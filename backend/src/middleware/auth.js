const { verifyToken } = require('../utils/jwt');
const pool = require('../db/pool');

// Кэш юзера на 30 секунд — чтобы не дёргать БД на каждый запрос.
const userCache = new Map();
const USER_CACHE_TTL = 30_000;

function getCachedUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() - entry.ts > USER_CACHE_TTL) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function setCachedUser(userId, user) {
  userCache.set(userId, { user, ts: Date.now() });
  if (userCache.size > 200) {
    let oldestKey = null, oldestTs = Infinity;
    for (const [key, entry] of userCache) {
      if (entry.ts < oldestTs) { oldestTs = entry.ts; oldestKey = key; }
    }
    if (oldestKey !== null) userCache.delete(oldestKey);
  }
}

function invalidateUserCache(userId) {
  if (userId) userCache.delete(userId);
  else userCache.clear();
}

// ─── Глобальная отметка отзыва сессий ────────────────────────────────────────
// settings_s.sessions_valid_after хранит UNIX-секунды. Любой токен с iat меньше
// этой отметки считается отозванным (кнопка «Завершить все сессии»). Кэшируем,
// чтобы не дёргать БД на каждый запрос.
let globalEpochCache = { value: 0, ts: 0 };
const GLOBAL_EPOCH_TTL = 30_000;

async function getGlobalLogoutEpoch() {
  if (globalEpochCache.ts && Date.now() - globalEpochCache.ts < GLOBAL_EPOCH_TTL) {
    return globalEpochCache.value;
  }
  try {
    const r = await pool.query(`SELECT value FROM settings_s WHERE key = 'sessions_valid_after'`);
    const v = r.rows.length ? (parseInt(r.rows[0].value, 10) || 0) : 0;
    globalEpochCache = { value: v, ts: Date.now() };
    return v;
  } catch {
    return globalEpochCache.value; // при сбое БД не блокируем всех
  }
}

function clearGlobalLogoutEpochCache() {
  globalEpochCache = { value: 0, ts: 0 };
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    const iatSec = payload.iat || 0; // момент выпуска токена (UNIX-секунды)

    // Глобальный отзыв: «Завершить все сессии» в настройках.
    const globalEpoch = await getGlobalLogoutEpoch();
    if (globalEpoch && iatSec < globalEpoch) {
      return res.status(401).json({ error: 'Сессия завершена. Войдите снова.', code: 'SESSION_REVOKED' });
    }

    let user = getCachedUser(payload.sub);
    if (!user) {
      // Загружаем users_s + предпочитаем role из sklad_user_roles_s, если есть линк users_d_id
      // (так смена роли админом действует мгновенно для общих аккаунтов).
      const result = await pool.query(
        `SELECT u.id, u.username, u.role, u.employee_id, u.users_d_id, u.active,
                u.tokens_valid_after,
                COALESCE(sur.role_id, u.role_id) AS effective_role_id,
                r.name AS role_name, r.permissions AS role_permissions,
                ed.status AS employee_status,
                ed.full_name AS d_full_name
         FROM users_s u
         LEFT JOIN sklad_user_roles_s sur ON sur.user_id = u.users_d_id
         LEFT JOIN roles_s r ON r.id = COALESCE(sur.role_id, u.role_id)
         LEFT JOIN users_d ud ON ud.id = u.users_d_id
         LEFT JOIN employees_d ed ON ed.id = ud.employee_id
         WHERE u.id = $1`,
        [payload.sub]
      );
      if (!result.rows.length || !result.rows[0].active) {
        return res.status(401).json({ error: 'Пользователь не найден или деактивирован' });
      }
      const row = result.rows[0];

      const BLOCKED_STATUSES = ['fired', 'rejected'];
      const isBlocked = row.users_d_id && BLOCKED_STATUSES.includes(row.employee_status);
      const blockedMessages = {
        fired: 'Вы уволены. Доступ к складу закрыт.',
        rejected: 'Вам отказано в трудоустройстве. Доступ к складу закрыт.',
      };

      // Для users_d-аккаунтов с разрешённым статусом проверяем роль склада.
      if (row.users_d_id && !isBlocked && !row.effective_role_id) {
        return res.status(403).json({ error: 'Доступ к складу отозван' });
      }

      user = {
        id: row.id,
        username: row.username,
        role: isBlocked ? 'employee' : (row.role_name === 'Администратор' ? 'admin' : (row.role || 'employee')),
        role_id: isBlocked ? null : row.effective_role_id,
        role_name: isBlocked ? null : row.role_name,
        employee_id: row.employee_id,
        users_d_id: row.users_d_id,
        permissions: isBlocked ? [] : (row.role_permissions || []),
        employee_status: row.employee_status || null,
        is_blocked: isBlocked,
        blocked_message: isBlocked ? blockedMessages[row.employee_status] : null,
        // секунды, в которые «протухают» все ранее выданные токены этого юзера
        tokens_valid_after_sec: row.tokens_valid_after
          ? Math.floor(new Date(row.tokens_valid_after).getTime() / 1000)
          : 0,
      };
      setCachedUser(payload.sub, user);
    }

    // Пер-юзерный отзыв: смена пароля / «выкинуть этого пользователя».
    if (user.tokens_valid_after_sec && iatSec < user.tokens_valid_after_sec) {
      return res.status(401).json({ error: 'Сессия завершена. Войдите снова.', code: 'SESSION_REVOKED' });
    }

    req.user = { ...user };

    // Update last_active_at (throttled — once per 5 min per user)
    const lastActiveKey = `la_${payload.sub}`;
    if (!userCache.has(lastActiveKey) || Date.now() - (userCache.get(lastActiveKey)?.ts || 0) > 300_000) {
      userCache.set(lastActiveKey, { ts: Date.now() });
      pool.query('UPDATE users_s SET last_active_at = NOW() WHERE id = $1', [payload.sub]).catch(() => {});
      // также обновляем last_active_at в sklad_user_roles_s, если есть линк
      if (req.user.users_d_id) {
        pool.query('UPDATE sklad_user_roles_s SET last_active_at = NOW() WHERE user_id = $1', [req.user.users_d_id]).catch(() => {});
      }
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'Нет прав доступа' });
  if (req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Нет прав доступа' });
}

// Flexible permission check: admin always passes, otherwise checks if user has ANY of the listed permissions
function requirePermission(...requiredPerms) {
  return (req, res, next) => {
    if (!req.user) return res.status(403).json({ error: 'Нет прав доступа' });
    if (req.user.role === 'admin') return next();
    const userPerms = req.user.permissions || [];
    if (requiredPerms.some(p => userPerms.includes(p))) return next();
    return res.status(403).json({ error: 'Нет прав доступа' });
  };
}

function requireAdminOrManager(req, res, next) {
  if (!req.user) return res.status(403).json({ error: 'Нет прав доступа' });
  const perms = req.user.permissions || [];
  if (['admin', 'manager'].includes(req.user.role) || perms.includes('staff.edit') || perms.includes('tasks.create') || perms.includes('warehouse.edit')) {
    return next();
  }
  return res.status(403).json({ error: 'Нет прав доступа' });
}

module.exports = { requireAuth, requireAdmin, requireAdminOrManager, requirePermission, invalidateUserCache, clearGlobalLogoutEpochCache };

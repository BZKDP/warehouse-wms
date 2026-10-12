const router = require('express').Router();
const pool = require('../db/pool');
const externalPool = require('../db/externalPool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { hashPassword } = require('../utils/password');
const { syncEmployeesFromOsite } = require('../utils/syncFromOsite');

// Lazy-refresh: страховка на случай, если LISTEN/NOTIFY (externalListener.js —
// основной механизм) что-то пропустил. Раньше синк ждали синхронно перед каждым
// GET /employees — полный проход по ~200+ сотрудникам с построчными запросами
// в обе БД занимал 4-6 секунд, и список в модалках выглядел пустым всё это время.
// Теперь синк идёт в фоне с cooldown, а список отдаётся сразу из локального
// зеркала (employees_s) — оно и так свежее благодаря LISTEN/NOTIFY.
let lastSyncAt = 0;
let syncInFlight = null;
const SYNC_COOLDOWN_MS = 60_000;

function lazySync() {
  const now = Date.now();
  if (syncInFlight || now - lastSyncAt < SYNC_COOLDOWN_MS) return;
  lastSyncAt = now;
  syncInFlight = syncEmployeesFromOsite()
    .catch(err => console.error('[Sync] Lazy sync failed:', err.message))
    .finally(() => { syncInFlight = null; });
}

// POST /api/staff/sync — trigger sync from external site
router.post('/sync', requireAuth, requirePermission('staff.view', 'staff.edit'), async (_req, res) => {
  try {
    await syncEmployeesFromOsite();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Employees ────────────────────────────────────────────────────────────────

router.get('/employees', requireAuth, requirePermission('staff.view', 'staff.edit', 'tasks.create', 'tasks.view'), async (req, res) => {
  try {
    lazySync(); // фоном, не блокирует ответ
    const result = await pool.query(
      `SELECT DISTINCT ON (e.id) e.*,
        u.id as user_id, u.username,
        NULL as password_plain,
        u.role, u.role_id, u.active as user_active, u.users_d_id,
        r.name as role_name,
        (SELECT COALESCE(json_agg(json_build_object(
          'product_id', ei.product_id, 'product_name', p.name, 'quantity', ei.quantity
        )), '[]'::json)
        FROM employee_inventory_s ei JOIN products_s p ON p.id=ei.product_id
        WHERE ei.employee_id=e.id AND ei.quantity>0) as inventory
       FROM employees_s e
       LEFT JOIN users_s u ON u.employee_id = e.id
       LEFT JOIN roles_s r ON r.id = u.role_id
       ORDER BY e.id, u.id`
    );
    // Re-sort by full_name after DISTINCT ON
    result.rows.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff/external-employees — list employees from external DB (not yet added)
router.get('/external-employees', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  try {
    // Get IDs already linked
    const linked = await pool.query('SELECT external_employee_id FROM employees_s WHERE external_employee_id IS NOT NULL');
    const linkedIds = linked.rows.map(r => r.external_employee_id);

    const result = await externalPool.query(
      `SELECT e.id, e.full_name, e.phone, e.status, p.name as position_name,
              u.login
       FROM employees_d e
       LEFT JOIN positions_d p ON p.id = e.position_id
       LEFT JOIN users_d u ON u.employee_id = e.id
       WHERE e.status = 'active'
       ORDER BY e.full_name`
    );

    // Mark which are already added
    const employees = result.rows.map(e => ({
      ...e,
      already_added: linkedIds.includes(e.id),
    }));

    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/employees', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { full_name, position, phone, external_employee_id, username, password, role, role_id } = req.body;
  if (!full_name) return res.status(400).json({ error: 'ФИО обязательно' });
  try {
    if (external_employee_id) {
      const exists = await pool.query('SELECT id FROM employees_s WHERE external_employee_id=$1', [external_employee_id]);
      if (exists.rows.length) return res.status(400).json({ error: 'Этот сотрудник уже добавлен' });
    }
    if (username) {
      const dup = await pool.query('SELECT id FROM users_s WHERE username=$1', [username]);
      if (dup.rows.length) return res.status(400).json({ error: 'Логин уже занят' });
    }
    const empResult = await pool.query(
      'INSERT INTO employees_s (full_name, position, phone, external_employee_id) VALUES ($1,$2,$3,$4) RETURNING *',
      [full_name, position || null, phone || null, external_employee_id || null]
    );
    const emp = empResult.rows[0];
    let user = null;
    // Пароль не передаётся с фронта (скрыт). Берём его из внешней БД по привязке.
    let userPassword = password;
    if (username && !userPassword && external_employee_id) {
      const ext = await externalPool.query('SELECT password_plain FROM users_d WHERE employee_id=$1', [external_employee_id]);
      userPassword = ext.rows[0]?.password_plain || null;
    }
    if (username && userPassword) {
      const hash = await hashPassword(userPassword);
      const userResult = await pool.query(
        'INSERT INTO users_s (username, password_hash, role, employee_id, role_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, role_id, employee_id, active',
        [username, hash, role || 'employee', emp.id, role_id || null]
      );
      user = userResult.rows[0];
    }
    res.status(201).json({ ...emp, user });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Этот сотрудник уже добавлен или логин занят' });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/staff/employees/:id/credentials — get login/password from external DB
router.get('/employees/:id/credentials', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  try {
    const emp = await pool.query('SELECT external_employee_id FROM employees_s WHERE id=$1', [req.params.id]);
    if (!emp.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });
    const extId = emp.rows[0].external_employee_id;
    if (!extId) return res.status(404).json({ error: 'Нет привязки к внешней БД' });
    const result = await externalPool.query('SELECT login FROM users_d WHERE employee_id=$1', [extId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Нет учётной записи во внешней БД' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/employees/:id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { full_name, position, phone, active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE employees_s
       SET full_name=COALESCE($1,full_name),
           position=COALESCE($2,position),
           phone=COALESCE($3,phone),
           active=COALESCE($4,active)
       WHERE id=$5 RETURNING *`,
      [full_name, position, phone, active, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/employees/:id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM employees_s WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────

// ─── Roles ────────────────────────────────────────────────────────────────────

router.get('/roles', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roles_s ORDER BY id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/roles', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  const { name, permissions } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const result = await pool.query(
      'INSERT INTO roles_s (name, permissions) VALUES ($1, $2) RETURNING *',
      [name, JSON.stringify(permissions || [])]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/roles/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  const { name, permissions } = req.body;
  try {
    const result = await pool.query(
      'UPDATE roles_s SET name=COALESCE($1,name), permissions=COALESCE($2,permissions) WHERE id=$3 RETURNING *',
      [name, permissions ? JSON.stringify(permissions) : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Роль не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Роль с таким названием уже существует' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/roles/:id', requireAuth, requirePermission('roles.manage'), async (req, res) => {
  try {
    // Check if role is in use
    const inUse = await pool.query('SELECT COUNT(*) FROM users_s WHERE role_id=$1', [req.params.id]);
    if (parseInt(inUse.rows[0].count) > 0) return res.status(400).json({ error: 'Роль используется, нельзя удалить' });
    await pool.query('DELETE FROM roles_s WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Доступ к складу через общие учётки users_d ──────────────────────────────
//
// users_d живёт в той же БД (это таблица сайта сотрудников). Auth склада
// читает её напрямую (см. routes/auth.js). Здесь — управление ролью склада
// для конкретного users_d.id (sklad_user_roles_s).

// GET /api/staff/sklad-d-users — список users_d с их статусом доступа к складу
router.get('/sklad-d-users', requireAuth, requirePermission('staff.view', 'staff.edit'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.login, u.employee_id AS d_employee_id,
              e.full_name, e.status, p.name AS position, d.name AS department,
              sur.role_id AS sklad_role_id, r.name AS sklad_role_name,
              sur.granted_at AS sklad_role_granted_at, sur.last_active_at
       FROM users_d u
       LEFT JOIN employees_d e ON e.id = u.employee_id
       LEFT JOIN positions_d p ON p.id = e.position_id
       LEFT JOIN departments_d d ON d.id = e.department_id
       LEFT JOIN sklad_user_roles_s sur ON sur.user_id = u.id
       LEFT JOIN roles_s r ON r.id = sur.role_id
       ORDER BY e.full_name`
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/staff/sklad-roles — выдать роль склада users_d-юзеру
router.post('/sklad-roles', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { user_id, role_id } = req.body;
  if (!user_id || !role_id) return res.status(400).json({ error: 'user_id и role_id обязательны' });
  try {
    // Проверка, что user_id существует в users_d
    const u = await pool.query('SELECT id FROM users_d WHERE id = $1', [user_id]);
    if (!u.rows.length) return res.status(404).json({ error: 'Пользователь не найден в users_d' });
    // Проверка роли
    const r = await pool.query('SELECT id FROM roles_s WHERE id = $1', [role_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Роль не найдена' });

    await pool.query(
      `INSERT INTO sklad_user_roles_s (user_id, role_id, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, granted_at = NOW(), granted_by = EXCLUDED.granted_by`,
      [user_id, role_id, req.user.users_d_id || null]
    );
    invalidateCacheForDUser(user_id).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/staff/sklad-roles/:user_id — сменить роль
router.put('/sklad-roles/:user_id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { role_id } = req.body;
  if (!role_id) return res.status(400).json({ error: 'role_id обязателен' });
  try {
    const r = await pool.query(
      'UPDATE sklad_user_roles_s SET role_id = $1, granted_at = NOW(), granted_by = $2 WHERE user_id = $3 RETURNING *',
      [role_id, req.user.users_d_id || null, req.params.user_id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Доступ к складу не выдан' });
    invalidateCacheForDUser(req.params.user_id).catch(() => {});
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/staff/sklad-roles/:user_id — отозвать доступ к складу
router.delete('/sklad-roles/:user_id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM sklad_user_roles_s WHERE user_id = $1', [req.params.user_id]);
    invalidateCacheForDUser(req.params.user_id).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Хелпер: инвалидация кэша users_s, привязанной к данному users_d.id
async function invalidateCacheForDUser(usersDId) {
  const { invalidateUserCache } = require('../middleware/auth');
  const r = await pool.query('SELECT id FROM users_s WHERE users_d_id = $1', [usersDId]);
  if (r.rows[0]) invalidateUserCache(r.rows[0].id);
}

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', requireAuth, requirePermission('staff.view', 'staff.edit'), async (req, res) => {
  try {
    // Возвращаем ВСЕХ из общей БД сайта сотрудников + служебные:
    //   - users_d                      (зарегистрированные пользователи)
    //   - pending_applicants_d         (заявки на трудоустройство, ещё не оформлены)
    //   - sklad_service_users_s        (служебные аккаунты склада)
    const result = await pool.query(
      `(
        -- users_d: все пользователи на сайте сотрудников (с linked employees_d или без)
        SELECT
          ud.id                              AS id,
          ud.login                           AS username,
          NULL::varchar                      AS password_plain,
          CASE WHEN r.name = 'Администратор' THEN 'admin' ELSE 'employee' END AS role,
          sur.role_id                        AS role_id,
          (ed.status IS NULL OR ed.status IN ('active','internship','pending_employment','pending_fired')) AS active,
          es.id                              AS employee_id,
          ud.id                              AS users_d_id,
          ud.created_at                      AS created_at,
          sur.last_active_at                 AS last_active_at,
          COALESCE(ed.full_name, ud.full_name, ud.login) AS employee_name,
          p.name                             AS position,
          d.name                             AS department,
          r.name                             AS role_name,
          r.permissions                      AS role_permissions,
          COALESCE(ed.status, 'unknown')     AS employee_status,
          'd'                                AS source
        FROM users_d ud
        LEFT JOIN employees_d ed ON ed.id = ud.employee_id
        LEFT JOIN positions_d p ON p.id = ed.position_id
        LEFT JOIN departments_d d ON d.id = ed.department_id
        LEFT JOIN sklad_user_roles_s sur ON sur.user_id = ud.id
        LEFT JOIN roles_s r ON r.id = sur.role_id
        LEFT JOIN employees_s es ON es.external_employee_id = ud.employee_id
      )
      UNION ALL
      (
        -- pending_applicants_d: заявки на трудоустройство (ещё нет users_d)
        SELECT
          (2000000 + pa.id)                  AS id,
          ('заявка №' || pa.id)              AS username,
          NULL::varchar                      AS password_plain,
          'employee'                         AS role,
          NULL::int                          AS role_id,
          (pa.status = 'pending')            AS active,
          NULL::int                          AS employee_id,
          NULL::int                          AS users_d_id,
          pa.created_at                      AS created_at,
          NULL::timestamptz                  AS last_active_at,
          pa.full_name                       AS employee_name,
          'Заявка на трудоустройство'::varchar AS position,
          NULL::varchar                      AS department,
          NULL::varchar                      AS role_name,
          NULL::jsonb                        AS role_permissions,
          ('applicant_' || COALESCE(pa.status, 'pending'))::varchar AS employee_status,
          'applicant'::varchar               AS source
        FROM pending_applicants_d pa
      )
      UNION ALL
      (
        -- employees_s «сироты»: записи, для которых сотрудник был удалён
        -- на сайте сотрудников. Сохраняем как архив — историю склада не теряем.
        SELECT
          (3000000 + es.id)                  AS id,
          ('архив #' || es.id)               AS username,
          NULL::varchar                      AS password_plain,
          'employee'                         AS role,
          NULL::int                          AS role_id,
          false                              AS active,
          es.id                              AS employee_id,
          NULL::int                          AS users_d_id,
          es.created_at                      AS created_at,
          NULL::timestamptz                  AS last_active_at,
          es.full_name                       AS employee_name,
          es.position                        AS position,
          es.department                      AS department,
          NULL::varchar                      AS role_name,
          NULL::jsonb                        AS role_permissions,
          'archived'::varchar                AS employee_status,
          'archived'::varchar                AS source
        FROM employees_s es
        WHERE es.external_employee_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM employees_d ed WHERE ed.id = es.external_employee_id)
      )
      UNION ALL
      (
        -- sklad_service_users_s: служебные аккаунты склада
        SELECT
          (1000000 + sv.id)                  AS id,
          sv.username                        AS username,
          NULL::varchar                      AS password_plain,
          CASE WHEN r.name = 'Администратор' THEN 'admin' ELSE 'employee' END AS role,
          sv.role_id                         AS role_id,
          sv.active                          AS active,
          NULL::int                          AS employee_id,
          NULL::int                          AS users_d_id,
          sv.created_at                      AS created_at,
          sv.last_active_at                  AS last_active_at,
          sv.username                        AS employee_name,
          'Служебный аккаунт'::varchar       AS position,
          NULL::varchar                      AS department,
          r.name                             AS role_name,
          r.permissions                      AS role_permissions,
          'service'::varchar                 AS employee_status,
          'service'::varchar                 AS source
        FROM sklad_service_users_s sv
        LEFT JOIN roles_s r ON r.id = sv.role_id
      )
      ORDER BY employee_name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { username, password, role, employee_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Логин и пароль обязательны' });
  try {
    const hash = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users_s (username, password_hash, password_plain, role, employee_id) VALUES ($1,$2,$3,$4,$5) RETURNING id, username, role, employee_id, active, created_at',
      [username, hash, password, role || 'employee', employee_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Логин уже занят' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const { username, role, employee_id, active, role_id, source } = req.body;
  const userId = parseInt(req.params.id);
  try {
    // ─── users_d (сайт сотрудников) ──────────────────────────────────────
    if (source === 'd') {
      // Роль склада → sklad_user_roles_s
      if (role_id !== undefined) {
        if (role_id) {
          await pool.query(
            `INSERT INTO sklad_user_roles_s (user_id, role_id, granted_at, granted_by)
             VALUES ($1, $2, NOW(), $3)
             ON CONFLICT (user_id) DO UPDATE SET role_id = $2, granted_at = NOW(), granted_by = $3`,
            [userId, role_id, req.user.id || null]);
        } else {
          // Снять роль
          await pool.query('DELETE FROM sklad_user_roles_s WHERE user_id = $1', [userId]);
        }
      }
      // Смена пароля отключена — пароли скрыты и не редактируются через интерфейс.
      // Вернуть обновлённого пользователя
      const updated = await pool.query(
        `SELECT ud.id, ud.login AS username, NULL::varchar AS password_plain,
                CASE WHEN r.name = 'Администратор' THEN 'admin' ELSE 'employee' END AS role,
                sur.role_id, es.id AS employee_id,
                (ed.status IS NULL OR ed.status IN ('active','internship','pending_employment','pending_fired')) AS active
         FROM users_d ud
         LEFT JOIN employees_d ed ON ed.id = ud.employee_id
         LEFT JOIN sklad_user_roles_s sur ON sur.user_id = ud.id
         LEFT JOIN roles_s r ON r.id = sur.role_id
         LEFT JOIN employees_s es ON es.external_employee_id = ud.employee_id
         WHERE ud.id = $1`, [userId]);
      if (!updated.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
      return res.json(updated.rows[0]);
    }

    // ─── sklad_service_users_s (служебные аккаунты) ──────────────────────
    if (source === 'service') {
      const realId = userId - 1000000;
      // Смена пароля отключена — пароли скрыты и не редактируются через интерфейс.
      const result = await pool.query(
        `UPDATE sklad_service_users_s
         SET username = COALESCE($1, username),
             role_id = COALESCE($2, role_id),
             active = COALESCE($3, active)
         WHERE id = $4
         RETURNING id, username, role_id, active`,
        [username, role_id || null, active, realId]);
      if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
      return res.json({ ...result.rows[0], id: userId });
    }

    // ─── Legacy users_s (обратная совместимость) ─────────────────────────
    // Смена пароля отключена — пароли скрыты и не редактируются через интерфейс.
    const result = await pool.query(
      `UPDATE users_s
       SET username=COALESCE($1,username),
           role=COALESCE($2,role),
           employee_id=COALESCE($3,employee_id),
           active=COALESCE($4,active),
           role_id=$6
       WHERE id=$5
       RETURNING id, username, role, role_id, employee_id, active`,
      [username, role, employee_id, active, userId, role_id !== undefined ? role_id : null]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Логин уже занят' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  if (req.user.id === parseInt(req.params.id)) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  try {
    await pool.query('DELETE FROM users_s WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Employee Breaks ─────────────────────────────────────────────────────

// POST /api/staff/breaks/start — employee starts a break (lunch)
router.post('/breaks/start', requireAuth, async (req, res) => {
  const employeeId = req.user.employee_id;
  if (!employeeId) return res.status(400).json({ error: 'Нет привязки к сотруднику' });
  try {
    // Check if already on break
    const active = await pool.query(
      'SELECT id FROM employee_breaks_s WHERE employee_id=$1 AND ended_at IS NULL LIMIT 1',
      [employeeId]
    );
    if (active.rows.length) return res.status(400).json({ error: 'Вы уже на перерыве' });
    const result = await pool.query(
      'INSERT INTO employee_breaks_s (employee_id, break_type) VALUES ($1, $2) RETURNING *',
      [employeeId, req.body.break_type || 'lunch']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/staff/breaks/end — employee ends a break (tech breaks need admin)
router.post('/breaks/end', requireAuth, async (req, res) => {
  const employeeId = req.body.employee_id || req.user.employee_id;
  if (!employeeId) return res.status(400).json({ error: 'Нет привязки к сотруднику' });
  try {
    const active = await pool.query(
      'SELECT * FROM employee_breaks_s WHERE employee_id=$1 AND ended_at IS NULL LIMIT 1',
      [employeeId]
    );
    if (!active.rows.length) return res.status(400).json({ error: 'Нет активного перерыва' });
    // Tech break — only admin/manager can end
    if (active.rows[0].break_type === 'tech' && req.user.employee_id === parseInt(employeeId)) {
      const perms = req.user.permissions || [];
      if (req.user.role !== 'admin' && !perms.includes('tasks.view')) {
        return res.status(403).json({ error: 'Технический перерыв может снять только администратор' });
      }
    }
    const result = await pool.query(
      'UPDATE employee_breaks_s SET ended_at=NOW() WHERE employee_id=$1 AND ended_at IS NULL RETURNING *',
      [employeeId]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/staff/breaks/active — check if employee is on break
router.get('/breaks/active', requireAuth, async (req, res) => {
  const employeeId = req.user.employee_id;
  if (!employeeId) return res.json({ on_break: false });
  try {
    const result = await pool.query(
      'SELECT * FROM employee_breaks_s WHERE employee_id=$1 AND ended_at IS NULL LIMIT 1',
      [employeeId]
    );
    res.json({ on_break: result.rows.length > 0, break: result.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/staff/breaks/admin-add — admin adds a tech break for an employee
router.post('/breaks/admin-add', requireAuth, requirePermission('tasks.view', 'tasks.create'), async (req, res) => {
  const { employee_id, break_type, started_at, ended_at } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id обязателен' });
  try {
    const result = await pool.query(
      'INSERT INTO employee_breaks_s (employee_id, break_type, started_at, ended_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [employee_id, break_type || 'tech', started_at || new Date(), ended_at || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/staff/breaks/admin-end — admin ends a tech break for an employee
router.post('/breaks/admin-end', requireAuth, requirePermission('tasks.view', 'tasks.create'), async (req, res) => {
  const { employee_id } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id обязателен' });
  try {
    const result = await pool.query(
      'UPDATE employee_breaks_s SET ended_at=NOW() WHERE employee_id=$1 AND ended_at IS NULL RETURNING *',
      [employee_id]
    );
    if (!result.rows.length) return res.status(400).json({ error: 'Нет активного перерыва' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

const router = require('express').Router();
const pool = require('../db/pool');
const config = require('../config');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  API_KEY_SCOPES,
  generateApiKey,
  validateScopes,
} = require('../utils/apiKeys');

router.use(requireAuth, requirePermission('settings'));

function docsUrl() {
  return `${config.appBasePath || ''}/api/public/v1/docs`;
}

function parseExpiry(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseRateLimit(value) {
  const limit = Number(value ?? 120);
  return Number.isInteger(limit) && limit >= 1 && limit <= 5000 ? limit : null;
}

// GET /api/api-management/scopes — справочник прав для формы и документации.
router.get('/scopes', (_req, res) => {
  res.json({ scopes: API_KEY_SCOPES, docs_url: docsUrl() });
});

// GET /api/api-management/keys — секретов здесь нет и никогда не будет.
router.get('/keys', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT k.id, k.name, k.key_prefix, k.scopes, k.active,
             k.rate_limit_per_minute, k.expires_at, k.last_used_at,
             k.last_used_ip, k.revoked_at, k.created_at, k.updated_at,
             u.username AS created_by_username,
             COUNT(l.id)::int AS requests_total,
             COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '24 hours')::int AS requests_24h,
             COUNT(l.id) FILTER (WHERE l.status_code >= 400 AND l.created_at >= NOW() - INTERVAL '24 hours')::int AS errors_24h
        FROM api_keys_s k
        LEFT JOIN users_s u ON u.id = k.created_by
        LEFT JOIN api_request_logs_s l ON l.api_key_id = k.id
       GROUP BY k.id, u.username
       ORDER BY k.active DESC, k.created_at DESC
    `);
    res.json({ items: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/api-management/keys — ключ показывается только в этом ответе.
router.post('/keys', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Название ключа обязательно' });
  if (name.length > 160) return res.status(400).json({ error: 'Название не должно превышать 160 символов' });

  const { scopes, invalid } = validateScopes(req.body?.scopes);
  if (invalid.length) return res.status(400).json({ error: 'Неизвестные права API', invalid_scopes: invalid });
  if (!scopes.length) return res.status(400).json({ error: 'Выберите хотя бы одно право' });

  const expiresAt = parseExpiry(req.body?.expires_at);
  if (expiresAt === undefined) return res.status(400).json({ error: 'Некорректная дата окончания действия' });
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Дата окончания должна быть в будущем' });
  }
  const rateLimit = parseRateLimit(req.body?.rate_limit_per_minute);
  if (!rateLimit) return res.status(400).json({ error: 'Лимит должен быть от 1 до 5000 запросов в минуту' });

  const generated = generateApiKey();
  try {
    const result = await pool.query(
      `INSERT INTO api_keys_s
         (name, key_prefix, key_hash, scopes, rate_limit_per_minute, expires_at, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)
       RETURNING id, name, key_prefix, scopes, active, rate_limit_per_minute,
                 expires_at, created_at`,
      [name, generated.prefix, generated.hash, JSON.stringify(scopes), rateLimit, expiresAt, req.user.id]
    );
    res.status(201).json({
      ...result.rows[0],
      token: generated.token,
      token_visible_once: true,
      message: 'Скопируйте ключ сейчас: после закрытия окна его нельзя будет посмотреть снова.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/api-management/keys/:id — меняются только переданные поля.
router.patch('/keys/:id', async (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ error: 'Некорректный ID ключа' });

  const sets = [];
  const params = [];
  const add = (sql, value) => { params.push(value); sets.push(`${sql} = $${params.length}`); };

  if (Object.hasOwn(req.body || {}, 'name')) {
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 160) return res.status(400).json({ error: 'Некорректное название ключа' });
    add('name', name);
  }
  if (Object.hasOwn(req.body || {}, 'scopes')) {
    const { scopes, invalid } = validateScopes(req.body.scopes);
    if (invalid.length) return res.status(400).json({ error: 'Неизвестные права API', invalid_scopes: invalid });
    if (!scopes.length) return res.status(400).json({ error: 'Выберите хотя бы одно право' });
    params.push(JSON.stringify(scopes));
    sets.push(`scopes = $${params.length}::jsonb`);
  }
  if (Object.hasOwn(req.body || {}, 'rate_limit_per_minute')) {
    const limit = parseRateLimit(req.body.rate_limit_per_minute);
    if (!limit) return res.status(400).json({ error: 'Лимит должен быть от 1 до 5000 запросов в минуту' });
    add('rate_limit_per_minute', limit);
  }
  if (Object.hasOwn(req.body || {}, 'expires_at')) {
    const expiry = parseExpiry(req.body.expires_at);
    if (expiry === undefined) return res.status(400).json({ error: 'Некорректная дата окончания действия' });
    if (expiry && expiry.getTime() <= Date.now()) return res.status(400).json({ error: 'Дата окончания должна быть в будущем' });
    add('expires_at', expiry);
  }
  if (!sets.length) return res.status(400).json({ error: 'Нет полей для изменения' });

  params.push(keyId);
  try {
    const result = await pool.query(
      `UPDATE api_keys_s SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $${params.length} AND active = true
        RETURNING id, name, key_prefix, scopes, active, rate_limit_per_minute,
                  expires_at, last_used_at, created_at, updated_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Активный API-ключ не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/api-management/keys/:id/rotate — старое значение сразу перестаёт работать.
router.post('/keys/:id/rotate', async (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ error: 'Некорректный ID ключа' });
  const generated = generateApiKey();
  try {
    const result = await pool.query(
      `UPDATE api_keys_s
          SET key_prefix = $1, key_hash = $2, last_used_at = NULL,
              last_used_ip = NULL, updated_at = NOW()
        WHERE id = $3 AND active = true
        RETURNING id, name, key_prefix, scopes, active, rate_limit_per_minute,
                  expires_at, created_at, updated_at`,
      [generated.prefix, generated.hash, keyId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Активный API-ключ не найден' });
    res.json({
      ...result.rows[0], token: generated.token, token_visible_once: true,
      message: 'Предыдущее значение отозвано. Скопируйте новый ключ сейчас.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE означает отзыв, а не физическое удаление — история остаётся связанной.
router.delete('/keys/:id', async (req, res) => {
  const keyId = Number(req.params.id);
  if (!Number.isInteger(keyId) || keyId <= 0) return res.status(400).json({ error: 'Некорректный ID ключа' });
  try {
    const result = await pool.query(
      `UPDATE api_keys_s
          SET active = false, revoked_at = NOW(), revoked_by = $2, updated_at = NOW()
        WHERE id = $1 AND active = true
        RETURNING id, name, key_prefix, active, revoked_at`,
      [keyId, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Активный API-ключ не найден' });
    res.json({ ...result.rows[0], message: 'API-ключ отозван' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM api_keys_s WHERE active AND (expires_at IS NULL OR expires_at > NOW())) AS active_keys,
        COUNT(*)::int AS requests_total,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS requests_today,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS requests_24h,
        COUNT(*) FILTER (WHERE status_code >= 400 AND created_at >= NOW() - INTERVAL '24 hours')::int AS errors_24h,
        COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours'), 1), 0) AS avg_duration_24h
      FROM api_request_logs_s
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/logs', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];
  const addCondition = (sql, value) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };

  if (req.query.key_id) {
    const keyId = Number(req.query.key_id);
    if (!Number.isInteger(keyId) || keyId <= 0) {
      return res.status(400).json({ error: 'Некорректный key_id' });
    }
    addCondition('l.api_key_id = ?', keyId);
  }
  if (req.query.method) addCondition('l.method = ?', String(req.query.method).toUpperCase());
  if (req.query.status === 'success') conditions.push('l.status_code < 400');
  if (req.query.status === 'error') conditions.push('l.status_code >= 400');
  if (req.query.q) {
    const pattern = `%${String(req.query.q).slice(0, 200)}%`;
    params.push(pattern, pattern, pattern);
    const n = params.length;
    conditions.push(`(l.path ILIKE $${n - 2} OR l.operation ILIKE $${n - 1} OR l.request_id ILIKE $${n})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM api_request_logs_s l ${where}`, params);
    const dataParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT l.id, l.api_key_id, l.key_prefix, l.request_id, l.operation,
              l.method, l.path, l.status_code, l.duration_ms, l.ip_address,
              l.user_agent, l.request_body, l.error_code, l.error_message,
              l.created_at, k.name AS key_name
         FROM api_request_logs_s l
         LEFT JOIN api_keys_s k ON k.id = l.api_key_id
         ${where}
        ORDER BY l.created_at DESC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );
    res.json({
      items: result.rows,
      pagination: {
        page, limit, total: count.rows[0].total,
        pages: Math.ceil(count.rows[0].total / limit),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

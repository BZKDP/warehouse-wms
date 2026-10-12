const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { verifyToken } = require('../utils/jwt');

// POST /api/errors/system — принять ошибку с фронтенда (любой авторизованный или анон)
router.post('/system', async (req, res) => {
  try {
    const {
      error_type,
      error_message,
      error_stack,
      page_url,
      component,
      http_status,
      request_url,
      request_method,
      response_data,
      browser_info,
      extra_json,
    } = req.body;

    // Пробуем получить пользователя из токена (но не блокируем если нет)
    let userId = null, username = null, userRole = null;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const payload = verifyToken(token);
        if (payload?.id) {
          userId = payload.id;
          username = payload.username;
          userRole = payload.role;
        }
      }
    } catch {}

    await pool.query(`
      INSERT INTO system_errors_s
        (user_id, username, user_role, error_type, error_message, error_stack,
         page_url, component, http_status, request_url, request_method,
         response_data, browser_info, extra_json)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    `, [
      userId,
      username,
      userRole,
      error_type || 'unknown',
      error_message ? String(error_message).slice(0, 5000) : null,
      error_stack  ? String(error_stack).slice(0, 10000) : null,
      page_url     ? String(page_url).slice(0, 1000) : null,
      component    ? String(component).slice(0, 255) : null,
      http_status  ? parseInt(http_status) : null,
      request_url  ? String(request_url).slice(0, 1000) : null,
      request_method ? String(request_method).slice(0, 10) : null,
      response_data  ? String(response_data).slice(0, 5000) : null,
      browser_info   ? String(browser_info).slice(0, 1000) : null,
      extra_json     ? JSON.stringify(extra_json) : null,
    ]);

    res.json({ ok: true });
  } catch (err) {
    // Молчим — не хотим бесконечных петель
    res.json({ ok: false });
  }
});

// GET /api/errors/system — список системных ошибок (только admin)
router.get('/system', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    const { limit = 200, offset = 0, type } = req.query;
    let where = type ? `WHERE error_type = $3` : '';
    const params = type
      ? [parseInt(limit), parseInt(offset), type]
      : [parseInt(limit), parseInt(offset)];

    const { rows } = await pool.query(`
      SELECT * FROM system_errors_s
      ${where}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const { rows: [{ cnt }] } = await pool.query(
      `SELECT COUNT(*) as cnt FROM system_errors_s ${where}`,
      type ? [type] : []
    );

    res.json({ items: rows, total: parseInt(cnt) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/errors/system/:id — удалить запись (только admin)
router.delete('/system/:id', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    await pool.query('DELETE FROM system_errors_s WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/errors/system — очистить все (только admin)
router.delete('/system', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    await pool.query('TRUNCATE system_errors_s RESTART IDENTITY');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

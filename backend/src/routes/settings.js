const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');

// GET /api/settings — all settings
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings_s ORDER BY key');
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings — update multiple settings (admin only)
router.put('/', requireAuth, requirePermission('settings'), async (req, res) => {
  const entries = Object.entries(req.body);
  if (!entries.length) return res.status(400).json({ error: 'Нет данных для обновления' });
  try {
    for (const [key, value] of entries) {
      await pool.query(
        `INSERT INTO settings_s (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)]
      );
    }
    const result = await pool.query('SELECT key, value FROM settings_s ORDER BY key');
    const settings = {};
    for (const row of result.rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

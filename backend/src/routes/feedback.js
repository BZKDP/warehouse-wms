const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

// Optional multer (may not be installed yet on server)
let upload = null;
try {
  const multer = require('multer');
  const uploadsDir = path.join(__dirname, '../../uploads/feedback');
  try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch {}

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname || '.bin'));
    },
  });

  upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.fieldname === 'screenshot' && !/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.originalname || '')) {
        return cb(new Error('Допустимы только изображения'));
      }
      if (file.fieldname === 'audio' && !/\.(mp3|wav|ogg|webm|m4a)$/i.test(file.originalname || '')) {
        return cb(new Error('Допустимы только аудио'));
      }
      cb(null, true);
    },
  }).fields([
    { name: 'screenshot', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]);
} catch (e) {
  console.warn('multer not available, file uploads disabled for feedback:', e.message);
}

// Middleware: try multer, fallback to no-file
function handleUpload(req, res, next) {
  if (!upload) return next();
  upload(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

// POST / — create feedback
router.post('/', requireAuth, handleUpload, async (req, res) => {
  try {
    const { category = 'bug', subcategory, description, transcript, page_url, browser_info } = req.body;
    const screenshotFile = req.files?.screenshot?.[0];
    const audioFile = req.files?.audio?.[0];

    const result = await pool.query(
      `INSERT INTO feedback_s (user_id, username, user_role, category, subcategory, description, transcript, screenshot_path, audio_path, page_url, browser_info)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [
        req.user?.id || null,
        req.user?.username || null,
        req.user?.role || null,
        category, subcategory || null,
        description || null, transcript || null,
        screenshotFile?.path || null,
        audioFile?.path || null,
        page_url || null, browser_info || null,
      ]
    );
    res.json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / — list (admin)
router.get('/', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    const { status, category, page = 1, limit = 50 } = req.query;
    const conditions = [];
    const params = [];
    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (Number(page) - 1) * Number(limit);
    params.push(Number(limit), offset);
    const result = await pool.query(
      `SELECT * FROM feedback_s ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ rows: result.rows, total: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /:id — detail (admin)
router.get('/:id', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM feedback_s WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /:id — update status/notes (admin)
router.patch('/:id', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const sets = ['updated_at = NOW()'];
    const params = [];
    if (status) { params.push(status); sets.push(`status = $${params.length}`); }
    if (admin_notes !== undefined) { params.push(admin_notes); sets.push(`admin_notes = $${params.length}`); }
    if (status === 'resolved') {
      params.push(req.user.id); sets.push(`resolved_by = $${params.length}`);
      sets.push('resolved_at = NOW()');
    }
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE feedback_s SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id (admin)
router.delete('/:id', requireAuth, requirePermission('errors'), async (req, res) => {
  try {
    const item = await pool.query('SELECT screenshot_path, audio_path FROM feedback_s WHERE id = $1', [req.params.id]);
    if (!item.rows.length) return res.status(404).json({ error: 'Не найдено' });
    // Remove files
    const row = item.rows[0];
    if (row.screenshot_path) try { fs.unlinkSync(row.screenshot_path); } catch {}
    if (row.audio_path) try { fs.unlinkSync(row.audio_path); } catch {}
    await pool.query('DELETE FROM feedback_s WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

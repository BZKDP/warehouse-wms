const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');

// Дата создания из формы приходит как YYYY-MM-DD — привязываем к полудню,
// чтобы часовой пояс не сдвинул её на соседний день.
function normalizeDate(value) {
  if (!value) return null;
  const v = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v;
}

// GET /api/materials
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      search = '',
      category,
      archived = 'false',
      page = 1,
      limit = 50,
      sort_by = 'name',
      sort_dir = 'asc',
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    if (archived === 'false') {
      conditions.push('m.archived = false');
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(m.name ILIKE $${params.length} OR m.code ILIKE $${params.length})`);
    }

    if (category) {
      params.push(category);
      conditions.push(`m.category = $${params.length}`);
    }

    if (req.query.material_group) {
      params.push(req.query.material_group);
      conditions.push(`m.material_group = $${params.length}`);
    }

    const allowedSortBy = ['name', 'code', 'category', 'material_group', 'created_at', 'stock', 'buy_price'];
    const safeSortBy = allowedSortBy.includes(sort_by) ? sort_by : 'name';
    const safeSortDir = sort_dir === 'desc' ? 'DESC' : 'ASC';

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM raw_materials_s m ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataParams = [...params, parseInt(limit), offset];
    const rows = await pool.query(
      `SELECT m.id, m.name, m.code, m.article, m.unit, m.category, m.material_group, m.folder_path, m.stock, m.buy_price, m.archived, m.created_at
       FROM raw_materials_s m
       ${where}
       ORDER BY m.${safeSortBy} ${safeSortDir}
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    res.json({ rows: rows.rows, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/materials/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE category = 'ingredient') AS ingredients,
         COUNT(*) FILTER (WHERE category = 'packaging') AS packaging
       FROM raw_materials_s`
    );
    const groupsResult = await pool.query(
      `SELECT material_group, COUNT(*) as count FROM raw_materials_s WHERE archived = false GROUP BY material_group ORDER BY count DESC`
    );
    const stats = result.rows[0];
    res.json({
      total: parseInt(stats.total),
      ingredients: parseInt(stats.ingredients),
      packaging: parseInt(stats.packaging),
      groups: groupsResult.rows.map(r => ({ group: r.material_group, count: parseInt(r.count) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/materials/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM raw_materials_s WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Сырьё не найдено' });

    const material = result.rows[0];

    const techCardsResult = await pool.query(
      `SELECT tc.id, tc.name, tc.product_id, p.name as product_name, tcm.quantity
       FROM tech_card_materials_s tcm
       JOIN tech_cards_s tc ON tc.id = tcm.tech_card_id
       JOIN products_s p ON p.id = tc.product_id
       WHERE tcm.material_id = $1`,
      [material.id]
    );

    // Recipe: what this material consists of (for semi-products)
    const recipeResult = await pool.query(
      `SELECT mr.id as recipe_id, mr.quantity, mr.sort_order,
              rm.id, rm.name, rm.code, rm.unit, rm.category, rm.material_group
       FROM material_recipe_s mr
       JOIN raw_materials_s rm ON rm.id = mr.ingredient_id
       WHERE mr.material_id = $1
       ORDER BY mr.sort_order, rm.name`,
      [material.id]
    );

    // Used in: which materials use this one as ingredient
    const usedInResult = await pool.query(
      `SELECT mr.quantity,
              rm.id, rm.name, rm.code, rm.unit, rm.material_group
       FROM material_recipe_s mr
       JOIN raw_materials_s rm ON rm.id = mr.material_id
       WHERE mr.ingredient_id = $1
       ORDER BY rm.name`,
      [material.id]
    );

    res.json({
      ...material,
      tech_cards: techCardsResult.rows,
      recipe: recipeResult.rows,
      used_in_materials: usedInResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/materials — create new material
router.post('/', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    const { name, code, unit, category, material_group, folder_path, stock, buy_price, created_at } = req.body;
    if (!name) return res.status(400).json({ error: 'name обязателен' });
    const result = await pool.query(
      `INSERT INTO raw_materials_s (name, code, unit, category, material_group, folder_path, stock, buy_price, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW())) RETURNING *`,
      [name, code || null, unit || 'шт', category || 'ingredient', material_group || 'другое', folder_path || null, stock || 0, buy_price || null, normalizeDate(created_at)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/materials/:id
router.put('/:id', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    const { name, code, unit, category, archived, buy_price, min_stock, supplier, notes, stock } = req.body;
    const fields = [];
    const params = [];

    if (name !== undefined) { params.push(name); fields.push(`name = $${params.length}`); }
    if (code !== undefined) { params.push(code); fields.push(`code = $${params.length}`); }
    if (unit !== undefined) { params.push(unit); fields.push(`unit = $${params.length}`); }
    if (category !== undefined) { params.push(category); fields.push(`category = $${params.length}`); }
    if (archived !== undefined) { params.push(archived); fields.push(`archived = $${params.length}`); }
    if (buy_price !== undefined) { params.push(buy_price); fields.push(`buy_price = $${params.length}`); }
    if (min_stock !== undefined) { params.push(min_stock); fields.push(`min_stock = $${params.length}`); }
    if (supplier !== undefined) { params.push(supplier); fields.push(`supplier = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); fields.push(`notes = $${params.length}`); }
    if (stock !== undefined) { params.push(stock); fields.push(`stock = $${params.length}`); }
    if (req.body.material_group !== undefined) { params.push(req.body.material_group); fields.push(`material_group = $${params.length}`); }
    if (req.body.created_at) { params.push(normalizeDate(req.body.created_at)); fields.push(`created_at = $${params.length}::timestamptz`); }
    if (req.body.article !== undefined) { params.push(req.body.article || null); fields.push(`article = $${params.length}`); }

    if (fields.length === 0) return res.status(400).json({ error: 'Нет полей для обновления' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE raw_materials_s SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Сырьё не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/materials/:id/recipe — add ingredient to material recipe
router.post('/:id/recipe', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    const { ingredient_id, quantity } = req.body;
    if (!ingredient_id) return res.status(400).json({ error: 'ingredient_id обязателен' });
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order),0)+1 as next FROM material_recipe_s WHERE material_id=$1', [req.params.id]);
    const result = await pool.query(
      `INSERT INTO material_recipe_s (material_id, ingredient_id, quantity, sort_order)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.id, ingredient_id, quantity || 0, maxOrder.rows[0].next]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/materials/:id/recipe/:recipeId
router.delete('/:id/recipe/:recipeId', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM material_recipe_s WHERE id=$1 AND material_id=$2', [req.params.recipeId, req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/materials/:id
router.delete('/:id', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM tech_card_materials_s WHERE material_id = $1', [req.params.id]);
    const result = await pool.query('DELETE FROM raw_materials_s WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;

const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getWarehouseDeletionImpact, deleteWarehouseTransactional } = require('../utils/warehouseDeletion');

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

// GET /api/fbo/warehouses — list FBO warehouses
router.get('/warehouses', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*,
        COALESCE(rc.cnt, 0) as rows_count,
        COALESCE(pc.cnt, 0) as pallets_count,
        COALESCE(bc.cnt, 0) as boxes_count
      FROM warehouses_s w
      LEFT JOIN (SELECT warehouse_id, COUNT(*) as cnt FROM pallet_rows_s GROUP BY warehouse_id) rc ON rc.warehouse_id = w.id
      LEFT JOIN (SELECT pr.warehouse_id, COUNT(*) as cnt FROM pallets_s pa JOIN pallet_rows_s pr ON pa.row_id = pr.id GROUP BY pr.warehouse_id) pc ON pc.warehouse_id = w.id
      LEFT JOIN (SELECT pr.warehouse_id, COUNT(*) as cnt FROM boxes_s b JOIN pallets_s pa ON b.pallet_id = pa.id JOIN pallet_rows_s pr ON pa.row_id = pr.id WHERE b.status = 'closed' GROUP BY pr.warehouse_id) bc ON bc.warehouse_id = w.id
      WHERE w.warehouse_type IN ('fbo', 'both') ORDER BY w.name
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/fbo/warehouses — create FBO warehouse
router.post('/warehouses', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const result = await pool.query(
      `INSERT INTO warehouses_s (name, notes, warehouse_type) VALUES ($1,$2,'fbo') RETURNING *`,
      [name, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/fbo/warehouses/:id/delete-impact — что именно будет удалено
router.get('/warehouses/:id/delete-impact', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    const impact = await getWarehouseDeletionImpact(pool, req.params.id);
    if (!impact) return res.status(404).json({ error: 'Склад не найден' });
    res.json(impact);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/fbo/warehouses/:id
// Тот же каскад, что и у стеллажного склада: сначала снимаются ссылки задач,
// истории и начислений, затем удаляется структура. Без этого удаление падало
// по внешним ключам (assembly_items_s, inventory_tasks_s) и склад «не удалялся».
router.delete('/warehouses/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    const result = await deleteWarehouseTransactional(pool, req.params.id, {
      force: parseBoolean(req.query.force, false),
    });
    if (result.code === 'NOT_FOUND') return res.status(404).json({ error: 'Склад не найден' });
    if (result.code === 'WAREHOUSE_HAS_STOCK') {
      return res.status(409).json({
        error: 'На складе есть остатки. Требуется подтверждённое удаление.',
        code: 'WAREHOUSE_HAS_STOCK',
        impact: result.impact,
      });
    }
    res.json({ success: true, deleted_stock: result.impact.total_stock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fbo/warehouses/:id — warehouse with rows and pallets
router.get('/warehouses/:id', requireAuth, async (req, res) => {
  try {
    const wh = await pool.query('SELECT * FROM warehouses_s WHERE id=$1 AND warehouse_type IN (\'fbo\',\'both\')', [req.params.id]);
    if (!wh.rows.length) return res.status(404).json({ error: 'Склад не найден' });
    const rows = await pool.query(`
      SELECT pr.*,
        (SELECT COUNT(*) FROM pallets_s WHERE row_id = pr.id) as pallets_count,
        (SELECT COUNT(*) FROM boxes_s b JOIN pallets_s pa ON b.pallet_id = pa.id WHERE pa.row_id = pr.id AND b.status = 'closed') as boxes_count,
        (SELECT COALESCE(SUM(b.quantity),0) FROM boxes_s b JOIN pallets_s pa ON b.pallet_id = pa.id WHERE pa.row_id = pr.id AND b.status = 'closed')
          + (SELECT COALESCE(SUM(pi.quantity),0) FROM pallet_items_s pi JOIN pallets_s pa ON pi.pallet_id = pa.id WHERE pa.row_id = pr.id AND pi.quantity > 0) as total_items
      FROM pallet_rows_s pr WHERE pr.warehouse_id = $1 ORDER BY pr.number
    `, [req.params.id]);
    res.json({ ...wh.rows[0], rows: rows.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/fbo/rows — create row
router.post('/rows', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { warehouse_id, number, name } = req.body;
  if (!warehouse_id || !number || !name) return res.status(400).json({ error: 'warehouse_id, number, name обязательны' });
  try {
    const result = await pool.query(
      'INSERT INTO pallet_rows_s (warehouse_id, number, name) VALUES ($1,$2,$3) RETURNING *',
      [warehouse_id, number, name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/fbo/rows/:id
router.put('/rows/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, number } = req.body;
  try {
    const result = await pool.query(
      'UPDATE pallet_rows_s SET name=COALESCE($1,name), number=COALESCE($2,number) WHERE id=$3 RETURNING *',
      [name || null, number || null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ряд не найден' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/fbo/rows/:id (cascade: nullify refs → items → boxes → pallets → row)
router.delete('/rows/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pallets = await client.query('SELECT id FROM pallets_s WHERE row_id=$1', [req.params.id]);
    const palletIds = pallets.rows.map(p => p.id);
    if (palletIds.length) {
      const boxes = await client.query('SELECT id FROM boxes_s WHERE pallet_id = ANY($1)', [palletIds]);
      const boxIds = boxes.rows.map(b => b.id);
      // Nullify FK refs
      await client.query('UPDATE inventory_tasks_s SET target_pallet_id=NULL WHERE target_pallet_id=ANY($1)', [palletIds]);
      await client.query('UPDATE inventory_tasks_s SET dest_pallet_id=NULL WHERE dest_pallet_id=ANY($1)', [palletIds]);
      await client.query('UPDATE assembly_items_s SET source_pallet_id=NULL WHERE source_pallet_id=ANY($1)', [palletIds]);
      await client.query('UPDATE movements_s SET from_pallet_id=NULL WHERE from_pallet_id=ANY($1)', [palletIds]);
      await client.query('UPDATE movements_s SET to_pallet_id=NULL WHERE to_pallet_id=ANY($1)', [palletIds]);
      if (boxIds.length) {
        await client.query('UPDATE inventory_tasks_s SET target_box_id=NULL WHERE target_box_id=ANY($1)', [boxIds]);
        await client.query('UPDATE inventory_task_boxes_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
        await client.query('UPDATE assembly_items_s SET source_box_id=NULL WHERE source_box_id=ANY($1)', [boxIds]);
        await client.query('UPDATE movements_s SET from_box_id=NULL WHERE from_box_id=ANY($1)', [boxIds]);
        await client.query('UPDATE movements_s SET to_box_id=NULL WHERE to_box_id=ANY($1)', [boxIds]);
        await client.query('UPDATE employee_earnings_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
        await client.query('DELETE FROM box_items_s WHERE box_id = ANY($1)', [boxIds]);
      }
      await client.query('DELETE FROM boxes_s WHERE pallet_id = ANY($1)', [palletIds]);
      await client.query('DELETE FROM pallet_items_s WHERE pallet_id = ANY($1)', [palletIds]);
    }
    await client.query('DELETE FROM pallets_s WHERE row_id=$1', [req.params.id]);
    await client.query('DELETE FROM pallet_rows_s WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// GET /api/fbo/rows/:id — row with pallets
router.get('/rows/:id', requireAuth, async (req, res) => {
  try {
    const row = await pool.query('SELECT * FROM pallet_rows_s WHERE id=$1', [req.params.id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Ряд не найден' });
    const pallets = await pool.query(`
      SELECT pa.*,
        (SELECT COUNT(*) FROM boxes_s WHERE pallet_id = pa.id AND status = 'closed') as boxes_count,
        (SELECT COALESCE(SUM(quantity),0) FROM boxes_s WHERE pallet_id = pa.id AND status = 'closed') +
        (SELECT COALESCE(SUM(quantity),0) FROM pallet_items_s WHERE pallet_id = pa.id AND quantity > 0) as total_items,
        (SELECT COUNT(*) FROM pallet_items_s WHERE pallet_id = pa.id AND quantity > 0) as loose_items_count
      FROM pallets_s pa WHERE pa.row_id = $1 ORDER BY pa.number
    `, [req.params.id]);
    res.json({ ...row.rows[0], pallets: pallets.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/fbo/pallets — create pallet
router.post('/pallets', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { row_id, number, name, uses_boxes } = req.body;
  if (!row_id || !number || !name) return res.status(400).json({ error: 'row_id, number, name обязательны' });
  try {
    const row = await pool.query('SELECT * FROM pallet_rows_s WHERE id=$1', [row_id]);
    if (!row.rows.length) return res.status(404).json({ error: 'Ряд не найден' });
    const code = `Р${row.rows[0].number}П${number}`;
    const barcodeValue = String(Math.floor(Math.random() * 900000000) + 100000000);
    const result = await pool.query(
      'INSERT INTO pallets_s (row_id, number, name, barcode_value, uses_boxes) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [row_id, number, name, barcodeValue, parseBoolean(uses_boxes, true)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Паллет с номером ${number} уже существует в этом ряду` });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/fbo/pallets/:id/box — add product directly to pallet
router.post('/pallets/:id/box', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { product_id, quantity, box_size } = req.body;
  try {
    const pallet = await pool.query(
      `SELECT p.id, p.uses_boxes,
              (SELECT COUNT(*) FROM pallet_items_s pi WHERE pi.pallet_id = p.id AND pi.quantity > 0) as loose_items_count
       FROM pallets_s p
       WHERE p.id=$1`,
      [req.params.id]
    );
    if (!pallet.rows.length) return res.status(404).json({ error: 'Паллет не найден' });
    const pal = pallet.rows[0];
    const looseItemsCount = parseInt(pal.loose_items_count || 0, 10);

    if (!pal.uses_boxes) {
      if (looseItemsCount > 0) {
        return res.status(400).json({ error: 'Паллет уже используется без коробок. Сначала очистите товар россыпью.' });
      }
      await pool.query('UPDATE pallets_s SET uses_boxes = true WHERE id = $1', [req.params.id]);
    }

    const parsedQty = quantity === undefined || quantity === null || quantity === ''
      ? 0
      : parseInt(quantity, 10);
    const parsedBoxSize = box_size === undefined || box_size === null || box_size === ''
      ? Math.max(parsedQty, 1, 50)
      : parseInt(box_size, 10);

    if (Number.isNaN(parsedQty) || parsedQty < 0) {
      return res.status(400).json({ error: 'quantity должен быть числом 0 или больше' });
    }
    if (Number.isNaN(parsedBoxSize) || parsedBoxSize <= 0) {
      return res.status(400).json({ error: 'box_size должен быть больше 0' });
    }
    if (parsedQty > 0 && !product_id) {
      return res.status(400).json({ error: 'Для непустой коробки укажите товар' });
    }

    const barcodeValue = String(Math.floor(Math.random() * 900000000) + 100000000);
    const result = await pool.query(
      `INSERT INTO boxes_s (barcode_value, product_id, pallet_id, quantity, box_size, status, closed_at)
       VALUES ($1, $2, $3, $4, $5, 'closed', NOW()) RETURNING *`,
      [barcodeValue, product_id || null, req.params.id, parsedQty, parsedBoxSize]
    );
    if (product_id && parsedQty > 0) {
      await pool.query(
        `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
         VALUES ($1, $2, $3, NOW())`,
        [result.rows[0].id, product_id, parsedQty]
      );
      // Record movement for box creation with product
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_pallet_id, to_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_create', $1, $2, $3, $4, $5, 'manual_edit', 'Создание коробки на паллете', 0, $2)`,
        [product_id, parsedQty, parseInt(req.params.id), result.rows[0].id, req.user?.id || null]
      );
    }
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/fbo/pallets/:id/item — add product directly to pallet (no box)
router.post('/pallets/:id/item', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'product_id и quantity обязательны' });
  }
  try {
    const pallet = await pool.query(
      `SELECT p.id, p.uses_boxes,
              (SELECT COUNT(*) FROM boxes_s b WHERE b.pallet_id = p.id AND b.status IN ('open', 'closed')) as boxes_count
       FROM pallets_s p
       WHERE p.id=$1`,
      [req.params.id]
    );
    if (!pallet.rows.length) return res.status(404).json({ error: 'Паллет не найден' });
    const pal = pallet.rows[0];
    const boxesCount = parseInt(pal.boxes_count || 0, 10);
    if (pal.uses_boxes) {
      if (boxesCount > 0) {
        return res.status(400).json({ error: 'Паллет уже используется в коробочном режиме. Сначала очистите коробки.' });
      }
      await pool.query('UPDATE pallets_s SET uses_boxes = false WHERE id = $1', [req.params.id]);
    }
    const pQty = parseFloat(quantity);
    // Get current qty before change
    const prev = await pool.query('SELECT quantity FROM pallet_items_s WHERE pallet_id=$1 AND product_id=$2', [req.params.id, product_id]);
    const prevQty = prev.rows.length ? parseFloat(prev.rows[0].quantity) : 0;
    const result = await pool.query(
      `INSERT INTO pallet_items_s (pallet_id, product_id, quantity) VALUES ($1, $2, $3)
       ON CONFLICT (pallet_id, product_id) DO UPDATE SET quantity = pallet_items_s.quantity + $3
       RETURNING *`,
      [req.params.id, product_id, pQty]
    );
    const newQty = parseFloat(result.rows[0].quantity);
    await pool.query(
      `INSERT INTO movements_s (movement_type, product_id, quantity, to_pallet_id, performed_by, source, notes, quantity_before, quantity_after)
       VALUES ('external_to_pallet',$1,$2,$3,$4,'manual_edit','Добавление товара на паллет',$5,$6)`,
      [product_id, pQty, parseInt(req.params.id), req.user.id, prevQty, newQty]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/fbo/pallets/:id/item — update quantity of product directly on pallet
router.put('/pallets/:palletId/item/:productId', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { quantity } = req.body;
  const qty = parseFloat(quantity);
  if (isNaN(qty) || qty < 0) return res.status(400).json({ error: 'Некорректное количество' });
  try {
    const old = await pool.query('SELECT quantity FROM pallet_items_s WHERE pallet_id=$1 AND product_id=$2', [req.params.palletId, req.params.productId]);
    const oldQty = old.rows.length ? parseFloat(old.rows[0].quantity) : 0;
    if (qty <= 0) {
      await pool.query('DELETE FROM pallet_items_s WHERE pallet_id=$1 AND product_id=$2', [req.params.palletId, req.params.productId]);
    } else {
      await pool.query('UPDATE pallet_items_s SET quantity=$1 WHERE pallet_id=$2 AND product_id=$3', [qty, req.params.palletId, req.params.productId]);
    }
    const delta = qty - oldQty;
    if (delta !== 0) {
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_pallet_id, to_pallet_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1,$2,$3,$4,$5,$6,'manual_edit',$7,$8,$9)`,
        [delta < 0 ? 'pallet_correction_out' : 'pallet_correction_in', parseInt(req.params.productId), Math.abs(delta),
         delta < 0 ? parseInt(req.params.palletId) : null, delta > 0 ? parseInt(req.params.palletId) : null,
         req.user.id, 'Ручное редактирование', oldQty, qty]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/fbo/pallets/:id — edit pallet name/number/uses_boxes
router.put('/pallets/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    const { name, number, uses_boxes } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name); }
    if (number !== undefined) { fields.push(`number=$${idx++}`); vals.push(number); }
    if (uses_boxes !== undefined) { fields.push(`uses_boxes=$${idx++}`); vals.push(uses_boxes); }
    if (fields.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });
    vals.push(req.params.id);
    await pool.query(`UPDATE pallets_s SET ${fields.join(', ')} WHERE id=$${idx}`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/fbo/pallets/:id (cascade: nullify refs → items → boxes → pallet)
router.delete('/pallets/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pid = req.params.id;
    const boxes = await client.query('SELECT id FROM boxes_s WHERE pallet_id=$1', [pid]);
    const boxIds = boxes.rows.map(b => b.id);
    // Nullify FK refs in logs/history/tasks
    await client.query('UPDATE inventory_tasks_s SET target_pallet_id=NULL WHERE target_pallet_id=$1', [pid]);
    await client.query('UPDATE inventory_tasks_s SET dest_pallet_id=NULL WHERE dest_pallet_id=$1', [pid]);
    await client.query('UPDATE assembly_items_s SET source_pallet_id=NULL WHERE source_pallet_id=$1', [pid]);
    await client.query('UPDATE movements_s SET from_pallet_id=NULL WHERE from_pallet_id=$1', [pid]);
    await client.query('UPDATE movements_s SET to_pallet_id=NULL WHERE to_pallet_id=$1', [pid]);
    if (boxIds.length) {
      await client.query('UPDATE inventory_tasks_s SET target_box_id=NULL WHERE target_box_id=ANY($1)', [boxIds]);
      await client.query('UPDATE inventory_task_boxes_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
      await client.query('UPDATE assembly_items_s SET source_box_id=NULL WHERE source_box_id=ANY($1)', [boxIds]);
      await client.query('UPDATE movements_s SET from_box_id=NULL WHERE from_box_id=ANY($1)', [boxIds]);
      await client.query('UPDATE movements_s SET to_box_id=NULL WHERE to_box_id=ANY($1)', [boxIds]);
      await client.query('UPDATE employee_earnings_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
      await client.query('DELETE FROM box_items_s WHERE box_id=ANY($1)', [boxIds]);
    }
    await client.query('DELETE FROM boxes_s WHERE pallet_id=$1', [pid]);
    await client.query('DELETE FROM pallet_items_s WHERE pallet_id=$1', [pid]);
    await client.query('DELETE FROM pallets_s WHERE id=$1', [pid]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// GET /api/fbo/pallets/:id — pallet with boxes
router.get('/pallets/:id', requireAuth, async (req, res) => {
  try {
    const pal = await pool.query(`
      SELECT pa.*, pr.name as row_name, pr.number as row_number, w.name as warehouse_name
      FROM pallets_s pa
      JOIN pallet_rows_s pr ON pa.row_id = pr.id
      JOIN warehouses_s w ON pr.warehouse_id = w.id
      WHERE pa.id = $1
    `, [req.params.id]);
    if (!pal.rows.length) return res.status(404).json({ error: 'Паллет не найден' });
    const boxes = await pool.query(`
      SELECT bx.*, agg.products_count, p.name as product_name, p.code as product_code
      FROM (
        SELECT b.*,
               ROW_NUMBER() OVER (PARTITION BY b.pallet_id ORDER BY b.created_at, b.id) as position
        FROM boxes_s b
        WHERE b.pallet_id = $1
      ) bx
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE quantity > 0) as products_count,
          MIN(product_id) FILTER (WHERE quantity > 0) as first_product_id
        FROM box_items_s
        WHERE box_id = bx.id
      ) agg ON TRUE
      LEFT JOIN products_s p ON p.id = CASE WHEN COALESCE(agg.products_count, 0) = 1 THEN agg.first_product_id ELSE bx.product_id END
      ORDER BY bx.position
    `, [req.params.id]);
    const items = await pool.query(`
      SELECT pi.*, p.name as product_name, p.code as product_code
      FROM pallet_items_s pi
      JOIN products_s p ON p.id = pi.product_id
      WHERE pi.pallet_id = $1 AND pi.quantity > 0
      ORDER BY p.name
    `, [req.params.id]);
    res.json({ ...pal.rows[0], boxes: boxes.rows, items: items.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/fbo/boxes/:id — box detail
router.get('/boxes/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, agg.products_count, p.name as product_name, p.code as product_code,
             pa.name as pallet_name, pa.number as pallet_number,
             pr.name as row_name, pr.number as row_number,
             COALESCE(w.name, (SELECT name FROM warehouses_s WHERE id = b.warehouse_id)) as warehouse_name,
             (
               SELECT COUNT(*)
               FROM boxes_s b2
               WHERE b2.pallet_id = b.pallet_id AND b.pallet_id IS NOT NULL
                 AND (
                   b2.created_at < b.created_at
                   OR (b2.created_at = b.created_at AND b2.id <= b.id)
                 )
             )::int as position
      FROM boxes_s b
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE quantity > 0) as products_count,
          MIN(product_id) FILTER (WHERE quantity > 0) as first_product_id
        FROM box_items_s
        WHERE box_id = b.id
      ) agg ON TRUE
      LEFT JOIN products_s p ON p.id = CASE WHEN COALESCE(agg.products_count, 0) = 1 THEN agg.first_product_id ELSE b.product_id END
      LEFT JOIN pallets_s pa ON pa.id = b.pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      LEFT JOIN warehouses_s w ON w.id = pr.warehouse_id
      WHERE b.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const items = await pool.query(
      `SELECT bi.product_id, bi.quantity, p.name as product_name, p.code as product_code
       FROM box_items_s bi
       JOIN products_s p ON p.id = bi.product_id
       WHERE bi.box_id = $1 AND bi.quantity > 0
       ORDER BY p.name`,
      [req.params.id]
    );
    res.json({ ...result.rows[0], items: items.rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/fbo/boxes/:id — edit box (quantity, product)
router.put('/boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { quantity, product_id } = req.body;
  try {
    // Get old state before update for movement tracking
    const oldBox = await pool.query('SELECT * FROM boxes_s WHERE id = $1', [req.params.id]);
    if (!oldBox.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const prev = oldBox.rows[0];
    const prevQty = Number(prev.quantity || 0);
    const prevProductId = prev.product_id;

    const sets = [];
    const params = [];
    let idx = 1;
    if (quantity !== undefined) {
      const parsedQty = parseInt(quantity, 10);
      if (Number.isNaN(parsedQty) || parsedQty < 0) {
        return res.status(400).json({ error: 'Количество должно быть 0 или больше' });
      }
      sets.push(`quantity = $${idx++}`); params.push(parsedQty);
      sets.push(`box_size = $${idx++}`); params.push(Math.max(parsedQty, 1));
    }
    if (product_id !== undefined) { sets.push(`product_id = $${idx++}`); params.push(product_id); }
    if (sets.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE boxes_s SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    await pool.query('DELETE FROM box_items_s WHERE box_id = $1', [req.params.id]);
    if (result.rows[0].product_id && Number(result.rows[0].quantity || 0) > 0) {
      await pool.query(
        `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
         VALUES ($1, $2, $3, NOW())`,
        [req.params.id, result.rows[0].product_id, result.rows[0].quantity]
      );
    }

    // Record movement if quantity or product changed
    const newQty = Number(result.rows[0].quantity || 0);
    const newProductId = result.rows[0].product_id;
    const delta = newQty - prevQty;
    if (delta !== 0 || (newProductId !== prevProductId && (newQty > 0 || prevQty > 0))) {
      const movType = delta > 0 ? 'edit_add_to_box' : delta < 0 ? 'edit_remove_from_box' : 'box_product_change';
      const trackProductId = newProductId || prevProductId;
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_pallet_id, to_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual_edit', 'Редактирование коробки', $7, $8)`,
        [movType, trackProductId, Math.abs(delta), prev.pallet_id, parseInt(req.params.id), req.user?.id || null, prevQty, newQty]
      );
    }

    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/fbo/boxes/:id — delete box
router.delete('/boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    // Get box data before deletion for movement tracking
    const oldBox = await pool.query('SELECT * FROM boxes_s WHERE id = $1', [req.params.id]);
    if (!oldBox.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const prev = oldBox.rows[0];
    const prevQty = Number(prev.quantity || 0);

    // Record movement before deletion if box had contents
    if (prevQty > 0 && prev.product_id) {
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_pallet_id, from_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_delete', $1, $2, $3, $4, $5, 'manual_edit', 'Удаление коробки', $2, 0)`,
        [prev.product_id, prevQty, prev.pallet_id, parseInt(req.params.id), req.user?.id || null]
      );
    }

    const bid = req.params.id;
    await pool.query('UPDATE inventory_task_boxes_s SET box_id=NULL WHERE box_id=$1', [bid]);
    await pool.query('UPDATE inventory_tasks_s SET target_box_id=NULL WHERE target_box_id=$1', [bid]);
    await pool.query('UPDATE assembly_items_s SET source_box_id=NULL WHERE source_box_id=$1', [bid]);
    await pool.query('UPDATE movements_s SET from_box_id=NULL WHERE from_box_id=$1', [bid]);
    await pool.query('UPDATE movements_s SET to_box_id=NULL WHERE to_box_id=$1', [bid]);
    await pool.query('UPDATE employee_earnings_s SET box_id=NULL WHERE box_id=$1', [bid]);
    await pool.query('DELETE FROM box_items_s WHERE box_id=$1', [bid]);
    const result = await pool.query('DELETE FROM boxes_s WHERE id=$1 RETURNING id', [bid]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/fbo/pallets-list?warehouse_id=X — flat list of pallets for task creation
router.get('/pallets-list', requireAuth, async (req, res) => {
  const { warehouse_id } = req.query;
  try {
    const params = [];
    let where = '';
    if (warehouse_id) { params.push(warehouse_id); where = 'WHERE pr.warehouse_id = $1'; }
    const result = await pool.query(`
      SELECT pa.id, pa.name, pa.number, pa.barcode_value,
             pr.name as row_name, pr.number as row_number,
             w.name as warehouse_name, w.id as warehouse_id
      FROM pallets_s pa
      JOIN pallet_rows_s pr ON pa.row_id = pr.id
      JOIN warehouses_s w ON pr.warehouse_id = w.id
      ${where}
      ORDER BY pr.number, pa.number
    `, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Visual FBO ───────────────────────────────────────────────────────────────

// POST /api/fbo/visual/move — Move box to another pallet (must be before GET /visual/:id)
router.post('/visual/move', requireAuth, async (req, res) => {
  const { box_id, to_pallet_id } = req.body;
  if (!box_id || !to_pallet_id) return res.status(400).json({ error: 'box_id и to_pallet_id обязательны' });
  try {
    await pool.query('UPDATE boxes_s SET pallet_id=$1 WHERE id=$2', [to_pallet_id, box_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/fbo/visual/:warehouseId — rows → pallets → boxes with product info
router.get('/visual/:warehouseId', requireAuth, async (req, res) => {
  try {
    const { warehouseId } = req.params;

    // Single query with JOINs instead of N+1 loop
    const [rowsRes, palletsRes, boxesRes] = await Promise.all([
      pool.query(
        `SELECT id, name, number FROM pallet_rows_s WHERE warehouse_id=$1 ORDER BY number`,
        [warehouseId]
      ),
      pool.query(
        `SELECT pl.id, pl.name, pl.number, pl.barcode_value, pl.row_id
         FROM pallets_s pl
         JOIN pallet_rows_s pr ON pr.id = pl.row_id
         WHERE pr.warehouse_id=$1
         ORDER BY pl.number`,
        [warehouseId]
      ),
      pool.query(
        `SELECT b.id, b.barcode_value, b.quantity, b.status, b.product_id, b.pallet_id,
                p.name as product_name, p.code as product_code
         FROM boxes_s b
         LEFT JOIN products_s p ON p.id = b.product_id
         JOIN pallets_s pl ON pl.id = b.pallet_id
         JOIN pallet_rows_s pr ON pr.id = pl.row_id
         WHERE pr.warehouse_id=$1
         ORDER BY b.id`,
        [warehouseId]
      ),
    ]);

    // Group boxes by pallet_id (skip empty boxes with qty=0)
    const boxesByPallet = {};
    for (const box of boxesRes.rows) {
      if (parseFloat(box.quantity || 0) <= 0) continue;
      if (!boxesByPallet[box.pallet_id]) boxesByPallet[box.pallet_id] = [];
      boxesByPallet[box.pallet_id].push(box);
    }

    // Group pallets by row_id
    const palletsByRow = {};
    for (const pl of palletsRes.rows) {
      if (!palletsByRow[pl.row_id]) palletsByRow[pl.row_id] = [];
      palletsByRow[pl.row_id].push({ ...pl, boxes: boxesByPallet[pl.id] || [] });
    }

    const result = rowsRes.rows.map(row => ({
      ...row,
      pallets: palletsByRow[row.id] || [],
    }));

    res.json({ rows: result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// BOX-TYPE WAREHOUSE: standalone boxes (no pallets/rows)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/fbo/box-warehouse/:warehouseId/boxes — list boxes in a box-type warehouse
router.get('/box-warehouse/:warehouseId/boxes', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
        p.name as product_name, p.code as product_code, p.barcode_list as product_barcode,
        (SELECT COALESCE(SUM(bi.quantity), 0) FROM box_items_s bi WHERE bi.box_id = b.id) as total_items
       FROM boxes_s b
       LEFT JOIN products_s p ON p.id = b.product_id
       WHERE b.warehouse_id = $1
       ORDER BY b.created_at DESC`,
      [req.params.warehouseId]
    );
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/fbo/box-warehouse/:warehouseId/boxes — create box in box-type warehouse
router.post('/box-warehouse/:warehouseId/boxes', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    const { name, product_id, quantity, box_size } = req.body;
    const barcode = String(Math.floor(100000000 + Math.random() * 900000000));
    const result = await pool.query(
      `INSERT INTO boxes_s (barcode_value, warehouse_id, product_id, quantity, box_size, name, status, closed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'closed', NOW()) RETURNING *`,
      [barcode, req.params.warehouseId, product_id || null, quantity || 0, box_size || 50, name || null]
    );
    // Create box_items_s entry if product + quantity
    if (product_id && quantity > 0) {
      await pool.query(
        `INSERT INTO box_items_s (box_id, product_id, quantity) VALUES ($1, $2, $3)`,
        [result.rows[0].id, product_id, quantity]
      );
      // Record movement for standalone box creation with product
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_create', $1, $2, $3, $4, 'manual_edit', 'Создание коробки на складе', 0, $2)`,
        [product_id, quantity, result.rows[0].id, req.user?.id || null]
      );
    }
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/fbo/box-warehouse/boxes/:id — edit standalone box
router.put('/box-warehouse/boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    // Get old state before update for movement tracking
    const oldBox = await pool.query('SELECT * FROM boxes_s WHERE id = $1', [req.params.id]);
    const prev = oldBox.rows.length ? oldBox.rows[0] : null;
    const prevQty = prev ? Number(prev.quantity || 0) : 0;
    const prevProductId = prev ? prev.product_id : null;

    const { name, product_id, quantity, box_size } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;
    if (name !== undefined) { fields.push(`name=$${idx++}`); vals.push(name); }
    if (product_id !== undefined) { fields.push(`product_id=$${idx++}`); vals.push(product_id || null); }
    if (quantity !== undefined) { fields.push(`quantity=$${idx++}`); vals.push(quantity); }
    if (box_size !== undefined) { fields.push(`box_size=$${idx++}`); vals.push(box_size); }
    if (fields.length === 0) return res.status(400).json({ error: 'Нечего обновлять' });
    vals.push(req.params.id);
    await pool.query(`UPDATE boxes_s SET ${fields.join(', ')} WHERE id=$${idx}`, vals);
    // Update box_items_s if product_id + quantity
    if (product_id !== undefined && quantity !== undefined) {
      await pool.query(`DELETE FROM box_items_s WHERE box_id = $1`, [req.params.id]);
      if (product_id && quantity > 0) {
        await pool.query(`INSERT INTO box_items_s (box_id, product_id, quantity) VALUES ($1, $2, $3)`, [req.params.id, product_id, quantity]);
      }
    }

    // Record movement if quantity or product changed
    const newQty = quantity !== undefined ? Number(quantity) : prevQty;
    const newProductId = product_id !== undefined ? (product_id || null) : prevProductId;
    const delta = newQty - prevQty;
    if (prev && (delta !== 0 || (newProductId !== prevProductId && (newQty > 0 || prevQty > 0)))) {
      const movType = delta > 0 ? 'edit_add_to_box' : delta < 0 ? 'edit_remove_from_box' : 'box_product_change';
      const trackProductId = newProductId || prevProductId;
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1, $2, $3, $4, $5, 'manual_edit', 'Редактирование коробки на складе', $6, $7)`,
        [movType, trackProductId, Math.abs(delta), parseInt(req.params.id), req.user?.id || null, prevQty, newQty]
      );
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/fbo/box-warehouse/boxes/:id — delete standalone box
router.delete('/box-warehouse/boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    // Get box data before deletion for movement tracking
    const oldBox = await pool.query('SELECT * FROM boxes_s WHERE id = $1', [req.params.id]);
    const prev = oldBox.rows.length ? oldBox.rows[0] : null;
    const prevQty = prev ? Number(prev.quantity || 0) : 0;

    // Record movement before deletion if box had contents
    if (prev && prevQty > 0 && prev.product_id) {
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_delete', $1, $2, $3, $4, 'manual_edit', 'Удаление коробки со склада', $2, 0)`,
        [prev.product_id, prevQty, parseInt(req.params.id), req.user?.id || null]
      );
    }

    await pool.query(`DELETE FROM box_items_s WHERE box_id = $1`, [req.params.id]);
    await pool.query(`DELETE FROM boxes_s WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

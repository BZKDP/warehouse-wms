const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const {
  nullifyShelfRefs,
  nullifyShelfBoxRefs,
  nullifyBoxRefs,
  nullifyPalletRefs,
  getWarehouseDeletionImpact,
  deleteWarehouseTransactional,
} = require('../utils/warehouseDeletion');

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function randomBarcode(length = 9) {
  const min = 10 ** (length - 1);
  const max = (10 ** length) - 1;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

async function getShelfStorageState(client, shelfId) {
  const result = await client.query(
    `SELECT s.id, s.code, s.name, s.uses_boxes,
            (SELECT COUNT(*) FROM shelf_items_s si WHERE si.shelf_id = s.id AND si.quantity > 0) as loose_items_count,
            (SELECT COUNT(*) FROM shelf_boxes_s sb WHERE sb.shelf_id = s.id) as boxes_count
     FROM shelves_s s
     WHERE s.id = $1
     FOR UPDATE`,
    [shelfId]
  );
  if (!result.rows.length) {
    throw new Error('Полка не найдена');
  }
  return {
    ...result.rows[0],
    loose_items_count: parseInt(result.rows[0].loose_items_count || 0, 10),
    boxes_count: parseInt(result.rows[0].boxes_count || 0, 10),
  };
}

async function ensureShelfReadyForBoxes(client, shelfId) {
  const shelf = await getShelfStorageState(client, shelfId);
  if (!shelf.uses_boxes) {
    await client.query('UPDATE shelves_s SET uses_boxes = true WHERE id = $1', [shelfId]);
    shelf.uses_boxes = true;
  }
  return shelf;
}

async function ensureShelfReadyForLooseItems(client, shelfId) {
  const shelf = await getShelfStorageState(client, shelfId);
  return shelf;
}

// ─── Warehouses ───────────────────────────────────────────────────────────────

// GET /api/warehouse/warehouses
router.get('/warehouses', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT w.*,
        (SELECT COUNT(*) FROM racks_s WHERE warehouse_id = w.id) as racks_count,
        (SELECT COUNT(*) FROM shelves_s s JOIN racks_s r ON r.id = s.rack_id WHERE r.warehouse_id = w.id) as shelves_count,
        (SELECT COUNT(*) FROM pallet_rows_s WHERE warehouse_id = w.id) as rows_count,
        (SELECT COUNT(*) FROM pallets_s p JOIN pallet_rows_s pr ON pr.id = p.row_id WHERE pr.warehouse_id = w.id) as pallets_count,
        -- коробки склада: на паллетах + на полках (boxes_s.warehouse_id заполняется не всегда)
        ((SELECT COUNT(*) FROM boxes_s b JOIN pallets_s p ON p.id = b.pallet_id
            JOIN pallet_rows_s pr ON pr.id = p.row_id WHERE pr.warehouse_id = w.id)
         + (SELECT COUNT(*) FROM shelf_boxes_s sb JOIN shelves_s s ON s.id = sb.shelf_id
            JOIN racks_s r ON r.id = s.rack_id WHERE r.warehouse_id = w.id)) as boxes_count
       FROM warehouses_s w ORDER BY w.sort_order, w.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/warehouses/:id — full structure
// PUT /api/warehouse/warehouses/reorder — update warehouse display order
router.put('/warehouses/reorder', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { order } = req.body; // [{id: 1}, {id: 3}, {id: 2}]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });
  try {
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE warehouses_s SET sort_order = $1 WHERE id = $2', [i, order[i].id || order[i]]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/warehouses/:id', requireAuth, async (req, res) => {
  try {
    const wh = await pool.query('SELECT * FROM warehouses_s WHERE id = $1', [req.params.id]);
    if (!wh.rows.length) return res.status(404).json({ error: 'Склад не найден' });

    const racks = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM shelves_s WHERE rack_id = r.id) as shelves_count,
        ((SELECT COALESCE(SUM(si.quantity),0)
         FROM shelves_s sh
         JOIN shelf_items_s si ON si.shelf_id = sh.id
         WHERE sh.rack_id = r.id)
         +
         (SELECT COALESCE(SUM(sb.quantity),0)
          FROM shelves_s sh
          JOIN shelf_boxes_s sb ON sb.shelf_id = sh.id
          WHERE sh.rack_id = r.id)) as total_items
       FROM racks_s r WHERE r.warehouse_id = $1 ORDER BY r.number`,
      [req.params.id]
    );

    res.json({ ...wh.rows[0], racks: racks.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/warehouses
router.post('/warehouses', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, external_id, notes, warehouse_type, exclude_from_suggestions } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const result = await pool.query(
      'INSERT INTO warehouses_s (name, external_id, notes, warehouse_type, exclude_from_suggestions) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, external_id || null, notes || null, warehouse_type || 'fbs', !!exclude_from_suggestions]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/warehouse/warehouses/:id
router.put('/warehouses/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, active, notes, exclude_from_suggestions } = req.body;
  try {
    const result = await pool.query(
      'UPDATE warehouses_s SET name=COALESCE($1,name), active=COALESCE($2,active), notes=COALESCE($3,notes), exclude_from_suggestions=COALESCE($4,exclude_from_suggestions) WHERE id=$5 RETURNING *',
      [name, active, notes, typeof exclude_from_suggestions === 'boolean' ? exclude_from_suggestions : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Склад не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/warehouses/:id/delete-impact
// Возвращает фактический остаток и объём структуры для фирменной модалки удаления.
router.get('/warehouses/:id/delete-impact', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    const impact = await getWarehouseDeletionImpact(pool, req.params.id);
    if (!impact) return res.status(404).json({ error: 'Склад не найден' });
    res.json(impact);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/warehouse/warehouses/:id
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

// ─── Racks ────────────────────────────────────────────────────────────────────

// GET /api/warehouse/racks?warehouse_id=X
router.get('/racks', requireAuth, async (req, res) => {
  try {
    const { warehouse_id } = req.query;
    const params = [];
    let where = '';
    if (warehouse_id) {
      params.push(warehouse_id);
      where = 'WHERE r.warehouse_id = $1';
    }
    const result = await pool.query(
      `SELECT r.*,
        (SELECT COUNT(*) FROM shelves_s WHERE rack_id = r.id) as shelves_count,
        ((SELECT COUNT(DISTINCT sh.id) FROM shelves_s sh JOIN shelf_items_s si ON si.shelf_id = sh.id WHERE sh.rack_id = r.id AND si.quantity > 0)
         +
         (SELECT COUNT(DISTINCT sh.id) FROM shelves_s sh JOIN shelf_boxes_s sb ON sb.shelf_id = sh.id WHERE sh.rack_id = r.id AND sb.quantity > 0)) as occupied_shelves,
        ((SELECT COALESCE(SUM(si.quantity),0)
         FROM shelves_s sh
         JOIN shelf_items_s si ON si.shelf_id = sh.id
         WHERE sh.rack_id = r.id)
         +
         (SELECT COALESCE(SUM(sb.quantity),0)
          FROM shelves_s sh
          JOIN shelf_boxes_s sb ON sb.shelf_id = sh.id
          WHERE sh.rack_id = r.id)) as total_items
       FROM racks_s r ${where} ORDER BY r.number`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/shelves-list — плоский список всех полок (для админ-переноса)
router.get('/shelves-list', requireAuth, async (req, res) => {
  try {
    const { warehouse_id } = req.query;
    const params = [];
    let where = '';
    if (warehouse_id) { params.push(warehouse_id); where = 'WHERE w.id = $1'; }
    const result = await pool.query(
      `SELECT s.id, s.code, s.name, s.number,
              r.name as rack_name, r.number as rack_number,
              w.id as warehouse_id, w.name as warehouse_name,
              (SELECT COUNT(*) FROM shelf_boxes_s sb WHERE sb.shelf_id = s.id AND sb.quantity > 0) as boxes_count
       FROM shelves_s s
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       ${where}
       ORDER BY w.name, r.number, s.number`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/racks/:id — rack with shelves
router.get('/racks/:id', requireAuth, async (req, res) => {
  try {
    const rack = await pool.query('SELECT * FROM racks_s WHERE id = $1', [req.params.id]);
    if (!rack.rows.length) return res.status(404).json({ error: 'Стеллаж не найден' });

    const shelves = await pool.query(
      `SELECT s.*,
        ((SELECT COALESCE(SUM(si.quantity),0) FROM shelf_items_s si WHERE si.shelf_id = s.id)
         +
         (SELECT COALESCE(SUM(sb.quantity),0) FROM shelf_boxes_s sb WHERE sb.shelf_id = s.id)) as total_items,
        (SELECT COUNT(*) FROM shelf_boxes_s sb WHERE sb.shelf_id = s.id) as boxes_count,
        (
          SELECT COUNT(*) FROM (
            SELECT DISTINCT si.product_id
            FROM shelf_items_s si
            WHERE si.shelf_id = s.id AND si.quantity > 0
            UNION
            SELECT DISTINCT sb.product_id
            FROM shelf_boxes_s sb
            WHERE sb.shelf_id = s.id AND sb.quantity > 0 AND sb.product_id IS NOT NULL
          ) products
        ) as products_count
       FROM shelves_s s WHERE s.rack_id = $1 ORDER BY s.number`,
      [req.params.id]
    );

    res.json({ ...rack.rows[0], shelves: shelves.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/racks
router.post('/racks', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { warehouse_id, name, number, notes } = req.body;
  if (!warehouse_id || !name || !number) {
    return res.status(400).json({ error: 'warehouse_id, name и number обязательны' });
  }
  try {
    const code = `С${number}`;
    const barcodeValue = String(Math.floor(Math.random() * 900000) + 100000);
    const result = await pool.query(
      'INSERT INTO racks_s (warehouse_id, name, number, code, barcode_value, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [warehouse_id, name, number, code, barcodeValue, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/warehouse/racks/:id
router.put('/racks/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE racks_s SET name=COALESCE($1,name), notes=COALESCE($2,notes) WHERE id=$3 RETURNING *',
      [name, notes, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Стеллаж не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/warehouse/racks/:id
router.delete('/racks/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shelves = await client.query('SELECT id FROM shelves_s WHERE rack_id=$1', [req.params.id]);
    const shelfIds = shelves.rows.map(s => s.id);
    if (shelfIds.length) {
      await nullifyShelfRefs(client, shelfIds);
      const sboxes = await client.query('SELECT id FROM shelf_boxes_s WHERE shelf_id = ANY($1)', [shelfIds]);
      const sboxIds = sboxes.rows.map(b => b.id);
      if (sboxIds.length) {
        await nullifyShelfBoxRefs(client, sboxIds);
        await client.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id = ANY($1)', [sboxIds]);
      }
      await client.query('DELETE FROM shelf_boxes_s WHERE shelf_id = ANY($1)', [shelfIds]);
      await client.query('DELETE FROM shelf_items_s WHERE shelf_id = ANY($1)', [shelfIds]);
    }
    await client.query('DELETE FROM shelves_s WHERE rack_id=$1', [req.params.id]);
    await client.query('DELETE FROM racks_s WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// ─── Shelves ──────────────────────────────────────────────────────────────────

// GET /api/warehouse/shelves/barcode/:value  ← MUST be before /shelves/:id
router.get('/shelves/barcode/:value', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*, r.name as rack_name, r.code as rack_code, w.name as warehouse_name
       FROM shelves_s s
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       WHERE s.barcode_value = $1`,
      [req.params.value]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Полка не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/shelves/:id — shelf with items
router.get('/shelves/:id', requireAuth, async (req, res) => {
  try {
    const shelf = await pool.query(
      `SELECT s.*, r.name as rack_name, r.code as rack_code, w.name as warehouse_name
       FROM shelves_s s
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!shelf.rows.length) return res.status(404).json({ error: 'Полка не найдена' });

    const items = await pool.query(
      `SELECT si.id, si.product_id, si.quantity, si.updated_at,
              p.name as product_name, p.code as product_code,
              p.production_barcode, p.barcode_list, p.entity_type
       FROM shelf_items_s si
       JOIN products_s p ON p.id = si.product_id
       WHERE si.shelf_id = $1 AND si.quantity > 0
       ORDER BY p.name`,
      [req.params.id]
    );

    const boxes = await pool.query(
      `SELECT sb.id, sb.shelf_id, sb.position, sb.name, sb.barcode_value,
              -- product_id: берём из shelf_box_items_s если единственный товар, иначе из sb
              COALESCE(sb.product_id, CASE WHEN COALESCE(agg.products_count, 0) = 1 THEN agg.first_product_id END) as product_id,
              -- quantity: реальная сумма из shelf_box_items_s, если > 0; иначе sb.quantity
              CASE WHEN COALESCE(agg.items_total, 0) > 0 THEN agg.items_total ELSE sb.quantity END as quantity,
              sb.box_size, sb.status, sb.confirmed, sb.created_at, sb.closed_at,
              agg.products_count,
              p.name as product_name, p.code as product_code
       FROM shelf_boxes_s sb
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE quantity > 0) as products_count,
           MIN(product_id) FILTER (WHERE quantity > 0) as first_product_id,
           COALESCE(SUM(quantity) FILTER (WHERE quantity > 0), 0)::int as items_total
         FROM shelf_box_items_s
         WHERE shelf_box_id = sb.id
       ) agg ON TRUE
       LEFT JOIN products_s p ON p.id = CASE WHEN COALESCE(agg.products_count, 0) = 1 THEN agg.first_product_id ELSE sb.product_id END
       WHERE sb.shelf_id = $1
       ORDER BY sb.position`,
      [req.params.id]
    );

    res.json({ ...shelf.rows[0], items: items.rows, boxes: boxes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/shelves
router.post('/shelves', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { rack_id, name, number, notes, uses_boxes } = req.body;
  if (!rack_id || !name || !number) {
    return res.status(400).json({ error: 'rack_id, name и number обязательны' });
  }
  try {
    const rack = await pool.query('SELECT * FROM racks_s WHERE id = $1', [rack_id]);
    if (!rack.rows.length) return res.status(404).json({ error: 'Стеллаж не найден' });

    const code = `${rack.rows[0].code}П${number}`;
    const barcodeValue = String(Math.floor(Math.random() * 900000000) + 100000000);
    const result = await pool.query(
      'INSERT INTO shelves_s (rack_id, name, number, code, barcode_value, notes, uses_boxes, uses_loose) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [rack_id, name, number, code, barcodeValue, notes || null, parseBoolean(uses_boxes, false), parseBoolean(req.body.uses_loose, true)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/warehouse/shelves/:id
router.put('/shelves/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { name, notes, uses_boxes, uses_loose } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE shelves_s SET name=COALESCE($1,name), notes=COALESCE($2,notes),
       uses_boxes=COALESCE($3,uses_boxes), uses_loose=COALESCE($4,uses_loose) WHERE id=$5 RETURNING *`,
      [name, notes, uses_boxes === undefined ? null : parseBoolean(uses_boxes, false),
       uses_loose === undefined ? null : parseBoolean(uses_loose, true), req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Полка не найдена' });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/warehouse/shelves/:id
router.delete('/shelves/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sid = [parseInt(req.params.id)];
    await nullifyShelfRefs(client, sid);
    const sboxes = await client.query('SELECT id FROM shelf_boxes_s WHERE shelf_id=$1', [req.params.id]);
    const sboxIds = sboxes.rows.map(b => b.id);
    if (sboxIds.length) {
      await nullifyShelfBoxRefs(client, sboxIds);
      await client.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id = ANY($1)', [sboxIds]);
    }
    await client.query('DELETE FROM shelf_boxes_s WHERE shelf_id=$1', [req.params.id]);
    await client.query('DELETE FROM shelf_items_s WHERE shelf_id=$1', [req.params.id]);
    await client.query('DELETE FROM shelves_s WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) { await client.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { client.release(); }
});

// ─── Shelf Item Operations ────────────────────────────────────────────────────

// POST /api/warehouse/shelves/:id/set — set quantity (inventory mode)
router.post('/shelves/:id/set', requireAuth, async (req, res) => {
  const { product_id, quantity, task_id } = req.body;
  if (product_id == null || quantity == null) {
    return res.status(400).json({ error: 'product_id и quantity обязательны' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shelfId = req.params.id;
    const qty = parseFloat(quantity);
    await ensureShelfReadyForLooseItems(client, shelfId);

    // Get current quantity
    const current = await client.query(
      'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
      [shelfId, product_id]
    );
    const prevQty = current.rows.length ? parseFloat(current.rows[0].quantity) : 0;

    // Upsert shelf item
    await client.query(
      `INSERT INTO shelf_items_s (shelf_id, product_id, quantity, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (shelf_id, product_id) DO UPDATE SET quantity=$3, updated_by=$4, updated_at=NOW()`,
      [shelfId, product_id, qty, req.user.id]
    );

    // Log movement
    const opType = task_id ? 'inventory' : 'correction';
    const source = task_id ? 'task' : 'manual_edit';
    await client.query(
      `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [shelfId, product_id, opType, prevQty, qty, qty - prevQty, req.user.id, task_id || null, source]
    );

    // Also log to universal movements_s
    const delta = qty - prevQty;
    if (delta !== 0) {
      await client.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          delta > 0 ? 'edit_add_to_shelf' : 'edit_remove_from_shelf',
          product_id, Math.abs(delta), shelfId, req.user.id, source,
          `${opType === 'inventory' ? 'Инвентаризация' : 'Ручная коррекция'}`,
          prevQty, qty,
        ]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, quantity: qty });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/warehouse/shelf-boxes/:id — shelf box detail
router.get('/shelf-boxes/:id', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sb.*, s.code as shelf_code, s.name as shelf_name,
              r.name as rack_name, r.code as rack_code,
              w.name as warehouse_name,
              agg.products_count,
              p.name as product_name, p.code as product_code
       FROM shelf_boxes_s sb
       JOIN shelves_s s ON s.id = sb.shelf_id
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE quantity > 0) as products_count,
           MIN(product_id) FILTER (WHERE quantity > 0) as first_product_id
         FROM shelf_box_items_s
         WHERE shelf_box_id = sb.id
       ) agg ON TRUE
       LEFT JOIN products_s p ON p.id = CASE WHEN COALESCE(agg.products_count, 0) = 1 THEN agg.first_product_id ELSE sb.product_id END
       WHERE sb.id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const items = await pool.query(
      `SELECT sbi.product_id, sbi.quantity, p.name as product_name, p.code as product_code
       FROM shelf_box_items_s sbi
       JOIN products_s p ON p.id = sbi.product_id
       WHERE sbi.shelf_box_id = $1 AND sbi.quantity > 0
       ORDER BY p.name`,
      [req.params.id]
    );
    // Проактивная синхронизация: shelf_boxes_s.quantity ← SUM(shelf_box_items_s.quantity)
    const box = result.rows[0];
    const itemsTotal = items.rows.reduce((s, r) => s + Number(r.quantity), 0);
    if (itemsTotal > 0 && Number(box.quantity) !== itemsTotal) {
      await pool.query('UPDATE shelf_boxes_s SET quantity = $1 WHERE id = $2', [itemsTotal, req.params.id]);
      box.quantity = itemsTotal;
    }
    res.json({ ...box, items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/warehouse/shelves/:id/box — create a box on shelf
router.post('/shelves/:id/box', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { product_id, quantity, box_size, name } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const shelf = await ensureShelfReadyForBoxes(client, req.params.id);
    const positionResult = await client.query(
      'SELECT COALESCE(MAX(position), 0) + 1 as next_position FROM shelf_boxes_s WHERE shelf_id = $1',
      [req.params.id]
    );
    const position = parseInt(positionResult.rows[0].next_position || 1, 10);
    const parsedQty = quantity === undefined || quantity === null || quantity === '' ? 0 : parseInt(quantity, 10);
    const parsedBoxSize = box_size === undefined || box_size === null || box_size === ''
      ? Math.max(parsedQty, 1, 50)
      : parseInt(box_size, 10);
    if (Number.isNaN(parsedQty) || parsedQty < 0) {
      throw new Error('quantity должен быть числом 0 или больше');
    }
    if (Number.isNaN(parsedBoxSize) || parsedBoxSize <= 0) {
      throw new Error('box_size должен быть больше 0');
    }
    if (parsedQty > 0 && !product_id) {
      throw new Error('Для непустой коробки укажите товар');
    }

    const boxName = name || `${shelf.code || shelf.name}К${position}`;
    const barcodeValue = randomBarcode(9);
    const result = await client.query(
      `INSERT INTO shelf_boxes_s (shelf_id, position, name, barcode_value, product_id, quantity, box_size, status, confirmed, closed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'closed',$8,$9)
       RETURNING *`,
      [req.params.id, position, boxName, barcodeValue, product_id || null, parsedQty, parsedBoxSize, parsedQty > 0, parsedQty > 0 ? new Date() : null]
    );
    if (product_id && parsedQty > 0) {
      await client.query(
        `INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at)
         VALUES ($1, $2, $3, NOW())`,
        [result.rows[0].id, product_id, parsedQty]
      );
      // Record movement for box creation with product
      await client.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, to_shelf_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_create', $1, $2, $3, $4, $5, 'manual_edit', 'Создание коробки на полке', 0, $2)`,
        [product_id, parsedQty, req.params.id, result.rows[0].id, req.user?.id || null]
      );
    }
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PUT /api/warehouse/shelf-boxes/:id — edit box on shelf
router.put('/shelf-boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  const { quantity, product_id, name, box_size } = req.body;
  try {
    // Get old state before update for movement tracking
    const oldBox = await pool.query('SELECT * FROM shelf_boxes_s WHERE id = $1', [req.params.id]);
    if (!oldBox.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const prev = oldBox.rows[0];
    const prevQty = Number(prev.quantity || 0);
    const prevProductId = prev.product_id;

    const sets = [];
    const params = [];
    let idx = 1;

    if (name !== undefined) {
      sets.push(`name = $${idx++}`);
      params.push(name || null);
    }
    if (box_size !== undefined) {
      sets.push(`box_size = $${idx++}`);
      params.push(Math.max(parseInt(box_size) || 50, 1));
    }
    if (quantity !== undefined) {
      const parsedQty = parseInt(quantity, 10);
      if (Number.isNaN(parsedQty) || parsedQty < 0) {
        return res.status(400).json({ error: 'Количество должно быть 0 или больше' });
      }
      sets.push(`quantity = $${idx++}`);
      params.push(parsedQty);
      sets.push(`confirmed = $${idx++}`);
      params.push(parsedQty > 0);
      sets.push(`status = $${idx++}`);
      params.push('closed');
      sets.push(`closed_at = $${idx++}`);
      params.push(parsedQty > 0 ? new Date() : null);
    }
    if (product_id !== undefined) {
      sets.push(`product_id = $${idx++}`);
      params.push(product_id || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Нечего обновлять' });

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE shelf_boxes_s SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    await pool.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id = $1', [req.params.id]);
    if (result.rows[0].product_id && Number(result.rows[0].quantity || 0) > 0) {
      await pool.query(
        `INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at)
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
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, to_shelf_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual_edit', 'Редактирование коробки на полке', $7, $8)`,
        [movType, trackProductId, Math.abs(delta), prev.shelf_id, parseInt(req.params.id), req.user?.id || null, prevQty, newQty]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/warehouse/shelf-boxes/:id — delete box from shelf
router.delete('/shelf-boxes/:id', requireAuth, requirePermission('warehouse.edit'), async (req, res) => {
  try {
    // Get box data before deletion for movement tracking
    const oldBox = await pool.query('SELECT * FROM shelf_boxes_s WHERE id = $1', [req.params.id]);
    if (!oldBox.rows.length) return res.status(404).json({ error: 'Коробка не найдена' });
    const prev = oldBox.rows[0];
    const prevQty = Number(prev.quantity || 0);

    // Record movement before deletion if box had contents
    if (prevQty > 0 && prev.product_id) {
      await pool.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_shelf_id, from_shelf_box_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ('box_delete', $1, $2, $3, $4, $5, 'manual_edit', 'Удаление коробки с полки', $2, 0)`,
        [prev.product_id, prevQty, prev.shelf_id, parseInt(req.params.id), req.user?.id || null]
      );
    }

    await nullifyShelfBoxRefs(pool, [parseInt(req.params.id)]);
    await pool.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id = $1', [req.params.id]);
    await pool.query('DELETE FROM shelf_boxes_s WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    // Run both queries in parallel for speed
    const [result, warehouses] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM warehouses_s WHERE active = true) as warehouses_count,
          (SELECT COUNT(*) FROM racks_s) as racks_count,
          (SELECT COUNT(*) FROM shelves_s) as shelves_count,
          (SELECT COUNT(*) FROM pallet_rows_s) as pallet_rows_count,
          (SELECT COUNT(*) FROM pallets_s) as pallets_count,
          (COALESCE((SELECT COUNT(*) FROM boxes_s WHERE status = 'closed'),0) + COALESCE((SELECT COUNT(*) FROM shelf_boxes_s WHERE status = 'closed'),0)) as boxes_count,
          (COALESCE((SELECT SUM(quantity) FROM shelf_items_s WHERE quantity > 0),0) + COALESCE((SELECT SUM(quantity) FROM shelf_boxes_s WHERE quantity > 0),0)) as total_items,
          (
            SELECT COUNT(*) FROM (
              SELECT DISTINCT product_id FROM shelf_items_s WHERE quantity > 0
              UNION
              SELECT DISTINCT product_id FROM shelf_boxes_s WHERE quantity > 0 AND product_id IS NOT NULL
            ) products
          ) as unique_products,
          (
            COALESCE((SELECT COUNT(DISTINCT shelf_id) FROM shelf_items_s WHERE quantity > 0),0)
            +
            COALESCE((SELECT COUNT(DISTINCT shelf_id) FROM shelf_boxes_s WHERE quantity > 0),0)
          ) as occupied_shelves,
          GREATEST(0, (SELECT COUNT(*) FROM shelves_s) - (
            COALESCE((SELECT COUNT(DISTINCT shelf_id) FROM shelf_items_s WHERE quantity > 0),0)
            +
            COALESCE((SELECT COUNT(DISTINCT shelf_id) FROM shelf_boxes_s WHERE quantity > 0),0)
          )) as empty_shelves
      `),
      pool.query(`
        SELECT
          w.id, w.name, w.warehouse_type,
          (SELECT COUNT(*) FROM racks_s WHERE warehouse_id = w.id) as racks_count,
          (SELECT COUNT(*) FROM shelves_s sh JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id) as shelves_count,
          (SELECT COUNT(*) FROM pallet_rows_s WHERE warehouse_id = w.id) as pallet_rows_count,
          (SELECT COUNT(*) FROM pallets_s p JOIN pallet_rows_s pr ON p.row_id = pr.id WHERE pr.warehouse_id = w.id) as pallets_count,
          (
            COALESCE((SELECT COUNT(*) FROM boxes_s b JOIN pallets_s p ON b.pallet_id = p.id JOIN pallet_rows_s pr ON p.row_id = pr.id WHERE pr.warehouse_id = w.id AND b.status = 'closed'),0)
            +
            COALESCE((SELECT COUNT(*) FROM shelf_boxes_s sb JOIN shelves_s sh ON sb.shelf_id = sh.id JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id AND sb.status = 'closed'),0)
          ) as boxes_count,
          (
            COALESCE((SELECT SUM(si.quantity) FROM shelf_items_s si JOIN shelves_s sh ON si.shelf_id = sh.id JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id AND si.quantity > 0),0)
            +
            COALESCE((SELECT SUM(sb.quantity) FROM shelf_boxes_s sb JOIN shelves_s sh ON sb.shelf_id = sh.id JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id AND sb.quantity > 0),0)
          ) as total_items,
          COALESCE((SELECT SUM(b.quantity) FROM boxes_s b JOIN pallets_s p ON b.pallet_id = p.id JOIN pallet_rows_s pr ON p.row_id = pr.id WHERE pr.warehouse_id = w.id AND b.status = 'closed'),0) as fbo_items,
          (
            SELECT COUNT(*) FROM (
              SELECT DISTINCT si.product_id
              FROM shelf_items_s si
              JOIN shelves_s sh ON si.shelf_id = sh.id
              JOIN racks_s r ON sh.rack_id = r.id
              WHERE r.warehouse_id = w.id AND si.quantity > 0
              UNION
              SELECT DISTINCT sb.product_id
              FROM shelf_boxes_s sb
              JOIN shelves_s sh ON sb.shelf_id = sh.id
              JOIN racks_s r ON sh.rack_id = r.id
              WHERE r.warehouse_id = w.id AND sb.quantity > 0 AND sb.product_id IS NOT NULL
            ) products
          ) as unique_products,
          (
            COALESCE((SELECT COUNT(DISTINCT si.shelf_id) FROM shelf_items_s si JOIN shelves_s sh ON si.shelf_id = sh.id JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id AND si.quantity > 0),0)
            +
            COALESCE((SELECT COUNT(DISTINCT sb.shelf_id) FROM shelf_boxes_s sb JOIN shelves_s sh ON sb.shelf_id = sh.id JOIN racks_s r ON sh.rack_id = r.id WHERE r.warehouse_id = w.id AND sb.quantity > 0),0)
          ) as occupied_shelves
        FROM warehouses_s w WHERE w.active = true ORDER BY w.name
      `)
    ]);

    res.json({ ...result.rows[0], warehouses: warehouses.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/warehouse/movements?shelf_id=X&product_id=Y&pallet_id=Z&limit=N
router.get('/movements', requireAuth, async (req, res) => {
  const { shelf_id, product_id, pallet_id, limit = 500 } = req.query;

  // If pallet_id is requested, query from movements_s (universal log) instead
  if (pallet_id) {
    try {
      const params = [parseInt(pallet_id), parseInt(limit)];
      const result = await pool.query(`
        SELECT m.*,
          p.name as product_name, p.code as product_code,
          e.full_name as employee_name,
          b.barcode_value as box_barcode,
          fp.name as from_pallet_name, tp.name as to_pallet_name,
          fs.code as from_shelf_code, fs.name as from_shelf_name,
          ts.code as to_shelf_code, ts.name as to_shelf_name,
          fe.full_name as from_employee_name, te.full_name as to_employee_name
        FROM movements_s m
        LEFT JOIN products_s p ON p.id = m.product_id
        LEFT JOIN users_s u ON u.id = m.performed_by
        LEFT JOIN employees_s e ON e.id = u.employee_id
        LEFT JOIN boxes_s b ON b.id = COALESCE(m.to_box_id, m.from_box_id)
        LEFT JOIN pallets_s fp ON fp.id = m.from_pallet_id
        LEFT JOIN pallets_s tp ON tp.id = m.to_pallet_id
        LEFT JOIN shelves_s fs ON fs.id = m.from_shelf_id
        LEFT JOIN shelves_s ts ON ts.id = m.to_shelf_id
        LEFT JOIN employees_s fe ON fe.id = m.from_employee_id
        LEFT JOIN employees_s te ON te.id = m.to_employee_id
        WHERE m.from_pallet_id = $1 OR m.to_pallet_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2
      `, params);
      return res.json(result.rows);
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  const lim = parseInt(limit);

  // For shelf queries: merge shelf_movements_s + movements_s (box operations)
  if (shelf_id) {
    try {
      const shelfIdInt = parseInt(shelf_id);
      const conditions1 = ['sm.shelf_id = $1'];
      const params1 = [shelfIdInt];
      if (product_id) { params1.push(parseInt(product_id)); conditions1.push(`sm.product_id = $${params1.length}`); }
      params1.push(lim);
      const where1 = 'WHERE ' + conditions1.join(' AND ');

      const runQuery = () => pool.query(`
        SELECT sm.id, sm.shelf_id, sm.product_id, sm.operation_type, sm.quantity_before, sm.quantity_after,
          sm.quantity_delta, sm.user_id, sm.task_id, sm.notes, sm.created_at, sm.source,
          p.name as product_name, p.code as product_code,
          s.code as shelf_code, s.name as shelf_name,
          r.name as rack_name, r.code as rack_code,
          w.name as warehouse_name,
          e.full_name as employee_name,
          t.title as task_title, t.task_type
        FROM shelf_movements_s sm
        LEFT JOIN products_s p ON p.id = sm.product_id
        LEFT JOIN shelves_s s ON s.id = sm.shelf_id
        LEFT JOIN racks_s r ON r.id = s.rack_id
        LEFT JOIN warehouses_s w ON w.id = r.warehouse_id
        LEFT JOIN users_s u ON u.id = sm.user_id
        LEFT JOIN employees_s e ON e.id = u.employee_id
        LEFT JOIN inventory_tasks_s t ON t.id = sm.task_id
        ${where1}
        ORDER BY sm.created_at DESC
        LIMIT $${params1.length}
      `, params1);

      let shelfResult;
      try { shelfResult = await runQuery(); } catch (e) {
        if (e.message.includes('deadlock')) { shelfResult = await runQuery(); } else throw e;
      }

      // Also get movements_s records for this shelf (box operations, bundle picks, etc.)
      // Exclude types that duplicate shelf_movements_s entries (manual edits, moves via /move endpoint)
      let boxRows = [];
      try {
        const params2 = [shelfIdInt];
        const conditions2 = [
          '(m.to_shelf_id = $1 OR m.from_shelf_id = $1)',
          `m.movement_type NOT IN (
            'edit_add_to_shelf', 'edit_remove_from_shelf',
            'shelf_to_employee', 'employee_to_shelf',
            'shelf_to_pallet', 'pallet_to_shelf',
            'shelf_to_box', 'box_to_shelf',
            'shelf_to_shelf'
          )`
        ];
        if (product_id) { params2.push(parseInt(product_id)); conditions2.push(`m.product_id = $${params2.length}`); }
        params2.push(lim);

        const boxResult = await pool.query(`
          SELECT m.id, m.movement_type, m.product_id, m.quantity,
            m.from_shelf_id, m.to_shelf_id, m.from_shelf_box_id, m.to_shelf_box_id,
            m.from_employee_id, m.to_employee_id,
            m.performed_by, m.source, m.notes, m.created_at,
            m.quantity_before, m.quantity_after,
            CASE WHEN m.from_shelf_id = $1 THEN -m.quantity ELSE m.quantity END as quantity_delta,
            p.name as product_name, p.code as product_code,
            e.full_name as employee_name,
            sb.name as box_name,
            fe.full_name as from_employee_name, te.full_name as to_employee_name,
            fp.name as from_pallet_name, tp.name as to_pallet_name,
            fsh.code as from_shelf_code, fsh.name as from_shelf_name,
            tsh.code as to_shelf_code, tsh.name as to_shelf_name
          FROM movements_s m
          LEFT JOIN products_s p ON p.id = m.product_id
          LEFT JOIN users_s u ON u.id = m.performed_by
          LEFT JOIN employees_s e ON e.id = u.employee_id
          LEFT JOIN shelf_boxes_s sb ON sb.id = COALESCE(m.to_shelf_box_id, m.from_shelf_box_id)
          LEFT JOIN employees_s fe ON fe.id = m.from_employee_id
          LEFT JOIN employees_s te ON te.id = m.to_employee_id
          LEFT JOIN pallets_s fp ON fp.id = m.from_pallet_id
          LEFT JOIN pallets_s tp ON tp.id = m.to_pallet_id
          LEFT JOIN shelves_s fsh ON fsh.id = m.from_shelf_id
          LEFT JOIN shelves_s tsh ON tsh.id = m.to_shelf_id
          WHERE ${conditions2.join(' AND ')}
          ORDER BY m.created_at DESC
          LIMIT $${params2.length}
        `, params2);
        boxRows = boxResult.rows;
      } catch { /* shelf_box columns may not exist yet — skip box movements */ }

      // Merge both result sets, sort by created_at DESC, limit
      const merged = [...shelfResult.rows, ...boxRows]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, lim);

      return res.json(merged);
    } catch (err) { return res.status(500).json({ error: err.message }); }
  }

  // Generic query (no filters or just product_id)
  const conditions = [];
  const params = [];
  if (product_id) { params.push(product_id); conditions.push(`sm.product_id = $${params.length}`); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(lim);
  try {
    const result = await pool.query(`
      SELECT sm.*,
        p.name as product_name, p.code as product_code,
        s.code as shelf_code, s.name as shelf_name,
        r.name as rack_name, r.code as rack_code,
        w.name as warehouse_name,
        e.full_name as employee_name,
        t.title as task_title, t.task_type
      FROM shelf_movements_s sm
      LEFT JOIN products_s p ON p.id = sm.product_id
      LEFT JOIN shelves_s s ON s.id = sm.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN warehouses_s w ON w.id = r.warehouse_id
      LEFT JOIN users_s u ON u.id = sm.user_id
      LEFT JOIN employees_s e ON e.id = u.employee_id
      LEFT JOIN inventory_tasks_s t ON t.id = sm.task_id
      ${where}
      ORDER BY sm.created_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/warehouse/box-movements?box_id=X&box_type=shelf|pallet&limit=N
router.get('/box-movements', requireAuth, async (req, res) => {
  const { box_id, box_type = 'pallet', limit = 200 } = req.query;
  if (!box_id) return res.status(400).json({ error: 'box_id обязателен' });

  try {
    const boxIdInt = parseInt(box_id);
    const lim = parseInt(limit);
    const boxFilter = box_type === 'shelf'
      ? 'm.from_shelf_box_id = $1 OR m.to_shelf_box_id = $1'
      : 'm.from_box_id = $1 OR m.to_box_id = $1';
    const result = await pool.query(`
      SELECT m.*,
        p.name as product_name, p.code as product_code,
        e.full_name as employee_name,
        fp.name as from_pallet_name, tp.name as to_pallet_name,
        fs.code as from_shelf_code, fs.name as from_shelf_name,
        ts.code as to_shelf_code, ts.name as to_shelf_name,
        fe.full_name as from_employee_name, te.full_name as to_employee_name
      FROM movements_s m
      LEFT JOIN products_s p ON p.id = m.product_id
      LEFT JOIN users_s u ON u.id = m.performed_by
      LEFT JOIN employees_s e ON e.id = u.employee_id
      LEFT JOIN pallets_s fp ON fp.id = m.from_pallet_id
      LEFT JOIN pallets_s tp ON tp.id = m.to_pallet_id
      LEFT JOIN shelves_s fs ON fs.id = m.from_shelf_id
      LEFT JOIN shelves_s ts ON ts.id = m.to_shelf_id
      LEFT JOIN employees_s fe ON fe.id = m.from_employee_id
      LEFT JOIN employees_s te ON te.id = m.to_employee_id
      WHERE ${boxFilter}
      ORDER BY m.created_at DESC
      LIMIT $2
    `, [boxIdInt, lim]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Visual Warehouse ─────────────────────────────────────────────────────────

// GET /api/warehouse/visual/:warehouseId
router.get('/visual/:warehouseId', requireAuth, async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const { rows: racks } = await pool.query(
      `SELECT id, name, number, code, barcode_value FROM racks_s WHERE warehouse_id = $1 ORDER BY number`,
      [warehouseId]
    );
    for (const rack of racks) {
      const { rows: shelves } = await pool.query(
        `SELECT id, name, number, code, barcode_value FROM shelves_s WHERE rack_id = $1 ORDER BY number`,
        [rack.id]
      );
      for (const shelf of shelves) {
        const { rows: boxes } = await pool.query(
          `SELECT id, name, position, barcode_value FROM shelf_boxes_s WHERE shelf_id = $1 ORDER BY position`,
          [shelf.id]
        );
        shelf.boxes = boxes;
      }
      rack.shelves = shelves;
    }
    res.json({ racks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Visual FBS (real shelf_items) ───────────────────────────────────────────

// POST /api/warehouse/visual-fbs/move — transfer product between shelves
router.post('/visual-fbs/move', requireAuth, async (req, res) => {
  const { product_id, from_shelf_id, to_shelf_id, quantity } = req.body;
  if (!product_id || !from_shelf_id || !to_shelf_id || !quantity)
    return res.status(400).json({ error: 'product_id, from_shelf_id, to_shelf_id, quantity обязательны' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const moveQty = parseFloat(quantity);
    const srcRes = await client.query(
      'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
      [from_shelf_id, product_id]
    );
    const srcQty = srcRes.rows.length ? parseFloat(srcRes.rows[0].quantity) : 0;
    if (srcQty < moveQty) throw new Error('Недостаточно товара на полке-источнике');
    const newSrcQty = srcQty - moveQty;
    if (newSrcQty <= 0) {
      await client.query('DELETE FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2', [from_shelf_id, product_id]);
    } else {
      await client.query(
        'UPDATE shelf_items_s SET quantity=$1, updated_by=$2, updated_at=NOW() WHERE shelf_id=$3 AND product_id=$4',
        [newSrcQty, req.user.id, from_shelf_id, product_id]
      );
    }
    const dstRes = await client.query(
      'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
      [to_shelf_id, product_id]
    );
    const dstQty = dstRes.rows.length ? parseFloat(dstRes.rows[0].quantity) : 0;
    const newDstQty = dstQty + moveQty;
    await client.query(
      `INSERT INTO shelf_items_s (shelf_id, product_id, quantity, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (shelf_id, product_id) DO UPDATE SET quantity=$3, updated_by=$4, updated_at=NOW()`,
      [to_shelf_id, product_id, newDstQty, req.user.id]
    );
    await client.query(
      `INSERT INTO shelf_movements_s (shelf_id,product_id,operation_type,quantity_before,quantity_after,quantity_delta,user_id,notes)
       VALUES ($1,$2,'correction',$3,$4,$5,$6,'Визуальное перемещение')`,
      [from_shelf_id, product_id, srcQty, newSrcQty, -moveQty, req.user.id]
    );
    await client.query(
      `INSERT INTO shelf_movements_s (shelf_id,product_id,operation_type,quantity_before,quantity_after,quantity_delta,user_id,notes)
       VALUES ($1,$2,'correction',$3,$4,$5,$6,'Визуальное перемещение')`,
      [to_shelf_id, product_id, dstQty, newDstQty, moveQty, req.user.id]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// GET /api/warehouse/visual-fbs/:warehouseId — racks → shelves → shelf_items
router.get('/visual-fbs/:warehouseId', requireAuth, async (req, res) => {
  try {
    const { warehouseId } = req.params;
    const { rows: rackRows } = await pool.query(
      `SELECT id, name, number, code FROM racks_s WHERE warehouse_id=$1 ORDER BY number`,
      [warehouseId]
    );
    const racks = [];
    for (const rack of rackRows) {
      const { rows: shelfRows } = await pool.query(
        `SELECT id, name, number, code, barcode_value FROM shelves_s WHERE rack_id=$1 ORDER BY number`,
        [rack.id]
      );
      const shelves = [];
      for (const shelf of shelfRows) {
        const { rows: items } = await pool.query(
          `SELECT si.product_id, si.quantity, p.name as product_name, p.code as product_code
           FROM shelf_items_s si
           JOIN products_s p ON p.id = si.product_id
           WHERE si.shelf_id=$1 AND si.quantity > 0 ORDER BY p.name`,
          [shelf.id]
        );
        shelves.push({ ...shelf, items });
      }
      racks.push({ ...rack, shelves });
    }
    res.json({ racks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/warehouse/find-product?product_id=X — find shelf boxes containing this product
// По умолчанию скрывает склады с exclude_from_suggestions=true.
// include_excluded=1 — вернуть все (для админских мест).
router.get('/find-product', requireAuth, async (req, res) => {
  const { product_id, include_excluded } = req.query;
  if (!product_id) return res.status(400).json({ error: 'product_id обязателен' });
  const includeExcluded = include_excluded === '1' || include_excluded === 'true';
  try {
    const result = await pool.query(`
      SELECT sbi.shelf_box_id, sbi.quantity,
        sb.barcode_value as box_barcode, sb.name as box_name, sb.position as box_position,
        s.id as shelf_id, s.code as shelf_code, s.name as shelf_name,
        r.name as rack_name, r.code as rack_code,
        w.name as warehouse_name, w.id as warehouse_id
      FROM shelf_box_items_s sbi
      JOIN shelf_boxes_s sb ON sb.id = sbi.shelf_box_id
      JOIN shelves_s s ON s.id = sb.shelf_id
      JOIN racks_s r ON r.id = s.rack_id
      JOIN warehouses_s w ON w.id = r.warehouse_id
      WHERE sbi.product_id = $1 AND sbi.quantity > 0
        ${includeExcluded ? '' : 'AND w.exclude_from_suggestions = false'}
      ORDER BY sbi.quantity DESC
      LIMIT 10
    `, [parseInt(product_id)]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

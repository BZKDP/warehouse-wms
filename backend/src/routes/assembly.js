const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { awardScanReward } = require('./tasks');
const { pickPreferredProduct } = require('../utils/sharedBarcodes');

// ─── Barcode → Product resolver (reused from tasks.js pattern) ──────────────
// preferredIds: при shared-ШК (несколько товаров с одним ШК) предпочитаем
// товар из контекста задачи — компонент комплекта или сам комплект.
async function resolveProduct(client, barcode, preferredIds = []) {
  const r = await client.query(
    `SELECT id, name, code, entity_type, production_barcode, barcode_list
     FROM products_s
     WHERE $1 = ANY(string_to_array(barcode_list, ';'))
        OR production_barcode = $1
        OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
     ORDER BY id
     LIMIT 5`,
    [barcode]
  );
  return pickPreferredProduct(r.rows, preferredIds);
}

// Компоненты комплекта — для предпочтения при shared-ШК
async function bundleComponentIds(client, bundleId) {
  if (!bundleId) return [];
  const r = await client.query('SELECT component_id FROM bundle_components_s WHERE bundle_id = $1', [bundleId]);
  return r.rows.map(x => x.component_id).filter(Boolean);
}

// ─── GET /source-locations — Find where components are stored ────────────────
router.get('/source-locations', requireAuth, async (req, res) => {
  let { component_ids, bundle_id } = req.query;
  let ids = [];

  if (bundle_id) {
    // Resolve component IDs from bundle
    const comps = await pool.query('SELECT component_id FROM bundle_components_s WHERE bundle_id = $1', [bundle_id]);
    ids = comps.rows.map(c => c.component_id);
    // Fallback: resolve from source_json
    if (ids.length === 0) {
      const prod = await pool.query('SELECT source_json FROM products_s WHERE id = $1', [bundle_id]);
      const rows = prod.rows[0]?.source_json?.components?.rows || [];
      const extIds = rows.map(r => r.assortmentDetails?.id).filter(Boolean);
      if (extIds.length > 0) {
        const resolved = await pool.query('SELECT id FROM products_s WHERE external_id = ANY($1)', [extIds]);
        ids = resolved.rows.map(r => r.id);
      }
    }
  } else if (component_ids) {
    ids = component_ids.split(',').map(Number).filter(n => n > 0);
  }

  if (ids.length === 0) return res.json([]);

  try {
    // Find in pallet boxes (with GREATEST fallback for boxes_s.quantity + legacy union)
    const boxLocs = await pool.query(
      `(SELECT bi.product_id,
              CASE WHEN b.product_id = bi.product_id
                   THEN GREATEST(bi.quantity, COALESCE(b.quantity, 0))
                   ELSE bi.quantity END as quantity,
              b.id as box_id, b.barcode_value as box_barcode,
              pa.id as pallet_id, pa.name as pallet_name,
              pr.id as row_id, pr.name as row_name,
              w.id as warehouse_id, w.name as warehouse_name,
              p.name as product_name
       FROM box_items_s bi
       JOIN boxes_s b ON b.id = bi.box_id
       JOIN pallets_s pa ON pa.id = b.pallet_id
       JOIN pallet_rows_s pr ON pr.id = pa.row_id
       JOIN warehouses_s w ON w.id = pr.warehouse_id
       JOIN products_s p ON p.id = bi.product_id
       WHERE bi.product_id = ANY($1) AND bi.quantity > 0 AND b.status = 'closed' AND w.active = true)
       UNION ALL
       (SELECT b.product_id, b.quantity,
              b.id as box_id, b.barcode_value as box_barcode,
              pa.id as pallet_id, pa.name as pallet_name,
              pr.id as row_id, pr.name as row_name,
              w.id as warehouse_id, w.name as warehouse_name,
              p.name as product_name
       FROM boxes_s b
       JOIN pallets_s pa ON pa.id = b.pallet_id
       JOIN pallet_rows_s pr ON pr.id = pa.row_id
       JOIN warehouses_s w ON w.id = pr.warehouse_id
       JOIN products_s p ON p.id = b.product_id
       WHERE b.product_id = ANY($1) AND b.quantity > 0 AND b.status = 'closed' AND w.active = true
         AND NOT EXISTS (SELECT 1 FROM box_items_s bi WHERE bi.box_id = b.id AND bi.product_id = b.product_id AND bi.quantity > 0))
       ORDER BY product_name, warehouse_name, row_name, pallet_name`, [ids]);

    // Find on shelves
    const shelfLocs = await pool.query(
      `SELECT si.product_id, si.quantity, s.id as shelf_id, s.code as shelf_code,
              r.name as rack_name, w.id as warehouse_id, w.name as warehouse_name,
              p.name as product_name
       FROM shelf_items_s si
       JOIN shelves_s s ON s.id = si.shelf_id
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       JOIN products_s p ON p.id = si.product_id
       WHERE si.product_id = ANY($1) AND si.quantity > 0 AND w.active = true
       ORDER BY p.name, w.name`, [ids]);

    // Find on pallets directly (pallet_items_s — no boxes)
    const palletLocs = await pool.query(
      `SELECT pi.product_id, pi.quantity, pi.pallet_id,
              pa.name as pallet_name, pa.barcode_value as pallet_barcode,
              pr.name as row_name, pr.id as row_id,
              w.id as warehouse_id, w.name as warehouse_name,
              p.name as product_name
       FROM pallet_items_s pi
       JOIN pallets_s pa ON pa.id = pi.pallet_id
       JOIN pallet_rows_s pr ON pr.id = pa.row_id
       JOIN warehouses_s w ON w.id = pr.warehouse_id
       JOIN products_s p ON p.id = pi.product_id
       WHERE pi.product_id = ANY($1) AND pi.quantity > 0 AND w.active = true
       ORDER BY p.name, w.name, pr.name, pa.name`, [ids]);

    const results = [];
    boxLocs.rows.forEach(r => results.push({
      key: `box-${r.box_id}`,
      path: `${r.warehouse_name} → ${r.row_name} → ${r.pallet_name}`,
      product_id: r.product_id, product_name: r.product_name, qty: Number(r.quantity),
      box_id: r.box_id, pallet_id: r.pallet_id, warehouse_id: r.warehouse_id,
    }));
    palletLocs.rows.forEach(r => results.push({
      key: `pallet-${r.pallet_id}-${r.product_id}`,
      path: `${r.warehouse_name} → ${r.row_name} → ${r.pallet_name}`,
      product_id: r.product_id, product_name: r.product_name, qty: Number(r.quantity),
      pallet_id: r.pallet_id, warehouse_id: r.warehouse_id,
    }));
    shelfLocs.rows.forEach(r => results.push({
      key: `shelf-${r.shelf_id}-${r.product_id}`,
      path: `${r.warehouse_name} → ${r.rack_name} → ${r.shelf_code}`,
      product_id: r.product_id, product_name: r.product_name, qty: Number(r.quantity),
      shelf_id: r.shelf_id, warehouse_id: r.warehouse_id,
    }));

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST / — Create assembly task (admin) ──────────────────────────────────
router.post('/', requireAuth, requirePermission('tasks.create'), async (req, res) => {
  const { bundle_product_id, bundle_qty, employee_id, source_boxes, dest_shelf_id, dest_pallet_id, notes } = req.body;
  if (!bundle_product_id || !bundle_qty || bundle_qty < 1) return res.status(400).json({ error: 'bundle_product_id и bundle_qty обязательны' });

  try {
    // Verify it's a bundle
    const product = await pool.query('SELECT id, name, entity_type FROM products_s WHERE id = $1', [bundle_product_id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    if (product.rows[0].entity_type !== 'bundle') return res.status(400).json({ error: 'Товар должен быть комплектом (bundle)' });

    // Get bundle components (bundle_components_s first, then source_json fallback)
    let comps = await pool.query(
      `SELECT bc.component_id, bc.quantity, p.name, p.code
       FROM bundle_components_s bc JOIN products_s p ON p.id = bc.component_id
       WHERE bc.bundle_id = $1`, [bundle_product_id]);

    // Fallback: resolve from source_json if no rows in bundle_components_s
    if (comps.rows.length === 0) {
      const fullProduct = await pool.query('SELECT source_json FROM products_s WHERE id = $1', [bundle_product_id]);
      const rows = fullProduct.rows[0]?.source_json?.components?.rows || [];
      if (rows.length > 0) {
        const externalIds = rows.map(r => r.assortmentDetails?.id).filter(Boolean);
        const quantities = {};
        rows.forEach(r => { if (r.assortmentDetails?.id) quantities[r.assortmentDetails.id] = r.quantity || 1; });
        if (externalIds.length > 0) {
          const resolved = await pool.query(
            `SELECT id as component_id, name, code, external_id FROM products_s WHERE external_id = ANY($1)`, [externalIds]);
          comps = { rows: resolved.rows.map(c => ({ ...c, quantity: quantities[c.external_id] || 1 })) };
        }
      }
    }

    if (comps.rows.length === 0) return res.status(400).json({ error: 'У комплекта нет компонентов' });

    const title = `Сборка: ${product.rows[0].name} × ${bundle_qty}`;
    const result = await pool.query(
      `INSERT INTO inventory_tasks_s (title, task_type, employee_id, bundle_product_id, bundle_qty, assembly_phase, source_boxes, dest_shelf_id, dest_pallet_id, notes, created_by)
       VALUES ($1, 'bundle_assembly', $2, $3, $4, 'picking', $5, $6, $7, $8, $9) RETURNING id`,
      [title, employee_id || null, bundle_product_id, bundle_qty,
       source_boxes ? JSON.stringify(source_boxes) : null,
       dest_shelf_id || null, dest_pallet_id || null,
       notes || null, req.user.id]
    );
    res.json({ ok: true, id: result.rows[0].id, title, components: comps.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id — Task details ────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const task = await pool.query(
      `SELECT t.*, p.name as bundle_name, p.code as bundle_code,
              p.barcode_list as bundle_barcodes, p.production_barcode as bundle_barcode,
              e.full_name as employee_name
       FROM inventory_tasks_s t
       LEFT JOIN products_s p ON p.id = t.bundle_product_id
       LEFT JOIN employees_s e ON e.id = t.employee_id
       WHERE t.id = $1 AND t.task_type = 'bundle_assembly'`, [req.params.id]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    // Components
    const comps = await pool.query(
      `SELECT bc.component_id, bc.quantity, p.name, p.code, p.barcode_list, p.production_barcode
       FROM bundle_components_s bc JOIN products_s p ON p.id = bc.component_id
       WHERE bc.bundle_id = $1`, [task.rows[0].bundle_product_id]);

    // Picked items summary
    const picked = await pool.query(
      `SELECT product_id, COUNT(*) as picked_count
       FROM assembly_items_s WHERE task_id = $1 GROUP BY product_id`, [req.params.id]);

    // Assembly progress
    const assembled = await pool.query(
      `SELECT used_in_bundle, COUNT(*) as items
       FROM assembly_items_s WHERE task_id = $1 AND used_in_bundle > 0
       GROUP BY used_in_bundle`, [req.params.id]);

    res.json({
      ...task.rows[0],
      components: comps.rows,
      picked_summary: picked.rows,
      assembled_bundles: assembled.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/source-boxes — Boxes with required products ──────────────────
router.get('/:id/source-boxes', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT bundle_product_id FROM inventory_tasks_s WHERE id = $1', [req.params.id]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    const comps = await pool.query(
      'SELECT component_id FROM bundle_components_s WHERE bundle_id = $1', [task.rows[0].bundle_product_id]);
    const baseComponentIds = comps.rows.map(c => c.component_id).filter(Boolean);
    if (baseComponentIds.length === 0) return res.json([]);

    // Расширяем список по дубликатам products_s: один и тот же реальный товар может
    // быть импортирован/создан несколько раз с разными id. Связываем по external_id,
    // production_barcode, code и совпадающим значениям в barcode_list.
    const expanded = await pool.query(
      `SELECT DISTINCT p2.id
       FROM products_s p1
       JOIN products_s p2 ON (
         p2.id = p1.id
         OR (p2.external_id IS NOT NULL AND p2.external_id = p1.external_id)
         OR (p2.production_barcode IS NOT NULL AND p2.production_barcode = p1.production_barcode)
         OR (p2.code IS NOT NULL AND p1.code IS NOT NULL AND p2.code = p1.code)
       )
       WHERE p1.id = ANY($1)`,
      [baseComponentIds]
    );
    const componentIds = expanded.rows.map(r => r.id);
    if (componentIds.length === 0) return res.json([]);

    // Pallet boxes: box_items_s + fallback boxes where quantity is only in boxes_s
    // Многие коробки (созданные через packing) хранят количество только в boxes_s,
    // без строк в box_items_s, или с устаревшими малыми qty в box_items_s.
    const boxes = await pool.query(
      `(
        -- Коробки с детальным трекингом через box_items_s
        -- Если boxes_s.product_id совпадает, берём GREATEST для защиты от рассинхрона
        SELECT b.id as box_id, b.barcode_value as box_barcode, b.pallet_id, bi.product_id,
               CASE WHEN b.product_id = bi.product_id
                    THEN GREATEST(bi.quantity, COALESCE(b.quantity, 0))
                    ELSE bi.quantity END as quantity,
               p.name as product_name, p.code as product_code,
               pa.name as pallet_name, pa.barcode_value as pallet_barcode, pr.name as row_name, w.name as warehouse_name,
               'pallet' as source_type
        FROM box_items_s bi
        JOIN boxes_s b ON b.id = bi.box_id
        JOIN products_s p ON p.id = bi.product_id
        LEFT JOIN pallets_s pa ON pa.id = b.pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
        LEFT JOIN warehouses_s w ON w.id = pr.warehouse_id
        WHERE bi.product_id = ANY($1) AND bi.quantity > 0 AND b.status = 'closed' AND w.active = true
      )
      UNION ALL
      (
        -- Legacy-коробки: product_id + quantity в boxes_s, но нет строки в box_items_s
        SELECT b.id as box_id, b.barcode_value as box_barcode, b.pallet_id, b.product_id,
               b.quantity,
               p.name as product_name, p.code as product_code,
               pa.name as pallet_name, pa.barcode_value as pallet_barcode, pr.name as row_name, w.name as warehouse_name,
               'pallet' as source_type
        FROM boxes_s b
        JOIN products_s p ON p.id = b.product_id
        LEFT JOIN pallets_s pa ON pa.id = b.pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
        LEFT JOIN warehouses_s w ON w.id = pr.warehouse_id
        WHERE b.product_id = ANY($1) AND b.quantity > 0 AND b.status = 'closed' AND w.active = true
          AND NOT EXISTS (
            SELECT 1 FROM box_items_s bi
            WHERE bi.box_id = b.id AND bi.product_id = b.product_id AND bi.quantity > 0
          )
      )
      ORDER BY product_name, warehouse_name, pallet_name`,
      [componentIds]
    );

    // Shelf items
    const shelves = await pool.query(
      `SELECT si.product_id, si.quantity, si.shelf_id,
              s.code as shelf_code, s.barcode_value as shelf_barcode,
              r.name as rack_name, r.id as rack_id,
              w.name as warehouse_name, w.id as warehouse_id,
              p.name as product_name, p.code as product_code,
              'shelf' as source_type
       FROM shelf_items_s si
       JOIN shelves_s s ON s.id = si.shelf_id
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       JOIN products_s p ON p.id = si.product_id
       WHERE si.product_id = ANY($1) AND si.quantity > 0 AND w.active = true
       ORDER BY p.name, w.name, r.name, s.code`,
      [componentIds]
    );

    // Pallet items (directly on pallet, no boxes)
    const palletItems = await pool.query(
      `SELECT pi.product_id, pi.quantity, pi.pallet_id,
              pa.name as pallet_name, pa.barcode_value as pallet_barcode,
              pr.name as row_name,
              w.name as warehouse_name, w.id as warehouse_id,
              p.name as product_name, p.code as product_code,
              'pallet_item' as source_type
       FROM pallet_items_s pi
       JOIN pallets_s pa ON pa.id = pi.pallet_id
       JOIN pallet_rows_s pr ON pr.id = pa.row_id
       JOIN warehouses_s w ON w.id = pr.warehouse_id
       JOIN products_s p ON p.id = pi.product_id
       WHERE pi.product_id = ANY($1) AND pi.quantity > 0 AND w.active = true
       ORDER BY p.name, w.name, pr.name, pa.name`,
      [componentIds]
    );

    // Shelf boxes (boxes located on shelves)
    const shelfBoxes = await pool.query(
      `SELECT sb.id as box_id, sb.barcode_value as box_barcode, sb.shelf_id,
              sbi.product_id, sbi.quantity,
              p.name as product_name, p.code as product_code,
              s.code as shelf_code, s.name as shelf_name,
              r.name as rack_name, r.id as rack_id,
              w.name as warehouse_name, w.id as warehouse_id,
              'shelf_box' as source_type
       FROM shelf_box_items_s sbi
       JOIN shelf_boxes_s sb ON sb.id = sbi.shelf_box_id
       JOIN shelves_s s ON s.id = sb.shelf_id
       JOIN racks_s r ON r.id = s.rack_id
       JOIN warehouses_s w ON w.id = r.warehouse_id
       JOIN products_s p ON p.id = sbi.product_id
       WHERE sbi.product_id = ANY($1) AND sbi.quantity > 0 AND w.active = true
       ORDER BY p.name, w.name, r.name, s.code`,
      [componentIds]
    );

    res.json([...boxes.rows, ...palletItems.rows, ...shelves.rows, ...shelfBoxes.rows]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/start-picking — Start picking phase ─────────────────────────
router.post('/:id/start-picking', requireAuth, async (req, res) => {
  try {
    // employee_id from users_s (may be null for admin)
    const employeeId = req.user.employee_id || null;
    // If no employee linked, just set null (admin testing)

    await pool.query(
      `UPDATE inventory_tasks_s SET status = 'in_progress', assembly_phase = 'picking', started_at = NOW(),
       employee_id = COALESCE(employee_id, $2)
       WHERE id = $1 AND task_type = 'bundle_assembly'`,
      [req.params.id, employeeId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/scan-pick — Scan item from pallet box or shelf ───────────────
router.post('/:id/scan-pick', requireAuth, async (req, res) => {
  const { barcode, box_id, shelf_id, pallet_id, box_source } = req.body;
  if (!barcode) return res.status(400).json({ error: 'barcode обязателен' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Задача не найдена' }); }
    if (task.rows[0].status !== 'in_progress') { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Задача не начата. Нажмите «Начать забор»' }); }
    if (task.rows[0].paused_at) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Задача на паузе. Дождитесь возобновления администратором.' }); }
    if (task.rows[0].assembly_phase !== 'picking') { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Задача не в фазе забора' }); }
    // Check employee break
    if (task.rows[0].employee_id) {
      const ab = await client.query('SELECT break_type FROM employee_breaks_s WHERE employee_id = $1 AND ended_at IS NULL LIMIT 1', [task.rows[0].employee_id]);
      if (ab.rows.length) { const l = ab.rows[0].break_type === 'lunch' ? 'обеде' : ab.rows[0].break_type === 'rest' ? 'отдыхе' : 'тех. паузе'; await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: `Вы на ${l}. Завершите перерыв` }); }
    }
    if (!box_id && !shelf_id && !pallet_id) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Укажите источник (box_id / shelf_id / pallet_id)' }); }

    let product = await resolveProduct(client, barcode,
      await bundleComponentIds(client, task.rows[0].bundle_product_id));
    if (!product) {
      // Smart scan classification
      const hasCyrillic = /[а-яА-ЯёЁ]/.test(barcode);
      const isUrl = /^https?:\/\//i.test(barcode);
      let deduped = null;
      if (!hasCyrillic && !isUrl && barcode.length >= 12) {
        for (let len = 6; len <= Math.floor(barcode.length / 2); len++) {
          const chunk = barcode.substring(0, len);
          if (barcode === chunk.repeat(Math.round(barcode.length / len)) || barcode.startsWith(chunk + chunk)) { deduped = chunk; break; }
        }
      }
      if (hasCyrillic) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Переключите раскладку клавиатуры на английскую (EN)', hint: 'keyboard_layout' }); }
      if (isUrl) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Вы отсканировали ссылку на сайт. Сканируйте штрих-код товара', hint: 'url_scanned' }); }
      if (deduped) {
        await client.query('ROLLBACK'); client.release();
        return res.status(400).json({ error: 'ШК отсканирован несколько раз подряд. Отсканируйте повторно, один раз.', hint: 'duplicate_scan' });
      } else if (/^\d+$/.test(barcode) && barcode.length < 6) {
        await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Штрих-код считался не полностью. Попробуйте ещё раз', hint: 'partial_scan' });
      } else {
        await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Товар не найден по ШК' });
      }
    }

    // Check product is a component of this bundle.
    // Толерантно к дубликатам products_s: один реальный товар может иметь несколько
    // записей в products_s (разные импорты), а bundle_components_s ссылается только
    // на одну из них. Сопоставляем по external_id / production_barcode / code.
    const comp = await client.query(
      `SELECT bc.*
       FROM bundle_components_s bc
       JOIN products_s pc ON pc.id = bc.component_id
       JOIN products_s ps ON ps.id = $2
       WHERE bc.bundle_id = $1
         AND (
           bc.component_id = $2
           OR (pc.external_id IS NOT NULL AND pc.external_id = ps.external_id)
           OR (pc.production_barcode IS NOT NULL AND pc.production_barcode = ps.production_barcode)
           OR (pc.code IS NOT NULL AND ps.code IS NOT NULL AND pc.code = ps.code)
         )
       LIMIT 1`,
      [task.rows[0].bundle_product_id, product.id]);
    if (!comp.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: `${product.name} не входит в состав комплекта` }); }
    // Используем component_id из bundle_components_s для последующего учёта —
    // так прогресс и assembly_items_s остаются консистентными с составом комплекта.
    const canonicalComponentId = comp.rows[0].component_id;

    // Класс эквивалентности product.id: другие records products_s, которые
    // соответствуют тому же реальному товару (дубликаты импорта). Используем
    // для декремента из box_items_s / shelf_items_s — на складе фактически
    // может лежать любой из дубликатов.
    const equiv = await client.query(
      `SELECT DISTINCT p2.id
       FROM products_s p1
       JOIN products_s p2 ON (
         p2.id = p1.id
         OR (p2.external_id IS NOT NULL AND p2.external_id = p1.external_id)
         OR (p2.production_barcode IS NOT NULL AND p2.production_barcode = p1.production_barcode)
         OR (p2.code IS NOT NULL AND p1.code IS NOT NULL AND p2.code = p1.code)
       )
       WHERE p1.id = ANY($1)`,
      [[product.id, canonicalComponentId]]
    );
    const equivProductIds = equiv.rows.map(r => r.id);

    // Check if already picked enough of this component
    const alreadyPicked = await client.query(
      'SELECT COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 AND product_id = ANY($2)', [req.params.id, equivProductIds]);
    const needed = Number(comp.rows[0].quantity) * task.rows[0].bundle_qty;
    if (Number(alreadyPicked.rows[0].cnt) >= needed) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ error: `Уже набрано ${alreadyPicked.rows[0].cnt}/${needed}. Больше не нужно` });
    }

    // Decrease quantity from source
    if (box_id) {
      // box_id может быть полочной (shelf_boxes_s) или паллетной (boxes_s) коробкой.
      // box_source='pallet' — фронт точно знает, что это паллетная коробка, пропускаем shelf_boxes_s.
      const isShelfBox = box_source === 'pallet' ? { rows: [] }
        : await client.query('SELECT shelf_id FROM shelf_boxes_s WHERE id = $1', [box_id]);
      if (isShelfBox.rows.length) {
        // Ищем строку с любым эквивалентным product_id — коробка может хранить
        // дубликат products_s (не совпадающий с scanned product.id).
        const upd = await client.query(
          `UPDATE shelf_box_items_s SET quantity = quantity - 1, updated_at = NOW()
           WHERE shelf_box_id = $1 AND product_id = ANY($2) AND quantity > 0
           RETURNING product_id, quantity`,
          [box_id, equivProductIds]);
        if (!upd.rows.length) {
          console.error('[ASSEMBLY] shelf_box source_empty:', JSON.stringify({
            task_id: req.params.id, box_id, box_source, product_id: product.id, equivProductIds,
            note: 'ID коллизия? box_id найден в shelf_boxes_s, но товар не найден в shelf_box_items_s'
          }));
          await client.query('ROLLBACK'); client.release();
          return res.status(400).json({ error: 'В этой коробке закончился товар. Нажмите «Сменить коробку»', hint: 'source_empty' });
        }
        await client.query('UPDATE shelf_boxes_s SET quantity = GREATEST(0, quantity - 1) WHERE id = $1', [box_id]);
        await client.query(
          `INSERT INTO movements_s (movement_type, product_id, quantity, from_shelf_box_id, from_shelf_id, performed_by, source, notes)
           VALUES ('bundle_pick', $1, 1, $2, $3, $4, 'task', $5)`,
          [product.id, box_id, isShelfBox.rows[0].shelf_id || null, req.user.id, `task:${req.params.id}`]);
      } else {
        // ─── Проактивная синхронизация box_items_s ← boxes_s ──────────
        // Многие коробки (из packing) хранят реальное количество только в
        // boxes_s.quantity, а box_items_s пуста или содержит заниженное число.
        // Синхронизируем ПЕРЕД декрементом, чтобы не блокировать пики.
        const boxRow = await client.query('SELECT product_id, quantity FROM boxes_s WHERE id = $1', [box_id]);
        if (boxRow.rows.length) {
          const br = boxRow.rows[0];
          const boxQty = Number(br.quantity || 0);
          if (boxQty > 0) {
            // Есть ли вообще строки в box_items_s для этой коробки?
            const anyBi = await client.query(
              'SELECT COALESCE(SUM(quantity), 0)::int as total, COUNT(*)::int as cnt FROM box_items_s WHERE box_id = $1', [box_id]);
            const biTotal = Number(anyBi.rows[0]?.total || 0);
            const biCnt = Number(anyBi.rows[0]?.cnt || 0);
            // Ищем любую эквивалентную строку (product.id или дубликат)
            const biRow = await client.query(
              'SELECT product_id, quantity FROM box_items_s WHERE box_id = $1 AND product_id = ANY($2) LIMIT 1',
              [box_id, equivProductIds]);
            const biQty = biRow.rows.length ? Number(biRow.rows[0].quantity) : 0;
            // product_id, под которым коробка фактически хранит остаток
            // (может совпадать с boxes_s.product_id или с эквивалентом)
            const targetPid = biRow.rows.length
              ? biRow.rows[0].product_id
              : (br.product_id && equivProductIds.includes(Number(br.product_id)) ? br.product_id : product.id);

            const isLegacyEmpty = biCnt === 0;
            const isSingleProductDesync = biCnt > 0
              && biTotal <= biQty
              && boxQty > biQty
              && (!br.product_id || equivProductIds.includes(Number(br.product_id)));
            // Коробка имеет строки в box_items_s для ДРУГИХ товаров, но boxes_s
            // хранит наш product_id — нужно добавить запись для нашего компонента.
            const isProductMissing = biCnt > 0
              && biQty === 0
              && boxQty > 0
              && br.product_id
              && equivProductIds.includes(Number(br.product_id));
            // Обобщённый случай: в box_items_s нет строки для нужного товара
            // (biQty === 0), но boxes_s.quantity > 0 — всегда синхронизируем,
            // даже если boxes_s.product_id не совпадает с equivProductIds или NULL.
            const isGeneralMissing = biQty === 0 && boxQty > 0;

            if (isLegacyEmpty || isSingleProductDesync || isProductMissing || isGeneralMissing) {
              await client.query(
                `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (box_id, product_id) DO UPDATE SET quantity = GREATEST(box_items_s.quantity, $3), updated_at = NOW()`,
                [box_id, targetPid, boxQty]);
            }
          }
        }

        let upd = await client.query(
          `UPDATE box_items_s SET quantity = quantity - 1
           WHERE box_id = $1 AND product_id = ANY($2) AND quantity > 0
           RETURNING product_id, quantity`,
          [box_id, equivProductIds]);
        // Fallback: box_items_s не имеет нужного товара, но boxes_s.quantity > 0 —
        // принудительно создаём запись и повторяем декремент.
        if (!upd.rows.length) {
          const fbBox = await client.query('SELECT product_id, quantity FROM boxes_s WHERE id = $1', [box_id]);
          const fbQty = Number(fbBox.rows[0]?.quantity || 0);
          // Используем boxes_s.quantity если > 0, иначе проверяем общий остаток box_items_s
          const effectiveQty = fbQty > 0 ? fbQty : Number(
            (await client.query('SELECT COALESCE(SUM(quantity), 0)::int as total FROM box_items_s WHERE box_id = $1', [box_id])).rows[0]?.total || 0
          );
          if (effectiveQty > 0) {
            const fbPid = fbBox.rows[0]?.product_id && equivProductIds.includes(Number(fbBox.rows[0].product_id))
              ? fbBox.rows[0].product_id : product.id;
            const insertQty = fbQty > 0 ? fbQty : effectiveQty;
            await client.query(
              `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (box_id, product_id) DO UPDATE SET quantity = GREATEST(box_items_s.quantity, $3), updated_at = NOW()`,
              [box_id, fbPid, insertQty]);
            upd = await client.query(
              `UPDATE box_items_s SET quantity = quantity - 1
               WHERE box_id = $1 AND product_id = ANY($2) AND quantity > 0
               RETURNING product_id, quantity`,
              [box_id, equivProductIds]);
          }
        }
        if (!upd.rows.length) {
          // Диагностика: логируем полное состояние для отладки
          const diagBox = await client.query('SELECT id, product_id, quantity, barcode_value, status FROM boxes_s WHERE id = $1', [box_id]);
          const diagBi = await client.query('SELECT product_id, quantity FROM box_items_s WHERE box_id = $1', [box_id]);
          const diagSb = await client.query('SELECT id, shelf_id FROM shelf_boxes_s WHERE id = $1', [box_id]);
          console.error('[ASSEMBLY] source_empty диагностика:', JSON.stringify({
            task_id: req.params.id, box_id, box_source,
            barcode, product_id: product.id, product_name: product.name,
            equivProductIds,
            boxes_s: diagBox.rows[0] || null,
            box_items_s: diagBi.rows,
            shelf_boxes_s_collision: diagSb.rows.length > 0,
          }));
          await client.query('ROLLBACK'); client.release();
          return res.status(400).json({
            error: 'В этой коробке закончился товар. Нажмите «Сменить коробку»',
            hint: 'source_empty',
            _debug: { box_id, box_source, hasBoxesS: !!diagBox.rows.length, hasSbCollision: diagSb.rows.length > 0 }
          });
        }
        const boxInfo = await client.query('SELECT pallet_id FROM boxes_s WHERE id = $1', [box_id]);
        await client.query('UPDATE boxes_s SET quantity = GREATEST(0, quantity - 1) WHERE id = $1', [box_id]);
        await client.query(
          `INSERT INTO movements_s (movement_type, product_id, quantity, from_box_id, from_pallet_id, performed_by, source, notes)
           VALUES ('bundle_pick', $1, 1, $2, $3, $4, 'task', $5)`,
          [product.id, box_id, boxInfo.rows[0]?.pallet_id, req.user.id, `task:${req.params.id}`]);
      }
    } else if (shelf_id) {
      const upd = await client.query(
        `UPDATE shelf_items_s SET quantity = quantity - 1
         WHERE shelf_id = $1 AND product_id = ANY($2) AND quantity > 0 RETURNING product_id, quantity`,
        [shelf_id, equivProductIds]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'На полке закончился товар. Нажмите «Сменить коробку / источник»', hint: 'source_empty' }); }
      await client.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_shelf_id, performed_by, source, notes)
         VALUES ('bundle_pick', $1, 1, $2, $3, 'task', $4)`,
        [product.id, shelf_id, req.user.id, `task:${req.params.id}`]);
    } else if (pallet_id) {
      const upd = await client.query(
        `UPDATE pallet_items_s SET quantity = quantity - 1
         WHERE pallet_id = $1 AND product_id = ANY($2) AND quantity > 0 RETURNING product_id, quantity`,
        [pallet_id, equivProductIds]);
      if (!upd.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'На паллете закончился товар. Нажмите «Сменить коробку / источник»', hint: 'source_empty' }); }
      await client.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, from_pallet_id, performed_by, source, notes)
         VALUES ('bundle_pick', $1, 1, $2, $3, 'task', $4)`,
        [product.id, pallet_id, req.user.id, `task:${req.params.id}`]);
    }

    // Record picked item — используем canonicalComponentId, чтобы прогресс
    // считался корректно даже при дубликатах products_s.
    await client.query(
      `INSERT INTO assembly_items_s (task_id, product_id, source_box_id, source_pallet_id, source_shelf_id, scanned_barcode)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.params.id, canonicalComponentId, box_id || null, pallet_id || null, shelf_id || null, barcode]);

    // Also record in task_scans for chronology
    const scanInsert = await client.query(
      `INSERT INTO inventory_task_scans_s (task_id, product_id, scanned_value, quantity_delta, shelf_id, employee_id)
       VALUES ($1, $2, $3, 1, $4, $5) RETURNING id`,
      [req.params.id, canonicalComponentId, barcode, shelf_id || null, req.user.employee_id || null]);
    await client.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [req.params.id]);

    // Award GRACoin for scan
    const t = task.rows[0];
    await awardScanReward(client, {
      task: { ...t, id: Number(req.params.id) },
      taskScanId: scanInsert.rows[0].id,
      activeTaskBox: null,
      productId: product.id,
      quantityDelta: 1,
      user: req.user,
    });

    await client.query('COMMIT');
    client.release();

    // Return current pick progress
    const progress = await pool.query(
      `SELECT product_id, COUNT(*) as picked FROM assembly_items_s WHERE task_id = $1 GROUP BY product_id`, [req.params.id]);

    res.json({ ok: true, product: product.name, picked_summary: progress.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/start-assembling — Switch to assembly phase ─────────────────
router.post('/:id/start-assembling', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    if (task.rows[0].paused_at) return res.status(400).json({ error: 'Задача на паузе. Дождитесь возобновления администратором.' });
    if (task.rows[0].assembly_phase !== 'picking') return res.status(400).json({ error: 'Задача не в фазе забора' });

    // Verify all components are fully picked
    const comps = await pool.query('SELECT component_id, quantity FROM bundle_components_s WHERE bundle_id = $1', [task.rows[0].bundle_product_id]);
    const picked = await pool.query('SELECT product_id, COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 GROUP BY product_id', [req.params.id]);
    const pickedMap = {};
    picked.rows.forEach(r => { pickedMap[r.product_id] = Number(r.cnt); });

    for (const c of comps.rows) {
      const needed = Number(c.quantity) * task.rows[0].bundle_qty;
      const have = pickedMap[c.component_id] || 0;
      if (have < needed) return res.status(400).json({ error: `Не хватает компонентов: набрано ${have}/${needed}` });
    }

    await pool.query(
      `UPDATE inventory_tasks_s SET assembly_phase = 'assembling' WHERE id = $1`,
      [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/component-status — Current bundle component status ─────────
router.get('/:id/component-status', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const currentBundle = task.rows[0].assembled_count + 1;
    const comps = await pool.query(
      'SELECT component_id, quantity FROM bundle_components_s WHERE bundle_id = $1', [task.rows[0].bundle_product_id]);
    const scanned = await pool.query(
      `SELECT product_id, COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 AND used_in_bundle = $2 GROUP BY product_id`,
      [req.params.id, currentBundle]);
    const scannedMap = {};
    scanned.rows.forEach(r => { scannedMap[r.product_id] = Number(r.cnt); });
    let allDone = true;
    const status = comps.rows.map(c => {
      const needed = Number(c.quantity);
      const have = scannedMap[c.component_id] || 0;
      if (have < needed) allDone = false;
      return { product_id: c.component_id, needed, have, done: have >= needed };
    });
    res.json({ bundle_number: currentBundle, components_status: status, all_components_scanned: allDone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/scan-component — Scan component into current bundle ─────────
router.post('/:id/scan-component', requireAuth, async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ error: 'barcode обязателен' });

  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    if (task.rows[0].paused_at) return res.status(400).json({ error: 'Задача на паузе. Дождитесь возобновления администратором.' });
    if (task.rows[0].assembly_phase !== 'assembling') return res.status(400).json({ error: 'Задача не в фазе сборки' });
    // Check employee break
    if (task.rows[0].employee_id) {
      const ab = await pool.query('SELECT break_type FROM employee_breaks_s WHERE employee_id = $1 AND ended_at IS NULL LIMIT 1', [task.rows[0].employee_id]);
      if (ab.rows.length) { const l = ab.rows[0].break_type === 'lunch' ? 'обеде' : ab.rows[0].break_type === 'rest' ? 'отдыхе' : 'тех. паузе'; return res.status(400).json({ error: `Вы на ${l}. Завершите перерыв` }); }
    }

    const currentBundle = task.rows[0].assembled_count + 1;

    // Check for duplicate scan
    if (barcode.length >= 12) {
      for (let len = 6; len <= Math.floor(barcode.length / 2); len++) {
        const chunk = barcode.substring(0, len);
        if (barcode === chunk.repeat(Math.round(barcode.length / len)) || barcode.startsWith(chunk + chunk)) {
          return res.status(400).json({ error: 'ШК отсканирован несколько раз подряд. Отсканируйте повторно, один раз.', hint: 'duplicate_scan' });
        }
      }
    }

    const product = await resolveProduct(pool, barcode,
      await bundleComponentIds(pool, task.rows[0].bundle_product_id));
    if (!product) return res.status(400).json({ error: 'Товар не найден по ШК' });

    // Check if already scanned enough of this component for current bundle
    const comp = await pool.query(
      'SELECT quantity FROM bundle_components_s WHERE bundle_id = $1 AND component_id = $2',
      [task.rows[0].bundle_product_id, product.id]);
    if (comp.rows.length > 0) {
      const needed = Number(comp.rows[0].quantity);
      const alreadyInBundle = await pool.query(
        `SELECT COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 AND product_id = $2 AND used_in_bundle = $3`,
        [req.params.id, product.id, currentBundle]);
      if (Number(alreadyInBundle.rows[0].cnt) >= needed) {
        return res.status(400).json({ error: `${product.name.replace(/GraFLab,?\s*/i,'').trim()} уже отсканирован. Сканируйте другой компонент.`, hint: 'already_scanned' });
      }
    }

    // Find unused picked item of this product
    const item = await pool.query(
      `SELECT id FROM assembly_items_s WHERE task_id = $1 AND product_id = $2 AND used_in_bundle = 0 LIMIT 1`,
      [req.params.id, product.id]);
    if (!item.rows.length) return res.status(400).json({ error: `Нет забранных ${product.name} — сначала заберите с паллета` });

    // All writes in one transaction
    const scanClient = await pool.connect();
    try {
      await scanClient.query('BEGIN');
      // Mark as used in current bundle
      await scanClient.query('UPDATE assembly_items_s SET used_in_bundle = $1 WHERE id = $2', [currentBundle, item.rows[0].id]);
      // Record scan
      const scanRes = await scanClient.query(
        `INSERT INTO inventory_task_scans_s (task_id, product_id, scanned_value, quantity_delta, employee_id)
         VALUES ($1, $2, $3, 1, $4) RETURNING id`,
        [req.params.id, product.id, barcode, req.user.employee_id || null]);
      await scanClient.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [req.params.id]);
      // Award GRA — non-critical, don't break scan if reward fails
      try {
        await awardScanReward(scanClient, {
          task: task.rows[0], taskScanId: scanRes.rows[0].id,
          productId: product.id, quantityDelta: 1, user: req.user,
        });
      } catch (rewardErr) {
        console.error('awardScanReward error (non-critical):', rewardErr.message);
      }
      await scanClient.query('COMMIT');
    } catch (e) {
      await scanClient.query('ROLLBACK');
      throw e;
    } finally { scanClient.release(); }

    // Check if all components for this bundle are scanned
    const comps = await pool.query(
      'SELECT component_id, quantity FROM bundle_components_s WHERE bundle_id = $1', [task.rows[0].bundle_product_id]);
    const scanned = await pool.query(
      `SELECT product_id, COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 AND used_in_bundle = $2 GROUP BY product_id`,
      [req.params.id, currentBundle]);

    const scannedMap = {};
    scanned.rows.forEach(r => { scannedMap[r.product_id] = Number(r.cnt); });

    let allDone = true;
    const status = comps.rows.map(c => {
      const needed = Number(c.quantity);
      const have = scannedMap[c.component_id] || 0;
      if (have < needed) allDone = false;
      return { product_id: c.component_id, needed, have, done: have >= needed };
    });

    res.json({ ok: true, product: product.name, bundle_number: currentBundle, all_components_scanned: allDone, components_status: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/confirm-bundle — Scan printed barcode of bundle ──────────────
router.post('/:id/confirm-bundle', requireAuth, async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) return res.status(400).json({ error: 'barcode обязателен' });

  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    if (task.rows[0].paused_at) return res.status(400).json({ error: 'Задача на паузе. Дождитесь возобновления администратором.' });
    if (task.rows[0].assembly_phase !== 'assembling') return res.status(400).json({ error: 'Задача не в фазе сборки' });

    // Verify barcode belongs to the bundle product
    const bundle = await pool.query('SELECT * FROM products_s WHERE id = $1', [task.rows[0].bundle_product_id]);
    if (!bundle.rows.length) return res.status(404).json({ error: 'Комплект не найден' });

    const barcodes = (bundle.rows[0].barcode_list || '').split(';').map(s => s.trim()).filter(Boolean);
    if (bundle.rows[0].production_barcode) barcodes.push(bundle.rows[0].production_barcode);
    if (!barcodes.includes(barcode)) return res.status(400).json({ error: 'ШК не совпадает с комплектом' });

    // Verify all components for current bundle are scanned
    const currentBundle = task.rows[0].assembled_count + 1;
    const comps = await pool.query(
      'SELECT component_id, quantity FROM bundle_components_s WHERE bundle_id = $1', [task.rows[0].bundle_product_id]);
    const scanned = await pool.query(
      `SELECT product_id, COUNT(*) as cnt FROM assembly_items_s WHERE task_id = $1 AND used_in_bundle = $2 GROUP BY product_id`,
      [req.params.id, currentBundle]);
    const scannedMap = {};
    scanned.rows.forEach(r => { scannedMap[r.product_id] = Number(r.cnt); });
    for (const c of comps.rows) {
      const needed = Number(c.quantity);
      const have = scannedMap[c.component_id] || 0;
      if (have < needed) {
        return res.status(400).json({ error: `Не все компоненты отсканированы для комплекта №${currentBundle}. Отсканируйте все компоненты` });
      }
    }

    const newCount = currentBundle;
    const phase = newCount >= task.rows[0].bundle_qty ? 'placing' : 'assembling';

    await pool.query(
      'UPDATE inventory_tasks_s SET assembled_count = $1, assembly_phase = $2 WHERE id = $3',
      [newCount, phase, req.params.id]);

    res.json({ ok: true, assembled_count: newCount, total: task.rows[0].bundle_qty, phase });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/start-placing — Switch to placing phase ──────────────────────
router.post('/:id/start-placing', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'UPDATE inventory_tasks_s SET assembly_phase = $1 WHERE id = $2', ['placing', req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/scan-place — Place assembled bundle on shelf/pallet/box ──────
router.post('/:id/scan-place', requireAuth, async (req, res) => {
  const { shelf_id, pallet_id, box_id, barcode } = req.body;
  if (!shelf_id && !pallet_id && !box_id) return res.status(400).json({ error: 'Сначала выберите место размещения (полку, паллет или коробку)' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Задача не найдена' }); }

    if (task.rows[0].paused_at) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ error: 'Задача на паузе. Дождитесь возобновления администратором.' });
    }
    if (task.rows[0].assembly_phase !== 'placing') {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ error: 'Задача не в фазе размещения' });
    }
    // Check employee break
    if (task.rows[0].employee_id) {
      const ab = await client.query('SELECT break_type FROM employee_breaks_s WHERE employee_id = $1 AND ended_at IS NULL LIMIT 1', [task.rows[0].employee_id]);
      if (ab.rows.length) { const l = ab.rows[0].break_type === 'lunch' ? 'обеде' : ab.rows[0].break_type === 'rest' ? 'отдыхе' : 'тех. паузе'; await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: `Вы на ${l}. Завершите перерыв` }); }
    }

    if (task.rows[0].placed_count >= task.rows[0].bundle_qty) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ error: 'Все комплекты уже размещены' });
    }

    const productId = task.rows[0].bundle_product_id;

    // Verify scanned barcode belongs to bundle product
    if (!barcode) { await client.query('ROLLBACK'); client.release(); return res.status(400).json({ error: 'Отсканируйте ШК комплекта' }); }
    const product = await resolveProduct(client, barcode, [productId]);
    if (!product || product.id !== productId) {
      await client.query('ROLLBACK'); client.release();
      return res.status(400).json({ error: 'ШК не соответствует комплекту. Сканируйте ШК собранного комплекта' });
    }

    if (box_id) {
      // Detect shelf_box vs pallet box
      const isShelfBox = await client.query('SELECT id FROM shelf_boxes_s WHERE id = $1', [box_id]);
      if (isShelfBox.rows.length) {
        const ex = await client.query('SELECT id FROM shelf_box_items_s WHERE shelf_box_id=$1 AND product_id=$2', [box_id, productId]);
        if (ex.rows.length) {
          await client.query('UPDATE shelf_box_items_s SET quantity = quantity + 1, updated_at=NOW() WHERE shelf_box_id=$1 AND product_id=$2', [box_id, productId]);
        } else {
          await client.query('INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at) VALUES ($1,$2,1,NOW())', [box_id, productId]);
        }
        await client.query('UPDATE shelf_boxes_s SET quantity = quantity + 1 WHERE id = $1', [box_id]);
      } else {
        const existing = await client.query('SELECT id FROM box_items_s WHERE box_id=$1 AND product_id=$2', [box_id, productId]);
        if (existing.rows.length) {
          await client.query('UPDATE box_items_s SET quantity = quantity + 1 WHERE box_id=$1 AND product_id=$2', [box_id, productId]);
        } else {
          await client.query('INSERT INTO box_items_s (box_id, product_id, quantity) VALUES ($1,$2,1)', [box_id, productId]);
        }
        await client.query('UPDATE boxes_s SET quantity = quantity + 1 WHERE id=$1', [box_id]);
      }
    } else if (shelf_id) {
      // Россыпь отключена — но оставим для обратной совместимости
      const existing = await client.query('SELECT id, quantity FROM shelf_items_s WHERE shelf_id = $1 AND product_id = $2', [shelf_id, productId]);
      if (existing.rows.length) {
        await client.query('UPDATE shelf_items_s SET quantity = quantity + 1 WHERE id = $1', [existing.rows[0].id]);
      } else {
        await client.query('INSERT INTO shelf_items_s (shelf_id, product_id, quantity) VALUES ($1, $2, 1)', [shelf_id, productId]);
      }
    } else if (pallet_id) {
      const existing = await client.query('SELECT id, quantity FROM pallet_items_s WHERE pallet_id = $1 AND product_id = $2', [pallet_id, productId]);
      if (existing.rows.length) {
        await client.query('UPDATE pallet_items_s SET quantity = quantity + 1 WHERE id = $1', [existing.rows[0].id]);
      } else {
        await client.query('INSERT INTO pallet_items_s (pallet_id, product_id, quantity) VALUES ($1, $2, 1)', [pallet_id, productId]);
      }
    }

    // Log movement
    // box_id может быть shelf_box (полочная коробка, FK shelf_boxes_s) или
    // pallet box (FK boxes_s). Они кладутся в РАЗНЫЕ колонки movements_s,
    // иначе FK violation. Поэтому сначала определяем тип.
    let toShelfBoxId = null, toPalletBoxId = null, computedShelfId = shelf_id || null, computedPalletId = pallet_id || null;
    if (box_id) {
      const sb = await client.query('SELECT shelf_id FROM shelf_boxes_s WHERE id = $1', [box_id]);
      if (sb.rows.length) {
        // Полочная коробка
        toShelfBoxId = box_id;
        if (!computedShelfId) computedShelfId = sb.rows[0].shelf_id || null;
      } else {
        const pb = await client.query('SELECT pallet_id FROM boxes_s WHERE id = $1', [box_id]);
        if (pb.rows.length) {
          toPalletBoxId = box_id;
          if (!computedPalletId) computedPalletId = pb.rows[0].pallet_id || null;
        }
      }
    }
    await client.query(
      `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, to_pallet_id, to_box_id, to_shelf_box_id, performed_by, source, notes)
       VALUES ('bundle_place', $1, 1, $2, $3, $4, $5, $6, 'task', $7)`,
      [productId, computedShelfId, computedPalletId, toPalletBoxId, toShelfBoxId, req.user.id, `task:${req.params.id}`]);

    // Record scan and award GRA for placement
    const placeScan = await client.query(
      `INSERT INTO inventory_task_scans_s (task_id, product_id, scanned_value, quantity_delta, employee_id)
       VALUES ($1, $2, $3, 1, $4) RETURNING id`,
      [req.params.id, productId, barcode, req.user.employee_id || null]);
    await client.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [req.params.id]);
    await awardScanReward(client, {
      task: task.rows[0], taskScanId: placeScan.rows[0].id,
      productId, quantityDelta: 1, user: req.user,
    });

    const newPlaced = task.rows[0].placed_count + 1;
    const phase = newPlaced >= task.rows[0].bundle_qty ? 'completed' : 'placing';
    const status = phase === 'completed' ? 'completed' : 'in_progress';

    await client.query(
      'UPDATE inventory_tasks_s SET placed_count = $1, assembly_phase = $2, status = $3 WHERE id = $4',
      [newPlaced, phase, status, req.params.id]);

    if (phase === 'completed') {
      await client.query('UPDATE inventory_tasks_s SET completed_at = NOW() WHERE id = $1', [req.params.id]);
    }

    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, placed_count: newPlaced, total: task.rows[0].bundle_qty, phase });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /:id/complete — Complete (with validation) ────────────────────────
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const task = await pool.query(
      'SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2',
      [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    const t = task.rows[0];
    if (t.placed_count < t.bundle_qty) {
      return res.status(400).json({
        error: `Размещено ${t.placed_count}/${t.bundle_qty} комплектов. Завершите размещение`
      });
    }

    await pool.query(
      `UPDATE inventory_tasks_s SET status = 'completed', assembly_phase = 'completed', completed_at = NOW()
       WHERE id = $1 AND task_type = 'bundle_assembly'`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /:id — Delete task and rollback all picks ────────────────────────
router.delete('/:id', requireAuth, requirePermission('tasks.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 AND task_type = $2', [req.params.id, 'bundle_assembly']);
    if (!task.rows.length) { await client.query('ROLLBACK'); client.release(); return res.status(404).json({ error: 'Задача не найдена' }); }

    // Rollback: return all picked items back to their source boxes/shelves
    const items = await client.query('SELECT * FROM assembly_items_s WHERE task_id = $1', [req.params.id]);
    for (const item of items.rows) {
      if (item.source_box_id) {
        const existing = await client.query('SELECT id FROM box_items_s WHERE box_id = $1 AND product_id = $2', [item.source_box_id, item.product_id]);
        if (existing.rows.length) {
          await client.query('UPDATE box_items_s SET quantity = quantity + $1 WHERE box_id = $2 AND product_id = $3',
            [Number(item.quantity), item.source_box_id, item.product_id]);
        } else {
          await client.query('INSERT INTO box_items_s (box_id, product_id, quantity) VALUES ($1, $2, $3)',
            [item.source_box_id, item.product_id, Number(item.quantity)]);
        }
      } else if (item.source_shelf_id) {
        const existing = await client.query('SELECT id FROM shelf_items_s WHERE shelf_id = $1 AND product_id = $2', [item.source_shelf_id, item.product_id]);
        if (existing.rows.length) {
          await client.query('UPDATE shelf_items_s SET quantity = quantity + $1 WHERE shelf_id = $2 AND product_id = $3',
            [Number(item.quantity), item.source_shelf_id, item.product_id]);
        } else {
          await client.query('INSERT INTO shelf_items_s (shelf_id, product_id, quantity) VALUES ($1, $2, $3)',
            [item.source_shelf_id, item.product_id, Number(item.quantity)]);
        }
      } else if (item.source_pallet_id) {
        const existing = await client.query('SELECT id FROM pallet_items_s WHERE pallet_id = $1 AND product_id = $2', [item.source_pallet_id, item.product_id]);
        if (existing.rows.length) {
          await client.query('UPDATE pallet_items_s SET quantity = quantity + $1 WHERE pallet_id = $2 AND product_id = $3',
            [Number(item.quantity), item.source_pallet_id, item.product_id]);
        } else {
          await client.query('INSERT INTO pallet_items_s (pallet_id, product_id, quantity) VALUES ($1, $2, $3)',
            [item.source_pallet_id, item.product_id, Number(item.quantity)]);
        }
      }
    }

    // Rollback: remove any placed bundles from shelves/pallets
    if (task.rows[0].placed_count > 0) {
      const bundleProductId = task.rows[0].bundle_product_id;
      const placed = task.rows[0].placed_count;
      // Remove from movements and reverse shelf/pallet additions
      const placements = await client.query(
        `SELECT to_shelf_id, to_pallet_id, to_box_id, to_shelf_box_id, SUM(quantity) as qty FROM movements_s
         WHERE product_id = $1 AND movement_type = 'bundle_place' AND source = 'task'
           AND notes LIKE $2
         GROUP BY to_shelf_id, to_pallet_id, to_box_id, to_shelf_box_id`, [bundleProductId, `task:${req.params.id}`]);
      for (const p of placements.rows) {
        if (p.to_shelf_box_id) {
          await client.query('UPDATE shelf_box_items_s SET quantity = GREATEST(0, quantity - $1) WHERE shelf_box_id = $2 AND product_id = $3',
            [Number(p.qty), p.to_shelf_box_id, bundleProductId]);
          await client.query('UPDATE shelf_boxes_s SET quantity = GREATEST(0, quantity - $1) WHERE id = $2',
            [Number(p.qty), p.to_shelf_box_id]);
        } else if (p.to_box_id) {
          await client.query('UPDATE box_items_s SET quantity = GREATEST(0, quantity - $1) WHERE box_id = $2 AND product_id = $3',
            [Number(p.qty), p.to_box_id, bundleProductId]);
          await client.query('UPDATE boxes_s SET quantity = GREATEST(0, quantity - $1) WHERE id = $2',
            [Number(p.qty), p.to_box_id]);
        } else if (p.to_shelf_id) {
          await client.query('UPDATE shelf_items_s SET quantity = GREATEST(0, quantity - $1) WHERE shelf_id = $2 AND product_id = $3',
            [Number(p.qty), p.to_shelf_id, bundleProductId]);
        } else if (p.to_pallet_id) {
          await client.query('UPDATE pallet_items_s SET quantity = GREATEST(0, quantity - $1) WHERE pallet_id = $2 AND product_id = $3',
            [Number(p.qty), p.to_pallet_id, bundleProductId]);
        }
      }
    }

    // Delete assembly items and task
    await client.query('DELETE FROM assembly_items_s WHERE task_id = $1', [req.params.id]);
    await client.query('DELETE FROM inventory_tasks_s WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, message: 'Задача удалена, все перемещения откачены' });
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { awardScanReward } = require('./tasks');

// Generate unique box barcode (digits only)
function genBoxBarcode() {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${ts}${rand}`;
}

// GET /api/packing/:taskId — task state for packaging UI
router.get('/:taskId', requireAuth, async (req, res) => {
  try {
    const task = await pool.query(`
      SELECT t.*,
             p.name as product_name, p.code as product_code,
             p.production_barcode, p.barcode_list,
             pa.name as pallet_name, pa.number as pallet_number,
             pa.barcode_value as pallet_barcode,
             pr.name as row_name, pr.number as row_number,
             w.name as warehouse_name,
             e.full_name as employee_name
      FROM inventory_tasks_s t
      LEFT JOIN products_s p ON p.id = t.product_id
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      LEFT JOIN warehouses_s w ON w.id = pr.warehouse_id
      LEFT JOIN employees_s e ON e.id = t.employee_id
      WHERE t.id = $1 AND t.task_type = 'packaging'
    `, [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    const t = task.rows[0];
    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    // Current open box
    const openBox = await pool.query(
      `SELECT * FROM boxes_s WHERE task_id = $1 AND status = 'open' ORDER BY created_at DESC LIMIT 1`,
      [req.params.taskId]
    );

    // Stats
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'closed') as closed_boxes,
        COALESCE(SUM(quantity) FILTER (WHERE status = 'closed'), 0) as closed_qty,
        COALESCE(SUM(quantity), 0) as total_qty
      FROM boxes_s WHERE task_id = $1
    `, [req.params.taskId]);

    res.json({
      task: t,
      open_box: openBox.rows[0] || null,
      stats: stats.rows[0],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/start — start packaging task (requires pallet scan)
router.post('/:taskId/start', requireAuth, async (req, res) => {
  const { pallet_barcode } = req.body;
  try {
    const task = await pool.query(`
      SELECT t.*, pa.barcode_value as pallet_barcode_expected,
             pa.number as pallet_number, pr.number as row_number
      FROM inventory_tasks_s t
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE t.id=$1 AND t.task_type='packaging'
    `, [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];
    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (t.status !== 'new') return res.status(400).json({ error: 'Задача уже начата' });

    // Validate pallet barcode
    if (t.target_pallet_id) {
      if (!pallet_barcode?.trim()) {
        return res.status(400).json({ error: 'Отсканируйте штрих-код паллета' });
      }
      if (t.pallet_barcode_expected !== pallet_barcode.trim()) {
        return res.status(400).json({
          error: `Неверный паллет. Вам нужен паллет Р${t.row_number}П${t.pallet_number}`,
          expected: `Р${t.row_number}П${t.pallet_number}`
        });
      }
    }

    await pool.query('UPDATE inventory_tasks_s SET status=\'in_progress\', started_at=NOW() WHERE id=$1', [req.params.taskId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/open-box — create a new box
router.post('/:taskId/open-box', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'', [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];
    if (t.status !== 'in_progress') return res.status(400).json({ error: 'Сначала начните задачу' });

    const existing = await pool.query('SELECT id FROM boxes_s WHERE task_id=$1 AND status=\'open\'', [req.params.taskId]);
    if (existing.rows.length) return res.status(400).json({ error: 'Уже есть открытая коробка' });

    const barcode = genBoxBarcode();
    const result = await pool.query(
      `INSERT INTO boxes_s (barcode_value, product_id, pallet_id, task_id, quantity, box_size, status, confirmed)
       VALUES ($1,$2,$3,$4,0,$5,'open',false) RETURNING *`,
      [barcode, t.product_id, t.target_pallet_id, t.id, t.box_size || 50]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/reuse-box — scan existing (partial) box to continue filling it
router.post('/:taskId/reuse-box', requireAuth, async (req, res) => {
  const { box_barcode } = req.body;
  if (!box_barcode?.trim()) return res.status(400).json({ error: 'Отсканируйте штрих-код коробки' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const taskRes = await client.query(
      'SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'',
      [req.params.taskId]
    );
    if (!taskRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = taskRes.rows[0];
    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (t.status !== 'in_progress') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Сначала начните задачу' }); }

    const alreadyOpen = await client.query(
      'SELECT id FROM boxes_s WHERE task_id=$1 AND status=\'open\'',
      [req.params.taskId]
    );
    if (alreadyOpen.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Уже есть открытая коробка' }); }

    const boxRes = await client.query('SELECT * FROM boxes_s WHERE barcode_value=$1', [box_barcode.trim()]);
    if (!boxRes.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Коробка с таким штрих-кодом не найдена' }); }
    const b = boxRes.rows[0];

    if (t.product_id && b.product_id && b.product_id !== t.product_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В этой коробке другой товар — сканируйте коробку с нужным товаром или откройте новую' });
    }

    const boxSize = b.box_size || t.box_size || 50;
    if (parseInt(b.quantity) >= parseInt(boxSize)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Коробка уже заполнена — откройте новую' });
    }

    if (b.status === 'open' && b.task_id && b.task_id !== parseInt(req.params.taskId)) {
      const other = await client.query('SELECT status FROM inventory_tasks_s WHERE id=$1', [b.task_id]);
      if (other.rows.length && other.rows[0].status === 'in_progress') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Эта коробка уже используется в другой активной задаче' });
      }
    }

    if (b.is_remainder && parseInt(b.quantity) > 0 && b.product_id) {
      const delta = parseInt(b.quantity);
      if (b.remainder_shelf_box_id) {
        // Остаток хранится внутри коробки на полке ФБС — списываем оттуда
        const cur = await client.query(
          'SELECT quantity FROM shelf_box_items_s WHERE shelf_box_id=$1 AND product_id=$2',
          [b.remainder_shelf_box_id, b.product_id]
        );
        const prevQty = cur.rows.length ? parseFloat(cur.rows[0].quantity) : 0;
        const newQty = Math.max(0, prevQty - delta);
        if (newQty <= 0) {
          await client.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id=$1 AND product_id=$2', [b.remainder_shelf_box_id, b.product_id]);
        } else {
          await client.query('UPDATE shelf_box_items_s SET quantity=$1, updated_at=NOW() WHERE shelf_box_id=$2 AND product_id=$3',
            [newQty, b.remainder_shelf_box_id, b.product_id]);
        }
        await client.query('UPDATE shelf_boxes_s SET quantity = GREATEST(0, quantity - $1) WHERE id=$2', [delta, b.remainder_shelf_box_id]);
        if (b.remainder_shelf_id) {
          const shelfTotalRes = await client.query(
            `SELECT COALESCE(SUM(sbi.quantity),0) AS qty
               FROM shelf_boxes_s sb
               JOIN shelf_box_items_s sbi ON sbi.shelf_box_id = sb.id
              WHERE sb.shelf_id = $1 AND sbi.product_id = $2`,
            [b.remainder_shelf_id, b.product_id]
          );
          const newShelfQty = parseFloat(shelfTotalRes.rows[0].qty || 0);
          await client.query(
            `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id, notes)
             VALUES ($1,$2,'stock_out',$3,$4,$5,$6,$7,$8)`,
            [b.remainder_shelf_id, b.product_id, newShelfQty + delta, newShelfQty, -delta, req.user.id, req.params.taskId, 'Реюз коробки из остатка']
          );
        }
      } else if (b.remainder_shelf_id) {
        // Легаси: остаток был положен россыпью на полку
        const cur = await client.query(
          'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
          [b.remainder_shelf_id, b.product_id]
        );
        const prevQty = cur.rows.length ? parseFloat(cur.rows[0].quantity) : 0;
        const newQty = Math.max(0, prevQty - delta);
        if (cur.rows.length) {
          await client.query(
            'UPDATE shelf_items_s SET quantity=$1, updated_by=$2, updated_at=NOW() WHERE shelf_id=$3 AND product_id=$4',
            [newQty, req.user.id, b.remainder_shelf_id, b.product_id]
          );
        }
        await client.query(
          `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id)
           VALUES ($1,$2,'stock_out',$3,$4,$5,$6,$7)`,
          [b.remainder_shelf_id, b.product_id, prevQty, newQty, -delta, req.user.id, req.params.taskId]
        );
      }
    }

    const prodId = b.product_id || t.product_id;
    const result = await client.query(
      `UPDATE boxes_s SET
         status='open',
         confirmed=true,
         is_remainder=false,
         remainder_shelf_id=NULL,
         remainder_shelf_box_id=NULL,
         closed_at=NULL,
         task_id=$2,
         pallet_id=$3,
         product_id=$4,
         box_size=$5
       WHERE id=$1 RETURNING *`,
      [b.id, req.params.taskId, t.target_pallet_id, prodId, boxSize]
    );

    await client.query('COMMIT');
    res.json({ success: true, box: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/packing/:taskId/confirm-box — employee scans box label to confirm
router.post('/:taskId/confirm-box', requireAuth, async (req, res) => {
  const { scanned_barcode } = req.body;
  if (!scanned_barcode) return res.status(400).json({ error: 'scanned_barcode обязателен' });
  try {
    const box = await pool.query(
      'SELECT * FROM boxes_s WHERE task_id=$1 AND status=\'open\' ORDER BY created_at DESC LIMIT 1',
      [req.params.taskId]
    );
    if (!box.rows.length) return res.status(404).json({ error: 'Нет открытой коробки' });
    const b = box.rows[0];
    if (b.barcode_value !== scanned_barcode.trim()) {
      return res.status(400).json({ error: 'Штрих-код не совпадает. Проверьте наклейку на коробке.' });
    }
    await pool.query('UPDATE boxes_s SET confirmed=true WHERE id=$1', [b.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/scan — scan item into current open confirmed box
router.post('/:taskId/scan', requireAuth, async (req, res) => {
  const { scanned_value } = req.body;
  if (!scanned_value) return res.status(400).json({ error: 'scanned_value обязателен' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'', [req.params.taskId]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];
    if (t.status !== 'in_progress') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Задача не в работе' }); }

    const product = await client.query(
      `SELECT id, name, code, production_barcode, barcode_list
       FROM products_s
       WHERE $1 = ANY(string_to_array(barcode_list, ';'))
          OR production_barcode = $1
          OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
       ORDER BY id
       LIMIT 1`,
      [scanned_value]
    );
    if (!product.rows.length) {
      // Smart scan error classification
      const val = scanned_value;
      const hasCyrillic = /[а-яА-ЯёЁ]/.test(val);
      const isUrl = /^https?:\/\//i.test(val);
      let deduped = null;
      if (!hasCyrillic && !isUrl && val.length >= 12) {
        for (let len = 6; len <= Math.floor(val.length / 2); len++) {
          const chunk = val.substring(0, len);
          if (val === chunk.repeat(Math.round(val.length / len)) || val.startsWith(chunk + chunk)) { deduped = chunk; break; }
        }
      }
      const isPartial = !hasCyrillic && !isUrl && !deduped && /^\d+$/.test(val) && val.length < 6;

      if (hasCyrillic) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, event: 'hint', hint: 'keyboard_layout',
          error: 'Переключите раскладку клавиатуры на английскую (EN) и попробуйте ещё раз' });
      }
      if (isUrl) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, event: 'hint', hint: 'url_scanned',
          error: 'Вы отсканировали QR-код с ссылкой на сайт. Сканируйте штрих-код на упаковке товара — он с цифрами' });
      }
      if (deduped) {
        // Try to find by single copy
        const retry = await client.query(
          `SELECT id, name, code, production_barcode, barcode_list FROM products_s
           WHERE $1 = ANY(string_to_array(barcode_list, ';')) OR production_barcode = $1
              OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1)) ORDER BY id LIMIT 1`,
          [deduped]
        );
        if (retry.rows.length) {
          // Found by deduped barcode — continue with corrected product
          product.rows[0] = retry.rows[0];
        } else {
          await client.query('ROLLBACK');
          return res.json({ ok: false, event: 'hint', hint: 'duplicate_scan',
            error: 'Штрих-код считался несколько раз. Товар не найден по коду ' + deduped });
        }
      } else if (isPartial) {
        await client.query('ROLLBACK');
        return res.json({ ok: false, event: 'hint', hint: 'partial_scan',
          error: 'Штрих-код считался не полностью. Поднесите сканер ровнее и попробуйте ещё раз' });
      } else {
        // Regular unknown barcode
        await client.query(
          `INSERT INTO scan_errors_s (task_id, scanned_value, user_id, employee_note)
           VALUES ($1, $2, $3, 'Товар не найден при оприходовании')`,
          [req.params.taskId, scanned_value, req.user.id]
        ).catch(() => {});
        await client.query('ROLLBACK');
        return res.json({ ok: false, error: 'Товар не найден', event: 'not_found' });
      }
    }
    const prod = product.rows[0];
    if (t.product_id && prod.id !== t.product_id) {
      await client.query(
        `INSERT INTO scan_errors_s (task_id, scanned_value, user_id, employee_note)
         VALUES ($1, $2, $3, $4)`,
        [req.params.taskId, scanned_value, req.user.id, `Неверный товар: отсканирован "${prod.name}"`]
      ).catch(() => {});
      await client.query('ROLLBACK');
      return res.json({ ok: false, error: `Неверный товар. Ожидается другой товар.`, event: 'wrong_product', scanned_product: prod.name });
    }

    const boxRes = await client.query(
      'SELECT * FROM boxes_s WHERE task_id=$1 AND status=\'open\' AND confirmed=true ORDER BY created_at DESC LIMIT 1',
      [req.params.taskId]
    );
    if (!boxRes.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ ok: false, error: 'Коробка не подтверждена. Отсканируйте наклейку на коробке.', event: 'no_box' });
    }

    const box = boxRes.rows[0];
    const newQty = box.quantity + 1;

    await client.query('UPDATE boxes_s SET quantity=$1 WHERE id=$2', [newQty, box.id]);

    // Синхронно ведём box_items_s — иначе сборка/перемещения не увидят содержимое
    // свежесозданной коробки и выдадут "В этой коробке закончился товар".
    await client.query(
      `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (box_id, product_id)
       DO UPDATE SET quantity = box_items_s.quantity + 1, updated_at = NOW()`,
      [box.id, prod.id]
    );

    // Log scan to inventory_task_scans_s for analytics/timing
    const scanInsert = await client.query(
      'INSERT INTO inventory_task_scans_s (task_id, product_id, scanned_value, quantity_delta, employee_id) VALUES ($1,$2,$3,1,$4) RETURNING id',
      [t.id, prod.id, scanned_value, req.user.employee_id || null]
    );
    await client.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [t.id]);

    // Award GRACoin for scan
    await awardScanReward(client, {
      task: t,
      taskScanId: scanInsert.rows[0].id,
      activeTaskBox: { id: null, box_id: box.id, shelf_box_id: null },
      productId: prod.id,
      quantityDelta: 1,
      user: req.user,
    });

    await client.query('COMMIT');
    return res.json({ ok: true, event: 'scan', box_qty: newQty, box_size: box.box_size, product_name: prod.name });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/packing/:taskId/close-box — employee puts box on pallet, scans pallet to confirm
router.post('/:taskId/close-box', requireAuth, async (req, res) => {
  const { pallet_barcode } = req.body;
  try {
    const task = await pool.query(`
      SELECT t.*, pa.barcode_value as pallet_barcode_expected,
             pa.number as pallet_number, pr.number as row_number
      FROM inventory_tasks_s t
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE t.id=$1 AND t.task_type='packaging'
    `, [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];

    // Validate pallet barcode
    if (t.target_pallet_id) {
      if (!pallet_barcode?.trim()) return res.status(400).json({ error: 'Отсканируйте штрих-код паллета' });
      if (t.pallet_barcode_expected !== pallet_barcode.trim()) {
        return res.status(400).json({
          error: `Неверный паллет. Вам нужен паллет Р${t.row_number}П${t.pallet_number}`,
          expected: `Р${t.row_number}П${t.pallet_number}`
        });
      }
    }

    await pool.query(
      `UPDATE boxes_s SET status='closed', closed_at=NOW() WHERE task_id=$1 AND status='open'`,
      [req.params.taskId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/close-remainder — остаток: закрыть коробку и положить в коробку на полке ФБС
// Принимает box_barcode (новый флоу — кладём в коробку) или shelf_barcode (старый флоу — россыпью).
router.post('/:taskId/close-remainder', requireAuth, async (req, res) => {
  const { box_barcode, shelf_barcode } = req.body;
  const scanBox = (box_barcode || '').trim();
  const scanShelf = (shelf_barcode || '').trim();
  if (!scanBox && !scanShelf) return res.status(400).json({ error: 'Отсканируйте штрих-код коробки' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const task = await client.query(
      'SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'',
      [req.params.taskId]
    );
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];

    // Get open box quantity
    const openBoxRes = await client.query(
      'SELECT * FROM boxes_s WHERE task_id=$1 AND status=\'open\' ORDER BY created_at DESC LIMIT 1',
      [req.params.taskId]
    );
    const boxQty = openBoxRes.rows.length ? parseInt(openBoxRes.rows[0].quantity) : 0;

    let shelf = null;
    let shelfBox = null;

    if (scanBox) {
      // Новый флоу: остаток → коробка на полке ФБС
      const sbRes = await client.query(
        `SELECT sb.*, s.id AS shelf_id, s.code AS shelf_code, s.name AS shelf_name, s.barcode_value AS shelf_barcode,
                r.name AS rack_name, w.warehouse_type
         FROM shelf_boxes_s sb
         JOIN shelves_s s ON s.id = sb.shelf_id
         JOIN racks_s r ON r.id = s.rack_id
         JOIN warehouses_s w ON w.id = r.warehouse_id
         WHERE sb.barcode_value = $1`,
        [scanBox]
      );
      if (!sbRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Коробка с таким штрих-кодом не найдена' });
      }
      shelfBox = sbRes.rows[0];
      if (!['fbs', 'both', 'visual'].includes(shelfBox.warehouse_type)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Коробка не на складе ФБС' });
      }
      if (shelfBox.product_id && t.product_id && shelfBox.product_id !== t.product_id) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'В этой коробке другой товар — отсканируйте коробку с нужным товаром' });
      }
      shelf = { id: shelfBox.shelf_id, code: shelfBox.shelf_code, name: shelfBox.shelf_name };

      if (boxQty > 0 && t.product_id) {
        // Обновить содержимое коробки на полке
        await client.query(
          `INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (shelf_box_id, product_id)
           DO UPDATE SET quantity = shelf_box_items_s.quantity + $3, updated_at = NOW()`,
          [shelfBox.id, t.product_id, boxQty]
        );
        await client.query(
          `UPDATE shelf_boxes_s
             SET quantity = quantity + $1,
                 product_id = COALESCE(product_id, $2),
                 status = 'closed',
                 confirmed = true
           WHERE id = $3`,
          [boxQty, t.product_id, shelfBox.id]
        );
        // Лог движения — на уровне полки, чтобы шкала/аналитика видели приход
        const shelfTotalRes = await client.query(
          `SELECT COALESCE(SUM(sbi.quantity),0) AS qty
             FROM shelf_boxes_s sb
             JOIN shelf_box_items_s sbi ON sbi.shelf_box_id = sb.id
            WHERE sb.shelf_id = $1 AND sbi.product_id = $2`,
          [shelfBox.shelf_id, t.product_id]
        );
        const newShelfQty = parseFloat(shelfTotalRes.rows[0].qty || 0);
        await client.query(
          `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id, notes)
           VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7,$8)`,
          [shelfBox.shelf_id, t.product_id, Math.max(0, newShelfQty - boxQty), newShelfQty, boxQty, req.user.id, req.params.taskId, `Остаток в коробке ${shelfBox.barcode_value}`]
        );
      }
    } else {
      // Старый флоу (fallback): россыпью на полку
      const shelfRes = await client.query(
        `SELECT s.*, r.name as rack_name FROM shelves_s s
         JOIN racks_s r ON r.id = s.rack_id
         WHERE s.barcode_value = $1`,
        [scanShelf]
      );
      if (!shelfRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Полка с таким штрих-кодом не найдена' });
      }
      shelf = shelfRes.rows[0];

      if (boxQty > 0 && t.product_id) {
        const current = await client.query(
          'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
          [shelf.id, t.product_id]
        );
        const prevQty = current.rows.length ? parseFloat(current.rows[0].quantity) : 0;
        const newQty = prevQty + boxQty;

        await client.query(
          `INSERT INTO shelf_items_s (shelf_id, product_id, quantity, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (shelf_id, product_id) DO UPDATE SET quantity=$3, updated_by=$4, updated_at=NOW()`,
          [shelf.id, t.product_id, newQty, req.user.id]
        );
        await client.query(
          `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id)
           VALUES ($1,$2,'stock_in',$3,$4,$5,$6,$7)`,
          [shelf.id, t.product_id, prevQty, newQty, boxQty, req.user.id, req.params.taskId]
        );
      }
    }

    // Close all open boxes (mark as remainder) and complete task
    await client.query(
      `UPDATE boxes_s SET status='closed', closed_at=NOW(), is_remainder=true,
                         remainder_shelf_id=$2, remainder_shelf_box_id=$3
       WHERE task_id=$1 AND status='open'`,
      [req.params.taskId, shelf.id, shelfBox ? shelfBox.id : null]
    );
    await client.query(
      `UPDATE inventory_tasks_s SET status='completed', completed_at=NOW(), packing_phase='done' WHERE id=$1`,
      [req.params.taskId]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      shelf_code: shelf.code,
      qty: boxQty,
      shelf_box_barcode: shelfBox ? shelfBox.barcode_value : null,
      shelf_box_name: shelfBox ? (shelfBox.name || `Коробка ${shelfBox.barcode_value}`) : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/packing/:taskId/complete — complete packaging task
router.post('/:taskId/complete', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'', [req.params.taskId]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];
    if (t.status !== 'in_progress') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Задача не в работе' }); }

    await client.query(`UPDATE boxes_s SET status='closed', closed_at=NOW() WHERE task_id=$1 AND status='open'`, [req.params.taskId]);
    await client.query(
      `UPDATE inventory_tasks_s SET status='completed', completed_at=NOW(), packing_phase='done' WHERE id=$1`,
      [req.params.taskId]
    );
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// GET /api/packing/:taskId/remainder-shelf
router.get('/:taskId/remainder-shelf', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'', [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];
    if (!t.product_id) return res.json({ shelf: null });

    const existing = await pool.query(`
      SELECT si.shelf_id, si.quantity, s.code as shelf_code, s.name as shelf_name,
             s.barcode_value, r.name as rack_name, w.name as warehouse_name, w.id as warehouse_id
      FROM shelf_items_s si
      JOIN shelves_s s ON s.id = si.shelf_id
      JOIN racks_s r ON r.id = s.rack_id
      JOIN warehouses_s w ON w.id = r.warehouse_id
      WHERE si.product_id = $1 AND si.quantity > 0 AND w.warehouse_type IN ('fbs','both')
      ORDER BY si.quantity DESC LIMIT 1
    `, [t.product_id]);

    if (existing.rows.length) return res.json({ shelf: existing.rows[0] });

    const freeShelf = await pool.query(`
      SELECT s.id as shelf_id, s.code as shelf_code, s.name as shelf_name,
             s.barcode_value, r.name as rack_name, w.name as warehouse_name, w.id as warehouse_id
      FROM shelves_s s
      JOIN racks_s r ON r.id = s.rack_id
      JOIN warehouses_s w ON w.id = r.warehouse_id
      WHERE w.warehouse_type IN ('fbs','both')
        AND s.id NOT IN (SELECT shelf_id FROM shelf_items_s WHERE quantity > 0)
      ORDER BY s.code LIMIT 1
    `);
    res.json({ shelf: freeShelf.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/packing/:taskId/remainder-box — рекомендуемая коробка на полке ФБС для остатка
router.get('/:taskId/remainder-box', requireAuth, async (req, res) => {
  try {
    const task = await pool.query('SELECT * FROM inventory_tasks_s WHERE id=$1 AND task_type=\'packaging\'', [req.params.taskId]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];
    if (!t.product_id) return res.json({ box: null });

    // 1) Коробка с тем же товаром на полке ФБС (максимальное количество)
    const withProduct = await pool.query(`
      SELECT sb.id AS shelf_box_id, sb.barcode_value AS box_barcode, sb.name AS box_name,
             sb.quantity AS box_quantity, sb.box_size,
             s.id AS shelf_id, s.code AS shelf_code, s.name AS shelf_name, s.barcode_value AS shelf_barcode,
             r.name AS rack_name, w.name AS warehouse_name, w.id AS warehouse_id
      FROM shelf_boxes_s sb
      JOIN shelves_s s ON s.id = sb.shelf_id
      JOIN racks_s r ON r.id = s.rack_id
      JOIN warehouses_s w ON w.id = r.warehouse_id
      WHERE sb.product_id = $1
        AND w.warehouse_type IN ('fbs','both','visual')
      ORDER BY sb.quantity DESC LIMIT 1
    `, [t.product_id]);
    if (withProduct.rows.length) return res.json({ box: withProduct.rows[0] });

    // 2) Пустая коробка на ФБС
    const empty = await pool.query(`
      SELECT sb.id AS shelf_box_id, sb.barcode_value AS box_barcode, sb.name AS box_name,
             sb.quantity AS box_quantity, sb.box_size,
             s.id AS shelf_id, s.code AS shelf_code, s.name AS shelf_name, s.barcode_value AS shelf_barcode,
             r.name AS rack_name, w.name AS warehouse_name, w.id AS warehouse_id
      FROM shelf_boxes_s sb
      JOIN shelves_s s ON s.id = sb.shelf_id
      JOIN racks_s r ON r.id = s.rack_id
      JOIN warehouses_s w ON w.id = r.warehouse_id
      WHERE sb.product_id IS NULL AND COALESCE(sb.quantity,0) = 0
        AND w.warehouse_type IN ('fbs','both','visual')
      ORDER BY sb.id LIMIT 1
    `);
    res.json({ box: empty.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/packing/:taskId/boxes — list all boxes with placement info
router.get('/:taskId/boxes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        b.id, b.barcode_value, b.quantity, b.box_size, b.status,
        b.is_remainder, b.confirmed, b.created_at, b.closed_at,
        -- FBO pallet destination
        pa.name   AS pallet_name,
        pa.number AS pallet_number,
        pr.name   AS row_name,
        pr.number AS row_number,
        wfbo.name AS fbo_warehouse_name,
        -- FBS shelf destination (for remainder boxes)
        s.code    AS shelf_code,
        s.name    AS shelf_name,
        r.name    AS rack_name,
        wfbs.name AS fbs_warehouse_name,
        -- если остаток ушёл в коробку на полке ФБС
        sb.barcode_value AS shelf_box_barcode,
        sb.name          AS shelf_box_name
      FROM boxes_s b
      LEFT JOIN pallets_s   pa   ON pa.id  = b.pallet_id
      LEFT JOIN pallet_rows_s pr  ON pr.id  = pa.row_id
      LEFT JOIN warehouses_s  wfbo ON wfbo.id = pr.warehouse_id
      LEFT JOIN shelves_s     s    ON s.id   = b.remainder_shelf_id
      LEFT JOIN racks_s       r    ON r.id   = s.rack_id
      LEFT JOIN warehouses_s  wfbs ON wfbs.id = r.warehouse_id
      LEFT JOIN shelf_boxes_s sb   ON sb.id  = b.remainder_shelf_box_id
      WHERE b.task_id = $1
      ORDER BY b.created_at
    `, [req.params.taskId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/packing/:taskId/cancel-box — снять/отменить открытую коробку с остатком
router.post('/:taskId/cancel-box', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM boxes_s WHERE task_id=$1 AND status='open'`,
      [req.params.taskId]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

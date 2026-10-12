const router = require('express').Router();
const pool = require('../db/pool');
const rateLimit = require('express-rate-limit');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { emitScanEvent, emitTaskCompleted } = require('../socket');
const { pickPreferredProduct } = require('../utils/sharedBarcodes');

// Rate limit for scan endpoints — max 10 scans per second per user
const scanLimiter = rateLimit({
  windowMs: 1000,
  max: 10,
  message: { error: 'Слишком быстрое сканирование' },
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => `scan_${req.user?.sub || 'anon'}`,
  validate: false,
});

// Совместная инвентаризация: разрешён ли сотруднику доступ к задаче.
// task.employee_id остаётся «основным» полем (старые фильтры/начисления),
// полная команда — в inventory_task_workers_s.
async function isTaskWorker(db, taskId, employeeId) {
  if (!employeeId) return false;
  const r = await db.query('SELECT 1 FROM inventory_task_workers_s WHERE task_id = $1 AND employee_id = $2 LIMIT 1', [taskId, employeeId]);
  return r.rows.length > 0;
}

// Свободная сверка: находим паллет по ШК или по названию (когда ШК под рукой нет),
// затем создаём task_boxes для всех его коробок — так же, как при выборе паллета
// админом на этапе создания задачи.
async function resolvePalletForRoam(client, identifier) {
  const trimmed = String(identifier || '').trim();
  if (!trimmed) return { error: 'Введите штрих-код или название паллета' };

  const cols = `pa.id, pa.name, pa.number, pa.barcode_value, pa.uses_boxes, pr.number as row_number, pr.name as row_name`;
  let pallet = await client.query(
    `SELECT ${cols} FROM pallets_s pa JOIN pallet_rows_s pr ON pr.id = pa.row_id WHERE pa.barcode_value = $1 LIMIT 1`,
    [trimmed]
  );

  // «Р4П2» — однозначный адрес (ряд+номер), в отличие от голого названия
  // «Паллет 2», которое повторяется на каждом ряду.
  if (!pallet.rows.length) {
    const addr = trimmed.match(/^[рp]\s*(\d+)\s*[пp]\s*(\d+)$/i);
    if (addr) {
      pallet = await client.query(
        `SELECT ${cols} FROM pallets_s pa JOIN pallet_rows_s pr ON pr.id = pa.row_id
         WHERE pr.number = $1 AND pa.number = $2 LIMIT 1`,
        [Number(addr[1]), Number(addr[2])]
      );
    }
  }

  if (!pallet.rows.length) {
    pallet = await client.query(
      `SELECT ${cols} FROM pallets_s pa JOIN pallet_rows_s pr ON pr.id = pa.row_id WHERE LOWER(pa.name) = LOWER($1) LIMIT 2`,
      [trimmed]
    );
    if (pallet.rows.length > 1) return { error: `Несколько паллетов с названием «${trimmed}» — введите штрих-код или адрес вида «Р4П2»` };
  }
  if (!pallet.rows.length) return { error: `Паллет «${trimmed}» не найден — проверьте штрих-код, название или введите адрес вида «Р4П2»` };

  const p = pallet.rows[0];
  if (!p.uses_boxes) return { error: `Паллет Р${p.row_number}П${p.number} хранит товар напрямую, без коробок — свободная сверка тут не нужна` };

  const boxes = await client.query('SELECT id FROM boxes_s WHERE pallet_id = $1 ORDER BY created_at, id', [p.id]);
  return { pallet: p, boxIds: boxes.rows.map(r => r.id) };
}

async function ensureInventoryPalletReady(client, palletId) {
  const palletResult = await client.query(
    `SELECT pa.id, pa.uses_boxes,
            (SELECT COUNT(*) FROM boxes_s b WHERE b.pallet_id = pa.id AND b.status IN ('open', 'closed')) as boxes_count
     FROM pallets_s pa
     WHERE pa.id = $1`,
    [palletId]
  );

  if (!palletResult.rows.length) {
    throw new Error('Паллет не найден');
  }

  const pallet = palletResult.rows[0];
  const boxesCount = parseInt(pallet.boxes_count || 0, 10);

  if (pallet.uses_boxes && boxesCount > 0) {
    throw new Error('Инвентаризация по товарам недоступна для паллета с коробками. Освободите паллет или используйте паллет без коробок.');
  }

  if (pallet.uses_boxes && boxesCount === 0) {
    await client.query('UPDATE pallets_s SET uses_boxes = false WHERE id = $1', [palletId]);
  }

  return pallet;
}

function parseNumeric(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

// GRA rate keys per task type
const GRA_RATE_KEYS = {
  inventory: 'gra_rate_inventory',
  packaging: 'gra_rate_packaging',
  assembly: 'gra_rate_assembly',
  bundle_assembly: 'gra_rate_assembly',
  production_transfer: 'gra_rate_production_transfer',
};

async function getScanRewardRate(client, taskType) {
  // Try task-type-specific rate first, then fallback to legacy key, then default 10
  const specificKey = GRA_RATE_KEYS[taskType];
  if (specificKey) {
    const result = await client.query(
      `SELECT value FROM settings_s WHERE key = $1 LIMIT 1`,
      [specificKey]
    );
    if (result.rows.length && result.rows[0].value != null) {
      return parseNumeric(result.rows[0].value, 0);
    }
  }
  // Fallback to legacy single rate
  const result = await client.query(
    `SELECT value FROM settings_s WHERE key = 'gra_inventory_scan_rate' LIMIT 1`
  );
  return parseNumeric(result.rows[0]?.value, 10);
}

async function awardScanReward(client, { task, taskScanId, activeTaskBox, productId, quantityDelta, user }) {
  if (!task.employee_id) return null;
  if (user.role !== 'employee') return null;
  if (Number(user.employee_id) !== Number(task.employee_id)) return null;

  const rewardUnits = parseNumeric(quantityDelta, 1);
  if (!(rewardUnits > 0)) return null;

  const rate = await getScanRewardRate(client, task.task_type);
  if (!(rate > 0)) return null;

  // Check for duplicate reward
  const dup = await client.query('SELECT id FROM employee_earnings_s WHERE task_scan_id = $1 LIMIT 1', [taskScanId]);
  if (dup.rows.length) return null;

  const amountDelta = Number((rate * rewardUnits).toFixed(6));

  // Atomic balance update — no read-then-write race condition
  const balResult = await client.query(
    `UPDATE employees_s
     SET gra_balance = gra_balance + $1, updated_at = NOW()
     WHERE id = $2
     RETURNING COALESCE(gra_balance, 0) as balance_after, COALESCE(gra_balance - $1, 0) as balance_before`,
    [amountDelta, task.employee_id]
  );
  if (!balResult.rows.length) return null;

  const { balance_before, balance_after } = balResult.rows[0];

  const rewardResult = await client.query(
    `INSERT INTO employee_earnings_s (
       employee_id, task_id, task_scan_id, task_box_id, shelf_id,
       box_id, shelf_box_id, product_id, event_type, reward_units,
       rate_per_unit, amount_delta, balance_before, balance_after, created_by_user_id,
       task_title, task_type
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'inventory_scan', $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, amount_delta, rate_per_unit, reward_units, balance_after`,
    [
      task.employee_id,
      task.id,
      taskScanId,
      activeTaskBox?.id || null,
      task.shelf_id || null,
      activeTaskBox?.box_id || null,
      activeTaskBox?.shelf_box_id || null,
      productId,
      rewardUnits,
      rate,
      amountDelta,
      balance_before,
      balance_after,
      user.id,
      task.title || null,
      task.task_type || null,
    ]
  );

  return rewardResult.rows[0];
}

function rowsToQtyMap(rows) {
  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.product_id), Number(row.quantity || row.total_qty || 0));
  }
  return map;
}

async function syncPalletBoxSummary(client, boxId, palletId = null) {
  const itemsResult = await client.query(
    `SELECT product_id, quantity
     FROM box_items_s
     WHERE box_id = $1 AND quantity > 0
     ORDER BY product_id`,
    [boxId]
  );
  const items = itemsResult.rows.map(row => ({
    product_id: Number(row.product_id),
    quantity: Number(row.quantity),
  }));
  const totalQty = items.reduce((sum, row) => sum + row.quantity, 0);
  const summaryProductId = items.length === 1 ? items[0].product_id : null;
  await client.query(
    `UPDATE boxes_s
     SET product_id = $1,
         quantity = $2,
         pallet_id = COALESCE($3, pallet_id),
         status = 'closed',
         confirmed = $4,
         closed_at = CASE WHEN $2 > 0 THEN NOW() ELSE NULL END
     WHERE id = $5`,
    [summaryProductId, totalQty, palletId, totalQty > 0, boxId]
  );
  return { items, totalQty, summaryProductId };
}

async function syncShelfBoxSummary(client, shelfBoxId, shelfId = null) {
  const itemsResult = await client.query(
    `SELECT product_id, quantity
     FROM shelf_box_items_s
     WHERE shelf_box_id = $1 AND quantity > 0
     ORDER BY product_id`,
    [shelfBoxId]
  );
  const items = itemsResult.rows.map(row => ({
    product_id: Number(row.product_id),
    quantity: Number(row.quantity),
  }));
  const totalQty = items.reduce((sum, row) => sum + row.quantity, 0);
  const summaryProductId = items.length === 1 ? items[0].product_id : null;
  await client.query(
    `UPDATE shelf_boxes_s
     SET product_id = $1,
         quantity = $2,
         shelf_id = COALESCE($3, shelf_id),
         status = 'closed',
         confirmed = $4,
         closed_at = CASE WHEN $2 > 0 THEN NOW() ELSE NULL END
     WHERE id = $5`,
    [summaryProductId, totalQty, shelfId, totalQty > 0, shelfBoxId]
  );
  return { items, totalQty, summaryProductId };
}

async function logPalletBoxMovementDiff(client, boxId, userId, previousItems, nextItems, note) {
  const prevMap = rowsToQtyMap(previousItems);
  const nextMap = rowsToQtyMap(nextItems);
  const productIds = new Set([...prevMap.keys(), ...nextMap.keys()]);

  for (const productId of productIds) {
    const prevQty = Number(prevMap.get(productId) || 0);
    const nextQty = Number(nextMap.get(productId) || 0);
    if (prevQty === nextQty) continue;

    await client.query(
      `INSERT INTO movements_s (movement_type, product_id, quantity, from_box_id, to_box_id, performed_by, source, notes, quantity_before, quantity_after)
       VALUES ($1, $2, $3, $4, $5, $6, 'task', $7, $8, $9)`,
      [
        nextQty > prevQty ? 'edit_add_to_box' : 'edit_remove_from_box',
        productId,
        Math.abs(nextQty - prevQty),
        nextQty < prevQty ? boxId : null,
        nextQty > prevQty ? boxId : null,
        userId,
        note,
        prevQty,
        nextQty,
      ]
    );
  }
}

async function logShelfBoxMovementDiff(client, shelfId, boxBarcode, taskId, userId, previousItems, nextItems) {
  const prevMap = rowsToQtyMap(previousItems);
  const nextMap = rowsToQtyMap(nextItems);
  const productIds = new Set([...prevMap.keys(), ...nextMap.keys()]);

  for (const productId of productIds) {
    const prevQty = Number(prevMap.get(productId) || 0);
    const nextQty = Number(nextMap.get(productId) || 0);
    if (prevQty === nextQty) continue;

    await client.query(
      `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id, notes)
       VALUES ($1, $2, 'inventory', $3, $4, $5, $6, $7, $8)`,
      [shelfId, productId, prevQty, nextQty, nextQty - prevQty, userId, taskId, `Инвентаризация коробки ${boxBarcode}`]
    );

    await client.query(
      `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, performed_by, source, notes, quantity_before, quantity_after)
       VALUES ($1, $2, $3, $4, $5, 'task', $6, $7, $8)`,
      [
        nextQty > prevQty ? 'edit_add_to_shelf' : 'edit_remove_from_shelf',
        productId,
        Math.abs(nextQty - prevQty),
        shelfId,
        userId,
        `Инвентаризация коробки на полке ${boxBarcode}`,
        prevQty,
        nextQty,
      ]
    );
  }
}

async function getTaskBoxRows(client, taskId) {
  const result = await client.query(
    `SELECT tb.*,
            COALESCE(sbx.id, bx.id) as storage_box_id,
            CASE WHEN sbx.id IS NOT NULL THEN 'shelf' ELSE 'pallet' END as box_location_type,
            COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
            COALESCE(sbx.name, CASE
              WHEN pr.number IS NOT NULL AND pa.number IS NOT NULL THEN CONCAT('Р', pr.number, 'П', pa.number, 'К', ROW_NUMBER() OVER (PARTITION BY bx.pallet_id ORDER BY bx.created_at, bx.id))
              ELSE NULL
            END) as box_name,
            COALESCE(sbx.quantity, bx.quantity) as box_quantity,
            COALESCE(sbx.box_size, bx.box_size) as box_size,
            COALESCE(sbx.product_id, bx.product_id) as summary_product_id,
            COALESCE(sbp.name, bp.name) as summary_product_name,
            COALESCE(sbp.code, bp.code) as summary_product_code,
            s.id as shelf_id,
            s.name as shelf_name,
            s.code as shelf_code,
            r.name as rack_name,
            pa.id as pallet_id,
            pa.name as pallet_name,
            pa.number as pallet_number,
            pr.name as row_name,
            pr.number as row_number,
            claimant.full_name as claimed_by_name
     FROM inventory_task_boxes_s tb
     LEFT JOIN shelf_boxes_s sbx ON sbx.id = tb.shelf_box_id
     LEFT JOIN products_s sbp ON sbp.id = sbx.product_id
     LEFT JOIN shelves_s s ON s.id = sbx.shelf_id
     LEFT JOIN racks_s r ON r.id = s.rack_id
     LEFT JOIN boxes_s bx ON bx.id = tb.box_id
     LEFT JOIN products_s bp ON bp.id = bx.product_id
     LEFT JOIN pallets_s pa ON pa.id = bx.pallet_id
     LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
     LEFT JOIN employees_s claimant ON claimant.id = tb.claimed_by_employee_id
     WHERE tb.task_id = $1
     ORDER BY tb.sort_order, tb.id`,
    [taskId]
  );
  return result.rows;
}

async function getActiveTaskBox(client, taskId) {
  const rows = await getTaskBoxRows(client, taskId);
  return rows.find(row => row.status === 'in_progress') || null;
}

// Что именно отсканировали вместо коробки из задачи — чтобы дать внятную подсказку.
async function classifyUnexpectedScan(pool, value) {
  // Товар?
  const product = await pool.query(
    `SELECT name FROM products_s
     WHERE $1 = ANY(string_to_array(barcode_list, ';'))
        OR production_barcode = $1
        OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
     LIMIT 1`,
    [value]
  );
  if (product.rows.length) {
    return {
      message: `Это штрих-код товара «${product.rows[0].name}». В этой задаче сканируются только коробки.`,
      note: 'скан товара вместо коробки',
    };
  }

  // Коробка на паллете, но не из этой задачи?
  const palletBox = await pool.query(
    `SELECT pr.number AS row_number, pa.number AS pallet_number
     FROM boxes_s b
     LEFT JOIN pallets_s pa ON pa.id = b.pallet_id
     LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
     WHERE b.barcode_value = $1 LIMIT 1`,
    [value]
  );
  if (palletBox.rows.length) {
    const { row_number, pallet_number } = palletBox.rows[0];
    const place = row_number && pallet_number ? ` (Р${row_number}П${pallet_number})` : '';
    return {
      message: `Эта коробка с другого паллета${place} — она не входит в текущую задачу.`,
      note: 'коробка с другого паллета',
    };
  }

  // Коробка на полке?
  const shelfBox = await pool.query(
    `SELECT s.code AS shelf_code FROM shelf_boxes_s sb
     LEFT JOIN shelves_s s ON s.id = sb.shelf_id
     WHERE sb.barcode_value = $1 LIMIT 1`,
    [value]
  );
  if (shelfBox.rows.length) {
    const code = shelfBox.rows[0].shelf_code ? ` (полка ${shelfBox.rows[0].shelf_code})` : '';
    return {
      message: `Эта коробка стоит на полке${code} — она не входит в текущую задачу.`,
      note: 'коробка с полки',
    };
  }

  return {
    message: 'Штрих-код не найден: это не коробка из этой задачи.',
    note: 'неизвестный штрих-код',
  };
}

// Перепись коробок (inventory_scope='boxes'): скан ШК коробки сразу засчитывает её.
// Содержимое коробки не трогаем — фиксируем только факт, что коробка на месте.
async function confirmBoxByScan(pool, { task, taskId, taskBoxId, boxName, scannedValue, alreadyStarted, user }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!alreadyStarted) {
      await client.query(
        `UPDATE inventory_tasks_s SET status = 'in_progress', started_at = COALESCE(started_at, NOW()) WHERE id = $1`,
        [taskId]
      );
    }

    const boxRow = await client.query(
      `UPDATE inventory_task_boxes_s
       SET status = 'completed',
           started_at = COALESCE(started_at, NOW()),
           completed_at = NOW()
       WHERE id = $1 AND task_id = $2 AND status <> 'completed'
       RETURNING id, box_id, shelf_box_id`,
      [taskBoxId, taskId]
    );

    // Коробку уже успели отметить (двойной скан) — молча отдаём прогресс
    if (boxRow.rows.length) {
      const activeTaskBox = boxRow.rows[0];

      const scanInsert = await client.query(
        `INSERT INTO inventory_task_scans_s (task_id, task_box_id, product_id, scanned_value, quantity_delta, shelf_id, scan_kind, employee_id)
         VALUES ($1, $2, NULL, $3, 1, $4, 'box', $5)
         RETURNING id`,
        [taskId, taskBoxId, scannedValue, task.shelf_id || null, user?.employee_id || null]
      );
      await client.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [taskId]);

      try {
        await awardScanReward(client, {
          task: { ...task, id: Number(taskId) },
          taskScanId: scanInsert.rows[0].id,
          activeTaskBox,
          productId: null,
          quantityDelta: 1,
          user,
        });
      } catch (rewardErr) {
        console.error('box check reward error (non-critical):', rewardErr.message);
      }
    }

    const progress = await client.query(
      `SELECT COUNT(*) as total_count,
              COUNT(*) FILTER (WHERE status = 'completed') as completed_count
       FROM inventory_task_boxes_s WHERE task_id = $1`,
      [taskId]
    );
    const totalBoxes = Number(progress.rows[0]?.total_count || 0);
    const confirmedBoxes = Number(progress.rows[0]?.completed_count || 0);

    await client.query('COMMIT');
    return {
      box_confirmed: true,
      box_name: boxName || null,
      confirmed_boxes: confirmedBoxes,
      total_boxes: totalBoxes,
      all_boxes_done: totalBoxes > 0 && confirmedBoxes >= totalBoxes,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function applyInventoryToPallet(client, palletId, taskId, userId) {
  await ensureInventoryPalletReady(client, palletId);

  const scanTotals = await client.query(
    `SELECT product_id, SUM(quantity_delta) as total_qty
     FROM inventory_task_scans_s
     WHERE task_id = $1 AND product_id IS NOT NULL
     GROUP BY product_id`,
    [taskId]
  );

  for (const row of scanTotals.rows) {
    const current = await client.query(
      'SELECT quantity FROM pallet_items_s WHERE pallet_id = $1 AND product_id = $2',
      [palletId, row.product_id]
    );
    const prevQty = current.rows.length ? parseFloat(current.rows[0].quantity) : 0;
    const newQty = parseFloat(row.total_qty);

    await client.query(
      `INSERT INTO pallet_items_s (pallet_id, product_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT (pallet_id, product_id) DO UPDATE SET quantity = $3`,
      [palletId, row.product_id, newQty]
    );

    if (newQty !== prevQty) {
      await client.query(
        `INSERT INTO movements_s (movement_type, product_id, quantity, to_pallet_id, performed_by, source, notes, quantity_before, quantity_after)
         VALUES ($1, $2, $3, $4, $5, 'task', $6, $7, $8)`,
        [
          newQty > prevQty ? 'edit_add_to_pallet' : 'edit_remove_from_pallet',
          row.product_id,
          Math.abs(newQty - prevQty),
          palletId,
          userId,
          'Инвентаризация паллета',
          prevQty,
          newQty,
        ]
      );
    }
  }
}

async function applyInventoryToBox(client, boxId, palletId, taskId, userId, taskBoxId = null) {
  const boxResult = await client.query(
    'SELECT id, product_id, quantity, pallet_id FROM boxes_s WHERE id = $1 FOR UPDATE',
    [boxId]
  );
  if (!boxResult.rows.length) {
    throw new Error('Коробка не найдена');
  }

  const box = boxResult.rows[0];
  const previousItemsResult = await client.query(
    `SELECT product_id, quantity
     FROM box_items_s
     WHERE box_id = $1 AND quantity > 0`,
    [boxId]
  );
  const scanTotals = await client.query(
    `SELECT product_id, SUM(quantity_delta) as total_qty
     FROM inventory_task_scans_s
     WHERE task_id = $1 AND product_id IS NOT NULL
       ${taskBoxId ? 'AND task_box_id = $2' : ''}
     GROUP BY product_id`,
    taskBoxId ? [taskId, taskBoxId] : [taskId]
  );
  const effectivePalletId = palletId || box.pallet_id || null;

  await client.query('DELETE FROM box_items_s WHERE box_id = $1', [boxId]);
  for (const row of scanTotals.rows) {
    const qty = Number(row.total_qty || 0);
    if (qty <= 0) continue;
    await client.query(
      `INSERT INTO box_items_s (box_id, product_id, quantity, updated_at)
       VALUES ($1, $2, $3, NOW())`,
      [boxId, row.product_id, qty]
    );
  }

  await client.query(
    `UPDATE boxes_s SET pallet_id = COALESCE($1, pallet_id) WHERE id = $2`,
    [effectivePalletId, boxId]
  );
  const nextState = await syncPalletBoxSummary(client, boxId, effectivePalletId);
  await logPalletBoxMovementDiff(client, boxId, userId, previousItemsResult.rows, nextState.items, 'Инвентаризация коробки');
}

async function applyInventoryToShelfBox(client, shelfBoxId, shelfId, taskId, userId, taskBoxId = null) {
  const boxResult = await client.query(
    'SELECT id, product_id, quantity, shelf_id, barcode_value FROM shelf_boxes_s WHERE id = $1 FOR UPDATE',
    [shelfBoxId]
  );
  if (!boxResult.rows.length) {
    throw new Error('Коробка на полке не найдена');
  }

  const box = boxResult.rows[0];
  const previousItemsResult = await client.query(
    `SELECT product_id, quantity
     FROM shelf_box_items_s
     WHERE shelf_box_id = $1 AND quantity > 0`,
    [shelfBoxId]
  );
  const scanTotals = await client.query(
    `SELECT product_id, SUM(quantity_delta) as total_qty
     FROM inventory_task_scans_s
     WHERE task_id = $1 AND product_id IS NOT NULL
       ${taskBoxId ? 'AND task_box_id = $2' : ''}
     GROUP BY product_id`,
    taskBoxId ? [taskId, taskBoxId] : [taskId]
  );
  const effectiveShelfId = shelfId || box.shelf_id || null;

  await client.query('DELETE FROM shelf_box_items_s WHERE shelf_box_id = $1', [shelfBoxId]);
  for (const row of scanTotals.rows) {
    const qty = Number(row.total_qty || 0);
    if (qty <= 0) continue;
    await client.query(
      `INSERT INTO shelf_box_items_s (shelf_box_id, product_id, quantity, updated_at)
       VALUES ($1, $2, $3, NOW())`,
      [shelfBoxId, row.product_id, qty]
    );
  }

  await client.query(
    `UPDATE shelf_boxes_s SET shelf_id = COALESCE($1, shelf_id) WHERE id = $2`,
    [effectiveShelfId, shelfBoxId]
  );
  const nextState = await syncShelfBoxSummary(client, shelfBoxId, effectiveShelfId);
  await logShelfBoxMovementDiff(client, effectiveShelfId, box.barcode_value, taskId, userId, previousItemsResult.rows, nextState.items);
}

// Досрочное завершение командной задачи (весь коллектив отметился «у меня всё»,
// или админ форсирует). Коробки, которые кто-то держал (in_progress) — фиксируем
// по тому, что успели отсканировать, и закрываем. Коробки, до которых руки не
// дошли (pending), остаются нетронутыми — их текущий остаток не меняется.
async function finalizeTeamTaskBoxes(client, task, taskId, userId) {
  const taskBoxes = await getTaskBoxRows(client, taskId);
  const inProgress = taskBoxes.filter(row => row.status === 'in_progress');
  for (const box of inProgress) {
    if (box.shelf_box_id) {
      await applyInventoryToShelfBox(client, box.shelf_box_id, task.shelf_id, taskId, userId, box.id);
    } else {
      await applyInventoryToBox(client, box.box_id, task.target_pallet_id, taskId, userId, box.id);
    }
    await client.query(
      `UPDATE inventory_task_boxes_s SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [box.id]
    );
  }
  const totals = await client.query(
    `SELECT COUNT(*) as total_count, COUNT(*) FILTER (WHERE status = 'completed') as completed_count
     FROM inventory_task_boxes_s WHERE task_id = $1`,
    [taskId]
  );
  return {
    harvested_boxes: inProgress.length,
    completed_boxes: Number(totals.rows[0]?.completed_count || 0),
    total_boxes: Number(totals.rows[0]?.total_count || 0),
  };
}

// Все ли исполнители задачи отметились «у меня всё» (сами или админ за них)
async function allWorkersFinished(client, taskId) {
  const r = await client.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE finished_at IS NOT NULL) as finished
     FROM inventory_task_workers_s WHERE task_id = $1`,
    [taskId]
  );
  const row = r.rows[0];
  return Number(row.total) > 0 && Number(row.total) === Number(row.finished);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createLeafKey(type, id) {
  return `${type}:${Number(id)}`;
}

function normalizeInventoryEventRow(row) {
  const products = Array.isArray(row.products) ? row.products : [];
  return {
    leaf_type: row.leaf_type,
    leaf_id: Number(row.leaf_id),
    task_id: Number(row.task_id),
    task_title: row.task_title,
    started_at: row.started_at,
    completed_at: row.completed_at,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    employee_name: row.employee_name || null,
    counted_qty: Number(row.counted_qty || 0),
    products: products.map(item => ({
      product_id: item.product_id == null ? null : Number(item.product_id),
      product_name: item.product_name || null,
      product_code: item.product_code || null,
      quantity: Number(item.quantity || 0),
    })),
  };
}

function groupInventoryEvents(rows) {
  const byLeaf = new Map();
  for (const row of rows) {
    const event = normalizeInventoryEventRow(row);
    const key = createLeafKey(event.leaf_type, event.leaf_id);
    const list = byLeaf.get(key) || [];
    list.push(event);
    byLeaf.set(key, list);
  }
  for (const list of byLeaf.values()) {
    list.sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime());
  }
  return byLeaf;
}

function buildInventoryLeafStats(type, id, currentQty, eventsByLeaf) {
  const history = eventsByLeaf.get(createLeafKey(type, id)) || [];
  const latest = history[0] || null;
  const previous = history[1] || null;
  const safeCurrentQty = Number(currentQty || 0);
  const safeLatestQty = latest ? Number(latest.counted_qty || 0) : null;
  const safePreviousQty = previous ? Number(previous.counted_qty || 0) : null;
  return {
    current_qty: safeCurrentQty,
    last_inventory_qty: safeLatestQty,
    previous_inventory_qty: safePreviousQty,
    last_inventory_at: latest?.completed_at || null,
    previous_inventory_at: previous?.completed_at || null,
    last_inventory_by: latest?.employee_name || null,
    last_inventory_duration_seconds: latest?.duration_seconds ?? null,
    delta_vs_current: safeLatestQty == null ? null : safeCurrentQty - safeLatestQty,
    delta_vs_previous: safeLatestQty == null || safePreviousQty == null ? null : safeLatestQty - safePreviousQty,
    history_count: history.length,
    total_leaf_count: 1,
    covered_leaf_count: latest ? 1 : 0,
    coverage_complete: Boolean(latest),
  };
}

function aggregateInventoryStats(children) {
  const list = Array.isArray(children) ? children : [];
  const latestChild = list
    .filter(child => child?.last_inventory_at)
    .sort((a, b) => new Date(b.last_inventory_at).getTime() - new Date(a.last_inventory_at).getTime())[0] || null;

  const totalLeafCount = list.reduce((sum, child) => sum + Number(child?.total_leaf_count || 0), 0);
  const coveredLeafCount = list.reduce((sum, child) => sum + Number(child?.covered_leaf_count || 0), 0);
  const coverageComplete = totalLeafCount > 0 && totalLeafCount === coveredLeafCount;
  const previousCoverageComplete = coverageComplete && list.every(child => child?.previous_inventory_qty != null);
  const currentQty = list.reduce((sum, child) => sum + Number(child?.current_qty || 0), 0);
  const lastInventoryQty = coverageComplete
    ? list.reduce((sum, child) => sum + Number(child?.last_inventory_qty || 0), 0)
    : null;
  const previousInventoryQty = previousCoverageComplete
    ? list.reduce((sum, child) => sum + Number(child?.previous_inventory_qty || 0), 0)
    : null;

  // Partial sums for incomplete coverage
  const coveredChildren = list.filter(child => child?.last_inventory_qty != null);
  const partialInventoryQty = !coverageComplete && coveredChildren.length > 0
    ? coveredChildren.reduce((sum, child) => sum + Number(child.last_inventory_qty || 0), 0)
    : null;
  const partialDuration = !coverageComplete && coveredChildren.length > 0
    ? coveredChildren.reduce((sum, child) => sum + Number(child.last_inventory_duration_seconds || 0), 0)
    : null;

  return {
    current_qty: currentQty,
    last_inventory_qty: lastInventoryQty,
    previous_inventory_qty: previousInventoryQty,
    partial_inventory_qty: partialInventoryQty,
    partial_inventory_duration_seconds: partialDuration,
    last_inventory_at: latestChild?.last_inventory_at || null,
    previous_inventory_at: previousCoverageComplete
      ? list
          .map(child => child?.previous_inventory_at)
          .filter(Boolean)
          .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null
      : null,
    last_inventory_by: latestChild?.last_inventory_by || null,
    last_inventory_duration_seconds: coverageComplete
      ? list.reduce((sum, child) => sum + Number(child?.last_inventory_duration_seconds || 0), 0)
      : (latestChild?.last_inventory_duration_seconds ?? null),
    delta_vs_current: lastInventoryQty == null ? null : currentQty - lastInventoryQty,
    delta_vs_previous: lastInventoryQty == null || previousInventoryQty == null ? null : lastInventoryQty - previousInventoryQty,
    history_count: list.reduce((sum, child) => sum + Number(child?.history_count || 0), 0),
    total_leaf_count: totalLeafCount,
    covered_leaf_count: coveredLeafCount,
    coverage_complete: coverageComplete,
  };
}

function buildInventoryEventFilter(idField, ids, warehouseField, warehouseId, params) {
  if (Array.isArray(ids) && ids.length > 0) {
    params.push(ids.map(Number).filter(Boolean));
    return `${idField} = ANY($${params.length}::int[])`;
  }
  if (warehouseId) {
    params.push(Number(warehouseId));
    return `${warehouseField} = $${params.length}`;
  }
  return '1=1';
}

async function getShelfInventoryEvents(client, { shelfIds = null, warehouseId = null, lite = false } = {}) {
  const params = [];
  const filterSql = buildInventoryEventFilter('t.shelf_id', shelfIds, 'r.warehouse_id', warehouseId, params);
  const productsCol = lite ? "'[]'::json as products" : `(
         SELECT COALESCE(json_agg(json_build_object(
           'product_id', agg.product_id,
           'product_name', p.name,
           'product_code', p.code,
           'quantity', agg.total_qty
         ) ORDER BY p.name), '[]'::json)
         FROM (
           SELECT sc2.product_id, SUM(sc2.quantity_delta) as total_qty
           FROM inventory_task_scans_s sc2
           WHERE sc2.task_id = t.id AND sc2.product_id IS NOT NULL
           GROUP BY sc2.product_id
         ) agg
         LEFT JOIN products_s p ON p.id = agg.product_id
       ) as products`;
  const result = await client.query(
    `SELECT
       'shelf' as leaf_type,
       t.shelf_id as leaf_id,
       t.id as task_id,
       t.title as task_title,
       t.started_at,
       t.completed_at,
       ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))::numeric) as duration_seconds,
       e.full_name as employee_name,
       COALESCE(SUM(sc.quantity_delta), 0) as counted_qty,
       ${productsCol}
     FROM inventory_tasks_s t
     JOIN shelves_s s ON s.id = t.shelf_id
     JOIN racks_s r ON r.id = s.rack_id
     LEFT JOIN employees_s e ON e.id = t.employee_id
     LEFT JOIN inventory_task_scans_s sc ON sc.task_id = t.id AND sc.product_id IS NOT NULL
     WHERE t.task_type = 'inventory'
       AND t.status = 'completed'
       AND t.shelf_id IS NOT NULL
       AND t.target_pallet_id IS NULL
       AND t.target_box_id IS NULL
       AND t.target_shelf_box_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id)
       AND (t.shelf_ids IS NULL OR jsonb_typeof(t.shelf_ids) <> 'array' OR jsonb_array_length(t.shelf_ids) <= 1)
       AND ${filterSql}
     GROUP BY t.id, e.full_name
     ORDER BY t.completed_at DESC`,
    params
  );
  return result.rows;
}

async function getPalletInventoryEvents(client, { palletIds = null, warehouseId = null, lite = false } = {}) {
  const params = [];
  const filterSql = buildInventoryEventFilter('t.target_pallet_id', palletIds, 'pr.warehouse_id', warehouseId, params);
  const productsCol = lite ? "'[]'::json as products" : `(
         SELECT COALESCE(json_agg(json_build_object(
           'product_id', agg.product_id,
           'product_name', p.name,
           'product_code', p.code,
           'quantity', agg.total_qty
         ) ORDER BY p.name), '[]'::json)
         FROM (
           SELECT sc2.product_id, SUM(sc2.quantity_delta) as total_qty
           FROM inventory_task_scans_s sc2
           WHERE sc2.task_id = t.id AND sc2.product_id IS NOT NULL
           GROUP BY sc2.product_id
         ) agg
         LEFT JOIN products_s p ON p.id = agg.product_id
       ) as products`;
  const result = await client.query(
    `SELECT
       'pallet' as leaf_type,
       t.target_pallet_id as leaf_id,
       t.id as task_id,
       t.title as task_title,
       t.started_at,
       t.completed_at,
       ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))::numeric) as duration_seconds,
       e.full_name as employee_name,
       COALESCE(SUM(sc.quantity_delta), 0) as counted_qty,
       ${productsCol}
     FROM inventory_tasks_s t
     JOIN pallets_s pa ON pa.id = t.target_pallet_id
     JOIN pallet_rows_s pr ON pr.id = pa.row_id
     LEFT JOIN employees_s e ON e.id = t.employee_id
     LEFT JOIN inventory_task_scans_s sc ON sc.task_id = t.id AND sc.product_id IS NOT NULL
     WHERE t.task_type = 'inventory'
       AND t.status = 'completed'
       AND t.target_pallet_id IS NOT NULL
       AND t.shelf_id IS NULL
       AND t.target_box_id IS NULL
       AND t.target_shelf_box_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id)
       AND ${filterSql}
     GROUP BY t.id, e.full_name
     ORDER BY t.completed_at DESC`,
    params
  );
  return result.rows;
}

async function getShelfBoxInventoryEvents(client, { shelfBoxIds = null, warehouseId = null, lite = false } = {}) {
  const params = [];
  const filterSql = buildInventoryEventFilter('tb.shelf_box_id', shelfBoxIds, 'r.warehouse_id', warehouseId, params);
  const productsCol = lite ? "'[]'::json as products" : `(
         SELECT COALESCE(json_agg(json_build_object(
           'product_id', agg.product_id,
           'product_name', p.name,
           'product_code', p.code,
           'quantity', agg.total_qty
         ) ORDER BY p.name), '[]'::json)
         FROM (
           SELECT sc2.product_id, SUM(sc2.quantity_delta) as total_qty
           FROM inventory_task_scans_s sc2
           WHERE sc2.task_id = t.id AND sc2.task_box_id = tb.id AND sc2.product_id IS NOT NULL
           GROUP BY sc2.product_id
         ) agg
         LEFT JOIN products_s p ON p.id = agg.product_id
       ) as products`;
  const result = await client.query(
    `SELECT
       'shelf_box' as leaf_type,
       tb.shelf_box_id as leaf_id,
       t.id as task_id,
       t.title as task_title,
       COALESCE(tb.started_at, t.started_at) as started_at,
       COALESCE(tb.completed_at, t.completed_at) as completed_at,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(tb.completed_at, t.completed_at) - COALESCE(tb.started_at, t.started_at)))::numeric) as duration_seconds,
       e.full_name as employee_name,
       COALESCE((
         SELECT SUM(sc2.quantity_delta)
         FROM inventory_task_scans_s sc2
         WHERE sc2.task_id = t.id AND sc2.task_box_id = tb.id AND sc2.product_id IS NOT NULL
       ), 0) as counted_qty,
       ${productsCol}
     FROM inventory_task_boxes_s tb
     JOIN inventory_tasks_s t ON t.id = tb.task_id
     JOIN shelf_boxes_s sb ON sb.id = tb.shelf_box_id
     JOIN shelves_s s ON s.id = sb.shelf_id
     JOIN racks_s r ON r.id = s.rack_id
     LEFT JOIN employees_s e ON e.id = t.employee_id
     WHERE tb.shelf_box_id IS NOT NULL
       AND tb.status = 'completed'
       AND t.task_type = 'inventory'
       AND t.status = 'completed'
       AND ${filterSql}
     ORDER BY COALESCE(tb.completed_at, t.completed_at) DESC`,
    params
  );
  return result.rows;
}

async function getPalletBoxInventoryEvents(client, { boxIds = null, warehouseId = null, lite = false } = {}) {
  const params = [];
  const filterSql = buildInventoryEventFilter('tb.box_id', boxIds, 'pr.warehouse_id', warehouseId, params);
  const productsCol = lite ? "'[]'::json as products" : `(
         SELECT COALESCE(json_agg(json_build_object(
           'product_id', agg.product_id,
           'product_name', p.name,
           'product_code', p.code,
           'quantity', agg.total_qty
         ) ORDER BY p.name), '[]'::json)
         FROM (
           SELECT sc2.product_id, SUM(sc2.quantity_delta) as total_qty
           FROM inventory_task_scans_s sc2
           WHERE sc2.task_id = t.id AND sc2.task_box_id = tb.id AND sc2.product_id IS NOT NULL
           GROUP BY sc2.product_id
         ) agg
         LEFT JOIN products_s p ON p.id = agg.product_id
       ) as products`;
  const result = await client.query(
    `SELECT
       'pallet_box' as leaf_type,
       tb.box_id as leaf_id,
       t.id as task_id,
       t.title as task_title,
       COALESCE(tb.started_at, t.started_at) as started_at,
       COALESCE(tb.completed_at, t.completed_at) as completed_at,
       ROUND(EXTRACT(EPOCH FROM (COALESCE(tb.completed_at, t.completed_at) - COALESCE(tb.started_at, t.started_at)))::numeric) as duration_seconds,
       e.full_name as employee_name,
       COALESCE((
         SELECT SUM(sc2.quantity_delta)
         FROM inventory_task_scans_s sc2
         WHERE sc2.task_id = t.id AND sc2.task_box_id = tb.id AND sc2.product_id IS NOT NULL
       ), 0) as counted_qty,
       ${productsCol}
     FROM inventory_task_boxes_s tb
     JOIN inventory_tasks_s t ON t.id = tb.task_id
     JOIN boxes_s b ON b.id = tb.box_id
     JOIN pallets_s pa ON pa.id = b.pallet_id
     JOIN pallet_rows_s pr ON pr.id = pa.row_id
     LEFT JOIN employees_s e ON e.id = t.employee_id
     WHERE tb.box_id IS NOT NULL
       AND tb.status = 'completed'
       AND t.task_type = 'inventory'
       AND t.status = 'completed'
       AND ${filterSql}
     ORDER BY COALESCE(tb.completed_at, t.completed_at) DESC`,
    params
  );
  return result.rows;
}

async function getInventoryOverviewData(client, warehouseId = null) {
  const warehouseParams = [];
  const warehouseWhere = warehouseId ? 'WHERE w.id = $1' : 'WHERE w.active = true';
  if (warehouseId) warehouseParams.push(Number(warehouseId));

  const warehousesResult = await client.query(
    `SELECT w.id, w.name, w.warehouse_type
     FROM warehouses_s w
     ${warehouseWhere}
     ORDER BY w.name`,
    warehouseParams
  );

  const warehouseRows = warehousesResult.rows;
  if (warehouseRows.length === 0) {
    return {
      summary: {
        warehouses_count: 0,
        racks_count: 0,
        shelves_count: 0,
        rows_count: 0,
        pallets_count: 0,
        boxes_count: 0,
        last_inventory_at: null,
      },
      warehouses: [],
      lookups: {},
    };
  }

  const warehouseIds = warehouseRows.map(row => Number(row.id));

  const [
    racksResult,
    shelvesResult,
    shelfBoxesResult,
    rowsResult,
    palletsResult,
    palletBoxesResult,
    shelfEventsRaw,
    palletEventsRaw,
    shelfBoxEventsRaw,
    palletBoxEventsRaw,
  ] = await Promise.all([
    client.query(
      `SELECT r.id, r.warehouse_id, r.name, r.code, r.number
       FROM racks_s r
       WHERE r.warehouse_id = ANY($1::int[])
       ORDER BY r.number, r.id`,
      [warehouseIds]
    ),
    client.query(
      `SELECT s.id, s.rack_id, s.name, s.code, s.number, s.barcode_value, s.uses_boxes,
              COALESCE(loose.total_qty, 0) + COALESCE(boxed.total_qty, 0) as current_qty
       FROM shelves_s s
       LEFT JOIN (
         SELECT shelf_id, SUM(quantity) as total_qty
         FROM shelf_items_s
         WHERE quantity > 0
         GROUP BY shelf_id
       ) loose ON loose.shelf_id = s.id
       LEFT JOIN (
         SELECT sb.shelf_id, SUM(sbi.quantity) as total_qty
         FROM shelf_box_items_s sbi
         JOIN shelf_boxes_s sb ON sb.id = sbi.shelf_box_id
         WHERE sbi.quantity > 0
         GROUP BY sb.shelf_id
       ) boxed ON boxed.shelf_id = s.id
       WHERE s.rack_id IN (SELECT id FROM racks_s WHERE warehouse_id = ANY($1::int[]))
       ORDER BY s.rack_id, s.number, s.id`,
      [warehouseIds]
    ),
    client.query(
      `SELECT sb.id, sb.shelf_id, sb.position, sb.name, sb.barcode_value, sb.created_at,
              COALESCE(SUM(sbi.quantity), 0) as current_qty,
              COUNT(*) FILTER (WHERE sbi.quantity > 0) as products_count
       FROM shelf_boxes_s sb
       LEFT JOIN shelf_box_items_s sbi ON sbi.shelf_box_id = sb.id AND sbi.quantity > 0
       WHERE sb.shelf_id IN (
         SELECT s.id
         FROM shelves_s s
         JOIN racks_s r ON r.id = s.rack_id
         WHERE r.warehouse_id = ANY($1::int[])
       )
       GROUP BY sb.id
       ORDER BY sb.shelf_id, sb.position, sb.created_at, sb.id`,
      [warehouseIds]
    ),
    client.query(
      `SELECT pr.id, pr.warehouse_id, pr.name, pr.number
       FROM pallet_rows_s pr
       WHERE pr.warehouse_id = ANY($1::int[])
       ORDER BY pr.number, pr.id`,
      [warehouseIds]
    ),
    client.query(
      `SELECT pa.id, pa.row_id, pa.name, pa.number, pa.barcode_value, pa.uses_boxes,
              COALESCE(loose.total_qty, 0) + COALESCE(boxed.total_qty, 0) as current_qty
       FROM pallets_s pa
       LEFT JOIN (
         SELECT pallet_id, SUM(quantity) as total_qty
         FROM pallet_items_s
         WHERE quantity > 0
         GROUP BY pallet_id
       ) loose ON loose.pallet_id = pa.id
       LEFT JOIN (
         SELECT b.pallet_id, SUM(bi.quantity) as total_qty
         FROM box_items_s bi
         JOIN boxes_s b ON b.id = bi.box_id
         WHERE bi.quantity > 0
         GROUP BY b.pallet_id
       ) boxed ON boxed.pallet_id = pa.id
       WHERE pa.row_id IN (SELECT id FROM pallet_rows_s WHERE warehouse_id = ANY($1::int[]))
       ORDER BY pa.row_id, pa.number, pa.id`,
      [warehouseIds]
    ),
    client.query(
      `SELECT * FROM (
         SELECT b.id, b.pallet_id, b.barcode_value, b.created_at,
                COALESCE(SUM(bi.quantity), 0) as current_qty,
                COUNT(*) FILTER (WHERE bi.quantity > 0) as products_count,
                ROW_NUMBER() OVER (PARTITION BY b.pallet_id ORDER BY b.created_at, b.id) as position
         FROM boxes_s b
         LEFT JOIN box_items_s bi ON bi.box_id = b.id AND bi.quantity > 0
         WHERE b.pallet_id IN (
           SELECT pa.id
           FROM pallets_s pa
           JOIN pallet_rows_s pr ON pr.id = pa.row_id
           WHERE pr.warehouse_id = ANY($1::int[])
         )
         GROUP BY b.id
       ) boxed
       ORDER BY boxed.pallet_id, boxed.position`,
      [warehouseIds]
    ),
    getShelfInventoryEvents(client, { warehouseId, lite: true }),
    getPalletInventoryEvents(client, { warehouseId, lite: true }),
    getShelfBoxInventoryEvents(client, { warehouseId, lite: true }),
    getPalletBoxInventoryEvents(client, { warehouseId, lite: true }),
  ]);

  const allEventsByLeaf = groupInventoryEvents([
    ...shelfEventsRaw,
    ...palletEventsRaw,
    ...shelfBoxEventsRaw,
    ...palletBoxEventsRaw,
  ]);

  const warehouseMap = new Map();
  const rackMap = new Map();
  const shelfMap = new Map();
  const rowMap = new Map();
  const palletMap = new Map();
  const shelfBoxMap = new Map();
  const palletBoxMap = new Map();
  const leafLookup = new Map();

  for (const row of warehouseRows) {
    warehouseMap.set(Number(row.id), {
      kind: 'warehouse',
      id: Number(row.id),
      name: row.name,
      warehouse_type: row.warehouse_type,
      racks: [],
      rows: [],
    });
  }

  for (const row of racksResult.rows) {
    const node = {
      kind: 'rack',
      id: Number(row.id),
      warehouse_id: Number(row.warehouse_id),
      name: row.name,
      code: row.code || null,
      label: row.code || row.name,
      shelves: [],
    };
    rackMap.set(node.id, node);
    warehouseMap.get(node.warehouse_id)?.racks.push(node);
  }

  for (const row of rowsResult.rows) {
    const node = {
      kind: 'row',
      id: Number(row.id),
      warehouse_id: Number(row.warehouse_id),
      name: row.name,
      number: Number(row.number),
      label: `Р${row.number}`,
      pallets: [],
    };
    rowMap.set(node.id, node);
    warehouseMap.get(node.warehouse_id)?.rows.push(node);
  }

  for (const row of shelvesResult.rows) {
    const node = {
      kind: 'shelf',
      id: Number(row.id),
      rack_id: Number(row.rack_id),
      name: row.name,
      code: row.code || null,
      number: Number(row.number),
      barcode_value: row.barcode_value || null,
      uses_boxes: row.uses_boxes === true,
      label: row.code || row.name,
      path_label: row.code || row.name,
      boxes: [],
      current_qty: Number(row.current_qty || 0),
    };
    shelfMap.set(node.id, node);
    rackMap.get(node.rack_id)?.shelves.push(node);
  }

  for (const row of palletsResult.rows) {
    const rowNode = rowMap.get(Number(row.row_id));
    const label = rowNode ? `Р${rowNode.number}П${row.number}` : (row.name || `Паллет ${row.number}`);
    const node = {
      kind: 'pallet',
      id: Number(row.id),
      row_id: Number(row.row_id),
      name: row.name,
      number: Number(row.number),
      barcode_value: row.barcode_value || null,
      uses_boxes: row.uses_boxes !== false,
      label,
      path_label: label,
      boxes: [],
      current_qty: Number(row.current_qty || 0),
    };
    palletMap.set(node.id, node);
    rowMap.get(node.row_id)?.pallets.push(node);
  }

  for (const row of shelfBoxesResult.rows) {
    const shelf = shelfMap.get(Number(row.shelf_id));
    const label = row.name || `${shelf?.code || shelf?.name || 'Полка'}К${row.position}`;
    const node = {
      kind: 'shelf_box',
      id: Number(row.id),
      shelf_id: Number(row.shelf_id),
      position: Number(row.position || 0),
      name: row.name || null,
      barcode_value: row.barcode_value || null,
      products_count: Number(row.products_count || 0),
      label,
      path_label: label,
      current_qty: Number(row.current_qty || 0),
    };
    const stats = buildInventoryLeafStats('shelf_box', node.id, node.current_qty, allEventsByLeaf);
    Object.assign(node, stats);
    shelfBoxMap.set(node.id, node);
    leafLookup.set(createLeafKey('shelf_box', node.id), node);
    shelf?.boxes.push(node);
  }

  for (const row of palletBoxesResult.rows) {
    const pallet = palletMap.get(Number(row.pallet_id));
    const rowNode = pallet ? rowMap.get(pallet.row_id) : null;
    const label = `${rowNode ? `Р${rowNode.number}` : ''}${pallet ? `П${pallet.number}` : ''}К${row.position}`;
    const node = {
      kind: 'pallet_box',
      id: Number(row.id),
      pallet_id: Number(row.pallet_id),
      position: Number(row.position || 0),
      name: null,
      barcode_value: row.barcode_value || null,
      products_count: Number(row.products_count || 0),
      label,
      path_label: label,
      current_qty: Number(row.current_qty || 0),
    };
    const stats = buildInventoryLeafStats('pallet_box', node.id, node.current_qty, allEventsByLeaf);
    Object.assign(node, stats);
    palletBoxMap.set(node.id, node);
    leafLookup.set(createLeafKey('pallet_box', node.id), node);
    pallet?.boxes.push(node);
  }

  for (const shelf of shelfMap.values()) {
    if (shelf.uses_boxes) {
      Object.assign(shelf, aggregateInventoryStats(shelf.boxes));
    } else {
      Object.assign(shelf, buildInventoryLeafStats('shelf', shelf.id, shelf.current_qty, allEventsByLeaf));
      leafLookup.set(createLeafKey('shelf', shelf.id), shelf);
    }
  }

  for (const pallet of palletMap.values()) {
    if (pallet.uses_boxes) {
      Object.assign(pallet, aggregateInventoryStats(pallet.boxes));
    } else {
      Object.assign(pallet, buildInventoryLeafStats('pallet', pallet.id, pallet.current_qty, allEventsByLeaf));
      leafLookup.set(createLeafKey('pallet', pallet.id), pallet);
    }
  }

  for (const rack of rackMap.values()) {
    Object.assign(rack, aggregateInventoryStats(rack.shelves));
  }
  for (const row of rowMap.values()) {
    Object.assign(row, aggregateInventoryStats(row.pallets));
  }
  for (const warehouse of warehouseMap.values()) {
    Object.assign(warehouse, aggregateInventoryStats([...warehouse.racks, ...warehouse.rows]));
  }

  const warehouses = Array.from(warehouseMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  const summary = {
    warehouses_count: warehouses.length,
    racks_count: rackMap.size,
    shelves_count: shelfMap.size,
    rows_count: rowMap.size,
    pallets_count: palletMap.size,
    boxes_count: shelfBoxMap.size + palletBoxMap.size,
    last_inventory_at: warehouses
      .map(node => node.last_inventory_at)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
  };

  return {
    summary,
    warehouses,
    lookups: {
      warehouse: warehouseMap,
      rack: rackMap,
      shelf: shelfMap,
      shelf_box: shelfBoxMap,
      row: rowMap,
      pallet: palletMap,
      pallet_box: palletBoxMap,
      leaf: leafLookup,
    },
  };
}

function findInventoryNode(lookups, kind, id) {
  const map = lookups?.[kind];
  if (!map) return null;
  return map.get(Number(id)) || null;
}

function collectInventoryLeafRefs(node, refs = []) {
  if (!node) return refs;
  switch (node.kind) {
    case 'shelf_box':
      refs.push({ leaf_type: 'shelf_box', leaf_id: node.id });
      return refs;
    case 'pallet_box':
      refs.push({ leaf_type: 'pallet_box', leaf_id: node.id });
      return refs;
    case 'shelf':
      if (node.uses_boxes) node.boxes.forEach(child => collectInventoryLeafRefs(child, refs));
      else refs.push({ leaf_type: 'shelf', leaf_id: node.id });
      return refs;
    case 'pallet':
      if (node.uses_boxes) node.boxes.forEach(child => collectInventoryLeafRefs(child, refs));
      else refs.push({ leaf_type: 'pallet', leaf_id: node.id });
      return refs;
    case 'rack':
      node.shelves.forEach(child => collectInventoryLeafRefs(child, refs));
      return refs;
    case 'row':
      node.pallets.forEach(child => collectInventoryLeafRefs(child, refs));
      return refs;
    case 'warehouse':
      node.racks.forEach(child => collectInventoryLeafRefs(child, refs));
      node.rows.forEach(child => collectInventoryLeafRefs(child, refs));
      return refs;
    default:
      return refs;
  }
}

function serializeInventoryNodeSummary(node) {
  if (!node) return null;
  return {
    kind: node.kind,
    id: node.id,
    name: node.name || null,
    code: node.code || null,
    number: node.number || null,
    label: node.label || node.name || null,
    path_label: node.path_label || node.label || node.name || null,
    uses_boxes: node.uses_boxes === true,
    current_qty: Number(node.current_qty || 0),
    last_inventory_qty: node.last_inventory_qty == null ? null : Number(node.last_inventory_qty),
    previous_inventory_qty: node.previous_inventory_qty == null ? null : Number(node.previous_inventory_qty),
    last_inventory_at: node.last_inventory_at || null,
    previous_inventory_at: node.previous_inventory_at || null,
    last_inventory_by: node.last_inventory_by || null,
    last_inventory_duration_seconds: node.last_inventory_duration_seconds == null ? null : Number(node.last_inventory_duration_seconds),
    delta_vs_current: node.delta_vs_current == null ? null : Number(node.delta_vs_current),
    delta_vs_previous: node.delta_vs_previous == null ? null : Number(node.delta_vs_previous),
    history_count: Number(node.history_count || 0),
    total_leaf_count: Number(node.total_leaf_count || 0),
    covered_leaf_count: Number(node.covered_leaf_count || 0),
    coverage_complete: node.coverage_complete === true,
    children_count: Array.isArray(node.boxes)
      ? node.boxes.length
      : Array.isArray(node.shelves)
      ? node.shelves.length
      : Array.isArray(node.pallets)
      ? node.pallets.length
      : Array.isArray(node.racks) || Array.isArray(node.rows)
      ? Number(node.racks?.length || 0) + Number(node.rows?.length || 0)
      : 0,
  };
}

function buildInventoryHistoryByTask(rows, overview) {
  const normalized = rows.map(normalizeInventoryEventRow);
  const byLeaf = groupInventoryEvents(normalized);
  const byTask = new Map();

  for (const event of normalized) {
    const leafKey = createLeafKey(event.leaf_type, event.leaf_id);
    const leafNode = overview.lookups?.leaf?.get(leafKey) || null;
    const leafHistory = byLeaf.get(leafKey) || [];
    const currentIndex = leafHistory.findIndex(item =>
      item.task_id === event.task_id
      && item.leaf_type === event.leaf_type
      && item.leaf_id === event.leaf_id
      && item.completed_at === event.completed_at
      && item.started_at === event.started_at
    );
    const previous = currentIndex >= 0 ? (leafHistory[currentIndex + 1] || null) : null;
    const currentQty = Number(leafNode?.current_qty || 0);
    const countedQty = Number(event.counted_qty || 0);
    const previousQty = previous ? Number(previous.counted_qty || 0) : null;
    const taskKey = `task:${event.task_id}`;

    if (!byTask.has(taskKey)) {
      byTask.set(taskKey, {
        event_key: taskKey,
        task_id: event.task_id,
        task_title: event.task_title || null,
        completed_at: event.completed_at || null,
        started_at: event.started_at || null,
        employee_name: event.employee_name || null,
        locations: [],
      });
    }

    const group = byTask.get(taskKey);
    if (event.completed_at && (!group.completed_at || new Date(event.completed_at).getTime() > new Date(group.completed_at).getTime())) {
      group.completed_at = event.completed_at;
    }
    if (event.started_at && (!group.started_at || new Date(event.started_at).getTime() < new Date(group.started_at).getTime())) {
      group.started_at = event.started_at;
    }
    if (!group.employee_name && event.employee_name) {
      group.employee_name = event.employee_name;
    }

    group.locations.push({
      leaf_type: event.leaf_type,
      leaf_id: event.leaf_id,
      scope_label: leafNode?.label || null,
      scope_path: leafNode?.path_label || leafNode?.label || null,
      counted_qty: countedQty,
      previous_inventory_qty: previousQty,
      previous_inventory_at: previous?.completed_at || null,
      current_qty: currentQty,
      delta_vs_current: currentQty - countedQty,
      delta_vs_previous: previousQty == null ? null : countedQty - previousQty,
      products: event.products,
    });
  }

  return Array.from(byTask.values())
    .map(group => {
      const locations = group.locations
        .sort((a, b) => String(a.scope_label || '').localeCompare(String(b.scope_label || ''), 'ru'));
      const countedQty = locations.reduce((sum, item) => sum + Number(item.counted_qty || 0), 0);
      const currentQty = locations.reduce((sum, item) => sum + Number(item.current_qty || 0), 0);
      const hasFullPrevious = locations.length > 0 && locations.every(item => item.previous_inventory_qty != null);
      const previousQty = hasFullPrevious
        ? locations.reduce((sum, item) => sum + Number(item.previous_inventory_qty || 0), 0)
        : null;
      const durationSeconds = group.started_at && group.completed_at
        ? (new Date(group.completed_at).getTime() - new Date(group.started_at).getTime()) / 1000
        : null;

      return {
        event_key: group.event_key,
        task_id: group.task_id,
        task_title: group.task_title,
        completed_at: group.completed_at,
        started_at: group.started_at,
        duration_seconds: durationSeconds != null && Number.isFinite(durationSeconds) ? durationSeconds : null,
        employee_name: group.employee_name,
        counted_qty: countedQty,
        previous_inventory_qty: previousQty,
        current_qty: currentQty,
        delta_vs_previous: previousQty == null ? null : countedQty - previousQty,
        delta_vs_current: currentQty - countedQty,
        locations_count: locations.length,
        locations,
      };
    })
    .sort((a, b) => new Date(b.completed_at || 0).getTime() - new Date(a.completed_at || 0).getTime());
}

// GET /api/tasks
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, employee_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = ['t.deleted_at IS NULL'];
    const params = [];

    const userPerms = req.user.permissions || [];
    const canViewAll = req.user.role === 'admin' || userPerms.includes('tasks.view') || userPerms.includes('tasks.create');
    if (!canViewAll) {
      params.push(req.user.employee_id);
      conditions.push(`(t.employee_id = $${params.length} OR EXISTS (SELECT 1 FROM inventory_task_workers_s w WHERE w.task_id = t.id AND w.employee_id = $${params.length}))`);
    } else if (employee_id) {
      params.push(employee_id);
      conditions.push(`t.employee_id = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`t.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM inventory_tasks_s t ${where}`, params
    );

    params.push(parseInt(limit), offset);
    const result = await pool.query(
      `SELECT t.id, t.title, t.status, t.notes, t.created_at, t.started_at, t.completed_at,
              t.task_type, t.inventory_scope, t.roam_mode,
              t.target_box_id, t.target_shelf_box_id,
              (SELECT COUNT(*) FROM inventory_task_workers_s w2 WHERE w2.task_id = t.id) as worker_count,
              (SELECT COALESCE(json_agg(json_build_object(
                 'id', we.id, 'full_name', we.full_name,
                 'finished_at', wl.finished_at,
                 'boxes_completed', (SELECT COUNT(*) FROM inventory_task_boxes_s wtb WHERE wtb.task_id = t.id AND wtb.claimed_by_employee_id = we.id AND wtb.status = 'completed')
               ) ORDER BY we.full_name), '[]'::json)
               FROM inventory_task_workers_s wl JOIN employees_s we ON we.id = wl.employee_id
               WHERE wl.task_id = t.id) as workers,
              e.full_name as employee_name,
              s.code as shelf_code, s.name as shelf_name,
              r.name as rack_name, r.code as rack_code,
              COALESCE(w.name, pw.name) as warehouse_name,
              pa.id as pallet_id, pa.name as pallet_name, pa.number as pallet_number,
              pr.name as pallet_row_name, pr.number as pallet_row_number,
              COALESCE(sbx.id, bx.id) as box_id,
              CASE WHEN sbx.id IS NOT NULL THEN 'shelf' WHEN bx.id IS NOT NULL THEN 'pallet' ELSE NULL END as box_location_type,
              COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
              COALESCE(sbx.quantity, bx.quantity) as box_quantity,
              COALESCE(sbp.name, bp.name) as box_product_name,
              COALESCE(sbp.code, bp.code) as box_product_code,
              t.scans_count,
              t.assembled_count, t.bundle_qty, t.placed_count, t.assembly_phase,
              CASE WHEN t.started_at IS NOT NULL AND t.completed_at IS NOT NULL
                THEN ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 60.0, 1) END as duration_minutes,
              tb_agg.task_boxes_total,
              tb_agg.task_boxes_completed
       FROM inventory_tasks_s t
       LEFT JOIN employees_s e ON e.id = t.employee_id
       LEFT JOIN shelves_s s ON s.id = t.shelf_id
       LEFT JOIN racks_s r ON r.id = s.rack_id
       LEFT JOIN warehouses_s w ON w.id = r.warehouse_id
       LEFT JOIN shelf_boxes_s sbx ON sbx.id = t.target_shelf_box_id
       LEFT JOIN products_s sbp ON sbp.id = sbx.product_id
       LEFT JOIN boxes_s bx ON bx.id = t.target_box_id
       LEFT JOIN products_s bp ON bp.id = bx.product_id
       LEFT JOIN pallets_s pa ON pa.id = COALESCE(t.target_pallet_id, bx.pallet_id)
       LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
       LEFT JOIN warehouses_s pw ON pw.id = pr.warehouse_id
       -- scans_count is denormalized on inventory_tasks_s
       LEFT JOIN LATERAL (
         SELECT COUNT(*) as task_boxes_total,
                COUNT(*) FILTER (WHERE tb.status = 'completed') as task_boxes_completed
         FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id
       ) tb_agg ON true
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      items: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Static routes BEFORE /:id ───────────────────────────────────────────────

// GET /api/tasks/stats/summary
router.get('/stats/summary', requireAuth, requirePermission('tasks.view', 'tasks.create', 'dashboard', 'analytics'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'new' AND deleted_at IS NULL) as new_count,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND deleted_at IS NULL) as in_progress_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND deleted_at IS NULL) as completed_count,
        COUNT(*) FILTER (WHERE status = 'cancelled' AND deleted_at IS NULL) as cancelled_count,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at >= CURRENT_DATE AND deleted_at IS NULL) as completed_today,
        COALESCE((SELECT SUM(amount_delta) FROM employee_earnings_s WHERE created_at >= CURRENT_DATE), 0) as gra_today,
        COALESCE((SELECT SUM(sc.quantity_delta) FROM inventory_task_scans_s sc JOIN inventory_tasks_s t ON t.id = sc.task_id WHERE t.completed_at >= CURRENT_DATE AND t.deleted_at IS NULL AND sc.product_id IS NOT NULL), 0) as scans_today
      FROM inventory_tasks_s
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/analytics/summary — global analytics
router.get('/analytics/summary', requireAuth, requirePermission('analytics', 'tasks.view'), async (req, res) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const { rows: [overview] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as completed_tasks,
        COUNT(*) FILTER (WHERE status = 'in_progress') as active_tasks,
        ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/60)
          FILTER (WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL)::numeric, 1
        ) as avg_duration_minutes,
        (SELECT COUNT(*) FROM inventory_task_scans_s WHERE product_id IS NOT NULL) + COALESCE((SELECT SUM(quantity) FROM boxes_s WHERE status IN ('closed','open')), 0) as total_scans,
        (SELECT COUNT(*) FROM scan_errors_s) as total_errors,
        (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
          SELECT EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY task_id ORDER BY created_at))) as gap
          FROM inventory_task_scans_s
        ) g WHERE gap IS NOT NULL AND gap < 300) as avg_seconds_per_scan
      FROM inventory_tasks_s
    `);

    const { rows: topEmployees } = await pool.query(`
      SELECT
        e.full_name,
        COUNT(DISTINCT t.id) as tasks_count,
        COUNT(sc.id) FILTER (WHERE sc.product_id IS NOT NULL) + COALESCE(SUM(CASE WHEN t.task_type = 'packaging' THEN (SELECT COALESCE(SUM(b.quantity),0) FROM boxes_s b WHERE b.task_id = t.id) ELSE 0 END), 0) as scans_count,
        ROUND(AVG(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))/60)
          FILTER (WHERE t.started_at IS NOT NULL AND t.completed_at IS NOT NULL)::numeric, 1
        ) as avg_minutes,
        (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
          SELECT EXTRACT(EPOCH FROM (sc2.created_at - LAG(sc2.created_at) OVER (PARTITION BY sc2.task_id ORDER BY sc2.created_at))) as gap
          FROM inventory_task_scans_s sc2
          JOIN inventory_tasks_s t2 ON t2.id = sc2.task_id AND t2.employee_id = e.id
        ) g WHERE gap IS NOT NULL AND gap < 300) as avg_scan_gap
      FROM employees_s e
      JOIN inventory_tasks_s t ON t.employee_id = e.id AND t.status = 'completed'
      LEFT JOIN inventory_task_scans_s sc ON sc.task_id = t.id AND t.task_type != 'packaging'
      GROUP BY e.id, e.full_name
      ORDER BY scans_count DESC
      LIMIT 15
    `);

    const { rows: recentTasks } = await pool.query(`
      SELECT
        t.id, t.title, t.status, t.started_at, t.completed_at, t.task_type,
        e.full_name as employee_name,
        ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))::numeric/60, 1) as duration_minutes,
        CASE WHEN t.task_type = 'packaging' THEN COALESCE((SELECT SUM(b.quantity) FROM boxes_s b WHERE b.task_id = t.id), 0)::bigint ELSE COUNT(sc.id) FILTER (WHERE sc.product_id IS NOT NULL) END as scans_count,
        (SELECT COUNT(*) FROM scan_errors_s WHERE task_id = t.id) as errors_count,
        (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
          SELECT EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at))) as gap
          FROM inventory_task_scans_s WHERE task_id = t.id
        ) g WHERE gap IS NOT NULL AND gap < 300) as avg_scan_gap
      FROM inventory_tasks_s t
      LEFT JOIN employees_s e ON e.id = t.employee_id
      LEFT JOIN inventory_task_scans_s sc ON sc.task_id = t.id
      WHERE t.status = 'completed'
      GROUP BY t.id, e.full_name
      ORDER BY t.completed_at DESC
      LIMIT 20
    `);

    return res.json({ overview, topEmployees, recentTasks });
  } catch (err) {
    if (err.code === '40P01' && attempt < 3) { await new Promise(r => setTimeout(r, 50 * attempt)); continue; }
    return res.status(500).json({ error: err.message });
  }
  }
});

// GET /api/tasks/analytics/live — real-time employee monitoring (cached 3s)
let liveCache = { data: null, ts: 0 };
router.get('/analytics/live', requireAuth, requirePermission('analytics', 'dashboard', 'tasks.view'), async (req, res) => {
  const dateParam = req.query.date; // optional: YYYY-MM-DD
  const isToday = !dateParam || dateParam === new Date().toISOString().slice(0, 10);

  // Cache only for today
  if (isToday && liveCache.data && Date.now() - liveCache.ts < 3000) {
    return res.json(liveCache.data);
  }
  const dayStart = dateParam ? new Date(dateParam + 'T00:00:00') : null;
  const dayEnd = dateParam ? new Date(dateParam + 'T23:59:59') : null;
  const dateFilterSql = dateParam ? `$1::date` : 'CURRENT_DATE';
  const params = dateParam ? [dateParam] : [];

  try {
    const { rows: employees } = await pool.query(`
      SELECT
        e.id as employee_id,
        e.full_name,
        e.position,
        COALESCE(e.gra_balance, 0) as balance,
        -- Active task
        (SELECT json_build_object(
          'id', t.id, 'title', t.title, 'type', t.task_type, 'status', t.status,
          'started_at', t.started_at,
          'scans', (SELECT COUNT(*) FROM inventory_task_scans_s sc WHERE sc.task_id = t.id AND sc.product_id IS NOT NULL),
          'boxes_done', (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id AND tb.status = 'completed'),
          'boxes_total', (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id),
          'assembled', t.assembled_count, 'bundle_qty', t.bundle_qty
        ) FROM inventory_tasks_s t WHERE t.employee_id = e.id AND t.status = 'in_progress' LIMIT 1) as active_task,
        COALESCE((SELECT COUNT(*) FROM inventory_task_scans_s sc
          JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = e.id
          WHERE sc.product_id IS NOT NULL AND sc.created_at >= ${dateFilterSql}), 0) as scans_today,
        COALESCE((SELECT SUM(amount_delta) FROM employee_earnings_s
          WHERE employee_id = e.id AND created_at >= ${dateFilterSql} AND created_at < ${dateFilterSql} + INTERVAL '1 day'
            AND event_type IN ('inventory_scan','external_order_pick','external_order_collect')), 0) as earned_today,
        COALESCE((SELECT COUNT(*) FROM inventory_tasks_s t
          WHERE t.employee_id = e.id AND t.status = 'completed' AND t.completed_at >= ${dateFilterSql} AND t.completed_at < ${dateFilterSql} + INTERVAL '1 day'), 0) as tasks_today,
        (SELECT sc.created_at FROM inventory_task_scans_s sc
          JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = e.id
          WHERE sc.product_id IS NOT NULL AND sc.created_at >= ${dateFilterSql} AND sc.created_at < ${dateFilterSql} + INTERVAL '1 day'
          ORDER BY sc.created_at DESC LIMIT 1) as last_scan_at,
        (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
          SELECT EXTRACT(EPOCH FROM (sc.created_at - LAG(sc.created_at) OVER (PARTITION BY sc.task_id ORDER BY sc.created_at))) as gap
          FROM inventory_task_scans_s sc
          JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = e.id
          WHERE sc.created_at >= ${dateFilterSql} AND sc.created_at < ${dateFilterSql} + INTERVAL '1 day'
        ) g WHERE gap > 0 AND gap < 300) as avg_speed_today,
        -- Sborka live stats (from sborka_live_events_s)
        COALESCE((SELECT COUNT(*) FROM sborka_live_events_s sle
          WHERE sle.employee_id = e.id AND sle.event_type = 'pick'
            AND sle.created_at >= ${dateFilterSql} AND sle.created_at < ${dateFilterSql} + INTERVAL '1 day'), 0) as sborka_picks_today,
        COALESCE((SELECT COUNT(*) FROM sborka_live_events_s sle
          WHERE sle.employee_id = e.id AND sle.event_type = 'order_complete'
            AND sle.created_at >= ${dateFilterSql} AND sle.created_at < ${dateFilterSql} + INTERVAL '1 day'), 0) as sborka_orders_today,
        (SELECT sle.created_at FROM sborka_live_events_s sle
          WHERE sle.employee_id = e.id
            AND sle.created_at >= ${dateFilterSql} AND sle.created_at < ${dateFilterSql} + INTERVAL '1 day'
          ORDER BY sle.created_at DESC LIMIT 1) as last_sborka_at,
        -- Active break
        (SELECT json_build_object('id', eb.id, 'break_type', eb.break_type, 'started_at', eb.started_at)
          FROM employee_breaks_s eb
          WHERE eb.employee_id = e.id AND eb.ended_at IS NULL
          ORDER BY eb.started_at DESC LIMIT 1) as active_break
      FROM employees_s e
      WHERE e.active = true
        AND (
          ${isToday ? `EXISTS (SELECT 1 FROM inventory_tasks_s t WHERE t.employee_id = e.id AND t.status = 'in_progress') OR` : ''}
          EXISTS (SELECT 1 FROM inventory_task_scans_s sc JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = e.id WHERE sc.created_at >= ${dateFilterSql} AND sc.created_at < ${dateFilterSql} + INTERVAL '1 day')
          OR EXISTS (SELECT 1 FROM sborka_live_events_s sle WHERE sle.employee_id = e.id AND sle.created_at >= ${dateFilterSql} AND sle.created_at < ${dateFilterSql} + INTERVAL '1 day')
        )
      ORDER BY scans_today DESC, sborka_picks_today DESC, sborka_orders_today DESC
    `, params);
    const result = { employees, timestamp: new Date().toISOString(), date: dateParam || new Date().toISOString().slice(0,10) };
    if (isToday) liveCache = { data: result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/analytics/live/:employeeId/timeline — employee day timeline for live monitor detail
router.get('/analytics/live/:employeeId/timeline', requireAuth, requirePermission('analytics', 'dashboard', 'tasks.view'), async (req, res) => {
  const employeeId = parseInt(req.params.employeeId);
  const dateParam = req.query.date;
  const dateVal = dateParam || new Date().toISOString().slice(0, 10);
  try {
    const tasksResult = await pool.query(`
      SELECT t.id, t.title, t.task_type, t.status, t.started_at, t.completed_at,
             t.assembled_count, t.bundle_qty, t.placed_count, t.assembly_phase, t.pause_log,
             t.scans_count as scan_count,
             (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
               SELECT EXTRACT(EPOCH FROM (sc.created_at - LAG(sc.created_at) OVER (ORDER BY sc.created_at))) as gap
               FROM inventory_task_scans_s sc WHERE sc.task_id = t.id AND sc.product_id IS NOT NULL
             ) g WHERE gap > 0 AND gap < 300) as avg_scan_time,
             (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id) as boxes_total,
             (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = t.id AND tb.status = 'completed') as boxes_done,
             COALESCE((SELECT SUM(ee.amount_delta) FROM employee_earnings_s ee
              WHERE ee.task_id = t.id AND ee.employee_id = $1
                AND ee.event_type IN ('inventory_scan','external_order_pick','external_order_collect')), 0) as earned,
             s.code as shelf_code, s.name as shelf_name,
             r.name as rack_name,
             pa.name as pallet_name, pa.number as pallet_number,
             pr.name as pallet_row_name
      FROM inventory_tasks_s t
      LEFT JOIN shelves_s s ON s.id = t.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE t.employee_id = $1
        AND (t.started_at >= $2::date
             OR t.completed_at >= $2::date
             OR (t.status = 'in_progress' AND t.started_at IS NOT NULL))
      ORDER BY t.started_at ASC
    `, [employeeId, dateVal]);

    // 5-minute activity buckets
    const bucketsResult = await pool.query(`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (sc.created_at - $2::date)) / 300)::int as bucket,
        COUNT(*) as scan_count,
        MIN(sc.created_at) as bucket_start,
        MAX(sc.created_at) as bucket_end
      FROM inventory_task_scans_s sc
      JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = $1
      WHERE sc.created_at >= $2::date AND sc.created_at < $2::date + INTERVAL '1 day' AND sc.product_id IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket
    `, [employeeId, dateVal]);

    // Breaks today
    const breaksResult = await pool.query(`
      SELECT id, break_type, started_at, ended_at
      FROM employee_breaks_s
      WHERE employee_id = $1 AND started_at >= $2::date AND started_at < $2::date + INTERVAL '1 day'
      ORDER BY started_at ASC
    `, [employeeId, dateVal]);

    // Sborka live events for the day (picks + order_complete)
    const sborkaEventsResult = await pool.query(`
      SELECT id, event_type, order_id, product_name, barcode, quantity, marketplace, created_at
      FROM sborka_live_events_s
      WHERE employee_id = $1 AND created_at >= $2::date AND created_at < $2::date + INTERVAL '1 day'
      ORDER BY created_at ASC
    `, [employeeId, dateVal]);

    // 5-minute sborka activity buckets (pick events count as activity)
    const sborkaBucketsResult = await pool.query(`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (sle.created_at - $2::date)) / 300)::int as bucket,
        COUNT(*) as event_count
      FROM sborka_live_events_s sle
      WHERE sle.employee_id = $1 AND sle.created_at >= $2::date AND sle.created_at < $2::date + INTERVAL '1 day'
        AND sle.event_type IN ('pick','order_start','order_complete')
      GROUP BY bucket
      ORDER BY bucket
    `, [employeeId, dateVal]);

    res.json({
      tasks: tasksResult.rows,
      activity_buckets: bucketsResult.rows,
      breaks: breaksResult.rows,
      sborka_events: sborkaEventsResult.rows,
      sborka_buckets: sborkaBucketsResult.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/errors — all scan errors across all tasks
router.get('/errors', requireAuth, requirePermission('errors', 'tasks.view'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        se.*,
        u.username,
        e.full_name as employee_name,
        t.title as task_title,
        s.id as shelf_id, s.code as shelf_code, s.name as shelf_name,
        r.name as rack_name, r.id as rack_id,
        ru.username as resolved_by_username
      FROM scan_errors_s se
      LEFT JOIN users_s u ON u.id = se.user_id
      LEFT JOIN employees_s e ON e.id = u.employee_id
      LEFT JOIN inventory_tasks_s t ON t.id = se.task_id
      LEFT JOIN shelves_s s ON s.id = t.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN users_s ru ON ru.id = se.resolved_by
      ORDER BY se.resolved_at NULLS FIRST, se.created_at DESC
      LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/errors/:id/resolve — mark scan error as resolved
router.put('/errors/:id/resolve', requireAuth, requirePermission('errors', 'tasks.create'), async (req, res) => {
  try {
    const result = await pool.query(
      'UPDATE scan_errors_s SET resolved_at=NOW(), resolved_by=$1 WHERE id=$2 RETURNING *',
      [req.user.id, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Не найдено' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/analytics/inventory-overview — tree of storage locations with inventory stats
router.get('/analytics/inventory-overview', requireAuth, requirePermission('analytics', 'warehouse.view'), async (req, res) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const warehouseId = req.query.warehouse_id ? Number(req.query.warehouse_id) : null;
      const overview = await getInventoryOverviewData(pool, warehouseId);
      return res.json({
        summary: overview.summary,
        warehouses: overview.warehouses,
      });
    } catch (err) {
      if (err.message.includes('deadlock') && attempt < 3) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      return res.status(500).json({ error: err.message });
    }
  }
});

// GET /api/tasks/analytics/inventory-history — history for selected node
router.get('/analytics/inventory-history', requireAuth, requirePermission('analytics', 'warehouse.view'), async (req, res) => {
  try {
    const locationType = String(req.query.location_type || '').trim();
    const locationId = Number(req.query.id);
    if (!locationType || !Number.isFinite(locationId)) {
      return res.status(400).json({ error: 'location_type и id обязательны' });
    }

    const overview = await getInventoryOverviewData(pool, null);
    const selectedNode = findInventoryNode(overview.lookups, locationType, locationId);
    if (!selectedNode) {
      return res.status(404).json({ error: 'Узел инвентаризации не найден' });
    }

    const refs = collectInventoryLeafRefs(selectedNode, []);
    const shelfIds = refs.filter(ref => ref.leaf_type === 'shelf').map(ref => ref.leaf_id);
    const palletIds = refs.filter(ref => ref.leaf_type === 'pallet').map(ref => ref.leaf_id);
    const shelfBoxIds = refs.filter(ref => ref.leaf_type === 'shelf_box').map(ref => ref.leaf_id);
    const palletBoxIds = refs.filter(ref => ref.leaf_type === 'pallet_box').map(ref => ref.leaf_id);

    const [shelfEvents, palletEvents, shelfBoxEvents, palletBoxEvents] = await Promise.all([
      shelfIds.length ? getShelfInventoryEvents(pool, { shelfIds }) : [],
      palletIds.length ? getPalletInventoryEvents(pool, { palletIds }) : [],
      shelfBoxIds.length ? getShelfBoxInventoryEvents(pool, { shelfBoxIds }) : [],
      palletBoxIds.length ? getPalletBoxInventoryEvents(pool, { boxIds: palletBoxIds }) : [],
    ]);

    const history = buildInventoryHistoryByTask(
      [...shelfEvents, ...palletEvents, ...shelfBoxEvents, ...palletBoxEvents],
      overview
    );

    res.json({
      node: serializeInventoryNodeSummary(selectedNode),
      history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/busy-targets — which shelves/pallets/boxes are in active tasks
router.get('/busy-targets', requireAuth, requirePermission('tasks.view', 'tasks.create'), async (_req, res) => {
  try {
    const activeStatuses = ['new', 'in_progress'];
    const [shelvesResult, palletsResult, palletBoxesResult, shelfBoxesResult] = await Promise.all([
      pool.query(
        `SELECT t.shelf_id as id, t.id as task_id, t.title, t.status
         FROM inventory_tasks_s t
         WHERE t.shelf_id IS NOT NULL AND t.status = ANY($1) AND t.deleted_at IS NULL`,
        [activeStatuses]
      ),
      pool.query(
        `SELECT t.target_pallet_id as id, t.id as task_id, t.title, t.status
         FROM inventory_tasks_s t
         WHERE t.target_pallet_id IS NOT NULL AND t.status = ANY($1) AND t.deleted_at IS NULL`,
        [activeStatuses]
      ),
      pool.query(
        `SELECT itb.box_id as id, t.id as task_id, t.title, t.status
         FROM inventory_task_boxes_s itb
         JOIN inventory_tasks_s t ON t.id = itb.task_id
         WHERE itb.box_id IS NOT NULL AND t.status = ANY($1) AND t.deleted_at IS NULL`,
        [activeStatuses]
      ),
      pool.query(
        `SELECT itb.shelf_box_id as id, t.id as task_id, t.title, t.status
         FROM inventory_task_boxes_s itb
         JOIN inventory_tasks_s t ON t.id = itb.task_id
         WHERE itb.shelf_box_id IS NOT NULL AND t.status = ANY($1) AND t.deleted_at IS NULL`,
        [activeStatuses]
      ),
    ]);
    const toMap = (rows) => {
      const map = {};
      for (const r of rows) {
        map[r.id] = { task_id: r.task_id, title: r.title, status: r.status };
      }
      return map;
    };
    res.json({
      shelves: toMap(shelvesResult.rows),
      pallets: toMap(palletsResult.rows),
      pallet_boxes: toMap(palletBoxesResult.rows),
      shelf_boxes: toMap(shelfBoxesResult.rows),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/analytics/audit-report — audit report grouped by employee
router.get('/analytics/audit-report', requireAuth, requirePermission('analytics', 'warehouse.view'), async (req, res) => {
  try {
    // 1) Summary
    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as total_tasks,
        COALESCE((SELECT COUNT(*) FROM inventory_task_scans_s WHERE product_id IS NOT NULL), 0) as total_scans,
        COALESCE((SELECT COUNT(*) FROM scan_errors_s), 0) as total_errors,
        ROUND(
          (SELECT AVG(gap) FROM (
            SELECT EXTRACT(EPOCH FROM (sc.created_at - LAG(sc.created_at) OVER (PARTITION BY sc.task_id ORDER BY sc.created_at)))::numeric as gap
            FROM inventory_task_scans_s sc
            WHERE sc.product_id IS NOT NULL
          ) sub WHERE sub.gap IS NOT NULL AND sub.gap > 0 AND sub.gap < 300)
        , 1) as avg_scan_gap
      FROM inventory_tasks_s
    `);

    // 2) Employees with aggregated stats
    const { rows: employees } = await pool.query(`
      SELECT
        e.id as employee_id,
        e.full_name,
        COUNT(DISTINCT t.id) as tasks_count,
        COALESCE(SUM(sub_sc.scans_count), 0) as total_scans,
        COALESCE(SUM(sub_err.errors_count), 0) as total_errors,
        MAX(t.completed_at) as last_task_at,
        ROUND(
          (SELECT AVG(gap) FROM (
            SELECT EXTRACT(EPOCH FROM (sc2.created_at - LAG(sc2.created_at) OVER (PARTITION BY sc2.task_id ORDER BY sc2.created_at)))::numeric as gap
            FROM inventory_task_scans_s sc2
            JOIN inventory_tasks_s t2 ON t2.id = sc2.task_id
            WHERE t2.employee_id = e.id AND sc2.product_id IS NOT NULL
          ) g WHERE g.gap IS NOT NULL AND g.gap > 0 AND g.gap < 300)
        , 1) as avg_scan_gap
      FROM employees_s e
      JOIN inventory_tasks_s t ON t.employee_id = e.id AND t.status = 'completed'
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as scans_count FROM inventory_task_scans_s WHERE task_id = t.id AND product_id IS NOT NULL
      ) sub_sc ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as errors_count FROM scan_errors_s WHERE task_id = t.id
      ) sub_err ON true
      GROUP BY e.id, e.full_name
      ORDER BY MAX(t.completed_at) DESC
    `);

    // 3) For each employee, get their tasks
    const employeeIds = employees.map(e => e.employee_id);
    let tasksMap = {};
    if (employeeIds.length > 0) {
      const { rows: tasks } = await pool.query(`
        SELECT
          t.id as task_id,
          t.title,
          t.status,
          t.task_type,
          t.started_at,
          t.completed_at,
          t.employee_id,
          s.name as shelf_name,
          r.name as rack_name,
          pa.name as pallet_name,
          pr.name as row_name,
          ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))::numeric) as duration_seconds,
          (SELECT COUNT(*) FROM inventory_task_scans_s WHERE task_id = t.id AND product_id IS NOT NULL) as scans_count,
          (SELECT COUNT(*) FROM scan_errors_s WHERE task_id = t.id) as errors_count,
          ROUND(
            (SELECT AVG(gap) FROM (
              SELECT EXTRACT(EPOCH FROM (sc3.created_at - LAG(sc3.created_at) OVER (ORDER BY sc3.created_at)))::numeric as gap
              FROM inventory_task_scans_s sc3
              WHERE sc3.task_id = t.id AND sc3.product_id IS NOT NULL
            ) g2 WHERE g2.gap IS NOT NULL AND g2.gap > 0 AND g2.gap < 300)
          , 1) as avg_scan_gap
        FROM inventory_tasks_s t
        LEFT JOIN shelves_s s ON s.id = t.shelf_id
        LEFT JOIN racks_s r ON r.id = s.rack_id
        LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
        WHERE t.employee_id = ANY($1) AND t.status = 'completed'
        ORDER BY t.completed_at DESC
      `, [employeeIds]);

      // Group tasks by employee
      for (const task of tasks) {
        if (!tasksMap[task.employee_id]) tasksMap[task.employee_id] = [];
        tasksMap[task.employee_id].push(task);
      }

      // 4) Get boxes for all tasks that have them
      const allTaskIds = tasks.map(t => t.task_id);
      let boxesMap = {};
      if (allTaskIds.length > 0) {
        const { rows: boxes } = await pool.query(`
          SELECT
            tb.id,
            tb.task_id,
            COALESCE(sbx.name, CONCAT('Коробка #', tb.id)) as box_name,
            COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
            COALESCE(sbx.box_size, bx.box_size) as box_size,
            tb.status,
            (SELECT COUNT(*) FROM inventory_task_scans_s WHERE task_id = tb.task_id AND task_box_id = tb.id AND product_id IS NOT NULL) as scans_count
          FROM inventory_task_boxes_s tb
          LEFT JOIN shelf_boxes_s sbx ON sbx.id = tb.shelf_box_id
          LEFT JOIN boxes_s bx ON bx.id = tb.box_id
          WHERE tb.task_id = ANY($1)
          ORDER BY tb.sort_order, tb.id
        `, [allTaskIds]);

        for (const box of boxes) {
          if (!boxesMap[box.task_id]) boxesMap[box.task_id] = [];
          boxesMap[box.task_id].push(box);
        }
      }

      // Attach boxes to tasks
      for (const task of tasks) {
        task.boxes = boxesMap[task.task_id] || [];
      }
    }

    // Build response
    const result = employees.map(emp => ({
      employee_id: emp.employee_id,
      full_name: emp.full_name,
      tasks_count: Number(emp.tasks_count),
      total_scans: Number(emp.total_scans),
      total_errors: Number(emp.total_errors),
      avg_scan_gap: emp.avg_scan_gap != null ? Number(emp.avg_scan_gap) : null,
      last_task_at: emp.last_task_at,
      tasks: (tasksMap[emp.employee_id] || []).map(t => ({
        task_id: t.task_id,
        title: t.title,
        status: t.status,
        task_type: t.task_type,
        shelf_name: t.shelf_name,
        rack_name: t.rack_name,
        pallet_name: t.pallet_name,
        row_name: t.row_name,
        scans_count: Number(t.scans_count),
        errors_count: Number(t.errors_count),
        duration_seconds: t.duration_seconds != null ? Number(t.duration_seconds) : null,
        avg_scan_gap: t.avg_scan_gap != null ? Number(t.avg_scan_gap) : null,
        started_at: t.started_at,
        completed_at: t.completed_at,
        boxes: t.boxes.map(b => ({
          id: b.id,
          box_name: b.box_name,
          box_barcode: b.box_barcode,
          box_size: b.box_size != null ? Number(b.box_size) : null,
          scans_count: Number(b.scans_count),
          status: b.status,
        })),
      })),
    }));

    res.json({
      summary: {
        total_tasks: Number(summary.total_tasks),
        total_scans: Number(summary.total_scans),
        total_errors: Number(summary.total_errors),
        avg_scan_gap: summary.avg_scan_gap != null ? Number(summary.avg_scan_gap) : null,
      },
      employees: result,
    });
  } catch (err) {
    console.error('audit-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/analytics/table-report — monthly table grouped by employee
router.get('/analytics/table-report', requireAuth, requirePermission('analytics', 'warehouse.view'), async (req, res) => {
  try {
    const monthLabels = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const now = new Date();
    const months = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ month: d.getMonth() + 1, year: d.getFullYear(), label: monthLabels[d.getMonth()] });
    }
    const oldest = new Date(now.getFullYear(), now.getMonth() - 2, 1);

    // 1) Summary
    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) as total_tasks,
        COALESCE((SELECT COUNT(*) FROM inventory_task_scans_s sc JOIN inventory_tasks_s t2 ON t2.id = sc.task_id WHERE t2.status = 'completed' AND t2.completed_at >= $1 AND sc.product_id IS NOT NULL), 0) as total_scans,
        COALESCE((SELECT COUNT(*) FROM scan_errors_s se JOIN inventory_tasks_s t3 ON t3.id = se.task_id WHERE t3.status = 'completed' AND t3.completed_at >= $1), 0) as total_errors,
        COUNT(DISTINCT employee_id) as total_employees
      FROM inventory_tasks_s
      WHERE status = 'completed' AND completed_at >= $1
    `, [oldest]);

    // 2) Tasks with per-task stats for last 3 months
    const { rows: tasks } = await pool.query(`
      SELECT
        t.id as task_id,
        t.title,
        t.status,
        t.employee_id,
        t.started_at,
        t.completed_at,
        EXTRACT(MONTH FROM t.completed_at)::int as m,
        EXTRACT(YEAR FROM t.completed_at)::int as y,
        s.name as shelf_name,
        r.name as rack_name,
        pa.name as pallet_name,
        pr.name as row_name,
        ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) / 60.0) as duration_min,
        (SELECT COUNT(*) FROM inventory_task_scans_s WHERE task_id = t.id AND product_id IS NOT NULL) as scans_count,
        (SELECT COUNT(*) FROM scan_errors_s WHERE task_id = t.id) as errors_count,
        ROUND(
          (SELECT AVG(gap) FROM (
            SELECT EXTRACT(EPOCH FROM (sc3.created_at - LAG(sc3.created_at) OVER (ORDER BY sc3.created_at)))::numeric as gap
            FROM inventory_task_scans_s sc3
            WHERE sc3.task_id = t.id AND sc3.product_id IS NOT NULL
          ) g2 WHERE g2.gap IS NOT NULL AND g2.gap > 0 AND g2.gap < 300)
        , 1) as avg_gap
      FROM inventory_tasks_s t
      LEFT JOIN shelves_s s ON s.id = t.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE t.status = 'completed' AND t.completed_at >= $1
      ORDER BY t.completed_at DESC
    `, [oldest]);

    // 3) Employees
    const { rows: empRows } = await pool.query(`
      SELECT DISTINCT e.id as employee_id, e.full_name
      FROM employees_s e
      JOIN inventory_tasks_s t ON t.employee_id = e.id AND t.status = 'completed' AND t.completed_at >= $1
      ORDER BY e.full_name
    `, [oldest]);

    // Group tasks by employee
    const employeesResult = empRows.map(emp => {
      const empTasks = tasks.filter(t => t.employee_id === emp.employee_id);
      const monthsData = {};
      for (const mo of months) {
        const key = `${mo.year}-${mo.month}`;
        const mTasks = empTasks.filter(t => Number(t.y) === mo.year && Number(t.m) === mo.month);
        monthsData[key] = {
          tasks: mTasks.length,
          scans: mTasks.reduce((s, t) => s + Number(t.scans_count), 0),
          errors: mTasks.reduce((s, t) => s + Number(t.errors_count), 0),
          duration_min: mTasks.reduce((s, t) => s + (Number(t.duration_min) || 0), 0),
          avg_gap: mTasks.length > 0
            ? (mTasks.filter(t => t.avg_gap != null).reduce((s, t) => s + Number(t.avg_gap), 0) / (mTasks.filter(t => t.avg_gap != null).length || 1)).toFixed(1)
            : null,
        };
      }
      return {
        employee_id: emp.employee_id,
        full_name: emp.full_name,
        months: monthsData,
        tasks: empTasks.map(t => {
          let location = '';
          if (t.rack_name && t.shelf_name) location = `${t.rack_name} · ${t.shelf_name}`;
          else if (t.rack_name) location = t.rack_name;
          else if (t.pallet_name && t.row_name) location = `${t.row_name} · ${t.pallet_name}`;
          return {
            task_id: t.task_id,
            title: t.title,
            status: t.status,
            month_key: `${t.y}-${t.m}`,
            location,
            scans_count: Number(t.scans_count),
            errors_count: Number(t.errors_count),
            duration_min: t.duration_min != null ? Number(t.duration_min) : null,
            avg_gap: t.avg_gap != null ? String(t.avg_gap) : null,
            started_at: t.started_at,
            completed_at: t.completed_at,
          };
        }),
      };
    });

    res.json({
      months,
      summary: {
        total_tasks: Number(summary.total_tasks),
        total_scans: Number(summary.total_scans),
        total_errors: Number(summary.total_errors),
        total_employees: Number(summary.total_employees),
      },
      employees: employeesResult,
    });
  } catch (err) {
    console.error('table-report error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Dynamic routes ───────────────────────────────────────────────────────────

// GET /api/tasks/:id
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const task = await pool.query(
      `SELECT t.*,
              e.full_name as employee_name,
              s.code as shelf_code, s.name as shelf_name, s.barcode_value as shelf_barcode,
              r.name as rack_name, r.code as rack_code,
              COALESCE(w.name, pw.name) as warehouse_name,
              pa.name as pallet_name, pa.number as pallet_number, pa.barcode_value as pallet_barcode,
              pr.name as pallet_row_name, pr.number as pallet_row_number,
              COALESCE(sbx.id, bx.id) as box_id,
              CASE WHEN sbx.id IS NOT NULL THEN 'shelf' WHEN bx.id IS NOT NULL THEN 'pallet' ELSE NULL END as box_location_type,
              COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
              COALESCE(sbx.quantity, bx.quantity) as box_quantity,
              COALESCE(sbp.name, bp.name) as box_product_name,
              COALESCE(sbp.code, bp.code) as box_product_code
       FROM inventory_tasks_s t
       LEFT JOIN employees_s e ON e.id = t.employee_id
       LEFT JOIN shelves_s s ON s.id = t.shelf_id
       LEFT JOIN racks_s r ON r.id = s.rack_id
       LEFT JOIN warehouses_s w ON w.id = r.warehouse_id
       LEFT JOIN shelf_boxes_s sbx ON sbx.id = t.target_shelf_box_id
       LEFT JOIN products_s sbp ON sbp.id = sbx.product_id
       LEFT JOIN boxes_s bx ON bx.id = t.target_box_id
       LEFT JOIN products_s bp ON bp.id = bx.product_id
       LEFT JOIN pallets_s pa ON pa.id = COALESCE(t.target_pallet_id, bx.pallet_id)
       LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
       LEFT JOIN warehouses_s pw ON pw.id = pr.warehouse_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && task.rows[0].employee_id !== req.user.employee_id && !(await isTaskWorker(pool, req.params.id, req.user.employee_id))) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const t = task.rows[0];
    const taskBoxes = await getTaskBoxRows(pool, req.params.id);
    const completedTaskBoxes = taskBoxes.filter(row => row.status === 'completed').length;
    // Моя активная коробка — та, что держу я; чужие claimed-коробки не считаются моими.
    const activeTaskBox = taskBoxes.find(row => row.status === 'in_progress'
      && (row.claimed_by_employee_id == null || Number(row.claimed_by_employee_id) === Number(req.user.employee_id))) || null;

    // For completed tasks, don't tag (scans already tagged). For active — tag untagged.
    if (t.shelf_id && t.status === 'in_progress') {
      await pool.query(
        `UPDATE inventory_task_scans_s SET shelf_id = $1 WHERE task_id = $2 AND shelf_id IS NULL`,
        [t.shelf_id, req.params.id]
      );
    }

    // For multi-shelf tasks, only show scans for current shelf
    const isMultiShelf = t.shelf_ids && Array.isArray(t.shelf_ids) && t.shelf_ids.length > 1;
    const shelfFilter = isMultiShelf && t.shelf_id ? `AND sc.shelf_id = ${parseInt(t.shelf_id)}` : '';

    const scans = await pool.query(
      `SELECT
         sc.product_id,
         p.name as product_name, p.code as product_code,
         p.production_barcode, p.barcode_list,
         SUM(sc.quantity_delta) as total_quantity,
         COUNT(*) as scan_count,
         MAX(sc.created_at) as last_scan_at
       FROM inventory_task_scans_s sc
       LEFT JOIN products_s p ON p.id = sc.product_id
       WHERE sc.task_id = $1 AND sc.product_id IS NOT NULL ${shelfFilter}
       GROUP BY sc.product_id, p.name, p.code, p.production_barcode, p.barcode_list
       ORDER BY MAX(sc.created_at) DESC`,
      [req.params.id]
    );

    // GRA earned for this task
    const earningsRes = await pool.query(
      `SELECT COALESCE(SUM(amount_delta), 0) as gra_earned FROM employee_earnings_s WHERE task_id = $1`,
      [req.params.id]
    );

    const workers = await pool.query(
      `SELECT e.id, e.full_name, w.finished_at, w.finished_by,
              (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = w.task_id AND tb.claimed_by_employee_id = e.id AND tb.status = 'completed') as boxes_completed
       FROM inventory_task_workers_s w JOIN employees_s e ON e.id = w.employee_id WHERE w.task_id = $1 ORDER BY e.full_name`,
      [req.params.id]
    );

    res.json({
      ...t,
      scans: scans.rows,
      task_boxes: taskBoxes,
      task_boxes_total: taskBoxes.length,
      task_boxes_completed: completedTaskBoxes,
      active_task_box: activeTaskBox,
      workers: workers.rows,
      gra_earned: Number(earningsRes.rows[0]?.gra_earned || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tasks/:id/analytics — per-task detailed analytics
router.get('/:id/analytics', requireAuth, async (req, res) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const taskId = parseInt(req.params.id);

    const { rows: [task] } = await pool.query(`
      SELECT t.*,
             e.full_name as employee_name,
             s.code as shelf_code, s.name as shelf_name,
             r.name as rack_name,
             pa.name as pallet_name, pa.number as pallet_number, pa.barcode_value as pallet_barcode,
             pr.name as pallet_row_name, pr.number as pallet_row_number,
             COALESCE(sbx.id, bx.id) as box_id,
             CASE WHEN sbx.id IS NOT NULL THEN 'shelf' WHEN bx.id IS NOT NULL THEN 'pallet' ELSE NULL END as box_location_type,
             COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
             COALESCE(sbx.quantity, bx.quantity) as box_quantity,
             COALESCE(sbp.name, bp.name) as box_product_name,
             COALESCE(sbp.code, bp.code) as box_product_code,
             ROUND(EXTRACT(EPOCH FROM (t.completed_at - t.started_at))::numeric) as duration_seconds
      FROM inventory_tasks_s t
      LEFT JOIN employees_s e ON e.id = t.employee_id
      LEFT JOIN shelves_s s ON s.id = t.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN shelf_boxes_s sbx ON sbx.id = t.target_shelf_box_id
      LEFT JOIN products_s sbp ON sbp.id = sbx.product_id
      LEFT JOIN boxes_s bx ON bx.id = t.target_box_id
      LEFT JOIN products_s bp ON bp.id = bx.product_id
      LEFT JOIN pallets_s pa ON pa.id = COALESCE(t.target_pallet_id, bx.pallet_id)
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE t.id = $1
    `, [taskId]);

    if (!task) return res.status(404).json({ error: 'Задача не найдена' });

    if (req.user.role === 'employee' && task.employee_id !== req.user.employee_id && !(await isTaskWorker(pool, req.params.id, req.user.employee_id))) {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const taskBoxes = await getTaskBoxRows(pool, taskId);
    // Моя активная коробка — та, что держу я; в командной задаче остальные держат свои.
    const activeTaskBox = taskBoxes.find(row => row.status === 'in_progress'
      && (row.claimed_by_employee_id == null || Number(row.claimed_by_employee_id) === Number(req.user.employee_id))) || null;
    const workersRes = await pool.query(
      `SELECT e.id, e.full_name, w.finished_at, w.finished_by,
              (SELECT COUNT(*) FROM inventory_task_boxes_s tb WHERE tb.task_id = w.task_id AND tb.claimed_by_employee_id = e.id AND tb.status = 'completed') as boxes_completed
       FROM inventory_task_workers_s w JOIN employees_s e ON e.id = w.employee_id WHERE w.task_id = $1 ORDER BY e.full_name`,
      [taskId]
    );

    // Tag untagged scans with current shelf before filtering
    if (task.shelf_id) {
      await pool.query(
        `UPDATE inventory_task_scans_s SET shelf_id = $1 WHERE task_id = $2 AND shelf_id IS NULL`,
        [task.shelf_id, taskId]
      );
    }

    // All scans with timestamps and gap from previous scan
    // For multi-shelf tasks, filter by current shelf_id
    const currentShelfId = task.shelf_id;
    const hasShelfFilter = task.shelf_ids && Array.isArray(task.shelf_ids) && task.shelf_ids.length > 1;

    const { rows: scans } = await pool.query(`
      SELECT
        sc.id,
        sc.task_box_id,
        sc.scanned_value,
        sc.quantity_delta,
        sc.created_at,
        sc.scan_kind,
        sc.employee_id,
        se.full_name as employee_name,
        p.name as product_name,
        p.code as product_code,
        ROUND(EXTRACT(EPOCH FROM (
          sc.created_at - LAG(sc.created_at) OVER (ORDER BY sc.created_at)
        ))::numeric, 1) as seconds_since_prev,
        LAG(sc.created_at) OVER (ORDER BY sc.created_at) as prev_scan_at
      FROM inventory_task_scans_s sc
      LEFT JOIN products_s p ON p.id = sc.product_id
      LEFT JOIN employees_s se ON se.id = sc.employee_id
      WHERE sc.task_id = $1
        AND (sc.product_id IS NOT NULL OR sc.scan_kind = 'box')
        ${hasShelfFilter && currentShelfId ? `AND (sc.shelf_id = ${parseInt(currentShelfId)} OR sc.shelf_id IS NULL)` : ''}
      ORDER BY sc.created_at ASC
    `, [taskId]);

    const { rows: errors } = await pool.query(
      'SELECT * FROM scan_errors_s WHERE task_id = $1 ORDER BY created_at ASC',
      [taskId]
    );

    // Scans per minute histogram
    const { rows: perMinute } = await pool.query(`
      SELECT
        FLOOR(EXTRACT(EPOCH FROM (sc.created_at - t.started_at))/60)::int as minute_offset,
        COUNT(*) as scan_count
      FROM inventory_task_scans_s sc
      JOIN inventory_tasks_s t ON t.id = sc.task_id
      WHERE sc.task_id = $1 AND t.started_at IS NOT NULL AND sc.product_id IS NOT NULL
      GROUP BY minute_offset
      ORDER BY minute_offset
    `, [taskId]);

    // For packaging tasks also return boxes
    let boxes = [];
    if (task.task_type === 'packaging') {
      const { rows: bxs } = await pool.query(`
        SELECT b.*, p.name as product_name, p.code as product_code,
               pa.name as pallet_name, pa.number as pallet_number,
               pr.name as row_name, pr.number as row_number
        FROM boxes_s b
        LEFT JOIN products_s p ON p.id = b.product_id
        LEFT JOIN pallets_s pa ON pa.id = b.pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
        WHERE b.task_id = $1
        ORDER BY b.created_at ASC
      `, [taskId]);
      boxes = bxs;
    }

    // Null out seconds_since_prev for scans that span a pause or error
    const pauseLog = task.pause_log || [];
    // Build set of error timestamps for gap detection
    const errorTimes = errors.map(e => new Date(e.created_at).getTime());

    for (const scan of scans) {
      if (scan.seconds_since_prev == null || !scan.prev_scan_at) continue;
      const prevTime = new Date(scan.prev_scan_at).getTime();
      const curTime = new Date(scan.created_at).getTime();

      // Check if a pause period overlaps this gap
      let nullify = false;
      for (const p of pauseLog) {
        const pausedAt = new Date(p.paused_at).getTime();
        if (pausedAt > prevTime && pausedAt < curTime) { nullify = true; break; }
      }

      // Check if a scan error occurred between these two scans
      if (!nullify) {
        for (const et of errorTimes) {
          if (et > prevTime && et < curTime) { nullify = true; break; }
        }
      }

      if (nullify) scan.seconds_since_prev = null;
    }

    res.json({
      task,
      scans,
      errors,
      perMinute,
      boxes,
      task_boxes: taskBoxes,
      active_task_box: activeTaskBox,
      task_boxes_total: taskBoxes.length,
      task_boxes_completed: taskBoxes.filter(row => row.status === 'completed').length,
      workers: workersRes.rows,
    });
    return;
  } catch (err) {
    if (err.code === '40P01' && attempt < 3) { await new Promise(r => setTimeout(r, 50 * attempt)); continue; }
    return res.status(500).json({ error: err.message });
  }
  }
});


// POST /api/tasks
router.post('/', requireAuth, (req, res, next) => {
  // Returns tasks can be created by any employee (auto-created from ReturnsPage)
  if (req.body.task_type === 'returns') return next();
  // Self-created packaging tasks (from MovePage button) — любой сотрудник
  // создаёт задачу оприходования на себя.
  if (req.body.task_type === 'packaging' && req.body.self_create && req.user.employee_id) {
    req.body.employee_id = req.user.employee_id;
    return next();
  }
  return requirePermission('tasks.create')(req, res, next);
}, async (req, res) => {
  const {
    title,
    employee_id,
    shelf_id,
    shelf_ids,
    notes,
    task_type,
    product_id,
    box_size,
    target_pallet_id,
    target_box_id,
    target_shelf_box_id,
    target_box_ids,
    target_shelf_box_ids,
    inventory_scope,
    roam_mode,
    employee_ids,
  } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length === 0) return res.status(400).json({ error: 'Название задачи обязательно' });
  const validTypes = ['inventory', 'packaging', 'production_transfer', 'bundle_assembly', 'returns'];
  if (task_type && !validTypes.includes(task_type)) return res.status(400).json({ error: `Неизвестный тип задачи: ${task_type}` });
  // 'boxes' — перепись коробок: сканируем паллет и коробки, внутрь не заходим
  const scope = inventory_scope === 'boxes' ? 'boxes' : 'items';
  // Свободная сверка: паллет не выбран заранее — сотрудник назовёт его сам на месте
  const isRoam = roam_mode === true && scope === 'boxes';
  // Совместная инвентаризация: несколько исполнителей на одной задаче
  const workerIds = Array.isArray(employee_ids)
    ? [...new Set(employee_ids.map(Number).filter(Boolean))]
    : (employee_id ? [Number(employee_id)] : []);
  const client = await pool.connect();
  try {
    const palletBoxIds = Array.isArray(target_box_ids) ? target_box_ids.map(Number).filter(Boolean) : [];
    const shelfBoxIds = Array.isArray(target_shelf_box_ids) ? target_shelf_box_ids.map(Number).filter(Boolean) : [];

    if ((task_type || 'inventory') === 'inventory'
      && !isRoam
      && !shelf_id
      && !target_pallet_id
      && !target_box_id
      && !target_shelf_box_id
      && !(shelf_ids?.length)
      && palletBoxIds.length === 0
      && shelfBoxIds.length === 0) {
      return res.status(400).json({ error: 'Для инвентаризации выберите полку, паллет или коробку' });
    }

    await client.query('BEGIN');

    // ─── Check: target not already in active task ──────────────────
    const activeStatuses = ['new', 'in_progress'];
    const allShelfIds = shelf_ids?.length ? shelf_ids.map(Number).filter(Boolean) : (shelf_id ? [Number(shelf_id)] : []);

    if (allShelfIds.length > 0) {
      const busyShelf = await client.query(
        `SELECT t.id, t.title, t.status, s.name as shelf_name, r.name as rack_name
         FROM inventory_tasks_s t
         LEFT JOIN shelves_s s ON s.id = t.shelf_id
         LEFT JOIN racks_s r ON r.id = s.rack_id
         WHERE t.shelf_id = ANY($1)
           AND t.status = ANY($2) AND t.deleted_at IS NULL
         LIMIT 1`,
        [allShelfIds, activeStatuses]
      );
      if (busyShelf.rows.length) {
        const b = busyShelf.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Полка "${b.rack_name ? b.rack_name + ' · ' : ''}${b.shelf_name}" уже в задаче #${b.id} "${b.title}" (${b.status === 'new' ? 'новая' : 'в работе'})`,
        });
      }
    }

    if (palletBoxIds.length > 0) {
      const busyBox = await client.query(
        `SELECT itb.task_id, t.title, t.status, b.barcode_value
         FROM inventory_task_boxes_s itb
         JOIN inventory_tasks_s t ON t.id = itb.task_id
         LEFT JOIN boxes_s b ON b.id = itb.box_id
         WHERE itb.box_id = ANY($1)
           AND t.status = ANY($2) AND t.deleted_at IS NULL
         LIMIT 1`,
        [palletBoxIds, activeStatuses]
      );
      if (busyBox.rows.length) {
        const b = busyBox.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Коробка ${b.barcode_value || ''} уже в задаче #${b.task_id} "${b.title}" (${b.status === 'new' ? 'новая' : 'в работе'})`,
        });
      }
    }

    if (shelfBoxIds.length > 0) {
      const busyShelfBox = await client.query(
        `SELECT itb.task_id, t.title, t.status, sb.barcode_value
         FROM inventory_task_boxes_s itb
         JOIN inventory_tasks_s t ON t.id = itb.task_id
         LEFT JOIN shelf_boxes_s sb ON sb.id = itb.shelf_box_id
         WHERE itb.shelf_box_id = ANY($1)
           AND t.status = ANY($2) AND t.deleted_at IS NULL
         LIMIT 1`,
        [shelfBoxIds, activeStatuses]
      );
      if (busyShelfBox.rows.length) {
        const b = busyShelfBox.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Коробка ${b.barcode_value || ''} уже в задаче #${b.task_id} "${b.title}" (${b.status === 'new' ? 'новая' : 'в работе'})`,
        });
      }
    }

    if (target_box_id) {
      const busyTargetBox = await client.query(
        `SELECT t.id, t.title, t.status
         FROM inventory_tasks_s t
         WHERE t.target_box_id = $1
           AND t.status = ANY($2) AND t.deleted_at IS NULL
         LIMIT 1`,
        [target_box_id, activeStatuses]
      );
      if (busyTargetBox.rows.length) {
        const b = busyTargetBox.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Коробка уже в задаче #${b.id} "${b.title}" (${b.status === 'new' ? 'новая' : 'в работе'})`,
        });
      }
    }

    if (target_shelf_box_id) {
      const busyTargetShelfBox = await client.query(
        `SELECT t.id, t.title, t.status
         FROM inventory_tasks_s t
         WHERE t.target_shelf_box_id = $1
           AND t.status = ANY($2) AND t.deleted_at IS NULL
         LIMIT 1`,
        [target_shelf_box_id, activeStatuses]
      );
      if (busyTargetShelfBox.rows.length) {
        const b = busyTargetShelfBox.rows[0];
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Коробка на полке уже в задаче #${b.id} "${b.title}" (${b.status === 'new' ? 'новая' : 'в работе'})`,
        });
      }
    }

    // If shelf_ids provided, use first as shelf_id and store full list
    let effectiveShelfId = shelf_ids?.length ? shelf_ids[0] : (shelf_id || null);
    const effectiveShelfIds = shelf_ids?.length ? JSON.stringify(shelf_ids) : null;
    let effectivePalletId = target_pallet_id || null;

    if ((target_box_id || palletBoxIds.length > 0) && !effectivePalletId) {
      const primaryBoxId = target_box_id || palletBoxIds[0];
      const boxResult = await client.query('SELECT pallet_id FROM boxes_s WHERE id = $1', [primaryBoxId]);
      if (!boxResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Коробка не найдена' });
      }
      effectivePalletId = boxResult.rows[0].pallet_id || null;
    }

    if ((target_shelf_box_id || shelfBoxIds.length > 0) && !effectiveShelfId) {
      const primaryBoxId = target_shelf_box_id || shelfBoxIds[0];
      const boxResult = await client.query('SELECT shelf_id FROM shelf_boxes_s WHERE id = $1', [primaryBoxId]);
      if (!boxResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Коробка на полке не найдена' });
      }
      effectiveShelfId = boxResult.rows[0].shelf_id || null;
    }

    const result = await client.query(
      `INSERT INTO inventory_tasks_s (title, employee_id, shelf_id, shelf_ids, current_shelf_index, notes, created_by, task_type, product_id, box_size, target_pallet_id, target_box_id, target_shelf_box_id, inventory_scope, roam_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [title, workerIds[0] || null, effectiveShelfId, effectiveShelfIds, 0, notes || null, req.user.id, task_type || 'inventory', product_id || null, box_size || null, effectivePalletId, target_box_id || null, target_shelf_box_id || null, scope, isRoam]
    );

    const taskId = result.rows[0].id;

    for (const empId of workerIds) {
      await client.query(
        `INSERT INTO inventory_task_workers_s (task_id, employee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [taskId, empId]
      );
    }

    for (let i = 0; i < palletBoxIds.length; i += 1) {
      await client.query(
        `INSERT INTO inventory_task_boxes_s (task_id, box_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [taskId, palletBoxIds[i], i]
      );
    }

    for (let i = 0; i < shelfBoxIds.length; i += 1) {
      await client.query(
        `INSERT INTO inventory_task_boxes_s (task_id, shelf_box_id, sort_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [taskId, shelfBoxIds[i], i]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...result.rows[0], worker_ids: workerIds });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/next-shelf — finish current shelf inventory + move to next shelf
router.post('/:id/next-shelf', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;

    const t = await client.query('SELECT * FROM inventory_tasks_s WHERE id=$1', [taskId]);
    if (!t.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const task = t.rows[0];

    if (task.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не в работе' });
    }

    const shelfIds = task.shelf_ids;
    if (!shelfIds || !Array.isArray(shelfIds) || shelfIds.length <= 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Это задача с одной полкой' });
    }

    const currentShelfId = task.shelf_id;
    const nextIndex = (task.current_shelf_index || 0) + 1;

    if (nextIndex >= shelfIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Все полки пройдены', allDone: true });
    }

    // 1. Tag any untagged scans with current shelf_id
    if (currentShelfId) {
      await client.query(
        `UPDATE inventory_task_scans_s SET shelf_id = $1 WHERE task_id = $2 AND shelf_id IS NULL`,
        [currentShelfId, taskId]
      );
    }

    // 2. Apply inventory results for CURRENT shelf (same logic as /complete)
    if (currentShelfId) {
      const scanTotals = await client.query(
        `SELECT product_id, SUM(quantity_delta) as total_qty
         FROM inventory_task_scans_s
         WHERE task_id = $1 AND product_id IS NOT NULL AND shelf_id = $2
         GROUP BY product_id`,
        [taskId, currentShelfId]
      );

      // If no scans have shelf_id, try without shelf_id filter (backward compat)
      let scans = scanTotals.rows;
      if (scans.length === 0) {
        const fallback = await client.query(
          `SELECT product_id, SUM(quantity_delta) as total_qty
           FROM inventory_task_scans_s
           WHERE task_id = $1 AND product_id IS NOT NULL
           GROUP BY product_id`,
          [taskId]
        );
        scans = fallback.rows;
      }

      for (const row of scans) {
        const current = await client.query(
          'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
          [currentShelfId, row.product_id]
        );
        const prevQty = current.rows.length ? parseFloat(current.rows[0].quantity) : 0;
        const newQty = parseFloat(row.total_qty);

        await client.query(
          `INSERT INTO shelf_items_s (shelf_id, product_id, quantity, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (shelf_id, product_id) DO UPDATE SET quantity=$3, updated_by=$4, updated_at=NOW()`,
          [currentShelfId, row.product_id, newQty, req.user.id]
        );

        await client.query(
          `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id)
           VALUES ($1,$2,'inventory',$3,$4,$5,$6,$7)`,
          [currentShelfId, row.product_id, prevQty, newQty, newQty - prevQty, req.user.id, taskId]
        );

        // Log to movements_s
        if (newQty !== prevQty) {
          await client.query(
            `INSERT INTO movements_s (movement_type, product_id, quantity, to_shelf_id, performed_by, source, notes, quantity_before, quantity_after)
             VALUES ($1,$2,$3,$4,$5,'task',$6,$7,$8)`,
            [newQty > prevQty ? 'edit_add_to_shelf' : 'edit_remove_from_shelf',
             row.product_id, Math.abs(newQty - prevQty), currentShelfId, req.user.id,
             'Инвентаризация (переход к след. полке)', prevQty, newQty]
          );
        }
      }
    }

    // 2. Switch to next shelf
    const nextShelfId = shelfIds[nextIndex];
    await client.query(
      `UPDATE inventory_tasks_s SET shelf_id=$1, current_shelf_index=$2, updated_at=NOW() WHERE id=$3`,
      [nextShelfId, nextIndex, taskId]
    );

    await client.query('COMMIT');

    const shelf = await pool.query(
      `SELECT s.id, s.code, s.name, s.barcode_value, r.name as rack_name, r.code as rack_code
       FROM shelves_s s LEFT JOIN racks_s r ON r.id = s.rack_id WHERE s.id=$1`, [nextShelfId]);
    res.json({ success: true, nextIndex, totalShelves: shelfIds.length, shelf: shelf.rows[0] || null });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/pause — admin pauses/resumes task
router.post('/:id/pause', requireAuth, requirePermission('tasks.create', 'tasks.view'), async (req, res) => {
  try {
    const task = await pool.query(`SELECT id, status FROM inventory_tasks_s WHERE id = $1`, [req.params.id]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];

    if (t.status === 'paused') {
      // Resume — update last pause_log entry with resumed_at
      const nowStr = new Date().toISOString();
      const logRes = await pool.query(`SELECT pause_log FROM inventory_tasks_s WHERE id = $1`, [req.params.id]);
      const log = logRes.rows[0]?.pause_log || [];
      if (log.length > 0 && !log[log.length - 1].resumed_at) {
        log[log.length - 1].resumed_at = nowStr;
      }
      await pool.query(
        `UPDATE inventory_tasks_s SET status = 'in_progress', paused_at = NULL, paused_by = NULL, updated_at = NOW(), pause_log = $1 WHERE id = $2`,
        [JSON.stringify(log), req.params.id]
      );
      res.json({ status: 'in_progress', message: 'Задача возобновлена' });
    } else if (t.status === 'in_progress' || t.status === 'new') {
      // Pause — append pause entry to log
      const nowStr = new Date().toISOString();
      const logRes = await pool.query(`SELECT pause_log FROM inventory_tasks_s WHERE id = $1`, [req.params.id]);
      const log = logRes.rows[0]?.pause_log || [];
      log.push({ paused_at: nowStr });
      await pool.query(
        `UPDATE inventory_tasks_s SET status = 'paused', paused_at = NOW(), paused_by = $1, updated_at = NOW(), pause_log = $2 WHERE id = $3`,
        [req.user.id, JSON.stringify(log), req.params.id]
      );
      res.json({ status: 'paused', message: 'Задача на паузе' });
    } else {
      res.status(400).json({ error: 'Нельзя поставить на паузу задачу со статусом ' + t.status });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tasks/:id
router.put('/:id', requireAuth, requirePermission('tasks.create', 'tasks.view'), async (req, res) => {
  const { title, employee_id, shelf_id, notes, status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE inventory_tasks_s
       SET title=COALESCE($1,title),
           employee_id=COALESCE($2,employee_id),
           shelf_id=COALESCE($3,shelf_id),
           notes=COALESCE($4,notes),
           status=COALESCE($5,status)
       WHERE id=$6 RETURNING *`,
      [title, employee_id, shelf_id, notes, status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tasks/:id — update task fields (assign employee, notes, title)
router.patch('/:id', requireAuth, requirePermission('tasks.create'), async (req, res) => {
  const { employee_id, title, notes } = req.body;
  const updates = [];
  const params = [];
  if (employee_id !== undefined) { params.push(employee_id); updates.push(`employee_id = $${params.length}`); }
  if (title !== undefined) { params.push(title); updates.push(`title = $${params.length}`); }
  if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }
  if (!updates.length) return res.status(400).json({ error: 'Нет полей для обновления' });
  params.push(req.params.id);
  try {
    const result = await pool.query(
      `UPDATE inventory_tasks_s SET ${updates.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING id, title, employee_id, notes`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/tasks/:id?refund=1 — delete task, optionally refund GRA
router.delete('/:id', requireAuth, requirePermission('tasks.create'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const refund = req.query.refund === '1';

    if (refund) {
      // Sum up all earnings for this task and subtract from employee balance
      const earnings = await client.query(
        `SELECT employee_id, SUM(amount_delta) as total FROM employee_earnings_s WHERE task_id = $1 GROUP BY employee_id`,
        [req.params.id]
      );
      for (const row of earnings.rows) {
        const total = Number(row.total || 0);
        if (total > 0) {
          await client.query(`UPDATE employees_s SET gra_balance = GREATEST(0, gra_balance - $1) WHERE id = $2`, [total, row.employee_id]);
        }
      }
      // Delete earnings records
      await client.query(`DELETE FROM employee_earnings_s WHERE task_id = $1`, [req.params.id]);
    }

    await client.query('UPDATE inventory_tasks_s SET deleted_at = NOW(), status = $2 WHERE id = $1', [req.params.id, 'cancelled']);
    await client.query('COMMIT');
    res.json({ success: true, refunded: refund });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/start — employee starts task
// For inventory tasks: must scan shelf barcode
// For production_transfer tasks: must scan pallet barcode
router.post('/:id/start', requireAuth, async (req, res) => {
  const { shelf_barcode, pallet_barcode, box_barcode } = req.body;
  try {
    const task = await pool.query(
      `SELECT t.*,
              s.barcode_value as shelf_barcode_expected,
              pa.barcode_value as pallet_barcode_expected,
              bx.barcode_value as box_barcode_expected,
              sbx.barcode_value as shelf_box_barcode_expected,
              (SELECT COUNT(*) FROM inventory_task_workers_s w WHERE w.task_id = t.id) as worker_count
       FROM inventory_tasks_s t
       LEFT JOIN shelves_s s ON s.id = t.shelf_id
       LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
       LEFT JOIN boxes_s bx ON bx.id = t.target_box_id
       LEFT JOIN shelf_boxes_s sbx ON sbx.id = t.target_shelf_box_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    const t = task.rows[0];
    const isMultiWorker = Number(t.worker_count || 0) > 1;
    const taskBoxesResult = await pool.query(
      `SELECT tb.id, tb.status, tb.claimed_by_employee_id,
              claimant.full_name as claimed_by_name,
              COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode,
              COALESCE(sbx.name, CASE
                WHEN pr.number IS NOT NULL AND pa.number IS NOT NULL
                  THEN CONCAT('Р', pr.number, 'П', pa.number, 'К', ROW_NUMBER() OVER (PARTITION BY bx.pallet_id ORDER BY bx.created_at, bx.id))
                ELSE NULL
              END) as box_name,
              CASE WHEN sbx.id IS NOT NULL THEN 'shelf' ELSE 'pallet' END as box_location_type
       FROM inventory_task_boxes_s tb
       LEFT JOIN shelf_boxes_s sbx ON sbx.id = tb.shelf_box_id
       LEFT JOIN boxes_s bx ON bx.id = tb.box_id
       LEFT JOIN pallets_s pa ON pa.id = bx.pallet_id
       LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
       LEFT JOIN employees_s claimant ON claimant.id = tb.claimed_by_employee_id
       WHERE tb.task_id = $1
       ORDER BY tb.sort_order, tb.id`,
      [req.params.id]
    );
    const taskBoxes = taskBoxesResult.rows;
    const hasTaskBoxQueue = taskBoxes.length > 0;

    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id && !(await isTaskWorker(pool, req.params.id, req.user.employee_id))) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (t.status !== 'new' && t.status !== 'in_progress') {
      return res.status(400).json({ error: 'Задача уже завершена' });
    }
    const alreadyStarted = t.status === 'in_progress';

    // For new pallet inventory tasks — validate pallet barcode first, even if task boxes exist
    if (!alreadyStarted && t.task_type === 'inventory' && t.target_pallet_id && !t.shelf_id && !t.target_box_id && !t.target_shelf_box_id) {
      const trimmed = (pallet_barcode || '').trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Необходимо отсканировать штрих-код паллета' });
      }
      if (t.pallet_barcode_expected !== trimmed) {
        return res.status(400).json({ error: 'Штрих-код не совпадает с назначенным паллетом.' });
      }
      await pool.query(
        'UPDATE inventory_tasks_s SET status=$1, started_at=NOW() WHERE id=$2',
        ['in_progress', req.params.id]
      );
      // If pallet uses boxes and no task boxes exist yet, auto-create them
      if (!hasTaskBoxQueue) {
        const palletCheck = await pool.query('SELECT uses_boxes FROM pallets_s WHERE id=$1', [t.target_pallet_id]);
        if (palletCheck.rows[0]?.uses_boxes) {
          const palletBoxes = await pool.query(
            'SELECT id FROM boxes_s WHERE pallet_id=$1 ORDER BY id', [t.target_pallet_id]
          );
          let sortOrder = 1;
          for (const box of palletBoxes.rows) {
            await pool.query(
              `INSERT INTO inventory_task_boxes_s (task_id, box_id, shelf_box_id, sort_order, status)
               VALUES ($1, $2, NULL, $3, 'pending')
               ON CONFLICT DO NOTHING`,
              [req.params.id, box.id, sortOrder++]
            );
          }
        }
      }
    } else if (hasTaskBoxQueue) {
      // Shelf-based tasks with boxes: first scan must be the shelf barcode
      if (!alreadyStarted && t.shelf_id && t.shelf_barcode_expected) {
        const trimmedShelf = (shelf_barcode || '').trim();
        if (!trimmedShelf) {
          return res.status(400).json({ error: 'Необходимо отсканировать штрих-код полки' });
        }
        // Reject rack barcodes
        const rackCheck = await pool.query('SELECT id FROM racks_s WHERE barcode_value = $1', [trimmedShelf]);
        if (rackCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Это штрих-код стеллажа. Отсканируйте штрих-код полки.' });
        }
        if (t.shelf_barcode_expected !== trimmedShelf) {
          return res.status(400).json({ error: 'Штрих-код не совпадает с назначенной полкой.' });
        }
        await pool.query(
          'UPDATE inventory_tasks_s SET status = $1, started_at = NOW() WHERE id = $2',
          ['in_progress', req.params.id]
        );
      } else {
        // Already started (or pallet task with boxes) — scan box barcode
        const trimmed = (box_barcode || '').trim();
        if (!trimmed) {
          return res.status(400).json({ error: 'Необходимо отсканировать штрих-код коробки' });
        }

        const matchedBox = taskBoxes.find(box => box.box_barcode === trimmed);
        if (!matchedBox) {
          // Объясняем, ЧТО именно отсканировали: товар, коробку с другого места или мусор.
          // Иначе кладовщик видит одинаковое «не входит в задачу» на любую ошибку.
          const reason = await classifyUnexpectedScan(pool, trimmed);
          // Отклонённый скан фиксируем — иначе разбирать потом нечего
          await pool.query(
            `INSERT INTO scan_errors_s (task_id, scanned_value, employee_note, user_id)
             VALUES ($1, $2, $3, $4)`,
            [req.params.id, trimmed, reason.note, req.user.id]
          ).catch(() => {});
          return res.status(400).json({ error: reason.message });
        }
        if (matchedBox.status === 'completed') {
          return res.status(400).json({ error: 'Эта коробка уже отмечена в этой задаче.' });
        }
        // Совместная инвентаризация: коробку уже держит другой сотрудник —
        // в одиночной задаче claimed_by_employee_id всегда пуст или наш же.
        if (isMultiWorker && matchedBox.status === 'in_progress'
          && matchedBox.claimed_by_employee_id && Number(matchedBox.claimed_by_employee_id) !== Number(req.user.employee_id)) {
          return res.status(409).json({ error: `Эту коробку сейчас сканирует ${matchedBox.claimed_by_name || 'другой сотрудник'}.` });
        }

        // Перепись коробок: коробка засчитывается сразу, внутрь не заходим
        if (t.inventory_scope === 'boxes') {
          const result = await confirmBoxByScan(pool, {
            task: t,
            taskId: req.params.id,
            taskBoxId: matchedBox.id,
            boxName: matchedBox.box_name || null,
            scannedValue: trimmed,
            alreadyStarted,
            user: req.user,
          });
          return res.json({ success: true, ...result });
        }

        // Одиночная задача: как раньше — любая чужая активная коробка блокирует.
        // Командная задача: блокирует только СВОЯ другая активная коробка —
        // остальные участники держат свои коробки параллельно.
        const activeBox = isMultiWorker
          ? taskBoxes.find(box => box.status === 'in_progress' && Number(box.claimed_by_employee_id) === Number(req.user.employee_id))
          : taskBoxes.find(box => box.status === 'in_progress');
        if (activeBox && activeBox.id !== matchedBox.id) {
          return res.status(400).json({ error: `Сначала завершите текущую коробку ${activeBox.box_barcode}.` });
        }

        if (!alreadyStarted) {
          await pool.query(
            'UPDATE inventory_tasks_s SET status = $1, started_at = NOW() WHERE id = $2',
            ['in_progress', req.params.id]
          );
        }

        if (matchedBox.status !== 'in_progress' || Number(matchedBox.claimed_by_employee_id) !== Number(req.user.employee_id)) {
          await pool.query(
            `UPDATE inventory_task_boxes_s
             SET status = 'in_progress',
                 claimed_by_employee_id = $2,
                 started_at = COALESCE(started_at, NOW())
             WHERE id = $1`,
            [matchedBox.id, req.user.employee_id || null]
          );
        }
      }
    } else if (t.task_type === 'production_transfer') {
      // Must scan pallet barcode
      const trimmed = (pallet_barcode || '').trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Необходимо отсканировать штрих-код паллета' });
      }
      const palletRow = await pool.query(
        'SELECT id FROM pallets_s WHERE barcode_value = $1', [trimmed]
      );
      if (!palletRow.rows.length) {
        return res.status(400).json({ error: 'Паллет с таким штрих-кодом не найден' });
      }
      const palletId = palletRow.rows[0].id;
      await pool.query(
        'UPDATE inventory_tasks_s SET status=$1, started_at=NOW(), target_pallet_id=$2 WHERE id=$3',
        ['in_progress', palletId, req.params.id]
      );
    } else if (t.task_type === 'inventory' && (t.target_box_id || t.target_shelf_box_id)) {
      const trimmed = (box_barcode || '').trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Необходимо отсканировать штрих-код коробки' });
      }
      const expectedBoxBarcode = t.target_shelf_box_id ? t.shelf_box_barcode_expected : t.box_barcode_expected;
      if (expectedBoxBarcode !== trimmed) {
        return res.status(400).json({ error: 'Штрих-код не совпадает с назначенной коробкой.' });
      }
      if (!alreadyStarted) {
        await pool.query(
          'UPDATE inventory_tasks_s SET status=$1, started_at=NOW() WHERE id=$2',
          ['in_progress', req.params.id]
        );
      }
    } else if (t.task_type === 'inventory' && t.target_pallet_id && !t.shelf_id) {
      const trimmed = (pallet_barcode || '').trim();
      if (!trimmed) {
        return res.status(400).json({ error: 'Необходимо отсканировать штрих-код паллета' });
      }
      if (t.pallet_barcode_expected !== trimmed) {
        return res.status(400).json({ error: 'Штрих-код не совпадает с назначенным паллетом.' });
      }
      if (!alreadyStarted) {
          await pool.query(
            'UPDATE inventory_tasks_s SET status=$1, started_at=NOW() WHERE id=$2',
            ['in_progress', req.params.id]
          );

          // If pallet uses boxes, auto-create task boxes for all boxes on this pallet
          const palletCheck = await pool.query('SELECT uses_boxes FROM pallets_s WHERE id=$1', [t.target_pallet_id]);
          if (palletCheck.rows[0]?.uses_boxes) {
            const palletBoxes = await pool.query(
              'SELECT id FROM boxes_s WHERE pallet_id=$1 ORDER BY id', [t.target_pallet_id]
            );
            let sortOrder = 1;
            for (const box of palletBoxes.rows) {
              await pool.query(
                `INSERT INTO inventory_task_boxes_s (task_id, box_id, shelf_box_id, sort_order, status)
                 VALUES ($1, $2, NULL, $3, 'pending')
                 ON CONFLICT DO NOTHING`,
                [req.params.id, box.id, sortOrder++]
              );
            }
            // task_boxes_total is computed from inventory_task_boxes_s count, no need to update
          }
      }
    } else {
      // inventory / default: validate shelf barcode if task has a shelf
      if (t.shelf_id) {
        if (!shelf_barcode || !shelf_barcode.trim()) {
          return res.status(400).json({ error: 'Необходимо отсканировать штрих-код полки' });
        }
        const trimmed = shelf_barcode.trim();

        // Reject rack barcodes
        const rackCheck = await pool.query(
          'SELECT id FROM racks_s WHERE barcode_value = $1', [trimmed]
        );
        if (rackCheck.rows.length > 0) {
          return res.status(400).json({ error: 'Это штрих-код стеллажа. Отсканируйте штрих-код полки.' });
        }

        if (t.shelf_barcode_expected !== trimmed) {
          return res.status(400).json({ error: 'Штрих-код не совпадает с назначенной полкой.' });
        }
      }
      if (!alreadyStarted) {
        await pool.query(
          'UPDATE inventory_tasks_s SET status=$1, started_at=NOW() WHERE id=$2',
          ['in_progress', req.params.id]
        );
      }
      // If already started (multi-shelf continuation), just validate — no status change needed
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/pick-pallet — свободная сверка: сотрудник сам называет паллет
// (штрих-код или название), задача не привязана к паллету заранее. Можно вызывать
// повторно в рамках одной задачи — «следующий паллет» продолжает ту же сессию.
router.post('/:id/pick-pallet', requireAuth, async (req, res) => {
  const { pallet_identifier } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];

    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id && !(await isTaskWorker(client, req.params.id, req.user.employee_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (!t.roam_mode) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Эта задача привязана к конкретному паллету' }); }
    if (t.status !== 'new' && t.status !== 'in_progress') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Задача уже завершена' }); }

    const resolved = await resolvePalletForRoam(client, pallet_identifier);
    if (resolved.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: resolved.error }); }
    const { pallet, boxIds } = resolved;

    const busy = await client.query(
      `SELECT itb.task_id, tt.title FROM inventory_task_boxes_s itb
       JOIN inventory_tasks_s tt ON tt.id = itb.task_id
       WHERE itb.box_id = ANY($1) AND tt.id <> $2 AND tt.status IN ('new','in_progress') AND tt.deleted_at IS NULL LIMIT 1`,
      [boxIds, req.params.id]
    );
    if (busy.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Этот паллет уже сверяется в задаче #${busy.rows[0].task_id} «${busy.rows[0].title}»` });
    }

    await client.query(
      `UPDATE inventory_tasks_s SET target_pallet_id = $1, status = 'in_progress', started_at = COALESCE(started_at, NOW()) WHERE id = $2`,
      [pallet.id, req.params.id]
    );

    const sortBase = await client.query('SELECT COALESCE(MAX(sort_order), 0) as m FROM inventory_task_boxes_s WHERE task_id = $1', [req.params.id]);
    let sortOrder = Number(sortBase.rows[0].m) + 1;
    for (const boxId of boxIds) {
      await client.query(
        `INSERT INTO inventory_task_boxes_s (task_id, box_id, sort_order, status) VALUES ($1, $2, $3, 'pending') ON CONFLICT DO NOTHING`,
        [req.params.id, boxId, sortOrder++]
      );
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      pallet: { id: pallet.id, name: pallet.name, number: pallet.number, row_number: pallet.row_number, row_name: pallet.row_name, barcode_value: pallet.barcode_value },
      boxes_added: boxIds.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/log-scan — lightweight scan log for returns (no inventory changes)
router.post('/:id/log-scan', requireAuth, scanLimiter, async (req, res) => {
  const { scanned_value, product_id } = req.body;
  if (!scanned_value) return res.status(400).json({ error: 'scanned_value обязателен' });
  try {
    const task = await pool.query('SELECT id, task_type FROM inventory_tasks_s WHERE id = $1', [req.params.id]);
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    // Resolve product from barcode if product_id not provided
    let prodId = product_id || null;
    if (!prodId && scanned_value) {
      const pr = await pool.query(
        `SELECT id FROM products_s WHERE $1 = ANY(string_to_array(barcode_list, ';')) OR production_barcode = $1 ORDER BY id LIMIT 1`,
        [scanned_value]);
      if (pr.rows.length) prodId = pr.rows[0].id;
    }

    await pool.query(
      `INSERT INTO inventory_task_scans_s (task_id, product_id, scanned_value, quantity_delta, employee_id) VALUES ($1, $2, $3, 1, $4)`,
      [req.params.id, prodId, scanned_value, req.user.employee_id || null]);
    await pool.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [req.params.id]);
    emitScanEvent(req.params.id, { scanned_value, product_id: prodId });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:id/scan — scan a product barcode
router.post('/:id/scan', requireAuth, scanLimiter, async (req, res) => {
  const { scanned_value, quantity_delta = 1 } = req.body;
  if (!scanned_value || typeof scanned_value !== 'string') return res.status(400).json({ error: 'scanned_value обязателен' });
  if (scanned_value.length > 200) return res.status(400).json({ error: 'scanned_value слишком длинный' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;

    // Lock task row to prevent concurrent scan deadlocks
    const task = await client.query(
      'SELECT * FROM inventory_tasks_s WHERE id = $1 FOR UPDATE', [taskId]
    );
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }

    const t = task.rows[0];

    // Pre-lock employee row to ensure consistent lock ordering (task → employee → insert)
    if (t.employee_id) {
      await client.query('SELECT id FROM employees_s WHERE id = $1 FOR UPDATE', [t.employee_id]);
    }

    const taskBoxes = await client.query(
      `SELECT tb.id, tb.status, tb.shelf_box_id, tb.box_id, tb.claimed_by_employee_id,
              COALESCE(sbx.barcode_value, bx.barcode_value) as box_barcode
       FROM inventory_task_boxes_s tb
       LEFT JOIN shelf_boxes_s sbx ON sbx.id = tb.shelf_box_id
       LEFT JOIN boxes_s bx ON bx.id = tb.box_id
       WHERE tb.task_id = $1
       ORDER BY tb.sort_order, tb.id`,
      [taskId]
    );
    // Командная задача: моя активная коробка — та, что я держу (claimed_by).
    // null у claimed_by — старые строки/одиночная задача, там активная коробка одна на всех.
    const activeTaskBox = taskBoxes.rows.find(row => row.status === 'in_progress'
      && (row.claimed_by_employee_id == null || Number(row.claimed_by_employee_id) === Number(req.user.employee_id))) || null;
    const hasTaskBoxQueue = taskBoxes.rows.length > 0;

    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id && !(await isTaskWorker(pool, req.params.id, req.user.employee_id))) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (t.status !== 'in_progress') {
      return res.status(400).json({ error: 'Задача не в состоянии "в работе"' });
    }
    // Check if employee is on a break
    if (t.employee_id) {
      const activeBreak = await client.query(
        'SELECT id, break_type FROM employee_breaks_s WHERE employee_id = $1 AND ended_at IS NULL LIMIT 1',
        [t.employee_id]);
      if (activeBreak.rows.length) {
        const bt = activeBreak.rows[0].break_type;
        const label = bt === 'lunch' ? 'обеде' : bt === 'rest' ? 'отдыхе' : 'тех. паузе';
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Вы на ${label}. Завершите перерыв, чтобы продолжить сканирование` });
      }
    }
    if (t.inventory_scope === 'boxes') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'В этой задаче сканируются только коробки — товар внутри считать не нужно.' });
    }
    if (hasTaskBoxQueue && !activeTaskBox) {
      return res.status(400).json({ error: 'Сначала отсканируйте коробку из этой инвентаризации.' });
    }

    // Find product — check ALL barcode fields.
    // ШК из shared-исключений может принадлежать нескольким товарам —
    // тогда выбираем товар из контекста задачи (коробка/полка).
    const product = await client.query(
      `SELECT id, external_id, name, code, production_barcode
       FROM products_s
       WHERE $1 = ANY(string_to_array(barcode_list, ';'))
          OR production_barcode = $1
          OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
       ORDER BY id
       LIMIT 5`,
      [scanned_value]
    );

    let productRow = product.rows[0] || null;
    if (product.rows.length > 1) {
      const matchIds = product.rows.map(r => r.id);
      let preferred = [];
      if (activeTaskBox?.shelf_box_id) {
        const r = await client.query(
          'SELECT product_id FROM shelf_box_items_s WHERE shelf_box_id = $1 AND product_id = ANY($2)',
          [activeTaskBox.shelf_box_id, matchIds]);
        preferred = r.rows.map(x => x.product_id);
      } else if (activeTaskBox?.box_id) {
        const r = await client.query(
          'SELECT product_id FROM box_items_s WHERE box_id = $1 AND product_id = ANY($2)',
          [activeTaskBox.box_id, matchIds]);
        preferred = r.rows.map(x => x.product_id);
      } else if (t.shelf_id) {
        const r = await client.query(
          'SELECT product_id FROM shelf_items_s WHERE shelf_id = $1 AND product_id = ANY($2)',
          [t.shelf_id, matchIds]);
        preferred = r.rows.map(x => x.product_id);
      }
      productRow = pickPreferredProduct(product.rows, preferred);
    }
    if (!productRow) {
      // Smart scan error classification
      const val = scanned_value;
      const hasCyrillic = /[а-яА-ЯёЁ]/.test(val);
      const isUrl = /^https?:\/\//i.test(val);
      // Detect repeated barcode: "400000000183400000000183" → "400000000183"
      let deduped = null;
      if (!hasCyrillic && !isUrl && val.length >= 12) {
        for (let len = 6; len <= Math.floor(val.length / 2); len++) {
          const chunk = val.substring(0, len);
          if (val === chunk.repeat(Math.round(val.length / len)) || val.startsWith(chunk + chunk)) {
            deduped = chunk;
            break;
          }
        }
      }
      const isPartial = !hasCyrillic && !isUrl && !deduped && /^\d+$/.test(val) && val.length < 6;

      // If repeated barcode detected — NEVER count, always warn
      if (deduped) {
        await client.query('COMMIT');
        return res.json({ found: false, scanned_value: deduped, hint: 'duplicate_scan',
          message: 'ШК отсканирован несколько раз подряд. Отсканируйте повторно, один раз.' });
      }

      if (!productRow) {
        if (hasCyrillic) {
          await client.query('COMMIT');
          return res.json({ found: false, scanned_value, hint: 'keyboard_layout',
            message: 'Переключите раскладку клавиатуры на английскую (EN) и попробуйте ещё раз' });
        }
        if (isUrl) {
          await client.query('COMMIT');
          return res.json({ found: false, scanned_value, hint: 'url_scanned',
            message: 'Вы отсканировали QR-код с ссылкой на сайт. Сканируйте штрих-код на упаковке товара — он с цифрами' });
        }
        if (isPartial) {
          await client.query('COMMIT');
          return res.json({ found: false, scanned_value, hint: 'partial_scan',
            message: 'Штрих-код считался не полностью (' + val.length + ' цифр). Поднесите сканер ровнее и попробуйте ещё раз' });
        }

        // Regular unknown barcode — save to errors
        const errorResult = await client.query(
          `INSERT INTO scan_errors_s (task_id, task_box_id, scanned_value, employee_note, user_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [taskId, activeTaskBox?.id || null, scanned_value, null, req.user.id]
        );
        await client.query('COMMIT');
        return res.json({ found: false, scanned_value, error_id: errorResult.rows[0].id });
      }
    }

    const scanInsert = await client.query(
      `INSERT INTO inventory_task_scans_s (task_id, task_box_id, product_id, product_external_id, scanned_value, quantity_delta, shelf_id, employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id`,
      [taskId, activeTaskBox?.id || null, productRow.id, productRow.external_id || null, scanned_value, parseFloat(quantity_delta), t.shelf_id || null, req.user.employee_id || null]
    );

    // Increment denormalized scan count
    await client.query('UPDATE inventory_tasks_s SET scans_count = scans_count + 1 WHERE id = $1', [taskId]);

    const reward = await awardScanReward(client, {
      task: { ...t, id: Number(taskId) },
      taskScanId: scanInsert.rows[0].id,
      activeTaskBox,
      productId: productRow.id,
      quantityDelta: parseFloat(quantity_delta),
      user: req.user,
    });

    await client.query('COMMIT');
    res.json({ found: true, product: productRow, quantity_delta: parseFloat(quantity_delta), reward: reward || undefined });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/report-error — employee reports unknown barcode
router.post('/:id/report-error', requireAuth, async (req, res) => {
  const { scanned_value, employee_note, error_id } = req.body;
  if (!scanned_value) return res.status(400).json({ error: 'scanned_value обязателен' });
  try {
    if (error_id) {
      const updated = await pool.query(
        `UPDATE scan_errors_s
         SET employee_note = COALESCE($1, employee_note)
         WHERE id = $2 AND task_id = $3
         RETURNING *`,
        [employee_note || null, error_id, req.params.id]
      );
      if (updated.rows.length) return res.json(updated.rows[0]);
    }
    const result = await pool.query(
      `INSERT INTO scan_errors_s (task_id, task_box_id, scanned_value, employee_note, user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, null, scanned_value, employee_note || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tasks/:id/abandon-box — exit current box without completing
router.post('/:id/abandon-box', requireAuth, async (req, res) => {
  const { task_box_id } = req.body;
  try {
    if (task_box_id) {
      await pool.query(
        `UPDATE inventory_task_boxes_s SET status = 'pending', started_at = NULL, claimed_by_employee_id = NULL WHERE id = $1 AND task_id = $2`,
        [task_box_id, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/tasks/:id/complete
router.post('/:id/complete', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;

    const task = await client.query(
      `SELECT t.*, (SELECT COUNT(*) FROM inventory_task_workers_s w WHERE w.task_id = t.id) as worker_count
       FROM inventory_tasks_s t WHERE t.id = $1`, [taskId]
    );
    if (!task.rows.length) return res.status(404).json({ error: 'Задача не найдена' });
    const t = task.rows[0];
    const isMultiWorker = Number(t.worker_count || 0) > 1;

    if (req.user.role !== 'admin' && !(req.user.permissions || []).includes('tasks.view') && !(req.user.permissions || []).includes('tasks.create') && t.employee_id !== req.user.employee_id && !(await isTaskWorker(pool, req.params.id, req.user.employee_id))) {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    if (t.status !== 'in_progress') {
      return res.status(400).json({ error: 'Задача не в состоянии "в работе"' });
    }

    const taskBoxes = await getTaskBoxRows(client, taskId);

    // Перепись коробок: содержимое не пересчитываем, задачу можно закрыть
    // и с недостающими коробками — они останутся 'pending' в отчёте.
    if (t.inventory_scope === 'boxes') {
      const confirmedBoxes = taskBoxes.filter(row => row.status === 'completed').length;
      const missingBoxes = taskBoxes.length - confirmedBoxes;
      await client.query(
        'UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2',
        ['completed', taskId]
      );
      const graRes = await client.query(
        `SELECT COALESCE(SUM(amount_delta), 0) as gra_earned FROM employee_earnings_s WHERE task_id = $1`, [taskId]);
      await client.query('COMMIT');
      emitTaskCompleted(taskId, { title: t.title, task_type: t.task_type });
      return res.json({
        success: true,
        task_completed: true,
        confirmed_boxes: confirmedBoxes,
        missing_boxes: missingBoxes,
        total_boxes: taskBoxes.length,
        stats: {
          total_scans: confirmedBoxes,
          unique_products: 0,
          gra_earned: Number(graRes.rows[0]?.gra_earned || 0),
        },
      });
    }

    if (taskBoxes.length > 0) {
      // Командная задача: «моя» активная коробка — та, что держу я;
      // остальные держат свои параллельно и не мешают моему прогрессу.
      const activeTaskBox = taskBoxes.find(row => row.status === 'in_progress'
        && (row.claimed_by_employee_id == null || Number(row.claimed_by_employee_id) === Number(req.user.employee_id)));
      const allBoxesCompleted = taskBoxes.every(row => row.status === 'completed');

      // All boxes already completed — finish the task
      if (!activeTaskBox && allBoxesCompleted) {
        await client.query(
          'UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2',
          ['completed', taskId]
        );
        await client.query('COMMIT');
        return res.json({
          success: true,
          task_completed: true,
          completed_boxes: taskBoxes.length,
          total_boxes: taskBoxes.length,
        });
      }

      if (!activeTaskBox) {
        // Команда: у меня сейчас нет своей коробки — не ошибка, просто жду
        // остальных или беру следующую свободную. Одиночная задача — как раньше.
        if (isMultiWorker) {
          await client.query('ROLLBACK');
          const completedCount = taskBoxes.filter(row => row.status === 'completed').length;
          return res.json({
            success: true,
            task_completed: false,
            waiting_for_team: true,
            completed_boxes: completedCount,
            total_boxes: taskBoxes.length,
          });
        }
        return res.status(400).json({ error: 'Сначала отсканируйте следующую коробку из этой задачи.' });
      }

      if (activeTaskBox.shelf_box_id) {
        await applyInventoryToShelfBox(client, activeTaskBox.shelf_box_id, t.shelf_id, taskId, req.user.id, activeTaskBox.id);
      } else {
        await applyInventoryToBox(client, activeTaskBox.box_id, t.target_pallet_id, taskId, req.user.id, activeTaskBox.id);
      }

      await client.query(
        `UPDATE inventory_task_boxes_s
         SET status = 'completed',
             completed_at = NOW()
         WHERE id = $1`,
        [activeTaskBox.id]
      );

      const progressResult = await client.query(
        `SELECT
           COUNT(*) as total_count,
           COUNT(*) FILTER (WHERE status = 'completed') as completed_count
         FROM inventory_task_boxes_s
         WHERE task_id = $1`,
        [taskId]
      );
      const totalCount = Number(progressResult.rows[0]?.total_count || 0);
      const completedCount = Number(progressResult.rows[0]?.completed_count || 0);
      const taskCompleted = totalCount > 0 && completedCount >= totalCount;

      if (taskCompleted) {
        await client.query(
          'UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2',
          ['completed', taskId]
        );
      }

      await client.query('COMMIT');
      return res.json({
        success: true,
        box_completed: true,
        task_completed: taskCompleted,
        completed_boxes: completedCount,
        total_boxes: totalCount,
        next_box_required: !taskCompleted,
      });
    }

    if (t.target_shelf_box_id) {
      await applyInventoryToShelfBox(client, t.target_shelf_box_id, t.shelf_id, taskId, req.user.id);
    } else if (t.target_box_id) {
      await applyInventoryToBox(client, t.target_box_id, t.target_pallet_id, taskId, req.user.id);
    } else if (t.shelf_id) {
      // Tag untagged scans with current shelf
      await client.query(
        `UPDATE inventory_task_scans_s SET shelf_id = $1 WHERE task_id = $2 AND shelf_id IS NULL`,
        [t.shelf_id, taskId]
      );

      // For multi-shelf tasks, only count scans for the CURRENT shelf
      const isMultiShelf = t.shelf_ids && Array.isArray(t.shelf_ids) && t.shelf_ids.length > 1;
      const shelfFilter = isMultiShelf ? `AND shelf_id = ${parseInt(t.shelf_id)}` : '';

      const scanTotals = await client.query(
        `SELECT product_id, SUM(quantity_delta) as total_qty
         FROM inventory_task_scans_s
         WHERE task_id = $1 AND product_id IS NOT NULL ${shelfFilter}
         GROUP BY product_id`,
        [taskId]
      );

      for (const row of scanTotals.rows) {
        const current = await client.query(
          'SELECT quantity FROM shelf_items_s WHERE shelf_id=$1 AND product_id=$2',
          [t.shelf_id, row.product_id]
        );
        const prevQty = current.rows.length ? parseFloat(current.rows[0].quantity) : 0;
        const newQty = parseFloat(row.total_qty);

        await client.query(
          `INSERT INTO shelf_items_s (shelf_id, product_id, quantity, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,NOW())
           ON CONFLICT (shelf_id, product_id) DO UPDATE SET quantity=$3, updated_by=$4, updated_at=NOW()`,
          [t.shelf_id, row.product_id, newQty, req.user.id]
        );

        await client.query(
          `INSERT INTO shelf_movements_s (shelf_id, product_id, operation_type, quantity_before, quantity_after, quantity_delta, user_id, task_id)
           VALUES ($1,$2,'inventory',$3,$4,$5,$6,$7)`,
          [t.shelf_id, row.product_id, prevQty, newQty, newQty - prevQty, req.user.id, taskId]
        );
      }
    } else if (t.target_pallet_id) {
      await applyInventoryToPallet(client, t.target_pallet_id, taskId, req.user.id);
    }

    await client.query(
      'UPDATE inventory_tasks_s SET status=$1, completed_at=NOW() WHERE id=$2',
      ['completed', taskId]
    );

    // Gather completion stats
    const scanStats = await client.query(
      `SELECT COUNT(*) as total_scans, COUNT(DISTINCT product_id) as unique_products
       FROM inventory_task_scans_s WHERE task_id = $1 AND product_id IS NOT NULL`, [taskId]);
    const graRes = await client.query(
      `SELECT COALESCE(SUM(amount_delta), 0) as gra_earned FROM employee_earnings_s WHERE task_id = $1`, [taskId]);

    await client.query('COMMIT');
    emitTaskCompleted(taskId, { title: t.title, task_type: t.task_type });
    res.json({
      success: true,
      task_completed: true,
      stats: {
        total_scans: Number(scanStats.rows[0]?.total_scans || 0),
        unique_products: Number(scanStats.rows[0]?.unique_products || 0),
        gra_earned: Number(graRes.rows[0]?.gra_earned || 0),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/finish-my-part — командная задача: «у меня коробок больше нет».
// Отпускает мою незавершённую коробку (если держал) обратно в pending — она не
// отсканирована до конца, отдавать её в отчёт как «сделанную» нельзя. Когда так
// отметились ВСЕ исполнители, задача завершается сама — харвестится то, что кто-то
// ещё держал на этот момент, остальное остаётся нетронутым.
router.post('/:id/finish-my-part', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 FOR UPDATE', [taskId]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];

    if (!req.user.employee_id || !(await isTaskWorker(client, taskId, req.user.employee_id))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Вы не в команде этой задачи' });
    }
    if (t.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не в состоянии "в работе"' });
    }

    // Моя коробка, которую не успел досканировать — назад в pending, без применения остатков
    await client.query(
      `UPDATE inventory_task_boxes_s
       SET status = 'pending', started_at = NULL, claimed_by_employee_id = NULL
       WHERE task_id = $1 AND claimed_by_employee_id = $2 AND status = 'in_progress'`,
      [taskId, req.user.employee_id]
    );

    await client.query(
      `UPDATE inventory_task_workers_s SET finished_at = NOW(), finished_by = 'self' WHERE task_id = $1 AND employee_id = $2`,
      [taskId, req.user.employee_id]
    );

    const everyoneDone = await allWorkersFinished(client, taskId);
    let harvest = null;
    if (everyoneDone) {
      harvest = await finalizeTeamTaskBoxes(client, t, taskId, req.user.id);
      await client.query('UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2', ['completed', taskId]);
    }

    await client.query('COMMIT');
    if (everyoneDone) emitTaskCompleted(taskId, { title: t.title, task_type: t.task_type });
    res.json({ success: true, task_completed: everyoneDone, ...(harvest || {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/finish-worker/:employeeId — админ отмечает «у него всё» за сотрудника
// (не дошёл до личного кабинета, ушёл домой и т.п.) — та же логика, что finish-my-part.
router.post('/:id/finish-worker/:employeeId', requireAuth, requirePermission('tasks.create', 'tasks.view'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;
    const employeeId = parseInt(req.params.employeeId, 10);
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 FOR UPDATE', [taskId]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];

    if (!(await isTaskWorker(client, taskId, employeeId))) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Этот сотрудник не в команде задачи' });
    }
    if (t.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не в состоянии "в работе"' });
    }

    await client.query(
      `UPDATE inventory_task_boxes_s
       SET status = 'pending', started_at = NULL, claimed_by_employee_id = NULL
       WHERE task_id = $1 AND claimed_by_employee_id = $2 AND status = 'in_progress'`,
      [taskId, employeeId]
    );

    await client.query(
      `UPDATE inventory_task_workers_s SET finished_at = NOW(), finished_by = 'admin' WHERE task_id = $1 AND employee_id = $2`,
      [taskId, employeeId]
    );

    const everyoneDone = await allWorkersFinished(client, taskId);
    let harvest = null;
    if (everyoneDone) {
      harvest = await finalizeTeamTaskBoxes(client, t, taskId, req.user.id);
      await client.query('UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2', ['completed', taskId]);
    }

    await client.query('COMMIT');
    if (everyoneDone) emitTaskCompleted(taskId, { title: t.title, task_type: t.task_type });
    res.json({ success: true, task_completed: everyoneDone, ...(harvest || {}) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/tasks/:id/force-complete — админ завершает задачу немедленно, независимо
// от того, кто что отметил. Харвестит все коробки, которые кто-то держал (in_progress),
// нетронутые (pending) остаются как были — «применяется то, что успели сделать».
router.post('/:id/force-complete', requireAuth, requirePermission('tasks.create', 'tasks.view'), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const taskId = req.params.id;
    const task = await client.query('SELECT * FROM inventory_tasks_s WHERE id = $1 FOR UPDATE', [taskId]);
    if (!task.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Задача не найдена' }); }
    const t = task.rows[0];
    if (t.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Задача не в состоянии "в работе"' });
    }

    const harvest = await finalizeTeamTaskBoxes(client, t, taskId, req.user.id);
    await client.query('UPDATE inventory_tasks_s SET status = $1, completed_at = NOW() WHERE id = $2', ['completed', taskId]);
    await client.query(
      `UPDATE inventory_task_workers_s SET finished_at = COALESCE(finished_at, NOW()), finished_by = COALESCE(finished_by, 'admin') WHERE task_id = $1`,
      [taskId]
    );

    await client.query('COMMIT');
    emitTaskCompleted(taskId, { title: t.title, task_type: t.task_type });
    res.json({ success: true, task_completed: true, ...harvest });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.awardScanReward = awardScanReward;

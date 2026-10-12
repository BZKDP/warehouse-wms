// Единый каскад удаления склада — используется и стеллажным (routes/warehouse.js),
// и паллетным (routes/fbo.js) роутами. Логика одна: сначала занулить/снять ссылки
// истории и задач, потом удалить структуру снизу вверх, потом сам склад.

// В старых БД shelf_movements_s.shelf_id был NOT NULL: занулить ссылку нельзя,
// и удаление склада падало. Схема это чинит при старте, но если миграция ещё
// не прошла (не дали лок) — удаляем историю по этим полкам, чтобы склад всё
// равно удалился. Результат кэшируется до рестарта процесса.
let shelfMovementsNullable = null;
async function isShelfMovementsShelfIdNullable(client) {
  if (shelfMovementsNullable !== null) return shelfMovementsNullable;
  const { rows } = await client.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'shelf_movements_s' AND column_name = 'shelf_id'`
  );
  shelfMovementsNullable = rows[0]?.is_nullable === 'YES';
  return shelfMovementsNullable;
}

// Nullify FK refs in history/logs/tasks before cascade delete
async function nullifyShelfRefs(client, shelfIds) {
  if (!shelfIds.length) return;
  await client.query('UPDATE inventory_tasks_s SET shelf_id=NULL WHERE shelf_id=ANY($1)', [shelfIds]);
  await client.query('UPDATE inventory_tasks_s SET dest_shelf_id=NULL WHERE dest_shelf_id=ANY($1)', [shelfIds]);
  await client.query('UPDATE assembly_items_s SET source_shelf_id=NULL WHERE source_shelf_id=ANY($1)', [shelfIds]);
  await client.query('UPDATE movements_s SET from_shelf_id=NULL WHERE from_shelf_id=ANY($1)', [shelfIds]);
  await client.query('UPDATE movements_s SET to_shelf_id=NULL WHERE to_shelf_id=ANY($1)', [shelfIds]);
  await client.query('UPDATE employee_earnings_s SET shelf_id=NULL WHERE shelf_id=ANY($1)', [shelfIds]);
  if (await isShelfMovementsShelfIdNullable(client)) {
    await client.query('UPDATE shelf_movements_s SET shelf_id=NULL WHERE shelf_id=ANY($1)', [shelfIds]);
  } else {
    await client.query('DELETE FROM shelf_movements_s WHERE shelf_id=ANY($1)', [shelfIds]);
  }
  await client.query('UPDATE boxes_s SET remainder_shelf_id=NULL WHERE remainder_shelf_id=ANY($1)', [shelfIds]);
}

async function nullifyShelfBoxRefs(client, sboxIds) {
  if (!sboxIds.length) return;
  // Строку задачи не удаляем — только снимаем привязку к исчезающей коробке.
  // Так сохраняются сканы, начисления и история задачи (см. schema.js: CHECK
  // допускает строку без цели, FK переведены на ON DELETE SET NULL).
  await client.query('UPDATE inventory_task_boxes_s SET shelf_box_id=NULL WHERE shelf_box_id=ANY($1)', [sboxIds]);
  await client.query('UPDATE inventory_tasks_s SET target_shelf_box_id=NULL WHERE target_shelf_box_id=ANY($1)', [sboxIds]);
  await client.query('UPDATE employee_earnings_s SET shelf_box_id=NULL WHERE shelf_box_id=ANY($1)', [sboxIds]);
  await client.query('UPDATE movements_s SET from_shelf_box_id=NULL WHERE from_shelf_box_id=ANY($1)', [sboxIds]);
  await client.query('UPDATE movements_s SET to_shelf_box_id=NULL WHERE to_shelf_box_id=ANY($1)', [sboxIds]);
  await client.query('UPDATE boxes_s SET remainder_shelf_box_id=NULL WHERE remainder_shelf_box_id=ANY($1)', [sboxIds]);
}

async function nullifyBoxRefs(client, boxIds) {
  if (!boxIds.length) return;
  await client.query('UPDATE inventory_tasks_s SET target_box_id=NULL WHERE target_box_id=ANY($1)', [boxIds]);
  await client.query('UPDATE inventory_task_boxes_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
  await client.query('UPDATE assembly_items_s SET source_box_id=NULL WHERE source_box_id=ANY($1)', [boxIds]);
  await client.query('UPDATE movements_s SET from_box_id=NULL WHERE from_box_id=ANY($1)', [boxIds]);
  await client.query('UPDATE movements_s SET to_box_id=NULL WHERE to_box_id=ANY($1)', [boxIds]);
  await client.query('UPDATE employee_earnings_s SET box_id=NULL WHERE box_id=ANY($1)', [boxIds]);
}

async function nullifyPalletRefs(client, palletIds) {
  if (!palletIds.length) return;
  await client.query('UPDATE inventory_tasks_s SET target_pallet_id=NULL WHERE target_pallet_id=ANY($1)', [palletIds]);
  await client.query('UPDATE inventory_tasks_s SET dest_pallet_id=NULL WHERE dest_pallet_id=ANY($1)', [palletIds]);
  await client.query('UPDATE assembly_items_s SET source_pallet_id=NULL WHERE source_pallet_id=ANY($1)', [palletIds]);
  await client.query('UPDATE movements_s SET from_pallet_id=NULL WHERE from_pallet_id=ANY($1)', [palletIds]);
  await client.query('UPDATE movements_s SET to_pallet_id=NULL WHERE to_pallet_id=ANY($1)', [palletIds]);
}

// Остаток и объём структуры склада — для модалки удаления и для проверки force.
async function getWarehouseDeletionImpact(client, warehouseId, lockWarehouse = false) {
  const warehouse = await client.query(
    `SELECT id, name, warehouse_type
       FROM warehouses_s
      WHERE id = $1
      ${lockWarehouse ? 'FOR UPDATE' : ''}`,
    [warehouseId]
  );
  if (!warehouse.rows.length) return null;

  const result = await client.query(
    `WITH target_racks AS (
       SELECT id FROM racks_s WHERE warehouse_id = $1
     ),
     target_shelves AS (
       SELECT s.id
         FROM shelves_s s
        WHERE s.rack_id IN (SELECT id FROM target_racks)
     ),
     target_shelf_boxes AS (
       SELECT sb.id, sb.quantity
         FROM shelf_boxes_s sb
        WHERE sb.shelf_id IN (SELECT id FROM target_shelves)
     ),
     target_rows AS (
       SELECT id FROM pallet_rows_s WHERE warehouse_id = $1
     ),
     target_pallets AS (
       SELECT p.id
         FROM pallets_s p
        WHERE p.row_id IN (SELECT id FROM target_rows)
     ),
     target_boxes AS (
       SELECT b.id, b.quantity
         FROM boxes_s b
        WHERE b.warehouse_id = $1
           OR b.pallet_id IN (SELECT id FROM target_pallets)
     ),
     shelf_box_stock AS (
       SELECT tsb.id,
              COALESCE(
                (SELECT SUM(GREATEST(sbi.quantity, 0))
                   FROM shelf_box_items_s sbi
                  WHERE sbi.shelf_box_id = tsb.id),
                GREATEST(COALESCE(tsb.quantity, 0), 0)
              ) AS quantity
         FROM target_shelf_boxes tsb
     ),
     box_stock AS (
       SELECT tb.id,
              COALESCE(
                (SELECT SUM(GREATEST(bi.quantity, 0))
                   FROM box_items_s bi
                  WHERE bi.box_id = tb.id),
                GREATEST(COALESCE(tb.quantity, 0), 0)
              ) AS quantity
         FROM target_boxes tb
     )
     SELECT
       (SELECT COUNT(*) FROM target_racks) AS racks_count,
       (SELECT COUNT(*) FROM target_shelves) AS shelves_count,
       (SELECT COUNT(*) FROM target_shelf_boxes) AS shelf_boxes_count,
       (SELECT COUNT(*) FROM target_rows) AS rows_count,
       (SELECT COUNT(*) FROM target_pallets) AS pallets_count,
       (SELECT COUNT(*) FROM target_boxes) AS boxes_count,
       (
         COALESCE((
           SELECT SUM(GREATEST(si.quantity, 0))
             FROM shelf_items_s si
            WHERE si.shelf_id IN (SELECT id FROM target_shelves)
         ), 0)
         + COALESCE((SELECT SUM(quantity) FROM shelf_box_stock), 0)
         + COALESCE((
           SELECT SUM(GREATEST(pi.quantity, 0))
             FROM pallet_items_s pi
            WHERE pi.pallet_id IN (SELECT id FROM target_pallets)
         ), 0)
         + COALESCE((SELECT SUM(quantity) FROM box_stock), 0)
       ) AS total_stock`,
    [warehouseId]
  );

  const row = result.rows[0];
  const totalStock = Number(row.total_stock || 0);
  return {
    warehouse: warehouse.rows[0],
    has_stock: totalStock > 0,
    total_stock: totalStock,
    racks_count: Number(row.racks_count || 0),
    shelves_count: Number(row.shelves_count || 0),
    shelf_boxes_count: Number(row.shelf_boxes_count || 0),
    rows_count: Number(row.rows_count || 0),
    pallets_count: Number(row.pallets_count || 0),
    boxes_count: Number(row.boxes_count || 0),
  };
}

// Полное удаление склада вместе со структурой. Вызывать внутри транзакции.
async function deleteWarehouseCascade(client, warehouseId) {
  // Стеллажная часть: shelf_box_items → shelf_boxes → shelf_items → shelves → racks
  const racks = await client.query('SELECT id FROM racks_s WHERE warehouse_id=$1', [warehouseId]);
  const rackIds = racks.rows.map(r => r.id);
  if (rackIds.length) {
    const shelves = await client.query('SELECT id FROM shelves_s WHERE rack_id = ANY($1)', [rackIds]);
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
      await client.query('DELETE FROM shelves_s WHERE id = ANY($1)', [shelfIds]);
    }
  }
  await client.query('DELETE FROM racks_s WHERE warehouse_id=$1', [warehouseId]);

  // Паллетная часть: rows → pallets → boxes → items
  const rows = await client.query('SELECT id FROM pallet_rows_s WHERE warehouse_id=$1', [warehouseId]);
  const rowIds = rows.rows.map(r => r.id);
  let palletIds = [];
  if (rowIds.length) {
    const pallets = await client.query('SELECT id FROM pallets_s WHERE row_id = ANY($1)', [rowIds]);
    palletIds = pallets.rows.map(p => p.id);
    if (palletIds.length) {
      await nullifyPalletRefs(client, palletIds);
      await client.query('DELETE FROM pallet_items_s WHERE pallet_id = ANY($1)', [palletIds]);
    }
  }

  // Коробки могут находиться как на паллетах, так и напрямую на складе типа box.
  const boxes = palletIds.length
    ? await client.query(
      'SELECT id FROM boxes_s WHERE warehouse_id = $1 OR pallet_id = ANY($2)',
      [warehouseId, palletIds]
    )
    : await client.query('SELECT id FROM boxes_s WHERE warehouse_id = $1', [warehouseId]);
  const boxIds = boxes.rows.map(b => b.id);
  if (boxIds.length) {
    await nullifyBoxRefs(client, boxIds);
    await client.query('DELETE FROM box_items_s WHERE box_id = ANY($1)', [boxIds]);
    await client.query('DELETE FROM boxes_s WHERE id = ANY($1)', [boxIds]);
  }

  if (palletIds.length) {
    await client.query('DELETE FROM pallets_s WHERE id = ANY($1)', [palletIds]);
  }
  await client.query('DELETE FROM pallet_rows_s WHERE warehouse_id=$1', [warehouseId]);
  await client.query('DELETE FROM warehouses_s WHERE id=$1', [warehouseId]);
}

// Удаление склада целиком: своя транзакция, проверка остатка и повтор при
// взаимной блокировке (кладовщики параллельно пишут в те же таблицы).
// Возвращает { ok, code, impact } — роуту остаётся только отдать ответ.
async function deleteWarehouseTransactional(pool, warehouseId, { force = false, attempts = 3 } = {}) {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const impact = await getWarehouseDeletionImpact(client, warehouseId, true);
      if (!impact) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'NOT_FOUND' };
      }
      if (impact.has_stock && !force) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'WAREHOUSE_HAS_STOCK', impact };
      }
      await deleteWarehouseCascade(client, warehouseId);
      await client.query('COMMIT');
      return { ok: true, impact };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // 40P01 — deadlock, 40001 — serialization failure: конфликт с текущей работой склада
      if ((err.code === '40P01' || err.code === '40001') && attempt < attempts) {
        console.log(`[warehouse] Удаление склада ${warehouseId}: попытка ${attempt} — ${err.message}, повтор`);
        await new Promise(r => setTimeout(r, 300 * attempt));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  nullifyShelfRefs,
  nullifyShelfBoxRefs,
  nullifyBoxRefs,
  nullifyPalletRefs,
  getWarehouseDeletionImpact,
  deleteWarehouseCascade,
  deleteWarehouseTransactional,
};

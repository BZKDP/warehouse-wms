// Исключения: один и тот же ШК разрешён сразу на нескольких товарах.
// Это НЕ общее правило склада — точечные случаи. Пример: новый и старый
// товар временно проводятся по одной этикетке, пока для второго нет этикеток.
// Формат: { barcode, productIds } — делить ШК могут ТОЛЬКО перечисленные товары.
const SHARED_BARCODE_EXCEPTIONS = [
  // 400000000282: старый (id 28) и новый (id 192) товар, этикетки одни на двоих
  { barcode: '400000000282', productIds: [28, 192] },
];

// Решение, принятое оператором в разделе «Спорные данные», имеет приоритет
// над временным исключением. Кэш заполняется при старте и после каждого
// решения; текущий production работает в одном процессе PM2.
const ownershipOverrides = new Map();

async function refreshBarcodeOwnershipCache(db) {
  try {
    const result = await db.query('SELECT barcode, product_id FROM barcode_ownership_s');
    ownershipOverrides.clear();
    for (const row of result.rows) ownershipOverrides.set(String(row.barcode), Number(row.product_id));
  } catch (err) {
    // До авто-миграции таблицы может ещё не быть. Исключения продолжают
    // работать по старому правилу, а следующий вызов заполнит кэш.
    if (err.code !== '42P01') throw err;
  }
}

// Можно ли добавить barcode товару targetId, если он уже есть у товаров ownerIds:
// и целевой товар, и все текущие владельцы должны быть в списке исключения.
function isSharedBarcodeAllowed(barcode, targetId, ownerIds = []) {
  const bc = String(barcode).trim();
  const decidedOwner = ownershipOverrides.get(bc);
  if (decidedOwner) {
    return Number(targetId) === decidedOwner
      && ownerIds.every(id => Number(id) === decidedOwner);
  }
  const ex = SHARED_BARCODE_EXCEPTIONS.find(e => e.barcode === bc);
  if (!ex) return false;
  if (!ex.productIds.includes(Number(targetId))) return false;
  return ownerIds.every(id => ex.productIds.includes(Number(id)));
}

// Из нескольких товаров, найденных по одному ШК (shared-исключение),
// выбрать подходящего по контексту; без контекста — первый (минимальный id).
function pickPreferredProduct(rows, preferredIds = []) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const pref = new Set((preferredIds || []).map(Number));
  return rows.find(r => pref.has(Number(r.id))) || rows[0];
}

// Идемпотентно дописывает shared-ШК в barcode_list перечисленных товаров.
// Вызывается при старте сервера (schema.js) и после импорта из МойСклад,
// который перезаписывает barcode_list значениями из МС.
async function applySharedBarcodeExceptions(db) {
  await refreshBarcodeOwnershipCache(db);

  // Сначала восстанавливаем решения оператора после импорта из МойСклад:
  // код удаляется со всех чужих карточек и остаётся производственным у владельца.
  for (const [barcode, productId] of ownershipOverrides) {
    await db.query(`
      UPDATE products_s
         SET production_barcode = CASE WHEN production_barcode = $1 THEN NULL ELSE production_barcode END,
             barcode_list = CASE
               WHEN $1 = ANY(string_to_array(COALESCE(barcode_list, ''), ';')) THEN
                 NULLIF(array_to_string(ARRAY(
                   SELECT value FROM unnest(string_to_array(COALESCE(barcode_list, ''), ';')) value
                    WHERE BTRIM(value) <> $1 AND BTRIM(value) <> ''
                 ), ';'), '')
               ELSE barcode_list
             END,
             marketplace_barcodes_json = CASE
               WHEN EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(marketplace_barcodes_json, '[]'::jsonb)) item
                  WHERE item->>'value' = $1
               ) THEN (
                 SELECT NULLIF(jsonb_agg(item), '[]'::jsonb)
                   FROM jsonb_array_elements(COALESCE(marketplace_barcodes_json, '[]'::jsonb)) item
                  WHERE item->>'value' IS DISTINCT FROM $1
               )
               ELSE marketplace_barcodes_json
             END,
             updated_at = NOW()
       WHERE id <> $2 AND (
         production_barcode = $1
         OR $1 = ANY(string_to_array(COALESCE(barcode_list, ''), ';'))
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(COALESCE(marketplace_barcodes_json, '[]'::jsonb)) item
            WHERE item->>'value' = $1
         )
       )
    `, [barcode, productId]);
    await db.query(
      'UPDATE products_s SET production_barcode = $1, updated_at = NOW() WHERE id = $2 AND production_barcode IS DISTINCT FROM $1',
      [barcode, productId]
    );
  }

  for (const ex of SHARED_BARCODE_EXCEPTIONS) {
    if (ownershipOverrides.has(ex.barcode)) continue;
    await db.query(
      `UPDATE products_s
       SET barcode_list = CASE
             WHEN COALESCE(barcode_list, '') = '' THEN $1
             ELSE barcode_list || ';' || $1
           END,
           updated_at = NOW()
       WHERE id = ANY($2)
         AND NOT ($1 = ANY(string_to_array(COALESCE(barcode_list, ''), ';')))
         AND production_barcode IS DISTINCT FROM $1
         AND NOT (COALESCE(marketplace_barcodes_json, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('value', $1)))`,
      [ex.barcode, ex.productIds]
    );
  }
}

module.exports = {
  SHARED_BARCODE_EXCEPTIONS,
  ownershipOverrides,
  isSharedBarcodeAllowed,
  pickPreferredProduct,
  applySharedBarcodeExceptions,
  refreshBarcodeOwnershipCache,
};

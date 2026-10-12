const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { ownershipOverrides, refreshBarcodeOwnershipCache } = require('../utils/sharedBarcodes');
const { archiveProductRecord } = require('../utils/archiveProduct');

const VALID_STATUSES = new Set(['open', 'decided', 'resolved', 'dismissed']);
const VALID_TYPES = new Set(['barcode_owner', 'production_barcode', 'product_status']);

router.use(requireAuth);

function apiError(status, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function productBarcodeFields(product, barcode) {
  if (!product || !barcode) return [];
  const fields = [];
  if (product.production_barcode === barcode) fields.push('production');
  if (String(product.barcode_list || '').split(';').map((item) => item.trim()).includes(barcode)) fields.push('additional');
  if (asArray(product.marketplace_barcodes_json).some((item) => item?.value === barcode)) fields.push('marketplace');
  return fields;
}

async function enrichIssues(rows, db = pool) {
  if (!rows.length) return [];
  const options = rows.flatMap((row) => asArray(row.candidate_options));
  const articles = [...new Set(options.map((option) => String(option.article || '').trim().toUpperCase()).filter(Boolean))];
  const ids = [...new Set(options.map((option) => Number(option.product_id)).filter((id) => Number.isInteger(id) && id > 0))];
  const barcodes = [...new Set(options.map((option) => String(option.barcode || '').trim()).filter(Boolean))];

  const products = articles.length || ids.length
    ? (await db.query(`
        SELECT id, article, name, entity_type, production_barcode, barcode_list,
               marketplace_barcodes_json, stock, reserve, archived, updated_at
          FROM products_s
         WHERE id = ANY($1::int[])
            OR UPPER(COALESCE(article, '')) = ANY($2::text[])
         ORDER BY archived ASC, id ASC
      `, [ids, articles])).rows
    : [];

  const productIds = products.map((product) => product.id);
  const scanRows = barcodes.length && productIds.length
    ? (await db.query(`
        SELECT product_id, scanned_value, COUNT(*)::int AS scans,
               MIN(created_at) AS first_scan, MAX(created_at) AS last_scan
          FROM inventory_task_scans_s
         WHERE product_id = ANY($1::int[]) AND scanned_value = ANY($2::text[])
         GROUP BY product_id, scanned_value
      `, [productIds, barcodes])).rows
    : [];

  const owners = barcodes.length
    ? (await db.query(`
        SELECT id, article, name, archived, production_barcode, barcode_list,
               marketplace_barcodes_json
          FROM products_s
         WHERE production_barcode = ANY($1::text[])
            OR string_to_array(COALESCE(barcode_list, ''), ';') && $1::text[]
            OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements(COALESCE(marketplace_barcodes_json, '[]'::jsonb)) item
               WHERE item->>'value' = ANY($1::text[])
            )
         ORDER BY archived ASC, id ASC
      `, [barcodes])).rows
    : [];

  const byId = new Map(products.map((product) => [Number(product.id), product]));
  const byArticle = new Map();
  for (const product of products) {
    const key = String(product.article || '').toUpperCase();
    if (!byArticle.has(key)) byArticle.set(key, []);
    byArticle.get(key).push(product);
  }
  const scans = new Map(scanRows.map((row) => [`${row.product_id}:${row.scanned_value}`, row]));

  return rows.map((row) => ({
    ...row,
    candidate_options: asArray(row.candidate_options).map((option) => {
      const matches = option.product_id
        ? [byId.get(Number(option.product_id))].filter(Boolean)
        : (byArticle.get(String(option.article || '').toUpperCase()) || []);
      const product = matches.length === 1 ? matches[0] : null;
      const barcode = String(option.barcode || '').trim() || null;
      const scan = product && barcode ? scans.get(`${product.id}:${barcode}`) : null;
      let availability = 'ready';
      if (!matches.length) availability = 'missing';
      else if (matches.length > 1) availability = 'duplicate_article';
      else if (product.archived) availability = 'archived';
      return {
        ...option,
        product: product ? {
          ...product,
          stock: Number(product.stock || 0),
          reserve: Number(product.reserve || 0),
          barcode_fields: productBarcodeFields(product, barcode),
        } : null,
        product_matches: matches.length,
        availability,
        scan_stats: scan ? {
          count: Number(scan.scans || 0),
          first_scan: scan.first_scan,
          last_scan: scan.last_scan,
        } : { count: 0, first_scan: null, last_scan: null },
        current_owners: barcode
          ? owners.filter((owner) => productBarcodeFields(owner, barcode).length).map((owner) => ({
              id: owner.id,
              article: owner.article,
              name: owner.name,
              archived: owner.archived,
              fields: productBarcodeFields(owner, barcode),
            }))
          : [],
      };
    }),
  }));
}

async function selectIssues(req, extraWhere = '', extraParams = []) {
  const conditions = [];
  const params = [];
  const statusValues = String(req.query.status || 'open,decided').split(',').map((value) => value.trim()).filter(Boolean);
  if (!statusValues.length || statusValues.some((status) => !VALID_STATUSES.has(status))) {
    throw apiError(400, 'Некорректный status');
  }
  params.push(statusValues);
  conditions.push(`d.status = ANY($${params.length}::text[])`);

  if (req.query.type) {
    if (!VALID_TYPES.has(req.query.type)) throw apiError(400, 'Некорректный type');
    params.push(req.query.type);
    conditions.push(`d.issue_type = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).slice(0, 200)}%`);
    conditions.push(`CONCAT_WS(' ', d.title, d.description, d.subject_article, d.primary_barcode) ILIKE $${params.length}`);
  }
  if (extraWhere) {
    for (const value of extraParams) params.push(value);
    conditions.push(extraWhere.replace(/\?(\d+)/g, (_match, index) => `$${params.length - extraParams.length + Number(index)}`));
  }

  const result = await pool.query(`
    SELECT d.*, resolver.username AS resolved_by_username,
           creator.username AS created_by_username
      FROM barcode_disputes_s d
      LEFT JOIN users_s resolver ON resolver.id = d.resolved_by
      LEFT JOIN users_s creator ON creator.id = d.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE d.status WHEN 'open' THEN 0 WHEN 'decided' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
       CASE d.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
       d.created_at DESC, d.id DESC
  `, params);
  return enrichIssues(result.rows);
}

router.get('/stats', requirePermission('barcode_disputes.view'), async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
             COUNT(*) FILTER (WHERE status = 'decided')::int AS decided,
             COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
             COUNT(*) FILTER (WHERE status = 'dismissed')::int AS dismissed,
             COUNT(*) FILTER (WHERE status = 'open' AND severity IN ('critical','high'))::int AS urgent,
             COUNT(*)::int AS total
        FROM barcode_disputes_s
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', requirePermission('barcode_disputes.view'), async (req, res) => {
  try {
    const items = await selectIssues(req);
    res.json({ items, total: items.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, ...(err.details || {}) });
  }
});

// Ищет коды, которые прямо сейчас встречаются у нескольких активных товаров.
router.post('/refresh', requirePermission('barcode_disputes.resolve'), async (req, res) => {
  try {
    const duplicates = await pool.query(`
      WITH barcode_rows AS (
        SELECT id AS product_id, production_barcode AS barcode
          FROM products_s WHERE NOT archived AND production_barcode IS NOT NULL
        UNION
        SELECT p.id, BTRIM(value)
          FROM products_s p
          CROSS JOIN LATERAL unnest(string_to_array(COALESCE(p.barcode_list, ''), ';')) value
         WHERE NOT p.archived AND BTRIM(value) <> ''
        UNION
        SELECT p.id, item->>'value'
          FROM products_s p
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.marketplace_barcodes_json, '[]'::jsonb)) item
         WHERE NOT p.archived AND COALESCE(item->>'value', '') <> ''
      ), conflicts AS (
        SELECT barcode, ARRAY_AGG(DISTINCT product_id ORDER BY product_id) AS product_ids
          FROM barcode_rows
         GROUP BY barcode
        HAVING COUNT(DISTINCT product_id) > 1
      )
      SELECT c.barcode, c.product_ids,
             jsonb_agg(jsonb_build_object('id', p.id, 'article', p.article, 'name', p.name) ORDER BY p.id) AS products
        FROM conflicts c
        JOIN products_s p ON p.id = ANY(c.product_ids)
       GROUP BY c.barcode, c.product_ids
       ORDER BY c.barcode
    `);

    let created = 0;
    for (const duplicate of duplicates.rows) {
      const options = asArray(duplicate.products).map((product) => ({
        id: `owner-product-${product.id}`,
        action: 'assign_production_barcode',
        product_id: product.id,
        article: product.article,
        barcode: duplicate.barcode,
        label: product.article || `Карточка #${product.id}`,
        detail: product.name,
      }));
      const result = await pool.query(`
        INSERT INTO barcode_disputes_s
          (issue_key, issue_type, severity, primary_barcode, title, description,
           candidate_options, evidence, detected_by, created_by)
        VALUES ($1,'barcode_owner','high',$2,$3,$4,$5::jsonb,$6::jsonb,'automatic_duplicate_scan',$7)
        ON CONFLICT (issue_key) DO NOTHING
        RETURNING id
      `, [
        `barcode:${duplicate.barcode}`, duplicate.barcode,
        'Штрихкод найден у нескольких активных товаров',
        'Автоматическая проверка обнаружила несколько карточек с одним и тем же кодом. Выберите единственного владельца.',
        JSON.stringify(options),
        JSON.stringify([{ source: 'Автопроверка GRAсклада', tone: 'warning', text: `Код присутствует у ${options.length} активных карточек.` }]),
        req.user.id,
      ]);
      if (result.rows.length) {
        created += 1;
        await pool.query(
          `INSERT INTO barcode_dispute_events_s (dispute_id, event_type, user_id, details)
           VALUES ($1,'detected',$2,$3::jsonb)`,
          [result.rows[0].id, req.user.id, JSON.stringify({ source: 'automatic_duplicate_scan' })]
        );
      }
    }
    res.json({ found: duplicates.rows.length, created, existing: duplicates.rows.length - created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function findOptionProduct(client, option) {
  if (option.product_id) {
    const result = await client.query(
      `SELECT id, article, name, archived, stock, reserve, production_barcode,
              barcode_list, marketplace_barcodes_json
         FROM products_s WHERE id = $1 FOR UPDATE`,
      [option.product_id]
    );
    return result.rows;
  }
  const result = await client.query(
    `SELECT id, article, name, archived, stock, reserve, production_barcode,
            barcode_list, marketplace_barcodes_json
       FROM products_s
      WHERE UPPER(COALESCE(article, '')) = UPPER($1)
      ORDER BY archived ASC, id ASC
      LIMIT 2 FOR UPDATE`,
    [option.article]
  );
  return result.rows;
}

async function assignBarcodeOwner(client, issue, option, userId) {
  const barcode = String(option.barcode || '').trim();
  if (!barcode || barcode.length > 255) throw apiError(400, 'В варианте решения указан некорректный штрихкод');
  const matches = await findOptionProduct(client, option);
  if (!matches.length) throw apiError(409, 'Карточка выбранного GRA-артикула ещё не создана', { code: 'product_missing', article: option.article });
  if (matches.length > 1) throw apiError(409, 'В каталоге несколько карточек выбранного GRA-артикула', { code: 'duplicate_article', article: option.article });
  const owner = matches[0];
  if (owner.archived) throw apiError(409, 'Нельзя назначить производственный штрихкод архивной карточке', { code: 'product_archived', article: owner.article });

  const previous = await client.query(`
    SELECT id, article, name, archived, production_barcode, barcode_list, marketplace_barcodes_json
      FROM products_s
     WHERE production_barcode = $1
        OR $1 = ANY(string_to_array(COALESCE(barcode_list, ''), ';'))
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(marketplace_barcodes_json, '[]'::jsonb)) item
           WHERE item->>'value' = $1
        )
     ORDER BY id FOR UPDATE
  `, [barcode]);

  await client.query(`
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
  `, [barcode, owner.id]);
  await client.query(
    `UPDATE products_s SET production_barcode = $1, updated_at = NOW()
      WHERE id = $2`,
    [barcode, owner.id]
  );
  await client.query('DELETE FROM barcode_ownership_s WHERE dispute_id = $1 AND barcode <> $2', [issue.id, barcode]);
  await client.query(`
    INSERT INTO barcode_ownership_s (barcode, product_id, dispute_id, assigned_by)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (barcode) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      dispute_id = EXCLUDED.dispute_id,
      assigned_by = EXCLUDED.assigned_by,
      assigned_at = NOW(),
      updated_at = NOW()
  `, [barcode, owner.id, issue.id, userId]);

  return {
    action: 'assign_production_barcode',
    barcode,
    owner: { id: owner.id, article: owner.article, name: owner.name },
    previous_cards: previous.rows.map((product) => ({
      id: product.id, article: product.article, name: product.name,
      fields: productBarcodeFields(product, barcode),
    })),
  };
}

async function archiveDisputeProduct(client, issue, option, userId) {
  const matches = await findOptionProduct(client, option);
  if (!matches.length) throw apiError(409, 'Карточка выбранного GRA-артикула не найдена', { code: 'product_missing', article: option.article });
  if (matches.length > 1) throw apiError(409, 'В каталоге несколько карточек выбранного GRA-артикула', { code: 'duplicate_article', article: option.article });
  const product = matches[0];
  if (product.archived) {
    await archiveProductRecord(client, {
      productId: product.id,
      archivedBy: userId,
      source: 'barcode_dispute',
      reason: `barcode_dispute:${issue.id}`,
    });
    return { action: 'archive_product', product: { id: product.id, article: product.article, name: product.name }, already_archived: true };
  }

  const physical = await client.query(`
    SELECT COALESCE(SUM(quantity), 0)::numeric AS total FROM (
      SELECT quantity FROM shelf_items_s WHERE product_id = $1
      UNION ALL SELECT quantity FROM pallet_items_s WHERE product_id = $1
      UNION ALL SELECT quantity FROM box_items_s WHERE product_id = $1
      UNION ALL SELECT quantity FROM shelf_box_items_s WHERE product_id = $1
      UNION ALL SELECT quantity FROM employee_inventory_s WHERE product_id = $1
    ) placements
  `, [product.id]);
  const physicalTotal = Number(physical.rows[0]?.total || 0);
  if (Number(product.stock || 0) > 0 || Number(product.reserve || 0) > 0 || physicalTotal > 0) {
    throw apiError(409, 'Карточку нельзя архивировать: у товара есть остаток', {
      code: 'product_has_stock',
      stock: Number(product.stock || 0),
      reserve: Number(product.reserve || 0),
      physical: physicalTotal,
    });
  }
  await archiveProductRecord(client, {
    productId: product.id,
    archivedBy: userId,
    source: 'barcode_dispute',
    reason: `barcode_dispute:${issue.id}`,
  });
  return { action: 'archive_product', product: { id: product.id, article: product.article, name: product.name } };
}

router.post('/:id/resolve', requirePermission('barcode_disputes.resolve'), async (req, res) => {
  const disputeId = Number(req.params.id);
  const optionId = String(req.body?.option_id || '').trim();
  const confirmApply = req.body?.confirm_apply === true;
  const note = String(req.body?.note || '').trim().slice(0, 2000) || null;
  if (!Number.isInteger(disputeId) || disputeId <= 0) return res.status(400).json({ error: 'Некорректный ID ситуации' });
  if (!optionId) return res.status(400).json({ error: 'Выберите вариант решения' });

  let client;
  let ownershipChanged = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM barcode_disputes_s WHERE id = $1 FOR UPDATE', [disputeId]);
    if (!result.rows.length) throw apiError(404, 'Спорная ситуация не найдена');
    const issue = result.rows[0];
    if (issue.status === 'dismissed') throw apiError(409, 'Отклонённую ситуацию нельзя изменить; сначала создайте новую проверку');
    const option = asArray(issue.candidate_options).find((item) => item.id === optionId);
    if (!option) throw apiError(400, 'Выбранный вариант не относится к этой ситуации');

    let outcome = { action: option.action || 'keep_no_change' };
    let applied = false;
    let status = 'resolved';
    if (option.action === 'assign_production_barcode') {
      if (confirmApply) {
        outcome = await assignBarcodeOwner(client, issue, option, req.user.id);
        applied = true;
        ownershipChanged = true;
      } else {
        status = 'decided';
        outcome = { ...outcome, article: option.article, barcode: option.barcode, reason: 'decision_recorded_without_catalog_change' };
      }
    } else if (option.action === 'archive_product') {
      if (confirmApply) {
        outcome = await archiveDisputeProduct(client, issue, option, req.user.id);
        applied = true;
      } else {
        status = 'decided';
        outcome = { ...outcome, article: option.article, reason: 'decision_recorded_without_catalog_change' };
      }
    } else if (option.action !== 'keep_no_change') {
      throw apiError(400, 'Неподдерживаемое действие в варианте решения');
    }

    await client.query(`
      UPDATE barcode_disputes_s
         SET selected_option = $1::jsonb, status = $2, applied = $3,
             resolution_note = $4, resolved_by = $5, resolved_at = NOW(), updated_at = NOW()
       WHERE id = $6
    `, [JSON.stringify(option), status, applied, note, req.user.id, issue.id]);
    await client.query(`
      INSERT INTO barcode_dispute_events_s (dispute_id, event_type, user_id, details)
      VALUES ($1,$2,$3,$4::jsonb)
    `, [
      issue.id,
      applied ? 'decision_applied' : status === 'decided' ? 'decision_recorded' : 'resolved_without_change',
      req.user.id,
      JSON.stringify({ option, outcome, note, previous_status: issue.status }),
    ]);
    await client.query('COMMIT');
    if (ownershipChanged && outcome.barcode && outcome.owner?.id) {
      // Сразу обновляем локальное правило, чтобы между COMMIT и перечитыванием
      // таблицы ни один запрос не смог вернуть временное shared-исключение.
      ownershipOverrides.set(String(outcome.barcode), Number(outcome.owner.id));
      await refreshBarcodeOwnershipCache(pool).catch(() => {});
    }

    const fakeReq = { query: { status } };
    let item;
    try {
      const items = await selectIssues(fakeReq, 'd.id = ?1', [issue.id]);
      [item] = items;
    } catch {
      // Решение уже атомарно применено. Ошибка вторичного чтения не должна
      // заставлять интерфейс повторять опасную операцию.
      item = {
        ...issue,
        status,
        selected_option: option,
        applied,
        resolution_note: note,
        resolved_by: req.user.id,
        resolved_by_username: req.user.username,
        resolved_at: new Date().toISOString(),
      };
    }
    res.json({ item, outcome });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message, ...(err.details || {}) });
  } finally {
    if (client) client.release();
  }
});

router.post('/:id/dismiss', requirePermission('barcode_disputes.resolve'), async (req, res) => {
  const disputeId = Number(req.params.id);
  const note = String(req.body?.note || '').trim().slice(0, 2000) || null;
  if (!Number.isInteger(disputeId) || disputeId <= 0) return res.status(400).json({ error: 'Некорректный ID ситуации' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE barcode_disputes_s
         SET status = 'dismissed', resolution_note = $2, resolved_by = $3,
             resolved_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status IN ('open','decided')
       RETURNING id
    `, [disputeId, note, req.user.id]);
    if (!result.rows.length) throw apiError(409, 'Ситуация уже решена или не найдена');
    await client.query(`
      INSERT INTO barcode_dispute_events_s (dispute_id, event_type, user_id, details)
      VALUES ($1,'dismissed',$2,$3::jsonb)
    `, [disputeId, req.user.id, JSON.stringify({ note })]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;

const router = require('express').Router();
const pool = require('../db/pool');
const config = require('../config');
const { isSharedBarcodeAllowed } = require('../utils/sharedBarcodes');
const {
  apiOperation,
  apiRequestAudit,
  hasScope,
  requireApiKey,
  requireApiScope,
} = require('../utils/apiKeys');
const { buildOpenApi, renderApiDocs } = require('../utils/publicApiOpenApi');
const { archiveProductRecord } = require('../utils/archiveProduct');

const API_VERSION = '1.0.0';
const PRODUCT_COLUMNS = `
  id, external_id, name, code, article, entity_type, barcode_list,
  production_barcode, marketplace_barcodes_json, stock, reserve, in_transit,
  quantity, folder_path, archived, sale_price, cost_price, honest_sign,
  notes, alt_names, created_at, updated_at
`;

function meta(req) {
  return { request_id: req.id, api_version: API_VERSION };
}

function internalError(req, res, err) {
  res.locals.apiInternalError = err;
  return res.status(500).json({
    error: 'internal_error',
    message: 'Внутренняя ошибка сервиса',
    ...meta(req),
  });
}

function parseList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(';');
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

function parseMarketplaceBarcodes(value) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const item of value) {
    const barcode = String(item?.value || '').trim();
    const type = String(item?.type || '').trim();
    if (!barcode || !type) return null;
    if (!result.some((row) => row.value === barcode && row.type === type)) result.push({ type, value: barcode });
  }
  return result;
}

function numeric(value, field) {
  if (value === null || value === '') return { value: null };
  const number = Number(value);
  if (!Number.isFinite(number)) return { error: `Поле ${field} должно быть числом` };
  if (number < 0) return { error: `Поле ${field} не может быть отрицательным` };
  return { value: number };
}

function productView(row, includeStock = false) {
  const product = {
    id: row.id,
    external_id: row.external_id,
    name: row.name,
    code: row.code,
    article: row.article,
    entity_type: row.entity_type,
    barcodes: {
      production: row.production_barcode,
      additional: parseList(row.barcode_list),
      marketplace: Array.isArray(row.marketplace_barcodes_json) ? row.marketplace_barcodes_json : [],
    },
    folder_path: row.folder_path,
    archived: Boolean(row.archived),
    sale_price: row.sale_price == null ? null : Number(row.sale_price),
    cost_price: row.cost_price == null ? null : Number(row.cost_price),
    honest_sign: Boolean(row.honest_sign),
    notes: row.notes,
    alt_names: row.alt_names,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (includeStock) {
    product.stock = {
      stock: Number(row.stock || 0),
      reserve: Number(row.reserve || 0),
      in_transit: Number(row.in_transit || 0),
      quantity: Number(row.quantity || 0),
    };
  }
  return product;
}

async function productsByArticle(db, article) {
  return db.query(
    `SELECT ${PRODUCT_COLUMNS} FROM products_s
      WHERE UPPER(COALESCE(article, code, '')) = UPPER($1)
      ORDER BY archived ASC, id ASC
      LIMIT 2`,
    [String(article || '').trim()]
  );
}

async function requireSingleProduct(db, article, res, req) {
  const result = await productsByArticle(db, article);
  if (!result.rows.length) {
    res.status(404).json({ error: 'product_not_found', message: 'Товар с таким артикулом не найден', article, ...meta(req) });
    return null;
  }
  if (result.rows.length > 1) {
    res.status(409).json({
      error: 'duplicate_article',
      message: 'В каталоге несколько карточек с этим артикулом. Исправьте дубликат в портале.',
      article,
      product_ids: result.rows.map((row) => row.id),
      ...meta(req),
    });
    return null;
  }
  return result.rows[0];
}

async function ensureUniqueArticle(db, article, exceptId = 0) {
  const result = await db.query(
    `SELECT id, name FROM products_s
      WHERE UPPER(COALESCE(article, code, '')) = UPPER($1) AND id <> $2
      LIMIT 1`,
    [article, exceptId]
  );
  return result.rows[0] || null;
}

async function ensureBarcodesAvailable(db, productId, barcodes) {
  const values = [...new Set(barcodes.filter(Boolean))];
  if (!values.length) return null;
  const result = await db.query(
    `SELECT DISTINCT p.id, p.article, p.name, barcode.value
       FROM products_s p
       CROSS JOIN LATERAL unnest($1::text[]) barcode(value)
      WHERE p.id <> $2 AND (
        p.production_barcode = barcode.value
        OR barcode.value = ANY(string_to_array(COALESCE(p.barcode_list, ''), ';'))
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(p.marketplace_barcodes_json, '[]'::jsonb)) item
           WHERE item->>'value' = barcode.value
        )
      )
      ORDER BY p.id`,
    [values, productId || 0]
  );
  const forbidden = result.rows.filter((row) => !isSharedBarcodeAllowed(
    row.value,
    productId,
    result.rows.filter((candidate) => candidate.value === row.value).map((candidate) => candidate.id)
  ));
  return forbidden.length ? forbidden : null;
}

async function stockLocations(productId) {
  return pool.query(`
    WITH locations AS (
      SELECT 'shelf'::text AS type, w.name AS warehouse,
             CONCAT(r.name, ' / ', s.name) AS location, si.quantity::numeric AS quantity,
             si.updated_at
        FROM shelf_items_s si
        JOIN shelves_s s ON s.id = si.shelf_id
        JOIN racks_s r ON r.id = s.rack_id
        JOIN warehouses_s w ON w.id = r.warehouse_id
       WHERE si.product_id = $1
      UNION ALL
      SELECT 'pallet', w.name, CONCAT(pr.name, ' / ', p.name), pi.quantity::numeric, pi.updated_at
        FROM pallet_items_s pi
        JOIN pallets_s p ON p.id = pi.pallet_id
        JOIN pallet_rows_s pr ON pr.id = p.row_id
        JOIN warehouses_s w ON w.id = pr.warehouse_id
       WHERE pi.product_id = $1
      UNION ALL
      SELECT 'pallet_box', w.name,
             CONCAT(pr.name, ' / ', p.name, ' / ', COALESCE(b.name, b.barcode_value)),
             bi.quantity::numeric, bi.updated_at
        FROM box_items_s bi
        JOIN boxes_s b ON b.id = bi.box_id
        LEFT JOIN pallets_s p ON p.id = b.pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = p.row_id
        LEFT JOIN warehouses_s w ON w.id = COALESCE(pr.warehouse_id, b.warehouse_id)
       WHERE bi.product_id = $1
      UNION ALL
      SELECT 'shelf_box', w.name,
             CONCAT(r.name, ' / ', s.name, ' / ', COALESCE(sb.name, sb.barcode_value)),
             sbi.quantity::numeric, sbi.updated_at
        FROM shelf_box_items_s sbi
        JOIN shelf_boxes_s sb ON sb.id = sbi.shelf_box_id
        JOIN shelves_s s ON s.id = sb.shelf_id
        JOIN racks_s r ON r.id = s.rack_id
        JOIN warehouses_s w ON w.id = r.warehouse_id
       WHERE sbi.product_id = $1
      UNION ALL
      SELECT 'employee', NULL, e.full_name, ei.quantity::numeric, ei.updated_at
        FROM employee_inventory_s ei
        JOIN employees_s e ON e.id = ei.employee_id
       WHERE ei.product_id = $1
    )
    SELECT type, warehouse, location, quantity, updated_at
      FROM locations
     WHERE quantity <> 0
     ORDER BY warehouse NULLS LAST, location
  `, [productId]);
}

// Документация и health-check открыты, чтобы интегратор мог начать работу до выдачи ключа.
router.get('/openapi.json', (req, res) => res.json(buildOpenApi(config.appBasePath)));
router.get('/docs', (_req, res) => res.type('html').send(renderApiDocs(config.appBasePath)));
router.get('/status', (req, res) => res.json({
  ok: true,
  service: 'GRAсклад Public API',
  version: API_VERSION,
  timestamp: new Date().toISOString(),
  request_id: req.id,
  links: {
    docs: `${config.appBasePath || ''}/api/public/v1/docs`,
    openapi: `${config.appBasePath || ''}/api/public/v1/openapi.json`,
  },
}));

router.use(apiRequestAudit);
router.use(requireApiKey);

router.get('/me', apiOperation('api_key.inspect'), (req, res) => {
  res.json({
    key: {
      id: req.apiKey.id,
      name: req.apiKey.name,
      prefix: req.apiKey.key_prefix,
      scopes: req.apiKey.scopes,
      rate_limit_per_minute: req.apiKey.rate_limit_per_minute,
      expires_at: req.apiKey.expires_at,
    },
    ...meta(req),
  });
});

router.get('/products', apiOperation('products.list'), requireApiScope('products:read'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  const params = [];
  const conditions = [];
  const add = (sql, value) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
  const includeStock = hasScope(req.apiKey, 'stock:read');

  const archived = String(req.query.archived ?? 'false').toLowerCase();
  if (!['true', 'false', 'all'].includes(archived)) {
    return res.status(400).json({ error: 'invalid_parameter', message: 'archived: true, false или all', ...meta(req) });
  }
  if (archived !== 'all') add('p.archived = ?', archived === 'true');
  if (req.query.q) {
    add(`CONCAT_WS(' ', p.name, p.article, p.code, p.production_barcode, p.barcode_list, p.alt_names) ILIKE ?`, `%${String(req.query.q).slice(0, 200)}%`);
  }
  if (req.query.sku) add(`UPPER(COALESCE(p.article, p.code, '')) = UPPER(?)`, String(req.query.sku).trim());
  if (req.query.entity_type) {
    if (!['product', 'bundle'].includes(req.query.entity_type)) {
      return res.status(400).json({ error: 'invalid_parameter', message: 'entity_type: product или bundle', ...meta(req) });
    }
    add('p.entity_type = ?', req.query.entity_type);
  }
  if (req.query.in_stock !== undefined) {
    if (!includeStock) {
      return res.status(403).json({ error: 'insufficient_scope', message: 'Фильтр in_stock требует stock:read', required_scopes: ['stock:read'], ...meta(req) });
    }
    const inStock = String(req.query.in_stock).toLowerCase();
    if (!['true', 'false'].includes(inStock)) {
      return res.status(400).json({ error: 'invalid_parameter', message: 'in_stock: true или false', ...meta(req) });
    }
    conditions.push(inStock === 'true' ? 'p.stock > 0' : 'p.stock <= 0');
  }
  if (req.query.updated_since) {
    const date = new Date(req.query.updated_since);
    if (Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: 'invalid_parameter', message: 'updated_since должен быть датой ISO 8601', ...meta(req) });
    }
    add('p.updated_at >= ?', date);
  }

  const sortColumns = { name: 'p.name', article: 'p.article', updated_at: 'p.updated_at', stock: 'p.stock' };
  const sort = String(req.query.sort || 'name');
  if (!sortColumns[sort]) return res.status(400).json({ error: 'invalid_parameter', message: 'Недопустимое поле sort', ...meta(req) });
  if (sort === 'stock' && !includeStock) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Сортировка по stock требует stock:read', required_scopes: ['stock:read'], ...meta(req) });
  }
  const order = String(req.query.order || 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(order)) return res.status(400).json({ error: 'invalid_parameter', message: 'order: asc или desc', ...meta(req) });
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const count = await pool.query(`SELECT COUNT(*)::int AS total FROM products_s p ${where}`, params);
    const dataParams = [...params, limit, offset];
    const result = await pool.query(
      `SELECT ${PRODUCT_COLUMNS} FROM products_s p ${where}
        ORDER BY ${sortColumns[sort]} ${order.toUpperCase()} NULLS LAST, p.id ASC
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );
    const total = count.rows[0].total;
    res.json({
      data: result.rows.map((row) => productView(row, includeStock)),
      pagination: { page, limit, total, pages: Math.ceil(total / limit), has_more: offset + result.rows.length < total },
      ...meta(req),
    });
  } catch (err) {
    internalError(req, res, err);
  }
});

router.get('/products/:article', apiOperation('products.get'), requireApiScope('products:read'), async (req, res) => {
  try {
    const product = await requireSingleProduct(pool, req.params.article, res, req);
    if (!product) return undefined;
    return res.json({ data: productView(product, hasScope(req.apiKey, 'stock:read')), ...meta(req) });
  } catch (err) {
    return internalError(req, res, err);
  }
});

router.post('/products', apiOperation('products.create'), requireApiScope('products:create'), async (req, res) => {
  const body = req.body || {};
  const allowed = new Set([
    'name', 'code', 'article', 'entity_type', 'barcodes', 'barcode_list', 'production_barcode',
    'marketplace_barcodes', 'stock', 'reserve', 'in_transit', 'quantity', 'folder_path',
    'archived', 'sale_price', 'cost_price', 'honest_sign', 'notes', 'alt_names',
  ]);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));
  if (unknown.length) {
    return res.status(400).json({ error: 'unknown_fields', message: 'Запрос содержит неподдерживаемые поля', fields: unknown, ...meta(req) });
  }
  const name = String(body.name || '').trim();
  const article = String(body.article || '').trim();
  if (!name || !article) {
    return res.status(400).json({ error: 'validation_error', message: 'Поля name и article обязательны', ...meta(req) });
  }
  if (name.length > 500 || article.length > 255) {
    return res.status(400).json({ error: 'validation_error', message: 'Превышена допустимая длина name или article', ...meta(req) });
  }
  const entityType = body.entity_type || 'product';
  if (!['product', 'bundle'].includes(entityType)) {
    return res.status(400).json({ error: 'validation_error', message: 'entity_type: product или bundle', ...meta(req) });
  }
  if (Object.hasOwn(body, 'code') && String(body.code || '').trim().length > 255) {
    return res.status(400).json({ error: 'validation_error', message: 'Поле code не должно превышать 255 символов', ...meta(req) });
  }
  for (const field of ['archived', 'honest_sign']) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'boolean') {
      return res.status(400).json({ error: 'validation_error', message: `${field} должен быть boolean`, ...meta(req) });
    }
  }

  const touchesBarcodes = ['production_barcode', 'barcodes', 'barcode_list', 'marketplace_barcodes']
    .some((field) => Object.hasOwn(body, field));
  const touchesStock = ['stock', 'reserve', 'in_transit', 'quantity'].some((field) => Object.hasOwn(body, field));
  if (touchesBarcodes && !hasScope(req.apiKey, 'barcodes:write')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Штрихкоды требуют barcodes:write', required_scopes: ['barcodes:write'], ...meta(req) });
  }
  if (touchesStock && !hasScope(req.apiKey, 'stock:write')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Остатки требуют stock:write', required_scopes: ['stock:write'], ...meta(req) });
  }
  if (body.archived && !hasScope(req.apiKey, 'products:archive')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Создание архивной карточки требует products:archive', required_scopes: ['products:archive'], ...meta(req) });
  }

  const additional = parseList(body.barcodes ?? body.barcode_list);
  const marketplace = parseMarketplaceBarcodes(body.marketplace_barcodes);
  if (marketplace === null) {
    return res.status(400).json({ error: 'validation_error', message: 'marketplace_barcodes должен быть массивом объектов {type, value}', ...meta(req) });
  }
  const production = String(body.production_barcode || '').trim() || null;
  if (production && production.length > 255) {
    return res.status(400).json({ error: 'validation_error', message: 'production_barcode не должен превышать 255 символов', ...meta(req) });
  }
  const numericFields = {};
  for (const field of ['stock', 'reserve', 'in_transit', 'quantity', 'sale_price', 'cost_price']) {
    const parsed = numeric(body[field] ?? 0, field);
    if (parsed.error) return res.status(400).json({ error: 'validation_error', message: parsed.error, ...meta(req) });
    numericFields[field] = parsed.value ?? 0;
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const duplicate = await ensureUniqueArticle(client, article);
    if (duplicate) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'article_exists', message: 'Товар с таким артикулом уже существует', product_id: duplicate.id, ...meta(req) });
    }
    const collision = await ensureBarcodesAvailable(client, 0, [production, ...additional, ...marketplace.map((item) => item.value)]);
    if (collision) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'barcode_conflict', message: 'Один или несколько штрихкодов принадлежат другому товару', conflicts: collision, ...meta(req) });
    }
    const result = await client.query(
      `INSERT INTO products_s
         (name, code, article, entity_type, barcode_list, production_barcode,
          marketplace_barcodes_json, stock, reserve, in_transit, quantity,
          folder_path, archived, sale_price, cost_price, honest_sign, notes, alt_names)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${PRODUCT_COLUMNS}`,
      [
        name, String(body.code || '').trim() || null, article, entityType,
        additional.length ? additional.join(';') : null, production,
        marketplace.length ? JSON.stringify(marketplace) : null,
        numericFields.stock, numericFields.reserve, numericFields.in_transit, numericFields.quantity,
        String(body.folder_path || '').trim() || null, body.archived === true,
        numericFields.sale_price, numericFields.cost_price, body.honest_sign === true,
        String(body.notes || '').trim() || null, String(body.alt_names || '').trim() || null,
      ]
    );
    await client.query('COMMIT');
    return res.status(201).json({ data: productView(result.rows[0], hasScope(req.apiKey, 'stock:read')), ...meta(req) });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return internalError(req, res, err);
  } finally {
    if (client) client.release();
  }
});

router.patch('/products/:article', apiOperation('products.update'), requireApiScope('products:update'), async (req, res) => {
  const body = req.body || {};
  const allowed = new Set([
    'name', 'code', 'article', 'entity_type', 'barcodes', 'barcode_list', 'production_barcode',
    'marketplace_barcodes', 'stock', 'reserve', 'in_transit', 'quantity', 'folder_path',
    'archived', 'sale_price', 'cost_price', 'honest_sign', 'notes', 'alt_names',
  ]);
  const unknown = Object.keys(body).filter((field) => !allowed.has(field));
  if (unknown.length) {
    return res.status(400).json({ error: 'unknown_fields', message: 'Запрос содержит неподдерживаемые поля', fields: unknown, ...meta(req) });
  }
  if (!Object.keys(body).length) return res.status(400).json({ error: 'validation_error', message: 'Нет полей для изменения', ...meta(req) });

  const barcodeFields = ['barcodes', 'barcode_list', 'production_barcode', 'marketplace_barcodes'];
  const stockFields = ['stock', 'reserve', 'in_transit', 'quantity'];
  if (barcodeFields.some((field) => Object.hasOwn(body, field)) && !hasScope(req.apiKey, 'barcodes:write')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Изменение штрихкодов требует barcodes:write', required_scopes: ['barcodes:write'], ...meta(req) });
  }
  if (stockFields.some((field) => Object.hasOwn(body, field)) && !hasScope(req.apiKey, 'stock:write')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Изменение остатков требует stock:write', required_scopes: ['stock:write'], ...meta(req) });
  }
  if (Object.hasOwn(body, 'archived') && !hasScope(req.apiKey, 'products:archive')) {
    return res.status(403).json({ error: 'insufficient_scope', message: 'Архивирование требует products:archive', required_scopes: ['products:archive'], ...meta(req) });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const product = await requireSingleProduct(client, req.params.article, res, req);
    if (!product) { await client.query('ROLLBACK'); return undefined; }

    if (body.archived === true) {
      const locations = await stockLocations(product.id);
      const physical = locations.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      if ((physical > 0 || Number(product.stock || 0) > 0 || Number(product.reserve || 0) > 0)
          && String(req.query.force).toLowerCase() !== 'true') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'product_has_stock',
          message: 'У товара есть остаток. Передайте force=true только после ручной проверки.',
          stock: { catalog: Number(product.stock || 0), reserve: Number(product.reserve || 0), physical },
          ...meta(req),
        });
      }
      if (String(req.query.force).toLowerCase() === 'true' && !hasScope(req.apiKey, 'stock:write')) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'insufficient_scope', message: 'Принудительное архивирование требует stock:write', required_scopes: ['stock:write'], ...meta(req) });
      }
    }

    const sets = [];
    const params = [];
    const changed = [];
    const add = (column, value, cast = '') => {
      params.push(value); sets.push(`${column} = $${params.length}${cast}`); changed.push(column);
    };

    if (Object.hasOwn(body, 'name')) {
      const value = String(body.name || '').trim();
      if (!value || value.length > 500) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'Некорректное название', ...meta(req) }); }
      add('name', value);
    }
    for (const field of ['code', 'folder_path', 'notes', 'alt_names']) {
      if (Object.hasOwn(body, field)) {
        const value = String(body[field] || '').trim() || null;
        if (field === 'code' && value && value.length > 255) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'validation_error', message: 'Поле code не должно превышать 255 символов', ...meta(req) });
        }
        add(field, value);
      }
    }
    if (Object.hasOwn(body, 'article')) {
      const value = String(body.article || '').trim();
      if (!value || value.length > 255) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'Некорректный артикул', ...meta(req) }); }
      const duplicate = await ensureUniqueArticle(client, value, product.id);
      if (duplicate) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'article_exists', message: 'Товар с таким артикулом уже существует', product_id: duplicate.id, ...meta(req) }); }
      add('article', value);
    }
    if (Object.hasOwn(body, 'entity_type')) {
      if (!['product', 'bundle'].includes(body.entity_type)) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'entity_type: product или bundle', ...meta(req) }); }
      add('entity_type', body.entity_type);
    }
    for (const field of ['stock', 'reserve', 'in_transit', 'quantity', 'sale_price', 'cost_price']) {
      if (Object.hasOwn(body, field)) {
        const parsed = numeric(body[field], field);
        if (parsed.error) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: parsed.error, ...meta(req) }); }
        add(field, parsed.value);
      }
    }
    if (Object.hasOwn(body, 'honest_sign')) {
      if (typeof body.honest_sign !== 'boolean') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'honest_sign должен быть boolean', ...meta(req) }); }
      add('honest_sign', body.honest_sign);
    }
    if (Object.hasOwn(body, 'archived')) {
      if (typeof body.archived !== 'boolean') { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'archived должен быть boolean', ...meta(req) }); }
      if (body.archived === false) {
        add('archived', false);
        add('manually_archived', false);
      }
    }

    let additional = parseList(product.barcode_list);
    let production = product.production_barcode;
    let marketplace = Array.isArray(product.marketplace_barcodes_json) ? product.marketplace_barcodes_json : [];
    if (Object.hasOwn(body, 'barcodes') || Object.hasOwn(body, 'barcode_list')) {
      additional = parseList(body.barcodes ?? body.barcode_list);
      add('barcode_list', additional.length ? additional.join(';') : null);
    }
    if (Object.hasOwn(body, 'production_barcode')) {
      production = String(body.production_barcode || '').trim() || null;
      if (production && production.length > 255) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'validation_error', message: 'production_barcode не должен превышать 255 символов', ...meta(req) });
      }
      add('production_barcode', production);
    }
    if (Object.hasOwn(body, 'marketplace_barcodes')) {
      marketplace = parseMarketplaceBarcodes(body.marketplace_barcodes);
      if (marketplace === null) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'validation_error', message: 'marketplace_barcodes должен быть массивом объектов {type, value}', ...meta(req) }); }
      add('marketplace_barcodes_json', marketplace.length ? JSON.stringify(marketplace) : null, '::jsonb');
    }
    if (barcodeFields.some((field) => Object.hasOwn(body, field))) {
      const collision = await ensureBarcodesAvailable(client, product.id, [production, ...additional, ...marketplace.map((item) => item.value)]);
      if (collision) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'barcode_conflict', message: 'Один или несколько штрихкодов принадлежат другому товару', conflicts: collision, ...meta(req) }); }
    }

    let updatedProduct = product;
    if (sets.length) {
      params.push(product.id);
      const result = await client.query(
        `UPDATE products_s SET ${sets.join(', ')}, updated_at = NOW()
          WHERE id = $${params.length}
          RETURNING ${PRODUCT_COLUMNS}`,
        params
      );
      [updatedProduct] = result.rows;
    }
    if (body.archived === true) {
      const archivedResult = await archiveProductRecord(client, {
        productId: product.id,
        source: 'public_api_patch',
        reason: req.query.reason,
      });
      updatedProduct = archivedResult.product;
      changed.push('archived');
    }
    await client.query('COMMIT');
    return res.json({ data: productView(updatedProduct, hasScope(req.apiKey, 'stock:read')), changed_fields: [...new Set(changed)], ...meta(req) });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return internalError(req, res, err);
  } finally {
    if (client) client.release();
  }
});

router.delete('/products/:article', apiOperation('products.archive'), requireApiScope('products:archive'), async (req, res) => {
  let client;
  try {
    const product = await requireSingleProduct(pool, req.params.article, res, req);
    if (!product) return undefined;
    const alreadyArchived = Boolean(product.archived);

    if (!alreadyArchived) {
      const locations = await stockLocations(product.id);
      const physical = locations.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const hasStock = physical > 0 || Number(product.stock || 0) > 0 || Number(product.reserve || 0) > 0;
      const force = String(req.query.force).toLowerCase() === 'true';
      if (hasStock && !force) {
        return res.status(409).json({
          error: 'product_has_stock',
          message: 'У товара есть остаток. Передайте force=true только после ручной проверки.',
          stock: { catalog: Number(product.stock || 0), reserve: Number(product.reserve || 0), physical },
          ...meta(req),
        });
      }
      if (hasStock && force && !hasScope(req.apiKey, 'stock:write')) {
        return res.status(403).json({ error: 'insufficient_scope', message: 'Принудительное архивирование требует stock:write', required_scopes: ['stock:write'], ...meta(req) });
      }
    }

    client = await pool.connect();
    await client.query('BEGIN');
    const result = await archiveProductRecord(client, {
      productId: product.id,
      source: 'public_api',
      reason: req.query.reason,
    });
    await client.query('COMMIT');
    return res.json({
      data: productView(result.product, hasScope(req.apiKey, 'stock:read')),
      archived: true,
      ...(alreadyArchived ? { already_archived: true } : {}),
      ...meta(req),
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return internalError(req, res, err);
  } finally {
    if (client) client.release();
  }
});

router.get('/products/:article/stock', apiOperation('products.stock'), requireApiScope('products:read', 'stock:read'), async (req, res) => {
  try {
    const product = await requireSingleProduct(pool, req.params.article, res, req);
    if (!product) return undefined;
    const locations = await stockLocations(product.id);
    const physical = locations.rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    return res.json({
      data: {
        article: product.article || product.code,
        product_name: product.name,
        catalog: {
          stock: Number(product.stock || 0), reserve: Number(product.reserve || 0),
          in_transit: Number(product.in_transit || 0), quantity: Number(product.quantity || 0),
        },
        physical_total: physical,
        locations: locations.rows.map((row) => ({ ...row, quantity: Number(row.quantity) })),
      },
      ...meta(req),
    });
  } catch (err) {
    return internalError(req, res, err);
  }
});

router.get('/products/:article/movements', apiOperation('products.movements'), requireApiScope('products:read', 'movements:read'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;
  try {
    const product = await requireSingleProduct(pool, req.params.article, res, req);
    if (!product) return undefined;
    const count = await pool.query('SELECT COUNT(*)::int AS total FROM movements_s WHERE product_id = $1', [product.id]);
    const result = await pool.query(
      `SELECT m.id, m.movement_type, m.quantity, m.quantity_before, m.quantity_after,
              m.source, m.notes, m.created_at,
              fp.name AS from_pallet, fs.name AS from_shelf, fb.barcode_value AS from_box,
              fe.full_name AS from_employee,
              tp.name AS to_pallet, ts.name AS to_shelf, tb.barcode_value AS to_box,
              te.full_name AS to_employee,
              u.username AS performed_by
         FROM movements_s m
         LEFT JOIN pallets_s fp ON fp.id = m.from_pallet_id
         LEFT JOIN shelves_s fs ON fs.id = m.from_shelf_id
         LEFT JOIN boxes_s fb ON fb.id = m.from_box_id
         LEFT JOIN employees_s fe ON fe.id = m.from_employee_id
         LEFT JOIN pallets_s tp ON tp.id = m.to_pallet_id
         LEFT JOIN shelves_s ts ON ts.id = m.to_shelf_id
         LEFT JOIN boxes_s tb ON tb.id = m.to_box_id
         LEFT JOIN employees_s te ON te.id = m.to_employee_id
         LEFT JOIN users_s u ON u.id = m.performed_by
        WHERE m.product_id = $1
        ORDER BY m.created_at DESC
        LIMIT $2 OFFSET $3`,
      [product.id, limit, offset]
    );
    const total = count.rows[0].total;
    return res.json({
      data: result.rows.map((row) => ({ ...row, quantity: Number(row.quantity || 0) })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit), has_more: offset + result.rows.length < total },
      ...meta(req),
    });
  } catch (err) {
    return internalError(req, res, err);
  }
});

module.exports = router;

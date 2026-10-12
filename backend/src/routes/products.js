const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { importCatalog } = require('../utils/catalogImport');
const { isSharedBarcodeAllowed } = require('../utils/sharedBarcodes');
const { archiveProductRecord } = require('../utils/archiveProduct');

// Дата создания из формы приходит как YYYY-MM-DD — привязываем к полудню,
// чтобы часовой пояс не сдвинул её на соседний день.
function normalizeDate(value) {
  if (!value) return null;
  const v = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v;
}

// GET /api/products
router.get('/', requireAuth, async (req, res) => {
  try {
    const {
      search = '',
      entity_type,
      archived = 'false',
      folder_path,
      page = 1,
      limit = 50,
      sort_by = 'name',
      sort_dir = 'asc',
      warehouse_id,
      stock_only,
      placed_only,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    if (archived === 'false') {
      conditions.push('p.archived = false');
    } else if (archived === 'true') {
      conditions.push('p.archived = true');
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR p.alt_names ILIKE $${params.length} OR p.iz_type ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.article ILIKE $${params.length} OR p.barcode_list ILIKE $${params.length} OR p.production_barcode ILIKE $${params.length} OR p.marketplace_barcodes_json::text ILIKE $${params.length})`);
    }

    if (entity_type) {
      params.push(entity_type);
      conditions.push(`p.entity_type = $${params.length}`);
    }

    if (folder_path) {
      params.push(`${folder_path}%`);
      conditions.push(`p.folder_path ILIKE $${params.length}`);
    }

    if (stock_only === 'true') {
      conditions.push('p.stock > 0');
    }

    if (placed_only === 'true') {
      if (warehouse_id) {
        params.push(parseInt(warehouse_id));
        const wPlacedIdx = params.length;
        conditions.push(`p.id IN (
          SELECT si.product_id FROM shelf_items_s si
          JOIN shelves_s s ON si.shelf_id = s.id
          JOIN racks_s r ON s.rack_id = r.id
          WHERE si.quantity > 0 AND r.warehouse_id = $${wPlacedIdx}
          UNION
          SELECT sbi.product_id FROM shelf_box_items_s sbi
          JOIN shelf_boxes_s sb ON sbi.shelf_box_id = sb.id
          JOIN shelves_s s2 ON sb.shelf_id = s2.id
          JOIN racks_s r2 ON s2.rack_id = r2.id
          WHERE sbi.quantity > 0 AND r2.warehouse_id = $${wPlacedIdx}
          UNION
          SELECT bi.product_id FROM box_items_s bi
          JOIN boxes_s b ON bi.box_id = b.id
          JOIN pallets_s p2 ON b.pallet_id = p2.id
          JOIN pallet_rows_s pr ON p2.row_id = pr.id
          WHERE bi.quantity > 0 AND b.status = 'closed' AND pr.warehouse_id = $${wPlacedIdx}
          UNION
          SELECT pi.product_id FROM pallet_items_s pi
          JOIN pallets_s pa ON pi.pallet_id = pa.id
          JOIN pallet_rows_s pr2 ON pa.row_id = pr2.id
          WHERE pi.quantity > 0 AND pr2.warehouse_id = $${wPlacedIdx}
        )`);
      } else {
        conditions.push(`p.id IN (
          SELECT si.product_id FROM shelf_items_s si JOIN shelves_s s ON si.shelf_id=s.id JOIN racks_s r ON s.rack_id=r.id JOIN warehouses_s w ON r.warehouse_id=w.id WHERE si.quantity > 0 AND w.active=true
          UNION
          SELECT sbi.product_id FROM shelf_box_items_s sbi JOIN shelf_boxes_s sb ON sbi.shelf_box_id=sb.id JOIN shelves_s s ON sb.shelf_id=s.id JOIN racks_s r ON s.rack_id=r.id JOIN warehouses_s w ON r.warehouse_id=w.id WHERE sbi.quantity > 0 AND w.active=true
          UNION
          SELECT bi.product_id FROM box_items_s bi JOIN boxes_s b ON bi.box_id=b.id JOIN pallets_s pa ON b.pallet_id=pa.id JOIN pallet_rows_s pr ON pa.row_id=pr.id JOIN warehouses_s w ON pr.warehouse_id=w.id WHERE bi.quantity > 0 AND w.active=true
          UNION
          SELECT pi.product_id FROM pallet_items_s pi JOIN pallets_s pa ON pi.pallet_id=pa.id JOIN pallet_rows_s pr ON pa.row_id=pr.id JOIN warehouses_s w ON pr.warehouse_id=w.id WHERE pi.quantity > 0 AND w.active=true
        )`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Safe server-side sort
    const SORT_COLS = {
      name: 'p.name', code: 'p.code', stock: 'COALESCE(sd.warehouse_qty, 0)',
      reserve: 'p.reserve', warehouse_qty: 'COALESCE(sd.warehouse_qty, 0)',
      shelf_codes: 'COALESCE(sd.shelf_codes, \'\')',
    };
    const orderCol = SORT_COLS[sort_by] || 'p.name';
    const orderDir = sort_dir === 'desc' ? 'DESC' : 'ASC';
    const orderBy = `${orderCol} ${orderDir}, p.name ASC`;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM products_s p ${where}`,
      params
    );

    // Build combined subquery: FBS shelves + FBO closed boxes, optionally filtered by warehouse
    let shelfSubquery;
    const shelfParams = [...params]; // copy current params for subquery
    if (warehouse_id) {
      shelfParams.push(parseInt(warehouse_id));
      const wIdx = shelfParams.length;
      shelfSubquery = `(
        SELECT product_id,
          STRING_AGG(DISTINCT loc_code, ', ' ORDER BY loc_code) as shelf_codes,
          SUM(quantity) as warehouse_qty
        FROM (
          -- FBS: товары на полках
          SELECT si.product_id, si.quantity, s.code as loc_code
          FROM shelf_items_s si
          JOIN shelves_s s ON si.shelf_id = s.id
          JOIN racks_s r ON s.rack_id = r.id
          WHERE si.quantity > 0 AND r.warehouse_id = $${wIdx}
          UNION ALL
          -- FBS: товары внутри коробок на полках
          SELECT sbi.product_id, sbi.quantity, COALESCE(sb.name, s.code) as loc_code
          FROM shelf_box_items_s sbi
          JOIN shelf_boxes_s sb ON sbi.shelf_box_id = sb.id
          JOIN shelves_s s ON sb.shelf_id = s.id
          JOIN racks_s r ON s.rack_id = r.id
          WHERE sbi.quantity > 0 AND r.warehouse_id = $${wIdx}
          UNION ALL
          -- FBO: закрытые коробки на паллетах
          SELECT bi.product_id, bi.quantity, p.name as loc_code
          FROM box_items_s bi
          JOIN boxes_s b ON bi.box_id = b.id
          JOIN pallets_s p ON b.pallet_id = p.id
          JOIN pallet_rows_s pr ON p.row_id = pr.id
          WHERE bi.quantity > 0 AND b.status = 'closed' AND pr.warehouse_id = $${wIdx}
          UNION ALL
          -- FBO: товары напрямую на паллетах
          SELECT pi.product_id, pi.quantity, pa.name as loc_code
          FROM pallet_items_s pi
          JOIN pallets_s pa ON pi.pallet_id = pa.id
          JOIN pallet_rows_s pr ON pa.row_id = pr.id
          WHERE pi.quantity > 0 AND pr.warehouse_id = $${wIdx}
        ) combined
        GROUP BY product_id
      )`;
    } else {
      shelfSubquery = `(
        SELECT product_id,
          STRING_AGG(DISTINCT loc_code, ', ' ORDER BY loc_code) as shelf_codes,
          SUM(quantity) as warehouse_qty
        FROM (
          -- FBS: товары на полках (только активные склады)
          SELECT si.product_id, si.quantity, s.code as loc_code
          FROM shelf_items_s si
          JOIN shelves_s s ON si.shelf_id = s.id
          JOIN racks_s r ON s.rack_id = r.id
          JOIN warehouses_s w ON r.warehouse_id = w.id
          WHERE si.quantity > 0 AND w.active = true
          UNION ALL
          -- FBS: товары внутри коробок на полках
          SELECT sbi.product_id, sbi.quantity, COALESCE(sb.name, s.code) as loc_code
          FROM shelf_box_items_s sbi
          JOIN shelf_boxes_s sb ON sbi.shelf_box_id = sb.id
          JOIN shelves_s s ON sb.shelf_id = s.id
          JOIN racks_s r ON s.rack_id = r.id
          JOIN warehouses_s w ON r.warehouse_id = w.id
          WHERE sbi.quantity > 0 AND w.active = true
          UNION ALL
          -- FBO: закрытые коробки на паллетах
          SELECT bi.product_id, bi.quantity, p.name as loc_code
          FROM box_items_s bi
          JOIN boxes_s b ON bi.box_id = b.id
          JOIN pallets_s p ON b.pallet_id = p.id
          JOIN pallet_rows_s pr ON p.row_id = pr.id
          JOIN warehouses_s w ON pr.warehouse_id = w.id
          WHERE bi.quantity > 0 AND b.status = 'closed' AND w.active = true
          UNION ALL
          -- FBO: товары напрямую на паллетах
          SELECT pi.product_id, pi.quantity, pa.name as loc_code
          FROM pallet_items_s pi
          JOIN pallets_s pa ON pi.pallet_id = pa.id
          JOIN pallet_rows_s pr ON pa.row_id = pr.id
          JOIN warehouses_s w ON pr.warehouse_id = w.id
          WHERE pi.quantity > 0 AND w.active = true
        ) combined
        GROUP BY product_id
      )`;
    }

    shelfParams.push(parseInt(limit), offset);
    const dataResult = await pool.query(
      `SELECT p.id, p.external_id, p.name, p.code, p.article, p.entity_type,
              p.barcode_list, p.production_barcode, p.marketplace_barcodes_json,
              p.stock, p.reserve, p.in_transit, p.quantity,
              p.folder_path, p.iz_type, p.archived, p.created_at, p.updated_at,
              COALESCE(sd.shelf_codes, '') as shelf_codes,
              COALESCE(sd.warehouse_qty, 0) as warehouse_qty
       FROM products_s p
       LEFT JOIN ${shelfSubquery} sd ON sd.product_id = p.id
       ${where}
       ORDER BY ${orderBy}
       LIMIT $${shelfParams.length - 1} OFFSET $${shelfParams.length}`,
      shelfParams
    );

    res.json({
      items: dataResult.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const { warehouse_id } = req.query;
    const baseResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE entity_type = 'product' AND NOT archived) as products_count,
        COUNT(*) FILTER (WHERE entity_type = 'bundle' AND NOT archived) as bundles_count,
        SUM(stock) FILTER (WHERE NOT archived) as total_stock,
        SUM(reserve) FILTER (WHERE NOT archived) as total_reserve
      FROM products_s
    `);
    const stats = baseResult.rows[0];

    // Физический итог: FBS полки + FBO закрытые коробки, с фильтром по складу если задан
    if (warehouse_id) {
      const wResult = await pool.query(
        `SELECT SUM(qty) as warehouse_total FROM (
           SELECT si.quantity as qty
           FROM shelf_items_s si
           JOIN shelves_s s ON si.shelf_id = s.id
           JOIN racks_s r ON s.rack_id = r.id
           WHERE si.quantity > 0 AND r.warehouse_id = $1
           UNION ALL
           SELECT sbi.quantity as qty
           FROM shelf_box_items_s sbi
           JOIN shelf_boxes_s sb ON sbi.shelf_box_id = sb.id
           JOIN shelves_s s ON sb.shelf_id = s.id
           JOIN racks_s r ON s.rack_id = r.id
           WHERE sbi.quantity > 0 AND r.warehouse_id = $1
           UNION ALL
           SELECT bi.quantity as qty
           FROM box_items_s bi
           JOIN boxes_s b ON bi.box_id = b.id
           JOIN pallets_s p ON b.pallet_id = p.id
           JOIN pallet_rows_s pr ON p.row_id = pr.id
           WHERE bi.quantity > 0 AND b.status = 'closed' AND pr.warehouse_id = $1
           UNION ALL
           SELECT pi.quantity as qty
           FROM pallet_items_s pi
           JOIN pallets_s pa ON pi.pallet_id = pa.id
           JOIN pallet_rows_s pr2 ON pa.row_id = pr2.id
           WHERE pi.quantity > 0 AND pr2.warehouse_id = $1
         ) combined`,
        [parseInt(warehouse_id)]
      );
      stats.warehouse_total = wResult.rows[0].warehouse_total || 0;
    } else {
      const allResult = await pool.query(
        `SELECT SUM(qty) as warehouse_total FROM (
           SELECT si.quantity as qty FROM shelf_items_s si JOIN shelves_s s ON si.shelf_id=s.id JOIN racks_s r ON s.rack_id=r.id JOIN warehouses_s w ON r.warehouse_id=w.id WHERE si.quantity > 0 AND w.active=true
           UNION ALL
           SELECT sbi.quantity as qty FROM shelf_box_items_s sbi JOIN shelf_boxes_s sb ON sbi.shelf_box_id=sb.id JOIN shelves_s s ON sb.shelf_id=s.id JOIN racks_s r ON s.rack_id=r.id JOIN warehouses_s w ON r.warehouse_id=w.id WHERE sbi.quantity > 0 AND w.active=true
           UNION ALL
           SELECT bi.quantity as qty FROM box_items_s bi JOIN boxes_s b ON bi.box_id=b.id JOIN pallets_s pa ON b.pallet_id=pa.id JOIN pallet_rows_s pr ON pa.row_id=pr.id JOIN warehouses_s w ON pr.warehouse_id=w.id WHERE bi.quantity > 0 AND w.active=true
           UNION ALL
           SELECT pi.quantity as qty FROM pallet_items_s pi JOIN pallets_s pa ON pi.pallet_id=pa.id JOIN pallet_rows_s pr ON pa.row_id=pr.id JOIN warehouses_s w ON pr.warehouse_id=w.id WHERE pi.quantity > 0 AND w.active=true
         ) combined`
      );
      stats.warehouse_total = allResult.rows[0].warehouse_total || 0;
    }

    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', requireAuth, async (req, res, next) => {
  // Skip named routes handled later (wb-stores, ozon-stores, etc.)
  if (!/^\d+$/.test(req.params.id)) return next();
  try {
    const result = await pool.query(
      'SELECT * FROM products_s WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Товар не найден' });

    const product = result.rows[0];

    // Resolve bundle components: сначала из bundle_components_s, потом из source_json как fallback
    let components = [];
    if (product.entity_type === 'bundle') {
      // Основной источник — таблица bundle_components_s
      const bcResult = await pool.query(
        `SELECT bc.id as bc_id, bc.quantity, p.id, p.name, p.code, p.article, p.entity_type, p.stock, p.production_barcode, p.barcode_list
         FROM bundle_components_s bc
         JOIN products_s p ON p.id = bc.component_id
         WHERE bc.bundle_id = $1
         ORDER BY bc.id ASC`,
        [product.id]
      );

      if (bcResult.rows.length > 0) {
        components = bcResult.rows.map(r => ({ ...r, bc_id: r.bc_id }));
      } else {
        // Fallback: из source_json (МойСклад формат)
        const rows = product.source_json?.components?.rows || [];
        if (rows.length > 0) {
          const externalIds = rows.map(r => r.assortmentDetails?.id).filter(Boolean);
          const quantities = {};
          rows.forEach(r => {
            if (r.assortmentDetails?.id) quantities[r.assortmentDetails.id] = r.quantity;
          });
          if (externalIds.length > 0) {
            const comps = await pool.query(
              `SELECT id, name, code, article, entity_type, stock, production_barcode, barcode_list, external_id
               FROM products_s WHERE external_id = ANY($1)`,
              [externalIds]
            );
            components = comps.rows.map(c => ({ ...c, quantity: quantities[c.external_id] || 1 }));
          }
        }
      }
    }

    // Где хранится товар — все склады
    const locationsResult = await pool.query(
      `SELECT * FROM (
        -- FBS: полки
        SELECT si.quantity, 'shelf' as location_type,
               s.id as location_id, s.code as location_code, s.name as location_name,
               r.name as rack_name, w.name as warehouse_name
        FROM shelf_items_s si
        JOIN shelves_s s ON s.id = si.shelf_id
        JOIN racks_s r ON r.id = s.rack_id
        JOIN warehouses_s w ON w.id = r.warehouse_id
        WHERE si.product_id = $1 AND si.quantity > 0 AND w.active = true
        UNION ALL
        -- FBS: коробки на полках
        SELECT sbi.quantity, 'shelf_box' as location_type,
               s.id as location_id, s.code as location_code, CONCAT('Коробка ', sb.barcode_value) as location_name,
               r.name as rack_name, w.name as warehouse_name
        FROM shelf_boxes_s sb
        JOIN shelves_s s ON s.id = sb.shelf_id
        JOIN racks_s r ON r.id = s.rack_id
        JOIN warehouses_s w ON w.id = r.warehouse_id
        JOIN shelf_box_items_s sbi ON sbi.shelf_box_id = sb.id
        WHERE sbi.product_id = $1 AND sbi.quantity > 0 AND w.active = true
        UNION ALL
        -- FBO: коробки на паллетах
        SELECT bi.quantity, 'box' as location_type,
               pa.id as location_id, pa.name as location_code, CONCAT('Коробка ', b.barcode_value) as location_name,
               pr.name as rack_name, w.name as warehouse_name
        FROM box_items_s bi
        JOIN boxes_s b ON bi.box_id = b.id
        JOIN pallets_s pa ON b.pallet_id = pa.id
        JOIN pallet_rows_s pr ON pa.row_id = pr.id
        JOIN warehouses_s w ON w.id = pr.warehouse_id
        WHERE bi.product_id = $1 AND b.status = 'closed' AND bi.quantity > 0 AND w.active = true
        UNION ALL
        -- FBO: товары напрямую на паллетах
        SELECT pi.quantity, 'pallet' as location_type,
               pa.id as location_id, pa.name as location_code, pa.name as location_name,
               pr.name as rack_name, w.name as warehouse_name
        FROM pallet_items_s pi
        JOIN pallets_s pa ON pi.pallet_id = pa.id
        JOIN pallet_rows_s pr ON pa.row_id = pr.id
        JOIN warehouses_s w ON w.id = pr.warehouse_id
        WHERE pi.product_id = $1 AND pi.quantity > 0 AND w.active = true
      ) all_locations ORDER BY warehouse_name, rack_name, location_code`,
      [product.id]
    );

    const techCardResult = await pool.query(
      `SELECT tc.id, tc.name, tc.folder_path, tc.output_quantity, tc.cost
       FROM tech_cards_s tc
       WHERE tc.product_id = $1`,
      [product.id]
    );
    let tech_card = null;
    if (techCardResult.rows.length > 0) {
      const tc = techCardResult.rows[0];
      const materialsResult = await pool.query(
        `SELECT rm.id, rm.name, rm.code, rm.unit, rm.category, tcm.quantity, tcm.sort_order
         FROM tech_card_materials_s tcm
         JOIN raw_materials_s rm ON rm.id = tcm.material_id
         WHERE tcm.tech_card_id = $1
         ORDER BY tcm.sort_order, rm.name`,
        [tc.id]
      );
      tech_card = {
        ...tc,
        output_quantity: Number(tc.output_quantity),
        materials: materialsResult.rows.map(m => ({ ...m, quantity: Number(m.quantity) })),
      };
    }

    res.json({ ...product, components, shelves: locationsResult.rows, tech_card });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/:id/components — добавить компонент к комплекту
router.post('/:id/components', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { component_id, quantity = 1 } = req.body;
  if (!component_id) return res.status(400).json({ error: 'component_id обязателен' });
  try {
    const result = await pool.query(
      `INSERT INTO bundle_components_s (bundle_id, component_id, quantity)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [req.params.id, component_id, parseFloat(quantity) || 1]
    );
    res.status(201).json(result.rows[0] || { bundle_id: req.params.id, component_id, quantity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id/components/:compId — изменить количество компонента
router.put('/:id/components/:compId', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { quantity } = req.body;
  try {
    const result = await pool.query(
      'UPDATE bundle_components_s SET quantity=$1 WHERE id=$2 AND bundle_id=$3 RETURNING *',
      [parseFloat(quantity) || 1, req.params.compId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Компонент не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id/components/:compId — удалить компонент
router.delete('/:id/components/:compId', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM bundle_components_s WHERE id=$1 AND bundle_id=$2', [req.params.compId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/barcode/:value — find product by any barcode
router.get('/barcode/:value', requireAuth, async (req, res) => {
  try {
    const { value } = req.params;
    const result = await pool.query(
      `SELECT id, external_id, name, code, article, entity_type,
              barcode_list, production_barcode, stock
       FROM products_s
       WHERE archived = false AND (
          $1 = ANY(string_to_array(barcode_list, ';'))
          OR production_barcode = $1
          OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
       )
       ORDER BY id
       LIMIT 1`,
      [value]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Marketplace stores config ───────────────────────────────────────────────
const OZON_STORES = {
  ozon_1: { envClientId: 'OZON_CLIENT_ID', envApiKey: 'OZON_API_KEY', label: 'Ozon ИП И.' },
  ozon_2: { envClientId: 'OZON2_CLIENT_ID', envApiKey: 'OZON2_API_KEY', label: 'Ozon ИП Е.' },
};

const WB_STORES = {
  wb_1: { envToken: 'WB_TOKEN_1', label: 'WB ИП Ирина' },
  wb_2: { envToken: 'WB_TOKEN_2', label: 'WB ИП Евгений' },
};

function getWbToken(storeKey) {
  const store = WB_STORES[storeKey];
  if (!store) return null;
  const token = process.env[store.envToken];
  if (!token) return null;
  return { token, label: store.label, key: storeKey };
}

function wbPost(token, body) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'content-api.wildberries.ru',
      path: '/content/v2/get/cards/list',
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
    }, resp => {
      let buf = '';
      resp.on('data', c => buf += c);
      resp.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Invalid JSON from WB')); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchWbBarcodeMap(token) {
  const map = new Map();
  let cursor = { limit: 100 };
  for (let page = 0; page < 100; page++) {
    const result = await wbPost(token, { settings: { cursor, filter: { withPhoto: -1 } } });
    const cards = result?.cards || result?.data?.cards || [];
    if (cards.length === 0) break;
    for (const card of cards) {
      for (const size of (card.sizes || [])) {
        for (const sku of (size.skus || [])) {
          map.set(sku, { nmID: card.nmID, vendorCode: card.vendorCode, title: card.title, wbSize: size.techSize || size.wbSize || '' });
        }
      }
    }
    const updatedCursor = result?.cursor || result?.data?.cursor;
    if (!updatedCursor?.updatedAt || cards.length < 100) break;
    cursor = { limit: 100, updatedAt: updatedCursor.updatedAt, nmID: updatedCursor.nmID };
  }
  return map;
}

// GET /api/products/wb-stores — list configured WB stores
router.get('/wb-stores', requireAuth, requirePermission('products.edit', 'products.edit_basic'), (req, res) => {
  const stores = [];
  for (const [key, cfg] of Object.entries(WB_STORES)) {
    const creds = getWbToken(key);
    stores.push({ key, label: cfg.label, configured: !!creds });
  }
  res.json(stores);
});

// POST /api/products/check-wb — check barcodes on a specific WB store (READ ONLY)
router.post('/check-wb', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { barcodes: inputBarcodes, store = 'wb_1' } = req.body;
  const bcList = Array.isArray(inputBarcodes) ? inputBarcodes.map(b => String(b).trim()).filter(Boolean) : [];
  if (bcList.length === 0) return res.status(400).json({ error: 'Штрих-коды обязательны' });

  const creds = getWbToken(store);
  if (!creds) return res.status(500).json({ error: `${WB_STORES[store]?.label || store} API не настроен` });

  try {
    const wbMap = await fetchWbBarcodeMap(creds.token);
    const results = {};
    for (const bc of bcList) {
      const found = wbMap.get(bc);
      results[bc] = found ? { found: true, wb_product: found } : { found: false };
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка WB API: ' + err.message });
  }
});

// POST /api/products/check-wb-all — check ALL products against a specific WB store
router.post('/check-wb-all', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { store = 'wb_1' } = req.body;
  const creds = getWbToken(store);
  if (!creds) return res.status(500).json({ error: `${WB_STORES[store]?.label || store} API не настроен` });

  try {
    const wbMap = await fetchWbBarcodeMap(creds.token);
    const productsResult = await pool.query(
      `SELECT id, name, code, barcode_list, production_barcode, marketplace_barcodes_json
       FROM products_s WHERE archived = false`
    );

    const matched = [];
    const notFound = [];

    for (const product of productsResult.rows) {
      const allBc = new Set();
      if (product.production_barcode) allBc.add(product.production_barcode);
      (product.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean).forEach(bc => allBc.add(bc));
      const mbj = Array.isArray(product.marketplace_barcodes_json) ? product.marketplace_barcodes_json : [];
      mbj.forEach(b => { if (b.value) allBc.add(b.value); });

      let foundOnWb = false;
      const productMatches = [];
      for (const bc of allBc) {
        if (wbMap.has(bc)) {
          foundOnWb = true;
          productMatches.push({ barcode: bc, wb: wbMap.get(bc) });
        }
      }

      if (foundOnWb) {
        matched.push({ id: product.id, name: product.name, code: product.code, matches: productMatches });
      } else {
        notFound.push({ id: product.id, name: product.name, code: product.code, barcodes: [...allBc] });
      }
    }

    res.json({
      store, label: creds.label,
      wb_products_count: wbMap.size,
      our_products_count: productsResult.rows.length,
      matched_count: matched.length,
      not_found_count: notFound.length,
      matched, not_found: notFound,
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка WB API: ' + err.message });
  }
});

function getOzonCredentials(storeKey) {
  const store = OZON_STORES[storeKey];
  if (!store) return null;
  const clientId = process.env[store.envClientId];
  const apiKey = process.env[store.envApiKey];
  if (!clientId || !apiKey) return null;
  return { clientId, apiKey, label: store.label, key: storeKey };
}

function ozonPost(clientId, apiKey, path, data) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: 'api-seller.ozon.ru', path, method: 'POST',
      headers: { 'Client-Id': clientId, 'Api-Key': apiKey, 'Content-Type': 'application/json' },
    }, resp => {
      let buf = '';
      resp.on('data', c => buf += c);
      resp.on('end', () => { try { resolve(JSON.parse(buf)); } catch { reject(new Error('Invalid JSON')); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchOzonBarcodeMap(clientId, apiKey) {
  const map = new Map();
  let lastId = '';
  for (let page = 0; page < 50; page++) {
    const listResult = await ozonPost(clientId, apiKey, '/v3/product/list', { filter: { visibility: 'ALL' }, last_id: lastId, limit: 100 });
    const items = listResult?.result?.items || [];
    if (items.length === 0) break;
    const infoResult = await ozonPost(clientId, apiKey, '/v3/product/info/list', { offer_id: items.map(i => i.offer_id) });
    for (const item of (infoResult?.items || [])) {
      for (const bc of (item.barcodes || [])) {
        map.set(bc, { product_id: item.id, offer_id: item.offer_id, name: item.name });
      }
    }
    lastId = listResult?.result?.last_id || '';
    if (!lastId || items.length < 100) break;
  }
  return map;
}

// GET /api/products/ozon-stores — list configured Ozon stores
router.get('/ozon-stores', requireAuth, requirePermission('products.edit', 'products.edit_basic'), (req, res) => {
  const stores = [];
  for (const [key, cfg] of Object.entries(OZON_STORES)) {
    const creds = getOzonCredentials(key);
    stores.push({ key, label: cfg.label, configured: !!creds });
  }
  res.json(stores);
});

// POST /api/products/check-ozon — check barcodes on a specific Ozon store (READ ONLY)
router.post('/check-ozon', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { barcodes: inputBarcodes, store = 'ozon_1' } = req.body;
  const bcList = Array.isArray(inputBarcodes) ? inputBarcodes.map(b => String(b).trim()).filter(Boolean) : [];
  if (bcList.length === 0) return res.status(400).json({ error: 'Штрих-коды обязательны' });

  const creds = getOzonCredentials(store);
  if (!creds) return res.status(500).json({ error: `${OZON_STORES[store]?.label || store} API не настроен` });

  try {
    const ozonMap = await fetchOzonBarcodeMap(creds.clientId, creds.apiKey);
    const results = {};
    for (const bc of bcList) {
      const found = ozonMap.get(bc);
      results[bc] = found ? { found: true, ozon_product: found } : { found: false };
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка Ozon API: ' + err.message });
  }
});

// POST /api/products/check-ozon-all — check ALL products against a specific Ozon store
router.post('/check-ozon-all', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { store = 'ozon_1' } = req.body;
  const creds = getOzonCredentials(store);
  if (!creds) return res.status(500).json({ error: `${OZON_STORES[store]?.label || store} API не настроен` });

  try {
    const ozonMap = await fetchOzonBarcodeMap(creds.clientId, creds.apiKey);
    const productsResult = await pool.query(
      `SELECT id, name, code, barcode_list, production_barcode, marketplace_barcodes_json
       FROM products_s WHERE archived = false`
    );

    const matched = [];
    const notFound = [];

    for (const product of productsResult.rows) {
      const allBc = new Set();
      if (product.production_barcode) allBc.add(product.production_barcode);
      (product.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean).forEach(bc => allBc.add(bc));
      const mbj = Array.isArray(product.marketplace_barcodes_json) ? product.marketplace_barcodes_json : [];
      mbj.forEach(b => { if (b.value) allBc.add(b.value); });

      let foundOnOzon = false;
      const productMatches = [];
      for (const bc of allBc) {
        if (ozonMap.has(bc)) {
          foundOnOzon = true;
          productMatches.push({ barcode: bc, ozon: ozonMap.get(bc) });
        }
      }

      if (foundOnOzon) {
        matched.push({ id: product.id, name: product.name, code: product.code, matches: productMatches });
      } else {
        notFound.push({ id: product.id, name: product.name, code: product.code, barcodes: [...allBc] });
      }
    }

    res.json({
      store, label: creds.label,
      ozon_products_count: ozonMap.size,
      our_products_count: productsResult.rows.length,
      matched_count: matched.length,
      not_found_count: notFound.length,
      matched, not_found: notFound,
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка Ozon API: ' + err.message });
  }
});

// PUT /api/products/:id/barcode-type — set marketplace type for a barcode
router.put('/:id/barcode-type', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { value, type } = req.body;
  if (!value?.trim() || !type?.trim()) return res.status(400).json({ error: 'value и type обязательны' });
  try {
    const product = await pool.query('SELECT marketplace_barcodes_json FROM products_s WHERE id=$1', [req.params.id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    const mbj = Array.isArray(product.rows[0].marketplace_barcodes_json) ? product.rows[0].marketplace_barcodes_json : [];
    const existing = mbj.find(m => m.value === value.trim());
    if (existing) {
      existing.type = type.trim();
    } else {
      mbj.push({ value: value.trim(), type: type.trim() });
    }
    const result = await pool.query(
      'UPDATE products_s SET marketplace_barcodes_json=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [JSON.stringify(mbj), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/:id/barcode — add single barcode
router.post('/:id/barcode', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { value } = req.body;
  if (!value?.trim()) return res.status(400).json({ error: 'Штрих-код обязателен' });
  try {
    const product = await pool.query('SELECT barcode_list FROM products_s WHERE id=$1', [req.params.id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    const existing = (product.rows[0].barcode_list || '').split(';').map(s => s.trim()).filter(Boolean);
    if (existing.includes(value.trim())) return res.status(400).json({ error: 'Штрих-код уже существует' });

    // Глобальная уникальность: один ШК = один товар,
    // кроме точечных исключений из utils/sharedBarcodes.js
    const dup = await pool.query(
      `SELECT id FROM products_s
       WHERE id <> $2 AND (
         production_barcode = $1
         OR $1 = ANY(string_to_array(barcode_list, ';'))
         OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
       )`,
      [value.trim(), req.params.id]
    );
    if (dup.rows.length && !isSharedBarcodeAllowed(value, req.params.id, dup.rows.map(r => r.id))) {
      return res.status(400).json({ error: 'Штрих-код уже принадлежит другому товару' });
    }

    existing.push(value.trim());
    const result = await pool.query(
      'UPDATE products_s SET barcode_list=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [existing.join(';'), req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/products/:id/barcode — remove single barcode from any field
router.delete('/:id/barcode', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { value } = req.body;
  if (!value?.trim()) return res.status(400).json({ error: 'Штрих-код обязателен' });
  const bc = value.trim();
  try {
    const product = await pool.query('SELECT barcode_list, production_barcode, marketplace_barcodes_json FROM products_s WHERE id=$1', [req.params.id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    const p = product.rows[0];
    const sets = [];
    const params = [];
    let idx = 1;

    // Remove from production_barcode
    if (p.production_barcode === bc) {
      sets.push(`production_barcode = $${idx++}`);
      params.push(null);
    }

    // Remove from barcode_list
    const list = (p.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean);
    const filtered = list.filter(b => b !== bc);
    if (filtered.length !== list.length) {
      sets.push(`barcode_list = $${idx++}`);
      params.push(filtered.length > 0 ? filtered.join(';') : null);
    }

    // Remove from marketplace_barcodes_json
    const mbj = Array.isArray(p.marketplace_barcodes_json) ? p.marketplace_barcodes_json : [];
    const mbjFiltered = mbj.filter(b => b.value !== bc);
    if (mbjFiltered.length !== mbj.length) {
      sets.push(`marketplace_barcodes_json = $${idx++}`);
      params.push(mbjFiltered.length > 0 ? JSON.stringify(mbjFiltered) : null);
    }

    if (sets.length === 0) return res.status(404).json({ error: 'Штрих-код не найден у этого товара' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE products_s SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/products/:id/barcode — rename a barcode in any field, preserving status/type
router.put('/:id/barcode', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { oldValue, newValue } = req.body;
  if (!oldValue?.trim() || !newValue?.trim()) return res.status(400).json({ error: 'Не указан штрих-код' });
  const oldBc = oldValue.trim();
  const newBc = newValue.trim();
  if (oldBc === newBc) return res.json({ ok: true });
  try {
    const product = await pool.query('SELECT barcode_list, production_barcode, marketplace_barcodes_json FROM products_s WHERE id=$1', [req.params.id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    const p = product.rows[0];

    // Check uniqueness inside the same product
    const existing = new Set();
    if (p.production_barcode) existing.add(p.production_barcode);
    (p.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean).forEach(b => existing.add(b));
    const mbjArr = Array.isArray(p.marketplace_barcodes_json) ? p.marketplace_barcodes_json : [];
    mbjArr.forEach(b => { if (b.value) existing.add(b.value); });
    if (existing.has(newBc)) return res.status(400).json({ error: 'Такой штрих-код уже есть у этого товара' });

    // Check global uniqueness across other products
    // (кроме точечных исключений из utils/sharedBarcodes.js)
    const dup = await pool.query(
      `SELECT id FROM products_s
       WHERE id <> $2 AND (
         production_barcode = $1
         OR $1 = ANY(string_to_array(barcode_list, ';'))
         OR marketplace_barcodes_json @> jsonb_build_array(jsonb_build_object('value', $1))
       )`,
      [newBc, req.params.id]
    );
    if (dup.rows.length && !isSharedBarcodeAllowed(newBc, req.params.id, dup.rows.map(r => r.id))) {
      return res.status(400).json({ error: 'Штрих-код уже принадлежит другому товару' });
    }

    const sets = [];
    const params = [];
    let idx = 1;
    let touched = false;

    if (p.production_barcode === oldBc) {
      sets.push(`production_barcode = $${idx++}`);
      params.push(newBc);
      touched = true;
    }

    const list = (p.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean);
    if (list.includes(oldBc)) {
      const replaced = list.map(b => b === oldBc ? newBc : b);
      sets.push(`barcode_list = $${idx++}`);
      params.push(replaced.length > 0 ? replaced.join(';') : null);
      touched = true;
    }

    const mbjReplaced = mbjArr.map(b => b.value === oldBc ? { ...b, value: newBc } : b);
    if (mbjArr.some(b => b.value === oldBc)) {
      sets.push(`marketplace_barcodes_json = $${idx++}`);
      params.push(JSON.stringify(mbjReplaced));
      touched = true;
    }

    if (!touched) return res.status(404).json({ error: 'Штрих-код не найден у этого товара' });

    sets.push(`updated_at = NOW()`);
    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE products_s SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/products — create product
router.post('/', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { name, code, article, entity_type = 'product', iz_type, barcode_list, production_barcode, stock = 0, reserve = 0, created_at } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const result = await pool.query(
      `INSERT INTO products_s (name, code, article, entity_type, iz_type, barcode_list, production_barcode, stock, reserve, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, NOW())) RETURNING *`,
      [name, code || null, article || null, entity_type, iz_type != null ? (String(iz_type).trim() || null) : null, barcode_list || null, production_barcode || null, parseFloat(stock) || 0, parseFloat(reserve) || 0, normalizeDate(created_at)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id — update product
router.put('/:id', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { name, code, article, entity_type, iz_type, barcode_list, stock, reserve, archived, sale_price, cost_price, honest_sign, folder_path, notes, alt_names, created_at } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Название обязательно' });
  try {
    // Ограниченное право: меняется только название, остальные поля игнорируются
    const fullEdit = req.user.role === 'admin' || (req.user.permissions || []).includes('products.edit');
    if (!fullEdit) {
      const limited = await pool.query(
        `UPDATE products_s SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [String(name).trim(), req.params.id]
      );
      if (!limited.rows.length) return res.status(404).json({ error: 'Товар не найден' });
      return res.json(limited.rows[0]);
    }

    // Обновляем только те поля, что реально пришли в запросе: карточка шлёт
    // форму целиком, а частичный PUT (скрипт, интеграция) больше не обнуляет
    // остальные поля товара.
    const fields = [];
    const params = [];
    const put = (sql, value) => { params.push(value); fields.push(sql.replace('$?', `$${params.length}`)); };

    put('name = $?', String(name).trim());
    if (code !== undefined) put('code = $?', code || null);
    if (article !== undefined) put('article = $?', article || null);
    if (entity_type !== undefined) put('entity_type = $?', entity_type || 'product');
    if (barcode_list !== undefined) put('barcode_list = $?', barcode_list || null);
    if (stock !== undefined) put('stock = $?', parseFloat(stock) || 0);
    if (reserve !== undefined) put('reserve = $?', parseFloat(reserve) || 0);
    if (archived !== undefined) {
      params.push(archived === true);
      fields.push(`archived = CASE WHEN $${params.length} = false THEN false ELSE archived END`);
      fields.push(`manually_archived = CASE WHEN $${params.length} = false THEN false ELSE manually_archived END`);
    }
    if (sale_price !== undefined) put('sale_price = $?', sale_price != null ? parseFloat(sale_price) || null : null);
    if (cost_price !== undefined) put('cost_price = $?', cost_price != null ? parseFloat(cost_price) || null : null);
    if (honest_sign !== undefined) put('honest_sign = $?', honest_sign === true);
    if (folder_path !== undefined) put('folder_path = $?', folder_path != null ? (String(folder_path).trim() || null) : null);
    if (notes !== undefined) put('notes = $?', notes != null ? (String(notes).trim() || null) : null);
    if (alt_names !== undefined) put('alt_names = $?', alt_names != null ? (String(alt_names).trim() || null) : null);
    if (iz_type !== undefined) put('iz_type = $?', iz_type != null ? (String(iz_type).trim() || null) : null);
    if (created_at) put('created_at = $?::timestamptz', normalizeDate(created_at));
    fields.push('updated_at = NOW()');

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE products_s SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id/system-barcode — set system barcode
router.put('/:id/system-barcode', requireAuth, requirePermission('products.edit', 'products.edit_basic'), async (req, res) => {
  const { value } = req.body;
  if (!value) return res.status(400).json({ error: 'Не указан штрих-код' });
  try {
    const result = await pool.query(
      `UPDATE products_s SET production_barcode = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [value, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Tech Card CRUD ─────────────────────────────────────────────────────────

// PUT /api/products/:id/tech-card — create or update tech card
router.put('/:id/tech-card', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { output_quantity, cost } = req.body;
  try {
    const existing = await pool.query('SELECT id FROM tech_cards_s WHERE product_id = $1', [req.params.id]);
    let tcId;
    if (existing.rows.length) {
      tcId = existing.rows[0].id;
      await pool.query(
        'UPDATE tech_cards_s SET output_quantity = $1, cost = $2, updated_at = NOW() WHERE id = $3',
        [parseFloat(output_quantity) || 1, cost != null ? parseFloat(cost) : null, tcId]);
    } else {
      const product = await pool.query('SELECT name FROM products_s WHERE id = $1', [req.params.id]);
      if (!product.rows.length) return res.status(404).json({ error: 'Товар не найден' });
      const ins = await pool.query(
        'INSERT INTO tech_cards_s (product_id, name, output_quantity, cost) VALUES ($1, $2, $3, $4) RETURNING id',
        [req.params.id, product.rows[0].name, parseFloat(output_quantity) || 1, cost != null ? parseFloat(cost) : null]);
      tcId = ins.rows[0].id;
    }
    res.json({ ok: true, tech_card_id: tcId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/products/:id/tech-card — delete tech card
router.delete('/:id/tech-card', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    await pool.query('DELETE FROM tech_cards_s WHERE product_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/products/:id/tech-card/materials — add material
router.post('/:id/tech-card/materials', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { material_id, quantity } = req.body;
  if (!material_id) return res.status(400).json({ error: 'material_id обязателен' });
  try {
    const tc = await pool.query('SELECT id FROM tech_cards_s WHERE product_id = $1', [req.params.id]);
    if (!tc.rows.length) return res.status(404).json({ error: 'Техкарта не найдена. Сначала создайте техкарту' });
    const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM tech_card_materials_s WHERE tech_card_id = $1', [tc.rows[0].id]);
    await pool.query(
      'INSERT INTO tech_card_materials_s (tech_card_id, material_id, quantity, sort_order) VALUES ($1, $2, $3, $4) ON CONFLICT (tech_card_id, material_id) DO UPDATE SET quantity = $3',
      [tc.rows[0].id, material_id, parseFloat(quantity) || 1, maxOrder.rows[0].next]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/products/:id/tech-card/materials/:matId — update quantity
router.put('/:id/tech-card/materials/:matId', requireAuth, requirePermission('products.edit'), async (req, res) => {
  const { quantity } = req.body;
  try {
    const tc = await pool.query('SELECT id FROM tech_cards_s WHERE product_id = $1', [req.params.id]);
    if (!tc.rows.length) return res.status(404).json({ error: 'Техкарта не найдена' });
    await pool.query(
      'UPDATE tech_card_materials_s SET quantity = $1 WHERE tech_card_id = $2 AND material_id = $3',
      [parseFloat(quantity) || 0, tc.rows[0].id, req.params.matId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/products/:id/tech-card/materials/:matId — remove material
router.delete('/:id/tech-card/materials/:matId', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    const tc = await pool.query('SELECT id FROM tech_cards_s WHERE product_id = $1', [req.params.id]);
    if (!tc.rows.length) return res.status(404).json({ error: 'Техкарта не найдена' });
    await pool.query('DELETE FROM tech_card_materials_s WHERE tech_card_id = $1 AND material_id = $2', [tc.rows[0].id, req.params.matId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/products/:id — archive product without deleting its history
router.delete('/:id', requireAuth, requirePermission('products.edit'), async (req, res) => {
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await archiveProductRecord(client, {
      productId: req.params.id,
      archivedBy: req.user.id,
      source: 'product_card',
      reason: req.body?.reason,
    });
    if (!result) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Товар не найден' });
    }
    await client.query('COMMIT');
    res.json({ success: true, archived: true, archive_id: result.archive.id });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

// POST /api/products/sync — trigger MoySklad import
router.post('/sync', requireAuth, requirePermission('products.edit'), async (req, res) => {
  try {
    const result = await importCatalog();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/import-history
router.get('/import/history', requireAuth, requirePermission('products.edit', 'products.view'), async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM import_runs_s ORDER BY created_at DESC LIMIT 10'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

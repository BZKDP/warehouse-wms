const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const config = require('../config');
const { applySharedBarcodeExceptions } = require('./sharedBarcodes');

function stripBOM(str) {
  return str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(stripBOM(raw));
}

function getLatestExportDir(sourceDir) {
  if (!fs.existsSync(sourceDir)) return null;
  const dirs = fs.readdirSync(sourceDir)
    .filter(d => d.startsWith('moysklad_export_'))
    .sort()
    .reverse();
  return dirs.length > 0 ? path.join(sourceDir, dirs[0]) : null;
}

function extractBarcodes(item) {
  const barcodes = item.barcodes || [];
  let productionBarcode = null;
  const marketplaceBarcodes = [];
  const allBarcodes = [];

  for (const b of barcodes) {
    const val = b.ean13 || b.ean8 || b.code128 || b.gtin || Object.values(b)[0];
    if (!val) continue;
    allBarcodes.push(val);

    // Russian production barcode: starts with 46 + 11 digits
    if (/^46\d{11}$/.test(val) && !productionBarcode) {
      productionBarcode = val;
    }

    // Ozon barcode
    if (/^(OZN|Z)\d+$/i.test(val)) {
      marketplaceBarcodes.push({ type: 'ozon', value: val });
    }

    // Wildberries barcode: starts with 20 or 40 (store determined later via check-wb)
    if (/^(?:20\d{10,11}|40\d{9,10})$/.test(val)) {
      marketplaceBarcodes.push({ type: 'wb', value: val });  // generic wb, refined by bulk check
    }
  }

  return {
    barcodeList: allBarcodes.join(';'),
    productionBarcode,
    marketplaceBarcodes,
  };
}

async function importCatalog() {
  const sourceDir = config.catalogSourceDir;
  const exportDir = getLatestExportDir(sourceDir);

  if (!exportDir) {
    throw new Error(`No export directory found in ${sourceDir}`);
  }

  console.log(`[Import] Using export dir: ${exportDir}`);

  // Start import run record
  const runResult = await pool.query(
    `INSERT INTO import_runs_s (status, source_dir) VALUES ('running', $1) RETURNING id`,
    [exportDir]
  );
  const runId = runResult.rows[0].id;

  try {
    // Load product data
    const prodDetails = readJSON(path.join(exportDir, 'details_nash_brend_proizvodstvo.json')) || { products: [] };
    const bundleDetails = readJSON(path.join(exportDir, 'details_nash_brend_komplekty.json')) || { products: [] };
    const stockData = readJSON(path.join(exportDir, 'stock_izhevsk_fbs.json')) || { items: [] };
    const foldersData = readJSON(path.join(exportDir, 'productfolders_all.json')) || { folders: [] };

    // Build stock lookup
    const stockMap = {};
    const stockItems = stockData.items || stockData;
    if (Array.isArray(stockItems)) {
      for (const s of stockItems) {
        stockMap[s.productExternalId] = s;
      }
    }

    // Import folders
    const folderMap = {}; // externalId -> db id
    const folders = foldersData.folders || foldersData;
    if (Array.isArray(folders)) {
      for (const folder of folders) {
        try {
          const res = await pool.query(
            `INSERT INTO product_folders_s (external_id, name, full_path)
             VALUES ($1, $2, $3)
             ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name, full_path = EXCLUDED.full_path
             RETURNING id`,
            [folder.id || folder.external_id, folder.name, folder.pathName || folder.full_path || folder.name]
          );
          folderMap[folder.id || folder.external_id] = res.rows[0].id;
        } catch (e) {
          // ignore folder errors
        }
      }
    }

    let productsCount = 0;
    let bundlesCount = 0;
    const errors = [];

    // Import regular products
    const products = prodDetails.products || prodDetails;
    if (Array.isArray(products)) {
      for (const item of products) {
        try {
          const { barcodeList, productionBarcode, marketplaceBarcodes } = extractBarcodes(item);
          const stock = stockMap[item.id] || {};
          const folderId = item.productFolder?.meta?.href
            ? folderMap[item.productFolder.meta.href.split('/').pop()]
            : null;

          await pool.query(
            `INSERT INTO products_s
               (external_id, name, code, article, entity_type, barcode_list, production_barcode,
                marketplace_barcodes_json, stock, reserve, in_transit, quantity,
                folder_path, archived, source_json)
             VALUES ($1,$2,$3,$4,'product',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (external_id) DO UPDATE SET
               barcode_list = EXCLUDED.barcode_list,
               stock = EXCLUDED.stock,
               reserve = EXCLUDED.reserve,
               in_transit = EXCLUDED.in_transit,
               quantity = EXCLUDED.quantity,
               archived = products_s.manually_archived OR EXCLUDED.archived,
               source_json = EXCLUDED.source_json`,
            [
              item.id,
              item.name,
              item.code || null,
              item.article || null,
              barcodeList || null,
              productionBarcode || null,
              marketplaceBarcodes.length > 0 ? JSON.stringify(marketplaceBarcodes) : null,
              stock.stock || 0,
              stock.reserve || 0,
              stock.inTransit || 0,
              (stock.stock || 0) + (stock.inTransit || 0),
              item.pathName || null,
              item.archived || false,
              JSON.stringify(item),
            ]
          );
          productsCount++;
        } catch (e) {
          errors.push({ item: item.name, error: e.message });
        }
      }
    }

    // Import bundles
    const bundles = bundleDetails.products || bundleDetails;
    if (Array.isArray(bundles)) {
      for (const item of bundles) {
        try {
          const { barcodeList, productionBarcode, marketplaceBarcodes } = extractBarcodes(item);

          await pool.query(
            `INSERT INTO products_s
               (external_id, name, code, article, entity_type, barcode_list, production_barcode,
                marketplace_barcodes_json, folder_path, archived, source_json)
             VALUES ($1,$2,$3,$4,'bundle',$5,$6,$7,$8,$9,$10)
             ON CONFLICT (external_id) DO UPDATE SET
               barcode_list = EXCLUDED.barcode_list,
               archived = products_s.manually_archived OR EXCLUDED.archived,
               source_json = EXCLUDED.source_json`,
            [
              item.id,
              item.name,
              item.code || null,
              item.article || null,
              barcodeList || null,
              productionBarcode || null,
              marketplaceBarcodes.length > 0 ? JSON.stringify(marketplaceBarcodes) : null,
              item.pathName || null,
              item.archived || false,
              JSON.stringify(item),
            ]
          );
          bundlesCount++;
        } catch (e) {
          errors.push({ item: item.name, error: e.message });
        }
      }
    }

    // Импорт перезаписывает barcode_list из МойСклад —
    // возвращаем shared-ШК исключения (см. utils/sharedBarcodes.js)
    await applySharedBarcodeExceptions(pool);

    await pool.query(
      `UPDATE import_runs_s SET status='success', products_count=$1, bundles_count=$2, errors_json=$3, finished_at=NOW() WHERE id=$4`,
      [productsCount, bundlesCount, JSON.stringify(errors), runId]
    );

    console.log(`[Import] Done: ${productsCount} products, ${bundlesCount} bundles, ${errors.length} errors`);
    return { productsCount, bundlesCount, errors };
  } catch (err) {
    await pool.query(
      `UPDATE import_runs_s SET status='error', errors_json=$1, finished_at=NOW() WHERE id=$2`,
      [JSON.stringify([{ error: err.message }]), runId]
    );
    throw err;
  }
}

module.exports = { importCatalog };

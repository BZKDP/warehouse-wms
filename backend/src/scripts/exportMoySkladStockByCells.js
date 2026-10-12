#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2';
const DEFAULT_OUTPUT_ROOT = 'C:\\ARRA\\Work\\moiskladimport';
const TARGET_STORE_NAME = 'Ижевск FBS нов';
const PAGE_LIMIT = 1000;
const RETRY_DELAY_MS = 1500;
const MAX_RETRIES = 6;

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatDirStamp(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(
    date.getMinutes(),
  )}${pad(date.getSeconds())}`;
}

function createCsvRow(values) {
  return values
    .map((value) => {
      const text = value === null || value === undefined ? '' : String(value);
      const escaped = text.replace(/"/g, '""');
      return /[",\r\n]/.test(escaped) ? `"${escaped}"` : escaped;
    })
    .join(',');
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeCsv(filePath, rows) {
  await fs.writeFile(filePath, `${rows.join('\n')}\n`, 'utf8');
}

async function fetchJson(url, token) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json;charset=utf-8',
      },
    });

    const text = await response.text();
    let payload = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (response.ok) {
      return payload;
    }

    const errorCode = Number(payload?.errors?.[0]?.code || 0);
    if ((response.status === 429 || errorCode === 1049) && attempt < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_MS * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const message = payload?.errors?.[0]?.error || payload?.error || response.statusText || 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.body = payload;
    error.url = url;
    throw error;
  }

  throw new Error('Failed to fetch MySklad data');
}

async function fetchAllRows(url, token) {
  const items = [];
  let offset = 0;

  while (true) {
    const pageUrl = new URL(url);
    pageUrl.searchParams.set('limit', String(PAGE_LIMIT));
    pageUrl.searchParams.set('offset', String(offset));

    const page = await fetchJson(pageUrl.toString(), token);
    const rows = Array.isArray(page?.rows) ? page.rows : [];
    items.push(...rows);

    const total = Number(page?.meta?.size);
    if (!rows.length) break;
    if (Number.isFinite(total) && items.length >= total) break;
    if (rows.length < PAGE_LIMIT) break;

    offset += rows.length;
  }

  return items;
}

function buildZonesCsvRows(store, zones) {
  const rows = [
    createCsvRow(['storeName', 'zoneName', 'zoneId', 'externalCode', 'updated', 'metaHref']),
  ];

  for (const zone of zones) {
    rows.push(
      createCsvRow([
        store.name || '',
        zone.name || '',
        zone.id || '',
        zone.externalCode || '',
        zone.updated || '',
        zone?.meta?.href || '',
      ]),
    );
  }

  return rows;
}

function buildStockCsvRows(store, rows) {
  const csvRows = [
    createCsvRow([
      'storeName',
      'productName',
      'code',
      'article',
      'stock',
      'reserve',
      'inTransit',
      'quantity',
      'externalCode',
      'metaHref',
    ]),
  ];

  for (const item of rows) {
    csvRows.push(
      createCsvRow([
        store.name || '',
        item.name || '',
        item.code || '',
        item.article || '',
        item.stock ?? '',
        item.reserve ?? '',
        item.inTransit ?? '',
        item.quantity ?? '',
        item.externalCode || '',
        item?.meta?.href || '',
      ]),
    );
  }

  return csvRows;
}

async function exportStockByCells({ token, outputRoot }) {
  await fs.mkdir(outputRoot, { recursive: true });

  const stamp = formatDirStamp(new Date());
  const exportDir = path.join(outputRoot, `moysklad_export_${stamp}`);
  await fs.mkdir(exportDir, { recursive: true });

  const stores = await fetchAllRows(`${API_BASE}/entity/store`, token);
  const targetStore = stores.find((store) => String(store?.name || '').trim() === TARGET_STORE_NAME);
  if (!targetStore) {
    throw new Error(`Store not found: ${TARGET_STORE_NAME}`);
  }

  const storeHref = targetStore?.meta?.href || `${API_BASE}/entity/store/${targetStore.id}`;
  const storeDetail = await fetchJson(storeHref, token);
  const zonesHref = storeDetail?.zones?.meta?.href || `${storeHref}/zones`;
  const zones = await fetchAllRows(zonesHref, token);

  const stockUrl = new URL(`${API_BASE}/report/stock/all`);
  stockUrl.searchParams.set('filter', `store=${storeHref}`);
  const stockRows = await fetchAllRows(stockUrl.toString(), token);

  const byCellsPayload = {
    exportedAt: new Date().toISOString(),
    store: {
      id: targetStore.id,
      name: targetStore.name,
      href: storeHref,
    },
    zonesHref,
    zonesCount: zones.length,
    rows: [],
    note:
      zones.length === 0
        ? 'MySklad API returned zero zones for this store, so the cell-level export is empty.'
        : 'Zones exist for the store, but the public API did not provide a separate stock-by-zone dataset in this export.',
  };

  const storePath = path.join(exportDir, 'store_izhevsk_fbs.json');
  const zonesJsonPath = path.join(exportDir, 'zones_izhevsk_fbs.json');
  const zonesCsvPath = path.join(exportDir, 'zones_izhevsk_fbs.csv');
  const byCellsJsonPath = path.join(exportDir, 'stock_by_cells_izhevsk_fbs.json');
  const byCellsCsvPath = path.join(exportDir, 'stock_by_cells_izhevsk_fbs.csv');
  const stockJsonPath = path.join(exportDir, 'stock_report_izhevsk_fbs.json');
  const stockCsvPath = path.join(exportDir, 'stock_report_izhevsk_fbs.csv');

  await writeJson(storePath, storeDetail);
  await writeJson(zonesJsonPath, zones);
  await writeCsv(zonesCsvPath, buildZonesCsvRows(targetStore, zones));
  await writeJson(byCellsJsonPath, byCellsPayload);
  await writeCsv(byCellsCsvPath, [createCsvRow(['storeName', 'zoneName', 'zoneId', 'note'])]);
  await writeJson(stockJsonPath, stockRows);
  await writeCsv(stockCsvPath, buildStockCsvRows(targetStore, stockRows));

  const summary = {
    exportedAt: byCellsPayload.exportedAt,
    outputDir: exportDir,
    store: {
      id: targetStore.id,
      name: targetStore.name,
      href: storeHref,
    },
    byCells: {
      file: byCellsJsonPath,
      csv: byCellsCsvPath,
      zonesFile: zonesJsonPath,
      zonesCsv: zonesCsvPath,
      zonesCount: zones.length,
      rowsCount: 0,
      note: byCellsPayload.note,
    },
    stockReport: {
      file: stockJsonPath,
      csv: stockCsvPath,
      rowsCount: stockRows.length,
      nonZeroRows: stockRows.filter(
        (item) => Number(item.stock || 0) !== 0 || Number(item.reserve || 0) !== 0 || Number(item.inTransit || 0) !== 0,
      ).length,
    },
  };

  await writeJson(path.join(exportDir, 'summary.json'), summary);
  await fs.writeFile(
    path.join(exportDir, 'README.txt'),
    [
      'MoySklad export for warehouse stock by cells',
      `Exported at: ${summary.exportedAt}`,
      `Store: ${targetStore.name}`,
      '',
      'Files:',
      '- store_izhevsk_fbs.json',
      '- zones_izhevsk_fbs.json',
      '- zones_izhevsk_fbs.csv',
      '- stock_by_cells_izhevsk_fbs.json',
      '- stock_by_cells_izhevsk_fbs.csv',
      '- stock_report_izhevsk_fbs.json',
      '- stock_report_izhevsk_fbs.csv',
      '',
      byCellsPayload.note,
    ].join('\n'),
    'utf8',
  );

  return summary;
}

async function main() {
  const token = process.env.MOYSKLAD_TOKEN || process.argv[2];
  const outputRoot = process.argv[3] || DEFAULT_OUTPUT_ROOT;

  if (!token) {
    throw new Error('MySklad token is required');
  }

  const summary = await exportStockByCells({ token, outputRoot });
  console.log(summary.outputDir);
}

main().catch((error) => {
  const details = error?.body ? `\n${JSON.stringify(error.body, null, 2)}` : '';
  console.error(`${error.message || String(error)}${details}`);
  process.exitCode = 1;
});

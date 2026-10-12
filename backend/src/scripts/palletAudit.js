// Сверка паллет: сопоставляет физические сканы коробок с данными boxes_s.
// Использование: node src/scripts/palletAudit.js <scans.json> <out.json> [дата]
// scans.json — { "<лист>": ["<ШК>", ...] } или { "<лист>::<подпись из ячейки>": [...] }
// Работает только по складу WAREHOUSE ниже — паллеты одного номера на разных складах не путать.
//
// ── БАЛАНС (главное правило отчёта) ───────────────────────────────────────────
//   стало = было − пропало − уехало + пришло
// где:
//   было    — коробки с товаром (qty>0), которые числятся на паллете в boxes_s
//   пропало — из «было» не нашлись НИ НА ОДНОМ листе сверки
//   уехало  — из «было» нашлись физически, но на ДРУГОМ паллете
//   пришло  — коробки чужих паллет, найденные физически здесь
//   стало   — то, что физически лежит на паллете: свои найденные + пришедшие
// Пустые коробки (qty=0) в баланс НЕ входят вообще: ни в «было», ни в «стало».
// Они считаются отдельно (ghosts / emptyScan), иначе Δ разъезжается с «пропало».
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const fs = require('fs');
const pool = require('../db/pool');

const WAREHOUSE = 'Наша продукция нов';
const SCANS = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// Ручная привязка листов без подписи к паллетам (имя листа → «РxПy»).
// Ставится глазами, когда в файле сверки адрес не подписан или подписан нечитаемо.
const SHEET_MAP = {
  Лист21: 'Р2П6', // 53/53 скана системно числятся на Р2П6, паллет ничем другим не сверялся
  Лист12: 'Р4П1', // все ШК числятся на Р3П6, но Р3П6 уже сверен своим листом → это отдельный
                  //  физический паллет; Р4П1 выбран как свободный/пустой в системе
};

function parseSheet(name) {
  // ключ листа может быть "ИмяЛиста" или "ИмяЛиста::подпись_в_ячейке" — пробуем оба, подпись в приоритете
  const parts = name.split('::').reverse();
  for (const p of parts) {
    const m = p.trim().match(/Р\s*(\d+)\s*-?\s*П\s*(\d+)/i);
    if (m) return `${m[1]}|${m[2]}`;
  }
  return null;
}
const sheetLabel = name => name.split('::')[0].trim();
const fmt = k => k ? `Р${k.split('|')[0]}П${k.split('|')[1]}` : '—';
const unfmt = s => { const m = String(s).match(/^Р(\d+)П(\d+)$/); return m ? `${m[1]}|${m[2]}` : null; };

(async () => {
  const { rows: all } = await pool.query(`
    SELECT b.barcode_value AS shk, b.quantity AS qty,
           pd.name AS product, pl.name AS pallet, pr.name AS row_name, pr.number AS row_num, w.name AS wh
    FROM boxes_s b
    JOIN pallets_s pl ON pl.id = b.pallet_id
    JOIN pallet_rows_s pr ON pr.id = pl.row_id
    JOIN warehouses_s w ON w.id = pr.warehouse_id
    LEFT JOIN products_s pd ON pd.id = b.product_id
    WHERE w.name = $1
  `, [WAREHOUSE]);
  const byShk = new Map(all.map(r => [r.shk, r])); // ШК уникален глобально — коллизий со скана из другого склада можно не бояться
  const pkey = r => {
    if (!r || !r.pallet || r.row_num == null) return null;
    const m = String(r.pallet).match(/(\d+)/);
    return m ? `${r.row_num}|${m[1]}` : null;
  };
  const byPallet = new Map();
  for (const r of all) {
    const k = pkey(r); if (!k) continue;
    if (!byPallet.has(k)) byPallet.set(k, []);
    byPallet.get(k).push(r);
  }

  // полный список паллет склада — все они попадают в отчёт, даже если лист сверки по ним не приносили
  const { rows: allPallets } = await pool.query(`
    SELECT pr.number AS row_num, pl.name AS pallet, pr.name AS row_name
    FROM pallets_s pl JOIN pallet_rows_s pr ON pr.id = pl.row_id JOIN warehouses_s w ON w.id = pr.warehouse_id
    WHERE w.name = $1
  `, [WAREHOUSE]);
  const allPalletKeys = new Map();
  for (const r of allPallets) {
    const m = String(r.pallet).match(/(\d+)/);
    if (!m) continue;
    allPalletKeys.set(`${r.row_num}|${m[1]}`, { rowName: r.row_name, pallet: r.pallet });
  }

  // ── 1) разбор листов ────────────────────────────────────────────────────────
  const sheets = [];
  for (const [sheet, codes] of Object.entries(SCANS)) {
    const uniq = [...new Set(codes)];
    const dupes = [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))];
    const rec = uniq.map(c => ({ shk: c, ...(byShk.get(c) || { notFound: true }) }));
    const goods = rec.filter(r => !r.notFound); // всё, что физически пикнули и опознали в базе (этого склада)
    const tally = {};
    for (const r of goods) { if (r.qty === 0) continue; const k = pkey(r); if (k) tally[k] = (tally[k] || 0) + 1; }
    const ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    sheets.push({
      sheet: sheetLabel(sheet), header: parseSheet(sheet), detected: ranked[0]?.[0] || null,
      spread: ranked.map(([k, n]) => ({ p: fmt(k), n })),
      codes: uniq, dupes, scans: codes.length,
      empty: rec.filter(r => !r.notFound && r.qty === 0).map(r => r.shk),
      notFound: rec.filter(r => r.notFound).map(r => r.shk),
      goods,
    });
  }

  // ── 2) адрес листа ──────────────────────────────────────────────────────────
  // Подпись в файле — источник истины. Исключения:
  //  · подпись есть, но ≥85% сканов с товаром система относит к другому паллету → overridden;
  //  · подписи нет, но лист прописан руками в SHEET_MAP → manual;
  //  · подписи нет и в SHEET_MAP нет → отдельная строка «Без номера», к паллету не привязываем.
  const unresolvedSheets = [];
  for (const s of sheets) {
    const manual = SHEET_MAP[s.sheet] ? unfmt(SHEET_MAP[s.sheet]) : null;
    if (s.header) {
      const total = s.spread.reduce((a, x) => a + x.n, 0);
      const top = s.spread[0];
      const overridden = !!(top && total > 0 && top.p !== fmt(s.header) && top.n / total >= 0.85);
      s.claimedHeader = fmt(s.header);
      s.effectiveKey = overridden ? unfmt(top.p) : s.header;
      s.overridden = overridden;
    } else if (manual) {
      s.effectiveKey = manual;
      s.manual = true;
    } else {
      s.effectiveKey = null;
      unresolvedSheets.push(s);
    }
    // «где физически лежит лист» — для movedOut нужен читаемый адрес даже у неразмеченных
    s.place = s.effectiveKey ? fmt(s.effectiveKey) : `Без номера — ${s.sheet}`;
  }

  // ── 3) физическое расположение коробки: одна коробка = одно место ───────────
  // Если ШК встретился на нескольких листах, засчитываем его на листе,
  // чей паллет совпадает с системным адресом коробки (это её «дом»),
  // иначе — на первом по порядку. Прочие вхождения — двойной скан, в счёт не идут.
  const homeOf = new Map(); // shk -> лист, где коробка физически засчитана
  const crossDupes = new Map(); // имя листа -> [ШК, засчитанные на другом листе]
  for (const s of sheets) {
    for (const r of s.goods) {
      const prev = homeOf.get(r.shk);
      if (!prev) { homeOf.set(r.shk, s); continue; }
      const isHome = k => k && pkey(r) === k;
      const winner = isHome(s.effectiveKey) && !isHome(prev.effectiveKey) ? s : prev;
      const loser = winner === s ? prev : s;
      homeOf.set(r.shk, winner);
      if (!crossDupes.has(loser.sheet)) crossDupes.set(loser.sheet, []);
      crossDupes.get(loser.sheet).push({ shk: r.shk, countedAt: winner.place });
    }
  }
  const placeOf = new Map(); // shk -> адрес, где коробка физически найдена
  for (const [shk, s] of homeOf) placeOf.set(shk, s.place);

  // листы, привязанные к паллету
  const groups = new Map();
  for (const s of sheets) {
    if (!s.effectiveKey) continue;
    if (!groups.has(s.effectiveKey)) groups.set(s.effectiveKey, []);
    groups.get(s.effectiveKey).push(s);
  }

  // ── 4) отчёт по всем паллетам склада ────────────────────────────────────────
  const report = [];
  const keys = new Set([...allPalletKeys.keys(), ...groups.keys()]);
  for (const key of keys) {
    const ss = groups.get(key) || [];
    const audited = ss.length > 0;
    const sysAll = byPallet.get(key) || [];
    const sys = sysAll.filter(r => r.qty > 0);   // «было» — только коробки с товаром
    const ghosts = sysAll.length - sys.length;   // пустые в учёте, в баланс не входят

    // всё, что физически засчитано на этом паллете (без двойных сканов)
    const here = ss.flatMap(s => s.goods).filter(r => placeOf.get(r.shk) === fmt(key));
    const uniqHere = [...new Map(here.map(r => [r.shk, r])).values()];
    const own = uniqHere.filter(r => pkey(r) === key);     // свои коробки, найденные на своём месте
    const alien = uniqHere.filter(r => pkey(r) !== key);   // чужие коробки, приехавшие сюда
    const ownFull = own.filter(r => r.qty > 0);
    const alienFull = alien.filter(r => r.qty > 0);
    const emptyHere = uniqHere.filter(r => r.qty === 0);   // физически есть, в учёте пустая

    // свои коробки, которых здесь нет: либо нашлись где-то ещё (уехали), либо нигде (пропали)
    const ownShk = new Set(own.map(r => r.shk));
    const gone = sys.filter(r => !ownShk.has(r.shk));
    const movedOut = gone.filter(r => placeOf.has(r.shk));
    const missing = gone.filter(r => !placeOf.has(r.shk));

    const byProduct = {};
    const bump = (p, f, n, q) => {
      byProduct[p] = byProduct[p] || { was: 0, wasQty: 0, fact: 0, factQty: 0 };
      byProduct[p][f] += n; byProduct[p][f + 'Qty'] += q;
    };
    for (const r of sys) bump(r.product || '— без товара', 'was', 1, r.qty);
    for (const r of [...ownFull, ...alienFull]) bump(r.product || '— без товара', 'fact', 1, r.qty);

    const fact = ownFull.length + alienFull.length;
    report.push({
      pallet: fmt(key),
      rowName: sysAll[0]?.row_name || allPalletKeys.get(key)?.rowName || null,
      palletName: sysAll[0]?.pallet || allPalletKeys.get(key)?.pallet || null,
      wh: WAREHOUSE,
      audited,
      sheets: ss.map(s => {
        const closeRace = s.spread.length > 1 && s.spread[1].n >= s.spread[0].n * 0.6;
        return {
          name: s.sheet, header: fmt(key), ok: !s.manual,
          spread: s.spread, scans: s.scans, dupes: s.dupes,
          lowConfidence: closeRace,
          overridden: !!s.overridden, claimedHeader: s.overridden ? s.claimedHeader : null,
          manual: !!s.manual,
          crossDupes: crossDupes.get(s.sheet) || [],
        };
      }),
      products: [...new Set([...sys, ...ownFull, ...alienFull].map(r => r.product).filter(Boolean))],
      // «было» — что числится в учёте: коробки с товаром + отдельно пустые
      wasTotal: sysAll.length, was: sys.length, wasGhosts: ghosts, wasQty: sys.reduce((a, r) => a + r.qty, 0),
      // «стало» — что физически лежит: свои найденные + приехавшие (только с товаром)
      fact, factQty: [...ownFull, ...alienFull].reduce((a, r) => a + r.qty, 0),
      own: ownFull.length, ownQty: ownFull.reduce((a, r) => a + r.qty, 0),
      alien: alienFull.map(r => ({ shk: r.shk, from: fmt(pkey(r)), product: r.product, qty: r.qty })),
      missing: missing.map(r => ({ shk: r.shk, qty: r.qty, product: r.product })),
      movedOut: movedOut.map(r => ({ shk: r.shk, qty: r.qty, product: r.product, to: placeOf.get(r.shk) })),
      emptyScan: emptyHere.map(r => r.shk),
      notFound: ss.flatMap(s => s.notFound),
      dupes: ss.flatMap(s => s.dupes),
      crossDupes: ss.flatMap(s => crossDupes.get(s.sheet) || []),
      ghosts,
      byProduct,
      odd: ownFull.filter(r => ![50, 100, 200, 150, 250, 300].includes(r.qty)).map(r => ({ shk: r.shk, qty: r.qty })),
      // контроль: было − пропало − уехало + пришло должно дать «стало»
      balanceOk: sys.length - missing.length - movedOut.length + alienFull.length === fact,
      unresolved: false,
    });
  }

  // ── 5) листы без подписи и без ручной привязки — отдельными строками ────────
  for (const s of unresolvedSheets) {
    const guessKey = s.detected;
    const mine = s.goods.filter(r => placeOf.get(r.shk) === s.place);
    const full = mine.filter(r => r.qty > 0);
    report.push({
      pallet: `Без номера — ${s.sheet}`,
      guess: guessKey ? fmt(guessKey) : null,
      rowName: null, palletName: null, wh: WAREHOUSE, audited: true,
      sheets: [{ name: s.sheet, header: null, ok: false, spread: s.spread, scans: s.scans, dupes: s.dupes, lowConfidence: false, crossDupes: crossDupes.get(s.sheet) || [] }],
      products: [...new Set(full.map(r => r.product).filter(Boolean))],
      wasTotal: null, was: null, wasGhosts: null, wasQty: null,
      fact: full.length, factQty: full.reduce((a, r) => a + r.qty, 0),
      own: 0, ownQty: 0,
      alien: full.map(r => ({ shk: r.shk, from: fmt(pkey(r)), product: r.product, qty: r.qty })),
      missing: [], movedOut: [],
      emptyScan: s.empty, notFound: s.notFound, dupes: s.dupes, crossDupes: crossDupes.get(s.sheet) || [],
      ghosts: 0, byProduct: {}, odd: [], balanceOk: true, unresolved: true,
    });
  }

  report.sort((a, b) => {
    if (a.unresolved !== b.unresolved) return a.unresolved ? 1 : -1;
    return a.pallet.localeCompare(b.pallet, 'ru', { numeric: true });
  });

  // ── 6) сквозные перемещения: коробка числится на A, найдена физически на B ──
  const moves = [];
  for (const g of report) for (const a of g.alien) moves.push({ shk: a.shk, from: a.from, to: g.pallet, product: a.product, qty: a.qty });

  // ── 7) сводка ───────────────────────────────────────────────────────────────
  const named = report.filter(r => !r.unresolved);
  const auditedRows = named.filter(r => r.audited);
  const totals = named.reduce((a, r) => ({
    was: a.was + r.was, fact: a.fact + r.fact,
    wasQty: a.wasQty + r.wasQty, factQty: a.factQty + r.factQty,
    missing: a.missing + r.missing.length, alien: a.alien + r.alien.length,
    movedOut: a.movedOut + r.movedOut.length,
    ghosts: a.ghosts + r.ghosts, dupes: a.dupes + r.dupes.length,
    crossDupes: a.crossDupes + r.crossDupes.length,
    notFound: a.notFound + r.notFound.length, emptyScan: a.emptyScan + r.emptyScan.length,
  }), { was: 0, fact: 0, wasQty: 0, factQty: 0, missing: 0, alien: 0, movedOut: 0, ghosts: 0, dupes: 0, crossDupes: 0, notFound: 0, emptyScan: 0 });

  totals.unresolvedSheets = unresolvedSheets.length;
  totals.unresolvedScans = unresolvedSheets.reduce((a, s) => a + s.codes.length, 0);
  totals.totalWarehousePallets = allPalletKeys.size;
  totals.auditedCount = auditedRows.length;
  totals.notAuditedCount = named.length - auditedRows.length;
  totals.balanceBroken = named.filter(r => !r.balanceOk).map(r => r.pallet);

  const out = { date: process.argv[4] || null, warehouse: WAREHOUSE, totals, pallets: report, moves };
  fs.writeFileSync(process.argv[3] || 'invreport.json', JSON.stringify(out, null, 1));
  console.table(report.map(r => ({
    pallet: r.pallet, sheets: r.sheets.map(s => s.name).join(','),
    was: r.was, fact: r.fact, diff: r.unresolved ? null : r.fact - r.was,
    miss: r.missing.length, moved: r.movedOut.length, alien: r.alien.length,
    ghosts: r.ghosts, ok: r.balanceOk, audited: r.audited,
  })));
  console.log('паллет:', named.length, '| сверено:', totals.auditedCount, '| не сверено:', totals.notAuditedCount,
    '| листов без номера:', unresolvedSheets.length, '| перемещений:', moves.length,
    '| баланс битый:', totals.balanceBroken.length ? totals.balanceBroken.join(', ') : 'нет');
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });

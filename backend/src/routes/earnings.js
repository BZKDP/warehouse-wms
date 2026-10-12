const router = require('express').Router();
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');

function parseNumeric(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Сборка period-фильтра. Поддерживает: today, week, month, all, YYYY-MM-DD, YYYY-MM
function buildPeriodFilter(period, alias = 'ee') {
  const col = `${alias}.created_at`;
  if (period === 'today') return `AND ${col} >= CURRENT_DATE`;
  if (period === 'week') return `AND ${col} >= CURRENT_DATE - INTERVAL '7 days'`;
  if (period === 'month') return `AND ${col} >= CURRENT_DATE - INTERVAL '30 days'`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return `AND ${col} >= '${period}'::date AND ${col} < '${period}'::date + INTERVAL '1 day'`;
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    return `AND ${col} >= '${period}-01'::date AND ${col} < ('${period}-01'::date + INTERVAL '1 month')`;
  }
  return '';
}

function formatScopeLabel(row) {
  if (row.shelf_box_id) {
    const shelfCode = row.shelf_code || [row.rack_code || row.rack_name, row.shelf_name].filter(Boolean).join(' · ') || 'Полка';
    const boxPart = row.shelf_box_position != null ? `К${row.shelf_box_position}` : 'Коробка';
    return `${shelfCode}${row.shelf_box_position != null ? boxPart : ` · ${boxPart}`}`;
  }

  if (row.box_id) {
    const rowNo = row.row_number != null ? row.row_number : '?';
    const palletNo = row.pallet_number != null ? row.pallet_number : '?';
    const boxNo = row.task_box_sort_order != null ? row.task_box_sort_order : '?';
    return `Р${rowNo}П${palletNo}К${boxNo}`;
  }

  if (row.shelf_id) {
    return row.shelf_code || [row.rack_code || row.rack_name, row.shelf_name].filter(Boolean).join(' · ') || 'Полка';
  }

  return 'Задача';
}

async function getRewardRate(client = pool) {
  const result = await client.query(
    `SELECT key, value FROM settings_s WHERE key LIKE 'gra_rate_%' OR key = 'gra_inventory_scan_rate'`
  );
  const map = {};
  for (const r of result.rows) map[r.key] = r.value;
  // Return legacy single rate for backward compat
  return parseNumeric(map['gra_rate_inventory'] || map['gra_inventory_scan_rate'], 10);
}

async function getAllGraRates(client = pool) {
  const result = await client.query(
    `SELECT key, value FROM settings_s WHERE key LIKE 'gra_rate_%' OR key = 'gra_inventory_scan_rate'`
  );
  const map = {};
  for (const r of result.rows) map[r.key] = r.value;
  const fallback = parseNumeric(map['gra_inventory_scan_rate'], 10);
  return {
    inventory: parseNumeric(map['gra_rate_inventory'], fallback),
    packaging: parseNumeric(map['gra_rate_packaging'], fallback),
    assembly: parseNumeric(map['gra_rate_assembly'], fallback),
    production_transfer: parseNumeric(map['gra_rate_production_transfer'], fallback),
  };
}

// In-memory cache for heavy queries
const cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}
function setCache(key, data) { cache.set(key, { data, ts: Date.now() }); }

router.get('/summary', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  const period = req.query.period || 'all';
  const pf = buildPeriodFilter(period, 'ee');

  const cacheKey = `summary_${period}`;
  const hit = cached(cacheKey, 5000);
  if (hit) return res.json(hit);

  for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const [rate, overviewResult, leadersResult, recentAdjustmentsResult] = await Promise.all([
      getRewardRate(pool),
      pool.query(`
        WITH employee_stats AS (
          SELECT
            e.id,
            e.full_name,
            e.active,
            COALESCE(e.gra_balance, 0) as current_balance,
            COUNT(ee.id) as events_count,
            COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.amount_delta ELSE 0 END), 0) as total_awarded,
            COALESCE(SUM(CASE WHEN ee.event_type = 'manual_adjustment' THEN ee.amount_delta ELSE 0 END), 0) as total_manual_adjustments,
            COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.reward_units ELSE 0 END), 0) as rewarded_scans,
            COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.amount_delta ELSE 0 END), 0) as sborka_order_amount,
            COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.reward_units ELSE 0 END), 0) as sborka_order_units
          FROM employees_s e
          LEFT JOIN employee_earnings_s ee ON ee.employee_id = e.id ${pf}
          GROUP BY e.id, e.full_name, e.active, e.gra_balance
        )
        SELECT
          -- Все агрегаты считаем ТОЛЬКО по работающим сотрудникам (active=true).
          -- Уволенные исключены из тоталов целиком (см. редизайн «Заработок» v7.35).
          COUNT(*) FILTER (WHERE active AND (events_count > 0 OR current_balance <> 0)) as employees_with_activity,
          COUNT(*) FILTER (WHERE active AND current_balance > 0) as employees_with_positive_balance,
          COALESCE(SUM(current_balance) FILTER (WHERE active AND (events_count > 0 OR current_balance <> 0)), 0) as total_current_balance,
          COALESCE(SUM(total_awarded) FILTER (WHERE active), 0) as total_awarded,
          COALESCE(SUM(total_manual_adjustments) FILTER (WHERE active), 0) as total_manual_adjustments,
          COALESCE(SUM(rewarded_scans) FILTER (WHERE active), 0) as rewarded_scans,
          COALESCE(SUM(sborka_order_amount) FILTER (WHERE active), 0) as total_sborka_amount,
          COALESCE(SUM(sborka_order_units) FILTER (WHERE active), 0) as total_sborka_units
        FROM employee_stats
      `),
      pool.query(`
        SELECT
          e.id as employee_id,
          e.full_name,
          e.active,
          COALESCE(e.gra_balance, 0) as current_balance,
          COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.amount_delta ELSE 0 END), 0) as total_awarded,
          COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.reward_units ELSE 0 END), 0) as rewarded_scans,
          COUNT(DISTINCT ee.task_id) FILTER (WHERE ee.event_type = 'inventory_scan' AND ee.task_id IS NOT NULL) as rewarded_tasks_count,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.amount_delta ELSE 0 END), 0) as sborka_amount,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.reward_units ELSE 0 END), 0) as sborka_units,
          MAX(ee.created_at) as last_earned_at
        FROM employees_s e
        JOIN employee_earnings_s ee ON ee.employee_id = e.id
        WHERE 1=1 ${pf}
        GROUP BY e.id, e.full_name, e.active, e.gra_balance
        HAVING COUNT(ee.id) > 0
        -- Уволенные приходят, но в конце списка (active DESC); фронт прячет их по умолчанию
        ORDER BY e.active DESC, COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.amount_delta ELSE 0 END), 0) DESC, rewarded_scans DESC
        LIMIT 30
      `),
      pool.query(`
        SELECT
          ee.id,
          ee.employee_id,
          e.full_name as employee_name,
          ee.amount_delta,
          ee.balance_before,
          ee.balance_after,
          ee.notes,
          ee.created_at,
          u.username as changed_by_username
        FROM employee_earnings_s ee
        JOIN employees_s e ON e.id = ee.employee_id
        LEFT JOIN users_s u ON u.id = ee.created_by_user_id
        WHERE ee.event_type = 'manual_adjustment'
        ORDER BY ee.created_at DESC
        LIMIT 20
      `),
    ]);

    const allRates = await getAllGraRates(pool);

    // Payroll summary — привязка к выбранному периоду (месяцу).
    // earned_period — начислено за выбранный период (сканы + сборка),
    // gra_balance   — текущий невыплаченный баланс (к выплате).
    // Уволенных (active=false) фронт показывает отдельным свёрнутым блоком
    // и НЕ учитывает в итоговой сумме к выплате.
    const payrollResult = await pool.query(`
      SELECT e.id, e.full_name, e.position, e.active,
        COALESCE(e.gra_balance, 0) as gra_balance,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type IN ('inventory_scan','external_order_pick','external_order_collect')), 0) as earned_period,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type = 'manual_adjustment'), 0) as adjustments_period
      FROM employees_s e
      LEFT JOIN employee_earnings_s ee ON ee.employee_id = e.id ${pf}
      GROUP BY e.id, e.full_name, e.position, e.active, e.gra_balance
      HAVING COALESCE(e.gra_balance, 0) <> 0
          OR COALESCE(SUM(ee.amount_delta) FILTER (
               WHERE ee.event_type IN ('inventory_scan','external_order_pick','external_order_collect')), 0) <> 0
      ORDER BY e.active DESC, earned_period DESC
    `);

    const result = {
      settings: {
        gra_inventory_scan_rate: rate,
        rates: allRates,
      },
      overview: overviewResult.rows[0] || {},
      leaders: leadersResult.rows,
      recent_adjustments: recentAdjustmentsResult.rows,
      payroll: payrollResult.rows,
    };
    setCache(cacheKey, result);
    res.json(result);
    return;
  } catch (err) {
    if (err.code === '40P01' && attempt < 3) { await new Promise(r => setTimeout(r, 50 * attempt)); continue; }
    return res.status(500).json({ error: err.message });
  }
  }
});

// GET /api/earnings/my — employee's own earnings (no admin required)
router.get('/my', requireAuth, async (req, res) => {
  const employeeId = req.user.employee_id;
  if (!employeeId) return res.status(400).json({ error: 'Нет привязки к сотруднику' });

  const period = req.query.period || 'this_month';
  let periodFilter = '';
  if (period === 'today') periodFilter = `AND ee.created_at >= CURRENT_DATE`;
  else if (period === 'week') periodFilter = `AND ee.created_at >= CURRENT_DATE - INTERVAL '7 days'`;
  else if (period === 'month') periodFilter = `AND ee.created_at >= CURRENT_DATE - INTERVAL '30 days'`;
  // this_month — текущий календарный месяц (личный кабинет показывает только его)
  else if (period === 'this_month') periodFilter = `AND ee.created_at >= date_trunc('month', CURRENT_DATE)`;

  try {
    const [summaryResult, tasksResult] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(ee.amount_delta), 0) as total_earned,
          COALESCE(SUM(ee.reward_units), 0) as rewarded_scans,
          (SELECT COUNT(*) FROM inventory_task_scans_s sc
           JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.employee_id = $1
           WHERE sc.product_id IS NOT NULL AND sc.created_at >= date_trunc('month', CURRENT_DATE)) as total_scans,
          COUNT(DISTINCT ee.task_id) FILTER (WHERE ee.task_id IS NOT NULL) as tasks_count,
          COALESCE(SUM(ee.amount_delta) FILTER (WHERE ee.event_type = 'inventory_scan'), 0) as warehouse_earned,
          COALESCE(SUM(ee.amount_delta) FILTER (WHERE ee.event_type = 'external_order_pick'), 0) as sborka_pick_amount,
          COALESCE(SUM(ee.reward_units) FILTER (WHERE ee.event_type = 'external_order_pick'), 0) as sborka_pick_units,
          COALESCE(SUM(ee.amount_delta) FILTER (WHERE ee.event_type = 'external_order_collect'), 0) as sborka_collect_amount,
          COALESCE(SUM(ee.reward_units) FILTER (WHERE ee.event_type = 'external_order_collect'), 0) as sborka_collect_units,
          COUNT(DISTINCT ee.source_order_ref) FILTER (WHERE ee.event_type = 'external_order_collect' AND ee.source_order_ref IS NOT NULL) as sborka_orders_count
        FROM employee_earnings_s ee
        WHERE ee.employee_id = $1
          AND ee.event_type IN ('inventory_scan','external_order_pick','external_order_collect')
          ${periodFilter}
      `, [employeeId]),
      pool.query(`
        SELECT
          ee.task_id,
          COALESCE(t.title, MAX(ee.task_title), 'Задача') as title,
          COALESCE(t.task_type, MAX(ee.task_type), 'inventory') as task_type,
          t.status,
          t.started_at,
          t.completed_at,
          COALESCE(SUM(ee.amount_delta), 0) as earned,
          COALESCE(SUM(ee.reward_units), 0) as rewarded_scans,
          (SELECT COUNT(*) FROM inventory_task_scans_s sc
           WHERE sc.task_id = ee.task_id AND sc.product_id IS NOT NULL) as total_scans,
          (SELECT ROUND(AVG(gap)::numeric, 1) FROM (
            SELECT EXTRACT(EPOCH FROM (sc.created_at - LAG(sc.created_at) OVER (ORDER BY sc.created_at))) as gap
            FROM inventory_task_scans_s sc WHERE sc.task_id = ee.task_id AND sc.product_id IS NOT NULL
          ) g WHERE gap > 0 AND gap < 300) as avg_scan_time
        FROM employee_earnings_s ee
        LEFT JOIN inventory_tasks_s t ON t.id = ee.task_id
        WHERE ee.employee_id = $1
          AND ee.event_type IN ('inventory_scan','external_order_pick','external_order_collect')
          ${periodFilter}
        GROUP BY ee.task_id, t.id, t.title, t.task_type, t.status, t.started_at, t.completed_at
        ORDER BY MAX(ee.created_at) DESC
      `, [employeeId]),
    ]);

    res.json({
      summary: summaryResult.rows[0] || { total_earned: 0, total_scans: 0, tasks_count: 0 },
      tasks: tasksResult.rows,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/employees', requireAuth, requirePermission('analytics', 'staff.view'), async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        e.id as employee_id,
        e.full_name,
        COALESCE(e.gra_balance, 0) as current_balance,
        agg.total_awarded,
        agg.total_manual_adjustments,
        agg.rewarded_scans,
        agg.rewarded_tasks_count,
        agg.sborka_amount,
        agg.sborka_units,
        agg.sborka_pick_amount,
        agg.sborka_pick_units,
        agg.sborka_collect_amount,
        agg.sborka_collect_units,
        agg.sborka_wb_amount,
        agg.sborka_ozon_amount,
        agg.last_earned_at
      FROM employees_s e
      JOIN (
        SELECT
          employee_id,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type = 'inventory_scan'), 0) as total_awarded,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type = 'manual_adjustment'), 0) as total_manual_adjustments,
          COALESCE(SUM(reward_units) FILTER (WHERE event_type = 'inventory_scan'), 0) as rewarded_scans,
          COUNT(DISTINCT task_id) FILTER (WHERE event_type = 'inventory_scan' AND task_id IS NOT NULL) as rewarded_tasks_count,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type IN ('external_order_pick','external_order_collect') AND source = 'sborka-site'), 0) as sborka_amount,
          COALESCE(SUM(reward_units) FILTER (WHERE event_type IN ('external_order_pick','external_order_collect') AND source = 'sborka-site'), 0) as sborka_units,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type = 'external_order_pick' AND source = 'sborka-site'), 0) as sborka_pick_amount,
          COALESCE(SUM(reward_units) FILTER (WHERE event_type = 'external_order_pick' AND source = 'sborka-site'), 0) as sborka_pick_units,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type = 'external_order_collect' AND source = 'sborka-site'), 0) as sborka_collect_amount,
          COALESCE(SUM(reward_units) FILTER (WHERE event_type = 'external_order_collect' AND source = 'sborka-site'), 0) as sborka_collect_units,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type IN ('external_order_pick','external_order_collect') AND source = 'sborka-site' AND source_marketplace = 'wb'), 0) as sborka_wb_amount,
          COALESCE(SUM(amount_delta) FILTER (WHERE event_type IN ('external_order_pick','external_order_collect') AND source = 'sborka-site' AND source_marketplace = 'ozon'), 0) as sborka_ozon_amount,
          MAX(created_at) as last_earned_at
        FROM employee_earnings_s
        GROUP BY employee_id
      ) agg ON agg.employee_id = e.id
      ORDER BY COALESCE(e.gra_balance, 0) DESC, agg.last_earned_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/employees/:employeeId', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  for (let attempt = 1; attempt <= 3; attempt++) { try {
    const employeeId = Number(req.params.employeeId);
    if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'Некорректный employeeId' });

    // Period filter
    const period = req.query.period || 'all';
    const periodFilter = buildPeriodFilter(period, 'ee');
    const liveFilter = buildPeriodFilter(period, 'sle');

    const [employeeResult, tasksResult, adjustmentsResult, sborkaResult, sborkaLiveResult] = await Promise.all([
      pool.query(`
        SELECT
          e.id as employee_id,
          e.full_name,
          COALESCE(e.gra_balance, 0) as current_balance,
          COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.amount_delta ELSE 0 END), 0) as total_awarded,
          COALESCE(SUM(CASE WHEN ee.event_type = 'manual_adjustment' THEN ee.amount_delta ELSE 0 END), 0) as total_manual_adjustments,
          COALESCE(SUM(CASE WHEN ee.event_type = 'inventory_scan' THEN ee.reward_units ELSE 0 END), 0) as rewarded_scans,
          COUNT(DISTINCT ee.task_id) FILTER (WHERE ee.event_type = 'inventory_scan' AND ee.task_id IS NOT NULL) as rewarded_tasks_count,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.amount_delta ELSE 0 END), 0) as sborka_amount,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' THEN ee.reward_units ELSE 0 END), 0) as sborka_units,
          COALESCE(SUM(CASE WHEN ee.event_type = 'external_order_pick' AND ee.source = 'sborka-site' THEN ee.amount_delta ELSE 0 END), 0) as sborka_pick_amount,
          COALESCE(SUM(CASE WHEN ee.event_type = 'external_order_pick' AND ee.source = 'sborka-site' THEN ee.reward_units ELSE 0 END), 0) as sborka_pick_units,
          COALESCE(SUM(CASE WHEN ee.event_type = 'external_order_collect' AND ee.source = 'sborka-site' THEN ee.amount_delta ELSE 0 END), 0) as sborka_collect_amount,
          COALESCE(SUM(CASE WHEN ee.event_type = 'external_order_collect' AND ee.source = 'sborka-site' THEN ee.reward_units ELSE 0 END), 0) as sborka_collect_units,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' AND ee.source_marketplace = 'wb' THEN ee.amount_delta ELSE 0 END), 0) as sborka_wb_amount,
          COALESCE(SUM(CASE WHEN ee.event_type IN ('external_order_pick','external_order_collect') AND ee.source = 'sborka-site' AND ee.source_marketplace = 'ozon' THEN ee.amount_delta ELSE 0 END), 0) as sborka_ozon_amount,
          MAX(ee.created_at) as last_earned_at
        FROM employees_s e
        LEFT JOIN employee_earnings_s ee ON ee.employee_id = e.id ${periodFilter}
        WHERE e.id = $1
        GROUP BY e.id, e.full_name, e.gra_balance
      `, [employeeId]),
      pool.query(`
        SELECT
          COALESCE(ee.task_id::text, 'deleted') as row_key,
          ee.task_id,
          COALESCE(t.title, MAX(ee.task_title), 'Удалённая задача') as title,
          t.status,
          COALESCE(t.task_type, MAX(ee.task_type), 'inventory') as task_type,
          s.code as shelf_code,
          s.name as shelf_name,
          r.name as rack_name,
          pa.name as pallet_name,
          pr.name as pallet_row_name,
          COALESCE(SUM(ee.amount_delta), 0) as amount_earned,
          COALESCE(SUM(ee.reward_units), 0) as rewarded_scans,
          COUNT(ee.id) as earning_events,
          COUNT(DISTINCT ee.task_box_id) FILTER (WHERE ee.task_box_id IS NOT NULL) as scopes_count,
          MAX(ee.created_at) as last_earned_at
        FROM employee_earnings_s ee
        LEFT JOIN inventory_tasks_s t ON t.id = ee.task_id
        LEFT JOIN shelves_s s ON s.id = t.shelf_id
        LEFT JOIN racks_s r ON r.id = s.rack_id
        LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
        LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
        WHERE ee.employee_id = $1
          AND ee.event_type = 'inventory_scan'
          ${periodFilter}
        GROUP BY
          ee.task_id, t.id, t.title, t.status, t.task_type,
          s.code, s.name, r.name, pa.name, pr.name
        ORDER BY last_earned_at DESC
      `, [employeeId]),
      pool.query(`
        SELECT
          ee.id,
          ee.amount_delta,
          ee.balance_before,
          ee.balance_after,
          ee.notes,
          ee.created_at,
          u.username as changed_by_username
        FROM employee_earnings_s ee
        LEFT JOIN users_s u ON u.id = ee.created_by_user_id
        WHERE ee.employee_id = $1
          AND ee.event_type = 'manual_adjustment'
        ORDER BY ee.created_at DESC
        LIMIT 50
      `, [employeeId]),
      pool.query(`
        SELECT
          ee.id,
          ee.event_type,
          ee.created_at,
          ee.amount_delta,
          ee.reward_units,
          ee.rate_per_unit,
          ee.source_marketplace,
          ee.source_store_id,
          ee.source_store_name,
          ee.source_entity_type,
          ee.source_entity_id,
          ee.source_entity_name,
          ee.source_article,
          ee.source_product_name,
          ee.source_marketplace_code,
          ee.source_marketplace_code_kind,
          ee.source_scanned_code,
          ee.source_task_id,
          ee.source_session_id,
          ee.source_item_id,
          ee.source_item_key,
          ee.source_order_ref
        FROM employee_earnings_s ee
        WHERE ee.employee_id = $1
          AND ee.event_type IN ('external_order_pick', 'external_order_collect')
          AND ee.source = 'sborka-site'
          ${periodFilter}
        ORDER BY ee.created_at DESC
      `, [employeeId]),
      pool.query(`
        SELECT
          id, event_type, order_id, product_name, barcode, quantity, marketplace, created_at
        FROM sborka_live_events_s sle
        WHERE sle.employee_id = $1
          ${liveFilter}
        ORDER BY sle.created_at DESC
      `, [employeeId]),
    ]);

    if (!employeeResult.rows.length) return res.status(404).json({ error: 'Сотрудник не найден' });

    res.json({
      employee: employeeResult.rows[0],
      tasks: tasksResult.rows,
      adjustments: adjustmentsResult.rows,
      sborka_picks: sborkaResult.rows,
      sborka_live_events: sborkaLiveResult.rows,
    });
  } catch (err) {
    if (err.message.includes('deadlock') && attempt < 3) { await new Promise(r => setTimeout(r, 500 * attempt)); continue; }
    return res.status(500).json({ error: err.message });
  } }
});

router.get('/tasks/:taskId', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) return res.status(400).json({ error: 'Некорректный taskId' });

    const taskResult = await pool.query(`
      SELECT
        t.id as task_id,
        t.title,
        t.status,
        t.task_type,
        t.created_at,
        t.started_at,
        t.completed_at,
        e.id as employee_id,
        e.full_name as employee_name,
        COALESCE(e.gra_balance, 0) as current_balance,
        s.id as shelf_id,
        s.code as shelf_code,
        s.name as shelf_name,
        r.name as rack_name,
        r.code as rack_code,
        pa.id as pallet_id,
        pa.name as pallet_name,
        pa.number as pallet_number,
        pr.name as pallet_row_name,
        pr.number as pallet_row_number,
        COALESCE(SUM(ee.amount_delta), 0) as total_earned,
        COALESCE(SUM(ee.reward_units), 0) as rewarded_scans,
        COUNT(ee.id) as earning_events
      FROM inventory_tasks_s t
      LEFT JOIN employees_s e ON e.id = t.employee_id
      LEFT JOIN shelves_s s ON s.id = t.shelf_id
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN pallets_s pa ON pa.id = t.target_pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      LEFT JOIN employee_earnings_s ee ON ee.task_id = t.id AND ee.event_type = 'inventory_scan'
      WHERE t.id = $1
      GROUP BY
        t.id, e.id, e.full_name, e.gra_balance,
        s.id, s.code, s.name, r.name, r.code,
        pa.id, pa.name, pa.number, pr.name, pr.number
    `, [taskId]);

    if (!taskResult.rows.length) return res.status(404).json({ error: 'Задача не найдена' });

    const task = taskResult.rows[0];
    const scansResult = await pool.query(`
      SELECT
        ee.id as earning_id,
        ee.amount_delta,
        ee.reward_units,
        ee.rate_per_unit,
        ee.balance_after,
        ee.created_at as earned_at,
        ee.task_box_id,
        ee.box_id,
        ee.shelf_box_id,
        ee.shelf_id,
        sc.id as task_scan_id,
        sc.scanned_value,
        sc.created_at as scanned_at,
        sc.quantity_delta,
        p.id as product_id,
        p.name as product_name,
        p.code as product_code,
        tb.sort_order as task_box_sort_order,
        sbx.position as shelf_box_position,
        sbx.barcode_value as shelf_box_barcode,
        bx.barcode_value as pallet_box_barcode,
        s.code as shelf_code,
        s.name as shelf_name,
        r.code as rack_code,
        r.name as rack_name,
        pa.number as pallet_number,
        pr.number as row_number
      FROM employee_earnings_s ee
      LEFT JOIN inventory_task_scans_s sc ON sc.id = ee.task_scan_id
      LEFT JOIN products_s p ON p.id = ee.product_id
      LEFT JOIN inventory_task_boxes_s tb ON tb.id = ee.task_box_id
      LEFT JOIN shelf_boxes_s sbx ON sbx.id = ee.shelf_box_id
      LEFT JOIN boxes_s bx ON bx.id = ee.box_id
      LEFT JOIN shelves_s s ON s.id = COALESCE(ee.shelf_id, sbx.shelf_id)
      LEFT JOIN racks_s r ON r.id = s.rack_id
      LEFT JOIN pallets_s pa ON pa.id = bx.pallet_id
      LEFT JOIN pallet_rows_s pr ON pr.id = pa.row_id
      WHERE ee.task_id = $1
        AND ee.event_type = 'inventory_scan'
      ORDER BY ee.created_at ASC, ee.id ASC
    `, [taskId]);

    const scopeMap = new Map();
    const scans = scansResult.rows.map((row) => {
      const scopeLabel = formatScopeLabel(row);
      const scopeKey = row.shelf_box_id
        ? `shelf_box:${row.shelf_box_id}`
        : row.box_id
        ? `pallet_box:${row.box_id}`
        : row.shelf_id
        ? `shelf:${row.shelf_id}`
        : `task:${taskId}`;

      if (!scopeMap.has(scopeKey)) {
        scopeMap.set(scopeKey, {
          scope_key: scopeKey,
          scope_type: row.shelf_box_id ? 'shelf_box' : row.box_id ? 'pallet_box' : row.shelf_id ? 'shelf' : 'task',
          scope_label: scopeLabel,
          box_barcode: row.shelf_box_barcode || row.pallet_box_barcode || null,
          amount_earned: 0,
          rewarded_scans: 0,
          scans: [],
        });
      }

      const group = scopeMap.get(scopeKey);
      group.amount_earned = Number(group.amount_earned || 0) + Number(row.amount_delta || 0);
      group.rewarded_scans = Number(group.rewarded_scans || 0) + Number(row.reward_units || 0);
      group.scans.push({
        earning_id: row.earning_id,
        task_scan_id: row.task_scan_id,
        scanned_value: row.scanned_value,
        scanned_at: row.scanned_at,
        product_id: row.product_id,
        product_name: row.product_name,
        product_code: row.product_code,
        quantity_delta: row.quantity_delta,
        reward_units: row.reward_units,
        rate_per_unit: row.rate_per_unit,
        amount_delta: row.amount_delta,
        balance_after: row.balance_after,
        scope_label: scopeLabel,
      });
      return {
        earning_id: row.earning_id,
        task_scan_id: row.task_scan_id,
        scanned_value: row.scanned_value,
        scanned_at: row.scanned_at,
        product_id: row.product_id,
        product_name: row.product_name,
        product_code: row.product_code,
        quantity_delta: row.quantity_delta,
        reward_units: row.reward_units,
        rate_per_unit: row.rate_per_unit,
        amount_delta: row.amount_delta,
        balance_after: row.balance_after,
        scope_label: scopeLabel,
      };
    });

    res.json({
      task,
      scopes: Array.from(scopeMap.values()),
      scans,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/employees/:employeeId/set-balance', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const newBalance = parseNumeric(req.body?.new_balance, NaN);
  const notes = String(req.body?.notes || '').trim();

  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'Некорректный employeeId' });
  if (!Number.isFinite(newBalance)) return res.status(400).json({ error: 'new_balance обязателен' });
  if (!notes) return res.status(400).json({ error: 'Укажите причину изменения баланса' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const employeeResult = await client.query(
      'SELECT id, full_name, COALESCE(gra_balance, 0) as gra_balance FROM employees_s WHERE id = $1 FOR UPDATE NOWAIT',
      [employeeId]
    );
    if (!employeeResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const employee = employeeResult.rows[0];
    const balanceBefore = Number(employee.gra_balance || 0);
    const balanceAfter = newBalance;
    const amountDelta = balanceAfter - balanceBefore;

    if (Math.abs(amountDelta) < 0.000001) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Баланс не изменился' });
    }

    const eventResult = await client.query(
      `INSERT INTO employee_earnings_s (
         employee_id, event_type, reward_units, rate_per_unit, amount_delta,
         balance_before, balance_after, notes, created_by_user_id
       )
       VALUES ($1, 'manual_adjustment', 0, 0, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employeeId, amountDelta, balanceBefore, balanceAfter, notes, req.user.id]
    );

    await client.query(
      'UPDATE employees_s SET gra_balance = $1, updated_at = NOW() WHERE id = $2',
      [balanceAfter, employeeId]
    );

    await client.query('COMMIT');
    res.json({
      employee: {
        employee_id: employee.id,
        full_name: employee.full_name,
        current_balance: balanceAfter,
      },
      event: eventResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/earnings/employees/:employeeId/adjust — списать/начислить сумму человеку.
// Body: { amount, mode?, notes }
//   amount — модуль суммы в GRA (всегда положительное число)
//   mode   — 'deduct' (списать, по умолчанию) | 'add' (начислить)
//   notes  — обязательная причина (идёт в аудит)
// Пишет manual_adjustment с amount_delta = ±amount и корректирует gra_balance.
router.post('/employees/:employeeId/adjust', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const amount = Math.abs(parseNumeric(req.body?.amount, NaN));
  const mode = req.body?.mode === 'add' ? 'add' : 'deduct';
  const notes = String(req.body?.notes || '').trim();

  if (!Number.isFinite(employeeId)) return res.status(400).json({ error: 'Некорректный employeeId' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше нуля' });
  if (!notes) return res.status(400).json({ error: 'Укажите причину' });

  const amountDelta = mode === 'add' ? amount : -amount;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const employeeResult = await client.query(
      'SELECT id, full_name, COALESCE(gra_balance, 0) as gra_balance FROM employees_s WHERE id = $1 FOR UPDATE NOWAIT',
      [employeeId]
    );
    if (!employeeResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Сотрудник не найден' });
    }

    const employee = employeeResult.rows[0];
    const balanceBefore = Number(employee.gra_balance || 0);
    const balanceAfter = balanceBefore + amountDelta;

    const eventResult = await client.query(
      `INSERT INTO employee_earnings_s (
         employee_id, event_type, reward_units, rate_per_unit, amount_delta,
         balance_before, balance_after, notes, created_by_user_id
       )
       VALUES ($1, 'manual_adjustment', 0, 0, $2, $3, $4, $5, $6)
       RETURNING *`,
      [employeeId, amountDelta, balanceBefore, balanceAfter, notes, req.user.id]
    );

    await client.query(
      'UPDATE employees_s SET gra_balance = $1, updated_at = NOW() WHERE id = $2',
      [balanceAfter, employeeId]
    );

    await client.query('COMMIT');
    res.json({
      employee: { employee_id: employee.id, full_name: employee.full_name, current_balance: balanceAfter },
      event: eventResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '55P03' || err.code === '40P01') return res.status(409).json({ error: 'Сотрудник занят, попробуйте ещё раз' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/earnings/payout-all — массовая выплата: обнуляем все положительные балансы
// одной транзакцией. На каждого сотрудника пишется manual_adjustment с amount_delta = -balance.
// Body: { notes: 'Выплачено за апрель 2026', employee_ids?: number[] }
//   notes — обязательно, идёт в notes каждого начисления (для аудита)
//   employee_ids — опционально, если нужно обнулить только указанных. Без поля — обнуляются ВСЕ с balance > 0.
router.post('/payout-all', requireAuth, requirePermission('staff.edit'), async (req, res) => {
  const notes = String(req.body?.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'Укажите причину (notes)' });

  const restrictIds = Array.isArray(req.body?.employee_ids)
    ? req.body.employee_ids.map(Number).filter(Number.isFinite)
    : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '10s'");

    const params = [];
    // По умолчанию обнуляем балансы только РАБОТАЮЩИХ сотрудников.
    // Уволенные исключены — их суммы спрятаны и в выплату не попадают.
    let where = 'COALESCE(gra_balance, 0) > 0 AND active = true';
    if (restrictIds && restrictIds.length) {
      // При явном списке id — игнорируем фильтр по active (точечная выплата кому угодно).
      where = 'COALESCE(gra_balance, 0) > 0';
      params.push(restrictIds);
      where += ` AND id = ANY($${params.length}::int[])`;
    }

    const empResult = await client.query(
      `SELECT id, full_name, COALESCE(gra_balance, 0) AS gra_balance
       FROM employees_s
       WHERE ${where}
       ORDER BY id
       FOR UPDATE NOWAIT`,
      params
    );

    const processed = [];
    let totalPaid = 0;
    for (const emp of empResult.rows) {
      const balanceBefore = Number(emp.gra_balance || 0);
      if (balanceBefore <= 0) continue;
      const amountDelta = -balanceBefore;

      await client.query(
        `INSERT INTO employee_earnings_s (
           employee_id, event_type, reward_units, rate_per_unit, amount_delta,
           balance_before, balance_after, notes, created_by_user_id
         )
         VALUES ($1, 'manual_adjustment', 0, 0, $2, $3, 0, $4, $5)`,
        [emp.id, amountDelta, balanceBefore, notes, req.user.id]
      );
      await client.query(
        'UPDATE employees_s SET gra_balance = 0, updated_at = NOW() WHERE id = $1',
        [emp.id]
      );

      processed.push({ employee_id: emp.id, full_name: emp.full_name, paid: balanceBefore });
      totalPaid += balanceBefore;
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      count: processed.length,
      total_paid: totalPaid,
      notes,
      employees: processed,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// POST /api/earnings/backfill-assembly — one-time backfill GRA for assembly scans
router.post('/backfill-assembly', requireAuth, requirePermission('settings'), async (_req, res) => {
  try {
    const rate = await pool.query(`SELECT value FROM settings_s WHERE key = 'gra_rate_assembly' LIMIT 1`);
    const graRate = rate.rows.length ? parseFloat(rate.rows[0].value) || 10 : 10;

    const unrewarded = await pool.query(`
      SELECT sc.id as scan_id, sc.task_id, sc.product_id, t.employee_id
      FROM inventory_task_scans_s sc
      JOIN inventory_tasks_s t ON t.id = sc.task_id AND t.task_type = 'bundle_assembly'
      WHERE NOT EXISTS (SELECT 1 FROM employee_earnings_s ee WHERE ee.task_scan_id = sc.id)
        AND t.employee_id IS NOT NULL
    `);

    let backfilled = 0;
    for (const scan of unrewarded.rows) {
      const bal = await pool.query('SELECT COALESCE(gra_balance, 0) as bal FROM employees_s WHERE id=$1', [scan.employee_id]);
      const balBefore = parseFloat(bal.rows[0]?.bal || 0);
      const balAfter = balBefore + graRate;
      // Check if already rewarded
      const exists = await pool.query('SELECT 1 FROM employee_earnings_s WHERE task_scan_id=$1', [scan.scan_id]);
      if (exists.rows.length) continue;
      await pool.query(
        `INSERT INTO employee_earnings_s (employee_id, task_id, task_scan_id, product_id, event_type, reward_units, rate_per_unit, amount_delta, balance_before, balance_after, task_type)
         VALUES ($1, $2, $3, $4, 'inventory_scan', 1, $5, $5, $6, $7, 'bundle_assembly')`,
        [scan.employee_id, scan.task_id, scan.scan_id, scan.product_id, graRate, balBefore, balAfter]);
      await pool.query('UPDATE employees_s SET gra_balance = $1 WHERE id = $2', [balAfter, scan.employee_id]);
      backfilled++;
    }

    res.json({ success: true, backfilled, rate: graRate });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Sborka assemblies (split-roles view) ──────────────────────────────────
// Агрегируем части сборок из employee_earnings_s. Не зависит от sborka-таблиц
// (supply_assignment_parts и т.п.) — всё что нужно уже пишется в earnings.
// Часть = (source_marketplace, source_task_id, source_entity_id).
router.get('/assemblies', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  try {
    const period = req.query.period || 'today';
    const marketplace = req.query.marketplace; // 'wb' | 'ozon' | undefined
    const storeId = req.query.store_id;

    const periodFilter = buildPeriodFilter(period, 'ee');

    const params = [];
    let extraWhere = '';
    if (marketplace === 'wb' || marketplace === 'ozon') {
      params.push(marketplace);
      extraWhere += ` AND ee.source_marketplace = $${params.length}`;
    }
    if (storeId) {
      params.push(String(storeId));
      extraWhere += ` AND ee.source_store_id = $${params.length}`;
    }

    // GROUP by (marketplace, task_id, entity_id) — это «часть сборки».
    // picker_id  = employee_id записей с external_order_pick    (берём любой; при redistribute их может быть несколько — первый)
    // packer_id  = employee_id записей с external_order_collect
    // mode       = split если picker_id != packer_id, иначе pick_pack
    const sql = `
      WITH parts AS (
        SELECT
          ee.source_marketplace,
          ee.source_task_id,
          ee.source_entity_id,
          COALESCE(ee.source_entity_name, '—')       AS entity_name,
          MAX(ee.source_store_id)                    AS store_id,
          MAX(ee.source_store_name)                  AS store_name,
          MIN(ee.created_at)                         AS first_at,
          MAX(ee.created_at)                         AS last_at,
          COUNT(*) FILTER (WHERE ee.event_type = 'external_order_pick')    AS pick_units,
          COUNT(*) FILTER (WHERE ee.event_type = 'external_order_collect') AS collect_units,
          SUM(ee.amount_delta) FILTER (WHERE ee.event_type = 'external_order_pick')    AS pick_amount,
          SUM(ee.amount_delta) FILTER (WHERE ee.event_type = 'external_order_collect') AS collect_amount,
          COUNT(DISTINCT ee.source_order_ref) FILTER (WHERE ee.event_type = 'external_order_collect' AND ee.source_order_ref IS NOT NULL) AS orders_count,
          COUNT(DISTINCT ee.employee_id) FILTER (WHERE ee.event_type = 'external_order_pick')    AS pickers_distinct,
          COUNT(DISTINCT ee.employee_id) FILTER (WHERE ee.event_type = 'external_order_collect') AS packers_distinct,
          (ARRAY_AGG(ee.employee_id ORDER BY ee.created_at) FILTER (WHERE ee.event_type = 'external_order_pick'))[1]    AS picker_id,
          (ARRAY_AGG(ee.employee_id ORDER BY ee.created_at) FILTER (WHERE ee.event_type = 'external_order_collect'))[1] AS packer_id,
          (ARRAY_AGG(ee.source_session_id ORDER BY ee.created_at) FILTER (WHERE ee.event_type = 'external_order_pick'))[1]    AS pick_session_id,
          (ARRAY_AGG(ee.source_session_id ORDER BY ee.created_at) FILTER (WHERE ee.event_type = 'external_order_collect'))[1] AS collect_session_id
        FROM employee_earnings_s ee
        WHERE ee.source = 'sborka-site'
          AND ee.event_type IN ('external_order_pick', 'external_order_collect')
          AND ee.source_task_id IS NOT NULL
          AND ee.source_entity_id IS NOT NULL
          ${periodFilter}
          ${extraWhere}
        GROUP BY ee.source_marketplace, ee.source_task_id, ee.source_entity_id, ee.source_entity_name
      )
      SELECT
        p.source_marketplace         AS marketplace,
        p.source_task_id             AS task_id,
        p.source_entity_id           AS entity_id,
        p.entity_name,
        p.store_id,
        p.store_name,
        p.first_at,
        p.last_at,
        p.pick_units,
        p.collect_units,
        COALESCE(p.pick_amount, 0)    AS pick_amount,
        COALESCE(p.collect_amount, 0) AS collect_amount,
        p.orders_count,
        p.pickers_distinct,
        p.packers_distinct,
        p.picker_id,
        p.packer_id,
        p.pick_session_id,
        p.collect_session_id,
        pe.full_name AS picker_name,
        pa.full_name AS packer_name,
        CASE
          WHEN p.picker_id IS NOT NULL AND p.packer_id IS NOT NULL AND p.picker_id <> p.packer_id THEN 'split'
          WHEN p.picker_id IS NOT NULL OR p.packer_id IS NOT NULL THEN 'pick_pack'
          ELSE 'unknown'
        END AS mode,
        CASE
          WHEN p.pick_units > 0 AND p.collect_units = 0 THEN 'picking'
          WHEN p.pick_units > 0 AND p.collect_units > 0 AND p.collect_units < p.pick_units THEN 'packing'
          WHEN p.pick_units > 0 AND p.collect_units >= p.pick_units THEN 'done'
          WHEN p.pick_units = 0 AND p.collect_units > 0 THEN 'packing_only'
          ELSE 'empty'
        END AS status,
        CASE WHEN p.pickers_distinct > 1 OR p.packers_distinct > 1 THEN true ELSE false END AS redistributed
      FROM parts p
      LEFT JOIN employees_s pe ON pe.id = p.picker_id
      LEFT JOIN employees_s pa ON pa.id = p.packer_id
      ORDER BY p.last_at DESC
      LIMIT 500
    `;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/earnings/months — список месяцев, в которых есть начисления
router.get('/months', requireAuth, requirePermission('analytics', 'staff.view'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS ym,
        MIN(created_at) AS first_at,
        MAX(created_at) AS last_at
      FROM employee_earnings_s
      WHERE created_at IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 36
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/earnings/monthly — помесячная разбивка заработка
//   ?employee_id=N — только по одному сотруднику
//   ?months=12     — сколько последних месяцев брать (по умолчанию 12)
router.get('/monthly', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  try {
    const monthsBack = Math.max(1, Math.min(36, Number(req.query.months) || 12));
    const employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

    const params = [monthsBack];
    let where = `ee.created_at >= date_trunc('month', CURRENT_DATE) - ((${'$1'}::int - 1) * INTERVAL '1 month')`;
    if (Number.isFinite(employeeId)) {
      params.push(employeeId);
      where += ` AND ee.employee_id = $${params.length}`;
    }

    const { rows } = await pool.query(`
      SELECT
        ee.employee_id,
        e.full_name,
        e.position,
        e.active,
        COALESCE(e.gra_balance, 0)                                          AS current_balance,
        TO_CHAR(date_trunc('month', ee.created_at), 'YYYY-MM')              AS ym,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type = 'inventory_scan'), 0)                       AS warehouse_amount,
        COALESCE(SUM(ee.reward_units) FILTER (
          WHERE ee.event_type = 'inventory_scan'), 0)                       AS warehouse_scans,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type = 'external_order_pick'
            AND ee.source = 'sborka-site'), 0)                              AS pick_amount,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type = 'external_order_collect'
            AND ee.source = 'sborka-site'), 0)                              AS collect_amount,
        COALESCE(SUM(ee.amount_delta) FILTER (
          WHERE ee.event_type = 'manual_adjustment'), 0)                    AS adjustments_amount,
        COALESCE(SUM(ee.amount_delta), 0)                                   AS total_amount
      FROM employee_earnings_s ee
      JOIN employees_s e ON e.id = ee.employee_id
      WHERE ${where}
      GROUP BY ee.employee_id, e.full_name, e.position, e.active, e.gra_balance,
               date_trunc('month', ee.created_at)
      ORDER BY e.full_name ASC, ym ASC
    `, params);

    res.json({ months_back: monthsBack, rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/earnings/export.xlsx — красивый цветной Excel: сотрудники × месяцы
router.get('/export.xlsx', requireAuth, requirePermission('analytics', 'staff.view'), async (req, res) => {
  try {
    const monthsBack = Math.max(1, Math.min(24, Number(req.query.months) || 6));
    const unit = req.query.unit === 'rub' ? 'rub' : 'gra';
    const GRA_TO_RUB = 0.01;
    const conv = (v) => unit === 'rub' ? Number(v || 0) * GRA_TO_RUB : Number(v || 0);
    const unitLabel = unit === 'rub' ? '₽' : 'GRA';

    // Последние N месяцев в порядке возрастания (YYYY-MM)
    const monthsCols = [];
    const now = new Date();
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsCols.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const MONTH_LABELS_RU = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    const monthLabel = (ym) => {
      const [y, m] = ym.split('-');
      return `${MONTH_LABELS_RU[Number(m) - 1]} ${y}`;
    };

    // Данные по сотрудникам и месяцам
    const { rows: monthly } = await pool.query(`
      SELECT
        ee.employee_id,
        e.full_name,
        e.position,
        e.active,
        COALESCE(e.gra_balance, 0)                              AS current_balance,
        TO_CHAR(date_trunc('month', ee.created_at), 'YYYY-MM')  AS ym,
        COALESCE(SUM(ee.amount_delta), 0)                       AS total_amount
      FROM employee_earnings_s ee
      JOIN employees_s e ON e.id = ee.employee_id
      WHERE ee.created_at >= date_trunc('month', CURRENT_DATE) - (($1::int - 1) * INTERVAL '1 month')
      GROUP BY ee.employee_id, e.full_name, e.position, e.active, e.gra_balance,
               date_trunc('month', ee.created_at)
      ORDER BY e.full_name ASC
    `, [monthsBack]);

    // Также включаем сотрудников с балансом, у которых нет начислений за период
    const { rows: allEmps } = await pool.query(`
      SELECT id AS employee_id, full_name, position, active, COALESCE(gra_balance, 0) AS current_balance
      FROM employees_s
      WHERE COALESCE(gra_balance, 0) <> 0 OR active = true
      ORDER BY full_name ASC
    `);

    // Свод по сотрудникам
    const empMap = new Map();
    for (const e of allEmps) {
      empMap.set(e.employee_id, {
        employee_id: e.employee_id,
        full_name: e.full_name,
        position: e.position || '',
        active: e.active,
        current_balance: Number(e.current_balance || 0),
        months: {},
      });
    }
    for (const r of monthly) {
      if (!empMap.has(r.employee_id)) {
        empMap.set(r.employee_id, {
          employee_id: r.employee_id,
          full_name: r.full_name,
          position: r.position || '',
          active: r.active,
          current_balance: Number(r.current_balance || 0),
          months: {},
        });
      }
      const emp = empMap.get(r.employee_id);
      emp.months[r.ym] = Number(r.total_amount || 0);
    }

    // Книга Excel
    const wb = new ExcelJS.Workbook();
    wb.creator = 'GRA Склад';
    wb.created = new Date();
    const ws = wb.addWorksheet('Заработок по месяцам', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
    });

    // ─── Заголовок-баннер ───────────────────────────────────────
    ws.mergeCells(1, 1, 1, 4 + monthsCols.length);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `GRA Склад — Заработок сотрудников (${unitLabel})`;
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B5BF5' } };
    ws.getRow(1).height = 32;

    ws.mergeCells(2, 1, 2, 4 + monthsCols.length);
    const subCell = ws.getCell(2, 1);
    const periodLabel = `${monthLabel(monthsCols[0])} — ${monthLabel(monthsCols[monthsCols.length - 1])}`;
    subCell.value = `Период: ${periodLabel}   ·   Сформировано: ${new Date().toLocaleString('ru-RU')}`;
    subCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF6B7280' } };
    subCell.alignment = { vertical: 'middle', horizontal: 'center' };
    ws.getRow(2).height = 20;

    // Пустая строка-разделитель
    ws.getRow(3).height = 6;

    // ─── Заголовки таблицы ──────────────────────────────────────
    const headerRowIdx = 4;
    const headers = ['#', 'Сотрудник', 'Должность', 'Статус', ...monthsCols.map(monthLabel), `Итого ${unitLabel}`, `Баланс ${unitLabel}`];
    const headerRow = ws.getRow(headerRowIdx);
    headers.forEach((h, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = h;
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: i < 4 ? 'left' : 'center', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF374151' } },
        left: { style: 'thin', color: { argb: 'FF374151' } },
        bottom: { style: 'medium', color: { argb: 'FF5B5BF5' } },
        right: { style: 'thin', color: { argb: 'FF374151' } },
      };
    });
    headerRow.height = 28;

    // Ширины колонок
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 28;
    ws.getColumn(3).width = 18;
    ws.getColumn(4).width = 12;
    for (let i = 0; i < monthsCols.length; i++) ws.getColumn(5 + i).width = 14;
    ws.getColumn(5 + monthsCols.length).width = 16;
    ws.getColumn(6 + monthsCols.length).width = 16;

    // ─── Тело таблицы ───────────────────────────────────────────
    const employees = Array.from(empMap.values()).sort((a, b) => {
      // активные первыми, по убыванию суммарного итога
      if (a.active !== b.active) return a.active ? -1 : 1;
      const sa = monthsCols.reduce((s, m) => s + (a.months[m] || 0), 0);
      const sb = monthsCols.reduce((s, m) => s + (b.months[m] || 0), 0);
      return sb - sa;
    });

    // Палитра для тепловой раскраски — от очень светлого к насыщенному
    const COLOR_SCALE = [
      'FFFFFFFF', // 0
      'FFEEF2FF', // tiny
      'FFDDE7FF',
      'FFC7D6FF',
      'FFA9C0FF',
      'FF85A6FF',
      'FF5B8DFF',
      'FF3D78FF',
    ];

    // Найдём максимум для шкалы
    let maxMonthValue = 0;
    for (const e of employees) {
      for (const m of monthsCols) maxMonthValue = Math.max(maxMonthValue, conv(e.months[m] || 0));
    }
    const colorFor = (val) => {
      if (!maxMonthValue || val <= 0) return COLOR_SCALE[0];
      const ratio = val / maxMonthValue;
      const idx = Math.min(COLOR_SCALE.length - 1, Math.max(1, Math.ceil(ratio * (COLOR_SCALE.length - 1))));
      return COLOR_SCALE[idx];
    };

    let r = headerRowIdx + 1;
    let totalSum = 0;
    const monthTotals = Object.fromEntries(monthsCols.map(m => [m, 0]));

    employees.forEach((emp, idx) => {
      const row = ws.getRow(r);
      const zebra = r % 2 === 0 ? 'FFFAFAFA' : 'FFFFFFFF';
      let rowSum = 0;

      const baseAlign = { vertical: 'middle', horizontal: 'left' };
      const num = (v) => Math.round(conv(v) * 100) / 100;

      row.getCell(1).value = idx + 1;
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'center' };
      row.getCell(1).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF9CA3AF' } };

      row.getCell(2).value = emp.full_name;
      row.getCell(2).alignment = baseAlign;
      row.getCell(2).font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF111827' } };

      row.getCell(3).value = emp.position || '—';
      row.getCell(3).alignment = baseAlign;
      row.getCell(3).font = { name: 'Segoe UI', size: 10, color: { argb: 'FF6B7280' } };

      const statusCell = row.getCell(4);
      statusCell.value = emp.active ? 'Активен' : 'Уволен';
      statusCell.alignment = { vertical: 'middle', horizontal: 'center' };
      statusCell.font = {
        name: 'Segoe UI', size: 10, bold: true,
        color: { argb: emp.active ? 'FF059669' : 'FFDC2626' },
      };
      statusCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: emp.active ? 'FFD1FAE5' : 'FFFEE2E2' },
      };

      monthsCols.forEach((m, mi) => {
        const cellIdx = 5 + mi;
        const val = num(emp.months[m] || 0);
        const cell = row.getCell(cellIdx);
        cell.value = val;
        cell.numFmt = '#,##0.00;[Red]-#,##0.00;""';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        cell.font = { name: 'Segoe UI', size: 10, color: { argb: val > 0 ? 'FF111827' : 'FFD1D5DB' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorFor(val) } };
        rowSum += val;
        monthTotals[m] += val;
      });

      const totalCell = row.getCell(5 + monthsCols.length);
      totalCell.value = Math.round(rowSum * 100) / 100;
      totalCell.numFmt = '#,##0.00';
      totalCell.alignment = { vertical: 'middle', horizontal: 'right' };
      totalCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FF1E3A8A' } };
      totalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      totalSum += rowSum;

      const balCell = row.getCell(6 + monthsCols.length);
      const balVal = Math.round(num(emp.current_balance) * 100) / 100;
      balCell.value = balVal;
      balCell.numFmt = '#,##0.00';
      balCell.alignment = { vertical: 'middle', horizontal: 'right' };
      balCell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: balVal > 0 ? 'FF047857' : 'FF9CA3AF' } };
      balCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: balVal > 0 ? 'FFD1FAE5' : 'FFF3F4F6' } };

      // Зебра для нейтральных колонок
      [1, 2, 3].forEach(ci => {
        const c = row.getCell(ci);
        if (!c.fill || c.fill.fgColor?.argb === undefined) {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebra } };
        }
      });

      // Тонкие границы
      for (let ci = 1; ci <= 6 + monthsCols.length; ci++) {
        row.getCell(ci).border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        };
      }
      row.height = 22;
      r++;
    });

    // ─── Итоговая строка ────────────────────────────────────────
    const totalRow = ws.getRow(r);
    totalRow.getCell(1).value = '';
    const totalLabel = totalRow.getCell(2);
    totalLabel.value = 'ИТОГО';
    totalLabel.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    totalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
    ws.mergeCells(r, 1, r, 4);
    totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };

    monthsCols.forEach((m, mi) => {
      const cell = totalRow.getCell(5 + mi);
      cell.value = Math.round(monthTotals[m] * 100) / 100;
      cell.numFmt = '#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
      cell.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B5BF5' } };
    });
    const totalGrand = totalRow.getCell(5 + monthsCols.length);
    totalGrand.value = Math.round(totalSum * 100) / 100;
    totalGrand.numFmt = '#,##0.00';
    totalGrand.alignment = { vertical: 'middle', horizontal: 'right' };
    totalGrand.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    totalGrand.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

    const totalBalCell = totalRow.getCell(6 + monthsCols.length);
    const balSum = employees.reduce((s, e) => s + (Number(e.current_balance) || 0) * (unit === 'rub' ? GRA_TO_RUB : 1), 0);
    totalBalCell.value = Math.round(balSum * 100) / 100;
    totalBalCell.numFmt = '#,##0.00';
    totalBalCell.alignment = { vertical: 'middle', horizontal: 'right' };
    totalBalCell.font = { name: 'Segoe UI', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    totalBalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };

    totalRow.height = 30;

    // Поток
    const fname = `earnings_${monthsCols[0]}_${monthsCols[monthsCols.length - 1]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

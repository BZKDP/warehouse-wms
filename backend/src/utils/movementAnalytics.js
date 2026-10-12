// Аналитика движений товара: что и сколько ушло со склада за период.
// Одна точка правды по классификации типов движений и каналов сбыта —
// используется всеми эндпоинтами /api/movements/analytics/*.

// ─── Категории операций ───────────────────────────────────────────────────────
// writeoff — товар ушёл с фирмы: автосписание после сборки заказа маркетплейса.
// bundle   — производство наборов: компоненты сняты (pick) и уложены (place).
// inbound  — приход: внешняя поставка, оприходование, ручное добавление.
// adjust   — уменьшение остатка не через отгрузку: правки, удаление коробок.
// transfer — внутренние перемещения между полками/паллетами/коробками/людьми.
const CATEGORIES = {
  writeoff: {
    label: 'Списания',
    types: ['employee_writeoff'],
  },
  bundle: {
    label: 'Сборка наборов',
    types: ['bundle_pick', 'bundle_place'],
  },
  inbound: {
    label: 'Приход',
    types: [
      'external_to_pallet', 'external_to_shelf', 'external_to_box', 'external_to_employee',
      'edit_add_to_shelf', 'edit_add_to_pallet', 'edit_add_to_box',
      'box_create', 'pallet_correction_in', 'employee_correction_in', 'employee_restore',
    ],
  },
  adjust: {
    label: 'Корректировки',
    types: [
      'edit_remove_from_shelf', 'edit_remove_from_pallet', 'edit_remove_from_box',
      'pallet_correction_out', 'employee_correction_out', 'box_delete', 'box_product_change',
    ],
  },
  transfer: {
    label: 'Перемещения',
    types: [
      'shelf_to_employee', 'shelf_to_shelf', 'shelf_to_pallet', 'shelf_to_box',
      'pallet_to_shelf', 'pallet_to_pallet', 'pallet_to_box', 'pallet_to_employee',
      'box_to_shelf', 'box_to_pallet', 'box_to_box', 'box_to_employee', 'box_transfer',
      'employee_to_shelf', 'employee_to_pallet', 'employee_to_box', 'employee_transfer',
    ],
  },
};

// ─── Каналы сбыта ─────────────────────────────────────────────────────────────
// Определяются по movements_s.source: wb_collect / wb_pick_scan / wb_handoff → WB,
// oz_collect / oz_pick_scan → Ozon, остальное — внутренние операции склада.
const CHANNEL_SQL = `CASE
  WHEN m.source LIKE 'wb%' THEN 'wb'
  WHEN m.source LIKE 'oz%' THEN 'ozon'
  ELSE 'other'
END`;

function categoryTypes(category) {
  if (!category || category === 'all') return null;
  return CATEGORIES[category]?.types || null;
}

// Общие условия выборки. Возвращает { where, params } — параметры нумеруются с 1.
function buildFilters({ category, channel, employee_id, product_id, search, date_from, date_to }) {
  const conditions = [];
  const params = [];

  const types = categoryTypes(category);
  if (types) { params.push(types); conditions.push(`m.movement_type = ANY($${params.length})`); }

  if (channel && channel !== 'all') {
    params.push(channel);
    conditions.push(`${CHANNEL_SQL} = $${params.length}`);
  }
  if (employee_id) {
    params.push(parseInt(employee_id, 10));
    conditions.push(`(m.from_employee_id = $${params.length} OR m.to_employee_id = $${params.length} OR m.performed_by = $${params.length})`);
  }
  if (product_id) { params.push(parseInt(product_id, 10)); conditions.push(`m.product_id = $${params.length}`); }
  if (search) {
    params.push(`%${search.trim()}%`);
    conditions.push(`(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.article ILIKE $${params.length})`);
  }
  // Период: по умолчанию последние 30 дней, иначе бессмысленно тяжёлый скан.
  if (date_from) { params.push(date_from); conditions.push(`m.created_at >= $${params.length}::date`); }
  if (date_to) { params.push(date_to); conditions.push(`m.created_at < ($${params.length}::date + INTERVAL '1 day')`); }
  if (!date_from && !date_to) conditions.push(`m.created_at >= NOW() - INTERVAL '30 days'`);

  return { where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '', params };
}

const SORTS = {
  qty: 'qty DESC, ops DESC',
  ops: 'ops DESC, qty DESC',
  name: 'product_name ASC',
  last: 'last_at DESC',
};

// Сводка по товарам за период: сколько списано всего и в разрезе каналов.
async function getProductSummary(pool, query) {
  const { where, params } = buildFilters(query);
  const sort = SORTS[query.sort] || SORTS.qty;
  const limit = Math.min(parseInt(query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);

  const sql = `
    SELECT m.product_id,
           COALESCE(p.name, 'Товар удалён') AS product_name,
           p.code, p.article,
           SUM(m.quantity)::numeric  AS qty,
           COUNT(*)::int             AS ops,
           COUNT(DISTINCT m.created_at::date)::int AS days,
           MAX(m.created_at)         AS last_at,
           SUM(m.quantity) FILTER (WHERE m.source LIKE 'wb%')::numeric AS qty_wb,
           SUM(m.quantity) FILTER (WHERE m.source LIKE 'oz%')::numeric AS qty_ozon,
           SUM(m.quantity) FILTER (WHERE m.source NOT LIKE 'wb%' AND m.source NOT LIKE 'oz%' OR m.source IS NULL)::numeric AS qty_other
      FROM movements_s m
      LEFT JOIN products_s p ON p.id = m.product_id
      ${where}
     GROUP BY m.product_id, p.name, p.code, p.article
     ORDER BY ${sort}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const totalsSql = `
    SELECT COALESCE(SUM(m.quantity), 0)::numeric AS qty,
           COUNT(*)::int                         AS ops,
           COUNT(DISTINCT m.product_id)::int     AS products,
           COUNT(DISTINCT m.created_at::date)::int AS days,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.source LIKE 'wb%'), 0)::numeric AS qty_wb,
           COALESCE(SUM(m.quantity) FILTER (WHERE m.source LIKE 'oz%'), 0)::numeric AS qty_ozon
      FROM movements_s m
      LEFT JOIN products_s p ON p.id = m.product_id
      ${where}`;

  const [rowsRes, totalsRes] = await Promise.all([
    pool.query(sql, [...params, limit, offset]),
    pool.query(totalsSql, params),
  ]);

  const totals = totalsRes.rows[0];
  return {
    rows: rowsRes.rows.map(r => ({
      product_id: r.product_id,
      product_name: r.product_name,
      code: r.code,
      article: r.article,
      qty: Number(r.qty || 0),
      ops: r.ops,
      days: r.days,
      last_at: r.last_at,
      qty_wb: Number(r.qty_wb || 0),
      qty_ozon: Number(r.qty_ozon || 0),
      qty_other: Number(r.qty_other || 0),
    })),
    totals: {
      qty: Number(totals.qty || 0),
      ops: totals.ops,
      products: totals.products,
      days: totals.days,
      qty_wb: Number(totals.qty_wb || 0),
      qty_ozon: Number(totals.qty_ozon || 0),
      avg_per_day: totals.days ? Number(totals.qty || 0) / totals.days : 0,
    },
    limit,
    offset,
  };
}

// Разбивка по дням — для графика и режима «по дням».
async function getDailySummary(pool, query) {
  const { where, params } = buildFilters(query);
  const { rows } = await pool.query(`
    SELECT m.created_at::date AS day,
           SUM(m.quantity)::numeric AS qty,
           COUNT(*)::int AS ops,
           COUNT(DISTINCT m.product_id)::int AS products,
           SUM(m.quantity) FILTER (WHERE m.source LIKE 'wb%')::numeric AS qty_wb,
           SUM(m.quantity) FILTER (WHERE m.source LIKE 'oz%')::numeric AS qty_ozon
      FROM movements_s m
      LEFT JOIN products_s p ON p.id = m.product_id
      ${where}
     GROUP BY day
     ORDER BY day DESC`, params);

  return rows.map(r => ({
    day: r.day,
    qty: Number(r.qty || 0),
    ops: r.ops,
    products: r.products,
    qty_wb: Number(r.qty_wb || 0),
    qty_ozon: Number(r.qty_ozon || 0),
  }));
}

// Детализация одного товара за период: по дням и по сотрудникам.
async function getProductDetail(pool, productId, query) {
  const q = { ...query, product_id: productId };
  const { where, params } = buildFilters(q);

  const [byDay, byEmployee] = await Promise.all([
    pool.query(`
      SELECT m.created_at::date AS day,
             SUM(m.quantity)::numeric AS qty,
             COUNT(*)::int AS ops,
             SUM(m.quantity) FILTER (WHERE m.source LIKE 'wb%')::numeric AS qty_wb,
             SUM(m.quantity) FILTER (WHERE m.source LIKE 'oz%')::numeric AS qty_ozon
        FROM movements_s m
        LEFT JOIN products_s p ON p.id = m.product_id
        ${where}
       GROUP BY day ORDER BY day DESC LIMIT 90`, params),
    pool.query(`
      SELECT COALESCE(e.full_name, u.username, 'Система') AS employee_name,
             SUM(m.quantity)::numeric AS qty,
             COUNT(*)::int AS ops
        FROM movements_s m
        LEFT JOIN products_s p ON p.id = m.product_id
        LEFT JOIN employees_s e ON e.id = COALESCE(m.from_employee_id, m.to_employee_id)
        LEFT JOIN users_s u ON u.id = m.performed_by
        ${where}
       GROUP BY employee_name ORDER BY qty DESC LIMIT 20`, params),
  ]);

  return {
    by_day: byDay.rows.map(r => ({
      day: r.day,
      qty: Number(r.qty || 0),
      ops: r.ops,
      qty_wb: Number(r.qty_wb || 0),
      qty_ozon: Number(r.qty_ozon || 0),
    })),
    by_employee: byEmployee.rows.map(r => ({
      employee_name: r.employee_name,
      qty: Number(r.qty || 0),
      ops: r.ops,
    })),
  };
}

// Сотрудники, которые вообще фигурируют в движениях за период — для фильтра.
// Отдельно от /staff/employees: страницу смотрят по movements.view, права на
// раздел сотрудников у смотрящего может не быть.
async function getEmployees(pool, query) {
  const { where, params } = buildFilters(query);
  const { rows } = await pool.query(`
    SELECT e.id, e.full_name, SUM(m.quantity)::numeric AS qty
      FROM movements_s m
      LEFT JOIN products_s p ON p.id = m.product_id
      JOIN employees_s e ON e.id = COALESCE(m.from_employee_id, m.to_employee_id)
      ${where}
     GROUP BY e.id, e.full_name
     ORDER BY qty DESC`, params);
  return rows.map(r => ({ id: r.id, full_name: r.full_name, qty: Number(r.qty || 0) }));
}

module.exports = { CATEGORIES, getProductSummary, getDailySummary, getProductDetail, getEmployees, buildFilters };

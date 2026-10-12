import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  History, Search, Download, RotateCcw, Package,
  TrendingDown, Layers, Activity, CalendarRange,
} from 'lucide-react';
import api from '../../api/client';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { cn } from '../../utils/cn';
import { fmtQty } from '../../utils/fmt';
import { ProductTable, DailyTable, fmtDay } from './movements/MovementViews';
import MovementJournal from './movements/MovementJournal';

// ─── Периоды ──────────────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const shift = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return iso(d); };
const monthStart = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return iso(d); };
const monthEnd = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset + 1); d.setDate(0); return iso(d); };

const PRESETS = [
  { key: 'today',     label: 'Сегодня',       from: () => shift(0),  to: () => shift(0) },
  { key: 'yesterday', label: 'Вчера',         from: () => shift(-1), to: () => shift(-1) },
  { key: 'week',      label: '7 дней',        from: () => shift(-6), to: () => shift(0) },
  { key: 'month',     label: '30 дней',       from: () => shift(-29), to: () => shift(0) },
  { key: 'cur_month', label: 'Этот месяц',    from: () => monthStart(0), to: () => shift(0) },
  { key: 'prev_month',label: 'Прошлый месяц', from: () => monthStart(-1), to: () => monthEnd(-1) },
];

const CATEGORIES = [
  { key: 'writeoff', label: 'Списания',       hint: 'Ушло с фирмы после сборки заказов WB и Ozon' },
  { key: 'bundle',   label: 'Сборка наборов', hint: 'Компоненты, снятые и уложенные при сборке наборов' },
  { key: 'inbound',  label: 'Приход',         hint: 'Поставки, оприходование, ручное добавление' },
  { key: 'adjust',   label: 'Корректировки',  hint: 'Правки остатков и удаление коробок' },
  { key: 'transfer', label: 'Перемещения',    hint: 'Внутренние переносы между полками, паллетами и людьми' },
  { key: 'all',      label: 'Всё',            hint: 'Любые операции с товаром' },
];

const CHANNELS = [
  { key: 'all',   label: 'Все каналы' },
  { key: 'wb',    label: 'Wildberries' },
  { key: 'ozon',  label: 'Ozon' },
  { key: 'other', label: 'Склад' },
];

const VIEWS = [
  { key: 'products', label: 'По товарам' },
  { key: 'days',     label: 'По дням' },
  { key: 'journal',  label: 'Журнал' },
];

function StatCard({ icon: Icon, label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400',
    rose: 'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400',
    blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    green: 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400',
  };
  return (
    <div className="stat-card">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', colors[color])}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white tabular-nums leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

export default function ProductMovementsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [category, setCategory] = useState(() => searchParams.get('category') || 'writeoff');
  const [channel, setChannel] = useState(() => searchParams.get('channel') || 'all');
  const [view, setView] = useState(() => searchParams.get('view') || 'products');
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || shift(-6));
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || shift(0));
  const [preset, setPreset] = useState(() => searchParams.get('preset') || 'week');
  const [employeeId, setEmployeeId] = useState(() => searchParams.get('employee') || '');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sort, setSort] = useState({ key: 'qty', dir: 'desc' });

  const [summary, setSummary] = useState({ rows: [], totals: null });
  const [days, setDays] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Поиск с задержкой, чтобы не дёргать сервер на каждую букву
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Список сотрудников — только те, кто реально двигал товар в этом периоде
  useEffect(() => {
    api.get('/movements/analytics/employees', { params: { category, date_from: dateFrom, date_to: dateTo } })
      .then(r => setEmployees(r.data || []))
      .catch(() => setEmployees([]));
  }, [category, dateFrom, dateTo]);

  // Фильтры в адресной строке — ссылкой можно поделиться
  useEffect(() => {
    const p = new URLSearchParams();
    p.set('category', category);
    if (channel !== 'all') p.set('channel', channel);
    if (view !== 'products') p.set('view', view);
    p.set('from', dateFrom);
    p.set('to', dateTo);
    if (preset) p.set('preset', preset);
    if (employeeId) p.set('employee', employeeId);
    setSearchParams(p, { replace: true });
  }, [category, channel, view, dateFrom, dateTo, preset, employeeId, setSearchParams]);

  const query = useMemo(() => {
    const q = { category, date_from: dateFrom, date_to: dateTo };
    if (channel !== 'all') q.channel = channel;
    if (employeeId) q.employee_id = employeeId;
    if (search) q.search = search;
    return q;
  }, [category, channel, dateFrom, dateTo, employeeId, search]);

  const load = useCallback(async () => {
    if (view === 'journal') { setLoading(false); return; }
    setLoading(true);
    try {
      const params = { ...query, sort: sort.key, limit: 300 };
      const [s, d] = await Promise.all([
        api.get('/movements/analytics/summary', { params }),
        api.get('/movements/analytics/daily', { params: query }),
      ]);
      setSummary(s.data);
      setDays(d.data || []);
    } catch {
      setSummary({ rows: [], totals: null });
      setDays([]);
    } finally {
      setLoading(false);
    }
  }, [query, sort.key, view]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (p) => {
    setPreset(p.key);
    setDateFrom(p.from());
    setDateTo(p.to());
  };

  const reset = () => {
    applyPreset(PRESETS[2]);
    setCategory('writeoff');
    setChannel('all');
    setEmployeeId('');
    setSearchInput('');
    setSort({ key: 'qty', dir: 'desc' });
  };

  const onSort = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

  // Сортировка на клиенте: сервер отдаёт по убыванию, направление меняем здесь
  const rows = useMemo(() => {
    const list = [...(summary.rows || [])];
    if (sort.dir === 'asc') list.reverse();
    return list;
  }, [summary.rows, sort.dir]);

  const pickDay = (day) => {
    setPreset('');
    setDateFrom(day);
    setDateTo(day);
    setView('products');
  };

  const exportCsv = () => {
    const head = ['Товар', 'Код', 'Всего', 'WB', 'Ozon', 'Склад', 'Операций', 'Дней'];
    const lines = rows.map(r => [
      `"${(r.product_name || '').replace(/"/g, '""')}"`,
      r.code || '', r.qty, r.qty_wb, r.qty_ozon, r.qty_other, r.ops, r.days,
    ].join(';'));
    const csv = '﻿' + [head.join(';'), ...lines].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `движение-товара_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = summary.totals;
  const catMeta = CATEGORIES.find(c => c.key === category);
  const periodLabel = dateFrom === dateTo ? fmtDay(dateFrom) : `${fmtDay(dateFrom)} — ${fmtDay(dateTo)}`;

  return (
    <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
      {/* Шапка */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <History size={24} className="text-primary-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Движение товара</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{catMeta?.hint}</p>
          </div>
        </div>
        <button
          onClick={exportCsv}
          disabled={!rows.length}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          <Download size={15} /> Выгрузить CSV
        </button>
      </div>

      {/* Фильтры */}
      <div className="card p-4 mb-5 space-y-3">
        {/* Категории */}
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map(c => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                category === c.key
                  ? 'bg-primary-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Период */}
        <div className="flex flex-wrap items-center gap-1.5">
          <CalendarRange size={14} className="text-gray-400 mr-1" />
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => applyPreset(p)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                preset === p.key
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              )}
            >
              {p.label}
            </button>
          ))}
          <div className="flex items-center gap-2 ml-auto">
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset(''); }} />
            <span className="text-gray-400 text-sm">—</span>
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset(''); }} />
          </div>
        </div>

        {/* Канал, сотрудник, поиск */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select value={channel} onChange={e => setChannel(e.target.value)}>
            {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
          <Select value={employeeId} onChange={e => setEmployeeId(e.target.value)}>
            <option value="">Все сотрудники</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name || e.name}</option>)}
          </Select>
          <Input
            icon={<Search size={15} />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Название, код товара"
          />
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <RotateCcw size={14} /> Сбросить
          </button>
        </div>
      </div>

      {/* Итоги */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatCard
          icon={TrendingDown}
          color="rose"
          label={category === 'writeoff' ? 'Списано за период' : 'Количество за период'}
          value={fmtQty(totals?.qty || 0)}
          sub={periodLabel}
        />
        <StatCard
          icon={Package}
          color="primary"
          label="Позиций товара"
          value={totals?.products || 0}
          sub={`${totals?.days || 0} дн. с движением`}
        />
        <StatCard
          icon={Activity}
          color="blue"
          label="Операций"
          value={(totals?.ops || 0).toLocaleString('ru-RU')}
          sub={`WB ${fmtQty(totals?.qty_wb || 0)} · Ozon ${fmtQty(totals?.qty_ozon || 0)}`}
        />
        <StatCard
          icon={Layers}
          color="green"
          label="В среднем в день"
          value={fmtQty(Math.round(totals?.avg_per_day || 0))}
          sub="за дни с движением"
        />
      </div>

      {/* Переключатель вида */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {VIEWS.map(v => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
              view === v.key
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'products' && (
        <ProductTable rows={rows} loading={loading} sort={sort} onSort={onSort} detailParams={query} />
      )}
      {view === 'days' && (
        <DailyTable days={days} loading={loading} onPickDay={pickDay} />
      )}
      {view === 'journal' && (
        <MovementJournal filters={{ category, date_from: dateFrom, date_to: dateTo, employee_id: employeeId, search }} />
      )}
    </div>
  );
}

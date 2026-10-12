import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, ChevronDown, RefreshCw, Search, Download, Calendar, Wallet, X, MinusCircle } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';

/* ─── Месяцы ────────────────────────────────────────────────────────────── */
const MONTH_LABELS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const MONTH_SHORT_RU  = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
function isMonthPeriod(p) { return typeof p === 'string' && /^\d{4}-\d{2}$/.test(p); }
function monthLabel(ym, full = true) {
  if (!isMonthPeriod(ym)) return '';
  const [y, m] = ym.split('-');
  const arr = full ? MONTH_LABELS_RU : MONTH_SHORT_RU;
  return `${arr[Number(m) - 1]} ${y}`;
}
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function buildRecentMonths(count = 12) {
  const arr = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return arr;
}

/* ─── Formatters ────────────────────────────────────────────────────────── */
function fmt(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  // adaptive precision: keep more decimals for small values (rates in ₽)
  const maxDigits = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  const s = String(n);
  const d = s.includes('.') ? s.split('.')[1].length : 0;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: Math.min(d, maxDigits) }).format(n);
}

/* ─── Periods ───────────────────────────────────────────────────────────── */
const PERIODS = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'all', label: 'Всё время' },
];

/* ─── Currency (GRA ⇄ ₽) ────────────────────────────────────────────────── */
const GRA_TO_RUB = 0.01; // 1 GRA = 0.01 ₽
function convert(value, unit) {
  const n = Number(value || 0);
  return unit === 'rub' ? n * GRA_TO_RUB : n;
}
// Обратная конвертация: сумма из отображаемых единиц → GRA (для отправки на бэкенд)
function toGra(value, unit) {
  const n = Number(value || 0);
  return unit === 'rub' ? n / GRA_TO_RUB : n;
}
function unitLabel(unit) { return unit === 'rub' ? '₽' : 'GRA'; }

/* ─── Line Icons ────────────────────────────────────────────────────────── */
const IconCoin = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M9 9.5C9 8.67 10.34 8 12 8s3 .67 3 1.5S13.66 11 12 11s-3 .67-3 1.5S10.34 14 12 14s3 .67 3 1.5c0 .83-1.34 1.5-3 1.5s-3-.67-3-1.5"/>
  </svg>
);
const IconUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
  </svg>
);
const IconScan = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IconTrend = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
  </svg>
);

/* ─── Stat Card ─────────────────────────────────────────────────────────── */
function Stat({ icon, label, value, color, hint }) {
  return (
    <div className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-[14px] px-4 py-3 flex items-center gap-3 min-w-0">
      <div className={`w-8 h-8 rounded-lg ${color || 'bg-primary-50 text-primary-600'} flex items-center justify-center flex-shrink-0`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-extrabold text-gray-900 truncate">{value}</p>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider truncate">{label}</p>
        {hint && <p className="text-[10px] text-gray-500 mt-0.5 truncate">{hint}</p>}
      </div>
    </div>
  );
}

/* ─── Rates Bar ─────────────────────────────────────────────────────────── */
const RATE_LABELS = {
  inventory: 'Инвентаризация',
  packaging: 'Оприходование',
  production_transfer: 'Перенос',
  assembly: 'Сборка',
};

function RatesBar({ rates, unit }) {
  if (!rates) return null;
  const entries = Object.entries(RATE_LABELS).filter(([k]) => rates[k] != null);
  if (entries.length === 0) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap bg-white/50 backdrop-blur-xl border border-white/75 rounded-[14px] px-3 py-2 mb-4">
      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mr-1">Ставка за скан</span>
      {entries.map(([key, label]) => (
        <div key={key} className="inline-flex items-center gap-1.5 bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1">
          <span className="text-[11px] text-gray-500">{label}</span>
          <span className="text-[11px] font-bold text-amber-600">
            {fmt(convert(rates[key], unit))} {unitLabel(unit)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Month Picker ──────────────────────────────────────────────────────── */
function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState(buildRecentMonths(12));
  const ref = useRef(null);

  // Подгружаем реальные месяцы с данными — но не блокируем UI
  useEffect(() => {
    let cancelled = false;
    api.get('/earnings/months').then(({ data }) => {
      if (cancelled || !Array.isArray(data) || data.length === 0) return;
      const fromDb = data.map(r => r.ym);
      const merged = Array.from(new Set([...fromDb, ...buildRecentMonths(12)])).sort().reverse().slice(0, 24);
      setMonths(merged);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const active = isMonthPeriod(value);
  const label = active ? monthLabel(value) : 'Выбрать месяц';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[12px] text-sm font-medium transition-all border ${
          active
            ? 'text-violet-700 bg-violet-500/10 border-violet-500/25 shadow-sm backdrop-blur-xl'
            : 'text-gray-500 bg-white/50 border-transparent hover:bg-white/70 hover:text-gray-700'
        }`}
      >
        <Calendar size={14} />
        {label}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-56 max-h-80 overflow-y-auto bg-white border border-gray-100 rounded-[14px] shadow-xl p-1">
          {months.map(m => (
            <button
              key={m}
              onClick={() => { onChange(m); setOpen(false); }}
              className={`w-full text-left px-3 py-2 rounded-[10px] text-sm transition-colors ${
                value === m
                  ? 'bg-violet-50 text-violet-700 font-semibold'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {monthLabel(m)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
export default function EarningsPage() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();

  // По умолчанию — текущий месяц (всё в разделе привязано к месяцам)
  const period = sp.get('period') || currentMonth();
  const employeeId = sp.get('employee');
  const unit = sp.get('unit') === 'gra' ? 'gra' : 'rub';
  const tab = sp.get('tab') || 'summary'; // 'summary' | 'assembly'
  const marketplace = sp.get('mp') || ''; // '' | 'wb' | 'ozon'

  const [summary, setSummary] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState('');
  const [showFired, setShowFired] = useState(false); // показывать уволенных в списках

  /* ─── Fetch summary ─────────────────────────────────────────────────── */
  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/earnings/summary', { params: { period } });
      setSummary(data);
    } catch (e) {
      toast.error('Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [period, toast]);

  /* ─── Fetch employee detail ─────────────────────────────────────────── */
  const fetchDetail = useCallback(async (eid) => {
    setDetailLoading(true);
    try {
      const { data } = await api.get(`/earnings/employees/${eid}`, { params: { period } });
      setDetail(data);
    } catch (e) {
      toast.error('Ошибка загрузки сотрудника');
    } finally {
      setDetailLoading(false);
    }
  }, [period, toast]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => {
    if (employeeId) fetchDetail(employeeId);
    else setDetail(null);
  }, [employeeId, fetchDetail]);

  /* ─── URL helpers ───────────────────────────────────────────────────── */
  const update = (patch) => {
    const n = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => {
      if (v == null || v === '') n.delete(k); else n.set(k, v);
    });
    setSp(n, { replace: true });
  };
  const setPeriod = (p) => update({ period: p });
  const setUnit = (u) => update({ unit: u === 'gra' ? 'gra' : null });
  const setTab = (t) => update({ tab: t === 'summary' ? null : t, employee: null });
  const setMarketplace = (m) => update({ mp: m || null });
  const selectEmployee = (eid) => update({ employee: eid });
  const clearEmployee = () => update({ employee: null });

  /* ─── Excel export ──────────────────────────────────────────────────── */
  const downloadExcel = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await api.get('/earnings/export.xlsx', {
        params: { months: 6, unit },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const a = document.createElement('a');
      a.href = url;
      a.download = `Заработок_сотрудников_${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Не удалось сформировать Excel');
    } finally {
      setExporting(false);
    }
  }, [exporting, unit, toast]);

  const ov = summary?.overview;
  const leaders = summary?.leaders || [];
  // Уволенных прячем по умолчанию (переключатель «Показать уволенных»)
  const firedCount = leaders.filter(e => e.active === false).length;
  const visibleLeaders = showFired ? leaders : leaders.filter(e => e.active !== false);
  const rates = summary?.settings?.rates;

  /* ═══ RENDER ═══ */
  return (
    <div className="p-6 max-w-7xl mx-auto">

      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Заработок</h1>
          {/* Tabs */}
          <div className="flex items-center bg-white/50 backdrop-blur-xl border border-gray-200 rounded-[12px] p-0.5 ml-2">
            {[
              { k: 'summary', label: 'Сводка' },
              { k: 'assembly', label: 'Сборки' },
            ].map(t => (
              <button
                key={t.k}
                onClick={() => setTab(t.k)}
                className={`px-3 py-1 rounded-[9px] text-xs font-semibold transition-all ${
                  tab === t.k ? 'bg-primary-600/15 text-primary-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >{t.label}</button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3.5 py-1.5 rounded-[12px] text-sm font-medium transition-all border ${
                period === p.value
                  ? 'glass-btn text-primary-700 bg-primary-600/10 border-primary-600/25 shadow-sm backdrop-blur-xl'
                  : 'text-gray-500 bg-white/50 border-transparent hover:bg-white/70 hover:text-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}

          {/* Конкретный месяц */}
          <MonthPicker value={period} onChange={setPeriod} />

          {/* GRA ⇄ ₽ */}
          <div className="ml-2 flex items-center bg-white/50 backdrop-blur-xl border border-gray-200 rounded-[12px] p-0.5">
            <button
              onClick={() => setUnit('gra')}
              className={`px-2.5 py-1 rounded-[9px] text-xs font-semibold transition-all ${
                unit === 'gra' ? 'bg-amber-500/15 text-amber-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >GRA</button>
            <button
              onClick={() => setUnit('rub')}
              className={`px-2.5 py-1 rounded-[9px] text-xs font-semibold transition-all ${
                unit === 'rub' ? 'bg-green-500/15 text-green-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >₽</button>
          </div>

          <button
            onClick={downloadExcel}
            disabled={exporting}
            title="Скачать Excel: сотрудники × месяцы"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] text-sm font-semibold transition-all border border-green-600/20 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-60 disabled:cursor-wait"
          >
            <Download size={14} />
            {exporting ? 'Готовлю…' : 'Excel'}
          </button>

          <button onClick={() => { fetchSummary(); if (employeeId) fetchDetail(employeeId); }} className="p-2 rounded-xl text-gray-400 hover:text-primary-600 hover:bg-white/70 transition-all">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {tab === 'assembly' ? (
        <AssembliesView period={period} unit={unit} marketplace={marketplace} setMarketplace={setMarketplace} />
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : ov ? (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <Stat icon={<IconCoin />} label={`Общий баланс ${unitLabel(unit)}`} value={fmt(convert(ov.total_current_balance, unit))} color="bg-amber-50 text-amber-600" />
            <Stat icon={<IconUsers />} label="Сотрудников" value={ov.employees_with_activity || 0} color="bg-primary-50 text-primary-600" />
            <Stat icon={<IconScan />} label="Сканов" value={fmt(ov.rewarded_scans)} color="bg-blue-50 text-blue-600" />
            <Stat icon={<IconTrend />} label={`Начислено ${unitLabel(unit)}`} value={fmt(convert(ov.total_awarded, unit))} color="bg-green-50 text-green-600" />
          </div>

          {/* Rates bar */}
          <RatesBar rates={rates} unit={unit} />

          {/* Two-pane: employee list + detail/leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

            {/* Left: employee list */}
            <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden flex flex-col max-h-[calc(100vh-280px)]">
              <div className="p-3 border-b border-gray-100 flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Поиск сотрудника..."
                    className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-100 rounded-[10px] text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-primary-300 focus:bg-white"
                  />
                </div>
                {employeeId && (
                  <button
                    onClick={clearEmployee}
                    className="text-[11px] font-semibold text-gray-400 hover:text-primary-600 px-2 py-1 rounded-md hover:bg-gray-50"
                    title="Показать сводку"
                  >
                    Сброс
                  </button>
                )}
              </div>
              {firedCount > 0 && (
                <button
                  onClick={() => setShowFired(v => !v)}
                  className="px-4 py-2 border-b border-gray-100 flex items-center justify-between text-[11px] font-semibold text-gray-400 hover:text-rose-500 hover:bg-rose-50/40 transition-colors"
                >
                  <span>{showFired ? 'Скрыть уволенных' : `Показать уволенных (${firedCount})`}</span>
                  {showFired ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              )}
              <div className="overflow-y-auto flex-1">
                {visibleLeaders
                  .filter(emp => emp.full_name.toLowerCase().includes(search.toLowerCase()))
                  .map(emp => {
                    const isFired = emp.active === false;
                    return (
                    <button
                      key={emp.employee_id}
                      onClick={() => selectEmployee(emp.employee_id)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-colors ${
                        String(employeeId) === String(emp.employee_id)
                          ? 'bg-primary-50 border-l-2 border-l-primary-500'
                          : `hover:bg-gray-50 border-l-2 border-l-transparent ${isFired ? 'bg-rose-50/30' : ''}`
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                        {emp.full_name}
                        {isFired && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 flex-shrink-0">уволен</span>}
                      </p>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[11px] text-gray-400">{fmt(emp.rewarded_scans)} сканов</span>
                        <span className={`text-xs font-bold ${isFired ? 'text-rose-400' : 'text-green-600'}`}>{fmt(convert(emp.current_balance, unit))} {unitLabel(unit)}</span>
                      </div>
                    </button>
                    );
                  })}
                {visibleLeaders.length === 0 && (
                  <p className="text-center text-sm text-gray-400 py-8">Нет данных</p>
                )}
              </div>
            </div>

            {/* Right: detail or leaderboard */}
            <div>
              {employeeId ? (
                detailLoading ? (
                  <div className="flex justify-center py-20"><Spinner /></div>
                ) : detail ? (
                  <EmployeeDetail detail={detail} unit={unit} onSelectMonth={setPeriod} currentPeriod={period} />
                ) : null
              ) : (
                <>
                  <PayrollSummary payroll={summary?.payroll || []} unit={unit} period={period} onRefresh={fetchSummary} />
                  <Leaderboard
                    leaders={visibleLeaders}
                    adjustments={summary?.recent_adjustments || []}
                    unit={unit}
                    onSelect={selectEmployee}
                  />
                </>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYOUT-ALL MODAL
   ═══════════════════════════════════════════════════════════════════════════ */
function PayoutAllModal({ open, onClose, totalGra, count, unit, onSuccess }) {
  const toast = useToast();
  const [notes, setNotes] = useState(() => {
    const now = new Date();
    const months = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
    return `Выплачено за ${months[now.getMonth()]} ${now.getFullYear()}`;
  });
  const [loading, setLoading] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!notes.trim()) { toast.error('Укажите причину'); return; }
    if (!window.confirm(`Обнулить балансы ${count} сотрудникам? Сумма: ${fmt(convert(totalGra, unit))} ${unitLabel(unit)}. Действие записывается в аудит.`)) return;
    setLoading(true);
    try {
      const { data } = await api.post('/earnings/payout-all', { notes: notes.trim() });
      toast.success(`Выплачено ${data.count} сотрудникам на ${fmt(convert(data.total_paid, unit))} ${unitLabel(unit)}`);
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка выплаты');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[20px] w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Выплатить всем</h3>
            <p className="text-xs text-gray-500 mt-0.5">Обнуляет балансы всех с balance &gt; 0. Записывает manual_adjustment в аудит.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-[12px] px-4 py-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Будет выплачено</span>
            <span className="text-base font-extrabold text-amber-700">{fmt(convert(totalGra, unit))} {unitLabel(unit)}</span>
          </div>
          <p className="text-[11px] text-amber-600 mt-1">{count} сотрудников с положительным балансом</p>
        </div>

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Причина (попадёт в аудит)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Например: Выплачено за апрель 2026"
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-primary-400 focus:bg-white mb-4"
        />

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 rounded-[10px] text-sm font-semibold text-gray-500 hover:bg-gray-50">Отмена</button>
          <button
            onClick={submit}
            disabled={loading || !notes.trim() || totalGra <= 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Wallet size={14} />
            {loading ? 'Выплачиваю…' : 'Выплатить всем'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAYROLL SUMMARY
   ═══════════════════════════════════════════════════════════════════════════ */
/* ─── Списание / точечная выплата суммы конкретному человеку ─────────────── */
function WriteOffModal({ open, employee, unit, onClose, onSuccess }) {
  const toast = useToast();
  const balanceInUnit = convert(employee?.gra_balance, unit);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      // По умолчанию предлагаем списать весь текущий баланс
      setAmount(balanceInUnit > 0 ? String(Math.round(balanceInUnit * 100) / 100) : '');
      setNotes('');
    }
  }, [open, employee?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !employee) return null;

  const amountNum = Number(String(amount).replace(',', '.')) || 0;
  const newBalanceUnit = balanceInUnit - amountNum;

  const submit = async () => {
    if (amountNum <= 0) { toast.error('Укажите сумму больше нуля'); return; }
    if (!notes.trim()) { toast.error('Укажите причину'); return; }
    setLoading(true);
    try {
      const { data } = await api.post(`/earnings/employees/${employee.id}/adjust`, {
        amount: toGra(amountNum, unit),
        mode: 'deduct',
        notes: notes.trim(),
      });
      toast.success(`Списано ${fmt(amountNum)} ${unitLabel(unit)} · ${data.employee.full_name}`);
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Ошибка списания');
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-[20px] w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Списать сумму</h3>
            <p className="text-xs text-gray-500 mt-0.5">{employee.full_name}{employee.position ? ` · ${employee.position}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-gray-50 border border-gray-200 rounded-[12px] px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Текущий баланс</p>
            <p className="text-base font-extrabold text-gray-900">{fmt(balanceInUnit)} {unitLabel(unit)}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-[12px] px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Останется</p>
            <p className={`text-base font-extrabold ${newBalanceUnit < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{fmt(newBalanceUnit)} {unitLabel(unit)}</p>
          </div>
        </div>

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Сумма к списанию ({unitLabel(unit)})</label>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0"
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-primary-400 focus:bg-white mb-3"
        />

        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Причина (попадёт в аудит)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Например: выплачено наличными"
          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-[10px] text-sm focus:outline-none focus:border-primary-400 focus:bg-white mb-4"
        />

        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={loading} className="px-4 py-2 rounded-[10px] text-sm font-semibold text-gray-500 hover:bg-gray-50">Отмена</button>
          <button
            onClick={submit}
            disabled={loading || amountNum <= 0 || !notes.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-sm font-bold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MinusCircle size={14} />
            {loading ? 'Списываю…' : 'Списать'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayrollSummary({ payroll, unit, period, onRefresh }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [writeOff, setWriteOff] = useState(null); // employee object or null
  const [showFired, setShowFired] = useState(false);
  if (!payroll.length) return null;

  const active = payroll.filter(e => e.active);
  // Уволенных показываем отдельным свёрнутым блоком — только тех, у кого остался баланс
  const fired = payroll.filter(e => !e.active && Number(e.gra_balance || 0) !== 0);

  const sumBalance = (arr) => arr.reduce((s, e) => s + Number(e.gra_balance || 0), 0);
  const sumEarned  = (arr) => arr.reduce((s, e) => s + Number(e.earned_period || 0), 0);

  // Итог к выплате — ТОЛЬКО работающие сотрудники (уволенные не учитываются)
  const payableActive = sumBalance(active);
  const earnedActive  = sumEarned(active);
  const monthLbl = isMonthPeriod(period) ? monthLabel(period) : null;

  const Row = ({ e, color }) => (
    <div className="group flex items-center justify-between py-1.5">
      <div className="min-w-0 flex-1">
        <span className="text-sm text-gray-700 truncate block">{e.full_name}</span>
        {e.position && <span className="text-[10px] text-gray-400">{e.position}</span>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-2">
        <div className="text-right">
          <span className={`text-xs font-bold ${color} block`}>{fmt(convert(e.gra_balance, unit))} {unitLabel(unit)}</span>
          <span className="text-[10px] text-gray-400">начислено: {fmt(convert(e.earned_period, unit))}</span>
        </div>
        <button
          onClick={() => setWriteOff(e)}
          title="Списать сумму / выплатить лично"
          className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
        >
          <MinusCircle size={13} /> Списать
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden mb-4">
      <PayoutAllModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        totalGra={payableActive}
        count={active.filter(e => Number(e.gra_balance || 0) > 0).length}
        unit={unit}
        onSuccess={onRefresh}
      />
      <WriteOffModal
        open={!!writeOff}
        employee={writeOff}
        unit={unit}
        onClose={() => setWriteOff(null)}
        onSuccess={onRefresh}
      />
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Расчёт выплат{monthLbl ? ` · ${monthLbl}` : ''}</h3>
          <p className="text-[10px] text-gray-400">К выплате — баланс работающих сотрудников</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-gray-900">{fmt(convert(payableActive, unit))} {unitLabel(unit)}</span>
          <button
            onClick={() => setModalOpen(true)}
            disabled={payableActive <= 0}
            title="Обнулить балансы работающим — записать как выплачено"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <Wallet size={13} /> Выплатить всем
          </button>
        </div>
      </div>

      {/* Работающие сотрудники */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Работающие ({active.length})</span>
          <span className="text-sm font-bold text-green-600">{fmt(convert(payableActive, unit))} {unitLabel(unit)}</span>
        </div>
        {monthLbl && (
          <p className="text-[10px] text-gray-400 mb-2">Начислено за {monthLbl}: {fmt(convert(earnedActive, unit))} {unitLabel(unit)}</p>
        )}
        <div className="divide-y divide-gray-50">
          {active.map(e => <Row key={e.id} e={e} color="text-green-600" />)}
          {active.length === 0 && <p className="text-sm text-gray-400 py-2">Нет работающих сотрудников с начислениями</p>}
        </div>
      </div>

      {/* Уволенные — скрыты, в итог не входят */}
      {fired.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 bg-rose-50/20">
          <button
            onClick={() => setShowFired(v => !v)}
            className="w-full flex items-center justify-between"
          >
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 uppercase tracking-wider">
              {showFired ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Уволенные · скрыты ({fired.length})
            </span>
            <span className="text-xs font-semibold text-rose-400">остаток {fmt(convert(sumBalance(fired), unit))} {unitLabel(unit)}</span>
          </button>
          {showFired && (
            <>
              <p className="text-[10px] text-gray-400 mt-1 mb-2">Не учитываются в сумме к выплате. Можно списать остаток вручную.</p>
              <div className="divide-y divide-gray-50">
                {fired.map(e => <Row key={e.id} e={e} color="text-rose-500" />)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEADERBOARD (default right-pane)
   ═══════════════════════════════════════════════════════════════════════════ */
function Leaderboard({ leaders, adjustments, unit, onSelect }) {
  return (
    <>
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <h3 className="text-sm font-semibold text-gray-700">Лидеры</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-10">#</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Сотрудник</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Сканы</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Склад</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-purple-500 uppercase tracking-wide" title="external_order_pick — сборка товара">Товар</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-fuchsia-500 uppercase tracking-wide" title="external_order_collect — сборка заказов">Заказы</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Текущий баланс</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {leaders.map((emp, i) => (
              <tr
                key={emp.employee_id}
                onClick={() => onSelect(emp.employee_id)}
                className={`group border-b border-gray-50 cursor-pointer transition-colors hover:bg-primary-50/30 ${
                  i < 3 ? 'bg-amber-50/20' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                    i === 0 ? 'bg-amber-100 text-amber-700' :
                    i === 1 ? 'bg-gray-200 text-gray-600' :
                    i === 2 ? 'bg-orange-100 text-orange-700' :
                    'text-gray-400'
                  }`}>{i + 1}</span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{emp.full_name}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-600">{fmt(emp.rewarded_scans)}</td>
                <td className="px-4 py-3 text-right text-primary-600 font-semibold">{fmt(convert(emp.total_awarded, unit))}</td>
                <td className="px-4 py-3 text-right text-purple-600 font-semibold" title={`${fmt(emp.sborka_pick_units)} позиций`}>{fmt(convert(emp.sborka_pick_amount, unit))}</td>
                <td className="px-4 py-3 text-right text-fuchsia-600 font-semibold" title={`${fmt(emp.sborka_collect_units)} позиций`}>{fmt(convert(emp.sborka_collect_amount, unit))}</td>
                <td className="px-4 py-3 text-right font-bold text-green-600">{fmt(convert(emp.current_balance, unit))}</td>
                <td className="pr-3 text-gray-300 group-hover:text-primary-500 transition-colors">
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjustments.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Корректировки</h3>
          <div className="space-y-2">
            {adjustments.slice(0, 5).map(adj => (
              <div key={adj.id} className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{adj.employee_name}</p>
                  <p className="text-xs text-gray-400 truncate">{adj.notes || '—'}</p>
                </div>
                <span className={`text-sm font-bold flex-shrink-0 ${Number(adj.amount_delta) >= 0 ? 'text-green-600' : 'text-rose-600'}`}>
                  {Number(adj.amount_delta) >= 0 ? '+' : ''}{fmt(convert(adj.amount_delta, unit))} {unitLabel(unit)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPLOYEE DETAIL VIEW
   ═══════════════════════════════════════════════════════════════════════════ */
const TASK_TYPE_LABELS = {
  inventory: 'Инвентаризация',
  packaging: 'Оприходование',
  production_transfer: 'Перенос с производства',
  bundle_assembly: 'Сборка комплекта',
  returns: 'Возвраты',
};

function taskLocation(t) {
  if (t.shelf_code || t.shelf_name) return `${t.rack_name ? t.rack_name + ' · ' : ''}${t.shelf_code || t.shelf_name}`;
  if (t.pallet_name) return `${t.pallet_row_name ? t.pallet_row_name + ' · ' : ''}${t.pallet_name}`;
  return '—';
}

function EmployeeDetail({ detail, unit = 'gra', onSelectMonth, currentPeriod }) {
  const emp = detail.employee;
  const tasks = detail.tasks || [];
  const adjustments = detail.adjustments || [];
  const sborka = detail.sborka_picks || [];
  const liveEvents = detail.sborka_live_events || [];
  const [expandedDay, setExpandedDay] = useState(null);
  const [monthly, setMonthly] = useState(null);

  // Помесячная разбивка за 6 месяцев
  useEffect(() => {
    if (!emp?.employee_id) { setMonthly(null); return; }
    let cancelled = false;
    api.get('/earnings/monthly', { params: { employee_id: emp.employee_id, months: 6 } })
      .then(({ data }) => { if (!cancelled) setMonthly(data?.rows || []); })
      .catch(() => { if (!cancelled) setMonthly([]); });
    return () => { cancelled = true; };
  }, [emp?.employee_id]);

  const monthsBack = 6;
  const recentMonths = useMemo(() => buildRecentMonths(monthsBack).reverse(), []);
  const byMonth = useMemo(() => {
    const map = Object.fromEntries(recentMonths.map(m => [m, 0]));
    (monthly || []).forEach(r => { if (map[r.ym] != null) map[r.ym] = Number(r.total_amount || 0); });
    return map;
  }, [monthly, recentMonths]);
  const maxByMonth = useMemo(() => Math.max(0, ...Object.values(byMonth)), [byMonth]);

  const dailyData = useMemo(() => {
    const byDate = {};
    const ensure = (date) => {
      if (!byDate[date]) byDate[date] = {
        date, scans: 0, tasks: 0, warehouse: 0, sborka: 0,
        pickAmount: 0, collectAmount: 0, pickUnits: 0, collectUnits: 0,
        pickCount: 0, orderCount: 0,
        taskItems: [], sborkaItems: [], liveOrders: [], livePicks: [],
      };
      return byDate[date];
    };

    tasks.forEach(t => {
      const date = t.last_earned_at ? new Date(t.last_earned_at).toLocaleDateString('ru-RU') : 'Без даты';
      const d = ensure(date);
      d.scans += Number(t.rewarded_scans || 0);
      d.tasks += 1;
      d.warehouse += Number(t.amount_earned || 0);
      d.taskItems.push(t);
    });

    sborka.forEach(s => {
      const date = s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : 'Без даты';
      const d = ensure(date);
      const delta = Number(s.amount_delta || 0);
      const units = Number(s.reward_units || 0);
      d.sborka += delta;
      d.sborkaItems.push(s);
      if (s.event_type === 'external_order_pick') {
        d.pickAmount += delta;
        d.pickUnits += units;
      } else if (s.event_type === 'external_order_collect') {
        d.collectAmount += delta;
        d.collectUnits += units;
        d.orderCount += 1;
      }
    });

    // Live sborka events — for expanded order list (order_id, product_name, time)
    liveEvents.forEach(e => {
      const date = e.created_at ? new Date(e.created_at).toLocaleDateString('ru-RU') : 'Без даты';
      const d = ensure(date);
      if (e.event_type === 'pick') {
        d.pickCount += 1;
        d.livePicks.push(e);
      } else if (e.event_type === 'order_complete') {
        d.liveOrders.push(e);
      }
    });

    return Object.values(byDate).sort((a, b) => {
      const da = a.date.split('.').reverse().join('-');
      const db = b.date.split('.').reverse().join('-');
      return db.localeCompare(da);
    });
  }, [tasks, sborka, liveEvents]);

  const totalSborka = Number(emp?.sborka_amount || 0);
  const pickAmount = Number(emp?.sborka_pick_amount || 0);
  const collectAmount = Number(emp?.sborka_collect_amount || 0);
  const pickUnits = Number(emp?.sborka_pick_units || 0);
  const collectUnits = Number(emp?.sborka_collect_units || 0);
  const wbAmount = Number(emp?.sborka_wb_amount || 0);
  const ozonAmount = Number(emp?.sborka_ozon_amount || 0);
  const totalOrders = sborka.filter(s => s.event_type === 'external_order_collect').length;

  return (
    <>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-gray-900">{emp?.full_name}</h2>
        <p className="text-xs text-gray-400">
          {isMonthPeriod(currentPeriod)
            ? `Статистика за ${monthLabel(currentPeriod)}`
            : 'Статистика за выбранный период'}
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Stat icon={<IconCoin />} label={`Текущий баланс ${unitLabel(unit)}`} value={fmt(convert(emp?.current_balance, unit))} color="bg-green-50 text-green-600" />
        <Stat icon={<IconScan />} label="Сканов склада" value={fmt(emp?.rewarded_scans)} color="bg-blue-50 text-blue-600" />
        <Stat icon={<IconTrend />} label={`Склад ${unitLabel(unit)}`} value={fmt(convert(emp?.total_awarded, unit))} color="bg-primary-50 text-primary-600" />
        <Stat icon={<IconCoin />} label={`Сборка всего ${unitLabel(unit)}`} value={fmt(convert(totalSborka, unit))} color="bg-indigo-50 text-indigo-600" />
      </div>

      {(totalSborka > 0 || pickAmount > 0 || collectAmount > 0) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat icon={<IconCoin />} label={`Товар (picker) ${unitLabel(unit)}`} value={fmt(convert(pickAmount, unit))} hint={`${fmt(pickUnits)} позиций`} color="bg-purple-50 text-purple-600" />
          <Stat icon={<IconScan />} label={`Заказы (packer) ${unitLabel(unit)}`} value={fmt(convert(collectAmount, unit))} hint={`${fmt(collectUnits)} позиций · ${fmt(totalOrders)} заказов`} color="bg-fuchsia-50 text-fuchsia-600" />
          <Stat icon={<IconCoin />} label={`WB ${unitLabel(unit)}`} value={fmt(convert(wbAmount, unit))} color="bg-violet-50 text-violet-600" />
          <Stat icon={<IconCoin />} label={`Ozon ${unitLabel(unit)}`} value={fmt(convert(ozonAmount, unit))} color="bg-sky-50 text-sky-600" />
        </div>
      )}

      {/* ─── Помесячный график (за 6 месяцев) ─────────────── */}
      <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">По месяцам · 6 мес</h3>
          {isMonthPeriod(currentPeriod) && (
            <button
              onClick={() => onSelectMonth && onSelectMonth('all')}
              className="text-[11px] font-semibold text-gray-400 hover:text-primary-600"
            >
              Сбросить месяц
            </button>
          )}
        </div>
        <div className="p-4 flex items-end gap-2 h-40">
          {recentMonths.map(m => {
            const val = byMonth[m] || 0;
            const ratio = maxByMonth > 0 ? val / maxByMonth : 0;
            const isActive = currentPeriod === m;
            return (
              <button
                key={m}
                onClick={() => onSelectMonth && onSelectMonth(m)}
                className="flex-1 flex flex-col items-center justify-end h-full group"
                title={`${monthLabel(m)} — ${fmt(convert(val, unit))} ${unitLabel(unit)}`}
              >
                <span className={`text-[10px] mb-1 ${isActive ? 'text-violet-700 font-bold' : 'text-gray-400 group-hover:text-gray-600'}`}>
                  {val > 0 ? fmt(convert(val, unit)) : ''}
                </span>
                <div
                  className={`w-full rounded-t-md transition-all ${
                    isActive
                      ? 'bg-violet-500'
                      : val > 0
                        ? 'bg-primary-400 group-hover:bg-primary-500'
                        : 'bg-gray-100'
                  }`}
                  style={{ height: `${Math.max(3, ratio * 100)}%`, minHeight: '4px' }}
                />
                <span className={`text-[10px] mt-1 ${isActive ? 'text-violet-700 font-semibold' : 'text-gray-400'}`}>
                  {monthLabel(m, false)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[10px] text-gray-400">
          Нажмите на столбец, чтобы посмотреть детали выбранного месяца
        </p>
      </div>

      {dailyData.length > 0 && (
        <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50">
            <h3 className="text-sm font-semibold text-gray-700">По дням</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="w-8"></th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Дата</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Сканы</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Задачи</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Заказов</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Склад</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-purple-500 uppercase tracking-wide" title="external_order_pick">Товар</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-fuchsia-500 uppercase tracking-wide" title="external_order_collect">Заказы</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Итого</th>
              </tr>
            </thead>
            <tbody>
              {dailyData.map(day => {
                const isOpen = expandedDay === day.date;
                return (
                  <Fragment key={day.date}>
                    <tr
                      onClick={() => setExpandedDay(isOpen ? null : day.date)}
                      className={`border-b border-gray-50 cursor-pointer transition-colors ${isOpen ? 'bg-primary-50/30' : 'hover:bg-gray-50/50'}`}
                    >
                      <td className="pl-3 text-gray-400">
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{day.date}</td>
                      <td className="px-3 py-3 text-right font-mono text-gray-600">{fmt(day.scans)}</td>
                      <td className="px-3 py-3 text-right text-gray-600">{day.tasks}</td>
                      <td className="px-3 py-3 text-right text-fuchsia-600 font-semibold">{day.orderCount || 0}</td>
                      <td className="px-3 py-3 text-right text-primary-600 font-semibold">{fmt(convert(day.warehouse, unit))}</td>
                      <td className="px-3 py-3 text-right text-purple-600 font-semibold" title={`${fmt(day.pickUnits)} позиций`}>{fmt(convert(day.pickAmount, unit))}</td>
                      <td className="px-3 py-3 text-right text-fuchsia-600 font-semibold" title={`${fmt(day.collectUnits)} позиций`}>{fmt(convert(day.collectAmount, unit))}</td>
                      <td className="px-3 py-3 text-right font-bold text-gray-900">{fmt(convert(day.warehouse + day.sborka, unit))}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/40 border-b border-gray-100">
                        <td></td>
                        <td colSpan={7} className="px-4 py-3">
                          {day.taskItems.length === 0 && day.sborkaItems.length === 0 && day.liveOrders.length === 0 && (
                            <p className="text-xs text-gray-400">Нет детализации</p>
                          )}
                          {day.taskItems.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Задачи склада</p>
                              <div className="space-y-1">
                                {day.taskItems.map((t, i) => (
                                  <div key={(t.task_id || 'x') + '-' + i} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                                      <p className="text-[11px] text-gray-400 truncate">
                                        {TASK_TYPE_LABELS[t.task_type] || t.task_type} · {taskLocation(t)}
                                      </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-sm font-bold text-primary-600">{fmt(convert(t.amount_earned, unit))} {unitLabel(unit)}</p>
                                      <p className="text-[11px] text-gray-400">{fmt(t.rewarded_scans)} сканов</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {day.sborkaItems.length > 0 && (
                            <div className="mb-2">
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Начисления за сборку</p>
                              <div className="space-y-1">
                                {day.sborkaItems.map(s => (
                                  <div key={s.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-900 truncate">
                                        {s.source_product_name || s.source_entity_name || 'Сборка'}
                                      </p>
                                      <p className="text-[11px] text-gray-400 truncate">
                                        {[s.source_marketplace, s.source_store_name, s.source_article].filter(Boolean).join(' · ') || '—'}
                                      </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-sm font-bold text-purple-600">+{fmt(convert(s.amount_delta, unit))} {unitLabel(unit)}</p>
                                      <p className="text-[11px] text-gray-400">{new Date(s.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {day.liveOrders.length > 0 && (
                            <div>
                              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                                Заказы собраны ({day.liveOrders.length})
                              </p>
                              <div className="space-y-1 max-h-[260px] overflow-y-auto">
                                {day.liveOrders.map(o => (
                                  <div key={o.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-900 truncate">{o.order_id || '—'}</p>
                                      <p className="text-[11px] text-gray-400 truncate">
                                        {(o.marketplace || '—').toUpperCase()}{o.product_name ? ' · ' + o.product_name : ''}
                                      </p>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-green-50 text-green-600">готов</span>
                                      <p className="text-[11px] text-gray-400 mt-0.5">{new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adjustments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Корректировки</h3>
          <div className="space-y-2">
            {adjustments.map(adj => (
              <div key={adj.id} className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">{new Date(adj.created_at).toLocaleString('ru-RU')} · {adj.changed_by_username}</p>
                  <p className="text-sm text-gray-600 truncate">{adj.notes || '—'}</p>
                </div>
                <span className={`text-sm font-bold flex-shrink-0 ${Number(adj.amount_delta) >= 0 ? 'text-green-600' : 'text-rose-600'}`}>
                  {Number(adj.amount_delta) >= 0 ? '+' : ''}{fmt(convert(adj.amount_delta, unit))} {unitLabel(unit)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {dailyData.length === 0 && adjustments.length === 0 && (
        <div className="bg-white rounded-[18px] border border-gray-100 py-16 text-center text-gray-400">
          <p className="text-lg font-semibold mb-1">Нет данных</p>
          <p className="text-sm">За выбранный период нет начислений</p>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSEMBLIES VIEW (Phase 2 — части сборок маркетплейсов)
   ═══════════════════════════════════════════════════════════════════════════ */
const MARKETPLACE_META = {
  wb:   { label: 'WB',   bg: 'bg-violet-50',  text: 'text-violet-700',  ring: 'ring-violet-200' },
  ozon: { label: 'Ozon', bg: 'bg-sky-50',     text: 'text-sky-700',     ring: 'ring-sky-200' },
};
const MODE_META = {
  pick_pack: { label: 'Один сотрудник', bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  split:     { label: 'Split (2 роли)', bg: 'bg-amber-50',   text: 'text-amber-700' },
  unknown:   { label: '—',              bg: 'bg-gray-50',    text: 'text-gray-400' },
};
const STATUS_META = {
  picking:      { label: 'Идёт сборка товара', bg: 'bg-purple-50',  text: 'text-purple-700' },
  packing:      { label: 'Идёт упаковка',      bg: 'bg-fuchsia-50', text: 'text-fuchsia-700' },
  packing_only: { label: 'Только упаковка',    bg: 'bg-rose-50',    text: 'text-rose-700' },
  done:         { label: 'Готово',             bg: 'bg-green-50',   text: 'text-green-700' },
  empty:        { label: '—',                  bg: 'bg-gray-50',    text: 'text-gray-400' },
};

function AssembliesView({ period, unit, marketplace, setMarketplace }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const params = { period };
      if (marketplace) params.marketplace = marketplace;
      const { data } = await api.get('/earnings/assemblies', { params });
      setRows(data);
    } catch (e) {
      setErr(e.response?.data?.error || 'Ошибка загрузки');
      toast.error('Ошибка загрузки сборок');
    } finally { setLoading(false); }
  }, [period, marketplace, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Агрегированные stat-карточки
  const totals = useMemo(() => {
    const t = { parts: rows.length, pickSum: 0, collectSum: 0, ordersSum: 0, splitCount: 0, pickPackCount: 0, redistributed: 0 };
    rows.forEach(r => {
      t.pickSum    += Number(r.pick_amount || 0);
      t.collectSum += Number(r.collect_amount || 0);
      t.ordersSum  += Number(r.orders_count || 0);
      if (r.mode === 'split') t.splitCount++;
      else if (r.mode === 'pick_pack') t.pickPackCount++;
      if (r.redistributed) t.redistributed++;
    });
    return t;
  }, [rows]);

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <Stat icon={<IconCoin />} label="Частей" value={totals.parts} color="bg-primary-50 text-primary-600" />
        <Stat icon={<IconCoin />} label={`Товар (pick) ${unitLabel(unit)}`} value={fmt(convert(totals.pickSum, unit))} color="bg-purple-50 text-purple-600" />
        <Stat icon={<IconCoin />} label={`Заказы (collect) ${unitLabel(unit)}`} value={fmt(convert(totals.collectSum, unit))} color="bg-fuchsia-50 text-fuchsia-600" />
        <Stat icon={<IconUsers />} label="Split / One" value={`${totals.splitCount} / ${totals.pickPackCount}`} color="bg-amber-50 text-amber-600" />
        <Stat icon={<IconUsers />} label="Redistribute" value={totals.redistributed} color="bg-rose-50 text-rose-600" hint={totals.redistributed > 0 ? 'Смена ответственного' : undefined} />
      </div>

      {/* Marketplace filter */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-400 font-semibold uppercase">Маркетплейс:</span>
        {[{ k: '', label: 'Все' }, { k: 'wb', label: 'WB' }, { k: 'ozon', label: 'Ozon' }].map(m => (
          <button key={m.k || 'all'} onClick={() => setMarketplace(m.k)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
              (marketplace || '') === m.k ? 'bg-primary-50 text-primary-700 border-primary-200' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>{m.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : err ? (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center text-rose-700">
          <p className="text-sm font-semibold mb-1">Ошибка загрузки</p>
          <p className="text-xs">{err}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center text-gray-400 py-16">
          <p className="text-lg font-semibold mb-1">Нет частей сборок</p>
          <p className="text-sm">За выбранный период или фильтр нет активности</p>
        </div>
      ) : (
        <div className="bg-white rounded-[18px] border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Маркет</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Магазин · часть</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Режим</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-purple-500 uppercase tracking-wide">Сборщик товара</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-fuchsia-500 uppercase tracking-wide">Упаковщик</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Прогресс</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Заказов</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Итого {unitLabel(unit)}</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const mp = MARKETPLACE_META[r.marketplace] || { label: r.marketplace || '—', bg: 'bg-gray-50', text: 'text-gray-500' };
                const mode = MODE_META[r.mode] || MODE_META.unknown;
                const status = STATUS_META[r.status] || STATUS_META.empty;
                const total = Number(r.pick_amount || 0) + Number(r.collect_amount || 0);
                return (
                  <tr key={`${r.marketplace}-${r.task_id}-${r.entity_id}-${i}`} className="border-b border-gray-50 hover:bg-primary-50/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold ${mp.bg} ${mp.text}`}>{mp.label}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-gray-900 text-sm truncate max-w-[240px]" title={r.entity_name}>{r.entity_name}</p>
                      <p className="text-[11px] text-gray-400 truncate">{r.store_name || `store #${r.store_id || '—'}`} · task {r.task_id}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${mode.bg} ${mode.text}`}>{mode.label}</span>
                      {r.redistributed && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200" title="Была смена ответственного без повторного начисления">re-dist</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 truncate max-w-[160px]">
                      {r.picker_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 truncate max-w-[160px]">
                      {r.packer_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-600">
                      <span className="text-purple-600 font-semibold">{r.pick_units || 0}</span>
                      <span className="text-gray-300 mx-1">→</span>
                      <span className="text-fuchsia-600 font-semibold">{r.collect_units || 0}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700 font-semibold">{r.orders_count || 0}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-gray-900">{fmt(convert(total, unit))}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${status.bg} ${status.text}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="text-[11px] text-gray-400 text-center mt-3">
          Режим определяется по наличию разных сотрудников-picker/packer · прогресс = собрано_товара → собрано_заказов<br />
          Агрегация из employee_earnings_s (handoff и стол не пишутся в склад — видны в sborka-сайте)
        </p>
      )}
    </>
  );
}

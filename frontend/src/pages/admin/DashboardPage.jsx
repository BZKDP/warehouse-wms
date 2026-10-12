import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Package, Warehouse, ClipboardList, TrendingUp, Layers, BoxesIcon,
  LayoutGrid, Rows3, PanelTop, BarChart3, Clock, ScanLine,
  AlertTriangle, Users, ChevronRight, ArrowLeft, CheckCircle2, ArrowRight,
  Briefcase, PieChart
} from 'lucide-react';
import api from '../../api/client';
import { qty } from '../../utils/fmt';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmt(seconds) {
  if (!seconds || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} мин ${s} с` : `${s} с`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatCard({ icon: Icon, label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-600',
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-rose-50 text-rose-600',
    gray: 'bg-gray-100 text-gray-500',
  };
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0 ${colors[color] || colors.gray}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">{value ?? '—'}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Per-task analytics view ─────────────────────────────────────────────────
function TaskAnalytics({ taskId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(null);

  useEffect(() => {
    setTab(null);
    api.get(`/tasks/${taskId}/analytics`)
      .then(r => { setData(r.data); setTab(r.data.task.task_type === 'packaging' ? 'boxes' : 'scans'); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [taskId]);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  if (!data) return null;

  const { task, scans, errors, perMinute, boxes = [] } = data;
  const isPackaging = task.task_type === 'packaging';
  const duration = task.duration_seconds;
  const totalItems = isPackaging
    ? boxes.filter(b => b.status === 'closed').reduce((s, b) => s + Number(b.quantity), 0)
    : scans.length;
  const scansPerMin = duration > 0 ? ((totalItems / duration) * 60).toFixed(1) : '—';
  const avgGap = scans.length > 1
    ? (scans.slice(1).reduce((s, sc) => s + (Number(sc.seconds_since_prev) || 0), 0) / (scans.length - 1)).toFixed(1)
    : '—';
  const maxPerMin = perMinute.length > 0 ? Math.max(...perMinute.map(r => Number(r.scan_count))) : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{task.title}</h1>
          <p className="text-sm text-gray-400">
            {task.employee_name}
            {isPackaging ? ' · Оприходование' : (task.rack_name ? ` · ${task.rack_name}${task.shelf_name ? ` · ${task.shelf_name}` : ''}` : '')}
          </p>
        </div>
        <Badge variant={task.status === 'completed' ? 'success' : 'warning'}>
          {task.status === 'completed' ? 'Выполнена' : 'В работе'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Время', value: fmt(duration), icon: Clock, color: 'blue' },
          { label: isPackaging ? 'Упаковано' : 'Сканирований', value: totalItems, icon: isPackaging ? Package : ScanLine, color: 'green' },
          { label: isPackaging ? 'Коробок' : 'Скан/мин', value: isPackaging ? boxes.filter(b => b.status === 'closed').length : scansPerMin, icon: BarChart3, color: 'primary' },
          { label: 'Ошибок', value: errors.length, icon: AlertTriangle, color: errors.length > 0 ? 'red' : 'gray' },
        ].map(({ label, value, icon: Icon, color }) => (
          <StatCard key={label} icon={Icon} label={label} value={value} color={color} />
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-4">
          <p className="text-xs text-gray-400 mb-1">Начало</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{fmtDate(task.started_at)}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-400 mb-1">Конец</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{fmtDate(task.completed_at)}</p>
        </div>
        {isPackaging && (
          <div className="card p-4">
            <p className="text-xs text-gray-400 mb-1">Паллет/ряд</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {boxes[0] ? `Р${boxes[0].row_number}П${boxes[0].pallet_number}` : '—'}
            </p>
          </div>
        )}
        <div className="card p-4">
          <p className="text-xs text-gray-400 mb-1">Среднее между сканами</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{avgGap !== '—' ? `${avgGap} с` : '—'}</p>
        </div>
      </div>

      {perMinute.length > 0 && (
        <div className="card p-5 mb-6">
          <p className="text-sm font-semibold text-gray-700 mb-4">Сканирования по минутам</p>
          <div className="flex items-end gap-1.5 h-20">
            {perMinute.map(row => (
              <div key={row.minute_offset} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-gray-400">{row.scan_count}</span>
                <div className="w-full bg-primary-500 rounded-t-sm" style={{ height: `${maxPerMin > 0 ? (Number(row.scan_count) / maxPerMin) * 56 : 4}px`, minHeight: '4px' }} />
                <span className="text-xs text-gray-300">{row.minute_offset + 1}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">мин от начала задачи</p>
        </div>
      )}

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
        {isPackaging ? (
          <button onClick={() => setTab('boxes')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'boxes' ? 'bg-white text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}>
            Коробки ({boxes.length})
          </button>
        ) : (
          <button onClick={() => setTab('scans')}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${tab === 'scans' ? 'bg-white text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}>
            Хронология ({scans.length})
          </button>
        )}
        <button onClick={() => setTab('errors')}
          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
            tab === 'errors' ? errors.length > 0 ? 'bg-rose-500 text-white shadow-sm' : 'bg-white text-gray-900 dark:text-white shadow-sm'
            : errors.length > 0 ? 'text-rose-400' : 'text-gray-400'
          }`}>
          Ошибки ({errors.length})
        </button>
      </div>

      {tab === 'boxes' && (
        <div className="card overflow-hidden">
          {boxes.length === 0 ? <div className="text-center py-10 text-gray-400">Нет коробок</div> : (
            <div className="divide-y divide-gray-50">
              {boxes.map((b, i) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-gray-300 w-6 text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{b.product_name || '—'}</p>
                    <p className="text-xs text-gray-400">{b.pallet_number ? `Р${b.row_number}П${b.pallet_number}` : '—'}{b.barcode_value ? ` · ${b.barcode_value}` : ''}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-800">{qty(b.quantity)} шт.</p>
                    <p className={`text-xs ${b.status === 'closed' ? 'text-green-500' : 'text-gray-400'}`}>{b.status === 'closed' ? 'закрыта' : 'открыта'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'scans' && (
        <div className="card overflow-hidden">
          {scans.length === 0 ? <div className="text-center py-10 text-gray-400">Нет сканирований</div> : (
            <div className="divide-y divide-gray-50">
              {scans.map((sc, i) => (
                <div key={sc.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs text-gray-300 w-6 text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{sc.product_name || <span className="text-rose-400 italic">Неизвестен</span>}</p>
                    {sc.product_code && <p className="text-xs text-gray-400">{sc.product_code}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-mono text-gray-700">{fmtTime(sc.created_at)}</p>
                    {sc.seconds_since_prev !== null && <p className="text-xs text-gray-300">+{sc.seconds_since_prev}с</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'errors' && (
        <div className="card overflow-hidden">
          {errors.length === 0 ? <div className="text-center py-10 text-gray-400">Ошибок нет</div> : (
            <div className="divide-y divide-gray-50">
              {errors.map(err => (
                <div key={err.id} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-mono font-medium text-rose-700">{err.scanned_value}</p>
                    <p className="text-xs text-gray-400">{fmtTime(err.created_at)}</p>
                  </div>
                  {err.employee_note && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-1.5 mt-1">{err.employee_note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const variant = Number(searchParams.get('v')) || 1;
  const setVariant = (v) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('v', String(v)); return p; }, { replace: true });
  const activeReport = searchParams.get('report') || null;
  const setActiveReport = (r) => setSearchParams(prev => { const p = new URLSearchParams(prev); if (r) p.set('report', r); else p.delete('report'); return p; }, { replace: true });

  const [stats, setStats] = useState(null);
  const [taskStats, setTaskStats] = useState(null);
  const [whStats, setWhStats] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('/products/stats'),
      api.get('/tasks/stats/summary'),
      api.get('/warehouse/stats'),
      api.get('/tasks/analytics/summary').catch(() => ({ data: null })),
    ]).then(([p, t, w, a]) => {
      setStats(p.data);
      setTaskStats(t.data);
      setWhStats(w.data);
      setAnalytics(a.data);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, []);

  // Drill into task
  if (selectedTask) {
    return <TaskAnalytics taskId={selectedTask} onBack={() => setSelectedTask(null)} />;
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  }

  const totalShelves = Number(whStats?.shelves_count || 0);
  const occupiedShelves = Number(whStats?.occupied_shelves || 0);
  const fillPercent = totalShelves > 0 ? Math.round((occupiedShelves / totalShelves) * 100) : 0;
  const overview = analytics?.overview || {};
  const topEmployees = analytics?.topEmployees || [];
  const recentTasks = analytics?.recentTasks || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Дашборд</h1>
            <p className="text-gray-500 text-sm mt-1">Общая сводка по складу и аналитика</p>
          </div>
          <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden ml-4 flex-shrink-0">
            <button onClick={() => setVariant(1)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${variant === 1 ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >Обзор</button>
            <button onClick={() => setVariant(2)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-300 dark:border-gray-600 ${variant === 2 ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >Отчёты</button>
          </div>
        </div>
      </div>

      {variant === 2 ? (
        /* ══════════════ VARIANT 2: REPORTS ══════════════ */
        <div className="space-y-4">
          {/* Report cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Card 1: Warehouse fill by warehouse */}
            <div className="card p-0 overflow-hidden hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700 transition-all cursor-pointer group"
              onClick={() => setActiveReport('warehouse-fill')}
            >
              <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                <Warehouse size={16} className="text-primary-500" />
                <p className="text-sm font-bold text-gray-900 dark:text-white flex-1">Заполненность складов</p>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-primary-500 transition-colors" />
              </div>
              <div className="px-4 pb-3">
                {whStats?.warehouses?.slice(0, 3).map(wh => {
                  const fill = Number(wh.shelves_count) > 0 ? Math.round((Number(wh.occupied_shelves) / Number(wh.shelves_count)) * 100) : 0;
                  return (
                    <div key={wh.id} className="flex items-center gap-2 py-1">
                      <span className="text-[11px] text-gray-600 w-24 truncate">{wh.name}</span>
                      <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${fill > 80 ? 'bg-rose-400' : fill > 50 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${fill}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500 w-8 text-right">{fill}%</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Card 2: Task analytics */}
            <div className="card p-0 overflow-hidden hover:shadow-lg hover:border-primary-300 dark:hover:border-primary-700 transition-all cursor-pointer group"
              onClick={() => setActiveReport('task-stats')}
            >
              <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                <ClipboardList size={16} className="text-amber-500" />
                <p className="text-sm font-bold text-gray-900 dark:text-white flex-1">Аналитика задач</p>
                <ArrowRight size={14} className="text-gray-300 group-hover:text-primary-500 transition-colors" />
              </div>
              <div className="px-4 pb-3 grid grid-cols-3 gap-2">
                {[
                  { label: 'Выполнено', val: taskStats?.completed_count || 0, color: 'text-green-600' },
                  { label: 'В работе', val: taskStats?.in_progress_count || 0, color: 'text-amber-600' },
                  { label: 'Новые', val: taskStats?.new_count || 0, color: 'text-gray-500' },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <p className={`text-lg font-bold ${s.color}`}>{s.val}</p>
                    <p className="text-[10px] text-gray-400">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Placeholder cards */}
            {[{ title: 'Отчёт 3', icon: PieChart }, { title: 'Отчёт 4', icon: TrendingUp }].map((r, i) => (
              <div key={i} className="card p-5 opacity-40">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <r.icon size={20} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-500">{r.title}</p>
                    <p className="text-[11px] text-gray-400">Скоро</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
      <>
      {/* ══════════════ VARIANT 1: OVERVIEW ══════════════ */}

      {/* ── Row 1: Key stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <StatCard icon={Package} label="Товаров" value={Number(stats?.products_count || 0) + Number(stats?.bundles_count || 0)} sub={`${stats?.bundles_count || 0} комплектов`} color="primary" />
        <StatCard icon={Layers} label="На складе (шт.)" value={Number(whStats?.total_items || 0).toLocaleString('ru-RU')} sub={`${whStats?.unique_products || 0} позиций`} color="blue" />
        <StatCard icon={ClipboardList} label="Активных задач" value={Number(taskStats?.new_count || 0) + Number(taskStats?.in_progress_count || 0)} sub={`${taskStats?.in_progress_count || 0} в работе`} color="amber" />
        <StatCard icon={CheckCircle2} label="Задач выполнено" value={overview.completed_tasks || taskStats?.completed_count || 0} color="green" />
        <StatCard icon={ScanLine} label="Всего сканов" value={overview.total_scans || 0} color="primary" />
        <StatCard icon={Clock} label="Ср. время задачи" value={overview.avg_duration_minutes ? `${overview.avg_duration_minutes} мин` : '—'} color="blue" />
      </div>

      {/* ── Row 2: Warehouse + Tasks + Fill ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Warehouse fill */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Заполненность склада</h2>
          <div className="flex items-end justify-between mb-2">
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{fillPercent}%</span>
            <span className="text-sm text-gray-400">{occupiedShelves} / {totalShelves} полок</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${fillPercent > 80 ? 'bg-rose-400' : fillPercent > 50 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${fillPercent}%` }} />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-2">
            <span>{occupiedShelves} занято</span>
            <span>{Number(whStats?.empty_shelves || 0)} свободно</span>
          </div>
        </div>

        {/* Warehouse structure */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Структура склада</h2>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[
              { label: 'Складов', value: whStats?.warehouses_count, icon: Warehouse },
              { label: 'Стеллажей', value: whStats?.racks_count, icon: LayoutGrid },
              { label: 'Полок', value: whStats?.shelves_count, icon: BoxesIcon },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{value || 0}</p>
                <p className="text-xs text-gray-500 mt-1">{label}</p>
              </div>
            ))}
          </div>
          {(Number(whStats?.pallet_rows_count) > 0 || Number(whStats?.pallets_count) > 0) && (
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100">
              {[
                { label: 'Рядов (паллетный)', value: whStats?.pallet_rows_count },
                { label: 'Паллетов', value: whStats?.pallets_count },
                { label: 'Коробок', value: whStats?.boxes_count },
              ].map(({ label, value }) => (
                <div key={label} className="bg-blue-50 dark:bg-blue-900/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-blue-800">{value || 0}</p>
                  <p className="text-xs text-blue-500 mt-1">{label}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tasks by status */}
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Задачи по статусам</h2>
          <div className="space-y-3">
            {[
              { label: 'Новые', value: taskStats?.new_count || 0, color: 'bg-gray-200' },
              { label: 'В работе', value: taskStats?.in_progress_count || 0, color: 'bg-amber-400' },
              { label: 'Выполнены', value: taskStats?.completed_count || 0, color: 'bg-green-400' },
              { label: 'Отменены', value: taskStats?.cancelled_count || 0, color: 'bg-rose-300' },
            ].map(({ label, value, color }) => {
              const total = Object.values(taskStats || {}).reduce((s, v) => s + Number(v), 0) || 1;
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{value}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${color}`} style={{ width: `${(value / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Row 3: Analytics — Recent tasks + Top employees ────────────── */}
      {analytics && (
        <>
          {/* Analytics stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard icon={BarChart3} label="Ср. между пиками" value={overview.avg_seconds_per_scan ? `${overview.avg_seconds_per_scan} с` : '—'} color="primary" />
            <StatCard icon={AlertTriangle} label="Ошибки сканов" value={overview.total_errors || 0} color={Number(overview.total_errors) > 0 ? 'red' : 'gray'} />
            <StatCard icon={Users} label="Сотрудников активно" value={topEmployees.length} color="purple" />
            <StatCard icon={TrendingUp} label="Всего задач выполнено" value={overview.completed_tasks || 0} color="green" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
            {/* Recent completed tasks */}
            <div className="lg:col-span-2 card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <h2 className="font-semibold text-gray-900 dark:text-white">Завершённые задачи</h2>
                <p className="text-xs text-gray-400 mt-0.5">Нажмите для детальной аналитики</p>
              </div>
              {recentTasks.length === 0 ? (
                <div className="text-center py-10 text-gray-400">Нет завершённых задач</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recentTasks.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTask(t.id)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{t.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-gray-400">{t.employee_name || '—'}</span>
                          <span className="text-gray-200">&middot;</span>
                          <span className="text-xs text-gray-400">{fmtDate(t.completed_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-xs font-semibold text-gray-700">{t.scans_count} сканов</p>
                          <p className="text-xs text-gray-400">
                            {t.duration_minutes ? `${t.duration_minutes} мин` : '—'}
                            {t.avg_scan_gap != null ? ` · ${t.avg_scan_gap}с` : ''}
                          </p>
                        </div>
                        {Number(t.errors_count) > 0 && (
                          <span className="text-xs bg-rose-50 text-rose-500 px-1.5 py-0.5 rounded-lg font-medium">{t.errors_count} ош.</span>
                        )}
                        <ChevronRight size={15} className="text-gray-300" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Top employees */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-50">
                <h2 className="font-semibold text-gray-900 dark:text-white">Лучшие сотрудники</h2>
                <p className="text-xs text-gray-400 mt-0.5">По количеству сканирований</p>
              </div>
              {topEmployees.length === 0 ? (
                <div className="text-center py-10 text-gray-400">Нет данных</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {topEmployees.map((e, i) => (
                    <div key={e.full_name} className="flex items-center gap-3 px-5 py-3">
                      <span className={`text-sm font-bold w-5 flex-shrink-0 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-amber-700' : 'text-gray-300'}`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{e.full_name}</p>
                        <p className="text-xs text-gray-400">
                          {e.tasks_count} задач
                          {e.avg_minutes ? ` · ${e.avg_minutes} мин/зад.` : ''}
                          {e.avg_scan_gap != null ? ` · ${e.avg_scan_gap}с/скан` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-primary-600 flex-shrink-0">{e.scans_count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Row 4: Per-warehouse breakdown ─────────────────────────────── */}
      {whStats?.warehouses?.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">По складам</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {whStats.warehouses.map(wh => {
              const whFill = Number(wh.shelves_count) > 0
                ? Math.round((Number(wh.occupied_shelves) / Number(wh.shelves_count)) * 100)
                : 0;
              const isFbo = wh.warehouse_type === 'fbo';
              const totalQty = isFbo ? Number(wh.fbo_items || 0) : Number(wh.total_items || 0);
              return (
                <div key={wh.id} className={`rounded-2xl p-4 ${isFbo ? 'bg-blue-50' : 'bg-gray-50'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isFbo ? 'bg-blue-100 text-blue-600' : 'bg-primary-100 text-primary-600'}`}>
                      <Warehouse size={15} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{wh.name}</h3>
                      <span className={`text-xs font-medium ${isFbo ? 'text-blue-500' : 'text-gray-400'}`}>{isFbo ? 'Паллетный' : 'Стеллажный'}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <p className="text-xs text-gray-400">Товаров (шт.)</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">{totalQty.toLocaleString('ru-RU')}</p>
                    </div>
                    {!isFbo && (
                      <div>
                        <p className="text-xs text-gray-400">Позиций</p>
                        <p className="text-lg font-bold text-gray-900 dark:text-white">{wh.unique_products}</p>
                      </div>
                    )}
                    {isFbo ? (
                      <>
                        <div><p className="text-xs text-gray-400">Рядов</p><p className="text-sm font-semibold text-gray-700">{wh.pallet_rows_count || 0}</p></div>
                        <div><p className="text-xs text-gray-400">Паллетов</p><p className="text-sm font-semibold text-gray-700">{wh.pallets_count || 0}</p></div>
                        <div><p className="text-xs text-gray-400">Коробок</p><p className="text-sm font-semibold text-gray-700">{wh.boxes_count || 0}</p></div>
                      </>
                    ) : (
                      <>
                        <div><p className="text-xs text-gray-400">Стеллажей</p><p className="text-sm font-semibold text-gray-700">{wh.racks_count}</p></div>
                        <div><p className="text-xs text-gray-400">Полок</p><p className="text-sm font-semibold text-gray-700">{wh.shelves_count}</p></div>
                      </>
                    )}
                  </div>
                  {!isFbo && (
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Заполненность</span>
                        <span>{whFill}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${whFill > 80 ? 'bg-rose-400' : whFill > 50 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${whFill}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}

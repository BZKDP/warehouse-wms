import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Clock, CheckCircle2, ChevronRight, RefreshCw,
  Box, ScanLine, Package, ArrowRight, Layers, AlertCircle, Pause
} from 'lucide-react';
import api from '../../api/client';
import { InventoryIcon, PackagingIcon, TransferIcon, BundleIcon, ReturnsIcon } from '../../components/ui/WarehouseIcons';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import FeedbackButton from '../../components/ui/FeedbackButton';
import { cn } from '../../utils/cn';

const STATUS_MAP = {
  new: { label: 'Новая', variant: 'default', color: 'bg-blue-50 text-blue-600 border-blue-200', icon: Clock },
  in_progress: { label: 'В работе', variant: 'warning', color: 'bg-amber-50 text-amber-600 border-amber-200', icon: ScanLine },
  paused: { label: 'На паузе', variant: 'info', color: 'bg-orange-50 text-orange-600 border-orange-200', icon: Pause },
  completed: { label: 'Выполнена', variant: 'success', color: 'bg-green-50 text-green-600 border-green-200', icon: CheckCircle2 },
  cancelled: { label: 'Отменена', variant: 'danger', color: 'bg-rose-50 text-rose-500 border-rose-200', icon: AlertCircle },
};

const TASK_TYPE_STYLE = {
  inventory: { SvgIcon: InventoryIcon, label: 'Инвентаризация', bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  packaging: { SvgIcon: PackagingIcon, label: 'Оприходование', bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
  production_transfer: { SvgIcon: TransferIcon, label: 'Перенос', bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200' },
  bundle_assembly: { SvgIcon: BundleIcon, label: 'Сборка комплектов', bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
  returns: { SvgIcon: ReturnsIcon, label: 'Возвраты', bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
  default: { SvgIcon: InventoryIcon, label: 'Задача', bg: 'bg-primary-50', text: 'text-primary-600', border: 'border-primary-200' },
};

const TASK_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'inventory', label: 'Инвентаризация' },
  { key: 'packaging', label: 'Оприходование' },
  { key: 'bundle_assembly', label: 'Сборка' },
  { key: 'production_transfer', label: 'Перенос' },
  { key: 'returns', label: 'Возвраты' },
];

export default function MyTasksPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tasks', { params: { limit: 100 } });
      setTasks(res.data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  // Auto-refresh every 30s when active tasks exist
  const pollRef = useRef(null);
  useEffect(() => {
    clearInterval(pollRef.current);
    if (tasks.some(t => t.status === 'in_progress')) {
      pollRef.current = setInterval(load, 30000);
    }
    return () => clearInterval(pollRef.current);
  }, [tasks, load]);

  const filtered = typeFilter === 'all' ? tasks : tasks.filter(t => t.task_type === typeFilter);
  const activeTasks = filtered.filter(t => t.status === 'new' || t.status === 'in_progress' || t.status === 'paused');
  const doneTasks = filtered.filter(t => t.status === 'completed' || t.status === 'cancelled');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
          <ClipboardList size={22} className="text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Мои задачи</h1>
            <FeedbackButton position="employee" />
          </div>
          <p className="text-xs text-gray-400">
            {activeTasks.length > 0 ? `${activeTasks.length} активных` : 'Нет активных задач'}
          </p>
        </div>
        <button
          onClick={load}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all active:scale-95"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Filter chips */}
      {tasks.length > 0 && (
        <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
          {TASK_FILTERS.map(f => (
            <button key={f.key} onClick={() => setTypeFilter(f.key)}
              className={cn(
                'px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 min-h-[36px]',
                typeFilter === f.key
                  ? 'bg-blue-500 text-white shadow-sm'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              )}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 && tasks.length > 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <p className="font-semibold text-gray-500">Нет задач этого типа</p>
          <button onClick={() => setTypeFilter('all')} className="text-sm mt-2 text-blue-500 hover:underline">Показать все</button>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mb-4">
            <ClipboardList size={32} className="opacity-40" />
          </div>
          <p className="font-semibold text-gray-500">Нет задач</p>
          <p className="text-sm mt-1 text-gray-400">Задачи появятся здесь когда будут назначены</p>
        </div>
      ) : (
        <>
          {/* Active tasks */}
          {activeTasks.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Активные ({activeTasks.length})
                </h2>
              </div>
              <div className="space-y-2.5">
                {activeTasks.map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    index={i}
                    onClick={() => navigate(
                      task.task_type === 'packaging' ? `/employee/packaging/${task.id}` :
                      task.task_type === 'bundle_assembly' ? `/employee/assembly/${task.id}` :
                      task.task_type === 'returns' ? `/employee/returns` :
                      `/employee/tasks/${task.id}`
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Done tasks */}
          {doneTasks.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Завершённые ({doneTasks.length})
                </h2>
              </div>
              <div className="space-y-2">
                {doneTasks.slice(0, 5).map((task, i) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    index={activeTasks.length + i}
                    onClick={() => navigate(
                      task.task_type === 'packaging' ? `/employee/packaging/${task.id}` :
                      task.task_type === 'bundle_assembly' ? `/employee/assembly/${task.id}` :
                      task.task_type === 'returns' ? `/employee/returns` :
                      `/employee/tasks/${task.id}`
                    )}
                    muted
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TaskCard({ task, onClick, muted, index = 0 }) {
  const status = STATUS_MAP[task.status] || STATUS_MAP.new;
  const typeStyle = TASK_TYPE_STYLE[task.task_type] || TASK_TYPE_STYLE.default;
  const TypeSvgIcon = typeStyle.SvgIcon;
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (task.status !== 'in_progress' || !task.started_at) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(task.started_at).getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [task.status, task.started_at]);

  return (
    <button
      onClick={onClick}
      style={{ animationDelay: `${index * 0.07}s` }}
      className={cn(
        'w-full text-left p-4 rounded-2xl border transition-all active:scale-[0.98] animate-fade-up',
        muted
          ? 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 opacity-55'
          : task.status === 'in_progress'
          ? 'bg-white border-l-[3px] border-l-amber-400 border-amber-200 shadow-sm hover:shadow-md hover:-translate-y-0.5'
          : 'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-primary-200'
      )}
    >
      <div className="flex items-start gap-3">
        {/* Task type icon */}
        <div className={cn(
          'w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 border',
          muted ? 'bg-gray-100 border-gray-200' : `${typeStyle.bg} ${typeStyle.border}`
        )}>
          <TypeSvgIcon size={28} />
        </div>

        <div className="flex-1 min-w-0">
          {/* Task type badge */}
          {task.task_type && !muted && (
            <span className={cn(
              'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg mb-1',
              typeStyle.bg, typeStyle.text
            )}>
              {typeStyle.label}
            </span>
          )}

          {/* Title */}
          <p className={cn(
            'font-semibold leading-tight',
            muted ? 'text-gray-500' : 'text-gray-900 dark:text-white'
          )}>
            {task.title}
          </p>

          {/* Location info */}
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
            {(task.rack_name || task.shelf_name) && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Package size={11} className="text-gray-400" />
                {task.rack_name}{task.shelf_name ? ` · ${task.shelf_name}` : ''}
              </span>
            )}
            {!task.shelf_name && task.pallet_name && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Layers size={11} className="text-gray-400" />
                {task.pallet_row_name || 'Ряд'} · {task.pallet_name}
              </span>
            )}
            {Number(task.task_boxes_total || 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Box size={11} className="text-gray-400" />
                Коробки {Number(task.task_boxes_completed || 0)}/{Number(task.task_boxes_total || 0)}
              </span>
            )}
            {task.box_barcode && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <Box size={11} className="text-gray-400" />
                {task.box_barcode}
              </span>
            )}
          </div>

          {task.notes && (
            <p className="text-xs text-gray-400 mt-1.5 line-clamp-1 italic">{task.notes}</p>
          )}
        </div>

        {/* Right side: status + arrow */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <Badge variant={status.variant}>{status.label}</Badge>
          {elapsed && (
            <span className="text-[11px] font-mono text-amber-500 font-semibold">{elapsed}</span>
          )}
          {task.scans_count > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-gray-400 font-medium">
              <ScanLine size={10} />
              {task.scans_count}
            </span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
            <Clock size={11} />
            {new Date(task.created_at).toLocaleDateString('ru-RU')}
          </span>
          {task.duration_minutes && (
            <span className="text-[10px] text-gray-300">
              {Number(task.duration_minutes) < 60 ? `${Math.round(Number(task.duration_minutes))}м` : `${Math.floor(Number(task.duration_minutes)/60)}ч${Math.round(Number(task.duration_minutes)%60)}м`}
            </span>
          )}
        </div>
        <div className={cn(
          'flex items-center gap-1 text-xs font-medium',
          muted ? 'text-gray-300' : 'text-primary-500'
        )}>
          {muted ? '' : 'Открыть'}
          <ChevronRight size={14} />
        </div>
      </div>
    </button>
  );
}

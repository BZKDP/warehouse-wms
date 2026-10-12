import { ShelfIcon, PalletIcon, BoxIcon } from '../../../components/ui/WarehouseIcons';
import Badge from '../../../components/ui/Badge';
import { STATUS_MAP, TASK_TYPE_ICON } from './taskConstants';

export default function TaskCard({ task, onClick }) {
  const status = STATUS_MAP[task.status] || STATUS_MAP.new;
  const typeInfo = TASK_TYPE_ICON[task.task_type] || TASK_TYPE_ICON.inventory;
  const TypeIcon = typeInfo.Icon;

  // SLA: task running > 1h = warning, > 2h = danger
  const isActive = task.status === 'in_progress';
  const startedMs = task.started_at ? Date.now() - new Date(task.started_at).getTime() : 0;
  const hoursRunning = startedMs / 3600000;
  const slaLevel = isActive && hoursRunning > 2 ? 'danger' : isActive && hoursRunning > 1 ? 'warning' : null;

  return (
    <button
      onClick={() => onClick(task)}
      className={`w-full text-left card p-4 hover:shadow-md transition-all group ${slaLevel === 'danger' ? 'border-rose-300 bg-rose-50/30 hover:border-rose-400' : slaLevel === 'warning' ? 'border-amber-200 bg-amber-50/20 hover:border-amber-300' : 'hover:border-primary-200'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${typeInfo.bg} ${typeInfo.border}`}>
          <TypeIcon size={26} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium text-gray-900 text-sm leading-tight group-hover:text-primary-700 transition-colors">{task.title}</h3>
            <Badge variant={status.variant} className="flex-shrink-0">{status.label}</Badge>
          </div>

          {/* Row 1: type badge + employee */}
          <div className="flex items-center gap-2 mt-1.5 text-xs">
            {task.task_type === 'packaging' && <span className="font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-lg">Оприходование</span>}
            {task.task_type === 'production_transfer' && <span className="font-semibold text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-lg">Перенос</span>}
            {task.task_type === 'inventory' && <span className="font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-lg">Инвентаризация</span>}
            {task.task_type === 'bundle_assembly' && <span className="font-semibold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded-lg">Сборка</span>}
            {task.task_type === 'returns' && <span className="font-semibold text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded-lg">Возвраты</span>}
            {task.employee_name && <span className="text-gray-500">{task.employee_name}</span>}
            {task.shelf_code && <span className="inline-flex items-center gap-1 text-gray-500"><ShelfIcon size={12} />{task.rack_name} · {task.shelf_name}</span>}
            {!task.shelf_code && task.pallet_name && <span className="inline-flex items-center gap-1 text-gray-500"><PalletIcon size={12} />{task.pallet_row_name || 'Ряд'} · {task.pallet_name}</span>}
            {task.box_barcode && <span className="inline-flex items-center gap-1 text-gray-500"><BoxIcon size={12} />Коробка {task.box_barcode}</span>}
          </div>
          {/* Row 2: stats grid — fixed positions */}
          <div className="grid grid-cols-[auto_auto_auto_auto_1fr] gap-x-3 mt-1 text-xs text-gray-500">
            {Number(task.task_boxes_total || 0) > 0 && (
              <span>Коробки {Number(task.task_boxes_completed || 0)} / {Number(task.task_boxes_total || 0)}</span>
            )}
            {Number(task.scans_count) > 0 && <span>{task.scans_count} {task.task_type === 'returns' ? 'разложено' : 'сканов'}</span>}
            {task.avg_scan_time && <span className="text-primary-500">{Number(task.avg_scan_time).toFixed(1)}с</span>}
            {task.task_type === 'bundle_assembly' && task.assembled_count != null && (
              <span className="text-green-600 font-semibold">{task.assembled_count}/{task.bundle_qty} собрано</span>
            )}
            {task.duration_minutes && <span className="text-gray-400">{Number(task.duration_minutes) < 60 ? `${Number(task.duration_minutes).toFixed(0)}м` : `${Math.floor(Number(task.duration_minutes)/60)}ч${Math.round(Number(task.duration_minutes)%60)}м`}</span>}
            <span className="text-gray-300 text-right">{new Date(task.created_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
          </div>

          {/* Progress bar for assembly and box-based tasks */}
          {(() => {
            const done = task.task_type === 'bundle_assembly' ? Number(task.assembled_count || 0) : Number(task.task_boxes_completed || 0);
            const total = task.task_type === 'bundle_assembly' ? Number(task.bundle_qty || 0) : Number(task.task_boxes_total || 0);
            if (total <= 0 || done >= total && task.status !== 'in_progress') return null;
            const pct = Math.min(100, Math.round((done / total) * 100));
            return (
              <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-green-500' : pct >= 50 ? 'bg-primary-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
              </div>
            );
          })()}

          {task.notes && (
            <p className="text-xs text-gray-400 mt-1.5 line-clamp-1">{task.notes}</p>
          )}
        </div>

        {isActive && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0 mt-1">
            <span className={`w-2 h-2 rounded-full animate-pulse ${slaLevel === 'danger' ? 'bg-rose-500' : slaLevel === 'warning' ? 'bg-amber-500' : 'bg-amber-400'}`} />
            {hoursRunning >= 0.5 && (
              <span className={`text-[10px] font-mono ${slaLevel === 'danger' ? 'text-rose-500 font-bold' : slaLevel === 'warning' ? 'text-amber-500' : 'text-gray-400'}`}>
                {Math.floor(hoursRunning)}ч{Math.floor((hoursRunning % 1) * 60)}м
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

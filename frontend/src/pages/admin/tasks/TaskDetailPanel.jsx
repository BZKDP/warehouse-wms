import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Pause, Play, AlertTriangle, ScanLine, Package, Box, MapPin, ChevronRight, Copy, ExternalLink
} from 'lucide-react';
import api from '../../../api/client';
import { qty } from '../../../utils/fmt';
import { GRACoinIcon } from '../../../components/ui/WarehouseIcons';
import Button from '../../../components/ui/Button';
import Badge from '../../../components/ui/Badge';
import Spinner from '../../../components/ui/Spinner';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';
import { STATUS_MAP, TASK_TYPE_ICON, fmtTime, fmtDate } from './taskConstants';
import { formatRub } from '../../../utils/currency';

export default function TaskDetailPanel({ task, onClose, onReload }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('scans');
  const [boxes, setBoxes] = useState(null);
  const [boxesLoading, setBoxesLoading] = useState(false);
  const intervalRef = useRef(null);
  const isPackaging = task.task_type === 'packaging';
  const isAssembly = task.task_type === 'bundle_assembly';
  const [assemblyData, setAssemblyData] = useState(null);
  const [assemblySourceBoxes, setAssemblySourceBoxes] = useState([]);
  const [showAssemblyModal, setShowAssemblyModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); // null | 'ask' | 'refund'
  const [employees, setEmployees] = useState([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesText, setNotesText] = useState(task.notes || '');
  const [graEarned, setGraEarned] = useState(null);

  // Reset state when task changes to avoid showing stale data
  useEffect(() => {
    setAnalytics(null);
    setLoading(true);
    setBoxes(null);
    setAssemblyData(null);
    setAssemblySourceBoxes([]);
    setTab('scans');
  }, [task.id]);

  const loadAnalytics = useCallback(() => {
    api.get(`/tasks/${task.id}/analytics`)
      .then(r => setAnalytics(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
    // Load GRA earned
    api.get(`/tasks/${task.id}`)
      .then(r => setGraEarned(Number(r.data.gra_earned || 0)))
      .catch(() => {});
  }, [task.id]);

  useEffect(() => {
    loadAnalytics();
    if (task.status === 'in_progress') {
      intervalRef.current = setInterval(loadAnalytics, 15000);
    }
    return () => clearInterval(intervalRef.current);
  }, [loadAnalytics, task.status]);

  useEffect(() => {
    if (!isPackaging) return;
    setBoxesLoading(true);
    api.get(`/packing/${task.id}/boxes`)
      .then(r => setBoxes(r.data))
      .catch(console.error)
      .finally(() => setBoxesLoading(false));
  }, [task.id, isPackaging]);

  // Load assembly details
  useEffect(() => {
    if (!isAssembly) return;
    api.get(`/assembly/${task.id}`).then(r => setAssemblyData(r.data)).catch(() => {});
    api.get(`/assembly/${task.id}/source-boxes`).then(r => setAssemblySourceBoxes(r.data || [])).catch(() => {});
  }, [task.id, isAssembly]);

  const handleCancel = async () => {
    try {
      await api.put(`/tasks/${task.id}`, { status: 'cancelled' });
      toast.success('Задача отменена');
      onClose();
      onReload();
    } catch { toast.error('Ошибка'); }
  };

  const handlePause = async () => {
    try {
      const res = await api.post(`/tasks/${task.id}/pause`);
      toast.success(res.data.message);
      onClose();
      onReload();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const handleSaveNotes = async () => {
    try {
      await api.patch(`/tasks/${task.id}`, { notes: notesText });
      toast.success('Заметки сохранены');
      setEditingNotes(false);
      onReload();
    } catch { toast.error('Ошибка сохранения'); }
  };

  const handleDuplicate = async () => {
    try {
      const body = {
        title: task.title,
        task_type: task.task_type || 'inventory',
        employee_id: task.employee_id || undefined,
        shelf_id: task.shelf_id || undefined,
        target_pallet_id: task.target_pallet_id || undefined,
        notes: task.notes || undefined,
      };
      await api.post('/tasks', body);
      toast.success('Задача дублирована');
      onReload();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка дублирования'); }
  };

  const handleDeleteClick = () => setDeleteConfirm('ask');

  const handleDeleteExecute = async (refund) => {
    setDeleteConfirm(null);
    try {
      if (isAssembly) {
        await api.delete(`/assembly/${task.id}`, { params: { refund: refund ? '1' : '0' } });
      } else {
        await api.delete(`/tasks/${task.id}`, { params: { refund: refund ? '1' : '0' } });
      }
      toast.success(refund ? 'Задача удалена, оплата списана' : 'Задача удалена, оплата сохранена');
      onClose();
      onReload();
    } catch { toast.error('Ошибка удаления'); }
  };

  // Load employees for assignment
  useEffect(() => {
    if (showAssign && employees.length === 0) {
      api.get('/staff/employees').then(r => setEmployees(r.data.filter(e => e.active !== false))).catch(() => {});
    }
  }, [showAssign, employees.length]);

  const handleAssign = async (empId) => {
    try {
      await api.patch(`/tasks/${task.id}`, { employee_id: empId || null });
      toast.success(empId ? 'Сотрудник назначен' : 'Сотрудник снят');
      setShowAssign(false);
      onReload();
    } catch { toast.error('Ошибка назначения'); }
  };

  const status = STATUS_MAP[task.status] || STATUS_MAP.new;
  const scans = analytics?.scans || [];
  const errors = analytics?.errors || [];
  const taskBoxes = analytics?.task_boxes || [];
  const hasBoxes = taskBoxes.length > 0;
  const [groupByBox, setGroupByBox] = useState(false);
  const [openBoxIds, setOpenBoxIds] = useState(new Set());
  const toggleBox = (id) => setOpenBoxIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md bg-white dark:bg-gray-900 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800">
          {/* Task type icon */}
          {(() => {
            const ti = TASK_TYPE_ICON[task.task_type] || TASK_TYPE_ICON.inventory;
            return (
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 border ${ti.bg} ${ti.border}`}>
                <ti.Icon size={28} />
              </div>
            );
          })()}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={status.variant}>{status.label}</Badge>
              {task.status === 'in_progress' && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white leading-tight">{task.title}</h2>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-xs text-gray-400">
              {task.employee_name ? (
                <button onClick={() => setShowAssign(!showAssign)} className="text-primary-500 hover:text-primary-700 font-medium transition-colors">
                  {task.employee_name} ✎
                </button>
              ) : (
                <button onClick={() => setShowAssign(!showAssign)} className="text-primary-500 hover:text-primary-700 font-medium transition-colors">
                  + Назначить
                </button>
              )}
              {task.rack_name && <span>{task.rack_name}{task.shelf_name ? ` · ${task.shelf_name}` : ''}</span>}
              {!task.rack_name && task.pallet_name && <span>{task.pallet_row_name || 'Ряд'} · {task.pallet_name}</span>}
              {Number(task.task_boxes_total || 0) > 0 && <span>Коробки {Number(task.task_boxes_completed || 0)} / {Number(task.task_boxes_total || 0)}</span>}
              {task.box_barcode && <span>Коробка {task.box_barcode}</span>}
              <span>{fmtDate(task.created_at)}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        {/* Notes */}
        <div className="mx-4 mt-2">
          {editingNotes ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={notesText}
                onChange={e => setNotesText(e.target.value)}
                autoFocus
                placeholder="Добавить заметку..."
                className="flex-1 px-3 py-1.5 text-sm rounded-xl border border-primary-200 bg-primary-50 focus:outline-none focus:border-primary-400"
                onKeyDown={e => { if (e.key === 'Enter') handleSaveNotes(); if (e.key === 'Escape') setEditingNotes(false); }}
              />
              <button onClick={handleSaveNotes} className="px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold">OK</button>
            </div>
          ) : (
            <button onClick={() => { setNotesText(task.notes || ''); setEditingNotes(true); }}
              className="text-xs text-gray-400 hover:text-primary-500 transition-colors">
              {task.notes ? `📝 ${task.notes}` : '+ Добавить заметку'}
            </button>
          )}
        </div>

        {/* Earned badge (in rubles) */}
        {graEarned > 0 && (
          <div className="mx-4 mt-2 flex items-center gap-1.5">
            <span className="text-xs font-black text-amber-600">₽</span>
            <span className="text-xs font-bold text-amber-600">+{formatRub(graEarned)} ₽</span>
          </div>
        )}

        {/* Assign employee dropdown */}
        {showAssign && (
          <div className="mx-4 mt-2 rounded-xl border border-primary-200 bg-primary-50 overflow-hidden">
            <input
              type="text"
              placeholder="Поиск сотрудника..."
              value={assignSearch}
              onChange={e => setAssignSearch(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 text-sm bg-white border-b border-primary-100 focus:outline-none focus:bg-primary-50 transition-colors"
            />
            <div className="max-h-40 overflow-y-auto p-1">
              <button onClick={() => handleAssign(null)} className="w-full text-left px-3 py-1.5 text-sm text-gray-400 hover:bg-white rounded-lg transition-colors">
                — Снять назначение —
              </button>
              {employees
                .filter(e => !assignSearch || e.full_name.toLowerCase().includes(assignSearch.toLowerCase()))
                .map(e => (
                <button key={e.id} onClick={() => handleAssign(e.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    e.id === task.employee_id ? 'bg-primary-100 text-primary-700 font-semibold' : 'text-gray-700 hover:bg-white'
                  }`}>
                  {e.full_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stats row */}
        {analytics && (() => {
          const gaps = scans.filter(s => s.seconds_since_prev != null && s.seconds_since_prev > 0).map(s => Number(s.seconds_since_prev));
          const avgGap = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : null;
          const duration = task.started_at && (task.completed_at || task.status === 'in_progress')
            ? ((new Date(task.completed_at || Date.now()) - new Date(task.started_at)) / 60000).toFixed(1)
            : null;
          return (
          <div className={`grid ${isAssembly ? 'grid-cols-4' : 'grid-cols-3'} divide-x divide-gray-100 dark:divide-gray-800 border-b border-gray-100 dark:border-gray-800`}>
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">Сканов</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white">{scans.length}</p>
            </div>
            {avgGap && (
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">Ср. между</p>
              <p className="text-lg font-bold text-primary-600">{avgGap}с</p>
            </div>
            )}
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">Ошибок</p>
              <p className={`text-lg font-bold ${errors.length > 0 ? 'text-rose-500' : 'text-gray-400'}`}>{errors.length}</p>
            </div>
            <div className="px-3 py-3 text-center">
              <p className="text-xs text-gray-400 mb-0.5">{duration ? 'Время' : 'Начато'}</p>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{duration ? `${duration} мин` : fmtTime(task.started_at)}</p>
            </div>
          </div>
          );
        })()}

        {/* Detail buttons */}
        {isAssembly && (
          <button onClick={() => setShowAssemblyModal(true)}
            className="mx-4 mt-3 w-[calc(100%-2rem)] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary-50 border border-primary-200 text-primary-700 text-sm font-semibold hover:bg-primary-100 transition-colors">
            <Package size={16} />
            Детали сборки комплектов
          </button>
        )}
        {!isAssembly && analytics && (() => {
          const gaps = scans.filter(s => s.seconds_since_prev != null && s.seconds_since_prev > 0).map(s => Number(s.seconds_since_prev));
          const avgGap = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : null;
          const duration = task.started_at && task.completed_at
            ? ((new Date(task.completed_at) - new Date(task.started_at)) / 60000).toFixed(1) : null;
          const uniqueProducts = new Set(scans.map(s => s.product_id)).size;
          if (!scans.length && !errors.length) return null;
          return (
            <div className="mx-4 mt-3 p-3 rounded-xl bg-primary-50 border border-primary-100 space-y-2">
              <p className="text-xs font-semibold text-primary-700 uppercase">
                {isPackaging ? 'Детали оприходования' : 'Детали инвентаризации'}
              </p>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div><p className="text-lg font-black text-primary-700">{scans.length}</p><p className="text-[10px] text-primary-400">Сканов</p></div>
                <div><p className="text-lg font-black text-primary-700">{uniqueProducts}</p><p className="text-[10px] text-primary-400">Товаров</p></div>
                {avgGap && <div><p className="text-lg font-black text-primary-700">{avgGap}с</p><p className="text-[10px] text-primary-400">Ср. пик</p></div>}
                {duration && <div><p className="text-lg font-black text-primary-700">{duration}</p><p className="text-[10px] text-primary-400">мин</p></div>}
                {errors.length > 0 && <div><p className="text-lg font-black text-rose-500">{errors.length}</p><p className="text-[10px] text-rose-400">Ошибок</p></div>}
              </div>
              {task.started_at && <p className="text-[10px] text-primary-400">
                Начало: {new Date(task.started_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}
                {task.completed_at && ` · Конец: ${new Date(task.completed_at).toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`}
              </p>}
            </div>
          );
        })()}

        {/* Tabs */}
        <div className="flex gap-1 mx-4 mt-3 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
          <button
            onClick={() => setTab('scans')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === 'scans' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}
          >
            Хронология{scans.length > 0 ? ` (${scans.length})` : ''}
          </button>
          <button
            onClick={() => setTab('errors')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === 'errors'
                ? errors.length > 0 ? 'bg-rose-500 text-white shadow-sm' : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : errors.length > 0 ? 'text-rose-400' : 'text-gray-400'
            }`}
          >
            Ошибки{errors.length > 0 ? ` (${errors.length})` : ''}
          </button>
          {isPackaging && (
            <button
              onClick={() => setTab('boxes')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === 'boxes' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-400'}`}
            >
              Коробки{boxes?.length > 0 ? ` (${boxes.length})` : ''}
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {tab === 'boxes' ? (
            boxesLoading ? (
              <div className="flex items-center justify-center h-32"><Spinner size="lg" /></div>
            ) : !boxes?.length ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-300">
                <Box size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Коробок нет</p>
              </div>
            ) : (
              <div className="space-y-2">
                {boxes.map((box, i) => {
                  const isFbo = !box.is_remainder && box.pallet_name;
                  const isFbs = box.is_remainder && box.shelf_code;
                  return (
                    <div key={box.id} className={`rounded-xl border px-3 py-3 ${
                      box.is_remainder
                        ? 'bg-amber-50 border-amber-200'
                        : 'bg-green-50 border-green-200'
                    }`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 font-mono">#{i + 1}</span>
                          <Box size={14} className={box.is_remainder ? 'text-amber-500' : 'text-green-600'} />
                          <span className="text-sm font-semibold text-gray-800">
                            {qty(box.quantity)} шт.
                            {box.box_size ? <span className="font-normal text-gray-400"> / {box.box_size}</span> : ''}
                          </span>
                          {box.is_remainder && (
                            <span className="text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-md font-medium">остаток</span>
                          )}
                        </div>
                        <CopyBadge value={box.barcode_value} />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <MapPin size={12} className="flex-shrink-0" />
                        {isFbo && (
                          <span>
                            <span className="font-medium text-green-700">
                              Паллет {box.row_name ? `Р${box.row_number}` : ''}П{box.pallet_number}
                            </span>
                            {box.fbo_warehouse_name && <span className="text-gray-400"> · {box.fbo_warehouse_name}</span>}
                          </span>
                        )}
                        {isFbs && (
                          <span>
                            <span className="font-medium text-amber-700">Полка {box.shelf_code}</span>
                            {box.rack_name && <span className="text-gray-400"> · {box.rack_name}</span>}
                            {box.fbs_warehouse_name && <span className="text-gray-400"> · {box.fbs_warehouse_name}</span>}
                          </span>
                        )}
                        {!isFbo && !isFbs && (
                          <span className="text-gray-300 italic">—</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : loading ? (
            <div className="flex items-center justify-center h-32"><Spinner size="lg" /></div>
          ) : tab === 'scans' ? (
            scans.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-300">
                <ScanLine size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Сканирований нет</p>
              </div>
            ) : (
              <div>
                {/* Toggle: All / By boxes */}
                {hasBoxes && (
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => setGroupByBox(false)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${!groupByBox ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    >
                      Все ({scans.length})
                    </button>
                    <button
                      onClick={() => setGroupByBox(true)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${groupByBox ? 'bg-primary-600 text-white shadow-sm' : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}
                    >
                      По коробкам ({taskBoxes.length})
                    </button>
                  </div>
                )}

                {groupByBox && hasBoxes ? (
                  /* Grouped by boxes view */
                  <div className="space-y-3">
                    {taskBoxes.map((box, bi) => {
                      const boxScans = scans.filter(sc => Number(sc.task_box_id) === Number(box.id));
                      const statusColor = box.status === 'completed' ? 'border-green-200 bg-green-50' : box.status === 'in_progress' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
                      const statusLabel = box.status === 'completed' ? 'Готово' : box.status === 'in_progress' ? 'В работе' : 'Ожидает';
                      const statusBadge = box.status === 'completed' ? 'success' : box.status === 'in_progress' ? 'warning' : 'default';
                      const isOpen = openBoxIds.has(box.id);
                      const boxGaps = boxScans.slice(1).map(s => Number(s.seconds_since_prev)).filter(s => !isNaN(s) && s > 0);
                      const boxAvgPick = boxGaps.length > 0 ? (boxGaps.reduce((a, b) => a + b, 0) / boxGaps.length).toFixed(1) : null;
                      return (
                        <div key={box.id} className={`rounded-2xl border ${statusColor} overflow-hidden`}>
                          {/* Box header — clickable */}
                          <button
                            onClick={() => toggleBox(box.id)}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:opacity-80 transition-opacity"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <svg className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                              <Box size={14} className="text-gray-500 flex-shrink-0" />
                              <span className="text-sm font-semibold text-gray-800 truncate">
                                {box.box_name || box.box_barcode || `Коробка ${bi + 1}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {boxAvgPick && <span className="text-[10px] text-primary-500 font-semibold">{boxAvgPick}с/шт</span>}
                              <span className="text-xs text-gray-400">{boxScans.length}</span>
                              <Badge variant={statusBadge}>{statusLabel}</Badge>
                            </div>
                          </button>
                          {/* Box scans — collapsible */}
                          {isOpen && (
                            boxScans.length === 0 ? (
                              <div className="px-3 py-3 text-center text-xs text-gray-300 border-t border-inherit">Нет сканирований</div>
                            ) : (
                              <div className="divide-y divide-gray-100/50 border-t border-inherit">
                                {boxScans.map((sc, i) => (
                                  <div key={sc.id} className="flex items-center gap-2.5 px-3 py-2">
                                    <span className="text-xs font-mono text-gray-300 w-5 text-right flex-shrink-0">{i + 1}</span>
                                    <div className="flex-1 min-w-0">
                                      {sc.product_name ? (
                                        <>
                                          <p className="text-sm font-medium text-gray-900 leading-tight truncate">{sc.product_name}</p>
                                          {sc.product_code && <p className="text-xs text-gray-400">{sc.product_code}</p>}
                                        </>
                                      ) : (
                                        <p className="text-sm text-rose-400 italic">Неизвестный товар</p>
                                      )}
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <p className="text-xs font-mono text-gray-700">{fmtTime(sc.created_at)}</p>
                                      {sc.seconds_since_prev != null ? (
                                        <p className="text-xs text-gray-300">+{sc.seconds_since_prev}с</p>
                                      ) : (
                                        <p className="text-xs text-primary-400">старт</p>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}
                    {/* Scans without a box */}
                    {(() => {
                      const orphanScans = scans.filter(sc => !sc.task_box_id);
                      if (orphanScans.length === 0) return null;
                      return (
                        <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                            <span className="text-sm font-semibold text-gray-500">Без коробки</span>
                            <span className="text-xs text-gray-400">{orphanScans.length} сканов</span>
                          </div>
                          <div className="divide-y divide-gray-50">
                            {orphanScans.map((sc, i) => (
                              <div key={sc.id} className="flex items-center gap-2.5 px-3 py-2">
                                <span className="text-xs font-mono text-gray-300 w-5 text-right flex-shrink-0">{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-900 leading-tight truncate">{sc.product_name || 'Неизвестный товар'}</p>
                                </div>
                                <p className="text-xs font-mono text-gray-700 flex-shrink-0">{fmtTime(sc.created_at)}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  /* Flat chronology view */
                  <div className="space-y-0 -mx-1">
                    {scans.map((sc, i) => (
                      <div key={sc.id} className="flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                        {/* Index + connector */}
                        <div className="flex flex-col items-center flex-shrink-0 w-6">
                          <span className="text-xs font-mono text-gray-300 leading-none">{i + 1}</span>
                          {i < scans.length - 1 && <div className="w-px h-4 bg-gray-100 mt-0.5" />}
                        </div>

                        {/* Product info */}
                        <div className="flex-1 min-w-0">
                          {sc.product_name ? (
                            <>
                              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">{sc.product_name}</p>
                              {sc.product_code && <p className="text-xs text-gray-400">{sc.product_code}</p>}
                            </>
                          ) : (
                            <p className="text-sm text-rose-400 italic">Неизвестный товар</p>
                          )}
                          <CopyBadge value={sc.scanned_value} className="mt-0.5" />
                        </div>

                        {/* Timestamp + gap */}
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-mono text-gray-700 dark:text-gray-300">{fmtTime(sc.created_at)}</p>
                          {sc.seconds_since_prev !== null && sc.seconds_since_prev !== undefined ? (
                            <p className="text-xs text-gray-300">+{sc.seconds_since_prev}с</p>
                          ) : (
                            <p className="text-xs text-primary-400">старт</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          ) : (
            errors.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-300">
                <AlertTriangle size={32} className="mb-2 opacity-40" />
                <p className="text-sm">Ошибок нет</p>
              </div>
            ) : (
              <div className="space-y-2">
                {errors.map(err => (
                  <div key={err.id} className="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-mono font-medium text-rose-700">{err.scanned_value}</p>
                        <CopyBadge value={err.scanned_value} />
                      </div>
                      <p className="text-xs text-gray-400">{fmtTime(err.created_at)}</p>
                    </div>
                    {err.employee_note && (
                      <p className="text-xs text-gray-600 bg-white rounded-lg px-2.5 py-1.5 mt-1">{err.employee_note}</p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Assembly detail modal */}
        {showAssemblyModal && assemblyData && (() => {
          const phase = assemblyData.assembly_phase || 'picking';
          const phases = ['picking', 'assembling', 'placing', 'completed'];
          const phaseIdx = phases.indexOf(phase);
          const phaseNames = { picking: 'Забор', assembling: 'Сборка', placing: 'Размещение', completed: 'Завершено' };
          const phaseColors = { picking: 'primary', assembling: 'purple', placing: 'blue', completed: 'green' };
          const totalPicked = (assemblyData.picked_summary || []).reduce((s, p) => s + Number(p.picked_count), 0);
          const totalNeeded = (assemblyData.components || []).reduce((s, c) => s + Number(c.quantity) * assemblyData.bundle_qty, 0);

          return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowAssemblyModal(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 bg-white rounded-t-2xl border-b border-gray-100 px-5 py-4 flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-gray-900">{assemblyData.bundle_name}</h3>
                  <p className="text-xs text-gray-400 mt-0.5">{assemblyData.bundle_qty} комплектов · {assemblyData.employee_name || 'Не назначен'}</p>
                </div>
                <button onClick={() => setShowAssemblyModal(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X size={18} /></button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Phase stepper */}
                <div className="flex items-center gap-1">
                  {['picking', 'assembling', 'placing'].map((p, i) => {
                    const done = phaseIdx > i || phase === 'completed';
                    const active = phase === p;
                    return (
                      <div key={p} className="flex items-center gap-1 flex-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          done ? 'bg-green-500 text-white' : active ? `bg-${phaseColors[p]}-600 text-white` : 'bg-gray-200 text-gray-400'
                        }`}>{done ? '✓' : i + 1}</div>
                        <span className={`text-[11px] font-medium ${active ? `text-${phaseColors[p]}-600` : done ? 'text-green-600' : 'text-gray-400'}`}>
                          {phaseNames[p]}
                        </span>
                        {i < 2 && <ChevronRight size={10} className="text-gray-300 ml-auto" />}
                      </div>
                    );
                  })}
                </div>

                {/* Stats cards */}
                <div className="grid grid-cols-4 gap-2">
                  <div className="bg-primary-50 rounded-xl p-2.5 text-center">
                    <p className="text-lg font-black text-primary-700">{totalPicked}</p>
                    <p className="text-[10px] text-primary-400">Забрано</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-2.5 text-center">
                    <p className="text-lg font-black text-gray-600">{totalNeeded}</p>
                    <p className="text-[10px] text-gray-400">Нужно</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-2.5 text-center">
                    <p className="text-lg font-black text-green-700">{assemblyData.assembled_count || 0}<span className="text-xs font-normal text-green-400">/{assemblyData.bundle_qty}</span></p>
                    <p className="text-[10px] text-green-400">Собрано</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-2.5 text-center">
                    <p className="text-lg font-black text-blue-700">{assemblyData.placed_count || 0}<span className="text-xs font-normal text-blue-400">/{assemblyData.bundle_qty}</span></p>
                    <p className="text-[10px] text-blue-400">Размещено</p>
                  </div>
                </div>

                {/* Components with progress bars */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Состав комплекта</p>
                  <div className="space-y-2">
                    {(assemblyData.components || []).map(c => {
                      const picked = (assemblyData.picked_summary || []).find(p => p.product_id === c.component_id);
                      const needed = Number(c.quantity) * assemblyData.bundle_qty;
                      const have = Number(picked?.picked_count || 0);
                      const pct = Math.min(100, (have / Math.max(1, needed)) * 100);
                      return (
                        <div key={c.component_id} className="p-2.5 bg-gray-50 rounded-xl">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-gray-800 truncate flex-1">{c.name?.replace(/GraFLab,?\s*/i, '').trim()}</p>
                            <span className={`text-xs font-bold ml-2 ${have >= needed ? 'text-green-600' : 'text-amber-600'}`}>
                              {have >= needed ? '✓' : ''} {have}/{needed}
                            </span>
                          </div>
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${have >= needed ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] text-gray-400 font-mono">{c.code} · × {Number(c.quantity)}</span>
                            {(() => { const sbc = c.production_barcode || (() => { const allBc = (c.barcode_list||'').split(';').map(s=>s.trim()).filter(Boolean); const mbj = Array.isArray(c.marketplace_barcodes_json) ? c.marketplace_barcodes_json : []; const mpValues = new Set(mbj.map(m => m.value)); const isMP = b => mpValues.has(b) || /^(OZN|MRKT|SBER)/i.test(b); return allBc.find(b => !isMP(b)) || allBc[0]; })(); return sbc ? <CopyBadge value={sbc} /> : null; })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Source locations */}
                {assemblySourceBoxes.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Источники ({assemblySourceBoxes.length})</p>
                    <div className="max-h-40 overflow-y-auto space-y-1">
                      {assemblySourceBoxes.map((b, i) => (
                        <div key={i} className="px-3 py-2 bg-gray-50 rounded-lg text-xs">
                          <div className="flex items-center gap-2">
                            <MapPin size={12} className="text-primary-400 flex-shrink-0" />
                            <span className="font-medium text-gray-700 flex-1">
                              {b.source_type === 'shelf' ? `${b.warehouse_name} → ${b.rack_name} → ${b.shelf_code}` : `${b.warehouse_name} → ${b.row_name} → ${b.pallet_name}`}
                            </span>
                            <span className="text-amber-600 font-bold">{Number(b.quantity)} шт</span>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1 pl-5">
                            {b.pallet_barcode && <CopyBadge value={b.pallet_barcode} label={`Паллет: ${b.pallet_barcode}`} />}
                            {b.box_barcode && <CopyBadge value={b.box_barcode} label={`Коробка: ${b.box_barcode}`} />}
                            {b.shelf_barcode && <CopyBadge value={b.shelf_barcode} label={`Полка: ${b.shelf_barcode}`} />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bundle barcodes */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1">ШК комплекта</p>
                  <div className="flex flex-wrap gap-1">
                    {(assemblyData.bundle_barcodes || '').split(';').filter(Boolean).map(bc => {
                      const isSystem = /^[124]0{5,}\d+$/.test(bc.trim());
                      return <CopyBadge key={bc} value={bc.trim()} className={isSystem ? '!bg-green-100 !text-green-700 font-bold !border-green-200' : ''} />;
                    })}
                  </div>
                </div>

                {/* Scan chronology */}
                {scans.length > 0 && (() => {
                  const gaps = scans.filter(s => s.seconds_since_prev != null && s.seconds_since_prev > 0).map(s => Number(s.seconds_since_prev));
                  const avgGap = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : null;
                  return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-gray-500 uppercase">Хронология сканов ({scans.length})</p>
                      {avgGap && <span className="text-xs font-bold text-primary-600">Ср. {avgGap}с между сканами</span>}
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {scans.map((sc, i) => (
                        <div key={sc.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-xs">
                          <span className="text-gray-300 font-mono w-5 text-right flex-shrink-0">{i + 1}</span>
                          <span className="flex-1 truncate text-gray-700">{(sc.product_name || '').replace(/GraFLab,?\s*/i, '').trim()}</span>
                          <span className="font-mono text-gray-500 flex-shrink-0">{new Date(sc.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                          {sc.seconds_since_prev != null && sc.seconds_since_prev > 0
                            ? <span className={`font-mono font-bold flex-shrink-0 w-10 text-right ${Number(sc.seconds_since_prev) > 10 ? 'text-rose-400' : Number(sc.seconds_since_prev) > 5 ? 'text-amber-400' : 'text-green-500'}`}>+{sc.seconds_since_prev}с</span>
                            : <span className="text-primary-400 font-mono flex-shrink-0 w-10 text-right">старт</span>
                          }
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })()}

                {/* Timing */}
                <div className="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-100">
                  {assemblyData.started_at && <span>Начало: {new Date(assemblyData.started_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                  {assemblyData.completed_at && <span>Завершено: {new Date(assemblyData.completed_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                  {assemblyData.started_at && assemblyData.completed_at && (() => {
                    const mins = ((new Date(assemblyData.completed_at) - new Date(assemblyData.started_at)) / 60000).toFixed(1);
                    return <span className="font-bold text-gray-600">Итого: {mins} мин</span>;
                  })()}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Footer actions */}
        {(task.status === 'new' || task.status === 'in_progress' || task.status === 'paused') && (
          <div className="flex gap-2 px-4 py-4 border-t border-gray-100 dark:border-gray-800">
            <Button variant="primary" size="sm" icon={<ExternalLink size={14} />} onClick={() => {
              const path = task.task_type === 'packaging' ? `/employee/packaging/${task.id}`
                : task.task_type === 'bundle_assembly' ? `/employee/assembly/${task.id}`
                : task.task_type === 'returns' ? '/employee/returns'
                : `/employee/tasks/${task.id}`;
              navigate(path);
            }}>Перейти</Button>
            {(task.status === 'in_progress' || task.status === 'new') && (
              <Button variant="outline" size="sm" icon={<Pause size={14} />} onClick={handlePause}>Пауза</Button>
            )}
            {task.status === 'paused' && (
              <Button variant="primary" size="sm" icon={<Play size={14} />} onClick={handlePause}>Возобновить</Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCancel}>Отменить</Button>
            <Button variant="danger" size="sm" onClick={handleDeleteClick}>Удалить</Button>
          </div>
        )}
        {(task.status === 'completed' || task.status === 'cancelled') && (
          <div className="flex gap-2 px-4 py-4 border-t border-gray-100 dark:border-gray-800">
            <Button variant="outline" size="sm" icon={<Copy size={14} />} onClick={handleDuplicate}>Дублировать</Button>
            <Button variant="danger" size="sm" onClick={handleDeleteClick}>Удалить</Button>
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirm(null)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden">
            {deleteConfirm === 'ask' ? (
              <>
                <div className="px-6 pt-6 pb-2 text-center">
                  <div className="w-12 h-12 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-3">
                    <AlertTriangle className="w-6 h-6 text-rose-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Удалить задачу?</h3>
                  <p className="text-sm text-gray-500 mt-1">{task.title}</p>
                </div>
                <div className="px-6 py-4 flex flex-col gap-2">
                  <Button variant="danger" size="md" className="w-full" onClick={() => setDeleteConfirm('refund')}>
                    Удалить
                  </Button>
                  <Button variant="ghost" size="md" className="w-full" onClick={() => setDeleteConfirm(null)}>
                    Отмена
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="px-6 pt-6 pb-2 text-center">
                  <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
                    <GRACoinIcon size={24} className="text-amber-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">Начисленная оплата</h3>
                  <p className="text-sm text-gray-500 mt-2">Списать оплату, начисленную за эту задачу, с баланса сотрудника?</p>
                </div>
                <div className="px-6 py-4 flex flex-col gap-2">
                  <Button variant="danger" size="md" className="w-full" onClick={() => handleDeleteExecute(true)}>
                    Списать оплату и удалить
                  </Button>
                  <Button variant="outline" size="md" className="w-full" onClick={() => handleDeleteExecute(false)}>
                    Оставить оплату, удалить задачу
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full" onClick={() => setDeleteConfirm(null)}>
                    Отмена
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
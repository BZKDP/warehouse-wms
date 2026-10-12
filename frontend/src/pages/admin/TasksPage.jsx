import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, Video, RefreshCw } from 'lucide-react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import TaskDetailPanel from './tasks/TaskDetailPanel';
import CreateTaskModal from './tasks/CreateTaskModal';
import TaskCard from './tasks/TaskCard';
import { useSocket } from '../../hooks/useSocket';

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function TasksPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [pageSize] = useState(50);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);


  // URL-backed state
  const selectedTaskId = searchParams.get('id');
  const filterEmployee = searchParams.get('employee') || '';
  const filterStatus = searchParams.get('status') || '';

  const selectedTask = useMemo(
    () => (selectedTaskId ? items.find(t => String(t.id) === selectedTaskId) || null : null),
    [selectedTaskId, items]
  );

  const setSelectedTask = useCallback((task) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (task) { next.set('id', String(task.id)); } else { next.delete('id'); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilterEmployee = useCallback((val) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) { next.set('employee', val); } else { next.delete('employee'); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setFilterStatus = useCallback((val) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (val) { next.set('status', val); } else { next.delete('status'); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Inline filters (client-side, some URL-backed)
  const [searchText, setSearchText] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const filterType = searchParams.get('type') || '';
  const filterPeriod = searchParams.get('period') || 'all';

  const setFilterType = useCallback((val) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (val) next.set('type', val); else next.delete('type'); return next; }, { replace: true });
  }, [setSearchParams]);
  const [sortBy, setSortBy] = useState('date'); // 'date' | 'scans' | 'status'

  const setFilterPeriod = useCallback((val) => {
    setSearchParams(prev => { const next = new URLSearchParams(prev); if (val && val !== 'all') next.set('period', val); else next.delete('period'); return next; }, { replace: true });
  }, [setSearchParams]);

  const loadRef = useRef(0);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/tasks', { params: { limit: pageSize } });
      setItems(res.data.items);
      setTotalCount(Number(res.data.total || res.data.items.length));
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    const page = Math.floor(items.length / pageSize) + 1;
    try {
      const res = await api.get('/tasks', { params: { limit: pageSize, page } });
      setItems(prev => [...prev, ...res.data.items]);
    } catch (err) {
      console.error(err);
    }
  }, [items.length, pageSize]);

  useEffect(() => { load(); }, [load]);

  // WebSocket: auto-refresh on task events
  useSocket('task:completed', () => load());
  useSocket('task:scan', () => {}); // future: live scan counter

  // Auto-refresh when tasks are in progress
  const pollRef = useRef(null);
  useEffect(() => {
    clearInterval(pollRef.current);
    if (items.some(t => t.status === 'in_progress')) {
      pollRef.current = setInterval(load, 30000);
    }
    return () => clearInterval(pollRef.current);
  }, [items, load]);

  // Derive unique employees, statuses, locations for dropdown options
  const uniqueEmployees = [...new Set(items.map(t => t.employee_name).filter(Boolean))].sort();
  const uniqueLocations = [...new Set(items.flatMap(t => [t.rack_name, t.pallet_row_name].filter(Boolean)))].sort();

  // Client-side filtering
  const filtered = items.filter(task => {
    if (searchText) {
      const q = searchText.toLowerCase();
      const haystack = [task.title, task.employee_name, task.shelf_code, task.rack_name, task.pallet_name, task.box_barcode].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filterEmployee && task.employee_name !== filterEmployee) return false;
    if (filterStatus && task.status !== filterStatus) return false;
    if (filterLocation) {
      const loc = task.rack_name || task.pallet_row_name || '';
      if (loc !== filterLocation) return false;
    }
    if (filterType && task.task_type !== filterType) return false;
    if (filterPeriod !== 'all') {
      const taskDate = new Date(task.created_at).toDateString();
      const now = new Date();
      if (filterPeriod === 'today' && taskDate !== now.toDateString()) return false;
      if (filterPeriod === 'yesterday') {
        const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
        if (taskDate !== yesterday.toDateString()) return false;
      }
    }
    return true;
  }).sort((a, b) => {
    if (sortBy === 'scans') return (Number(b.scans_count) || 0) - (Number(a.scans_count) || 0);
    if (sortBy === 'status') {
      const order = { in_progress: 0, new: 1, paused: 2, completed: 3, cancelled: 4 };
      return (order[a.status] ?? 5) - (order[b.status] ?? 5);
    }
    return new Date(b.created_at) - new Date(a.created_at); // default: newest first
  });

  const searchRef = useRef(null);
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });

  const bulkDelete = async () => {
    if (!selectedIds.size || !confirm(`Удалить ${selectedIds.size} задач?`)) return;
    for (const id of selectedIds) {
      try { await api.delete(`/tasks/${id}`, { params: { refund: '0' } }); } catch {}
    }
    setSelectedIds(new Set());
    setBulkMode(false);
    load();
  };



  const hasActiveFilters = searchText || filterEmployee || filterStatus || filterLocation || filterType || filterPeriod !== 'all';

  // Keyboard shortcut: "/" to focus search
  useEffect(() => {
    const handler = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  const resetFilters = () => { setSearchText(''); setFilterEmployee(''); setFilterStatus(''); setFilterLocation(''); setFilterType(''); setFilterPeriod('all'); };


  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Задачи</h1>
          <p className="text-gray-500 text-sm mt-1">
            {filtered.length !== items.length ? `${filtered.length} из ${items.length}` : `${items.length} задач`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
            title="Массовые действия"
            className={`hidden sm:flex p-2 rounded-xl transition-all ${bulkMode ? 'text-rose-500 bg-rose-500/10 border border-rose-500/25 shadow-[0_2px_10px_rgba(244,63,94,0.12)]' : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70'}`}
          >
            <ClipboardList size={16} />
          </button>
          <button
            onClick={() => { setRefreshing(true); load().finally(() => setTimeout(() => setRefreshing(false), 500)); }}
            title={lastUpdate ? `Обновлено ${lastUpdate.toLocaleTimeString('ru-RU')}` : 'Обновить'}
            className="p-2 rounded-xl text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70 hover:text-primary-600 transition-all"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/admin/live-monitor')}
            title="Live-мониторинг"
            className="p-2 rounded-xl text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70 hover:text-primary-600 transition-all"
          >
            <Video size={18} />
          </button>
          <Button icon={<Plus size={15} />} size="sm" onClick={() => setShowCreate(true)}>
            Создать задачу
          </Button>
        </div>
      </div>

      {/* Filters — full width single row */}
      <div className="flex flex-wrap items-center gap-2 mb-3 w-full">
        {/* Period pills */}
        {[['all', 'Все'], ['today', 'Сегодня'], ['yesterday', 'Вчера']].map(([k, l]) => (
          <button key={k} onClick={() => setFilterPeriod(k)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              filterPeriod === k ? 'text-primary-700 bg-primary-600/10 border border-primary-600/25 shadow-[0_2px_10px_rgba(124,58,237,0.12)]' : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70'
            }`}>{l}</button>
        ))}
        <span className="w-px h-5 bg-gray-200" />
        {/* Sort pills */}
        {[['date', '↓ Дата'], ['status', '↓ Статус'], ['scans', '↓ Сканы']].map(([k, l]) => (
          <button key={k} onClick={() => setSortBy(k)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              sortBy === k ? 'text-primary-700 bg-primary-600/10 border border-primary-600/25 shadow-[0_2px_10px_rgba(124,58,237,0.12)]' : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70'
            }`}>{l}</button>
        ))}
        <span className="w-px h-5 bg-gray-200" />
        {/* Search */}
        <input
          ref={searchRef}
          type="text"
          placeholder="Поиск..."
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          className="px-3 py-1 text-xs rounded-lg border border-gray-200 bg-white/50 focus:outline-none focus:border-primary-400 focus:bg-white/70 w-36 sm:w-48 transition-all"
        />
        <select
          value={filterEmployee}
          onChange={e => setFilterEmployee(e.target.value)}
          className="px-2 py-1 text-xs rounded-lg border border-gray-200 bg-white/50 focus:outline-none focus:border-primary-400 focus:bg-white/70 text-gray-600 transition-all"
        >
          <option value="">Все сотрудники</option>
          {uniqueEmployees.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="px-2 py-1 text-xs rounded-lg border border-gray-200 bg-white/50 focus:outline-none focus:border-primary-400 focus:bg-white/70 text-gray-600 transition-all"
        >
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="in_progress">В работе</option>
          <option value="paused">На паузе</option>
          <option value="completed">Выполненные</option>
          <option value="cancelled">Отменённые</option>
        </select>
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-2 py-1 text-xs rounded-lg border border-gray-200 bg-white/50 focus:outline-none focus:border-primary-400 focus:bg-white/70 text-gray-600 transition-all"
        >
          <option value="">Все типы</option>
          <option value="inventory">Инвентаризация</option>
          <option value="packaging">Оприходование</option>
          <option value="production_transfer">Перенос</option>
          <option value="bundle_assembly">Сборка</option>
          <option value="returns">Возвраты</option>
        </select>
      </div>

      {/* Bulk actions bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-2xl">
          <input
            type="checkbox"
            checked={selectedIds.size === filtered.length && filtered.length > 0}
            onChange={() => {
              if (selectedIds.size === filtered.length) setSelectedIds(new Set());
              else setSelectedIds(new Set(filtered.map(t => t.id)));
            }}
            className="w-4 h-4 rounded border-gray-300 text-rose-500"
          />
          <span className="text-sm font-semibold text-rose-700">{selectedIds.size > 0 ? `Выбрано: ${selectedIds.size}` : 'Выберите задачи'}</span>
          {selectedIds.size > 0 && (
            <button onClick={bulkDelete} className="px-3 py-1 rounded-xl text-white bg-gradient-to-br from-rose-400 to-rose-600 border border-rose-600/30 shadow-[0_2px_12px_rgba(244,63,94,0.2)] text-xs font-bold hover:from-rose-500 hover:to-rose-700 transition-all">Удалить</button>
          )}
          <button onClick={() => { setSelectedIds(new Set()); setBulkMode(false); }} className="px-3 py-1 rounded-xl text-xs text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70 transition-all">Выйти</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400">
          <ClipboardList size={40} className="mb-2 opacity-30" />
          <p className="text-sm">{items.length === 0 ? 'Нет задач' : 'Ничего не найдено по фильтрам'}</p>
          {hasActiveFilters && (
            <button onClick={resetFilters} className="mt-2 text-sm text-primary-600 bg-white/50 border border-gray-200 hover:bg-white/70 px-3 py-1 rounded-lg font-medium transition-all">Сбросить фильтры</button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(task => (
            <div key={task.id} className="flex items-start gap-2">
              {bulkMode && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(task.id)}
                  onChange={() => toggleSelect(task.id)}
                  className="mt-5 w-4 h-4 rounded border-gray-300 text-primary-600 flex-shrink-0"
                />
              )}
              <div className="flex-1">
                <TaskCard task={task} onClick={bulkMode ? () => toggleSelect(task.id) : setSelectedTask} />
              </div>
            </div>
          ))}
          {items.length < totalCount && (
            <button
              onClick={loadMore}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-gray-200 text-gray-500 bg-white/50 text-sm font-medium hover:bg-white/70 hover:border-primary-300 hover:text-primary-600 transition-all mt-2"
            >
              Загрузить ещё ({items.length} из {totalCount})
            </button>
          )}
        </div>
      )}

      <CreateTaskModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={load}
      />

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onReload={load}
        />
      )}
    </div>
  );
}

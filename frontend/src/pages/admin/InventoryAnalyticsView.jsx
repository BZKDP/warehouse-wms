import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Clock, ChevronRight, ChevronDown, Search, Package, ArrowLeft } from 'lucide-react';
import { WarehouseIcon, RackIcon, ShelfIcon, PalletIcon, RowIcon, BoxIcon, ShelfBoxIcon } from '../../components/ui/WarehouseIcons';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import { useAppSettings } from '../../context/AppSettingsContext';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(seconds) {
  if (!seconds) return '—';
  const s = Math.round(Number(seconds));
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  if (m === 0) return `${remainder}с`;
  return `${m}м ${remainder}с`;
}

function timeAgo(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function hexToBgBorder(hex) {
  return { bg: hex + '18', border: hex + '60', text: hex };
}

function statusColor(node, settings = {}) {
  const freshH = settings.inventory_fresh_hours || 24;
  const staleH = settings.inventory_stale_hours || 72;
  const cFresh = settings.inventory_color_fresh || '#047857';
  const cWarn = settings.inventory_color_warn || '#a16207';
  const cStale = settings.inventory_color_stale || '#b91c1c';
  const cNone = settings.inventory_color_none || '#b91c1c';

  if (!node.last_inventory_at) return { ...hexToBgBorder(cNone), label: 'Не было' };
  const hours = (Date.now() - new Date(node.last_inventory_at).getTime()) / 3600000;
  if (hours < freshH) return { ...hexToBgBorder(cFresh), label: 'Свежий' };
  if (hours < staleH) return { ...hexToBgBorder(cWarn), label: 'Давно' };
  return { ...hexToBgBorder(cStale), label: 'Устарел' };
}

function fmtQty(val) {
  return Number(val || 0).toLocaleString('ru-RU');
}

// ═══ Stat Box ═══
function StatBox({ label, value, accent }) {
  const colors = accent === 'green' ? 'text-green-600' : accent === 'red' ? 'text-rose-600' : accent === 'amber' ? 'text-amber-600' : 'text-gray-900 dark:text-white';
  return (
    <div className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-[14px] p-3">
      <p className="text-[11px] text-gray-400 uppercase font-semibold">{label}</p>
      <p className={`text-lg font-black ${colors}`}>{value}</p>
    </div>
  );
}

// ═══ Inventory Card (row in list) ═══
function InventoryCard({ node, type, onDrill, settings }) {
  const st = statusColor(node, settings);
  const hasInventory = !!node.last_inventory_at;
  const delta = Number(node.delta_vs_current || 0);
  const invQty = Number(node.last_inventory_qty || 0);
  const dur = Number(node.last_inventory_duration_seconds || 0);
  const avgPick = invQty > 0 && dur > 0 ? (dur / invQty).toFixed(1) : null;

  return (
    <div
      className="rounded-2xl border p-4 cursor-pointer hover:shadow-lg transition-all group"
      style={{ borderColor: st.border, background: 'white' }}
      onClick={() => onDrill?.(node)}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: st.bg }}>
          {type === 'warehouse' ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg> :
           type === 'rack' ? <RackIcon size={24} /> :
           type === 'shelf' ? <ShelfIcon size={24} /> :
           type === 'pallet' ? <PalletIcon size={24} /> :
           type === 'row' ? <RowIcon size={24} /> :
           type === 'pallet_box' ? <BoxIcon size={24} /> :
           type === 'shelf_box' ? <BoxIcon size={24} /> :
           <ShelfIcon size={24} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-900 dark:text-white truncate">{node.label || node.name || node.code || '—'}</span>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg" style={{ background: st.bg, color: st.text }}>
              {st.label}
            </span>
            {node.coverage_complete === false && node.total_leaf_count > 0 && (
              <span className="text-[10px] text-gray-400">{node.covered_leaf_count}/{node.total_leaf_count}</span>
            )}
          </div>
          {hasInventory ? (
            <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-gray-400">По инвенту</span>
                <p className="font-bold text-gray-900 dark:text-white">{fmtQty(invQty)} шт.</p>
              </div>
              <div>
                <span className="text-gray-400">Сейчас</span>
                <p className="font-bold text-gray-900 dark:text-white">{fmtQty(node.current_qty)} шт.</p>
              </div>
              <div>
                <span className="text-gray-400">Разница</span>
                <p className={`font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                  {delta > 0 ? '+' : ''}{delta}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-1">Инвентаризация не проводилась</p>
          )}
          {hasInventory && (
            <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
              <span className="flex items-center gap-1"><Clock size={10} /> {timeAgo(node.last_inventory_at)}</span>
              {dur > 0 && <span>{fmtDuration(dur)}</span>}
              {avgPick && <span className="text-primary-500 font-semibold">{avgPick}с/шт</span>}
              {node.last_inventory_by && <span>{node.last_inventory_by}</span>}
            </div>
          )}
        </div>
        {onDrill && <ChevronRight size={16} className="text-gray-300 group-hover:text-primary-400 flex-shrink-0 mt-2" />}
      </div>
    </div>
  );
}

// ═══ Children list for drill-down ═══
function getChildren(node) {
  if (node.racks?.length) return { items: node.racks.map(r => ({ ...r, _type: 'rack' })), label: 'Стеллажи' };
  if (node.rows?.length) return { items: node.rows.map(r => ({ ...r, _type: 'row' })), label: 'Ряды' };
  if (node.shelves?.length) return { items: node.shelves.map(s => ({ ...s, _type: 'shelf' })), label: 'Полки' };
  if (node.pallets?.length) return { items: node.pallets.map(p => ({ ...p, _type: 'pallet' })), label: 'Паллеты' };
  if (node.boxes?.length) return { items: node.boxes.map(b => ({ ...b, _type: 'pallet_box' })), label: 'Коробки' };
  if (node.children?.length) return { items: node.children, label: 'Элементы' };
  return null;
}

function getChildType(child) {
  if (child._type) return child._type;
  if (child.kind === 'shelf_box') return 'shelf_box';
  if (child.kind === 'pallet_box') return 'pallet_box';
  if (child.racks) return 'warehouse';
  if (child.shelves) return 'rack';
  if (child.pallets) return 'row';
  if (child.boxes) return 'pallet';
  return 'shelf';
}

// ═══ Inventory Task Scans (expandable per task) ═══
// boxId: if provided, filter scans to only this box (pallet_box or shelf_box)
// boxType: 'pallet_box' | 'shelf_box' — determines which field to match
function TaskScansPanel({ taskId, boxId, boxType }) {
  const [scans, setScans] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tasks/${taskId}/analytics`)
      .then(r => {
        let allScans = r.data?.scans || [];
        // If we have a boxId, filter scans to only show those for this specific box
        if (boxId && allScans.length > 0) {
          const taskBoxes = r.data?.task_boxes || [];
          // Find the task_box entry that matches our box
          const matchField = boxType === 'shelf_box' ? 'shelf_box_id' : 'box_id';
          const taskBox = taskBoxes.find(tb => String(tb[matchField]) === String(boxId));
          if (taskBox) {
            allScans = allScans.filter(sc => String(sc.task_box_id) === String(taskBox.id));
            // Recompute seconds_since_prev for filtered scans
            allScans = allScans.map((sc, i) => ({
              ...sc,
              seconds_since_prev: i > 0
                ? ((new Date(sc.created_at).getTime() - new Date(allScans[i - 1].created_at).getTime()) / 1000).toFixed(1)
                : null,
            }));
          }
        }
        setScans(allScans);
      })
      .catch(() => setScans([]))
      .finally(() => setLoading(false));
  }, [taskId, boxId, boxType]);

  if (loading) return <div className="py-3 text-center"><Spinner size="sm" /></div>;
  if (!scans?.length) return <p className="py-3 text-center text-xs text-gray-300">Нет сканов</p>;

  // Compute avg seconds
  const gaps = scans.slice(1).map(s => Number(s.seconds_since_prev)).filter(s => !isNaN(s) && s > 0);
  const avgSec = gaps.length > 0 ? (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1) : null;

  return (
    <div>
      <div className="flex items-center gap-4 px-3 py-2 text-[11px] text-gray-400 border-b border-gray-100">
        <span>{scans.length} сканов</span>
        {avgSec && <span>Ср. время: {avgSec}с</span>}
        {gaps.length > 0 && <span>Мин: {Math.min(...gaps)}с / Макс: {Math.max(...gaps)}с</span>}
      </div>
      <div className="divide-y divide-gray-50 max-h-[400px] overflow-y-auto">
        {scans.map((sc, i) => (
          <div key={sc.id} className="flex items-center gap-2.5 px-3 py-1.5">
            <span className="text-[11px] font-mono text-gray-300 w-5 text-right flex-shrink-0">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{sc.product_name || 'Неизвестный'}</p>
              {sc.product_code && <p className="text-[10px] text-gray-400">{sc.product_code}</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] font-mono text-gray-600">{fmtTime(sc.created_at)}</p>
              {sc.seconds_since_prev != null ? (
                <p className={`text-[10px] ${Number(sc.seconds_since_prev) > 10 ? 'text-amber-500' : 'text-gray-300'}`}>+{sc.seconds_since_prev}с</p>
              ) : (
                <p className="text-[10px] text-primary-400">старт</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ═══ Inventory History List for a leaf node ═══
function InventoryHistorySection({ node }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState(null);

  const kind = node.kind || node._type;
  const locationType = kind === 'shelf_box' ? 'shelf_box' : kind === 'pallet_box' ? 'pallet_box' : kind;

  useEffect(() => {
    api.get('/tasks/analytics/inventory-history', { params: { location_type: locationType, id: node.id } })
      .then(r => setHistory(r.data?.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [node.id, locationType]);

  if (loading) return <div className="py-6 text-center"><Spinner size="sm" /></div>;
  if (!history?.length) return <p className="text-sm text-gray-400 italic py-4">Нет завершённых инвентаризаций</p>;

  return (
    <div className="space-y-3">
      {history.map((ev, i) => {
        const isExpanded = expandedTask === ev.task_id;
        const isLatest = i === 0;
        const counted = Number(ev.counted_qty || 0);
        const dur = Number(ev.duration_seconds || 0);
        const avgPick = counted > 0 && dur > 0 ? (dur / counted).toFixed(1) : null;
        const picksPerMin = counted > 0 && dur > 0 ? (counted / (dur / 60)).toFixed(1) : null;
        return (
          <div key={ev.task_id} className={`rounded-2xl border overflow-hidden ${isLatest ? 'border-primary-200 bg-primary-50/30' : 'border-gray-200 bg-white'}`}>
            <button
              onClick={() => setExpandedTask(isExpanded ? null : ev.task_id)}
              className="w-full text-left px-4 py-3 hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {ev.task_title || `Задача #${ev.task_id}`}
                      {isLatest && <span className="ml-2 text-[10px] text-primary-500 font-medium">последняя</span>}
                    </p>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400 mt-0.5">
                      <span>{fmtDate(ev.completed_at)}</span>
                      {ev.employee_name && <span>{ev.employee_name}</span>}
                      {dur > 0 && <span>{fmtDuration(dur)}</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-black text-gray-900">{counted}<span className="text-xs font-medium text-gray-400 ml-0.5">шт</span></p>
                  <div className="flex items-center gap-2 justify-end">
                    {avgPick && <span className="text-[10px] text-primary-500 font-semibold">{avgPick}с/шт</span>}
                    {picksPerMin && <span className="text-[10px] text-gray-400">{picksPerMin}/мин</span>}
                  </div>
                </div>
              </div>
            </button>
            {isExpanded && <TaskScansPanel taskId={ev.task_id} boxId={node.id} boxType={locationType} />}
          </div>
        );
      })}
    </div>
  );
}

// ═══ Detail Panel with drill-down ═══
function DetailPanel({ node, breadcrumbs, onDrill, onBack, settings }) {
  const st = statusColor(node, settings);
  const delta = Number(node.delta_vs_current || 0);
  const deltaPrev = Number(node.delta_vs_previous || 0);
  const hasInventory = !!node.last_inventory_at;
  const childrenData = getChildren(node);
  const isLeaf = !childrenData;

  return (
    <div>
      {/* Breadcrumbs */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        <button onClick={() => onBack(0)} className="text-sm text-primary-500 hover:text-primary-700 font-medium">Обзор</button>
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <ChevronRight size={12} className="text-gray-300" />
            <button
              onClick={() => onBack(i + 1)}
              className={`text-sm font-medium ${i === breadcrumbs.length - 1 ? 'text-gray-900 dark:text-white' : 'text-primary-500 hover:text-primary-700'}`}
            >
              {crumb.label || crumb.name || crumb.code || '—'}
            </button>
          </span>
        ))}
      </div>

      {/* Header card */}
      <div className="card p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: st.bg }}>
            {node._type === 'rack' ? <RackIcon size={28} /> :
             node._type === 'row' ? <RowIcon size={28} /> :
             node._type === 'shelf' ? <ShelfIcon size={28} /> :
             node._type === 'pallet' ? <PalletIcon size={28} /> :
             node._type === 'pallet_box' || node._type === 'shelf_box' ? <BoxIcon size={28} /> :
             <ShelfIcon size={28} />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{node.label || node.name || node.code || '—'}</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{ background: st.bg, color: st.text }}>{st.label}</span>
              {node.total_leaf_count > 1 && (
                <span className="text-xs text-gray-400">Покрытие: {node.covered_leaf_count}/{node.total_leaf_count}</span>
              )}
            </div>
          </div>
        </div>

        {hasInventory ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatBox label="По инвенту" value={fmtQty(node.last_inventory_qty)} />
              <StatBox label="Сейчас" value={fmtQty(node.current_qty)} />
              <StatBox
                label="Разница"
                value={`${delta > 0 ? '+' : ''}${delta}`}
                accent={delta > 0 ? 'green' : delta < 0 ? 'red' : null}
              />
              {node.previous_inventory_qty != null && (
                <StatBox
                  label="Пред. инвент"
                  value={fmtQty(node.previous_inventory_qty)}
                />
              )}
            </div>

            {node.previous_inventory_qty != null && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-4 text-xs">
                <span className="text-gray-400">Между инвентами:</span>
                <span className={`font-bold ${deltaPrev > 0 ? 'text-green-600' : deltaPrev < 0 ? 'text-rose-600' : 'text-gray-400'}`}>
                  {deltaPrev > 0 ? '+' : ''}{deltaPrev} шт.
                </span>
                {node.previous_inventory_at && (
                  <span className="text-gray-400">пред: {fmtDate(node.previous_inventory_at)}</span>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>Дата: {fmtDate(node.last_inventory_at)}</span>
              {node.last_inventory_by && <span>{node.last_inventory_by}</span>}
              {node.last_inventory_duration_seconds > 0 && <span>{fmtDuration(node.last_inventory_duration_seconds)}</span>}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-400">Инвентаризация не проводилась</p>
        )}
      </div>

      {/* Children — drill-down */}
      {childrenData && childrenData.items.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {childrenData.label} ({childrenData.items.length})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {childrenData.items.map((child, i) => (
              <InventoryCard
                key={child.id || i}
                node={child}
                type={getChildType(child)}
                onDrill={onDrill}
                settings={settings}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inventory history with scans — for leaf nodes */}
      {isLeaf && hasInventory && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            История инвентаризаций
          </p>
          <InventoryHistorySection node={node} />
        </div>
      )}
    </div>
  );
}

// ═══ Main Component ═══
export default function InventoryAnalyticsView() {
  const { settings: s } = useAppSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState(null);
  const [drillStack, setDrillStack] = useState([]);

  useEffect(() => {
    setLoading(true);
    api.get('/tasks/analytics/inventory-overview')
      .then(res => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDrill = (node) => {
    setDrillStack(prev => [...prev, node]);
  };

  const handleBack = (toIndex) => {
    setDrillStack(prev => prev.slice(0, toIndex));
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;
  if (!data) return <p className="text-center text-gray-400 py-12">Нет данных</p>;

  const warehouses = data.warehouses || data || [];

  // Drill-down view (only in inventory tab)
  if (drillStack.length > 0) {
    const currentNode = drillStack[drillStack.length - 1];
    return (
      <div>
        <DetailPanel
          node={currentNode}
          breadcrumbs={drillStack}
          onDrill={handleDrill}
          onBack={handleBack}
          settings={s}
        />
      </div>
    );
  }

  const filteredWarehouses = selectedWarehouse
    ? warehouses.filter(w => String(w.id) === String(selectedWarehouse))
    : warehouses;

  // Flatten nodes for selected warehouses (for stats + search)
  function collectNodesFrom(sources, path = '') {
    const result = [];
    for (const n of (sources || [])) {
      result.push({ ...n, _path: path });
      if (n.racks) result.push(...collectNodesFrom(n.racks, path + (path ? ' → ' : '') + (n.name || '')));
      if (n.rows) result.push(...collectNodesFrom(n.rows, path + (path ? ' → ' : '') + (n.name || '')));
      if (n.shelves) result.push(...collectNodesFrom(n.shelves, path + (path ? ' → ' : '') + (n.name || n.code || '')));
      if (n.pallets) result.push(...collectNodesFrom(n.pallets, path + (path ? ' → ' : '') + (n.name || '')));
      if (n.boxes) result.push(...collectNodesFrom(n.boxes, path + (path ? ' → ' : '') + (n.label || n.name || n.code || '')));
      if (n.children) result.push(...collectNodesFrom(n.children, path + (path ? ' → ' : '') + (n.name || '')));
    }
    return result;
  }
  const filteredNodes = collectNodesFrom(filteredWarehouses);

  const searchResults = search.length >= 2
    ? filteredNodes.filter(n => {
        const hay = [n.name, n.code, n.label, n.barcode_value].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(search.toLowerCase());
      })
    : [];

  // Stats — based on selected warehouse + settings thresholds
  const freshH = s.inventory_fresh_hours || 24;
  const staleH = s.inventory_stale_hours || 72;
  const statsNodes = filteredNodes;
  const inventoried = statsNodes.filter(n => !!n.last_inventory_at).length;
  const notInventoried = statsNodes.length - inventoried;
  const freshCount = statsNodes.filter(n => {
    if (!n.last_inventory_at) return false;
    return (Date.now() - new Date(n.last_inventory_at).getTime()) < freshH * 3600000;
  }).length;
  const staleCount = statsNodes.filter(n => {
    if (!n.last_inventory_at) return false;
    return (Date.now() - new Date(n.last_inventory_at).getTime()) > staleH * 3600000;
  }).length;

  return (
    <div>
      <>
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <WarehouseIcon size={28} />
          </div>
          <div>
            <p className="text-2xl font-black text-gray-900 dark:text-white">{selectedWarehouse ? 1 : warehouses.length}</p>
            <p className="text-xs text-gray-400 uppercase font-semibold">{selectedWarehouse ? 'Склад' : 'Складов'}</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: (s.inventory_color_fresh || '#047857') + '18' }}>
            <CheckCircle2 size={22} style={{ color: s.inventory_color_fresh || '#047857' }} />
          </div>
          <div>
            <p className="text-2xl font-black" style={{ color: s.inventory_color_fresh || '#047857' }}>{freshCount}</p>
            <p className="text-xs text-gray-400 uppercase font-semibold">Свежих ({freshH}ч)</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: (s.inventory_color_stale || '#b91c1c') + '18' }}>
            <AlertTriangle size={22} style={{ color: s.inventory_color_stale || '#b91c1c' }} />
          </div>
          <div>
            <p className="text-2xl font-black" style={{ color: s.inventory_color_stale || '#b91c1c' }}>{notInventoried}</p>
            <p className="text-xs text-gray-400 uppercase font-semibold">Без инвента</p>
          </div>
        </div>
        <div className="card p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: (s.inventory_color_warn || '#a16207') + '18' }}>
            <Clock size={22} style={{ color: s.inventory_color_warn || '#a16207' }} />
          </div>
          <div>
            <p className="text-2xl font-black" style={{ color: s.inventory_color_warn || '#a16207' }}>{staleCount}</p>
            <p className="text-xs text-gray-400 uppercase font-semibold">Устарели ({staleH}ч+)</p>
          </div>
        </div>
      </div>

      {/* Warehouse filter + search */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {warehouses.map(w => (
          <button key={w.id}
            onClick={() => setSelectedWarehouse(w.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-1.5 ${String(selectedWarehouse) === String(w.id) ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg> {w.name}
          </button>
        ))}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию, коду, штрих-коду..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm placeholder-gray-400 focus:outline-none focus:border-primary-400"
            />
          </div>
        </div>
      </div>

      {/* Search results */}
      {search.length >= 2 && (
        <div className="card p-0 mb-5 overflow-hidden">
          {searchResults.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-6">Ничего не найдено</p>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-700 max-h-64 overflow-y-auto">
              {searchResults.slice(0, 20).map((n, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                  onClick={() => handleDrill(n)}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor(n, s).text }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{n.label || n.name || n.code}</p>
                    {n._path && <p className="text-xs text-gray-400 truncate">{n._path}</p>}
                  </div>
                  {n.last_inventory_at && <span className="text-xs text-gray-400 flex-shrink-0">{fmtQty(n.last_inventory_qty)} шт.</span>}
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg flex-shrink-0" style={{ background: statusColor(n, s).bg, color: statusColor(n, s).text }}>
                    {statusColor(n, s).label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Warehouse map */}
      {filteredWarehouses.map(wh => {
        const racks = (wh.racks || []).map(r => ({ ...r, _type: 'rack' }));
        const rows = (wh.rows || []).map(r => ({ ...r, _type: 'row' }));
        const locations = [...racks, ...rows];
        const whInventoried = locations.filter(n => !!n.last_inventory_at).length;
        const whTotal = locations.length;
        const whPct = whTotal > 0 ? Math.round((whInventoried / whTotal) * 100) : 0;

        return (
          <div key={wh.id} className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>
              <h3 className="font-bold text-gray-900 dark:text-white">{wh.name}</h3>
              <span className="text-xs text-gray-400">{wh.warehouse_type === 'fbo' ? 'Паллетный' : 'Стеллажный'}</span>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${whPct}%`, background: whPct === 100 ? '#10b981' : whPct > 50 ? '#f59e0b' : '#ef4444' }} />
                </div>
                <span className="text-xs font-bold text-gray-600">{whPct}%</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {locations.map((loc, i) => (
                <InventoryCard key={loc.id || i} node={loc} type={loc._type || 'shelf'} onDrill={handleDrill} settings={s} />
              ))}
            </div>
          </div>
        );
      })}
      </>
    </div>
  );
}

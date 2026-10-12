import { useState, useEffect, useCallback } from 'react';
import { BarChart3, ChevronRight, Clock, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import { WarehouseIcon, RackIcon, ShelfIcon, PalletIcon, RowIcon, BoxIcon, ProductIcon, EmployeeIcon } from '../../components/ui/WarehouseIcons';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import { useAppSettings } from '../../context/AppSettingsContext';
import { cn } from '../../utils/cn';

/* ═══════════════════ Helpers ═══════════════════ */

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

function fmtQty(val) {
  return Number(val || 0).toLocaleString('ru-RU');
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  const cNone = settings.inventory_color_none || '#a16207';

  if (!node.last_inventory_at) return { ...hexToBgBorder(cNone), label: 'Не было' };
  const hours = (Date.now() - new Date(node.last_inventory_at).getTime()) / 3600000;
  if (hours < freshH) return { ...hexToBgBorder(cFresh), label: 'Свежий' };
  if (hours < staleH) return { ...hexToBgBorder(cWarn), label: 'Давно' };
  return { ...hexToBgBorder(cStale), label: 'Устарел' };
}

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

function nodeId(node, type) {
  return `${type || node._type || 'node'}-${node.id}`;
}

function getNodeLabel(node) {
  // For rows: show "Ряд X" instead of just "РX"
  if (node.kind === 'row' || node._type === 'row') {
    return node.name || `Ряд ${node.number || ''}`;
  }
  // For pallets: show "Паллет X" or full label
  if (node.kind === 'pallet' || node._type === 'pallet') {
    return node.name || node.label || `Паллет ${node.number || ''}`;
  }
  return node.label || node.name || node.code || '—';
}

function getNodeIcon(type, size = 18, colorIndex = 0) {
  switch (type) {
    case 'warehouse': return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>;
    case 'rack': return <RackIcon size={size} />;
    case 'row': return <RowIcon size={size} />;
    case 'shelf': return <ShelfIcon size={size} />;
    case 'pallet': return <PalletIcon size={size} />;
    case 'pallet_box':
    case 'shelf_box':
    case 'box': return <BoxIcon size={size} />;
    default: return <ShelfIcon size={size} />;
  }
}

/* ═══════════════════ Folder SVG icons ═══════════════════ */

function FolderClosedIcon({ color = '#7c3aed', size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" fill={color} opacity="0.85"/>
    </svg>
  );
}

function FolderOpenIcon({ color = '#7c3aed', size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v1H7.5a2 2 0 00-1.9 1.37L2 20V6z" fill={color} opacity="0.7"/>
      <path d="M5.5 11h16a1 1 0 01.97 1.24l-2.1 8.4A1 1 0 0119.4 21.5H3.6L5.5 11z" fill={color} opacity="0.9"/>
    </svg>
  );
}

function FileIcon({ color = '#a78bfa', size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M6 2a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6H6z" fill={color} opacity="0.8"/>
      <path d="M14 2v4a2 2 0 002 2h4" fill="none" stroke={color} strokeWidth="1.5"/>
    </svg>
  );
}

/* ═══════════════════ Tree Node ═══════════════════ */

function TreeNode({ node, type, depth = 0, expandedNodes, selectedNodeId, onToggle, onSelect }) {
  const nid = nodeId(node, type);
  const childrenData = getChildren(node);
  const hasChildren = !!childrenData;
  const isExpanded = expandedNodes.has(nid);
  const isSelected = selectedNodeId === nid;
  const childCount = childrenData ? childrenData.items.length : 0;

  const isWarehouse = type === 'warehouse';
  const isRackOrRow = type === 'rack' || type === 'row';
  const isBox = type === 'pallet_box' || type === 'shelf_box' || type === 'box';

  const getFolderIcon = () => {
    if (isBox) return <BoxIcon size={16} />;
    if (type === 'warehouse') return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>;
    if (type === 'rack') return <RackIcon size={16} />;
    if (type === 'row') return <RowIcon size={16} />;
    if (type === 'shelf') return <ShelfIcon size={16} />;
    if (type === 'pallet') return <PalletIcon size={16} />;
    if (!hasChildren) return <ShelfIcon size={16} />;
    return <ShelfIcon size={16} />;
  };

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) onToggle(nid);
          onSelect(node, type, nid);
        }}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors rounded-r-lg',
          isSelected
            ? 'bg-[#f5f3ff] text-[#7c3aed] font-semibold border-l-[3px] border-[#7c3aed]'
            : 'text-gray-700 hover:bg-gray-50 border-l-[3px] border-transparent'
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {hasChildren && (
          <ChevronRight
            size={12}
            className={cn('flex-shrink-0 text-gray-400 transition-transform', isExpanded && 'rotate-90')}
          />
        )}
        {!hasChildren && <span className="w-3 flex-shrink-0" />}
        <span className="flex-shrink-0">{getFolderIcon()}</span>
        <span className="truncate flex-1">{getNodeLabel(node)}</span>
        {hasChildren && childCount > 0 && (
          <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5 flex-shrink-0 font-medium">
            {childCount}
          </span>
        )}
      </button>
      {hasChildren && isExpanded && (
        <div>
          {childrenData.items.map((child, i) => {
            const cType = getChildType(child);
            return (
              <TreeNode
                key={child.id || i}
                node={child}
                type={cType}
                depth={depth + 1}
                expandedNodes={expandedNodes}
                selectedNodeId={selectedNodeId}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Task Scans Panel ═══════════════════ */

function TaskScansPanel({ taskId, boxId, boxType }) {
  const [scans, setScans] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/tasks/${taskId}/analytics`)
      .then(r => {
        let allScans = r.data?.scans || [];
        if (boxId && allScans.length > 0) {
          const taskBoxes = r.data?.task_boxes || [];
          const matchField = boxType === 'shelf_box' ? 'shelf_box_id' : 'box_id';
          const taskBox = taskBoxes.find(tb => String(tb[matchField]) === String(boxId));
          if (taskBox) {
            allScans = allScans.filter(sc => String(sc.task_box_id) === String(taskBox.id));
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
        {scans.map((sc, i) => {
          const secSince = Number(sc.seconds_since_prev);
          const speedClass = sc.seconds_since_prev == null
            ? 'text-purple-400'
            : secSince <= 5 ? 'text-green-500' : secSince <= 10 ? 'text-amber-500' : 'text-rose-500';
          return (
            <div key={sc.id} className="flex items-center gap-2.5 px-3 py-1.5">
              <span className="text-[11px] font-mono text-gray-300 w-5 text-right flex-shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{sc.product_name || 'Неизвестный'}</p>
                {sc.product_code && <p className="text-[10px] text-gray-400">{sc.product_code}</p>}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] font-mono text-gray-600">{fmtTime(sc.created_at)}</p>
                {sc.seconds_since_prev != null ? (
                  <p className={`text-[10px] ${speedClass}`}>+{sc.seconds_since_prev}с</p>
                ) : (
                  <p className="text-[10px] text-purple-400">старт</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════ Inventory History Section ═══════════════════ */

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
          <div key={ev.task_id} className={cn('rounded-2xl border overflow-hidden', isLatest ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200 bg-white')}>
            <button
              onClick={() => setExpandedTask(isExpanded ? null : ev.task_id)}
              className="w-full text-left px-4 py-3 hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <svg className={cn('w-3 h-3 text-gray-400 flex-shrink-0 transition-transform', isExpanded && 'rotate-90')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {ev.task_title || `Задача #${ev.task_id}`}
                      {isLatest && <span className="ml-2 text-[10px] text-purple-500 font-medium">последняя</span>}
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
                    {avgPick && <span className="text-[10px] text-purple-500 font-semibold">{avgPick}с/шт</span>}
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

/* ═══════════════════ Overview Panel (v4 table style) ═══════════════════ */

function OverviewPanel({ data, settings, singleWarehouse, onSelectNode }) {
  const warehouses = data.warehouses || data || [];
  const isSingle = singleWarehouse && warehouses.length === 1;
  const wh = isSingle ? warehouses[0] : null;

  // For single warehouse mode, table rows are its racks/rows; for overview, rows are warehouses
  const tableItems = isSingle
    ? [...(wh.racks || []).map(r => ({ ...r, _type: 'rack' })), ...(wh.rows || []).map(r => ({ ...r, _type: 'row' }))]
    : warehouses;

  function collectAll(sources) {
    const result = [];
    for (const n of (sources || [])) {
      result.push(n);
      if (n.racks) result.push(...collectAll(n.racks));
      if (n.rows) result.push(...collectAll(n.rows));
      if (n.shelves) result.push(...collectAll(n.shelves));
      if (n.pallets) result.push(...collectAll(n.pallets));
      if (n.boxes) result.push(...collectAll(n.boxes));
      if (n.children) result.push(...collectAll(n.children));
    }
    return result;
  }

  const allNodes = collectAll(warehouses);
  const totalQty = allNodes.reduce((s, n) => s + Number(n.current_qty || 0), 0);
  const inventoried = allNodes.filter(n => !!n.last_inventory_at).length;
  const coverage = allNodes.length > 0 ? Math.round((inventoried / allNodes.length) * 100) : 0;

  // Total time spent
  const totalDuration = allNodes.reduce((s, n) => s + Number(n.last_inventory_duration_seconds || 0), 0);

  // Average speed
  const speeds = allNodes
    .filter(n => n.last_inventory_duration_seconds > 0 && n.last_inventory_qty > 0)
    .map(n => Number(n.last_inventory_duration_seconds) / Number(n.last_inventory_qty));
  const avgSpeed = speeds.length > 0 ? (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1) : null;

  // Accuracy: % of leaf nodes where delta == 0
  const leafNodes = allNodes.filter(n => n.last_inventory_qty != null);
  const accurateCount = leafNodes.filter(n => Number(n.last_inventory_qty || 0) === Number(n.current_qty || 0)).length;
  const accuracy = leafNodes.length > 0 ? ((accurateCount / leafNodes.length) * 100).toFixed(1) : '—';

  // Sort state
  const [sortCol, setSortCol] = useState(null);
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  }

  function getSortValue(item, col) {
    switch (col) {
      case 'name': return getNodeLabel(item).toLowerCase();
      case 'qty': return Number(item.current_qty || 0);
      case 'inv': return Number(item.last_inventory_qty || 0);
      case 'diff': return item.last_inventory_qty != null && item.previous_inventory_qty != null
        ? Math.abs(Number(item.last_inventory_qty) - Number(item.previous_inventory_qty)) : -1;
      case 'time': return Number(item.last_inventory_duration_seconds || 0);
      case 'speed': {
        const q = Number(item.last_inventory_qty || 0);
        const d = Number(item.last_inventory_duration_seconds || 0);
        return q > 0 && d > 0 ? d / q : 9999;
      }
      case 'employee': return (item.last_inventory_by || '').toLowerCase();
      case 'date': return item.last_inventory_at ? new Date(item.last_inventory_at).getTime() : 0;
      case 'status': return statusColor(item, settings).label;
      default: return 0;
    }
  }

  const sortedItems = [...tableItems];
  if (sortCol) {
    sortedItems.sort((a, b) => {
      const va = getSortValue(a, sortCol);
      const vb = getSortValue(b, sortCol);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }

  const headerTitle = isSingle ? getNodeLabel(wh) : 'Обзор всех складов';
  const headerSubtitle = isSingle
    ? `${fmtQty(totalQty)} позиций \u00B7 ${tableItems.length} ${tableItems.length === 1 ? 'элемент' : 'элементов'}`
    : `${fmtQty(totalQty)} позиций \u00B7 ${warehouses.length} ${warehouses.length === 1 ? 'склад' : 'складов'}`;
  const firstColLabel = isSingle ? 'Стеллаж/Ряд' : 'Склад/Стеллаж';

  function getDiffClass(delta, total) {
    const pct = total > 0 ? Math.abs(delta) / total * 100 : 0;
    if (delta === 0) return 'text-[#047857] font-semibold';
    if (pct < 0.5) return 'text-[#a16207] font-semibold';
    return 'text-[#b91c1c] font-semibold';
  }

  function getRowBg(item) {
    const st = statusColor(item, settings);
    if (st.label === 'Свежий') return 'bg-[#fafff9]';
    if (st.label === 'Давно') return 'bg-[#fffdf5]';
    if (st.label === 'Не было') return 'bg-[#fffdf5]';
    if (st.label === 'Устарел') return 'bg-[#fff8f8]';
    return '';
  }

  function getStatusBadge(item) {
    const st = statusColor(item, settings);
    if (st.label === 'Свежий') return <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#ecfdf5] text-[#047857]">Свежий</span>;
    if (st.label === 'Давно') return <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fffbeb] text-[#a16207]">Давно</span>;
    if (st.label === 'Не было') return <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fffbeb] text-[#a16207]">Не было</span>;
    return <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#fef2f2] text-[#b91c1c]">Устарел</span>;
  }

  return (
    <div className="animate-fade-up">
      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-3.5 flex-1 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6d28d9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-[22px] font-extrabold text-gray-900 break-words">{headerTitle}</h1>
              <p className="text-sm text-gray-500 mt-0.5">{headerSubtitle}</p>
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-500">Покрытие инвентаризации</span>
              <span className="font-bold text-[#7c3aed]">{coverage}%</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-md overflow-hidden">
              <div className="h-full rounded-md transition-all duration-700" style={{ width: `${coverage}%`, background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-gray-100 mb-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr>
                {[
                  { key: 'name', label: firstColLabel },
                  { key: 'qty', label: 'Позиций' },
                  { key: 'inv', label: 'По инвенту' },
                  { key: 'diff', label: 'Расхожд.' },
                  { key: 'time', label: 'Время' },
                  { key: 'speed', label: 'Скорость' },
                  { key: 'employee', label: 'Сотрудник' },
                  { key: 'date', label: 'Дата' },
                  { key: 'status', label: 'Статус' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-left px-2.5 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-b border-gray-100 cursor-pointer hover:text-primary-600 select-none whitespace-nowrap bg-gray-50/50"
                  >
                    {col.label} <span className="text-[10px] opacity-40">{sortCol === col.key ? (sortAsc ? '\u2191' : '\u2193') : '\u2195'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item, i) => {
                const curQ = Number(item.current_qty || 0);
                const hasFullInv = item.last_inventory_qty != null;
                const hasPartialInv = !hasFullInv && item.partial_inventory_qty != null;
                const invQ = hasFullInv ? Number(item.last_inventory_qty) : hasPartialInv ? Number(item.partial_inventory_qty) : null;
                const isPartial = hasPartialInv;
                const hasAnyInv = hasFullInv || hasPartialInv;
                const hasPrevInv = item.previous_inventory_qty != null;
                const prevQ = hasPrevInv ? Number(item.previous_inventory_qty) : null;
                const delta = hasFullInv && hasPrevInv ? invQ - prevQ : null;
                const totalDur = hasFullInv
                  ? Number(item.last_inventory_duration_seconds || 0)
                  : Number(item.partial_inventory_duration_seconds || 0);
                const spd = hasAnyInv && invQ > 0 && totalDur > 0 ? (totalDur / invQ).toFixed(1) : '—';
                const pct = delta != null && prevQ > 0 && delta !== 0 ? ((Math.abs(delta) / prevQ) * 100).toFixed(2) : '0';
                const itemType = item._type || (isSingle ? 'rack' : 'warehouse');
                const covInfo = item.covered_leaf_count != null && item.total_leaf_count > 0
                  ? `${item.covered_leaf_count}/${item.total_leaf_count}`
                  : null;
                return (
                  <tr key={item.id || i} className={cn('transition-colors hover:bg-[#faf5ff] cursor-pointer', getRowBg(item))} onClick={() => onSelectNode?.(item, itemType, nodeId(item, itemType))}>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">
                      <div className="flex items-center gap-2 font-semibold text-[#7c3aed]">
                        {getNodeIcon(itemType, 20, isSingle ? 0 : (item.id || i) % 10)}
                        {getNodeLabel(item)}
                      </div>
                    </td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">{fmtQty(curQ)}</td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">
                      {hasAnyInv ? (
                        <span>{fmtQty(invQ)}{isPartial && covInfo && <span className="text-[10px] text-gray-400 ml-1">({covInfo})</span>}</span>
                      ) : '—'}
                    </td>
                    <td className={cn('px-2.5 py-3 border-b border-gray-100 whitespace-nowrap', delta != null ? getDiffClass(delta, prevQ || 1) : 'text-gray-400')}>
                      {delta != null ? (<>{delta > 0 ? '+' : ''}{delta} {delta !== 0 ? `(${pct}%)` : ''}</>) : hasAnyInv ? '1 инвент' : '—'}
                    </td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">{totalDur > 0 ? fmtDuration(totalDur) : '—'}</td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">{spd !== '—' ? `${spd} с/шт` : '—'}</td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">
                      {item.last_inventory_by ? <span className="text-[#7c3aed] font-semibold">{item.last_inventory_by}</span> : '—'}
                    </td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">{item.last_inventory_at ? fmtDate(item.last_inventory_at) : '—'}</td>
                    <td className="px-2.5 py-3 border-b border-gray-100 whitespace-nowrap">{getStatusBadge(item)}</td>
                  </tr>
                );
              })}
              {sortedItems.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">Нет данных</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom 3 cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-center">
          <p className="text-lg font-black text-amber-600">{fmtDuration(totalDuration)}</p>
          <p className="text-[10px] text-amber-500 font-medium">Время</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 text-center">
          <p className="text-lg font-black text-indigo-600">{avgSpeed ? `${avgSpeed} с/шт` : '—'}</p>
          <p className="text-[10px] text-indigo-500 font-medium">Скорость</p>
        </div>
        <div className="bg-green-50 border border-green-100 rounded-xl px-3 py-2 text-center">
          <p className="text-lg font-black text-green-600">{accuracy}%</p>
          <p className="text-[10px] text-green-500 font-medium">Точность</p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Detail Header Card (v2 style) ═══════════════════ */

function DetailHeaderCard({ node, type, breadcrumb, childrenLabel }) {
  const curQty = Number(node.current_qty || 0);
  const hasFullInv = node.last_inventory_qty != null;
  const hasPartialInv = !hasFullInv && node.partial_inventory_qty != null;
  const hasAnyInv = hasFullInv || hasPartialInv;
  const invQty = hasFullInv ? Number(node.last_inventory_qty) : hasPartialInv ? Number(node.partial_inventory_qty) : null;
  const hasPrevInv = node.previous_inventory_qty != null;
  const prevQty = hasPrevInv ? Number(node.previous_inventory_qty) : null;
  const delta = hasFullInv && hasPrevInv ? invQty - prevQty : null;
  const dur = hasFullInv
    ? Number(node.last_inventory_duration_seconds || 0)
    : Number(node.partial_inventory_duration_seconds || 0);
  const avgPick = hasAnyInv && invQty > 0 && dur > 0 ? (dur / invQty).toFixed(1) : null;
  const picksPerMin = hasAnyInv && invQty > 0 && dur > 0 ? (invQty / (dur / 60)).toFixed(1) : null;
  const covInfo = node.covered_leaf_count != null && node.total_leaf_count > 0
    ? `${node.covered_leaf_count}/${node.total_leaf_count}`
    : null;

  const iconBgColors = {
    rack: '#ecfdf5',
    row: '#fffbeb',
    shelf: '#eff6ff',
    pallet: '#fefce8',
    pallet_box: '#fef3c7',
    shelf_box: '#fef3c7',
    box: '#fef3c7',
  };
  const iconBg = iconBgColors[type] || '#f3f4f6';

  const statusBadge = !hasAnyInv
    ? <span className="text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-[#fffbeb] text-[#a16207]">Не было</span>
    : hasPartialInv
      ? <span className="text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-[#fffbeb] text-[#a16207]">Частично {covInfo}</span>
      : delta == null
        ? <span className="text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-[#fffbeb] text-[#a16207]">1 инвент</span>
        : delta === 0
          ? <span className="text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-[#ecfdf5] text-[#047857]">Сходится</span>
          : <span className="text-[11px] font-bold px-3 py-1 rounded-full uppercase tracking-wide bg-[#fffbeb] text-[#a16207]">{delta > 0 ? '+' : ''}{delta} расхождение</span>;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6 mb-5">
      {/* Top row: icon + info + status */}
      <div className="flex items-center gap-4 mb-4">
        <div className="w-[72px] h-[72px] rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
          {getNodeIcon(type, 36)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[22px] font-extrabold text-gray-900 truncate">{getNodeLabel(node)}</h3>
          {breadcrumb && <p className="text-xs text-gray-400 font-medium mt-0.5">{breadcrumb}{childrenLabel ? ` \u00B7 ${childrenLabel}` : ''}</p>}
          {node.barcode_value && <p className="text-[11px] font-mono text-gray-300 tracking-wider mt-0.5">{node.barcode_value}</p>}
        </div>
        <div className="flex-shrink-0">
          {statusBadge}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 border-l-[3px] border-l-[#7c3aed]">
          <p className="text-lg font-extrabold text-gray-900 leading-tight">{hasAnyInv ? fmtQty(invQty) : '—'}</p>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">Насчитано{hasPartialInv && covInfo ? ` (${covInfo})` : ''}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
          <p className="text-lg font-extrabold text-gray-900 leading-tight">{fmtQty(curQty)}</p>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">Текущий остаток</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
          <p className={cn('text-lg font-extrabold leading-tight', delta != null ? (delta === 0 ? 'text-[#047857]' : Math.abs(delta) <= 5 ? 'text-[#a16207]' : 'text-[#b91c1c]') : 'text-gray-300')}>
            {delta != null ? (delta === 0 ? '0' : (delta > 0 ? '+' : '') + delta) : hasAnyInv ? '1 инвент' : '—'}
          </p>
          <p className="text-[11px] text-gray-400 font-medium mt-0.5">Расхожд. между инвентами</p>
        </div>
        {dur > 0 && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-lg font-extrabold text-[#7c3aed] leading-tight">{fmtDuration(dur)}</p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Потрачено на инвент.</p>
          </div>
        )}
        {avgPick && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-lg font-extrabold text-gray-900 leading-tight">{avgPick} с</p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Скорость/шт</p>
          </div>
        )}
        {picksPerMin && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-lg font-extrabold text-gray-900 leading-tight">{picksPerMin}</p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Товаров/мин</p>
          </div>
        )}
        {node.last_inventory_by && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100 flex items-center gap-2">
            <EmployeeIcon size={24} />
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-gray-900 truncate">{node.last_inventory_by}</p>
              <p className="text-[11px] text-gray-400 font-medium mt-0.5">Сотрудник</p>
            </div>
          </div>
        )}
        {node.last_inventory_at && (
          <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
            <p className="text-sm font-extrabold text-gray-900 leading-tight">{fmtDate(node.last_inventory_at)}</p>
            <p className="text-[11px] text-gray-400 font-medium mt-0.5">Дата</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ Rack / Row Detail ═══════════════════ */

function RackRowDetail({ node, type, settings, onSelectNode }) {
  const childrenData = getChildren(node);
  const items = childrenData?.items || [];

  return (
    <div className="animate-fade-up">
      {/* Header card (v2 style) */}
      <DetailHeaderCard
        node={node}
        type={type}
        childrenLabel={items.length > 0 ? `${items.length} ${childrenData?.label?.toLowerCase() || 'элементов'}` : null}
      />

      {/* Child cards */}
      <div className="space-y-3">
        {items.map((child, i) => {
          const cst = statusColor(child, settings);
          const cHasInv = child.last_inventory_qty != null;
          const cHasPartial = !cHasInv && child.partial_inventory_qty != null;
          const cHasAny = cHasInv || cHasPartial;
          const cInv = cHasInv ? Number(child.last_inventory_qty) : cHasPartial ? Number(child.partial_inventory_qty) : null;
          const cCur = Number(child.current_qty || 0);
          const cHasPrev = child.previous_inventory_qty != null;
          const cPrev = cHasPrev ? Number(child.previous_inventory_qty) : null;
          const cDelta = cHasInv && cHasPrev ? cInv - cPrev : null;
          const cDur = cHasInv
            ? Number(child.last_inventory_duration_seconds || 0)
            : Number(child.partial_inventory_duration_seconds || 0);
          const cAvgPick = cHasAny && cInv > 0 && cDur > 0 ? (cDur / cInv).toFixed(1) : null;
          return (
            <div key={child.id || i} className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer" style={{ borderLeft: `4px solid ${cst.text}` }} onClick={() => onSelectNode?.(child, getChildType(child), nodeId(child, getChildType(child)))}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getNodeIcon(getChildType(child), 18)}
                  <span className="font-semibold text-[#7c3aed]">{getNodeLabel(child)}</span>
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg" style={{ background: cst.bg, color: cst.text }}>{cst.label}</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center bg-gray-50 rounded-lg p-2 mb-2">
                <div>
                  <p className="text-sm font-black text-gray-900">{cHasAny ? fmtQty(cInv) : '—'}</p>
                  <p className="text-[10px] text-gray-400">по инвенту</p>
                </div>
                <div>
                  <p className="text-sm font-black text-gray-900">{fmtQty(cCur)}</p>
                  <p className="text-[10px] text-gray-400">сейчас</p>
                </div>
                <div>
                  <p className={cn('text-sm font-black', cDelta != null ? (cDelta > 0 ? 'text-green-600' : cDelta < 0 ? 'text-rose-600' : 'text-gray-400') : 'text-gray-300')}>
                    {cDelta != null ? ((cDelta > 0 ? '+' : '') + cDelta) : cHasAny ? '1 инв.' : '—'}
                  </p>
                  <p className="text-[10px] text-gray-400">расхожд.</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-400">
                {child.last_inventory_at && (
                  <span className="flex items-center gap-1"><Clock size={10} />{timeAgo(child.last_inventory_at)}</span>
                )}
                {cDur > 0 && (
                  <span className="flex items-center gap-1">Время: <strong className="text-gray-600">{fmtDuration(cDur)}</strong></span>
                )}
                {cAvgPick && (
                  <span className="text-purple-500 font-semibold">{cAvgPick}с/шт</span>
                )}
                {child.last_inventory_by && (
                  <span className="flex items-center gap-1"><EmployeeIcon size={10} />{child.last_inventory_by}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════ Shelf / Pallet Detail ═══════════════════ */

function ShelfPalletDetail({ node, type, settings, onSelectNode }) {
  const childrenData = getChildren(node);
  const hasBoxes = !!childrenData && childrenData.items.length > 0;

  // Product distribution from node.products if available
  const products = node.products || [];

  return (
    <div className="animate-fade-up">
      {/* Header card (v2 style) */}
      <DetailHeaderCard
        node={node}
        type={type}
        childrenLabel={hasBoxes ? `${childrenData.items.length} ${childrenData.label?.toLowerCase() || 'элементов'}` : null}
      />

      {/* Boxes tile grid */}
      {hasBoxes && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{childrenData.label} ({childrenData.items.length})</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {childrenData.items.map((box, i) => {
              const bst = statusColor(box, settings);
              const bQty = Number(box.last_inventory_qty || box.current_qty || 0);
              const bDur = Number(box.last_inventory_duration_seconds || 0);
              const bAvg = bQty > 0 && bDur > 0 ? (bDur / bQty).toFixed(1) : null;
              return (
                <button key={box.id || i} onClick={() => onSelectNode?.(box, getChildType(box), nodeId(box, getChildType(box)))} className="bg-white rounded-xl border border-gray-100 p-3 hover:shadow-md hover:-translate-y-0.5 transition-all text-left w-full cursor-pointer" style={{ borderBottom: `3px solid ${bst.text}` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <BoxIcon size={14} />
                    <span className="font-semibold text-sm text-gray-900 truncate flex-1">{getNodeLabel(box)}</span>
                    <span className="text-xs font-black text-gray-900">{fmtQty(bQty)}<span className="text-[10px] text-gray-400 ml-0.5">шт</span></span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-gray-400">
                    {bDur > 0 && <span>Время: <strong className="text-gray-600">{fmtDuration(bDur)}</strong></span>}
                    {bAvg && <span className="text-purple-500 font-semibold">{bAvg}с/шт</span>}
                    {box.last_inventory_at && <span>{timeAgo(box.last_inventory_at)}</span>}
                    {box.last_inventory_by && <span>{box.last_inventory_by}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* If no boxes — show history + product distribution */}
      {!hasBoxes && (
        <>
          {/* Product distribution bar */}
          {products.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Распределение товаров</p>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="h-6 rounded-full overflow-hidden flex">
                  {products.map((p, idx) => {
                    const pQty = Number(p.qty || p.quantity || 0);
                    const total = products.reduce((s, pp) => s + Number(pp.qty || pp.quantity || 0), 0);
                    const pct = total > 0 ? (pQty / total) * 100 : 0;
                    const colors = ['#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2', '#4f46e5'];
                    return (
                      <div
                        key={idx}
                        className="h-full"
                        style={{ width: `${pct}%`, background: colors[idx % colors.length], minWidth: pct > 0 ? '4px' : 0 }}
                        title={`${p.name || p.product_name}: ${pQty}`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-3">
                  {products.slice(0, 6).map((p, idx) => {
                    const colors = ['#7c3aed', '#2563eb', '#16a34a', '#d97706', '#dc2626', '#0891b2'];
                    return (
                      <span key={idx} className="flex items-center gap-1 text-[11px] text-gray-600">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: colors[idx % colors.length] }} />
                        {p.name || p.product_name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {node.last_inventory_at && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">История инвентаризаций</p>
              <InventoryHistorySection node={node} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════ Box Detail (leaf) ═══════════════════ */

function BoxDetail({ node, type, settings }) {
  return (
    <div className="animate-fade-up">
      {/* Header card (v2 style) */}
      <DetailHeaderCard node={node} type={type} />

      {/* History section — no tabs, history only */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">История инвентаризаций</p>
      {(
        <InventoryHistorySection node={node} />
      )}
    </div>
  );
}

/* ═══════════════════ Right Panel Content Router ═══════════════════ */

function RightPanelContent({ selectedNode, selectedType, data, settings, onSelectNode }) {
  if (!selectedNode) {
    return <OverviewPanel data={data} settings={settings} onSelectNode={onSelectNode} />;
  }

  if (selectedType === 'warehouse') {
    return <OverviewPanel data={{ warehouses: [selectedNode] }} settings={settings} singleWarehouse onSelectNode={onSelectNode} />;
  }

  if (selectedType === 'rack' || selectedType === 'row') {
    return <RackRowDetail node={selectedNode} type={selectedType} settings={settings} onSelectNode={onSelectNode} />;
  }

  if (selectedType === 'shelf' || selectedType === 'pallet') {
    return <ShelfPalletDetail node={selectedNode} type={selectedType} settings={settings} onSelectNode={onSelectNode} />;
  }

  if (selectedType === 'pallet_box' || selectedType === 'shelf_box' || selectedType === 'box') {
    return <BoxDetail node={selectedNode} type={selectedType} settings={settings} />;
  }

  // Fallback: treat as shelf
  return <ShelfPalletDetail node={selectedNode} type={selectedType} settings={settings} onSelectNode={onSelectNode} />;
}

/* ═══════════════════ Main Component ═══════════════════ */

export default function InventoryAnalyticsV2() {
  const { settings: s } = useAppSettings();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedPath, setSelectedPath] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get('/tasks/analytics/inventory-overview')
      .then(res => {
        // Assign unique color index to each warehouse
        if (res.data?.warehouses) {
          res.data.warehouses.forEach((wh, i) => { wh._colorIdx = i + 1; });
        }
        setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = useCallback((nid) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nid)) next.delete(nid);
      else next.add(nid);
      return next;
    });
  }, []);

  const buildPath = useCallback((node, type, warehouses) => {
    // Build breadcrumb path by searching through the tree
    const path = [];

    function search(items, parentType, trail) {
      for (const item of items) {
        const iType = item._type || parentType;
        const currentTrail = [...trail, { node: item, type: iType, label: getNodeLabel(item) }];

        if (item === node || (item.id && item.id === node.id && iType === type)) {
          return currentTrail;
        }

        // Search children
        const childArrays = [
          { arr: item.racks, type: 'rack' },
          { arr: item.rows, type: 'row' },
          { arr: item.shelves, type: 'shelf' },
          { arr: item.pallets, type: 'pallet' },
          { arr: item.boxes, type: 'pallet_box' },
          { arr: item.children, type: null },
        ];

        for (const { arr, type: cType } of childArrays) {
          if (arr?.length) {
            const tagged = arr.map(c => ({ ...c, _type: c._type || cType || getChildType(c) }));
            const found = search(tagged, cType, currentTrail);
            if (found) return found;
          }
        }
      }
      return null;
    }

    const whs = (warehouses || []).map(w => ({ ...w, _type: 'warehouse' }));
    const result = search(whs, 'warehouse', []);
    return result || [{ node, type, label: getNodeLabel(node) }];
  }, []);

  const handleSelect = useCallback((node, type, nid) => {
    setSelectedNode(node);
    setSelectedType(type);
    setSelectedNodeId(nid || nodeId(node, type));

    if (data) {
      const warehouses = data.warehouses || data || [];
      const path = buildPath(node, type, warehouses);
      setSelectedPath(path);

      // Auto-expand ancestors (but not the node itself — toggle handles that)
      setExpandedNodes(prev => {
        const next = new Set(prev);
        const selectedNid = nid || nodeId(node, type);
        path.forEach(p => {
          const pid = nodeId(p.node, p.type);
          if (pid && pid !== selectedNid) next.add(pid);
        });
        return next;
      });
    }
  }, [data, buildPath]);

  const handleBreadcrumbClick = useCallback((index) => {
    if (index < 0) {
      // Click on "Overview"
      setSelectedNode(null);
      setSelectedType(null);
      setSelectedNodeId(null);
      setSelectedPath([]);
      return;
    }
    const pathItem = selectedPath[index];
    if (pathItem) {
      setSelectedNode(pathItem.node);
      setSelectedType(pathItem.type);
      setSelectedNodeId(nodeId(pathItem.node, pathItem.type));
      setSelectedPath(selectedPath.slice(0, index + 1));
    }
  }, [selectedPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-center text-gray-400 py-12">Нет данных</p>;
  }

  const warehouses = data.warehouses || data || [];

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
      {/* Mobile sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="md:hidden fixed top-20 left-4 z-50 bg-white border border-gray-200 rounded-lg p-2 shadow-lg"
      >
        <BarChart3 size={20} className="text-purple-600" />
      </button>

      {/* ═══ LEFT SIDEBAR ═══ */}
      <aside className={cn(
        'bg-white border-r border-gray-200 flex-shrink-0 flex flex-col overflow-hidden transition-all duration-300',
        sidebarOpen ? 'w-[270px]' : 'w-0 md:w-[270px]',
        'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:shadow-xl',
        !sidebarOpen && 'max-md:-translate-x-full'
      )}>
        {/* Sidebar header */}
        {/* Section label */}
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ИЕРАРХИЯ СКЛАДА</p>
        </div>

        {/* Tree */}
        <div className="flex-1 overflow-y-auto px-1 pb-4">
          {/* Overview node */}
          <button
            onClick={() => {
              setSelectedNode(null);
              setSelectedType(null);
              setSelectedNodeId(null);
              setSelectedPath([]);
            }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors rounded-r-lg mb-1',
              !selectedNode
                ? 'bg-[#f5f3ff] text-[#7c3aed] font-semibold border-l-[3px] border-[#7c3aed]'
                : 'text-gray-700 hover:bg-gray-50 border-l-[3px] border-transparent'
            )}
          >
            <BarChart3 size={14} className="flex-shrink-0" />
            <span>Обзор</span>
          </button>

          {/* Warehouse nodes */}
          {warehouses.map((wh, i) => (
            <TreeNode
              key={wh.id || i}
              node={wh}
              type="warehouse"
              depth={0}
              expandedNodes={expandedNodes}
              selectedNodeId={selectedNodeId}
              onToggle={handleToggle}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/20 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ═══ RIGHT PANEL ═══ */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 mb-5 flex-wrap">
          <button
            onClick={() => handleBreadcrumbClick(-1)}
            className={cn('text-sm font-medium', selectedPath.length > 0 ? 'text-purple-500 hover:text-purple-700' : 'text-gray-900')}
          >
            Обзор
          </button>
          {selectedPath.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight size={12} className="text-gray-300" />
              <button
                onClick={() => handleBreadcrumbClick(i)}
                className={cn('text-sm font-medium',
                  i === selectedPath.length - 1 ? 'text-gray-900' : 'text-purple-500 hover:text-purple-700'
                )}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>

        {/* Content */}
        <RightPanelContent
          selectedNode={selectedNode}
          selectedType={selectedType}
          data={data}
          settings={s}
          onSelectNode={handleSelect}
        />
      </main>
    </div>
  );
}

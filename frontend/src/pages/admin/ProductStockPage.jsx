import { useState, useEffect, useCallback } from 'react';
import {
  Package, Boxes, ChevronLeft, ChevronRight,
  MapPin, ArrowUp, ArrowDown, Warehouse, Search, X, Pencil, Users, ArrowLeft, Clock
} from 'lucide-react';
import { ProductIcon, BundleIcon, WarehouseIcon, NavStockIcon } from '../../components/ui/WarehouseIcons';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../utils/cn';
import { ProductDetailModal, ProductFormModal } from './ProductsPage';
import { qty as fmtQ, fmtDate } from '../../utils/fmt';
import { getTypeMeta, fmtSource as movFmtSource } from '../../utils/movementTypes';

function fmtQty(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function Th({ label, sortKey, sortBy, sortDir, onSort }) {
  const active = sortBy === sortKey;
  return (
    <th className="cursor-pointer select-none hover:bg-gray-50 transition-colors" onClick={() => onSort(sortKey)}>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {active
          ? (sortDir === 'asc' ? <ArrowUp size={12} className="text-primary-500" /> : <ArrowDown size={12} className="text-primary-500" />)
          : <ArrowDown size={12} className="text-gray-200" />}
      </div>
    </th>
  );
}

// ─── Employee Inventory View ─────────────────────────────────────────────────
function EmployeeInventoryView({ onBack }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drillEmployee, setDrillEmployee] = useState(null);
  const [history, setHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);

  useEffect(() => {
    api.get('/movements/all-employee-inventory').then(r => setData(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const openEmployee = (emp) => {
    setDrillEmployee(emp);
    setHistLoading(true);
    api.get(`/movements/history?employee_id=${emp.employee_id}&limit=50`)
      .then(r => setHistory(r.data.items || []))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  };

  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

  if (drillEmployee) {
    const totalQty = drillEmployee.items.reduce((s, i) => s + Number(i.quantity), 0);
    return (
      <div>
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => setDrillEmployee(null)} className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-gray-900">{drillEmployee.full_name}</h2>
            <p className="text-sm text-gray-400">{drillEmployee.items.length} товаров · {totalQty} шт.</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Товары на руках</p>
            <div className="card overflow-hidden divide-y divide-gray-50">
              {drillEmployee.items.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <ProductIcon size={20} className="flex-shrink-0" />
                  <p className="text-sm font-medium text-gray-800 flex-1 truncate">{item.product_name}</p>
                  <span className="text-sm font-bold text-primary-600">{fmtQ(item.quantity)} шт.</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              История перемещений {history.length > 0 && <span className="text-primary-500 ml-1">({history.length})</span>}
            </p>
            {histLoading ? <div className="flex justify-center py-8"><Spinner size="lg" /></div>
            : history.length === 0 ? <p className="text-sm text-gray-300 text-center py-4">Нет перемещений</p>
            : (
              <div className="card overflow-hidden divide-y divide-gray-50">
                {history.map(m => {
                  const meta = getTypeMeta(m.movement_type);
                  const from = movFmtSource(m, 'from');
                  const to = movFmtSource(m, 'to');
                  return (
                    <div key={m.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 whitespace-nowrap ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{m.product_name || m.notes || '—'}</p>
                        <div className="flex items-center gap-1 mt-0.5 text-[10px] text-gray-400 flex-wrap">
                          {from && <span className="text-rose-400">{from}</span>}
                          {(from || to) && <span className="text-gray-300">→</span>}
                          {to && <span className="text-green-600">{to}</span>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-bold text-primary-600">{fmtQ(m.quantity)} шт.</p>
                        <p className="text-[10px] text-gray-400">{fmtDate(m.created_at)}</p>
                        {(m.performer_name || m.performed_by_name) && <p className="text-[10px] text-gray-300">{(m.performer_name || m.performed_by_name).split(' ')[0]}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Сотрудники с остатками</h2>
          <p className="text-sm text-gray-400">Товары на руках у сотрудников</p>
        </div>
      </div>
      {loading ? <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      : data.length === 0 ? (
        <div className="card p-8 text-center text-gray-300">
          <Users size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Ни у кого нет товаров на руках</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.map(emp => {
            const totalQty = emp.items.reduce((s, i) => s + Number(i.quantity), 0);
            return (
              <div key={emp.employee_id} onClick={() => openEmployee(emp)}
                className="card p-4 flex items-center gap-3 cursor-pointer hover:bg-primary-50/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                  <Users size={18} className="text-primary-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{emp.full_name}</p>
                  <p className="text-xs text-gray-400">{emp.items.length} товаров</p>
                </div>
                <span className="text-lg font-bold text-primary-600">{totalQty} шт.</span>
                <ChevronRight size={16} className="text-gray-300" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtInventoryDate(iso) {
  return iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}

function fmtDuration(seconds) {
  const total = Number(seconds || 0);
  if (!total) return '—';
  if (total < 60) return `${Math.round(total)}с`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = Math.round(total % 60);
  if (hours > 0) return `${hours}ч ${String(minutes).padStart(2, '0')}м`;
  if (minutes > 0 && secs > 0) return `${minutes}м ${secs}с`;
  return `${minutes}м`;
}

function findInventoryNodeInTree(nodes, kind, id) {
  for (const node of nodes || []) {
    if (node.kind === kind && Number(node.id) === Number(id)) return node;
    const found = findInventoryNodeInTree(node.racks || node.rows || node.shelves || node.pallets || node.boxes || [], kind, id);
    if (found) return found;
    const nested = [
      ...(node.racks || []),
      ...(node.rows || []),
      ...(node.shelves || []),
      ...(node.pallets || []),
      ...(node.boxes || []),
    ];
    if (nested.length > 0) {
      const nestedFound = findInventoryNodeInTree(nested, kind, id);
      if (nestedFound) return nestedFound;
    }
  }
  return null;
}

function getInventoryChildren(node) {
  if (!node) return [];
  if (node.kind === 'warehouse') return [...(node.racks || []), ...(node.rows || [])];
  if (node.kind === 'rack') return node.shelves || [];
  if (node.kind === 'row') return node.pallets || [];
  if (node.kind === 'shelf' && node.uses_boxes) return node.boxes || [];
  if (node.kind === 'pallet' && node.uses_boxes) return node.boxes || [];
  return [];
}

function matchesInventorySearch(node, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    node?.name,
    node?.label,
    node?.path_label,
    node?.code,
    node?.barcode_value,
    node?.warehouse_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

function InventoryMetricCard({ label, value, sub, accent = 'default' }) {
  const tone = accent === 'primary'
    ? 'text-primary-700 bg-primary-50 border-primary-100'
    : accent === 'success'
    ? 'text-green-700 bg-green-50 border-green-100'
    : accent === 'warning'
    ? 'text-amber-700 bg-amber-50 border-amber-100'
    : 'text-gray-900 bg-white border-gray-200';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-xl font-bold mt-1">{value}</p>
      {sub ? <p className="text-xs mt-1 opacity-80">{sub}</p> : null}
    </div>
  );
}

function InventoryNodeCard({ node, onOpen }) {
  const childCount = node.kind === 'warehouse'
    ? Number(node.racks?.length || 0) + Number(node.rows?.length || 0)
    : Array.isArray(node.boxes)
    ? node.boxes.length
    : Array.isArray(node.shelves)
    ? node.shelves.length
    : Array.isArray(node.pallets)
    ? node.pallets.length
    : 0;

  const scopeLabel = node.kind === 'warehouse'
    ? node.warehouse_type === 'both' ? 'Стеллажи и паллеты' : node.warehouse_type === 'fbo' ? 'Паллетный склад' : 'Стеллажный склад'
    : node.kind === 'rack'
    ? `${childCount} полок`
    : node.kind === 'row'
    ? `${childCount} паллетов`
    : node.kind === 'shelf'
    ? node.uses_boxes ? `${childCount} коробок` : 'Полочная инвентаризация'
    : node.kind === 'pallet'
    ? node.uses_boxes ? `${childCount} коробок` : 'Паллетная инвентаризация'
    : `${Number(node.products_count || 0)} товара`;

  const lastInventoryValue = node.last_inventory_qty == null
    ? (Number(node.total_leaf_count || 0) > 1 ? `Охват ${Number(node.covered_leaf_count || 0)} / ${Number(node.total_leaf_count || 0)}` : 'Нет инвентаризации')
    : `${fmtQty(node.last_inventory_qty)} шт.`;

  return (
    <button
      onClick={() => onOpen(node)}
      className="w-full text-left rounded-2xl border border-gray-200 bg-white px-4 py-4 hover:border-primary-300 hover:bg-primary-50/40 transition-all"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">{node.label || node.name}</p>
            {(node.kind === 'shelf' || node.kind === 'pallet') && node.uses_boxes && (
              <Badge variant="warning">Коробки</Badge>
            )}
            {(node.kind === 'shelf_box' || node.kind === 'pallet_box') && (
              <Badge variant="default">Коробка</Badge>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">{scopeLabel}</p>
        </div>
        <ChevronRight size={16} className="text-gray-300 flex-shrink-0 mt-1" />
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider">Сейчас</p>
          <p className="text-sm font-bold text-gray-900 mt-1">{fmtQty(node.current_qty)} шт.</p>
        </div>
        <div className="rounded-xl bg-gray-50 px-3 py-2">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider">Последний инвент</p>
          <p className="text-sm font-bold text-gray-900 mt-1">{lastInventoryValue}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs text-gray-500">
        <span>{fmtInventoryDate(node.last_inventory_at)}</span>
        {node.last_inventory_by && <span>{node.last_inventory_by}</span>}
        {node.last_inventory_duration_seconds != null && <span>{fmtDuration(node.last_inventory_duration_seconds)}</span>}
      </div>
    </button>
  );
}

function InventoryHistoryList({ node, history, loading }) {
  const showScope = !['shelf_box', 'pallet_box'].includes(node?.kind);

  if (loading) {
    return <div className="flex items-center justify-center h-32"><Spinner size="lg" /></div>;
  }

  if (!history?.length) {
    return (
      <div className="card p-8 text-center text-gray-300">
        <Clock size={30} className="mx-auto mb-2 opacity-40" />
        <p className="text-sm">Истории инвентаризаций пока нет</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {history.map(event => (
        <div key={event.event_key} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {showScope && event.scope_label && (
                  <Badge variant="default">{event.scope_label}</Badge>
                )}
                <p className="text-sm font-semibold text-gray-900 truncate">{event.task_title || 'Инвентаризация'}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                <span>{fmtInventoryDate(event.completed_at)}</span>
                {event.employee_name && <span>{event.employee_name}</span>}
                {event.duration_seconds != null && <span>{fmtDuration(event.duration_seconds)}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-gray-400 uppercase tracking-wider">На инвенте</p>
              <p className="text-sm font-bold text-primary-700 mt-1">{fmtQty(event.counted_qty)} шт.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-400 uppercase tracking-wider">Сейчас</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{fmtQty(event.current_qty)} шт.</p>
            </div>
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[11px] text-gray-400 uppercase tracking-wider">Разница</p>
              <p className={`text-sm font-semibold mt-1 ${Number(event.delta_vs_current || 0) === 0 ? 'text-gray-900' : Number(event.delta_vs_current || 0) > 0 ? 'text-green-700' : 'text-rose-600'}`}>
                {Number(event.delta_vs_current || 0) > 0 ? '+' : ''}{fmtQty(event.delta_vs_current)} шт.
              </p>
            </div>
          </div>

          {event.products?.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Раскадровка товаров</p>
              <div className="space-y-1.5">
                {event.products.map(product => (
                  <div key={`${event.event_key}-${product.product_id}`} className="flex items-center gap-3 rounded-xl bg-primary-50/60 px-3 py-2">
                    <ProductIcon size={18} className="flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{product.product_name || 'Товар'}</p>
                      {product.product_code && <p className="text-xs text-gray-500">{product.product_code}</p>}
                    </div>
                    <span className="text-sm font-bold text-primary-700 flex-shrink-0">{fmtQty(product.quantity)} шт.</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InventorySection({ title, items, onOpen, searchQuery, emptyText }) {
  const filtered = (items || []).filter(item => matchesInventorySearch(item, searchQuery));
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
        {filtered.length > 0 && <span className="text-xs text-primary-600 font-medium">{filtered.length}</span>}
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-400 text-center">
          {emptyText}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map(item => (
            <InventoryNodeCard key={`${item.kind}-${item.id}`} node={item} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

function InventoryAnalyticsView({ selectedWarehouse }) {
  const toast = useToast();
  const [overview, setOverview] = useState({ summary: null, warehouses: [] });
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [drillPath, setDrillPath] = useState([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedWarehouse) params.warehouse_id = selectedWarehouse;
      const res = await api.get('/tasks/analytics/inventory-overview', { params });
      setOverview(res.data || { summary: null, warehouses: [] });
    } catch {
      setOverview({ summary: null, warehouses: [] });
      toast.error('Ошибка загрузки аналитики инвентаризации');
    } finally {
      setLoading(false);
    }
  }, [selectedWarehouse, toast]);

  useEffect(() => {
    setDrillPath([]);
    setHistory([]);
    setSearch('');
    setSearchInput('');
  }, [selectedWarehouse]);

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const autoWarehouseRef = !drillPath.length && selectedWarehouse && overview.warehouses?.length === 1
    ? { kind: 'warehouse', id: overview.warehouses[0].id }
    : null;
  const currentRef = drillPath[drillPath.length - 1] || autoWarehouseRef;
  const currentNode = currentRef ? findInventoryNodeInTree(overview.warehouses || [], currentRef.kind, currentRef.id) : null;
  const currentChildren = currentNode ? getInventoryChildren(currentNode) : (overview.warehouses || []);

  useEffect(() => {
    if (!currentRef) {
      setHistory([]);
      return;
    }
    setHistoryLoading(true);
    api.get('/tasks/analytics/inventory-history', {
      params: {
        location_type: currentRef.kind,
        id: currentRef.id,
      },
    })
      .then(res => setHistory(res.data.history || []))
      .catch(() => {
        setHistory([]);
        toast.error('Ошибка загрузки истории инвентаризации');
      })
      .finally(() => setHistoryLoading(false));
  }, [currentRef?.kind, currentRef?.id, toast]);

  const openNode = (node) => {
    setDrillPath(prev => [...prev, { kind: node.kind, id: node.id }]);
  };

  const goBack = () => {
    setDrillPath(prev => prev.slice(0, -1));
  };

  const summaryCards = currentNode ? (
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-5">
      <InventoryMetricCard label="Сейчас" value={`${fmtQty(currentNode.current_qty)} шт.`} accent="primary" />
      <InventoryMetricCard
        label="Последний инвент"
        value={currentNode.last_inventory_qty == null ? 'Частично' : `${fmtQty(currentNode.last_inventory_qty)} шт.`}
        sub={currentNode.last_inventory_qty == null && Number(currentNode.total_leaf_count || 0) > 1
          ? `Охват ${Number(currentNode.covered_leaf_count || 0)} / ${Number(currentNode.total_leaf_count || 0)}`
          : null}
        accent="success"
      />
      <InventoryMetricCard label="Последний раз" value={fmtInventoryDate(currentNode.last_inventory_at)} accent="warning" />
      <InventoryMetricCard label="Кто делал" value={currentNode.last_inventory_by || '—'} />
      <InventoryMetricCard label="Время" value={fmtDuration(currentNode.last_inventory_duration_seconds)} />
    </div>
  ) : (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
      <InventoryMetricCard label="Складов" value={overview.summary?.warehouses_count || 0} accent="primary" />
      <InventoryMetricCard label="Стеллажей и рядов" value={`${overview.summary?.racks_count || 0} / ${overview.summary?.rows_count || 0}`} />
      <InventoryMetricCard label="Полок, паллет, коробок" value={`${overview.summary?.shelves_count || 0} / ${overview.summary?.pallets_count || 0} / ${overview.summary?.boxes_count || 0}`} accent="success" />
      <InventoryMetricCard label="Последняя инвентаризация" value={fmtInventoryDate(overview.summary?.last_inventory_at)} accent="warning" />
    </div>
  );

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{currentNode ? (currentNode.label || currentNode.name) : 'Инвентаризация'}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {currentNode
              ? 'Последняя инвентаризация, текущий остаток и история по выбранному узлу'
              : 'История инвентаризаций по складам, стеллажам, паллетам и коробкам'}
          </p>
        </div>
        {drillPath.length > 0 && (
          <Button variant="outline" size="sm" icon={<ArrowLeft size={15} />} onClick={goBack}>
            Назад
          </Button>
        )}
      </div>

      {summaryCards}

      <form className="flex gap-2 mb-5" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }}>
        <div className="relative flex-1">
          <Input
            placeholder={currentNode ? 'Поиск по текущему уровню...' : 'Поиск по складу или ячейке...'}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            icon={<Search size={15} />}
          />
        </div>
        <Button type="submit" size="md">Найти</Button>
        {search && (
          <Button type="button" variant="ghost" size="md" onClick={() => { setSearch(''); setSearchInput(''); }}>
            Сбросить
          </Button>
        )}
      </form>

      {!currentNode ? (
        <InventorySection
          title="Склады"
          items={overview.warehouses || []}
          onOpen={openNode}
          searchQuery={search}
          emptyText="Склады не найдены"
        />
      ) : (
        <div className="space-y-6">
          {currentNode.kind === 'warehouse' && (
            <>
              <InventorySection
                title="Стеллажная зона"
                items={currentNode.racks || []}
                onOpen={openNode}
                searchQuery={search}
                emptyText="Стеллажей нет"
              />
              <InventorySection
                title="Паллетная зона"
                items={currentNode.rows || []}
                onOpen={openNode}
                searchQuery={search}
                emptyText="Рядов нет"
              />
            </>
          )}

          {currentNode.kind === 'rack' && (
            <InventorySection
              title="Полки"
              items={currentNode.shelves || []}
              onOpen={openNode}
              searchQuery={search}
              emptyText="Полок нет"
            />
          )}

          {currentNode.kind === 'row' && (
            <InventorySection
              title="Паллеты"
              items={currentNode.pallets || []}
              onOpen={openNode}
              searchQuery={search}
              emptyText="Паллетов нет"
            />
          )}

          {(currentNode.kind === 'shelf' && currentNode.uses_boxes) && (
            <InventorySection
              title="Коробки на полке"
              items={currentNode.boxes || []}
              onOpen={openNode}
              searchQuery={search}
              emptyText="Коробок нет"
            />
          )}

          {(currentNode.kind === 'pallet' && currentNode.uses_boxes) && (
            <InventorySection
              title="Коробки на паллете"
              items={currentNode.boxes || []}
              onOpen={openNode}
              searchQuery={search}
              emptyText="Коробок нет"
            />
          )}

          <div>
            <div className="flex items-center justify-between gap-3 mb-3">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">История инвентаризаций</p>
              {history.length > 0 && <span className="text-xs text-primary-600 font-medium">{history.length}</span>}
            </div>
            <InventoryHistoryList node={currentNode} history={history} loading={historyLoading} />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductStockPage() {
  const toast = useToast();
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState(null); // null = все склады
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState('warehouse_qty');
  const [sortDir, setSortDir] = useState('desc');
  const [stats, setStats] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('id') ? parseInt(searchParams.get('id')) : null;
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showEmployeeInventory, setShowEmployeeInventory] = useState(false);
  const limit = 50;

  const openProduct = (id) => {
    const p = new URLSearchParams(searchParams);
    p.set('id', id);
    setSearchParams(p);
  };
  const closeProduct = () => {
    const p = new URLSearchParams(searchParams);
    p.delete('id');
    setSearchParams(p);
  };

  // Загрузка складов
  useEffect(() => {
    api.get('/warehouse/warehouses').then(r => setWarehouses(r.data || [])).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        search,
        page,
        limit,
        sort_by: sortBy,
        sort_dir: sortDir,
        placed_only: 'true', // только товары с физическим остатком
      };
      if (selectedWarehouse) params.warehouse_id = selectedWarehouse;
      const res = await api.get('/products', { params });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch { toast.error('Ошибка загрузки'); }
    finally { setLoading(false); }
  }, [search, page, sortBy, sortDir, selectedWarehouse]);

  // Статистика по выбранному складу
  useEffect(() => {
    const params = {};
    if (selectedWarehouse) params.warehouse_id = selectedWarehouse;
    api.get('/products/stats', { params }).then(r => setStats(r.data)).catch(() => {});
  }, [selectedWarehouse]);

  useEffect(() => { load(); }, [load]);

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('desc'); }
    setPage(1);
  };

  const handleSearch = (val) => { setSearch(val); setPage(1); };
  const handleSelectWarehouse = (id) => { setSelectedWarehouse(id); setPage(1); setSearch(''); setSearchInput(''); };

  const totalPages = Math.ceil(total / limit);
  const thProps = { sortBy, sortDir, onSort: handleSort };

  const selectedWarehouseInfo = warehouses.find(w => w.id === selectedWarehouse);

  if (showEmployeeInventory) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <EmployeeInventoryView onBack={() => setShowEmployeeInventory(false)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Склады + кнопка */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => handleSelectWarehouse(null)}
            className={cn('text-xs font-semibold uppercase tracking-wider transition-all', selectedWarehouse === null ? 'text-primary-600' : 'text-gray-400 hover:text-gray-600')}>
            Все склады
          </button>
          {selectedWarehouse && <span className="text-xs text-gray-300">›</span>}
          {selectedWarehouse && <span className="text-xs font-semibold text-gray-700">{warehouses.find(w => w.id === selectedWarehouse)?.name}</span>}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setShowEmployeeInventory(true)}
          className="glass-btn text-gray-600 bg-white/50 backdrop-blur-xl border border-gray-200 rounded-[14px] hover:bg-white/70 px-4 py-2 text-sm font-medium flex items-center gap-2 transition-all"
        >
          <Users size={15} />
          С остатками
        </button>
      </div>
      <div className="mb-4">
        <div className="flex flex-wrap gap-2 w-fit">
          {warehouses.map(w => (
            <button
              key={w.id}
              onClick={() => handleSelectWarehouse(w.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all border',
                selectedWarehouse === w.id
                  ? 'glass-btn text-primary-700 bg-primary-600/8 border border-primary-600/20 backdrop-blur-xl shadow-sm'
                  : 'text-gray-500 bg-white/50 border border-gray-200 hover:bg-white/70'
              )}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>
              {w.name}
            </button>
          ))}
        </div>
      </div>

      <>
          {/* Статистика */}
          {stats && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-[14px] px-5 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                  <ProductIcon size={26} />
                </div>
                <div>
                  <p className="text-xl font-extrabold text-gray-900">{total.toLocaleString('ru-RU')}</p>
                  <p className="text-xs text-gray-400">Товаров</p>
                </div>
              </div>
              <div className="bg-white/50 backdrop-blur-xl border border-white/75 rounded-[14px] px-5 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <NavStockIcon size={26} />
                </div>
                <div>
                  <p className="text-xl font-extrabold text-gray-900">{Math.round(Number(stats.warehouse_total || 0)).toLocaleString('ru-RU')}</p>
                  <p className="text-xs text-gray-400">Остаток (шт)</p>
                </div>
              </div>
            </div>
          )}

          {/* Поиск */}
          <form className="flex gap-2 mb-3" onSubmit={e => { e.preventDefault(); handleSearch(searchInput); }}>
            <div className="relative flex-1">
              <Input
                placeholder="Поиск по названию, коду, штрих-коду..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                icon={<Search size={15} />}
              />
            </div>
            <button type="submit" className="glass-btn text-primary-700 bg-primary-600/8 backdrop-blur-xl border border-primary-600/18 rounded-[14px] hover:bg-primary-600/14 px-4 py-2 text-sm font-medium transition-all">Найти</button>
            {search && (
              <Button type="button" variant="ghost" size="md" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}>
                Сбросить
              </Button>
            )}
          </form>

          {/* Таблица */}
          <div className="card overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-400">
                <ProductIcon size={48} className="mb-2 opacity-50" />
                <p className="text-sm">
                  {selectedWarehouse
                    ? 'На этом складе нет товаров'
                    : 'Нет товаров на складах'}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <Th label="Название" sortKey="name" {...thProps} />
                      <Th label="Остаток" sortKey="warehouse_qty" {...thProps} />
                      <th>Ячейки / паллеты</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(item => (
                      <tr key={item.id} className="cursor-pointer hover:bg-primary-50/40 transition-colors" onClick={() => openProduct(item.id)}>
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${item.entity_type === 'bundle' ? 'bg-purple-50' : 'bg-primary-50'}`}>
                              {item.entity_type === 'bundle'
                                ? <BundleIcon size={18} />
                                : <ProductIcon size={18} />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 text-sm leading-tight">{item.name}</p>
                              {item.article && <p className="text-xs text-gray-400">{item.article}</p>}
                            </div>
                          </div>
                        </td>
                        <td>
                          {Number(item.warehouse_qty) > 0
                            ? <span className="text-sm font-bold text-primary-700">{Math.round(Number(item.warehouse_qty)).toLocaleString('ru-RU')} шт</span>
                            : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td>
                          {item.shelf_codes
                            ? (
                              <div className="flex flex-wrap gap-1">
                                {item.shelf_codes.split(', ').map(code => (
                                  <span key={code} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-primary-50 text-primary-700 text-xs font-mono rounded-lg border border-primary-100">
                                    <MapPin size={9} />
                                    {code}
                                  </span>
                                ))}
                              </div>
                            )
                            : <span className="text-xs text-gray-300 italic">—</span>}
                        </td>
                        <td className="w-10">
                          <button
                            onClick={e => { e.stopPropagation(); setEditProduct(item); setShowForm(true); }}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-all"
                            title="Редактировать"
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Пагинация */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3">
              <p className="text-sm text-gray-500">{(page - 1) * limit + 1}–{Math.min(page * limit, total)} из {total}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} icon={<ChevronLeft size={15} />}>Назад</Button>
                <span className="text-sm text-gray-500 px-2">{page}/{totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} icon={<ChevronRight size={15} />}>Вперёд</Button>
              </div>
            </div>
          )}

          <ProductDetailModal
            productId={selectedId}
            onClose={closeProduct}
            onEdit={product => { setEditProduct(product); setShowForm(true); }}
            onDelete={() => setReloadKey(k => k + 1)}
          />

          <ProductFormModal
            open={showForm}
            onClose={() => { setShowForm(false); setEditProduct(null); }}
            onSuccess={() => { setReloadKey(k => k + 1); load(); }}
            initial={editProduct}
          />
      </>
    </div>
  );
}

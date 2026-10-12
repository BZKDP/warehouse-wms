import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { printBarcode } from '../../../utils/printBarcode';
import { qty } from '../../../utils/fmt';
import { Plus, Pencil, Trash2, ChevronRight, Printer, Box } from 'lucide-react';
import { WarehouseIcon, RackIcon, ShelfIcon, RackBadge } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';
import { cn } from '../../../utils/cn';
import { BarcodeDisplay } from './warehouseUtils';
import { WarehouseModal, WarehouseDeleteModal, BoxWarehouseModal } from './WarehouseModals';
import { BoxDetailView } from './BoxDetailView';

// ─── Warehouse List View ──────────────────────────────────────────────────────
export function WarehouseListView({ warehouses, selectedId, onSelect, onReload, onDeleted }) {
  const [editWh, setEditWh] = useState(null);
  const [deleteWh, setDeleteWh] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  // Structure label based on type
  const structureLabel = (wh) => {
    if (wh.warehouse_type === 'box') return `${qty(wh.boxes_count)} кор.`;
    if (wh.warehouse_type === 'fbo') return `${qty(wh.rows_count)} р.`;
    if (wh.warehouse_type === 'both') return `${qty(wh.racks_count)}с · ${qty(wh.rows_count)}р`;
    return `${wh.racks_count} ст.`;
  };

  return (
    <>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex-1 flex gap-2 overflow-x-auto pb-1 bg-gray-50/80 rounded-2xl p-2 border border-gray-100"
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            const fromId = Number(e.dataTransfer.getData('wh_id'));
            const toEl = e.target.closest('[data-whid]');
            if (!toEl) return;
            const toId = Number(toEl.dataset.whid);
            if (fromId === toId) return;
            const ids = warehouses.map(w => w.id);
            const fromIdx = ids.indexOf(fromId);
            const toIdx = ids.indexOf(toId);
            if (fromIdx < 0 || toIdx < 0) return;
            ids.splice(fromIdx, 1);
            ids.splice(toIdx, 0, fromId);
            api.put('/warehouse/warehouses/reorder', { order: ids }).then(() => onReload()).catch(() => {});
          }}>
          {warehouses.map((wh, idx) => {
            const isSelected = selectedId === wh.id;
            return (
              <div
                key={wh.id}
                data-whid={wh.id}
                draggable
                onDragStart={e => { e.dataTransfer.setData('wh_id', String(wh.id)); e.target.style.opacity = '0.5'; }}
                onDragEnd={e => { e.target.style.opacity = '1'; }}
                onDragOver={e => { e.preventDefault(); e.currentTarget.style.transform = 'scale(1.05)'; }}
                onDragLeave={e => { e.currentTarget.style.transform = ''; }}
                onDrop={e => { e.currentTarget.style.transform = ''; }}
                onClick={() => onSelect(wh)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap cursor-pointer select-none group border backdrop-blur-xl',
                  isSelected
                    ? 'text-violet-700 dark:text-violet-300 border-violet-600/20 shadow-sm'
                    : 'text-gray-400 border-transparent hover:bg-white/70 dark:hover:bg-gray-800/50',
                  wh.active === false && 'opacity-50'
                )}
                style={{
                  minWidth: 'fit-content',
                  background: isSelected ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.5)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>
                <span className={wh.active === false ? 'line-through' : ''}>{wh.name}</span>
                {isSelected && (
                  <>
                    <span role="button" onClick={e => { e.stopPropagation(); setEditWh(wh); }} className="opacity-0 group-hover:opacity-70 hover:!opacity-100 cursor-pointer transition-opacity">
                      <Pencil size={11} />
                    </span>
                    <span role="button" onClick={e => { e.stopPropagation(); setDeleteWh(wh); }} className="opacity-0 group-hover:opacity-70 hover:!opacity-100 cursor-pointer transition-opacity text-rose-400">
                      <Trash2 size={11} />
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <Button variant="outline" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
          Склад
        </Button>
      </div>

      <WarehouseModal open={showCreate} onClose={() => setShowCreate(false)} onSuccess={onReload} />
      <WarehouseModal open={!!editWh} onClose={() => setEditWh(null)} warehouse={editWh} onSuccess={onReload} />
      <WarehouseDeleteModal
        open={!!deleteWh}
        warehouse={deleteWh}
        onClose={() => setDeleteWh(null)}
        onDeleted={id => {
          onDeleted?.(id);
          onReload();
        }}
      />
    </>
  );
}

// ─── Shelf Cards View (Visual 2) ─────────────────────────────────────────────��
export function ShelfCardsView({ warehouse, racks, onDrillRack, onDrillShelf }) {
  const [rackDetails, setRackDetails] = useState({});
  const [loadingIds, setLoadingIds] = useState(new Set());

  const palette = [
    { bg: '#7c3aed', light: '#ede9fe', text: '#6d28d9', dot: '#8b5cf6' },
    { bg: '#2563eb', light: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
    { bg: '#0891b2', light: '#cffafe', text: '#0e7490', dot: '#06b6d4' },
    { bg: '#059669', light: '#d1fae5', text: '#047857', dot: '#10b981' },
    { bg: '#d97706', light: '#fef3c7', text: '#b45309', dot: '#f59e0b' },
    { bg: '#dc2626', light: '#fee2e2', text: '#b91c1c', dot: '#ef4444' },
    { bg: '#db2777', light: '#fce7f3', text: '#be185d', dot: '#ec4899' },
    { bg: '#4f46e5', light: '#e0e7ff', text: '#4338ca', dot: '#6366f1' },
    { bg: '#0d9488', light: '#ccfbf1', text: '#0f766e', dot: '#14b8a6' },
    { bg: '#ca8a04', light: '#fef9c3', text: '#a16207', dot: '#eab308' },
    { bg: '#9333ea', light: '#f3e8ff', text: '#7e22ce', dot: '#a855f7' },
    { bg: '#e11d48', light: '#ffe4e6', text: '#be123c', dot: '#f43f5e' },
  ];

  useEffect(() => {
    racks.forEach(rack => {
      if (!rackDetails[rack.id]) {
        setLoadingIds(prev => new Set([...prev, rack.id]));
        api.get(`/warehouse/racks/${rack.id}`).then(res => {
          setRackDetails(prev => ({ ...prev, [rack.id]: res.data.shelves || [] }));
          setLoadingIds(prev => { const s = new Set(prev); s.delete(rack.id); return s; });
        }).catch(() => {
          setLoadingIds(prev => { const s = new Set(prev); s.delete(rack.id); return s; });
        });
      }
    });
  }, [racks]);

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {racks.map((rack, idx) => {
          const c = palette[idx % palette.length];
          const shelves = rackDetails[rack.id] || [];
          const isLoading = loadingIds.has(rack.id);
          const num = rack.code?.replace(/\D/g, '') || (idx + 1);
          const totalItems = shelves.reduce((s, sh) => s + Number(sh.total_items || 0), 0);
          const shelvesCount = Number(rack.shelves_count || shelves.length || 0);
          const occupiedShelves = shelves.filter(sh => Number(sh.total_items || 0) > 0).length;
          const fillPct = shelvesCount > 0 ? Math.round((occupiedShelves / shelvesCount) * 100) : 0;

          return (
            <div key={rack.id} className="card p-0 overflow-hidden hover:shadow-lg transition-all"
              style={{ borderTop: `3px solid ${c.dot}` }}>
              {/* Header */}
              <div className="p-4 pb-3 cursor-pointer" onClick={() => onDrillRack(rack)}>
                <div className="flex items-center gap-3">
                  <RackBadge number={num} size={40} color={c.bg} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 dark:text-white">{rack.name}</span>
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ color: c.text, background: c.light }}>{rack.code}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-gray-400">{shelvesCount} полок</span>
                      {rack.barcode_value && (
                        <span className="text-xs font-mono text-gray-400" onClick={e => e.stopPropagation()}>
                          <CopyBadge value={rack.barcode_value} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Shelves list */}
              <div className="border-t border-gray-100 dark:border-gray-700">
                {isLoading ? (
                  <div className="p-4 text-center text-xs text-gray-400">Загрузка...</div>
                ) : shelves.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-400">Нет полок</div>
                ) : (
                  <div className="divide-y divide-gray-50 dark:divide-gray-700">
                    {shelves.map(shelf => {
                      const items = Number(shelf.total_items || 0);
                      const dotColor = items > 0 ? c.dot : '#d1d5db';
                      return (
                        <div key={shelf.id}
                          className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary-50 dark:hover:bg-gray-800 cursor-pointer transition-colors group/shelf"
                          onClick={() => onDrillShelf ? onDrillShelf(rack, shelf) : onDrillRack(rack)}>
                          <ShelfIcon size={16} className="flex-shrink-0" />
                          <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 group-hover/shelf:text-primary-600 transition-colors">{shelf.name}</span>
                          <span className={`text-sm font-semibold tabular-nums ${items > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                            {items > 0 ? items.toLocaleString('ru-RU') + ' шт.' : '0 шт.'}
                          </span>
                          <ChevronRight size={14} className="text-gray-200 group-hover/shelf:text-primary-400 transition-colors flex-shrink-0" />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer — total + fill bar */}
              {shelves.length > 0 && (
                <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-3">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{totalItems.toLocaleString('ru-RU')} шт.</span>
                  <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${fillPct}%`, background: c.dot }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: c.text }}>{fillPct}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Box Warehouse View ─────────────────────────────────────────────────────
export function BoxWarehouseView({ warehouse }) {
  const toast = useToast();
  const [boxes, setBoxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editBox, setEditBox] = useState(null);
  const [products, setProducts] = useState([]);
  const [drillBoxId, setDrillBoxId] = useState(null);

  const loadBoxes = useCallback(async (attempt = 1) => {
    if (!warehouse) return;
    setLoading(true);
    try {
      const res = await api.get(`/fbo/box-warehouse/${warehouse.id}/boxes`);
      setBoxes(res.data);
    } catch (err) {
      if (attempt < 3) { setTimeout(() => loadBoxes(attempt + 1), 500 * attempt); return; }
      toast.error('Ошибка загрузки коробок');
    }
    finally { setLoading(false); }
  }, [warehouse?.id]);

  useEffect(() => { loadBoxes(); }, [loadBoxes]);

  // Load products for the modal
  useEffect(() => {
    api.get('/products', { params: { limit: 1000 } }).then(res => setProducts(res.data.items || [])).catch(() => {});
  }, []);

  const deleteBox = async (box) => {
    if (!confirm(`Удалить коробку "${box.name || box.barcode_value}"?`)) return;
    try {
      await api.delete(`/fbo/box-warehouse/boxes/${box.id}`);
      toast.success('Коробка удалена');
      loadBoxes();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const palette = [
    { bg: '#f59e0b', light: '#fef3c7', text: '#b45309', border: '#f59e0b' },
    { bg: '#3b82f6', light: '#dbeafe', text: '#1d4ed8', border: '#3b82f6' },
    { bg: '#10b981', light: '#d1fae5', text: '#047857', border: '#10b981' },
    { bg: '#8b5cf6', light: '#ede9fe', text: '#6d28d9', border: '#8b5cf6' },
    { bg: '#ef4444', light: '#fee2e2', text: '#b91c1c', border: '#ef4444' },
    { bg: '#ec4899', light: '#fce7f3', text: '#be185d', border: '#ec4899' },
    { bg: '#06b6d4', light: '#cffafe', text: '#0e7490', border: '#06b6d4' },
    { bg: '#14b8a6', light: '#ccfbf1', text: '#0f766e', border: '#14b8a6' },
  ];

  if (drillBoxId) {
    return (
      <BoxDetailView
        boxId={drillBoxId}
        boxType="standalone"
        onClose={() => setDrillBoxId(null)}
        onChanged={loadBoxes}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-700 dark:text-gray-200">Коробки</h2>
          <p className="text-xs text-gray-400">{boxes.length} коробок</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAdd(true)}>
          Коробка
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
      ) : boxes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
          <Box size={36} className="mb-2 opacity-30" />
          <p className="text-sm">Нет коробок</p>
          <p className="text-xs mt-1">Нажмите «Коробка» чтобы создать</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {boxes.map((box, idx) => {
            const c = palette[idx % palette.length];
            const itemsCount = Number(box.quantity || box.total_items || 0);
            return (
              <div key={box.id}
                onClick={() => setDrillBoxId(box.id)}
                className="card p-0 hover:shadow-lg transition-all group cursor-pointer overflow-hidden"
                style={{ borderLeft: `4px solid ${c.border}` }}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: c.light }}>
                      <Box size={20} style={{ color: c.text }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-gray-900 dark:text-white truncate">
                          {box.name || `Коробка #${box.id}`}
                        </span>
                      </div>
                      {box.product_name && (
                        <p className="text-xs text-gray-500 mt-0.5 truncate">{box.product_name}</p>
                      )}
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-xs font-bold" style={{ color: c.text }}>{itemsCount.toLocaleString('ru-RU')} шт.</span>
                        <span className="text-xs text-gray-400">макс. {box.box_size}</span>
                      </div>
                      {box.barcode_value && (
                        <div className="mt-2" onClick={e => e.stopPropagation()}>
                          <BarcodeDisplay value={box.barcode_value} />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={e => e.stopPropagation()}>
                      <button onClick={() => box.barcode_value && printBarcode(box.barcode_value, box.name || `Коробка #${box.id}`, '')}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                        <Printer size={13} />
                      </button>
                      <button onClick={() => setEditBox(box)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteBox(box)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BoxWarehouseModal open={showAdd} onClose={() => setShowAdd(false)} warehouseId={warehouse?.id} products={products} onSuccess={loadBoxes} />
      <BoxWarehouseModal open={!!editBox} onClose={() => setEditBox(null)} box={editBox} products={products} onSuccess={loadBoxes} />
    </div>
  );
}

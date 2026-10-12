import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { qty } from '../../utils/fmt';
import {
  Plus, Pencil, Trash2, Search,
  ChevronRight, X
} from 'lucide-react';
import { WarehouseIcon, RackBadge } from '../../components/ui/WarehouseIcons';
import api from '../../api/client';
import FBSVisualView from '../../components/visual/FBSVisualView';

import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';

import { RackModal } from './warehouse/WarehouseModals';
import { RackDetailView } from './warehouse/RackDetailView';
import { FBORowListView } from './warehouse/RowDetailView';
import { WarehouseListView, ShelfCardsView, BoxWarehouseView } from './warehouse/WarehouseListViews';

// ─── Warehouse Content (FBS / FBO / Both) ────────────────────────────────────
function WarehouseContent({ warehouse, initialRackId, initialShelfId, initialRowId, initialPalletId, initialBoxId, initialBoxType }) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Tab-scoped state for drill-down persistence
  const viewMode = searchParams.get('view') || 'cards';
  const setViewMode = (mode) => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('view', mode);
      return p;
    });
  };
  const toast = useToast();
  const [racks, setRacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddRack, setShowAddRack] = useState(false);
  const [editRack, setEditRack] = useState(null);
  const [drillRack, setDrillRack] = useState(null);
  const [quickShelfId, setQuickShelfId] = useState(null);
  const [productSearch, setProductSearch] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const wtype = warehouse?.warehouse_type;
  const hasFBS = wtype !== 'fbo' && wtype !== 'box';
  const hasFBO = wtype === 'fbo' || wtype === 'both';
  const hasBox = wtype === 'box';

  // Product search in warehouse
  const handleProductSearch = useCallback(async (q) => {
    setProductSearch(q);
    if (!q || q.length < 2) { setSearchResults(null); return; }
    setSearchLoading(true);
    try {
      const res = await api.get('/products', {
        params: { search: q, warehouse_id: warehouse?.id, placed_only: 'true', limit: 20 }
      });
      setSearchResults(res.data.items || []);
    } catch { setSearchResults([]); }
    finally { setSearchLoading(false); }
  }, [warehouse?.id]);

  useEffect(() => {
    const t = setTimeout(() => handleProductSearch(productSearch), 400);
    return () => clearTimeout(t);
  }, [productSearch]);

  useEffect(() => { setDrillRack(null); setQuickShelfId(null); }, [warehouse?.id]);

  const loadRacks = useCallback(async () => {
    if (!warehouse || !hasFBS) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await api.get('/warehouse/racks', { params: { warehouse_id: warehouse.id } });
      const rs = res.data;
      setRacks(rs);
      if (!drillRack) {
        if (initialRackId) {
          const found = rs.find(r => String(r.id) === String(initialRackId));
          if (found) setDrillRack(found);
        } else if (initialShelfId) {
          // URL has shelf but no rack — find rack containing this shelf
          try {
            const shelfRes = await api.get(`/warehouse/shelves/${initialShelfId}`);
            const rackId = shelfRes.data?.rack_id;
            if (rackId) {
              const found = rs.find(r => String(r.id) === String(rackId));
              if (found) {
                setDrillRack(found);
                setQuickShelfId(String(initialShelfId));
              }
            }
          } catch { /* shelf not found, just show warehouse */ }
        }
      }
    } catch (err) {
      console.error('[Warehouse] loadRacks error:', err.message);
      setRacks([]);
    } finally { setLoading(false); }
  }, [warehouse?.id, hasFBS]);

  useEffect(() => { loadRacks(); }, [loadRacks]);

  const handleDrillRack = (rack, shelfId = null) => {
    setDrillRack(rack);
    setQuickShelfId(shelfId);
    if (rack) {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.set('rack', rack.id);
        if (shelfId) p.set('shelf', shelfId);
        else p.delete('shelf');
        return p;
      });
    } else {
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('rack'); p.delete('shelf'); return p; });
    }
  };

  const deleteRack = async (rack) => {
    if (!confirm(`Удалить стеллаж "${rack.name}"?`)) return;
    try {
      await api.delete(`/warehouse/racks/${rack.id}`);
      toast.success('Стеллаж удалён');
      loadRacks();
    } catch { toast.error('Ошибка'); }
  };

  // If drilled into a rack
  if (drillRack) {
    return (
      <RackDetailView
        rack={drillRack}
        onBack={() => handleDrillRack(null)}
        onReload={loadRacks}
        initialShelfId={quickShelfId || initialShelfId}
        initialBoxId={initialBoxId}
        initialBoxType={initialBoxType}
        directShelf={!!quickShelfId}
      />
    );
  }

  const viewBtnStyle = (active) => ({
    display:'inline-flex', alignItems:'center', gap:5, padding:'5px 12px',
    borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', transition:'all .15s',
    border: active ? '1px solid rgba(124,58,237,0.2)' : '1px solid rgba(229,231,235,0.8)',
    background: active ? 'rgba(124,58,237,0.08)' : 'rgba(255,255,255,0.5)',
    color: active ? '#6d28d9' : '#9ca3af',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
  });

  return (
    <div>
      {/* Product search */}
      <div className="mb-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
            placeholder="Найти товар на складе..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all"
          />
          {productSearch && (
            <button onClick={() => { setProductSearch(''); setSearchResults(null); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          )}
        </div>
        {searchResults !== null && (
          <div className="mt-2 card p-0 overflow-hidden">
            {searchLoading ? (
              <div className="p-4 text-center text-sm text-gray-400">Поиск...</div>
            ) : searchResults.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">Товар не найден на этом складе</div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-700">
                {searchResults.map(item => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.code}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-primary-600">{Number(item.warehouse_qty || 0).toLocaleString('ru-RU')} шт.</p>
                    </div>
                    <div className="flex flex-wrap gap-1 max-w-[300px]">
                      {(item.shelf_codes || '').split(', ').filter(Boolean).map(code => (
                        <span key={code} className="inline-flex items-center gap-0.5 px-2 py-0.5 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-mono rounded-lg border border-primary-100 dark:border-primary-800">
                          {code}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Сводка по складу — сразу видно объём адресации */}
      {warehouse && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[
            hasFBS && { label: 'стеллажей', value: warehouse.racks_count },
            hasFBS && { label: 'полок', value: warehouse.shelves_count },
            hasFBO && { label: 'рядов', value: warehouse.rows_count },
            hasFBO && { label: 'паллет', value: warehouse.pallets_count },
            { label: 'коробок', value: warehouse.boxes_count },
          ].filter(x => x && x.value != null).map(({ label, value }) => (
            <div key={label} className="flex items-baseline gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
              <span className="text-sm font-bold text-gray-900 dark:text-white">{Number(value).toLocaleString('ru-RU')}</span>
              <span className="text-xs text-gray-400">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* FBS section */}
      {hasFBS && (
        <div className={hasFBO ? 'mb-8' : ''}>
          {hasFBO && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Стеллажи и полки</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          )}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-semibold text-gray-700 dark:text-gray-200">Стеллажи</h2>
              <p className="text-xs text-gray-400">{racks.length} стеллажей</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setViewMode('list')} style={viewBtnStyle(viewMode === 'list')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                Список
              </button>
              <button onClick={() => setViewMode('visual')} style={viewBtnStyle(viewMode === 'visual')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Визуально
              </button>
              <button onClick={() => setViewMode('cards')} style={viewBtnStyle(viewMode === 'cards')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Карточки
              </button>
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddRack(true)}>
                Стеллаж
              </Button>
            </div>
          </div>

          {/* Visual mode content */}
          {viewMode === 'visual' && hasFBS && (
            <div>
              <FBSVisualView warehouse={warehouse} onClose={() => setViewMode('list')} />
            </div>
          )}

          {/* Cards mode content */}
          {viewMode === 'cards' && (
            <ShelfCardsView warehouse={warehouse} racks={racks} onDrillRack={handleDrillRack} onDrillShelf={(rack, shelf) => handleDrillRack(rack, String(shelf.id))} />
          )}

          {/* List mode content */}
          {viewMode === 'list' && loading && (
            <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
          )}
          {viewMode === 'list' && !loading && racks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
              <WarehouseIcon size={44} className="mb-2 opacity-40" />
              <p className="text-sm">Нет стеллажей</p>
            </div>
          )}
          {viewMode === 'list' && !loading && racks.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {(() => {
                const palette = [
                  { bg: 'linear-gradient(135deg, #7c3aed, #6d28d9)', light: '#ede9fe', text: '#6d28d9', border: '#8b5cf6' },
                  { bg: 'linear-gradient(135deg, #2563eb, #1d4ed8)', light: '#dbeafe', text: '#1d4ed8', border: '#3b82f6' },
                  { bg: 'linear-gradient(135deg, #0891b2, #0e7490)', light: '#cffafe', text: '#0e7490', border: '#06b6d4' },
                  { bg: 'linear-gradient(135deg, #059669, #047857)', light: '#d1fae5', text: '#047857', border: '#10b981' },
                  { bg: 'linear-gradient(135deg, #d97706, #b45309)', light: '#fef3c7', text: '#b45309', border: '#f59e0b' },
                  { bg: 'linear-gradient(135deg, #dc2626, #b91c1c)', light: '#fee2e2', text: '#b91c1c', border: '#ef4444' },
                  { bg: 'linear-gradient(135deg, #db2777, #be185d)', light: '#fce7f3', text: '#be185d', border: '#ec4899' },
                  { bg: 'linear-gradient(135deg, #7c3aed, #5b21b6)', light: '#ede9fe', text: '#5b21b6', border: '#8b5cf6' },
                  { bg: 'linear-gradient(135deg, #4f46e5, #4338ca)', light: '#e0e7ff', text: '#4338ca', border: '#6366f1' },
                  { bg: 'linear-gradient(135deg, #0d9488, #0f766e)', light: '#ccfbf1', text: '#0f766e', border: '#14b8a6' },
                  { bg: 'linear-gradient(135deg, #ca8a04, #a16207)', light: '#fef9c3', text: '#a16207', border: '#eab308' },
                  { bg: 'linear-gradient(135deg, #9333ea, #7e22ce)', light: '#f3e8ff', text: '#7e22ce', border: '#a855f7' },
                ];
                return racks.map((rack, idx) => {
                  const shelvesCount = Number(rack.shelves_count || 0);
                  const totalItems = Number(rack.total_items || 0);
                  const c = palette[idx % palette.length];
                  const num = rack.code?.replace(/\D/g, '') || rack.number || (idx + 1);
                  return (
                    <div key={rack.id}
                      className="card p-0 hover:shadow-lg transition-all group cursor-pointer overflow-hidden"
                      style={{ borderLeft: `4px solid ${c.border}` }}
                      onClick={() => handleDrillRack(rack)}>
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <RackBadge number={num} size={48} color={c.bg} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-bold text-gray-900 dark:text-white">{rack.name}</span>
                              <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ color: c.text, background: c.light }}>{rack.code}</span>
                            </div>
                            <div className="flex items-center gap-4 mt-1.5">
                              <span className="text-xs text-gray-500">{shelvesCount} полок</span>
                              <span className="text-xs font-bold" style={{ color: c.text }}>{totalItems.toLocaleString('ru-RU')} шт.</span>
                            </div>
                            {shelvesCount > 0 && (
                              <div className="mt-2.5 flex gap-1">
                                {Array.from({ length: shelvesCount }, (_, i) => (
                                  <div key={i} className="h-1.5 rounded-full flex-1" style={{ background: c.light, maxWidth: 32 }}>
                                    <div className="h-full rounded-full" style={{ background: c.border, width: '70%', opacity: 0.7 }} />
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={e => e.stopPropagation()}>
                            <button onClick={() => setEditRack(rack)}
                              className="p-1.5 rounded-lg text-gray-300 hover:bg-gray-100 transition-all"
                              style={{ '--tw-text-opacity': 1 }}
                              onMouseEnter={e => e.currentTarget.style.color = c.text}
                              onMouseLeave={e => e.currentTarget.style.color = ''}>
                              <Pencil size={13} />
                            </button>
                            <button onClick={() => deleteRack(rack)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <ChevronRight size={18} className="text-gray-300 flex-shrink-0 transition-colors"
                            style={{ color: undefined }}
                            onMouseEnter={() => {}} />
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}

          <RackModal open={showAddRack} onClose={() => setShowAddRack(false)} warehouseId={warehouse?.id} onSuccess={loadRacks} />
          <RackModal open={!!editRack} onClose={() => setEditRack(null)} rack={editRack} onSuccess={loadRacks} />
        </div>
      )}

      {/* FBO section */}
      {hasFBO && (
        <div>
          {hasFBS && (
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Ряды и паллеты</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>
          )}
          <FBORowListView
            warehouse={warehouse}
            initialRowId={initialRowId}
            initialPalletId={initialPalletId}
            initialBoxId={initialBoxId}
            initialBoxType={initialBoxType}
            viewMode={!hasFBS ? viewMode : 'list'}
            onViewMode={!hasFBS ? setViewMode : null}
          />
        </div>
      )}

      {/* BOX section */}
      {hasBox && (
        <BoxWarehouseView warehouse={warehouse} />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function WarehousePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRackId = searchParams.get('rack');
  const initialShelfId = searchParams.get('shelf');
  const initialRowId = searchParams.get('row');
  const initialPalletId = searchParams.get('pallet');
  const initialBoxId = searchParams.get('box');
  const initialBoxType = searchParams.get('boxtype');

  const [warehouses, setWarehouses] = useState([]);
  const [selectedWh, setSelectedWh] = useState(null);
  const [loading, setLoading] = useState(true);

  const handleSelectWh = useCallback((wh) => {
    setSelectedWh(wh);
    setSearchParams(prev => {
      const p = new URLSearchParams();
      p.set('wh', String(wh.id));
      return p;
    });
  }, [setSearchParams]);

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await api.get('/warehouse/warehouses');
      setWarehouses(res.data);
      if (res.data.length > 0) {
        const urlWhId = searchParams.get('wh');
        const fromUrl = urlWhId ? res.data.find(w => w.id === +urlWhId) : null;
        setSelectedWh(prev => fromUrl || (prev ? (res.data.find(w => w.id === prev.id) || res.data[0]) : res.data[0]));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWarehouses(); }, []);

  return (
    <div className="p-6 mx-auto max-w-6xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Склады</h1>
          <p className="text-gray-500 text-sm mt-0.5">Управление складами, стеллажами и паллетами</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
      ) : (
        <>
          <div className="mb-5">
            <WarehouseListView
              warehouses={warehouses}
              selectedId={selectedWh?.id}
              onSelect={handleSelectWh}
              onReload={loadWarehouses}
              onDeleted={(deletedId) => {
                if (selectedWh?.id === deletedId) {
                  setSelectedWh(null);
                  setSearchParams(new URLSearchParams());
                }
              }}
            />
          </div>
          {selectedWh && (
            <WarehouseContent
              key={selectedWh.id}
              warehouse={selectedWh}
              initialRackId={initialRackId}
              initialShelfId={initialShelfId}
              initialRowId={initialRowId}
              initialPalletId={initialPalletId}
              initialBoxId={initialBoxId}
              initialBoxType={initialBoxType}
            />
          )}
        </>
      )}
    </div>
  );
}

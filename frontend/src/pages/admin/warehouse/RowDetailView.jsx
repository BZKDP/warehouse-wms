import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { printBarcode } from '../../../utils/printBarcode';
import { qty } from '../../../utils/fmt';
import { Plus, Pencil, Trash2, ChevronRight, ArrowLeft, Printer, X, Layers } from 'lucide-react';
import { RowBadge, PalletBadge, PalletIcon, RowIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import { useToast } from '../../../components/ui/Toast';
import { lazy, Suspense } from 'react';
const FBOVisualView = lazy(() => import('../../../components/visual/FBOVisualView'));
import { BarcodeDisplay, fmtQ } from './warehouseUtils';
import { PalletModal, RowModal } from './WarehouseModals';
import { PalletDetailView } from './PalletDetailView';

export function RowDetailView({ row, onBack, initialPalletId, initialBoxId, initialBoxType }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddPallet, setShowAddPallet] = useState(false);
  const [editPallet, setEditPallet] = useState(null);
  const [drillPallet, setDrillPallet] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/fbo/rows/${row.id}`);
      const ps = res.data.pallets || [];
      setPallets(ps);
      if (initialPalletId && !drillPallet) {
        const found = ps.find(p => String(p.id) === String(initialPalletId));
        if (found) setDrillPallet(found);
      }
    } catch { toast.error('Ошибка загрузки паллет'); }
    finally { setLoading(false); }
  }, [row.id]);

  useEffect(() => { load(); }, [load]);

  const handleDrillPallet = (p) => {
    setDrillPallet(p);
    if (p) {
      setSearchParams(prev => { const ps = new URLSearchParams(prev); ps.set('pallet', p.id); return ps; });
    } else {
      setSearchParams(prev => { const ps = new URLSearchParams(prev); ps.delete('pallet'); return ps; });
    }
  };

  const deletePallet = async (p) => {
    if (!confirm(`Удалить паллет "${p.name}"?`)) return;
    try {
      await api.delete(`/fbo/pallets/${p.id}`);
      toast.success('Паллет удалён'); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  if (drillPallet) {
    return <PalletDetailView pallet={drillPallet} onClose={() => handleDrillPallet(null)} initialBoxId={initialBoxType === 'pallet' ? initialBoxId : null} />;
  }

  const palletPalette = [
    { bg: '#7c3aed', light: '#ede9fe', text: '#6d28d9', border: '#8b5cf6' },
    { bg: '#2563eb', light: '#dbeafe', text: '#1d4ed8', border: '#3b82f6' },
    { bg: '#0891b2', light: '#cffafe', text: '#0e7490', border: '#06b6d4' },
    { bg: '#059669', light: '#d1fae5', text: '#047857', border: '#10b981' },
    { bg: '#d97706', light: '#fef3c7', text: '#b45309', border: '#f59e0b' },
    { bg: '#dc2626', light: '#fee2e2', text: '#b91c1c', border: '#ef4444' },
    { bg: '#db2777', light: '#fce7f3', text: '#be185d', border: '#ec4899' },
    { bg: '#4f46e5', light: '#e0e7ff', text: '#4338ca', border: '#6366f1' },
  ];

  return (
    <div>
      {/* Row header banner */}
      <div className="card p-0 mb-5 overflow-hidden">
        <div className="flex items-center gap-4 p-5" style={{ borderLeft: '5px solid #7c3aed' }}>
          <button onClick={onBack}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
            <ArrowLeft size={18} />
          </button>
          <RowBadge number={row.number} size={56} color="#7c3aed" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{row.name}</h2>
              <span className="text-xs font-mono text-primary-600 bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 rounded-lg">№{row.number}</span>
            </div>
            <p className="text-sm text-gray-400">{pallets.length} паллет</p>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddPallet(true)}>
            Паллет
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
      ) : pallets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
          <Layers size={36} className="mb-2 opacity-30" />
          <p className="text-sm">Нет паллет</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {pallets.map((p, idx) => {
            const c = palletPalette[idx % palletPalette.length];
            const totalItems = Number(p.total_items || 0);
            const boxesCount = Number(p.boxes_count || 0);
            const isBoxMode = p.uses_boxes !== false;
            return (
              <div key={p.id}
                className="card p-0 hover:shadow-lg transition-all group cursor-pointer overflow-hidden"
                style={{ borderLeft: `4px solid ${c.border}` }}
                onClick={() => handleDrillPallet(p)}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <PalletBadge number={p.number} size={44} color={c.bg} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-gray-900 dark:text-white">{p.name}</span>
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded-md" style={{ color: c.text, background: c.light }}>Р{row.number}П{p.number}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${isBoxMode ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                          {isBoxMode ? 'Коробки' : 'Без коробок'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        {isBoxMode && boxesCount > 0 && <span className="text-xs text-gray-500">{boxesCount} коробок</span>}
                        {!isBoxMode && <span className="text-xs text-gray-500">{qty(p.loose_items_count || 0)} товаров</span>}
                        <span className="text-xs font-bold" style={{ color: c.text }}>{totalItems.toLocaleString('ru-RU')} шт.</span>
                      </div>
                      {p.barcode_value && (
                        <div className="mt-2" onClick={e => e.stopPropagation()}>
                          <BarcodeDisplay value={p.barcode_value} />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}>
                        <button onClick={() => printBarcode(p.barcode_value, `Р${row.number}П${p.number}`, p.name)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                          <Printer size={13} />
                        </button>
                        <button onClick={() => setEditPallet(p)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deletePallet(p)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <ChevronRight size={18} className="text-gray-300 group-hover:text-primary-400 transition-colors mt-1" />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PalletModal open={showAddPallet} onClose={() => setShowAddPallet(false)} rowId={row.id} onSuccess={load} />
      <PalletModal open={!!editPallet} onClose={() => setEditPallet(null)} pallet={editPallet} onSuccess={load} />
    </div>
  );
}

// ─── Pallet Cards View (FBO analog of ShelfCardsView) ─────────────────────────
export function PalletCardsView({ rows, onDrillRow, onDrillPallet, onEditRow, onDeleteRow }) {
  const [rowDetails, setRowDetails] = useState({});
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
  ];

  useEffect(() => {
    rows.forEach(row => {
      if (!rowDetails[row.id]) {
        setLoadingIds(prev => new Set([...prev, row.id]));
        api.get(`/fbo/rows/${row.id}`).then(res => {
          setRowDetails(prev => ({ ...prev, [row.id]: res.data.pallets || [] }));
          setLoadingIds(prev => { const s = new Set(prev); s.delete(row.id); return s; });
        }).catch(() => {
          setLoadingIds(prev => { const s = new Set(prev); s.delete(row.id); return s; });
        });
      }
    });
  }, [rows]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {rows.map((row, idx) => {
        const c = palette[idx % palette.length];
        const pallets = rowDetails[row.id] || [];
        const isLoading = loadingIds.has(row.id);
        const totalItems = pallets.reduce((s, p) => s + Number(p.total_items || 0), 0);
        const palletsCount = Number(row.pallets_count || pallets.length || 0);
        const occupiedPallets = pallets.filter(p => Number(p.total_items || 0) > 0).length;
        const fillPct = palletsCount > 0 ? Math.round((occupiedPallets / palletsCount) * 100) : 0;

        return (
          <div key={row.id} className="card p-0 overflow-hidden hover:shadow-lg transition-all"
            style={{ borderTop: `3px solid ${c.dot}` }}>
            <div className="p-4 pb-3 cursor-pointer group/row" onClick={() => onDrillRow(row)}>
              <div className="flex items-center gap-3">
                <RowBadge number={row.number} size={40} color={c.bg} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900 dark:text-white">{row.name}</span>
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ color: c.text, background: c.light }}>№{row.number}</span>
                  </div>
                  <span className="text-xs text-gray-400">{palletsCount} паллет</span>
                </div>
                {(onEditRow || onDeleteRow) && (
                  <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                    {onEditRow && (
                      <button onClick={() => onEditRow(row)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                        <Pencil size={13} />
                      </button>
                    )}
                    {onDeleteRow && (
                      <button onClick={() => onDeleteRow(row)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-700">
              {isLoading ? (
                <div className="p-4 text-center text-xs text-gray-400">Загрузка...</div>
              ) : pallets.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-400">Нет паллет</div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-gray-700">
                  {pallets.map(p => {
                    const items = Number(p.total_items || 0);
                    return (
                      <div key={p.id}
                        className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-primary-50 dark:hover:bg-gray-800 cursor-pointer transition-colors group/pallet"
                        onClick={() => onDrillPallet ? onDrillPallet(row, p) : onDrillRow(row)}>
                        <PalletIcon size={16} className="flex-shrink-0" />
                        <span className="text-sm text-gray-700 dark:text-gray-300 flex-1 group-hover/pallet:text-primary-600 transition-colors">{p.name}</span>
                        <span className={`text-sm font-semibold tabular-nums ${items > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                          {items > 0 ? items.toLocaleString('ru-RU') + ' шт.' : '0 шт.'}
                        </span>
                        <ChevronRight size={14} className="text-gray-200 group-hover/pallet:text-primary-400 transition-colors flex-shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {pallets.length > 0 && (
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
  );
}

export function FBORowListView({ warehouse, initialRowId, initialPalletId, initialBoxId, initialBoxType, viewMode: extViewMode, onViewMode }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddRow, setShowAddRow] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [drillRow, setDrillRow] = useState(null);
  const [quickPalletId, setQuickPalletId] = useState(null);
  const [visualSelection, setVisualSelection] = useState(null);
  const vm = extViewMode || 'cards';

  useEffect(() => { setDrillRow(null); setQuickPalletId(null); }, [warehouse?.id]);

  const loadRows = useCallback(async () => {
    if (!warehouse) return;
    setLoading(true);
    try {
      const res = await api.get(`/fbo/warehouses/${warehouse.id}`);
      const rs = res.data.rows || [];
      setRows(rs);
      if (initialRowId && !drillRow) {
        const found = rs.find(r => String(r.id) === String(initialRowId));
        if (found) setDrillRow(found);
      }
    } catch { toast.error('Ошибка загрузки рядов'); }
    finally { setLoading(false); }
  }, [warehouse?.id]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const handleDrillRow = (row, palletId = null) => {
    setDrillRow(row);
    setQuickPalletId(palletId);
    if (row) {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.set('row', row.id);
        if (palletId) p.set('pallet', palletId);
        else p.delete('pallet');
        return p;
      });
    } else {
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('row'); p.delete('pallet'); return p; });
    }
  };

  const deleteRow = async (row) => {
    if (!confirm(`Удалить ряд "${row.name}"?`)) return;
    try {
      await api.delete(`/fbo/rows/${row.id}`);
      toast.success('Ряд удалён'); loadRows();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  if (drillRow) {
    return <RowDetailView row={drillRow} onBack={() => handleDrillRow(null)} initialPalletId={quickPalletId || initialPalletId} initialBoxId={initialBoxId} initialBoxType={initialBoxType} />;
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-700 dark:text-gray-200">Ряды</h2>
          <p className="text-xs text-gray-400">{rows.length} рядов</p>
        </div>
        <div className="flex items-center gap-2">
          {onViewMode && (
            <>
              <button onClick={() => onViewMode('list')} style={viewBtnStyle(vm === 'list')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                Список
              </button>
              <button onClick={() => onViewMode('visual')} style={viewBtnStyle(vm === 'visual')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Визуально
              </button>
              <button onClick={() => onViewMode('cards')} style={viewBtnStyle(vm === 'cards')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Карточки
              </button>
            </>
          )}
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddRow(true)}>
            Ряд
          </Button>
        </div>
      </div>

      {/* Visual mode */}
      {vm === 'visual' && (
        <div className="relative">
          {/* Mini card — left side, overlays without affecting 3D layout */}
          {visualSelection && (
            <div className="absolute left-0 top-0 z-20 w-64">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
                <div className="px-4 py-3 bg-primary-600 text-white">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide opacity-80">
                      {visualSelection.type === 'pallet' ? 'Паллет' : 'Коробка'}
                    </span>
                    <button onClick={() => setVisualSelection(null)} className="opacity-70 hover:opacity-100 transition-opacity">
                      <X size={14} />
                    </button>
                  </div>
                  <p className="font-bold text-lg mt-1 truncate">
                    {visualSelection.type === 'pallet' ? visualSelection.palletName : visualSelection.product}
                  </p>
                </div>
                <div className="p-4 space-y-3">
                  {visualSelection.type === 'box' && (
                    <>
                      <div>
                        <span className="text-[11px] text-gray-400 uppercase tracking-wide">Товар</span>
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{visualSelection.product}</p>
                      </div>
                      <div className="flex gap-4">
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Кол-во</span>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{visualSelection.qty} шт</p>
                        </div>
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Паллет</span>
                          <p className="text-sm text-gray-600 dark:text-gray-300">{visualSelection.palletName}</p>
                        </div>
                      </div>
                      {visualSelection.barcode && visualSelection.barcode !== '—' && (
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">ШК</span>
                          <p className="text-xs font-mono text-gray-500">{visualSelection.barcode}</p>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          const rowWithPallet = rows.find(r => r.pallets.some(p => p.id === visualSelection.palletId));
                          if (rowWithPallet) handleDrillRow(rowWithPallet, String(visualSelection.palletId));
                        }}
                        className="w-full mt-1 px-3 py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <ChevronRight size={14} />
                        Открыть паллет
                      </button>
                    </>
                  )}
                  {visualSelection.type === 'pallet' && (
                    <>
                      <div className="flex gap-4">
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Коробок</span>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{visualSelection.boxes.length}</p>
                        </div>
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Всего шт</span>
                          <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {fmtQ(visualSelection.boxes.reduce((s, b) => s + parseFloat(b.quantity || 0), 0))}
                          </p>
                        </div>
                      </div>
                      {visualSelection.boxes.length > 0 && (
                        <div>
                          <span className="text-[11px] text-gray-400 uppercase tracking-wide">Товары</span>
                          <div className="mt-1 space-y-1 max-h-40 overflow-y-auto">
                            {Object.entries(visualSelection.boxes.reduce((acc, b) => {
                              const name = (b.product_name || '—').replace(/GraFLab,?\s*/i, '').trim();
                              acc[name] = (acc[name] || 0) + parseFloat(b.quantity || 0);
                              return acc;
                            }, {})).map(([name, total]) => (
                              <div key={name} className="flex items-center justify-between text-xs">
                                <span className="text-gray-600 dark:text-gray-300 truncate mr-2">{name}</span>
                                <span className="font-medium text-gray-800 dark:text-gray-200 flex-shrink-0">{fmtQ(total)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => {
                          const rowWithPallet = rows.find(r => r.pallets.some(p => p.id === visualSelection.palletId));
                          if (rowWithPallet) handleDrillRow(rowWithPallet, String(visualSelection.palletId));
                        }}
                        className="w-full mt-1 px-3 py-2 bg-primary-50 hover:bg-primary-100 text-primary-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                      >
                        <ChevronRight size={14} />
                        Открыть паллет
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {/* 3D view — always full width, not affected by panel */}
          <div>
            <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:400}}><Spinner size="lg" /></div>}>
              <FBOVisualView warehouse={warehouse} onSelect={setVisualSelection} />
            </Suspense>
          </div>
        </div>
      )}

      {/* Cards mode */}
      {vm === 'cards' && (
        <PalletCardsView rows={rows} onDrillRow={handleDrillRow} onDrillPallet={(row, pallet) => handleDrillRow(row, String(pallet.id))} onEditRow={r => setEditRow(r)} onDeleteRow={deleteRow} />
      )}

      {/* List mode */}
      {vm === 'list' && loading && (
        <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
      )}
      {vm === 'list' && !loading && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
          <RowIcon size={44} className="mb-2 opacity-40" />
          <p className="text-sm">Нет рядов</p>
        </div>
      )}
      {vm === 'list' && !loading && rows.length > 0 && (
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
              { bg: 'linear-gradient(135deg, #4f46e5, #4338ca)', light: '#e0e7ff', text: '#4338ca', border: '#6366f1' },
              { bg: 'linear-gradient(135deg, #0d9488, #0f766e)', light: '#ccfbf1', text: '#0f766e', border: '#14b8a6' },
            ];
            return rows.map((row, idx) => {
              const c = palette[idx % palette.length];
              const palletsCount = Number(row.pallets_count || 0);
              const totalItems = Number(row.total_items || 0);
              return (
                <div key={row.id}
                  className="card p-0 hover:shadow-lg transition-all group cursor-pointer overflow-hidden"
                  style={{ borderLeft: `4px solid ${c.border}` }}
                  onClick={() => handleDrillRow(row)}>
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <RowBadge number={row.number} size={48} color={c.bg} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-bold text-gray-900 dark:text-white">{row.name}</span>
                          <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ color: c.text, background: c.light }}>№{row.number}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-1.5">
                          <span className="text-xs text-gray-500">{qty(palletsCount)} паллет</span>
                          {Number(row.boxes_count) > 0 && <span className="text-xs text-gray-500">{qty(row.boxes_count)} коробок</span>}
                          <span className="text-xs font-bold" style={{ color: c.text }}>{totalItems.toLocaleString('ru-RU')} шт.</span>
                        </div>
                        {palletsCount > 0 && (
                          <div className="mt-2.5 flex gap-1">
                            {Array.from({ length: Math.min(palletsCount, 8) }, (_, i) => (
                              <div key={i} className="h-1.5 rounded-full flex-1" style={{ background: c.light, maxWidth: 32 }}>
                                <div className="h-full rounded-full" style={{ background: c.border, width: '70%', opacity: 0.7 }} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditRow(row)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteRow(row)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <ChevronRight size={18} className="text-gray-300 flex-shrink-0 group-hover:text-primary-400 transition-colors" />
                    </div>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      <RowModal open={showAddRow} onClose={() => setShowAddRow(false)} warehouseId={warehouse?.id} onSuccess={loadRows} />
      <RowModal open={!!editRow} onClose={() => setEditRow(null)} row={editRow} onSuccess={loadRows} />
    </div>
  );
}

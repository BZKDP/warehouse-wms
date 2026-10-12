import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Pencil, Trash2, ChevronRight, ArrowLeft } from 'lucide-react';
import { RackBadge, ShelfBadge } from '../../../components/ui/WarehouseIcons';
import { Layers } from 'lucide-react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';
import { qty } from '../../../utils/fmt';
import { BarcodeDisplay } from './warehouseUtils';
import { ShelfModal } from './WarehouseModals';
import { ShelfDetailView } from './ShelfDetailView';

export function RackDetailView({ rack, onBack, onReload, initialShelfId, initialBoxId, initialBoxType, directShelf }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddShelf, setShowAddShelf] = useState(false);
  const [editShelf, setEditShelf] = useState(null);
  const [drillShelfId, setDrillShelfId] = useState(initialShelfId || null);
  const [copied, setCopied] = useState(false);
  const [cameDirectly] = useState(!!directShelf);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/warehouse/racks/${rack.id}`);
      setShelves(res.data.shelves || []);
    } finally {
      setLoading(false);
    }
  }, [rack.id]);

  useEffect(() => { load(); }, []);

  const handleDrillShelf = (id) => {
    setDrillShelfId(id);
    if (id) {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.set('shelf', id);
        p.delete('box');
        p.delete('boxtype');
        return p;
      });
    } else {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.delete('shelf');
        p.delete('box');
        p.delete('boxtype');
        return p;
      });
    }
  };

  const deleteShelf = async (id, name) => {
    if (!confirm(`Удалить полку "${name}"?`)) return;
    try {
      await api.delete(`/warehouse/shelves/${id}`);
      toast.success('Полка удалена');
      load();
    } catch {
      toast.error('Ошибка');
    }
  };

  const copyBarcode = (val) => {
    navigator.clipboard.writeText(val);
    setCopied(val);
    setTimeout(() => setCopied(false), 2000);
  };

  if (drillShelfId) {
    return (
      <ShelfDetailView
        shelfId={drillShelfId}
        rackId={rack.id}
        onClose={() => {
          if (cameDirectly) {
            // Came directly from warehouse → go back to warehouse, skip rack view
            onBack();
          } else {
            handleDrillShelf(null);
          }
        }}
        initialBoxId={initialBoxType === 'shelf' ? initialBoxId : null}
      />
    );
  }

  const rackNum = rack.code?.replace(/\D/g, '') || rack.number || '?';
  const shelfPalette = [
    { bg: '#7c3aed', light: '#ede9fe', text: '#6d28d9' },
    { bg: '#2563eb', light: '#dbeafe', text: '#1d4ed8' },
    { bg: '#0891b2', light: '#cffafe', text: '#0e7490' },
    { bg: '#059669', light: '#d1fae5', text: '#047857' },
    { bg: '#d97706', light: '#fef3c7', text: '#b45309' },
    { bg: '#dc2626', light: '#fee2e2', text: '#b91c1c' },
    { bg: '#db2777', light: '#fce7f3', text: '#be185d' },
    { bg: '#4f46e5', light: '#e0e7ff', text: '#4338ca' },
  ];

  return (
    <div>
      {/* Rack header — colored banner */}
      <div className="card p-0 mb-5 overflow-hidden">
        <div className="flex items-center gap-4 p-5" style={{ borderLeft: '5px solid #7c3aed' }}>
          <button onClick={onBack}
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
            <ArrowLeft size={18} />
          </button>
          <RackBadge number={rackNum} size={56} color="#7c3aed" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white">{rack.name}</h2>
              <span className="text-xs font-mono text-primary-600 bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 rounded-lg">{rack.code}</span>
            </div>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-sm text-gray-400">{shelves.length} полок</span>
              {rack.barcode_value && <BarcodeDisplay value={rack.barcode_value} />}
            </div>
          </div>
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowAddShelf(true)}>
            Добавить полку
          </Button>
        </div>
      </div>

      {/* Shelves grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner /></div>
      ) : shelves.length === 0 ? (
        <div className="text-center py-12 text-gray-400 card">
          <Layers size={36} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Нет полок</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {shelves.map((shelf, idx) => {
            const c = shelfPalette[idx % shelfPalette.length];
            const productsCount = Number(shelf.products_count || 0);
            const totalItems = Number(shelf.total_items || 0);
            const shelfNum = shelf.code?.replace(/\D/g, '').slice(-1) || (idx + 1);
            return (
              <div key={shelf.id}
                className="card p-0 hover:shadow-lg transition-all group cursor-pointer overflow-hidden"
                style={{ borderLeft: `4px solid ${c.bg}` }}
                onClick={() => handleDrillShelf(shelf.id)}>
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <ShelfBadge number={shelfNum} size={44} color={c.bg} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-bold text-gray-900 dark:text-white">{shelf.name}</span>
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded-md" style={{ color: c.text, background: c.light }}>{shelf.code}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${shelf.uses_boxes ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'}`}>
                          {shelf.uses_boxes ? 'Коробки' : 'Без коробок'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-xs text-gray-500">
                          {shelf.uses_boxes
                            ? `${Number(shelf.boxes_count || 0)} кор. · ${totalItems.toLocaleString('ru-RU')} шт.`
                            : `${productsCount} тов. · ${totalItems.toLocaleString('ru-RU')} шт.`}
                        </span>
                      </div>
                      <div className="mt-2" onClick={e => e.stopPropagation()}>
                        <BarcodeDisplay value={shelf.barcode_value} />
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditShelf(shelf)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => deleteShelf(shelf.id, shelf.name)}
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

      <ShelfModal open={showAddShelf} onClose={() => setShowAddShelf(false)} rackId={rack.id} onSuccess={load} />
      <ShelfModal open={!!editShelf} onClose={() => setEditShelf(null)} shelf={editShelf} rackId={rack.id} onSuccess={load} />
    </div>
  );
}

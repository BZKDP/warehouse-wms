import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { printBarcode } from '../../../utils/printBarcode';
import { qty } from '../../../utils/fmt';
import { Plus, Pencil, Trash2, Printer, ArrowLeft, ArrowDown } from 'lucide-react';
import { ShelfBadge, BoxIcon, ProductIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import {
  BarcodeDisplay, ShelfItemRow, getShelfBoxLabel, getBoxContentsLabel,
  printShelfBoxBarcode, printShelfBoxesBarcodes, downloadShelfBoxesPdf,
  ShelfMovements,
} from './warehouseUtils';
import { ShelfModal, BoxEditorModal } from './WarehouseModals';
import { AddProductToShelfModal } from './warehouseUtils';
import { BoxDetailView } from './BoxDetailView';

export function ShelfDetailView({ shelfId, rackId, onClose, initialBoxId }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [shelf, setShelf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [movements, setMovements] = useState([]);
  const [movMode, setMovMode] = useState('detailed');
  const [creatingBox, setCreatingBox] = useState(false);
  const [editingBox, setEditingBox] = useState(null);
  const [boxSaving, setBoxSaving] = useState(false);
  const [drillBoxId, setDrillBoxId] = useState(initialBoxId || null);

  // Set URL
  useEffect(() => {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      p.set('shelf', shelfId);
      return p;
    });
    return () => {
      setSearchParams(prev => {
        const p = new URLSearchParams(prev);
        p.delete('shelf');
        return p;
      });
    };
  }, [shelfId]);

  const load = useCallback(async () => {
    if (!shelfId) return;
    setLoading(true);
    try {
      const shelfRes = await api.get(`/warehouse/shelves/${shelfId}`);
      setShelf(shelfRes.data);
      // Movements load independently — don't block shelf display
      api.get(`/warehouse/movements?shelf_id=${shelfId}&limit=200`)
        .then(r => setMovements(r.data || []))
        .catch(() => setMovements([]));
    } catch {
      toast.error('Ошибка загрузки полки');
    } finally {
      setLoading(false);
    }
  }, [shelfId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (initialBoxId) setDrillBoxId(initialBoxId);
  }, [initialBoxId]);

  const copyBarcode = () => {
    navigator.clipboard.writeText(shelf?.barcode_value || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doPrint = () => {
    printBarcode(shelf.barcode_value, shelf.code, shelf.name);
  };

  const createShelfBox = async () => {
    setCreatingBox(true);
    try {
      await api.post(`/warehouse/shelves/${shelf.id}/box`, {});
      toast.success('Коробка создана');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setCreatingBox(false);
    }
  };

  const saveShelfBox = async (payload) => {
    if (payload.quantity > 0 && !payload.product_id) {
      toast.error('Для непустой коробки выберите товар');
      return;
    }
    setBoxSaving(true);
    try {
      await api.put(`/warehouse/shelf-boxes/${editingBox.id}`, payload);
      toast.success('Коробка обновлена');
      setEditingBox(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setBoxSaving(false);
    }
  };

  const deleteShelfBox = async (box) => {
    if (!confirm(`Удалить коробку "${box.name || box.barcode_value}"?`)) return;
    try {
      await api.delete(`/warehouse/shelf-boxes/${box.id}`);
      toast.success('Коробка удалена');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  const handlePrintAllShelfBoxes = () => {
    const result = printShelfBoxesBarcodes(shelf?.boxes || [], shelf);
    if (result.blocked) {
      toast.error('Браузер заблокировал открытие PDF (отключите блокировщик всплывающих окон)');
      return;
    }
    if (!result.printed) {
      toast.error('На полке нет коробок для печати');
      return;
    }
    if (result.skipped > 0) {
      toast.success(`Открыт PDF на ${result.printed} коробок, ${result.skipped} пропущено без штрих-кода`);
      return;
    }
    toast.success(`Открыт PDF на ${result.printed} коробок`);
  };

  const handleDownloadAllShelfBoxes = async () => {
    try {
      const result = await downloadShelfBoxesPdf(shelf?.boxes || [], shelf);
      if (!result.downloaded) {
        toast.error('На полке нет коробок для скачивания');
        return;
      }
      if (result.skipped > 0) {
        toast.success(`Скачан PDF: ${result.downloaded} коробок, ${result.skipped} пропущено без штрих-кода`);
        return;
      }
      toast.success(`Скачан PDF на ${result.downloaded} коробок`);
    } catch (err) {
      toast.error('Не удалось скачать PDF');
    }
  };

  if (drillBoxId) {
    return (
      <BoxDetailView
        boxId={drillBoxId}
        boxType="shelf"
        onClose={() => setDrillBoxId(null)}
        onChanged={load}
      />
    );
  }

  if (loading) return <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>;
  if (!shelf) return null;
  const isBoxMode = true; // всё в коробках
  const isLooseMode = false; // россыпь отключена — всё в коробках

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onClose}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
          <ArrowLeft size={18} />
        </button>
        <ShelfBadge number={shelf.code?.replace(/\D/g, '').slice(-1) || '?'} size={48} color="#059669" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{shelf.name}</h2>
            <span className="text-xs font-mono text-primary-600 bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 rounded-lg">{shelf.code}</span>
            {isBoxMode && <Badge variant="warning">Коробки</Badge>}
            {isLooseMode && <Badge variant="default">Россыпь</Badge>}
          </div>
          {shelf.notes && <p className="text-sm text-gray-400">{shelf.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)}
            className="p-2 rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-all">
            <Pencil size={15} />
          </button>
        </div>
      </div>

      {/* Barcode */}
      <div className="card p-4 mb-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Штрих-код</p>
        <BarcodeDisplay value={shelf.barcode_value} />
      </div>


      {/* Shelf contents */}
      {/* Boxes section (when uses_boxes) */}
      {isBoxMode && (
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Коробки на полке
              {shelf.boxes?.length > 0 && <span className="ml-1.5 text-primary-500">{shelf.boxes.length}</span>}
            </p>
            <div className="flex items-center gap-2">
              {shelf.boxes?.length > 0 && (
                <button
                  onClick={handleDownloadAllShelfBoxes}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-xl transition-all font-medium"
                >
                  <ArrowDown size={13} />
                  Скачать PDF
                </button>
              )}
              {shelf.boxes?.length > 0 && (
                <button
                  onClick={handlePrintAllShelfBoxes}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-primary-50 dark:bg-primary-900/30 hover:bg-primary-100 dark:hover:bg-primary-900/50 rounded-xl transition-all font-medium"
                >
                  <Printer size={13} />
                  Печать всех
                </button>
              )}
              <Button size="sm" onClick={createShelfBox} loading={creatingBox} icon={<Plus size={14} />}>
                Создать коробку
              </Button>
            </div>
          </div>
          {shelf.boxes?.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {shelf.boxes.map(box => (
                <div
                  key={box.id}
                  onClick={() => setDrillBoxId(box.id)}
                  className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl group cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-gray-600">
                    <BoxIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{getShelfBoxLabel(box, shelf)}</p>
                    <p className="text-xs text-gray-500 truncate">{getBoxContentsLabel(box)}{box.product_code && Number(box.products_count || 0) <= 1 ? ` · ${box.product_code}` : ''}</p>
                    <p className="text-xs font-mono text-gray-400">{box.barcode_value}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="flex flex-col items-end gap-1">
                      <span className={`text-xs font-semibold ${Number(box.quantity) > Number(box.box_size) ? 'text-rose-600' : 'text-gray-600 dark:text-gray-300'}`}>
                        {qty(box.quantity)} из {box.box_size || 50}
                      </span>
                      <span className="text-[11px] text-gray-400">К{box.position}</span>
                    </div>
                    <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); printShelfBoxBarcode(box, shelf); }}
                        className="p-1 text-gray-300 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all">
                        <Printer size={12} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); setEditingBox(box); }}
                        className="p-1 text-gray-300 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all">
                        <Pencil size={12} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); deleteShelfBox(box); }}
                        className="p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <BoxIcon size={36} className="mx-auto mb-1.5 opacity-40" />
              <p className="text-sm">На полке пока нет коробок</p>
            </div>
          )}
        </div>
      )}

      {/* Loose items section (shown if uses_loose or has items) */}
      {(isLooseMode || shelf.items?.length > 0) && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Товары россыпью
              {shelf.items?.length > 0 && <span className="ml-1.5 text-primary-500">{shelf.items.length}</span>}
            </p>
            {isLooseMode && (
              <button onClick={() => setAddOpen(true)}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
                <Plus size={13} />
                Добавить
              </button>
            )}
          </div>
          {shelf.items?.length > 0 ? (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {shelf.items.map(item => (
                <ShelfItemRow key={item.id} item={item} shelfId={shelf.id} onUpdate={load} />
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <ProductIcon size={36} className="mx-auto mb-1.5 opacity-40" />
              <p className="text-sm">Полка пустая</p>
            </div>
          )}
        </div>
      )}

      {/* Movement history */}
      <ShelfMovements movements={movements} mode={movMode} onModeChange={setMovMode} />

      <ShelfModal open={editOpen} onClose={() => setEditOpen(false)} shelf={shelf} rackId={shelf.rack_id} onSuccess={load} />
      <AddProductToShelfModal open={addOpen} onClose={() => setAddOpen(false)} shelfId={shelf.id} onSuccess={load} />
      <BoxEditorModal
        open={!!editingBox}
        onClose={() => setEditingBox(null)}
        box={editingBox}
        title={editingBox?.product_id || editingBox?.product_name ? 'Редактировать коробку' : 'Заполнить коробку'}
        onSave={saveShelfBox}
        loading={boxSaving}
      />
    </div>
  );
}

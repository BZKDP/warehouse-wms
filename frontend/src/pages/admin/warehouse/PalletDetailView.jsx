import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { printBarcode } from '../../../utils/printBarcode';
import { qty } from '../../../utils/fmt';
import { Plus, Pencil, Trash2, Printer, ArrowLeft, Package, ArrowDown, X } from 'lucide-react';
import { PalletBadge, BoxIcon, ProductIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';
import {
  PalletItemRow, getPalletBoxLabel, getBoxContentsLabel,
  printPalletBoxBarcode, printPalletBoxesBarcodes, downloadPalletBoxesPdf,
  LocationHistory,
} from './warehouseUtils';
import { BoxEditorModal } from './WarehouseModals';
import { BoxDetailView } from './BoxDetailView';

export function PalletDetailView({ pallet, onClose, initialBoxId }) {
  const [, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addSelected, setAddSelected] = useState(null);
  const [addQty, setAddQty] = useState('1');
  const [addSaving, setAddSaving] = useState(false);
  const [creatingBox, setCreatingBox] = useState(false);
  const [editingBox, setEditingBox] = useState(null);
  const [boxSaving, setBoxSaving] = useState(false);
  const [drillBoxId, setDrillBoxId] = useState(initialBoxId || null);
  const [movements, setMovements] = useState([]);
  const [movMode, setMovMode] = useState('detailed');
  const addDebRef = useRef(null);

  useEffect(() => {
    setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('pallet', pallet.id); return p; });
    return () => {
      setSearchParams(prev => { const p = new URLSearchParams(prev); p.delete('pallet'); return p; });
    };
  }, [pallet.id]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/fbo/pallets/${pallet.id}`);
      setData(res.data);
      // Load pallet movement history independently
      api.get(`/warehouse/movements?pallet_id=${pallet.id}&limit=200`)
        .then(r => setMovements(r.data || []))
        .catch(() => setMovements([]));
    } catch { toast.error('Ошибка загрузки паллета'); }
    finally { setLoading(false); }
  }, [pallet.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (initialBoxId) setDrillBoxId(initialBoxId);
  }, [initialBoxId]);

  const palletBarcode = pallet.barcode_value || data?.barcode_value || null;

  const doPrint = () => {
    const code = pallet.row_number ? `Р${pallet.row_number}П${pallet.number}` : (pallet.name || 'Паллет');
    printBarcode(palletBarcode, code, pallet.warehouse_name || '');
  };

  const searchProducts = (q) => {
    clearTimeout(addDebRef.current);
    setAddSearch(q);
    if (q.length < 2) { setAddResults([]); return; }
    addDebRef.current = setTimeout(async () => {
      setAddLoading(true);
      try {
        const res = await api.get('/products', { params: { search: q, limit: 10 } });
        setAddResults(res.data.items || []);
      } catch { setAddResults([]); }
      finally { setAddLoading(false); }
    }, 300);
  };

  const handleAddLooseItem = async () => {
    if (!addSelected || !addQty) return;
    setAddSaving(true);
    try {
      await api.post(`/fbo/pallets/${pallet.id}/item`, { product_id: addSelected.id, quantity: parseInt(addQty, 10) });
      toast.success('Товар добавлен на паллет');
      setShowAdd(false); setAddSearch(''); setAddResults([]); setAddSelected(null); setAddQty('1');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setAddSaving(false); }
  };

  const handleCreateBox = async () => {
    setCreatingBox(true);
    try {
      await api.post(`/fbo/pallets/${pallet.id}/box`, {});
      toast.success('Коробка создана');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setCreatingBox(false);
    }
  };

  const handleDeleteBox = async (box) => {
    if (!confirm(`Удалить коробку "${box.barcode_value}"?`)) return;
    try {
      await api.delete(`/fbo/boxes/${box.id}`);
      toast.success('Коробка удалена');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const handleSaveBox = async (payload) => {
    if (payload.quantity > 0 && !payload.product_id) {
      toast.error('Для непустой коробки выберите товар');
      return;
    }
    setBoxSaving(true);
    try {
      await api.put(`/fbo/boxes/${editingBox.id}`, payload);
      toast.success('Коробка обновлена');
      setEditingBox(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setBoxSaving(false); }
  };

  const handlePrintAllPalletBoxes = () => {
    const result = printPalletBoxesBarcodes(data?.boxes || [], data || pallet);
    if (result.blocked) {
      toast.error('Браузер заблокировал открытие PDF (отключите блокировщик всплывающих окон)');
      return;
    }
    if (!result.printed) {
      toast.error('На паллете нет коробок для печати');
      return;
    }
    if (result.skipped > 0) {
      toast.success(`Открыт PDF на ${result.printed} коробок, ${result.skipped} пропущено без штрих-кода`);
      return;
    }
    toast.success(`Открыт PDF на ${result.printed} коробок`);
  };

  const handleDownloadAllPalletBoxes = async () => {
    try {
      const result = await downloadPalletBoxesPdf(data?.boxes || [], data || pallet);
      if (!result.downloaded) {
        toast.error('На паллете нет коробок для скачивания');
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

  const isBoxMode = data?.uses_boxes !== false;

  // Сводка по товарам: группировка коробок по product_name
  const productSummary = useMemo(() => {
    if (!isBoxMode || !data?.boxes?.length) return [];
    const map = {};
    data.boxes.forEach(box => {
      const name = box.product_name || 'Без товара';
      const q = Number(box.quantity || 0);
      if (!map[name]) map[name] = { name, boxes: 0, total: 0, code: box.product_code };
      map[name].boxes += 1;
      map[name].total += q;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [data?.boxes, isBoxMode]);

  if (drillBoxId) {
    return (
      <BoxDetailView
        boxId={drillBoxId}
        boxType="pallet"
        onClose={() => setDrillBoxId(null)}
        onChanged={load}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onClose}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-all">
          <ArrowLeft size={18} />
        </button>
        <PalletBadge number={pallet.number} size={56} color="#7c3aed" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{pallet.name}</h2>
            <span className="text-xs font-mono text-primary-600 bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 rounded-lg">№{pallet.number}</span>
            <Badge variant={isBoxMode ? 'warning' : 'default'}>{isBoxMode ? 'Коробки' : 'Без коробок'}</Badge>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-gray-400">
              {loading ? '...' : isBoxMode ? `${data?.boxes?.length || 0} коробок` : 'Товар напрямую'}
            </p>
            {palletBarcode && (
              <>
                <span className="text-gray-300">·</span>
                <span className="text-sm font-mono font-semibold text-gray-600 dark:text-gray-300">{palletBarcode}</span>
                <CopyBadge value={palletBarcode} />
              </>
            )}
          </div>
        </div>
        {palletBarcode && (
          <button onClick={doPrint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-primary-100 hover:bg-primary-200 rounded-xl transition-all font-medium">
            <Printer size={13} />
            Штрих-код
          </button>
        )}
      </div>

      {/* Сводка по товарам */}
      {!loading && isBoxMode && productSummary.length > 0 && (
        <div className="card overflow-hidden mb-4">
          <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Сводка по товарам</p>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {productSummary.map(item => (
              <div key={item.name} className="flex items-center gap-3 px-4 py-2.5">
                <Package size={14} className="text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{item.name}</p>
                  {item.code && <p className="text-xs text-gray-400">{item.code}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{qty(item.total)} шт.</p>
                  <p className="text-xs text-gray-400">{qty(item.boxes)} кор. × {item.boxes > 0 ? qty(Math.round(item.total / item.boxes)) : 0}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex justify-between">
            <span className="text-xs font-semibold text-gray-500">Итого</span>
            <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{qty(productSummary.reduce((s, i) => s + i.total, 0))} шт. в {qty(productSummary.reduce((s, i) => s + i.boxes, 0))} коробках</span>
          </div>
        </div>
      )}

      {isBoxMode && <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Коробки {data?.boxes?.length > 0 && <span className="ml-1.5 text-primary-500">{data.boxes.length}</span>}
          </p>
          <div className="flex items-center gap-2">
            {data?.boxes?.length > 0 && (
              <button
                onClick={handleDownloadAllPalletBoxes}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-white dark:bg-gray-800 border border-primary-200 dark:border-primary-700 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded-xl transition-all font-medium"
              >
                <ArrowDown size={13} />
                Скачать PDF
              </button>
            )}
            {data?.boxes?.length > 0 && (
              <button
                onClick={handlePrintAllPalletBoxes}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-primary-50 hover:bg-primary-100 rounded-xl transition-all font-medium"
              >
                <Printer size={13} />
                Печать всех
              </button>
            )}
            <Button size="sm" onClick={handleCreateBox} loading={creatingBox} icon={<Plus size={14} />}>
              Создать коробку
            </Button>
          </div>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : data?.boxes?.length > 0 ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {data.boxes.map(box => (
              <div
                key={box.id}
                onClick={() => setDrillBoxId(box.id)}
                className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl group cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 flex items-center justify-center flex-shrink-0 border border-gray-100 dark:border-gray-600">
                  <BoxIcon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{getPalletBoxLabel(box, data || pallet)}</p>
                  <p className="text-xs text-gray-500 truncate">{getBoxContentsLabel(box)}{box.product_code && Number(box.products_count || 0) <= 1 ? ` · ${box.product_code}` : ''}</p>
                  <p className="text-xs text-gray-400 font-mono">{box.barcode_value}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={box.status === 'open' ? 'warning' : 'success'} dot>
                      {box.status === 'open' ? 'Открыта' : 'Закрыта'}
                    </Badge>
                    <span className="text-xs text-gray-500">{qty(box.quantity)} шт.</span>
                  </div>
                  <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); printPalletBoxBarcode(box, data || pallet); }}
                      className="p-1 text-gray-300 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all">
                      <Printer size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setEditingBox(box); }}
                      className="p-1 text-gray-300 hover:text-primary-500 hover:bg-primary-50 rounded-lg transition-all">
                      <Pencil size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteBox(box); }}
                      className="p-1 text-gray-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl">
            <BoxIcon size={36} className="mx-auto mb-2 opacity-40" />
            <p className="text-sm">Нет коробок</p>
          </div>
        )}
      </div>}

      {/* Add product directly (no boxes mode) */}
      {showAdd && !isBoxMode && (
        <div className="card p-4 mt-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Добавить товар на паллет</p>
          {!addSelected ? (
            <div className="space-y-2">
              <Input placeholder="Поиск по названию, коду, штрих-коду..." value={addSearch} onChange={e => searchProducts(e.target.value)} />
              {addLoading && <div className="text-center py-2"><Spinner size="sm" /></div>}
              {addResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1 bg-white dark:bg-gray-800 rounded-xl p-1">
                  {addResults.map(p => (
                    <button key={p.id} onClick={() => setAddSelected(p)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors flex items-center gap-2">
                      <ProductIcon size={18} className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.name}</p>
                        {p.code && <p className="text-xs text-gray-400">{p.code}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {addSearch.length >= 2 && !addLoading && addResults.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Не найдено</p>
              )}
              <button onClick={() => { setShowAdd(false); setAddSearch(''); setAddResults([]); }}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium">Отмена</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 rounded-xl">
                <ProductIcon size={18} className="flex-shrink-0" />
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200 flex-1 truncate">{addSelected.name}</p>
                <button onClick={() => setAddSelected(null)} className="text-gray-400 hover:text-gray-600">
                  <X size={14} />
                </button>
              </div>
              <div className="flex items-end gap-3">
                <div style={{ width: 100 }}>
                  <Input label="Кол-во" type="number" min="1" value={addQty} onChange={e => setAddQty(e.target.value)} />
                </div>
                <Button onClick={handleAddLooseItem} loading={addSaving} size="sm">Добавить</Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowAdd(false); setAddSelected(null); setAddSearch(''); setAddResults([]); setAddQty('1'); }}>Отмена</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loose items on pallet (pallet_items_c) */}
      {!loading && (!isBoxMode || data?.items?.length > 0) && (
        <div className="card p-4 mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Товары напрямую {data?.items?.length > 0 && <span className="ml-1.5 text-primary-500">{data.items.length}</span>}
            </p>
            {!isBoxMode && !showAdd && (
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
                <Plus size={13} /> Товар
              </button>
            )}
          </div>
          <div className="space-y-2">
            {data.items.map(item => (
              <PalletItemRow key={item.id} item={item} palletId={pallet.id} onUpdate={load} />
            ))}
          </div>
          {data?.items?.length === 0 && !isBoxMode && (
            <div className="text-center py-8 text-gray-300 bg-gray-50 dark:bg-gray-800 rounded-xl">
              <ProductIcon size={36} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Нет товаров на паллете</p>
            </div>
          )}
        </div>
      )}

      <LocationHistory movements={movements} mode={movMode} onModeChange={setMovMode} title="История паллета" />

      <BoxEditorModal
        open={!!editingBox}
        onClose={() => setEditingBox(null)}
        box={editingBox}
        title="Заполнить коробку"
        onSave={handleSaveBox}
        loading={boxSaving}
      />

    </div>
  );
}

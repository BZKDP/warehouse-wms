import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Warehouse, Plus, Pencil, Trash2, Package, Layers,
  ChevronRight, ArrowLeft, Box, Boxes, Printer
} from 'lucide-react';
import api from '../../api/client';
import { qty } from '../../utils/fmt';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import CopyBadge from '../../components/ui/CopyBadge';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../utils/cn';
import { printBarcode } from '../../utils/printBarcode';

function printPalletBarcode(pallet) {
  const code = pallet.row_number ? `Р${pallet.row_number}П${pallet.number}` : (pallet.name || 'Паллет');
  printBarcode(pallet.barcode_value, code, pallet.warehouse_name || pallet.name || '');
}

function printBoxBarcode(box, pallet) {
  printBarcode(box.barcode_value, 'Коробка', pallet?.name || '');
}

// ─── FBO Warehouse Modal (create) ─────────────────────────────────────────────
function FBOWarehouseModal({ open, onClose, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', notes: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', notes: '' });
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/fbo/warehouses', form);
      toast.success('Паллетный склад создан');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Создать паллетный склад"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary-solid" form="fbo-wh-form" type="submit" loading={loading}>Создать</Button>
      </>}
    >
      <form id="fbo-wh-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Название склада"
          placeholder="Паллетный Ижевск"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
        <Input
          label="Примечание"
          placeholder="Необязательно"
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        />
      </form>
    </Modal>
  );
}

// ─── Row Modal (add row to warehouse) ─────────────────────────────────────────
function RowModal({ open, onClose, warehouseId, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', number: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', number: '' });
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/fbo/rows', { warehouse_id: warehouseId, ...form });
      toast.success('Ряд добавлен');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить ряд"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary-solid" form="fbo-row-form" type="submit" loading={loading}>Добавить</Button>
      </>}
    >
      <form id="fbo-row-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Название"
          placeholder="Ряд 1"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
        <Input
          label="Номер"
          type="number"
          min="1"
          placeholder="1"
          value={form.number}
          onChange={e => setForm(f => ({ ...f, number: e.target.value }))}
          required
        />
      </form>
    </Modal>
  );
}

// ─── Pallet Modal (add pallet to row) ─────────────────────────────────────────
function PalletModal({ open, onClose, rowId, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', number: '', uses_boxes: 'true' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setForm({ name: '', number: '', uses_boxes: 'true' });
  }, [open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/fbo/pallets', { row_id: rowId, ...form });
      toast.success('Паллета добавлена');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Добавить паллету"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary-solid" form="fbo-pallet-form" type="submit" loading={loading}>Добавить</Button>
      </>}
    >
      <form id="fbo-pallet-form" onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Название"
          placeholder="Паллета 1"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          required
        />
        <Input
          label="Номер"
          type="number"
          min="1"
          placeholder="1"
          value={form.number}
          onChange={e => setForm(f => ({ ...f, number: e.target.value }))}
          required
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Режим хранения</label>
          <select
            value={form.uses_boxes}
            onChange={e => setForm(f => ({ ...f, uses_boxes: e.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-400"
          >
            <option value="true">Товар в коробках</option>
            <option value="false">Товар без коробок</option>
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ─── Pallet Detail Modal (boxes) ──────────────────────────────────────────────
function PalletDetailModal({ open, onClose, palletId, onReload }) {
  const toast = useToast();
  const [pallet, setPallet] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addSelected, setAddSelected] = useState(null);
  const [addQty, setAddQty] = useState('1');
  const [addSaving, setAddSaving] = useState(false);
  const [creatingBox, setCreatingBox] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState(null);
  const [editSearch, setEditSearch] = useState('');
  const [editResults, setEditResults] = useState([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editSelected, setEditSelected] = useState(null);
  const [editQty, setEditQty] = useState('0');
  const [editSaving, setEditSaving] = useState(false);
  const addDebRef = useRef(null);
  const editDebRef = useRef(null);

  const load = useCallback(async () => {
    if (!palletId) return;
    setLoading(true);
    try {
      const res = await api.get(`/fbo/pallets/${palletId}`);
      setPallet(res.data);
    } catch {
      toast.error('Ошибка загрузки паллеты');
    } finally {
      setLoading(false);
    }
  }, [palletId]);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => {
    if (!open) {
      setShowAddItem(false);
      setAddSearch('');
      setAddResults([]);
      setAddSelected(null);
      setAddQty('1');
      setEditingBoxId(null);
      setEditSearch('');
      setEditResults([]);
      setEditSelected(null);
      setEditQty('0');
    }
  }, [open]);

  const isBoxMode = pallet?.uses_boxes !== false;
  const boxes = pallet?.boxes || [];
  const items = pallet?.items || [];

  // Сводка по товарам: группировка коробок по product_name
  const productSummary = useMemo(() => {
    if (!isBoxMode || boxes.length === 0) return [];
    const map = {};
    boxes.forEach(box => {
      const name = box.product_name || 'Без товара';
      const q = Number(box.quantity || 0);
      if (!map[name]) map[name] = { name, boxes: 0, total: 0, code: box.product_code };
      map[name].boxes += 1;
      map[name].total += q;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [boxes, isBoxMode]);

  const searchProducts = (q, mode = 'add') => {
    const ref = mode === 'edit' ? editDebRef : addDebRef;
    clearTimeout(ref.current);

    if (mode === 'edit') {
      setEditSearch(q);
      if (q.length < 2) { setEditResults([]); return; }
    } else {
      setAddSearch(q);
      if (q.length < 2) { setAddResults([]); return; }
    }

    ref.current = setTimeout(async () => {
      mode === 'edit' ? setEditLoading(true) : setAddLoading(true);
      try {
        const res = await api.get('/products', { params: { search: q, limit: 10 } });
        mode === 'edit' ? setEditResults(res.data.items || []) : setAddResults(res.data.items || []);
      } catch {
        mode === 'edit' ? setEditResults([]) : setAddResults([]);
      } finally {
        mode === 'edit' ? setEditLoading(false) : setAddLoading(false);
      }
    }, 300);
  };

  const handleCreateBox = async () => {
    setCreatingBox(true);
    try {
      await api.post(`/fbo/pallets/${palletId}/box`, {});
      toast.success('Пустая коробка создана');
      load();
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setCreatingBox(false);
    }
  };

  const handleAddItem = async () => {
    if (!addSelected || !addQty) return;
    setAddSaving(true);
    try {
      await api.post(`/fbo/pallets/${palletId}/item`, { product_id: addSelected.id, quantity: parseFloat(addQty) });
      toast.success('Товар добавлен на паллет');
      setShowAddItem(false);
      setAddSearch('');
      setAddResults([]);
      setAddSelected(null);
      setAddQty('1');
      load();
      onReload?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setAddSaving(false); }
  };

  const startEditBox = (box) => {
    setEditingBoxId(box.id);
    setEditQty(String(box.quantity ?? 0));
    setEditSelected(box.product_id ? {
      id: box.product_id,
      name: box.product_name,
      code: box.product_code,
    } : null);
    setEditSearch('');
    setEditResults([]);
  };

  const handleSaveBox = async (boxId) => {
    setEditSaving(true);
    try {
      await api.put(`/fbo/boxes/${boxId}`, {
        product_id: editSelected?.id || null,
        quantity: parseInt(editQty || '0', 10) || 0,
      });
      toast.success('Коробка обновлена');
      setEditingBoxId(null);
      setEditSelected(null);
      setEditSearch('');
      setEditResults([]);
      load();
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDeleteBox = async (box) => {
    if (!confirm(`Удалить коробку ${box.barcode_value}?`)) return;
    try {
      await api.delete(`/fbo/boxes/${box.id}`);
      toast.success('Коробка удалена');
      if (editingBoxId === box.id) {
        setEditingBoxId(null);
      }
      load();
      onReload?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  const formatDate = (str) => {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Modal open={open} onClose={onClose} title={isBoxMode ? 'Паллет — коробки' : 'Паллет — товар'} size="lg">
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size="lg" />
        </div>
      ) : pallet ? (
        <div className="space-y-4">
          {/* Pallet info */}
          <div className="flex items-center gap-3 p-4 bg-primary-50 rounded-2xl">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
              <Layers size={18} className="text-primary-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-gray-900">{pallet.name}</h3>
                <span className="text-xs font-mono text-primary-600 bg-primary-100 px-2 py-0.5 rounded-lg">
                  №{pallet.number}
                </span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-lg ${isBoxMode ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {isBoxMode ? 'Коробки' : 'Без коробок'}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                {isBoxMode
                  ? `${qty(boxes.length)} коробок · ${qty(boxes.reduce((sum, box) => sum + Number(box.quantity || 0), 0))} шт.`
                  : `${qty(items.length)} товаров · ${qty(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0))} шт.`}
              </p>
            </div>
            {pallet.barcode_value && (
              <button
                onClick={() => printPalletBarcode(pallet)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-primary-600 bg-primary-100 hover:bg-primary-200 rounded-xl transition-all font-medium"
              >
                <Printer size={13} />
                Штрих-код
              </button>
            )}
          </div>
          {pallet.barcode_value && (
            <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-xl">
              <p className="text-xs text-gray-400 font-medium">Штрих-код паллета</p>
              <div className="flex items-center gap-2">
                <p className="text-sm font-mono font-bold text-gray-700">{pallet.barcode_value}</p>
                <CopyBadge value={pallet.barcode_value} />
              </div>
            </div>
          )}

          {/* Сводка по товарам */}
          {isBoxMode && productSummary.length > 0 && (
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Сводка по товарам</p>
              </div>
              <div className="divide-y divide-gray-50">
                {productSummary.map(item => (
                  <div key={item.name} className="flex items-center gap-3 px-4 py-2.5">
                    <Package size={14} className="text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                      {item.code && <p className="text-xs text-gray-400">{item.code}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-gray-900">{qty(item.total)} шт.</p>
                      <p className="text-xs text-gray-400">{qty(item.boxes)} кор. × {item.boxes > 0 ? qty(Math.round(item.total / item.boxes)) : 0}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between">
                <span className="text-xs font-semibold text-gray-500">Итого</span>
                <span className="text-xs font-bold text-gray-700">{qty(productSummary.reduce((s, i) => s + i.total, 0))} шт. в {qty(productSummary.reduce((s, i) => s + i.boxes, 0))} коробках</span>
              </div>
            </div>
          )}

          {isBoxMode ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Коробки
                  {boxes.length > 0 && <span className="ml-1.5 text-primary-500">{boxes.length}</span>}
                </p>
                <Button size="xs" onClick={handleCreateBox} loading={creatingBox}>
                  <Plus size={12} />
                  Создать коробку
                </Button>
              </div>

              {boxes.length > 0 ? (
                <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
                  {boxes.map(box => (
                    <div key={box.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center flex-shrink-0 border border-gray-100">
                          <Box size={15} className="text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900 truncate">
                              {Number(box.products_count || 0) > 1 ? `${Number(box.products_count)} товара` : (box.product_name || 'Пустая коробка')}
                            </p>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${box.quantity > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                              {qty(box.quantity)} шт.
                            </span>
                          </div>
                          {box.product_code && Number(box.products_count || 0) <= 1 && <p className="text-xs text-gray-400 mt-0.5">{box.product_code}</p>}
                          <div className="mt-1">
                            <CopyBadge value={box.barcode_value} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => printBoxBarcode(box, pallet)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all"
                            title="Печать штрих-кода коробки"
                          >
                            <Printer size={13} />
                          </button>
                          <button
                            onClick={() => Number(box.products_count || 0) > 1 ? null : startEditBox(box)}
                            disabled={Number(box.products_count || 0) > 1}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-primary-600 hover:bg-primary-50 transition-all"
                            title={Number(box.products_count || 0) > 1 ? 'Смешанную коробку редактируйте через инвентаризацию' : 'Изменить коробку'}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => handleDeleteBox(box)}
                            className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                            title="Удалить коробку"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{box.status === 'open' ? 'Открыта' : 'Закрыта'}</span>
                        <span>{formatDate(box.created_at)}</span>
                      </div>

                      {editingBoxId === box.id && (
                        <div className="rounded-xl border border-primary-100 bg-primary-50 p-3 space-y-3">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Заполнить коробку</p>
                          {!editSelected ? (
                            <>
                              <Input
                                placeholder="Поиск товара по названию, коду или штрих-коду..."
                                value={editSearch}
                                onChange={e => searchProducts(e.target.value, 'edit')}
                              />
                              {editLoading && <div className="text-center py-2"><Spinner size="sm" /></div>}
                              {editResults.length > 0 && (
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                  {editResults.map(product => (
                                    <button
                                      key={product.id}
                                      type="button"
                                      onClick={() => setEditSelected(product)}
                                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-white transition-colors flex items-center gap-2"
                                    >
                                      <Package size={14} className="text-gray-400 flex-shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">{product.name}</p>
                                        {product.code && <p className="text-xs text-gray-400">{product.code}</p>}
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {editSearch.length >= 2 && !editLoading && editResults.length === 0 && (
                                <p className="text-xs text-gray-400 text-center py-2">Не найдено</p>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl">
                                <Package size={14} className="text-primary-500 flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-gray-800 truncate">{editSelected.name}</p>
                                  {editSelected.code && <p className="text-xs text-gray-400">{editSelected.code}</p>}
                                </div>
                                <button type="button" onClick={() => setEditSelected(null)} className="text-gray-400 hover:text-gray-600">
                                  <span className="text-xs">✕</span>
                                </button>
                              </div>
                              <Input
                                label="Количество в коробке"
                                type="number"
                                min="0"
                                value={editQty}
                                onChange={e => setEditQty(e.target.value)}
                              />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={() => handleSaveBox(box.id)} loading={editSaving}>Сохранить</Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingBoxId(null)}>Отмена</Button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-300 bg-gray-50 rounded-xl">
                  <Box size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Коробок пока нет</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {showAddItem && (
                <div className="p-4 bg-primary-50 border border-primary-100 rounded-2xl space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Добавить товар на паллет</p>
                  {!addSelected ? (
                    <>
                      <Input placeholder="Поиск товара по названию, коду или штрих-коду..." value={addSearch} onChange={e => searchProducts(e.target.value, 'add')} />
                      {addLoading && <div className="text-center py-2"><Spinner size="sm" /></div>}
                      {addResults.length > 0 && (
                        <div className="max-h-48 overflow-y-auto space-y-1">
                          {addResults.map(product => (
                            <button key={product.id} type="button" onClick={() => setAddSelected(product)}
                              className="w-full text-left px-3 py-2 rounded-xl hover:bg-white transition-colors flex items-center gap-2">
                              <Package size={14} className="text-gray-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-800 truncate">{product.name}</p>
                                {product.code && <p className="text-xs text-gray-400">{product.code}</p>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl">
                        <Package size={14} className="text-primary-500 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{addSelected.name}</p>
                          {addSelected.code && <p className="text-xs text-gray-400">{addSelected.code}</p>}
                        </div>
                        <button type="button" onClick={() => setAddSelected(null)} className="text-gray-400 hover:text-gray-600"><span className="text-xs">✕</span></button>
                      </div>
                      <div className="flex items-center gap-3">
                        <Input label="Кол-во" type="number" min="0.001" step="0.001" value={addQty} onChange={e => setAddQty(e.target.value)} className="w-32" />
                        <Button onClick={handleAddItem} loading={addSaving} size="sm">Добавить</Button>
                        <Button variant="ghost" size="sm" onClick={() => { setShowAddItem(false); setAddSelected(null); setAddSearch(''); setAddResults([]); }}>Отмена</Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Товар на паллете
                    {items.length > 0 && <span className="ml-1.5 text-primary-500">{items.length}</span>}
                  </p>
                  {!showAddItem && (
                    <Button size="xs" onClick={() => setShowAddItem(true)}>
                      <Plus size={12} />
                      Товар
                    </Button>
                  )}
                </div>
                {items.length > 0 ? (
                  <div className="space-y-2">
                    {items.map(item => (
                      <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-gray-100">
                          <Package size={14} className="text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
                          {item.product_code && <p className="text-xs text-gray-400">{item.product_code}</p>}
                        </div>
                        <span className="text-sm font-semibold text-gray-700">{qty(item.quantity)} шт.</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-300 bg-gray-50 rounded-xl">
                    <Package size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">На паллете пока нет товара</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

// ─── Pallet List View (drill: row → pallets) ──────────────────────────────────
function PalletListView({ row, onBack }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pallets, setPallets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddPallet, setShowAddPallet] = useState(false);
  const detailPalletId = searchParams.get('pallet') ? Number(searchParams.get('pallet')) : null;
  const setDetailPalletId = useCallback((id) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id) { next.set('pallet', String(id)); } else { next.delete('pallet'); }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/fbo/rows/${row.id}`);
      setPallets(res.data.pallets || []);
    } catch {
      toast.error('Ошибка загрузки паллет');
    } finally {
      setLoading(false);
    }
  }, [row.id]);

  useEffect(() => { load(); }, [load]);

  const deletePallet = async (pallet) => {
    if (!confirm(`Удалить паллету "${pallet.name}"?`)) return;
    try {
      await api.delete(`/fbo/pallets/${pallet.id}`);
      toast.success('Паллета удалена');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{row.name}</h2>
            <span className="text-xs font-mono text-primary-600 bg-primary-50 px-2 py-0.5 rounded-lg">
              №{row.number}
            </span>
          </div>
          <p className="text-sm text-gray-400">{pallets.length} паллет</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowAddPallet(true)}
        >
          Паллета
        </Button>
      </div>

      {/* Pallets grid */}
      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
      ) : pallets.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
          <Layers size={36} className="mb-2 opacity-30" />
          <p className="text-sm">Нет паллет</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {pallets.map(pallet => (
            <div key={pallet.id} className="card p-4 hover:shadow-md transition-shadow group">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Layers size={18} className="text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-900">{pallet.name}</span>
                    <span className="text-xs font-mono text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                      №{pallet.number}
                    </span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${pallet.uses_boxes ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {pallet.uses_boxes ? 'Коробки' : 'Без коробок'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {pallet.uses_boxes
                      ? `${qty(pallet.boxes_count)} коробок · ${qty(pallet.total_items)} шт.`
                      : `${qty(pallet.loose_items_count)} товаров · ${qty(pallet.total_items)} шт.`}
                  </p>
                </div>
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    title="Печать штрих-кода"
                    onClick={() => printPalletBarcode(pallet)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all"
                  >
                    <Printer size={13} />
                  </button>
                  <button
                    onClick={() => deletePallet(pallet)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {pallet.barcode_value && (
                <div className="mt-1">
                  <CopyBadge value={pallet.barcode_value} />
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  size="xs"
                  className="flex-1"
                  onClick={() => setDetailPalletId(pallet.id)}
                >
                  Открыть
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={<Printer size={12} />}
                  onClick={() => printPalletBarcode(pallet)}
                  title="Печать штрих-кода паллета"
                >
                  Штрих-код
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <PalletModal
        open={showAddPallet}
        onClose={() => setShowAddPallet(false)}
        rowId={row.id}
        onSuccess={load}
      />
      <PalletDetailModal
        open={!!detailPalletId}
        onClose={() => setDetailPalletId(null)}
        palletId={detailPalletId}
        onReload={load}
      />
    </div>
  );
}

// ─── Row List View (main warehouse view) ──────────────────────────────────────
function RowListView({ warehouse }) {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddRow, setShowAddRow] = useState(false);

  const drillRowId = searchParams.get('row') ? Number(searchParams.get('row')) : null;
  const drillRow = useMemo(() => rows.find(r => r.id === drillRowId) || null, [rows, drillRowId]);

  const setDrillRow = useCallback((row) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (row) {
        next.set('row', String(row.id));
      } else {
        next.delete('row');
        next.delete('pallet');
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('row');
      next.delete('pallet');
      return next;
    }, { replace: true });
  }, [warehouse?.id]);

  const loadRows = useCallback(async () => {
    if (!warehouse) return;
    setLoading(true);
    try {
      const res = await api.get(`/fbo/warehouses/${warehouse.id}`);
      setRows(res.data.rows || []);
    } catch {
      toast.error('Ошибка загрузки рядов');
    } finally {
      setLoading(false);
    }
  }, [warehouse?.id]);

  useEffect(() => { loadRows(); }, [loadRows]);

  const deleteRow = async (row) => {
    if (!confirm(`Удалить ряд "${row.name}"? Все паллеты и коробки будут удалены.`)) return;
    try {
      await api.delete(`/fbo/rows/${row.id}`);
      toast.success('Ряд удалён');
      loadRows();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  if (drillRow) {
    return (
      <PalletListView
        row={drillRow}
        onBack={() => setDrillRow(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-gray-700">Ряды</h2>
            <span className="text-xs font-medium bg-primary-50 text-primary-600 px-2 py-0.5 rounded-lg">
              {warehouse.name}
            </span>
          </div>
          <p className="text-xs text-gray-400">{rows.length} рядов</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setShowAddRow(true)}
        >
          Ряд
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40"><Spinner size="lg" /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-400 card">
          <Boxes size={36} className="mb-2 opacity-30" />
          <p className="text-sm">Нет рядов</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {rows.map(row => (
            <div
              key={row.id}
              className="card p-4 hover:shadow-md transition-shadow group cursor-pointer"
              onClick={() => setDrillRow(row)}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                  <Package size={18} className="text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-gray-900">{row.name}</span>
                    <span className="text-xs font-mono text-primary-500 bg-primary-50 px-1.5 py-0.5 rounded">
                      №{row.number}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {qty(row.pallets_count)} паллет · {qty(row.boxes_count)} коробок
                  </p>
                </div>
                <div
                  className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    onClick={() => deleteRow(row)}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
                    title="Удалить ряд"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
      )}

      <RowModal
        open={showAddRow}
        onClose={() => setShowAddRow(false)}
        warehouseId={warehouse?.id}
        onSuccess={loadRows}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function FBOPage() {
  const toast = useToast();
  const [warehouses, setWarehouses] = useState([]);
  const [selectedWh, setSelectedWh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await api.get('/fbo/warehouses');
      setWarehouses(res.data);
      if (res.data.length > 0) {
        setSelectedWh(prev =>
          prev ? (res.data.find(w => w.id === prev.id) || res.data[0]) : res.data[0]
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);

  const deleteWarehouse = async (wh) => {
    if (!confirm(`Удалить склад "${wh.name}"? Все ряды, паллеты и коробки будут удалены.`)) return;
    const doDelete = async (force) => {
      await api.delete(`/fbo/warehouses/${wh.id}`, { params: force ? { force: true } : {} });
      toast.success('Склад удалён');
      if (selectedWh?.id === wh.id) setSelectedWh(null);
      loadWarehouses();
    };
    try {
      await doDelete(false);
    } catch (err) {
      // Склад с остатками требует второго, осознанного подтверждения.
      const data = err.response?.data;
      if (data?.code === 'WAREHOUSE_HAS_STOCK') {
        const stock = data.impact?.total_stock ?? 0;
        if (!confirm(`На складе "${wh.name}" числится ${stock} ед. товара.\n\nУдалить склад вместе с остатками? Действие необратимо.`)) return;
        try {
          await doDelete(true);
        } catch (forceErr) {
          toast.error(forceErr.response?.data?.error || 'Не удалось удалить склад');
        }
        return;
      }
      toast.error(data?.error || 'Не удалось удалить склад');
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Паллетный склад</h1>
          <p className="text-gray-500 text-sm mt-0.5">Управление рядами, паллетами и коробками</p>
        </div>
        <Button
          variant="primary"
          icon={<Plus size={16} />}
          onClick={() => setShowCreate(true)}
        >
          Создать паллетный склад
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          {/* Warehouse tabs */}
          {warehouses.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {warehouses.map(wh => (
                  <div key={wh.id} className="relative group flex items-center">
                    <button
                      onClick={() => setSelectedWh(wh)}
                      className={cn(
                        'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all whitespace-nowrap',
                        selectedWh?.id === wh.id
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'bg-white border border-gray-200 text-gray-600 hover:border-primary-300'
                      )}
                    >
                      <Warehouse size={14} />
                      {wh.name}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteWarehouse(wh); }}
                      className="ml-1 p-1 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all opacity-0 group-hover:opacity-100"
                      title="Удалить склад"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No warehouses yet */}
          {warehouses.length === 0 && (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400 card">
              <Warehouse size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">Нет паллетных складов</p>
              <p className="text-xs mt-1">Создайте первый склад, чтобы начать</p>
            </div>
          )}

          {/* Row list for selected warehouse */}
          {selectedWh && (
            <RowListView warehouse={selectedWh} />
          )}
        </>
      )}

      <FBOWarehouseModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSuccess={loadWarehouses}
      />
    </div>
  );
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, Package, Boxes, ChevronLeft, ChevronRight,
  Copy, Check, ArrowRight, Plus, Pencil, Trash2, Archive, X, MapPin,
  ArrowUp, ArrowDown, Settings2, GripVertical, Save, Star
} from 'lucide-react';
import { ProductIcon, BundleIcon, PowderIcon, SemiProductIcon, LabelIcon, SuppliesIcon, MixIcon, PackagingMaterialIcon, JarLidIcon, PetJarIcon, VacuumFlaskIcon, MembraneIcon, CapsuleEmptyIcon } from '../../components/ui/WarehouseIcons';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import Modal from '../../components/ui/Modal';
import CopyBadge from '../../components/ui/CopyBadge';
import { useToast } from '../../components/ui/Toast';
import { useAppSettings } from '../../context/AppSettingsContext';
import { usePerms } from '../../hooks/usePerms';
import { cn } from '../../utils/cn';

function fmtQty(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

// Дата для input[type=date]: ISO/timestamp → YYYY-MM-DD (по локальному времени)
function toDateInput(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayInput() { return toDateInput(new Date()); }

function StockBadge({ stock }) {
  if (stock <= 0) return <Badge variant="danger">Нет</Badge>;
  if (stock < 10) return <Badge variant="warning">{stock}</Badge>;
  return <Badge variant="success">{stock}</Badge>;
}

// ─── Barcode parsing ──────────────────────────────────────────────────────────
const MARKETPLACE_COLORS = {
  system:  { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  wb:      { bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-100' },
  ozon:    { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-100'   },
  yandex:  { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-100' },
  sber:    { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-100'  },
  prod:    { bg: 'bg-gray-50',   text: 'text-gray-600',   border: 'border-gray-100'   },
  unknown: { bg: 'bg-gray-50',   text: 'text-gray-400',   border: 'border-gray-100'   },
};

function parseBarcodes(product) {
  const result = [];
  const added = new Set();
  const sysBc = product.production_barcode || null;
  // Collect ALL barcodes from all sources
  const allBarcodes = [];
  if (sysBc) allBarcodes.push(sysBc);
  (product.barcode_list || '').split(';').map(s => s.trim()).filter(Boolean).forEach(bc => allBarcodes.push(bc));
  const mbj = Array.isArray(product.marketplace_barcodes_json) ? product.marketplace_barcodes_json : [];
  mbj.forEach(b => { if (b.value) allBarcodes.push(b.value); });
  // Deduplicate and classify
  allBarcodes.forEach(bc => {
    if (added.has(bc)) return;
    added.add(bc);
    // System barcode = production_barcode
    if (bc === sysBc) { result.push({ label: 'Системный', value: bc, kind: 'system', storeKey: 'system', isSystem: true }); return; }
    // Marketplace barcodes
    const mp = mbj.find(m => m.value === bc);
    if (mp?.type === 'ozon_1') { result.push({ label: 'Ozon ИП И.', value: bc, kind: 'ozon', storeKey: 'ozon_1' }); return; }
    if (mp?.type === 'ozon_2') { result.push({ label: 'Ozon ИП Е.', value: bc, kind: 'ozon', storeKey: 'ozon_2' }); return; }
    if (mp?.type === 'wb_1') { result.push({ label: 'WB ИП И.', value: bc, kind: 'wb', storeKey: 'wb_1' }); return; }
    if (mp?.type === 'wb_2') { result.push({ label: 'WB ИП Е.', value: bc, kind: 'wb', storeKey: 'wb_2' }); return; }
    if (mp?.type === 'wb') { result.push({ label: 'WB', value: bc, kind: 'wb' }); return; }
    if (mp?.type === 'ozon' || bc.startsWith('OZN')) { result.push({ label: 'Ozon', value: bc, kind: 'ozon' }); return; }
    if (bc.startsWith('MRKT')) { result.push({ label: 'Яндекс Маркет', value: bc, kind: 'yandex' }); return; }
    if (bc.startsWith('SBER')) { result.push({ label: 'СберМегаМаркет', value: bc, kind: 'sber' }); return; }
    // Unclassified
    result.push({ label: null, value: bc, kind: 'unknown' });
  });
  return result;
}

function parsePrices(sourceJson) {
  if (!sourceJson?.salePrices) return [];
  const WANTED = ['Цена продажи', 'Себестоимость', 'Цена Ozon после скидки', 'Цена Ozon до скидки', 'Цена WB ИП до скидки', 'Цена WB ИП после скидки', 'СберМегаМаркет'];
  return sourceJson.salePrices
    .filter(p => WANTED.includes(p.priceType?.name) && p.value > 0)
    .map(p => ({
      name: p.priceType.name,
      value: (p.value / 100).toLocaleString('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }),
    }));
}

const MAT_GROUP_ICONS = {
  'порошки': PowderIcon, 'полуфабрикаты': SemiProductIcon, 'этикетки': LabelIcon,
  'смеси': MixIcon, 'расходники': SuppliesIcon, 'другое': PackagingMaterialIcon,
};
const SUPPLY_ICON_KEYS = { 'мембран': MembraneIcon, 'крышк': JarLidIcon, 'капсул': CapsuleEmptyIcon, 'флакон': VacuumFlaskIcon, 'дозатор': VacuumFlaskIcon, 'банк': PetJarIcon };
function matIcon(m, size = 16) {
  if (m.material_group === 'расходники') {
    const lower = (m.name || '').toLowerCase();
    for (const [k, I] of Object.entries(SUPPLY_ICON_KEYS)) { if (lower.includes(k)) return <I size={size} />; }
  }
  const I = MAT_GROUP_ICONS[m.material_group] || PackagingMaterialIcon;
  return <I size={size} />;
}

function BarcodeRow({ label, value, kind, isSystem, onDelete, onSetSystem, onEdit }) {
  const colors = MARKETPLACE_COLORS[kind] || MARKETPLACE_COLORS.unknown;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  const startEdit = () => { setDraft(value); setEditing(true); };
  const cancelEdit = () => { setDraft(value); setEditing(false); };
  const saveEdit = async () => {
    const v = draft.trim();
    if (!v || v === value) { setEditing(false); return; }
    const ok = await onEdit?.(value, v);
    if (ok !== false) setEditing(false);
  };

  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border group', isSystem ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : colors.bg, !isSystem && colors.border)}>
      <div className="w-24 flex-shrink-0">
        {isSystem ? <span className="text-xs font-semibold text-green-600">Системный</span>
          : label ? <span className={cn('text-xs font-semibold', colors.text)}>{label}</span>
          : <span className="text-xs text-gray-300 italic">—</span>}
      </div>
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); saveEdit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          }}
          className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded-lg border border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white dark:bg-gray-800"
        />
      ) : (
        <CopyBadge value={value} variant="ghost" className="flex-1 min-w-0" />
      )}
      {editing ? (
        <>
          <button onClick={saveEdit} title="Сохранить"
            className="flex-shrink-0 text-emerald-500 hover:text-emerald-600 transition-colors">
            <Check size={14} />
          </button>
          <button onClick={cancelEdit} title="Отменить"
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors">
            <X size={14} />
          </button>
        </>
      ) : (
        <>
          {!isSystem && onSetSystem && (
            <button onClick={() => onSetSystem(value)} title="Сделать системным"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-green-500 transition-all">
              <Star size={14} />
            </button>
          )}
          {onEdit && (
            <button onClick={startEdit} title="Изменить штрих-код"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-primary-500 transition-all">
              <Pencil size={14} />
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(value)} title="Удалить"
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-500 transition-all">
              <X size={14} />
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Search with autocomplete suggestions ─────────────────────────────────────
function SearchWithSuggestions({ value, onChange, onSearch, entityType }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  const fetchSuggestions = useCallback(async (q) => {
    if (!q || q.length < 2) { setSuggestions([]); return; }
    try {
      // Подсказки — по всем карточкам, без фильтра вкладки
      const res = await api.get('/products', { params: { search: q, limit: 8 } });
      setSuggestions(res.data.items || []);
    } catch {
      setSuggestions([]);
    }
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    if (v.length >= 2) {
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(v);
        setShowSuggestions(true);
      }, 300);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleSelect = (name) => {
    onChange(name);
    setSuggestions([]);
    setShowSuggestions(false);
    onSearch(name);
  };

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Enter') {
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        handleSelect(suggestions[activeIdx].name);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setActiveIdx(-1);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative flex-1" ref={containerRef}>
      <Input
        placeholder="Поиск по названию, коду, штрих-коду..."
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
        icon={<Search size={15} />}
        className="w-full"
      />
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                'w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors',
                idx === activeIdx ? 'bg-primary-50 text-primary-900' : 'hover:bg-gray-50 text-gray-800'
              )}
              onMouseDown={() => handleSelect(item.name)}
            >
              <div className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${item.entity_type === 'bundle' ? 'bg-purple-50' : 'bg-primary-50'}`}>
                {item.entity_type === 'bundle' ? <BundleIcon size={18} /> : <ProductIcon size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.name}</p>
                {item.code && <p className="text-xs text-gray-400 truncate">{item.code}</p>}
              </div>
              {(() => {
                const qty = Number(item.warehouse_qty || item.stock || 0);
                return qty > 0 ? (
                  <span className="text-xs text-green-600 font-semibold flex-shrink-0">{fmtQty(qty)} шт.</span>
                ) : null;
              })()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Добавление компонента к комплекту ───────────────────────────────────────
function AddComponentModal({ open, onClose, bundleId, onSuccess }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState('1');
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setSearch(''); setResults([]); setSelected(null); setQty('1'); }
  }, [open]);

  const doSearch = useCallback(async () => {
    if (!search.trim()) return;
    setLoading(true);
    try {
      const res = await api.get('/products', { params: { search: search.trim(), entity_type: 'product', limit: 20 } });
      setResults(res.data.items);
    } catch { toast.error('Ошибка поиска'); }
    finally { setLoading(false); }
  }, [search]);

  const handleAdd = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await api.post(`/products/${bundleId}/components`, { component_id: selected.id, quantity: parseFloat(qty) || 1 });
      toast.success('Компонент добавлен');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить компонент в комплект"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button onClick={handleAdd} loading={saving} disabled={!selected}>Добавить</Button>
      </>}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Поиск единичного товара..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            className="flex-1"
          />
          <Button onClick={doSearch} loading={loading} size="md">Найти</Button>
        </div>

        {results.length > 0 && (
          <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-100 rounded-xl p-1">
            {results.map(r => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                  selected?.id === r.id ? 'bg-primary-100 text-primary-800' : 'hover:bg-gray-50'
                )}
              >
                <p className="font-medium truncate">{r.name}</p>
                {r.code && <p className="text-xs text-gray-400">{r.code}</p>}
              </button>
            ))}
          </div>
        )}

        {selected && (
          <div className="bg-primary-50 rounded-xl px-4 py-3">
            <p className="text-xs text-primary-500 font-medium mb-1">Выбран</p>
            <p className="text-sm font-semibold text-primary-900">{selected.name}</p>
            <div className="mt-3">
              <Input
                label="Количество"
                type="number"
                min="0.001"
                step="0.001"
                value={qty}
                onChange={e => setQty(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Product Form Modal (создание/редактирование) ─────────────────────────────
const FORM_INPUT = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-300 focus:border-primary-400 transition-all';

function FormSection({ title, icon, children, className = '', action }) {
  return (
    <div className={`rounded-2xl border border-gray-100 dark:border-gray-800 overflow-hidden ${className}`}>
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
        {icon}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex-1">{title}</p>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function ProductFormModal({ open, onClose, onSuccess, initial }) {
  const toast = useToast();
  const isEdit = !!initial?.id;
  const [form, setForm] = useState({ name:'', code:'', article:'', entity_type:'product', iz_type:'', barcode_list:'', stock:'', reserve:'', created_at:'' });
  const [barcodes, setBarcodes] = useState([]);
  const [newBarcode, setNewBarcode] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({ name:initial.name||'', code:initial.code||'', article:initial.article||'', entity_type:initial.entity_type||'product', iz_type:initial.iz_type||'',
        barcode_list: '',
        stock:initial.stock!==undefined?fmtQty(initial.stock):'', reserve:initial.reserve!==undefined?fmtQty(initial.reserve):'',
        created_at: toDateInput(initial.created_at) });
      const list = (initial.barcode_list||'').split(';').map(s=>s.trim()).filter(Boolean);
      setBarcodes(list);
    } else {
      setForm({ name:'', code:'', article:'', entity_type:'product', iz_type:'', barcode_list:'', stock:'', reserve:'', created_at: todayInput() });
      setBarcodes([]);
    }
    setNewBarcode('');
  }, [open, initial]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = { ...form, barcode_list: barcodes.join(';'), stock: parseFloat(form.stock)||0, reserve: parseFloat(form.reserve)||0, created_at: form.created_at || null };
      if (isEdit) { await api.put(`/products/${initial.id}`, payload); toast.success('Товар обновлён'); }
      else { await api.post('/products', payload); toast.success('Товар добавлен'); }
      onSuccess(initial?.id || null);
      onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addBarcode = () => {
    const v = newBarcode.trim();
    if (!v) return;
    if (barcodes.includes(v)) { toast.error('Штрих-код уже добавлен'); return; }
    setBarcodes(prev => [...prev, v]);
    setNewBarcode('');
  };

  const removeBarcode = (idx) => setBarcodes(prev => prev.filter((_, i) => i !== idx));

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Редактировать товар' : 'Добавить товар'} size="full"
      footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary-solid" form="product-form" type="submit" loading={loading}>{isEdit?'Сохранить':'Добавить'}</Button></>}
    >
      <form id="product-form" onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT */}
          <div className="space-y-4">
            <FormSection title="Основное" icon={<Package size={14} className="text-gray-400" />}>
              <div className="space-y-3">
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Название *</span>
                  <input value={form.name} onChange={e => set('name', e.target.value)} required className={FORM_INPUT} /></label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Код</span>
                    <input value={form.code} onChange={e => set('code', e.target.value)} className={FORM_INPUT} /></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Артикул</span>
                    <input value={form.article} onChange={e => set('article', e.target.value)} className={FORM_INPUT} /></label>
                </div>
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Тип</span>
                  <select value={form.entity_type} onChange={e => set('entity_type', e.target.value)} className={FORM_INPUT}>
                    <option value="product">Единичный товар</option>
                    <option value="bundle">Комплект (бандл)</option>
                  </select></label>
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Тип ИЗ</span>
                  <input value={form.iz_type} onChange={e => set('iz_type', e.target.value)} placeholder="Укажите конкретный тип ИЗ" className={FORM_INPUT} /></label>
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Дата создания</span>
                  <input type="date" value={form.created_at} onChange={e => set('created_at', e.target.value)} className={FORM_INPUT} />
                  <span className="text-[10px] text-gray-400">По умолчанию сегодня — можно поставить фактическую дату</span></label>
              </div>
            </FormSection>

            <FormSection title="Остатки" icon={<span className="text-gray-400 text-sm">📊</span>}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Остаток</span>
                  <input type="number" min="0" step="0.001" value={form.stock} onChange={e => set('stock', e.target.value)} className={FORM_INPUT} /></label>
                <label className="block"><span className="text-[11px] text-gray-400 font-medium">Резерв</span>
                  <input type="number" min="0" step="0.001" value={form.reserve} onChange={e => set('reserve', e.target.value)} className={FORM_INPUT} /></label>
              </div>
            </FormSection>
          </div>

          {/* RIGHT */}
          <div className="space-y-4">
            <FormSection title={`Штрихкоды (${barcodes.length})`} icon={<span className="text-gray-400 text-sm">🏷</span>}>
              <div className="flex gap-2 mb-3">
                <input
                  type="text" value={newBarcode} onChange={e => setNewBarcode(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBarcode(); } }}
                  placeholder="Введите штрихкод и нажмите +"
                  className={`${FORM_INPUT} flex-1 font-mono`}
                />
                <button type="button" onClick={addBarcode}
                  className="px-4 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors text-sm font-bold">
                  +
                </button>
              </div>
              {barcodes.length > 0 ? (
                <div className="space-y-1.5 max-h-60 overflow-y-auto">
                  {barcodes.map((bc, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-xl group">
                      <code className="flex-1 text-sm font-mono text-gray-700 dark:text-gray-300">{bc}</code>
                      <button type="button" onClick={() => removeBarcode(i)}
                        className="text-gray-300 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-300 text-center py-4">Нет штрихкодов</p>
              )}
            </FormSection>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ─── Product Detail Modal ─────────────────────────────────────────────────────
export function ProductDetailModal({ productId, onClose, onEdit, onDelete }) {
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [nestedId, setNestedId] = useState(null);
  const [showAddComp, setShowAddComp] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newBarcode, setNewBarcode] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingShelf, setEditingShelf] = useState(null);
  const [shelfQty, setShelfQty] = useState('');
  const [shelfSaving, setShelfSaving] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [addLocLoading, setAddLocLoading] = useState(false);
  const [warehouses, setWarehouses] = useState([]);
  const [addLocForm, setAddLocForm] = useState({ warehouse_id: '', shelf_id: '', pallet_id: '', quantity: '1' });
  const [availShelves, setAvailShelves] = useState([]);
  const [availPallets, setAvailPallets] = useState([]);
  const [tcEditing, setTcEditing] = useState(false);
  const [tcOutput, setTcOutput] = useState('1');
  const [tcCost, setTcCost] = useState('');
  const [tcAddMat, setTcAddMat] = useState(false);
  const [tcMatSearch, setTcMatSearch] = useState('');
  const [tcMatResults, setTcMatResults] = useState([]);
  const [tcMatQty, setTcMatQty] = useState('1');
  const [tcEditingMat, setTcEditingMat] = useState(null);
  const [tcEditMatQty, setTcEditMatQty] = useState('');
  const toast = useToast();
  const { can } = usePerms();
  const canEditFull = can('products.edit');            // полный доступ к карточке
  const canEditBasic = canEditFull || can('products.edit_basic'); // только название и ШК

  const loadProduct = useCallback(() => {
    if (!productId) return;
    setLoading(true);
    setProduct(null);
    api.get(`/products/${productId}`)
      .then(r => {
        setProduct(r.data);
        setEditForm({
          name: r.data.name || '', code: r.data.code || '', article: r.data.article || '',
          alt_names: r.data.alt_names || '',
          entity_type: r.data.entity_type || 'product', iz_type: r.data.iz_type || '', honest_sign: !!r.data.honest_sign,
          folder_path: r.data.folder_path || '', notes: r.data.notes || '',
          created_at: toDateInput(r.data.created_at),
          stock: r.data.stock !== undefined ? fmtQty(r.data.stock) : '',
          reserve: r.data.reserve !== undefined ? fmtQty(r.data.reserve) : '',
          sale_price: r.data.sale_price != null ? String(parseFloat(r.data.sale_price)) : (() => {
            const sp = r.data.source_json?.salePrices?.find(p => p.priceType?.name === 'Цена продажи');
            return sp?.value > 0 ? String(sp.value / 100) : '';
          })(),
          cost_price: r.data.cost_price != null ? String(parseFloat(r.data.cost_price)) : (() => {
            const cp = r.data.source_json?.salePrices?.find(p => p.priceType?.name === 'Себестоимость');
            return cp?.value > 0 ? String(cp.value / 100) : '';
          })(),
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [productId]);

  useEffect(() => { setNestedId(null); loadProduct(); }, [loadProduct]);

  const handleSave = async () => {
    if (!editForm) return;
    setSaving(true);
    try {
      await api.put(`/products/${productId}`, {
        ...editForm, stock: parseFloat(editForm.stock) || 0, reserve: parseFloat(editForm.reserve) || 0,
        created_at: editForm.created_at || null,
        sale_price: editForm.sale_price !== '' ? parseFloat(editForm.sale_price) : null,
        cost_price: editForm.cost_price !== '' ? parseFloat(editForm.cost_price) : null,
      });
      toast.success('Товар сохранён');
      loadProduct();
      onEdit?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await api.delete(`/products/${productId}`);
      toast.success('Товар перенесен в архив');
      onDelete?.();
      onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка архивирования'); }
  };

  const handleShelfQtyChange = async (shelf) => {
    const newQty = parseFloat(shelfQty);
    if (isNaN(newQty) || newQty < 0) { toast.error('Некорректное количество'); return; }
    setShelfSaving(true);
    try {
      if (shelf.location_type === 'shelf') {
        await api.post(`/warehouse/shelves/${shelf.location_id}/set`, { product_id: productId, quantity: newQty });
      } else if (shelf.location_type === 'pallet') {
        await api.put(`/fbo/pallets/${shelf.location_id}/item/${productId}`, { quantity: newQty });
      }
      toast.success('Количество обновлено');
      setEditingShelf(null);
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка обновления'); }
    setShelfSaving(false);
  };

  const openAddLocation = async () => {
    setShowAddLocation(true);
    setAddLocForm({ warehouse_id: '', shelf_id: '', pallet_id: '', quantity: '1' });
    try {
      const res = await api.get('/warehouse/warehouses');
      setWarehouses(res.data || []);
    } catch {}
  };

  const onWarehouseChange = async (whId) => {
    setAddLocForm(f => ({ ...f, warehouse_id: whId, shelf_id: '', pallet_id: '' }));
    setAvailShelves([]); setAvailPallets([]);
    if (!whId) return;
    const wh = warehouses.find(w => String(w.id) === String(whId));
    const wtype = wh?.warehouse_type;
    try {
      if (wtype !== 'fbo') {
        const res = await api.get(`/warehouse/warehouses/${whId}`);
        const shelves = [];
        (res.data?.racks || []).forEach(r => (r.shelves || []).forEach(s => shelves.push({ ...s, rackName: r.name })));
        setAvailShelves(shelves);
      }
      if (wtype === 'fbo' || wtype === 'both') {
        const res = await api.get(`/fbo/warehouses/${whId}`);
        const pallets = [];
        (res.data?.rows || []).forEach(r => (r.pallets || []).forEach(p => pallets.push({ ...p, rowName: r.name })));
        setAvailPallets(pallets);
      }
    } catch {}
  };

  const handleAddLocation = async () => {
    const qty = parseFloat(addLocForm.quantity);
    if (isNaN(qty) || qty <= 0) { toast.error('Укажите количество'); return; }
    setAddLocLoading(true);
    try {
      if (addLocForm.shelf_id) {
        await api.post(`/warehouse/shelves/${addLocForm.shelf_id}/set`, { product_id: productId, quantity: qty });
      } else if (addLocForm.pallet_id) {
        await api.post(`/fbo/pallets/${addLocForm.pallet_id}/item`, { product_id: productId, quantity: qty });
      } else { toast.error('Выберите полку или паллет'); setAddLocLoading(false); return; }
      toast.success('Товар размещён');
      setShowAddLocation(false);
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    setAddLocLoading(false);
  };

  const handleDeleteComponent = async (compBcId) => {
    try {
      await api.delete(`/products/${productId}/components/${compBcId}`);
      toast.success('Компонент удалён');
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const handleDeleteBarcode = async (value) => {
    try {
      await api.delete(`/products/${productId}/barcode`, { data: { value } });
      toast.success('Штрих-код удалён');
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const handleEditBarcode = async (oldValue, newValue) => {
    try {
      await api.put(`/products/${productId}/barcode`, { oldValue, newValue });
      toast.success('Штрих-код изменён');
      loadProduct();
      onEdit?.();
      return true;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
      return false;
    }
  };

  const handleSetSystemBarcode = async (value) => {
    try {
      await api.put(`/products/${productId}/system-barcode`, { value });
      toast.success('Системный ШК установлен');
      loadProduct();
      onEdit?.();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  // ─── Tech card handlers ─────────────────────────────────────────────────
  const startTcEdit = () => {
    setTcOutput(product?.tech_card?.output_quantity?.toString() || '1');
    setTcCost(product?.tech_card?.cost != null ? String(product.tech_card.cost) : '');
    setTcEditing(true);
  };
  const saveTechCard = async () => {
    try {
      await api.put(`/products/${productId}/tech-card`, { output_quantity: tcOutput, cost: tcCost || null });
      toast.success('Техкарта сохранена');
      setTcEditing(false);
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };
  const deleteTechCard = async () => {
    try {
      await api.delete(`/products/${productId}/tech-card`);
      toast.success('Техкарта удалена');
      setTcEditing(false);
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };
  const searchMaterials = async (q) => {
    setTcMatSearch(q);
    if (q.length < 2) { setTcMatResults([]); return; }
    try {
      const res = await api.get('/materials', { params: { search: q, limit: 10 } });
      setTcMatResults(res.data?.materials || res.data || []);
    } catch { setTcMatResults([]); }
  };
  const addTcMaterial = async (matId) => {
    try {
      await api.post(`/products/${productId}/tech-card/materials`, { material_id: matId, quantity: parseFloat(tcMatQty) || 1 });
      toast.success('Материал добавлен');
      setTcAddMat(false); setTcMatSearch(''); setTcMatResults([]); setTcMatQty('1');
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };
  const updateTcMatQty = async (matId) => {
    try {
      await api.put(`/products/${productId}/tech-card/materials/${matId}`, { quantity: parseFloat(tcEditMatQty) || 0 });
      toast.success('Количество обновлено');
      setTcEditingMat(null);
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };
  const removeTcMaterial = async (matId) => {
    try {
      await api.delete(`/products/${productId}/tech-card/materials/${matId}`);
      toast.success('Материал удалён');
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  const handleAddBarcode = async () => {
    if (!newBarcode.trim()) return;
    try {
      await api.post(`/products/${productId}/barcode`, { value: newBarcode.trim() });
      toast.success('Штрих-код добавлен');
      setNewBarcode('');
      loadProduct();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка добавления'); }
  };

  const barcodes = (product ? parseBarcodes(product) : []).sort((a, b) => {
    const rank = (bc) => { if (bc.kind === 'system') return -1; if (bc.storeKey) return 0; if (bc.kind !== 'unknown') return 1; return 2; };
    return rank(a) - rank(b);
  });
  const prices = product ? parsePrices(product.source_json) : [];
  const isBundle = product?.entity_type === 'bundle';
  const physicalStock = product?.shelves?.reduce((sum, s) => sum + Number(s.quantity || 0), 0) || 0;
  const set = (k, v) => setEditForm(f => ({ ...f, [k]: v }));

  return (
    <>
      <Modal open={!!productId} onClose={onClose} size="full" title={product?.name || 'Загрузка...'}
        footer={product ? (
          <div className="flex items-center justify-between w-full">
            {!canEditFull ? <span /> : confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-amber-700 font-medium">Перенести товар в архив?</span>
                <Button variant="danger-solid" size="sm" onClick={handleDelete}>Да, в архив</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Нет</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="text-amber-600 hover:text-amber-700" icon={<Archive size={14} />} onClick={handleDelete}>В архив</Button>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              {canEditBasic && <Button loading={saving} onClick={handleSave} icon={<Save size={14} />}>Сохранить</Button>}
            </div>
          </div>
        ) : undefined}
      >
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
        ) : !product ? null : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* COLUMN 1: основное + остатки */}
            <div className="space-y-4">
              {/* Бейджи */}
              <div className="flex flex-wrap items-center gap-2">
                {isBundle ? <Badge variant="purple">Комплект</Badge> : <Badge variant="info">Единичный</Badge>}
                <Badge variant={physicalStock > 0 ? 'success' : 'danger'}>На складах: {fmtQty(physicalStock)}</Badge>
                {Number(product.reserve) > 0 && <Badge variant="warning">Резерв: {fmtQty(product.reserve)}</Badge>}
                {product.honest_sign && <Badge variant="success">Честный знак</Badge>}
              </div>

              <FormSection title="Основное" icon={<Package size={14} className="text-gray-400" />}>
                <div className="space-y-3">
                  {!canEditFull && canEditBasic && (
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      Доступны только название и штрихкоды — остальные поля только для чтения.
                    </p>
                  )}
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Название</span>
                    <input value={editForm?.name || ''} onChange={e => set('name', e.target.value)} disabled={!canEditBasic} className={FORM_INPUT} /></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Доп. названия (синонимы)</span>
                    <textarea value={editForm?.alt_names || ''} onChange={e => set('alt_names', e.target.value)} rows={2} disabled={!canEditFull}
                      placeholder="Другие названия товара — по ним ИИ тоже найдёт. По одному в строке (или через «;»)"
                      className={`${FORM_INPUT} resize-y min-h-[52px]`} />
                    <span className="text-[10px] text-gray-400">Напр.: «NAC, N-ацетилцистеин (Acetyl Cysteine) 1200 мг, 60 капсул»</span></label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Код</span>
                      <input value={editForm?.code || ''} onChange={e => set('code', e.target.value)} disabled={!canEditFull} className={FORM_INPUT} /></label>
                    <label className="block"><span className="text-[11px] text-gray-400 font-medium">Артикул</span>
                      <input value={editForm?.article || ''} onChange={e => set('article', e.target.value)} disabled={!canEditFull} className={FORM_INPUT} /></label>
                  </div>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Тип</span>
                    <select value={editForm?.entity_type || 'product'} onChange={e => set('entity_type', e.target.value)} disabled={!canEditFull} className={FORM_INPUT}>
                      <option value="product">Единичный товар</option>
                      <option value="bundle">Комплект (бандл)</option>
                    </select></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Тип ИЗ</span>
                    <input value={editForm?.iz_type || ''} onChange={e => set('iz_type', e.target.value)} disabled={!canEditFull}
                      placeholder="Укажите конкретный тип ИЗ" className={FORM_INPUT} /></label>
                  <label className="flex items-center gap-2 cursor-pointer py-1">
                    <input type="checkbox" checked={editForm?.honest_sign || false} onChange={e => set('honest_sign', e.target.checked)} disabled={!canEditFull}
                      className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="text-[11px] text-gray-400 font-medium">Честный знак</span>
                    {editForm?.honest_sign && <span className="text-[10px] text-green-600 font-semibold">Да</span>}
                  </label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Папка</span>
                    <input value={editForm?.folder_path || ''} onChange={e => set('folder_path', e.target.value)} disabled={!canEditFull} placeholder="Наш бренд/Производство" className={FORM_INPUT} /></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Дата создания</span>
                    <input type="date" value={editForm?.created_at || ''} onChange={e => set('created_at', e.target.value)} disabled={!canEditFull} className={FORM_INPUT} /></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Заметка</span>
                    <textarea value={editForm?.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} disabled={!canEditFull}
                      placeholder="Например: на складе должен называться..."
                      className={`${FORM_INPUT} resize-y min-h-[60px]`} /></label>
                </div>
              </FormSection>

              {/* Цены */}
              <FormSection title="Цены" icon={<span className="text-gray-400 text-sm">₽</span>}>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Цена продажи (₽)</span>
                    <input type="number" min="0" step="0.01" value={editForm?.sale_price || ''} onChange={e => set('sale_price', e.target.value)} disabled={!canEditFull} placeholder="0.00" className={FORM_INPUT} /></label>
                  <label className="block"><span className="text-[11px] text-gray-400 font-medium">Себестоимость (₽)</span>
                    <input type="number" min="0" step="0.01" value={editForm?.cost_price || ''} onChange={e => set('cost_price', e.target.value)} disabled={!canEditFull} placeholder="0.00" className={FORM_INPUT} /></label>
                </div>
              </FormSection>
            </div>

            {/* COLUMN 2: штрихкоды + расположение */}
            <div className="space-y-4">
              <FormSection title={`Штрихкоды (${barcodes.length})`} icon={<span className="text-gray-400 text-sm">🏷</span>}>
                {canEditBasic && (
                  <div className="flex gap-2 mb-3">
                    <input type="text" value={newBarcode} onChange={e => setNewBarcode(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddBarcode(); } }}
                      placeholder="Добавить штрихкод..." className={`${FORM_INPUT} flex-1 font-mono text-xs`} />
                    <button onClick={handleAddBarcode}
                      className="px-3 py-2 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors text-sm font-bold">+</button>
                  </div>
                )}
                {barcodes.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {barcodes.map((bc, i) => (
                      <BarcodeRow key={i} {...bc}
                        onDelete={canEditBasic ? handleDeleteBarcode : undefined}
                        onSetSystem={canEditBasic ? handleSetSystemBarcode : undefined}
                        onEdit={canEditBasic ? handleEditBarcode : undefined} />
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-300 text-center py-3">Нет штрихкодов</p>}
              </FormSection>

              <FormSection title={`Расположение (${product.shelves?.length || 0})`} icon={<span className="text-gray-400 text-sm">📍</span>}
                action={canEditFull ? <button onClick={openAddLocation} className="text-xs text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1"><Plus size={12} />Разместить</button> : null}>
                {!product.shelves?.length ? (
                  <div className="text-center py-4">
                    <p className="text-sm text-gray-300 mb-2">Не размещён на складе</p>
                    <button onClick={openAddLocation} className="text-xs text-primary-600 hover:text-primary-800 font-medium">+ Разместить на полку/паллет</button>
                  </div>
                ) : (() => {
                  // Группировка: склад → стеллаж/ряд → ячейки
                  const tree = {};
                  product.shelves.forEach(s => {
                    const wh = s.warehouse_name || 'Без склада';
                    const rack = s.rack_name || 'Без стеллажа';
                    if (!tree[wh]) tree[wh] = {};
                    if (!tree[wh][rack]) tree[wh][rack] = [];
                    tree[wh][rack].push(s);
                  });
                  return (
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {Object.entries(tree).map(([whName, racks]) => {
                        const whTotal = Object.values(racks).flat().reduce((s, l) => s + Number(l.quantity || 0), 0);
                        return (
                          <div key={whName} className="rounded-xl border border-gray-100 dark:border-gray-800 overflow-hidden">
                            <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{whName}</span>
                              <span className="text-[10px] font-bold text-primary-500">{fmtQty(whTotal)} шт.</span>
                            </div>
                            {Object.entries(racks).map(([rackName, locations]) => {
                              const rackTotal = locations.reduce((s, l) => s + Number(l.quantity || 0), 0);
                              return (
                                <div key={rackName}>
                                  <div className="px-3 py-1 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between border-t border-gray-50 dark:border-gray-800">
                                    <span className="text-[10px] font-semibold text-gray-400">{rackName}</span>
                                    <span className="text-[10px] font-semibold text-gray-400">{fmtQty(rackTotal)} шт.</span>
                                  </div>
                                  <div className="divide-y divide-gray-50 dark:divide-gray-800">
                                    {locations.map((s, i) => (
                                      <div key={i} className="flex items-center gap-2 px-3 py-2 group hover:bg-primary-50/30 dark:hover:bg-primary-900/10 transition-colors">
                                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                                          if (s.location_type === 'shelf' || s.location_type === 'shelf_box') navigate(`/admin/warehouse?shelf=${s.location_id}`);
                                          else if (s.location_type === 'pallet' || s.location_type === 'box') navigate(`/admin/fbo?pallet=${s.location_id}`);
                                        }}>
                                          <p className="text-sm font-medium text-primary-700 dark:text-primary-400 hover:underline">{s.location_code || s.shelf_code}</p>
                                          <p className="text-[10px] text-gray-400">
                                            {s.location_type === 'shelf' && 'полка'}
                                            {s.location_type === 'pallet' && 'паллет'}
                                            {s.location_type === 'box' && 'коробка'}
                                            {s.location_type === 'shelf_box' && 'коробка на полке'}
                                          </p>
                                        </div>
                                        {editingShelf === `${s.location_type}-${s.location_id}-${i}` ? (
                                          <div className="flex items-center gap-1">
                                            <input type="number" min="0" step="1" value={shelfQty} onChange={e => setShelfQty(e.target.value)}
                                              className="w-20 px-2 py-1 rounded-lg border border-primary-300 text-sm text-center font-bold focus:outline-none focus:ring-2 focus:ring-primary-300" autoFocus />
                                            <button onClick={() => handleShelfQtyChange(s)} disabled={shelfSaving}
                                              className="p-1 text-green-500 hover:text-green-700"><Check size={14} /></button>
                                            <button onClick={() => setEditingShelf(null)}
                                              className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                                          </div>
                                        ) : canEditFull ? (
                                          <button
                                            onClick={() => { setEditingShelf(`${s.location_type}-${s.location_id}-${i}`); setShelfQty(String(Number(s.quantity || 0))); }}
                                            className="text-sm font-bold text-primary-700 dark:text-primary-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-lg shadow-sm hover:ring-2 hover:ring-primary-300 transition-all"
                                            title="Нажмите чтобы изменить"
                                          >
                                            {fmtQty(s.quantity)} шт.
                                          </button>
                                        ) : (
                                          <span className="text-sm font-bold text-primary-700 dark:text-primary-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-lg shadow-sm">
                                            {fmtQty(s.quantity)} шт.
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </FormSection>
            </div>

            {/* COLUMN 3: техкарта + бандл */}
            <div className="space-y-4">
              {/* Тех. карта */}
              <FormSection title={`Техкарта${product.tech_card ? ` (${product.tech_card.materials?.length || 0} мат.)` : ''}`} icon={<span className="text-gray-400 text-sm">🧪</span>}
                action={!canEditFull ? null : product.tech_card
                  ? <button onClick={startTcEdit} className="text-xs text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1"><Pencil size={11} /> Ред.</button>
                  : <button onClick={() => { setTcOutput('1'); setTcCost(''); saveTechCard(); }} className="text-xs text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1"><Plus size={12} /> Создать</button>
                }>
                {product.tech_card ? (
                  <div className="space-y-2">
                    {/* Output & cost — editable */}
                    {tcEditing ? (
                      <div className="space-y-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-200">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block"><span className="text-[10px] text-amber-600">Выход (шт.)</span>
                            <input type="number" min="1" step="1" value={tcOutput} onChange={e => setTcOutput(e.target.value)}
                              className="w-full rounded-lg border border-amber-200 px-2 py-1 text-sm" /></label>
                          <label className="block"><span className="text-[10px] text-amber-600">Себестоимость (₽)</span>
                            <input type="number" min="0" step="0.01" value={tcCost} onChange={e => setTcCost(e.target.value)}
                              className="w-full rounded-lg border border-amber-200 px-2 py-1 text-sm" placeholder="—" /></label>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={saveTechCard} className="px-3 py-1 rounded-lg bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700">Сохранить</button>
                          <button onClick={() => setTcEditing(false)} className="px-3 py-1 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold hover:bg-gray-200">Отмена</button>
                          <button onClick={deleteTechCard} className="ml-auto px-2 py-1 rounded-lg text-rose-400 text-xs hover:text-rose-600 hover:bg-rose-50">Удалить</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 rounded-xl border border-amber-100 dark:border-amber-800/30">
                        <span className="text-xs text-amber-600 font-medium">Выход:</span>
                        <span className="text-sm font-bold text-amber-700">{fmtQty(product.tech_card.output_quantity)} шт.</span>
                        {product.tech_card.cost > 0 && (
                          <span className="text-xs text-amber-500 ml-auto">Себестоимость: {fmtQty(product.tech_card.cost)} ₽</span>
                        )}
                      </div>
                    )}
                    {/* Materials list */}
                    <div className="space-y-1 max-h-52 overflow-y-auto">
                      {(product.tech_card.materials || []).filter(m => m.id).map((m, i) => (
                        <div key={m.id || i}
                          className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gray-50 dark:bg-gray-800 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors border border-transparent hover:border-purple-200 group">
                          <span className="flex-shrink-0 cursor-pointer" onClick={() => { onClose(); navigate(`/admin/products/materials?id=${m.id}`); }}>{matIcon(m)}</span>
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { onClose(); navigate(`/admin/products/materials?id=${m.id}`); }}>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{m.name}</p>
                          </div>
                          {!canEditFull ? (
                            <span className="text-xs font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 px-2 py-0.5 rounded-lg">
                              {fmtQty(m.quantity)} {m.unit}
                            </span>
                          ) : tcEditingMat === m.id ? (
                            <div className="flex items-center gap-1">
                              <input type="number" min="0" step="0.01" value={tcEditMatQty} onChange={e => setTcEditMatQty(e.target.value)}
                                className="w-16 rounded-lg border border-gray-300 px-1.5 py-0.5 text-xs" autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') updateTcMatQty(m.id); if (e.key === 'Escape') setTcEditingMat(null); }} />
                              <span className="text-[10px] text-gray-400">{m.unit}</span>
                              <button onClick={() => updateTcMatQty(m.id)} className="text-green-500 hover:text-green-700"><Check size={14} /></button>
                              <button onClick={() => setTcEditingMat(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                            </div>
                          ) : (
                            <button onClick={() => { setTcEditingMat(m.id); setTcEditMatQty(String(m.quantity)); }}
                              className="text-xs font-bold text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-700 px-2 py-0.5 rounded-lg hover:bg-primary-50 hover:text-primary-700 transition-colors">
                              {fmtQty(m.quantity)} {m.unit}
                            </button>
                          )}
                          {canEditFull && (
                            <button onClick={() => removeTcMaterial(m.id)}
                              className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-500 transition-all"><X size={14} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                    {/* Add material */}
                    {!canEditFull ? null : tcAddMat ? (
                      <div className="space-y-2 px-3 py-2 bg-purple-50 rounded-xl border border-purple-200">
                        <input type="text" value={tcMatSearch} onChange={e => searchMaterials(e.target.value)}
                          placeholder="Поиск материала..." className="w-full rounded-lg border border-purple-200 px-3 py-1.5 text-sm" autoFocus />
                        {tcMatResults.length > 0 && (
                          <div className="max-h-32 overflow-y-auto space-y-0.5">
                            {tcMatResults.map(m => (
                              <button key={m.id} onClick={() => addTcMaterial(m.id)}
                                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-purple-100 text-sm flex items-center gap-2 transition-colors">
                                <span className="flex-1 truncate">{m.name}</span>
                                <span className="text-[10px] text-gray-400">{m.unit}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-purple-600">Кол-во:</label>
                          <input type="number" min="0" step="0.01" value={tcMatQty} onChange={e => setTcMatQty(e.target.value)}
                            className="w-20 rounded-lg border border-purple-200 px-2 py-1 text-xs" />
                          <button onClick={() => { setTcAddMat(false); setTcMatSearch(''); setTcMatResults([]); }}
                            className="ml-auto text-xs text-gray-500 hover:text-gray-700">Отмена</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setTcAddMat(true)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
                        <Plus size={13} /> Добавить материал
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-300 text-center py-4">Нет техкарты</p>
                )}
              </FormSection>

              {/* Бандл */}
              {isBundle && (
                <FormSection title={`Состав комплекта (${product.components?.length || 0})`} icon={<span className="text-gray-400 text-sm">📦</span>}>
                  {canEditFull && (
                    <div className="mb-2">
                      <button onClick={() => setShowAddComp(true)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
                        <Plus size={13} /> Добавить компонент
                      </button>
                    </div>
                  )}
                  {!product.components?.length ? (
                    <p className="text-sm text-gray-300 text-center py-4">Состав не определён</p>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                      {product.components.map(c => (
                        <div key={c.bc_id || c.id} className="flex items-center gap-2.5 px-3 py-2 bg-primary-50 dark:bg-primary-900/10 rounded-xl border border-primary-100 dark:border-primary-800/30 group">
                          <ProductIcon size={16} />
                          <button className="flex-1 min-w-0 text-left" onClick={() => setNestedId(c.id)}>
                            <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{c.name}</p>
                          </button>
                          <span className="text-xs font-bold text-primary-700 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-lg">{fmtQty(c.quantity)} шт.</span>
                          {c.bc_id && canEditFull && (
                            <button onClick={() => handleDeleteComponent(c.bc_id)}
                              className="opacity-0 group-hover:opacity-100 text-rose-300 hover:text-rose-500 transition-all"><X size={14} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </FormSection>
              )}
            </div>
          </div>
        )}
      </Modal>

      {nestedId && <ProductDetailModal productId={nestedId} onClose={() => setNestedId(null)} />}

      {showAddComp && product && (
        <AddComponentModal open={showAddComp} onClose={() => setShowAddComp(false)} bundleId={product.id} onSuccess={loadProduct} />
      )}

      {/* Add Location Modal */}
      <Modal open={showAddLocation} onClose={() => setShowAddLocation(false)} title="Разместить товар"
        footer={<><Button variant="ghost" onClick={() => setShowAddLocation(false)}>Отмена</Button>
          <Button onClick={handleAddLocation} loading={addLocLoading}>Разместить</Button></>}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Склад</label>
            <select value={addLocForm.warehouse_id} onChange={e => onWarehouseChange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-primary-400">
              <option value="">Выберите склад</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          {availShelves.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Полка</label>
              <select value={addLocForm.shelf_id} onChange={e => setAddLocForm(f => ({ ...f, shelf_id: e.target.value, pallet_id: '' }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-primary-400">
                <option value="">Выберите полку</option>
                {availShelves.map(s => <option key={s.id} value={s.id}>{s.rackName} → {s.name} ({s.code})</option>)}
              </select>
            </div>
          )}
          {availPallets.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Паллет</label>
              <select value={addLocForm.pallet_id} onChange={e => setAddLocForm(f => ({ ...f, pallet_id: e.target.value, shelf_id: '' }))}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-primary-400">
                <option value="">Выберите паллет</option>
                {availPallets.map(p => <option key={p.id} value={p.id}>{p.rowName} → {p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">Количество</label>
            <input type="number" min="1" value={addLocForm.quantity} onChange={e => setAddLocForm(f => ({ ...f, quantity: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:border-primary-400" />
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Column config ────────────────────────────────────────────────────────────
const COLUMNS_DEF = [
  { key: 'name',        label: 'Название',  required: true  },
  { key: 'code',        label: 'Код',       required: false },
  { key: 'barcode',     label: 'Штрих-код', required: false },
  { key: 'stock',       label: 'Остаток',   required: false },
  { key: 'shelf_codes', label: 'Ячейки',    required: false },
];
const COL_STORAGE_KEY = 'products_columns_v3';
function loadSavedColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_STORAGE_KEY));
    if (Array.isArray(saved) && saved.length > 0) {
      const savedKeys = new Set(saved.map(c => c.key));
      const result = saved.filter(c => COLUMNS_DEF.some(d => d.key === c.key));
      COLUMNS_DEF.forEach(d => { if (!savedKeys.has(d.key)) result.push({ ...d, visible: true }); });
      return result;
    }
  } catch {}
  return COLUMNS_DEF.map(c => ({ ...c, visible: true }));
}

// ─── Sort header ──────────────────────────────────────────────────────────────
function Th({ label, sortKey, sortBy, sortDir, onSort, hint }) {
  const active = sortBy === sortKey;
  return (
    <th
      className="cursor-pointer select-none hover:bg-gray-50 transition-colors"
      onClick={() => onSort(sortKey)}
    >
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {hint && (
          <span
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-gray-500 text-[9px] font-bold cursor-default leading-none flex-shrink-0"
            title={hint}
            onClick={e => e.stopPropagation()}
          >i</span>
        )}
        {active
          ? (sortDir === 'asc' ? <ArrowUp size={12} className="text-primary-500" /> : <ArrowDown size={12} className="text-primary-500" />)
          : <ArrowDown size={12} className="text-gray-200" />
        }
      </div>
    </th>
  );
}

// ─── Таблица товаров ──────────────────────────────────────────────────────────
function ProductTable({ entityType, onSelect, onEdit }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const limit = settings.products_page_size;
  const densityClass = settings.products_row_density === 'compact' ? 'data-table-compact'
    : settings.products_row_density === 'large' ? 'data-table-large' : '';
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [sortBy, setSortBy] = useState(entityType === 'product' ? 'stock' : 'name');
  const [sortDir, setSortDir] = useState(entityType === 'product' ? 'desc' : 'asc');
  const [globalStats, setGlobalStats] = useState(null);
  const [columns, setColumns] = useState(loadSavedColumns);
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef(null);
  const dragColIdx = useRef(null);

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir(['stock', 'warehouse_qty', 'reserve'].includes(key) ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // При активном поиске ищем по ВСЕМ карточкам (единичные + комплекты),
      // чтобы товар находился по любому ШК/полю независимо от открытой вкладки
      const params = { search, entity_type: search ? undefined : entityType, page, limit, sort_by: sortBy, sort_dir: sortDir };
      const res = await api.get('/products', { params });
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch { toast.error('Ошибка загрузки'); }
    finally { setLoading(false); }
  }, [search, entityType, page, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); setSortBy(entityType === 'product' ? 'stock' : 'name'); setSortDir(entityType === 'product' ? 'desc' : 'asc'); }, [entityType]);
  useEffect(() => { setPage(1); }, [limit]);

  // Fetch global product stats for summary bar
  useEffect(() => {
    api.get('/products/stats').then(r => setGlobalStats(r.data)).catch(() => {});
  }, []);

  // Save columns to localStorage
  useEffect(() => {
    localStorage.setItem(COL_STORAGE_KEY, JSON.stringify(columns));
  }, [columns]);

  // Close col picker on outside click
  useEffect(() => {
    const handler = (e) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target)) setShowColPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const totalPages = Math.ceil(total / limit);
  const handleSearch = (val) => { setSearch(val); setPage(1); };
  const withCells = items.filter(i => i.shelf_codes).length;
  const thProps = { sortBy, sortDir, onSort: handleSort };
  const visibleCols = columns.filter(c => c.visible || c.required);

  return (
    <div>
      <form className="flex gap-2 mb-3" onSubmit={e => { e.preventDefault(); handleSearch(searchInput); }}>
        <SearchWithSuggestions
          value={searchInput}
          onChange={setSearchInput}
          onSearch={handleSearch}
          entityType={entityType}
        />
        <Button type="submit" size="md">Найти</Button>
        {search && <Button type="button" variant="ghost" size="md" onClick={() => { setSearch(''); setSearchInput(''); setPage(1); }}>Сбросить</Button>}
        {/* Column picker */}
        <div className="relative" ref={colPickerRef}>
          <button
            type="button"
            onClick={() => setShowColPicker(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
              showColPicker
                ? 'bg-primary-50 border-primary-300 text-primary-700'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            )}
          >
            <Settings2 size={14} />
            Столбцы
          </button>
          {showColPicker && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-2xl shadow-xl p-3 w-52">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Столбцы</p>
              <div className="space-y-1">
                {columns.map((col, idx) => (
                  <div
                    key={col.key}
                    draggable
                    onDragStart={() => { dragColIdx.current = idx; }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      const from = dragColIdx.current;
                      if (from === idx || from === null) return;
                      const next = [...columns];
                      const [moved] = next.splice(from, 1);
                      next.splice(idx, 0, moved);
                      setColumns(next);
                      dragColIdx.current = null;
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-50 cursor-grab active:cursor-grabbing select-none"
                  >
                    <GripVertical size={13} className="text-gray-300 flex-shrink-0" />
                    <input
                      type="checkbox"
                      checked={col.visible || col.required}
                      disabled={col.required}
                      onChange={e => {
                        setColumns(cs => cs.map(c => c.key === col.key ? { ...c, visible: e.target.checked } : c));
                      }}
                      className="rounded"
                    />
                    <span className={cn('text-sm', col.required ? 'text-gray-400' : 'text-gray-700')}>{col.label}</span>
                  </div>
                ))}
              </div>
              <button
                className="mt-2 w-full text-xs text-gray-400 hover:text-gray-600 text-center py-1"
                onClick={() => setColumns(COLUMNS_DEF.map(c => ({ ...c, visible: true })))}
              >
                Сбросить
              </button>
            </div>
          )}
        </div>
      </form>

      {/* Итоговая строка */}
      {!loading && items.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2 bg-gray-50 text-gray-600 rounded-xl px-3 py-2 text-sm font-medium">
            <span>Размещено на полках: <strong>{withCells}</strong> из <strong>{items.length}</strong></span>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <ProductIcon size={48} className="mb-2 opacity-50" />
            <p className="text-sm">Товары не найдены</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className={`data-table ${densityClass}`}>
              <thead>
                <tr>
                  {visibleCols.map(col => {
                    const sortKeys = { name: 'name', code: 'code', stock: 'stock', shelf_codes: 'shelf_codes' };
                    if (sortKeys[col.key]) return <Th key={col.key} label={col.label} sortKey={col.key} {...thProps} />;
                    return <th key={col.key}>{col.label}</th>;
                  })}
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="cursor-pointer hover:bg-primary-50/40 transition-colors" onClick={() => onSelect(item.id)}>
                    {visibleCols.map(col => {
                      if (col.key === 'name') return (
                        <td key="name">
                          <div className="flex items-center gap-2.5">
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${item.entity_type === 'bundle' ? 'bg-purple-50' : 'bg-primary-50'}`}>
                              {item.entity_type === 'bundle' ? <BundleIcon size={20} /> : <ProductIcon size={20} />}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-white text-sm leading-tight">
                                {item.name}
                                {item.entity_type === 'bundle' && <span className="ml-1.5 text-[10px] font-semibold text-purple-500">комплект</span>}
                              </p>
                              {item.article && <p className="text-xs text-gray-400">{item.article}</p>}
                            </div>
                          </div>
                        </td>
                      );
                      if (col.key === 'code') return <td key="code" className="text-gray-500 text-xs font-mono">{item.code || '—'}</td>;
                      if (col.key === 'barcode') { const systemBc = item.production_barcode || (() => { const allBc = (item.barcode_list||'').split(';').map(s=>s.trim()).filter(Boolean); const mbj = Array.isArray(item.marketplace_barcodes_json) ? item.marketplace_barcodes_json : []; const mpValues = new Set(mbj.map(m => m.value)); const isMP = b => mpValues.has(b) || /^(OZN|MRKT|SBER)/i.test(b); return allBc.find(b => !isMP(b)) || allBc[0]; })(); return <td key="barcode">{systemBc ? <CopyBadge value={systemBc} /> : <span className="text-xs text-gray-300">—</span>}</td>; }
                      if (col.key === 'stock') return <td key="stock"><StockBadge stock={Number(item.warehouse_qty || item.stock || 0)} /></td>;
                      if (col.key === 'shelf_codes') return (
                        <td key="shelf_codes">
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
                            : <span className="text-xs text-gray-300 italic">не размещён</span>
                          }
                        </td>
                      );
                      return null;
                    })}
                    {/* карандашик убран — редактирование в карточке */}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-sm text-gray-500">{(page-1)*limit+1}–{Math.min(page*limit,total)} из {total}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} icon={<ChevronLeft size={15} />}>Назад</Button>
            <span className="text-sm text-gray-500 px-2">{page}/{totalPages}</span>
            <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} icon={<ChevronRight size={15} />}>Вперёд</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Главная страница ─────────────────────────────────────────────────────────
export default function ProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = usePerms();
  const canEditProducts = can('products.edit');
  const selectedId = searchParams.get('id') ? parseInt(searchParams.get('id')) : null;
  const [showForm, setShowForm] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const activeTab = searchParams.get('type') || 'product';
  const setActiveTab = (t) => { const p = new URLSearchParams(searchParams); p.set('type', t); p.delete('id'); setSearchParams(p); };

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

  // handleFormSuccess: reload table and re-open detail modal if editing existing product
  const handleFormSuccess = useCallback((savedId = null) => {
    setReloadKey(k => k + 1);
    if (savedId) {
      // Briefly close and reopen to force ProductDetailModal to refetch
      const p = new URLSearchParams(searchParams);
      p.delete('id');
      setSearchParams(p);
      setTimeout(() => {
        const p2 = new URLSearchParams(searchParams);
        p2.set('id', savedId);
        setSearchParams(p2);
      }, 30);
    }
  }, [searchParams, setSearchParams]);

  const handleReload = useCallback(() => {
    setReloadKey(k => k + 1);
  }, []);

  const TABS = [
    { value: 'product', label: 'Единичные', Icon: ProductIcon },
    { value: 'bundle', label: 'Комплекты', Icon: BundleIcon },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Шапка */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Карточки товаров</h1>
          <p className="text-gray-500 text-sm mt-1">Каталог — все товары и комплекты</p>
        </div>
        {canEditProducts && (
          <Button icon={<Plus size={15} />} size="sm" onClick={() => { setEditProduct(null); setShowForm(true); }}>
            Добавить товар
          </Button>
        )}
      </div>

      {/* Вкладки */}
      <div className="flex gap-2 mb-5">
        {TABS.map(({ value, label, Icon }) => (
          <button
            key={value}
            onClick={() => setActiveTab(value)}
            className={cn(
              'glass-btn flex items-center gap-2 px-5 py-2.5 rounded-[14px] text-sm font-semibold transition-all backdrop-blur-xl',
              activeTab === value
                ? value === 'bundle'
                  ? 'text-purple-700 bg-purple-500/10 border border-purple-500/25 shadow-[0_2px_10px_rgba(139,92,246,0.12)]'
                  : 'text-primary-700 bg-primary-600/10 border border-primary-600/25 shadow-[0_2px_10px_rgba(124,58,237,0.12)]'
                : 'text-gray-600 bg-white/50 border border-white/75 hover:bg-white/70 hover:shadow-sm'
            )}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>

      {/* Таблицы */}
      <ProductTable key={`${activeTab}-${reloadKey}`} entityType={activeTab} onSelect={openProduct} onEdit={product => { setEditProduct(product); setShowForm(true); }} />

      <ProductDetailModal
        productId={selectedId}
        onClose={closeProduct}
        onEdit={handleReload}
        onDelete={handleReload}
      />

      <ProductFormModal
        open={showForm}
        onClose={() => { setShowForm(false); setEditProduct(null); }}
        onSuccess={handleFormSuccess}
        initial={editProduct}
      />
    </div>
  );
}

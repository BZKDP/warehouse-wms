import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ArrowLeft, ScanLine, Layers, ArrowRightLeft, Package, Settings2, ChevronDown, RotateCcw, PackagePlus, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { PalletIcon, BoxIcon, TransferIcon, ReturnsIcon, PieceScanIcon, PourBoxIcon, MoveBoxIcon, AdminClipboardIcon } from '../../components/ui/WarehouseIcons';
import Spinner from '../../components/ui/Spinner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { playBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';

// ─── Animated Scan Input ────────────────────────────────────────────────────

function ScanInput({ onScan, placeholder, disabled, autoFocus = true }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus]);

  const submit = () => {
    const v = value.trim();
    if (v) { onScan(v); setValue(''); }
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    clearTimeout(timerRef.current);
    if (v.length >= 4) timerRef.current = setTimeout(() => { const s = v.trim(); if (s) { onScan(s); setValue(''); } }, SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="relative">
      <div className="absolute inset-0 rounded-2xl bg-primary-400/20 animate-pulse-slow pointer-events-none" />
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timerRef.current); submit(); } }}
        placeholder={placeholder}
        disabled={disabled}
        className="scan-input relative w-full px-4 py-4 rounded-2xl border-2 border-dashed border-primary-300 focus:border-primary-500 focus:border-solid bg-white text-center text-lg font-mono transition-all outline-none disabled:opacity-40"
      />
    </div>
  );
}

// ─── Step Progress Bar ──────────────────────────────────────────────────────

function StepProgress({ current, total, color = 'bg-blue-500' }) {
  return (
    <div className="flex gap-1.5 mb-5">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
          i < current ? color : i === current ? color + ' animate-pulse' : 'bg-gray-200'
        }`} />
      ))}
    </div>
  );
}

// ─── Big Visual Hint ────────────────────────────────────────────────────────

function ScanHint({ icon: Icon, title, subtitle, color = 'blue', animateIcon = true }) {
  const colorMap = {
    blue: { bg: 'bg-blue-50', icon: 'bg-blue-100 text-blue-600', ring: 'ring-blue-200' },
    purple: { bg: 'bg-purple-50', icon: 'bg-purple-100 text-purple-600', ring: 'ring-purple-200' },
    green: { bg: 'bg-green-50', icon: 'bg-green-100 text-green-600', ring: 'ring-green-200' },
    amber: { bg: 'bg-amber-50', icon: 'bg-amber-100 text-amber-600', ring: 'ring-amber-200' },
    indigo: { bg: 'bg-indigo-50', icon: 'bg-indigo-100 text-indigo-600', ring: 'ring-indigo-200' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <div className={`${c.bg} rounded-2xl p-6 mb-5 text-center animate-fade-in`}>
      <div className={`w-20 h-20 rounded-2xl ${c.icon} ring-4 ${c.ring} flex items-center justify-center mx-auto mb-4 ${animateIcon ? 'animate-bounce-gentle' : ''}`}>
        <Icon size={36} />
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-1">{title}</h2>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}

// ─── Error Banner ───────────────────────────────────────────────────────────

function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3 animate-shake">
      <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0">
        <span className="text-rose-500 text-lg font-bold">!</span>
      </div>
      <p className="text-sm text-rose-700 font-medium">{message}</p>
    </div>
  );
}

// ─── Info Tag ───────────────────────────────────────────────────────────────

function InfoTag({ label, value, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    rose: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${colors[color] || colors.blue}`}>
      <span className="opacity-60">{label}:</span> <span className="font-bold">{value}</span>
    </div>
  );
}

// ─── Success Screen ─────────────────────────────────────────────────────────

function SuccessScreen({ message, onReset }) {
  return (
    <div className="p-4 max-w-md mx-auto text-center py-16 animate-fade-in">
      <div className="w-20 h-20 rounded-full bg-green-100 ring-4 ring-green-200 flex items-center justify-center mx-auto mb-5 animate-bounce-in">
        <Check size={40} className="text-green-600" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Готово!</h2>
      <p className="text-sm text-gray-500 mb-8">{message || 'Перемещение завершено'}</p>
      <button onClick={onReset} className="px-8 py-3 rounded-2xl bg-primary-500 text-white font-bold text-sm hover:bg-primary-600 shadow-lg shadow-primary-200 transition-all active:scale-95">
        Новое перемещение
      </button>
    </div>
  );
}

// ─── Styled Select ──────────────────────────────────────────────────────────

function StyledSelect({ label, value, onChange, options, placeholder, disabled }) {
  return (
    <div className="mb-3">
      {label && <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>}
      <div className="relative">
        <select
          value={value || ''}
          onChange={e => onChange(e.target.value || null)}
          disabled={disabled}
          className="w-full appearance-none px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-800 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all disabled:opacity-40 pr-10"
        >
          <option value="">{placeholder || 'Выберите...'}</option>
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── CSS Animations (injected once) ─────────────────────────────────────────

const styleId = 'move-page-animations';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes bounce-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
    @keyframes bounce-in { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 15%, 45%, 75% { transform: translateX(-4px); } 30%, 60%, 90% { transform: translateX(4px); } }
    @keyframes pulse-slow { 0%, 100% { opacity: 0; } 50% { opacity: 1; } }
    .animate-fade-in { animation: fade-in 0.4s ease-out; }
    .animate-bounce-gentle { animation: bounce-gentle 2s ease-in-out infinite; }
    .animate-bounce-in { animation: bounce-in 0.5s ease-out; }
    .animate-shake { animation: shake 0.4s ease-in-out; }
    .animate-pulse-slow { animation: pulse-slow 2.5s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN TRANSFER — component for admin mode
// ═══════════════════════════════════════════════════════════════════════════

// Переключатель типа склада (паллет/полка)
function TypeToggle({ value, onChange }) {
  return (
    <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
      {[['pallet', 'Паллет', PalletIcon], ['shelf', 'Полка', Layers]].map(([k, label, Icon]) => (
        <button key={k} onClick={() => onChange(k)}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${value === k ? 'bg-white text-rose-600 shadow-sm' : 'text-gray-500'}`}>
          <Icon size={16} /> {label}
        </button>
      ))}
    </div>
  );
}

function AdminTransfer({ onBack, onDone }) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [pallets, setPallets] = useState([]);
  const [shelves, setShelves] = useState([]);

  // Откуда
  const [srcType, setSrcType] = useState('pallet');
  const [srcLocId, setSrcLocId] = useState(null);
  const [srcBoxes, setSrcBoxes] = useState([]);
  const [srcBoxId, setSrcBoxId] = useState(null);

  // Куда
  const [destType, setDestType] = useState('shelf');
  const [destLocId, setDestLocId] = useState(null);

  // Списки паллет и полок
  useEffect(() => {
    api.get('/fbo/pallets-list').then(r => setPallets(r.data || [])).catch(() => {});
    api.get('/warehouse/shelves-list').then(r => setShelves(r.data || [])).catch(() => {});
  }, []);

  // Коробки в выбранном источнике
  useEffect(() => {
    setSrcBoxes([]); setSrcBoxId(null);
    if (!srcLocId) return;
    if (srcType === 'pallet') {
      api.get(`/fbo/pallets/${srcLocId}`).then(r => setSrcBoxes(r.data?.boxes || [])).catch(() => setSrcBoxes([]));
    } else {
      api.get(`/warehouse/shelves/${srcLocId}`).then(r =>
        setSrcBoxes((r.data?.boxes || []).filter(b => (b.quantity || 0) > 0 || b.barcode_value))
      ).catch(() => setSrcBoxes([]));
    }
  }, [srcType, srcLocId]);

  const shelfLabel = (s) => `${s.warehouse_name} · ${s.rack_name} · ${s.code || s.name || 'Полка ' + s.number}`;
  const boxLabel = (b) => `${b.barcode_value || b.name || 'Коробка'} — ${b.quantity || 0} шт.${b.product_name ? ` (${b.product_name})` : ''}`;

  const palletOptions = pallets.map(p => ({ value: p.id, label: `${p.row_name} · ${p.name}` }));
  const shelfOptions = shelves.map(s => ({ value: s.id, label: shelfLabel(s) + (s.boxes_count ? ` · ${s.boxes_count} кор.` : '') }));

  const srcOptions = srcType === 'pallet' ? palletOptions : shelfOptions;
  let destOptions = destType === 'pallet' ? palletOptions : shelfOptions;
  if (destType === srcType) destOptions = destOptions.filter(o => String(o.value) !== String(srcLocId));

  const onSrcType = (t) => { setSrcType(t); setSrcLocId(null); setSrcBoxes([]); setSrcBoxId(null); };
  const onDestType = (t) => { setDestType(t); setDestLocId(null); };

  const selectedBox = srcBoxes.find(b => String(b.id) === String(srcBoxId));

  const handleTransfer = async () => {
    if (!srcBoxId || !destLocId) return;
    setLoading(true); setError('');
    try {
      await api.post('/movements/relocate-box', {
        source_type: srcType, box_id: parseInt(srcBoxId),
        dest_type: destType, dest_id: parseInt(destLocId),
      });
      const dest = destType === 'pallet'
        ? pallets.find(p => String(p.id) === String(destLocId))?.name
        : (() => { const s = shelves.find(x => String(x.id) === String(destLocId)); return s ? (s.code || s.name || `полку ${s.number}`) : null; })();
      toast.success(`Коробка перенесена на ${dest || (destType === 'pallet' ? 'паллет' : 'полку')}`);
      onDone(`Коробка перенесена на ${dest || (destType === 'pallet' ? 'паллет' : 'полку')}`);
    } catch (err) { setError(err.response?.data?.error || 'Ошибка переноса'); }
    finally { setLoading(false); }
  };

  return (
    <div className="p-4 max-w-md mx-auto animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>

      <div className="bg-rose-50 rounded-2xl p-5 mb-4 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 ring-4 ring-rose-200 flex items-center justify-center mx-auto mb-3">
          <Settings2 size={32} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Админский перенос</h2>
        <p className="text-xs text-gray-500 mt-1">Без сканера · паллет ↔ стеллаж в любую сторону</p>
      </div>

      <ErrorBanner message={error} />

      {/* ОТКУДА */}
      <div className="mb-4 rounded-2xl border border-gray-100 p-3">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Откуда</p>
        <TypeToggle value={srcType} onChange={onSrcType} />
        <div className="mt-3">
          <StyledSelect
            label={srcType === 'pallet' ? 'Паллет-источник' : 'Полка-источник'}
            value={srcLocId} onChange={setSrcLocId}
            options={srcOptions}
            placeholder={srcType === 'pallet' ? 'Выберите паллет...' : 'Выберите полку...'} />
          {srcLocId && (
            <StyledSelect label="Какую коробку переносим" value={srcBoxId} onChange={setSrcBoxId}
              options={srcBoxes.map(b => ({ value: b.id, label: boxLabel(b) }))}
              placeholder={srcBoxes.length ? 'Выберите коробку...' : 'Нет коробок'}
              disabled={!srcBoxes.length} />
          )}
        </div>
      </div>

      {/* Инфо о коробке */}
      {selectedBox && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-xs text-indigo-500 font-medium mb-1">Выбранная коробка</p>
          <p className="text-sm font-bold text-indigo-800">{selectedBox.barcode_value || selectedBox.name}</p>
          <p className="text-xs text-indigo-600">{selectedBox.quantity || 0} шт.{selectedBox.product_name ? ` · ${selectedBox.product_name}` : ''}</p>
        </div>
      )}

      {/* КУДА */}
      {srcBoxId && (
        <div className="mb-4 rounded-2xl border border-gray-100 p-3">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Куда</p>
          <TypeToggle value={destType} onChange={onDestType} />
          <div className="mt-3">
            <StyledSelect
              label={destType === 'pallet' ? 'Паллет назначения' : 'Полка назначения'}
              value={destLocId} onChange={setDestLocId}
              options={destOptions}
              placeholder={destType === 'pallet' ? 'Выберите паллет...' : 'Выберите полку...'} />
          </div>
        </div>
      )}

      {/* Кнопка */}
      {srcBoxId && destLocId && (
        <button onClick={handleTransfer} disabled={loading}
          className="w-full py-3.5 rounded-2xl bg-rose-500 text-white font-bold text-sm hover:bg-rose-600 disabled:opacity-50 transition-all shadow-lg shadow-rose-200 active:scale-[0.98]">
          {loading ? <Spinner size="sm" className="mx-auto" /> : 'Перенести коробку'}
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PACKAGING CREATE — создание задачи оприходования (packaging) на себя
// ═══════════════════════════════════════════════════════════════════════════

function PackagingCreate({ onBack }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [productSearch, setProductSearch] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [fboWarehouses, setFboWarehouses] = useState([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [pallets, setPallets] = useState([]);
  const [selectedPalletId, setSelectedPalletId] = useState('');

  const [boxSize, setBoxSize] = useState('50');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Загрузка паллетных складов
  useEffect(() => {
    api.get('/fbo/warehouses').then(r => setFboWarehouses(r.data || [])).catch(() => {});
  }, []);

  // Загрузка паллет при смене склада
  useEffect(() => {
    if (!selectedWarehouseId) { setPallets([]); setSelectedPalletId(''); return; }
    api.get('/fbo/pallets-list', { params: { warehouse_id: selectedWarehouseId } })
      .then(r => setPallets(r.data || []))
      .catch(() => setPallets([]));
    setSelectedPalletId('');
  }, [selectedWarehouseId]);

  // Поиск товара (debounce)
  useEffect(() => {
    if (!productSearch.trim() || productSearch.trim().length < 2) { setProductResults([]); return; }
    const t = setTimeout(() => {
      api.get('/products', { params: { search: productSearch, entity_type: 'product', limit: 8 } })
        .then(r => setProductResults(r.data?.items || []))
        .catch(() => setProductResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  const handleCreate = async () => {
    setError('');
    if (!selectedProduct) { setError('Выберите товар'); return; }
    if (!selectedPalletId) { setError('Выберите паллет'); return; }
    const bs = parseInt(boxSize, 10);
    if (!bs || bs < 1) { setError('Укажите количество штук в коробке'); return; }
    if (!user?.employee_id) { setError('Ваш аккаунт не связан с сотрудником'); return; }

    setLoading(true);
    try {
      const res = await api.post('/tasks', {
        title: `Оприходование: ${selectedProduct.name}`,
        task_type: 'packaging',
        product_id: selectedProduct.id,
        box_size: bs,
        target_pallet_id: parseInt(selectedPalletId, 10),
        notes: notes || null,
        self_create: true,
      });
      const taskId = res.data?.id;
      if (!taskId) throw new Error('Сервер не вернул id задачи');
      playBeep(true);
      toast.success('Задача оприходования создана');
      navigate(`/employee/packaging/${taskId}`);
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || err.message || 'Ошибка создания задачи');
      setLoading(false);
    }
  };

  return (
    <div className="p-4 max-w-md mx-auto animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-400 mb-3">
        <ArrowLeft size={16} /> Назад
      </button>

      <div className="bg-indigo-50 rounded-2xl p-5 mb-5 text-center">
        <div className="w-16 h-16 rounded-2xl bg-indigo-100 text-indigo-600 ring-4 ring-indigo-200 flex items-center justify-center mx-auto mb-3">
          <PackagePlus size={32} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">Оприходование</h2>
        <p className="text-xs text-gray-500 mt-1">Задача создаётся на вас. Дальше — создаёте новые коробки и сканируете товар</p>
      </div>

      <ErrorBanner message={error} />

      {/* Товар */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Товар</label>
        {selectedProduct ? (
          <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl border border-primary-100">
            <Package size={16} className="text-primary-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{selectedProduct.name}</p>
              {selectedProduct.code && <p className="text-xs text-gray-400 truncate">{selectedProduct.code}</p>}
            </div>
            <button type="button"
              onClick={() => { setSelectedProduct(null); setProductSearch(''); setProductResults([]); }}
              className="text-gray-400 hover:text-rose-500 flex-shrink-0">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
              placeholder="Поиск товара..."
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
            />
            {productResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                {productResults.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => { setSelectedProduct(p); setProductSearch(''); setProductResults([]); }}
                    className="w-full text-left px-3 py-2.5 hover:bg-gray-50 text-sm">
                    <p className="font-medium truncate">{p.name}</p>
                    {p.code && <p className="text-xs text-gray-400 truncate">{p.code}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Паллетный склад */}
      <StyledSelect
        label="Паллетный склад"
        value={selectedWarehouseId}
        onChange={v => setSelectedWarehouseId(v || '')}
        options={fboWarehouses.map(w => ({ value: String(w.id), label: w.name }))}
        placeholder="Выберите склад..."
      />

      {/* Паллет */}
      {selectedWarehouseId && (
        <StyledSelect
          label="Паллет назначения"
          value={selectedPalletId}
          onChange={v => setSelectedPalletId(v || '')}
          options={pallets.map(p => ({
            value: String(p.id),
            label: `Р${p.row_number ?? p.row_name ?? '?'}П${p.number ?? '?'}${p.name ? ' — ' + p.name : ''}`,
          }))}
          placeholder={pallets.length ? 'Выберите паллет...' : 'На складе нет паллет'}
          disabled={!pallets.length}
        />
      )}

      {/* Количество в коробке */}
      <div className="mb-3">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Штук в коробке</label>
        <input
          type="number" min="1" max="1000"
          value={boxSize}
          onChange={e => setBoxSize(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
        />
      </div>

      {/* Примечание */}
      <div className="mb-4">
        <label className="text-xs font-medium text-gray-500 mb-1 block">Примечание</label>
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Необязательно..."
          className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
        />
      </div>

      <button
        onClick={handleCreate}
        disabled={loading || !selectedProduct || !selectedPalletId}
        className="w-full py-3.5 rounded-2xl bg-indigo-500 text-white font-bold text-sm hover:bg-indigo-600 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98]"
      >
        {loading ? <Spinner size="sm" className="mx-auto" /> : 'Создать задачу и начать'}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function MovePage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState(null); // 'piece' | 'whole' | 'box_transfer' | 'admin'
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Shared state
  const [sourceBox, setSourceBox] = useState(null);
  const [sourcePallet, setSourcePallet] = useState(null);
  const [cart, setCart] = useState([]);

  const reset = () => {
    setMode(null); setStep(0); setLoading(false);
    setError(''); setSuccess('');
    setSourceBox(null); setSourcePallet(null);
    setCart([]);
  };

  const scanBarcode = async (barcode) => {
    setError('');
    try {
      const res = await api.post('/movements/scan', { barcode });
      return res.data;
    } catch {
      playBeep(false); setError('Не найдено по этому штрих-коду'); return null;
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // MODE SELECTION
  // ═══════════════════════════════════════════════════════════════════════
  if (!mode) {
    const isAdmin = user?.role === 'admin';
    return (
      <div className="p-4 max-w-md mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center">
            <TransferIcon size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Перемещение</h1>
            <p className="text-sm text-gray-400">Выберите тип</p>
          </div>
        </div>
        <div className="space-y-3">
          <button onClick={() => { setMode('piece'); setStep(1); }}
            className="w-full bg-blue-50/80 border border-blue-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-blue-50 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center">
                <PieceScanIcon size={36} />
              </div>
              <div>
                <p className="font-bold text-base text-gray-900">Поштучно</p>
                <p className="text-xs text-gray-500 mt-0.5">Сканировать каждую банку отдельно</p>
              </div>
            </div>
          </button>

          <button onClick={() => { setMode('whole'); setStep(1); }}
            className="w-full bg-purple-50/80 border border-purple-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-purple-50 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center">
                <PourBoxIcon size={36} />
              </div>
              <div>
                <p className="font-bold text-base text-gray-900">Весь товар из коробки</p>
                <p className="text-xs text-gray-500 mt-0.5">Пересыпать всё содержимое в другую коробку</p>
              </div>
            </div>
          </button>

          <button onClick={() => { setMode('box_transfer'); setStep(1); }}
            className="w-full bg-amber-50/80 border border-amber-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-amber-50 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center">
                <MoveBoxIcon size={36} />
              </div>
              <div>
                <p className="font-bold text-base text-gray-900">Переставить коробку</p>
                <p className="text-xs text-gray-500 mt-0.5">Перенести коробку целиком на другой паллет</p>
              </div>
            </div>
          </button>

          {isAdmin && (
            <button onClick={() => { setMode('admin'); }}
              className="w-full bg-rose-50/80 border border-rose-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-rose-50 transition-all active:scale-[0.98]">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-rose-100 border border-rose-200 flex items-center justify-center">
                  <AdminClipboardIcon size={36} />
                </div>
                <div>
                  <p className="font-bold text-base text-gray-900">Админский перенос</p>
                  <p className="text-xs text-gray-500 mt-0.5">Без сканера — выбрать откуда и куда</p>
                </div>
              </div>
            </button>
          )}

          <button onClick={() => { setMode('packaging'); }}
            className="w-full bg-indigo-50/80 border border-indigo-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-indigo-50 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-indigo-100 border border-indigo-200 flex items-center justify-center">
                <PackagePlus size={32} className="text-indigo-600" />
              </div>
              <div>
                <p className="font-bold text-base text-gray-900">Оприходование</p>
                <p className="text-xs text-gray-500 mt-0.5">Создать коробки и заполнить — задача на меня</p>
              </div>
            </div>
          </button>
        </div>

        {/* Возвраты — визуально отделён */}
        <div className="mt-6 pt-5 border-t border-gray-100">
          <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mb-3">Другое</p>
          <button onClick={() => navigate('/employee/returns')}
            className="w-full bg-cyan-50/80 border border-cyan-100 rounded-2xl p-5 text-left hover:shadow-md hover:bg-cyan-50 transition-all active:scale-[0.98]">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-cyan-100 border border-cyan-200 flex items-center justify-center">
                <ReturnsIcon size={32} />
              </div>
              <div>
                <p className="font-bold text-base text-gray-900">Разложить возвраты</p>
                <p className="text-xs text-gray-500 mt-0.5">Отсканировать и разложить по полкам</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ADMIN MODE
  // ═══════════════════════════════════════════════════════════════════════
  if (mode === 'admin') {
    return <AdminTransfer onBack={reset} onDone={(msg) => { setSuccess(msg); setMode('admin_done'); }} />;
  }
  if (mode === 'admin_done') {
    return <SuccessScreen message={success} onReset={reset} />;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PACKAGING MODE — создание задачи оприходования на себя
  // ═══════════════════════════════════════════════════════════════════════
  if (mode === 'packaging') {
    return <PackagingCreate onBack={reset} />;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PIECE MODE — поштучный перенос
  // ═══════════════════════════════════════════════════════════════════════
  if (mode === 'piece') {
    const totalSteps = 4;

    if (step === 1) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="piece-1">
          <button onClick={reset} className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={0} total={totalSteps} color="bg-blue-500" />
          <ScanHint icon={BoxIcon} title="Сканируйте коробку" subtitle="Коробка, откуда хотите взять товар" color="blue" />
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на коробку..." onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'box') { playBeep(false); setError(`Это ${data.type === 'pallet' ? 'паллет' : data.type === 'shelf' ? 'полка' : 'товар'}, а нужна коробка`); return; }
            if (!data.contents?.length) { playBeep(false); setError('Коробка пуста — выберите другую'); return; }
            setSourceBox(data);
            playBeep(true);
            setStep(2);
          }} />
        </div>
      );
    }

    if (step === 2) {
      const handleProductScan = async (bc) => {
        const data = await scanBarcode(bc);
        if (!data || data.type !== 'product') { playBeep(false); setError('Сканируйте товар (банку), а не коробку или паллет'); return; }
        const boxItem = sourceBox.contents.find(c => c.product_id === data.id);
        if (!boxItem) { playBeep(false); setError('Этого товара нет в данной коробке'); return; }
        setCart(prev => {
          const existing = prev.find(c => c.product_id === data.id);
          if (existing) {
            if (existing.quantity >= parseFloat(boxItem.quantity)) { playBeep(false); setError('Всё количество уже набрано'); return prev; }
            return prev.map(c => c.product_id === data.id ? { ...c, quantity: c.quantity + 1 } : c);
          }
          return [...prev, { product_id: data.id, product_name: data.name, quantity: 1, maxQty: parseFloat(boxItem.quantity) }];
        });
        playBeep(true);
        setError('');
      };
      const totalItems = cart.reduce((s, c) => s + c.quantity, 0);
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="piece-2">
          <button onClick={() => { setStep(1); setCart([]); setSourceBox(null); setError(''); }}
            className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={1} total={totalSteps} color="bg-blue-500" />
          <ScanHint icon={Package} title="Сканируйте банки" subtitle="Каждую банку, которую забираете из коробки" color="blue" />
          <div className="mb-4"><InfoTag label="Из коробки" value={sourceBox?.name} color="blue" /></div>
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на банку..." onScan={handleProductScan} />
          {cart.length > 0 && (
            <div className="mt-4 space-y-2 animate-fade-in">
              {cart.map(item => (
                <div key={item.product_id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm">
                  <p className="text-sm text-gray-900 truncate flex-1">{item.product_name}</p>
                  <span className="text-sm font-bold text-blue-600 ml-2 bg-blue-50 px-2 py-0.5 rounded-lg">{item.quantity} / {item.maxQty}</span>
                </div>
              ))}
              <button onClick={async () => {
                setLoading(true);
                try {
                  for (const item of cart) {
                    await api.post('/movements/move', {
                      product_id: item.product_id, quantity: item.quantity,
                      source_type: 'box', source_id: sourceBox.id,
                      dest_type: 'employee', dest_id: user.employee_id,
                    });
                  }
                  playBeep(true); toast.success(`Забрали ${totalItems} шт.`); setStep(3);
                } catch (err) {
                  playBeep(false); setError(err.response?.data?.error || 'Ошибка');
                } finally { setLoading(false); }
              }} disabled={loading}
                className="w-full py-3.5 rounded-2xl bg-blue-500 text-white font-bold text-sm hover:bg-blue-600 disabled:opacity-50 transition-all shadow-lg shadow-blue-200 active:scale-[0.98]">
                {loading ? <Spinner size="sm" className="mx-auto" /> : `Забрать ${totalItems} шт.`}
              </button>
            </div>
          )}
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="piece-3">
          <StepProgress current={2} total={totalSteps} color="bg-blue-500" />
          <ScanHint icon={BoxIcon} title="Куда кладём?" subtitle="Сканируйте коробку назначения" color="green" />
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на коробку..." onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'box') { playBeep(false); setError('Сканируйте коробку'); return; }
            setLoading(true);
            try {
              for (const item of cart) {
                await api.post('/movements/move', {
                  product_id: item.product_id, quantity: item.quantity,
                  source_type: 'employee', source_id: user.employee_id,
                  dest_type: 'box', dest_id: data.id,
                });
              }
              playBeep(true);
              setSuccess(`Перемещено ${cart.reduce((s, c) => s + c.quantity, 0)} шт. в ${data.name}`);
              setStep(4);
            } catch (err) {
              playBeep(false); setError(err.response?.data?.error || 'Ошибка');
            } finally { setLoading(false); }
          }} />
          {loading && <div className="flex justify-center py-6"><Spinner size="lg" /></div>}
        </div>
      );
    }

    if (step === 4) return <SuccessScreen message={success} onReset={reset} />;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // WHOLE BOX MODE — пересыпка целой коробки
  // ═══════════════════════════════════════════════════════════════════════
  if (mode === 'whole') {
    const totalSteps = 4;

    if (step === 1) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="whole-1">
          <button onClick={reset} className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={0} total={totalSteps} color="bg-purple-500" />
          <ScanHint icon={PalletIcon} title="Сканируйте паллет" subtitle="Паллет, на котором стоит нужная коробка" color="purple" />
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на паллет..." onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'pallet') { playBeep(false); setError('Нужен паллет, а не коробка'); return; }
            setSourcePallet(data); playBeep(true); setStep(2);
          }} />
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="whole-2">
          <button onClick={() => { setStep(1); setSourcePallet(null); setError(''); }}
            className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={1} total={totalSteps} color="bg-purple-500" />
          <ScanHint icon={BoxIcon} title="Сканируйте коробку" subtitle="Весь товар из неё перейдёт к вам" color="purple" />
          <div className="mb-4"><InfoTag label="Паллет" value={sourcePallet?.name} color="purple" /></div>
          <ErrorBanner message={error} />
          {loading && <div className="flex justify-center py-6"><Spinner size="lg" /></div>}
          <ScanInput placeholder="Наведите сканер на коробку..." disabled={loading} onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'box') { playBeep(false); setError('Сканируйте коробку на паллете'); return; }
            setLoading(true);
            try {
              const res = await api.post('/movements/take-box-contents', { box_id: data.id });
              setSourceBox({ ...data, palletName: sourcePallet?.name, palletId: sourcePallet?.id, takenQty: res.data.total_qty });
              playBeep(true); toast.success(`Забрали ${res.data.total_qty} шт. из коробки`); setStep(3);
            } catch (err) {
              playBeep(false); setError(err.response?.data?.error || 'Ошибка');
            } finally { setLoading(false); }
          }} />
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="whole-3">
          <StepProgress current={2} total={totalSteps} color="bg-purple-500" />
          <ScanHint icon={BoxIcon} title="Куда пересыпаем?" subtitle="Сканируйте коробку назначения" color="green" />
          <div className="flex gap-2 mb-4 flex-wrap">
            <InfoTag label="У вас" value={`${sourceBox?.takenQty} шт.`} color="purple" />
            <InfoTag label="Из" value={sourceBox?.name} color="purple" />
          </div>
          <ErrorBanner message={error} />
          {loading && <div className="flex justify-center py-6"><Spinner size="lg" /></div>}
          <ScanInput placeholder="Наведите сканер на коробку..." disabled={loading} onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'box') { playBeep(false); setError('Сканируйте коробку'); return; }
            setLoading(true);
            try {
              await api.post('/movements/put-to-box', { box_id: data.id });
              playBeep(true); toast.success('Товар пересыпан'); setStep(4);
            } catch (err) {
              playBeep(false); setError(err.response?.data?.error || 'Ошибка');
            } finally { setLoading(false); }
          }} />
        </div>
      );
    }

    if (step === 4) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="whole-4">
          <StepProgress current={3} total={totalSteps} color="bg-purple-500" />
          <ScanHint icon={PalletIcon} title="Верните коробку" subtitle={`Поставьте ${sourceBox?.name} обратно на паллет`} color="amber" />
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
            <p className="text-sm text-amber-800 font-medium text-center">
              Верните коробку <b>{sourceBox?.name}</b> на паллет <b>{sourceBox?.palletName}</b>
            </p>
          </div>
          <ErrorBanner message={error} />
          {loading && <div className="flex justify-center py-6"><Spinner size="lg" /></div>}
          <ScanInput placeholder="Сканируйте паллет куда вернули..." disabled={loading} onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'pallet') { playBeep(false); setError('Сканируйте паллет'); return; }
            setLoading(true);
            try {
              await api.post('/movements/move-box', { box_id: sourceBox.id, dest_pallet_id: data.id });
              playBeep(true); setSuccess('Коробка возвращена'); setStep(5);
            } catch (err) {
              if (err.response?.data?.error?.includes('уже на этом')) { playBeep(true); setSuccess('Коробка на месте'); setStep(5); }
              else { playBeep(false); setError(err.response?.data?.error || 'Ошибка'); }
            } finally { setLoading(false); }
          }} />
          <button onClick={() => { setSuccess('Перемещение завершено'); setStep(5); }}
            className="w-full mt-3 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors">
            Пропустить
          </button>
        </div>
      );
    }

    if (step === 5) return <SuccessScreen message={success} onReset={reset} />;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // BOX TRANSFER MODE — переставить коробку на другой паллет
  // ═══════════════════════════════════════════════════════════════════════
  if (mode === 'box_transfer') {
    const totalSteps = 3;

    if (step === 1) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="bt-1">
          <button onClick={reset} className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={0} total={totalSteps} color="bg-indigo-500" />
          <ScanHint icon={PalletIcon} title="Откуда берём коробку?" subtitle="Сканируйте паллет, на котором стоит коробка" color="indigo" />
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на паллет..." onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'pallet') { playBeep(false); setError('Сканируйте паллет'); return; }
            setSourcePallet(data); playBeep(true); setStep(2);
          }} />
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="bt-2">
          <button onClick={() => { setStep(1); setSourcePallet(null); setError(''); }}
            className="flex items-center gap-1 text-sm text-gray-400 mb-3"><ArrowLeft size={16} /> Назад</button>
          <StepProgress current={1} total={totalSteps} color="bg-indigo-500" />
          <ScanHint icon={BoxIcon} title="Какую коробку переставляем?" subtitle="Сканируйте коробку" color="indigo" />
          <div className="mb-4"><InfoTag label="Паллет" value={sourcePallet?.name} color="indigo" /></div>
          <ErrorBanner message={error} />
          <ScanInput placeholder="Наведите сканер на коробку..." onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'box') { playBeep(false); setError('Сканируйте коробку'); return; }
            setSourceBox(data); playBeep(true); setStep(3);
          }} />
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="p-4 max-w-md mx-auto animate-fade-in" key="bt-3">
          <StepProgress current={2} total={totalSteps} color="bg-indigo-500" />
          <ScanHint icon={PalletIcon} title="Куда ставим?" subtitle="Сканируйте паллет назначения" color="green" />
          <div className="flex gap-2 mb-4 flex-wrap">
            <InfoTag label="Коробка" value={sourceBox?.name} color="indigo" />
            <InfoTag label="С паллета" value={sourcePallet?.name} color="indigo" />
          </div>
          <ErrorBanner message={error} />
          {loading && <div className="flex justify-center py-6"><Spinner size="lg" /></div>}
          <ScanInput placeholder="Наведите сканер на паллет..." disabled={loading} onScan={async (bc) => {
            const data = await scanBarcode(bc);
            if (!data) return;
            if (data.type !== 'pallet') { playBeep(false); setError('Сканируйте паллет'); return; }
            setLoading(true);
            try {
              await api.post('/movements/move-box', { box_id: sourceBox.id, dest_pallet_id: data.id });
              playBeep(true); setSuccess(`Коробка ${sourceBox?.name} перенесена на ${data.name}`); setStep(4);
            } catch (err) {
              playBeep(false); setError(err.response?.data?.error || 'Ошибка');
            } finally { setLoading(false); }
          }} />
        </div>
      );
    }

    if (step === 4) return <SuccessScreen message={success} onReset={reset} />;
  }

  return null;
}

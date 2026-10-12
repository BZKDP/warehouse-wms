import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, ArrowRightLeft, RefreshCw, Inbox, MapPin, ArrowLeft, Check, ScanLine, Clock, X } from 'lucide-react';
import { ProductIcon } from '../../components/ui/WarehouseIcons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { qty } from '../../utils/fmt';
import Spinner from '../../components/ui/Spinner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../utils/cn';
import { playBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';

function ScanInput({ onScan, placeholder, disabled, autoFocus = true }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus, disabled]);
  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    clearTimeout(timerRef.current);
    if (v.length >= 4) timerRef.current = setTimeout(() => { const s = v.trim(); if (s) { onScan(s); setValue(''); } }, SCAN_AUTO_SUBMIT_MS);
  };
  return (
    <input ref={inputRef} value={value} onChange={handleChange}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timerRef.current); const v = value.trim(); if (v) { onScan(v); setValue(''); } } }}
      placeholder={placeholder} disabled={disabled}
      className="w-full px-4 py-3.5 rounded-2xl border-2 border-dashed border-primary-300 focus:border-primary-500 focus:border-solid bg-white text-center text-lg font-mono transition-all outline-none disabled:opacity-40" />
  );
}

function formatSource(src) {
  if (!src) return null;
  const type = src.movement_type || '';
  if (src.from_shelf_code) return `Полка ${src.from_shelf_code}`;
  if (src.from_pallet_name) return `Паллет ${src.from_pallet_name}`;
  if (src.from_box_barcode) return `Коробка ${src.from_box_barcode}`;
  if (src.task_title) return src.task_title;
  if (type.includes('external')) return 'Внешний приход';
  if (type.includes('correction')) return 'Корректировка';
  if (src.notes) return src.notes;
  return type.replace(/_/g, ' ');
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'только что';
  if (mins < 60) return `${mins} мин. назад`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} ч. назад`;
  const days = Math.floor(hrs / 24);
  return `${days} дн. назад`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

export default function MyInventoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  // Deliver mode
  const [deliverItem, setDeliverItem] = useState(null); // item being delivered
  const [deliverLocations, setDeliverLocations] = useState([]); // where to put it
  const [deliverLoading, setDeliverLoading] = useState(false);
  const [deliverError, setDeliverError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/movements/my-inventory');
      setItems(res.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ─── Start delivering an item ─────────────────────────────────────────
  const startDeliver = async (item) => {
    setDeliverItem(item);
    setDeliverError('');
    try {
      const res = await api.get(`/warehouse/find-product?product_id=${item.product_id}`);
      setDeliverLocations(res.data || []);
    } catch {
      setDeliverLocations([]);
    }
  };

  // ─── Scan box to deliver ──────────────────────────────────────────────
  const handleScanBox = async (barcode) => {
    setDeliverError('');
    try {
      const scanRes = await api.post('/movements/scan', { barcode });
      if (scanRes.data.type !== 'box') {
        playBeep(false);
        setDeliverError('Сканируйте коробку на полке');
        return;
      }
      setDeliverLoading(true);
      await api.post('/movements/move', {
        product_id: deliverItem.product_id,
        quantity: parseFloat(deliverItem.quantity),
        source_type: 'employee',
        source_id: user.employee_id,
        dest_type: 'box',
        dest_id: scanRes.data.id,
      });
      playBeep(true);
      toast.success(`${qty(deliverItem.quantity)} шт. переложено`);
      setDeliverItem(null);
      load();
    } catch (err) {
      playBeep(false);
      setDeliverError(err.response?.data?.error || 'Ошибка');
    } finally { setDeliverLoading(false); }
  };

  const totalQty = items.reduce((s, i) => s + Number(i.quantity || 0), 0);

  // ─── DELIVER MODE ─────────────────────────────────────────────────────
  if (deliverItem) {
    const loc = deliverLocations[0];
    const locationText = loc
      ? `${loc.rack_code || loc.rack_name} · ${loc.shelf_code || loc.shelf_name} · К${loc.box_position}`
      : 'Место не найдено на полках';

    return (
      <div className="p-4 max-w-lg mx-auto">
        <button onClick={() => { setDeliverItem(null); setDeliverError(''); }}
          className="flex items-center gap-1 text-sm text-gray-400 mb-4">
          <ArrowLeft size={16} /> Назад к товарам
        </button>

        {/* Where to go */}
        <div className="bg-emerald-50 rounded-2xl p-5 mb-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 ring-4 ring-emerald-200 flex items-center justify-center mx-auto mb-3">
            <MapPin size={28} />
          </div>
          <p className="text-sm font-bold text-gray-900 mb-1">Отнесите к коробке</p>
          {loc ? (
            <p className="text-lg font-bold text-emerald-700 bg-white rounded-xl py-2 px-4 mt-2 inline-block shadow-sm border border-emerald-200">
              {locationText}
            </p>
          ) : (
            <p className="text-sm text-gray-500 mt-2">Товар не найден на стеллажах — отсканируйте любую коробку</p>
          )}
        </div>

        {/* What to deliver */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 mb-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">Переложить в коробку:</p>
          <p className="text-sm font-medium text-gray-900 truncate">{deliverItem.product_name}</p>
          <p className="text-lg font-bold text-emerald-600 mt-1">{qty(deliverItem.quantity)} шт.</p>
        </div>

        {deliverError && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-3">
            <p className="text-sm text-rose-700">{deliverError}</p>
          </div>
        )}

        {deliverLoading && <div className="flex justify-center py-4"><Spinner size="lg" /></div>}

        <p className="text-xs text-gray-400 text-center mb-2">Сканируйте коробку, в которую кладёте</p>
        <ScanInput placeholder="Наведите сканер на коробку..." onScan={handleScanBox} disabled={deliverLoading} />
      </div>
    );
  }

  // ─── MAIN LIST ────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-200">
          <Package size={22} className="text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Мой товар</h1>
          <p className="text-xs text-gray-400">
            {items.length > 0 ? `${items.length} позиций · ${qty(totalQty)} шт.` : 'Товары, которые сейчас у вас'}
          </p>
        </div>
        <button onClick={load}
          className="p-2.5 rounded-xl text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 transition-all active:scale-95">
          <RefreshCw size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center mb-4">
            <Inbox size={32} className="text-gray-300" />
          </div>
          <p className="text-gray-500 font-semibold">У вас нет товаров</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Товары появляются при перемещениях и задачах</p>
          <button onClick={() => navigate('/employee/move')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-600 text-sm font-semibold hover:bg-emerald-100 transition-all active:scale-95">
            <ArrowRightLeft size={16} />
            Перейти к перемещению
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const src = formatSource(item.last_source);
            const ago = timeAgo(item.last_source?.created_at);
            return (
              <div key={item.product_id} className={cn(
                'bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800',
                'transition-all hover:shadow-sm hover:border-emerald-200 overflow-hidden'
              )}>
                {/* Main row */}
                <div className="flex items-center gap-3 p-4">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                    <ProductIcon size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 truncate">{item.product_name}</p>
                    {item.product_code && <p className="text-[10px] text-gray-400 font-mono">{item.product_code}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className="text-lg font-black text-emerald-600">{qty(item.quantity)}<span className="text-xs font-medium text-gray-400 ml-0.5">шт.</span></p>
                    <button onClick={() => startDeliver(item)}
                      title="Положить на место"
                      className="p-2 rounded-xl text-gray-300 hover:text-emerald-500 hover:bg-emerald-50 transition-all active:scale-95">
                      <MapPin size={16} />
                    </button>
                  </div>
                </div>
                {/* Source info */}
                {src && (
                  <div className="px-4 pb-3 -mt-1 flex items-center gap-2 text-[10px] text-gray-400">
                    <Clock size={10} className="flex-shrink-0" />
                    <span className="truncate">Откуда: <span className="font-medium text-gray-500">{src}</span></span>
                    {ago && <span className="flex-shrink-0">· {ago}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

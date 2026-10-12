import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Package, Box, CheckCircle2, Printer,
  RefreshCw, ScanLine, AlertCircle, ChevronRight
} from 'lucide-react';
import { ProductIcon, PalletIcon, BoxIcon, ScanIcon, ShelfIcon } from '../../components/ui/WarehouseIcons';
import { printBarcode } from '../../utils/printBarcode';
import api from '../../api/client';
import { qty } from '../../utils/fmt';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Barcode from '../../components/ui/Barcode';
import CopyBadge from '../../components/ui/CopyBadge';
import { useToast } from '../../components/ui/Toast';
import { useAppSettings } from '../../context/AppSettingsContext';
import { makePlayBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';

function makeSpeedColor(fast, slow) {
  return (s) => s < fast ? 'text-green-500' : s < slow ? 'text-amber-500' : 'text-rose-400';
}

// ─── Шаг 1: Сканировать паллет для начала ─────────────────────────────────────
function StepScanPallet({ task, onSuccess }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const palletLabel = task.row_number && task.pallet_number
    ? `Р${task.row_number}П${task.pallet_number}`
    : task.pallet_name || '—';

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const doScan = useCallback(async (val) => {
    if (!val.trim() || loading) return;
    setLoading(true); setError('');
    try {
      await api.post(`/packing/${task.id}/start`, { pallet_barcode: val.trim() });
      playBeep(true);
      onSuccess();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setLoading(false); }
  }, [task.id, loading]);

  const handleChange = (e) => {
    const v = e.target.value; setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= 4) timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="space-y-6">
      {/* Инструкция */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center flex-shrink-0 shadow-sm">
            <PalletIcon size={28} />
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Задание</p>
            <p className="font-bold text-gray-900 leading-tight">{task.title}</p>
          </div>
        </div>
        {task.product_name && (
          <div className="bg-gray-50 rounded-xl p-3">
            <p className="text-xs text-gray-400 mb-0.5">Товар</p>
            <p className="font-semibold text-gray-900">{task.product_name}</p>
            {task.box_size && <p className="text-xs text-gray-500 mt-0.5">{task.box_size} шт. в коробке</p>}
          </div>
        )}
      </div>

      {/* Шаги */}
      <div className="card p-5 space-y-4">
        <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">Что делать</p>
        <Step num={1} active text={`Подойдите к паллету`} sub={<span className="font-bold text-primary-700">{palletLabel}</span>} />
        <Step num={2} text="Найдите штрих-код на паллете" />
        <Step num={3} text="Отсканируйте штрих-код паллета" />
      </div>

      {/* Скан */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Сканируйте паллет</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={value}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(value); } }}
          placeholder="Поднесите сканер к паллету..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={loading} autoComplete="off"
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
        <Button variant="primary-solid" size="lg" className="w-full" loading={loading} onClick={() => doScan(value)}>
          Подтвердить
        </Button>
      </div>
    </div>
  );
}

// ─── Шаг 2: Открыть новую коробку или переоткрыть существующую ────────────────
function StepOpenBox({ task, stats, onOpen, onReused }) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);

  const reuseInputRef = useRef(null);
  const reuseTimerRef = useRef(null);
  const [reuseValue, setReuseValue] = useState('');
  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseError, setReuseError] = useState('');

  const palletLabel = task.row_number && task.pallet_number
    ? `Р${task.row_number}П${task.pallet_number}` : task.pallet_name || '—';

  const handleOpen = async () => {
    setLoading(true);
    try { await onOpen(); }
    catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); setLoading(false); }
  };

  const doReuse = useCallback(async (val) => {
    if (!val.trim() || reuseLoading) return;
    setReuseLoading(true); setReuseError('');
    try {
      const res = await api.post(`/packing/${task.id}/reuse-box`, { box_barcode: val.trim() });
      playBeep(true);
      toast.success(`Коробка открыта: ${res.data.box.quantity} / ${res.data.box.box_size} шт.`);
      onReused();
    } catch (err) {
      playBeep(false);
      setReuseError(err.response?.data?.error || 'Ошибка');
      setReuseValue('');
      setTimeout(() => reuseInputRef.current?.focus(), 100);
    } finally { setReuseLoading(false); }
  }, [task.id, reuseLoading]);

  const handleReuseChange = (e) => {
    const v = e.target.value; setReuseValue(v);
    if (reuseTimerRef.current) clearTimeout(reuseTimerRef.current);
    if (v.trim().length >= 4) reuseTimerRef.current = setTimeout(() => doReuse(v), SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="space-y-5">
      {stats && parseInt(stats.closed_boxes) > 0 && (
        <div className="card p-4 grid grid-cols-2 gap-3">
          <div className="bg-green-50 rounded-xl p-3 text-center border border-green-100">
            <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">Коробок</p>
            <p className="text-2xl font-black text-green-600">{stats.closed_boxes}</p>
          </div>
          <div className="bg-primary-50 rounded-xl p-3 text-center border border-primary-100">
            <p className="text-[10px] text-primary-500 font-bold uppercase tracking-wider">Штук</p>
            <p className="text-2xl font-black text-primary-600">{stats.closed_qty}</p>
          </div>
        </div>
      )}

      <div className="card p-5 space-y-4">
        <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">Новая коробка</p>
        <Step num={1} active text="Возьмите пустую коробку" />
        <Step num={2} text="Нажмите кнопку ниже — система создаст этикетку" />
        <Step num={3} text="Распечатайте этикетку, наклейте на коробку" />
        <Step num={4} text="Отсканируйте этикетку на коробке" />
      </div>

      <Button variant="primary-solid" size="xl" className="w-full" loading={loading} onClick={handleOpen}>
        <Box size={20} />
        Открыть новую коробку
      </Button>

      <div className="relative py-1">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
        <div className="relative flex justify-center">
          <span className="bg-gray-50 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">или</span>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Продолжить старую коробку</p>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          Если есть незаполненная коробка с тем же товаром — отсканируйте её штрих-код,
          чтобы дозаполнить. Остаток с полки ФБС будет списан автоматически.
        </p>
        <input
          ref={reuseInputRef}
          type="text" value={reuseValue}
          onChange={handleReuseChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (reuseTimerRef.current) clearTimeout(reuseTimerRef.current); doReuse(reuseValue); } }}
          placeholder="Отсканируйте ШК существующей коробки..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={reuseLoading} autoComplete="off"
        />
        {reuseError && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{reuseError}</p>
          </div>
        )}
      </div>

      <Button variant="success" size="lg" className="w-full" onClick={() => {
        if (confirm('Завершить задачу? Все коробки будут закрыты.')) {
          api.post(`/packing/${task.id}/complete`).then(() => window.location.reload()).catch(e => toast.error(e.response?.data?.error || 'Ошибка'));
        }
      }}>
        <CheckCircle2 size={18} />
        Завершить задание
      </Button>
    </div>
  );
}

// ─── Шаг 3: Распечатать и отсканировать этикетку коробки ──────────────────────
function StepConfirmBox({ task, box, onConfirmed }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  const printLabel = () => {
    printBarcode(box.barcode_value, 'Коробка', task.title || '');
  };

  const doScan = useCallback(async (val) => {
    if (!val.trim() || loading) return;
    setLoading(true); setError('');
    try {
      await api.post(`/packing/${task.id}/confirm-box`, { scanned_barcode: val.trim() });
      playBeep(true);
      onConfirmed();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setLoading(false); }
  }, [task.id, loading]);

  const handleChange = (e) => {
    const v = e.target.value; setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= 4) timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">Что делать</p>
        <Step num={1} done text="Коробка открыта — этикетка готова" />
        <Step num={2} active text="Нажмите «Печать», распечатайте этикетку" />
        <Step num={3} text="Наклейте этикетку на коробку" />
        <Step num={4} text="Отсканируйте этикетку на коробке для подтверждения" />
      </div>

      {/* Штрихкод */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Штрих-код коробки</p>
            <div className="flex items-center gap-2 mt-1">
              <p className="font-mono font-bold text-gray-900">{box.barcode_value}</p>
              <CopyBadge value={box.barcode_value} label="Копировать" />
            </div>
          </div>
          <button onClick={printLabel}
            className="flex items-center gap-1.5 bg-primary-50 text-primary-700 font-semibold text-sm px-4 py-2.5 rounded-xl hover:bg-primary-100 transition-all">
            <Printer size={16} /> Печать
          </button>
        </div>
        <div className="flex justify-center py-2">
          <Barcode value={box.barcode_value} height={55} />
        </div>
      </div>

      {/* Скан */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Отсканируйте наклейку на коробке</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={value}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(value); } }}
          placeholder="Поднесите сканер к наклейке..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={loading} autoComplete="off"
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Шаг 4: Сканировать товары в коробку ──────────────────────────────────────
function StepFillBox({ task, box, onRefresh, onDone, onRemainder }) {
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const speedColor = makeSpeedColor(settings.scan_fast_threshold, settings.scan_slow_threshold);

  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const prevScanAt = useRef(null);
  const [value, setValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [flash, setFlash] = useState(false);
  const [scanTimes, setScanTimes] = useState([]); // последние 10 интервалов в секундах

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const doScan = useCallback(async (val) => {
    if (!val.trim() || scanning) return;
    // считаем интервал с предыдущего скана
    const now = Date.now();
    const delta = prevScanAt.current ? (now - prevScanAt.current) / 1000 : null;
    prevScanAt.current = now;

    setScanning(true); setValue('');
    try {
      const res = await api.post(`/packing/${task.id}/scan`, { scanned_value: val.trim() });
      if (res.data.ok) {
        playBeep(true);
        setFlash(true); setTimeout(() => setFlash(false), 400);
        if (delta !== null) {
          setScanTimes(prev => [...prev.slice(-9), delta]);
        }
        setLastScan({ ok: true, message: res.data.product_name, box_qty: res.data.box_qty, box_size: res.data.box_size, delta });
        onRefresh();
      } else {
        playBeep(false);
        setLastScan({ ok: false, message: res.data.error, delta: null, hint: res.data.hint || null });
      }
    } catch (err) {
      playBeep(false);
      setLastScan({ ok: false, message: err.response?.data?.error || 'Ошибка', delta: null });
    } finally {
      setScanning(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [task.id, scanning]);

  const handleChange = (e) => {
    const v = e.target.value; setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= settings.scan_min_length) {
      timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
    }
  };

  const pct = box.box_size > 0 ? Math.min(100, Math.round((box.quantity / box.box_size) * 100)) : 0;
  const isFull = box.quantity >= box.box_size;

  const avgTime = scanTimes.length >= 2
    ? (scanTimes.reduce((a, b) => a + b, 0) / scanTimes.length).toFixed(1)
    : null;



  return (
    <div className="space-y-4">
      {/* Прогресс */}
      <div className={`card p-4 space-y-3 transition-all duration-200 ${flash ? 'ring-2 ring-green-400 bg-green-50' : ''}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Box size={16} className="text-primary-500" />
            <span className="text-sm font-semibold text-gray-700">Текущая коробка</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Среднее время — показываем после 2+ сканов */}
            {avgTime && (
              <span className={`text-xs font-medium ${speedColor(parseFloat(avgTime))}`}>
                ⌀ {avgTime}с
              </span>
            )}
            <span className={`text-lg font-bold ${isFull ? 'text-green-600' : 'text-gray-900'}`}>
              {qty(box.quantity)} / {qty(box.box_size)} шт.
            </span>
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-300 ${isFull ? 'bg-green-500' : 'bg-primary-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Мини-лента последних сканов */}
        {scanTimes.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {scanTimes.map((t, i) => (
              <span
                key={i}
                className={`text-xs px-1.5 py-0.5 rounded-md font-mono animate-pop-in ${
                  t < 3 ? 'bg-green-100 text-green-700' :
                  t < 6 ? 'bg-amber-100 text-amber-700' :
                  'bg-rose-100 text-rose-600'
                }`}
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                {t.toFixed(1)}с
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Скан */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Сканируйте товар</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={value}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(value); } }}
          placeholder="Поднесите сканер к товару..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={scanning} autoComplete="off" autoFocus
        />
        {lastScan && (
          lastScan.hint ? (
            <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-400 text-sm animate-pulse">
              <div className="flex items-start gap-2">
                <AlertCircle size={20} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-amber-900">
                    {lastScan.hint === 'keyboard_layout' && 'Неправильная раскладка!'}
                    {lastScan.hint === 'url_scanned' && 'Это ссылка, а не штрих-код!'}
                    {lastScan.hint === 'partial_scan' && 'Штрих-код не полностью!'}
                    {lastScan.hint === 'duplicate_scan' && 'Штрих-код считался дважды!'}
                  </p>
                  <p className="text-amber-800 mt-1">{lastScan.message}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className={`flex items-start justify-between gap-2 p-3 rounded-xl text-sm font-medium
              ${lastScan.ok ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
              <div className="flex items-start gap-2">
                {lastScan.ok ? <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
                <div>
                  <p>{lastScan.message}</p>
                  {lastScan.ok && <p className="text-xs mt-0.5 opacity-75">В коробке: {lastScan.box_qty} / {lastScan.box_size} шт.</p>}
                </div>
              </div>
              {lastScan.ok && lastScan.delta != null && (
                <span className={`text-xs font-mono font-semibold flex-shrink-0 ${speedColor(lastScan.delta)}`}>
                  {lastScan.delta.toFixed(1)}с
                </span>
              )}
            </div>
          )
        )}
      </div>

      {/* Кнопка "Коробка заполнена" — только при достижении нормы */}
      {isFull && (
        <Button variant="primary-solid" size="xl" className="w-full" onClick={onDone}>
          <ChevronRight size={20} />
          Коробка заполнена → Перенести на паллет
        </Button>
      )}

      {/* Кнопка остатка — всегда видна внизу */}
      <div className="card p-4 space-y-3 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">Товар закончился раньше?</p>
            <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
              Если в коробке {qty(box.quantity)} шт. и больше товара нет — это остаток.
              Его нельзя отправить на паллет ФБО, нужно отнести на склад ФБС
              и положить в коробку с этим товаром.
            </p>
          </div>
        </div>
        <Button variant="outline" size="md" className="w-full border-amber-300 text-amber-700 hover:bg-amber-100"
          onClick={onRemainder}>
          Это остаток — отнести на склад ФБС
        </Button>
      </div>
    </div>
  );
}

// ─── Шаг 5: Перенести коробку на паллет (скан паллета) ────────────────────────
function StepTransferBox({ task, box, onSuccess }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const palletLabel = task.row_number && task.pallet_number
    ? `Р${task.row_number}П${task.pallet_number}` : task.pallet_name || '—';

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const doScan = useCallback(async (val) => {
    if (!val.trim() || loading) return;
    setLoading(true); setError('');
    try {
      await api.post(`/packing/${task.id}/close-box`, { pallet_barcode: val.trim() });
      playBeep(true);
      onSuccess();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setLoading(false); }
  }, [task.id, loading]);

  const handleChange = (e) => {
    const v = e.target.value; setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= 4) timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">Что делать</p>
        <Step num={1} done text="Коробка заполнена" sub={<span className="text-xs font-mono">{qty(box.quantity)} шт. / {box.barcode_value}</span>} />
        <Step num={2} active text={<>Отнесите коробку к паллету <span className="font-bold text-primary-700">{palletLabel}</span></>} />
        <Step num={3} text="Отсканируйте штрих-код паллета для подтверждения" />
        <Step num={4} text="Система запишет коробку на паллет" />
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Сканируйте паллет</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={value}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(value); } }}
          placeholder="Поднесите сканер к паллету..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={loading} autoComplete="off"
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
        <Button variant="primary-solid" size="lg" className="w-full" loading={loading} onClick={() => doScan(value)}>
          Подтвердить размещение
        </Button>
      </div>
    </div>
  );
}

// ─── Шаг 6а: Информация об остатке + сканирование коробки ФБС ─────────────────
function StepRemainderInfo({ task, box, onConfirmShelf, onBack }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const [recBox, setRecBox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/packing/${task.id}/remainder-box`)
      .then(r => setRecBox(r.data.box))
      .catch(() => {})
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [task.id]);

  const doScan = async (val) => {
    if (!val.trim() || scanning) return;
    setScanning(true); setError('');
    try {
      const res = await api.post(`/packing/${task.id}/close-remainder`, { box_barcode: val.trim() });
      playBeep(true);
      const boxLabel = res.data.shelf_box_barcode || val.trim();
      toast.success(`Остаток ${res.data.qty} шт. положен в коробку ${boxLabel} (полка ${res.data.shelf_code})`);
      onConfirmShelf();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
      setScanValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setScanning(false); }
  };

  const handleChange = (e) => {
    const v = e.target.value; setScanValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= 4) timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
  };

  const confirmRecommended = async () => {
    if (!recBox?.box_barcode) return;
    setScanning(true); setError('');
    try {
      const res = await api.post(`/packing/${task.id}/close-remainder`, { box_barcode: recBox.box_barcode });
      playBeep(true);
      const boxLabel = res.data.shelf_box_barcode || recBox.box_barcode;
      toast.success(`Остаток ${res.data.qty} шт. положен в коробку ${boxLabel} (полка ${res.data.shelf_code})`);
      onConfirmShelf();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
    } finally { setScanning(false); }
  };

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4 border-amber-200 bg-amber-50">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <div>
            <p className="font-bold text-amber-900">Остаток: {qty(box.quantity)} шт.</p>
            <p className="text-sm text-amber-800 mt-1 leading-relaxed">
              Эти {qty(box.quantity)} шт. не помещаются в полную коробку для ФБО паллета.
              Отнесите на склад ФБС и отсканируйте ШК коробки — остаток уйдёт в неё.
            </p>
          </div>
        </div>
      </div>

      {/* Сканировать коробку — основное действие */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Отсканируйте коробку ФБС</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={scanValue}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(scanValue); } }}
          placeholder="Поднесите сканер к коробке..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={scanning} autoComplete="off"
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
        <Button variant="primary-solid" size="lg" className="w-full" loading={scanning} onClick={() => doScan(scanValue)}>
          Подтвердить коробку
        </Button>
      </div>

      {/* Рекомендуемая коробка — подсказка */}
      {loading ? (
        <div className="card p-4 flex items-center justify-center h-16"><Spinner size="sm" /></div>
      ) : recBox ? (
        <button
          onClick={confirmRecommended}
          disabled={scanning}
          className="w-full card p-4 flex items-center gap-3 bg-primary-50 border-primary-200 hover:bg-primary-100 active:scale-[0.99] transition-all text-left"
        >
          <div className="w-11 h-11 rounded-xl bg-white/60 flex items-center justify-center flex-shrink-0 shadow-sm">
            <BoxIcon size={26} />
          </div>
          <div className="flex-1">
            <p className="text-xs text-primary-500 font-medium">Рекомендуемая коробка — нажмите для быстрого подтверждения</p>
            <p className="font-bold text-primary-900 text-lg">{recBox.box_name || `Коробка ${recBox.box_barcode}`}</p>
            <p className="text-xs text-primary-600">
              Полка {recBox.shelf_code} · {recBox.rack_name} · {recBox.warehouse_name}
              {Number(recBox.box_quantity) > 0 ? ` · ${qty(recBox.box_quantity)} шт. уже внутри` : ' · пустая'}
            </p>
          </div>
          <ChevronRight size={20} className="text-primary-400 flex-shrink-0" />
        </button>
      ) : null}

      <button onClick={onBack} className="w-full text-center text-sm text-gray-400 py-2">
        ← Вернуться к сканированию
      </button>
    </div>
  );
}

// ─── Шаг 6б: Сканировать полку ФБС для остатка ────────────────────────────────
function StepRemainderShelf({ task, box, onSuccess }) {
  const toast = useToast();
  const { settings } = useAppSettings();
  const playBeep = makePlayBeep(settings);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const doScan = useCallback(async (val) => {
    if (!val.trim() || loading) return;
    setLoading(true); setError('');
    try {
      const res = await api.post(`/packing/${task.id}/close-remainder`, { box_barcode: val.trim() });
      playBeep(true);
      const boxLabel = res.data.shelf_box_barcode || val.trim();
      toast.success(`Остаток ${res.data.qty} шт. положен в коробку ${boxLabel} (полка ${res.data.shelf_code})`);
      onSuccess();
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка');
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setLoading(false); }
  }, [task.id, loading]);

  const handleChange = (e) => {
    const v = e.target.value; setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (v.trim().length >= 4) timerRef.current = setTimeout(() => doScan(v), SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="space-y-5">
      <div className="card p-5 space-y-4">
        <p className="text-sm font-bold text-gray-700 uppercase tracking-wide">Что делать</p>
        <Step num={1} done text={`Возьмите ${qty(box.quantity)} шт. остатка`} />
        <Step num={2} done text="Пришли на склад ФБС" />
        <Step num={3} active text="Положите товар в коробку и отсканируйте ШК коробки" />
      </div>

      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ScanLine size={18} className="text-primary-500" />
          <p className="font-semibold text-gray-800">Сканируйте коробку ФБС</p>
        </div>
        <input
          ref={inputRef}
          type="text" value={value}
          onChange={handleChange}
          onKeyDown={e => { if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(value); } }}
          placeholder="Поднесите сканер к коробке..."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base
            placeholder:text-gray-400 focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none"
          disabled={loading} autoComplete="off"
        />
        {error && (
          <div className="flex items-start gap-2 p-3 bg-rose-50 rounded-xl text-sm text-rose-700">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <p>{error}</p>
          </div>
        )}
        <Button variant="primary-solid" size="lg" className="w-full" loading={loading} onClick={() => doScan(value)}>
          Подтвердить размещение на ФБС
        </Button>
      </div>
    </div>
  );
}

// ─── Завершено ────────────────────────────────────────────────────────────────
function StepCompleted({ task, stats, onBack }) {
  return (
    <div className="space-y-6 text-center relative overflow-hidden">
      {/* Confetti */}
      <div className="absolute inset-x-0 top-0 h-48 pointer-events-none overflow-hidden">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="absolute rounded-sm" style={{
            width: 6 + (i % 3) * 3,
            height: 6 + (i % 3) * 3,
            background: ['#7c3aed','#22c55e','#f59e0b','#3b82f6','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316','#10b981'][i],
            left: `${8 + i * 9}%`,
            animation: `confettiFall ${2 + (i % 3) * 0.5}s ease-in ${i * 0.15}s both`,
          }} />
        ))}
      </div>

      <div className="flex flex-col items-center gap-4 py-8">
        <div className="relative animate-scale-in">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center shadow-lg shadow-green-100 relative z-10">
            <CheckCircle2 size={48} className="text-green-500" />
          </div>
          <div className="absolute inset-0 rounded-full border-2 border-green-300 z-0" style={{ animation: 'ringPulse 2s ease-in-out infinite' }} />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 animate-fade-up" style={{ animationDelay: '0.3s' }}>Задание выполнено!</h2>
          <p className="text-sm text-gray-500 mt-1 animate-fade-up" style={{ animationDelay: '0.4s' }}>{task.title}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 rounded-2xl p-4 text-center border border-green-100 animate-fade-up" style={{ animationDelay: '0.5s' }}>
          <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">Коробок</p>
          <p className="text-3xl font-black text-green-600 mt-1">{stats?.closed_boxes ?? 0}</p>
        </div>
        <div className="bg-primary-50 rounded-2xl p-4 text-center border border-primary-100 animate-fade-up" style={{ animationDelay: '0.6s' }}>
          <p className="text-[10px] text-primary-500 font-bold uppercase tracking-wider">Принято</p>
          <p className="text-3xl font-black text-primary-600 mt-1">{stats?.closed_qty ?? 0}<span className="text-sm ml-0.5">шт</span></p>
        </div>
      </div>

      <button onClick={onBack}
        className="w-full py-3.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-primary-200 hover:-translate-y-0.5 hover:shadow-xl transition-all active:scale-[0.98] animate-fade-up"
        style={{ animationDelay: '0.7s' }}>
        <ArrowLeft size={16} className="inline mr-2" />
        Назад к задачам
      </button>
    </div>
  );
}

// ─── Вспомогательный компонент: шаг инструкции ────────────────────────────────
function Step({ num, active, done, text, sub }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold
        ${done ? 'bg-green-100 text-green-600' : active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
        {done ? <CheckCircle2 size={14} /> : num}
      </div>
      <div className="pt-0.5">
        <p className={`text-sm leading-snug ${active ? 'font-semibold text-gray-900' : done ? 'text-gray-400 line-through' : 'text-gray-600'}`}>
          {text}
        </p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Главная страница ──────────────────────────────────────────────────────────
export default function PackagingPage() {
  const { id: taskId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // шаг 5: скан паллета для закрытия коробки
  const [transferring, setTransferring] = useState(false);
  // шаг 6: остаток на ФБС
  const [remainder, setRemainder] = useState(false); // 'info' | 'shelf' | false
  const [elapsed, setElapsed] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get(`/packing/${taskId}`);
      setData(res.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Elapsed timer
  useEffect(() => {
    const startedAt = data?.task?.started_at ? new Date(data.task.started_at).getTime() : null;
    if (!startedAt) return;
    const tick = () => {
      const diff = Math.floor((Date.now() - startedAt) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [data?.task?.started_at]);

  const handleOpenBox = async () => {
    await api.post(`/packing/${taskId}/open-box`);
    await fetchData();
  };

  const { task, open_box, stats } = data || {};

  // Определяем текущий шаг
  const getStep = () => {
    if (!task) return null;
    if (task.status === 'completed') return 'completed';
    if (task.status === 'new') return 'scan_pallet';
    // in_progress:
    if (!open_box) return 'open_box';
    if (!open_box.confirmed) return 'confirm_box';
    if (remainder === 'info') return 'remainder_info';
    if (transferring) return 'transfer_box';
    return 'fill_box';
  };

  const step = getStep();

  const stepTitle = {
    scan_pallet: 'Шаг 1: Подтвердить паллет',
    open_box: 'Шаг 2: Открыть коробку',
    confirm_box: 'Шаг 3: Подтвердить коробку',
    fill_box: 'Шаг 4: Заполнить коробку',
    transfer_box: 'Шаг 5: Перенести на паллет',
    remainder_info: 'Шаг 6: Остаток → склад ФБС',
    completed: 'Выполнено',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Шапка */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate(-1)}
          className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all">
          <ArrowLeft size={20} />
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-100 to-purple-200 flex items-center justify-center flex-shrink-0">
          <BoxIcon size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold text-gray-900 truncate">
            {task?.title || 'Оприходование'}
          </h1>
          {step && stepTitle[step] && (
            <p className="text-xs text-gray-400">{stepTitle[step]}</p>
          )}
        </div>
        <button onClick={fetchData} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all">
          <RefreshCw size={16} />
        </button>
        <div className="flex flex-col items-end gap-0.5">
          {task?.status === 'completed' && <Badge variant="success" dot>Выполнено</Badge>}
          {task?.status === 'in_progress' && <Badge variant="warning" dot>В работе</Badge>}
          {task?.status === 'new' && <Badge variant="default" dot>Новая</Badge>}
          {elapsed && <span className="text-[10px] font-mono text-gray-400">{elapsed}</span>}
        </div>
      </div>

      {/* Контент */}
      <div className="max-w-lg mx-auto px-4 py-5">
        {loading ? (
          <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
        ) : !task ? (
          <div className="card p-6 text-center text-gray-400">
            <AlertCircle size={32} className="mx-auto mb-2 opacity-50" />
            <p>Задача не найдена</p>
          </div>
        ) : step === 'scan_pallet' ? (
          <StepScanPallet task={task} onSuccess={fetchData} />
        ) : step === 'open_box' ? (
          <StepOpenBox task={task} stats={stats} onOpen={handleOpenBox} onReused={fetchData} />
        ) : step === 'confirm_box' ? (
          <StepConfirmBox task={task} box={open_box} onConfirmed={fetchData} />
        ) : step === 'fill_box' ? (
          <StepFillBox
            task={task} box={open_box} onRefresh={fetchData}
            onDone={() => setTransferring(true)}
            onRemainder={() => setRemainder('info')}
          />
        ) : step === 'transfer_box' ? (
          <StepTransferBox task={task} box={open_box} onSuccess={() => { setTransferring(false); fetchData(); }} />
        ) : step === 'remainder_info' ? (
          <StepRemainderInfo
            task={task} box={open_box}
            onConfirmShelf={() => { setRemainder(false); fetchData(); }}
            onBack={() => setRemainder(false)}
          />
        ) : step === 'completed' ? (
          <StepCompleted task={task} stats={stats} onBack={() => navigate(-1)} />
        ) : null}
      </div>
    </div>
  );
}

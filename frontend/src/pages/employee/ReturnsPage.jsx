import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, ArrowLeft, RotateCcw, MapPin, Package, ScanLine, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { BoxIcon, ReturnsIcon } from '../../components/ui/WarehouseIcons';
import Spinner from '../../components/ui/Spinner';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/ui/Toast';
import { useNavigate } from 'react-router-dom';
import { playBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';

function ScanInput({ onScan, placeholder, disabled, autoFocus = true }) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => { if (autoFocus && inputRef.current) inputRef.current.focus(); }, [autoFocus, disabled]);

  const submittingRef = useRef(false);

  const submit = () => {
    if (submittingRef.current) return;
    clearTimeout(timerRef.current);
    const v = value.trim();
    if (v) { submittingRef.current = true; onScan(v); setValue(''); setTimeout(() => { submittingRef.current = false; }, 300); }
  };

  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    clearTimeout(timerRef.current);
    if (v.length >= 4) timerRef.current = setTimeout(() => { if (!submittingRef.current) { const s = v.trim(); if (s) { submittingRef.current = true; onScan(s); setValue(''); setTimeout(() => { submittingRef.current = false; }, 300); } } }, SCAN_AUTO_SUBMIT_MS);
  };

  return (
    <div className="relative">
      <div className="absolute inset-0 rounded-2xl bg-primary-400/20 animate-pulse pointer-events-none" style={{ animationDuration: '2.5s' }} />
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        placeholder={placeholder}
        disabled={disabled}
        className="scan-input relative w-full px-4 py-4 rounded-2xl border-2 border-dashed border-primary-300 focus:border-primary-500 focus:border-solid bg-white text-center text-lg font-mono transition-all outline-none disabled:opacity-40"
      />
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────

const styleId = 'returns-page-animations';
if (typeof document !== 'undefined' && !document.getElementById(styleId)) {
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes fade-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes bounce-in { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 15%, 45%, 75% { transform: translateX(-4px); } 30%, 60%, 90% { transform: translateX(4px); } }
    .ret-fade-in { animation: fade-in 0.4s ease-out; }
    .ret-bounce-in { animation: bounce-in 0.5s ease-out; }
    .ret-shake { animation: shake 0.4s ease-in-out; }
  `;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function ReturnsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  // Phase: 'start' | 'scanning' | 'delivering' | 'done'
  const [phase, setPhase] = useState('start');
  const [taskId, setTaskId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Check for existing active returns task on mount
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    api.get('/tasks', { params: { limit: 50 } })
      .then(res => {
        const active = (res.data.items || []).find(t => t.task_type === 'returns' && t.status === 'in_progress');
        if (active && phase === 'start') {
          setTaskId(active.id);
          setPhase('scanning');
        }
      }).catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  // Accumulated items to deliver: [{ product_id, product_name, quantity, locations: [...] }]
  const [items, setItems] = useState([]);
  // Currently delivering item index
  const [deliverIdx, setDeliverIdx] = useState(null);
  // Stats
  const [totalDelivered, setTotalDelivered] = useState(0);

  // ─── Start: Create task ────────────────────────────────────────────────
  const handleStart = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/tasks', {
        title: 'Разложить возвраты',
        employee_id: user.employee_id,
        task_type: 'returns',
      });
      setTaskId(res.data.id);
      // Start the task immediately
      await api.post(`/tasks/${res.data.id}/start`);
      setPhase('scanning');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка создания задачи');
    } finally { setLoading(false); }
  };

  // ─── Scan product barcode ──────────────────────────────────────────────
  const handleScanProduct = async (barcode) => {
    setError('');
    try {
      // Resolve barcode to product
      const scanRes = await api.post('/movements/scan', { barcode });
      const data = scanRes.data;
      if (data.type !== 'product') {
        playBeep(false);
        setError(data.type === 'box' ? 'Это коробка, а нужна банка' : 'Сканируйте банку (товар)');
        return;
      }

      // Find where this product lives on shelves
      const locRes = await api.get(`/warehouse/find-product?product_id=${data.id}`);
      const locations = locRes.data || [];

      // Add to employee inventory (external → employee)
      await api.post('/movements/move', {
        product_id: data.id, quantity: 1,
        dest_type: 'employee', dest_id: user.employee_id,
      });

      // Log scan in task for chronology (lightweight — no inventory changes)
      if (taskId) {
        try { await api.post(`/tasks/${taskId}/log-scan`, { scanned_value: barcode, product_id: data.id }); } catch {}
      }

      // Add to items list
      setItems(prev => {
        const existing = prev.find(i => i.product_id === data.id);
        if (existing) {
          return prev.map(i => i.product_id === data.id
            ? { ...i, quantity: i.quantity + 1, locations }
            : i
          );
        }
        return [...prev, {
          product_id: data.id,
          product_name: data.name,
          quantity: 1,
          locations,
        }];
      });

      playBeep(true);
    } catch {
      playBeep(false);
      setError('Не найдено по этому штрих-коду');
    }
  };

  // ─── Start delivering a specific item ──────────────────────────────────
  const startDeliver = (idx) => {
    setDeliverIdx(idx);
    setPhase('delivering');
    setError('');
  };

  // ─── Scan destination box ──────────────────────────────────────────────
  const handleScanBox = async (barcode) => {
    setError('');
    const item = items[deliverIdx];
    if (!item) return;

    try {
      const scanRes = await api.post('/movements/scan', { barcode });
      const data = scanRes.data;
      if (data.type !== 'box') {
        playBeep(false);
        setError('Сканируйте коробку на полке');
        return;
      }

      // Move items from employee to this box
      await api.post('/movements/move', {
        product_id: item.product_id,
        quantity: item.quantity,
        source_type: 'employee',
        source_id: user.employee_id,
        dest_type: 'box',
        dest_id: data.id,
      });

      // Log delivery scan in task
      if (taskId) {
        try { await api.post(`/tasks/${taskId}/log-scan`, { scanned_value: barcode, product_id: item.product_id }); } catch {}
      }

      playBeep(true);
      toast.success(`${item.quantity} шт. переложено в коробку`);

      setTotalDelivered(prev => prev + item.quantity);

      // Remove delivered item
      setItems(prev => prev.filter((_, i) => i !== deliverIdx));
      setDeliverIdx(null);
      setPhase('scanning');
    } catch (err) {
      playBeep(false);
      setError(err.response?.data?.error || 'Ошибка перемещения');
    }
  };

  // ─── Complete task ─────────────────────────────────────────────────────
  const handleComplete = async () => {
    if (taskId) {
      try {
        await api.post(`/tasks/${taskId}/complete`);
      } catch (err) {
        console.error('[Returns] Complete failed:', err.response?.data?.error || err.message);
      }
    }
    setTaskId(null);
    setPhase('done');
    setItems([]);
  };

  // ─── Remove item from list (just remove from UI, inventory stays with employee) ─
  const removeItem = (idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  // ─── CHECKING ──────────────────────────────────────────────────────────
  if (checking) {
    return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  }

  // ─── START PHASE ───────────────────────────────────────────────────────
  if (phase === 'start') {
    return (
      <div className="p-4 max-w-md mx-auto ret-fade-in">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Возвраты</h1>
        <p className="text-sm text-gray-400 mb-6">Разложить возвращённые баночки по полкам</p>

        <div className="bg-cyan-50 rounded-2xl p-6 mb-5 text-center">
          <div className="w-20 h-20 rounded-2xl bg-cyan-100 text-cyan-600 ring-4 ring-cyan-200 flex items-center justify-center mx-auto mb-4">
            <ReturnsIcon size={48} />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Как это работает</h2>
          <div className="text-left space-y-2 text-sm text-gray-600">
            <p>1. Сканируете баночки из возврата</p>
            <p>2. Система покажет, в какую коробку отнести</p>
            <p>3. Подходите к коробке, сканируете — готово</p>
          </div>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-4 ret-shake">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        <button onClick={handleStart} disabled={loading}
          className="w-full py-4 rounded-2xl bg-cyan-500 text-white font-bold text-base hover:bg-cyan-600 disabled:opacity-50 transition-all shadow-lg shadow-cyan-200 active:scale-[0.98]">
          {loading ? <Spinner size="sm" className="mx-auto" /> : 'Начать раскладку возвратов'}
        </button>
      </div>
    );
  }

  // ─── SCANNING PHASE ────────────────────────────────────────────────────
  if (phase === 'scanning') {
    const totalItems = items.reduce((s, i) => s + i.quantity, 0);

    return (
      <div className="p-4 max-w-md mx-auto ret-fade-in">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => {
            if (items.length === 0) { handleComplete(); return; }
            // Confirm if have items
          }} className="flex items-center gap-1 text-sm text-gray-400">
            <ArrowLeft size={16} />
          </button>
          <h2 className="text-sm font-bold text-gray-500">Сканируйте баночки</h2>
          {totalDelivered > 0 && (
            <span className="text-xs bg-green-50 text-green-600 px-2 py-1 rounded-lg font-medium">
              Разложено: {totalDelivered}
            </span>
          )}
        </div>

        {/* Scan hint */}
        <div className="bg-cyan-50 rounded-2xl p-5 mb-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-100 text-cyan-600 ring-4 ring-cyan-200 flex items-center justify-center mx-auto mb-3">
            <ScanLine size={28} />
          </div>
          <p className="text-sm font-bold text-gray-900">Сканируйте банку из возврата</p>
          <p className="text-xs text-gray-500 mt-1">Система найдёт, куда её отнести</p>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-3 ret-shake">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        <ScanInput placeholder="Наведите сканер на банку..." onScan={handleScanProduct} />

        {/* Complete button — always visible */}
        {items.length === 0 && (
          <button onClick={handleComplete}
            className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors mt-4">
            Завершить задачу
          </button>
        )}

        {/* Accumulated items */}
        {items.length > 0 && (
          <div className="mt-5 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase">Нужно разложить ({totalItems} шт.)</p>
            {items.map((item, idx) => {
              const loc = item.locations?.[0];
              const locationText = loc
                ? `${loc.rack_code || loc.rack_name} · ${loc.shelf_code || loc.shelf_name} · К${loc.box_position}`
                : 'Место не найдено';
              return (
                <div key={item.product_id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden ret-fade-in">
                  {/* Product info */}
                  <div className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.product_name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-sm font-bold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-lg">{item.quantity} шт.</span>
                        </div>
                      </div>
                      <button onClick={() => removeItem(idx)} className="p-1 text-gray-300 hover:text-rose-400 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {/* Location hint + deliver button */}
                  <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between border-t border-gray-100">
                    <div className="flex items-center gap-2 text-xs text-gray-500 min-w-0">
                      <MapPin size={12} className="text-cyan-500 flex-shrink-0" />
                      <span className="truncate">{locationText}</span>
                    </div>
                    <button onClick={() => startDeliver(idx)}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 text-white text-xs font-bold hover:bg-cyan-600 transition-colors flex-shrink-0 ml-2">
                      Отнести
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Complete button */}
            <button onClick={handleComplete}
              className="w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 text-sm font-medium hover:bg-gray-50 transition-colors mt-2">
              Завершить задачу
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── DELIVERING PHASE ──────────────────────────────────────────────────
  if (phase === 'delivering' && deliverIdx !== null) {
    const item = items[deliverIdx];
    if (!item) { setPhase('scanning'); return null; }
    const loc = item.locations?.[0];
    const locationText = loc
      ? `${loc.rack_code || loc.rack_name} · ${loc.shelf_code || loc.shelf_name} · К${loc.box_position}`
      : '';

    return (
      <div className="p-4 max-w-md mx-auto ret-fade-in">
        <button onClick={() => { setPhase('scanning'); setDeliverIdx(null); setError(''); }}
          className="flex items-center gap-1 text-sm text-gray-400 mb-3">
          <ArrowLeft size={16} /> Назад к списку
        </button>

        {/* Where to go */}
        <div className="bg-cyan-50 rounded-2xl p-5 mb-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-cyan-100 text-cyan-600 ring-4 ring-cyan-200 flex items-center justify-center mx-auto mb-3">
            <MapPin size={28} />
          </div>
          <p className="text-sm font-bold text-gray-900 mb-1">Отнесите к коробке</p>
          {locationText && (
            <p className="text-lg font-bold text-cyan-700 bg-white rounded-xl py-2 px-4 mt-2 inline-block shadow-sm border border-cyan-200">
              {locationText}
            </p>
          )}
        </div>

        {/* What to deliver */}
        <div className="bg-white rounded-xl border border-gray-100 px-4 py-3 mb-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">Переложить в коробку:</p>
          <p className="text-sm font-medium text-gray-900 truncate">{item.product_name}</p>
          <p className="text-lg font-bold text-cyan-600 mt-1">{item.quantity} шт.</p>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-3 ret-shake">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center mb-2">Сканируйте коробку, в которую кладёте</p>
        <ScanInput placeholder="Наведите сканер на коробку..." onScan={handleScanBox} />
      </div>
    );
  }

  // ─── DONE PHASE ────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="p-4 max-w-md mx-auto text-center py-16 ret-fade-in">
        <div className="w-20 h-20 rounded-full bg-green-100 ring-4 ring-green-200 flex items-center justify-center mx-auto mb-5 ret-bounce-in">
          <Check size={40} className="text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Задача завершена!</h2>
        <p className="text-sm text-gray-500 mb-2">
          {totalDelivered > 0 ? `Разложено ${totalDelivered} шт. по полкам` : 'Возвраты разложены'}
        </p>
        <div className="flex gap-3 justify-center mt-8">
          <button onClick={() => { setPhase('start'); setItems([]); setTaskId(null); setTotalDelivered(0); setError(''); }}
            className="px-6 py-3 rounded-2xl bg-cyan-500 text-white font-bold text-sm hover:bg-cyan-600 shadow-lg shadow-cyan-200 transition-all">
            Новая раскладка
          </button>
          <button onClick={() => navigate('/employee/tasks')}
            className="px-6 py-3 rounded-2xl border border-gray-200 text-gray-600 font-medium text-sm hover:bg-gray-50 transition-colors">
            К задачам
          </button>
        </div>
      </div>
    );
  }

  return null;
}

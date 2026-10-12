import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircle2, ScanLine, Package, AlertTriangle,
  Check, X, Send, Clock
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { ProductIcon, ShelfIcon, PalletIcon, BoxIcon, ScanIcon } from '../../components/ui/WarehouseIcons';
import Spinner from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import { playBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';
import { formatRub } from '../../utils/currency';

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Step 1: Scan shelf/pallet barcode to start ──────────────────────────────
function StartStep({ task, onStart }) {
  const toast = useToast();
  const [barcode, setBarcode] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  const hasTaskBoxQueue = Number(task.task_boxes_total || 0) > 0;
  const isBoxScope = task.inventory_scope === 'boxes';
  const isRoam = task.roam_mode === true; // свободная сверка — паллет не выбран заранее
  const isShelfBoxTask = !task.target_pallet_id && (task.target_box_id || task.target_shelf_box_id);
  const isPalletTask = !!task.target_pallet_id || task.task_type === 'production_transfer';
  // For pallet tasks (even with boxes) — first scan pallet, not box
  const scanTarget = isRoam ? 'roam' : isShelfBoxTask ? 'box' : isPalletTask ? 'pallet' : 'shelf';

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100); }, []);

  const doStart = useCallback(async (value) => {
    if (!value.trim() || loading) return;
    setLoading(true);
    try {
      if (scanTarget === 'roam') {
        await api.post(`/tasks/${task.id}/pick-pallet`, { pallet_identifier: value.trim() });
      } else {
        const body = scanTarget === 'box'
          ? { box_barcode: value.trim() }
          : scanTarget === 'pallet'
          ? { pallet_barcode: value.trim() }
          : { shelf_barcode: value.trim() };
        await api.post(`/tasks/${task.id}/start`, body);
      }
      playBeep(true);
      onStart();
    } catch (err) {
      playBeep(false);
      toast.error(err.response?.data?.error || 'Ошибка');
      setBarcode('');
      setTimeout(() => inputRef.current?.focus(), 100);
    } finally { setLoading(false); }
  }, [task.id, loading, scanTarget]);

  const handleChange = (e) => {
    const val = e.target.value;
    setBarcode(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (val.trim().length >= 4) timerRef.current = setTimeout(() => doStart(val), SCAN_AUTO_SUBMIT_MS);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doStart(barcode); }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
      {/* Hero icon with scaleIn + ringPulse */}
      <div className="relative mb-5 animate-scale-in">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center shadow-lg shadow-primary-100 relative z-10">
          <ScanIcon size={44} />
        </div>
        <div className="absolute inset-0 rounded-3xl border-2 border-primary-300 z-0" style={{ animation: 'ringPulse 2s ease-in-out infinite' }} />
      </div>

      <h2 className="text-xl font-extrabold text-gray-900 mb-1 animate-fade-up" style={{ animationDelay: '0.2s' }}>
        {task.task_type === 'production_transfer' ? 'Перенос с производства' : isBoxScope ? 'Перепись коробок' : 'Инвентаризация'}
      </h2>
      <p className="text-gray-500 text-sm mb-5 animate-fade-up" style={{ animationDelay: '0.3s' }}>{task.title}</p>

      {/* Step-by-step instruction card */}
      <div className="w-full max-w-sm mb-5 animate-fade-up" style={{ animationDelay: '0.4s' }}>
        <div className="bg-white rounded-2xl p-5 text-left space-y-0 border border-gray-100 shadow-sm">
          {scanTarget === 'roam' && (
            <>
              <StepItem num={1} active title="Подойдите к любому паллету"
                sub="Отсканируйте штрих-код паллета или введите его адрес, например «Р4П2»" />
              <StepItem num={2} title="Пикайте коробки на этом паллете" />
              <StepItem num={3} title="Когда закончите — можно перейти к следующему паллету" />
            </>
          )}
          {scanTarget === 'pallet' && (
            <>
              <StepItem num={1} active title="Подойдите к паллету"
                sub={<>{task.pallet_row_name ? task.pallet_row_name + ' → ' : ''}{task.pallet_name || 'Паллет ' + task.pallet_number}
                  {task.pallet_barcode && <span className="block text-xs font-mono text-primary-500 mt-0.5">ШК: {task.pallet_barcode}</span>}</>}
              />
              <StepItem num={2} title="Отсканируйте штрих-код паллета" />
              {hasTaskBoxQueue && (
                <StepItem num={3} title={isBoxScope
                  ? 'Затем пикайте коробки — внутрь заходить не нужно'
                  : 'Затем сканируйте коробки по очереди'} />
              )}
            </>
          )}
          {scanTarget === 'box' && (
            <StepItem num={1} active title="Отсканируйте коробку"
              sub={task.shelf_name ? `${task.rack_name} → ${task.shelf_name}` : task.pallet_row_name ? `${task.pallet_row_name} → ${task.pallet_name}` : ''}
            />
          )}
          {scanTarget === 'shelf' && (
            <StepItem num={1} active title="Подойдите к полке и отсканируйте"
              sub={<>{task.warehouse_name && <span className="block text-xs text-gray-400 mb-0.5">{task.warehouse_name}</span>}{task.rack_name} → {task.shelf_name}</>}
            />
          )}
        </div>
      </div>

      {/* Инструкция */}
      {task.notes && (
        <div className="w-full max-w-sm mb-4 animate-fade-up" style={{ animationDelay: '0.45s' }}>
          <div className="px-4 py-3 bg-primary-50 border border-primary-100 rounded-2xl text-sm text-primary-800 whitespace-pre-line leading-relaxed">
            {task.notes.replace(/\\n/g, '\n')}
          </div>
        </div>
      )}

      <div className="w-full max-w-sm animate-fade-up" style={{ animationDelay: '0.5s' }}>
        <div className="relative">
          <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40" style={{ animation: 'pulse 2s ease-in-out infinite' }}>
            <ScanIcon size={20} />
          </div>
          <input
            ref={inputRef}
            value={barcode}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={scanTarget === 'roam' ? 'ШК паллета или адрес (Р4П2)...' : scanTarget === 'box' ? 'Наведите сканер на коробку...' : scanTarget === 'pallet' ? 'Наведите сканер на паллет...' : 'Наведите сканер на полку...'}
            autoComplete="off"
            className="w-full pl-12 pr-4 py-4 border-2 border-dashed border-primary-200 rounded-2xl text-center text-lg font-mono tracking-widest focus:border-solid focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none bg-white transition-all"
          />
        </div>
        {loading && (
          <div className="flex items-center justify-center mt-3 text-primary-600">
            <Spinner size="sm" />
            <span className="ml-2 text-sm">Проверяем...</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step Item for instructions ──────────────────────────────────────────────
function StepItem({ num, active, done, title, sub }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all ${
        done ? 'bg-green-100 text-green-600' : active ? 'bg-primary-600 text-white shadow-md shadow-primary-200' : 'bg-gray-100 text-gray-400'
      }`}>
        {done ? <Check size={14} /> : num}
      </div>
      <div className="pt-1 flex-1">
        <p className={`text-sm leading-snug ${active ? 'font-semibold text-gray-900' : done ? 'text-gray-400 line-through' : 'text-gray-500'}`}>{title}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Error Report Bottom Sheet ────────────────────────────────────────────────
function ErrorReportForm({ taskId, scannedValue, errorId, onClose, onSent }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    setLoading(true);
    try {
      await api.post(`/tasks/${taskId}/report-error`, {
        scanned_value: scannedValue,
        employee_note: note || null,
        error_id: errorId || null,
      });
      toast.success('Ошибка отправлена');
      onSent();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Не удалось отправить';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-rose-500" />
          </div>
          <div>
            <p className="font-bold text-gray-900">Штрих-код не найден</p>
            <p className="text-xs font-mono text-gray-400">{scannedValue}</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Опишите что это за товар</label>
          <textarea
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-300"
            rows={3}
            placeholder="Например: Омега-3 синяя баночка, штрих-код на банке: 4607..."
            value={note}
            onChange={e => setNote(e.target.value)}
            autoFocus
          />
        </div>

        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Отмена</Button>
          <Button variant="primary-solid" className="flex-1" icon={<Send size={15} />} onClick={handleSend} loading={loading}>
            Отправить
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Scanning products ────────────────────────────────────────────────
function ScanStep({ task, onComplete }) {
  const { registerGraReward, user } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const pollRef = useRef(null);
  const pickStartRef = useRef(null);
  const scanQueueRef = useRef(null);
  const loadingRef = useRef(false);
  const [taskState, setTaskState] = useState(task);
  const [barcode, setBarcode] = useState('');
  const [lastScan, setLastScan] = useState(null);
  const [lastPickMs, setLastPickMs] = useState(null);
  const [showPickTimer, setShowPickTimer] = useState(false);
  const [scans, setScans] = useState([]);
  const [errors, setErrors] = useState([]);
  const [taskBoxes, setTaskBoxes] = useState(task.task_boxes || []);
  const [activeTaskBox, setActiveTaskBox] = useState(task.active_task_box || null);
  const [avgSeconds, setAvgSeconds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [tab, setTab] = useState('scans');
  const [errorForm, setErrorForm] = useState(null);
  const [elapsed, setElapsed] = useState('');
  const [confirmFinish, setConfirmFinish] = useState(null); // текст подтверждения завершения переписи
  const [nextPalletValue, setNextPalletValue] = useState('');
  const [showNextPallet, setShowNextPallet] = useState(false);
  const [pickingPallet, setPickingPallet] = useState(false);
  const [finishingMyPart, setFinishingMyPart] = useState(false);

  // Elapsed timer since task started
  useEffect(() => {
    const startedAt = task.started_at ? new Date(task.started_at).getTime() : null;
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
  }, [task.started_at]);
  const hasTaskBoxQueue = Number(taskState.task_boxes_total || task.task_boxes_total || taskBoxes.length || 0) > 0;
  const completedBoxes = Number(taskState.task_boxes_completed || taskBoxes.filter(box => box.status === 'completed').length || 0);
  const totalBoxes = Number(taskState.task_boxes_total || taskBoxes.length || 0);
  const allBoxesDone = hasTaskBoxQueue && completedBoxes >= totalBoxes && totalBoxes > 0;
  // Перепись коробок: пикаем только коробки, внутрь не заходим
  const isBoxScope = (taskState.inventory_scope || task.inventory_scope) === 'boxes';
  const needsBoxSelection = !isBoxScope && hasTaskBoxQueue && !activeTaskBox && !allBoxesDone;
  // Совместная задача: другие могут ещё держать свои коробки — «нет активной» не ошибка
  const isTeamTask = (taskState.workers || task.workers || []).length > 1;
  const myWorker = (taskState.workers || task.workers || []).find(w => Number(w.id) === Number(user?.employee_id));
  const iAmFinished = !!myWorker?.finished_at;

  // Auto-hide pick timer after 2 seconds
  useEffect(() => {
    if (!showPickTimer) return;
    const t = setTimeout(() => setShowPickTimer(false), 2000);
    return () => clearTimeout(t);
  }, [showPickTimer, lastPickMs]);

  useEffect(() => {
    setTaskState(task);
    setTaskBoxes(task.task_boxes || []);
    setActiveTaskBox(task.active_task_box || null);
  }, [task]);

  const taskId = task.id;

  const loadState = useCallback(async () => {
    try {
      const [taskRes, analyticsRes] = await Promise.all([
        api.get(`/tasks/${taskId}`),
        api.get(`/tasks/${taskId}/analytics`),
      ]);
      const nextTask = taskRes.data;
      const analytics = analyticsRes.data;
      const nextTaskBoxes = analytics.task_boxes || nextTask.task_boxes || [];
      const nextActiveTaskBox = nextTask.active_task_box || analytics.active_task_box || null;
      const queueMode = Number(nextTask.task_boxes_total || analytics.task_boxes_total || nextTaskBoxes.length || 0) > 0;
      const allScans = analytics.scans || [];
      const allErrors = analytics.errors || [];
      const visibleScans = queueMode
        ? (nextActiveTaskBox ? allScans.filter(scan => Number(scan.task_box_id) === Number(nextActiveTaskBox.id)) : [])
        : allScans;
      const visibleErrors = queueMode
        ? (nextActiveTaskBox ? allErrors.filter(error => Number(error.task_box_id) === Number(nextActiveTaskBox.id)) : [])
        : allErrors;

      setTaskState(nextTask);
      setTaskBoxes(nextTaskBoxes);
      setActiveTaskBox(nextActiveTaskBox);
      setScans(visibleScans);
      setErrors(visibleErrors);

      const secs = visibleScans
        .slice(1)
        .map(s => Number(s.seconds_since_prev))
        .filter(s => !Number.isNaN(s) && s > 0);
      setAvgSeconds(secs.length > 0 ? (secs.reduce((a, b) => a + b, 0) / secs.length).toFixed(1) : null);
    } catch (e) {
      console.error('task state load error', e);
    }
  }, [taskId]);

  // Stable polling — only depends on taskId, not loadState reference
  useEffect(() => {
    inputRef.current?.focus();
    loadState();
    const interval = setInterval(() => loadState(), 5000);
    pollRef.current = interval;
    return () => clearInterval(interval);
  }, [taskId]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Терминал сканирования: если фокус случайно ушёл (клик по экрану, перерисовка),
  // возвращаем его в поле на первом же символе от сканера.
  useEffect(() => {
    const onKey = (e) => {
      if (errorForm) return;                       // открыта форма ошибки — не мешаем
      const el = inputRef.current;
      if (!el || document.activeElement === el) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key.length === 1 || e.key === 'Enter') el.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [errorForm]);

  const refocus = useCallback(() => {
    // Сканер «печатает» в поле — фокус нужно вернуть немедленно и подстраховаться
    // после перерисовки, иначе следующий скан уходит в никуда.
    inputRef.current?.focus();
    setTimeout(() => inputRef.current?.focus(), 60);
    setTimeout(() => inputRef.current?.focus(), 250);
  }, []);

  const startBox = useCallback(async (value) => {
    if (!value || loadingRef.current) return;
    setBarcode('');
    setLoading(true);
    loadingRef.current = true;
    try {
      const res = await api.post(`/tasks/${taskId}/start`, { box_barcode: value });
      playBeep(true);
      if (res.data?.box_confirmed) {
        // Перепись: коробка засчитана сразу
        setLastScan({
          type: 'box_confirmed',
          value,
          boxName: res.data.box_name || null,
          confirmed: res.data.confirmed_boxes,
          total: res.data.total_boxes,
        });
      } else {
        setLastScan(null);
      }
      await loadState();
    } catch (err) {
      playBeep(false);
      const message = err.response?.data?.error || 'Ошибка';
      // В переписи ошибку показываем прямо на экране — тост сотрудник не успевает прочитать
      if (isBoxScope) setLastScan({ type: 'box_error', value, message });
      else toast.error(message);
    } finally {
      setLoading(false);
      loadingRef.current = false;
      refocus();
    }
  }, [taskId, loadState, toast, refocus, isBoxScope]);

  const doScan = useCallback(async (value) => {
    if (!value) return;
    // If already scanning, queue the next scan instead of dropping it
    if (loadingRef.current) {
      scanQueueRef.current = value;
      return;
    }
    // В переписи коробок любой скан — это коробка
    if (isBoxScope || needsBoxSelection) {
      await startBox(value);
      return;
    }
    setBarcode('');
    setLoading(true);
    loadingRef.current = true;
    try {
      const res = await api.post(`/tasks/${taskId}/scan`, { scanned_value: value });
      if (res.data.found) {
        playBeep(true);
        // Reset pick timer — only on first successful scan after mount/error
        if (pickStartRef.current) {
          const ms = Date.now() - pickStartRef.current;
          setLastPickMs(ms);
          setShowPickTimer(true);
        }
        pickStartRef.current = Date.now();
        if (res.data.reward?.amount_delta) {
          registerGraReward({
            amount: res.data.reward.amount_delta,
            balanceAfter: res.data.reward.balance_after,
          });
        }
        setLastScan({ type: 'found', product: res.data.product, reward: res.data.reward || null });
        await loadState();
      } else {
        playBeep(false);
        pickStartRef.current = Date.now();
        if (res.data.hint) {
          // Smart hint — show explanation, don't open error form
          setLastScan({ type: 'hint', hint: res.data.hint, message: res.data.message, value });
        } else {
          setLastScan({ type: 'not_found', value, errorId: res.data.error_id || null });
          setTab('errors');
          setErrorForm({ value, errorId: res.data.error_id || null });
        }
        await loadState();
      }
    } catch (err) {
      playBeep(false);
      pickStartRef.current = Date.now();
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
      loadingRef.current = false;
      refocus();
      // Process queued scan if any
      if (scanQueueRef.current) {
        const queued = scanQueueRef.current;
        scanQueueRef.current = null;
        setTimeout(() => doScan(queued), 50);
      }
    }
  }, [taskId, loadState, needsBoxSelection, isBoxScope, startBox, toast, refocus]);

  const handleChange = (e) => {
    const val = e.target.value;
    setBarcode(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (val.trim().length >= 4) timerRef.current = setTimeout(() => doScan(val.trim()), SCAN_AUTO_SUBMIT_MS);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { if (timerRef.current) clearTimeout(timerRef.current); doScan(barcode.trim()); }
  };

  const handleComplete = async () => {
    const missingBoxes = Math.max(totalBoxes - completedBoxes, 0);
    const confirmText = isBoxScope
      ? (missingBoxes > 0
        ? `Завершить перепись? Отмечено ${completedBoxes} из ${totalBoxes}. ${missingBoxes} коробок останутся не найденными.`
        : `Завершить перепись? Все ${totalBoxes} коробок отмечены.`)
      : allBoxesDone
      ? `Завершить задачу? Все ${totalBoxes} коробок отсканированы.`
      : hasTaskBoxQueue && activeTaskBox
      ? `Завершить коробку ${activeTaskBox?.box_barcode || ''}?`
      : hasTaskBoxQueue && isTeamTask
      ? `Выйти из задачи? Отмечено ${completedBoxes} из ${totalBoxes} коробок командой.`
      : `Завершить задачу? Записано: ${scans.length} сканирований.`;
    if (!isBoxScope && !isTeamTask && hasTaskBoxQueue && !activeTaskBox && !allBoxesDone) {
      toast.error('Сначала отсканируйте коробку из этой задачи');
      return;
    }
    // В переписи спрашиваем своим диалогом: нативный confirm ломает поток сканера
    if (isBoxScope) {
      if (!confirmFinish) { setConfirmFinish(confirmText); return; }
      setConfirmFinish(null);
    } else if (!confirm(confirmText)) return;
    setCompleting(true);
    try {
      const res = await api.post(`/tasks/${task.id}/complete`);
      if (!isBoxScope && res.data.waiting_for_team) {
        // Команда: моя часть сделана, жду остальных или беру следующую свободную коробку
        toast.success('Ваши коробки готовы. Можно взять ещё одну или дождаться остальных.');
        setBarcode('');
        setLastScan(null);
        await loadState();
      } else if (!isBoxScope && hasTaskBoxQueue && !res.data.task_completed) {
        toast.success('Коробка завершена. Отсканируйте следующую.');
        setBarcode('');
        setLastScan(null);
        await loadState();
      } else {
        toast.success('Задача завершена!');
        onComplete();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setCompleting(false); }
  };

  // Командная задача: «у меня коробок больше нет» — сигнал остальным/админу.
  // Задача завершится сама, когда так отметятся все.
  const handleFinishMyPart = async () => {
    if (!confirm('Сообщить, что у вас больше нет коробок? Ваша часть будет зафиксирована как готовая.')) return;
    setFinishingMyPart(true);
    try {
      const res = await api.post(`/tasks/${task.id}/finish-my-part`);
      if (res.data.task_completed) {
        toast.success('Все закончили — задача завершена!');
        onComplete();
      } else {
        toast.success('Отмечено: ваша часть готова. Ждём остальных.');
        await loadState();
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setFinishingMyPart(false); }
  };

  // Свободная сверка: перейти к следующему паллету, не завершая всю задачу
  const handlePickNextPallet = async () => {
    if (!nextPalletValue.trim() || pickingPallet) return;
    setPickingPallet(true);
    try {
      const res = await api.post(`/tasks/${task.id}/pick-pallet`, { pallet_identifier: nextPalletValue.trim() });
      playBeep(true);
      toast.success(`Паллет Р${res.data.pallet.row_number}П${res.data.pallet.number} — добавлено ${res.data.boxes_added} коробок`);
      setNextPalletValue('');
      setShowNextPallet(false);
      setLastScan(null);
      await loadState();
      inputRef.current?.focus();
    } catch (err) {
      playBeep(false);
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setPickingPallet(false); }
  };

  // Build location breadcrumb
  const locationParts = [];
  if (taskState.warehouse_name) locationParts.push(taskState.warehouse_name);
  if (taskState.rack_name) locationParts.push(taskState.rack_name);
  if (taskState.pallet_row_name) locationParts.push(taskState.pallet_row_name);
  if (taskState.pallet_name) locationParts.push(taskState.pallet_name);
  if (taskState.shelf_name) locationParts.push(taskState.shelf_name);
  if (hasTaskBoxQueue && activeTaskBox?.box_name) locationParts.push(activeTaskBox.box_name);
  else if (taskState.box_barcode) locationParts.push(taskState.box_barcode);

  // ─── Перепись коробок: компактный терминал ──────────────────────────────────
  // Никаких длинных списков — экран фиксированный, фокус всегда в поле,
  // сотрудник просто пикает коробку за коробкой.
  if (isBoxScope) {
    const progressPct = totalBoxes > 0 ? Math.round((completedBoxes / totalBoxes) * 100) : 0;
    return (
      <div className="flex flex-col h-full">
        {/* Шапка: где мы + счётчик + завершить */}
        <div className="mx-4 mt-3 px-4 py-3 bg-gradient-to-r from-primary-50 to-white rounded-2xl border border-primary-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <BoxIcon size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-primary-500 font-medium">Перепись коробок</p>
              <p className="text-sm font-bold text-primary-800 truncate">
                {taskState.pallet_name || taskState.shelf_name || taskState.title}
                {taskState.pallet_row_name ? ` · ${taskState.pallet_row_name}` : ''}
              </p>
            </div>
            {elapsed && (
              <span className="flex items-center gap-1 text-xs font-mono text-gray-400 flex-shrink-0">
                <Clock size={11} />{elapsed}
              </span>
            )}
            <button
              onClick={handleComplete}
              disabled={completing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
            >
              <CheckCircle2 size={14} />
              {completing ? '...' : 'Завершить'}
            </button>
          </div>
          {totalBoxes > 0 && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-primary-500 font-medium">Отмечено</span>
                <span className="text-[11px] font-bold text-primary-700">{completedBoxes} из {totalBoxes}</span>
              </div>
              <div className="h-1.5 rounded-full bg-primary-100 overflow-hidden">
                <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Поле сканера — сразу под шапкой, всегда на одном месте */}
        <div className="mx-4 mt-3 relative">
          <Input
            ref={inputRef}
            placeholder="Сканируйте коробку..."
            value={barcode}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => inputRef.current?.focus(), 80)}
            className="text-center text-xl font-mono tracking-widest py-4"
            autoComplete="off"
            autoFocus
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size="sm" /></div>
          )}
        </div>

        {/* Счётчик крупно + последняя отметка. Высота фиксирована — экран не прыгает */}
        <div className="mx-4 mt-4 flex flex-col items-center justify-center flex-1 min-h-0">
          <p className="text-6xl font-black text-gray-900 leading-none">{completedBoxes}</p>
          <p className="text-sm text-gray-400 mt-1">
            {totalBoxes > 0 ? `из ${totalBoxes} коробок отмечено` : 'коробок отмечено'}
          </p>

          <div className="h-20 mt-5 w-full max-w-sm flex items-start justify-center">
            {lastScan?.type === 'box_confirmed' ? (
              <div className="w-full px-4 py-3 rounded-2xl bg-green-50 border border-green-200 flex items-center gap-3 animate-fade-in">
                <Check size={20} className="text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-green-800 truncate">
                    {lastScan.boxName || 'Коробка отмечена'}
                  </p>
                  <p className="text-xs text-green-600 font-mono truncate">{lastScan.value}</p>
                </div>
              </div>
            ) : lastScan?.type === 'box_error' ? (
              <div className="w-full px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-3 animate-fade-in">
                <X size={20} className="text-rose-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-rose-700">{lastScan.message}</p>
                  <p className="text-xs text-rose-500 font-mono truncate">{lastScan.value}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-300 pt-4">Отсканируйте штрих-код коробки</p>
            )}
          </div>
        </div>

        {/* Свободная сверка: переход к следующему паллету без завершения задачи */}
        {taskState.roam_mode && (
          <div className="mx-4 mb-3">
            {showNextPallet ? (
              <div className="flex gap-2">
                <input
                  value={nextPalletValue}
                  onChange={e => setNextPalletValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handlePickNextPallet(); } }}
                  placeholder="ШК или адрес (Р4П2)..."
                  autoFocus
                  className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none"
                />
                <button onClick={handlePickNextPallet} disabled={pickingPallet}
                  className="px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">
                  {pickingPallet ? '...' : 'Перейти'}
                </button>
                <button onClick={() => { setShowNextPallet(false); setNextPalletValue(''); inputRef.current?.focus(); }}
                  className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-500"><X size={16} /></button>
              </div>
            ) : (
              <button onClick={() => setShowNextPallet(true)}
                className="w-full py-2.5 rounded-xl border border-dashed border-primary-200 text-primary-600 text-sm font-semibold hover:bg-primary-50 transition-all">
                Следующий паллет →
              </button>
            )}
          </div>
        )}

        {/* Подтверждение завершения — своим диалогом, чтобы не ломать поток сканера */}
        {confirmFinish && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4"
            onClick={() => { setConfirmFinish(null); refocus(); }}>
            <div className="w-full max-w-sm bg-white rounded-3xl p-5 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-2xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={20} className="text-green-500" />
                </div>
                <div>
                  <p className="font-bold text-gray-900">Завершить перепись?</p>
                  <p className="text-sm text-gray-500 mt-0.5">{confirmFinish}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setConfirmFinish(null); refocus(); }}
                  className="flex-1 py-3 rounded-2xl bg-gray-100 text-gray-600 font-semibold text-sm active:scale-95 transition-all"
                >
                  Продолжить скан
                </button>
                <button
                  onClick={handleComplete}
                  disabled={completing}
                  className="flex-1 py-3 rounded-2xl bg-green-600 text-white font-bold text-sm active:scale-95 transition-all disabled:opacity-50"
                >
                  {completing ? 'Завершение...' : 'Завершить'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb path + timer */}
      <div className="mx-4 mt-3 flex items-center justify-between gap-2">
        {locationParts.length > 1 && (
          <div className="flex items-center gap-1 text-xs text-gray-400 overflow-x-auto min-w-0">
            {locationParts.map((part, i) => (
              <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                {i > 0 && <span className="text-gray-300">→</span>}
                <span className={i === locationParts.length - 1 ? 'text-primary-600 font-semibold' : ''}>{part}</span>
              </span>
            ))}
          </div>
        )}
        {elapsed && (
          <span className="flex items-center gap-1 text-xs font-mono text-gray-400 flex-shrink-0 bg-gray-50 px-2 py-1 rounded-lg">
            <Clock size={11} />
            {elapsed}
          </span>
        )}
      </div>

      {/* Верхняя полоса */}
      <div className="mx-4 mt-2 px-4 py-3 bg-gradient-to-r from-primary-50 to-white rounded-2xl border border-primary-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
          {hasTaskBoxQueue ? <BoxIcon size={24} /> : taskState.target_pallet_id ? <PalletIcon size={24} /> : <ShelfIcon size={24} />}
        </div>
        <div className="flex-1 min-w-0">
          {isBoxScope ? (
            <>
              <p className="text-xs text-primary-500 font-medium">Перепись коробок</p>
              <p className="text-sm font-bold text-primary-800 truncate">
                {taskState.pallet_name || taskState.shelf_name || taskState.title}
                {taskState.pallet_row_name ? ` · ${taskState.pallet_row_name}` : ''}
              </p>
              <p className="text-[11px] text-primary-500 mt-0.5">
                Отмечено: {completedBoxes} из {totalBoxes}
              </p>
            </>
          ) : hasTaskBoxQueue ? (
            <>
              <p className="text-xs text-primary-500 font-medium">
                {needsBoxSelection ? 'Ожидается следующая коробка' : 'Текущая коробка'}
              </p>
              <p className="text-sm font-bold text-primary-800 truncate">
                {needsBoxSelection
                  ? 'Отсканируйте коробку из задачи'
                  : (activeTaskBox?.box_name || activeTaskBox?.box_barcode || 'Коробка')}
              </p>
              <p className="text-[11px] text-primary-500 mt-0.5">
                Коробок завершено: {completedBoxes} из {totalBoxes}
                {isTeamTask && ` · команда: ${(taskState.workers || []).length} чел.`}
              </p>
            </>
          ) : task.task_type === 'inventory' && (task.target_box_id || task.target_shelf_box_id) ? (
            <>
              <p className="text-xs text-primary-500 font-medium">Коробка</p>
              <p className="text-sm font-bold text-primary-800 truncate">
                {taskState.box_barcode}
                {taskState.shelf_name
                  ? ` · ${taskState.shelf_name}`
                  : taskState.pallet_name ? ` · ${taskState.pallet_name}` : ''}
              </p>
            </>
          ) : (taskState.task_type === 'production_transfer' || (taskState.task_type === 'inventory' && taskState.target_pallet_id && !taskState.shelf_id)) && taskState.pallet_barcode ? (
            <>
              <p className="text-xs text-primary-500 font-medium">Паллет</p>
              <p className="text-sm font-bold text-primary-800 truncate">
                {taskState.pallet_name || `Паллет ${taskState.pallet_number}`}
                {taskState.pallet_row_name ? ` · ${taskState.pallet_row_name}` : ''}
              </p>
            </>
          ) : taskState.shelf_code ? (
            <>
              <p className="text-xs text-primary-500 font-medium">Полка</p>
              <p className="text-sm font-bold text-primary-800 truncate">{taskState.rack_name} · {taskState.shelf_name}</p>
            </>
          ) : (
            <p className="text-sm font-bold text-primary-800">{taskState.title}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!isBoxScope && hasTaskBoxQueue && activeTaskBox && (
            <button
              onClick={async () => {
                if (confirm('Выйти из текущей коробки? Вы вернётесь к выбору коробки.')) {
                  try {
                    await api.post(`/tasks/${task.id}/abandon-box`, { task_box_id: activeTaskBox.id });
                  } catch {}
                  setActiveTaskBox(null);
                  setScans([]);
                  setLastScan(null);
                  setTab('scans');
                  await loadState();
                }
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-xl text-xs font-semibold transition-all active:scale-95"
            >
              <X size={13} />
              Выйти
            </button>
          )}
          {(isBoxScope || !hasTaskBoxQueue || activeTaskBox) && (
            <button
              onClick={handleComplete}
              disabled={completing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              {completing ? '...' : isBoxScope ? 'Завершить' : hasTaskBoxQueue ? 'Завершить коробку' : 'Завершить'}
            </button>
          )}
          {!isBoxScope && isTeamTask && hasTaskBoxQueue && !activeTaskBox && !iAmFinished && !allBoxesDone && (
            <button
              onClick={handleFinishMyPart}
              disabled={finishingMyPart}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 size={14} />
              {finishingMyPart ? '...' : 'У меня всё'}
            </button>
          )}
          {iAmFinished && (
            <span className="flex items-center gap-1 px-2.5 py-1.5 text-green-600 text-xs font-semibold">
              <CheckCircle2 size={14} /> Ваша часть готова
            </span>
          )}
        </div>
      </div>

      {/* Инструкция */}
      {taskState.notes && (
        <details className="mx-4 mt-3">
          <summary className="text-xs font-semibold text-primary-600 cursor-pointer hover:text-primary-800 transition-colors flex items-center gap-1">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Инструкция
          </summary>
          <div className="mt-2 px-4 py-3 bg-primary-50 border border-primary-100 rounded-2xl text-sm text-primary-800 whitespace-pre-line leading-relaxed">
            {taskState.notes.replace(/\\n/g, '\n')}
          </div>
        </details>
      )}

      {hasTaskBoxQueue && (
        <div className={`mx-4 mt-3 px-4 py-3 bg-gray-50 rounded-2xl ${isBoxScope ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {isBoxScope ? 'Коробки — отметьте сканером' : 'Коробки в задаче'}
            </p>
            <p className="text-xs font-semibold text-gray-600">{completedBoxes}/{totalBoxes}</p>
          </div>
          {isBoxScope && (
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden mb-2.5">
              <div className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${totalBoxes > 0 ? Math.round((completedBoxes / totalBoxes) * 100) : 0}%` }} />
            </div>
          )}
          <div className={`space-y-1.5 overflow-y-auto ${isBoxScope ? 'flex-1 min-h-0' : 'max-h-32'}`}>
            {taskBoxes.map(box => {
              // Командная задача: чужая занятая коробка — показываем, кто её держит
              const heldByOther = box.status === 'in_progress' && box.claimed_by_employee_id
                && Number(box.claimed_by_employee_id) !== Number(user?.employee_id);
              return (
              <div key={box.id} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition-colors ${
                isBoxScope && box.status === 'completed' ? 'bg-green-50 border border-green-200' : 'bg-white'
              }`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{box.box_name || box.box_barcode}</p>
                  <p className="text-xs text-gray-400 font-mono">{box.box_barcode}</p>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg flex-shrink-0 ${
                  box.status === 'completed'
                    ? 'bg-green-100 text-green-700'
                    : box.status === 'in_progress'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {box.status === 'completed'
                    ? (isBoxScope ? 'Отмечена' : 'Готово')
                    : box.status === 'in_progress'
                    ? (heldByOther ? `У ${(box.claimed_by_name || '').split(' ')[0] || 'коллеги'}` : 'Текущая')
                    : (isBoxScope ? 'Не найдена' : 'Ожидает')}
                </span>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Последний скан */}
      {lastScan && !needsBoxSelection && (
        lastScan.type === 'hint' ? (
          <div className="mx-4 mt-3 px-4 py-4 rounded-2xl bg-amber-50 border-2 border-amber-400 animate-pulse">
            <div className="flex items-start gap-3">
              <AlertTriangle size={24} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-amber-900">
                  {lastScan.hint === 'keyboard_layout' && 'Неправильная раскладка клавиатуры!'}
                  {lastScan.hint === 'url_scanned' && 'Отсканирована ссылка, а не штрих-код!'}
                  {lastScan.hint === 'partial_scan' && 'Штрих-код считался не полностью!'}
                  {lastScan.hint === 'duplicate_scan' && 'Штрих-код считался несколько раз!'}
                </p>
                <p className="text-sm text-amber-800 mt-1">{lastScan.message}</p>
              </div>
            </div>
          </div>
        ) : lastScan.type === 'box_confirmed' ? (
          <div className="mx-4 mt-3 px-4 py-2.5 rounded-2xl flex items-center gap-3 bg-green-50 border border-green-200">
            <Check size={18} className="text-green-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-green-800 truncate">Коробка отмечена</p>
              <p className="text-xs text-green-600 font-mono truncate">{lastScan.value} · {lastScan.confirmed} из {lastScan.total}</p>
            </div>
          </div>
        ) : (
          <div className={`mx-4 mt-3 px-4 py-2.5 rounded-2xl flex items-center gap-3 ${
            lastScan.type === 'found' ? 'bg-green-50 border border-green-200' : 'bg-rose-50 border border-rose-200'
          }`}>
            {lastScan.type === 'found' ? (
              <>
                <Check size={16} className="text-green-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-green-800 truncate">{lastScan.product.name}</p>
                  <p className="text-xs text-green-600">{lastScan.product.code}</p>
                </div>
              </>
            ) : (
              <>
                <X size={16} className="text-rose-400 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-rose-700 font-mono truncate">{lastScan.value}</p>
                  <p className="text-xs text-rose-500">Не найден — отправлен в ошибки</p>
                </div>
              </>
            )}
          </div>
        )
      )}

      {/* Поле ввода */}
      <div className="mx-4 mt-3 relative">
        <Input
          ref={inputRef}
          placeholder={isBoxScope ? 'Сканируйте коробки...' : needsBoxSelection ? 'Отсканируйте следующую коробку...' : 'Наведите сканер...'}
          value={barcode}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="text-center text-lg font-mono tracking-widest"
          autoComplete="off"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2"><Spinner size="sm" /></div>
        )}
        {lastPickMs !== null && showPickTimer && (
          <div className={`absolute right-0 -bottom-6 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
            lastPickMs < 5000
              ? 'bg-green-100 text-green-700'
              : lastPickMs < 15000
              ? 'bg-orange-100 text-orange-700'
              : 'bg-rose-100 text-rose-700'
          }`}>
            ⚡ {(lastPickMs / 1000).toFixed(1)}с
          </div>
        )}
      </div>

      {allBoxesDone ? (
        <div className={`flex flex-col items-center justify-center mx-4 text-center ${isBoxScope ? 'mt-4' : 'flex-1'}`}>
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-lg font-bold text-gray-800 mb-1">
            {isBoxScope ? 'Все коробки отмечены!' : 'Все коробки завершены!'}
          </p>
          <p className="text-sm text-gray-500 mb-5">{completedBoxes} из {totalBoxes} коробок</p>
          <button
            onClick={handleComplete}
            disabled={completing}
            className="px-8 py-3 bg-green-600 text-white rounded-2xl font-bold text-base shadow-lg hover:bg-green-700 transition-all disabled:opacity-50"
          >
            {completing ? 'Завершение...' : 'Завершить задачу'}
          </button>
        </div>
      ) : isBoxScope ? null : needsBoxSelection ? (
        <div className="flex-1 flex flex-col items-center justify-center mx-4 text-center text-gray-300">
          <ScanLine size={34} className="mb-2 opacity-50" />
          <p className="text-sm">Отсканируйте следующую коробку</p>
          <p className="text-xs mt-1">Осталось коробок: {Math.max(totalBoxes - completedBoxes, 0)}</p>
        </div>
      ) : (
        <>
          <div className="mx-4 mt-2 grid grid-cols-3 gap-2">
            <div className="bg-blue-50 rounded-xl px-3 py-2.5 text-center border border-blue-100">
              <p className="text-[10px] text-blue-500 font-semibold uppercase tracking-wider">Сканов</p>
              <p className="text-lg font-black text-blue-700">{scans.length}</p>
            </div>
            <div className={`rounded-xl px-3 py-2.5 text-center border ${errors.length > 0 ? 'bg-rose-50 border-rose-100' : 'bg-gray-50 border-gray-100'}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${errors.length > 0 ? 'text-rose-400' : 'text-gray-400'}`}>Ошибок</p>
              <p className={`text-lg font-black ${errors.length > 0 ? 'text-rose-500' : 'text-gray-400'}`}>{errors.length}</p>
            </div>
            <div className="bg-amber-50 rounded-xl px-3 py-2.5 text-center border border-amber-100">
              <p className="text-[10px] text-amber-500 font-semibold uppercase tracking-wider">Ср. время</p>
              <p className="text-lg font-black text-amber-700">{avgSeconds ? `${avgSeconds}с` : '—'}</p>
            </div>
          </div>

          <div className="mx-4 mt-3 flex gap-1 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setTab('scans')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === 'scans' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400'
              }`}
            >
              <Clock size={13} />
              Хронология ({scans.length})
            </button>
            <button
              onClick={() => setTab('errors')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                tab === 'errors'
                  ? errors.length > 0 ? 'bg-rose-500 text-white shadow-sm' : 'bg-white text-gray-900 shadow-sm'
                  : errors.length > 0 ? 'text-rose-400' : 'text-gray-400'
              }`}
            >
              <AlertTriangle size={13} />
              Ошибки ({errors.length})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto mx-4 mt-2 mb-4">
            {tab === 'scans' && (
              scans.length === 0 ? (
                <div className="text-center py-10 text-gray-300">
                  <ScanLine size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Начните сканирование</p>
                </div>
              ) : (
                <div className="space-y-0">
                  {[...scans].reverse().map((sc, i) => (
                    <div key={sc.id} className="flex items-center gap-2.5 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-xs font-mono text-gray-300 w-5 text-right flex-shrink-0">{scans.length - i}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 leading-tight truncate">{sc.product_name}</p>
                        {sc.product_code && <p className="text-xs text-gray-400">{sc.product_code}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-mono font-semibold text-gray-700">{fmtTime(sc.created_at)}</p>
                        {sc.seconds_since_prev !== null && sc.seconds_since_prev !== undefined ? (
                          <p className="text-xs text-gray-300">+{sc.seconds_since_prev}с</p>
                        ) : (
                          <p className="text-xs text-primary-400 font-medium">старт</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'errors' && (
              errors.length === 0 ? (
                <div className="text-center py-10 text-gray-300">
                  <Check size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Ошибок нет</p>
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {errors.map(err => (
                    <div key={err.id} className="flex items-start gap-3 p-3 bg-rose-50 rounded-xl border border-rose-100">
                      <AlertTriangle size={15} className="text-rose-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono font-medium text-rose-700 truncate">{err.scanned_value}</p>
                        {err.employee_note && <p className="text-xs text-gray-600 mt-0.5">{err.employee_note}</p>}
                        <p className="text-xs text-rose-400 mt-0.5">{fmtTime(err.created_at)}</p>
                      </div>
                      <button
                        onClick={() => setErrorForm({ value: err.scanned_value, errorId: err.id })}
                        className="text-xs text-rose-400 hover:text-rose-600 underline whitespace-nowrap flex-shrink-0"
                      >
                        Описать
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </>
      )}

      {/* Error report bottom sheet */}
      {errorForm && (
        <ErrorReportForm
          taskId={task.id}
          scannedValue={errorForm.value}
          errorId={errorForm.errorId}
          onClose={() => { setErrorForm(null); refocus(); }}
          onSent={() => { setErrorForm(null); loadState(); }}
        />
      )}
    </div>
  );
}

// ─── Completed view ───────────────────────────────────────────────────────────
function CompletedView({ task, scans }) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center relative overflow-hidden">
      {/* Confetti */}
      <div className="absolute inset-x-0 top-0 h-48 pointer-events-none overflow-hidden">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="absolute rounded-sm" style={{
            width: 6 + (i % 3) * 3,
            height: 6 + (i % 3) * 3,
            background: ['#7c3aed','#22c55e','#f59e0b','#3b82f6','#ef4444','#ec4899','#8b5cf6','#06b6d4','#f97316','#10b981'][i],
            left: `${8 + i * 9}%`,
            animation: `confettiFall ${2 + (i % 3) * 0.5}s ease-in ${i * 0.15}s both`,
            transform: `rotate(${i * 36}deg)`,
          }} />
        ))}
      </div>

      {/* Check circle with scaleIn + ringPulse */}
      <div className="relative mb-5 animate-scale-in">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-green-100 to-green-200 flex items-center justify-center shadow-lg shadow-green-100 relative z-10">
          <CheckCircle2 size={48} className="text-green-500" />
        </div>
        <div className="absolute inset-0 rounded-full border-2 border-green-300 z-0" style={{ animation: 'ringPulse 2s ease-in-out infinite' }} />
      </div>

      <h2 className="text-2xl font-extrabold text-gray-900 mb-1 animate-fade-up" style={{ animationDelay: '0.3s' }}>Готово!</h2>
      <p className="text-gray-500 text-sm mb-2 animate-fade-up" style={{ animationDelay: '0.4s' }}>{task.title}</p>
      {task.gra_earned > 0 && (
        <div className="animate-fade-up flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 mb-4" style={{ animationDelay: '0.45s' }}>
          <span className="text-lg font-black text-amber-600">+{formatRub(task.gra_earned)} ₽</span>
          <span className="text-xs text-amber-500 font-semibold">заработано</span>
        </div>
      )}

      {(() => {
        const duration = task.started_at && task.completed_at
          ? Math.round((new Date(task.completed_at) - new Date(task.started_at)) / 60000)
          : null;
        const totalQty = scans.reduce((s, sc) => s + Number(sc.total_quantity || 0), 0);
        return (scans.length > 0 || duration) && (
          <div className={`w-full max-w-sm grid ${duration ? 'grid-cols-3' : 'grid-cols-2'} gap-2.5 mb-5`}>
            {scans.length > 0 && (
              <div className="bg-green-50 rounded-2xl p-4 text-center border border-green-100 animate-fade-up" style={{ animationDelay: '0.5s' }}>
                <p className="text-[10px] text-green-500 font-bold uppercase tracking-wider">Товаров</p>
                <p className="text-2xl font-black text-green-600 mt-1">{scans.length}</p>
              </div>
            )}
            {totalQty > 0 && (
              <div className="bg-blue-50 rounded-2xl p-4 text-center border border-blue-100 animate-fade-up" style={{ animationDelay: '0.6s' }}>
                <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">Всего штук</p>
                <p className="text-2xl font-black text-blue-600 mt-1">{totalQty}</p>
              </div>
            )}
            {duration != null && (
              <div className="bg-amber-50 rounded-2xl p-4 text-center border border-amber-100 animate-fade-up" style={{ animationDelay: '0.65s' }}>
                <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">Время</p>
                <p className="text-2xl font-black text-amber-600 mt-1">{duration < 60 ? `${duration}м` : `${Math.floor(duration/60)}ч ${duration%60}м`}</p>
              </div>
            )}
          </div>
        );
      })()}

      {scans.length > 0 && (
        <div className="w-full max-w-sm bg-white rounded-2xl p-4 mb-5 text-left border border-gray-100 shadow-sm animate-fade-up" style={{ animationDelay: '0.7s' }}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Итог</p>
          <div className="space-y-2">
            {scans.map(s => (
              <div key={s.product_id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700 truncate flex-1 mr-2">{s.product_name}</span>
                <span className="font-bold text-gray-900 flex-shrink-0">{Number(s.total_quantity)} шт.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={() => navigate('/employee/tasks')}
        className="w-full max-w-sm py-3.5 bg-gradient-to-r from-primary-600 to-primary-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-primary-200 hover:-translate-y-0.5 hover:shadow-xl transition-all active:scale-[0.98] animate-fade-up"
        style={{ animationDelay: '0.8s' }}>
        К задачам
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TaskScanPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadTask = useCallback(async () => {
    try {
      const res = await api.get(`/tasks/${id}`);
      setTask(res.data);
    } catch {
      navigate('/employee/tasks');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadTask(); }, []);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  if (!task) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Leave task button */}
      {(task.status === 'new' || task.status === 'in_progress') && (
        <div className="px-4 pt-3 pb-0">
          <button
            onClick={() => {
              if (confirm('Покинуть задачу? Задача останется в текущем статусе, вы сможете вернуться к ней позже.')) {
                navigate('/employee/tasks');
              }
            }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            Покинуть задачу
          </button>
        </div>
      )}
      {task.status === 'new' && <StartStep task={task} onStart={loadTask} />}
      {task.status === 'in_progress' && <ScanStep task={task} onComplete={loadTask} />}
      {task.status === 'paused' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">Задача на паузе</h3>
          <p className="text-sm text-gray-500 max-w-xs">Администратор приостановил эту задачу. Дождитесь возобновления.</p>
        </div>
      )}
      {(task.status === 'completed' || task.status === 'cancelled') && (
        <CompletedView task={task} scans={task.scans || []} />
      )}
    </div>
  );
}

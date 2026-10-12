import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, ChevronRight, CheckCircle2, ScanLine, Printer, MapPin, ArrowLeft, Box, AlertCircle, X, Clock } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import JsBarcode from 'jsbarcode';

function fmtQty(v) { const n = parseFloat(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(0); }

// ─── Barcode Print Component ─────────────────────────────────────────────────
function BarcodePrint({ barcode, productName, onPrinted }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current && barcode) {
      try {
        JsBarcode(canvasRef.current, barcode, {
          format: 'CODE128', width: 2, height: 60, displayValue: true,
          fontSize: 14, margin: 10, background: '#fff',
        });
      } catch { /* fallback: just show text */ }
    }
  }, [barcode]);

  return (
    <div className="text-center space-y-3">
      <p className="text-sm font-bold text-gray-900">{productName}</p>
      <div className="bg-white border border-gray-200 rounded-xl p-4 inline-block">
        <canvas ref={canvasRef} />
      </div>
      <p className="text-xs text-gray-400">Наклейте штрих-код и отсканируйте его</p>
      <div className="flex gap-2 justify-center">
        <Button icon={<Printer size={14} />} onClick={() => {
          const w = window.open('', '_blank', 'width=400,height=300');
          w.document.write(`<html><body style="text-align:center;padding:20px;font-family:Arial">
            <h3>${productName}</h3>
            <canvas id="bc"></canvas>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3/dist/JsBarcode.all.min.js"><\/script>
            <script>JsBarcode('#bc','${barcode}',{format:'CODE128',width:2,height:60,displayValue:true});window.print();<\/script>
          </body></html>`);
          w.document.close();
          if (onPrinted) onPrinted();
        }}>Печать</Button>
      </div>
    </div>
  );
}

import { playBeep, SCAN_AUTO_SUBMIT_MS } from '../../utils/audio';

// ─── Scan Input (exact copy of TaskScanPage pattern) ─────────────────────────
function ScanInput({ onScan, placeholder = 'Сканируйте штрих-код...', disabled }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  const timerRef = useRef(null);
  const loadingRef = useRef(false);
  const queueRef = useRef(null);

  useEffect(() => { if (ref.current && !disabled) ref.current.focus(); }, [disabled]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const refocus = useCallback(() => setTimeout(() => ref.current?.focus(), 200), []);

  const doScan = useCallback(async (val) => {
    if (!val) return;
    if (loadingRef.current) { queueRef.current = val; return; }
    setValue('');
    loadingRef.current = true;
    try { await onScan(val); }
    catch {}
    finally {
      loadingRef.current = false;
      refocus();
      if (queueRef.current) {
        const queued = queueRef.current;
        queueRef.current = null;
        setTimeout(() => doScan(queued), 50);
      }
    }
  }, [onScan, refocus]);

  const handleChange = (e) => {
    const val = e.target.value;
    setValue(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (val.trim().length >= 4) timerRef.current = setTimeout(() => doScan(val.trim()), SCAN_AUTO_SUBMIT_MS);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (timerRef.current) clearTimeout(timerRef.current); doScan(value.trim()); }
  };

  return (
    <input ref={ref} value={value} onChange={handleChange} onKeyDown={handleKeyDown} disabled={disabled}
      placeholder={placeholder}
      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm focus:border-primary-400 focus:ring-2 focus:ring-primary-100 focus:outline-none disabled:opacity-50"
      autoComplete="off" />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function AssemblyPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sourceBoxes, setSourceBoxes] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [componentStatus, setComponentStatus] = useState([]);
  const [printBarcode, setPrintBarcode] = useState(null);
  const [elapsed, setElapsed] = useState('');
  // ─── Restore picking state from sessionStorage ───────────────────────────
  const ssKey = `assembly_pick_${id}`;
  const saved = useRef(null);
  try { const raw = sessionStorage.getItem(ssKey); if (raw) saved.current = JSON.parse(raw); } catch {}
  const ss = saved.current;

  const [scannedPallet, setScannedPallet] = useState(ss?.scannedPallet || null);
  const [scannedBox, setScannedBox] = useState(ss?.scannedBox || null);
  const [pickStep, setPickStep] = useState(ss?.pickStep || 'choose');
  const [activeComponent, setActiveComponent] = useState(ss?.activeComponent || null);
  const [expandedComponent, setExpandedComponent] = useState(ss?.expandedComponent || null);
  const [lastPickScan, setLastPickScan] = useState(null);
  const [scanHistory, setScanHistory] = useState([]);
  const [placeDest, setPlaceDest] = useState(ss?.placeDest || null);
  const [placeBoxStep, setPlaceBoxStep] = useState(false);
  const [placeBox, setPlaceBox] = useState(null);
  const pickedMaxRef = useRef({});

  // ─── Persist picking state on every change ──────────────────────────────
  useEffect(() => {
    const data = { pickStep, scannedPallet, scannedBox, activeComponent, expandedComponent, placeDest };
    // Only save if there's something meaningful
    if (pickStep !== 'choose' || scannedPallet || scannedBox || activeComponent || placeDest) {
      sessionStorage.setItem(ssKey, JSON.stringify(data));
    } else {
      sessionStorage.removeItem(ssKey);
    }
  }, [pickStep, scannedPallet, scannedBox, activeComponent, expandedComponent, placeDest, ssKey]);

  const loadTask = useCallback(async () => {
    try {
      const res = await api.get(`/assembly/${id}`);
      setTask(res.data);
      // Restore component status for current bundle (e.g. after page reload)
      if (res.data.assembly_phase === 'assembling') {
        try {
          const cs = await api.get(`/assembly/${id}/component-status`);
          setComponentStatus(cs.data.components_status || []);
          if (cs.data.all_components_scanned) {
            const allBc = (res.data.bundle_barcodes || '').split(';').map(s => s.trim()).filter(Boolean);
            const systemBc = allBc.find(b => /^[124]0{5,}\d+$/.test(b));
            setPrintBarcode(systemBc || res.data.bundle_barcode || allBc[0] || '');
          }
        } catch {}
      }
    } catch (err) {
      toast.error('Не удалось загрузить задачу');
    } finally { setLoading(false); }
  }, [id, toast]);

  const loadScans = useCallback(async () => {
    try {
      const res = await api.get(`/tasks/${id}/analytics`);
      setScanHistory((res.data.scans || []).reverse());
    } catch {}
  }, [id]);

  const loadSourceBoxes = useCallback(async () => {
    try {
      const res = await api.get(`/assembly/${id}/source-boxes`);
      setSourceBoxes(res.data);
    } catch {}
  }, [id]);

  useEffect(() => { loadTask(); loadScans(); }, [loadTask, loadScans]);

  // Elapsed timer
  useEffect(() => {
    const startedAt = task?.started_at ? new Date(task.started_at).getTime() : null;
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
  }, [task?.started_at]);
  useEffect(() => {
    if (task?.assembly_phase === 'picking' || task?.status === 'new') loadSourceBoxes();
  }, [task?.assembly_phase, task?.status, loadSourceBoxes]);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size="lg" /></div>;
  if (!task) return <div className="p-6 text-center text-gray-400">Задача не найдена</div>;

  const phase = task.assembly_phase || 'picking';
  const components = task.components || [];
  const pickedMap = {};
  (task.picked_summary || []).forEach(p => {
    const val = Number(p.picked_count);
    // Never decrease — prevents progress bar jumping back
    pickedMaxRef.current[p.product_id] = Math.max(pickedMaxRef.current[p.product_id] || 0, val);
    pickedMap[p.product_id] = pickedMaxRef.current[p.product_id];
  });

  const totalNeeded = components.reduce((s, c) => s + Number(c.quantity) * task.bundle_qty, 0);
  const totalPicked = Object.values(pickedMap).reduce((s, v) => s + v, 0);
  const allPicked = components.every(c => (pickedMap[c.component_id] || 0) >= Number(c.quantity) * task.bundle_qty);

  // Aggregate sourceBoxes by location (pallet/shelf) for cleaner display
  // Multiple boxes on the same pallet are combined into a single row with total qty + box count
  const aggregateLocations = (locs) => {
    const map = new Map();
    for (const loc of locs) {
      let key, label;
      if (loc.source_type === 'shelf') {
        key = `shelf-${loc.shelf_id}-${loc.product_id}`;
        label = `${loc.warehouse_name} → ${loc.rack_name} → ${loc.shelf_code}`;
      } else if (loc.source_type === 'shelf_box') {
        key = `shbox-${loc.shelf_id}-${loc.product_id}`;
        label = `${loc.warehouse_name} → ${loc.rack_name} → ${loc.shelf_code || loc.shelf_name}`;
      } else if (loc.source_type === 'pallet_item') {
        key = `pitem-${loc.pallet_id}-${loc.product_id}`;
        label = `${loc.warehouse_name} → ${loc.row_name} → ${loc.pallet_name}`;
      } else {
        key = `pallet-${loc.pallet_id}-${loc.product_id}`;
        label = `${loc.warehouse_name} → ${loc.row_name} → ${loc.pallet_name}`;
      }
      const isBoxRow = loc.source_type === 'pallet' || loc.source_type === 'shelf_box';
      const existing = map.get(key);
      if (existing) {
        existing.quantity += Number(loc.quantity);
        existing.box_count += isBoxRow ? 1 : 0;
      } else {
        map.set(key, {
          ...loc,
          label,
          quantity: Number(loc.quantity),
          box_count: isBoxRow ? 1 : 0,
        });
      }
    }
    return Array.from(map.values());
  };

  // ─── PHASE: PICKING ────────────────────────────────────────────────────────
  const handleStartPicking = async () => {
    setActionLoading(true);
    try {
      const res = await api.post(`/assembly/${id}/start-picking`);
      if (res.data.ok) {
        await loadTask();
        await loadSourceBoxes();
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Не удалось начать задачу'); }
    finally { setActionLoading(false); }
  };

  const handleScanPallet = async (barcode) => {
    // 1. Try match in sourceBoxes by pallet_barcode
    const match = sourceBoxes.find(b => b.pallet_barcode === barcode);
    if (match) {
      const palletSources = sourceBoxes.filter(b => b.pallet_id === match.pallet_id);
      if (palletSources.length === 0) {
        playBeep(false); toast.error('На этом паллете нет нужного товара');
        return;
      }
      const hasPalletItems = palletSources.some(b => b.source_type === 'pallet_item');
      setScannedPallet({ pallet_id: match.pallet_id, name: match.pallet_name, warehouse: match.warehouse_name });
      setPickStep(hasPalletItems ? 'items' : 'box');
      playBeep(true);
      toast.success(`${match.warehouse_name} · ${match.pallet_name}`);
      return;
    }

    // 2. Try via movements/scan API (pallet or shelf)
    try {
      const res = await api.post('/movements/scan', { barcode });
      const d = res.data;
      if (d.type === 'pallet') {
        const palletId = d.id;
        const palletSources = sourceBoxes.filter(b => b.pallet_id === palletId);
        if (palletSources.length === 0) {
          playBeep(false); toast.error('На этом паллете нет нужного товара для комплекта');
          return;
        }
        const hasPalletItems = palletSources.some(b => b.source_type === 'pallet_item');
        setScannedPallet({ pallet_id: palletId, name: d.name, warehouse: d.location, type: 'pallet' });
        playBeep(true);
        setPickStep(hasPalletItems ? 'items' : 'box');
        toast.success(d.location + ' · ' + d.name);
      } else if (d.type === 'shelf') {
        const shelfId = d.id;
        const shelfItems = sourceBoxes.filter(b => b.source_type === 'shelf' && b.shelf_id === shelfId);
        if (shelfItems.length === 0) {
          playBeep(false); toast.error('На этой полке нет нужного товара для комплекта');
          return;
        }
        setScannedPallet({ shelf_id: shelfId, name: d.name, warehouse: d.location, type: 'shelf' });
        playBeep(true);
        setPickStep('items');
        toast.success(d.location + ' · ' + d.name);
      } else {
        playBeep(false); toast.error('Отсканируйте паллет или полку');
      }
    } catch {
      playBeep(false); toast.error('Не найдено. Проверьте штрих-код');
    }
  };

  const handleScanPickBox = async (barcode) => {
    // 1. Быстрый путь — локальный поиск в sourceBoxes
    const box = sourceBoxes.find(b => b.box_barcode === barcode && (!scannedPallet || b.pallet_id === scannedPallet.pallet_id));
    if (box) {
      setScannedBox(box);
      playBeep(true);
      setPickStep('items');
      toast.success(`Коробка: ${box.product_name} · ${fmtQty(box.quantity)} шт`);
      return;
    }

    // 2. Fallback через /movements/scan — коробка физически может быть на паллете,
    // но не попадать в source-boxes из-за рассинхрона box_items_s / boxes_s.
    // scan-pick на бэке всё равно валидирует принадлежность товара комплекту.
    try {
      const res = await api.post('/movements/scan', { barcode });
      const d = res.data;
      if (d.type !== 'box') {
        playBeep(false);
        toast.error('Отсканирован не штрих-код коробки');
        return;
      }
      // Сравниваем pallet_id (movements/scan возвращает location с "Паллет #id" — недостаточно,
      // нужно поле pallet_id; для shelf_box его нет). Поэтому проверяем сам объект.
      // Для пеллетной коробки структура {type:'box',id,contents}, pallet_id отсутствует
      // в ответе, но мы проверяем через contents.source === 'box' (пеллетный) vs 'shelf_box'.
      const isPalletBox = (d.contents || []).some(c => c.source === 'box');
      const isShelfBox = (d.contents || []).some(c => c.source === 'shelf_box');
      if (scannedPallet?.pallet_id && !isPalletBox && !isShelfBox) {
        // Пустая коробка без contents — всё равно пробуем: scan-pick проверит содержимое.
      }
      if (scannedPallet?.pallet_id && isShelfBox) {
        playBeep(false);
        toast.error('Эта коробка на полке, а не на паллете');
        return;
      }
      // Принимаем коробку — scan-pick на бэке проверит и товар, и принадлежность комплекту
      const firstContent = (d.contents || [])[0];
      const productName = firstContent?.product_name || 'Коробка';
      const qty = firstContent?.quantity || 0;
      setScannedBox({
        box_id: d.id,
        box_barcode: barcode,
        pallet_id: scannedPallet?.pallet_id || null,
        source_type: isPalletBox ? 'pallet' : isShelfBox ? 'shelf' : (scannedPallet?.pallet_id ? 'pallet' : null),
        product_name: productName,
        quantity: qty,
      });
      playBeep(true);
      setPickStep('items');
      toast.success(`Коробка: ${productName}${qty ? ' · ' + fmtQty(qty) + ' шт' : ''}`);
    } catch (err) {
      playBeep(false);
      const status = err?.response?.status;
      if (status === 404) {
        toast.error(`ШК ${barcode} не найден в системе. Проверьте наклейку на коробке.`);
      } else {
        toast.error(err?.response?.data?.error || `Коробка ${barcode} не найдена на этом паллете`);
      }
    }
  };

  const handleScanPick = async (barcode) => {
    if (!scannedBox && !scannedPallet?.shelf_id && !scannedPallet?.pallet_id) { playBeep(false); toast.error('Сначала отсканируйте место'); return; }

    if (activeComponent) {
      const needed = Number(activeComponent.quantity) * (task?.bundle_qty || 1);
      const have = pickedMap[activeComponent.component_id] || 0;
      if (have >= needed) { playBeep(false); toast.error('Уже набрано. Нажмите «Далее»'); return; }
    }

    try {
      const res = await api.post(`/assembly/${id}/scan-pick`, {
        barcode,
        box_id: scannedBox?.box_id || null,
        box_source: scannedBox?.source_type || (scannedBox?.pallet_id ? 'pallet' : null),
        shelf_id: scannedPallet?.shelf_id || null,
        pallet_id: (!scannedBox && scannedPallet?.pallet_id && !scannedPallet?.shelf_id) ? scannedPallet.pallet_id : null,
      });
      if (res.data.duplicate) { playBeep(true); return; }
      playBeep(true);
      setLastPickScan({ name: res.data.product, time: new Date() });
      // Update picked count locally (fast) + reload in background
      if (activeComponent && res.data.picked_summary) {
        const newMap = {};
        res.data.picked_summary.forEach(p => { newMap[p.product_id] = Number(p.picked); });
        setTask(prev => prev ? { ...prev, picked_summary: res.data.picked_summary } : prev);
      }
      loadTask(); // background reload (no await)
      loadSourceBoxes();
      loadScans();
    } catch (err) {
      playBeep(false);
      const hint = err.response?.data?.hint;
      if (hint === 'source_empty') {
        // Сбрасываем коробку, но оставляем паллет — чтобы не пересканировать
        toast.error(err.response.data.error);
        setScannedBox(null);
        if (scannedPallet?.pallet_id) {
          setPickStep('box'); // выбрать другую коробку на том же паллете
        } else {
          setPickStep('location');
        }
        return;
      }
      toast.error(err.response?.data?.error || 'Ошибка');
    }
  };

  const resetPickScan = () => {
    setScannedPallet(null); setScannedBox(null); setPickStep('choose'); setActiveComponent(null);
    sessionStorage.removeItem(ssKey);
  };

  const handleStartAssembly = async () => {
    setActionLoading(true);
    try {
      await api.post(`/assembly/${id}/start-assembling`);
      sessionStorage.removeItem(ssKey);
      await loadTask();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setActionLoading(false); }
  };

  // ─── PHASE: ASSEMBLING ─────────────────────────────────────────────────────
  const currentBundle = (task.assembled_count || 0) + 1;

  const handleScanComponent = async (barcode) => {
    setActionLoading(true);
    try {
      const res = await api.post(`/assembly/${id}/scan-component`, { barcode });
      playBeep(true);
      toast.success(`✓ ${res.data.product}`);
      setComponentStatus(res.data.components_status || []);

      if (res.data.all_components_scanned) {
        // Show barcode for printing
        // Find system barcode (starts with 20000)
        const allBc = (task.bundle_barcodes || '').split(';').map(s => s.trim()).filter(Boolean);
        const systemBc = allBc.find(b => /^[124]0{5,}\d+$/.test(b));
        const bc = systemBc || task.bundle_barcode || allBc[0] || '';
        setPrintBarcode(bc);
      }
      await loadTask();
    } catch (err) {
      const hint = err.response?.data?.hint;
      if (hint === 'already_scanned') {
        playBeep(false);
        toast.warning?.(err.response.data.error) || toast.error(err.response.data.error);
      } else {
        playBeep(false);
        toast.error(err.response?.data?.error || 'Ошибка');
      }
    }
    finally { setActionLoading(false); }
  };

  const handleConfirmBundle = async (barcode) => {
    setActionLoading(true);
    try {
      const res = await api.post(`/assembly/${id}/confirm-bundle`, { barcode });
      playBeep(true);
      toast.success(`Комплект ${res.data.assembled_count}/${res.data.total} готов!`);
      setPrintBarcode(null);
      setComponentStatus([]);
      await loadTask();
    } catch (err) { playBeep(false); toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setActionLoading(false); }
  };

  // ─── PHASE: PLACING ────────────────────────────────────────────────────────
  const handleScanDestination = async (barcode) => {
    try {
      const res = await api.post('/movements/scan', { barcode });
      const d = res.data;
      if (d.type === 'shelf') {
        setPlaceDest({ shelf_id: d.id, name: `${d.location} · ${d.name}` });
        setPlaceBoxStep(false); setPlaceBox(null);
        playBeep(true); toast.success(`Полка: ${d.name}`);
      } else if (d.type === 'pallet') {
        // Check if pallet has boxes
        const hasBoxes = (d.contents || []).some(c => c.source === 'box');
        setPlaceDest({ pallet_id: d.id, name: `${d.location} · ${d.name}`, hasBoxes });
        if (hasBoxes) {
          setPlaceBoxStep(true);
          playBeep(true); toast.success(`${d.location} · ${d.name} — отсканируйте коробку`);
        } else {
          setPlaceBoxStep(false); setPlaceBox(null);
          playBeep(true); toast.success(`Паллет: ${d.name}`);
        }
      } else if (d.type === 'box') {
        // Direct box scan — set as destination immediately
        setPlaceDest({ box_id: d.id, name: `${d.location} · ${d.name}` });
        setPlaceBox({ box_id: d.id, name: d.name });
        setPlaceBoxStep(false);
        playBeep(true); toast.success(`Коробка: ${d.name}`);
      } else {
        playBeep(false); toast.error('Отсканируйте полку, паллет или коробку');
      }
    } catch (err) { playBeep(false); toast.error('Место не найдено'); }
  };

  const handleScanPlaceBox = async (barcode) => {
    if (!placeDest?.pallet_id) { toast.error('Сначала выберите паллет'); return; }
    try {
      const pr = await api.get(`/fbo/pallets/${placeDest.pallet_id}`);
      const box = (pr.data.boxes || []).find(b => b.barcode_value === barcode);
      if (box) {
        setPlaceBox({ box_id: box.id, name: `Коробка · ${box.product_name || ''}`.trim() });
        setPlaceBoxStep(false);
        playBeep(true); toast.success(`Коробка выбрана`);
      } else {
        playBeep(false); toast.error('Коробка не найдена на этом паллете');
      }
    } catch { playBeep(false); toast.error('Ошибка при поиске коробки'); }
  };

  const handleScanPlace = async (barcode) => {
    if (!placeDest) { toast.error('Сначала отсканируйте место назначения'); return; }
    setActionLoading(true);
    try {
      const body = { barcode };
      if (placeBox?.box_id) body.box_id = placeBox.box_id;
      else if (placeDest.box_id) body.box_id = placeDest.box_id;
      else if (placeDest.shelf_id) body.shelf_id = placeDest.shelf_id;
      else if (placeDest.pallet_id) body.pallet_id = placeDest.pallet_id;
      const res = await api.post(`/assembly/${id}/scan-place`, body);
      playBeep(true); toast.success(`Размещено ${res.data.placed_count}/${res.data.total}`);
      if (res.data.phase === 'completed') {
        toast.success('Задача завершена!');
      }
      await loadTask();
    } catch (err) { playBeep(false); toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setActionLoading(false); }
  };

  const handleChangeDest = () => { setPlaceDest(null); setPlaceBox(null); setPlaceBoxStep(false); };

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/employee/tasks')} className="p-2 rounded-xl hover:bg-gray-100">
          <ArrowLeft size={18} className="text-gray-500" />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">Сборка комплектов</h1>
          <p className="text-xs text-gray-400">{task.bundle_name} × {task.bundle_qty}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={phase === 'completed' ? 'success' : 'primary'}>
            {phase === 'picking' ? 'Забор' : phase === 'assembling' ? 'Сборка' : phase === 'placing' ? 'Размещение' : 'Готово'}
          </Badge>
          {elapsed && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-gray-400">
              <Clock size={10} />{elapsed}
            </span>
          )}
        </div>
      </div>

      {/* Phase indicators */}
      <div className="flex items-center gap-2 mb-5">
        {['picking', 'assembling', 'placing'].map((p, i) => (
          <div key={p} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
              phase === p ? 'bg-primary-600 text-white' :
              ['assembling','placing','completed'].indexOf(phase) > ['picking','assembling','placing'].indexOf(p) ? 'bg-green-500 text-white' :
              'bg-gray-200 text-gray-500'
            }`}>{i + 1}</div>
            <span className={`text-xs font-medium ${phase === p ? 'text-primary-600' : 'text-gray-400'}`}>
              {p === 'picking' ? 'Забор' : p === 'assembling' ? 'Сборка' : 'Размещение'}
            </span>
            {i < 2 && <ChevronRight size={12} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {/* ═══ PAUSED ═══ */}
      {task.status === 'paused' && (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
          </div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">Задача на паузе</h3>
          <p className="text-sm text-gray-500 max-w-xs">Администратор приостановил эту задачу. Дождитесь возобновления.</p>
        </div>
      )}

      {/* ═══ NOT STARTED ═══ */}
      {task.status === 'new' && (
        <div className="text-center space-y-4 py-8">
          <Package size={48} className="text-primary-300 mx-auto" />
          <div>
            <h2 className="text-lg font-bold text-gray-900">Собрать {task.bundle_qty} комплектов</h2>
            <p className="text-sm text-gray-500 mt-1">{task.bundle_name}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-4 text-left">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Состав комплекта:</p>
            {components.map(c => (
              <div key={c.component_id} className="flex justify-between py-1 text-sm">
                <span className="text-gray-800">{c.name}</span>
                <span className="font-bold text-gray-600">× {fmtQty(c.quantity)}</span>
              </div>
            ))}
          </div>
          {sourceBoxes.length > 0 && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-left">
              <p className="text-xs font-semibold text-amber-700 uppercase mb-2">Где можно взять:</p>
              <div className="max-h-32 overflow-y-auto space-y-2">
                {sourceBoxes.slice(0, 15).map((b, i) => (
                  <div key={i} className="px-2 py-1 bg-white/60 rounded-lg">
                    <div className="flex items-center gap-1.5 text-xs">
                      <MapPin size={11} className="text-amber-500 flex-shrink-0" />
                      <span className="font-medium text-gray-800">{b.warehouse_name} → {b.source_type === 'shelf' ? `${b.rack_name} → ${b.shelf_code}` : `${b.row_name} → ${b.pallet_name}`}</span>
                      <span className="text-amber-600 font-bold ml-auto flex-shrink-0">{fmtQty(b.quantity)} шт</span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5 pl-4">{b.product_name?.replace(/GraFLab,?\s*/i, '').trim()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Button onClick={handleStartPicking} loading={actionLoading} size="lg" className="w-full">
            Начать забор товара
          </Button>
        </div>
      )}

      {/* ═══ PICKING ═══ */}
      {phase === 'picking' && task.status === 'in_progress' && (
        <div className="space-y-4">
          {/* Components list with expand/locations/status */}
          {pickStep === 'choose' && (
            <div className="space-y-2">
              <p className="text-sm text-gray-500 text-center py-1">Выберите, с какого товара хотите начать забор</p>
              {components.map(c => {
                const needed = Number(c.quantity) * task.bundle_qty;
                const have = pickedMap[c.component_id] || 0;
                const done = have >= needed;
                const isExpanded = expandedComponent === c.component_id;
                const compLocs = aggregateLocations(sourceBoxes.filter(b => b.product_id === c.component_id));
                return (
                  <div key={c.component_id} className={`rounded-xl border overflow-hidden ${done ? 'border-green-200 bg-green-50/30' : 'border-gray-100 bg-white'}`}>
                    {/* Component header — clickable */}
                    <button type="button" onClick={() => setExpandedComponent(isExpanded ? null : c.component_id)}
                      className="w-full text-left px-3 py-3 flex items-center gap-3">
                      {done ? <CheckCircle2 size={18} className="text-green-500 flex-shrink-0" /> : <Package size={18} className="text-gray-300 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{c.name?.replace(/GraFLab,?\s*/i,'').trim()}</p>
                        <p className="text-xs text-gray-400">{isExpanded ? '▼' : '▶'} Где взять ({compLocs.length})</p>
                      </div>
                      <span className={`text-sm font-bold ${done ? 'text-green-600' : 'text-gray-500'}`}>{have}/{needed}</span>
                    </button>

                    {/* Expanded: locations + take button */}
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2">
                        {compLocs.length > 0 ? (
                          <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                            {compLocs.map((loc, i) => (
                              <div key={i} className="px-2 py-1.5 bg-amber-50 rounded-lg text-xs">
                                <div className="flex items-center gap-1.5">
                                  <MapPin size={11} className="text-amber-500 flex-shrink-0" />
                                  <span className="font-medium text-gray-800 flex-1">
                                    {loc.label}
                                    {loc.box_count > 1 && <span className="text-gray-400 ml-1">· {loc.box_count} кор.</span>}
                                  </span>
                                  <span className="text-amber-600 font-bold">{fmtQty(loc.quantity)} шт</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-rose-500">Не найден на складах</p>
                        )}
                        {!done && compLocs.length > 0 && (
                          <Button size="sm" className="w-full" onClick={() => { setActiveComponent(c); setPickStep('location'); }}>
                            Забрать {c.name?.replace(/GraFLab,?\s*/i,'').trim().slice(0,25)}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Step: Scan location for active component */}
          {pickStep === 'location' && activeComponent && (
            <div className="space-y-3">
              <div className="bg-primary-50 border border-primary-100 rounded-xl p-3">
                <p className="text-sm font-bold text-primary-800">Забираем: {activeComponent.name?.replace(/GraFLab,?\s*/i,'').trim()}</p>
                <p className="text-xs text-primary-600">Набрано: {pickedMap[activeComponent.component_id] || 0} / {Number(activeComponent.quantity) * task.bundle_qty}</p>
              </div>

              {/* Available locations for this component */}
              <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                {aggregateLocations(sourceBoxes.filter(b => b.product_id === activeComponent.component_id)).map((loc, i) => (
                  <div key={i} className="px-2 py-1.5 bg-amber-50 rounded-lg text-xs">
                    <div className="flex items-center gap-1.5">
                      <MapPin size={11} className="text-amber-500 flex-shrink-0" />
                      <span className="font-medium text-gray-800 flex-1">
                        {loc.label}
                        {loc.box_count > 1 && <span className="text-gray-400 ml-1">· {loc.box_count} кор.</span>}
                      </span>
                      <span className="text-amber-600 font-bold">{fmtQty(loc.quantity)} шт</span>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs font-semibold text-gray-500 uppercase">Отсканируйте паллет или полку</p>
              <ScanInput onScan={handleScanPallet} disabled={actionLoading} placeholder="ШК паллета или полки..." />
              <button onClick={resetPickScan} className="text-xs text-gray-400 hover:text-gray-600">← Назад к выбору</button>
            </div>
          )}

          {/* Step: Scan box (only for pallet) */}
          {pickStep === 'box' && scannedPallet && (
            <div className="space-y-2">
              <div className="bg-primary-50 border border-primary-100 rounded-xl p-3">
                <p className="text-sm font-bold text-primary-800">Забираем: {activeComponent?.name?.replace(/GraFLab,?\s*/i,'').trim()}</p>
                <p className="text-xs text-primary-600">{scannedPallet.warehouse} · {scannedPallet.name}</p>
              </div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Отсканируйте коробку</p>
              <ScanInput onScan={handleScanPickBox} disabled={actionLoading} placeholder="ШК коробки..." />
              <button onClick={() => { setScannedPallet(null); setPickStep('location'); }} className="text-xs text-gray-400 hover:text-gray-600">← Другой паллет</button>
            </div>
          )}

          {/* Step: Scan items */}
          {pickStep === 'items' && (scannedBox || scannedPallet?.shelf_id || scannedPallet?.pallet_id) && activeComponent && (
            <div className="space-y-2">
              <div className="bg-primary-50 border border-primary-100 rounded-xl p-3">
                <p className="text-sm font-bold text-primary-800">{activeComponent.name?.replace(/GraFLab,?\s*/i,'').trim()}</p>
                <p className="text-xs text-primary-600">{scannedPallet?.warehouse || ''} · {scannedPallet?.name || ''}{scannedBox ? ' · Коробка' : ''}</p>
                <div className="h-2 bg-primary-100 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-primary-500 rounded-full transition-all duration-300 ease-out" style={{ width: `${Math.min(100, ((pickedMap[activeComponent.component_id] || 0) / Math.max(1, Number(activeComponent.quantity) * (task?.bundle_qty || 1))) * 100)}%` }} />
                </div>
                <p className="text-xs text-primary-700 font-bold mt-1">{pickedMap[activeComponent.component_id] || 0} / {Number(activeComponent.quantity) * (task?.bundle_qty || 1)}</p>
              </div>

              {/* Scan chronology — like inventory */}
              {scanHistory.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-0 rounded-xl border border-gray-100 bg-white">
                  {scanHistory.map((sc, i) => (
                    <div key={sc.id} className="flex items-center gap-2 px-3 py-2 border-b border-gray-50 last:border-0">
                      <span className="text-xs font-mono text-gray-300 w-4 text-right flex-shrink-0">{scanHistory.length - i}</span>
                      <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                      <p className="text-xs font-medium text-gray-800 truncate flex-1">{(sc.product_name || '').replace(/GraFLab,?\s*/i, '').trim()}</p>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[11px] font-mono text-gray-500">{new Date(sc.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p>
                        {sc.seconds_since_prev != null && Number(sc.seconds_since_prev) > 0
                          ? <p className={`text-[11px] font-mono font-bold ${Number(sc.seconds_since_prev) > 10 ? 'text-rose-400' : Number(sc.seconds_since_prev) > 5 ? 'text-amber-400' : 'text-green-500'}`}>+{sc.seconds_since_prev}с</p>
                          : <p className="text-[11px] text-primary-400 font-mono">старт</p>
                        }
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(pickedMap[activeComponent.component_id] || 0) < Number(activeComponent.quantity) * (task?.bundle_qty || 1) && (
                <ScanInput onScan={handleScanPick} disabled={actionLoading} placeholder="ШК баночки..." />
              )}

              {(pickedMap[activeComponent.component_id] || 0) >= Number(activeComponent.quantity) * (task?.bundle_qty || 1) && (
                <Button onClick={resetPickScan} size="lg" className="w-full" variant="success">
                  ✓ Набрано — далее
                </Button>
              )}

              {(pickedMap[activeComponent.component_id] || 0) < Number(activeComponent.quantity) * (task?.bundle_qty || 1) && (
                <div className="flex items-center gap-3">
                  <button onClick={resetPickScan} className="text-xs text-gray-400 hover:text-gray-600">← Назад к выбору</button>
                  <button onClick={() => { setScannedBox(null); setPickStep(scannedPallet?.type === 'shelf' ? 'location' : 'location'); }}
                    className="text-xs text-primary-500 hover:text-primary-700 font-semibold ml-auto">
                    Сменить коробку / источник →
                  </button>
                </div>
              )}
            </div>
          )}

          {allPicked && (
            <Button onClick={handleStartAssembly} loading={actionLoading} size="lg" className="w-full" variant="success">
              Все забрано — начать сборку
            </Button>
          )}
        </div>
      )}

      {/* ═══ ASSEMBLING ═══ */}
      {phase === 'assembling' && (
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-4 text-center">
            <p className="text-xl font-black text-primary-700">Комплект {currentBundle} из {task.bundle_qty}</p>
            <p className="text-xs text-primary-500 mt-1">Собрано: {task.assembled_count || 0}</p>
          </div>

          {!printBarcode ? (
            <>
              {/* Components checklist */}
              <div className="space-y-2">
                {components.map(c => {
                  const status = componentStatus.find(s => s.product_id === c.component_id);
                  const done = status?.done || false;
                  return (
                    <div key={c.component_id} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${done ? 'bg-green-50 border-green-200' : 'bg-white border-gray-100'}`}>
                      {done ? <CheckCircle2 size={18} className="text-green-500" /> : <Box size={18} className="text-gray-300" />}
                      <span className={`text-sm font-medium ${done ? 'text-green-700' : 'text-gray-800'}`}>{c.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">× {fmtQty(c.quantity)}</span>
                    </div>
                  );
                })}
              </div>
              <ScanInput onScan={handleScanComponent} disabled={actionLoading} placeholder="Сканируйте компонент..." />
            </>
          ) : (
            /* Print barcode */
            <div className="bg-white border border-gray-200 rounded-xl p-6">
              <BarcodePrint barcode={printBarcode} productName={task.bundle_name} />
              <div className="mt-4">
                <ScanInput onScan={handleConfirmBundle} disabled={actionLoading} placeholder="Сканируйте наклеенный ШК..." />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ PLACING ═══ */}
      {phase === 'placing' && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-center">
            <p className="text-lg font-bold text-green-800">Размещение комплектов</p>
            <p className="text-sm text-green-600">{task.placed_count || 0} / {task.bundle_qty} размещено</p>
            <div className="h-2 bg-green-100 rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${((task.placed_count || 0) / task.bundle_qty) * 100}%` }} />
            </div>
          </div>

          {!placeDest ? (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-sm font-medium text-amber-800">Отсканируйте место назначения</p>
                <p className="text-xs text-amber-600 mt-0.5">Полку или паллет, куда положить комплекты</p>
              </div>
              <ScanInput onScan={handleScanDestination} disabled={actionLoading} placeholder="Сканируйте полку, паллет или коробку..." />
            </div>
          ) : placeBoxStep ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
                <MapPin size={16} className="text-blue-500" />
                <span className="text-sm font-medium text-blue-800 flex-1">{placeDest.name}</span>
                <button onClick={handleChangeDest} className="text-xs text-blue-500 hover:text-blue-700">Сменить</button>
              </div>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-sm font-medium text-amber-800">Отсканируйте коробку на паллете</p>
                <p className="text-xs text-amber-600 mt-0.5">Комплекты будут размещены в коробку</p>
              </div>
              <ScanInput onScan={handleScanPlaceBox} disabled={actionLoading} placeholder="ШК коробки..." />
              <button onClick={() => { setPlaceBoxStep(false); }} className="text-xs text-gray-400 hover:text-gray-600">Положить на паллет без коробки</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
                <MapPin size={16} className="text-blue-500" />
                <div className="flex-1">
                  <span className="text-sm font-medium text-blue-800">{placeDest.name}</span>
                  {placeBox && <p className="text-xs text-blue-500">{placeBox.name}</p>}
                </div>
                <button onClick={handleChangeDest} className="text-xs text-blue-500 hover:text-blue-700">Сменить</button>
              </div>
              <ScanInput onScan={handleScanPlace} disabled={actionLoading} placeholder="Сканируйте комплект для размещения..." />
            </div>
          )}
        </div>
      )}

      {/* ═══ COMPLETED ═══ */}
      {phase === 'completed' && (
        <div className="text-center py-12 space-y-4">
          <CheckCircle2 size={64} className="text-green-500 mx-auto" />
          <h2 className="text-xl font-bold text-gray-900">Задача завершена!</h2>
          <p className="text-sm text-gray-500">
            Собрано {task.assembled_count} комплектов · Размещено {task.placed_count}
          </p>
          <Button onClick={() => navigate('/employee/tasks')} variant="ghost">К задачам</Button>
        </div>
      )}
    </div>
  );
}

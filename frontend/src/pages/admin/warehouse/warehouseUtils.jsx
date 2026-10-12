import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { printBarcode } from '../../../utils/printBarcode';
import { openLabelsPdf, downloadLabelsPdf } from '../../../utils/barcodePdf';
import { qty } from '../../../utils/fmt';
import {
  Pencil, Trash2, Plus, Search,
  ChevronRight, ArrowLeft, Copy, Check, X, Printer, ArrowDown
} from 'lucide-react';
import { ProductIcon, BoxIcon } from '../../../components/ui/WarehouseIcons';
import api from '../../../api/client';

import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Input from '../../../components/ui/Input';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import Barcode from '../../../components/ui/Barcode';
import CopyBadge from '../../../components/ui/CopyBadge';
import { useToast } from '../../../components/ui/Toast';
import { getTypeMeta, fmtSource as fmtMovSource } from '../../../utils/movementTypes';

export const fmtQ = (v) => { const n = parseFloat(v || 0); return Number.isInteger(n) ? String(n) : n.toFixed(0); };

// ─── Barcode Display (click to show modal) ───────────────────────────────────
export function BarcodeDisplay({ value, label }) {
  const [showBarcode, setShowBarcode] = useState(false);
  if (!value) return null;
  return (
    <>
      <span className="inline-flex items-center gap-2">
        <CopyBadge value={value} label={label} />
        <button onClick={() => setShowBarcode(true)}
          className="text-xs text-gray-400 hover:text-primary-600 transition-colors flex items-center gap-1"
          title="Показать штрих-код">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7v10M11 7v10M15 7v6M19 7v10"/></svg>
        </button>
      </span>
      {showBarcode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowBarcode(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
            <Barcode value={value} height={80} width={2} />
            <div className="flex justify-center gap-3 mt-4">
              <button onClick={() => printBarcode(value, value, '')} className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-xl hover:bg-primary-700 transition-colors flex items-center gap-2">
                <Printer size={14} /> Печать
              </button>
              <button onClick={() => setShowBarcode(false)} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Movement History helper ────────────────────────────────────────────────────
export const OP_LABELS = {
  // shelf_movements_s operation types
  inventory:              { label: 'Инвентаризация',       color: 'text-blue-600',    bg: 'bg-blue-50',    icon: '📋' },
  stock_in:               { label: 'Приход',               color: 'text-green-600',   bg: 'bg-green-50',   icon: '📥' },
  stock_out:              { label: 'Списание',             color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '📤' },
  correction:             { label: 'Корректировка',        color: 'text-amber-600',   bg: 'bg-amber-50',   icon: '✏️' },
  transfer:               { label: 'Перемещение',          color: 'text-primary-600', bg: 'bg-primary-50', icon: '🔄' },
  // movements_s types — box operations
  box_create:             { label: 'Создание коробки',     color: 'text-green-600',   bg: 'bg-green-50',   icon: '📦' },
  box_delete:             { label: 'Удаление коробки',     color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '🗑️' },
  edit_add_to_box:        { label: 'Добавлено в коробку',  color: 'text-green-600',   bg: 'bg-green-50',   icon: '📥' },
  edit_remove_from_box:   { label: 'Списание из коробки',  color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '📤' },
  box_product_change:     { label: 'Замена товара',        color: 'text-amber-600',   bg: 'bg-amber-50',   icon: '🔄' },
  // movements_s types — location transfers
  shelf_to_shelf:         { label: 'Полка → Полка',        color: 'text-blue-600',    bg: 'bg-blue-50',    icon: '🔄' },
  shelf_to_pallet:        { label: 'Полка → Паллет',       color: 'text-purple-600',  bg: 'bg-purple-50',  icon: '📤' },
  pallet_to_shelf:        { label: 'Паллет → Полка',       color: 'text-green-600',   bg: 'bg-green-50',   icon: '📥' },
  pallet_to_pallet:       { label: 'Паллет → Паллет',      color: 'text-indigo-600',  bg: 'bg-indigo-50',  icon: '🔄' },
  shelf_to_employee:      { label: 'Забрал с полки',       color: 'text-orange-600',  bg: 'bg-orange-50',  icon: '👤' },
  employee_to_shelf:      { label: 'Положил на полку',     color: 'text-cyan-600',    bg: 'bg-cyan-50',    icon: '📥' },
  employee_to_pallet:     { label: 'Положил на паллет',    color: 'text-cyan-600',    bg: 'bg-cyan-50',    icon: '📥' },
  pallet_to_employee:     { label: 'Забрал с паллета',     color: 'text-amber-600',   bg: 'bg-amber-50',   icon: '👤' },
  box_to_employee:        { label: 'Забрал из коробки',    color: 'text-orange-600',  bg: 'bg-orange-50',  icon: '📦→👤' },
  employee_to_box:        { label: 'Положил в коробку',    color: 'text-cyan-600',    bg: 'bg-cyan-50',    icon: '👤→📦' },
  box_to_shelf:           { label: 'Коробка → Полка',      color: 'text-cyan-600',    bg: 'bg-cyan-50',    icon: '📥' },
  box_to_pallet:          { label: 'Коробка → Паллет',     color: 'text-violet-600',  bg: 'bg-violet-50',  icon: '📤' },
  shelf_to_box:           { label: 'Полка → Коробка',      color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', icon: '📦' },
  pallet_to_box:          { label: 'Паллет → Коробка',     color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', icon: '📦' },
  box_transfer:           { label: 'Перенос коробки',      color: 'text-indigo-600',  bg: 'bg-indigo-50',  icon: '📦🔄' },
  // сборка
  bundle_pick:            { label: 'Сборка (забор)',       color: 'text-orange-600',  bg: 'bg-orange-50',  icon: '📦' },
  // external / admin
  external_to_shelf:      { label: 'Приход на полку',      color: 'text-emerald-600', bg: 'bg-emerald-50', icon: '📥' },
  external_to_pallet:     { label: 'Приход на паллет',     color: 'text-emerald-600', bg: 'bg-emerald-50', icon: '📥' },
  external_to_employee:   { label: 'Выдача сотруднику',    color: 'text-amber-600',   bg: 'bg-amber-50',   icon: '👤' },
  edit_add_to_shelf:      { label: 'Добавлено на полку',   color: 'text-green-600',   bg: 'bg-green-50',   icon: '📥' },
  edit_remove_from_shelf: { label: 'Списание с полки',     color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '📤' },
  edit_add_to_pallet:     { label: 'Добавлено на паллет',  color: 'text-green-600',   bg: 'bg-green-50',   icon: '📥' },
  edit_remove_from_pallet:{ label: 'Списание с паллета',   color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '📤' },
  pallet_correction_in:   { label: 'Корректировка +',      color: 'text-green-600',   bg: 'bg-green-50',   icon: '✏️' },
  pallet_correction_out:  { label: 'Корректировка −',      color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '✏️' },
  employee_correction_in: { label: 'Добавлено сотруднику', color: 'text-green-600',   bg: 'bg-green-50',   icon: '👤+' },
  employee_correction_out:{ label: 'Списание у сотрудника',color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '👤−' },
  employee_writeoff:      { label: 'Списание',             color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '🗑️' },
  write_off:              { label: 'Списание',             color: 'text-rose-600',     bg: 'bg-rose-50',     icon: '🗑️' },
};

export function opMeta(type) {
  if (OP_LABELS[type]) return OP_LABELS[type];
  const meta = getTypeMeta(type);
  return { label: meta.label, color: meta.cls.split(' ')[1] || 'text-gray-600', bg: meta.cls.split(' ')[0] || 'bg-gray-100', icon: '📋' };
}

export function normalizeMovement(r) {
  if (r._normalized) return r;
  const opType = r.operation_type || r.movement_type || 'unknown';
  // Fix: use != null to correctly handle null DB values (null !== undefined is true!)
  const qDelta = r.quantity_delta != null ? Number(r.quantity_delta)
    : (r.quantity_before != null && r.quantity_after != null)
      ? Number(r.quantity_after) - Number(r.quantity_before)
      : Number(r.quantity || 0);
  return { ...r, operation_type: opType, quantity_delta: qDelta, _normalized: true };
}

export function groupMovements(rows) {
  const map = new Map();
  for (const raw of rows) {
    const r = normalizeMovement(raw);
    const key = `${r.task_id ?? 'null'}|${r.product_id}|${r.shelf_id ?? r.to_shelf_id ?? r.from_shelf_id ?? 'null'}|${r.operation_type}|${r.employee_name ?? r.from_employee_name ?? r.to_employee_name ?? 'null'}`;
    if (!map.has(key)) map.set(key, { ...r, quantity_delta: 0, rows: [] });
    const g = map.get(key);
    g.quantity_delta += r.quantity_delta;
    g.quantity_after = r.quantity_after;
    if (new Date(r.created_at) > new Date(g.created_at)) g.created_at = r.created_at;
    g.rows.push(r);
  }
  return [...map.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function fmtMovDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function movRoute(r) {
  const parts = [];
  // From
  if (r.from_shelf_code || r.from_shelf_name) parts.push({ label: r.from_shelf_code || r.from_shelf_name, type: 'shelf' });
  else if (r.from_pallet_name) parts.push({ label: r.from_pallet_name, type: 'pallet' });
  else if (r.from_employee_name) parts.push({ label: r.from_employee_name?.split(' ')[0], type: 'employee' });
  // To
  if (r.to_shelf_code || r.to_shelf_name) parts.push({ label: r.to_shelf_code || r.to_shelf_name, type: 'shelf' });
  else if (r.to_pallet_name) parts.push({ label: r.to_pallet_name, type: 'pallet' });
  else if (r.to_employee_name) parts.push({ label: r.to_employee_name?.split(' ')[0], type: 'employee' });
  return parts;
}

export function LocationHistory({ movements, mode, onModeChange, title }) {
  const normalized = useMemo(() => movements.map(normalizeMovement), [movements]);
  const grouped = useMemo(() => groupMovements(movements), [movements]);
  return (
    <div className="card p-4 mt-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {title || 'История'} <span className="text-primary-500">{movements.length}</span>
        </p>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => onModeChange('grouped')}
            className={`px-2 py-1 rounded text-xs font-medium transition-all ${mode === 'grouped' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>
            Группировка
          </button>
          <button onClick={() => onModeChange('detailed')}
            className={`px-2 py-1 rounded text-xs font-medium transition-all ${mode === 'detailed' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}>
            Все
          </button>
        </div>
      </div>
      {movements.length === 0 ? (
        <p className="text-center text-sm text-gray-300 py-4">Нет записей</p>
      ) : (
        <div className="space-y-0.5 max-h-96 overflow-y-auto">
          {(mode === 'grouped' ? grouped : normalized).map((r, i) => {
            const meta = opMeta(r.operation_type);
            const delta = Number(r.quantity_delta);
            const sign = delta >= 0 ? '+' : '';
            const boxInfo = r.box_name || r.box_barcode || '';
            const route = movRoute(r);
            const hasQtyChange = r.quantity_before != null && r.quantity_after != null;
            return (
              <div key={r.id ?? i} className="flex items-start gap-2 py-2 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-50 last:border-0">
                {/* Type badge */}
                <span className={`text-[11px] px-2 py-0.5 rounded-md font-medium flex-shrink-0 mt-0.5 ${meta.bg} ${meta.color}`}>
                  {meta.label}
                </span>
                {/* Product + route */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-800 dark:text-gray-200 truncate block font-medium">
                    {r.product_name || r.notes || '—'}
                  </span>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {boxInfo && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">📦 {boxInfo}</span>}
                    {route.length >= 2 && (
                      <span className="text-[10px] text-gray-400">
                        <span className="text-rose-400">{route[0].label}</span>
                        <span className="mx-0.5">→</span>
                        <span className="text-green-600">{route[1].label}</span>
                      </span>
                    )}
                    {route.length === 1 && (
                      <span className="text-[10px] text-gray-400">{route[0].label}</span>
                    )}
                    {!route.length && r.notes && r.notes !== 'Перемещение' && (
                      <span className="text-[10px] text-gray-400">{r.notes}</span>
                    )}
                  </div>
                </div>
                {/* Quantity info */}
                <div className="flex flex-col items-end flex-shrink-0 gap-0.5">
                  <div className="flex items-center gap-1.5">
                    {mode === 'grouped' && r.rows?.length > 1 && (
                      <span className="text-[10px] text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{r.rows.length}×</span>
                    )}
                    {mode === 'detailed' && hasQtyChange && (
                      <span className="text-[10px] font-mono text-gray-400">{qty(r.quantity_before)}→{qty(r.quantity_after)}</span>
                    )}
                    <span className={`text-sm font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-rose-500' : 'text-gray-400'}`}>
                      {delta !== 0 ? `${sign}${qty(delta)} шт.` : `${qty(Math.abs(Number(r.quantity || 0)))} шт.`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.employee_name && (
                      <span className="text-[10px] text-gray-400 truncate max-w-[80px]" title={r.employee_name}>{r.employee_name.split(' ')[0]}</span>
                    )}
                    <span className="text-[10px] text-gray-300">{fmtMovDate(r.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Backward compat alias
export function ShelfMovements({ movements, mode, onModeChange }) {
  return <LocationHistory movements={movements} mode={mode} onModeChange={onModeChange} />;
}

// ─── Shelf Box helpers ──────────────────────────────────────────────────────
export function getShelfBoxLabel(box, shelf) {
  if (box?.name) return box.name;
  if (box?.position && (shelf?.code || shelf?.name)) return `${shelf.code || shelf.name}К${box.position}`;
  return 'Коробка';
}

export function getPalletBoxLabel(box, pallet) {
  if (box?.name) return box.name;
  const palletNumber = pallet?.number || pallet?.pallet_number;
  if (box?.position && pallet?.row_number && palletNumber) return `Р${pallet.row_number}П${palletNumber}К${box.position}`;
  if (box?.position) return `Коробка К${box.position}`;
  return 'Коробка';
}

export function printBarcodesBatch(items, _title = 'Этикетки') {
  const printable = (items || []).filter(item => item?.barcodeValue);
  if (!printable.length) {
    return { printed: 0, skipped: Array.isArray(items) ? items.length : 0, blocked: false };
  }
  // Вкладку открываем синхронно (до await внутри openLabelsPdf) — иначе блокировщик popup.
  const win = window.open('', '_blank');
  if (!win) {
    return { printed: 0, skipped: Array.isArray(items) ? items.length : 0, blocked: true };
  }
  openLabelsPdf(printable, { win }).catch((err) => {
    console.error('[printBarcodesBatch] не удалось сформировать PDF:', err);
    if (win && !win.closed) win.close();
  });
  return { printed: printable.length, skipped: (items?.length || 0) - printable.length, blocked: false };
}

export async function downloadBarcodesPdfBatch(items, filename = 'etiketki.pdf') {
  return downloadLabelsPdf(items, filename);
}

/** Открыть пачку этикеток как PDF в новой вкладке (просмотр/сохранение). */
export function openBarcodesPdfBatch(items, _filename = 'etiketki.pdf') {
  const printable = (items || []).filter(item => item?.barcodeValue);
  if (!printable.length) {
    return { opened: 0, skipped: Array.isArray(items) ? items.length : 0, blocked: false };
  }
  const win = window.open('', '_blank');
  if (!win) {
    return { opened: 0, skipped: Array.isArray(items) ? items.length : 0, blocked: true };
  }
  openLabelsPdf(printable, { win }).catch((err) => {
    console.error('[openBarcodesPdfBatch] не удалось сформировать PDF:', err);
    if (win && !win.closed) win.close();
  });
  return { opened: printable.length, skipped: (items?.length || 0) - printable.length, blocked: false };
}

export function printShelfBoxBarcode(box, shelf) {
  printBarcode(box.barcode_value, getShelfBoxLabel(box, shelf), shelf?.code || shelf?.name || '');
}

export function printPalletBoxBarcode(box, pallet) {
  printBarcode(box.barcode_value, getPalletBoxLabel(box, pallet), pallet?.name || '');
}

export function printShelfBoxesBarcodes(boxes, shelf) {
  return printBarcodesBatch(
    (boxes || []).map(box => ({
      barcodeValue: box?.barcode_value,
      labelText: getShelfBoxLabel(box, shelf),
      subText: shelf?.code || shelf?.name || '',
    })),
    `Коробки ${shelf?.code || shelf?.name || ''}`
  );
}

export function printPalletBoxesBarcodes(boxes, pallet) {
  return printBarcodesBatch(
    (boxes || []).map(box => ({
      barcodeValue: box?.barcode_value,
      labelText: getPalletBoxLabel(box, pallet),
      subText: pallet?.name || '',
    })),
    `Коробки ${pallet?.name || ''}`
  );
}

export function downloadShelfBoxesPdf(boxes, shelf) {
  return downloadBarcodesPdfBatch(
    (boxes || []).map(box => ({
      barcodeValue: box?.barcode_value,
      labelText: getShelfBoxLabel(box, shelf),
      subText: shelf?.code || shelf?.name || '',
    })),
    `Коробки ${shelf?.code || shelf?.name || 'полка'}`
  );
}

export function downloadPalletBoxesPdf(boxes, pallet) {
  return downloadBarcodesPdfBatch(
    (boxes || []).map(box => ({
      barcodeValue: box?.barcode_value,
      labelText: getPalletBoxLabel(box, pallet),
      subText: pallet?.name || '',
    })),
    `Коробки ${pallet?.name || 'паллет'}`
  );
}

export function getBoxContentsLabel(box) {
  if (Number(box?.products_count || 0) > 1) return `${Number(box.products_count)} товара`;
  if (box?.product_name) return box.product_name;
  return 'Пустая коробка';
}

// ─── Shelf Item Row (inline edit) ────────────────────────────────────────────
export function ShelfItemRow({ item, shelfId, onUpdate }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [qtyVal, setQtyVal] = useState(String(parseFloat(item.quantity)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newQty = parseFloat(qtyVal);
    if (isNaN(newQty) || newQty < 0) return;
    setSaving(true);
    try {
      await api.post(`/warehouse/shelves/${shelfId}/set`, { product_id: item.product_id, quantity: newQty });
      toast.success('Количество обновлено');
      setEditing(false);
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
      <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-gray-100">
        <ProductIcon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
        <p className="text-xs text-gray-400">{item.product_code}</p>
      </div>
      {editing ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="number" min="0" step="1"
            className="w-16 text-center text-sm font-bold border border-primary-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-300"
            value={qtyVal}
            onChange={e => setQtyVal(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button onClick={save} disabled={saving} className="p-1 rounded-lg text-green-500 hover:bg-green-50 transition-all">
            {saving ? <Spinner size="xs" /> : <Check size={14} />}
          </button>
          <button onClick={() => setEditing(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-gray-900 dark:text-white">{parseFloat(item.quantity)} шт.</span>
          <button
            onClick={() => { setQtyVal(String(parseFloat(item.quantity))); setEditing(true); }}
            className="p-1 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-all"
          >
            <Pencil size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Pallet Item Row (inline edit) ───────────────────────────────────────────
export function PalletItemRow({ item, palletId, onUpdate }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [editQty, setEditQty] = useState(String(parseFloat(item.quantity)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const newQty = parseFloat(editQty);
    if (isNaN(newQty) || newQty < 0) return;
    setSaving(true);
    try {
      await api.put(`/fbo/pallets/${palletId}/item/${item.product_id}`, { quantity: newQty });
      toast.success(newQty <= 0 ? 'Товар удалён' : 'Количество обновлено');
      setEditing(false);
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setSaving(false); }
  };

  return (
    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center flex-shrink-0 border border-gray-100">
        <ProductIcon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800 truncate">{item.product_name}</p>
        {item.product_code && <p className="text-xs text-gray-400">{item.product_code}</p>}
      </div>
      {editing ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="number" min="0" step="1"
            className="w-16 text-center text-sm font-bold border border-primary-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-300"
            value={editQty}
            onChange={e => setEditQty(e.target.value)}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
          <button onClick={save} disabled={saving} className="p-1 rounded-lg text-green-500 hover:bg-green-50 transition-all">
            {saving ? <Spinner size="xs" /> : <Check size={14} />}
          </button>
          <button onClick={() => setEditing(false)} className="p-1 rounded-lg text-gray-400 hover:bg-gray-100 transition-all">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-bold text-primary-600">{parseFloat(item.quantity)} шт.</span>
          <button
            onClick={() => { setEditQty(String(parseFloat(item.quantity))); setEditing(true); }}
            className="p-1 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-all"
          >
            <Pencil size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Add Product to Shelf Modal ───────────────────────────────────────────────
export function AddProductToShelfModal({ open, onClose, shelfId, onSuccess }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [qtyVal, setQtyVal] = useState('1');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setSearch(''); setSelected(null); setQtyVal('1'); setProducts([]); }
  }, [open]);

  useEffect(() => {
    if (!search.trim() || search.length < 2) { setProducts([]); return; }
    const t = setTimeout(async () => {
      setLoadingSearch(true);
      try {
        const res = await api.get('/products', { params: { search, limit: 10 } });
        setProducts(res.data.items || []);
      } finally { setLoadingSearch(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleSave = async () => {
    if (!selected) return;
    const newQty = parseFloat(qtyVal);
    if (isNaN(newQty) || newQty < 0) return;
    setSaving(true);
    try {
      await api.post(`/warehouse/shelves/${shelfId}/set`, { product_id: selected.id, quantity: newQty });
      toast.success('Товар добавлен на полку');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Добавить товар на полку"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button onClick={handleSave} loading={saving} disabled={!selected}>Сохранить</Button>
      </>}
    >
      <div className="space-y-4">
        {!selected ? (
          <>
            <Input label="Поиск товара" placeholder="Название, артикул, штрих-код..."
              value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            {loadingSearch && <div className="flex justify-center py-2"><Spinner size="sm" /></div>}
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {products.map(p => (
                <button key={p.id} onClick={() => setSelected(p)}
                  className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-primary-50 transition-colors border border-transparent hover:border-primary-100">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{p.name}</p>
                  <p className="text-xs text-gray-400">{p.code || p.article || '—'}</p>
                </button>
              ))}
              {search.length >= 2 && !loadingSearch && products.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-4">Не найдено</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-xl">
              <ProductIcon size={20} className="flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{selected.name}</p>
                <p className="text-xs text-gray-400">{selected.code}</p>
              </div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
            <Input label="Количество" type="number" min="0" step="1"
              value={qtyVal} onChange={e => setQtyVal(e.target.value)} autoFocus />
          </>
        )}
      </div>
    </Modal>
  );
}

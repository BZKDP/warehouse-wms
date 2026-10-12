import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import { ArrowLeft, RefreshCw, Zap, TrendingUp, Clock, Package, ScanLine, Award, CheckCircle2, Play, Pause, Timer, ChevronDown, Check } from 'lucide-react';
import { WorkerAvatar } from '../../components/ui/WarehouseIcons';
import { formatRub, graToRub } from '../../utils/currency';

const POLL_MS = 5000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}с назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
  return `${Math.floor(diff / 3600)}ч назад`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function fmtCompact(n) {
  n = Number(n || 0);
  if (n >= 100000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return fmtNum(n);
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м`;
  return `${Math.floor(seconds)}с`;
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ─── Marketplace helpers (WB / OZON / …) ────────────────────────────────────

// Нормализуем код маркетплейса к верхнему регистру (в БД wb/ozon, в UI WB/OZON).
function mpKey(m) {
  return String(m || '').trim().toUpperCase();
}

// Скорость сборки, сек/заказ — средний промежуток между соседними завершёнными
// заказами. Тот же принцип, что avg_speed_today по сканам (учитываем 0<gap<300,
// чтобы обеды/простои не искажали темп). completedEvents — order_complete события.
function sborkaSpeed(completedEvents) {
  const times = completedEvents
    .map(e => new Date(e.created_at).getTime())
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);
  let sum = 0, n = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / 1000;
    if (gap > 0 && gap < 300) { sum += gap; n++; }
  }
  return n ? Math.round((sum / n) * 10) / 10 : null;
}

function taskTypeLabel(type) {
  if (type === 'bundle_assembly') return 'Сборка компл.';
  if (type === 'packaging') return 'Оприход.';
  if (type === 'production_transfer') return 'Перенос';
  if (type === 'returns') return 'Возвраты';
  return 'Инвент.';
}

function taskTypeBg(type) {
  if (type === 'bundle_assembly') return 'bg-purple-100 text-purple-700';
  if (type === 'packaging') return 'bg-amber-100 text-amber-700';
  if (type === 'production_transfer') return 'bg-sky-100 text-sky-700';
  if (type === 'returns') return 'bg-rose-100 text-rose-700';
  return 'bg-indigo-100 text-indigo-700'; // inventory
}

function taskTypeBarColor(type) {
  if (type === 'bundle_assembly') return 'bg-purple-100 border-purple-300';
  if (type === 'packaging') return 'bg-amber-100 border-amber-300';
  if (type === 'production_transfer') return 'bg-sky-100 border-sky-300';
  if (type === 'returns') return 'bg-rose-100 border-rose-300';
  return 'bg-indigo-100 border-indigo-300'; // inventory
}

function taskTypeActiveBarColor(type) {
  if (type === 'bundle_assembly') return 'bg-purple-200 border-purple-400';
  if (type === 'packaging') return 'bg-amber-200 border-amber-400';
  if (type === 'production_transfer') return 'bg-sky-200 border-sky-400';
  if (type === 'returns') return 'bg-rose-200 border-rose-400';
  return 'bg-indigo-200 border-indigo-400'; // inventory
}

function statusBadge(status) {
  if (status === 'completed') return { bg: 'bg-green-100 text-green-700', label: 'Завершена', icon: CheckCircle2 };
  if (status === 'in_progress') return { bg: 'bg-blue-100 text-blue-700', label: 'В работе', icon: Play };
  if (status === 'paused') return { bg: 'bg-amber-100 text-amber-700', label: 'Пауза', icon: Pause };
  return { bg: 'bg-gray-100 text-gray-600', label: status, icon: Clock };
}

// ─── Activity Timeline ──────────────────────────────────────────────────────

// Merge inventory scan buckets with sborka event buckets into one array of {bucket, scan_count}
function mergeBuckets(activity = [], sborka = []) {
  const map = new Map();
  (activity || []).forEach(b => {
    map.set(b.bucket, { bucket: b.bucket, scan_count: Number(b.scan_count || 0), bucket_start: b.bucket_start, bucket_end: b.bucket_end });
  });
  (sborka || []).forEach(b => {
    const cur = map.get(b.bucket) || { bucket: b.bucket, scan_count: 0 };
    cur.scan_count += Number(b.event_count || 0);
    map.set(b.bucket, cur);
  });
  return [...map.values()].sort((a, b) => a.bucket - b.bucket);
}

function ActivityTimeline({ buckets, tasks, breaks = [], thresholds, sborkaEvents = [] }) {
  const T1 = thresholds?.t1 || 3;
  const T2 = thresholds?.t2 || 6;
  const T3 = thresholds?.t3 || 10;
  const T4 = thresholds?.t4 || 15;
  const T5 = thresholds?.t5 || 22;
  const T6 = thresholds?.t6 || 30;
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(0);
  const [panOffset, setPanOffset] = useState(0);
  const [popupTask, setPopupTask] = useState(null);
  const [expandedBreak, setExpandedBreak] = useState(null);
  const dragRef = useRef(null);
  const barRef = useRef(null);

  // Fixed work day: 07:00–17:00
  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const nowBucket = Math.floor((now - todayStart) / 300000);
  const WORK_START = 84; // 07:00 = 7*60/5
  const WORK_END = 204;  // 17:00 = 17*60/5
  const FULL_RANGE = WORK_END - WORK_START;

  // Zoom: 0=120 buckets (full), 1=60, 2=30, 3=15
  const visibleCount = Math.max(12, Math.floor(FULL_RANGE / Math.pow(2, zoomLevel)));
  const center = Math.min(WORK_END - Math.floor(visibleCount / 2), Math.max(WORK_START + Math.floor(visibleCount / 2), Math.floor((WORK_START + Math.min(nowBucket, WORK_END)) / 2) + panOffset));
  const minBucket = Math.max(WORK_START, center - Math.floor(visibleCount / 2));
  const maxBucket = Math.min(WORK_END, minBucket + visibleCount);
  const totalBuckets = maxBucket - minBucket;

  const canZoomIn = zoomLevel < 3;
  const canZoomOut = zoomLevel > 0;
  const canPanLeft = minBucket > WORK_START;
  const canPanRight = maxBucket < WORK_END;

  // Build break bucket sets per type for coloring
  const breakBuckets = new Set();
  const lunchBuckets = new Set();
  const restBuckets = new Set();
  const techBuckets = new Set();
  for (const br of breaks) {
    const bStart = Math.max(minBucket, Math.floor((new Date(br.started_at) - todayStart) / 300000));
    const bEnd = br.ended_at
      ? Math.min(maxBucket, Math.floor((new Date(br.ended_at) - todayStart) / 300000))
      : Math.min(maxBucket, nowBucket);
    const typeSet = br.break_type === 'lunch' ? lunchBuckets : br.break_type === 'rest' ? restBuckets : techBuckets;
    for (let i = bStart; i <= bEnd; i++) { breakBuckets.add(i); typeSet.add(i); }
  }

  // Build task pause buckets from pause_log
  const taskPauseBuckets = new Set();
  for (const t of tasks) {
    const log = t.pause_log || [];
    for (const p of log) {
      if (!p.paused_at) continue;
      const pStart = Math.max(minBucket, Math.floor((new Date(p.paused_at) - todayStart) / 300000));
      const pEnd = p.resumed_at
        ? Math.min(maxBucket, Math.floor((new Date(p.resumed_at) - todayStart) / 300000))
        : Math.min(maxBucket, nowBucket);
      for (let i = pStart; i <= pEnd; i++) taskPauseBuckets.add(i);
    }
  }

  // Build bucket map for fast lookup
  const bucketMap = {};
  let maxScans = 1;
  for (const b of buckets) {
    const num = parseInt(b.bucket);
    bucketMap[num] = parseInt(b.scan_count);
    if (bucketMap[num] > maxScans) maxScans = bucketMap[num];
  }

  // Map bucket → active task info for richer tooltips and coloring
  const bucketTaskMap = {};
  const bucketTaskType = {};
  for (const t of tasks) {
    if (!t.started_at) continue;
    const tStart = Math.floor((new Date(t.started_at) - todayStart) / 300000);
    const tEnd = t.completed_at ? Math.floor((new Date(t.completed_at) - todayStart) / 300000) : nowBucket;
    for (let i = Math.max(minBucket, tStart); i <= Math.min(maxBucket, tEnd); i++) {
      bucketTaskMap[i] = taskTypeLabel(t.task_type);
      bucketTaskType[i] = t.task_type;
    }
  }

  // Сборка заказов (sborka) — группируем события в сессии по gap 5 мин,
  // заполняем bucketTaskMap чтобы время внутри сессий считалось работой.
  if (sborkaEvents && sborkaEvents.length > 0) {
    const sorted = [...sborkaEvents].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    let sesStart = new Date(sorted[0].created_at);
    let sesEnd = new Date(sorted[0].created_at);
    const flushSession = () => {
      const sB = Math.floor((sesStart - todayStart) / 300000);
      const eB = Math.floor((sesEnd - todayStart) / 300000);
      for (let i = Math.max(minBucket, sB); i <= Math.min(maxBucket, eB); i++) {
        if (!bucketTaskMap[i]) {
          bucketTaskMap[i] = 'Сборка заказов';
          bucketTaskType[i] = 'sborka';
        }
      }
    };
    for (let j = 1; j < sorted.length; j++) {
      const t = new Date(sorted[j].created_at);
      if (t - sesEnd <= 5 * 60 * 1000) {
        sesEnd = t;
      } else {
        flushSession();
        sesStart = t;
        sesEnd = t;
      }
    }
    flushSession();
  }

  // Pre-compute contiguous regions for range tooltips
  const bucketType = (b) => {
    if (breakBuckets.has(b)) return 'break';
    if (taskPauseBuckets.has(b) && !(bucketMap[b] > 0)) return 'pause';
    if (bucketMap[b] > 0) return 'active';
    // Если в бакете идёт активная задача (отбор, сборка, инвентаризация) —
    // это работа, а не простой (сотрудник перемещается между точками).
    if (bucketTaskMap[b]) return 'active';
    return 'idle';
  };
  const regionMap = {};
  for (let i = minBucket; i < maxBucket; i++) {
    if (regionMap[i]) continue;
    const type = bucketType(i);
    let end = i;
    while (end + 1 < maxBucket && bucketType(end + 1) === type) end++;
    for (let j = i; j <= end; j++) regionMap[j] = { start: i, end: end + 1, type };
  }

  if (buckets.length === 0 && tasks.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Активность за день</p>
        <div className="text-center py-6 text-gray-300">
          <Clock size={24} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Нет активности сегодня</p>
        </div>
      </div>
    );
  }

  // Calculate active/idle/break time — only up to current time
  const countUpTo = Math.min(nowBucket, maxBucket);
  let activeBuckets = 0;
  let breakBucketCount = 0;
  let lunchBucketCount = 0;
  let restBucketCount = 0;
  let techBucketCount = 0;
  let taskPauseCount = 0;
  for (let i = minBucket; i < countUpTo; i++) {
    if (breakBuckets.has(i)) {
      breakBucketCount++;
      if (lunchBuckets.has(i)) lunchBucketCount++;
      else if (restBuckets.has(i)) restBucketCount++;
      else techBucketCount++;
    }
    else if (taskPauseBuckets.has(i) && !bucketMap[i]) taskPauseCount++;
    else if (bucketMap[i] || bucketTaskMap[i]) activeBuckets++;
  }
  const elapsedBuckets = Math.max(0, countUpTo - minBucket);
  const activeMinutes = activeBuckets * 5;
  const breakMinutes = breakBucketCount * 5;
  const lunchMinutes = lunchBucketCount * 5;
  const restMinutes = restBucketCount * 5;
  const techMinutes = techBucketCount * 5;
  const taskPauseMinutes = taskPauseCount * 5;
  const idleBuckets = elapsedBuckets - activeBuckets - breakBucketCount - taskPauseCount;
  const idleMinutes = Math.max(0, idleBuckets) * 5;

  // Hour markers
  const startHour = Math.floor(minBucket * 5 / 60);
  const endHour = Math.ceil((maxBucket + 1) * 5 / 60);
  const hourMarkers = [];
  for (let h = startHour; h <= endHour; h++) {
    const hBucket = (h * 60) / 5; // bucket number for this hour
    if (hBucket >= minBucket && hBucket <= maxBucket) {
      const pct = ((hBucket - minBucket) / totalBuckets) * 100;
      hourMarkers.push({ hour: h, pct });
    }
  }

  // Now marker position
  const nowPct = Math.min(100, ((nowBucket - minBucket) / totalBuckets) * 100);

  function bucketToTime(bucketNum) {
    const minutes = bucketNum * 5;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Активность за день</p>
          {/* Zoom controls */}
          <div className="flex items-center gap-0.5 ml-2">
            <button onClick={() => { setZoomLevel(z => Math.min(3, z + 1)); setPanOffset(0); }} disabled={!canZoomIn}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-primary-100 text-gray-500 hover:text-primary-600 flex items-center justify-center text-sm font-bold disabled:opacity-30 transition-colors">+</button>
            <button onClick={() => { setZoomLevel(z => Math.max(0, z - 1)); setPanOffset(0); }} disabled={!canZoomOut}
              className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-sm font-bold disabled:opacity-30 transition-colors">−</button>
            {zoomLevel > 0 && (
              <>
                <button onClick={() => setPanOffset(o => o - Math.floor(visibleCount / 2))} disabled={!canPanLeft}
                  className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-sm disabled:opacity-30 transition-colors">←</button>
                <button onClick={() => setPanOffset(o => o + Math.floor(visibleCount / 2))} disabled={!canPanRight}
                  className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center text-sm disabled:opacity-30 transition-colors">→</button>
                <button onClick={() => { setZoomLevel(0); setPanOffset(0); }}
                  className="px-2 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-[10px] text-gray-500 font-semibold transition-colors">Всё</button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] flex-wrap">
          <span className="text-gray-500">Работа: <b className="text-green-700">{fmtDuration(activeMinutes * 60)}</b></span>
          {lunchMinutes > 0 && (
            <span className="text-gray-500">Обед: <b className="text-pink-600">{fmtDuration(lunchMinutes * 60)}</b></span>
          )}
          {restMinutes > 0 && (
            <span className="text-gray-500">Отдых: <b className="text-blue-600">{fmtDuration(restMinutes * 60)}</b></span>
          )}
          {techMinutes > 0 && (
            <span className="text-gray-500">Тех. пауза: <b className="text-amber-600">{fmtDuration(techMinutes * 60)}</b></span>
          )}
          {taskPauseMinutes > 0 && (
            <span className="text-gray-500">Пауза: <b className="text-rose-400">{fmtDuration(taskPauseMinutes * 60)}</b></span>
          )}
          <span className="text-gray-500">Простой: <b className="text-rose-500">{fmtDuration(idleMinutes * 60)}</b></span>
        </div>
      </div>

      {/* Timeline bar */}
      <div className="relative">
        <div
          ref={barRef}
          className={`flex h-10 rounded-xl overflow-hidden bg-gray-100 border border-gray-200 relative select-none ${zoomLevel > 0 ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onMouseDown={zoomLevel > 0 ? (e) => {
            e.preventDefault();
            dragRef.current = { startX: e.clientX, startOffset: panOffset };
          } : undefined}
          onMouseMove={(e) => {
            if (!dragRef.current || !barRef.current) return;
            const dx = e.clientX - dragRef.current.startX;
            const barW = barRef.current.offsetWidth;
            const bucketsPerPx = totalBuckets / barW;
            setPanOffset(Math.round(dragRef.current.startOffset - dx * bucketsPerPx));
          }}
          onMouseUp={() => { dragRef.current = null; }}
          onMouseLeave={() => { dragRef.current = null; }}>
          {Array.from({ length: totalBuckets }).map((_, i) => {
            const bNum = minBucket + i;
            const scans = bucketMap[bNum] || 0;
            const isHovered = hoveredBucket === bNum;
            const isBreak = breakBuckets.has(bNum);
            // 7 levels: T1/T2/T3/T4/T5/T6/above
            const isTaskPause = taskPauseBuckets.has(bNum);
            // Green intensity scale for activity bars
            const colorClass = isBreak
              ? lunchBuckets.has(bNum) ? (isHovered ? 'bg-pink-400' : 'bg-pink-300')
              : restBuckets.has(bNum) ? (isHovered ? 'bg-blue-400' : 'bg-blue-300')
              : (isHovered ? 'bg-amber-400' : 'bg-amber-300')
              : isTaskPause
              ? (isHovered ? 'bg-rose-300' : 'bg-rose-200')
              : scans <= 0 && !bucketTaskMap[bNum] ? (isHovered ? 'bg-gray-200' : 'bg-gray-100')
              : scans <= T1 ? (isHovered ? 'bg-green-300' : 'bg-green-100')
              : scans <= T2 ? (isHovered ? 'bg-green-400' : 'bg-green-200')
              : scans <= T3 ? (isHovered ? 'bg-green-400' : 'bg-green-300')
              : scans <= T4 ? (isHovered ? 'bg-green-500' : 'bg-green-400')
              : scans <= T5 ? (isHovered ? 'bg-green-600' : 'bg-green-500')
              : scans <= T6 ? (isHovered ? 'bg-green-700' : 'bg-green-600')
              : (isHovered ? 'bg-green-800' : 'bg-green-700');

            return (
              <div
                key={bNum}
                className="relative h-full transition-all duration-75"
                style={{ width: `${100 / totalBuckets}%` }}
                onMouseEnter={() => setHoveredBucket(bNum)}
                onMouseLeave={() => setHoveredBucket(null)}
              >
                <div
                  className={`h-full ${colorClass} transition-colors`}
                />
                {/* Tooltip rendered outside overflow container below */}
              </div>
            );
          })}
          {/* Now marker — only show if in visible range */}
          {nowPct >= 0 && nowPct <= 100 && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10"
              style={{ left: `${nowPct}%` }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-rose-500" />
            </div>
          )}
        </div>

        {/* Floating tooltip — rendered below the timeline bar */}
        {hoveredBucket !== null && (() => {
          const bNum = hoveredBucket;
          const scans = bucketMap[bNum] || 0;
          const isBreak = breakBuckets.has(bNum);
          const isLunch = lunchBuckets.has(bNum);
          const isRest = restBuckets.has(bNum);
          const isTaskPause = taskPauseBuckets.has(bNum) && !(bucketMap[bNum] > 0);
          const leftPct = ((bNum - minBucket + 0.5) / totalBuckets) * 100;
          return (
            <div className="relative" style={{ height: 0 }}>
              <div className="absolute z-30 px-3 py-2 bg-gray-900 text-white rounded-lg text-[10px] whitespace-nowrap shadow-lg pointer-events-none -translate-x-1/2"
                style={{ left: `${leftPct}%`, top: 4 }}>
                <p className="font-bold text-[11px]">{bucketToTime(bNum)} – {bucketToTime(bNum + 1)}</p>
                {isBreak ? (
                  <p className={`mt-0.5 ${isLunch ? 'text-pink-300' : isRest ? 'text-blue-300' : 'text-amber-300'}`}>
                    {isLunch ? '🍽 Обед' : isRest ? '☕ Отдых' : '⏸ Тех. пауза'}
                  </p>
                ) : isTaskPause ? (
                  <p className="text-rose-300 mt-0.5">⏸ Пауза задачи</p>
                ) : scans > 0 ? (
                  <>
                    <p className="text-green-300 mt-0.5">{bucketTaskMap[bNum] || 'Работа'}</p>
                    <p className="mt-0.5">{scans} {scans === 1 ? 'скан' : scans < 5 ? 'скана' : 'сканов'}</p>
                  </>
                ) : bucketTaskMap[bNum] ? (
                  <p className="text-green-300 mt-0.5">{bucketTaskMap[bNum]} (перемещение)</p>
                ) : (
                  <p className="text-gray-400 mt-0.5">Простой</p>
                )}
              </div>
            </div>
          );
        })()}

        {/* Hour labels */}
        <div className="relative h-5 mt-1">
          {hourMarkers.map(({ hour, pct }) => (
            <span
              key={hour}
              className="absolute text-[10px] text-gray-400 font-medium -translate-x-1/2"
              style={{ left: `${pct}%` }}
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>

        {/* Color legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 pt-2 border-t border-gray-100">
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-green-400" />Работа</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-gray-200" />Простой</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-pink-300" />Обед</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-blue-300" />Отдых</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-amber-300" />Тех. пауза</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-3 h-3 rounded-sm bg-rose-200" />Пауза задачи</span>
          <span className="flex items-center gap-1 text-[10px] text-gray-400"><span className="w-1 h-3 rounded-sm bg-rose-500" />Сейчас</span>
        </div>
      </div>

      {/* Task spans — lane layout to avoid overlaps */}
      {tasks.length > 0 && (() => {
        const LANE_H = 22; // px per lane
        const GAP = 2;
        // Build items with positions
        const items = tasks.filter(t => t.started_at).map(t => {
          const rawStart = Math.floor((new Date(t.started_at) - todayStart) / 300000);
          const rawEnd = t.completed_at
            ? Math.floor((new Date(t.completed_at) - todayStart) / 300000)
            : nowBucket;
          const startB = Math.max(minBucket, rawStart);
          const endB = Math.min(maxBucket, rawEnd);
          return { ...t, startB, endB };
        }).filter(t => t.endB > minBucket && t.startB < maxBucket)
          .sort((a, b) => a.startB - b.startB);

        // Assign lanes — greedy: put each task in the first lane where it doesn't overlap
        const lanes = []; // lanes[i] = endB of last task in that lane
        const itemLanes = items.map(item => {
          let lane = lanes.findIndex(laneEnd => item.startB > laneEnd);
          if (lane === -1) { lane = lanes.length; lanes.push(0); }
          lanes[lane] = item.endB;
          return lane;
        });

        const totalLanes = lanes.length || 1;

        return (
          <div className="relative mt-1 mb-1" style={{ height: totalLanes * (LANE_H + GAP) }}>
            {items.map((t, i) => {
              const leftPct = ((t.startB - minBucket) / totalBuckets) * 100;
              const widthPct = Math.max(2, ((t.endB - t.startB + 1) / totalBuckets) * 100);
              const colors = t.status === 'in_progress' ? taskTypeActiveBarColor(t.task_type) : taskTypeBarColor(t.task_type);
              const top = itemLanes[i] * (LANE_H + GAP);
              return (
                <div
                  key={t.id}
                  onClick={() => setPopupTask(popupTask?.id === t.id ? null : t)}
                  className={`absolute ${colors} border rounded-md flex items-center overflow-hidden px-1.5 cursor-pointer hover:opacity-80 transition-opacity`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, top, height: LANE_H }}
                >
                  <span className="text-[8px] font-semibold text-gray-600 truncate">
                    {taskTypeLabel(t.task_type)}
                    {t.completed_at && <span className="text-gray-400 ml-1">{fmtTime(t.started_at)}–{fmtTime(t.completed_at)}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Break bars */}
      {breaks.length > 0 && (
        <div className="mt-1 space-y-1">
          <div className="relative h-6">
            {breaks.map((br, idx) => {
              const bStart = Math.max(minBucket, Math.floor((new Date(br.started_at) - todayStart) / 300000));
              const bEnd = br.ended_at
                ? Math.min(maxBucket, Math.floor((new Date(br.ended_at) - todayStart) / 300000))
                : Math.min(maxBucket, nowBucket);
              if (bEnd <= minBucket || bStart >= maxBucket) return null;
              const leftPct = ((bStart - minBucket) / totalBuckets) * 100;
              const widthPct = Math.max(2, ((bEnd - bStart + 1) / totalBuckets) * 100);
              const isExpanded = expandedBreak === idx;
              return (
                <div key={idx}
                  className={`absolute h-5 rounded-md flex items-center overflow-hidden px-1.5 border cursor-pointer transition-all ${
                    br.break_type === 'lunch' ? 'bg-pink-100 border-pink-300 hover:bg-pink-200' :
                    br.break_type === 'rest' ? 'bg-blue-100 border-blue-300 hover:bg-blue-200' :
                    'bg-amber-100 border-amber-300 hover:bg-amber-200'
                  } ${isExpanded ? 'ring-2 ring-offset-1 ' + (br.break_type === 'lunch' ? 'ring-pink-400' : br.break_type === 'rest' ? 'ring-blue-400' : 'ring-amber-400') : ''}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: 0 }}
                  onClick={() => setExpandedBreak(isExpanded ? null : idx)}
                >
                  <span className={`text-[8px] font-semibold truncate ${
                    br.break_type === 'lunch' ? 'text-pink-600' :
                    br.break_type === 'rest' ? 'text-blue-600' :
                    'text-amber-600'
                  }`}>
                    {br.break_type === 'lunch' ? '🍽 Обед' : br.break_type === 'rest' ? '☕ Отдых' : '⏸ Тех. пауза'}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Expanded break detail */}
          {expandedBreak !== null && breaks[expandedBreak] && (() => {
            const br = breaks[expandedBreak];
            const startTime = fmtTime(br.started_at);
            const endTime = br.ended_at ? fmtTime(br.ended_at) : 'сейчас';
            const durationMs = (br.ended_at ? new Date(br.ended_at) : new Date()) - new Date(br.started_at);
            const durationMin = Math.round(durationMs / 60000);
            const typeLabel = br.break_type === 'lunch' ? '🍽 Обед' : br.break_type === 'rest' ? '☕ Отдых' : '⏸ Тех. пауза';
            const colors = br.break_type === 'lunch' ? 'bg-pink-50 border-pink-200 text-pink-700'
              : br.break_type === 'rest' ? 'bg-blue-50 border-blue-200 text-blue-700'
              : 'bg-amber-50 border-amber-200 text-amber-700';
            return (
              <div className={`rounded-xl border px-4 py-2.5 flex items-center gap-4 ${colors}`}>
                <span className="text-sm font-semibold">{typeLabel}</span>
                <span className="text-xs font-mono">{startTime} → {endTime}</span>
                <span className="text-xs font-bold">{durationMin} мин</span>
                <button onClick={() => setExpandedBreak(null)} className="ml-auto text-xs opacity-50 hover:opacity-100">✕</button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Task popup */}
      {popupTask && (() => {
        const t = popupTask;
        const st = statusBadge(t.status);
        const StIcon = st.icon;
        const durationSec = t.started_at && t.completed_at
          ? (new Date(t.completed_at) - new Date(t.started_at)) / 1000
          : t.started_at ? (Date.now() - new Date(t.started_at)) / 1000 : 0;
        const pauses = t.pause_log || [];
        const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
        const totalPauseSec = pauses.reduce((sum, p) => {
          if (!p.paused_at) return sum;
          const start = Math.max(new Date(p.paused_at).getTime(), todayMidnight.getTime());
          const end = p.resumed_at ? new Date(p.resumed_at).getTime() : Date.now();
          return sum + Math.max(0, end - start) / 1000;
        }, 0);
        const location = [t.rack_name, t.shelf_code || t.shelf_name, t.pallet_name].filter(Boolean).join(' → ');

        return (
          <div className="mt-2 bg-gray-50 rounded-xl border border-gray-200 p-4 animate-[fadeIn_0.2s_ease-out]"
               style={{ animation: 'fadeIn 0.2s ease-out' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${taskTypeBg(t.task_type)}`}>{taskTypeLabel(t.task_type)}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${st.bg}`}><StIcon size={10} /> {st.label}</span>
                </div>
                <p className="text-sm font-semibold text-gray-900">{t.title}</p>
                {location && <p className="text-[11px] text-gray-400">{location}</p>}
              </div>
              <button onClick={() => setPopupTask(null)} className="p-1 rounded-lg text-gray-300 hover:text-gray-500 hover:bg-gray-200 transition-colors">✕</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[9px] text-gray-400 uppercase font-bold">Время</p>
                <p className="font-semibold text-gray-800">{fmtTime(t.started_at)} → {t.completed_at ? fmtTime(t.completed_at) : 'сейчас'}</p>
              </div>
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[9px] text-gray-400 uppercase font-bold">Длит.</p>
                <p className="font-semibold text-gray-800">{fmtDuration(durationSec)}</p>
              </div>
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[9px] text-gray-400 uppercase font-bold">Сканов</p>
                <p className="font-semibold text-gray-800">{fmtNum(t.scan_count)}</p>
              </div>
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[9px] text-gray-400 uppercase font-bold">₽</p>
                <p className="font-semibold text-green-700">{formatRub(t.earned)}</p>
              </div>
            </div>
            {pauses.length > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-[10px] font-bold text-rose-400 mb-1">⏸ Паузы ({pauses.length}) — всего {fmtDuration(totalPauseSec)}</p>
                <div className="flex flex-wrap gap-1">
                  {pauses.map((p, idx) => (
                    <span key={idx} className="text-[10px] bg-rose-50 text-rose-500 rounded px-1.5 py-0.5">
                      {fmtTime(p.paused_at)} → {p.resumed_at ? fmtTime(p.resumed_at) : 'сейчас'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Employee Detail View ───────────────────────────────────────────────────

function EmployeeDetailView({ employeeId, employees, onBack, thresholds, date, isToday = true }) {
  const navigate = useNavigate();
  const [timeline, setTimeline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [breakLoading, setBreakLoading] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState(null);

  const emp = useMemo(() => employees.find(e => e.employee_id === employeeId), [employees, employeeId]);

  const loadTimeline = useCallback(async () => {
    try {
      const dateQ = !isToday && date ? `?date=${date}` : '';
      const res = await api.get(`/tasks/analytics/live/${employeeId}/timeline${dateQ}`);
      setTimeline(res.data);
      setLoading(false);
    } catch { setLoading(false); }
  }, [employeeId]);

  useEffect(() => {
    loadTimeline();
    if (isToday) {
      const id = setInterval(loadTimeline, POLL_MS);
      return () => clearInterval(id);
    }
  }, [loadTimeline, isToday]);

  const [showBreakForm, setShowBreakForm] = useState(false);
  const [breakFrom, setBreakFrom] = useState('');
  const [breakTo, setBreakTo] = useState('');

  const addTechBreak = async () => {
    if (!breakFrom || !breakTo) return;
    setBreakLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.post('/staff/breaks/admin-add', {
        employee_id: employeeId,
        break_type: 'tech',
        started_at: new Date(`${today}T${breakFrom}`).toISOString(),
        ended_at: new Date(`${today}T${breakTo}`).toISOString(),
      });
      setShowBreakForm(false);
      setBreakFrom(''); setBreakTo('');
      await loadTimeline();
    } catch {} finally { setBreakLoading(false); }
  };

  // ─── Фильтр по маркетплейсу для сборки заказов ──────────────────────────────
  // Данные по каждому заказу уже приходят в timeline.sborka_events (с marketplace),
  // поэтому скорость/кол-во по WB и OZON считаем прямо здесь, без запроса на бэкенд.
  const completedSborka = useMemo(
    () => (timeline?.sborka_events || []).filter(e => e.event_type === 'order_complete'),
    [timeline]
  );
  const presentMps = useMemo(() => {
    const s = new Set();
    completedSborka.forEach(e => { const k = mpKey(e.marketplace); if (k) s.add(k); });
    return [...s].sort();
  }, [completedSborka]);
  const [selMps, setSelMps] = useState([]);
  const mpsKey = presentMps.join(',');
  useEffect(() => { setSelMps(presentMps); }, [mpsKey]);
  const toggleMp = (m) => setSelMps(cur => cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m]);
  const hasSborka = presentMps.length > 0;
  const filteredCompleted = useMemo(
    () => completedSborka.filter(e => selMps.includes(mpKey(e.marketplace))),
    [completedSborka, selMps]
  );
  const filteredSpeed = useMemo(() => sborkaSpeed(filteredCompleted), [filteredCompleted]);
  const speedByMp = useMemo(() => {
    const map = {};
    presentMps.forEach(m => { map[m] = sborkaSpeed(completedSborka.filter(e => mpKey(e.marketplace) === m)); });
    return map;
  }, [presentMps, completedSborka]);
  const countByMp = useMemo(() => {
    const map = {};
    presentMps.forEach(m => { map[m] = completedSborka.filter(e => mpKey(e.marketplace) === m).length; });
    return map;
  }, [presentMps, completedSborka]);

  if (!emp) return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <p className="text-sm text-gray-400">Загрузка данных сотрудника...</p>
      </div>
      <div className="flex justify-center py-12"><Spinner size="lg" /></div>
    </div>
  );

  const task = emp.active_task;
  const isLive = task?.status === 'in_progress' && emp.last_scan_at && (Date.now() - new Date(emp.last_scan_at).getTime()) < 120000;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-gray-900">{emp.full_name}</h2>
            {isLive && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            Баланс: {formatRub(emp.balance)} ₽ · Последний скан: {emp.last_scan_at ? timeAgo(emp.last_scan_at) : '—'}
          </p>
        </div>
        {/* Active break indicator + end button */}
        {(() => {
          const activeBr = timeline?.breaks?.find(b => !b.ended_at);
          if (activeBr) {
            const brLabel = activeBr.break_type === 'lunch' ? '🍽 Обед' : activeBr.break_type === 'rest' ? '☕ Перерыв' : '🔧 Тех. проблема';
            return (
              <button onClick={async () => {
                setBreakLoading(true);
                try {
                  await api.post('/staff/breaks/end', { employee_id: employeeId });
                  await loadTimeline();
                } catch {} finally { setBreakLoading(false); }
              }} disabled={breakLoading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200 ring-1 ring-rose-300 transition-all flex-shrink-0">
                {brLabel} — Снять
              </button>
            );
          }
          return (
            <button onClick={() => setShowBreakForm(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 text-gray-500 hover:bg-orange-50 hover:text-orange-600 transition-all flex-shrink-0">
              <Pause size={14} /> Доб. паузу
            </button>
          );
        })()}
      </div>

      {/* Tech break form */}
      {showBreakForm && (
        <div className="mb-4 bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3 flex-wrap" style={{ animation: 'fadeIn 0.15s ease-out' }}>
          <span className="text-xs font-semibold text-orange-700">Добавить паузу:</span>
          <div className="flex items-center gap-1.5">
            <input type="time" value={breakFrom} onChange={e => setBreakFrom(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-orange-200 text-xs bg-white w-24 focus:outline-none focus:ring-1 focus:ring-orange-400" />
            <span className="text-gray-400 text-xs">→</span>
            <input type="time" value={breakTo} onChange={e => setBreakTo(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-orange-200 text-xs bg-white w-24 focus:outline-none focus:ring-1 focus:ring-orange-400" />
          </div>
          <button onClick={addTechBreak} disabled={breakLoading || !breakFrom || !breakTo}
            className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-semibold hover:bg-orange-600 disabled:opacity-40 transition-colors">
            Добавить
          </button>
          <button onClick={() => setShowBreakForm(false)} className="text-xs text-gray-400 hover:text-gray-600">Отмена</button>
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {[
          { icon: ScanLine, label: 'Сканов', value: fmtNum(emp.scans_today), bg: 'bg-gray-50', color: 'text-gray-800' },
          { icon: Package, label: 'Заказов сборки', value: fmtNum(hasSborka ? filteredCompleted.length : (emp.sborka_orders_today || 0)), bg: 'bg-purple-50', color: 'text-purple-700' },
          { icon: Award, label: 'Заработок', value: `${formatRub(emp.earned_today)} ₽`, bg: 'bg-green-50', color: 'text-green-700' },
          { icon: Zap, label: hasSborka ? 'Скорость сборки' : 'Скорость',
            value: hasSborka
              ? (filteredSpeed != null ? `${filteredSpeed}с` : '—')
              : (emp.avg_speed_today ? `${emp.avg_speed_today}с` : '—'),
            bg: 'bg-blue-50', color: 'text-blue-700' },
          { icon: TrendingUp, label: 'Задач', value: emp.tasks_today, bg: 'bg-amber-50', color: 'text-amber-700' },
        ].map((s, i) => (
          <div key={i} className={`${s.bg} rounded-2xl p-3 text-center`}>
            <s.icon size={16} className={`mx-auto mb-1 ${s.color} opacity-50`} />
            <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-[9px] uppercase font-semibold text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Фильтр по маркетплейсу — влияет на «Скорость сборки», счётчик заказов и список сессий ниже */}
      {hasSborka && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mr-0.5">Маркетплейс</span>
          {presentMps.map(m => {
            const on = selMps.includes(m);
            const sp = speedByMp[m];
            return (
              <button key={m} onClick={() => toggleMp(m)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  on ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'
                }`}>
                <span className={`w-3.5 h-3.5 rounded-[4px] flex items-center justify-center border ${
                  on ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'
                }`}>
                  {on && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>
                {m}
                <span className="font-normal text-gray-400">· {fmtNum(countByMp[m])}</span>
                <span className={`font-bold ${on ? 'text-blue-600' : 'text-gray-400'}`}>{sp != null ? `${sp}с` : '—'}</span>
              </button>
            );
          })}
          {presentMps.length > 1 && selMps.length !== presentMps.length && (
            <button onClick={() => setSelMps(presentMps)}
              className="text-[11px] text-gray-400 hover:text-gray-600 underline underline-offset-2 ml-1">все</button>
          )}
        </div>
      )}

      {/* Activity Timeline */}
      {loading ? (
        <div className="flex justify-center py-10"><Spinner size="lg" /></div>
      ) : timeline ? (
        <>
          <ActivityTimeline buckets={mergeBuckets(timeline.activity_buckets, timeline.sborka_buckets)} tasks={timeline.tasks} breaks={timeline.breaks} thresholds={thresholds} sborkaEvents={timeline.sborka_events} />

          {/* Tasks list */}
          <div className="mt-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Задачи сегодня ({timeline.tasks.length})
            </p>
            {timeline.tasks.length === 0 ? (
              <div className="text-center py-8 text-gray-300 bg-white rounded-2xl border border-gray-100">
                <Package size={24} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Нет задач сегодня</p>
              </div>
            ) : (
              <div className="space-y-2">
                {timeline.tasks.map(t => {
                  const st = statusBadge(t.status);
                  const StIcon = st.icon;
                  const durationSec = t.started_at && t.completed_at
                    ? (new Date(t.completed_at) - new Date(t.started_at)) / 1000
                    : t.started_at ? (Date.now() - new Date(t.started_at)) / 1000 : 0;
                  const location = [t.rack_name, t.shelf_code || t.shelf_name, t.pallet_name].filter(Boolean).join(' → ');

                  const isExpanded = expandedTaskId === t.id;
                  const pauses = t.pause_log || [];
                  const todayMid = new Date(); todayMid.setHours(0,0,0,0);
                  const totalPause = pauses.reduce((s, p) => {
                    if (!p.paused_at) return s;
                    const start = Math.max(new Date(p.paused_at).getTime(), todayMid.getTime());
                    const end = p.resumed_at ? new Date(p.resumed_at).getTime() : Date.now();
                    return s + Math.max(0, end - start) / 1000;
                  }, 0);

                  return (
                    <div key={t.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                      {/* Header — clickable to expand */}
                      <button
                        onClick={() => setExpandedTaskId(isExpanded ? null : t.id)}
                        className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${taskTypeBg(t.task_type)}`}>
                              {taskTypeLabel(t.task_type)}
                            </span>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${st.bg}`}>
                              <StIcon size={10} /> {st.label}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                          {location && <p className="text-[11px] text-gray-400">{location}</p>}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs text-gray-500">{fmtTime(t.started_at)} → {t.completed_at ? fmtTime(t.completed_at) : '...'}</p>
                          <p className="text-xs font-bold text-green-600">+{formatRub(t.earned)} ₽</p>
                        </div>
                        <ChevronDown size={16} className={`text-gray-300 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-3.5 pb-3.5 border-t border-gray-50" style={{ animation: 'fadeIn 0.15s ease-out' }}>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-gray-400 uppercase font-bold">Длит.</p>
                              <p className="text-xs font-semibold text-gray-700">{fmtDuration(durationSec)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-gray-400 uppercase font-bold">Сканов</p>
                              <p className="text-xs font-semibold text-gray-700">{fmtNum(t.scan_count)}</p>
                            </div>
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-gray-400 uppercase font-bold">Ср. скорость</p>
                              <p className="text-xs font-semibold text-gray-700">{t.avg_scan_time ? `${t.avg_scan_time} с` : '—'}</p>
                            </div>
                            <div className="bg-green-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-green-500 uppercase font-bold">Заработок</p>
                              <p className="text-xs font-black text-green-700">+{formatRub(t.earned)} ₽</p>
                            </div>
                          </div>
                          {parseInt(t.boxes_total) > 0 && (
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                                <span>Коробки</span>
                                <span>{t.boxes_done}/{t.boxes_total}</span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-400 rounded-full transition-all"
                                  style={{ width: `${Math.round((parseInt(t.boxes_done) / parseInt(t.boxes_total)) * 100)}%` }} />
                              </div>
                            </div>
                          )}
                          {pauses.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                              <p className="text-[10px] font-bold text-rose-400 mb-1">⏸ Паузы ({pauses.length}) — {fmtDuration(totalPause)}</p>
                              <div className="flex flex-wrap gap-1">
                                {pauses.map((p, idx) => (
                                  <span key={idx} className="text-[10px] bg-rose-50 text-rose-500 rounded px-1.5 py-0.5">
                                    {fmtTime(p.paused_at)} → {p.resumed_at ? fmtTime(p.resumed_at) : 'сейчас'}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <button onClick={() => navigate(`/admin/tasks?id=${t.id}`)}
                            className="mt-2 text-[11px] text-primary-500 hover:text-primary-700 font-medium">
                            Открыть задачу →
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sborka orders — live events from sborka site */}
          <SborkaOrdersSection events={timeline.sborka_events || []} allowedMps={hasSborka ? selMps : null} />
        </>
      ) : null}
    </div>
  );
}

// ─── Sborka orders section (grouped into sessions by 5-min gap) ─────────────
function groupIntoSessions(completedOrders, gapMs = 5 * 60 * 1000) {
  if (!completedOrders.length) return [];
  const sorted = [...completedOrders].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const sessions = [];
  let cur = { orders: [sorted[0]], start: new Date(sorted[0].created_at), end: new Date(sorted[0].created_at) };
  for (let i = 1; i < sorted.length; i++) {
    const t = new Date(sorted[i].created_at);
    if (t - cur.end <= gapMs) {
      cur.orders.push(sorted[i]);
      cur.end = t;
    } else {
      sessions.push(cur);
      cur = { orders: [sorted[i]], start: t, end: t };
    }
  }
  sessions.push(cur);
  return sessions;
}

function SborkaOrdersSection({ events, allowedMps = null }) {
  const completed = events
    .filter(e => e.event_type === 'order_complete')
    .filter(e => allowedMps === null || allowedMps.includes(mpKey(e.marketplace)));
  if (completed.length === 0) return null;

  const startsByOrder = {};
  events.filter(e => e.event_type === 'order_start').forEach(e => {
    if (e.order_id) startsByOrder[e.order_id] = e;
  });

  const sessions = groupIntoSessions(completed);
  const [expandedSession, setExpandedSession] = useState(null);

  return (
    <div className="mt-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Сборка заказов — {sessions.length} {sessions.length === 1 ? 'сессия' : 'сессий'} · {completed.length} заказов
      </p>
      <div className="space-y-2">
        {sessions.map((s, i) => {
          const isOpen = expandedSession === i;
          const dur = (s.end - s.start) / 1000;
          const mps = {};
          s.orders.forEach(o => { const mp = (o.marketplace || '—').toUpperCase(); mps[mp] = (mps[mp] || 0) + 1; });
          return (
            <div key={i} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button
                onClick={() => setExpandedSession(isOpen ? null : i)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 flex-shrink-0">
                  Сборка
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {s.orders.length} заказов
                    <span className="text-gray-400 text-xs ml-1.5">
                      {Object.entries(mps).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                    </span>
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500">
                    {fmtTime(s.start.toISOString())} → {fmtTime(s.end.toISOString())}
                  </p>
                  {dur > 0 && <p className="text-[10px] text-gray-400">{fmtDuration(dur)}</p>}
                </div>
                <ChevronDown size={14} className={`text-gray-300 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-3 pb-3 border-t border-gray-50 max-h-[300px] overflow-y-auto space-y-1 pt-2">
                  {s.orders.map(o => {
                    const start = startsByOrder[o.order_id];
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-2.5 py-1.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">{o.order_id || '—'}</p>
                          {start?.product_name && <p className="text-[10px] text-gray-400 truncate">{start.product_name}</p>}
                        </div>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {(o.marketplace || '').toUpperCase()} · {new Date(o.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Employee Card ──────────────────────────────────────────────────────────

const BREAK_LABELS = { lunch: 'Обед', rest: 'Перекур', tech: 'Тех. пауза' };
const BREAK_COLORS = { lunch: 'bg-rose-100 text-rose-700', rest: 'bg-sky-100 text-sky-700', tech: 'bg-amber-100 text-amber-700' };

function EmployeeCard({ emp, onClick }) {
  const task = emp.active_task;
  const brk = emp.active_break;
  const isActive = task && task.status === 'in_progress';
  const lastScanRecent = emp.last_scan_at && (Date.now() - new Date(emp.last_scan_at).getTime()) < 120000;
  const lastSborkaRecent = emp.last_sborka_at && (Date.now() - new Date(emp.last_sborka_at).getTime()) < 120000;
  const isAnythingLive = (isActive && lastScanRecent) || lastSborkaRecent;
  const onBreak = !!brk;

  const statusDot = onBreak
    ? <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" /><span className="text-[10px] font-bold text-sky-600">{BREAK_LABELS[brk.break_type] || 'Пауза'}</span></span>
    : isAnythingLive
      ? <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /><span className="text-[10px] font-bold text-green-600">LIVE</span></span>
      : isActive
        ? <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
        : <span className="w-2 h-2 rounded-full bg-gray-200 inline-block" />;

  return (
    <button onClick={onClick} className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md hover:border-primary-200 transition-all p-3.5 flex flex-col">
      {/* Name + status */}
      <div className="flex items-start gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
          <WorkerAvatar size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-bold text-gray-900 leading-snug truncate">{emp.full_name}</h3>
          {emp.position && <p className="text-[9px] text-gray-400 truncate">{emp.position}</p>}
        </div>
        <div className="flex-shrink-0 mt-0.5">{statusDot}</div>
      </div>

      {/* Task zone — fixed height */}
      <div className="h-[56px] mb-2">
        {task ? (
          <div className="px-2 py-1.5 bg-primary-50 rounded-lg border border-primary-100 h-full overflow-hidden">
            <p className="text-[11px] font-semibold text-primary-700 truncate leading-tight">{task.title}</p>
            <div className="flex items-center gap-1 mt-1 text-[9px] text-primary-500 flex-wrap leading-tight">
              <span className="bg-primary-100 rounded px-1 py-px font-bold">{taskTypeLabel(task.type)}</span>
              {task.scans > 0 && <span>· {fmtCompact(task.scans)}</span>}
              {task.boxes_total > 0 && <span>· {task.boxes_done}/{task.boxes_total}</span>}
              {task.type === 'bundle_assembly' && <span>· {task.assembled}/{task.bundle_qty}</span>}
            </div>
          </div>
        ) : Number(emp.sborka_orders_today) > 0 ? (
          <div className="px-2 py-1.5 bg-fuchsia-50 rounded-lg border border-fuchsia-100 h-full overflow-hidden">
            <p className="text-[11px] font-semibold text-fuchsia-700 truncate leading-tight">Сборка заказов</p>
            <div className="flex items-center gap-1 mt-1 text-[9px] text-fuchsia-500 flex-wrap leading-tight">
              <span className="bg-fuchsia-100 rounded px-1 py-px font-bold">Сборка</span>
              <span>· {emp.sborka_orders_today} заказов</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full bg-gray-50 rounded-lg border border-dashed border-gray-200">
            <p className="text-[11px] text-gray-300 italic">Нет активной задачи</p>
          </div>
        )}
      </div>

      {/* Stats — compact */}
      <div className="grid grid-cols-4 gap-1 mt-auto">
        <div className="bg-gray-50 rounded-lg py-1.5 text-center overflow-hidden">
          <p className="text-[7px] text-gray-400 uppercase font-bold">Сканов</p>
          <p className="text-xs font-black text-gray-800 leading-tight mt-px truncate px-0.5">{fmtCompact(emp.scans_today)}</p>
        </div>
        <div className="bg-purple-50 rounded-lg py-1.5 text-center overflow-hidden">
          <p className="text-[7px] text-purple-500 uppercase font-bold">Заказов</p>
          <p className="text-xs font-black text-purple-700 leading-tight mt-px truncate px-0.5">{fmtCompact(emp.sborka_orders_today || 0)}</p>
        </div>
        <div className="bg-green-50 rounded-lg py-1.5 text-center overflow-hidden">
          <p className="text-[7px] text-green-500 uppercase font-bold">₽</p>
          <p className="text-xs font-black text-green-700 leading-tight mt-px truncate px-0.5">{fmtCompact(graToRub(emp.earned_today))}</p>
        </div>
        <div className="bg-blue-50 rounded-lg py-1.5 text-center overflow-hidden">
          <p className="text-[7px] text-blue-500 uppercase font-bold">Скорость</p>
          <p className="text-xs font-black text-blue-700 leading-tight mt-px truncate px-0.5">{emp.avg_speed_today ? `${emp.avg_speed_today}с` : '—'}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-gray-50 text-[9px] text-gray-400">
        <span>{emp.tasks_today} задач</span>
        <span>
          {(() => {
            const lastScan = emp.last_scan_at ? new Date(emp.last_scan_at).getTime() : 0;
            const lastSborka = emp.last_sborka_at ? new Date(emp.last_sborka_at).getTime() : 0;
            const latest = Math.max(lastScan, lastSborka);
            return latest ? timeAgo(new Date(latest).toISOString()) : '—';
          })()}
        </span>
      </div>
    </button>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function LiveMonitorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const selectedId = searchParams.get('emp') ? parseInt(searchParams.get('emp')) : null;
  const setSelectedId = (id) => {
    const p = {};
    if (id) p.emp = id;
    if (selectedDate !== todayStr) p.date = selectedDate;
    setSearchParams(p);
  };
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || todayStr);
  const isToday = selectedDate === todayStr;
  const [lastUpdate, setLastUpdate] = useState(null);
  const [thresholds, setThresholds] = useState({ t1:3, t2:6, t3:10, t4:15, t5:22, t6:30 });

  // Load settings once
  useEffect(() => {
    api.get('/settings').then(r => {
      const s = r.data;
      setThresholds({
        t1: Number(s.live_scan_t1) || 3,
        t2: Number(s.live_scan_t2) || 6,
        t3: Number(s.live_scan_t3) || 10,
        t4: Number(s.live_scan_t4) || 15,
        t5: Number(s.live_scan_t5) || 22,
        t6: Number(s.live_scan_t6) || 30,
      });
    }).catch(() => {});
  }, []);

  const loadGrid = useCallback(async (attempt = 1) => {
    try {
      const res = await api.get(`/tasks/analytics/live${!isToday ? `?date=${selectedDate}` : ''}`);
      setEmployees(res.data.employees || []);
      setLastUpdate(new Date());
    } catch {
      if (attempt < 3) { setTimeout(() => loadGrid(attempt + 1), 1000 * attempt); return; }
    } finally { setLoading(false); }
  }, [selectedDate, isToday]);

  useEffect(() => {
    setLoading(true);
    loadGrid();
    if (isToday) {
      const id = setInterval(loadGrid, POLL_MS);
      return () => clearInterval(id);
    }
  }, [loadGrid]);

  // Detail view
  if (selectedId) {
    return (
      <EmployeeDetailView
        employeeId={selectedId}
        employees={employees}
        onBack={() => setSelectedId(null)}
        thresholds={thresholds}
        date={selectedDate}
        isToday={isToday}
      />
    );
  }

  // Sort: active+live first, then active, then by scans
  const sorted = [...employees].sort((a, b) => {
    const aActive = a.active_task?.status === 'in_progress' ? 1 : 0;
    const bActive = b.active_task?.status === 'in_progress' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    const aRecent = a.last_scan_at && (Date.now() - new Date(a.last_scan_at).getTime()) < 120000 ? 1 : 0;
    const bRecent = b.last_scan_at && (Date.now() - new Date(b.last_scan_at).getTime()) < 120000 ? 1 : 0;
    if (aRecent !== bRecent) return bRecent - aRecent;
    return (b.scans_today || 0) - (a.scans_today || 0);
  });

  const activeCount = employees.filter(e => e.active_task?.status === 'in_progress').length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/admin/tasks')} className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              Мониторинг
              {isToday && (
                <span className="flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> LIVE
                </span>
              )}
            </h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {isToday ? `${activeCount} работают · ` : ''}{employees.length} сотрудников · {employees.reduce((s, e) => s + Number(e.scans_today || 0), 0).toLocaleString('ru-RU')} сканов
              {isToday && lastUpdate && <span className="ml-1">· {lastUpdate.toLocaleTimeString('ru-RU')}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            max={todayStr}
            onChange={e => { setSelectedDate(e.target.value); setSearchParams(e.target.value !== todayStr ? { date: e.target.value } : {}); }}
            className="px-3 py-1.5 rounded-xl border border-gray-200 text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          {!isToday && (
            <button onClick={() => { setSelectedDate(todayStr); setSearchParams({}); }}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-green-50 text-green-600 hover:bg-green-100 transition-colors">
              Сегодня
            </button>
          )}
          <button onClick={loadGrid} className="p-2 rounded-xl text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {employees.length === 0 && !loading && (
        <div className="text-center py-20 text-gray-300">
          <ScanLine size={48} className="mx-auto mb-3 opacity-40" />
          <p className="text-lg font-semibold">Нет активных сотрудников</p>
          <p className="text-sm mt-1">Сотрудники появятся здесь как только начнут работать</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {sorted.map(emp => (
          <EmployeeCard key={emp.employee_id} emp={emp} onClick={() => setSelectedId(emp.employee_id)} />
        ))}
      </div>
    </div>
  );
}

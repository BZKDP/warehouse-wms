import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { ChevronDown, X } from 'lucide-react';

export default function SearchSelect({ label, value, onChange, options, placeholder = 'Поиск...', emptyText = 'Ничего не найдено', columns = 1, loading = false }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState(null); // {left, top, width, maxHeight, up}
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find(o => String(o.value) === String(value) && o.value !== '');

  const filtered = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  useEffect(() => {
    const handler = (e) => {
      const insideTrigger = wrapRef.current?.contains(e.target);
      const insideList = listRef.current?.contains(e.target);
      if (!insideTrigger && !insideList) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  // Дропдаун рендерится в portal с fixed-позицией — иначе его режет
  // скроллящееся тело модалки. Пересчитываем при скролле и ресайзе.
  const measure = useCallback(() => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gap = 4;
    const below = window.innerHeight - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const up = below < 200 && above > below;
    setPos({
      left: rect.left,
      width: rect.width,
      top: up ? undefined : rect.bottom + gap,
      bottom: up ? window.innerHeight - rect.top + gap : undefined,
      maxHeight: Math.max(160, Math.min(320, up ? above : below)),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    const onChangeView = () => measure();
    window.addEventListener('scroll', onChangeView, true);
    window.addEventListener('resize', onChangeView);
    return () => {
      window.removeEventListener('scroll', onChangeView, true);
      window.removeEventListener('resize', onChangeView);
    };
  }, [open, measure]);

  // Сброс курсора при поиске/открытии + подскролл к активному пункту
  useEffect(() => { setCursor(0); }, [search, open]);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${cursor}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const handleSelect = useCallback((opt) => {
    if (opt.disabled) return;
    onChange(String(opt.value));
    setOpen(false);
    setSearch('');
  }, [onChange]);

  const handleClear = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    onChange('');
    setSearch('');
    setOpen(false);
  }, [onChange]);

  const toggleOpen = useCallback(() => {
    if (loading) return;
    setOpen(v => {
      if (!v) setTimeout(() => inputRef.current?.focus(), 10);
      return !v;
    });
  }, [loading]); // без loading в зависимостях колбэк навсегда запоминал loading=true и список не открывался

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setCursor(c => (c + step + filtered.length) % filtered.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[cursor];
      if (opt) handleSelect(opt);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
  }, [filtered, cursor, handleSelect]);

  return (
    <div className="flex flex-col gap-1.5" ref={wrapRef}>
      {label && <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      <div className="relative">
        {/* Trigger button — always visible */}
        <div
          className={cn(
            'w-full rounded-xl border bg-white px-3 py-2 text-sm flex items-center gap-2 transition-all',
            'dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100',
            loading ? 'cursor-wait opacity-60' : 'cursor-pointer',
            open ? 'border-primary-400 ring-2 ring-primary-100' : 'border-gray-200 hover:border-primary-300'
          )}
          onClick={toggleOpen}
        >
          {open ? (
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
              onKeyDown={handleKeyDown}
              placeholder={selected ? selected.label : placeholder}
              className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-gray-100 min-w-0"
              autoComplete="off"
            />
          ) : (
            <span className={cn('flex-1 truncate', selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400')}>
              {loading ? 'Загрузка...' : selected ? selected.label : placeholder}
            </span>
          )}
          {loading ? (
            <span className="w-3.5 h-3.5 flex-shrink-0 rounded-full border-2 border-gray-300 border-t-primary-500 animate-spin" />
          ) : selected && !open ? (
            <button type="button" onPointerDown={handleClear} className="text-gray-300 hover:text-rose-400 flex-shrink-0 p-0.5">
              <X size={14} />
            </button>
          ) : (
            <ChevronDown size={14} className={cn('text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-180')} />
          )}
        </div>

        {/* Dropdown — в портале, чтобы не обрезался модалкой */}
        {open && pos && createPortal(
          <div
            ref={listRef}
            style={{
              position: 'fixed',
              left: pos.left,
              width: pos.width,
              top: pos.top,
              bottom: pos.bottom,
              maxHeight: pos.maxHeight,
            }}
            className={cn(
              'z-[200] glass-dropdown rounded-xl shadow-xl overflow-y-auto dark:bg-gray-800 dark:border-gray-700',
              columns > 1 && 'grid gap-0.5 p-1 content-start',
              columns === 2 && 'grid-cols-1 sm:grid-cols-2',
              columns >= 3 && 'grid-cols-1 sm:grid-cols-3'
            )}
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-gray-400">{emptyText}</div>
            ) : (
              filtered.map((opt, idx) => (
                <div
                  key={opt.value}
                  data-idx={idx}
                  onPointerDown={(e) => { e.preventDefault(); handleSelect(opt); }}
                  onMouseEnter={() => setCursor(idx)}
                  className={cn(
                    'w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer',
                    columns > 1 && 'rounded-lg',
                    opt.disabled
                      ? 'opacity-40 cursor-not-allowed bg-gray-50 dark:bg-gray-900'
                      : String(opt.value) === String(value)
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : idx === cursor
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                      : 'text-gray-900 dark:text-gray-100'
                  )}
                >
                  <span className="truncate block">{opt.label}</span>
                  {opt.hint && <span className="text-xs text-gray-400 block truncate">{opt.hint}</span>}
                </div>
              ))
            )}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}

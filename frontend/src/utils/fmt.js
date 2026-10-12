/** Форматирует количество: убирает лишние нули (16.000 → 16, 1.5 → 1.5) */
export function qty(v) {
  const n = Number(v);
  if (isNaN(n)) return v ?? '';
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}

/** Форматирует количество с разделителями: 1234 → 1 234 */
export function fmtQty(val) {
  return Number(val || 0).toLocaleString('ru-RU');
}

/** Дата + время: 27.03.26, 14:30 */
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Дата + время + секунды: 27.03.2026, 14:30:15 */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU');
}

/** Только время: 14:30:15 */
export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Длительность из секунд: 125 → "2м 5с" */
export function fmtDuration(seconds) {
  if (!seconds) return '—';
  const s = Math.round(Number(seconds));
  const m = Math.floor(s / 60);
  const remainder = s % 60;
  if (m === 0) return `${remainder}с`;
  return `${m}м ${remainder}с`;
}

/** "5д назад", "3ч назад", "только что" */
export function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}д назад`;
  if (hours > 0) return `${hours}ч назад`;
  return 'только что';
}

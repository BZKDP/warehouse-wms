/**
 * Глобальный audio-сервис для звуков сканирования.
 * Используется на всех страницах вместо copy-paste playBeep().
 */

// Таймаут авто-отправки сканера (единый на весь проект)
export const SCAN_AUTO_SUBMIT_MS = 350;

// Дефолтные частоты/длительности
const DEFAULTS = {
  scan_sound_enabled: true,
  scan_sound_freq_ok: 880,
  scan_sound_freq_err: 300,
  scan_sound_dur_ok: 150,
  scan_sound_dur_err: 500,
};

/**
 * Простой beep без настроек (для страниц без AppSettingsContext).
 * Двойной бип при ошибке.
 */
export function playBeep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 440;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.15 : 0.4));
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + (ok ? 0.15 : 0.4));
    if (!ok) {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2); gain2.connect(ctx.destination);
      osc2.frequency.value = 330; osc2.type = 'sine';
      gain2.gain.setValueAtTime(0, ctx.currentTime + 0.25);
      gain2.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.27);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.65);
      osc2.start(ctx.currentTime + 0.25);
      osc2.stop(ctx.currentTime + 0.65);
    }
  } catch {}
}

/**
 * Фабрика beep с настройками из AppSettingsContext.
 * Используется в PackagingPage и других страницах с useAppSettings().
 */
export function makePlayBeep(s) {
  const cfg = { ...DEFAULTS, ...s };
  return function beep(ok = true) {
    if (!cfg.scan_sound_enabled) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = ok ? cfg.scan_sound_freq_ok : cfg.scan_sound_freq_err;
      osc.type = 'sine';
      const dur = (ok ? cfg.scan_sound_dur_ok : cfg.scan_sound_dur_err) / 1000;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur);
      if (!ok) {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2); gain2.connect(ctx.destination);
        osc2.frequency.value = Math.max(200, cfg.scan_sound_freq_err - 110);
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0, ctx.currentTime + dur + 0.05);
        gain2.gain.linearRampToValueAtTime(0.3, ctx.currentTime + dur + 0.07);
        gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur + 0.05 + dur);
        osc2.start(ctx.currentTime + dur + 0.05);
        osc2.stop(ctx.currentTime + dur + 0.05 + dur);
      }
    } catch {}
  };
}

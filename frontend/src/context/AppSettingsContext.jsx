import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api/client';

// ─── Дефолтные значения всех настроек ──────────────────────────────────────
export const SETTINGS_DEFAULTS = {
  // Скорость сканирования (цветовая индикация)
  scan_fast_threshold: 3,      // сек — до этого: зелёный
  scan_slow_threshold: 6,      // сек — выше этого: красный, между: жёлтый

  // Звук при сканировании
  scan_sound_enabled: true,
  scan_sound_freq_ok: 880,     // Гц — тон успешного скана
  scan_sound_freq_err: 300,    // Гц — тон ошибки
  scan_sound_dur_ok: 150,      // мс — длительность успеха
  scan_sound_dur_err: 500,     // мс — длительность ошибки

  // Авто-отправка при сканировании
  scan_auto_delay: 350,        // мс — задержка после последнего символа
  scan_min_length: 4,          // символов — минимальная длина для авто-отправки

  // Упаковка
  default_box_size: 50,        // шт. в коробке по умолчанию

  // Таблица товаров
  products_page_size: 50,      // строк на странице
  products_row_density: 'normal', // compact | normal | large

  // Уведомления (toast)
  toast_duration_success: 3,   // сек
  toast_duration_error: 5,     // сек

  // Инвентаризация — пороги свежести (часы)
  inventory_fresh_hours: 24,     // до этого — зелёный «Свежий»
  inventory_stale_hours: 72,     // после этого — красный «Устарел», между — жёлтый «Давно»

  // Инвентаризация — цвета
  inventory_color_fresh: '#047857',   // зелёный
  inventory_color_warn: '#a16207',    // жёлтый
  inventory_color_stale: '#b91c1c',   // красный
  inventory_color_none: '#b91c1c',    // не было
};

const AppSettingsContext = createContext(null);

function parseValue(raw, defaultVal) {
  if (raw === undefined || raw === null || raw === '') return defaultVal;
  if (typeof defaultVal === 'boolean') return raw === 'true' || raw === true;
  if (typeof defaultVal === 'number') {
    const n = parseFloat(raw);
    return isNaN(n) ? defaultVal : n;
  }
  return raw;
}

function parseSettings(rawObj) {
  const result = {};
  for (const [k, def] of Object.entries(SETTINGS_DEFAULTS)) {
    result[k] = parseValue(rawObj[k], def);
  }
  return result;
}

export function AppSettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    // Быстрая инициализация из localStorage
    try {
      const stored = localStorage.getItem('wms_app_settings');
      if (stored) return parseSettings(JSON.parse(stored));
    } catch {}
    return { ...SETTINGS_DEFAULTS };
  });

  // Загрузить настройки из API
  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get('/settings');
      const parsed = parseSettings(res.data);
      setSettings(parsed);
      localStorage.setItem('wms_app_settings', JSON.stringify(res.data));
    } catch {}
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  // Обновить одну настройку (оптимистично + API)
  const updateSetting = useCallback(async (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      // Обновить localStorage
      const raw = {};
      for (const [k, v] of Object.entries(next)) raw[k] = String(v);
      localStorage.setItem('wms_app_settings', JSON.stringify(raw));
      return next;
    });
    try {
      await api.put('/settings', { [key]: String(value) });
    } catch {}
  }, []);

  // Обновить несколько настроек сразу
  const updateSettings = useCallback(async (updates) => {
    setSettings(prev => {
      const next = { ...prev, ...updates };
      const raw = {};
      for (const [k, v] of Object.entries(next)) raw[k] = String(v);
      localStorage.setItem('wms_app_settings', JSON.stringify(raw));
      return next;
    });
    try {
      const body = {};
      for (const [k, v] of Object.entries(updates)) body[k] = String(v);
      await api.put('/settings', body);
    } catch {}
  }, []);

  const value = useMemo(() => ({ settings, updateSetting, updateSettings, loadSettings }),
    [settings, updateSetting, updateSettings, loadSettings]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext);
  // Безопасный фолбэк если вызван вне провайдера
  if (!ctx) return {
    settings: { ...SETTINGS_DEFAULTS },
    updateSetting: () => {},
    updateSettings: () => {},
    loadSettings: () => {},
  };
  return ctx;
}

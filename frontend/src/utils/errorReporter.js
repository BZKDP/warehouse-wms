/**
 * errorReporter — глобальная отправка ошибок на бэкенд в system_errors_c
 * Все ошибки с max инфой: тип, стек, URL, пользователь, браузер, данные запроса.
 */

let _reporting = false; // защита от рекурсии

export async function reportError(payload) {
  if (_reporting) return;
  _reporting = true;
  try {
    const token = localStorage.getItem('auth_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    // Добавляем общий контекст
    const full = {
      ...payload,
      browser_info: navigator.userAgent,
      page_url: window.location.href,
    };

    const basePath = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_BASE_PATH)
      ? `/${import.meta.env.VITE_APP_BASE_PATH.replace(/^\/+|\/+$/g, '')}`
      : '';
    await fetch(`${basePath}/api/errors/system`, {
      method: 'POST',
      headers,
      body: JSON.stringify(full),
    });
  } catch {
    // полная тишина
  } finally {
    _reporting = false;
  }
}

/**
 * Инициализировать глобальные обработчики.
 * Вызывать один раз при старте приложения.
 */
export function initGlobalErrorHandlers() {
  // Непойманные JS-исключения
  window.addEventListener('error', (event) => {
    // Игнорируем ошибки из расширений браузера
    if (event.filename?.includes('extension://')) return;
    reportError({
      error_type: 'js_error',
      error_message: event.message,
      error_stack: event.error?.stack || `${event.filename}:${event.lineno}:${event.colno}`,
      component: event.filename,
      extra_json: {
        lineno: event.lineno,
        colno: event.colno,
        filename: event.filename,
      },
    });
  });

  // Непойманные Promise rejection
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportError({
      error_type: 'unhandled_rejection',
      error_message: reason?.message || String(reason),
      error_stack: reason?.stack,
      extra_json: {
        reason: String(reason),
      },
    });
  });
}

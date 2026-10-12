import axios from 'axios';
import { appBasePath, withAppBasePath } from '../utils/appBasePath';
import { reportError } from '../utils/errorReporter';

const api = axios.create({
  baseURL: appBasePath ? `${appBasePath}/api` : '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;

    if (status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      const loginPath = withAppBasePath('/login');
      if (!window.location.href.includes('/login')) {
        window.location.href = loginPath;
      }
      return Promise.reject(err);
    }

    // Логируем 4xx (кроме 401/404) и все 5xx
    if (status && status !== 404 && (status >= 400)) {
      const url = err.config?.url || '';
      // Не логируем сам эндпоинт репортера (избегаем петли)
      if (!url.includes('/errors/system')) {
        reportError({
          error_type: 'api_error',
          error_message: err.response?.data?.error || err.message,
          http_status: status,
          request_url: url,
          request_method: (err.config?.method || '').toUpperCase(),
          response_data: JSON.stringify(err.response?.data)?.slice(0, 2000),
          extra_json: {
            params: err.config?.params,
            baseURL: err.config?.baseURL,
          },
        });
      }
    }

    return Promise.reject(err);
  }
);

export default api;

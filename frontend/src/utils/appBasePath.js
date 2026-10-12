function normalizeBasePath(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned || cleaned === '/') {
    return '';
  }

  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

export const appBasePath = normalizeBasePath(import.meta.env.VITE_APP_BASE_PATH || '');

export function withAppBasePath(path) {
  if (!appBasePath) {
    return path || '/';
  }

  if (!path || path === '/') {
    return `${appBasePath}/`;
  }

  if (path === appBasePath || path.startsWith(`${appBasePath}/`)) {
    return path;
  }

  return `${appBasePath}${path.startsWith('/') ? path : `/${path}`}`;
}

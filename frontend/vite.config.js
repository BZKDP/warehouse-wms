import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBasePath(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned || cleaned === '/') {
    return '';
  }

  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appBasePath = normalizeBasePath(env.VITE_APP_BASE_PATH || '');
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3020';

  return {
    base: appBasePath ? `${appBasePath}/` : '/',
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            icons: ['lucide-react'],
            barcode: ['jsbarcode'],
            socketio: ['socket.io-client'],
          },
        },
      },
    },
    server: {
      port: 5174,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        ...(appBasePath
          ? {
              [`${appBasePath}/api`]: {
                target: proxyTarget,
                changeOrigin: true,
              },
            }
          : {}),
      },
    },
  };
});

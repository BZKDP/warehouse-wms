import { useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

let socket = null;
let socketInitialized = false;

function getSocket() {
  if (socket) return socket;
  const token = localStorage.getItem('auth_token');
  if (!token) return null;

  const basePath = import.meta.env.VITE_APP_BASE_PATH || '/sklad';
  socket = io(window.location.origin, {
    path: `${basePath}/socket.io`,
    auth: { token },
    // nginx в проде не проксирует WS upgrade — используем только long-polling
    transports: ['polling'],
    upgrade: false,
    reconnection: true,
    reconnectionDelay: 5000,
    autoConnect: true,
  });
  socketInitialized = true;
  return socket;
}

export function useSocket(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const s = getSocket();
    if (!s || !event) return;

    const cb = (...args) => handlerRef.current?.(...args);
    s.on(event, cb);
    return () => s.off(event, cb);
  }, [event]);

  const emit = useCallback((ev, data) => {
    const s = getSocket();
    if (s) s.emit(ev, data);
  }, []);

  return { emit };
}

import { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertCircle, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAppSettings } from '../../context/AppSettingsContext';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const { settings } = useAppSettings();

  const addToast = useCallback((message, type = 'info', duration) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const durOk  = (settings.toast_duration_success || 3) * 1000;
  const durErr = (settings.toast_duration_error   || 5) * 1000;

  const toast = {
    success: (msg) => addToast(msg, 'success', durOk),
    error:   (msg) => addToast(msg, 'error',   durErr),
    info:    (msg) => addToast(msg, 'info',     durOk),
    warning: (msg) => addToast(msg, 'warning',  durOk),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, onRemove }) {
  const icons = {
    success: <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />,
    error: <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />,
    warning: <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
    info: <AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />,
  };

  const borderColors = {
    success: 'border-l-green-500',
    error: 'border-l-rose-500',
    warning: 'border-l-amber-500',
    info: 'border-l-blue-500',
  };

  return (
    <div className={cn(
      'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border border-l-4',
      'bg-white dark:bg-gray-900 border-gray-100 dark:border-gray-800',
      borderColors[toast.type],
      'animate-fade-in'
    )}>
      {icons[toast.type]}
      <p className="text-sm text-gray-700 dark:text-gray-300 flex-1">{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="text-gray-300 hover:text-gray-500 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

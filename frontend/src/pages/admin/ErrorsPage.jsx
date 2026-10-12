import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, RefreshCw, CheckCircle2, X,
  User, ClipboardList, MapPin, Calendar, CheckCheck,
  Globe, Cpu, Trash2, ChevronDown, ChevronRight, Copy, Check
} from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import CopyBadge from '../../components/ui/CopyBadge';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../utils/cn';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── Scan Error Detail Modal ──────────────────────────────────────────────────
function ScanErrorModal({ error, onClose, onResolved }) {
  const toast = useToast();
  const [resolving, setResolving] = useState(false);
  if (!error) return null;
  const isResolved = !!error.resolved_at;

  const handleResolve = async () => {
    setResolving(true);
    try {
      await api.put(`/tasks/errors/${error.id}/resolve`);
      toast.success('Ошибка отмечена как исправленная');
      onResolved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setResolving(false); }
  };

  return (
    <Modal open={!!error} onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          {isResolved ? <CheckCircle2 size={18} className="text-green-500" /> : <AlertTriangle size={18} className="text-rose-500" />}
          <span>Ошибка сканирования #{error.id}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {!isResolved && <Button variant="primary" icon={<CheckCheck size={15} />} onClick={handleResolve} loading={resolving}>Исправлено</Button>}
            {isResolved && (
              <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
                <CheckCircle2 size={16} />
                Исправлено {fmtDate(error.resolved_at)}
                {error.resolved_by_username && <span className="text-gray-400">· {error.resolved_by_username}</span>}
              </div>
            )}
          </div>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {isResolved && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
            <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-green-800">Ошибка исправлена</p>
              <p className="text-xs text-green-600">{fmtDate(error.resolved_at)}{error.resolved_by_username && ` · ${error.resolved_by_username}`}</p>
            </div>
          </div>
        )}
        <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">Отсканированный штрих-код</p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-lg font-mono font-bold text-rose-700 break-all">{error.scanned_value}</p>
            <CopyBadge value={error.scanned_value} />
          </div>
        </div>
        {error.employee_note
          ? <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3"><p className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-1">Комментарий сотрудника</p><p className="text-sm text-gray-800">{error.employee_note}</p></div>
          : <div className="bg-gray-50 rounded-xl px-4 py-3"><p className="text-xs text-gray-400 italic">Комментарий не оставлен</p></div>
        }
        <div className="grid grid-cols-2 gap-3">
          {error.employee_name && (
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1"><User size={12} className="text-gray-400" /><p className="text-xs text-gray-400 font-medium">Сотрудник</p></div>
              <p className="text-sm font-semibold text-gray-800">{error.employee_name}</p>
              {error.username && <p className="text-xs text-gray-400">@{error.username}</p>}
            </div>
          )}
          {error.task_title && (
            <div className="bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1"><ClipboardList size={12} className="text-gray-400" /><p className="text-xs text-gray-400 font-medium">Задача</p></div>
              <p className="text-sm font-semibold text-gray-800 truncate">{error.task_title}</p>
            </div>
          )}
          {(error.rack_name || error.shelf_name) && (
            <div className="bg-gray-50 rounded-xl px-3 py-2.5 col-span-2">
              <div className="flex items-center gap-1.5 mb-1"><MapPin size={12} className="text-gray-400" /><p className="text-xs text-gray-400 font-medium">Местоположение</p></div>
              <div className="flex items-center gap-2 flex-wrap">
                {error.rack_name && <span className="text-sm font-semibold text-gray-800">{error.rack_name}</span>}
                {error.rack_name && error.shelf_name && <span className="text-gray-300">·</span>}
                {error.shelf_name && <span className="text-sm text-gray-700">{error.shelf_name}</span>}
                {error.shelf_code && <span className="text-xs font-mono text-primary-500 bg-primary-50 px-1.5 py-0.5 rounded">{error.shelf_code}</span>}
              </div>
            </div>
          )}
          <div className="bg-gray-50 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-1.5 mb-1"><Calendar size={12} className="text-gray-400" /><p className="text-xs text-gray-400 font-medium">Дата ошибки</p></div>
            <p className="text-sm font-semibold text-gray-800">{fmtDate(error.created_at)}</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── System Error Detail Modal ────────────────────────────────────────────────
const ERROR_TYPE_LABELS = {
  js_error:            { label: 'Ошибка скрипта',       color: 'bg-rose-100 text-rose-700' },
  unhandled_rejection: { label: 'Необработанная ошибка', color: 'bg-orange-100 text-orange-700' },
  react_error:         { label: 'Ошибка компонента',     color: 'bg-pink-100 text-pink-700' },
  api_error:           { label: 'Ошибка запроса',        color: 'bg-amber-100 text-amber-700' },
  scan_error:          { label: 'Ошибка сканирования',   color: 'bg-yellow-100 text-yellow-700' },
  unknown:             { label: 'Неизвестно',            color: 'bg-gray-100 text-gray-600' },
};

// Словарь перевода типичных англоязычных ошибок
const ERROR_TRANSLATIONS = [
  [/screenshot attempt/i, 'Попытка скриншота'],
  [/security/i, 'Ошибка безопасности'],
  [/network error/i, 'Ошибка сети — сервер недоступен'],
  [/failed to fetch/i, 'Не удалось загрузить данные'],
  [/timeout/i, 'Превышено время ожидания'],
  [/unauthorized/i, 'Не авторизован — требуется вход'],
  [/forbidden/i, 'Доступ запрещён'],
  [/not found/i, 'Не найдено'],
  [/internal server error/i, 'Внутренняя ошибка сервера'],
  [/bad request/i, 'Некорректный запрос'],
  [/cors/i, 'Ошибка CORS — запрос заблокирован'],
  [/chunk.*fail/i, 'Ошибка загрузки модуля — обновите страницу'],
  [/loading chunk/i, 'Ошибка загрузки части приложения'],
  [/resizeobserver/i, 'Ошибка отслеживания размеров элемента'],
  [/cannot read propert/i, 'Ошибка чтения данных (пустое значение)'],
  [/is not a function/i, 'Ошибка вызова функции'],
  [/unexpected token/i, 'Ошибка разбора данных'],
  [/syntax error/i, 'Синтаксическая ошибка'],
  [/permission denied/i, 'Доступ запрещён'],
  [/quota exceeded/i, 'Превышен лимит хранилища'],
  [/abort/i, 'Запрос отменён'],
  [/econnrefused/i, 'Сервер не отвечает'],
  [/econnreset/i, 'Соединение сброшено'],
];

function translateError(msg) {
  if (!msg) return '—';
  for (const [pattern, translation] of ERROR_TRANSLATIONS) {
    if (pattern.test(msg)) return `${translation} (${msg.length > 60 ? msg.slice(0, 60) + '...' : msg})`;
  }
  return msg;
}

function SysErrorModal({ error, onClose, onDelete }) {
  const toast = useToast();
  const [showStack, setShowStack] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (!error) return null;
  const type = ERROR_TYPE_LABELS[error.error_type] || ERROR_TYPE_LABELS.unknown;

  const handleDelete = async () => {
    if (!confirm('Удалить эту запись?')) return;
    try {
      await api.delete(`/errors/system/${error.id}`);
      toast.success('Запись удалена');
      onDelete();
      onClose();
    } catch { toast.error('Ошибка удаления'); }
  };

  return (
    <Modal open={!!error} onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <Globe size={16} className="text-gray-400" />
          <span>Системная ошибка #{error.id}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type.color}`}>{type.label}</span>
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={handleDelete}>Удалить</Button>
          <Button variant="ghost" onClick={onClose}>Закрыть</Button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {/* Сообщение */}
        <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
          <p className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">Сообщение</p>
          <p className="text-sm text-rose-800 break-all leading-relaxed">{translateError(error.error_message)}</p>
        </div>

        {/* Стек */}
        {error.error_stack && (
          <div className="bg-gray-50 rounded-xl overflow-hidden">
            <button onClick={() => setShowStack(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-100 transition-colors">
              Стек вызовов
              {showStack ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showStack && (
              <div className="px-4 pb-3 relative">
                <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all leading-relaxed max-h-60 overflow-y-auto">{error.error_stack}</pre>
                <CopyBadge value={error.error_stack} label="Копировать стек" className="mt-2" />
              </div>
            )}
          </div>
        )}

        {/* Детали по сетке */}
        <div className="grid grid-cols-2 gap-2">
          {error.username && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400 mb-0.5">Пользователь</p>
              <p className="font-semibold text-gray-800">@{error.username}</p>
              {error.user_role && <p className="text-xs text-gray-400">{error.user_role}</p>}
            </div>
          )}
          {error.http_status && (
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-xs text-gray-400 mb-0.5">HTTP статус</p>
              <p className={`font-bold text-lg ${error.http_status >= 500 ? 'text-rose-600' : 'text-amber-600'}`}>{error.http_status}</p>
            </div>
          )}
          {error.request_method && error.request_url && (
            <div className="bg-gray-50 rounded-xl px-3 py-2 col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">API запрос</p>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">{error.request_method}</span>
                <code className="text-xs text-gray-700 truncate flex-1">{error.request_url}</code>
                <CopyBadge value={`${error.request_method} ${error.request_url}`} />
              </div>
            </div>
          )}
          {error.page_url && (
            <div className="bg-gray-50 rounded-xl px-3 py-2 col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Страница</p>
              <div className="flex items-center gap-2">
                <code className="text-xs text-gray-700 truncate flex-1">{error.page_url}</code>
                <CopyBadge value={error.page_url} />
              </div>
            </div>
          )}
          {error.component && (
            <div className="bg-gray-50 rounded-xl px-3 py-2 col-span-2">
              <p className="text-xs text-gray-400 mb-0.5">Компонент / файл</p>
              <code className="text-xs text-gray-700">{error.component}</code>
            </div>
          )}
          <div className="bg-gray-50 rounded-xl px-3 py-2 col-span-2">
            <p className="text-xs text-gray-400 mb-0.5">Время</p>
            <p className="font-semibold text-gray-800">{fmtDate(error.created_at)}</p>
          </div>
        </div>

        {/* Браузер */}
        {error.browser_info && (
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-xs text-gray-400 mb-0.5">Браузер</p>
            <p className="text-xs text-gray-600 break-all font-mono leading-relaxed">{error.browser_info}</p>
          </div>
        )}

        {/* Response data */}
        {error.response_data && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wider mb-1">Ответ сервера</p>
            <pre className="text-xs text-amber-800 font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">{error.response_data}</pre>
          </div>
        )}

        {/* Extra JSON */}
        {error.extra_json && (
          <div className="bg-gray-50 rounded-xl overflow-hidden">
            <button onClick={() => setShowRaw(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:bg-gray-100 transition-colors">
              Дополнительные данные
              {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {showRaw && (
              <div className="px-4 pb-3">
                <pre className="text-xs text-gray-700 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                  {JSON.stringify(typeof error.extra_json === 'string' ? JSON.parse(error.extra_json) : error.extra_json, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Строка системной ошибки ──────────────────────────────────────────────────
function SysErrorRow({ err, onClick }) {
  const type = ERROR_TYPE_LABELS[err.error_type] || ERROR_TYPE_LABELS.unknown;
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left px-5 py-3.5 hover:bg-rose-50/30 transition-colors">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Globe size={14} className="text-rose-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${type.color}`}>{type.label}</span>
            {err.http_status && <span className="text-xs font-bold text-amber-600">Код {err.http_status}</span>}
            {err.username && <span className="text-xs text-gray-400">@{err.username}</span>}
          </div>
          <p className="text-sm text-gray-700 truncate leading-snug">
            {translateError(err.error_message) || err.request_url || '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{fmtDate(err.created_at)}</p>
        </div>
        <ChevronRight size={14} className="text-gray-300 flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Строка ошибки сканирования ───────────────────────────────────────────────
function ScanErrorRow({ err, resolved, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('w-full text-left px-5 py-4 transition-colors', resolved ? 'hover:bg-green-50/40 dark:hover:bg-green-900/20' : 'hover:bg-rose-50/30 dark:hover:bg-rose-900/20')}>
      <div className="flex items-start gap-4">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5', resolved ? 'bg-green-50 dark:bg-green-900/30' : 'bg-rose-50 dark:bg-rose-900/30')}>
          {resolved ? <CheckCircle2 size={16} className="text-green-500" /> : <AlertTriangle size={16} className="text-rose-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className={cn('text-sm font-mono font-semibold', resolved ? 'text-gray-500' : 'text-rose-700')}>{err.scanned_value}</p>
            {resolved && <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium"><CheckCircle2 size={10} />Исправлено</span>}
          </div>
          {err.employee_note
            ? <p className="text-xs text-gray-600 mb-1.5 line-clamp-1">{err.employee_note}</p>
            : <p className="text-xs text-gray-400 italic mb-1.5">Без комментария</p>}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
            {err.employee_name && <span>{err.employee_name}</span>}
            {err.rack_name && err.shelf_name && <span>{err.rack_name} · {err.shelf_name}</span>}
            <span>{fmtDate(err.created_at)}</span>
          </div>
        </div>
        <ChevronRight size={14} className="text-gray-300 flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ─── Главная страница ──────────────────────────────────────────────────────────
export default function ErrorsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'scan';
  const setTab = (t) => { const p = new URLSearchParams(searchParams); p.set('tab', t); setSearchParams(p); };

  // Ошибки сканирования
  const [scanErrors, setScanErrors] = useState([]);
  const [scanLoading, setScanLoading] = useState(true);
  const [selectedScan, setSelectedScan] = useState(null);

  // Системные ошибки
  const [sysErrors, setSysErrors] = useState([]);
  const [sysTotal, setSysTotal] = useState(0);
  const [sysLoading, setSysLoading] = useState(false);
  const [selectedSys, setSelectedSys] = useState(null);
  const [sysFilter, setSysFilter] = useState('all');

  const loadScan = useCallback(() => {
    setScanLoading(true);
    api.get('/tasks/errors')
      .then(r => setScanErrors(r.data))
      .catch(console.error)
      .finally(() => setScanLoading(false));
  }, []);

  const loadSys = useCallback(() => {
    setSysLoading(true);
    const params = sysFilter !== 'all' ? { type: sysFilter } : {};
    api.get('/errors/system', { params })
      .then(r => { setSysErrors(r.data.items); setSysTotal(r.data.total); })
      .catch(console.error)
      .finally(() => setSysLoading(false));
  }, [sysFilter]);

  useEffect(() => { loadScan(); }, [loadScan]);
  useEffect(() => { if (tab === 'system') loadSys(); }, [tab, loadSys]);

  const unresolved = scanErrors.filter(e => !e.resolved_at);
  const resolved   = scanErrors.filter(e =>  e.resolved_at);

  const clearAllSys = async () => {
    if (!confirm('Очистить все системные ошибки?')) return;
    try {
      await api.delete('/errors/system');
      toast.success('Очищено');
      loadSys();
    } catch { toast.error('Ошибка'); }
  };

  const SYS_TYPES = [
    { value: 'all',                label: 'Все' },
    { value: 'js_error',           label: 'JS' },
    { value: 'unhandled_rejection',label: 'Promise' },
    { value: 'api_error',          label: 'API' },
    { value: 'react_error',        label: 'React' },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Заголовок */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ошибки</h1>
          <p className="text-gray-500 text-sm mt-1">Ошибки сканирования и системные события</p>
        </div>
        <Button variant="outline" size="sm"
          icon={<RefreshCw size={15} className={(scanLoading || sysLoading) ? 'animate-spin' : ''} />}
          onClick={() => { loadScan(); if (tab === 'system') loadSys(); }}>
          Обновить
        </Button>
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 bg-gray-50 dark:bg-gray-800 rounded-2xl p-1.5 mb-5 w-fit border border-gray-200 dark:border-gray-700">
        <button onClick={() => setTab('scan')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${tab === 'scan' ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 shadow-sm' : 'text-gray-400 hover:text-gray-600 border-transparent'}`}>
          Ошибки сканирования
          {unresolved.length > 0 && <span className="ml-2 bg-rose-500 text-white text-xs rounded-full px-1.5 py-0.5">{unresolved.length}</span>}
        </button>
        <button onClick={() => setTab('system')}
          className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all border ${tab === 'system' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 shadow-sm' : 'text-gray-400 hover:text-gray-600 border-transparent'}`}>
          Системные
          {sysTotal > 0 && <span className="ml-2 bg-amber-500 text-white text-xs rounded-full px-1.5 py-0.5">{sysTotal}</span>}
        </button>
      </div>

      {/* ─── Вкладка: Ошибки сканирования ──────────────────────────────── */}
      {tab === 'scan' && (
        scanLoading ? (
          <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
        ) : scanErrors.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 card">
            <AlertTriangle size={40} className="mb-2 opacity-30" />
            <p className="text-sm">Ошибок нет</p>
          </div>
        ) : (
          <div className="space-y-4">
            {unresolved.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2 px-1">
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Требуют внимания ({unresolved.length})</h2>
                  {unresolved.length > 1 && (
                    <Button variant="outline" size="sm" icon={<CheckCheck size={14} />}
                      onClick={async () => {
                        if (!confirm(`Отметить все ${unresolved.length} ошибок как исправленные?`)) return;
                        try {
                          await Promise.all(unresolved.map(e => api.put(`/tasks/errors/${e.id}/resolve`)));
                          toast.success(`${unresolved.length} ошибок исправлено`);
                          loadScan();
                        } catch { toast.error('Ошибка'); }
                      }}>
                      Исправить все
                    </Button>
                  )}
                </div>
                <div className="card overflow-hidden">
                  <div className="divide-y divide-gray-50">
                    {(() => {
                      // Group by scanned_value
                      const groups = new Map();
                      unresolved.forEach(err => {
                        const key = err.scanned_value || '—';
                        if (!groups.has(key)) groups.set(key, []);
                        groups.get(key).push(err);
                      });
                      const result = [];
                      for (const [val, errs] of groups) {
                        if (errs.length > 1) {
                          result.push(
                            <div key={`group-${val}`} className="px-5 py-3.5 hover:bg-rose-50/30 transition-colors">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
                                  <AlertTriangle size={16} className="text-rose-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-sm font-mono font-semibold text-rose-700">{val}</p>
                                    <span className="text-xs bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded-full font-bold">×{errs.length}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-400">
                                    {[...new Set(errs.map(e => e.employee_name).filter(Boolean))].map(n => <span key={n}>{n}</span>)}
                                    <span>{fmtDate(errs[0].created_at)}</span>
                                  </div>
                                </div>
                                <button onClick={() => setSelectedScan(errs[0])} className="text-gray-300 hover:text-gray-500"><ChevronRight size={14} /></button>
                              </div>
                            </div>
                          );
                        } else {
                          result.push(<ScanErrorRow key={errs[0].id} err={errs[0]} onClick={() => setSelectedScan(errs[0])} />);
                        }
                      }
                      return result;
                    })()}
                  </div>
                </div>
              </div>
            )}
            {resolved.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">Исправлено ({resolved.length})</h2>
                <div className="card overflow-hidden opacity-75">
                  <div className="divide-y divide-gray-50">
                    {resolved.map(err => <ScanErrorRow key={err.id} err={err} resolved onClick={() => setSelectedScan(err)} />)}
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ─── Вкладка: Системные ошибки ──────────────────────────────────── */}
      {tab === 'system' && (
        <div>
          {/* Фильтр по типу + кнопка очистки */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex gap-1 bg-gray-50 dark:bg-gray-800 rounded-2xl p-1.5 border border-gray-200 dark:border-gray-700">
              {SYS_TYPES.map(t => (
                <button key={t.value} onClick={() => setSysFilter(t.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${sysFilter === t.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white border-gray-200 shadow-sm' : 'text-gray-400 hover:text-gray-600 border-transparent'}`}>
                  {t.label}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={clearAllSys}>
              Очистить всё
            </Button>
          </div>

          {sysLoading ? (
            <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
          ) : sysErrors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-400 card">
              <Globe size={40} className="mb-2 opacity-30" />
              <p className="text-sm">Системных ошибок нет</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="divide-y divide-gray-50">
                {sysErrors.map(err => (
                  <SysErrorRow key={err.id} err={err} onClick={() => setSelectedSys(err)} />
                ))}
              </div>
              {sysTotal > sysErrors.length && (
                <div className="px-5 py-3 bg-gray-50 text-xs text-gray-400 text-center">
                  Показано {sysErrors.length} из {sysTotal}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ScanErrorModal error={selectedScan} onClose={() => setSelectedScan(null)} onResolved={loadScan} />
      <SysErrorModal  error={selectedSys}  onClose={() => setSelectedSys(null)}  onDelete={loadSys} />
    </div>
  );
}

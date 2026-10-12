import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BookOpen, Check, ChevronLeft, ChevronRight,
  Clipboard, Clock3, Eye, EyeOff, KeyRound, Plus, RefreshCw, RotateCw,
  Search, ShieldCheck, Trash2,
} from 'lucide-react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/Toast';
import { withAppBasePath } from '../../../utils/appBasePath';

const METHOD_STYLE = {
  GET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  POST: 'bg-blue-50 text-blue-700 border-blue-200',
  PATCH: 'bg-amber-50 text-amber-700 border-amber-200',
  DELETE: 'bg-rose-50 text-rose-700 border-rose-200',
};

const EMPTY_FORM = {
  name: '', scopes: [], rate_limit_per_minute: 120, expires_at: '',
};

function dateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString('ru-RU');
}

function KeyStatus({ item }) {
  const expired = item.expires_at && new Date(item.expires_at).getTime() <= Date.now();
  if (!item.active) return <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-500">Отозван</span>;
  if (expired) return <span className="inline-flex rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">Истёк</span>;
  return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">Активен</span>;
}

function Metric({ icon: Icon, label, value, tone = 'purple' }) {
  const tones = {
    purple: 'bg-primary-50 text-primary-600', blue: 'bg-blue-50 text-blue-600',
    green: 'bg-emerald-50 text-emerald-600', rose: 'bg-rose-50 text-rose-600',
  };
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className={`mb-3 grid h-8 w-8 place-items-center rounded-xl ${tones[tone]}`}><Icon size={16} /></div>
      <div className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{value ?? '—'}</div>
      <div className="mt-1 text-xs text-gray-400">{label}</div>
    </div>
  );
}

function ScopePicker({ scopes, selected, onChange, disabled = false }) {
  const grouped = useMemo(() => scopes.reduce((result, scope) => {
    (result[scope.group] ||= []).push(scope);
    return result;
  }, {}), [scopes]);
  const toggle = (scope) => {
    if (disabled) return;
    onChange(selected.includes(scope)
      ? selected.filter((item) => item !== scope)
      : [...selected, scope]);
  };
  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([group, items]) => (
        <div key={group}>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">{group}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((scope) => {
              const active = selected.includes(scope.id);
              return (
                <button key={scope.id} type="button" onClick={() => toggle(scope.id)} disabled={disabled}
                  className={`group flex gap-3 rounded-xl border p-3 text-left transition-all ${active
                    ? scope.dangerous ? 'border-amber-300 bg-amber-50/70' : 'border-primary-300 bg-primary-50/70'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800'} disabled:cursor-default`}>
                  <span className={`mt-0.5 grid h-5 w-5 flex-shrink-0 place-items-center rounded-md border ${active
                    ? scope.dangerous ? 'border-amber-500 bg-amber-500 text-white' : 'border-primary-500 bg-primary-500 text-white'
                    : 'border-gray-300 text-transparent'}`}><Check size={12} /></span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-gray-800 dark:text-gray-100">{scope.label}</span>
                    <code className="mt-0.5 block text-[10px] text-primary-600">{scope.id}</code>
                    <span className="mt-1 block text-[11px] leading-4 text-gray-400">{scope.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function KeyFormModal({ open, onClose, scopes, initial, onSaved }) {
  const toast = useToast();
  const editing = Boolean(initial?.id);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      name: initial.name || '',
      scopes: Array.isArray(initial.scopes) ? initial.scopes : [],
      rate_limit_per_minute: Number(initial.rate_limit_per_minute || 120),
      expires_at: initial.expires_at ? new Date(initial.expires_at).toISOString().slice(0, 16) : '',
    } : EMPTY_FORM);
  }, [open, initial]);

  const save = async () => {
    if (!form.name.trim()) return toast.error('Укажите название ключа');
    if (!form.scopes.length) return toast.error('Выберите хотя бы одно право');
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), scopes: form.scopes,
        rate_limit_per_minute: Number(form.rate_limit_per_minute || 120),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      };
      const result = editing
        ? await api.patch(`/api-management/keys/${initial.id}`, payload)
        : await api.post('/api-management/keys', payload);
      toast.success(editing ? 'Параметры ключа обновлены' : 'API-ключ создан');
      onSaved(result.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить ключ');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Настроить API-ключ' : 'Новый API-ключ'} size="xl"
      footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary-solid" loading={saving} onClick={save}>{editing ? 'Сохранить' : 'Создать ключ'}</Button></>}>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">Название</span>
            <input value={form.name} onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
              placeholder="Например, База знаний" autoFocus
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">Запросов в минуту</span>
            <input type="number" min="1" max="5000" value={form.rate_limit_per_minute}
              onChange={(event) => setForm((value) => ({ ...value, rate_limit_per_minute: event.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          </label>
        </div>
        <label className="block max-w-sm">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600 dark:text-gray-300">Работает до</span>
          <input type="datetime-local" value={form.expires_at}
            onChange={(event) => setForm((value) => ({ ...value, expires_at: event.target.value }))}
            className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          <span className="mt-1 block text-[11px] text-gray-400">Оставьте пустым для бессрочного ключа. Срок можно изменить позже.</span>
        </label>
        <div className="h-px bg-gray-100 dark:bg-gray-700" />
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div><h3 className="text-sm font-semibold text-gray-900 dark:text-white">Разрешённые действия</h3><p className="mt-0.5 text-xs text-gray-400">Выдавайте только те права, которые действительно нужны интеграции.</p></div>
            <button type="button" onClick={() => setForm((value) => ({ ...value, scopes: scopes.map((scope) => scope.id) }))} className="text-xs font-medium text-primary-600 hover:text-primary-700">Выбрать все</button>
          </div>
          <ScopePicker scopes={scopes} selected={form.scopes} onChange={(value) => setForm((formValue) => ({ ...formValue, scopes: value }))} />
        </div>
      </div>
    </Modal>
  );
}

function SecretModal({ secret, onClose }) {
  const toast = useToast();
  const [visible, setVisible] = useState(true);
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret?.token || ''); toast.success('API-ключ скопирован'); }
    catch { toast.error('Не удалось скопировать ключ'); }
  };
  return (
    <Modal open={Boolean(secret)} onClose={onClose} title="Сохраните API-ключ" size="lg"
      footer={<Button variant="primary-solid" onClick={onClose}>Я сохранил ключ</Button>}>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 flex-shrink-0" size={18} /><div><p className="font-semibold">Это единственный показ секрета</p><p className="mt-1 text-xs leading-5 text-amber-800">После закрытия окна GRAсклад не сможет показать его снова. При потере перевыпустите ключ.</p></div></div>
      </div>
      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold text-gray-500">Authorization: Bearer</p>
        <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-950 p-3 text-gray-100">
          <code className="min-w-0 flex-1 break-all text-xs leading-5">{visible ? secret?.token : '•'.repeat(42)}</code>
          <button onClick={() => setVisible((value) => !value)} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          <button onClick={copy} className="rounded-lg p-2 text-gray-400 hover:bg-white/10 hover:text-white"><Clipboard size={16} /></button>
        </div>
      </div>
    </Modal>
  );
}

function KeysView({ scopes, items, loading, reload, onSecret }) {
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const revoke = async (item) => {
    if (!confirm(`Отозвать ключ «${item.name}»? Все запросы с ним сразу перестанут работать.`)) return;
    try { await api.delete(`/api-management/keys/${item.id}`); toast.success('Ключ отозван'); reload(); }
    catch (err) { toast.error(err.response?.data?.error || 'Не удалось отозвать ключ'); }
  };
  const rotate = async (item) => {
    if (!confirm(`Перевыпустить ключ «${item.name}»? Старое значение перестанет работать сразу.`)) return;
    try { const result = await api.post(`/api-management/keys/${item.id}/rotate`); onSecret(result.data); reload(); }
    catch (err) { toast.error(err.response?.data?.error || 'Не удалось перевыпустить ключ'); }
  };
  const saved = (value) => {
    setCreateOpen(false); setEditing(null); reload();
    if (value?.token) onSecret(value);
  };

  return (
    <>
      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row sm:items-center dark:border-gray-700">
          <div className="min-w-0 flex-1"><h3 className="font-semibold text-gray-900 dark:text-white">Ключи доступа</h3><p className="mt-1 text-xs text-gray-400">Секрет хранится только у интегратора; в портале остаётся префикс и хэш.</p></div>
          <Button variant="primary-solid" size="sm" icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>Создать ключ</Button>
        </div>
        {loading ? <div className="grid place-items-center py-16 text-sm text-gray-400"><RefreshCw className="mb-2 animate-spin" size={20} />Загрузка ключей…</div>
          : items.length === 0 ? <div className="grid place-items-center px-5 py-16 text-center"><div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary-50 text-primary-500"><KeyRound size={22} /></div><p className="font-medium text-gray-800 dark:text-white">API-ключей пока нет</p><p className="mt-1 max-w-sm text-xs text-gray-400">Создайте отдельный ключ для каждой системы — так права и журнал не смешиваются.</p></div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:bg-gray-800/50"><th className="px-5 py-3 font-semibold">Интеграция</th><th className="px-3 py-3 font-semibold">Права</th><th className="px-3 py-3 font-semibold">Активность</th><th className="px-3 py-3 text-right font-semibold">24 часа</th><th className="px-5 py-3" /></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700/70">
                <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600"><KeyRound size={16} /></div><div><p className="text-sm font-semibold text-gray-900 dark:text-white">{item.name}</p><code className="text-[10px] text-gray-400">{item.key_prefix}••••</code><div className="mt-1"><KeyStatus item={item} /></div></div></div></td>
                <td className="max-w-[280px] px-3 py-4"><div className="flex flex-wrap gap-1">{(item.scopes || []).slice(0, 4).map((scope) => <code key={scope} className="rounded-md bg-gray-100 px-1.5 py-1 text-[9px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">{scope}</code>)}{(item.scopes || []).length > 4 && <span className="rounded-md bg-gray-100 px-1.5 py-1 text-[9px] text-gray-500">+{item.scopes.length - 4}</span>}</div></td>
                <td className="px-3 py-4 text-xs text-gray-500"><p>{item.last_used_at ? dateTime(item.last_used_at) : 'Ещё не использовался'}</p><p className="mt-1 text-[10px] text-gray-400">лимит {item.rate_limit_per_minute}/мин · до {item.expires_at ? dateTime(item.expires_at) : 'бессрочно'}</p></td>
                <td className="px-3 py-4 text-right"><p className="text-sm font-semibold text-gray-800 dark:text-white">{item.requests_24h || 0}</p><p className={`text-[10px] ${item.errors_24h ? 'text-rose-500' : 'text-gray-400'}`}>{item.errors_24h || 0} ошибок</p></td>
                <td className="px-5 py-4"><div className="flex items-center justify-end gap-1"><button disabled={!item.active} onClick={() => setEditing(item)} title="Настроить" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"><ShieldCheck size={15} /></button><button disabled={!item.active} onClick={() => rotate(item)} title="Перевыпустить" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 dark:hover:bg-gray-700"><RotateCw size={15} /></button><button disabled={!item.active} onClick={() => revoke(item)} title="Отозвать" className="rounded-lg p-2 text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={15} /></button></div></td>
              </tr>)}</tbody></table></div>}
      </div>
      <KeyFormModal open={createOpen} onClose={() => setCreateOpen(false)} scopes={scopes} onSaved={saved} />
      <KeyFormModal open={Boolean(editing)} onClose={() => setEditing(null)} scopes={scopes} initial={editing} onSaved={saved} />
    </>
  );
}

function LogDetail({ item, onClose }) {
  if (!item) return null;
  return (
    <Modal open onClose={onClose} title={`Запрос ${item.request_id || `#${item.id}`}`} size="lg">
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Метод</p><p className="mt-1 font-semibold">{item.method}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Статус</p><p className={`mt-1 font-semibold ${item.status_code >= 400 ? 'text-rose-600' : 'text-emerald-600'}`}>{item.status_code}</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Время</p><p className="mt-1 font-semibold">{Number(item.duration_ms || 0).toFixed(0)} мс</p></div>
          <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Создан</p><p className="mt-1 text-xs font-medium">{dateTime(item.created_at)}</p></div>
        </div>
        <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Ключ</p><p className="mt-1 font-medium text-gray-800 dark:text-gray-100">{item.key_name || 'Неизвестный ключ'} <code className="ml-1 text-xs text-gray-400">{item.key_prefix}</code></p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Операция</p><p className="mt-1 font-medium">{item.operation}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Путь</p><code className="mt-1 block break-all rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">{item.path}</code></div>
        {item.request_body && <div><p className="text-[10px] uppercase tracking-wide text-gray-400">Тело запроса</p><pre className="mt-1 max-h-64 overflow-auto rounded-xl bg-gray-950 p-3 text-xs leading-5 text-gray-100">{JSON.stringify(item.request_body, null, 2)}</pre></div>}
        {item.error_message && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800"><p className="text-xs font-semibold">{item.error_code || 'Ошибка'}</p><p className="mt-1 text-xs">{item.error_message}</p></div>}
        <div className="grid gap-2 text-xs text-gray-400 sm:grid-cols-2"><p>IP: {item.ip_address || '—'}</p><p className="truncate" title={item.user_agent}>User-Agent: {item.user_agent || '—'}</p></div>
      </div>
    </Modal>
  );
}

function LogsView({ keys }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ q: '', key_id: '', method: '', status: '' });
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 50 };
      for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
      const result = await api.get('/api-management/logs', { params });
      setItems(result.data.items || []); setPagination(result.data.pagination || { pages: 1, total: 0 });
    } finally { setLoading(false); }
  }, [filters, page]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const setFilter = (key, value) => { setPage(1); setFilters((current) => ({ ...current, [key]: value })); };
  return (
    <>
      <div className="card overflow-hidden">
        <div className="border-b border-gray-100 p-5 dark:border-gray-700">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1"><h3 className="font-semibold text-gray-900 dark:text-white">Журнал запросов</h3><p className="mt-1 text-xs text-gray-400">Каждый HTTP-вызов можно проследить до ключа и request_id.</p></div>
            <div className="relative min-w-[220px]"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} /><input value={filters.q} onChange={(event) => setFilter('q', event.target.value)} placeholder="Путь, операция, request_id" className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white" /></div>
            <select value={filters.key_id} onChange={(event) => setFilter('key_id', event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"><option value="">Все ключи</option>{keys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}</select>
            <select value={filters.method} onChange={(event) => setFilter('method', event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"><option value="">Все методы</option>{['GET', 'POST', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}</select>
            <select value={filters.status} onChange={(event) => setFilter('status', event.target.value)} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-white"><option value="">Все статусы</option><option value="success">Успешные</option><option value="error">Ошибки</option></select>
          </div>
        </div>
        {loading ? <div className="grid place-items-center py-16 text-sm text-gray-400"><RefreshCw className="mb-2 animate-spin" size={20} />Чтение журнала…</div>
          : items.length === 0 ? <div className="grid place-items-center py-16 text-center"><Activity className="mb-3 text-gray-300" size={28} /><p className="text-sm font-medium text-gray-600">Запросов по фильтру нет</p></div>
            : <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/60 text-[11px] uppercase tracking-wide text-gray-400 dark:border-gray-700 dark:bg-gray-800/50"><th className="px-5 py-3">Время</th><th className="px-3 py-3">Операция</th><th className="px-3 py-3">Ключ</th><th className="px-3 py-3 text-right">Результат</th><th className="px-5 py-3" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700/70"><td className="whitespace-nowrap px-5 py-3 text-xs text-gray-500">{dateTime(item.created_at)}</td><td className="max-w-[380px] px-3 py-3"><div className="flex items-center gap-2"><span className={`rounded-md border px-1.5 py-1 font-mono text-[9px] font-bold ${METHOD_STYLE[item.method] || 'border-gray-200 bg-gray-50 text-gray-600'}`}>{item.method}</span><div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{item.operation}</p><p className="truncate font-mono text-[10px] text-gray-400">{item.path}</p></div></div></td><td className="px-3 py-3"><p className="text-xs font-medium text-gray-700 dark:text-gray-200">{item.key_name || 'Неизвестный'}</p><code className="text-[9px] text-gray-400">{item.key_prefix || '—'}</code></td><td className="px-3 py-3 text-right"><span className={`text-xs font-bold ${item.status_code >= 400 ? 'text-rose-600' : 'text-emerald-600'}`}>{item.status_code}</span><p className="mt-0.5 text-[9px] text-gray-400">{Number(item.duration_ms || 0).toFixed(0)} мс</p></td><td className="px-5 py-3 text-right"><button onClick={() => setDetail(item)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"><Eye size={15} /></button></td></tr>)}</tbody></table></div>}
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 text-xs text-gray-400 dark:border-gray-700"><span>{pagination.total || 0} запросов</span><div className="flex items-center gap-2"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-gray-200 p-1.5 disabled:opacity-30 dark:border-gray-700"><ChevronLeft size={14} /></button><span>{page} / {Math.max(1, pagination.pages || 1)}</span><button disabled={page >= (pagination.pages || 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-200 p-1.5 disabled:opacity-30 dark:border-gray-700"><ChevronRight size={14} /></button></div></div>
      </div>
      <LogDetail item={detail} onClose={() => setDetail(null)} />
    </>
  );
}

export default function ApiManagementSection() {
  const toast = useToast();
  const [view, setView] = useState('keys');
  const [scopes, setScopes] = useState([]);
  const [keys, setKeys] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scopeResult, keyResult, statsResult] = await Promise.all([
        api.get('/api-management/scopes'), api.get('/api-management/keys'), api.get('/api-management/stats'),
      ]);
      setScopes(scopeResult.data.scopes || []); setKeys(keyResult.data.items || []); setStats(statsResult.data || null);
    } catch (err) { toast.error(err.response?.data?.error || 'Не удалось загрузить настройки API'); }
    finally { setLoading(false); }
  // ToastContext создаёт новый объект на каждом рендере; намеренно не кладём
  // его в зависимости, иначе загрузка будет перезапускаться по кругу.
  }, []);
  useEffect(() => { load(); }, [load]);

  const docsHref = withAppBasePath('/api/public/v1/docs');
  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl border border-primary-200 bg-gradient-to-br from-white via-white to-primary-50/80 p-6 shadow-sm dark:border-primary-900/60 dark:from-gray-900 dark:via-gray-900 dark:to-primary-900/30">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full border-[28px] border-primary-100/70 dark:border-primary-900/30" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl bg-primary-600 text-white shadow-[0_12px_28px_rgba(124,58,237,0.25)]"><KeyRound size={24} /></div>
          <div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary-500">Внешние интеграции</p><h2 className="mt-1 text-xl font-bold tracking-tight text-gray-900 dark:text-white">Доступ к GRAскладу по API</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">Отдельный ключ для каждого сервиса, точные права на операции и полная трасса запросов — от метода до результата.</p></div>
          <a href={docsHref} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-primary-200 bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-primary-800 dark:bg-gray-800 dark:text-primary-300"><BookOpen size={16} />Документация API</a>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={KeyRound} label="активных ключей" value={stats?.active_keys} />
        <Metric icon={Activity} label="запросов за 24 часа" value={stats?.requests_24h} tone="blue" />
        <Metric icon={AlertTriangle} label="ошибок за 24 часа" value={stats?.errors_24h} tone="rose" />
        <Metric icon={Clock3} label="среднее время, мс" value={stats?.avg_duration_24h} tone="green" />
      </div>

      <div className="inline-flex rounded-2xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800">
        {[{ key: 'keys', label: 'Ключи', icon: KeyRound }, { key: 'logs', label: 'Журнал операций', icon: Activity }].map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setView(key)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-semibold transition ${view === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white' : 'text-gray-500 hover:text-gray-700'}`}><Icon size={14} />{label}</button>)}
      </div>

      {view === 'keys'
        ? <KeysView scopes={scopes} items={keys} loading={loading} reload={load} onSecret={setSecret} />
        : <LogsView keys={keys} />}
      <SecretModal secret={secret} onClose={() => setSecret(null)} />
    </div>
  );
}

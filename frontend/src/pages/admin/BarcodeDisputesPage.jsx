import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Archive, Barcode as BarcodeIcon, Check, CheckCircle2,
  CircleDot, Clock3, FileQuestion, History, PackageCheck, RefreshCw,
  Search, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react';
import api from '../../api/client';
import Barcode from '../../components/ui/Barcode';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Spinner from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import usePerms from '../../hooks/usePerms';
import { cn } from '../../utils/cn';

const STATUS_TABS = [
  { id: 'open', label: 'Ожидают решения', icon: FileQuestion },
  { id: 'decided', label: 'Решение принято', icon: Clock3 },
  { id: 'resolved', label: 'Решённые', icon: CheckCircle2 },
  { id: 'dismissed', label: 'Отклонено', icon: XCircle },
];

const TYPE_FILTERS = [
  { id: '', label: 'Все ситуации' },
  { id: 'barcode_owner', label: 'Владелец штрихкода' },
  { id: 'production_barcode', label: 'Производственный код' },
  { id: 'product_status', label: 'Статус карточки' },
];

const TYPE_LABELS = {
  barcode_owner: 'Владелец штрихкода',
  production_barcode: 'Производственный код',
  product_status: 'Статус карточки',
};

const SEVERITY = {
  critical: { label: 'Критично', className: 'border-rose-200 bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  high: { label: 'Важно', className: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  medium: { label: 'Проверить', className: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  low: { label: 'Низкий', className: 'border-gray-200 bg-gray-50 text-gray-600', dot: 'bg-gray-400' },
};

const EVIDENCE_TONES = {
  support: 'border-emerald-200 bg-emerald-50/70 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50/70 text-amber-800',
  neutral: 'border-gray-200 bg-gray-50 text-gray-600',
};

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}

function actionLabel(option) {
  if (option.action === 'archive_product') return 'Архивировать карточку';
  if (option.action === 'keep_no_change') return 'Оставить без изменений';
  return option.barcode ? `Назначить ${option.barcode}` : 'Назначить штрихкод';
}

function availabilityMessage(option) {
  if (option.availability === 'missing') return 'Карточки ещё нет в GRAскладе';
  if (option.availability === 'duplicate_article') return 'В каталоге несколько карточек с этим артикулом';
  if (option.availability === 'archived' && option.action === 'assign_production_barcode') return 'Карточка находится в архиве';
  return null;
}

function IssueLabel({ barcode, article }) {
  const value = barcode || article;
  if (!value) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.05)] dark:border-gray-700 dark:bg-gray-900">
      <div className="absolute inset-y-0 right-0 w-20 opacity-[0.035]"
        style={{ backgroundImage: 'repeating-linear-gradient(90deg,#111 0,#111 2px,transparent 2px,transparent 6px)' }} />
      <div className="relative flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-400">
            {barcode ? 'Штрихкод на проверке' : 'Карточка на проверке'}
          </p>
          <code className="block whitespace-nowrap text-lg font-bold tracking-[0.04em] text-gray-900 dark:text-white sm:text-xl">{value}</code>
        </div>
        {barcode && (
          <div className="hidden w-[130px] flex-shrink-0 overflow-hidden rounded-lg bg-white sm:block" aria-hidden="true">
            <Barcode value={barcode} width={0.8} height={34} className="h-[58px] w-full" />
          </div>
        )}
      </div>
    </div>
  );
}

function OptionCard({ option, selected, recommended, onSelect, disabled }) {
  const issue = availabilityMessage(option);
  const product = option.product;
  const fields = product?.barcode_fields || [];
  return (
    <button type="button" onClick={onSelect} disabled={disabled}
      className={cn(
        'relative w-full rounded-2xl border p-4 text-left transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-400/40',
        selected
          ? 'border-emerald-400 bg-emerald-50/65 shadow-[0_8px_24px_rgba(16,185,129,0.10)] dark:bg-emerald-950/20'
          : 'border-gray-200 bg-white hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md dark:border-gray-700 dark:bg-gray-900',
        disabled && 'cursor-default hover:translate-y-0 hover:shadow-none'
      )}>
      <div className="flex items-start gap-3">
        <span className={cn(
          'mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-full border-2 transition-colors',
          selected ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 bg-white text-transparent dark:bg-gray-800'
        )}><Check size={13} strokeWidth={3} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-gray-900 dark:text-white">{option.label || option.article}</p>
            {recommended && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700">
                <Sparkles size={10} /> Рекомендация
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{option.detail}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {option.article && <code className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:bg-gray-800 dark:text-gray-200">{option.article}</code>}
            {option.barcode && <code className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] text-white">{option.barcode}</code>}
            {fields.includes('production') && <span className="rounded-lg bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">сейчас производственный</span>}
            {fields.includes('additional') && <span className="rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">есть в дополнительных</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
            {product && <span>{product.name}</span>}
            {option.barcode && <span>{option.scan_stats?.count || 0} сканов этого кода</span>}
            {product && <span>остаток {product.stock || 0}</span>}
          </div>
          {issue && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{issue}. Выбор можно записать, но применить к каталогу нельзя.</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function DecisionSummary({ issue }) {
  const option = issue.selected_option;
  if (!option && issue.status !== 'dismissed') return null;
  if (issue.status === 'dismissed') {
    return (
      <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex items-start gap-3">
          <XCircle size={18} className="mt-0.5 text-gray-500" />
          <div><p className="text-xs font-semibold text-gray-700">Ситуация отклонена</p><p className="mt-1 text-[11px] text-gray-500">{issue.resolved_by_username || 'Пользователь'} · {dateTime(issue.resolved_at)}</p>{issue.resolution_note && <p className="mt-2 text-xs leading-5 text-gray-600">{issue.resolution_note}</p>}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn(
      'rounded-2xl border px-4 py-3',
      issue.status === 'resolved'
        ? 'border-emerald-200 bg-emerald-50/70'
        : issue.status === 'dismissed'
          ? 'border-gray-200 bg-gray-50'
          : 'border-blue-200 bg-blue-50/70'
    )}>
      <div className="flex items-start gap-3">
        {issue.status === 'resolved' ? <PackageCheck size={18} className="mt-0.5 text-emerald-600" /> : <History size={18} className="mt-0.5 text-blue-600" />}
        <div>
          <p className="text-xs font-semibold text-gray-800">
            {issue.applied ? 'Решение применено' : issue.status === 'resolved' ? 'Решение сохранено без изменений' : 'Решение зафиксировано'}
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900">{option.label || actionLabel(option)}</p>
          <p className="mt-1 text-[11px] text-gray-500">
            {issue.resolved_by_username || 'Пользователь'} · {dateTime(issue.resolved_at)}
          </p>
          {issue.resolution_note && <p className="mt-2 text-xs leading-5 text-gray-600">{issue.resolution_note}</p>}
        </div>
      </div>
    </div>
  );
}

function DisputeCard({ issue, selectedId, onSelect, onResolve, onDismiss, canResolve }) {
  const severity = SEVERITY[issue.severity] || SEVERITY.medium;
  const readOnly = !canResolve || issue.status === 'dismissed';
  return (
    <article className="overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-[0_12px_40px_rgba(15,23,42,0.045)] dark:border-gray-800 dark:bg-gray-900">
      <div className="border-b border-gray-100 px-5 py-5 dark:border-gray-800 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold', severity.className)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', severity.dot)} />{severity.label}
              </span>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {TYPE_LABELS[issue.issue_type] || issue.issue_type}
              </span>
              <span className="text-[11px] text-gray-400">#{issue.id}</span>
            </div>
            <h2 className="text-lg font-bold tracking-tight text-gray-950 dark:text-white sm:text-xl">{issue.title}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500 dark:text-gray-400">{issue.description}</p>
          </div>
          <div className="w-full flex-shrink-0 lg:w-[360px]">
            <IssueLabel barcode={issue.primary_barcode} article={issue.subject_article} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <div>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Выберите правильный вариант</p>
              <p className="mt-1 text-xs text-gray-400">Ничего не изменится до отдельного подтверждения.</p>
            </div>
            {selectedId && !readOnly && <span className="hidden text-xs font-medium text-emerald-600 sm:block">Вариант выбран</span>}
          </div>
          <div className={cn('grid gap-3', issue.candidate_options.length > 1 && 'xl:grid-cols-2')}>
            {issue.candidate_options.map((option) => (
              <OptionCard key={option.id} option={option}
                selected={selectedId === option.id}
                recommended={issue.recommended_option_id === option.id}
                disabled={readOnly}
                onSelect={() => onSelect(issue.id, option.id)} />
            ))}
          </div>
          {!readOnly && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-gray-800">
              <button type="button" onClick={() => onDismiss(issue)} className="text-xs font-medium text-gray-400 hover:text-rose-600">
                Не считать проблемой
              </button>
              <Button variant="primary-solid" disabled={!selectedId}
                icon={<ShieldCheck size={15} />}
                onClick={() => onResolve(issue, issue.candidate_options.find((option) => option.id === selectedId))}>
                {issue.status === 'open' ? 'Принять решение' : 'Изменить решение'}
              </Button>
            </div>
          )}
        </div>

        <aside className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.13em] text-gray-400">Что удалось проверить</p>
            <div className="mt-3 space-y-2">
              {(issue.evidence || []).map((item, index) => (
                <div key={`${item.source}-${index}`} className={cn('rounded-xl border px-3 py-2.5', EVIDENCE_TONES[item.tone] || EVIDENCE_TONES.neutral)}>
                  <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">{item.source}</p>
                  <p className="mt-1 text-xs leading-5">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
          <DecisionSummary issue={issue} />
        </aside>
      </div>
    </article>
  );
}

function ResolutionModal({ value, onClose, onSaved }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [apply, setApply] = useState(true);
  const [saving, setSaving] = useState(false);
  const issue = value?.issue;
  const option = value?.option;
  const actionable = option && option.action !== 'keep_no_change';
  const canApply = actionable && option.availability === 'ready';

  useEffect(() => {
    if (!value) return;
    setNote('');
    setApply(canApply);
  }, [value, canApply]);

  if (!value) return null;

  const save = async () => {
    setSaving(true);
    try {
      const response = await api.post(`/barcode-disputes/${issue.id}/resolve`, {
        option_id: option.id,
        confirm_apply: canApply && apply,
        note,
      });
      const applied = response.data.item?.applied;
      toast.success(applied ? 'Решение применено к каталогу' : 'Решение зафиксировано');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось сохранить решение');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Подтвердить решение" size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary-solid" loading={saving} onClick={save}>{apply && canApply ? 'Применить решение' : 'Зафиксировать выбор'}</Button></>}>
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-emerald-500 text-white"><Check size={18} strokeWidth={3} /></span>
            <div>
              <p className="text-sm font-semibold text-gray-900">{option.label || actionLabel(option)}</p>
              <p className="mt-1 text-xs leading-5 text-gray-600">{option.detail}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {option.article && <code className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-gray-700">{option.article}</code>}
                {option.barcode && <code className="rounded-lg bg-gray-950 px-2 py-1 text-xs text-white">{option.barcode}</code>}
              </div>
            </div>
          </div>
        </div>

        {actionable && (
          <label className={cn('flex items-start gap-3 rounded-2xl border p-4', canApply ? 'cursor-pointer border-gray-200' : 'border-amber-200 bg-amber-50/60')}>
            <input type="checkbox" checked={canApply && apply} disabled={!canApply}
              onChange={(event) => setApply(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Применить к каталогу сейчас</p>
              <p className="mt-1 text-xs leading-5 text-gray-500">
                {canApply
                  ? option.action === 'archive_product'
                    ? 'Карточка будет переведена в архив. При наличии остатка операция будет заблокирована.'
                    : 'Код станет производственным у выбранной карточки и будет удалён из всех полей других товаров.'
                  : `${availabilityMessage(option)}. Сейчас будет сохранён только ваш выбор.`}
              </p>
            </div>
          </label>
        )}

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-gray-600">Комментарий к решению</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000}
            placeholder="Например: проверил печатную этикетку на производстве"
            className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3.5 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-100" />
        </label>

        <div className="flex gap-2 text-[11px] leading-5 text-gray-400">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
          <p>GRAсклад сохранит пользователя, время, выбранный вариант и фактическое изменение карточек.</p>
        </div>
      </div>
    </Modal>
  );
}

export default function BarcodeDisputesPage() {
  const toast = useToast();
  const { can } = usePerms();
  const canResolve = can('barcode_disputes.resolve');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ open: 0, decided: 0, resolved: 0, dismissed: 0, urgent: 0, total: 0 });
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [resolution, setResolution] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listResponse, statsResponse] = await Promise.all([
        api.get('/barcode-disputes', { params: { status, type: type || undefined, q: search || undefined } }),
        api.get('/barcode-disputes/stats'),
      ]);
      setItems(listResponse.data.items || []);
      setStats(statsResponse.data || {});
      setSelected((current) => {
        const next = { ...current };
        for (const item of listResponse.data.items || []) {
          if (item.selected_option?.id) next[item.id] = item.selected_option.id;
        }
        return next;
      });
      window.dispatchEvent(new CustomEvent('barcode-disputes-updated', { detail: statsResponse.data }));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось загрузить спорные ситуации');
    } finally { setLoading(false); }
  }, [status, type, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const response = await api.post('/barcode-disputes/refresh');
      toast.success(response.data.created
        ? `Добавлено новых ситуаций: ${response.data.created}`
        : 'Новых конфликтов не найдено');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось выполнить проверку');
    } finally { setRefreshing(false); }
  };

  const dismiss = async (issue) => {
    if (!confirm(`Убрать ситуацию «${issue.title}» из очереди без изменения товаров?`)) return;
    try {
      await api.post(`/barcode-disputes/${issue.id}/dismiss`, { note: 'Отклонено из очереди оператором' });
      toast.success('Ситуация отмечена как неактуальная');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Не удалось отклонить ситуацию');
    }
  };

  const filteredCounts = useMemo(() => ({
    open: stats.open || 0,
    decided: stats.decided || 0,
    resolved: stats.resolved || 0,
    dismissed: stats.dismissed || 0,
  }), [stats]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary-600">Контроль товарного справочника</p>
          <h1 className="text-2xl font-bold tracking-tight text-gray-950 dark:text-white sm:text-3xl">Спорные данные</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            Проверяйте конфликтующие этикетки и выбирайте, какому GRA-артикулу принадлежит штрихкод.
          </p>
        </div>
        {canResolve && <Button variant="outline" loading={refreshing} icon={<RefreshCw size={15} />} onClick={refresh}>Найти новые конфликты</Button>}
      </header>

      <section className="relative overflow-hidden rounded-[24px] border border-slate-800 bg-slate-950 px-5 py-5 text-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] sm:px-6">
        <div className="absolute inset-y-0 right-0 w-[44%] opacity-[0.08]"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg,#fff 0,#fff 2px,transparent 2px,transparent 8px)' }} />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-2xl bg-amber-400 text-slate-950"><BarcodeIcon size={23} /></div>
            <div>
              <p className="text-sm font-semibold">Очередь проверки этикеток</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">До вашего решения спорный код не переназначается автоматически.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-xl border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-rose-200"><strong className="mr-1 text-base text-white">{stats.urgent || 0}</strong> срочных</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-xl border border-blue-400/25 bg-blue-400/10 px-3 py-2 text-blue-200"><strong className="mr-1 text-base text-white">{stats.decided || 0}</strong> выбрано</span>
            <span className="text-slate-600">→</span>
            <span className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-emerald-200"><strong className="mr-1 text-base text-white">{stats.resolved || 0}</strong> решено</span>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => setStatus(id)}
              className={cn('flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
                status === id ? 'bg-gray-950 text-white shadow-sm dark:bg-white dark:text-gray-950' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800')}>
              <Icon size={14} />{label}
              <span className={cn('rounded-md px-1.5 py-0.5 text-[10px]', status === id ? 'bg-white/15' : 'bg-gray-100 text-gray-500 dark:bg-gray-800')}>{filteredCounts[id]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Артикул или штрихкод"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-primary-300 focus:bg-white sm:w-56 dark:border-gray-700 dark:bg-gray-800" />
          </div>
          <select value={type} onChange={(event) => setType(event.target.value)}
            className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 outline-none focus:border-primary-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {TYPE_FILTERS.map((filter) => <option key={filter.id} value={filter.id}>{filter.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="grid min-h-[340px] place-items-center rounded-3xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="text-center"><Spinner size="lg" className="mx-auto" /><p className="mt-3 text-sm text-gray-400">Загружаем доказательства…</p></div>
        </div>
      ) : items.length === 0 ? (
        <div className="grid min-h-[340px] place-items-center rounded-3xl border border-dashed border-gray-300 bg-white px-6 text-center dark:border-gray-700 dark:bg-gray-900">
          <div><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleDot size={24} /></div><h2 className="mt-4 font-semibold text-gray-900 dark:text-white">В этой вкладке пусто</h2><p className="mt-1 text-sm text-gray-400">Новые найденные конфликты появятся здесь автоматически.</p></div>
        </div>
      ) : (
        <div className="space-y-5">
          {items.map((issue) => (
            <DisputeCard key={issue.id} issue={issue}
              selectedId={selected[issue.id] || null}
              onSelect={(id, optionId) => setSelected((value) => ({ ...value, [id]: optionId }))}
              onResolve={(currentIssue, option) => setResolution({ issue: currentIssue, option })}
              onDismiss={dismiss}
              canResolve={canResolve} />
          ))}
        </div>
      )}

      <ResolutionModal value={resolution} onClose={() => setResolution(null)} onSaved={load} />
    </div>
  );
}

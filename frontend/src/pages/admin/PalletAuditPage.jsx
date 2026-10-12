import { useState, useMemo, Fragment } from 'react';
import {
  ClipboardCheck, AlertTriangle, PackageX, PackagePlus, Truck,
  Search, ChevronDown, ChevronRight, Copy, Ghost,
} from 'lucide-react';
import audit from '../../data/palletAudit.json';
import Input from '../../components/ui/Input';
import { cn } from '../../utils/cn';

// ─── Хелперы ──────────────────────────────────────────────────────────────────
const num = (n) => (n ?? 0).toLocaleString('ru-RU');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);

function Delta({ v, className }) {
  if (!v) return <span className={cn('text-slate-400', className)}>0</span>;
  return (
    <span className={cn('font-semibold tabular-nums', v < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400', className)}>
      {v > 0 ? '+' : ''}{num(v)}
    </span>
  );
}

// Список ШК компактными чипами
function ShkChips({ items, tone = 'rose', render }) {
  const tones = {
    rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-800/60',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/60',
    slate: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  };
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={i} className={cn('px-1.5 py-0.5 rounded border text-[11px] font-mono tabular-nums', tones[tone])}>
          {render ? render(it) : it}
        </span>
      ))}
    </div>
  );
}

// Формула баланса: было − пропало − уехало + пришло = стало
function Balance({ p }) {
  const Cell = ({ label, v, tone }) => (
    <div className="flex flex-col items-center px-2">
      <span className={cn('text-base font-bold tabular-nums leading-tight', tone)}>{num(v)}</span>
      <span className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</span>
    </div>
  );
  const Op = ({ s }) => <span className="text-slate-300 dark:text-slate-600 font-bold text-lg select-none">{s}</span>;
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
      <Cell label="было" v={p.was} tone="text-slate-700 dark:text-slate-200" />
      <Op s="−" />
      <Cell label="пропало" v={p.missing.length} tone="text-rose-600 dark:text-rose-400" />
      <Op s="−" />
      <Cell label="уехало" v={p.movedOut.length} tone="text-amber-600 dark:text-amber-400" />
      <Op s="+" />
      <Cell label="пришло" v={p.alien.length} tone="text-emerald-600 dark:text-emerald-400" />
      <Op s="=" />
      <Cell label="стало" v={p.fact} tone="text-slate-900 dark:text-slate-50" />
      <div className="ml-3 text-[11px] text-slate-400 leading-tight">
        Считаем только коробки с товаром.
        {!!p.wasGhosts && <> В учёте ещё {p.wasGhosts} пустых (qty = 0) — в баланс не входят.</>}
      </div>
    </div>
  );
}

// ─── Детали паллета ───────────────────────────────────────────────────────────
function PalletDetails({ p }) {
  const alienByFrom = useMemo(() => {
    const m = {};
    for (const a of p.alien) (m[a.from] = m[a.from] || []).push(a);
    return m;
  }, [p]);
  const movedByTo = useMemo(() => {
    const m = {};
    for (const a of p.movedOut) (m[a.to] = m[a.to] || []).push(a);
    return m;
  }, [p]);

  if (p.unresolved) {
    return (
      <div className="bg-slate-50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-700 px-4 py-3 space-y-2 text-xs">
        <div className="text-slate-600 dark:text-slate-300">
          Лист «{p.sheets[0].name}» не подписан адресом и не привязан вручную.
          {p.guess ? <> По штрихкодам похоже на <b className="text-primary-600 dark:text-primary-400">{p.guess}</b>.</> : ' Ни один ШК не совпал с известным паллетом.'}
        </div>
        <div className="text-slate-500">Отсканировано: {p.sheets[0].scans}, коробок с товаром: {p.fact}, пустых: {p.emptyScan.length}, не найдено в базе: {p.notFound.length}.</div>
        <div className="text-amber-600 dark:text-amber-400 font-medium">
          Пропишите лист в SHEET_MAP (backend/src/scripts/palletAudit.js) и пересоберите отчёт.
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-700 px-4 py-3 space-y-3">
      <Balance p={p} />

      {!p.audited && (
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Лист сверки по этому паллету не приносили. В учёте числится {p.was} коробок с товаром
          ({num(p.wasQty)} шт){!!p.wasGhosts && <> и {p.wasGhosts} пустых</>}.
          {p.movedOut.length
            ? <> Из них {p.movedOut.length} нашлись физически на других паллетах, остальные {p.missing.length} — нигде.</>
            : <> Ни одна коробка не встретилась ни на одном листе — все {p.missing.length} числятся пропавшими.</>}
        </div>
      )}

      {/* по товарам */}
      {!!Object.keys(p.byProduct).length && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 text-[11px] uppercase">
                <th className="text-left font-medium py-1">Товар</th>
                <th className="text-right font-medium px-2">Было кор.</th>
                <th className="text-right font-medium px-2">Стало кор.</th>
                <th className="text-right font-medium px-2">Δ</th>
                <th className="text-right font-medium px-2">Было шт</th>
                <th className="text-right font-medium px-2">Стало шт</th>
                <th className="text-right font-medium px-2">Δ шт</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(p.byProduct).map(([name, v]) => (
                <tr key={name} className="border-t border-slate-200 dark:border-slate-800">
                  <td className="py-1 pr-2 text-slate-700 dark:text-slate-200">{name}</td>
                  <td className="text-right px-2 tabular-nums">{v.was}</td>
                  <td className="text-right px-2 tabular-nums">{v.fact}</td>
                  <td className="text-right px-2"><Delta v={v.fact - v.was} /></td>
                  <td className="text-right px-2 tabular-nums text-slate-500">{num(v.wasQty)}</td>
                  <td className="text-right px-2 tabular-nums text-slate-500">{num(v.factQty || 0)}</td>
                  <td className="text-right px-2"><Delta v={(v.factQty || 0) - v.wasQty} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* пропало */}
      {!!p.missing.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-rose-600 dark:text-rose-400">
            <PackageX size={13} /> Пропало — {p.missing.length} кор. ({num(p.missing.reduce((a, m) => a + m.qty, 0))} шт), не найдены ни на одном листе
          </div>
          <ShkChips items={p.missing} tone="rose" render={(m) => `${m.shk}·${m.qty}`} />
        </div>
      )}

      {/* уехало */}
      {!!p.movedOut.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
            <Truck size={13} /> Уехало — {p.movedOut.length} кор. ({num(p.movedOut.reduce((a, m) => a + m.qty, 0))} шт) числятся здесь, найдены на другом паллете
          </div>
          <div className="space-y-1.5">
            {Object.entries(movedByTo).map(([to, list]) => (
              <div key={to} className="flex flex-wrap items-start gap-2">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-semibold shrink-0">
                  на {to} · {list.length} кор.
                </span>
                <ShkChips items={list} tone="amber" render={(a) => `${a.shk}·${a.qty}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* пришло */}
      {!!p.alien.length && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <PackagePlus size={13} /> Пришло — {p.alien.length} кор. ({num(p.alien.reduce((a, m) => a + m.qty, 0))} шт) с других паллет
          </div>
          <div className="space-y-1.5">
            {Object.entries(alienByFrom).map(([from, list]) => (
              <div key={from} className="flex flex-wrap items-start gap-2">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-semibold shrink-0">
                  из {from} · {list.length} кор.
                </span>
                <span className="text-[11px] text-slate-500 shrink-0 max-w-[280px] truncate">{list[0].product}</span>
                <ShkChips items={list} tone="emerald" render={(a) => `${a.shk}·${a.qty}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* прочее */}
      <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        {!!p.emptyScan.length && (
          <div>
            <span className="font-semibold">Пустые коробки, найденные физически ({p.emptyScan.length}):</span> <span className="font-mono">{p.emptyScan.join(', ')}</span>
            <span className="italic"> — в учёте qty = 0, в баланс не входят</span>
          </div>
        )}
        {!!p.ghosts && (
          <div><Ghost size={11} className="inline mr-1" /><span className="font-semibold">Пустых коробок в учёте:</span> {p.ghosts} (qty = 0, в баланс не входят)</div>
        )}
        {!!p.dupes.length && (
          <div><span className="font-semibold">Дубли скана внутри листа ({p.dupes.length}):</span> <span className="font-mono">{p.dupes.join(', ')}</span></div>
        )}
        {!!p.crossDupes?.length && (
          <div>
            <span className="font-semibold text-amber-600">Отсканировано дважды на разных листах ({p.crossDupes.length}):</span>{' '}
            <span className="font-mono">{p.crossDupes.map((c) => `${c.shk}→${c.countedAt}`).join(', ')}</span>
            <span className="italic"> — коробка засчитана один раз, там где её системный адрес</span>
          </div>
        )}
        {!!p.notFound.length && (
          <div><span className="font-semibold text-amber-600">Нет в базе ({p.notFound.length}):</span> <span className="font-mono">{p.notFound.join(', ')}</span></div>
        )}
        {!!p.odd.length && (
          <div><span className="font-semibold">Нестандартное наполнение:</span> <span className="font-mono">{p.odd.map((o) => `${o.shk}·${o.qty}`).join(', ')}</span></div>
        )}
      </div>

      {/* листы источника */}
      {!!p.sheets.length && (
        <div className="text-[11px] text-slate-400 border-t border-slate-200 dark:border-slate-800 pt-2">
          Источник: {p.sheets.map((s) => (
            <span key={s.name} className="mr-3">
              лист «{s.name}» ({s.scans} скан.)
              {s.overridden && (
                <span className="text-rose-600 dark:text-rose-400 font-semibold">
                  {' '}— в файле подписан как {s.claimedHeader}, но {s.spread[0].n} из {s.spread.reduce((a, x) => a + x.n, 0)} сканов система относит к {p.pallet} → отнесено сюда
                </span>
              )}
              {s.manual && (
                <span className="text-blue-600 dark:text-blue-400 font-semibold"> — без подписи в файле, привязан вручную к {p.pallet}</span>
              )}
              {!s.overridden && !s.manual && s.spread.length > 1 && (
                <span className="text-slate-400"> · часть коробок системно числится на: {s.spread.filter((x) => x.p !== p.pallet).map((x) => `${x.p}:${x.n}`).join(', ')}</span>
              )}
              {s.lowConfidence && !s.overridden && (
                <span className="text-rose-600 dark:text-rose-400 font-semibold"> · ⚠ заметная часть коробок с этого листа системно числится на другом паллете — проверьте, не перепутан ли лист</span>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Страница ─────────────────────────────────────────────────────────────────
const FILTERS = [
  { id: 'all', label: 'Все паллеты' },
  { id: 'audited', label: 'Сверенные' },
  { id: 'notAudited', label: 'Не сверялись' },
  { id: 'diff', label: 'С расхождениями' },
];

export default function PalletAuditPage() {
  const [open, setOpen] = useState(() => new Set());
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const t = audit.totals;
  const toggle = (id) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pallets = useMemo(() => {
    const s = q.trim().toLowerCase();
    return audit.pallets.filter((p) => {
      if (filter === 'audited' && !p.audited) return false;
      if (filter === 'notAudited' && p.audited) return false;
      if (filter === 'diff' && p.fact === p.was && !p.movedOut?.length && !p.alien.length) return false;
      if (!s) return true;
      return p.pallet.toLowerCase().includes(s)
        || p.products.some((x) => (x || '').toLowerCase().includes(s))
        || p.missing.some((m) => m.shk.includes(s))
        || p.alien.some((a) => a.shk.includes(s))
        || (p.movedOut || []).some((m) => m.shk.includes(s));
    });
  }, [q, filter]);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* шапка */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <ClipboardCheck size={20} className="text-primary-500" /> Сверка паллет
          </h1>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Все {t.totalWarehousePallets} паллет склада «{audit.warehouse}» · сверено {t.auditedCount}, без листа {t.notAuditedCount}
            {' · '}баланс: было − пропало − уехало + пришло = стало
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn('px-3 py-1.5 transition',
                  filter === f.id
                    ? 'bg-primary-500 text-white font-semibold'
                    : 'bg-white dark:bg-slate-900 text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800')}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-64">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Паллет, товар или ШК…" icon={<Search size={16} />} />
          </div>
        </div>
      </div>

      {/* ── Паллеты ── */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-[11px] uppercase text-slate-400">
              <tr>
                <th className="text-left font-medium px-3 py-1.5 w-24">Паллет</th>
                <th className="text-left font-medium px-2 py-1.5">Товар</th>
                <th className="text-right font-medium px-2 py-1.5 w-28">Было</th>
                <th className="text-right font-medium px-2 py-1.5 w-16">Стало</th>
                <th className="text-right font-medium px-2 py-1.5 w-16">Δ кор.</th>
                <th className="text-right font-medium px-2 py-1.5 w-20">Δ шт</th>
                <th className="text-right font-medium px-2 py-1.5 w-20">Пропало</th>
                <th className="text-right font-medium px-2 py-1.5 w-20">Уехало</th>
                <th className="text-right font-medium px-2 py-1.5 w-20">Пришло</th>
                <th className="text-left font-medium px-2 py-1.5 w-32">Заполнено</th>
              </tr>
            </thead>
            <tbody>
              {pallets.map((p) => {
                const isOpen = open.has(p.pallet);

                if (p.unresolved) {
                  return (
                    <Fragment key={p.pallet}>
                      <tr
                        onClick={() => toggle(p.pallet)}
                        className={cn('border-t border-slate-100 dark:border-slate-800 cursor-pointer transition bg-amber-50/40 dark:bg-amber-900/5',
                          isOpen ? 'bg-amber-50 dark:bg-amber-900/10' : 'hover:bg-amber-50/70 dark:hover:bg-amber-900/10')}
                      >
                        <td className="px-3 py-1 font-bold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            {p.pallet}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-amber-700/80 dark:text-amber-400/80 text-xs" colSpan={8}>
                          адрес не подписан{p.guess ? <> — похоже на <b>{p.guess}</b>, нужна ручная привязка</> : ', ни один ШК не совпал'}
                          {' · '}{p.fact} кор.
                        </td>
                        <td />
                      </tr>
                      {isOpen && <tr><td colSpan={10} className="p-0"><PalletDetails p={p} /></td></tr>}
                    </Fragment>
                  );
                }

                const d = p.fact - p.was;
                const fill = pct(p.fact, p.was);
                const flagged = p.sheets.some((s) => s.lowConfidence || s.overridden);
                const manual = p.sheets.some((s) => s.manual);
                const empty = !p.was && !p.fact;

                return (
                  <Fragment key={p.pallet}>
                    <tr
                      onClick={() => toggle(p.pallet)}
                      className={cn('border-t border-slate-100 dark:border-slate-800 cursor-pointer transition',
                        !p.audited && 'bg-slate-50/60 dark:bg-slate-800/20',
                        isOpen ? 'bg-slate-50 dark:bg-slate-800/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800/30')}
                    >
                      <td className={cn('px-3 py-1 font-bold whitespace-nowrap',
                        p.audited ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500')}>
                        <span className="inline-flex items-center gap-1">
                          {isOpen ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                          {p.pallet}
                        </span>
                        {flagged && (
                          <AlertTriangle size={11} className="inline ml-1 text-rose-500" title="Подпись листа под вопросом — коробки системно числятся на другом паллете, проверьте вручную" />
                        )}
                        {manual && !flagged && (
                          <span className="inline-block ml-1 w-1.5 h-1.5 rounded-full bg-blue-400" title="Лист привязан к паллету вручную" />
                        )}
                      </td>
                      <td className="px-2 py-1 text-xs">
                        {!p.audited ? (
                          <span className="text-slate-400 italic">не сверялся — листа нет</span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-300">
                            {p.products.length === 1 ? p.products[0] : p.products.length ? `${p.products.length} наименования` : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">
                        <span className="font-semibold">{p.was}</span>
                        {!!p.wasGhosts && (
                          <span className="text-[10px] text-slate-400 font-normal"> / {p.wasTotal} · {p.wasGhosts} пуст.</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-semibold">{p.fact}</td>
                      <td className="px-2 py-1 text-right"><Delta v={d} /></td>
                      <td className="px-2 py-1 text-right"><Delta v={p.factQty - p.wasQty} className="text-xs" /></td>
                      <td className="px-2 py-1 text-right">
                        {p.missing.length
                          ? <span className="text-rose-600 dark:text-rose-400 font-semibold tabular-nums">−{p.missing.length}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {p.movedOut?.length
                          ? <span className="text-amber-600 dark:text-amber-400 font-semibold tabular-nums">−{p.movedOut.length}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {p.alien.length
                          ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">+{p.alien.length}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1">
                        {empty ? (
                          <span className="text-[11px] text-slate-300">пусто и в учёте, и физически</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div
                                className={cn('h-full rounded-full', fill >= 95 ? 'bg-emerald-500' : fill >= 70 ? 'bg-amber-500' : 'bg-rose-500')}
                                style={{ width: `${Math.min(fill ?? 100, 100)}%` }}
                              />
                            </div>
                            <span className="text-[11px] tabular-nums text-slate-500 w-9 text-right">{fill == null ? '—' : `${fill}%`}</span>
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && <tr><td colSpan={10} className="p-0"><PalletDetails p={p} /></td></tr>}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot className="bg-slate-50 dark:bg-slate-800/60 font-semibold">
              <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                <td className="px-3 py-1.5">ИТОГО</td>
                <td className="px-2 py-1.5 text-xs text-slate-400">
                  {t.totalWarehousePallets} паллет · сверено {t.auditedCount}
                  {!!t.notAuditedCount && <span className="text-slate-400"> · без листа {t.notAuditedCount}</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">
                  <span>{num(t.was)}</span>
                  {!!t.ghosts && <span className="text-[10px] text-slate-400 font-normal"> / {num(t.was + t.ghosts)} · {num(t.ghosts)} пуст.</span>}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(t.fact)}</td>
                <td className="px-2 py-1.5 text-right"><Delta v={t.fact - t.was} /></td>
                <td className="px-2 py-1.5 text-right"><Delta v={t.factQty - t.wasQty} className="text-xs" /></td>
                <td className="px-2 py-1.5 text-right text-rose-600 dark:text-rose-400 tabular-nums">−{num(t.missing)}</td>
                <td className="px-2 py-1.5 text-right text-amber-600 dark:text-amber-400 tabular-nums">−{num(t.movedOut)}</td>
                <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400 tabular-nums">+{num(t.alien)}</td>
                <td className="px-2 py-1.5 text-[11px] text-slate-500">{pct(t.fact, t.was)}% в среднем</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
        <Copy size={11} />
        «Уехало» и «пришло» — это одни и те же коробки с двух сторон: всего перемещений {num(t.movedOut)}.
        Пустые коробки (qty = 0) в баланс не входят — их {num(t.ghosts)} в учёте.
      </div>
    </div>
  );
}

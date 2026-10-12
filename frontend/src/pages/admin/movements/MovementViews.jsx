import { useState, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ExternalLink, Users, CalendarDays } from 'lucide-react';
import api from '../../../api/client';
import Spinner from '../../../components/ui/Spinner';
import SortTh from '../../../components/ui/SortTh';
import { cn } from '../../../utils/cn';
import { fmtQty } from '../../../utils/fmt';

const DASH = '—';

export const fmtDay = (d) => {
  if (!d) return DASH;
  const date = new Date(d);
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export const fmtDayLong = (d) => {
  if (!d) return DASH;
  const date = new Date(d);
  const wd = date.toLocaleDateString('ru-RU', { weekday: 'short' });
  return `${date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}, ${wd}`;
};

const fmtWhen = (iso) => {
  if (!iso) return DASH;
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// Доля канала в общем количестве — тонкая полоска под числом.
function ChannelBar({ wb, ozon, other, total }) {
  if (!total) return null;
  const pct = (v) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div className="flex h-1 w-full rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mt-1">
      {wb > 0 && <div className="bg-[#cb11ab]" style={{ width: pct(wb) }} title={`WB: ${fmtQty(wb)}`} />}
      {ozon > 0 && <div className="bg-[#005bff]" style={{ width: pct(ozon) }} title={`Ozon: ${fmtQty(ozon)}`} />}
      {other > 0 && <div className="bg-gray-400" style={{ width: pct(other) }} title={`Склад: ${fmtQty(other)}`} />}
    </div>
  );
}

// ─── Детализация товара (раскрытая строка) ────────────────────────────────────
function ProductDetail({ productId, params }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(`/movements/analytics/product/${productId}`, { params })
      .then(r => { if (alive) setData(r.data); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productId, params]);

  if (loading) return <div className="py-6 flex justify-center"><Spinner /></div>;
  if (!data) return <div className="py-4 text-sm text-gray-400">Не удалось загрузить детализацию</div>;

  const maxDay = Math.max(1, ...data.by_day.map(d => d.qty));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4 px-2">
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <CalendarDays size={13} /> По дням
        </div>
        {!data.by_day.length ? <p className="text-sm text-gray-400">Нет данных</p> : (
          <div className="space-y-1.5">
            {data.by_day.map(d => (
              <div key={d.day} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0 text-gray-500 tabular-nums">{fmtDayLong(d.day)}</span>
                <div className="flex-1 h-4 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
                  <div className="bg-[#cb11ab] h-full" style={{ width: `${(d.qty_wb / maxDay) * 100}%` }} />
                  <div className="bg-[#005bff] h-full" style={{ width: `${(d.qty_ozon / maxDay) * 100}%` }} />
                  <div className="bg-gray-400 h-full" style={{ width: `${((d.qty - d.qty_wb - d.qty_ozon) / maxDay) * 100}%` }} />
                </div>
                <span className="w-12 text-right font-semibold tabular-nums">{fmtQty(d.qty)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="flex items-center gap-2 mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <Users size={13} /> Кто списывал
        </div>
        {!data.by_employee.length ? <p className="text-sm text-gray-400">Нет данных</p> : (
          <table className="w-full text-sm">
            <tbody>
              {data.by_employee.map(e => (
                <tr key={e.employee_name} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                  <td className="py-1.5 pr-3 text-gray-700 dark:text-gray-300">{e.employee_name}</td>
                  <td className="py-1.5 w-20 text-right font-semibold tabular-nums">{fmtQty(e.qty)}</td>
                  <td className="py-1.5 w-24 text-right text-xs text-gray-400 tabular-nums">{e.ops} оп.</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Вид «По товарам» ─────────────────────────────────────────────────────────
export function ProductTable({ rows, loading, sort, onSort, detailParams }) {
  const [openId, setOpenId] = useState(null);
  const maxQty = Math.max(1, ...rows.map(r => r.qty));
  // Колонки каналов показываем только если по ним вообще что-то есть:
  // у сборки наборов и прихода маркетплейса нет, и пустые столбцы только мешают.
  const hasWb = rows.some(r => r.qty_wb > 0);
  const hasOzon = rows.some(r => r.qty_ozon > 0);
  const hasOther = rows.some(r => r.qty_other > 0);
  const colCount = 6 + [hasWb, hasOzon, hasOther].filter(Boolean).length;

  if (loading) return <div className="card py-20 flex justify-center"><Spinner /></div>;
  if (!rows.length) {
    return (
      <div className="card py-16 text-center text-gray-400">
        <p className="text-sm">За выбранный период движений нет</p>
        <p className="text-xs mt-1">Измените период или категорию операций</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table min-w-[1080px]">
          <thead>
            <tr>
              <th className="w-8" />
              <SortTh label="Товар" sortKey="name" sort={sort} onSort={onSort} className="min-w-[340px]" />
              <SortTh label="Количество" sortKey="qty" sort={sort} onSort={onSort} className="text-right w-32" />
              {hasWb && <th className="text-right w-24 whitespace-nowrap">WB</th>}
              {hasOzon && <th className="text-right w-24 whitespace-nowrap">Ozon</th>}
              {hasOther && <th className="text-right w-24 whitespace-nowrap">Склад</th>}
              <SortTh label="Операций" sortKey="ops" sort={sort} onSort={onSort} className="text-right w-28 whitespace-nowrap" />
              <th className="text-right w-16 whitespace-nowrap">Дней</th>
              <SortTh label="Последнее" sortKey="last" sort={sort} onSort={onSort} className="text-right w-28" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const open = openId === r.product_id;
              return (
                <Fragment key={r.product_id}>
                  <tr
                    className={cn('cursor-pointer transition-colors', open && 'bg-primary-50/50 dark:bg-primary-900/10')}
                    onClick={() => setOpenId(open ? null : r.product_id)}
                  >
                    <td className="text-gray-400">
                      {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </td>
                    <td>
                      <div className="font-medium text-gray-900 dark:text-gray-100 leading-snug">{r.product_name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {r.code && <span className="text-xs text-gray-400 font-mono">{r.code}</span>}
                        {r.product_id && (
                          <Link
                            to={`/admin/products?id=${r.product_id}`}
                            onClick={e => e.stopPropagation()}
                            className="text-xs text-primary-500 hover:text-primary-600 inline-flex items-center gap-0.5"
                          >
                            карточка <ExternalLink size={10} />
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="font-bold text-base tabular-nums text-gray-900 dark:text-gray-100">{fmtQty(r.qty)}</div>
                      <ChannelBar wb={r.qty_wb} ozon={r.qty_ozon} other={r.qty_other} total={maxQty} />
                    </td>
                    {hasWb && (
                      <td className="text-right tabular-nums text-sm">
                        {r.qty_wb ? <span className="text-[#cb11ab] font-medium">{fmtQty(r.qty_wb)}</span> : <span className="text-gray-300">{DASH}</span>}
                      </td>
                    )}
                    {hasOzon && (
                      <td className="text-right tabular-nums text-sm">
                        {r.qty_ozon ? <span className="text-[#005bff] font-medium">{fmtQty(r.qty_ozon)}</span> : <span className="text-gray-300">{DASH}</span>}
                      </td>
                    )}
                    {hasOther && (
                      <td className="text-right tabular-nums text-sm">
                        {r.qty_other ? <span className="text-gray-600 dark:text-gray-300">{fmtQty(r.qty_other)}</span> : <span className="text-gray-300">{DASH}</span>}
                      </td>
                    )}
                    <td className="text-right tabular-nums text-sm text-gray-500">{r.ops}</td>
                    <td className="text-right tabular-nums text-sm text-gray-500">{r.days}</td>
                    <td className="text-right text-xs text-gray-400 whitespace-nowrap">{fmtWhen(r.last_at)}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={colCount} className="bg-gray-50/60 dark:bg-gray-800/20 !py-0">
                        <ProductDetail productId={r.product_id} params={detailParams} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Вид «По дням» ────────────────────────────────────────────────────────────
export function DailyTable({ days, loading, onPickDay }) {
  if (loading) return <div className="card py-20 flex justify-center"><Spinner /></div>;
  if (!days.length) {
    return <div className="card py-16 text-center text-gray-400 text-sm">За выбранный период движений нет</div>;
  }
  const max = Math.max(1, ...days.map(d => d.qty));

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-36">День</th>
              <th className="min-w-[280px]">Распределение</th>
              <th className="text-right w-28">Количество</th>
              <th className="text-right w-24">WB</th>
              <th className="text-right w-24">Ozon</th>
              <th className="text-right w-24">Позиций</th>
              <th className="text-right w-28">Операций</th>
            </tr>
          </thead>
          <tbody>
            {days.map(d => (
              <tr
                key={d.day}
                className="cursor-pointer"
                onClick={() => onPickDay?.(String(d.day).slice(0, 10))}
                title="Показать товары за этот день"
              >
                <td className="font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">{fmtDayLong(d.day)}</td>
                <td>
                  <div className="h-5 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden flex min-w-[120px]">
                    <div className="bg-[#cb11ab] h-full" style={{ width: `${(d.qty_wb / max) * 100}%` }} title={`WB: ${fmtQty(d.qty_wb)}`} />
                    <div className="bg-[#005bff] h-full" style={{ width: `${(d.qty_ozon / max) * 100}%` }} title={`Ozon: ${fmtQty(d.qty_ozon)}`} />
                    <div className="bg-gray-400 h-full" style={{ width: `${((d.qty - d.qty_wb - d.qty_ozon) / max) * 100}%` }} />
                  </div>
                </td>
                <td className="text-right font-bold tabular-nums">{fmtQty(d.qty)}</td>
                <td className="text-right tabular-nums text-sm text-[#cb11ab]">{d.qty_wb ? fmtQty(d.qty_wb) : DASH}</td>
                <td className="text-right tabular-nums text-sm text-[#005bff]">{d.qty_ozon ? fmtQty(d.qty_ozon) : DASH}</td>
                <td className="text-right tabular-nums text-sm text-gray-500">{d.products}</td>
                <td className="text-right tabular-nums text-sm text-gray-500">{d.ops}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

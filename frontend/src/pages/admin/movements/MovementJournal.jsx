import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import api from '../../../api/client';
import Spinner from '../../../components/ui/Spinner';
import { getTypeMeta, fmtSource } from '../../../utils/movementTypes';
import { fmtQty } from '../../../utils/fmt';

const DASH = '—';
const LIMIT = 50;

const fmtWhen = (iso) => iso
  ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : DASH;

// Плоский журнал: каждая операция отдельной строкой. Нужен, когда сводных
// цифр мало и надо посмотреть, из какой ячейки и по чьей задаче ушёл товар.
export default function MovementJournal({ filters }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT };
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.employee_id) params.employee_id = filters.employee_id;
      if (filters.search) params.search = filters.search;
      if (filters.category) params.category = filters.category;
      const { data } = await api.get('/movements/history', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setItems([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { setPage(1); }, [filters]);
  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  if (loading) return <div className="card py-20 flex justify-center"><Spinner /></div>;
  if (!items.length) return <div className="card py-16 text-center text-gray-400 text-sm">Операций за период нет</div>;

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table min-w-[1000px]">
            <thead>
              <tr>
                <th className="w-28">Когда</th>
                <th className="w-32">Операция</th>
                <th className="min-w-[300px]">Товар</th>
                <th className="text-right w-20">Кол-во</th>
                <th className="w-40">Откуда</th>
                <th className="w-40">Куда</th>
                <th className="w-44">Выполнил</th>
              </tr>
            </thead>
            <tbody>
              {items.map(m => {
                const meta = getTypeMeta(m.movement_type);
                return (
                  <tr key={m.id}>
                    <td className="text-xs text-gray-500 whitespace-nowrap">{fmtWhen(m.created_at)}</td>
                    <td>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="text-sm text-gray-900 dark:text-gray-100">
                      <span className="line-clamp-2" title={m.product_name || ''}>{m.product_name || DASH}</span>
                    </td>
                    <td className="text-right font-semibold tabular-nums text-sm">{fmtQty(m.quantity)}</td>
                    <td className="text-xs text-gray-500">{fmtSource(m, 'from') || DASH}</td>
                    <td className="text-xs text-gray-500">{fmtSource(m, 'to') || DASH}</td>
                    <td className="text-xs text-gray-500">
                      {m.performer_name || m.from_employee_name || m.to_employee_name || m.performed_by_name || DASH}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">Всего операций: <b className="tabular-nums">{total.toLocaleString('ru-RU')}</b></span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-gray-500 tabular-nums">{page} / {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

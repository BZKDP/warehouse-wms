import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Clock, ScanLine, TrendingUp, Package, ShoppingBag } from 'lucide-react';
import api from '../../api/client';
import Spinner from '../../components/ui/Spinner';
import { GRACoinIcon } from '../../components/ui/WarehouseIcons';
import { formatRub } from '../../utils/currency';

function fmtNum(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(seconds) {
  if (!seconds || seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м`;
  return `${Math.floor(seconds)}с`;
}

function taskTypeLabel(type) {
  if (type === 'bundle_assembly') return 'Сборка';
  if (type === 'packaging') return 'Оприход.';
  if (type === 'production_transfer') return 'Перенос';
  if (type === 'returns') return 'Возвраты';
  return 'Инвент.';
}

function taskTypeBg(type) {
  if (type === 'bundle_assembly') return 'bg-purple-100 text-purple-700';
  if (type === 'packaging') return 'bg-amber-100 text-amber-700';
  if (type === 'production_transfer') return 'bg-sky-100 text-sky-700';
  if (type === 'returns') return 'bg-cyan-100 text-cyan-700';
  return 'bg-indigo-100 text-indigo-700';
}

const MONTH_LABELS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
function currentMonthLabel() {
  const d = new Date();
  return `${MONTH_LABELS_RU[d.getMonth()]} ${d.getFullYear()}`;
}

export default function MyEarningsPage() {
  // Личный кабинет показывает заработок ТОЛЬКО за текущий календарный месяц
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/earnings/my?period=this_month`);
      setData(res.data);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center">
          <GRACoinIcon size={24} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Мой заработок</h1>
          <p className="text-xs text-gray-400">Рубли за {currentMonthLabel()}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-green-50 rounded-2xl p-3 text-center border border-green-100">
              <div className="flex justify-center mb-1 text-green-600 font-black text-lg leading-none">₽</div>
              <p className="text-xl font-black text-green-700">{formatRub(data.summary.total_earned)}</p>
              <p className="text-[9px] uppercase font-semibold text-green-500 mt-0.5">Итого</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-3 text-center border border-gray-100">
              <ScanLine size={18} className="mx-auto mb-1 text-gray-500 opacity-60" />
              <p className="text-xl font-black text-gray-800">{fmtNum(Math.round(parseFloat(data.summary.total_scans)))}</p>
              <p className="text-[9px] uppercase font-semibold text-gray-400 mt-0.5">Пиков</p>
            </div>
            <div className="bg-primary-50 rounded-2xl p-3 text-center border border-primary-100">
              <TrendingUp size={18} className="mx-auto mb-1 text-primary-500 opacity-60" />
              <p className="text-xl font-black text-primary-700">{data.summary.tasks_count}</p>
              <p className="text-[9px] uppercase font-semibold text-primary-400 mt-0.5">Задач</p>
            </div>
          </div>

          {/* Sborka breakdown: pick (товар) + collect (заказы) */}
          {(Number(data.summary.sborka_pick_amount || 0) > 0 || Number(data.summary.sborka_collect_amount || 0) > 0) && (
            <div className="grid grid-cols-3 gap-2 mb-5">
              <div className="bg-indigo-50 rounded-2xl p-3 text-center border border-indigo-100">
                <div className="flex justify-center mb-1 text-indigo-600 font-black text-base leading-none">🏭</div>
                <p className="text-lg font-black text-indigo-700">{formatRub(data.summary.warehouse_earned)}</p>
                <p className="text-[9px] uppercase font-semibold text-indigo-500 mt-0.5">Склад</p>
              </div>
              <div className="bg-purple-50 rounded-2xl p-3 text-center border border-purple-100">
                <Package size={18} className="mx-auto mb-1 text-purple-500 opacity-70" />
                <p className="text-lg font-black text-purple-700">{formatRub(data.summary.sborka_pick_amount)}</p>
                <p className="text-[9px] uppercase font-semibold text-purple-500 mt-0.5">Товар · {fmtNum(data.summary.sborka_pick_units)} ед.</p>
              </div>
              <div className="bg-fuchsia-50 rounded-2xl p-3 text-center border border-fuchsia-100">
                <ShoppingBag size={18} className="mx-auto mb-1 text-fuchsia-500 opacity-70" />
                <p className="text-lg font-black text-fuchsia-700">{formatRub(data.summary.sborka_collect_amount)}</p>
                <p className="text-[9px] uppercase font-semibold text-fuchsia-500 mt-0.5">Заказы · {fmtNum(data.summary.sborka_orders_count)} шт.</p>
              </div>
            </div>
          )}

          {/* Tasks list */}
          {data.tasks.length === 0 ? (
            <div className="text-center py-10 text-gray-300">
              <div className="flex justify-center mb-2 opacity-30"><GRACoinIcon size={32} /></div>
              <p className="text-sm">Нет начислений за этот период</p>
            </div>
          ) : (
            <div className="space-y-2">
              {data.tasks.map(t => {
                const isExpanded = expandedTask === t.task_id;
                const durationSec = t.started_at && t.completed_at
                  ? (new Date(t.completed_at) - new Date(t.started_at)) / 1000 : 0;

                return (
                  <div key={t.task_id || t.title} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    {/* Task header — clickable */}
                    <button
                      onClick={() => setExpandedTask(isExpanded ? null : t.task_id)}
                      className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${taskTypeBg(t.task_type)}`}>
                            {taskTypeLabel(t.task_type)}
                          </span>
                          {t.status === 'completed' && (
                            <span className="text-[10px] text-green-500 font-medium">✓</span>
                          )}
                        </div>
                        <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-black text-green-700">+{formatRub(t.earned)} ₽</p>
                        <p className="text-[10px] text-gray-400">{fmtNum(parseInt(t.total_scans || t.scans || 0))} пиков</p>
                      </div>
                      <ChevronDown size={16} className={`text-gray-300 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="px-3.5 pb-3.5 border-t border-gray-50" style={{ animation: 'fadeIn 0.15s ease-out' }}>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {t.started_at && (
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-gray-400 uppercase font-bold">Время</p>
                              <p className="text-xs font-semibold text-gray-700">
                                {fmtTime(t.started_at)} → {t.completed_at ? fmtTime(t.completed_at) : 'сейчас'}
                              </p>
                            </div>
                          )}
                          {durationSec > 0 && (
                            <div className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[9px] text-gray-400 uppercase font-bold">Длительность</p>
                              <p className="text-xs font-semibold text-gray-700">{fmtDuration(durationSec)}</p>
                            </div>
                          )}
                          <div className="bg-gray-50 rounded-lg px-3 py-2">
                            <p className="text-[9px] text-gray-400 uppercase font-bold">Ср. скорость</p>
                            <p className="text-xs font-semibold text-gray-700">
                              {t.avg_scan_time ? `${t.avg_scan_time} с/пик` : '—'}
                            </p>
                          </div>
                          <div className="bg-green-50 rounded-lg px-3 py-2">
                            <p className="text-[9px] text-green-500 uppercase font-bold">Заработок</p>
                            <p className="text-xs font-black text-green-700">+{formatRub(t.earned)} ₽</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

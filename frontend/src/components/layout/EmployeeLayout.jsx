import { useEffect, useState, useCallback } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  ClipboardList, LogOut, BarChart3, ArrowRightLeft, Package,
  Sparkles, ChevronRight, UtensilsCrossed, Award, Coffee, Wrench, PauseCircle, X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';
import api from '../../api/client';
import { WorkerAvatar } from '../ui/WarehouseIcons';
import { formatRub } from '../../utils/currency';

function GraBalanceCenter({ balance, rewardFx }) {
  const [activeReward, setActiveReward] = useState(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (!rewardFx?.id) return;
    setActiveReward(rewardFx);
    setIsAnimating(true);

    const t1 = setTimeout(() => setIsAnimating(false), 620);
    const t2 = setTimeout(() => setActiveReward(null), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [rewardFx]);

  return (
    <div className={cn('gra-balance-widget', isAnimating && 'is-rewarding')} aria-live="polite">
      <div className="gra-balance-coin">₽</div>
      <div className="gra-balance-copy">
        <span className="gra-balance-label">Оплата за точность</span>
        <strong className="gra-balance-value">{formatRub(balance)} ₽</strong>
      </div>
      {activeReward && (
        <div key={activeReward.id} className="gra-balance-reward">
          +{formatRub(activeReward.amount)} ₽
        </div>
      )}
    </div>
  );
}

const navItems = [
  {
    to: '/employee/tasks',
    icon: ClipboardList,
    label: 'Задачи',
    color: 'text-blue-500',
    activeBg: 'bg-blue-50',
    activeText: 'text-blue-600',
    activeRing: 'ring-blue-200',
  },
  {
    to: '/employee/move',
    icon: ArrowRightLeft,
    label: 'Переместить',
    color: 'text-purple-500',
    activeBg: 'bg-purple-50',
    activeText: 'text-purple-600',
    activeRing: 'ring-purple-200',
  },
  {
    to: '/employee/earnings',
    icon: Award,
    label: 'Заработок',
    color: 'text-amber-500',
    activeBg: 'bg-amber-50',
    activeText: 'text-amber-600',
    activeRing: 'ring-amber-200',
  },
  {
    to: '/employee/inventory',
    icon: Package,
    label: 'Мой товар',
    color: 'text-emerald-500',
    activeBg: 'bg-emerald-50',
    activeText: 'text-emerald-600',
    activeRing: 'ring-emerald-200',
  },
];

export default function EmployeeLayout({ children }) {
  const { user, logout, rewardFx } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTasks, setActiveTasks] = useState(0);
  const [activeBreak, setActiveBreak] = useState(null); // { id, break_type, started_at }
  const [breakLoading, setBreakLoading] = useState(false);
  const [showBreakMenu, setShowBreakMenu] = useState(false);

  const loadBreak = useCallback(() => {
    api.get('/staff/breaks/active').then(r => {
      setActiveBreak(r.data.on_break ? r.data.break : null);
    }).catch(() => {});
  }, []);

  useEffect(() => { loadBreak(); }, [loadBreak]);

  // Load active tasks count for badge
  useEffect(() => {
    api.get('/tasks', { params: { limit: 100 } })
      .then(r => setActiveTasks((r.data.items || []).filter(t => t.status === 'in_progress' || t.status === 'new').length))
      .catch(() => {});
  }, [location.pathname]);

  const startBreak = async (type) => {
    setBreakLoading(true);
    try {
      const r = await api.post('/staff/breaks/start', { break_type: type });
      setActiveBreak(r.data);
      setShowBreakMenu(false);
    } catch {} finally { setBreakLoading(false); }
  };

  const endBreak = async () => {
    setBreakLoading(true);
    try {
      await api.post('/staff/breaks/end');
      setActiveBreak(null);
    } catch (err) {
      if (err.response?.data?.error) alert(err.response.data.error);
    } finally { setBreakLoading(false); }
  };

  const breakLabel = activeBreak?.break_type === 'lunch' ? 'Обед'
    : activeBreak?.break_type === 'rest' ? 'Перерыв'
    : activeBreak?.break_type === 'tech' ? 'Тех. проблема' : 'Перерыв';

  const breakColor = activeBreak?.break_type === 'tech'
    ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-300'
    : activeBreak ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300 animate-pulse'
    : 'bg-gray-100 text-gray-500';

  const currentNav = navItems.find(n => location.pathname.startsWith(n.to));

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* ─── Header ─── */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 sticky top-0 z-10">
        <div className="grid grid-cols-[minmax(92px,1fr)_auto_minmax(92px,1fr)] sm:grid-cols-[minmax(150px,1fr)_auto_minmax(150px,1fr)] items-center gap-2 min-h-[64px] px-3 sm:px-4 tsd-header">
          {/* Left: Logo + page title */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-sm shadow-primary-200">
              <BarChart3 size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-gray-900 dark:text-white text-sm leading-tight block truncate">GRAсклад</span>
              <span className="text-[10px] text-gray-400 leading-tight block">Сотрудник</span>
            </div>
          </div>

          {/* Center: GRA balance */}
          <div className="flex justify-center px-1 min-w-0">
            <GraBalanceCenter balance={user?.gra_balance} rewardFx={rewardFx} />
          </div>

          {/* Right: User info + logout */}
          <div className="flex items-center justify-end gap-1.5 sm:gap-2 min-w-0">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
              <WorkerAvatar size={24} />
            </div>
            <button onClick={() => { if (window.confirm('Выйти из аккаунта?')) { logout(); navigate('/login'); } }}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950 transition-all flex-shrink-0">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main content ─── */}
      <main className="flex-1 overflow-y-auto pb-24">
        {children}
      </main>

      {/* ─── Bottom Navigation ─── */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border-t border-gray-100 dark:border-gray-800 safe-area-inset-bottom z-20">
        <div className="flex items-center justify-around h-[68px] px-1 sm:px-2 max-w-lg mx-auto tsd-nav gap-0.5">
          {navItems.map(item => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => cn(
                'employee-nav-item group relative flex flex-col items-center gap-0.5 px-2.5 sm:px-4 py-2 rounded-2xl transition-all duration-200 min-w-[52px]',
                isActive
                  ? `${item.activeBg} ${item.activeText} ring-1 ${item.activeRing} shadow-sm`
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              )}>
              {({ isActive }) => (
                <>
                  <div className={cn(
                    'relative transition-transform duration-200',
                    isActive && 'scale-110'
                  )}>
                    <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                    {item.to === '/employee/tasks' && activeTasks > 0 && !isActive && (
                      <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold px-1">{activeTasks}</span>
                    )}
                    {isActive && (
                      <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-current opacity-60 animate-pulse" />
                    )}
                  </div>
                  <span className={cn(
                    'text-[11px] font-semibold leading-tight transition-all',
                    isActive ? 'opacity-100' : 'opacity-70'
                  )}>
                    {item.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
          {/* Break button in nav */}
          <button
            onClick={() => activeBreak ? (activeBreak.break_type === 'tech' ? null : endBreak()) : setShowBreakMenu(true)}
            disabled={breakLoading || (activeBreak?.break_type === 'tech')}
            className={cn(
              'employee-nav-item group relative flex flex-col items-center gap-0.5 px-2.5 sm:px-3 py-2 rounded-2xl transition-all duration-200 min-w-[52px]',
              activeBreak
                ? activeBreak.break_type === 'tech'
                  ? 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 shadow-sm'
                  : 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 shadow-sm animate-pulse'
                : 'text-gray-400 hover:text-gray-600'
            )}
          >
            <div className="relative transition-transform duration-200">
              {activeBreak?.break_type === 'tech' ? <Wrench size={22} /> : activeBreak ? <UtensilsCrossed size={22} /> : <PauseCircle size={22} />}
            </div>
            <span className="text-[10px] font-semibold leading-tight">
              {activeBreak ? breakLabel : 'Перерыв'}
            </span>
          </button>
        </div>
      </nav>

      {/* Break type selection modal */}
      {showBreakMenu && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowBreakMenu(false)} />
          <div className="fixed bottom-24 left-4 right-4 max-w-sm mx-auto z-50 bg-white rounded-2xl shadow-xl p-4 space-y-2" style={{ animation: 'fadeIn 0.15s ease-out' }}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-gray-900">Выберите перерыв</p>
              <button onClick={() => setShowBreakMenu(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <button onClick={() => startBreak('lunch')} disabled={breakLoading}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-amber-50 hover:bg-amber-100 transition-colors">
              <UtensilsCrossed size={20} className="text-amber-600" />
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Обеденный перерыв</p>
                <p className="text-[10px] text-gray-400">Вы сами снимете когда вернётесь</p>
              </div>
            </button>
            <button onClick={() => startBreak('rest')} disabled={breakLoading}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-blue-50 hover:bg-blue-100 transition-colors">
              <Coffee size={20} className="text-blue-600" />
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Обычный перерыв</p>
                <p className="text-[10px] text-gray-400">Вы сами снимете когда вернётесь</p>
              </div>
            </button>
            <button onClick={() => startBreak('tech')} disabled={breakLoading}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-rose-50 hover:bg-rose-100 transition-colors">
              <Wrench size={20} className="text-rose-600" />
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900">Техническая проблема</p>
                <p className="text-[10px] text-gray-400">Снять может только администратор</p>
              </div>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

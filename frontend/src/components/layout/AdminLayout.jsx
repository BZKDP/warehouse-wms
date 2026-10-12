import { useState, useEffect } from 'react';
import FeedbackButton from '../ui/FeedbackButton';
import { NavLink, useNavigate, useLocation, useSearchParams, Link } from 'react-router-dom';
import {
  LogOut, Menu, X, ChevronRight,
  ChevronDown, Home
} from 'lucide-react';

// ─── Inline SVG Icons (stroke-only, matching design system) ─────────────────
const IconPackage = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4"/><line x1="12" y1="22" x2="12" y2="11"/></svg>
);
const IconLayoutGrid = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
);
const IconPackageSearch = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7L12 3 4 7v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4"/><line x1="12" y1="22" x2="12" y2="11"/><circle cx="18.5" cy="18.5" r="3.5"/><line x1="21" y1="21" x2="20" y2="20"/></svg>
);
const IconFlask = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6M12 3v7l-5 8.5a2 2 0 001.7 3h6.6a2 2 0 001.7-3L12 10V3"/></svg>
);
const IconBarcodeConflict = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5v14M7 5v14M11 5v14M15 5v8M19 5v8"/><path d="M16 18h6M19 15v6"/></svg>
);
const IconWarehouse = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="13" rx="1"/><path d="M2 9.5L12 3l10 6.5"/><line x1="7" y1="14" x2="17" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></svg>
);
const IconClipboard = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><polyline points="8 10 10 12 14 8"/><line x1="8" y1="16" x2="16" y2="16"/></svg>
);
const IconBarChart = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
);
const IconCoins = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v10"/><path d="M9 9.5C9 8.67 10.34 8 12 8s3 .67 3 1.5S13.66 11 12 11s-3 .67-3 1.5S10.34 14 12 14s3 .67 3 1.5c0 .83-1.34 1.5-3 1.5s-3-.67-3-1.5"/></svg>
);
const IconActivity = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
);
const IconArrows = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
);
const IconHistory = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
);
const IconAudit = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M9 3v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V3"/><path d="m14 12 2 2 5-5"/><path d="M7 12h4"/><path d="M7 16h6"/></svg>
);
const IconUsers = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
);
const IconSettings = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>
);
const IconAlertTriangle = ({ className }) => (
  <svg className={className || "w-[18px] h-[18px]"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
);
import { useAuth } from '../../context/AuthContext';
import { cn } from '../../utils/cn';
import { AdminAvatar, ManagerAvatar, WorkerAvatar } from '../ui/WarehouseIcons';
import api from '../../api/client';

// ─── Конфигурация хлебных крошек ─────────────────────────────────────────────
function buildCrumbs(pathname) {
  if (pathname.startsWith('/admin/products/cards')) return [{ label: 'Товары' }, { label: 'Карточки', to: '/admin/products/cards' }];
  if (pathname.startsWith('/admin/products/materials')) return [{ label: 'Товары' }, { label: 'Сырьё' }];
  if (pathname.startsWith('/admin/products/stock')) return [{ label: 'Товары' }, { label: 'Остатки', to: '/admin/products/stock' }];
  if (pathname.startsWith('/admin/products/barcode-disputes')) return [{ label: 'Товары' }, { label: 'Спорные данные', to: '/admin/products/barcode-disputes' }];
  if (pathname.startsWith('/admin/warehouse'))  return [{ label: 'Склады' }];
  if (pathname.startsWith('/admin/tasks'))      return [{ label: 'Задачи' }];
  if (pathname.startsWith('/admin/analytics'))  return [{ label: 'Аналитика' }];
  if (pathname.startsWith('/admin/earnings'))   return [{ label: 'Заработок' }];
  if (pathname.startsWith('/admin/move'))       return [{ label: 'Переместить' }];
  if (pathname.startsWith('/admin/product-movements')) return [{ label: 'Движение товара' }];
  if (pathname.startsWith('/admin/pallet-audit')) return [{ label: 'Сверка паллет' }];
  if (pathname.startsWith('/admin/live-monitor')) return [{ label: 'Мониторинг' }];
  if (pathname.startsWith('/admin/errors'))     return [{ label: 'Ошибки сканирования' }];
  if (pathname.startsWith('/admin/staff'))      return [{ label: 'Сотрудники' }];
  if (pathname.startsWith('/admin/settings'))   return [{ label: 'Настройки' }];
  if (pathname.startsWith('/admin/fbo'))        return [{ label: 'Паллетный склад' }];
  return [];
}

const GROUP_LABEL_MAP = {
  'порошки': 'Порошки', 'полуфабрикаты': 'Полуфабрикаты', 'этикетки': 'Этикетки',
  'смеси': 'Смеси', 'расходники': 'Расходники', 'другое': 'Другое',
};

const SETTINGS_TABS = { appearance: 'Внешний вид', moysklad: 'МойСклад', scanning: 'Сканирование', gracoin: 'GRACoin', interface: 'Интерфейс', data: 'Данные', api: 'API', security: 'Безопасность', feedback: 'Обращения', changelog: 'История', about: 'О системе' };
const STAFF_TABS = { employees: 'Сотрудники', users: 'Пользователи', roles: 'Роли' };
const EARNINGS_TABS = { summary: 'Сводка', warehouse: 'Склад', assembly: 'Сборки' };
const ANALYTICS_VERSIONS = { v1: 'Версия 1', v2: 'Версия 2' };
const ERRORS_TABS = { scan: 'Сканирование', system: 'Система' };
const MOVEMENTS_VIEWS = { all: 'Все', by_employee: 'По сотрудникам', by_type: 'По типам' };

function Breadcrumb() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [entityName, setEntityName] = useState(null);
  const path = location.pathname;
  const id = searchParams.get('id');
  const tab = searchParams.get('tab');
  const group = searchParams.get('group');
  const type = searchParams.get('type');
  const employee = searchParams.get('employee');
  const view = searchParams.get('view');
  const v = searchParams.get('v');
  const row = searchParams.get('row');
  const pallet = searchParams.get('pallet');
  const task = searchParams.get('task');

  useEffect(() => {
    if (!id) { setEntityName(null); return; }
    if (path.includes('/products/cards') || path.includes('/products/stock')) {
      api.get(`/products/${id}`).then(r => setEntityName(r.data.name)).catch(() => setEntityName(null));
    } else if (path.includes('/products/materials')) {
      api.get(`/materials/${id}`).then(r => setEntityName(r.data.name)).catch(() => setEntityName(null));
    } else {
      setEntityName(null);
    }
  }, [id, path]);

  const crumbs = buildCrumbs(path);
  if (crumbs.length === 0) return null;

  const extra = [];

  // Карточки товаров: тип
  if (path.includes('/products/cards') && type) {
    extra.push({ label: type === 'bundle' ? 'Комплекты' : 'Единичные' });
  }
  // Сырьё: группа
  if (path.includes('/products/materials') && group && GROUP_LABEL_MAP[group]) {
    extra.push({ label: GROUP_LABEL_MAP[group] });
  }
  // Настройки: вкладка
  if (path.includes('/settings') && tab && SETTINGS_TABS[tab]) {
    extra.push({ label: SETTINGS_TABS[tab] });
  }
  // Сотрудники: вкладка + drill
  if (path.includes('/staff')) {
    if (tab && STAFF_TABS[tab]) extra.push({ label: STAFF_TABS[tab] });
    if (employee) extra.push({ label: 'Сотрудник' });
  }
  // Заработок: вкладка + сотрудник + задача
  if (path.includes('/earnings')) {
    if (tab && EARNINGS_TABS[tab]) extra.push({ label: EARNINGS_TABS[tab] });
    if (employee) extra.push({ label: 'Сотрудник' });
    if (task) extra.push({ label: `Задача #${task}` });
  }
  // Аналитика: версия
  if (path.includes('/analytics') && v && ANALYTICS_VERSIONS[v]) {
    extra.push({ label: ANALYTICS_VERSIONS[v] });
  }
  // Ошибки: вкладка
  if (path.includes('/errors') && tab && ERRORS_TABS[tab]) {
    extra.push({ label: ERRORS_TABS[tab] });
  }
  // Перемещения: вид
  if (path.includes('/movements') && view && MOVEMENTS_VIEWS[view]) {
    extra.push({ label: MOVEMENTS_VIEWS[view] });
  }
  // Задачи: выбранная задача
  if (path.includes('/tasks') && id) {
    extra.push({ label: `Задача #${id}` });
  }
  // Склады: склад + стеллаж + полка
  if (path.includes('/warehouse')) {
    const wh = searchParams.get('wh');
    const rack = searchParams.get('rack');
    const shelf = searchParams.get('shelf');
    if (wh) extra.push({ label: `Склад #${wh}` });
    if (rack) extra.push({ label: `Стеллаж #${rack}` });
    if (shelf) extra.push({ label: `Полка #${shelf}` });
  }
  // Паллетный склад: ряд + паллет
  if (path.includes('/fbo')) {
    if (row) extra.push({ label: `Ряд #${row}` });
    if (pallet) extra.push({ label: `Паллет #${pallet}` });
  }
  // Название сущности (товар/материал)
  if (entityName && !path.includes('/tasks')) {
    extra.push({ label: entityName });
  }

  const allCrumbs = [
    { label: 'Главная', to: '/admin', icon: true },
    ...crumbs,
    ...extra,
  ];

  return (
    <div className="flex items-center gap-1.5 px-6 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm">
      {allCrumbs.map((crumb, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <ChevronRight size={13} className="text-gray-300 flex-shrink-0" />}
          {crumb.to ? (
            <Link to={crumb.to} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors flex items-center gap-1">
              {crumb.icon && <Home size={13} />}
              {!crumb.icon && crumb.label}
            </Link>
          ) : (
            <span className={cn(
              'flex items-center gap-1',
              i === allCrumbs.length - 1 ? 'text-gray-800 dark:text-gray-100 font-medium' : 'text-gray-400'
            )}>
              {crumb.icon && <Home size={13} />}
              {!crumb.icon && crumb.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

const ALL_NAV = [
  { to: '/admin/warehouse', icon: IconWarehouse, label: 'Склады', perm: 'warehouse.view' },
  { to: '/admin/tasks', icon: IconClipboard, label: 'Задачи', perm: 'tasks.view' },
  { to: '/admin/analytics', icon: IconBarChart, label: 'Аналитика', perm: 'analytics' },
  { to: '/admin/earnings', icon: IconCoins, label: 'Заработок', perm: 'analytics' },
  { to: '/admin/live-monitor', icon: IconActivity, label: 'Мониторинг', perm: 'analytics' },
  { to: '/admin/move', icon: IconArrows, label: 'Переместить', perm: 'movements.edit' },
  { to: '/admin/product-movements', icon: IconHistory, label: 'Движение товара', perm: 'movements.view' },
  { to: '/admin/pallet-audit', icon: IconAudit, label: 'Сверка паллет', perm: 'warehouse.view' },
  { to: '/admin/staff', icon: IconUsers, label: 'Сотрудники', perm: 'staff.view' },
  { to: '/admin/settings', icon: IconSettings, label: 'Настройки', perm: 'settings' },
];

export default function AdminLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(location.pathname.startsWith('/admin/products'));
  const [openDisputes, setOpenDisputes] = useState(0);
  const userPerms = user?.permissions || [];
  const navItems = ALL_NAV.filter(item => user?.role === 'admin' || userPerms.includes(item.perm));
  const isProductsActive = location.pathname.startsWith('/admin/products');
  const canViewProducts = user?.role === 'admin' || userPerms.includes('products.view');
  const canViewDisputes = user?.role === 'admin' || userPerms.includes('barcode_disputes.view');

  useEffect(() => {
    if (!canViewDisputes) return undefined;
    const loadCount = () => api.get('/barcode-disputes/stats')
      .then((response) => setOpenDisputes(Number(response.data.open || 0) + Number(response.data.decided || 0)))
      .catch(() => {});
    const updateFromEvent = (event) => {
      if (event.detail) setOpenDisputes(Number(event.detail.open || 0) + Number(event.detail.decided || 0));
      else loadCount();
    };
    loadCount();
    window.addEventListener('barcode-disputes-updated', updateFromEvent);
    return () => window.removeEventListener('barcode-disputes-updated', updateFromEvent);
  }, [canViewDisputes]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Sidebar overlay (mobile) */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-64 bg-white dark:bg-gray-900',
        'border-r border-gray-100 dark:border-gray-800',
        'flex flex-col transition-transform duration-300 ease-in-out',
        'lg:static lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-primary-600 flex items-center justify-center">
              <IconBarChart className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-lg tracking-tight">GRAсклад</span>
          </div>
          <button
            className="lg:hidden p-1 rounded-lg text-gray-400 hover:text-gray-600"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {/* Товары — разворачивается */}
          {(canViewProducts || canViewDisputes) && (
            <div>
              <button
                onClick={() => setProductsOpen(v => !v)}
                className={cn('sidebar-link w-full', isProductsActive && 'active')}
              >
                <IconPackage className="w-[18px] h-[18px] flex-shrink-0" />
                <span className="flex-1 text-left">Товары</span>
                <ChevronDown size={14} className={cn('transition-transform duration-200 flex-shrink-0', productsOpen && 'rotate-180')} />
              </button>
              {productsOpen && (
                <div className="ml-3 mt-0.5 mb-0.5 pl-3 border-l-2 border-gray-100 dark:border-gray-800 space-y-0.5">
                  {canViewProducts && <>
                    <NavLink
                      to="/admin/products/cards"
                      className={({ isActive }) => cn('sidebar-link text-[13px] py-1.5', isActive && 'active')}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <IconLayoutGrid className="w-[15px] h-[15px] flex-shrink-0" />
                      <span>Карточки</span>
                    </NavLink>
                    <NavLink
                      to="/admin/products/stock"
                      className={({ isActive }) => cn('sidebar-link text-[13px] py-1.5', isActive && 'active')}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <IconPackageSearch className="w-[15px] h-[15px] flex-shrink-0" />
                      <span>Остатки</span>
                    </NavLink>
                    <NavLink
                      to="/admin/products/materials"
                      className={({ isActive }) => cn('sidebar-link text-[13px] py-1.5', isActive && 'active')}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <IconFlask className="w-[15px] h-[15px] flex-shrink-0" />
                      <span>Сырьё</span>
                    </NavLink>
                  </>}
                  {canViewDisputes && (
                    <NavLink
                      to="/admin/products/barcode-disputes"
                      className={({ isActive }) => cn('sidebar-link text-[13px] py-1.5', isActive && 'active')}
                      onClick={() => setSidebarOpen(false)}
                    >
                      <IconBarcodeConflict className="w-[15px] h-[15px] flex-shrink-0" />
                      <span className="flex-1">Спорные данные</span>
                      {openDisputes > 0 && <span className="min-w-5 rounded-full bg-amber-100 px-1.5 py-0.5 text-center text-[10px] font-bold text-amber-700">{openDisputes}</span>}
                    </NavLink>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Остальные пункты */}
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => cn('sidebar-link', isActive && 'active')}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon className="w-[18px] h-[18px] flex-shrink-0" />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="p-4 border-t border-gray-100 dark:border-gray-800">
          {/* Quick action buttons */}
          <div className="flex items-center gap-1.5 mb-3">
            <FeedbackButton position="admin" />
            {(user?.role === 'admin' || userPerms.includes('errors')) && (
              <NavLink
                to="/admin/errors"
                className={({ isActive }) => cn(
                  'w-9 h-9 rounded-xl flex items-center justify-center transition-all',
                  isActive
                    ? 'bg-rose-100 text-rose-600'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                )}
                title="Ошибки сканирования"
                onClick={() => setSidebarOpen(false)}
              >
                <IconAlertTriangle className="w-4 h-4" />
              </NavLink>
            )}
          </div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              {user?.role === 'admin' ? <AdminAvatar size={26} /> : user?.role === 'manager' ? <ManagerAvatar size={26} /> : <WorkerAvatar size={26} />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{user?.username}</p>
              <p className="text-xs text-gray-400">{user?.role_name || (user?.role === 'admin' ? 'Администратор' : user?.role === 'manager' ? 'Менеджер' : 'Сотрудник')}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
            >
              <LogOut className="w-3.5 h-3.5" />
              Выйти
            </button>
            <p className="text-[10px] text-gray-300 dark:text-gray-600">v7.79.0</p>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center h-14 px-4 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl text-gray-500 hover:bg-gray-100"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 ml-3">
            <div className="w-6 h-6 rounded-lg bg-primary-600 flex items-center justify-center">
              <IconBarChart className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-gray-900">GRAсклад</span>
          </div>
        </header>

        {/* Breadcrumb */}
        <Breadcrumb />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scroll-smooth">
          {children}
        </main>
      </div>
    </div>
  );
}

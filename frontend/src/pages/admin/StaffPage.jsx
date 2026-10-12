import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus, Users, Pencil, Trash2, ChevronDown, ChevronRight, Search, Copy, Check, X,
  Shield, UserCheck, Briefcase, Building2, BadgeCheck, Filter, LayoutGrid, Rows3,
} from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Spinner from '../../components/ui/Spinner';
import { useToast } from '../../components/ui/Toast';
import EmployeeDetailView from './staff/EmployeeDetailView';
import { EmployeeModal, AddEmployeeModal, EditUserModal, UserModal } from './staff/StaffModals';

// ════════════════════════════════════════════════════════════════════════════
// Группировка
// ════════════════════════════════════════════════════════════════════════════
const GROUP_MODES = [
  { key: 'position',   label: 'Должность',  icon: Briefcase },
  { key: 'department', label: 'Отдел',      icon: Building2 },
  { key: 'role',       label: 'Роль',       icon: Shield },
  { key: 'status',     label: 'Статус',     icon: BadgeCheck },
  { key: 'none',       label: 'Без групп',  icon: Rows3 },
];

const STATUS_LABELS = {
  active: 'Работают',
  internship: 'Стажёры',
  pending_employment: 'Оформляются',
  pending_fired: 'Готовятся к увольнению',
  service: 'Служебные',
  unknown: 'Без сотрудника',
  fired: 'Уволенные',
  rejected: 'Не приняты',
  applicant_pending: 'Заявки (ожидают)',
  applicant_approved: 'Заявки (одобрены)',
  applicant_rejected: 'Заявки (отклонены)',
  archived: 'Архив склада',
};

const STATUS_ORDER = [
  'Работают', 'Стажёры', 'Оформляются', 'Готовятся к увольнению',
  'Служебные', 'Без сотрудника',
  'Заявки (ожидают)', 'Заявки (одобрены)', 'Заявки (отклонены)',
  'Уволенные', 'Не приняты', 'Архив склада',
];

const ACTIVE_STATUSES = new Set(['active', 'internship', 'pending_employment', 'pending_fired', 'service', 'unknown']);

// Стабильный цвет аватара по строке
const AVATAR_COLORS = [
  { bg: 'bg-rose-100',    text: 'text-rose-700',    ring: 'ring-rose-200' },
  { bg: 'bg-orange-100',  text: 'text-orange-700',  ring: 'ring-orange-200' },
  { bg: 'bg-amber-100',   text: 'text-amber-700',   ring: 'ring-amber-200' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  { bg: 'bg-teal-100',    text: 'text-teal-700',    ring: 'ring-teal-200' },
  { bg: 'bg-sky-100',     text: 'text-sky-700',     ring: 'ring-sky-200' },
  { bg: 'bg-indigo-100',  text: 'text-indigo-700',  ring: 'ring-indigo-200' },
  { bg: 'bg-violet-100',  text: 'text-violet-700',  ring: 'ring-violet-200' },
  { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200' },
  { bg: 'bg-pink-100',    text: 'text-pink-700',    ring: 'ring-pink-200' },
];
function colorFor(str) {
  const s = String(str || '?');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initialsOf(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}
function isOnline(u) {
  return u?.last_active_at && (Date.now() - new Date(u.last_active_at).getTime()) < 600000;
}

// ════════════════════════════════════════════════════════════════════════════
// Avatar
// ════════════════════════════════════════════════════════════════════════════
function Avatar({ name, size = 40, online }) {
  const c = colorFor(name);
  const px = `${size}px`;
  return (
    <div className="relative flex-shrink-0">
      <div
        className={`rounded-2xl flex items-center justify-center font-bold ring-1 ${c.bg} ${c.text} ${c.ring}`}
        style={{ width: px, height: px, fontSize: Math.round(size * 0.36) }}
      >
        {initialsOf(name)}
      </div>
      {online && (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-green-500 ring-2 ring-white"
          style={{ width: Math.max(10, size * 0.28), height: Math.max(10, size * 0.28) }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Скопировать значение (логин/пароль) — компактный inline-чип
// ════════════════════════════════════════════════════════════════════════════
// Копирование в буфер с фолбэком для HTTP-страниц (где navigator.clipboard недоступен)
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  // Fallback: hidden textarea + execCommand('copy') — работает на http://
  return new Promise((resolve) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      resolve(ok);
    } catch {
      resolve(false);
    }
  });
}

function CopyChip({ text, label, mono = true, className = '' }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  const onClick = async (e) => {
    e.stopPropagation();
    const ok = await copyToClipboard(String(text));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    }
  };
  return (
    <button
      onClick={onClick}
      title={`Копировать ${label}`}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] ${mono ? 'font-mono' : ''} transition-all ${
        copied
          ? 'bg-green-100 text-green-700 ring-1 ring-green-300'
          : 'bg-gray-50 text-gray-600 hover:bg-primary-50 hover:text-primary-600 ring-1 ring-gray-100'
      } ${className}`}
    >
      <span className="max-w-[150px] truncate">{text}</span>
      {copied ? <Check size={11} className="flex-shrink-0" /> : <Copy size={11} className="opacity-50 flex-shrink-0" />}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Карточка статистики (header)
// ════════════════════════════════════════════════════════════════════════════
function StatCard({ icon: Icon, value, label, color }) {
  const colors = {
    green:   'bg-green-50 text-green-600 ring-green-100',
    primary: 'bg-primary-50 text-primary-600 ring-primary-100',
    amber:   'bg-amber-50 text-amber-600 ring-amber-100',
    rose:    'bg-rose-50 text-rose-600 ring-rose-100',
    sky:     'bg-sky-50 text-sky-600 ring-sky-100',
  };
  return (
    <div className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ring-1 ${colors[color] || colors.primary}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-extrabold text-gray-900 leading-tight">{value}</p>
        <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Строка пользователя
// ════════════════════════════════════════════════════════════════════════════
function UserRow({ user, dim, canEdit, onClick, onEdit, onDelete, view = 'list' }) {
  const online = isOnline(user);
  const name = user.employee_name || user.username;
  const isInternship = user.employee_status === 'internship';

  if (view === 'grid') {
    return (
      <button
        onClick={() => onClick?.(user)}
        className={`group w-full text-left bg-white border border-gray-100 rounded-2xl p-4 hover:border-primary-200 hover:shadow-md transition-all ${dim ? 'opacity-60' : ''}`}
      >
        <div className="flex items-start gap-3 mb-3">
          <Avatar name={name} size={44} online={online} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <p className={`text-sm font-bold truncate ${dim ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{name}</p>
              {isInternship && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">стажёр</span>}
            </div>
            {user.position && <p className="text-[11px] text-gray-500 truncate">{user.position}</p>}
            {user.department && <p className="text-[10px] text-gray-400 truncate">{user.department}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
          {user.username && <CopyChip text={user.username} label="логин" />}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 mt-3 pt-3 border-t border-gray-50 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            <button onClick={() => onEdit?.(user)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-primary-50 hover:text-primary-600 transition-all">
              <Pencil size={12} /> Изм.
            </button>
            <button onClick={() => onDelete?.(user.id)} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] text-gray-500 hover:bg-rose-50 hover:text-rose-600 transition-all">
              <Trash2 size={12} /> Удалить
            </button>
          </div>
        )}
      </button>
    );
  }

  // list view (default)
  return (
    <div
      onClick={() => onClick?.(user)}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-primary-50/30 transition-colors border-b border-gray-50 last:border-0 cursor-pointer ${dim ? 'opacity-55' : ''}`}
    >
      <Avatar name={name} size={42} online={online} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold truncate ${dim ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{name}</p>
          {isInternship && (
            <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-orange-100 text-orange-700 border border-orange-200">
              стажёр
            </span>
          )}
          {online && <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-100 text-green-700">online</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {user.position && <p className="text-[11px] text-gray-500 truncate">{user.position}</p>}
          {user.department && (
            <>
              <span className="text-gray-300">·</span>
              <p className="text-[11px] text-gray-400 truncate">{user.department}</p>
            </>
          )}
        </div>
      </div>

      {/* Роль склада */}
      {user.role_name && (
        <div className="hidden md:block flex-shrink-0">
          <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
            {user.role_name}
          </span>
        </div>
      )}

      {/* Логин — кнопка копирования под рукой; пароль скрыт */}
      <div className="hidden sm:flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end max-w-[260px]" onClick={e => e.stopPropagation()}>
        {user.username && <CopyChip text={user.username} label="логин" />}
      </div>

      {/* Действия */}
      {canEdit && (
        <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onEdit?.(user)}
            className="p-2 rounded-xl text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all"
            title="Редактировать"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => onDelete?.(user.id)}
            className="p-2 rounded-xl text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
            title="Удалить"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Группированный список
// ════════════════════════════════════════════════════════════════════════════
function StaffList({ users, groupBy, view, canEdit, onDrill, onEdit, onDelete }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = (k) => setCollapsed(prev => ({ ...prev, [k]: !prev[k] }));

  const getGroupKey = (u) => {
    switch (groupBy) {
      case 'position':   return u.position || '— без должности —';
      case 'department': return u.department || '— без отдела —';
      case 'role':       return u.role_name || '— без роли склада —';
      case 'status':     return STATUS_LABELS[u.employee_status] || u.employee_status || '— без статуса —';
      default:           return '__all__';
    }
  };

  // Группируем
  const groups = useMemo(() => {
    const g = {};
    for (const u of users) {
      const key = getGroupKey(u);
      if (!g[key]) g[key] = [];
      g[key].push(u);
    }
    return g;
  }, [users, groupBy]);

  const sortedGroups = useMemo(() => {
    const entries = Object.entries(groups);
    return entries.sort(([a, la], [b, lb]) => {
      if (groupBy === 'status') {
        const ai = STATUS_ORDER.indexOf(a); const bi = STATUS_ORDER.indexOf(b);
        if (ai !== -1 || bi !== -1) {
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        }
      }
      const aDash = a.startsWith('—'); const bDash = b.startsWith('—');
      if (aDash !== bDash) return aDash ? 1 : -1;
      if (lb.length !== la.length) return lb.length - la.length;
      return a.localeCompare(b, 'ru');
    });
  }, [groups, groupBy]);

  for (const [, list] of sortedGroups) {
    list.sort((a, b) =>
      (a.employee_name || a.username || '').localeCompare(b.employee_name || b.username || '', 'ru')
    );
  }

  if (users.length === 0) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl flex flex-col items-center justify-center py-16 text-gray-400">
        <Users size={42} className="mb-3 opacity-30" />
        <p className="text-sm">Никого не найдено</p>
      </div>
    );
  }

  // Без группировки — простой плоский список / grid
  if (groupBy === 'none') {
    const flat = users.slice().sort((a, b) =>
      (a.employee_name || a.username || '').localeCompare(b.employee_name || b.username || '', 'ru')
    );
    return view === 'grid' ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {flat.map(u => (
          <UserRow
            key={u.id}
            user={u}
            view="grid"
            dim={!ACTIVE_STATUSES.has(u.employee_status || 'active')}
            canEdit={canEdit}
            onClick={onDrill}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    ) : (
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {flat.map(u => (
          <UserRow
            key={u.id}
            user={u}
            dim={!ACTIVE_STATUSES.has(u.employee_status || 'active')}
            canEdit={canEdit}
            onClick={onDrill}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    );
  }

  // С группировкой — секции
  return (
    <div className="space-y-4">
      {sortedGroups.map(([groupKey, list]) => {
        const isOpen = collapsed[groupKey] === undefined ? true : !collapsed[groupKey];
        const allBlocked = list.every(u => !ACTIVE_STATUSES.has(u.employee_status || 'active'));
        const onlineInGroup = list.filter(isOnline).length;
        return (
          <div key={groupKey} className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <button
              onClick={() => toggle(groupKey)}
              className={`w-full px-5 py-3 flex items-center justify-between transition-colors ${
                allBlocked ? 'bg-gray-50/70 hover:bg-gray-100/70' : 'bg-gradient-to-r from-primary-50/50 to-transparent hover:from-primary-50'
              } border-b border-gray-100`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${allBlocked ? 'bg-gray-200 text-gray-500' : 'bg-primary-100 text-primary-700'}`}>
                  <Users size={15} />
                </div>
                <div className="text-left min-w-0">
                  <p className={`text-sm font-bold truncate ${allBlocked ? 'text-gray-500' : 'text-gray-900'}`}>{groupKey}</p>
                  <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">
                    {list.length} чел.{onlineInGroup > 0 && <> · <span className="text-green-600">{onlineInGroup} в сети</span></>}
                  </p>
                </div>
              </div>
              <ChevronDown size={18} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {isOpen && (
              view === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
                  {list.map(u => (
                    <UserRow
                      key={u.id}
                      user={u}
                      view="grid"
                      dim={!ACTIVE_STATUSES.has(u.employee_status || 'active')}
                      canEdit={canEdit}
                      onClick={onDrill}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                </div>
              ) : (
                list.map(u => (
                  <UserRow
                    key={u.id}
                    user={u}
                    dim={!ACTIVE_STATUSES.has(u.employee_status || 'active')}
                    canEdit={canEdit}
                    onClick={onDrill}
                    onEdit={onEdit}
                    onDelete={onDelete}
                  />
                ))
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Roles tab — компактная версия (повторяет логику старой страницы)
// ════════════════════════════════════════════════════════════════════════════
const ALL_PERMISSIONS = [
  { key: 'dashboard', label: 'Дашборд', group: 'Общее' },
  { key: 'analytics', label: 'Аналитика', group: 'Общее' },
  { key: 'settings', label: 'Настройки', group: 'Общее' },
  { key: 'products.view', label: 'Просмотр товаров', group: 'Товары' },
  { key: 'products.edit', label: 'Редактирование товаров', group: 'Товары' },
  { key: 'products.edit_basic', label: 'Правка только названия и ШК', group: 'Товары' },
  { key: 'barcode_disputes.view', label: 'Просмотр спорных данных', group: 'Товары' },
  { key: 'barcode_disputes.resolve', label: 'Принятие решений по ШК', group: 'Товары' },
  { key: 'warehouse.view', label: 'Просмотр склада', group: 'Склад' },
  { key: 'warehouse.edit', label: 'Редактирование склада', group: 'Склад' },
  { key: 'tasks.view', label: 'Просмотр заданий', group: 'Задания' },
  { key: 'tasks.create', label: 'Создание заданий', group: 'Задания' },
  { key: 'tasks.execute', label: 'Выполнение заданий', group: 'Задания' },
  { key: 'staff.view', label: 'Просмотр сотрудников', group: 'Персонал' },
  { key: 'staff.edit', label: 'Управление сотрудниками', group: 'Персонал' },
  { key: 'roles.manage', label: 'Управление ролями', group: 'Персонал' },
  { key: 'movements.view', label: 'История перемещений', group: 'Перемещения' },
  { key: 'movements.edit', label: 'Перемещение товаров', group: 'Перемещения' },
  { key: 'errors', label: 'Ошибки сканирования', group: 'Прочее' },
];

function RoleFormModal({ open, onClose, role, onSuccess }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [perms, setPerms] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (role) { setName(role.name); setPerms(role.permissions || []); }
    else { setName(''); setPerms([]); }
  }, [open, role]);

  const toggle = (key) => setPerms(prev => prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]);
  const toggleAll = () => setPerms(perms.length === ALL_PERMISSIONS.length ? [] : ALL_PERMISSIONS.map(p => p.key));

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Введите название'); return; }
    setLoading(true);
    try {
      if (role) await api.put(`/staff/roles/${role.id}`, { name, permissions: perms });
      else await api.post('/staff/roles', { name, permissions: perms });
      toast.success(role ? 'Роль обновлена' : 'Роль создана');
      onSuccess(); onClose();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setLoading(false); }
  };

  const groups = {};
  for (const p of ALL_PERMISSIONS) {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  }

  return (
    <Modal open={open} onClose={onClose} title={role ? 'Редактировать роль' : 'Создать роль'} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button onClick={handleSave} loading={loading}>{role ? 'Сохранить' : 'Создать'}</Button></>}>
      <div className="space-y-4">
        <Input label="Название роли" placeholder="Например: Старший кладовщик" value={name} onChange={e => setName(e.target.value)} />
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Права доступа</p>
            <button onClick={toggleAll} className="text-xs text-primary-600 hover:text-primary-800 font-medium">
              {perms.length === ALL_PERMISSIONS.length ? 'Снять все' : 'Выбрать все'}
            </button>
          </div>
          <div className="space-y-4">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-gray-500 mb-2">{group}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {items.map(p => (
                    <label key={p.key} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-primary-50/50 transition-colors">
                      <input type="checkbox" checked={perms.includes(p.key)} onChange={() => toggle(p.key)}
                        className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-sm text-gray-700">{p.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RolesManager() {
  const toast = useToast();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/staff/roles').then(r => setRoles(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/staff/roles/${deleteTarget.id}`);
      toast.success('Роль удалена');
      setDeleteTarget(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
    finally { setDeleting(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner size="lg" /></div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Роли ({roles.length})</p>
        <button onClick={() => { setEditRole(null); setShowForm(true); }}
          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
          <Plus size={13} /> Создать роль
        </button>
      </div>
      {roles.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center text-gray-300">
          <Shield size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">Нет ролей</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {roles.map(role => (
            <div key={role.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 ring-1 ring-primary-100 flex items-center justify-center flex-shrink-0">
                  <Shield size={18} className="text-primary-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900">{role.name}</p>
                  <p className="text-[11px] text-gray-400">{(role.permissions || []).length} прав доступа</p>
                </div>
                <button onClick={() => { setEditRole(role); setShowForm(true); }}
                  className="p-2 rounded-xl text-gray-400 hover:text-primary-500 hover:bg-primary-50 transition-all">
                  <Pencil size={14} />
                </button>
                <button onClick={() => setDeleteTarget(role)}
                  className="p-2 rounded-xl text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {(role.permissions || []).map(p => {
                  const info = ALL_PERMISSIONS.find(a => a.key === p);
                  return <span key={p} className="text-[10px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-md">{info?.label || p}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <RoleFormModal open={showForm} onClose={() => { setShowForm(false); setEditRole(null); }} role={editRole} onSuccess={load} />
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Удалить роль"
        footer={<><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Отмена</Button><Button variant="danger-solid" onClick={confirmDelete} loading={deleting}>Удалить</Button></>}>
        <p className="text-sm text-gray-600">Удалить роль «{deleteTarget?.name}»? Это действие нельзя отменить.</p>
      </Modal>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Главная страница
// ════════════════════════════════════════════════════════════════════════════
export default function StaffPage() {
  const toast = useToast();
  const { user } = useAuth();
  const userPerms = user?.permissions || [];
  const isAdmin = user?.role === 'admin';
  const canEditStaff = isAdmin || userPerms.includes('staff.edit');
  const canManageRoles = isAdmin || userPerms.includes('roles.manage');

  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'users';
  const setTab = (t) => setSearchParams({ tab: t });

  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('staff_group_by') || 'position');
  const setGroup = (g) => { setGroupBy(g); localStorage.setItem('staff_group_by', g); };
  const [view, setView] = useState(() => localStorage.getItem('staff_view') || 'list');
  const setViewMode = (v) => { setView(v); localStorage.setItem('staff_view', v); };

  const [showEmpModal, setShowEmpModal] = useState(false);
  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [editEmployee, setEditEmployee] = useState(null);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editUser, setEditUser] = useState(null);

  const drillId = searchParams.get('employee');
  const setDrillEmployee = (emp) => {
    if (emp) setSearchParams({ tab, employee: emp.id });
    else setSearchParams({ tab });
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [emp, usr] = await Promise.allSettled([
        api.get('/staff/employees'),
        api.get('/staff/users'),
      ]);
      if (emp.status === 'fulfilled') setEmployees(emp.value.data.filter(e => e.active !== false));
      if (usr.status === 'fulfilled') setUsers(usr.value.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const deleteEmployee = async (id) => {
    if (!confirm('Удалить сотрудника?')) return;
    try {
      await api.delete(`/staff/employees/${id}`);
      toast.success('Сотрудник удалён');
      loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };
  const deleteUser = async (id) => {
    if (!confirm('Удалить пользователя?')) return;
    try {
      await api.delete(`/staff/users/${id}`);
      toast.success('Пользователь удалён');
      loadAll();
    } catch (err) { toast.error(err.response?.data?.error || 'Ошибка'); }
  };

  // Поиск
  const searchLower = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!searchLower) return users;
    return users.filter(u =>
      (u.employee_name || u.username || '').toLowerCase().includes(searchLower) ||
      (u.username || '').toLowerCase().includes(searchLower) ||
      (u.role_name || '').toLowerCase().includes(searchLower) ||
      (u.position || '').toLowerCase().includes(searchLower) ||
      (u.department || '').toLowerCase().includes(searchLower)
    );
  }, [users, searchLower]);

  const userEmpIds = useMemo(() => new Set(users.map(u => u.employee_id).filter(Boolean)), [users]);
  const employeesWithoutAccount = useMemo(() => employees.filter(e => !userEmpIds.has(e.id)), [employees, userEmpIds]);
  const filteredNoAccount = searchLower
    ? employeesWithoutAccount.filter(e =>
        e.full_name.toLowerCase().includes(searchLower) ||
        (e.position || '').toLowerCase().includes(searchLower))
    : employeesWithoutAccount;

  // Статистика
  const stats = useMemo(() => {
    const onlineCount = users.filter(isOnline).length;
    const interns = users.filter(u => u.employee_status === 'internship').length;
    const active = users.filter(u => u.employee_status === 'active').length;
    const blocked = users.filter(u => !ACTIVE_STATUSES.has(u.employee_status || 'active')).length;
    return { onlineCount, interns, active, blocked, total: users.length };
  }, [users]);

  const drillEmployee = drillId ? employees.find(e => String(e.id) === drillId) : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ─── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">Сотрудники</h1>
          <p className="text-gray-500 text-sm mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="font-semibold text-gray-700">{stats.onlineCount}</span> в сети
            </span>
            <span className="text-gray-300">·</span>
            <span><span className="font-semibold text-gray-700">{stats.total}</span> всего</span>
          </p>
        </div>
        {tab === 'users' && canEditStaff && !drillId && (
          <Button icon={<Plus size={16} />} onClick={() => setShowAddEmpModal(true)}>
            Добавить сотрудника
          </Button>
        )}
      </div>

      {/* ─── Stat cards ─────────────────────────────────────────────────────── */}
      {!drillId && tab === 'users' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatCard icon={UserCheck} value={stats.onlineCount} label="В сети" color="green" />
          <StatCard icon={Users}     value={stats.active}      label="Работают" color="primary" />
          <StatCard icon={BadgeCheck} value={stats.interns}    label="Стажёров" color="amber" />
          <StatCard icon={Shield}    value={stats.blocked}     label="Архив / уволены" color="rose" />
        </div>
      )}

      {/* ─── Tabs ───────────────────────────────────────────────────────────── */}
      {canManageRoles && !drillId && (
        <div className="flex gap-1 mb-5 bg-gray-50 p-1.5 rounded-2xl w-fit border border-gray-200">
          {[
            { value: 'users', label: `Сотрудники (${users.length})`, icon: Users },
            { value: 'roles', label: 'Роли',                          icon: Shield },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === value
                  ? 'bg-white text-primary-700 shadow-sm border border-primary-100'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ─── Тулбар ─────────────────────────────────────────────────────────── */}
      {tab === 'users' && !drillId && (
        <div className="bg-white border border-gray-100 rounded-2xl p-3 mb-4 shadow-sm">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
            {/* Поиск */}
            <div className="relative flex-1 min-w-0">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск по имени, логину, должности, отделу..."
                className="w-full h-11 pl-10 pr-10 rounded-xl border border-gray-100 bg-gray-50 text-sm focus:bg-white focus:border-primary-300 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
              />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Группировка */}
            <div className="flex items-center gap-1.5 bg-gray-50 rounded-xl p-1 border border-gray-100">
              <Filter size={13} className="text-gray-400 ml-1.5" />
              {GROUP_MODES.map(m => {
                const Icon = m.icon;
                const active = groupBy === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => setGroup(m.key)}
                    title={m.label}
                    className={`flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-semibold transition-all ${
                      active ? 'bg-white text-primary-700 shadow-sm border border-primary-100' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="hidden xl:inline">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Вид (список / сетка) */}
            <div className="flex items-center gap-1 bg-gray-50 rounded-xl p-1 border border-gray-100">
              <button
                onClick={() => setViewMode('list')}
                title="Список"
                className={`p-1.5 rounded-lg transition-all ${view === 'list' ? 'bg-white text-primary-700 shadow-sm border border-primary-100' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <Rows3 size={15} />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                title="Сетка"
                className={`p-1.5 rounded-lg transition-all ${view === 'grid' ? 'bg-white text-primary-700 shadow-sm border border-primary-100' : 'text-gray-400 hover:text-gray-600'}`}
              >
                <LayoutGrid size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Контент ────────────────────────────────────────────────────────── */}
      {drillEmployee ? (
        <EmployeeDetailView employee={drillEmployee} onBack={() => { setDrillEmployee(null); loadAll(); }} />
      ) : loading ? (
        <div className="flex items-center justify-center h-48"><Spinner size="lg" /></div>
      ) : tab === 'users' ? (
        <>
          <StaffList
            users={filteredUsers}
            groupBy={groupBy}
            view={view}
            canEdit={canEditStaff}
            onDrill={(u) => { const emp = employees.find(e => e.id === u.employee_id); if (emp) setDrillEmployee(emp); }}
            onEdit={(u) => setEditUser(u)}
            onDelete={deleteUser}
          />

          {/* Сотрудники без учётной записи */}
          {filteredNoAccount.length > 0 && (
            <div className="mt-4 bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-3 bg-amber-50/50 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-xl bg-amber-100 flex items-center justify-center">
                    <Users size={14} className="text-amber-600" />
                  </div>
                  <span className="text-xs font-bold text-gray-700">Без учётной записи</span>
                </div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{filteredNoAccount.length} чел.</span>
              </div>
              {filteredNoAccount.map(emp => (
                <div key={emp.id} onClick={() => setDrillEmployee(emp)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-amber-50/30 transition-colors border-b border-gray-50 last:border-0 cursor-pointer">
                  <Avatar name={emp.full_name} size={42} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{emp.full_name}</p>
                    {emp.position && <p className="text-[11px] text-gray-500 truncate">{emp.position}</p>}
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-1 rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-100">
                    Нет аккаунта
                  </span>
                  {canEditStaff && (
                    <div className="flex items-center gap-0.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditEmployee(emp); setShowEmpModal(true); }}
                        className="p-2 rounded-xl text-gray-300 hover:text-primary-500 hover:bg-primary-50 transition-all">
                        <Pencil size={14} />
                      </button>
                      <button onClick={() => deleteEmployee(emp.id)}
                        className="p-2 rounded-xl text-gray-300 hover:text-rose-500 hover:bg-rose-50 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </div>
              ))}
            </div>
          )}
        </>
      ) : tab === 'roles' ? (
        <RolesManager />
      ) : null}

      <EmployeeModal open={showEmpModal} onClose={() => { setShowEmpModal(false); setEditEmployee(null); }} employee={editEmployee} onSuccess={loadAll} />
      <AddEmployeeModal open={showAddEmpModal} onClose={() => setShowAddEmpModal(false)} onSuccess={loadAll} />
      <UserModal open={showUserModal} onClose={() => setShowUserModal(false)} onSuccess={loadAll} employees={employees} />
      <EditUserModal open={!!editUser} onClose={() => setEditUser(null)} user={editUser} onSuccess={loadAll} employees={employees} />
    </div>
  );
}

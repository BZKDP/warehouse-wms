import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff, X, Search, Package, ChevronDown, ChevronRight, Users, UserCog, Pencil, Trash2, Plus, Shield } from 'lucide-react';
import api from '../../../api/client';
import Button from '../../../components/ui/Button';
import Modal from '../../../components/ui/Modal';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Spinner from '../../../components/ui/Spinner';
import Badge from '../../../components/ui/Badge';
import { useToast } from '../../../components/ui/Toast';
import { useAuth } from '../../../context/AuthContext';

// ─── Employee Modal (edit existing) ──────────────────────────────────────────
function EmployeeModal({ open, onClose, employee, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({ full_name: '', position: '', phone: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (employee) setForm({ full_name: employee.full_name, position: employee.position || '', phone: employee.phone || '' });
  }, [employee, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.put(`/staff/employees/${employee.id}`, form);
      toast.success('Сотрудник обновлён');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Редактировать сотрудника"
      footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary-solid" form="emp-form" type="submit" loading={loading}>Сохранить</Button></>}>
      <form id="emp-form" onSubmit={handleSubmit} className="space-y-4">
        <Input label="ФИО" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} required />
        <Input label="Должность" value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
        <Input label="Телефон" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
      </form>
    </Modal>
  );
}

// ─── Add Employee from External DB Modal ─────────────────────────────────────
function AddEmployeeModal({ open, onClose, onSuccess }) {
  const toast = useToast();
  const [extEmployees, setExtEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ role: 'employee', role_id: '' });
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    if (!open) { setSearch(''); setSelected(null); setForm({ role: 'employee', role_id: '' }); return; }
    api.get('/staff/roles').then(r => setRoles(r.data)).catch(() => {});
    setLoading(true);
    api.get('/staff/external-employees')
      .then(r => setExtEmployees(r.data))
      .catch(() => toast.error('Не удалось загрузить список сотрудников'))
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = extEmployees.filter(e =>
    !e.already_added && e.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (ext) => {
    setSelected(ext);
    const empRole = roles.find(r => r.name === 'Сотрудник');
    setForm({ role: 'employee', role_id: empRole ? String(empRole.id) : '' });
  };

  const handleSave = async () => {
    if (!selected.login) { toast.error('У сотрудника нет логина во внешней БД'); return; }
    setSaving(true);
    try {
      await api.post('/staff/employees', {
        full_name: selected.full_name,
        position: selected.position_name || '',
        phone: selected.phone || '',
        external_employee_id: selected.id,
        username: selected.login,
        role: form.role,
        role_id: form.role_id ? parseInt(form.role_id) : null,
      });
      toast.success(`${selected.full_name} добавлен`);
      setExtEmployees(prev => prev.map(e => e.id === selected.id ? { ...e, already_added: true } : e));
      setSelected(null);
      setForm({ username: '', password: '', role: 'employee' });
      onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally { setSaving(false); }
  };

  const alreadyCount = extEmployees.filter(e => e.already_added).length;

  return (
    <Modal open={open} onClose={onClose} title="Добавить сотрудника" size="lg"
      footer={selected
        ? <><Button variant="ghost" onClick={() => setSelected(null)}>Назад</Button><Button onClick={handleSave} loading={saving}>Создать</Button></>
        : <Button variant="ghost" onClick={onClose}>Закрыть</Button>
      }>
      {selected ? (
        <div className="space-y-4">
          <div className="bg-primary-50 rounded-xl p-4">
            <p className="text-sm font-semibold text-gray-800">{selected.full_name}</p>
            <p className="text-xs text-gray-500">{selected.position_name || '—'}{selected.phone ? ` · ${selected.phone}` : ''}</p>
          </div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Доступ в систему</p>
          <div className="bg-gray-50 rounded-xl px-3 py-2">
            <p className="text-xs text-gray-400 mb-0.5">Логин</p>
            <p className="text-sm font-mono font-medium text-gray-800">{selected.login || '—'}</p>
          </div>
          <Select label="Роль" value={form.role_id} onChange={e => {
            const rid = e.target.value;
            const r = roles.find(x => String(x.id) === rid);
            setForm(f => ({ ...f, role_id: rid, role: r?.name === 'Администратор' ? 'admin' : r?.name === 'Менеджер' ? 'manager' : 'employee' }));
          }}>
            <option value="">Выберите роль</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </Select>
        </div>
      ) : (
        <div className="space-y-3">
          <Input placeholder="Поиск по имени..." value={search} onChange={e => setSearch(e.target.value)} icon={<Search size={15} />} />
          <p className="text-xs text-gray-400">
            Доступно: {filtered.length} · Уже добавлено: {alreadyCount}
          </p>
          {loading ? (
            <div className="flex justify-center py-8"><Spinner size="lg" /></div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-gray-300">
              <Users size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">{search ? 'Не найдено' : 'Все сотрудники уже добавлены'}</p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1">
              {filtered.map(ext => (
                <button key={ext.id} onClick={() => handleSelect(ext)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{ext.full_name}</p>
                    <p className="text-xs text-gray-400">{ext.position_name || '—'}{ext.phone ? ` · ${ext.phone}` : ''}</p>
                  </div>
                  <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Edit User Modal ──────────────────────────────────────────────────────────
function EditUserModal({ open, onClose, user, onSuccess, employees }) {
  const toast = useToast();
  const [form, setForm] = useState({ username: '', role: 'employee', role_id: '', employee_id: '', active: true });
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState([]);

  useEffect(() => {
    if (open) api.get('/staff/roles').then(r => setRoles(r.data)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (user && open) {
      setForm({
        username: user.username || '',
        role: user.role || 'employee',
        role_id: user.role_id ? String(user.role_id) : '',
        employee_id: user.employee_id ? String(user.employee_id) : '',
        active: user.active !== false,
      });
    }
  }, [user, open]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const payload = {
        username: form.username,
        role: form.role,
        role_id: form.role_id ? parseInt(form.role_id) : null,
        employee_id: form.employee_id ? parseInt(form.employee_id) : null,
        active: form.active,
      };
      await api.put(`/staff/users/${user.id}`, { ...payload, source: user.source });
      toast.success('Пользователь обновлён');
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Редактировать пользователя"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary-solid" form="edit-user-form" type="submit" loading={loading}>Сохранить</Button>
      </>}
    >
      <form id="edit-user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input label="Логин" value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />

        <Select label="Роль" value={form.role_id} onChange={e => {
          const rid = e.target.value;
          const r = roles.find(x => String(x.id) === rid);
          setForm(f => ({ ...f, role_id: rid, role: r?.name === 'Администратор' ? 'admin' : r?.name === 'Менеджер' ? 'manager' : 'employee' }));
        }}>
          <option value="">Выберите роль</option>
          {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
        <Select label="Привязать к сотруднику" value={form.employee_id}
          onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
          <option value="">Не привязывать</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>{emp.full_name}</option>
          ))}
        </Select>
        <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={form.active}
            onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
            className="w-4 h-4 rounded accent-primary-600"
          />
          <span className="text-sm font-medium text-gray-700">Активен (может входить в систему)</span>
        </label>
      </form>
    </Modal>
  );
}

// ─── User Modal ───────────────────────────────────────────────────────────────
function UserModal({ open, onClose, onSuccess, employees }) {
  const toast = useToast();
  const [form, setForm] = useState({ username: '', password: '', role: 'employee', employee_id: '' });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/staff/users', { ...form, employee_id: form.employee_id || null });
      toast.success('Пользователь создан');
      onSuccess();
      onClose();
      setForm({ username: '', password: '', role: 'employee', employee_id: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Создать пользователя"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="primary-solid" form="user-form" type="submit" loading={loading}>Создать</Button>
      </>}
    >
      <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
        <Input label="Логин" placeholder="ivanov" value={form.username}
          onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required />
        <Input
          label="Пароль"
          type={showPass ? 'text' : 'password'}
          placeholder="Минимум 6 символов"
          value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          required
          iconRight={
            <button type="button" onClick={() => setShowPass(s => !s)}>
              {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
        <Select label="Роль" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
          <option value="employee">Сотрудник</option>
          <option value="manager">Менеджер (создаёт задачи)</option>
          <option value="admin">Администратор</option>
        </Select>
        <Select label="Привязать к сотруднику" value={form.employee_id}
          onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))}>
          <option value="">Не привязывать</option>
          {employees.map(emp => (
            <option key={emp.id} value={emp.id}>{emp.full_name}</option>
          ))}
        </Select>
      </form>
    </Modal>
  );
}

export { EmployeeModal, AddEmployeeModal, EditUserModal, UserModal };

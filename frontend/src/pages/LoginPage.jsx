import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, BarChart3, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(form.username, form.password);
      const perms = user.permissions || [];
      const isAdmin = user.role === 'admin' || user.role === 'manager' || perms.includes('dashboard') || perms.includes('products.view') || perms.includes('warehouse.view');
      navigate(isAdmin ? '/admin' : '/employee/tasks');
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-white to-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-600 shadow-lg shadow-primary-200 mb-4">
            <BarChart3 size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">GRAсклад</h1>
          <p className="text-gray-500 text-sm mt-1">Система управления складом</p>
        </div>

        {/* Card */}
        <div className="card p-8">
          <div className="flex items-center gap-2 mb-6">
            <Lock className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">Вход в систему</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Логин"
              placeholder="Введите логин"
              value={form.username}
              onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
              autoComplete="username"
              autoFocus
            />

            <Input
              label="Пароль"
              type={showPass ? 'text' : 'password'}
              placeholder="Введите пароль"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              autoComplete="current-password"
              iconRight={
                <button type="button" onClick={() => setShowPass(s => !s)} className="text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />

            {error && (
              <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary-solid"
              className="w-full"
              size="lg"
              loading={loading}
            >
              Войти
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          GRAсклад v2.71.0
        </p>
      </div>
    </div>
  );
}

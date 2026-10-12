import { useAuth } from '../context/AuthContext';

/**
 * Экран для пользователей, у которых статус сотрудника заблокирован
 * (fired / pending_fired / rejected). Они могут залогиниться, но никаких
 * функций склада не получают — только сообщение и кнопка «Выйти».
 */
export default function BlockedScreen() {
  const { user, logout } = useAuth();
  const message = user?.blocked_message || 'Доступ к складу закрыт.';
  const name = user?.employee_name || user?.username || '';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 p-6">
      <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
          <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636m12.728 12.728L18.364 5.636M5.636 18.364l12.728-12.728" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Доступ закрыт
        </h1>
        {name && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{name}</p>
        )}
        <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
        <button
          onClick={logout}
          className="w-full px-4 py-2.5 bg-gray-900 dark:bg-gray-100 dark:text-gray-900 text-white rounded-xl font-medium hover:bg-gray-800 dark:hover:bg-white transition-colors"
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

import { useAuth } from '../context/AuthContext';

// Права текущего пользователя. Админ проходит любую проверку.
// can('products.edit') — есть ли право; can(a, b) — есть ли хотя бы одно из.
export function usePerms() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const perms = user?.permissions || [];
  const can = (...list) => isAdmin || list.some(p => perms.includes(p));
  return { user, isAdmin, perms, can };
}

export default usePerms;

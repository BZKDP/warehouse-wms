import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense, Component } from 'react';
import { initGlobalErrorHandlers } from './utils/errorReporter';
import { appBasePath } from './utils/appBasePath';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { AppSettingsProvider } from './context/AppSettingsContext';
import { ToastProvider } from './components/ui/Toast';
import { PageLoader } from './components/ui/Spinner';

import AdminLayout from './components/layout/AdminLayout';
import EmployeeLayout from './components/layout/EmployeeLayout';
import BlockedScreen from './components/BlockedScreen';

// Lazy-loaded pages for code splitting
const LoginPage = lazy(() => import('./pages/LoginPage'));
// DashboardPage removed — /admin redirects to /admin/warehouse
const ProductsPage = lazy(() => import('./pages/admin/ProductsPage'));
const ProductStockPage = lazy(() => import('./pages/admin/ProductStockPage'));
const WarehousePage = lazy(() => import('./pages/admin/WarehousePage'));
const TasksPage = lazy(() => import('./pages/admin/TasksPage'));
const StaffPage = lazy(() => import('./pages/admin/StaffPage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage'));
const EarningsPage = lazy(() => import('./pages/admin/EarningsPage'));
const ErrorsPage = lazy(() => import('./pages/admin/ErrorsPage'));
const MyTasksPage = lazy(() => import('./pages/employee/MyTasksPage'));
const TaskScanPage = lazy(() => import('./pages/employee/TaskScanPage'));
const PackagingPage = lazy(() => import('./pages/employee/PackagingPage'));
const AssemblyPage = lazy(() => import('./pages/employee/AssemblyPage'));
const MovePage = lazy(() => import('./pages/employee/MovePage'));
const MyInventoryPage = lazy(() => import('./pages/employee/MyInventoryPage'));
const MyEarningsPage = lazy(() => import('./pages/employee/MyEarningsPage'));
const ReturnsPage = lazy(() => import('./pages/employee/ReturnsPage'));
const FBOPage = lazy(() => import('./pages/admin/FBOPage'));
// MovementsPage removed — history view no longer in nav
const MaterialsPage = lazy(() => import('./pages/admin/MaterialsPage'));
const LiveMonitorPage = lazy(() => import('./pages/admin/LiveMonitorPage'));
const ProductMovementsPage = lazy(() => import('./pages/admin/ProductMovementsPage'));
const BarcodeDisputesPage = lazy(() => import('./pages/admin/BarcodeDisputesPage'));

class ChunkErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error) {
    if (error?.name === 'ChunkLoadError' || error?.message?.includes('Failed to fetch dynamically imported module') || error?.message?.includes('Loading chunk')) {
      return { hasError: true };
    }
    throw error;
  }
  componentDidCatch() {
    const key = 'chunk_reload';
    if (!sessionStorage.getItem(key)) {
      sessionStorage.setItem(key, '1');
      window.location.reload();
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <p className="text-gray-600 text-lg mb-4">Обновление приложения...</p>
          <button onClick={() => { sessionStorage.removeItem('chunk_reload'); window.location.reload(); }}
            className="px-5 py-2.5 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors">
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function hasAdminAccess(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'manager') return true;
  const perms = user.permissions || [];
  return perms.includes('products.view') || perms.includes('barcode_disputes.view') || perms.includes('warehouse.view') || perms.includes('tasks.view') || perms.includes('staff.view') || perms.includes('analytics');
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.is_blocked) return <BlockedScreen />;
  if (!hasAdminAccess(user)) return <Navigate to="/employee/tasks" replace />;
  return <AdminLayout>{children}</AdminLayout>;
}

function EmployeeRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.is_blocked) return <BlockedScreen />;
  return <EmployeeLayout>{children}</EmployeeLayout>;
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.is_blocked) return <BlockedScreen />;
  if (hasAdminAccess(user)) return <Navigate to="/admin" replace />;
  return <Navigate to="/employee/tasks" replace />;
}

function AppRoutes() {
  return (
    <ChunkErrorBoundary>
    <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Admin routes */}
      <Route path="/admin" element={<Navigate to="/admin/warehouse" replace />} />
      <Route path="/admin/products" element={<Navigate to="/admin/products/cards" replace />} />
      <Route path="/admin/products/cards" element={<AdminRoute><ProductsPage /></AdminRoute>} />
      <Route path="/admin/products/stock" element={<AdminRoute><ProductStockPage /></AdminRoute>} />
      <Route path="/admin/products/materials" element={<AdminRoute><MaterialsPage /></AdminRoute>} />
      <Route path="/admin/products/barcode-disputes" element={<AdminRoute><BarcodeDisputesPage /></AdminRoute>} />
      <Route path="/admin/warehouse" element={<AdminRoute><WarehousePage /></AdminRoute>} />
      <Route path="/admin/tasks" element={<AdminRoute><TasksPage /></AdminRoute>} />
      <Route path="/admin/staff" element={<AdminRoute><StaffPage /></AdminRoute>} />
      <Route path="/admin/settings" element={<AdminRoute><SettingsPage /></AdminRoute>} />
      <Route path="/admin/analytics" element={<AdminRoute><AnalyticsPage /></AdminRoute>} />
      <Route path="/admin/earnings" element={<AdminRoute><EarningsPage /></AdminRoute>} />
      <Route path="/admin/errors" element={<AdminRoute><ErrorsPage /></AdminRoute>} />
      <Route path="/admin/fbo" element={<AdminRoute><FBOPage /></AdminRoute>} />
      <Route path="/admin/move" element={<AdminRoute><MovePage /></AdminRoute>} />
      <Route path="/admin/live-monitor" element={<AdminRoute><LiveMonitorPage /></AdminRoute>} />
      <Route path="/admin/product-movements" element={<AdminRoute><ProductMovementsPage /></AdminRoute>} />
      {/* Employee routes */}
      <Route path="/employee/tasks" element={<EmployeeRoute><MyTasksPage /></EmployeeRoute>} />
      <Route path="/employee/tasks/:id" element={<EmployeeRoute><TaskScanPage /></EmployeeRoute>} />
      <Route path="/employee/packaging/:id" element={<EmployeeRoute><PackagingPage /></EmployeeRoute>} />
      <Route path="/employee/assembly/:id" element={<EmployeeRoute><AssemblyPage /></EmployeeRoute>} />
      <Route path="/employee/move" element={<EmployeeRoute><MovePage /></EmployeeRoute>} />
      <Route path="/employee/earnings" element={<EmployeeRoute><MyEarningsPage /></EmployeeRoute>} />
      <Route path="/employee/inventory" element={<EmployeeRoute><MyInventoryPage /></EmployeeRoute>} />
      <Route path="/employee/returns" element={<EmployeeRoute><ReturnsPage /></EmployeeRoute>} />

      <Route path="*" element={
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
          <h1 className="text-8xl font-black text-gray-200">404</h1>
          <p className="text-gray-500 mt-2 mb-6">Страница не найдена</p>
          <a href={appBasePath ? `${appBasePath}/` : '/'} className="px-5 py-2.5 bg-primary-600 text-white rounded-xl font-medium hover:bg-primary-700 transition-colors">На главную</a>
        </div>
      } />
    </Routes>
    </Suspense>
    </ChunkErrorBoundary>
  );
}

export default function App() {
  useEffect(() => { initGlobalErrorHandlers(); }, []);

  return (
    <ThemeProvider>
      <AppSettingsProvider>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </ToastProvider>
      </AppSettingsProvider>
    </ThemeProvider>
  );
}

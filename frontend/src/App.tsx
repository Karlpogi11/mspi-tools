import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { api } from './lib/api';
import Layout from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage'));
const loadDashboardPage = () => import('./pages/DashboardPage');
const loadAdminPage = () => import('./pages/admin/AdminPage');
const loadAdminUsersPage = () => import('./pages/AdminUsersPage');
const loadAdminToolsPage = () => import('./pages/AdminToolsPage');

const DashboardPage = lazy(loadDashboardPage);
const AdminPage = lazy(loadAdminPage);
const AdminUsersPage = lazy(loadAdminUsersPage);
const AdminToolsPage = lazy(loadAdminToolsPage);
const loadAdminPcountPage = () => import('./pages/admin/AdminPcountPage');
const loadPcountIndexPage = () => import('./pages/pcount/IndexPage');
const loadPcountSessionPage = () => import('./pages/pcount/SessionPage');
const loadRfpuPage = () => import('./pages/RfpuPage');
const loadReformatPage = () => import('./pages/reformat/ReformatPage');
const loadConsumablesPage = () => import('./pages/consumables/ConsumablesPage');
const loadPdfExtractorPage = () => import('./pages/pdf-extractor/PdfExtractorPage');

const AdminPcountPage = lazy(loadAdminPcountPage);
const PcountIndexPage = lazy(loadPcountIndexPage);
const PcountSessionPage = lazy(loadPcountSessionPage);
const RfpuPage = lazy(loadRfpuPage);
const ReformatPage = lazy(loadReformatPage);
const ConsumablesPage = lazy(loadConsumablesPage);
const PdfExtractorPage = lazy(loadPdfExtractorPage);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <p className="text-[14px] text-[#6e6e73]">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!user.roleId) return <PendingApprovalPage />;

  return <>{children}</>;
}

function PrefetchCommonRoutes() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;
    const prefetch = () => {
      void Promise.all([
        loadDashboardPage(),
        loadAdminPage(),
        loadAdminUsersPage(),
        loadAdminToolsPage(),
        loadAdminPcountPage(),
        loadPcountIndexPage(),
        loadPcountSessionPage(),
        loadRfpuPage(),
        loadReformatPage(),
        loadConsumablesPage(),
        loadPdfExtractorPage(),
      ]).catch(() => undefined);

      void Promise.all([
        api.myTools(),
        api.sessions.list(),
        api.reformat.listTemplates(),
        api.consumables.listMaster(),
        ...(user.roleName === 'Admin'
          ? [api.admin.getUsers(), api.admin.getRoles(), api.admin.getTools(), api.pcountAdmin.listSessions()]
          : []),
      ]).catch(() => undefined);
    };
    prefetch();
  }, [user]);

  return null;
}

function RouteFallback() {
  return (
    <div className="min-h-[240px] animate-pulse space-y-4 p-6" aria-label="Loading page">
      <div className="h-6 w-40 rounded-md bg-[#e5e5ea]" />
      <div className="h-4 w-64 rounded-md bg-[#e5e5ea]" />
      <div className="h-24 rounded-xl bg-[#f5f5f7]" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PrefetchCommonRoutes />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Layout />}>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <DashboardPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/users"
                element={
                  <ProtectedRoute>
                    <AdminUsersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/tools"
                element={
                  <ProtectedRoute>
                    <AdminToolsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/pcount"
                element={
                  <ProtectedRoute>
                    <AdminPcountPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pcount"
                element={
                  <ProtectedRoute>
                    <PcountIndexPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pcount/session/:id"
                element={
                  <ProtectedRoute>
                    <PcountSessionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/rfpu"
                element={
                  <ProtectedRoute>
                    <RfpuPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/reformat"
                element={
                  <ProtectedRoute>
                    <ReformatPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/consumables"
                element={
                  <ProtectedRoute>
                    <ConsumablesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/pdf-extractor"
                element={
                  <ProtectedRoute>
                    <PdfExtractorPage />
                  </ProtectedRoute>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

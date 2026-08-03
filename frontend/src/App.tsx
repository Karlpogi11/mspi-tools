import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const PendingApprovalPage = lazy(() => import('./pages/PendingApprovalPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminToolsPage = lazy(() => import('./pages/AdminToolsPage'));
const AdminPcountPage = lazy(() => import('./pages/admin/AdminPcountPage'));
const PcountIndexPage = lazy(() => import('./pages/pcount/IndexPage'));
const PcountSessionPage = lazy(() => import('./pages/pcount/SessionPage'));
const RfpuPage = lazy(() => import('./pages/RfpuPage'));
const ReformatPage = lazy(() => import('./pages/reformat/ReformatPage'));
const ConsumablesPage = lazy(() => import('./pages/consumables/ConsumablesPage'));

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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div className="min-h-screen bg-[#f5f5f7]" />}>
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
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

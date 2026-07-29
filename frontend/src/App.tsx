import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import PendingApprovalPage from './pages/PendingApprovalPage';
import DashboardPage from './pages/DashboardPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminToolsPage from './pages/AdminToolsPage';
import PcountIndexPage from './pages/pcount/IndexPage';
import PcountSessionPage from './pages/pcount/SessionPage';
import RfpuPage from './pages/RfpuPage';

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
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

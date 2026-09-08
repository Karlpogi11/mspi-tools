import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import { api, type Tool } from './lib/api';
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
const loadChromeExtensionPage = () => import('./pages/ChromeExtensionPage');
const loadApplecarePage = () => import('./pages/ApplecarePage');
const loadFrontlinePage = () => import('./pages/FrontlinePage');
const loadFrontlineDataEntryPage = () => import('./pages/FrontlineDataEntryPage');
const loadAdminFrontlinePage = () => import('./pages/admin/AdminFrontlinePage');
const loadAdminEngineersPage = () => import('./pages/admin/AdminEngineersPage');
const loadAdminStorageLocatorPage = () => import('./pages/admin/AdminStorageLocatorPage');
const loadEngineerEndorsementsPage = () => import('./pages/EngineerEndorsementsPage');
const loadStorageLocatorPage = () => import('./pages/StorageLocatorPage');
const loadPartsPage = () => import('./pages/PartsPage');
const loadAdminPartsPage = () => import('./pages/admin/AdminPartsPage');

const AdminPcountPage = lazy(loadAdminPcountPage);
const PcountIndexPage = lazy(loadPcountIndexPage);
const PcountSessionPage = lazy(loadPcountSessionPage);
const RfpuPage = lazy(loadRfpuPage);
const ReformatPage = lazy(loadReformatPage);
const ConsumablesPage = lazy(loadConsumablesPage);
const PdfExtractorPage = lazy(loadPdfExtractorPage);
const ChromeExtensionPage = lazy(loadChromeExtensionPage);
const ApplecarePage = lazy(loadApplecarePage);
const FrontlinePage = lazy(loadFrontlinePage);
const FrontlineDataEntryPage = lazy(loadFrontlineDataEntryPage);
const AdminFrontlinePage = lazy(loadAdminFrontlinePage);
const AdminEngineersPage = lazy(loadAdminEngineersPage);
const AdminStorageLocatorPage = lazy(loadAdminStorageLocatorPage);
const EngineerEndorsementsPage = lazy(loadEngineerEndorsementsPage);
const StorageLocatorPage = lazy(loadStorageLocatorPage);
const PartsPage = lazy(loadPartsPage);
const AdminPartsPage = lazy(loadAdminPartsPage);

const TOOL_PATHS = ['/pcount', '/rfpu', '/reformat', '/consumables', '/pdf-extractor', '/chrome-extension', '/applecare', '/frontline', '/endorsements', '/storage-locator', '/parts'];

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const toolPath = TOOL_PATHS.find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  const [tools, setTools] = useState<Tool[] | null>(null);

  useEffect(() => {
    if (!user || !toolPath || user.isSuperAdmin) return;
    setTools(null);
    void api.myTools().then(setTools).catch(() => setTools([]));
  }, [toolPath, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <p className="text-[14px] text-[#6e6e73]">Loading...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!user.roleId) return <PendingApprovalPage />;

  if (toolPath && !user.isSuperAdmin && !tools) {
    return <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center"><p className="text-[14px] text-[#6e6e73]">Checking access...</p></div>;
  }
  if (toolPath && !user.isSuperAdmin && !tools?.some((tool) => tool.url === toolPath && tool.canAccess)) {
    return <Navigate to="/" replace />;
  }

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
        loadChromeExtensionPage(),
        loadApplecarePage(),
        loadFrontlinePage(),
        loadFrontlineDataEntryPage(),
        loadAdminFrontlinePage(),
        loadAdminEngineersPage(),
        loadAdminStorageLocatorPage(),
        loadEngineerEndorsementsPage(),
        loadStorageLocatorPage(),
        loadPartsPage(),
        loadAdminPartsPage(),
      ]).catch(() => undefined);

      void api.myTools().catch(() => undefined);
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
                path="/admin/frontline"
                element={
                  <ProtectedRoute>
                    <AdminFrontlinePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/engineers"
                element={
                  <ProtectedRoute>
                    <AdminEngineersPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/storage-locator" element={<ProtectedRoute><AdminStorageLocatorPage /></ProtectedRoute>} />
              <Route path="/admin/parts" element={<ProtectedRoute><AdminPartsPage /></ProtectedRoute>} />
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
              <Route
                path="/chrome-extension"
                element={
                  <ProtectedRoute>
                    <ChromeExtensionPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/applecare"
                element={
                  <ProtectedRoute>
                    <ApplecarePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/frontline"
                element={
                  <ProtectedRoute>
                    <FrontlinePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/frontline/data-entry"
                element={
                  <ProtectedRoute>
                    <FrontlineDataEntryPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/endorsements"
                element={
                  <ProtectedRoute>
                    <EngineerEndorsementsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/storage-locator"
                element={<ProtectedRoute><StorageLocatorPage /></ProtectedRoute>}
              />
              <Route
                path="/parts"
                element={
                  <ProtectedRoute>
                    <PartsPage />
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

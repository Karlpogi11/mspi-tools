import { BrowserRouter, Routes, Route, Link, Outlet, useLocation } from 'react-router-dom';
import IndexPage from './pages/IndexPage';
import SessionPage from './pages/SessionPage';

function Layout() {
  const location = useLocation();
  const isSession = location.pathname.startsWith('/session/');

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <header className="bg-white border-b border-[#d2d2d7]">
        <div className="max-w-7xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
              PCount
            </Link>
            {isSession && (
              <nav className="flex items-center gap-1">
                <Link to="/" className="px-3 py-1.5 text-[13px] rounded-md text-[#6e6e73] hover:text-[#1d1d1f] transition-colors">
                  Sessions
                </Link>
              </nav>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/pcount">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<IndexPage />} />
          <Route path="/session/:id" element={<SessionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

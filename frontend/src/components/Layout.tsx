import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/tools', label: 'Tools' },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <header className="bg-white/80 backdrop-blur-md border-b border-[#d2d2d7]/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-11 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="text-[14px] font-semibold text-[#1d1d1f] tracking-tight">
              MSPI Tools
            </Link>
            <nav className="flex items-center gap-0.5">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-3 py-1 text-[13px] font-medium rounded-md transition-all ${
                    isActive(item.to)
                      ? 'bg-[#2563eb] text-white'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-[#6e6e73]">{user?.fullName || user?.email}</span>
            {user?.roleName && (
              <span className="text-[11px] px-2 py-0.5 rounded-md bg-[#f5f5f7] text-[#6e6e73] border border-[#d2d2d7]">
                {user.roleName}
              </span>
            )}
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="text-[12px] text-[#6e6e73] hover:text-[#dc2626] transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

import { Outlet, Link, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Tools' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/tools', label: 'Tools' },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <header className="bg-white border-b border-[#d2d2d7]">
        <div className="max-w-6xl mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/" className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
              MSPI Tools
            </Link>
            <nav className="flex items-center gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`px-3 py-1.5 text-[13px] rounded-md transition-colors ${
                    location.pathname === item.to
                      ? 'bg-[#2563eb] text-white'
                      : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-[13px] text-[#6e6e73]">Admin (Demo)</span>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

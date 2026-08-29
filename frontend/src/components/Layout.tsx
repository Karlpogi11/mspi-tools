import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isToolPage = location.pathname !== '/' && !location.pathname.startsWith('/admin');
  const isFrontlineDataEntryPage = location.pathname === '/frontline/data-entry';
  const isPcountSessionPage = location.pathname.startsWith('/pcount/session/');
  const isAdmin = location.pathname.startsWith('/admin');
  const isWideEndorsementsPage = location.pathname === '/endorsements';
  const displayName = user?.fullName || user?.email || 'Account';
  const initials = displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function closeMenu(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', closeMenu);
    return () => document.removeEventListener('mousedown', closeMenu);
  }, []);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordError('');
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 12 || !/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setPasswordError('Use at least 12 characters with uppercase, lowercase, a number, and a special character.');
      return;
    }
    setPasswordBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      await logout();
      navigate('/login', { state: { message: 'Password changed. Sign in with your new password.' } });
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Unable to change password.');
    } finally {
      setPasswordBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F3F6]">
      <header className="bg-white/80 backdrop-blur-xl border-b border-black/10 sticky top-0 z-50 print:hidden">
        <div className="mx-auto flex h-12 max-w-[1200px] items-center justify-between px-6">
          <div className="flex items-center gap-7">
            <Link to="/" className="flex items-center gap-2 text-[14px] font-semibold text-[#1d1d1f] tracking-tight hover:opacity-70 transition-opacity">
              <span className="w-6 h-6 rounded-[7px] bg-[#1d1d1f] text-white flex items-center justify-center text-[10px] font-bold">M</span>
              MSPI Tools
            </Link>
            <Link
              to="/"
              className={`text-[12px] transition-colors ${!isAdmin ? 'text-[#1d1d1f] font-medium' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}
            >
              Tools
            </Link>
            {user?.roleName === 'Admin' && (
              <Link
                to="/admin"
                className={`text-[12px] transition-colors ${isAdmin ? 'text-[#1d1d1f] font-medium' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}
              >
                Manage
              </Link>
            )}
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Open account menu"
              className="h-8 flex items-center gap-2.5 pl-3 pr-1 rounded-full hover:bg-[#f5f5f7] transition-colors cursor-pointer"
            >
              <span className="hidden sm:block max-w-[180px] truncate text-[12px] font-medium text-[#3a3a3c]">{displayName}</span>
              <span className="w-7 h-7 rounded-full bg-[#e8e8ed] text-[#1d1d1f] flex items-center justify-center text-[10px] font-semibold">{initials}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-10 w-64 rounded-2xl border border-black/10 bg-white/95 backdrop-blur-xl shadow-[0_12px_36px_rgba(0,0,0,0.14)] p-2">
                <div className="px-3 py-2.5 border-b border-[#e5e5e7] mb-1">
                  <p className="text-[13px] font-semibold text-[#1d1d1f] truncate">{displayName}</p>
                  {user?.email && user.email !== displayName && <p className="text-[11px] text-[#6e6e73] truncate mt-0.5">{user.email}</p>}
                  {user?.roleName && <p className="text-[10px] text-[#86868b] mt-1">{user.roleName}</p>}
                </div>
                <button
                  onClick={() => { setMenuOpen(false); setPasswordOpen(true); setPasswordError(''); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                >
                  Change password
                </button>
                <button
                  onClick={() => { logout(); navigate('/login'); }}
                  className="w-full text-left px-3 py-2 rounded-xl text-[12px] text-[#dc2626] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {passwordOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-labelledby="change-password-title">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h2 id="change-password-title" className="text-[18px] font-semibold text-[#1d1d1f]">Change password</h2>
                <p className="text-[12px] text-[#6e6e73] mt-1">You’ll be signed out after your password changes.</p>
              </div>
              <button type="button" onClick={() => setPasswordOpen(false)} className="w-8 h-8 rounded-full bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f] cursor-pointer" aria-label="Close">×</button>
            </div>
            <form onSubmit={changePassword} className="space-y-4">
              <label className="block text-[12px] font-medium text-[#1d1d1f]">Current password
                <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className="mt-1.5 w-full h-10 px-3 rounded-xl border border-[#d2d2d7] outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10" />
              </label>
              <label className="block text-[12px] font-medium text-[#1d1d1f]">New password
                <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required maxLength={128} className="mt-1.5 w-full h-10 px-3 rounded-xl border border-[#d2d2d7] outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10" />
              </label>
              <p className="text-[11px] leading-relaxed text-[#6e6e73]">At least 12 characters, including uppercase, lowercase, a number, and a special character.</p>
              <label className="block text-[12px] font-medium text-[#1d1d1f]">Confirm new password
                <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required maxLength={128} className="mt-1.5 w-full h-10 px-3 rounded-xl border border-[#d2d2d7] outline-none focus:border-[#0071e3] focus:ring-2 focus:ring-[#0071e3]/10" />
              </label>
              {passwordError && <p className="text-[12px] text-[#dc2626]" role="alert">{passwordError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setPasswordOpen(false)} disabled={passwordBusy} className="h-9 px-4 rounded-full text-[12px] font-medium text-[#1d1d1f] bg-[#f5f5f7] hover:bg-[#e8e8ed] disabled:opacity-50 cursor-pointer">Cancel</button>
                <button type="submit" disabled={passwordBusy} className="h-9 px-4 rounded-full text-[12px] font-medium text-white bg-[#0071e3] hover:bg-[#0077ed] disabled:opacity-50 cursor-pointer">{passwordBusy ? 'Changing…' : 'Change password'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <main className={isWideEndorsementsPage ? 'mx-auto w-full max-w-none px-[clamp(1rem,3vw,3rem)] py-8 lg:py-10' : 'mx-auto w-full max-w-[1200px] px-6 py-10'}>
        {isToolPage && !isFrontlineDataEntryPage && (
          <Link to={isPcountSessionPage ? '/pcount' : '/'} className="print:hidden inline-flex items-center gap-1.5 mb-5 text-[12px] font-medium text-[#6e6e73] hover:text-[#2563eb] transition-colors">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {isPcountSessionPage ? 'Back to PCount' : 'Back to Tools'}
          </Link>
        )}
        <Outlet />
      </main>
    </div>
  );
}

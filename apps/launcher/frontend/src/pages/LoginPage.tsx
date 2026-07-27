import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'signup';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justSignedUp, setJustSignedUp] = useState(false);

  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (mode === 'login') {
        await login(email, password);
        navigate('/');
      } else {
        await signup(email, password, fullName);
        setJustSignedUp(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  if (justSignedUp) {
    return (
      <div className="min-h-screen bg-[#0a0a0b] flex">
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#0a0a0b] via-[#111113] to-[#1a1a2e] items-center justify-center p-12 relative overflow-hidden">
          <div className="absolute inset-0 opacity-30">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#2563eb] rounded-full blur-[128px]" />
            <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-[#7c3aed] rounded-full blur-[96px]" />
          </div>
          <div className="relative z-10 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#2563eb]/20">
              <span className="text-white text-2xl font-bold">M</span>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-3">Account created</h2>
            <p className="text-[#a1a1aa] text-sm leading-relaxed max-w-sm mx-auto">
              Your account has been created. An admin must assign your role before you can access tools. Please check back later.
            </p>
            <button
              onClick={() => { setMode('login'); setJustSignedUp(false); }}
              className="mt-8 px-6 h-10 bg-white/10 text-white text-sm font-medium rounded-lg hover:bg-white/20 transition-colors cursor-pointer"
            >
              Back to login
            </button>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] flex items-center justify-center lg:hidden shadow-lg shadow-[#2563eb]/20">
              <span className="text-white text-xl font-bold">M</span>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Account created</h2>
            <p className="text-[#a1a1aa] text-sm leading-relaxed max-w-sm">
              Your account has been created. An admin must assign your role before you can access tools. Please check back later.
            </p>
            <button
              onClick={() => { setMode('login'); setJustSignedUp(false); }}
              className="mt-6 w-full max-w-sm h-10 bg-white text-[#0a0a0b] text-sm font-medium rounded-lg hover:bg-[#e5e5e5] transition-colors cursor-pointer"
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex">
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#0a0a0b] via-[#111113] to-[#1a1a2e] items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#2563eb] rounded-full blur-[128px]" />
          <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-[#7c3aed] rounded-full blur-[96px]" />
        </div>
        <div className="relative z-10 text-center">
          <div className="w-16 h-16 mx-auto mb-8 rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#2563eb]/20">
            <span className="text-white text-2xl font-bold">M</span>
          </div>
          <h1 className="text-3xl font-semibold text-white mb-3">MSPI Tools</h1>
          <p className="text-[#a1a1aa] text-sm leading-relaxed max-w-sm mx-auto">
            Internal tool suite for MSPI operations. Access monitoring, inventory, and reporting tools with a single account.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-4 max-w-sm mx-auto">
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="w-8 h-8 rounded-lg bg-[#2563eb]/20 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-[#2563eb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p className="text-[11px] text-[#a1a1aa] font-medium">Monitor</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="w-8 h-8 rounded-lg bg-[#7c3aed]/20 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-[#7c3aed]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <p className="text-[11px] text-[#a1a1aa] font-medium">Inventory</p>
            </div>
            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <div className="w-8 h-8 rounded-lg bg-[#06b6d4]/20 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-[#06b6d4]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="text-[11px] text-[#a1a1aa] font-medium">Reports</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#2563eb] to-[#7c3aed] flex items-center justify-center shadow-lg shadow-[#2563eb]/20">
              <span className="text-white text-lg font-bold">M</span>
            </div>
            <span className="text-white text-lg font-semibold">MSPI Tools</span>
          </div>

          <h1 className="text-2xl font-semibold text-white mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create account'}
          </h1>
          <p className="text-[#a1a1aa] text-sm mb-8">
            {mode === 'login' ? 'Sign in to access your tools' : 'Register for internal tool access'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'signup' && (
              <div>
                <label className="block text-[13px] font-medium text-[#e5e5e5] mb-1.5">Full name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-10 px-3 text-[14px] bg-white/5 border border-white/10 rounded-lg text-white placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
                  placeholder="John Doe"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-[#e5e5e5] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 text-[14px] bg-white/5 border border-white/10 rounded-lg text-white placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
                placeholder="you@company.com"
                required
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#e5e5e5] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 text-[14px] bg-white/5 border border-white/10 rounded-lg text-white placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
                placeholder="Password"
                required
              />
            </div>

            {error && (
              <p className="text-[13px] text-[#ef4444]">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 bg-gradient-to-r from-[#2563eb] to-[#7c3aed] text-white text-[14px] font-medium rounded-lg hover:from-[#1d4ed8] hover:to-[#6d28d9] transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-[#2563eb]/20"
            >
              {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10">
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="w-full text-[13px] text-[#a1a1aa] hover:text-white transition-colors cursor-pointer"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

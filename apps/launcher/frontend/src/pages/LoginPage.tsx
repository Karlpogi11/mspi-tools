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

  const signupSuccess = (
    <div className="min-h-screen bg-white flex">
      <div className="hidden lg:flex lg:w-1/2 bg-[#0a0a1a] items-center justify-center p-16 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/3 -left-24 w-96 h-96 bg-[#2563eb] rounded-full blur-[160px] opacity-20" />
          <div className="absolute bottom-1/3 -right-24 w-80 h-80 bg-[#7c3aed] rounded-full blur-[120px] opacity-15" />
        </div>
        <div className="relative z-10">
          <div className="mb-8">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="white"/>
              <path d="M12 20L18 26L28 14" stroke="#0a0a1a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-2xl font-semibold text-white mb-3 tracking-tight">Account created</h2>
          <p className="text-[#8a8a9a] text-[15px] leading-relaxed max-w-sm">
            Your account has been created and is pending admin approval. You'll receive access once your role is assigned.
          </p>
          <button
            onClick={() => { setMode('login'); setJustSignedUp(false); }}
            className="mt-10 px-5 h-10 bg-white text-[#0a0a1a] text-sm font-medium rounded-lg hover:bg-[#e8e8ed] transition-colors cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#0a0a1a] flex items-center justify-center lg:hidden">
            <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
              <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-[#1a1a2e] mb-2">Account created</h2>
          <p className="text-[#6e6e7a] text-sm leading-relaxed">
            Your account has been created and is pending admin approval. You'll receive access once your role is assigned.
          </p>
          <button
            onClick={() => { setMode('login'); setJustSignedUp(false); }}
            className="mt-6 w-full h-10 bg-[#0a0a1a] text-white text-sm font-medium rounded-lg hover:bg-[#1a1a2e] transition-colors cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );

  if (justSignedUp) return signupSuccess;

  return (
    <div className="min-h-screen bg-white flex">
      <div className="hidden lg:flex lg:w-1/2 bg-[#0a0a1a] items-center justify-center p-16 relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-1/3 -left-24 w-96 h-96 bg-[#2563eb] rounded-full blur-[160px] opacity-20" />
          <div className="absolute bottom-1/3 -right-24 w-80 h-80 bg-[#7c3aed] rounded-full blur-[120px] opacity-15" />
        </div>
        <div className="relative z-10">
          <div className="mb-10">
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect width="44" height="44" rx="11" fill="white"/>
              <path d="M14 22L20 28L30 16" stroke="#0a0a1a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 className="text-[28px] font-semibold text-white mb-3 tracking-tight">MSPI Tools</h1>
          <p className="text-[#8a8a9a] text-[15px] leading-relaxed max-w-sm">
            Internal tool suite for MSPI operations. Access monitoring, inventory, and reporting tools with a single account.
          </p>
          <div className="mt-12 space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#8a8a9a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <p className="text-white text-sm font-medium">Site Monitor</p>
                <p className="text-[#6e6e7a] text-[13px]">Real-time RFPU monitoring</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#8a8a9a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <div>
                <p className="text-white text-sm font-medium">PCount</p>
                <p className="text-[#6e6e7a] text-[13px]">Inventory reconciliation</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-[#8a8a9a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-white text-sm font-medium">Reports</p>
                <p className="text-[#6e6e7a] text-[13px]">Data analytics dashboard</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-[#0a0a1a] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 40 40" fill="none">
                <path d="M12 20L18 26L28 14" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="text-[#1a1a2e] text-lg font-semibold">MSPI Tools</span>
          </div>

          <h1 className="text-[22px] font-semibold text-[#1a1a2e] mb-1.5 tracking-tight">
            {mode === 'login' ? 'Sign in' : 'Create account'}
          </h1>
          <p className="text-[#6e6e7a] text-[14px] mb-9">
            {mode === 'login' ? 'Sign in to access your tools' : 'Register for internal tool access'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === 'signup' && (
              <div>
                <label className="block text-[13px] font-medium text-[#1a1a2e] mb-1.5">Full name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-10 px-3 text-[14px] border border-[#d4d4db] rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 transition-colors"
                  placeholder="Jane Doe"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-[13px] font-medium text-[#1a1a2e] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 px-3 text-[14px] border border-[#d4d4db] rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 transition-colors"
                placeholder="name@company.com"
                required
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-[#1a1a2e] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-10 px-3 text-[14px] border border-[#d4d4db] rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 transition-colors"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <p className="text-[13px] text-[#dc2626]">{error}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 bg-[#2563eb] text-white text-[14px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#e8e8ed]">
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
              className="w-full text-[13px] text-[#6e6e7a] hover:text-[#1a1a2e] transition-colors cursor-pointer"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

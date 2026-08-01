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

  const Panel = () => (
    <div className="hidden lg:flex lg:w-[300px] xl:w-[380px] bg-[#0c0f18] items-center justify-center relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#172554]/85 via-[#1e3a8a]/45 to-transparent" />
        <div
          className="absolute inset-0 opacity-[0.38] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.32] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n2'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n2)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>
      <div className="relative z-10 flex items-end justify-end h-full w-full p-4">
        <span className="text-white/70 text-[13px] font-semibold tracking-[0.25em] uppercase">MSPI Tools</span>
      </div>
    </div>
  );

  const signupSuccess = (
    <div className="min-h-screen bg-white flex">
      <Panel />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <h2 className="text-xl font-semibold text-[#1a1a2e] mb-2">Account created</h2>
          <p className="text-[#6e6e7a] text-sm leading-relaxed">
            Your account has been created and is pending admin approval. You'll receive access once your role is assigned.
          </p>
          <button
            onClick={() => { setMode('login'); setJustSignedUp(false); }}
            className="mt-6 w-full h-10 bg-[#1e3a5f] text-white text-sm font-medium rounded-lg hover:bg-[#16304d] transition-colors cursor-pointer"
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
      <Panel />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
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

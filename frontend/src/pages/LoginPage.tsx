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
    <div className="hidden lg:flex lg:w-[300px] xl:w-[380px] bg-[#1e3a5f] items-center justify-center relative overflow-hidden">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 800" preserveAspectRatio="none" fill="none">
        <rect width="300" height="800" fill="#1e3a5f" />
        <polygon points="0,0 300,200 300,400 0,600" fill="#254a75" opacity="0.5" />
        <polygon points="300,0 0,200 0,400 300,600" fill="#16304d" opacity="0.4" />
        <polygon points="150,0 300,150 150,300 0,150" fill="#2a5684" opacity="0.3" />
        <polygon points="0,200 150,350 0,500" fill="#1d3e63" opacity="0.35" />
        <polygon points="300,400 150,550 300,700" fill="#254a75" opacity="0.25" />
        <rect x="0" y="0" width="60" height="60" fill="#2a5684" opacity="0.15" />
        <rect x="60" y="0" width="60" height="60" fill="#16304d" opacity="0.2" />
        <rect x="120" y="0" width="60" height="60" fill="#2a5684" opacity="0.15" />
        <rect x="180" y="0" width="60" height="60" fill="#16304d" opacity="0.2" />
        <rect x="240" y="0" width="60" height="60" fill="#2a5684" opacity="0.15" />
        <rect x="0" y="60" width="60" height="60" fill="#1d3e63" opacity="0.1" />
        <rect x="60" y="60" width="60" height="60" fill="#2a5684" opacity="0.15" />
        <rect x="180" y="60" width="60" height="60" fill="#1d3e63" opacity="0.1" />
        <rect x="240" y="60" width="60" height="60" fill="#2a5684" opacity="0.15" />
        <circle cx="80" cy="480" r="40" stroke="#3b6ea8" strokeWidth="1" opacity="0.2" />
        <circle cx="220" cy="350" r="55" stroke="#3b6ea8" strokeWidth="1" opacity="0.15" />
        <circle cx="150" cy="650" r="30" stroke="#3b6ea8" strokeWidth="1" opacity="0.2" />
        <polygon points="50,680 80,710 50,740 20,710" fill="#2a5684" opacity="0.15" />
        <polygon points="230,680 260,710 230,740 200,710" fill="#2a5684" opacity="0.15" />
        <polygon points="140,720 160,740 140,760 120,740" fill="#3b6ea8" opacity="0.1" />
      </svg>
      <div className="relative z-10 flex flex-col items-center gap-3">
        <svg width="56" height="56" viewBox="0 0 64 64" fill="none">
          <rect x="2" y="2" width="60" height="60" rx="12" stroke="white" strokeWidth="1.5" opacity="0.3" />
          <polygon points="32,12 44,28 38,48 26,48 20,28" stroke="white" strokeWidth="1.5" opacity="0.25" fill="none" />
          <polygon points="32,18 39,28 35,42 29,42 25,28" fill="white" opacity="0.08" />
          <line x1="32" y1="12" x2="32" y2="8" stroke="white" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
          <line x1="32" y1="52" x2="32" y2="56" stroke="white" strokeWidth="1.5" opacity="0.3" strokeLinecap="round" />
          <circle cx="32" cy="28" r="3" fill="white" opacity="0.4" />
        </svg>
        <span className="text-white/60 text-[11px] font-medium tracking-widest uppercase">MSPI Tools</span>
      </div>
    </div>
  );

  const signupSuccess = (
    <div className="min-h-screen bg-white flex">
      <Panel />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#1e3a5f] flex items-center justify-center lg:hidden">
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
              <polygon points="32,8 44,24 38,44 26,44 20,24" stroke="white" strokeWidth="1.5" opacity="0.4" fill="none" />
              <circle cx="32" cy="24" r="2.5" fill="white" opacity="0.5" />
            </svg>
          </div>
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
            <div className="w-9 h-9 rounded-lg bg-[#1e3a5f] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 64 64" fill="none">
                <polygon points="32,8 44,24 38,44 26,44 20,24" stroke="white" strokeWidth="1.5" opacity="0.4" fill="none" />
                <circle cx="32" cy="24" r="2.5" fill="white" opacity="0.5" />
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

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
    <div className="hidden lg:flex lg:w-[280px] xl:w-[320px] bg-[#0a0a1a] items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/3 -left-24 w-96 h-96 bg-[#2563eb] rounded-full blur-[160px] opacity-20" />
        <div className="absolute bottom-1/3 -right-24 w-80 h-80 bg-[#7c3aed] rounded-full blur-[120px] opacity-15" />
      </div>
      <div className="relative z-10">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" stroke="white" strokeWidth="1" opacity="0.15"/>
          <circle cx="32" cy="32" r="20" stroke="white" strokeWidth="1" opacity="0.1"/>
          <circle cx="32" cy="32" r="4" fill="white" opacity="0.4"/>
          <line x1="32" y1="2" x2="32" y2="12" stroke="white" strokeWidth="1" opacity="0.2"/>
          <line x1="32" y1="52" x2="32" y2="62" stroke="white" strokeWidth="1" opacity="0.2"/>
          <line x1="2" y1="32" x2="12" y2="32" stroke="white" strokeWidth="1" opacity="0.2"/>
          <line x1="52" y1="32" x2="62" y2="32" stroke="white" strokeWidth="1" opacity="0.2"/>
          <circle cx="16" cy="16" r="2" fill="white" opacity="0.25"/>
          <circle cx="48" cy="16" r="2" fill="white" opacity="0.25"/>
          <circle cx="16" cy="48" r="2" fill="white" opacity="0.25"/>
          <circle cx="48" cy="48" r="2" fill="white" opacity="0.25"/>
        </svg>
      </div>
    </div>
  );

  const signupSuccess = (
    <div className="min-h-screen bg-white flex">
      <Panel />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-[#0a0a1a] flex items-center justify-center lg:hidden">
            <svg width="20" height="20" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="white" strokeWidth="2" opacity="0.3"/>
              <circle cx="32" cy="32" r="3" fill="white" opacity="0.5"/>
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
      <Panel />
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-lg bg-[#0a0a1a] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 64 64" fill="none">
                <circle cx="32" cy="32" r="28" stroke="white" strokeWidth="2" opacity="0.3"/>
                <circle cx="32" cy="32" r="3" fill="white" opacity="0.5"/>
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

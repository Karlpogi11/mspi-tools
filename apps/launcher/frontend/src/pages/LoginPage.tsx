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
      <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 w-full max-w-sm mx-4 shadow-sm">
          <h1 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">Account created</h1>
          <p className="text-[14px] text-[#6e6e73] leading-relaxed">
            Your account has been created. An admin must assign your role before you can access tools. Please check back later.
          </p>
          <button
            onClick={() => { setMode('login'); setJustSignedUp(false); }}
            className="mt-6 w-full h-9 bg-[#2563eb] text-white text-[14px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
          >
            Back to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 w-full max-w-sm mx-4 shadow-sm">
        <h1 className="text-[20px] font-semibold text-[#1d1d1f] mb-6">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-9 px-3 text-[14px] border border-[#d2d2d7] rounded-lg bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
                placeholder="John Doe"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full h-9 px-3 text-[14px] border border-[#d2d2d7] rounded-lg bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
              placeholder="you@mspi.io"
              required
            />
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 px-3 text-[14px] border border-[#d2d2d7] rounded-lg bg-white text-[#1d1d1f] placeholder-[#6e6e73] outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] transition-colors"
              placeholder="Password"
              required
            />
          </div>

          {error && (
            <p className="text-[13px] text-[#dc2626]">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-9 bg-[#2563eb] text-white text-[14px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#d2d2d7]">
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); }}
            className="w-full text-[13px] text-[#2563eb] hover:text-[#1d4ed8] transition-colors cursor-pointer"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

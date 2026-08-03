import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';

type Mode = 'login' | 'signup';

const ALLOWED_DOMAINS = ['mspi.io', 'mobilecare.com', 'powermaccenter.com'];

function getEmailDomain(email: string): string | null {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justSignedUp, setJustSignedUp] = useState(false);

  const { login, signup } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailError('');

    if (mode === 'signup') {
      const domain = getEmailDomain(email);
      if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
        setEmailError('Enter a valid company email address.');
        return;
      }
    }

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
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="text-center w-full max-w-[340px]">
        <span className="text-[#1a1a2e] text-[15px] font-semibold block mb-6">MSPI Tools</span>
        <h2 className="text-[17px] font-semibold text-[#1a1a2e] mb-1.5">Account created</h2>
        <p className="text-[#6e6e7a] text-[12.5px] leading-relaxed">
          Your account has been created and is pending admin approval. You'll receive access once your role is assigned.
        </p>
        <button
          onClick={() => { setMode('login'); setJustSignedUp(false); }}
          className="mt-5 w-full h-9 bg-[#1e3a5f] text-white text-[13px] font-medium rounded-lg hover:bg-[#16304d] transition-colors cursor-pointer"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );

  if (justSignedUp) return signupSuccess;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-[340px]">
        <div className="flex items-center gap-3 mb-7">
          <span className="text-[#1a1a2e] text-[15px] font-semibold">MSPI Tools</span>
        </div>

        <h1 className="text-[18px] font-semibold text-[#1a1a2e] mb-1 tracking-tight">
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </h1>
        <p className="text-[#6e6e7a] text-[12.5px] mb-7">
          {mode === 'login' ? 'Sign in to access your tools' : 'Register for internal tool access'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === 'signup' && (
            <div>
              <label className="block text-[12.5px] font-medium text-[#1a1a2e] mb-1">Full name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full h-9 px-3 text-[13px] border border-[#d4d4db] rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 transition-colors"
                placeholder="Jane Doe"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-[12.5px] font-medium text-[#1a1a2e] mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
              className={`w-full h-9 px-3 text-[13px] border rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:ring-2 transition-colors ${
                emailError
                  ? 'border-[#dc2626] focus:border-[#dc2626] focus:ring-[#dc2626]/10'
                  : 'border-[#d4d4db] focus:border-[#2563eb] focus:ring-[#2563eb]/10'
              }`}
              placeholder="name@company.com"
              required
            />
            {emailError && <p className="mt-1 text-[12.5px] text-[#dc2626]">{emailError}</p>}
          </div>

          <div>
            <label className="block text-[12.5px] font-medium text-[#1a1a2e] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full h-9 px-3 text-[13px] border border-[#d4d4db] rounded-lg bg-white text-[#1a1a2e] placeholder-[#9e9ea8] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10 transition-colors"
              placeholder="Enter your password"
              required
            />
          </div>

          {error && (
            <p className="text-[12.5px] text-[#dc2626]">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-9 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-[#e8e8ed]">
          <button
            onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setEmailError(''); }}
            className="w-full text-[12.5px] text-[#6e6e7a] hover:text-[#1a1a2e] transition-colors cursor-pointer"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
  );
}

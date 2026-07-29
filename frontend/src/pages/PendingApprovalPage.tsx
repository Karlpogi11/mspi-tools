import { useAuth } from '../lib/auth';

export default function PendingApprovalPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-[#f5f5f7] flex items-center justify-center">
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 w-full max-w-sm mx-4 shadow-sm text-center">
        <div className="w-12 h-12 bg-[#fef3c7] rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-[#d97706]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">Account pending approval</h1>
        <p className="text-[14px] text-[#6e6e73] leading-relaxed mb-1">
          Your account (<span className="text-[#1d1d1f]">{user?.email}</span>) has been created but hasn't been assigned a role yet.
        </p>
        <p className="text-[14px] text-[#6e6e73] leading-relaxed mb-6">
          Please wait for an admin to grant you access. You'll be able to use the tools once your role is assigned.
        </p>
        <button
          onClick={logout}
          className="w-full h-9 bg-[#2563eb] text-white text-[14px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

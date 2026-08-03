import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

const adminTools = [
  {
    to: '/admin/pcount',
    name: 'PCount',
    description: 'Product counting sessions — results by date, review and export.',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    to: '/admin/users',
    name: 'Users',
    description: 'Manage user accounts, roles, and approvals.',
    icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
  {
    to: '/admin/tools',
    name: 'Tools',
    description: 'Manage available tools and role access.',
    icon: 'M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z',
  },
];

export default function AdminPage() {
  const { user } = useAuth();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold text-[#1d1d1f] tracking-tight">Admin Panel</h1>
        <p className="text-[14px] text-[#6e6e73] mt-1.5">
          Select a tool to manage its data and results.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {adminTools.map((tool) => (
          <Link
            key={tool.to}
            to={tool.to}
            className="group bg-white rounded-xl border border-[#d2d2d7] p-5 hover:border-[#2563eb] transition-all no-underline"
          >
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-[#f5f5f7] text-[#2563eb]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={tool.icon} />
              </svg>
            </div>
            <h3 className="text-[15px] font-semibold text-[#1d1d1f] mt-4 group-hover:text-[#2563eb] transition-colors">
              {tool.name}
            </h3>
            <p className="text-[13px] text-[#6e6e73] mt-1.5 leading-relaxed">
              {tool.description}
            </p>
          </Link>
        ))}
      </div>

      <p className="text-[12px] text-[#6e6e73] mt-6">
        Signed in as {user?.fullName || user?.email} ({user?.roleName || 'no role'})
      </p>
    </div>
  );
}

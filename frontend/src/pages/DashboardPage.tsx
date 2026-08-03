import { useState, useEffect } from 'react';
import { api, type Tool } from '../lib/api';
import { useAuth } from '../lib/auth';

const iconMap: Record<string, string> = {
  monitor: 'M3 8.5V5a2 2 0 012-2h14a2 2 0 012 2v3.5M3 8.5v6a2 2 0 002 2h14a2 2 0 002-2v-6M3 8.5h18M8 16l-1 4m4-4l-1 4m4-4l-1 4',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  table: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z M3 10h18 M3 15h18 M9 10v9 M15 10v9',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z M7 7h.01',
  default: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512a9.025 9.025 0 015.488 5.488z',
};

function ToolIcon({ icon, active }: { icon: string; active: boolean }) {
  const path = iconMap[icon] || iconMap.default;
  return (
    <div className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${active ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#2563eb]'}`}>
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tools, setTools] = useState<Tool[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.myTools()
      .then(setTools)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[14px] text-[#6e6e73]">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-10">
        <h1 className="text-[28px] font-semibold text-[#1d1d1f] tracking-tight">Tools</h1>
        <p className="text-[14px] text-[#6e6e73] mt-1.5">
          Welcome back, {user?.fullName || user?.email}
        </p>
      </div>

      {tools.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-10 text-center">
          <div className="w-10 h-10 mx-auto mb-4 flex items-center justify-center rounded-xl bg-[#f5f5f7] text-[#2563eb]">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={iconMap.default} />
            </svg>
          </div>
          <p className="text-[15px] text-[#1d1d1f] font-medium">No tools available</p>
          <p className="text-[13px] text-[#6e6e73] mt-1.5">
            There are no tools assigned to your role yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map((tool) => (
            <a
              key={tool.id}
              href={tool.url}
              className="group bg-white rounded-xl border border-[#d2d2d7] p-5 hover:border-[#2563eb] transition-all no-underline"
            >
              <ToolIcon icon={tool.icon} active={false} />
              <h3 className="text-[15px] font-semibold text-[#1d1d1f] mt-4 group-hover:text-[#2563eb] transition-colors">
                {tool.name}
              </h3>
              <p className="text-[13px] text-[#6e6e73] mt-1.5 leading-relaxed">
                {tool.description}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
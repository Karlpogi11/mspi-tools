import { useState, useEffect } from 'react';
import { api, type Tool } from '../lib/api';

const iconMap: Record<string, string> = {
  monitor: 'M3 8.5V5a2 2 0 012-2h14a2 2 0 012 2v3.5M3 8.5v6a2 2 0 002 2h14a2 2 0 002-2v-6M3 8.5h18M8 16l-1 4m4-4l-1 4m4-4l-1 4',
  tools: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  database: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  default: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512a9.025 9.025 0 015.488 5.488z',
};

function ToolIcon({ icon }: { icon: string }) {
  const path = iconMap[icon] || iconMap.default;
  return (
    <svg className="w-8 h-8 text-[#2563eb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

export default function DashboardPage() {
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
      <div className="mb-8">
        <h1 className="text-[24px] font-semibold text-[#1d1d1f]">Internal Tools</h1>
        <p className="text-[14px] text-[#6e6e73] mt-1">
          Welcome, Admin
        </p>
      </div>

      {tools.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-8 text-center shadow-sm">
          <p className="text-[15px] text-[#1d1d1f] font-medium">No tools available</p>
          <p className="text-[13px] text-[#6e6e73] mt-2">
            There are no tools assigned to your role yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tools.map((tool) => (
            <a
              key={tool.id}
              href={tool.url}
              className="group bg-white rounded-xl border border-[#d2d2d7] p-5 hover:border-[#2563eb] hover:shadow-sm transition-all duration-150 no-underline"
            >
              <ToolIcon icon={tool.icon} />
              <h3 className="text-[15px] font-semibold text-[#1d1d1f] mt-3 group-hover:text-[#2563eb] transition-colors">
                {tool.name}
              </h3>
              <p className="text-[13px] text-[#6e6e73] mt-1 leading-relaxed">
                {tool.description}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

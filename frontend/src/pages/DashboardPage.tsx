import { api, type Tool } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useCachedQuery } from '../lib/queryCache';

const iconMap: Record<string, string> = {
  monitor: 'M3 8.5V5a2 2 0 012-2h14a2 2 0 012 2v3.5M3 8.5v6a2 2 0 002 2h14a2 2 0 002-2v-6M3 8.5h18M8 16l-1 4m4-4l-1 4m4-4l-1 4',
  clipboard: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  table: 'M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z M3 10h18 M3 15h18 M9 10v9 M15 10v9',
  tag: 'M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z M7 7h.01',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  extension: 'M8 3v5m8-5v5M5 8h14M6 8v10a2 2 0 002 2h8a2 2 0 002-2V8M10 12v4m4-4v4',
  package: 'm16.5 9.4 5-2.9M3 7l9 5 9-5M12 12v9M20 8.5v7a2 2 0 01-1 1.7l-6 3.4a2 2 0 01-2 0l-6-3.4a2 2 0 01-1-1.7v-7a2 2 0 011-1.7l6-3.4a2 2 0 012 0l6 3.4a2 2 0 011 1.7Z',
  default: 'M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z M20.488 9H15V3.512a9.025 9.025 0 015.488 5.488z',
};

function ToolIcon({ icon, active }: { icon: string; active: boolean }) {
  const path = iconMap[icon] || iconMap.default;
  return (
    <div className={`flex h-5 w-5 items-center justify-center transition-colors ${active ? 'text-[#1d1d1f]' : 'text-[#1d1d1f]'}`}>
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={path} />
      </svg>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: tools = [], loading } = useCachedQuery<Tool[]>('my-tools', api.myTools);

  const visibleTools = tools.filter(tool => tool.name.trim().toLowerCase() !== 'site monitor');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[14px] text-[#6e6e73]">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-128px)] w-full flex-col bg-[#F4F3F6]">
      <div className="mb-8">
        <h1 className="text-[28px] font-semibold leading-[1.1] tracking-[-0.022em] text-[#1d1d1f]">Tools</h1>
        <p className="mt-1.5 text-[14px] leading-[1.4] tracking-[-0.005em] text-[#6e6e73]">
          Welcome back, {user?.fullName || user?.email}
        </p>
      </div>

      {visibleTools.length === 0 ? (
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
        <div className="mx-auto my-auto grid w-full max-w-[1120px] -translate-y-[clamp(16px,4vh,40px)] auto-rows-fr grid-cols-1 justify-center gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visibleTools.map((tool) => (
            <a
              key={tool.id}
              href={tool.url}
              className="group relative flex h-full min-h-[clamp(150px,18vw,190px)] w-full flex-col rounded-[14px] border border-black/[0.06] bg-[#FFFFFF] p-4 no-underline shadow-[0_1px_2px_rgba(0,0,0,0.02),0_3px_10px_rgba(0,0,0,0.025)] transition-all duration-200 hover:-translate-y-0.5 hover:border-black/[0.1] hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_8px_18px_rgba(0,0,0,0.07)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 focus-visible:ring-offset-2"
            >
              <ToolIcon icon={tool.icon} active={false} />
              <h3 className="mt-3 text-[19px] font-medium leading-[1.1] tracking-[-0.014em] text-[#1d1d1f]">
                {tool.name}
              </h3>
              <p className="mt-1.5 max-w-[18rem] flex-1 pr-4 text-[12px] leading-[1.35] tracking-[-0.002em] text-[#1d1d1f]">
                {tool.description}
              </p>
              <span aria-hidden="true" className="absolute bottom-3.5 right-3.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1d1d1f] text-white transition-transform duration-200 group-hover:translate-x-0.5">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

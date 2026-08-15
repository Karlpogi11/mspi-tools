import ToolHelp from '../components/ToolHelp';

export default function RfpuPage() {
  return (
    <div className="min-h-[80vh] bg-[#f5f5f7] flex items-center justify-center">
      <div className="relative bg-white rounded-xl border border-[#d2d2d7] p-8 max-w-md mx-4 shadow-sm text-center">
        <div className="absolute right-4 top-4">
          <ToolHelp
            toolName="RFPU Site Monitor"
            purpose="Provide a clear status and access point for the separately deployed RFPU service used for RFPU operational workflows."
            steps={[
              'Open the Site Monitor to confirm the RFPU service location.',
              'Use the RFPU deployment at rfpu.mspi.io for the operational workflow.',
              'Return here to confirm service information when needed.',
            ]}
            cards={[
              { title: 'Deployment', description: 'RFPU runs as a separate service at rfpu.mspi.io.' },
              { title: 'Scope', description: 'This page provides deployment status information; RFPU work happens in the dedicated service.' },
            ]}
          />
        </div>
        <svg className="w-10 h-10 text-[#2563eb] mx-auto mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5V5a2 2 0 012-2h14a2 2 0 012 2v3.5M3 8.5v6a2 2 0 002 2h14a2 2 0 002-2v-6M3 8.5h18M8 16l-1 4m4-4l-1 4m4-4l-1 4" />
        </svg>
        <h1 className="text-[20px] font-semibold text-[#1d1d1f] mb-2">Site Monitor</h1>
        <p className="text-[14px] text-[#6e6e73] leading-relaxed">
          Real-time site monitoring and performance tracking for RFPU deployments. This app is already deployed at <span className="text-[#2563eb]">rfpu.mspi.io</span>.
        </p>
      </div>
    </div>
  );
}

import { type ScanResult } from '../../lib/api';

interface Props {
  lastScan: ScanResult | null;
  onRecount: (code: string) => void;
  onStatusChange: (code: string, status: string) => void;
  stats: { total: number; checked: number; matched: number; missing: number; pending: number };
  progress: number;
}

export default function ScanPanel({ lastScan, onRecount, onStatusChange, stats, progress }: Props) {
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-5">
        <h3 className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider mb-1">Progress</h3>
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#e5e5e5" strokeWidth="4" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="#2563eb" strokeWidth="4"
                strokeDasharray={`${Math.min(progress, 100) * 1.76} 176`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.4s ease' }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[14px] font-bold text-[#2563eb]">
              {progress}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <div><span className="font-semibold text-[#1d1d1f]">{stats.checked}</span> <span className="text-[#6e6e73]">/ {stats.total} checked</span></div>
            <div><span className="font-semibold text-[#16a34a]">{stats.matched}</span> <span className="text-[#6e6e73]">matched</span></div>
            <div><span className="font-semibold text-[#d97706]">{stats.missing}</span> <span className="text-[#6e6e73]">missing</span></div>
            <div><span className="font-semibold text-[#6e6e73]">{stats.pending}</span> <span className="text-[#6e6e73]">pending</span></div>
          </div>
        </div>
      </div>

      {lastScan ? (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[12px] font-semibold text-[#6e6e73] uppercase tracking-wider">Last Scanned</h3>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
              lastScan.match ? 'bg-[#f0fdf4] text-[#16a34a]' : 'bg-[#fffbeb] text-[#d97706]'
            }`}>
              {lastScan.match ? '\u2713 Matched' : '\u26a0 Mismatch'}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-[#6e6e73] uppercase tracking-wider mb-0.5">Product Code</p>
              <p className="text-[15px] font-mono font-semibold text-[#1d1d1f]">{lastScan.product_code}</p>
            </div>
            <div>
              <p className="text-[11px] text-[#6e6e73] uppercase tracking-wider mb-0.5">Description</p>
              <p className="text-[13px] text-[#1d1d1f]">{lastScan.description || '\u2014'}</p>
            </div>
            <div className="flex gap-4">
              <div className="flex-1 bg-[#f5f5f7] rounded-lg p-3 text-center">
                <p className="text-[11px] text-[#6e6e73] uppercase tracking-wider mb-1">System Qty</p>
                <p className="text-[22px] font-bold text-[#1d1d1f]">{lastScan.system_qty}</p>
              </div>
              <div className={`flex-1 rounded-lg p-3 text-center ${
                lastScan.match ? 'bg-[#f0fdf4] ring-1 ring-[#86efac]' : 'bg-[#fffbeb] ring-1 ring-[#fde68a]'
              }`}>
                <p className="text-[11px] text-[#6e6e73] uppercase tracking-wider mb-1">Actual Qty</p>
                <p className={`text-[22px] font-bold ${
                  lastScan.match ? 'text-[#16a34a]' : 'text-[#d97706]'
                }`}>{lastScan.counted_qty}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <select
                value={lastScan.status}
                onChange={e => onStatusChange(lastScan.product_code, e.target.value)}
                className="flex-1 px-3 py-2 border border-[#d2d2d7] rounded-lg text-[13px] bg-white cursor-pointer"
              >
                <option value="pending">Pending</option>
                <option value="matched">Matched</option>
                <option value="missing">Missing</option>
                <option value="defect">Defect</option>
                <option value="stolen">Stolen</option>
                <option value="ignored">Ignored</option>
              </select>
              <button
                onClick={() => onRecount(lastScan.product_code)}
                className="px-4 py-2 border border-[#d2d2d7] text-[13px] rounded-lg hover:bg-[#f5f5f7] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                </svg>
                Recount
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-5">
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <svg className="w-10 h-10 text-[#d2d2d7] mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
            </svg>
            <p className="text-[14px] text-[#6e6e73]">Scan a product to see details</p>
            <p className="text-[12px] text-[#d2d2d7] mt-1">Use the barcode scanner below</p>
          </div>
        </div>
      )}
    </div>
  );
}

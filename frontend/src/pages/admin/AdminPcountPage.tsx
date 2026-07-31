import { useState, useEffect, useCallback } from 'react';
import { api, type PcountAdminSession, type PcountAdminDetail } from '../../lib/api';

function toDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminPcountPage() {
  const [sessions, setSessions] = useState<PcountAdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PcountAdminDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const list = await api.pcountAdmin.listSessions();
      setSessions(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openSession(id: number) {
    setDetailLoading(true);
    setError('');
    try {
      const detail = await api.pcountAdmin.getSession(id);
      setSelected(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setDetailLoading(false);
    }
  }

  if (loading) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Loading...</div>;
  }

  if (selected) {
    const s = selected.session;
    const byCategory = (cat: string) =>
      selected.products.filter(p => p.category === cat);
    return (
      <div>
        <button
          onClick={() => setSelected(null)}
          className="text-[13px] text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer mb-4"
        >
          &larr; Back to sessions
        </button>

        <div className="bg-white rounded-xl border border-[#d2d2d7] p-5 mb-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-[20px] font-semibold text-[#1d1d1f] tracking-tight">{s.name}</h1>
              <p className="text-[12px] text-[#6e6e73] mt-1">
                Created {new Date(s.created_at).toLocaleString()}
                {selected.creator ? ` by ${selected.creator.email}` : ''}
              </p>
              <p className="text-[12px] text-[#6e6e73] mt-0.5">
                {s.submitted_at && (
                  <span className="text-[#15803d] font-medium">
                    Submitted {new Date(s.submitted_at).toLocaleString()}
                    {selected.submitter ? ` by ${selected.submitter.email}` : ''}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <a
                href={api.pcountAdmin.exportUrl(s.id)}
                className="px-4 py-2 bg-[#15803d] text-white text-[13px] font-medium rounded-lg hover:bg-[#166534] transition-colors cursor-pointer"
              >
                Export Excel
              </a>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-5 text-center">
            {[
              { label: 'Total', value: s.total },
              { label: 'Checked', value: s.checked },
              { label: 'Progress', value: `${s.progress}%` },
            ].map(stat => (
              <div key={stat.label} className="bg-[#f5f5f7] rounded-lg py-3">
                <div className="text-[20px] font-bold text-[#1d1d1f]">{stat.value}</div>
                <div className="text-[11px] text-[#6e6e73] mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#d2d2d7] bg-[#fafafa]">
                {['Product Code', 'Description', 'Category', 'System Qty', 'Counted Qty', 'Adjusted', 'Status', 'Notes'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-[11px] font-semibold text-[#6e6e73] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.products.map(p => (
                <tr key={p.id} className="border-b border-[#f0f0f2]">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-[#1d1d1f]">{p.product_code}</td>
                  <td className="px-4 py-2.5 text-[13px] text-[#6e6e73] max-w-[220px] truncate">{p.description}</td>
                  <td className="px-4 py-2.5 text-[13px] text-[#6e6e73]">{p.category || '—'}</td>
                  <td className="px-4 py-2.5 text-[13px] text-[#1d1d1f]">{p.system_qty}</td>
                  <td className="px-4 py-2.5 text-[13px] font-semibold text-[#1d1d1f]">{p.counted_qty}</td>
                  <td className="px-4 py-2.5 text-[13px] text-[#6e6e73]">{p.adjusted_qty ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded-lg font-medium ${
                      p.status === 'matched' ? 'text-[#16a34a] bg-[#f0fdf4]' :
                      p.status === 'missing' ? 'text-[#d97706] bg-[#fffbeb]' :
                      'text-[#6e6e73] bg-[#f5f5f7]'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[13px] text-[#6e6e73] max-w-[200px] truncate">{p.notes || '—'}</td>
                </tr>
              ))}
              {selected.products.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-[13px] text-[#6e6e73]">No products in this session.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const dates = new Map<string, PcountAdminSession[]>();
  for (const s of sessions) {
    const key = toDateKey(s.created_at);
    if (!dates.has(key)) dates.set(key, []);
    dates.get(key)!.push(s);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[26px] font-semibold text-[#1d1d1f] tracking-tight">PCount Admin</h1>
          <p className="text-[14px] text-[#6e6e73] mt-1">Sessions organized by date</p>
        </div>
        <button
          onClick={load}
          className="px-4 py-2 border border-[#d2d2d7] text-[13px] font-medium rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-center justify-between gap-4 border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          <span>{error}</span>
          <button onClick={() => { setError(''); load(); }} className="font-medium underline cursor-pointer">Retry</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="bg-white border border-[#d2d2d7] p-12 text-center">
          <p className="text-[14px] text-[#6e6e73]">No sessions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {Array.from(dates.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([date, dateSessions]) => {
            const expanded = expandedDates.has(date);
            const submittedCount = dateSessions.filter(s => s.submitted_at).length;
            return (
              <div key={date} className="bg-white border border-[#d2d2d7] rounded-xl overflow-hidden">
                <button
                  onClick={() => {
                    const next = new Set(expandedDates);
                    if (expanded) next.delete(date); else next.add(date);
                    setExpandedDates(next);
                  }}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#fafafa] transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-[15px] font-semibold text-[#1d1d1f]">
                      {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <span className="text-[12px] text-[#6e6e73]">
                      {dateSessions.length} session{dateSessions.length > 1 ? 's' : ''}
                    </span>
                    {submittedCount > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0fdf4] text-[#15803d] font-medium">
                        {submittedCount} submitted
                      </span>
                    )}
                  </div>
                  <svg
                    className={`w-4 h-4 text-[#6e6e73] transition-transform ${expanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {expanded && (
                  <div className="border-t border-[#d2d2d7] divide-y divide-[#f0f0f2]">
                    {dateSessions.map(s => (
                      <button
                        key={s.id}
                        onClick={() => openSession(s.id)}
                        className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#fafafa] transition-colors cursor-pointer text-left"
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="relative w-9 h-9 flex-shrink-0">
                            <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
                              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e5e5" strokeWidth="3" />
                              <circle
                                cx="18" cy="18" r="15.5" fill="none" stroke="#2563eb" strokeWidth="3"
                                strokeDasharray={`${s.progress * 0.97} 97.4`}
                                strokeLinecap="round"
                              />
                            </svg>
                            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-[#2563eb]">
                              {s.progress}%
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-[14px] font-medium text-[#1d1d1f] truncate">{s.name}</h3>
                            <p className="text-[12px] text-[#6e6e73] mt-0.5">
                              {s.checked}/{s.total} checked &middot; {s.member_count} member{s.member_count === 1 ? '' : 's'}
                              {s.submitted_at && <span className="text-[#15803d]">&middot; Submitted</span>}
                            </p>
                          </div>
                        </div>
                        <span className="text-[12px] text-[#2563eb] flex-shrink-0 ml-4">View results &rarr;</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

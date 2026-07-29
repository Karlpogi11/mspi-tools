import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Session } from '../../lib/api';

export default function PcountIndexPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function load() {
    try {
      setError('');
      const list = await api.sessions.list();
      setSessions(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load sessions';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const presenceTimer = setInterval(load, 5000);
    return () => clearInterval(presenceTimer);
  }, []);

  async function createSession() {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const s = await api.sessions.create();
      navigate(`/pcount/session/${s.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setCreating(false);
    }
  }

  async function deleteSession(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    try {
      await api.sessions.delete(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  }

  if (loading) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[26px] font-semibold text-[#1d1d1f] tracking-tight">PCount</h1>
          <p className="text-[14px] text-[#6e6e73] mt-1">Product counting sessions</p>
        </div>
        <button
          onClick={createSession}
          disabled={creating}
          className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {creating ? 'Creating\u2026' : 'New session'}
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-center justify-between gap-4 border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          <span>{error}</span>
          <button onClick={load} className="font-medium underline cursor-pointer">Retry</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="bg-white border border-[#d2d2d7] p-12 text-center">
          <p className="text-[14px] text-[#6e6e73]">No sessions yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-2">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/pcount/session/${s.id}`)}
              className="bg-white border border-[#d2d2d7] px-5 py-4 hover:border-[#2563eb] transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-5 min-w-0">
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
                      {s.status} &middot; {new Date(s.created_at).toLocaleDateString()} &middot; {s.checked}/{s.total} checked
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 flex-shrink-0 ml-4">
                  <div className="flex items-center gap-2">
                    {s.online_count ? (
                      <span className="inline-flex items-center gap-1 text-[#16a34a] text-[12px]">
                        <span className="w-1.5 h-1.5 bg-[#16a34a]" />
                        {s.online_count}
                      </span>
                    ) : null}
                    {!!s.active_scanner_count && (
                      <span className="text-[#a16207] text-[12px]">
                        {s.active_scanner_count} scanning
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="text-[#6e6e73] hover:text-[#dc2626] text-[12px] font-medium transition-colors cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

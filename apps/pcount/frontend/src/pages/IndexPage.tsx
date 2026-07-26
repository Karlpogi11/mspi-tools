import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Session } from '../lib/api';

export default function IndexPage() {
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
      console.error('Failed to load sessions', err);
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
      navigate(`/session/${s.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      console.error('Failed to create session', err);
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
      const message = err instanceof Error ? err.message : 'Failed to delete session';
      setError(message);
      console.error('Failed to delete session', err);
    }
  }

  if (loading) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[20px] font-semibold text-[#1d1d1f]">Inventory Sessions</h1>
        <button
          onClick={createSession}
          disabled={creating}
          className="px-4 py-2 bg-[#2563eb] text-white text-[13px] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {creating ? 'Creating…' : '+ New Session'}
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          <span>{error}</span>
          <button onClick={load} className="font-medium underline cursor-pointer">Retry</button>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-12 text-center">
          <p className="text-[14px] text-[#6e6e73]">No sessions yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/session/${s.id}`)}
              className="bg-white rounded-xl border border-[#d2d2d7] p-5 hover:border-[#2563eb] hover:shadow-sm transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-[15px] font-medium text-[#1d1d1f]">{s.name}</h3>
                  <p className="text-[12px] text-[#6e6e73] mt-0.5">
                    {s.status} &middot; {new Date(s.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-[13px] text-[#6e6e73]">{s.checked}/{s.total} checked</p>
                    <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-[#6e6e73]">
                      {s.online_count ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#f0fdf4] px-2 py-0.5 text-[#15803d]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
                          {s.online_count} online
                        </span>
                      ) : (
                        <span className="text-[#9ca3af]">No one online</span>
                      )}
                      {!!s.active_scanner_count && (
                        <span className="rounded-full bg-[#fffbeb] px-2 py-0.5 text-[#a16207]">
                          {s.active_scanner_count} scanning
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative w-10 h-10">
                    <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="#e5e5e5" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.5" fill="none" stroke="#2563eb" strokeWidth="3"
                        strokeDasharray={`${s.progress * 0.97} 97.4`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-[#2563eb]">
                      {s.progress}%
                    </span>
                  </div>
                  <button
                    onClick={(e) => deleteSession(s.id, e)}
                    className="text-[#dc2626] hover:text-[#b91c1c] text-[13px] cursor-pointer"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="w-full bg-[#e5e5e5] rounded-full h-1.5">
                <div
                  className="bg-[#2563eb] h-1.5 rounded-full transition-all"
                  style={{ width: `${s.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

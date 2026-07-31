import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Session } from '../../lib/api';

export default function PcountIndexPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Session[]>([]);
  const [joinTarget, setJoinTarget] = useState<Session | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [ownedSessionId, setOwnedSessionId] = useState<number | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        setSearchResults(await api.sessions.search(q));
      } catch {
        setSearchResults([]);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQuery]);

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

  function openSession(s: Session) {
    if (s.is_owner || s.joined) {
      navigate(`/pcount/session/${s.id}`);
      return;
    }
    setJoinTarget(s);
    setJoinCodeInput('');
  }

  async function joinWithCode(code?: string) {
    if (joining) return;
    setJoining(true);
    setJoinError('');
    setOwnedSessionId(null);
    try {
      const s = await api.sessions.join(code || joinCodeInput);
      navigate(`/pcount/session/${s.id}`);
    } catch (err) {
      const e = err as Error & { data?: { sessionId?: number } };
      setJoinError(e instanceof Error ? e.message : 'Failed to join session');
      setOwnedSessionId(e?.data?.sessionId ?? null);
    } finally {
      setJoining(false);
    }
  }

  function SessionCard({ s }: { s: Session }) {
    return (
      <div
        onClick={() => openSession(s)}
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
                {s.owner_email && (
                  <span className="ml-1.5">&middot; Owner: {s.is_owner ? 'You' : s.owner_email}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0 ml-4">
            {s.is_owner && s.join_code && (
              <span className="text-[12px] font-semibold text-[#2563eb] tracking-widest border border-[#2563eb]/30 bg-[#2563eb]/5 px-2 py-1 rounded-lg">
                Code: {s.join_code}
              </span>
            )}
            {!s.is_owner && s.joined && (
              <span className="text-[12px] text-[#6e6e73]">Joined</span>
            )}
            {!s.is_owner && !s.joined && (
              <button
                onClick={(e) => { e.stopPropagation(); openSession(s); }}
                className="text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer"
              >
                Join
              </button>
            )}
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
            {s.is_owner && (
              <button
                onClick={(e) => deleteSession(s.id, e)}
                className="text-[#6e6e73] hover:text-[#dc2626] text-[12px] font-medium transition-colors cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      </div>
    );
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

  const allSessions = sessions;

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
          className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
        >
          {creating ? 'Creating\u2026' : 'New session'}
        </button>
      </div>

      <div className="mb-5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by session name or 4-digit code..."
          className="w-full max-w-md px-4 py-2.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb]"
        />
      </div>

      {error && (
        <div className="mb-5 flex items-center justify-between gap-4 border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#b91c1c]">
          <span>{error}</span>
          <button onClick={() => { setError(''); load(); }} className="font-medium underline cursor-pointer">Retry</button>
        </div>
      )}

      {searchQuery.trim() ? (
        <>
          <h2 className="text-[13px] font-medium text-[#6e6e73] mb-2">Search results</h2>
          {searchResults.length === 0 ? (
            <div className="bg-white border border-[#d2d2d7] p-8 text-center">
              <p className="text-[13px] text-[#6e6e73]">
                No sessions found{/^\d{4}$/.test(searchQuery.trim()) ? ' with that code' : ''}.
              </p>
              {/^\d{4}$/.test(searchQuery.trim()) && (
                <button
                  onClick={() => joinWithCode()}
                  disabled={joining}
                  className="mt-3 px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {joining ? 'Joining\u2026' : 'Join with this code'}
                </button>
              )}
            </div>
          ) : (
            <div className="grid gap-2 mb-6">
              {searchResults.map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <h2 className="text-[13px] font-medium text-[#6e6e73] mb-2">All sessions</h2>
          {allSessions.length === 0 ? (
            <div className="bg-white border border-[#d2d2d7] p-12 text-center">
              <p className="text-[14px] text-[#6e6e73] mb-2">
                No sessions yet. Create one to get started.
              </p>
              <button
                onClick={createSession}
                className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors cursor-pointer"
              >
                New session
              </button>
            </div>
          ) : (
            <div className="grid gap-2">
              {allSessions.map((s) => (
                <SessionCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </>
      )}

      {joinTarget && !joinTarget.is_owner && !joinTarget.joined && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm">
            <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Join session</h3>
            <p className="text-[13px] text-[#6e6e73] mt-1">
              Enter the 4-digit code for &ldquo;{joinTarget.name}&rdquo; to join.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={joinCodeInput}
              onChange={(e) => {
                setJoinCodeInput(e.target.value.replace(/\D/g, ''));
                if (joinError) setJoinError('');
              }}
              autoFocus
              className={`mt-4 w-full px-4 py-2.5 border rounded-lg text-[20px] font-semibold tracking-[0.5em] text-center bg-white focus:outline-none transition-colors ${
                joinError
                  ? 'border-[#dc2626] focus:border-[#dc2626]'
                  : 'border-[#d2d2d7] focus:border-[#2563eb]'
              }`}
              placeholder="0000"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && /^\d{4}$/.test(joinCodeInput)) joinWithCode();
              }}
            />
            {joinError && (
              <div className="mt-2">
                <p className="text-[12px] text-[#dc2626] flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
                  </svg>
                  {joinError}
                </p>
                {ownedSessionId && (
                  <button
                    onClick={() => navigate(`/pcount/session/${ownedSessionId}`)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-[#2563eb] hover:text-[#1d4ed8] hover:underline transition-colors cursor-pointer"
                  >
                    Open session
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M7 17L17 7M17 7H8M17 7v9" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => { setJoinTarget(null); setJoinCodeInput(''); setJoinError(''); setOwnedSessionId(null); }}
                className="flex-1 px-4 py-2 border border-[#d2d2d7] text-[#1d1d1f] text-[13px] font-medium rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => joinWithCode()}
                disabled={! /^\d{4}$/.test(joinCodeInput) || joining}
                className="flex-1 px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {joining ? 'Joining\u2026' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

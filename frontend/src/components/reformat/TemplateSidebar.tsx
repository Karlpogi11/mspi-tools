import { useState, useEffect, useRef } from 'react';
import { api, type ReformatTemplate, type ReformatUser } from '../../lib/api';

export function ShareTemplateModal({ template, onClose, onChanged, onError }: {
  template: ReformatTemplate;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [shares, setShares] = useState<ReformatUser[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReformatUser[]>([]);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.reformat.listShares(template.id).then(setShares).catch((e) => onError(e.message));
  }, [template.id, onError]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      api.reformat.searchUsers(q).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  async function shareWith(user: ReformatUser) {
    setBusy(true);
    try {
      await api.reformat.share(template.id, user.email);
      setShares(await api.reformat.listShares(template.id));
      setQuery('');
      setResults([]);
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Share failed');
    } finally {
      setBusy(false);
    }
  }

  async function unshare(userId: number) {
    setBusy(true);
    try {
      await api.reformat.unshare(template.id, userId);
      setShares(await api.reformat.listShares(template.id));
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to remove share');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-md p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[15px] font-semibold text-[#1d1d1f]">Share &ldquo;{template.name}&rdquo;</h3>
          <button onClick={onClose} className="text-[#9ca3af] hover:text-[#1d1d1f] text-[18px] leading-none cursor-pointer">×</button>
        </div>

        <label className="text-[12px] font-medium text-[#6e6e73] block mb-1.5">Share with a user by email</label>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type an email to search..."
          className="w-full px-3 py-2 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb]"
        />
        {query.trim() && (
          <div className="mt-2 border border-[#d2d2d7] rounded-lg overflow-hidden bg-white max-h-44 overflow-y-auto">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-[12px] text-[#9ca3af]">No users found</p>
            ) : (
              results.map((u) => (
                <div key={u.id} className="flex items-center justify-between px-3 py-2 border-b border-[#d2d2d7]/60 last:border-0">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#1d1d1f] truncate">{u.full_name}</p>
                    <p className="text-[11px] text-[#9ca3af] truncate">{u.email}</p>
                  </div>
                  <button
                    onClick={() => shareWith(u)}
                    disabled={busy}
                    className="px-2.5 py-1 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 cursor-pointer"
                  >
                    Share
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <p className="text-[12px] font-medium text-[#6e6e73] mt-4 mb-1.5">Shared with ({shares.length})</p>
        {shares.length === 0 ? (
          <p className="text-[12px] text-[#9ca3af]">Not shared with anyone yet.</p>
        ) : (
          <div className="border border-[#d2d2d7] rounded-lg overflow-hidden">
            {shares.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 border-b border-[#d2d2d7]/60 last:border-0">
                <div className="min-w-0">
                  <p className="text-[13px] text-[#1d1d1f] truncate">{u.full_name}</p>
                  <p className="text-[11px] text-[#9ca3af] truncate">{u.email}</p>
                </div>
                <button
                  onClick={() => unshare(u.id)}
                  disabled={busy}
                  className="px-2.5 py-1 text-[12px] text-[#dc2626] border border-[#fecaca] rounded-lg hover:bg-[#fef2f2] disabled:opacity-50 cursor-pointer"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from 'react';
import type { ReformatTemplate } from '../../lib/api';
import { ShareTemplateModal } from './TemplateSidebar';

interface Props {
  templates: { owned: ReformatTemplate[]; shared: ReformatTemplate[] };
  activeName: string | null;
  dirty: boolean;
  onApply: (t: ReformatTemplate) => void;
  onNew: () => void;
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function TemplateSelector({ templates, activeName, dirty, onApply, onNew, onRename, onDelete, onChanged, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [sharingTemplate, setSharingTemplate] = useState<ReformatTemplate | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId !== null) renameRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function startRename(t: ReformatTemplate) {
    setRenamingId(t.id);
    setRenameValue(t.name);
  }

  function commitRename() {
    if (renamingId !== null) {
      onRename(renamingId, renameValue);
      setRenamingId(null);
    }
  }

  function apply(t: ReformatTemplate) {
    setOpen(false);
    onApply(t);
  }

  function meta(t: ReformatTemplate) {
    const parts = [`${t.columns.length} col${t.columns.length === 1 ? '' : 's'}`];
    if (t.removed_columns?.length) parts.push(`${t.removed_columns.length} removed`);
    if (t.is_owner) parts.push(`updated ${relativeTime(t.updated_at)}`);
    else parts.push(`from ${t.owner_email}`);
    return parts.join(' · ');
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen(!open)}
        title="Apply a saved template"
        className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-[#1d1d1f] border border-[#d2d2d7] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        {activeName ? (
          <>
            <span className="max-w-[150px] truncate">{activeName}</span>
            {dirty && <span className="text-[10px] text-[#b45309]">•</span>}
          </>
        ) : (
          'Apply template'
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-white border border-[#d2d2d7] rounded-xl shadow-xl z-30 max-h-[440px] overflow-y-auto">
          {(templates.owned.length > 0 || templates.shared.length > 0) && (
            <p className="px-3 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[#9ca3af]">My templates</p>
          )}
          {templates.owned.map((t) => (
            <div
              key={t.id}
              onClick={() => apply(t)}
              className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#f5f5f7] border-b border-[#d2d2d7]/50 last:border-0"
            >
              <div className="min-w-0 flex-1">
                {renamingId === t.id ? (
                  <input
                    ref={renameRef}
                    value={renameValue}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    className="w-full px-2 py-1 border border-[#2563eb] rounded-lg text-[12px] font-medium bg-white outline-none"
                  />
                ) : (
                  <>
                    <p className="text-[12px] font-medium text-[#1d1d1f] truncate">{t.name}</p>
                    <p className="text-[10px] text-[#9ca3af] truncate">{meta(t)}</p>
                  </>
                )}
              </div>
              {renamingId !== t.id && (
                <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button title="Rename" onClick={() => startRename(t)} className="p-1 text-[#6e6e73] hover:text-[#2563eb] cursor-pointer">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" /></svg>
                  </button>
                  <button title="Share" onClick={() => setSharingTemplate(t)} className="p-1 text-[#6e6e73] hover:text-[#2563eb] cursor-pointer">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                  </button>
                  {confirmDeleteId === t.id ? (
                    <button onClick={() => { onDelete(t.id); setConfirmDeleteId(null); }} className="px-1.5 py-0.5 text-[10px] text-white bg-[#dc2626] rounded-md cursor-pointer">Sure?</button>
                  ) : (
                    <button title="Delete" onClick={() => setConfirmDeleteId(t.id)} onMouseLeave={() => setConfirmDeleteId(null)} className="p-1 text-[#6e6e73] hover:text-[#dc2626] cursor-pointer">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
          {templates.shared.length > 0 && (
            <p className="px-3 pt-3 pb-1 text-[10px] font-medium uppercase tracking-wider text-[#9ca3af]">Shared with me</p>
          )}
          {templates.shared.map((t) => (
            <div key={t.id} onClick={() => apply(t)} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#f5f5f7] border-b border-[#d2d2d7]/50 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-[#1d1d1f] truncate">{t.name}</p>
                <p className="text-[10px] text-[#9ca3af] truncate">{meta(t)}</p>
              </div>
            </div>
          ))}
          <button
            onClick={() => { setOpen(false); onNew(); }}
            className="w-full flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium text-[#2563eb] border-t border-[#d2d2d7] hover:bg-[#eff6ff] cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New template — build from this file
          </button>
        </div>
      )}

      {sharingTemplate && (
        <ShareTemplateModal
          template={sharingTemplate}
          onClose={() => setSharingTemplate(null)}
          onChanged={onChanged}
          onError={onError}
        />
      )}
    </div>
  );
}

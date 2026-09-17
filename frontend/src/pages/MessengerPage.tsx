import { useCallback, useEffect, useRef, useState } from 'react';
import { connectPulseWs, pulseApi, type PulseAssignment, type PulseAttachment, type PulseChannel, type PulseMessage } from '../lib/messenger';

function RepairChips({ repairs, onOpen }: { repairs: string[]; onOpen: (n: string) => void }) {
  if (repairs.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {repairs.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onOpen(n)}
          className="rounded-full bg-[#1d1d1f] px-2 py-0.5 font-mono text-[11px] font-medium text-white hover:bg-[#3a3a3c]"
          aria-label={`View timeline for repair ${n}`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
function AssignmentChips({ message, busyKey, onAct }: { message: PulseMessage; busyKey: string | null; onAct: (msgId: number, index: number, action: 'ack' | 'done' | 'reopen') => void }) {
  const assignments = message.meta?.assignments ?? [];
  if (assignments.length === 0) return null;
  const act = (index: number, action: 'ack' | 'done' | 'reopen') => ({ onClick: () => onAct(message.id, index, action), disabled: busyKey !== null });
  return (
    <div className="mt-1.5 space-y-1.5">
      {assignments.map((a, i) => {
        const done = a.status === 'done';
        return (
          <div key={`${a.name}-${i}`} className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-[12px] ${done ? 'bg-[#f5f5f7] text-[#8e8e93]' : 'bg-[#eef4ff] text-[#1d1d1f]'}`}>
            <span className={`font-semibold ${done ? 'line-through' : ''}`}>@{a.name}</span>
            <span className="text-[11px]">
              {a.status === 'open' ? 'assigned' : a.status === 'acked' ? `acked${a.by ? ` by ${a.by}` : ''}` : `done${a.by ? ` by ${a.by}` : ''}`}
            </span>
            <span className="flex-1" />
            {a.status === 'open' && (
              <>
                <button type="button" {...act(i, 'ack')} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0071e3] ring-1 ring-inset ring-[#0071e3]/30 disabled:opacity-40">Ack</button>
                <button type="button" {...act(i, 'done')} className="rounded-full bg-[#0071e3] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Done</button>
              </>
            )}
            {a.status === 'acked' && (
              <>
                <button type="button" {...act(i, 'done')} className="rounded-full bg-[#0071e3] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Done</button>
                <button type="button" {...act(i, 'reopen')} className="rounded-full px-2 py-1 text-[11px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] disabled:opacity-40">Reopen</button>
              </>
            )}
            {a.status === 'done' && (
              <button type="button" {...act(i, 'reopen')} className="rounded-full px-2 py-1 text-[11px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] disabled:opacity-40">Reopen</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
function PhotoAttachments({ attachments, onOpen }: { attachments: PulseAttachment[]; onOpen: (a: PulseAttachment) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onOpen(a)}
          className="overflow-hidden rounded-xl ring-1 ring-inset ring-[#e5e5ea] transition hover:ring-[#0071e3]/50"
          aria-label="View full-size photo"
        >
          <img src={pulseApi.photoUrl(a.id, 'thumb')} alt="Attached unit photo" loading="lazy" className="h-28 w-auto max-w-[220px] object-cover" />
        </button>
      ))}
    </div>
  );
}
function RefChips({ message }: { message: PulseMessage }) {
  const refs = message.meta?.refs;
  if (!refs || (refs.ars.length === 0 && refs.serials.length === 0 && refs.parts.length === 0)) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {refs.ars.map((ar) => (
        <span key={ar} className="rounded-full bg-[#eef2ff] px-2 py-0.5 text-[11px] font-medium text-[#3730a3]">{ar}</span>
      ))}
      {refs.serials.map((s) => (
        <span key={s} className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#065f46]">{s}</span>
      ))}
      {refs.parts.map((p) => (
        <span key={p} className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[11px] font-medium text-[#9a3412]">{p}</span>
      ))}
    </div>
  );
}

export default function MessengerPage() {
  const [channels, setChannels] = useState<PulseChannel[]>([]);
  const [activeId, setActiveId] = useState<number>(0);
  const [messages, setMessages] = useState<PulseMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [backupOpen, setBackupOpen] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [sheetTitle, setSheetTitle] = useState('');
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState('');
  const [sheetConnected, setSheetConnected] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [staged, setStaged] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [lightbox, setLightbox] = useState<PulseAttachment | null>(null);
  const [timelineFor, setTimelineFor] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ endorsement: Record<string, unknown> | null; endorsements: Array<Record<string, unknown>>; messages: PulseMessage[] } | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');
  const [tasksOnly, setTasksOnly] = useState(false);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrls = useRef<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    const { channels } = await pulseApi.channels();
    setChannels(channels);
    if (!activeId && channels.length > 0) setActiveId(channels[0].id);
  }, [activeId]);

  useEffect(() => {
    loadChannels().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load.')).finally(() => setLoading(false));
  }, [loadChannels]);

  useEffect(() => {
    if (!activeId) return;
    pulseApi.messages(activeId).then(({ messages }) => {
      setMessages(messages);
      const last = messages[messages.length - 1];
      if (last) pulseApi.markRead(activeId, last.id).catch(() => undefined);
    }).catch(() => undefined);
  }, [activeId]);

  useEffect(() => {
    if (channels.length === 0) return;
    const ids = channels.map((c) => c.id);
    const disconnect = connectPulseWs(ids, (channelId, message, kind) => {
      if (kind === 'updated') {
        if (channelId === activeId) setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
        return;
      }
      if (channelId === activeId) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        pulseApi.markRead(channelId, message.id).catch(() => undefined);
      }
      setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, unread: c.id === activeId ? 0 : c.unread + 1 } : c)));
    });
    return disconnect;
  }, [channels, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const revokePreviews = useCallback(() => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current = [];
  }, []);

  const stageFiles = (files: FileList | null) => {
    if (!files) return;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 4);
    if (images.length === 0) return;
    revokePreviews();
    previewUrls.current = images.map((f) => URL.createObjectURL(f));
    setStaged(images);
  };

  useEffect(() => revokePreviews, [revokePreviews]);

  const openTimeline = async (n: string) => {
    setTimelineFor(n);
    setTimeline(null);
    setTimelineError('');
    setTimelineLoading(true);
    try {
      setTimeline(await pulseApi.repairTimeline(n));
    } catch (err) {
      setTimelineError(err instanceof Error ? err.message : 'Could not load timeline.');
    } finally {
      setTimelineLoading(false);
    }
  };

  const actOnAssignment = async (msgId: number, index: number, action: 'ack' | 'done' | 'reopen') => {
    const key = `${msgId}:${index}:${action}`;
    setActingKey(key);
    try {
      const { message } = await pulseApi.assignmentAction(activeId, msgId, index, action);
      if (message) setMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setActingKey(null);
    }
  };

  const openTasks = messages.filter((m) => (m.meta?.assignments ?? []).some((a) => a.status !== 'done')).length;
  const visibleMessages = tasksOnly
    ? messages.filter((m) => (m.meta?.assignments ?? []).some((a) => a.status !== 'done'))
    : messages;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!draft.trim() && staged.length === 0) || !activeId || uploadBusy) return;
    if (staged.length > 0) {
      const files = staged;
      const caption = draft.trim();
      setStaged([]);
      setDraft('');
      revokePreviews();
      setUploadBusy(true);
      try {
        const { message } = await pulseApi.sendPhotos(activeId, files, caption);
        setMessages((prev) => [...prev, message]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Send failed.');
      } finally {
        setUploadBusy(false);
      }
      return;
    }
    const body = draft.trim();
    setDraft('');
    try {
      const { message } = await pulseApi.send(activeId, body);
      setMessages((prev) => [...prev, message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed.');
    }
  };

  const openBackup = async () => {
    setBackupOpen(true);
    setBackupMsg('');
    try {
      const [{ connected }, { config }] = await Promise.all([pulseApi.sheetStatus(), pulseApi.sheetConfig()]);
      setSheetConnected(connected);
      if (config) {
        setSheetId(config.spreadsheet_id);
        setSheetTitle(config.spreadsheet_name);
        setTab(config.sheet_name);
        if (connected && config.spreadsheet_id) {
          pulseApi.sheetTabs(config.spreadsheet_id).then(({ title, sheets }) => {
            setSheetTitle(title);
            setTabs(sheets);
          }).catch(() => undefined);
        }
      }
    } catch {
      /* panel still usable for Excel export */
    }
  };

  const lookupTabs = async () => {
    if (!sheetId.trim()) return;
    setBackupBusy(true);
    setBackupMsg('');
    try {
      const { title, sheets } = await pulseApi.sheetTabs(sheetId.trim());
      setSheetTitle(title);
      setTabs(sheets);
      setBackupMsg(`Found ${sheets.length} tab(s) in “${title}”.`);
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Could not list tabs.');
    } finally {
      setBackupBusy(false);
    }
  };

  const saveAndBackup = async () => {
    if (!sheetId.trim() || !tab) {
      setBackupMsg('Paste a spreadsheet ID and choose a tab first.');
      return;
    }
    setBackupBusy(true);
    setBackupMsg('');
    try {
      await pulseApi.saveSheetConfig(sheetId.trim(), sheetTitle, tab);
      const { pushed } = await pulseApi.backupToSheet(activeId);
      setBackupMsg(`Backed up ${pushed} message(s) to ${sheetTitle} → ${tab}.`);
    } catch (err) {
      setBackupMsg(err instanceof Error ? err.message : 'Backup failed.');
    } finally {
      setBackupBusy(false);
    }
  };

  if (loading) return <p className="p-6 text-[14px] text-[#6e6e73]">Loading Pulse…</p>;

  return (
    <div className="mx-auto flex h-[calc(100vh-140px)] min-h-[480px] w-full max-w-6xl gap-3">
      {/* Sidebar — macOS Source List style */}
      <aside className="hidden w-60 shrink-0 flex-col rounded-2xl border border-[#e5e5ea] bg-[#f5f5f7]/70 p-2 backdrop-blur sm:flex">
        <p className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8e8e93]">Channels</p>
        <div className="flex-1 space-y-0.5 overflow-y-auto">
          {channels.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveId(c.id); setChannels((prev) => prev.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x))); }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${c.id === activeId ? 'bg-white font-semibold text-[#1d1d1f] shadow-sm' : 'text-[#3a3a3c] hover:bg-white/60'}`}
            >
              <span className="truncate"># {c.name}</span>
              {c.unread > 0 && <span className="ml-2 rounded-full bg-[#ff3b30] px-1.5 py-0.5 text-[10px] font-bold text-white">{c.unread}</span>}
            </button>
          ))}
        </div>
        <a href={pulseApi.exportUrl(activeId)} className="mt-2 rounded-lg bg-white px-3 py-2 text-center text-[12px] font-medium text-[#1d1d1f] shadow-sm hover:bg-[#fafafa]">Download .xlsx backup</a>
        <button onClick={openBackup} className="mt-1.5 rounded-lg px-3 py-2 text-center text-[12px] font-medium text-[#0071e3] hover:bg-white/60">Google Sheet backup…</button>
      </aside>

      {/* Thread — iMessage-like bubbles, restrained monochrome */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#e5e5ea] bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-[#f2f2f7] px-5 py-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-[#1d1d1f]"># {channels.find((c) => c.id === activeId)?.name || '—'}</h1>
            <p className="text-[12px] text-[#8e8e93]">{channels.find((c) => c.id === activeId)?.topic}</p>
          </div>
          <button
            type="button"
            onClick={() => setTasksOnly((v) => !v)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-semibold ${tasksOnly ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#3c3c43] hover:bg-[#e5e5ea]'}`}
            aria-pressed={tasksOnly}
          >
            Tasks{openTasks > 0 ? ` (${openTasks})` : ''}
          </button>
        </header>
        {error && <p role="alert" className="border-b border-[#f2f2f7] bg-[#fff1f2] px-5 py-2 text-[12px] text-[#a33a3a]">{error}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {tasksOnly && visibleMessages.length === 0 && (
            <p className="text-[13px] text-[#6e6e73]">No open tasks in this channel. Mention someone with @name to assign one.</p>
          )}
          {visibleMessages.map((m) => {
            const bot = m.kind === 'bot';
            return (
              <div key={m.id} className={`flex ${bot ? 'justify-start' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${bot ? 'bg-[#f5f5f7] ring-1 ring-inset ring-[#e5e5ea]' : 'bg-[#f5f5f7]'}`}>
                  <p className="text-[11px] font-semibold text-[#8e8e93]">{bot ? '✦ Pulse Bot' : m.author_name} <span className="font-normal">· {new Date(m.created_at).toLocaleString()}</span></p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-5 text-[#1d1d1f]">{m.body}</p>
                  <RepairChips repairs={m.meta?.refs?.repairs ?? []} onOpen={openTimeline} />
                  <PhotoAttachments attachments={m.meta?.attachments ?? []} onOpen={setLightbox} />
                  <AssignmentChips message={m} busyKey={actingKey} onAct={actOnAssignment} />
                  <RefChips message={m} />
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="border-t border-[#f2f2f7] p-3">
          {staged.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {staged.map((f, i) => (
                <span key={`${f.name}-${i}`} className="relative overflow-hidden rounded-xl ring-1 ring-inset ring-[#e5e5ea]">
                  <img src={previewUrls.current[i]} alt={`Staged photo ${i + 1}`} className="h-16 w-auto max-w-[120px] object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(previewUrls.current[i]);
                      previewUrls.current = previewUrls.current.filter((_, j) => j !== i);
                      setStaged((prev) => prev.filter((_, j) => j !== i));
                    }}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#1d1d1f]/70 text-[11px] font-bold text-white"
                    aria-label={`Remove photo ${i + 1}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 rounded-full border border-[#e5e5ea] bg-[#f5f5f7]/60 px-4 py-1.5 focus-within:border-[#0071e3]/50 focus-within:bg-white">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              aria-label="Attach photos"
              onChange={(e) => {
                stageFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadBusy}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#6e6e73] hover:text-[#1d1d1f] disabled:opacity-30"
              aria-label="Attach photos"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message — try AR-12345, SN-ABC, or 661-1234 for smart cards"
              className="h-8 flex-1 bg-transparent text-[13.5px] text-[#1d1d1f] outline-none placeholder:text-[#8e8e93]"
            />
            <button type="submit" disabled={(!draft.trim() && staged.length === 0) || uploadBusy} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0071e3] text-white disabled:opacity-30" aria-label="Send">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 14-7-7 14-2.5-5.5L5 12Z" /></svg>
            </button>
          </div>
          {uploadBusy && <p role="status" className="px-4 pt-1.5 text-[11px] text-[#8e8e93]">Uploading photos…</p>}
        </form>
      </section>

      {timelineFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={`Timeline for repair ${timelineFor}`}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e5e5e7] bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Repair timeline</p>
            <h2 className="mt-1 font-mono text-[20px] font-semibold tracking-tight text-[#1d1d1f]">{timelineFor}</h2>
            {timelineLoading && <p className="mt-4 text-[13px] text-[#6e6e73]">Loading timeline…</p>}
            {timelineError && <p role="alert" className="mt-4 text-[13px] text-[#a33a3a]">{timelineError}</p>}
            {timeline && (
              <>
                {timeline.endorsement ? (
                  <div className="mt-4 rounded-xl bg-[#f5f5f7] px-3.5 py-2.5 text-[12px] leading-5 text-[#1d1d1f]">
                    <p className="font-semibold">{String(timeline.endorsement.device_model || 'Device not specified')} <span className="font-normal text-[#6e6e73]">· {String(timeline.endorsement.engineer_name || 'Unassigned')}</span></p>
                    <p className="text-[#6e6e73]">{String(timeline.endorsement.issue || 'No issue recorded')} · {String(timeline.endorsement.status || '')}</p>
                    {timeline.endorsements.length > 1 && <p className="mt-1 text-[11px] text-[#8e8e93]">{timeline.endorsements.length} endorsement records (latest shown)</p>}
                  </div>
                ) : (
                  <p className="mt-4 text-[13px] text-[#6e6e73]">No endorsement record for this number yet.</p>
                )}
                <div className="mt-4 space-y-3">
                  {timeline.messages.map((m) => (
                    <div key={m.id} className="rounded-xl bg-[#f5f5f7] px-3.5 py-2.5">
                      <p className="text-[11px] font-semibold text-[#8e8e93]">{m.author_name} <span className="font-normal">· {new Date(m.created_at).toLocaleString()}</span></p>
                      {m.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-[#1d1d1f]">{m.body}</p>}
                      <PhotoAttachments attachments={m.meta?.attachments ?? []} onOpen={setLightbox} />
                    </div>
                  ))}
                  {timeline.messages.length === 0 && <p className="text-[13px] text-[#6e6e73]">No Pulse messages mention this number yet.</p>}
                </div>
              </>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setTimelineFor(null)} className="flex-1 rounded-xl bg-[#f5f5f7] py-3 text-[12px] font-semibold text-[#3c3c43]">Close</button>
            </div>
          </div>
        </div>
      )}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <img
            src={pulseApi.photoUrl(lightbox.id, 'full')}
            alt="Unit photo full size"
            className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[15px] font-bold text-[#1d1d1f]"
            aria-label="Close photo viewer"
          >
            ×
          </button>
        </div>
      )}

      {backupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="pulse-backup-title">
          <div className="w-full max-w-md rounded-2xl border border-[#e5e5e7] bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Raw data backup</p>
            <h2 id="pulse-backup-title" className="mt-1 text-[20px] font-semibold tracking-tight text-[#1d1d1f]">Back up to Excel / Sheets</h2>
            {!sheetConnected && (
              <p className="mt-2 rounded-xl bg-[#fffaf0] p-3 text-[12px] leading-5 text-[#6e6e73]">
                Google isn’t connected for this account. Excel download works now; for Sheets, connect Google on the <strong>Parts Inventory</strong> page first (shared free OAuth, no new setup).
              </p>
            )}
            <label className="mt-4 block text-[11px] font-medium text-[#3c3c43]">Google Spreadsheet ID
              <input value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="e.g. 1BxiMVs0XRA5nFMd…" className="mt-1 h-10 w-full rounded-xl border border-[#d2d2d7] px-3 font-mono text-[12px] outline-none focus:border-[#1d1d1f]" />
            </label>
            <div className="mt-2 flex gap-2">
              <button onClick={lookupTabs} disabled={backupBusy || !sheetId.trim()} className="flex-1 rounded-xl bg-[#f5f5f7] py-2.5 text-[12px] font-semibold text-[#3c3c43] disabled:opacity-40">{backupBusy ? 'Reading…' : 'List tabs'}</button>
              <a href={pulseApi.exportUrl(activeId)} className="flex-1 rounded-xl bg-white py-2.5 text-center text-[12px] font-semibold text-[#1d1d1f] ring-1 ring-inset ring-[#d2d2d7]">Download .xlsx</a>
            </div>
            {tabs.length > 0 && (
              <label className="mt-3 block text-[11px] font-medium text-[#3c3c43]">Choose tab
                <select value={tab} onChange={(e) => setTab(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]">
                  <option value="">Select… ({sheetTitle})</option>
                  {tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            )}
            {backupMsg && <p role="status" className="mt-3 text-[12px] text-[#3c3c43]">{backupMsg}</p>}
            <div className="mt-4 flex gap-2">
              <button onClick={() => setBackupOpen(false)} className="flex-1 rounded-xl bg-[#f5f5f7] py-3 text-[12px] font-semibold text-[#3c3c43]">Close</button>
              <button onClick={saveAndBackup} disabled={backupBusy || !tab} className="flex-1 rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">{backupBusy ? 'Backing up…' : 'Save & back up'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

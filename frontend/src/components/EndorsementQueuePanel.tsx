import { useEffect, useRef, useState } from 'react';
import { api, ENDORSEMENT_DIVISIONS, type EndorsementDivision, type EndorsementEngineer, type EndorsementPreview, type EndorsementQueue, type EndorsementQueues } from '../lib/api';

interface Props {
  state: EndorsementQueues | null;
  canAssign: boolean;
  canManage: boolean;
  canAdd: boolean;
  currentUserId?: number;
  canManageAll: boolean;
  isEngineer: boolean;
  request: { arNumber: string } | null;
  onRequestHandled: () => void;
  onRefresh: () => Promise<void>;
  onAssignmentComplete: () => Promise<void>;
  onMessage: (message: string, isError?: boolean) => void;
}
const buttonClass = 'rounded-full border border-[#d2d2d7] px-3 py-2 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-40';
const inputClass = 'h-10 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[12px] outline-none focus:border-[#8e8e93]';

export default function EndorsementQueuePanel({ state, canAssign, canManage, canAdd, currentUserId, canManageAll, isEngineer, request, onRequestHandled, onRefresh, onAssignmentComplete, onMessage }: Props) {
  const [ar, setAr] = useState('');
  const [preview, setPreview] = useState<EndorsementPreview | null>(null);
  const [assignmentError, setAssignmentError] = useState('');
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<EndorsementQueue | null>(null);
  const [reason, setReason] = useState('');
  const [skipError, setSkipError] = useState('');
  const [newName, setNewName] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [restDays, setRestDays] = useState<string[]>([]);
  const [scheduleEngineerName, setScheduleEngineerName] = useState<string | undefined>();
  const [scheduleEngineers, setScheduleEngineers] = useState<Array<{ id: number; full_name: string }>>([]);
  const [scheduleError, setScheduleError] = useState('');
  const [arranging, setArranging] = useState<{ division: EndorsementDivision; token: string; engineers: EndorsementEngineer[] } | null>(null);
  const arInput = useRef<HTMLInputElement>(null);
  const draggedEngineerId = useRef<number | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const review = async (value = ar) => {
    if (!canAssign || !value.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setAssignmentError('');
    try {
      const result = await api.endorsements.preview({ arNumber: value.trim() });
      if (mounted.current) setPreview(result);
      await onRefresh();
    } catch (error) { if (mounted.current) { setPreview(null); setAssignmentError((error as Error).message); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    if (!request) return;
    setAr(request.arNumber);
    void review(request.arNumber);
    onRequestHandled();
  }, [request]);

  const confirm = async () => {
    if (!preview || busyRef.current) return;
    busyRef.current = true; setBusy(true); setAssignmentError('');
    try {
      const result = await api.endorsements.create({ arNumber: preview.record.arNumber, frontlineRecordId: preview.record.frontlineRecordId, queueToken: preview.queue.token });
      setPreview(null); setAr(''); onMessage(result.message);
      await onAssignmentComplete();
    } catch (error) { setAssignmentError((error as Error).message); await onRefresh(); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const changeAvailability = async (id: number, name: string, active: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = active ? await api.endorsements.removeEngineer(id) : await api.endorsements.addEngineer(name);
      await onRefresh(); onMessage(result.message);
    } catch (error) { onMessage((error as Error).message, true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const add = async () => {
    if (!newName.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await api.endorsements.addEngineer(newName.trim()); setNewName(''); await onRefresh(); }
    catch (error) { onMessage((error as Error).message, true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const changeOwnAvailability = async (active: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = active ? await api.endorsements.join() : await api.endorsements.leave();
      await onRefresh(); onMessage(result.message);
    } catch (error) { onMessage((error as Error).message, true); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const openSchedule = async () => {
    try {
      const engineers = canManageAll ? (await api.endorsements.roster()).roster : [];
      const engineerName = canManageAll ? engineers[0]?.full_name : undefined;
      const result = await api.endorsements.schedule(engineerName);
      setScheduleError(''); setScheduleEngineers(engineers); setScheduleEngineerName(engineerName); setRestDays(result.restDays); setScheduleOpen(true);
    }
    catch (error) { onMessage((error as Error).message, true); }
  };
  const saveSchedule = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { const result = await api.endorsements.saveSchedule(restDays, scheduleEngineerName); setScheduleOpen(false); await onRefresh(); onMessage(result.message); }
    catch (error) { setScheduleError((error as Error).message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const confirmSkip = async () => {
    if (!skip || !reason.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setSkipError('');
    try {
      const result = await api.endorsements.passNext(skip.division, reason.trim(), skip.token);
      setSkip(null); setReason(''); await onRefresh(); onMessage(result.message);
    } catch (error) { setSkipError((error as Error).message); await onRefresh(); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const moveDraftEngineer = (engineerId: number, to: number) => {
    setArranging((current) => {
      if (!current || to < 0 || to >= current.engineers.length) return current;
      const from = current.engineers.findIndex((engineer) => engineer.id === engineerId);
      if (from < 0 || from === to) return current;
      const engineers = [...current.engineers];
      const [moved] = engineers.splice(from, 1);
      if (!moved) return current;
      engineers.splice(to, 0, moved);
      return { ...current, engineers };
    });
  };
  const saveArrangement = async () => {
    if (!arranging || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await api.endorsements.reorder(arranging.division, arranging.engineers.map((engineer) => engineer.id), arranging.token);
      setArranging(null); await onRefresh(); onMessage(result.message);
    } catch (error) { onMessage((error as Error).message, true); await onRefresh(); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const currentPreviewQueue = state?.queues.find((queue) => queue.division === preview?.record.productDivision);
  const previewStale = Boolean(preview && (!currentPreviewQueue || currentPreviewQueue.token !== preview.queue.token));
  const skipStale = Boolean(skip && state?.queues.find((queue) => queue.division === skip.division)?.token !== skip.token);
  const liveArrangingQueue = state?.queues.find((queue) => queue.division === arranging?.division);
  const arrangingStale = Boolean(arranging && liveArrangingQueue?.token !== arranging.token);
  const arrangementChanged = Boolean(arranging && liveArrangingQueue && arranging.engineers.map((engineer) => engineer.id).join(',') !== liveArrangingQueue.engineers.map((engineer) => engineer.id).join(','));
  const availableCount = state?.roster.filter((engineer) => engineer.status === 'active').length || 0;

  return <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-4 sm:p-5" aria-label="Round-robin assignment">
    {canAssign && <form onSubmit={(event) => { event.preventDefault(); void review(); }}>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="endorsement-ar">Frontline AR number</label>
        <input id="endorsement-ar" ref={arInput} value={ar} maxLength={100} onChange={(event) => { setAr(event.target.value); setAssignmentError(''); }} placeholder="Frontline AR number" autoComplete="off" disabled={busy} className={`${inputClass} min-w-0 flex-1`} />
        <button disabled={busy || !state || !ar.trim()} className="h-10 shrink-0 rounded-full bg-[#1d1d1f] px-5 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Checking…' : 'Review'}</button>
        {(isEngineer || canManageAll) && <button type="button" onClick={() => void openSchedule()} aria-label="Availability schedule" title="Availability schedule" className="h-10 w-10 shrink-0 rounded-full border border-[#d2d2d7] text-[#515154] hover:bg-[#f5f5f7]">⚙</button>}
      </div>
      {assignmentError && !preview && <p role="alert" className="mt-2 text-[12px] text-[#b42318]">{assignmentError}</p>}
    </form>}

    {!state && <p role="status" className="mt-5 text-[12px] text-[#6e6e73]">Loading today’s queues…</p>}
    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      {ENDORSEMENT_DIVISIONS.map((name) => {
        const queue = state?.queues.find((item) => item.division === name);
        const canSkipOwn = canManage && !canManageAll && queue?.nextEngineer?.user_id === currentUserId;
        return <article key={name} aria-label={`${name} queue`} className="rounded-xl bg-[#f7f7f8] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-[#1d1d1f]">{name}</h3>
            {canManageAll && queue && queue.engineers.length > 1 && <button type="button" disabled={busy} onClick={() => setArranging({ division: name, token: queue.token, engineers: [...queue.engineers] })} className="rounded-full px-2 py-1 text-[11px] font-medium text-[#515154] hover:bg-white disabled:opacity-40">Arrange</button>}
          </div>
          <ol className="mt-3 space-y-2.5">
            {queue?.engineers.slice(0, 3).map((engineer, index) => <li key={engineer.id} className="flex items-center gap-3">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${index === 0 ? 'bg-[#1d1d1f] text-white' : 'bg-white text-[#6e6e73]'}`}>{index + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-semibold text-[#1d1d1f]">{engineer.full_name}</p><p className="mt-0.5 text-[10px] text-[#6e6e73]">{index === 0 ? 'Next' : index === 1 ? 'Second' : 'Third'} · {engineer.assignment_count} {queue?.countPeriod === 'month' ? 'this month' : 'today'}</p></div>
            </li>)}
          </ol>
          {queue && !queue.nextEngineer && <p className="mt-3 text-[12px] text-[#6e6e73]">No Engineer available.</p>}
          {queue && queue.engineers.length > 3 && <p className="mt-3 truncate text-[10px] text-[#86868b]">Then {queue.engineers.slice(3).map((engineer) => engineer.full_name).join(' → ')}</p>}
          {canSkipOwn && <button type="button" className="mt-3 text-[11px] font-medium text-[#515154] underline-offset-2 hover:underline" disabled={busy || !queue || queue.engineers.length < 2} onClick={() => { setSkip(queue!); setReason(''); setSkipError(''); }}>Skip my turn</button>}
        </article>;
      })}
    </div>

    <details className="mt-4 border-t border-[#e5e5e7] pt-4 text-[12px] text-[#3c3c43]">
      <summary className="cursor-pointer select-none font-medium">Today’s availability <span className="ml-1 font-normal text-[#86868b]">{availableCount} of {state?.roster.length || 0} available</span></summary>
      <div className="mt-3">
        {isEngineer && <button type="button" disabled={busy} className={buttonClass} onClick={() => void changeOwnAvailability(state?.roster.some((engineer) => engineer.user_id === currentUserId && engineer.status === 'active') !== true)}>{state?.roster.some((engineer) => engineer.user_id === currentUserId && engineer.status === 'active') ? 'Set myself Away' : 'Set myself Available'}</button>}
        <div className="mt-3 flex flex-wrap gap-2">{state?.roster.map((engineer) => canManageAll ? <button key={engineer.id} type="button" disabled={busy} onClick={() => void changeAvailability(engineer.id, engineer.full_name, engineer.status === 'active')} aria-pressed={engineer.status === 'active'} className={`${buttonClass} ${engineer.status === 'active' ? 'bg-white' : 'bg-[#f5f5f7] text-[#86868b]'}`}>
          {engineer.full_name} · {engineer.status === 'active' ? 'Available' : 'Away'}
        </button> : <span key={engineer.id} className={`rounded-full px-3 py-2 text-[11px] ${engineer.status === 'active' ? 'bg-[#f5f5f7]' : 'text-[#86868b]'}`}>{engineer.full_name} · {engineer.status === 'active' ? 'Available' : 'Away'}</span>)}</div>
        {canAdd && <form className="mt-3 flex max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); void add(); }}><input value={newName} maxLength={150} onChange={(event) => setNewName(event.target.value)} placeholder="Add Engineer" aria-label="Add Engineer name" className={`${inputClass} min-w-0 flex-1`} /><button disabled={busy || !newName.trim()} className={buttonClass}>Add</button></form>}
      </div>
    </details>
    {Boolean(state?.skips.length) && <details className="mt-3 text-[11px] text-[#6e6e73]"><summary className="cursor-pointer">Skipped turns</summary><ul className="mt-2 space-y-2">{state!.skips.map((entry) => <li key={entry.id}><span className="font-medium text-[#3c3c43]">{entry.division} · {entry.engineer_name}</span> — {entry.reason}</li>)}</ul></details>}

    {scheduleOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Availability schedule"><div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"><h2 className="text-[16px] font-semibold text-[#1d1d1f]">Availability schedule</h2>{canManageAll && <label className="mt-4 block text-[11px] font-medium text-[#3c3c43]">Engineer<select value={scheduleEngineerName || ''} onChange={async (event) => { try { const engineerName = event.target.value; const result = await api.endorsements.schedule(engineerName); setScheduleError(''); setScheduleEngineerName(engineerName); setRestDays(result.restDays); } catch (error) { setScheduleError((error as Error).message); } }} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[12px]">{scheduleEngineers.map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name}</option>)}</select></label>}<div className="mt-4 grid grid-cols-2 gap-2">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <label key={day} className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#e5e5e7] px-3 py-2 text-[12px]"><input type="checkbox" checked={restDays.includes(day)} onChange={() => { setScheduleError(''); setRestDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day]); }} />{day}</label>)}</div>{scheduleError && <p role="alert" className="mt-3 text-[12px] text-[#b42318]">{scheduleError}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={() => setScheduleOpen(false)}>Cancel</button><button type="button" disabled={busy} onClick={() => void saveSchedule()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Save schedule</button></div></div></div>}

    {arranging && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label={`Arrange ${arranging.division} queue`}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f]">Arrange {arranging.division}</h2>
        <p id="arrange-help" className="mt-1 text-[11px] leading-5 text-[#6e6e73]">Drag engineers into order. The first person receives the next AR. Focus a drag handle and use the arrow keys for keyboard control.</p>
        <ol className="mt-4 space-y-2" aria-describedby="arrange-help">
          {arranging.engineers.map((engineer, index) => <li key={engineer.id} data-arrange-index={index} draggable={!busy && !arrangingStale}
            onDragStart={(event) => { draggedEngineerId.current = engineer.id; event.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
            onDrop={(event) => { event.preventDefault(); if (draggedEngineerId.current != null) moveDraftEngineer(draggedEngineerId.current, index); draggedEngineerId.current = null; }}
            onDragEnd={() => { draggedEngineerId.current = null; }}
            className="flex cursor-grab items-center gap-3 rounded-xl border border-[#e5e5e7] bg-white px-3 py-2.5 active:cursor-grabbing">
            <button type="button" disabled={busy || arrangingStale}
              onPointerDown={(event) => { if (event.pointerType !== 'mouse') { draggedEngineerId.current = engineer.id; event.currentTarget.setPointerCapture(event.pointerId); } }}
              onPointerMove={(event) => { if (draggedEngineerId.current == null || event.pointerType === 'mouse') return; const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-arrange-index]'); if (target) moveDraftEngineer(draggedEngineerId.current, Number(target.dataset.arrangeIndex)); }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); draggedEngineerId.current = null; }}
              onPointerCancel={() => { draggedEngineerId.current = null; }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') { event.preventDefault(); moveDraftEngineer(engineer.id, index - 1); }
                if (event.key === 'ArrowDown') { event.preventDefault(); moveDraftEngineer(engineer.id, index + 1); }
              }} aria-label={`Drag ${engineer.full_name}. Position ${index + 1} of ${arranging.engineers.length}`} className="touch-none cursor-grab text-[16px] leading-none text-[#86868b] disabled:opacity-40">⠿</button>
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold ${index === 0 ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#6e6e73]'}`}>{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#1d1d1f]">{engineer.full_name}</span>
            {index === 0 && <span className="text-[10px] text-[#6e6e73]">Next</span>}
          </li>)}
        </ol>
        {arrangingStale && <p role="status" className="mt-3 text-[12px] text-[#b42318]">The queue changed. Close and open Arrange again.</p>}
        <div className="mt-5 flex items-center justify-between gap-3">
          <button type="button" disabled={busy || arrangingStale || !liveArrangingQueue || liveArrangingQueue.engineers.length < 2} onClick={() => { setArranging(null); setSkip(liveArrangingQueue || null); setReason(''); setSkipError(''); }} className="text-[11px] font-medium text-[#6e6e73] hover:text-[#1d1d1f] disabled:opacity-40">Skip next turn</button>
          <div className="flex gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => setArranging(null)}>Cancel</button><button type="button" disabled={busy || arrangingStale || !arrangementChanged} onClick={() => void saveArrangement()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : 'Save order'}</button></div>
        </div>
      </div>
    </div>}

    {preview && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Review endorsement">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f]">Review endorsement</h2>
        <p className="mt-4 text-[13px] font-semibold">AR {preview.record.arNumber} · {preview.record.productDivision}</p>
        <p className="mt-2 text-[12px] text-[#3c3c43]">{preview.record.deviceModel || 'Device not specified'}</p>
        <p className="mt-1 text-[12px] text-[#6e6e73]">{preview.record.issue || 'No issue provided'}</p>
        <div className="mt-4 rounded-xl bg-[#f5f5f7] p-4"><p className="text-[11px] text-[#6e6e73]">Next available Engineer</p><p className="mt-1 text-[20px] font-semibold text-[#1d1d1f]">{preview.queue.nextEngineer?.full_name || 'No Engineer available'}</p></div>
        {previewStale && <p role="status" className="mt-3 text-[12px] text-[#6e6e73]">The queue changed. Review again to see the current Engineer.</p>}
        {assignmentError && <p role="alert" className="mt-3 text-[12px] text-[#b42318]">{assignmentError}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => { setPreview(null); setAssignmentError(''); }}>Cancel</button>
          {previewStale || !preview.queue.nextEngineer ? <button type="button" disabled={busy || !state} className={buttonClass} onClick={() => void review(preview.record.arNumber)}>Review again</button> : <button type="button" disabled={busy} onClick={() => void confirm()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Assigning…' : `Assign to ${preview.queue.nextEngineer.full_name}`}</button>}
        </div>
      </div>
    </div>}
    {skip && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Skip Engineer turn">
      <form className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onSubmit={(event) => { event.preventDefault(); void confirmSkip(); }}>
        <h2 className="text-[16px] font-semibold">Skip {skip.nextEngineer?.full_name}’s turn</h2><p className="mt-2 text-[12px] text-[#6e6e73]">{skip.division} · This moves the Engineer to the end of this division’s queue.</p>
        <label className="mt-4 block text-[12px] font-medium">Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={300} rows={3} autoFocus className="mt-2 w-full rounded-xl border border-[#d2d2d7] p-3 text-[12px]" placeholder="Why is this turn being skipped?" /></label>
        {skipStale && <p role="status" className="mt-2 text-[12px] text-[#6e6e73]">The queue changed. Close and select Skip turn again.</p>}
        {skipError && <p role="alert" className="mt-2 text-[12px] text-[#b42318]">{skipError}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={busy} className={buttonClass} onClick={() => setSkip(null)}>Cancel</button><button disabled={busy || skipStale || !reason.trim()} className={buttonClass}>{busy ? 'Saving…' : 'Confirm skip'}</button></div>
      </form>
    </div>}
  </section>;
}

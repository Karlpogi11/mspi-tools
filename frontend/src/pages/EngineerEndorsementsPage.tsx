import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type EndorsementEngineer, type EndorsementQueues, type EngineerCalendar, type EngineerDashboard } from '../lib/api';
import { pulseApi, type PulseMessage } from '../lib/messenger';
import { useAuth } from '../lib/auth';
import EndorsementQueuePanel from '../components/EndorsementQueuePanel';

function LegacyEngineerEndorsementsPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [calendar, setCalendar] = useState<EngineerCalendar | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<{ date: string; division: string; engineer: string } | null>(null);
 const [editingCell, setEditingCell] = useState<{ date: string; division: string; engineer: string; count: string; details: string; arNumber: string } | null>(null);
 const [savingCell, setSavingCell] = useState(false);
  const [editingCellError, setEditingCellError] = useState('');
  const [deletingManualEntry, setDeletingManualEntry] = useState(false);
  const [roster, setRoster] = useState<EndorsementEngineer[] | null>(null);
  const [queueState, setQueueState] = useState<EndorsementQueues | null>(null);
  const [assignmentRequest, setAssignmentRequest] = useState<{ arNumber: string } | null>(null);
  const loadVersion = useRef(0);
  const queueLoadVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageIsError, setMessageIsError] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [editingEndorsementId, setEditingEndorsementId] = useState<number | null>(null);
  const [deviceModelDraft, setDeviceModelDraft] = useState('');
  const [savingDeviceModel, setSavingDeviceModel] = useState(false);
  const [editingEngineerId, setEditingEngineerId] = useState<number | null>(null);
  const [engineerDraft, setEngineerDraft] = useState('');
  const [savingEngineer, setSavingEngineer] = useState(false);
  const [draggedEngineer, setDraggedEngineer] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deletingEndorsementId, setDeletingEndorsementId] = useState<number | null>(null);
  const [photosFor, setPhotosFor] = useState<{ id: number; ar_number: string } | null>(null);
  const [linkedMessages, setLinkedMessages] = useState<PulseMessage[]>([]);
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedError, setLinkedError] = useState('');
  const [linkedFull, setLinkedFull] = useState<string | null>(null);

  const openPhotos = async (row: { id: number; ar_number: string }) => {
    setPhotosFor(row);
    setLinkedMessages([]);
    setLinkedError('');
    setLinkedFull(null);
    setLinkedLoading(true);
    try {
      const { messages } = await pulseApi.endorsementMessages(row.id);
      setLinkedMessages(messages);
    } catch (error) {
      setLinkedError(error instanceof Error ? error.message : 'Could not load linked messages.');
    } finally {
      setLinkedLoading(false);
    }
  };

  const canManageRoster = Boolean(user?.isSuperAdmin) || user?.roleName === 'Admin' || user?.roleName === 'PMG' || user?.roleName === 'CSO';
  const canManageAvailability = canManageRoster || user?.roleName === 'ENGR';
  const showMessage = (text: string, isError = false) => { setMessage(text); setMessageIsError(isError); };

  const loadHistory = async (silent = false) => {
    const version = ++loadVersion.current;
    if (!silent) setLoading(true);
    try {
      const [nextDashboard, nextCalendar] = await Promise.all([api.endorsements.dashboardFresh(), api.endorsements.calendarFresh(calendarMonth)]);
      if (version !== loadVersion.current) return;
      setDashboard(nextDashboard); setCalendar(nextCalendar);
    } catch (error) {
      if (version !== loadVersion.current) return;
      showMessage((error as Error).message, true);
    } finally { if (version === loadVersion.current) setLoading(false); }
  };
  const loadQueues = async () => {
    const version = ++queueLoadVersion.current;
    try {
      const availability = await api.endorsements.available();
      if (version === queueLoadVersion.current) { setRoster(availability.roster); setQueueState(availability); }
    } catch (error) { if (version === queueLoadVersion.current) showMessage((error as Error).message, true); }
  };
  useEffect(() => {
    void loadQueues();
    if (showDetails) void loadHistory();
    const refreshQueues = () => { if (document.visibilityState === 'visible') void loadQueues(); };
    const queueTimer = window.setInterval(refreshQueues, 10000);
    const pageTimer = window.setInterval(() => { if (showDetails && document.visibilityState === 'visible') void loadHistory(true); }, 60000);
    window.addEventListener('focus', refreshQueues); document.addEventListener('visibilitychange', refreshQueues);
    return () => { window.clearInterval(queueTimer); window.clearInterval(pageTimer); window.removeEventListener('focus', refreshQueues); document.removeEventListener('visibilitychange', refreshQueues); ++loadVersion.current; ++queueLoadVersion.current; };
  }, [calendarMonth, showDetails]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 6000); return () => window.clearTimeout(timer); }, [message]);

  const formatDate = (value: string | null | undefined) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(date);
  };

  const formatTime = (value: string | null | undefined) => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(date);
  };

  const calendarTitle = useMemo(() => calendar ? new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${calendar.month}-01T00:00:00Z`)) : 'Endorsement calendar', [calendar]);
  const shiftMonth = (offset: number) => { const [year, month] = calendarMonth.split('-').map(Number); const next = new Date(Date.UTC(year, month - 1 + offset, 1)); setSelectedDay(null); setCalendarMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`); };
  const selectedEndorsements = selectedDay ? calendar?.days.find((day) => day.date === selectedDay.date)?.counts[selectedDay.division]?.[selectedDay.engineer] || [] : [];
 const selectedEndorsementCount = selectedEndorsements.reduce((sum, entry) => sum + (entry.manual_count || 1), 0);
 const latestCalendarTimestamp = useMemo(() => { if (!calendar) return null; let latest = ''; for (const day of calendar.days) for (const division of Object.values(day.counts)) for (const entries of Object.values(division)) for (const entry of entries) if (entry.created_at > latest) latest = entry.created_at; return latest || null; }, [calendar]);
  const openCalendarEditor = (date: string, division: string, engineer: string) => { if (!canEditEndorsement) return; const entry = calendar?.days.find((day) => day.date === date)?.counts[division]?.[engineer]?.find((item) => item.is_manual); setEditingCellError(''); setEditingCell({ date, division, engineer, count: entry?.manual_count ? String(entry.manual_count) : '', details: entry?.details || '', arNumber: '' }); };
  const saveCalendarEntry = async () => {
    if (!editingCell) return;
    const arNumber = editingCell.arNumber.trim();
    if (arNumber) {
      if (editingCell.date !== queueState?.date) { setEditingCellError('New AR assignments are recorded today. Use manual counts for historical dates.'); return; }
      setAssignmentRequest({ arNumber });
      setEditingCell(null); setSelectedDay(null); return;
    }
    const count = Number(editingCell.count);
    if (!Number.isInteger(count) || count < 1) return;
    setSavingCell(true); setEditingCellError('');
    try { await api.endorsements.saveCalendarEntry({ ...editingCell, count }); setEditingCell(null); setSelectedDay(null); await loadHistory(true); showMessage('Manual count saved.'); }
    catch (error) { setEditingCellError((error as Error).message); }
    finally { setSavingCell(false); }
  };
  const canEditEndorsement = Boolean(user?.isSuperAdmin) || user?.roleName === 'Admin' || user?.roleName === 'CSO' || user?.roleName === 'ENGR';
  const beginDeviceModelEdit = (id: number, value: string | null) => { setEditingEndorsementId(id); setDeviceModelDraft(value || ''); };
  const saveDeviceModel = async (id: number) => { const value = deviceModelDraft.trim(); if (!value) return; setSavingDeviceModel(true); setMessage(''); try { await api.endorsements.updateDeviceModel(id, value); setEditingEndorsementId(null); setDeviceModelDraft(''); await loadHistory(); showMessage('Device model updated.'); } catch (error) { showMessage((error as Error).message, true); } finally { setSavingDeviceModel(false); } };
  const beginEngineerEdit = (id: number, name: string) => { setEditingEngineerId(id); setEngineerDraft(name); };
  const saveEngineer = async (id: number) => { const name = engineerDraft.trim(); if (!name) return; setSavingEngineer(true); setMessage(''); try { await api.endorsements.updateEngineer(id, name); setEditingEngineerId(null); setEngineerDraft(''); await loadHistory(true); showMessage('Engineer assignment updated.'); } catch (error) { showMessage((error as Error).message, true); } finally { setSavingEngineer(false); } };
  const reorderEngineers = async (division: string, targetEngineer: string) => { if (!draggedEngineer || !calendar) return; const [draggedDivision, draggedName] = draggedEngineer.split('::'); if (draggedDivision !== division || draggedName === targetEngineer) return; const currentOrder = calendar.engineerOrder?.[division] || calendar.columns.filter((column) => column.division === division).map((column) => column.engineer); const nextOrder = [...currentOrder]; const from = nextOrder.indexOf(draggedName); const to = nextOrder.indexOf(targetEngineer); if (from < 0 || to < 0) return; nextOrder.splice(from, 1); nextOrder.splice(to, 0, draggedName); const nextEngineerOrder = { ...calendar.engineerOrder, [division]: nextOrder }; const orderIndex = new Map(nextOrder.map((name, index) => [name, index])); setCalendar({ ...calendar, engineerOrder: nextEngineerOrder, columns: calendar.columns.map((column) => column.division === division ? column : column).sort((a, b) => a.division === division && b.division === division ? (orderIndex.get(a.engineer) ?? 0) - (orderIndex.get(b.engineer) ?? 0) : 0) }); setDraggedEngineer(null); setSavingOrder(true); try { await api.endorsements.saveCalendarOrder(calendar.month, division, nextOrder); await loadHistory(true); } catch (error) { showMessage((error as Error).message, true); await loadHistory(true); } finally { setSavingOrder(false); } };
  const deleteEndorsement = async (id: number) => { if (!window.confirm('Delete this endorsement only? The original Frontline record will not be changed.')) return; setDeletingEndorsementId(id); setMessage(''); try { const result = await api.endorsements.delete(id); setSelectedDay(null); await loadHistory(true); showMessage(result.message); } catch (error) { showMessage((error as Error).message, true); } finally { setDeletingEndorsementId(null); } };

  return (
    <div className="endorsement-page min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <div className="mx-auto w-full max-w-none">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Engineer Endorsements</h1>
          <button type="button" onClick={() => setShowDetails((visible) => !visible)} aria-expanded={showDetails} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7]">{showDetails ? 'Hide history' : 'View history'}</button>
        </div>

        {message && (
          <div role="status" aria-live="polite" className="fixed right-4 top-16 z-30 flex max-w-sm items-center gap-3 rounded-2xl bg-white/95 px-3.5 py-3 text-[12px] text-[#3c3c43] shadow-[0_12px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] ${messageIsError ? 'bg-[#fef2f2] text-[#b42318]' : 'bg-[#f5f5f7] text-[#3c3c43]'}`} aria-hidden="true">{messageIsError ? '!' : '✓'}</span>
            <span className="min-w-0 flex-1 leading-5">{message}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="cursor-pointer rounded-full px-1 text-[16px] leading-none text-[#6e6e73] hover:bg-[#f5f5f7]">×</button>
          </div>
        )}

        <EndorsementQueuePanel state={queueState} canAssign={canEditEndorsement} canManage={canManageAvailability} canAdd={canManageRoster} currentUserId={user?.id} canManageAll={canManageRoster} isEngineer={user?.roleName === 'ENGR'}
          request={assignmentRequest} onRequestHandled={() => setAssignmentRequest(null)} onRefresh={loadQueues} onAssignmentComplete={async () => { await loadQueues(); if (showDetails) await loadHistory(true); }} onMessage={showMessage} />

        {loading ? (
          <div className="rounded-2xl border border-[#e5e5e7] bg-white p-8 text-center text-[13px] text-[#6e6e73]">Loading endorsements…</div>
        ) : dashboard && (
          <>{showDetails && <>
            <section className="mb-5 min-w-0 max-w-full rounded-2xl border border-[#e5e5e7] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e7] px-5 py-4"><div><h2 className="text-[13px] font-semibold text-[#1d1d1f]">Endorsement calendar</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Daily workload by Engineer · click a count for details · double-click an empty cell for manual counts.</p><p className="mt-1 text-[11px] text-[#86868b]">Available today · {roster === null ? 'Checking…' : roster.filter((engineer) => engineer.status === 'active').map((engineer) => engineer.full_name).join(', ') || 'None'}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => shiftMonth(-1)} className="h-8 w-8 rounded-full border border-[#d2d2d7] text-[16px] text-[#3c3c43] hover:bg-[#f5f5f7]" aria-label="Previous month">‹</button><span className="min-w-32 text-center text-[12px] font-semibold text-[#1d1d1f]">{calendarTitle}</span><button type="button" onClick={() => shiftMonth(1)} className="h-8 w-8 rounded-full border border-[#d2d2d7] text-[16px] text-[#3c3c43] hover:bg-[#f5f5f7]" aria-label="Next month">›</button></div></div>
              {calendar && <div className="w-full max-w-full overflow-visible"><table className="w-full min-w-0 table-fixed border-separate border-spacing-0 text-left text-[12px]"><colgroup><col className="w-28 min-w-28 max-w-28" /><col className="w-14 min-w-14 max-w-14" />{calendar.columns.map((column, index) => <col key={`${column.division}-${column.engineer}-${index}`} className="w-auto" />)}</colgroup><thead className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-[#6e6e73]"><tr className="sticky top-12 z-[6] bg-[#fafafa]"><th rowSpan={2} className="sticky left-0 top-12 z-[7] w-28 min-w-28 max-w-28 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-b border-[#e5e5e7] bg-[#fafafa] px-4 py-3">Date</th><th rowSpan={2} className="sticky left-28 top-12 z-[7] w-14 min-w-14 max-w-14 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-b border-[#e5e5e7] bg-[#fafafa] px-2 py-3">Day</th>{calendar.divisions.map((division) => { const columns = calendar.columns.filter((column) => column.division === division); return <th key={division} colSpan={Math.max(columns.length, 1)} className="sticky top-12 z-[5] border-r border-b border-l-4 border-[#e5e5e7] bg-[#fafafa] px-4 py-3 text-center normal-case text-[12px] font-semibold text-[#1d1d1f]">{division}<span className="ml-2 text-[10px] font-normal text-[#6e6e73]">{calendar.totals[division] || 0} total</span></th>})}</tr><tr className="sticky top-[90px] z-[6] bg-[#fafafa]">{calendar.divisions.flatMap((division) => { const columns = calendar.columns.filter((column) => column.division === division); return columns.length ? columns.map((column, index) => <th key={`${column.division}-${column.engineer}`} draggable={canEditEndorsement} onDragStart={() => setDraggedEngineer(`${division}::${column.engineer}`)} onDragOver={(event) => event.preventDefault()} onDrop={() => void reorderEngineers(division, column.engineer)} title={canEditEndorsement ? 'Drag to arrange columns; round-robin turns stay the same' : column.engineer} className={`sticky top-[90px] z-[5] w-auto min-w-0 border-r border-b bg-[#fafafa] px-4 py-3 text-center ${index === 0 ? 'border-l-4' : ''} border-[#e5e5e7]`}><span className="block whitespace-normal break-words text-[11px] font-semibold text-[#3c3c43]" title={column.engineer}>{column.engineer}</span><span className="mt-1 block text-[10px] font-normal text-[#6e6e73]">{column.total}</span>{queueState?.queues.find((queue) => queue.division === division)?.nextEngineer?.full_name === column.engineer && <span className="mt-1 inline-block rounded-full bg-[#1d1d1f] px-2 py-0.5 text-[8px] font-semibold tracking-wide text-white">NEXT</span>}</th>) : (<th key={division} className="sticky top-[90px] z-[5] border-r border-b border-l-4 border-[#e5e5e7] bg-[#fafafa] px-4 py-3 text-center text-[10px] font-normal text-[#86868b]">No Engineers</th>); })}</tr></thead><tbody>{calendar.days.map((day) => <tr key={day.date} className={`h-6 border-t border-[#f0f0f2] ${day.date === dashboard.date ? 'bg-[#eef1f5] ring-1 ring-inset ring-[#c4c9d1]' : ''}`}><td className="sticky left-0 z-[2] w-28 min-w-28 max-w-28 whitespace-nowrap border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-[#e5e5e7] bg-inherit px-4 py-1.5 align-middle font-medium text-[#3c3c43]">{formatDate(`${day.date}T00:00:00Z`)}{day.date === dashboard.date && <span className="mt-0.5 block text-[9px] font-semibold text-[#5b6575]">TODAY</span>}</td><td className="sticky left-28 z-[2] w-14 min-w-14 max-w-14 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-[#e5e5e7] bg-inherit px-2 py-1.5 align-middle text-[#6e6e73]">{day.day}</td>{calendar.divisions.flatMap((division) => { const columns = calendar.columns.filter((column) => column.division === division); if (!columns.length) return [<td key={`${day.date}-${division}-empty`} className="border-r border-l-4 border-[#e5e5e7] px-2 py-1.5 align-middle text-center text-[#d2d2d7]">—</td>]; return columns.map((column, index) => { const entries = day.counts[division]?.[column.engineer] || []; const cellCount = entries.reduce((sum, entry) => sum + (entry.manual_count || 1), 0); const isLatestCell = Boolean(latestCalendarTimestamp && entries.some((entry) => entry.created_at === latestCalendarTimestamp)); return <td key={`${day.date}-${division}-${column.engineer}`} className={`w-auto min-w-0 border-r p-0 align-middle ${index === 0 ? 'border-l-4' : ''} border-[#e5e5e7]`}>{entries.length ? <button type="button" onClick={() => setSelectedDay({ date: day.date, division, engineer: column.engineer })} onPointerUp={() => setSelectedDay({ date: day.date, division, engineer: column.engineer })} className="relative flex min-h-6 w-full items-center justify-center rounded-none bg-[#f5f5f7] px-2 py-1.5 text-left hover:bg-[#e5e5e7]" aria-label={`${cellCount} endorsements for ${column.engineer} in ${division} on ${day.date}`}><span className="block pt-2 text-center text-[15px] font-semibold leading-6 text-[#1d1d1f]">{cellCount}</span>{isLatestCell && <span title="New" aria-label="New" className="absolute right-1 top-0.5 rounded-full border border-[#d2d2d7] px-1 py-px text-[7px] font-semibold leading-3 tracking-wide text-[#6e6e73]">NEW</span>}</button> : <button type="button" onDoubleClick={() => openCalendarEditor(day.date, division, column.engineer)} className="flex min-h-6 w-full cursor-default items-center justify-center rounded-none px-2 py-1.5 text-[#d2d2d7] hover:bg-[#fafafa]" aria-label={`Empty cell for ${column.engineer} in ${division} on ${day.date}; double-click to add an entry`}>—</button>}</td>; }); })}</tr>)}</tbody></table></div>}
              {selectedDay && (
                <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Endorsement details">
                  <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold text-[#1d1d1f]">{selectedDay.division} · {selectedDay.engineer} · {formatDate(selectedDay.date + 'T00:00:00Z')}</p>
                        <p className="mt-1 text-[11px] text-[#6e6e73]">{selectedEndorsementCount} record{selectedEndorsementCount === 1 ? '' : 's'}</p>
                      </div>
                      <button type="button" onClick={() => setSelectedDay(null)} className="rounded-full px-2 py-1 text-[11px] text-[#6e6e73] hover:bg-[#f5f5f7]">Close</button>
                    </div>
                    <div className="mt-4 divide-y divide-[#e5e5e7]">
                      {selectedEndorsements.map((row) => (
                        <div key={row.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12px] font-semibold text-[#1d1d1f]">AR {row.ar_number}</span>
                            <span className="text-[11px] text-[#6e6e73]">{formatTime(row.created_at)}</span>
                          </div>
                          {editingEngineerId === row.id ? (
                            <div className="mt-2 flex items-center gap-2">
                              <select value={engineerDraft} onChange={(event) => setEngineerDraft(event.target.value)} aria-label="Select Engineer" className="h-8 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] bg-white px-2 text-[11px]">
                                {roster?.filter((engineer) => engineer.status === 'active').map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name}</option>)}
                              </select>
                              <button type="button" onClick={() => void saveEngineer(row.id)} disabled={savingEngineer || !engineerDraft.trim()} className="rounded-full bg-[#1d1d1f] px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-40">{savingEngineer ? 'Saving…' : 'Save'}</button>
                              <button type="button" onClick={() => { setEditingEngineerId(null); setEngineerDraft(''); }} className="text-[10px] text-[#6e6e73] underline">Cancel</button>
                            </div>
                          ) : (
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-[11px] text-[#3c3c43]">{row.device_model || 'Device not specified'} · {row.engineer_name}</p>
                              {!row.is_manual && <button type="button" onClick={() => canEditEndorsement && beginEngineerEdit(row.id, row.engineer_name)} disabled={!canEditEndorsement} className="shrink-0 text-[10px] font-medium text-[#3c3c43] underline disabled:cursor-not-allowed disabled:opacity-40">Edit Engineer</button>}
                            </div>
                          )}
                          <p className="mt-1.5 text-[11px] leading-5 text-[#6e6e73]">{row.is_manual ? row.details || 'No details provided' : row.issue || 'No issue provided'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              {editingCell && (
                <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Edit calendar entry">
                  <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-semibold text-[#1d1d1f]">Edit calendar entry</p>
                        <p className="mt-1 text-[11px] text-[#6e6e73]">{editingCell.division} · {editingCell.engineer} · {formatDate(editingCell.date + 'T00:00:00Z')}</p>
                      </div>
                      <button type="button" onClick={() => setEditingCell(null)} className="rounded-full px-2 py-1 text-[11px] text-[#6e6e73] hover:bg-[#f5f5f7]">Close</button>
                    </div>
                    <label className="mt-5 block text-[11px] font-medium text-[#3c3c43]">
                      Frontline AR number
                      <input type="text" value={editingCell.arNumber} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCalendarEntry(); } }} onChange={(event) => { setEditingCellError(''); setEditingCell((current) => current ? { ...current, arNumber: event.target.value } : current); }} placeholder="Enter one AR number" aria-invalid={Boolean(editingCellError)} className={`mt-2 h-10 w-full rounded-xl border px-3 text-[12px] outline-none focus:ring-2 focus:ring-[#d2d2d7]/40 ${editingCellError ? 'border-[#b42318] focus:border-[#b42318]' : 'border-[#d2d2d7] focus:border-[#8e8e93]'}`} autoFocus />
                      {editingCellError && <p className="mt-2 text-[11px] leading-4 text-[#b42318]" role="alert">{editingCellError}</p>}
                    </label>
                    {editingCell.arNumber.trim() ? <p className="mt-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[11px] leading-4 text-[#6e6e73]">Review the Frontline details and the next Engineer in this division before assigning.</p> : <>
                      <div className="my-5 flex items-center gap-3 text-[9px] font-semibold uppercase tracking-wider text-[#86868b]"><span className="h-px flex-1 bg-[#e5e5e7]" /><span>or manual entry</span><span className="h-px flex-1 bg-[#e5e5e7]" /></div>
                      <label className="block text-[11px] font-medium text-[#3c3c43]">Manual count <span className="font-normal text-[#86868b]">(required without an AR)</span>
                        <input type="number" min="1" max="999" value={editingCell.count} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveCalendarEntry(); } }} onChange={(event) => setEditingCell((current) => current ? { ...current, count: event.target.value } : current)} className="mt-2 h-10 w-full rounded-xl border border-[#d2d2d7] px-3 text-[12px] outline-none focus:border-[#8e8e93] focus:ring-2 focus:ring-[#d2d2d7]/40" />
                      </label>
                      <label className="mt-4 block text-[11px] font-medium text-[#3c3c43]">Details <span className="font-normal text-[#86868b]">(optional)</span>
                        <textarea rows={2} maxLength={1000} value={editingCell.details} onChange={(event) => setEditingCell((current) => current ? { ...current, details: event.target.value } : current)} placeholder="Optional device or workload details" className="mt-2 w-full resize-none rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-[12px] outline-none focus:border-[#8e8e93] focus:ring-2 focus:ring-[#d2d2d7]/40" />
                      </label>
                    </>}
                    <div className="mt-6 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingCell(null)} className="rounded-full px-4 py-2 text-[11px] text-[#3c3c43] hover:bg-[#f5f5f7]">Cancel</button>
                      <button type="button" onClick={() => void saveCalendarEntry()} disabled={savingCell || (!editingCell.arNumber.trim() && (!Number.isInteger(Number(editingCell.count)) || Number(editingCell.count) < 1))} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{savingCell ? 'Saving…' : editingCell.arNumber.trim() ? 'Review assignment' : 'Save count'}</button>
                    </div>
                  </div>
                </div>
              )}
            </section>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric label="Total endorsements" value={Number(dashboard.totals.total || 0).toLocaleString()} />
              <Metric label="Pending work" value={Number(dashboard.totals.pending || 0).toLocaleString()} />
              <Metric label="Today's assignment count" value={Number(dashboard.availability?.assignment_count || 0).toLocaleString()} />
            </div>
            <div className="mt-5">
              <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
                <h2 className="text-[13px] font-semibold text-[#1d1d1f]">By product division</h2>
                <div className="mt-4 space-y-3">
                  {dashboard.divisions.length ? dashboard.divisions.map((row) => (
                    <div key={row.product_division} className="flex items-center justify-between text-[12px]">
                      <span className="text-[#3c3c43]">{row.product_division || 'Unspecified'}</span>
                      <span className="font-semibold text-[#1d1d1f]">{Number(row.total).toLocaleString()}</span>
                    </div>
                  )) : <p className="text-[12px] text-[#6e6e73]">No endorsements yet.</p>}
                </div>
              </section>
            <div className="mt-5">
              <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
                <div className="flex items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold text-[#1d1d1f]">Recent endorsements</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Delete an endorsement without deleting the original Frontline record.</p></div><span className="text-[11px] text-[#6e6e73]">{dashboard.endorsements.length}</span></div>
                <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
                  {dashboard.endorsements.length ? dashboard.endorsements.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[12px] font-medium text-[#1d1d1f]">AR {row.ar_number} <span className="font-normal text-[#6e6e73]">· {row.engineer_name}</span></p><p className="mt-0.5 truncate text-[11px] text-[#6e6e73]">{row.device_model || 'Device not specified'} · CSO: {row.cso_name || 'Unknown'} · {row.issue || 'No issue provided'}</p></div><button type="button" onClick={() => void openPhotos(row)} className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-[#0071e3] hover:bg-[#eef4ff]">Photos</button>{canEditEndorsement && <button type="button" onClick={() => void deleteEndorsement(row.id)} disabled={deletingEndorsementId === row.id} className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-[#b42318] hover:bg-[#feeceb] disabled:cursor-not-allowed disabled:opacity-40">{deletingEndorsementId === row.id ? 'Deleting…' : 'Delete'}</button>}</div>) : <p className="text-[12px] text-[#6e6e73]">No endorsements yet.</p>}
                </div>
              </section>
            </div>
          </div></>}
          </>
        )}
      {photosFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label={`Linked Pulse messages for AR ${photosFor.ar_number}`}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#e5e5e7] bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Pulse evidence</p>
            <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-[#1d1d1f]">AR {photosFor.ar_number}</h2>
            {linkedLoading && <p className="mt-4 text-[13px] text-[#6e6e73]">Loading linked messages…</p>}
            {linkedError && <p role="alert" className="mt-4 text-[13px] text-[#a33a3a]">{linkedError}</p>}
            {!linkedLoading && !linkedError && linkedMessages.length === 0 && (
              <p className="mt-4 text-[13px] text-[#6e6e73]">No Pulse messages mention this AR yet. Send one from Pulse with AR {photosFor.ar_number} in the caption.</p>
            )}
            <div className="mt-4 space-y-3">
              {linkedMessages.map((m) => (
                <div key={m.id} className="rounded-xl bg-[#f5f5f7] px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold text-[#8e8e93]">{m.author_name} <span className="font-normal">· {new Date(m.created_at).toLocaleString()}</span></p>
                  {m.body && <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-[#1d1d1f]">{m.body}</p>}
                  {(m.meta?.attachments ?? []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(m.meta?.attachments ?? []).map((a) => (
                        <button key={a.id} type="button" onClick={() => setLinkedFull(a.id)} className="overflow-hidden rounded-xl ring-1 ring-inset ring-[#e5e5e7]" aria-label="View full-size photo">
                          <img src={pulseApi.photoUrl(a.id, 'thumb')} alt="Linked unit photo" loading="lazy" className="h-24 w-auto max-w-[200px] object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setPhotosFor(null); setLinkedFull(null); }} className="flex-1 rounded-xl bg-[#f5f5f7] py-3 text-[12px] font-semibold text-[#3c3c43]">Close</button>
            </div>
          </div>
        </div>
      )}
      {linkedFull && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1d1d1f]/80 p-4" role="dialog" aria-modal="true" aria-label="Photo viewer" onClick={() => setLinkedFull(null)}>
          <img src={pulseApi.photoUrl(linkedFull, 'full')} alt="Unit photo full size" className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[#e5e5e7] bg-white p-4"><p className="text-[11px] uppercase tracking-wider text-[#6e6e73]">{label}</p><p className="mt-2 text-[24px] font-semibold tracking-tight text-[#1d1d1f]">{value}</p></div>;
}

function LegacyEndorsementsKanban() {
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [selected, setSelected] = useState<EndorsementEngineer | null>(null);
  const [showFeed, setShowFeed] = useState(true);
  useEffect(() => { void Promise.all([api.endorsements.dashboardFresh(), api.endorsements.available()]).then(([nextDashboard, nextQueues]) => { setDashboard(nextDashboard); setQueues(nextQueues); }).catch(() => undefined); }, []);
  const rows = dashboard?.endorsements || [];
  const waiting = rows.filter((row) => !row.engineer_name || row.engineer_name === 'Unassigned');
  const done = rows.filter((row) => !['endorsed', 'pending'].includes(row.status));
  const progress = rows.filter((row) => !waiting.includes(row) && !done.includes(row));
  const visibleArs = new Set(rows.map((row) => row.ar_number));
  const priority = (row: typeof rows[number]) => row.status === 'urgent' ? 'URGENT' : 'NORMAL';
  const sorted = (items: typeof rows) => [...items].sort((a, b) => (priority(a) === 'URGENT' ? -1 : 1) - (priority(b) === 'URGENT' ? -1 : 1) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-5 text-[#1d1d1f] sm:px-6"><div className="mx-auto max-w-7xl"><div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#6e6e73]">Engineer Endorsements</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Queue board</h1></div><button onClick={() => window.location.reload()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-xs">Refresh</button></div><div className="mt-5 flex gap-2 overflow-x-auto pb-2">{(queues?.roster || []).map((engineer) => <button key={engineer.id} onClick={() => setSelected(engineer)} className={`shrink-0 rounded-full border px-3 py-2 text-xs ${engineer.status === 'active' ? engineer.last_assigned_at ? 'border-[#d9a441] bg-[#fff7df]' : 'border-[#4d9a66] bg-[#edf8ef]' : 'border-[#d2d2d7] bg-transparent text-[#6e6e73]'}`}>{engineer.full_name}</button>)}</div>{selected && <div className="rounded-xl border border-[#e5e5e7] bg-white p-3 text-xs">{selected.full_name} · {selected.last_assigned_at ? `last assigned ${new Date(selected.last_assigned_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : 'No current assignment'}<button className="ml-3 underline" onClick={() => setSelected(null)}>Close</button></div>}<div className="mt-4 grid gap-4 lg:grid-cols-3">{[['WAITING', waiting], ['IN PROGRESS', progress], ['DONE TODAY', done]].map(([name, items]) => <section key={String(name)} className="min-h-64 rounded-2xl border border-[#e5e5e7] bg-white p-3"><div className="flex items-center justify-between"><h2 className="text-xs font-semibold tracking-wide">{String(name)}</h2><span className="rounded-full bg-[#f5f5f7] px-2 py-1 text-[10px]">{(items as typeof rows).length}</span></div><div className="mt-3 space-y-2">{sorted(items as typeof rows).map((row) => <article key={row.id} className={`rounded-xl border border-[#e5e5e7] border-l-4 p-3 ${priority(row) === 'URGENT' ? 'border-l-[#f59e0b]' : 'border-l-[#3b82f6]'}`}><div className="flex justify-between"><strong className="text-xs">AR {row.ar_number}</strong><span className="text-[10px] text-[#6e6e73]">{row.engineer_name || 'Unassigned'}</span></div><p className="mt-1 text-xs">{row.device_model || 'Device not specified'}</p><p className="mt-1 line-clamp-2 text-[11px] text-[#6e6e73]">{row.issue || 'No fault details'}</p><p className="mt-2 text-[10px] text-[#86868b]">Synced from Frontline · {new Date(row.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></article>)}{(items as typeof rows).length === 0 && <p className="py-8 text-center text-xs text-[#6e6e73]">No {String(name).toLowerCase()} units.</p>}</div></section>)}</div><section className="mt-5 rounded-2xl border border-[#e5e5e7] bg-white p-4"><button onClick={() => setShowFeed((value) => !value)} className="flex w-full items-center justify-between text-sm font-semibold">Pulse history for this view <span className="text-xs text-[#6e6e73]">{showFeed ? 'Hide' : 'Show'}</span></button>{showFeed && <p className="mt-3 text-xs text-[#6e6e73]">{visibleArs.size ? `Open MSPI Pulse to review cards for ${visibleArs.size} visible AR${visibleArs.size === 1 ? '' : 's'}.` : 'No visible ARs have Pulse history yet.'}</p>}</section></div></main>;
}

function EndorsementsKanban() {
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [selected, setSelected] = useState<EndorsementEngineer | null>(null);
  const [collapsedDone, setCollapsedDone] = useState(false);
  useEffect(() => { void Promise.all([api.endorsements.dashboardFresh(), api.endorsements.available()]).then(([nextDashboard, nextQueues]) => { setDashboard(nextDashboard); setQueues(nextQueues); }).catch(() => undefined); }, []);
  const rows = dashboard?.endorsements || [];
  const waiting = rows.filter((row) => !row.engineer_name || row.engineer_name === 'Unassigned');
  const done = rows.filter((row) => !['endorsed', 'pending'].includes(row.status));
  const progress = rows.filter((row) => !waiting.includes(row) && !done.includes(row));
  const priority = (row: typeof rows[number]) => row.status.toLowerCase().includes('urgent') ? 'URGENT' : 'NORMAL';
  const ordered = (items: typeof rows) => [...items].sort((a, b) => (priority(a) === 'URGENT' ? 0 : 1) - (priority(b) === 'URGENT' ? 0 : 1) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const isAfterSix = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', hour12: false }).format(new Date());
  const doneHidden = collapsedDone || Number(isAfterSix) >= 18;
  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 text-[#1d1d1f] sm:px-7"><div className="mx-auto max-w-7xl"><header className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#86868b]">Operations</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-.03em]">Engineer Endorsements</h1><p className="mt-2 text-[13px] text-[#6e6e73]">A calm view of the queue, assignments, and completed work.</p></div><button onClick={() => window.location.reload()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm hover:bg-[#fafafa]">Refresh</button></header><section className="mt-7 rounded-[22px] border border-[#e5e5e7] bg-white px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]"><div className="flex items-center justify-between"><div><p className="text-[11px] font-semibold uppercase tracking-[.14em] text-[#86868b]">Engineer availability</p><p className="mt-1 text-[12px] text-[#6e6e73]">Tap an engineer to see their current queue state.</p></div><span className="text-[11px] text-[#86868b]">{queues?.roster.length || 0} engineers</span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{(queues?.roster || []).map((engineer) => <button key={engineer.id} onClick={() => setSelected(engineer)} className={`group flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[12px] transition-colors ${engineer.status === 'active' ? engineer.last_assigned_at ? 'border-[#e7c46a] bg-[#fffaf0]' : 'border-[#9dcaa8] bg-[#f2fbf4]' : 'border-[#d2d2d7] bg-white text-[#6e6e73]'}`}><span className={`h-2 w-2 rounded-full ${engineer.status !== 'active' ? 'bg-[#b5b5b9]' : engineer.last_assigned_at ? 'bg-[#d6a82d]' : 'bg-[#45a461]'}`} />{engineer.full_name}</button>)}</div>{selected && <div className="mt-3 flex items-center justify-between rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[12px]"><span><strong>{selected.full_name}</strong><span className="ml-2 text-[#6e6e73]">{selected.last_assigned_at ? `Last assigned ${new Date(selected.last_assigned_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : 'No current assignment'}</span></span><button onClick={() => setSelected(null)} className="text-[#6e6e73] underline underline-offset-2">Close</button></div>}</section><div className="mt-5 grid gap-4 lg:grid-cols-3">{([['WAITING', waiting, 'Units waiting for an engineer'], ['IN PROGRESS', progress, 'Assigned and being worked'], ['DONE TODAY', done, 'Completed since shift start']] as const).map(([title, items, subtitle]) => { const hidden = title === 'DONE TODAY' && doneHidden; return <section key={title} className="min-h-[360px] rounded-[22px] border border-[#e5e5e7] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]"><div className="flex items-start justify-between gap-3 border-b border-[#f0f0f2] pb-4"><div><div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold tracking-[.01em]">{title}</h2><span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e73]">{items.length}</span></div><p className="mt-1 text-[11px] text-[#86868b]">{subtitle}</p></div>{title === 'DONE TODAY' && <button onClick={() => setCollapsedDone((value) => !value)} className="text-[11px] text-[#6e6e73] underline underline-offset-2">{hidden ? 'Show' : 'Hide'}</button>}</div>{!hidden && <div className="mt-4 space-y-3">{ordered(items).map((row) => <article key={row.id} className={`rounded-[17px] border border-[#e5e5e7] bg-white p-4 shadow-[0_3px_12px_rgba(0,0,0,.035)] ${priority(row) === 'URGENT' ? 'border-l-4 border-l-[#e58a2b]' : 'border-l-4 border-l-[#4a8fe7]'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[#86868b]">{priority(row)}</p><h3 className="mt-1 text-[15px] font-semibold tracking-[-.01em]">AR {row.ar_number}</h3></div><span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-medium text-[#6e6e73]">{row.engineer_name || 'Unassigned'}</span></div><div className="mt-3 border-t border-[#f0f0f2] pt-3"><p className="text-[12px] font-medium text-[#3c3c43]">{row.device_model || 'Device model not specified'}</p><p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-[#6e6e73]">{row.issue || 'No fault description provided.'}</p></div><div className="mt-3 flex items-center gap-2 text-[10px] text-[#86868b]"><span className="h-1.5 w-1.5 rounded-full bg-[#45a461]" />Synced from Frontline · {new Date(row.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</div></article>)}{items.length === 0 && <div className="rounded-[17px] border border-dashed border-[#d2d2d7] px-4 py-10 text-center"><p className="text-[13px] font-medium text-[#6e6e73]">Nothing here</p><p className="mt-1 text-[11px] text-[#a1a1a6]">New units will appear automatically.</p></div>}</div>}</section>; })}</div></div></main>;
}

function EndorsementsMacBoard() {
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [showDone, setShowDone] = useState(true);
  useEffect(() => { void Promise.all([api.endorsements.dashboardFresh(), api.endorsements.available()]).then(([nextDashboard, nextQueues]) => { setDashboard(nextDashboard); setQueues(nextQueues); }).catch(() => undefined); }, []);
  const rows = dashboard?.endorsements || [];
  const waiting = rows.filter((row) => !row.engineer_name || row.engineer_name === 'Unassigned');
  const done = rows.filter((row) => !['endorsed', 'pending'].includes(row.status));
  const progress = rows.filter((row) => !waiting.includes(row) && !done.includes(row));
  const columns: Array<{ title: string; subtitle: string; rows: typeof rows }> = [{ title: 'WAITING', subtitle: 'Awaiting an engineer', rows: waiting }, { title: 'IN PROGRESS', subtitle: 'Assigned and being worked', rows: progress }, { title: 'DONE TODAY', subtitle: 'Completed this shift', rows: done }];
  const ordered = (items: typeof rows) => [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 text-[#1d1d1f] sm:px-7"><div className="mx-auto max-w-7xl"><header className="flex items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.18em] text-[#86868b]">Operations</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-.03em]">Engineer Endorsements</h1><p className="mt-2 text-[13px] text-[#6e6e73]">A focused queue view for today’s repair work.</p></div><div className="flex items-center gap-2"><button onClick={() => setSettingsOpen(true)} className="rounded-full border border-[#d2d2d7] bg-white px-3.5 py-2 text-[12px] font-medium shadow-sm hover:bg-[#fafafa]">Settings</button><button onClick={() => window.location.reload()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm hover:bg-[#fafafa]">Refresh</button></div></header><section className="mt-7 rounded-[20px] border border-[#d2d2d7] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]"><div className="flex items-center justify-between"><div><h2 className="text-[13px] font-semibold">Engineer availability</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Active engineers are ready for the round-robin queue.</p></div><span className="text-[11px] text-[#86868b]">{queues?.roster.length || 0} total</span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{(queues?.roster || []).map((engineer) => <div key={engineer.id} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[12px] ${engineer.status === 'active' ? 'border-[#c7c7cc] bg-[#f8f8fa]' : 'border-[#dedee3] bg-white text-[#86868b]'}`}><span className={`h-2 w-2 rounded-full ${engineer.status === 'active' ? 'bg-[#4f9b62]' : 'bg-[#b6b6bb]'}`} />{engineer.full_name}</div>)}</div></section><div className="mt-5 grid gap-4 lg:grid-cols-3">{columns.map((column) => <section key={column.title} className="min-h-[360px] rounded-[20px] border border-[#d2d2d7] bg-[#fbfbfc] p-4"><div className="flex items-start justify-between border-b border-[#e5e5e7] pb-4"><div><div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold">{column.title}</h2><span className="rounded-full bg-[#e5e5e7] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e73]">{column.rows.length}</span></div><p className="mt-1 text-[11px] text-[#86868b]">{column.subtitle}</p></div>{column.title === 'DONE TODAY' && <button onClick={() => setShowDone((value) => !value)} className="text-[11px] text-[#6e6e73] underline underline-offset-2">{showDone ? 'Hide' : 'Show'}</button>}</div>{column.title !== 'DONE TODAY' || showDone ? <div className="mt-4 space-y-3">{ordered(column.rows).map((row) => <article key={row.id} className={`rounded-[16px] border border-[#d9d9de] bg-white shadow-[0_2px_8px_rgba(0,0,0,.035)] ${compact ? 'p-3' : 'p-4'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#86868b]">{row.status === 'urgent' ? 'Urgent' : 'Endorsement'}</p><h3 className="mt-1 text-[15px] font-semibold">AR {row.ar_number}</h3></div><span className="max-w-[45%] truncate rounded-full bg-[#f1f1f3] px-2.5 py-1 text-[10px] text-[#5f5f66]">{row.engineer_name || 'Unassigned'}</span></div><div className="my-3 h-px bg-[#f0f0f2]" /><p className="text-[12px] font-medium text-[#3c3c43]">{row.device_model || 'Device model not specified'}</p><p className="mt-1.5 text-[12px] leading-5 text-[#6e6e73]">{row.issue || 'No fault description provided.'}</p><div className="mt-3 flex items-center gap-2 text-[10px] text-[#86868b]"><span className="h-1.5 w-1.5 rounded-full bg-[#7c7c82]" />Frontline record · {new Date(row.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</div></article>)}{column.rows.length === 0 && <div className="rounded-[16px] border border-dashed border-[#c9c9cf] px-4 py-10 text-center"><p className="text-[13px] font-medium text-[#6e6e73]">No records</p><p className="mt-1 text-[11px] text-[#9a9aa0]">New work will appear here automatically.</p></div>}</div> : null}</section>)}</div></div>{settingsOpen && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" onClick={() => setSettingsOpen(false)}><div className="w-full max-w-sm rounded-[20px] border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-[0_18px_60px_rgba(0,0,0,.18)]" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Endorsement settings</h2><button onClick={() => setSettingsOpen(false)} className="text-[18px] text-[#6e6e73]">×</button></div><div className="mt-5 divide-y divide-[#e5e5e7] overflow-hidden rounded-xl border border-[#d2d2d7] bg-white"><label className="flex items-center justify-between gap-3 px-3 py-3 text-[12px]"><span><span className="block font-medium">Compact cards</span><span className="mt-0.5 block text-[11px] text-[#6e6e73]">Use tighter spacing for smaller screens.</span></span><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /></label><label className="flex items-center justify-between gap-3 px-3 py-3 text-[12px]"><span><span className="block font-medium">Show Done Today</span><span className="mt-0.5 block text-[11px] text-[#6e6e73]">Keep completed work visible.</span></span><input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} /></label></div><p className="mt-4 text-[11px] leading-4 text-[#6e6e73]">Queue order and assignment rules are managed by operations.</p></div></div>}</main>;
}

function EndorsementsSettingsBoard() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()));
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [calendar, setCalendar] = useState<EngineerCalendar | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const canManage = Boolean(user?.isSuperAdmin) || ['Admin', 'PMG', 'CSO'].includes(user?.roleName || '');
  const month = date.slice(0, 7);
  const load = useCallback(async () => { try { const [nextDashboard, nextCalendar, nextQueues] = await Promise.all([api.endorsements.dashboardFresh(), api.endorsements.calendarFresh(month), api.endorsements.available()]); setDashboard(nextDashboard); setCalendar(nextCalendar); setQueues(nextQueues); } catch { /* keep the current board visible */ } }, [month]);
  useEffect(() => { void load(); }, [load]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const selectedDay = calendar?.days.find((day) => day.date === date);
  const rows = date === today ? (dashboard?.endorsements || []) : (selectedDay?.endorsements || []).map((row) => ({ ...row, cso_name: null }));
  const waiting = rows.filter((row) => !row.engineer_name || row.engineer_name === 'Unassigned');
  const done = rows.filter((row) => !['endorsed', 'pending'].includes(row.status));
  const progress = rows.filter((row) => !waiting.includes(row) && !done.includes(row));
  const availability = new Set((queues?.roster || []).filter((engineer) => engineer.status === 'active').map((engineer) => engineer.id));
  async function toggleAvailability(engineer: EndorsementEngineer, active: boolean) { if (!canManage) return; setSavingId(engineer.id); try { if (active) await api.endorsements.addEngineer(engineer.full_name); else await api.endorsements.removeEngineer(engineer.id); await load(); } finally { setSavingId(null); } }
  const columns: Array<{ title: string; rows: typeof rows }> = [{ title: 'WAITING', rows: waiting }, { title: 'IN PROGRESS', rows: progress }, { title: 'DONE', rows: done }];
  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 text-[#1d1d1f] sm:px-7"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-[#86868b]">Operations</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-.03em]">Engineer Endorsements</h1><p className="mt-2 text-[13px] text-[#6e6e73]">Queue and history for {date === today ? 'today' : new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'long' })}.</p></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-3 py-2 text-[12px] text-[#6e6e73]">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-transparent text-[#1d1d1f] outline-none" /></label><button onClick={() => setSettingsOpen(true)} className="rounded-full border border-[#d2d2d7] bg-white px-3.5 py-2 text-[12px] font-medium shadow-sm">Settings</button><button onClick={() => void load()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm">Refresh</button></div></header><section className="mt-7 rounded-[20px] border border-[#d2d2d7] bg-white p-4"><div className="flex items-center justify-between"><div><h2 className="text-[13px] font-semibold">Engineer availability · today</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Settings controls who can receive new queue assignments.</p></div><span className="text-[11px] text-[#86868b]">{availability.size} active</span></div><div className="mt-4 flex gap-2 overflow-x-auto pb-1">{(queues?.roster || []).map((engineer) => <label key={engineer.id} className="flex shrink-0 items-center gap-2 rounded-full border border-[#d2d2d7] bg-[#fafafa] px-3 py-2 text-[12px]"><input type="checkbox" checked={availability.has(engineer.id)} disabled={!canManage || savingId === engineer.id} onChange={(event) => void toggleAvailability(engineer, event.target.checked)} /><span>{engineer.full_name}</span></label>)}</div></section><div className="mt-5 grid gap-4 lg:grid-cols-3">{columns.map((column) => <section key={column.title} className="min-h-[340px] rounded-[20px] border border-[#d2d2d7] bg-[#fbfbfc] p-4"><div className="flex items-center justify-between border-b border-[#e5e5e7] pb-4"><h2 className="text-[13px] font-semibold">{column.title}</h2><span className="rounded-full bg-[#e5e5e7] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e73]">{column.rows.length}</span></div><div className="mt-4 space-y-3">{column.rows.length ? column.rows.map((row) => <article key={row.id} className={`rounded-[16px] border border-[#d9d9de] bg-white shadow-[0_2px_8px_rgba(0,0,0,.035)] ${compact ? 'p-3' : 'p-4'}`}><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#86868b]">{row.status === 'urgent' ? 'Urgent' : 'Endorsement'}</p><h3 className="mt-1 text-[15px] font-semibold">AR {row.ar_number}</h3></div><span className="rounded-full bg-[#f1f1f3] px-2.5 py-1 text-[10px] text-[#5f5f66]">{row.engineer_name || 'Unassigned'}</span></div><div className="my-3 h-px bg-[#f0f0f2]" /><p className="text-[12px] font-medium">{row.device_model || 'Device model not specified'}</p><p className="mt-1.5 text-[12px] leading-5 text-[#6e6e73]">{row.issue || 'No fault description provided.'}</p><p className="mt-3 text-[10px] text-[#86868b]">Frontline record · {new Date(row.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></article>) : <div className="rounded-[16px] border border-dashed border-[#c9c9cf] px-4 py-10 text-center text-[12px] text-[#86868b]">No records for this date.</div>}</div></section>)}</div></div>{settingsOpen && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" onClick={() => setSettingsOpen(false)}><div className="w-full max-w-sm rounded-[20px] border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Settings</h2><button onClick={() => setSettingsOpen(false)} className="text-[18px] text-[#6e6e73]">×</button></div><p className="mt-1 text-[11px] text-[#6e6e73]">Manage today’s Engineer availability and board density.</p><div className="mt-4 divide-y divide-[#e5e5e7] overflow-hidden rounded-xl border border-[#d2d2d7] bg-white"><label className="flex items-center justify-between px-3 py-3 text-[12px]"><span>Compact cards</span><input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} /></label><div className="px-3 py-3 text-[11px] text-[#6e6e73]">Use the availability checkboxes above to add or remove Engineers from today’s queue.</div></div></div></div>}</main>;
}

function WeeklyAvailabilityBoard() {
  const { user } = useAuth();
  const [engineers, setEngineers] = useState<EndorsementEngineer[]>([]);
  const [selectedEngineer, setSelectedEngineer] = useState('');
  const [availableDays, setAvailableDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const canManage = Boolean(user?.isSuperAdmin) || ['Admin', 'PMG', 'CSO'].includes(user?.roleName || '');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  useEffect(() => { void api.endorsements.available().then((result) => { setEngineers(result.roster); if (!selectedEngineer) setSelectedEngineer(user?.roleName === 'ENGR' ? result.roster.find((row) => row.user_id === user.id)?.full_name || '' : result.roster[0]?.full_name || ''); }).catch(() => undefined); }, [selectedEngineer, user]);
  useEffect(() => { if (!selectedEngineer) return; void api.endorsements.schedule(canManage ? selectedEngineer : undefined).then((result) => setAvailableDays(days.filter((day) => !result.restDays.includes(day)))).catch(() => undefined); }, [canManage, selectedEngineer]);
  async function save() { if (!selectedEngineer || (!canManage && selectedEngineer !== engineers.find((engineer) => engineer.user_id === user?.id)?.full_name)) return; setSaving(true); setMessage(''); try { await api.endorsements.saveSchedule(days.filter((day) => !availableDays.includes(day)).concat('Sun'), canManage ? selectedEngineer : undefined); setMessage('Weekly availability saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save schedule.'); } finally { setSaving(false); } }
  return <div><EndorsementsSettingsBoard /><section className="mx-auto -mt-2 max-w-7xl px-4 pb-8 sm:px-7"><div className="rounded-[20px] border border-[#d2d2d7] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.03)]"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-[#86868b]">Settings</p><h2 className="mt-1 text-[17px] font-semibold tracking-[-.01em]">Weekly Engineer availability</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Choose which days each Engineer can receive work. Sunday is always unavailable.</p></div><button onClick={() => void save()} disabled={saving || !selectedEngineer} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save schedule'}</button></div><div className="mt-5 grid gap-4 md:grid-cols-[240px_1fr]"><label className="text-[12px] font-medium">Engineer<select value={selectedEngineer} onChange={(event) => setSelectedEngineer(event.target.value)} disabled={!canManage && engineers.length > 0} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[12px] outline-none">{engineers.map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name}</option>)}</select></label><div><p className="text-[12px] font-medium">Available days</p><div className="mt-2 flex flex-wrap gap-2">{days.map((day) => <label key={day} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] ${availableDays.includes(day) ? 'border-[#b9b9c0] bg-[#f5f5f7]' : 'border-[#e5e5e7] bg-white text-[#86868b]'}`}><input type="checkbox" checked={availableDays.includes(day)} onChange={(event) => setAvailableDays((current) => event.target.checked ? [...current, day] : current.filter((value) => value !== day))} />{day}</label>)}<span className="flex items-center rounded-xl border border-[#e5e5e7] bg-[#fafafa] px-3 py-2.5 text-[12px] text-[#a1a1a6]">Sun · Rest day</span></div></div></div>{message && <p className="mt-4 text-[12px] text-[#3c3c43]">{message}</p>}</div></section></div>;
}

function FinalEndorsementsBoard() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()));
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [calendar, setCalendar] = useState<EngineerCalendar | null>(null);
  const [frontlineReport, setFrontlineReport] = useState<Awaited<ReturnType<typeof api.frontline.report>> | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedEngineer, setSelectedEngineer] = useState('');
  const [availableDays, setAvailableDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const canManage = Boolean(user?.isSuperAdmin) || ['Admin', 'PMG', 'CSO'].includes(user?.roleName || '');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const load = useCallback(async () => { try { const [nextDashboard, nextCalendar, nextQueues, nextFrontline] = await Promise.all([api.endorsements.dashboardFresh(), api.endorsements.calendarFresh(date.slice(0, 7)), api.endorsements.available(), api.frontline.report()]); setDashboard(nextDashboard); setCalendar(nextCalendar); setQueues(nextQueues); setFrontlineReport(nextFrontline); if (!selectedEngineer) setSelectedEngineer(canManage ? nextQueues.roster[0]?.full_name || '' : nextQueues.roster.find((row) => row.user_id === user?.id)?.full_name || ''); } catch { setMessage('Unable to refresh endorsement data.'); } }, [canManage, date, selectedEngineer, user?.id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selectedEngineer) void api.endorsements.schedule(canManage ? selectedEngineer : undefined).then((result) => setAvailableDays(days.filter((day) => !result.restDays.includes(day)))).catch(() => undefined); }, [canManage, selectedEngineer]);
  const selectedDay = calendar?.days.find((day) => day.date === date);
  const dateInManila = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(value)) : '';
  const rows = date === today ? (dashboard?.endorsements || []).filter((row) => dateInManila(row.created_at) === date) : (selectedDay?.endorsements || []).map((row) => ({ ...row, cso_name: null }));
  const frontlineWaiting = (frontlineReport?.records || []).filter((record) => !record.endorsement_id && (record.occurred_date || '').slice(0, 10) === date && ['received (appointment)', 'received (walk in)', 'job order (walk in)'].includes(record.transaction_type.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim())).map((record) => ({ id: record.id, ar_number: record.ar_number, device_model: record.device_model, issue: record.issue, product_division: record.product_division, status: 'waiting', created_at: record.occurred_date || new Date().toISOString(), engineer_name: '', cso_name: record.cso || null }));
  const waiting = frontlineWaiting; const progress = rows.filter((row) => !['cancelled', 'canceled', 'completed', 'resolved'].includes(row.status.toLowerCase()));
  const columns: Array<{ title: string; rows: typeof rows }> = [{ title: 'WAITING', rows: waiting }, { title: 'IN PROGRESS', rows: progress }];
  async function saveSchedule() { if (!selectedEngineer) return; setSaving(true); setMessage(''); try { await api.endorsements.saveSchedule(days.filter((day) => !availableDays.includes(day)).concat('Sun'), canManage ? selectedEngineer : undefined); setMessage('Weekly availability saved.'); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save schedule.'); } finally { setSaving(false); } }
  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-6 text-[#1d1d1f] sm:px-7"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-[#86868b]">Operations</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-.03em]">Engineer Endorsements</h1><p className="mt-2 text-[13px] text-[#6e6e73]">{date === today ? 'Today' : new Date(`${date}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'long' })} · queue history</p></div><label className="flex items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-3 py-2 text-[12px] text-[#6e6e73]">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-transparent text-[#1d1d1f] outline-none" /></label></header><div className="mt-5 grid gap-4 lg:grid-cols-3">{columns.map((column) => <section key={column.title} className="min-h-[340px] rounded-[20px] border border-[#d2d2d7] bg-[#fbfbfc] p-4"><div className="flex items-center justify-between border-b border-[#e5e5e7] pb-4"><h2 className="text-[13px] font-semibold">{column.title}</h2><span className="rounded-full bg-[#e5e5e7] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e73]">{column.rows.length}</span></div><div className="mt-4 space-y-3">{column.rows.length ? column.rows.map((row) => <article key={row.id} className="rounded-[16px] border border-[#d9d9de] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,.035)]"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#86868b]">{row.status === 'urgent' ? 'Urgent' : 'Endorsement'}</p><h3 className="mt-1 text-[15px] font-semibold">AR {row.ar_number}</h3></div><span className="rounded-full bg-[#f1f1f3] px-2.5 py-1 text-[10px] text-[#5f5f66]">{row.engineer_name || 'Unassigned'}</span></div><div className="my-3 h-px bg-[#f0f0f2]" /><p className="text-[12px] font-medium">{row.device_model || 'Device model not specified'}</p><p className="mt-1.5 text-[12px] leading-5 text-[#6e6e73]">{row.issue || 'No fault description provided.'}</p><p className="mt-3 text-[10px] text-[#86868b]">Frontline record · {new Date(row.created_at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></article>) : <div className="rounded-[16px] border border-dashed border-[#c9c9cf] px-4 py-10 text-center text-[12px] text-[#86868b]">No records for this date.</div>}</div></section>)}</div><button onClick={() => setSettingsOpen(true)} className="mt-5 rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm">Settings</button>{settingsOpen && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" onClick={() => setSettingsOpen(false)}><div className="w-full max-w-lg rounded-[22px] border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-[#86868b]">Settings</p><h2 className="mt-1 text-[18px] font-semibold">Engineer availability</h2></div><button onClick={() => setSettingsOpen(false)} className="text-[18px] text-[#6e6e73]">×</button></div><p className="mt-1 text-[12px] text-[#6e6e73]">Set which days an Engineer is available. Monday through Saturday are configurable; Sunday is always a rest day.</p><div className="mt-5 grid gap-4 md:grid-cols-[220px_1fr]"><label className="text-[12px] font-medium">Engineer<select value={selectedEngineer} onChange={(event) => setSelectedEngineer(event.target.value)} disabled={!canManage} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[12px]">{(queues?.roster || []).map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name}</option>)}</select></label><div><p className="text-[12px] font-medium">Available days</p><div className="mt-2 flex flex-wrap gap-2">{days.map((day) => <label key={day} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] ${availableDays.includes(day) ? 'border-[#b9b9c0] bg-white' : 'border-[#e5e5e7] bg-[#f1f1f3] text-[#86868b]'}`}><input type="checkbox" checked={availableDays.includes(day)} onChange={(event) => setAvailableDays((current) => event.target.checked ? [...current, day] : current.filter((value) => value !== day))} />{day}</label>)}<span className="rounded-xl border border-[#e5e5e7] bg-[#f1f1f3] px-3 py-2.5 text-[12px] text-[#a1a1a6]">Sun · Rest</span></div></div></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => void load()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium">Refresh</button><button onClick={() => void saveSchedule()} disabled={saving || !selectedEngineer || !canManage && selectedEngineer !== queues?.roster.find((row) => row.user_id === user?.id)?.full_name} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">{saving ? 'Saving…' : 'Save schedule'}</button></div>{message && <p className="mt-3 text-[12px] text-[#3c3c43]">{message}</p>}</div></div>}</div></main>;
}

export default FinalEndorsementsBoard;

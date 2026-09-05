import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type EndorsementEngineer, type EndorsementQueues, type EngineerCalendar, type EngineerDashboard } from '../lib/api';
import { useAuth } from '../lib/auth';
import EndorsementQueuePanel from '../components/EndorsementQueuePanel';

export default function EngineerEndorsementsPage() {
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
                  {dashboard.endorsements.length ? dashboard.endorsements.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[12px] font-medium text-[#1d1d1f]">AR {row.ar_number} <span className="font-normal text-[#6e6e73]">· {row.engineer_name}</span></p><p className="mt-0.5 truncate text-[11px] text-[#6e6e73]">{row.device_model || 'Device not specified'} · CSO: {row.cso_name || 'Unknown'} · {row.issue || 'No issue provided'}</p></div>{canEditEndorsement && <button type="button" onClick={() => void deleteEndorsement(row.id)} disabled={deletingEndorsementId === row.id} className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-[#b42318] hover:bg-[#feeceb] disabled:cursor-not-allowed disabled:opacity-40">{deletingEndorsementId === row.id ? 'Deleting…' : 'Delete'}</button>}</div>) : <p className="text-[12px] text-[#6e6e73]">No endorsements yet.</p>}
                </div>
              </section>
            </div>
          </div></>}
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[#e5e5e7] bg-white p-4"><p className="text-[11px] uppercase tracking-wider text-[#6e6e73]">{label}</p><p className="mt-2 text-[24px] font-semibold tracking-tight text-[#1d1d1f]">{value}</p></div>;
}

import { useEffect, useMemo, useState } from 'react';
import { api, type EndorsementEngineer, type EngineerCalendar, type EngineerDashboard } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function EngineerEndorsementsPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [calendar, setCalendar] = useState<EngineerCalendar | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7));
  const [selectedDay, setSelectedDay] = useState<{ date: string; division: string; engineer: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ date: string; division: string; engineer: string; count: string; details: string } | null>(null);
  const [savingCell, setSavingCell] = useState(false);
  const [roster, setRoster] = useState<EndorsementEngineer[] | null>(null);
  const [nextEngineer, setNextEngineer] = useState<EndorsementEngineer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [newEngineerName, setNewEngineerName] = useState('');
  const [message, setMessage] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [editingEndorsementId, setEditingEndorsementId] = useState<number | null>(null);
  const [deviceModelDraft, setDeviceModelDraft] = useState('');
  const [savingDeviceModel, setSavingDeviceModel] = useState(false);
  const [passingEndorsementId, setPassingEndorsementId] = useState<number | null>(null);
  const [deletingEndorsementId, setDeletingEndorsementId] = useState<number | null>(null);

  const isEngineer = user?.roleName === 'ENGR';
  const canManageRoster = user?.roleName === 'Admin' || user?.roleName === 'PMG';

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [nextDashboard, nextCalendar] = await Promise.all([api.endorsements.dashboard(), api.endorsements.calendar(calendarMonth)]);
      setDashboard(nextDashboard);
      setCalendar(nextCalendar);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadRoster = async () => {
    try {
      const result = await api.endorsements.available();
      setRoster(result.roster);
      setNextEngineer(result.nextEngineer);
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(true), 10000); return () => window.clearInterval(timer); }, [calendarMonth]);
  useEffect(() => { void loadRoster(); }, [canManageRoster]);
  useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(''), 4000); return () => window.clearTimeout(timer); }, [message]);

  const active = dashboard?.availability?.status === 'active';

  const changeAvailability = async (action: 'join' | 'leave') => {
    setBusy(true);
    setMessage('');
    try {
      const result = action === 'join'
        ? await api.endorsements.join()
        : await api.endorsements.leave();
      setMessage(result.message);
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const skipTurn = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.endorsements.skip();
      setMessage(result.message);
      await Promise.all([load(), loadRoster()]);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const passNext = async () => {
    const previousNext = nextEngineer;
    const activeEngineers = roster?.filter((engineer) => engineer.status === 'active') || [];
    const currentIndex = previousNext ? activeEngineers.findIndex((engineer) => engineer.id === previousNext.id) : -1;
    const optimisticNext = currentIndex >= 0 && activeEngineers.length > 1
      ? activeEngineers[(currentIndex + 1) % activeEngineers.length]
      : previousNext;
    if (optimisticNext) setNextEngineer(optimisticNext);
    setBusy(true);
    setMessage('');
    try {
      await api.endorsements.passNext();
      void Promise.all([load(true), loadRoster()]);
    } catch (error) {
      setNextEngineer(previousNext);
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addEngineer = async () => {
    const name = newEngineerName.trim();
    if (!name) return;
    setRosterBusy(true);
    setMessage('');
    try {
      await api.endorsements.addEngineer(name);
      setNewEngineerName('');
      await loadRoster();
      setMessage(`${name} added to today's Engineer roster.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRosterBusy(false);
    }
  };

  const removeEngineer = async (id: number) => {
    const previousRoster = roster;
    const nextRoster = roster?.map((engineer) => engineer.id === id ? { ...engineer, status: 'left' as const } : engineer) || null;
    setRoster(nextRoster);
    setNextEngineer(nextRoster?.find((engineer) => engineer.status === 'active') || null);
    setRosterBusy(true);
    setMessage('');
    try {
      await api.endorsements.removeEngineer(id);
      void loadRoster();
      setMessage('Engineer removed from today\'s roster.');
    } catch (error) {
      setRoster(previousRoster);
      setNextEngineer(previousRoster?.find((engineer) => engineer.status === 'active') || null);
      setMessage((error as Error).message);
    } finally {
      setRosterBusy(false);
    }
  };

  const markPresent = async (name: string) => {
    const previousRoster = roster;
    const nextRoster = roster?.map((engineer) => engineer.full_name.toLowerCase() === name.toLowerCase() ? { ...engineer, status: 'active' as const } : engineer) || null;
    setRoster(nextRoster);
    setNextEngineer(nextRoster?.find((engineer) => engineer.status === 'active') || null);
    setRosterBusy(true);
    setMessage('');
    try {
      await api.endorsements.addEngineer(name);
      void loadRoster();
      setMessage(`${name} is present and eligible for endorsements.`);
    } catch (error) {
      setRoster(previousRoster);
      setNextEngineer(previousRoster?.find((engineer) => engineer.status === 'active') || null);
      setMessage((error as Error).message);
    } finally {
      setRosterBusy(false);
    }
  };

  const toggleAvailability = async (engineer: EndorsementEngineer) => {
    if (!canManageRoster) return;
    if (engineer.status === 'active') await removeEngineer(engineer.id);
    else await markPresent(engineer.full_name);
  };

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
  const openCalendarEditor = (date: string, division: string, engineer: string) => { const entry = calendar?.days.find((day) => day.date === date)?.counts[division]?.[engineer]?.find((item) => item.is_manual); setEditingCell({ date, division, engineer, count: entry?.manual_count ? String(entry.manual_count) : '', details: entry?.details || '' }); };
  const saveCalendarEntry = async () => { if (!editingCell) return; const count = Number(editingCell.count); if (!Number.isInteger(count) || count < 1) return; setSavingCell(true); setMessage(''); try { await api.endorsements.saveCalendarEntry({ ...editingCell, count }); setEditingCell(null); await load(); setMessage('Calendar entry saved.'); } catch (error) { setMessage((error as Error).message); } finally { setSavingCell(false); } };
  const canEditEndorsement = user?.roleName === 'Admin' || user?.roleName === 'CSO';
  const beginDeviceModelEdit = (id: number, value: string | null) => { setEditingEndorsementId(id); setDeviceModelDraft(value || ''); };
  const saveDeviceModel = async (id: number) => { const value = deviceModelDraft.trim(); if (!value) return; setSavingDeviceModel(true); setMessage(''); try { await api.endorsements.updateDeviceModel(id, value); setEditingEndorsementId(null); setDeviceModelDraft(''); await load(); setMessage('Device model updated.'); } catch (error) { setMessage((error as Error).message); } finally { setSavingDeviceModel(false); } };
  const passEndorsement = async (id: number) => { setPassingEndorsementId(id); setMessage(''); try { await api.endorsements.passEndorsement(id); void Promise.all([load(true), loadRoster()]); } catch (error) { setMessage((error as Error).message); } finally { setPassingEndorsementId(null); } };
  const deleteEndorsement = async (id: number) => { if (!window.confirm('Delete this endorsement only? The original Frontline record will not be changed.')) return; setDeletingEndorsementId(id); setMessage(''); try { const result = await api.endorsements.delete(id); setSelectedDay(null); await Promise.all([load(true), loadRoster()]); setMessage(result.message); } catch (error) { setMessage((error as Error).message); } finally { setDeletingEndorsementId(null); } };

  return (
    <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <div className="mx-auto w-full max-w-none">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Engineer Endorsements</h1><p className="mt-1.5 text-[14px] text-[#3c3c43]">Daily availability and customer device endorsements.</p></div>
          <button type="button" onClick={() => setShowDetails((visible) => !visible)} aria-expanded={showDetails} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7]">{showDetails ? 'Hide details' : 'Show details'}</button>
        </div>

        {message && (
          <div role="status" aria-live="polite" className="fixed right-4 top-16 z-30 flex max-w-sm items-center gap-3 rounded-2xl bg-white/95 px-3.5 py-3 text-[12px] text-[#3c3c43] shadow-[0_12px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[13px] text-[#3c3c43]" aria-hidden="true">✓</span>
            <span className="min-w-0 flex-1 leading-5">{message}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="cursor-pointer rounded-full px-1 text-[16px] leading-none text-[#6e6e73] hover:bg-[#f5f5f7]">×</button>
          </div>
        )}

        {showDetails && <>{isEngineer && (
          <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-[#1d1d1f]">Today&apos;s availability</p>
                <p className="mt-1 text-[12px] text-[#6e6e73]">Join each morning when you are ready to receive new endorsements.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void changeAvailability(active ? 'leave' : 'join')} disabled={busy} className={`rounded-full px-4 py-2 text-[12px] font-semibold ${active ? 'border border-[#d2d2d7] text-[#3c3c43]' : 'bg-[#1d1d1f] text-white'} disabled:opacity-40`}>
                  {busy ? 'Updating…' : active ? "Leave today's queue" : "Join today's queue"}
                </button>
                {active && <button type="button" onClick={() => void skipTurn()} disabled={busy} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-semibold text-[#3c3c43] disabled:opacity-40">Pass next turn</button>}
              </div>
            </div>
            <p className={`mt-3 text-[12px] ${active ? 'text-[#3c3c43]' : 'text-[#6e6e73]'}`}>
              {active ? 'You are available for new endorsements.' : 'You are not currently available for new endorsements.'}
            </p>
          </section>
        )}

        <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-5">
          <div className="flex items-center justify-between gap-3"><p className="text-[11px] uppercase tracking-wider text-[#6e6e73]">Next endorsement</p><span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-medium text-[#6e6e73]">{dashboard?.date || 'Today'}</span></div>
          {nextEngineer ? <div className="mt-3 flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1d1d1f] text-[13px] font-semibold text-white">1</div><div className="min-w-0"><p className="truncate text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{nextEngineer.full_name}</p><p className="mt-0.5 text-[12px] text-[#6e6e73]">First in round robin · {nextEngineer.assignment_count} assigned today</p></div></div><button type="button" onClick={() => void passNext()} disabled={busy} className="shrink-0 rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-semibold text-[#3c3c43] hover:bg-[#f5f5f7] disabled:opacity-40">Pass to next</button></div> : <p className="mt-2 text-[13px] text-[#6e6e73]">No Engineer is currently available. Engineers can join today&apos;s queue above.</p>}
        </section>

        {showDetails && (
          <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1d1d1f]">Today&apos;s Engineer availability</h2>
                <p className="mt-1 text-[12px] text-[#6e6e73]">Click an Engineer card to change availability. The first available card is next.</p>
              </div>
              {canManageRoster && <form className="flex w-full max-w-md gap-2 sm:w-auto" onSubmit={(event) => { event.preventDefault(); void addEngineer(); }}>
                <input value={newEngineerName} onChange={(event) => setNewEngineerName(event.target.value)} placeholder="Engineer name" aria-label="Engineer name" className="h-9 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] px-3 text-[12px]" />
                <button type="submit" disabled={rosterBusy || !newEngineerName.trim()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">
                  {rosterBusy ? 'Adding…' : 'Add Engineer'}
                </button>
              </form>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {roster === null ? <p className="text-[12px] text-[#6e6e73]">Loading roster…</p> : roster.length ? <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{roster.map((engineer, index) => <button key={engineer.id} type="button" onClick={() => void toggleAvailability(engineer)} disabled={!canManageRoster} aria-pressed={engineer.status === 'active'} aria-label={`${engineer.full_name}: ${engineer.status === 'active' ? 'available' : 'unavailable'}. Click to change status.`} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${engineer.status === 'active' ? 'border-[#cfe8d6] bg-[#fbfefc] hover:bg-[#f4fbf6]' : 'border-[#e5e5e7] bg-[#fafafa] opacity-70 hover:bg-[#f5f5f7]'} ${canManageRoster ? 'cursor-pointer' : 'cursor-default'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${engineer.status === 'active' ? 'bg-[#e8f5eb] text-[#166534]' : 'bg-[#e8e8ed] text-[#86868b]'}`}>{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold text-[#1d1d1f]">{engineer.full_name}</span><span className="mt-0.5 block text-[11px] text-[#6e6e73]">{engineer.assignment_count} assigned today</span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${engineer.status === 'active' ? 'bg-[#ecfdf3] text-[#166534]' : 'bg-[#f0f0f2] text-[#6e6e73]'}`}>{engineer.status === 'active' ? 'Available' : 'Away'}</span></button>)}</div> : <p className="text-[12px] text-[#6e6e73]">No Engineers added for today yet.</p>}
            </div>
          </section>
        )}</>}

        {loading ? (
          <div className="rounded-2xl border border-[#e5e5e7] bg-white p-8 text-center text-[13px] text-[#6e6e73]">Loading endorsements…</div>
        ) : dashboard && (
          <>
            <section className="mb-5 min-w-0 max-w-full rounded-2xl border border-[#e5e5e7] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e7] px-5 py-4"><div><h2 className="text-[13px] font-semibold text-[#1d1d1f]">Endorsement calendar</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Daily workload by Engineer · click a count to view details · double-click a cell to edit.</p><p className="mt-1 text-[11px] text-[#86868b]">Available today · {roster === null ? 'Checking…' : roster.filter((engineer) => engineer.status === 'active').map((engineer) => engineer.full_name).join(', ') || 'None'}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => shiftMonth(-1)} className="h-8 w-8 rounded-full border border-[#d2d2d7] text-[16px] text-[#3c3c43] hover:bg-[#f5f5f7]" aria-label="Previous month">‹</button><span className="min-w-32 text-center text-[12px] font-semibold text-[#1d1d1f]">{calendarTitle}</span><button type="button" onClick={() => shiftMonth(1)} className="h-8 w-8 rounded-full border border-[#d2d2d7] text-[16px] text-[#3c3c43] hover:bg-[#f5f5f7]" aria-label="Next month">›</button></div></div>
              {calendar && <div className="w-full max-w-full overflow-visible"><table className="w-full min-w-0 table-fixed border-separate border-spacing-0 text-left text-[12px]"><colgroup><col className="w-28 min-w-28 max-w-28" /><col className="w-14 min-w-14 max-w-14" />{calendar.columns.map((column, index) => <col key={`${column.division}-${column.engineer}-${index}`} className="w-auto" />)}</colgroup><thead className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-[#6e6e73]"><tr className="sticky top-12 z-[6] bg-[#fafafa]"><th rowSpan={2} className="sticky left-0 top-12 z-[7] w-28 min-w-28 max-w-28 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-b border-[#e5e5e7] bg-[#fafafa] px-4 py-3">Date</th><th rowSpan={2} className="sticky left-28 top-12 z-[7] w-14 min-w-14 max-w-14 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-b border-[#e5e5e7] bg-[#fafafa] px-2 py-3">Day</th>{calendar.divisions.map((division) => { const columns = calendar.columns.filter((column) => column.division === division); return <th key={division} colSpan={Math.max(columns.length, 1)} className="sticky top-12 z-[5] border-r border-b border-l-4 border-[#e5e5e7] bg-[#fafafa] px-4 py-3 text-center normal-case text-[12px] font-semibold text-[#1d1d1f]">{division}<span className="ml-2 text-[10px] font-normal text-[#6e6e73]">{calendar.totals[division] || 0} total</span></th>})}</tr><tr className="sticky top-[90px] z-[6] bg-[#fafafa]">{calendar.divisions.flatMap((division) => { const columns = calendar.columns.filter((column) => column.division === division); return columns.length ? columns.map((column, index) => <th key={`${column.division}-${column.engineer}`} className={`sticky top-[90px] z-[5] w-auto min-w-0 border-r border-b bg-[#fafafa] px-4 py-3 text-center ${index === 0 ? 'border-l-4' : ''} border-[#e5e5e7]`}><span className="block truncate text-[11px] font-semibold text-[#3c3c43]">{column.engineer}</span><span className="mt-1 block text-[10px] font-normal text-[#6e6e73]">{column.total}</span></th>) : (<th key={division} className="sticky top-[90px] z-[5] border-r border-b border-l-4 border-[#e5e5e7] bg-[#fafafa] px-4 py-3 text-center text-[10px] font-normal text-[#86868b]">No Engineers</th>); })}</tr></thead><tbody>{calendar.days.map((day) => <tr key={day.date} className={`h-6 border-t border-[#f0f0f2] ${day.date === dashboard.date ? 'bg-[#fbfefc]' : ''}`}><td className="sticky left-0 z-[2] w-28 min-w-28 max-w-28 whitespace-nowrap border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-[#e5e5e7] bg-inherit px-4 py-1.5 align-middle font-medium text-[#3c3c43]">{formatDate(`${day.date}T00:00:00Z`)}</td><td className="sticky left-28 z-[2] w-14 min-w-14 max-w-14 border-r shadow-[2px_0_4px_-3px_rgba(0,0,0,0.18)] border-[#e5e5e7] bg-inherit px-2 py-1.5 align-middle text-[#6e6e73]">{day.day}</td>{calendar.divisions.flatMap((division) => { const columns = calendar.columns.filter((column) => column.division === division); if (!columns.length) return [<td key={`${day.date}-${division}-empty`} className="border-r border-l-4 border-[#e5e5e7] px-2 py-1.5 align-middle text-center text-[#d2d2d7]">—</td>]; return columns.map((column, index) => { const entries = day.counts[division]?.[column.engineer] || []; const cellCount = entries.reduce((sum, entry) => sum + (entry.manual_count || 1), 0); const isLatestCell = Boolean(latestCalendarTimestamp && entries.some((entry) => entry.created_at === latestCalendarTimestamp)); return <td key={`${day.date}-${division}-${column.engineer}`} className={`w-auto min-w-0 border-r p-0 align-middle ${index === 0 ? 'border-l-4' : ''} border-[#e5e5e7]`}>{entries.length ? <button type="button" onClick={() => setSelectedDay({ date: day.date, division, engineer: column.engineer })} onDoubleClick={() => openCalendarEditor(day.date, division, column.engineer)} className="relative flex min-h-6 w-full items-center justify-center rounded-none bg-[#f5f5f7] px-2 py-1.5 text-left hover:bg-[#e5e5e7]" aria-label={`${entries.length} endorsements for ${column.engineer} in ${division} on ${day.date}`}><span className="block text-center text-[15px] font-semibold leading-6 text-[#1d1d1f]">{cellCount}</span>{isLatestCell && <span title="New" aria-label="New" className="absolute right-1.5 top-1 rounded-full border border-[#d2d2d7] px-1 py-px text-[7px] font-semibold leading-3 tracking-wide text-[#6e6e73]">NEW</span>}</button> : <button type="button" onClick={() => openCalendarEditor(day.date, division, column.engineer)} className="flex min-h-6 w-full items-center justify-center rounded-none px-2 py-1.5 text-[#d2d2d7] hover:bg-[#fafafa]" aria-label={`Add calendar entry for ${column.engineer} in ${division} on ${day.date}`}>—</button>}</td>; }); })}</tr>)}</tbody></table></div>}
              {selectedDay && <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Endorsement details"><div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#e5e5e7] bg-white p-5 shadow-xl"><div className="flex items-center justify-between gap-3 border-b border-[#e5e5e7] pb-4"><div><p className="text-[12px] font-semibold text-[#1d1d1f]">{selectedDay.division} · {selectedDay.engineer} · {formatDate(`${selectedDay.date}T00:00:00Z`)}</p><p className="mt-1 text-[11px] text-[#6e6e73]">{selectedEndorsementCount} endorsement{selectedEndorsementCount === 1 ? '' : 's'}</p></div><button type="button" onClick={() => setSelectedDay(null)} className="rounded-full px-2 py-1 text-[11px] font-medium text-[#6e6e73] hover:bg-[#f5f5f7]">Close</button></div><div className="mt-4 grid gap-3">{selectedEndorsements.map((row) => <div key={row.id} className="cursor-pointer border-b border-[#e5e5e7] px-1 py-3 last:border-b-0"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-semibold text-[#1d1d1f]">AR {row.ar_number}</span><span className="text-[11px] text-[#6e6e73]">{formatTime(row.created_at)}</span></div><div className="mt-2 flex items-center gap-2 text-[11px] text-[#3c3c43]">{editingEndorsementId === row.id ? <><input value={deviceModelDraft} onChange={(event) => setDeviceModelDraft(event.target.value)} placeholder="Device model" aria-label="Device model" className="h-8 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] bg-white px-2 text-[11px]" /><button type="button" onClick={() => void saveDeviceModel(row.id)} disabled={savingDeviceModel || !deviceModelDraft.trim()} className="rounded-full bg-[#1d1d1f] px-3 py-1.5 text-[10px] font-semibold text-white disabled:opacity-40">{savingDeviceModel ? 'Saving…' : 'Save'}</button><button type="button" onClick={() => { setEditingEndorsementId(null); setDeviceModelDraft(''); }} className="text-[10px] text-[#6e6e73] underline">Cancel</button></> : <><span className="min-w-0 flex-1 break-words whitespace-normal">{row.device_model || 'Device not specified'} · {row.engineer_name}</span>{canEditEndorsement && <button type="button" onClick={() => beginDeviceModelEdit(row.id, row.device_model)} className="shrink-0 text-[10px] font-medium text-[#3c3c43] underline">Edit</button>}{canEditEndorsement && !row.is_manual && row.created_at === latestCalendarTimestamp && <button type="button" onClick={() => void passEndorsement(row.id)} disabled={passingEndorsementId === row.id} className="shrink-0 text-[10px] font-medium text-[#3c3c43] underline disabled:opacity-40">{passingEndorsementId === row.id ? "Passing…" : "Pass"}</button>}</>}</div><p className="mt-2 break-words whitespace-normal text-[11px] leading-5 text-[#6e6e73]">{row.issue || 'No issue provided'}</p></div>)}</div></div></div>}{editingCell && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4" role="dialog" aria-modal="true" aria-label="Edit calendar entry"><div className="w-full max-w-sm rounded-2xl border border-[#e5e5e7] bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-3 border-b border-[#e5e5e7] pb-4"><div><p className="text-[13px] font-semibold text-[#1d1d1f]">Edit calendar entry</p><p className="mt-1 text-[11px] text-[#6e6e73]">{editingCell.division} · {editingCell.engineer} · {formatDate(`${editingCell.date}T00:00:00Z`)}</p></div><button type="button" onClick={() => setEditingCell(null)} className="rounded-full px-2 py-1 text-[11px] text-[#6e6e73] hover:bg-[#f5f5f7]">Close</button></div><label className="mt-4 block text-[11px] font-medium text-[#3c3c43]">Count<input type="number" min="1" max="999" value={editingCell.count} onChange={(event) => setEditingCell((current) => current ? { ...current, count: event.target.value } : current)} className="mt-1 h-9 w-full rounded-lg border border-[#d2d2d7] px-3 text-[12px]" autoFocus /></label><label className="mt-4 block text-[11px] font-medium text-[#3c3c43]">Details <span className="font-normal text-[#86868b]">(optional)</span><textarea rows={3} maxLength={1000} value={editingCell.details} onChange={(event) => setEditingCell((current) => current ? { ...current, details: event.target.value } : current)} placeholder="Optional device or workload details" className="mt-1 w-full resize-y rounded-lg border border-[#d2d2d7] px-3 py-2 text-[12px]" /></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditingCell(null)} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-[11px] text-[#3c3c43]">Cancel</button><button type="button" onClick={() => void saveCalendarEntry()} disabled={savingCell || !Number.isInteger(Number(editingCell.count)) || Number(editingCell.count) < 1} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">{savingCell ? 'Saving…' : 'Save'}</button></div></div></div>}
            </section>
            {showDetails && <><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                <div className="mt-4 space-y-2">
                  {dashboard.endorsements.length ? dashboard.endorsements.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5"><div className="min-w-0"><p className="truncate text-[12px] font-medium text-[#1d1d1f]">AR {row.ar_number} <span className="font-normal text-[#6e6e73]">· {row.engineer_name}</span></p><p className="mt-0.5 truncate text-[11px] text-[#6e6e73]">{row.device_model || 'Device not specified'} · {row.issue || 'No issue provided'}</p></div>{canEditEndorsement && <button type="button" onClick={() => void deleteEndorsement(row.id)} disabled={deletingEndorsementId === row.id} className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium text-[#b42318] hover:bg-[#feeceb] disabled:cursor-not-allowed disabled:opacity-40">{deletingEndorsementId === row.id ? 'Deleting…' : 'Delete'}</button>}</div>) : <p className="text-[12px] text-[#6e6e73]">No endorsements yet.</p>}
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

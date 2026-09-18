import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type EndorsementEngineer, type EngineerDashboard, type EndorsementQueues, type FrontlineReport } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePulseWebSocket } from '../hooks/useWebSocket';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const SCHEDULE_DAYS = [...DAYS, 'Sun'];
const ENDORSEMENT_TYPES = new Set(['received (appointment)', 'received (walk in)', 'job order (walk in)']);

type BoardRecord = EngineerDashboard['endorsements'][number];
type WaitingRecord = FrontlineReport['records'][number];

function manilaDate(value: string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(value));
}

function eligibleFrontlineRecord(record: WaitingRecord): boolean {
  const transaction = record.transaction_type.toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return ENDORSEMENT_TYPES.has(transaction);
}

function queueDivision(record: WaitingRecord): 'iOS/ACCS' | 'MacBook' | 'iMac' {
  const model = record.device_model.trim().toLowerCase();
  const source = record.product_division.trim().toLowerCase();
  if (/^(iphone|ipad|ipod|apple watch|airpods|beats)/.test(model) || source.includes('ios') || source.includes('accs')) return 'iOS/ACCS';
  if (model.startsWith('macbook') || source === 'portable' || source === 'macbook') return 'MacBook';
  if (model.startsWith('imac') || source === 'desktop' || source === 'imac') return 'iMac';
  return 'iOS/ACCS';
}

export default function EngineerEndorsementsBoardPage() {
  const { user } = useAuth();
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()));
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [calendar, setCalendar] = useState<Awaited<ReturnType<typeof api.endorsements.calendarFresh>> | null>(null);
  const [queues, setQueues] = useState<EndorsementQueues | null>(null);
  const [frontline, setFrontline] = useState<FrontlineReport | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<WaitingRecord | BoardRecord | null>(null);
  const [viewEngineer, setViewEngineer] = useState<string | null>(null);
  const [selectedEngineer, setSelectedEngineer] = useState('');
  const [availableDays, setAvailableDays] = useState<string[]>([...DAYS]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const canManage = Boolean(user?.isSuperAdmin) || ['Admin', 'PMG', 'CSO'].includes(user?.roleName || '');

  const refresh = useCallback(async () => {
    try {
      const [nextDashboard, nextCalendar, nextQueues, nextFrontline] = await Promise.all([
        api.endorsements.dashboardFresh(),
        api.endorsements.calendarFresh(date.slice(0, 7)),
        api.endorsements.available(),
        api.frontline.report(),
      ]);
      setDashboard(nextDashboard);
      setCalendar(nextCalendar);
      setQueues(nextQueues);
      setFrontline(nextFrontline);
      if (!selectedEngineer) setSelectedEngineer(nextQueues.roster[0]?.full_name || '');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to refresh endorsement data.');
    }
  }, [date, selectedEngineer]);

  useEffect(() => { void refresh(); }, [refresh]);
  usePulseWebSocket((event) => {
    if (event.type === 'endorsement:changed' && document.visibilityState === 'visible') void refresh();
  }, Boolean(user));
  useEffect(() => {
    const refreshOnReturn = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(refreshOnReturn, 60_000);
    document.addEventListener('visibilitychange', refreshOnReturn);
    window.addEventListener('focus', refreshOnReturn);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshOnReturn);
      window.removeEventListener('focus', refreshOnReturn);
    };
  }, [refresh]);
  useEffect(() => {
    if (!selectedEngineer) return;
    void api.endorsements.schedule(canManage ? selectedEngineer : undefined)
      .then((result) => setAvailableDays(DAYS.filter((day) => !result.restDays.includes(day))))
      .catch(() => undefined);
  }, [canManage, selectedEngineer]);

  const today = manilaDate(new Date().toISOString());
  const selectedDay = calendar?.days.find((day) => day.date === date);
  const endorsedRows = useMemo(() => date === today
    ? (dashboard?.endorsements || []).filter((row) => manilaDate(row.created_at) === date)
    : (selectedDay?.endorsements || []).map((row) => ({ ...row, cso_name: null })), [calendar, dashboard, date, selectedDay, today]);
  const waiting = useMemo(() => (frontline?.records || [])
    .filter((record) => !record.endorsement_id && record.occurred_date?.slice(0, 10) === date && eligibleFrontlineRecord(record)), [date, frontline]);
  const searchTerm = search.trim().toLowerCase();
  const matchesSearch = (record: WaitingRecord | BoardRecord) => !searchTerm || record.ar_number.toLowerCase().includes(searchTerm) || (record.serial_number || '').toLowerCase().includes(searchTerm);
  const visibleWaiting = useMemo(() => waiting.filter(matchesSearch), [waiting, searchTerm]);
  const progress = useMemo(() => endorsedRows.filter((row) => !['cancelled', 'canceled', 'completed', 'resolved'].includes(row.status.toLowerCase()) && (!viewEngineer || row.engineer_name === viewEngineer) && matchesSearch(row)), [endorsedRows, viewEngineer, searchTerm]);
  const receiptRows = useMemo(() => {
    const map = new Map<string, { engineer: EndorsementEngineer; ios: number; macbook: number; imac: number; last: string | null }>();
    for (const engineer of queues?.roster || []) map.set(engineer.full_name, { engineer, ios: 0, macbook: 0, imac: 0, last: engineer.last_assigned_at || null });
    for (const queue of queues?.queues || []) for (const engineer of queue.engineers) {
      const item = map.get(engineer.full_name);
      if (!item) continue;
      if (queue.division === 'iOS/ACCS') item.ios = engineer.assignment_count;
      if (queue.division === 'MacBook') item.macbook = engineer.assignment_count;
      if (queue.division === 'iMac') item.imac = engineer.assignment_count;
      if (engineer.last_assigned_at && (!item.last || new Date(engineer.last_assigned_at) > new Date(item.last))) item.last = engineer.last_assigned_at;
    }
    return [...map.values()];
  }, [queues]);

  async function assign(record: WaitingRecord, engineerName: string) {
    const division = queueDivision(record);
    const queue = queues?.queues.find((item) => item.division === division);
    if (!queue || !engineerName) return;
    setSaving(true); setMessage('');
    try {
      await api.endorsements.create({ arNumber: record.ar_number, frontlineRecordId: record.id, sourceSheet: record.source_sheet, sourceRow: record.source_row, serialNumber: record.serial_number, deviceModel: record.device_model, division, queueToken: queue.token, engineerName });
      setSelected(null); setMessage(`AR ${record.ar_number} assigned to ${engineerName}.`); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to assign endorsement.'); } finally { setSaving(false); }
  }

  async function saveSchedule() {
    if (!selectedEngineer) return;
    setSaving(true); setMessage('');
    try { await api.endorsements.saveSchedule(SCHEDULE_DAYS.filter((day) => !availableDays.includes(day)), canManage ? selectedEngineer : undefined); setMessage('Availability saved.'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save availability.'); }
    finally { setSaving(false); }
  }

  const renderCard = (record: WaitingRecord | BoardRecord, isNew: boolean) => {
    const assigned = 'engineer_name' in record ? record.engineer_name : '';
    const sourceDate = 'created_at' in record ? record.created_at : record.occurred_date || '';
    return <article key={record.id} className={`w-full rounded-[14px] border p-4 text-left shadow-[0_1px_3px_rgba(0,0,0,.04)] ${isNew ? 'border-[#b9cee5] bg-[#f8fbff]' : 'border-[#d9d9de] bg-white'}`}>
      <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className={`text-[11px] font-semibold normal-case tracking-normal ${isNew ? 'text-[#35658f]' : 'text-[#86868b]'}`}>{isNew ? 'New Frontline Endorsement' : 'Endorsement'}</p><h3 className="mt-1.5 text-[24px] font-semibold leading-7 tracking-[-.03em] text-[#1d1d1f]">{record.ar_number}</h3></div>{assigned && <span className="max-w-[48%] shrink-0 truncate rounded-full bg-[#f1f1f3] px-2.5 py-1.5 text-[11px] font-semibold text-[#3c3c43]">{assigned}</span>}</div>
      <div className="my-4 border-t border-[#ececf0]" /><div className="grid gap-3"><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#86868b]">Division</p><p className="mt-1 text-[16px] font-semibold leading-5 text-[#1d1d1f]">{record.product_division || 'Unspecified'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#86868b]">Serial number</p><p className="mt-1 text-[15px] font-medium leading-5 text-[#3c3c43]">{record.serial_number || 'Not specified'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#86868b]">Device model</p><p className="mt-1 text-[15px] font-medium leading-5 text-[#3c3c43]">{record.device_model || 'Not specified'}</p></div><div><p className="text-[9px] font-semibold uppercase tracking-[.12em] text-[#86868b]">Issue</p><p className="mt-1 line-clamp-3 text-[14px] leading-5 text-[#4b4b52]">{record.issue || ''}</p></div></div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-[#ececf0] pt-3"><div className="min-w-0 text-[11px] leading-5 text-[#86868b]"><p className="truncate font-medium text-[#5f5f66]">{isNew ? (('cso' in record ? record.cso || 'Unknown' : 'Unknown') + ' · ' + (record.product_division || 'Unspecified')) : 'Last endorsed Engineer: ' + (assigned || 'Unassigned')}</p><p>{new Date(sourceDate).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p></div>{isNew && <button type="button" onClick={() => setSelected(record)} className="shrink-0 rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#3c3c43]">Assign Engineer</button>}</div>
    </article>;
  };

  const selectedReceipt = receiptRows.find((item) => item.engineer.full_name === viewEngineer);
  const engineerModal = selectedReceipt && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" onClick={() => setViewEngineer(null)}><div className="w-full max-w-sm rounded-2xl border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#86868b]">Engineer Received</p><h2 className="mt-1 text-[22px] font-semibold">{selectedReceipt.engineer.full_name}</h2><p className="mt-1 text-[12px] text-[#6e6e73]">{selectedReceipt.last ? "Last received " + new Date(selectedReceipt.last).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }) : "Not yet received"}</p><div className="mt-5 space-y-2"><div className="flex items-center justify-between rounded-xl bg-white px-3 py-3 text-[13px]"><span>iOS/ACCS</span><b>{selectedReceipt.ios}</b></div><div className="flex items-center justify-between rounded-xl bg-white px-3 py-3 text-[13px]"><span>MacBook</span><b>{selectedReceipt.macbook}</b></div><div className="flex items-center justify-between rounded-xl bg-white px-3 py-3 text-[13px]"><span>iMac</span><b>{selectedReceipt.imac}</b></div></div><button type="button" onClick={() => setViewEngineer(null)} className="mt-5 w-full rounded-full border border-[#d2d2d7] bg-white py-2.5 text-[12px] font-medium">Close</button></div></div>;  return <main className="min-h-screen bg-[#f5f5f7] px-4 py-5 text-[#1d1d1f] sm:px-7"><div className="mx-auto max-w-7xl"><header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-[#86868b]">Operations</p><h1 className="mt-2 text-[30px] font-semibold tracking-[-.03em]">Engineer Endorsements</h1><p className="mt-2 text-[13px] text-[#6e6e73]">{date === today ? 'Today' : date} · queue view</p></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-3 py-2 text-[12px] text-[#6e6e73]">Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="bg-transparent text-[#1d1d1f] outline-none" /></label><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm">Settings</button><button type="button" onClick={() => void refresh()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium shadow-sm">Refresh</button></div></header>
    <section className="mt-5 rounded-2xl border border-[#d2d2d7] bg-white p-4"><div className="flex items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold">Engineer Received</h2><p className="mt-1 text-[11px] text-[#6e6e73]">iOS/ACCS today · MacBook and iMac this month</p></div><span className="text-[11px] text-[#86868b]">{receiptRows.length} Engineers</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{receiptRows.map((item) => <div key={item.engineer.id} role="button" tabIndex={0} onClick={() => setViewEngineer(item.engineer.full_name)} className="cursor-pointer rounded-xl border border-[#e5e5e7] bg-[#fafafa] px-3 py-2.5 text-left transition hover:border-[#b9b9c0] hover:bg-white"><div className="flex items-center justify-between gap-2"><span className="truncate text-[12px] font-semibold">{item.engineer.full_name}</span><span className="text-[10px] text-[#86868b]">{item.last ? `last ${new Date(item.last).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' })}` : 'not yet received'}</span></div><div className="mt-2 flex gap-3 text-[11px] tabular-nums text-[#5f5f66]"><span>iOS <b className="text-[#1d1d1f]">{item.ios}</b></span><span>Mac <b className="text-[#1d1d1f]">{item.macbook}</b></span><span>iMac <b className="text-[#1d1d1f]">{item.imac}</b></span></div></div>)}</div></section>
    {message && <p className="mt-3 rounded-xl bg-white px-3 py-2 text-[12px] text-[#3c3c43]">{message}</p>}<div className="mt-5 flex justify-end"><label className="flex w-full max-w-xs items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-3 py-2 text-[12px] text-[#86868b] shadow-sm"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search AR or serial" className="min-w-0 flex-1 bg-transparent text-[12px] text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6]" /></label></div><div className="mt-3 grid gap-4 lg:grid-cols-2"><section className="min-w-0 rounded-2xl border border-[#d2d2d7] bg-[#fbfbfc] p-4"><div className="flex items-center justify-between border-b border-[#e5e5e7] pb-4"><div><h2 className="text-[13px] font-semibold">Unendorsed</h2><p className="mt-1 text-[11px] text-[#86868b]">CSO has not clicked Endorse</p></div><span className="rounded-full bg-[#e5e5e7] px-2.5 py-1 text-[11px] font-semibold text-[#5f5f66]">{visibleWaiting.length}</span></div><div className={`mt-4 min-h-[220px] space-y-3 pr-1 ${visibleWaiting.length > 10 ? 'max-h-[calc(100vh-360px)] overflow-y-auto' : ''}`}>{visibleWaiting.map((record) => renderCard(record, true))}{visibleWaiting.length === 0 && <div className="rounded-2xl border border-dashed border-[#c9c9cf] px-4 py-12 text-center text-[12px] text-[#86868b]">{searchTerm ? 'No matching Frontline records.' : 'No new Frontline records for this date.'}</div>}</div></section><section className="min-w-0 rounded-2xl border border-[#d2d2d7] bg-[#fbfbfc] p-4"><div className="flex items-center justify-between border-b border-[#e5e5e7] pb-4"><div><h2 className="text-[13px] font-semibold">Endorsed</h2><p className="mt-1 text-[11px] text-[#86868b]">CSO clicked Endorse; Engineer assigned</p></div><span className="rounded-full bg-[#e5e5e7] px-2.5 py-1 text-[11px] font-semibold text-[#5f5f66]">{progress.length}</span></div><div className={`mt-4 min-h-[220px] space-y-3 pr-1 ${progress.length > 10 ? 'max-h-[calc(100vh-360px)] overflow-y-auto' : ''}`}>{progress.map((record) => renderCard(record, false))}{progress.length === 0 && <div className="rounded-2xl border border-dashed border-[#c9c9cf] px-4 py-12 text-center text-[12px] text-[#86868b]">{searchTerm ? 'No matching endorsements.' : 'No endorsements for this date.'}</div>}</div></section></div></div>
    {engineerModal}{selected && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" onClick={() => setSelected(null)}><div className="w-full max-w-md rounded-2xl border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#86868b]">{'engineer_name' in selected && selected.engineer_name ? 'Assigned endorsement' : 'New Frontline Endorsement'}</p><h2 className="mt-1 text-[20px] font-semibold">{selected.ar_number}</h2><p className="mt-2 text-[12px] text-[#6e6e73]">{selected.product_division || 'Division not specified'} · {selected.device_model || 'Device model not specified'} · {selected.issue || 'No issue provided.'}</p>{'engineer_name' in selected && selected.engineer_name ? <p className="mt-5 rounded-xl bg-white px-3 py-3 text-[13px] font-medium">Received by {selected.engineer_name}</p> : <label className="mt-5 block text-[12px] font-medium">Assign Engineer<select defaultValue="" onChange={(event) => void assign(selected as WaitingRecord, event.target.value)} disabled={saving} className="mt-1.5 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px]"><option value="">Choose an Engineer...</option>{(queues?.queues.find((queue) => queue.division === queueDivision(selected as WaitingRecord))?.engineers || []).map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name} · received {engineer.assignment_count}</option>)}</select></label>}<button type="button" onClick={() => setSelected(null)} className="mt-5 w-full rounded-full border border-[#d2d2d7] bg-white py-2.5 text-[12px] font-medium">Close</button></div></div>}
    {settingsOpen && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4" onClick={() => setSettingsOpen(false)}><div className="w-full max-w-lg rounded-2xl border border-[#d2d2d7] bg-[#f7f7f8] p-5 shadow-xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#86868b]">Settings</p><h2 className="mt-1 text-[18px] font-semibold">Engineer availability</h2></div><button type="button" onClick={() => setSettingsOpen(false)} className="text-[18px] text-[#6e6e73]">×</button></div><p className="mt-2 text-[12px] text-[#6e6e73]">Choose the days each Engineer can receive assignments. Sunday is always a rest day.</p><label className="mt-5 block text-[12px] font-medium">Engineer<select value={selectedEngineer} onChange={(event) => setSelectedEngineer(event.target.value)} disabled={!canManage} className="mt-1.5 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px]">{(queues?.roster || []).map((engineer) => <option key={engineer.id} value={engineer.full_name}>{engineer.full_name}</option>)}</select></label><div className="mt-4 flex flex-wrap gap-2">{DAYS.map((day) => <label key={day} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[12px] ${availableDays.includes(day) ? 'border-[#b9b9c0] bg-white' : 'border-[#e5e5e7] bg-[#f1f1f3] text-[#86868b]'}`}><input type="checkbox" checked={availableDays.includes(day)} onChange={(event) => setAvailableDays((current) => event.target.checked ? [...current, day] : current.filter((item) => item !== day))} />{day}</label>)}<span className="rounded-xl border border-[#e5e5e7] bg-[#f1f1f3] px-3 py-2.5 text-[12px] text-[#a1a1a6]">Sun · Rest</span></div><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => void refresh()} className="rounded-full border border-[#d2d2d7] bg-white px-4 py-2 text-[12px] font-medium">Refresh</button><button type="button" onClick={() => void saveSchedule()} disabled={saving || !selectedEngineer || !canManage} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-40">{saving ? 'Saving...' : 'Save schedule'}</button></div></div></div>}
  </main>;
}








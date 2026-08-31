import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, type StorageEmployee, type StorageMovement, type StorageRule, type StorageUnit } from '../lib/api';

const EMPTY_RULES: StorageRule[] = [];
const pad = (number: number) => String(number).padStart(2, '0');
const dateTime = (value: string | null | undefined) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';

function moveOptionFocus(event: React.KeyboardEvent<HTMLButtonElement>, selector: string) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const current = event.currentTarget;
  const buttons = Array.from(current.parentElement?.querySelectorAll<HTMLButtonElement>(selector) ?? []);
  const currentRect = current.getBoundingClientRect();
  const direction = event.key === 'ArrowLeft' ? 'left' : event.key === 'ArrowRight' ? 'right' : event.key === 'ArrowUp' ? 'up' : 'down';
  const candidates = buttons.filter((button) => {
    if (button === current || button.disabled) return false;
    const rect = button.getBoundingClientRect();
    if (direction === 'left') return rect.right <= currentRect.left + 1;
    if (direction === 'right') return rect.left >= currentRect.right - 1;
    if (direction === 'up') return rect.bottom <= currentRect.top + 1;
    return rect.top >= currentRect.bottom - 1;
  });
  const target = candidates.sort((a, b) => {
    const aRect = a.getBoundingClientRect();
    const bRect = b.getBoundingClientRect();
    const aDistance = Math.hypot(aRect.left - currentRect.left, aRect.top - currentRect.top);
    const bDistance = Math.hypot(bRect.left - currentRect.left, bRect.top - currentRect.top);
    return aDistance - bDistance;
  })[0];
  if (target) {
    event.preventDefault();
    target.focus();
  }
}

export default function StorageLocatorPage() {
  const location = useLocation();
  const routedEmployee = (location.state as { employee?: StorageEmployee } | null)?.employee ?? null;
  const [employeeNumber, setEmployeeNumber] = useState(routedEmployee?.employeeNumber ?? '');
  const [employee, setEmployee] = useState<StorageEmployee | null>(routedEmployee);
  const [arNumber, setArNumber] = useState('');
  const [unit, setUnit] = useState<StorageUnit | null>(null);
  const [history, setHistory] = useState<StorageMovement[]>([]);
  const [rules, setRules] = useState<StorageRule[]>(EMPTY_RULES);
  const [occupied, setOccupied] = useState<StorageUnit[]>([]);
  const [action, setAction] = useState<'IN' | 'OUT' | null>(null);
  const [family, setFamily] = useState<'IOS' | 'Mac'>('IOS');
  const [status, setStatus] = useState('');
  const [cabinet, setCabinet] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadOverview = async () => {
    const result = await api.storageLocator.overview();
    setRules(result.rules); setOccupied(result.occupied);
  };
  useEffect(() => { if (!employee) return; void loadOverview().catch((err) => setError((err as Error).message)); }, [employee]);

  const verifyEmployee = async () => {
    if (!employeeNumber.trim()) return;
    setBusy(true); setError('');
    try { const result = await api.storageLocator.verifyEmployee(employeeNumber); setEmployee(result.employee); setMessage('Employee verified. Enter an AR number to continue.'); }
    catch (err) { setEmployee(null); setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const lookup = async () => {
    if (!employee || !arNumber.trim()) return;
    setBusy(true); setError(''); setMessage(''); setAction(null); setCabinet(null);
    try { const result = await api.storageLocator.lookup(arNumber.trim()); setUnit(result.unit); setHistory(result.history); setAction(result.unit?.state === 'in' ? 'OUT' : 'IN'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const matchingRules = useMemo(() => rules.filter((rule) => rule.family === family), [rules, family]);
  const selectedRule = matchingRules.find((rule) => rule.status === status);
  const occupiedNumbers = useMemo(() => new Set(occupied.filter((item) => item.family === family && item.state === 'in').map((item) => item.cabinet_number)), [occupied, family]);
  const submitIn = async () => {
    if (!employee || !arNumber.trim() || !selectedRule || cabinet === null) return;
    setBusy(true); setError('');
    try { const result = await api.storageLocator.checkIn({ employeeNumber: employee.employeeNumber, arNumber: arNumber.trim(), family, status, cabinetNumber: cabinet }); setMessage(result.message); await Promise.all([lookup(), loadOverview()]); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const submitOut = async () => {
    if (!employee || !arNumber.trim()) return;
    setBusy(true); setError('');
    try { const result = await api.storageLocator.checkOut({ employeeNumber: employee.employeeNumber, arNumber: arNumber.trim() }); setMessage(result.message); await Promise.all([lookup(), loadOverview()]); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
    <div className="mx-auto max-w-6xl">
      <div className="mb-7"><p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6e6e73]">Operations</p><h1 className="mt-2 text-[32px] font-semibold tracking-tight text-[#1d1d1f]">Storage Locator</h1><p className="mt-1 text-[14px] text-[#6e6e73]">Find a customer unit, see its history, and place it in the right cabinet.</p></div>
      {(message || error) && <div className={`mb-4 rounded-xl border px-4 py-3 text-[13px] ${error ? 'border-[#f1caca] bg-[#fffafa] text-[#9b1c1c]' : 'border-[#d8e8dc] bg-[#fbfefc] text-[#27633a]'}`}>{error || message}</div>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
          <div className="flex items-start justify-between gap-4"><div><h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Unit lookup</h2><p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">Look up the AR number to view its location and history.</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${employee ? 'bg-[#ecfdf3] text-[#166534]' : 'bg-[#f5f5f7] text-[#6e6e73]'}`}>{employee ? 'Verified' : 'Not verified'}</span></div>
          {employee && <div className="mt-5 rounded-xl bg-[#f7f7f8] px-3.5 py-3"><p className="text-[11px] text-[#6e6e73]">Operating as</p><p className="mt-0.5 text-[15px] font-semibold text-[#1d1d1f]">{employee.fullName}</p><p className="mt-0.5 text-[11px] text-[#6e6e73]">Employee {employee.employeeNumber}</p></div>}
          <div className="mt-5 border-t border-[#e5e5e7] pt-5"><label className="text-[11px] font-medium text-[#3c3c43]">AR number<input value={arNumber} onChange={(e) => setArNumber(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(); } }} disabled={!employee} placeholder={employee ? 'Enter AR number to see history' : 'Verify employee first'} className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] px-3 text-[14px] outline-none focus:border-[#8e8e93] disabled:bg-[#f5f5f7]" /></label><button type="button" onClick={() => void lookup()} disabled={busy || !employee || !arNumber.trim()} className="mt-3 w-full rounded-xl border border-[#1d1d1f] py-2.5 text-[12px] font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-40">{busy ? 'Looking up…' : 'Show unit history'}</button></div>
          {unit && <div className="mt-6 rounded-xl border border-[#e5e5e7] bg-white p-4"><div className="flex items-start justify-between gap-4"><div><p className="text-[11px] font-medium text-[#6e6e73]">Current location</p><p className="mt-1 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{unit.state === 'in' ? `${unit.family} ${pad(unit.cabinet_number)}` : 'Outside storage'}</p><p className="mt-1 text-[12px] text-[#6e6e73]">{unit.status} <span className="px-1">·</span> AR {unit.ar_number}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${unit.state === 'in' ? 'bg-[#ecfdf3] text-[#166534]' : 'bg-[#f5f5f7] text-[#6e6e73]'}`}>{unit.state === 'in' ? 'IN STORAGE' : 'OUT'}</span></div></div>}
          {employee && unit && <div className="mt-6 border-t border-[#e5e5e7] pt-5"><p className="text-[11px] font-medium text-[#6e6e73]">Next action</p><p className="mt-1 text-[13px] text-[#3c3c43]">{unit.state === 'in' ? 'Remove this unit from its cabinet.' : 'Place this unit in a cabinet.'}</p></div>}
          {action === 'IN' && employee && <div className="mt-5 rounded-xl bg-[#fafafa] p-4"><h3 className="text-[13px] font-semibold text-[#1d1d1f]">Choose a cabinet</h3><div className="mt-3 flex gap-2"><button type="button" data-storage-family onKeyDown={(event) => moveOptionFocus(event, '[data-storage-family]')} onClick={() => { setFamily('IOS'); setStatus(''); setCabinet(null); }} className={`rounded-full px-4 py-2 text-[11px] font-semibold ${family === 'IOS' ? 'bg-[#1d1d1f] text-white' : 'border border-[#d2d2d7] text-[#3c3c43]'}`}>IOS</button><button type="button" data-storage-family onKeyDown={(event) => moveOptionFocus(event, '[data-storage-family]')} onClick={() => { setFamily('Mac'); setStatus(''); setCabinet(null); }} className={`rounded-full px-4 py-2 text-[11px] font-semibold ${family === 'Mac' ? 'bg-[#1d1d1f] text-white' : 'border border-[#d2d2d7] text-[#3c3c43]'}`}>Mac</button></div><div className="mt-4 flex flex-wrap gap-2">{matchingRules.map((rule) => <button key={rule.status} type="button" data-storage-status onKeyDown={(event) => moveOptionFocus(event, '[data-storage-status]')} onClick={() => { setStatus(rule.status); setCabinet(null); }} className={`rounded-lg border px-3 py-2 text-[11px] ${status === rule.status ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white' : 'border-[#d2d2d7] bg-white text-[#3c3c43]'}`}>{rule.status}</button>)}</div>{selectedRule && <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">{selectedRule.numbers.map((number) => { const isOccupied = occupiedNumbers.has(number); return <button key={number} data-storage-cabinet type="button" disabled={isOccupied} onKeyDown={(event) => moveOptionFocus(event, '[data-storage-cabinet]')} onClick={() => setCabinet(number)} className={`aspect-square rounded-xl border text-[13px] font-semibold transition-colors ${cabinet === number ? 'border-[#1d1d1f] bg-[#1d1d1f] text-white' : isOccupied ? 'border-[#ececef] bg-[#f0f0f2] text-[#b0b0b5] line-through' : 'border-[#d2d2d7] bg-white text-[#1d1d1f] hover:border-[#1d1d1f]'}`} title={isOccupied ? 'Occupied' : `${family} ${pad(number)}`}>{family} {pad(number)}</button>; })}</div>}{cabinet !== null && <button type="button" onClick={() => void submitIn()} disabled={busy} className="mt-4 w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : `Check IN to ${family} ${pad(cabinet)}`}</button>}</div>}
          {action === 'OUT' && employee && <button type="button" onClick={() => void submitOut()} disabled={busy || unit?.state !== 'in'} className="mt-5 w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Saving…' : unit?.state === 'in' ? `Check OUT from ${unit.family} ${pad(unit.cabinet_number)}` : 'Unit is already OUT'}</button>}
        </section>
        <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5"><div className="flex items-center justify-between"><div><h2 className="text-[15px] font-semibold text-[#1d1d1f]">Unit history</h2><p className="mt-1 text-[12px] text-[#6e6e73]">{history.length ? `${history.length} recorded operation${history.length === 1 ? '' : 's'}` : 'Enter an AR number to view history.'}</p></div><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f5f5f7] text-[#6e6e73]">↕</div></div><div className="mt-5 space-y-4">{history.length ? history.map((entry, index) => <div key={entry.id} className="relative flex gap-3"><div className="flex w-5 flex-col items-center"><span className={`mt-1 h-2.5 w-2.5 rounded-full ${entry.action === 'IN' ? 'bg-[#34a853]' : 'bg-[#9ca3af]'}`} />{index < history.length - 1 && <span className="mt-1 h-full w-px bg-[#e5e5e7]" />}</div><div className="min-w-0 flex-1 pb-1"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-semibold text-[#1d1d1f]">{entry.action} · {entry.family} {entry.cabinet_number ? pad(entry.cabinet_number) : '—'}</span><span className="whitespace-nowrap text-[10px] text-[#86868b]">{dateTime(entry.occurred_at)}</span></div><p className="mt-1 text-[11px] text-[#6e6e73]">{entry.status} · {entry.full_name} ({entry.employee_number})</p></div></div>) : <div className="rounded-xl border border-dashed border-[#d2d2d7] p-6 text-center text-[12px] text-[#6e6e73]">No history loaded yet.</div>}</div></section>
      </div>
    </div>
    {!employee && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="storage-employee-title"><form onSubmit={(event) => { event.preventDefault(); void verifyEmployee(); }} className="w-full max-w-sm rounded-2xl border border-[#e5e5e7] bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Storage Locator</p><h2 id="storage-employee-title" className="mt-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">Who is operating?</h2><p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">Enter your employee number before looking up or moving a unit.</p><label className="mt-5 block text-[11px] font-medium text-[#3c3c43]">Employee number<input autoFocus value={employeeNumber} onChange={(event) => { setEmployeeNumber(event.target.value); setError(''); }} placeholder="e.g. EMP-001" className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] px-3 text-[14px] outline-none focus:border-[#1d1d1f]" /></label>{error && <p role="alert" className="mt-3 text-[12px] text-[#a33a3a]">{error}</p>}<button type="submit" disabled={busy || !employeeNumber.trim()} className="mt-5 w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">{busy ? 'Verifying…' : 'Continue'}</button></form></div>}
  </div>;
}

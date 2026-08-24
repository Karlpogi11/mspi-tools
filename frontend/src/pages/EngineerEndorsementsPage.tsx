import { useEffect, useState } from 'react';
import { api, type EndorsementEngineer, type EngineerDashboard } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function EngineerEndorsementsPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<EngineerDashboard | null>(null);
  const [roster, setRoster] = useState<EndorsementEngineer[] | null>(null);
  const [nextEngineer, setNextEngineer] = useState<EndorsementEngineer | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [newEngineerName, setNewEngineerName] = useState('');
  const [message, setMessage] = useState('');

  const isEngineer = user?.roleName === 'ENGR';
  const canManageRoster = user?.roleName === 'Admin' || user?.roleName === 'PMG';

  const load = async () => {
    setLoading(true);
    try {
      setDashboard(await api.endorsements.dashboard());
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

  useEffect(() => { void load(); }, []);
  useEffect(() => { void loadRoster(); }, [canManageRoster]);

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
    setRosterBusy(true);
    setMessage('');
    try {
      await api.endorsements.removeEngineer(id);
      await loadRoster();
      setMessage('Engineer removed from today\'s roster.');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRosterBusy(false);
    }
  };

  const markPresent = async (name: string) => {
    setRosterBusy(true);
    setMessage('');
    try {
      await api.endorsements.addEngineer(name);
      await loadRoster();
      setMessage(`${name} is present and eligible for endorsements.`);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setRosterBusy(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-7">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Engineer Endorsements</h1>
          <p className="mt-1.5 text-[14px] text-[#3c3c43]">Daily availability and customer device endorsements.</p>
        </div>

        {message && (
          <div className="mb-4 flex items-center justify-between border border-[#d2d2d7] bg-white px-4 py-3 text-[13px] text-[#3c3c43]">
            <span>{message}</span>
            <button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="cursor-pointer text-[18px]">×</button>
          </div>
        )}

        {isEngineer && (
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
                {active && <button type="button" onClick={() => void skipTurn()} disabled={busy} className="rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-semibold text-[#3c3c43] disabled:opacity-40">Skip next turn</button>}
              </div>
            </div>
            <p className={`mt-3 text-[12px] ${active ? 'text-[#3c3c43]' : 'text-[#6e6e73]'}`}>
              {active ? 'You are available for new endorsements.' : 'You are not currently available for new endorsements.'}
            </p>
          </section>
        )}

        <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-5">
          <p className="text-[11px] uppercase tracking-wider text-[#6e6e73]">Next endorsement</p>
          {nextEngineer ? <><p className="mt-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{nextEngineer.full_name}</p><p className="mt-1 text-[12px] text-[#6e6e73]">Round-robin position · {nextEngineer.assignment_count} assigned today</p></> : <p className="mt-2 text-[13px] text-[#6e6e73]">No Engineer is currently available. Engineers can join today&apos;s queue above.</p>}
        </section>

        {(
          <section className="mb-5 rounded-2xl border border-[#e5e5e7] bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-[13px] font-semibold text-[#1d1d1f]">Today&apos;s Engineer availability</h2>
                <p className="mt-1 text-[12px] text-[#6e6e73]">Green Engineers are present and eligible for the next round-robin endorsement.</p>
              </div>
              {canManageRoster && <form className="flex w-full max-w-md gap-2 sm:w-auto" onSubmit={(event) => { event.preventDefault(); void addEngineer(); }}>
                <input value={newEngineerName} onChange={(event) => setNewEngineerName(event.target.value)} placeholder="Engineer name" aria-label="Engineer name" className="h-9 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] px-3 text-[12px]" />
                <button type="submit" disabled={rosterBusy || !newEngineerName.trim()} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">
                  {rosterBusy ? 'Adding…' : 'Add Engineer'}
                </button>
              </form>}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {roster === null ? <p className="text-[12px] text-[#6e6e73]">Loading roster…</p> : roster.length ? roster.map((engineer) => (
                <div key={engineer.id} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${engineer.status === 'active' ? 'border-[#b7e4c7] bg-[#ecfdf3] text-[#166534]' : 'border-[#e5e5e7] bg-[#f5f5f7] text-[#86868b] opacity-70'}`}>
                  <span>{engineer.full_name}</span>
                  <span className="text-[11px] text-[#6e6e73]">{engineer.assignment_count} assigned</span>
                  {canManageRoster && engineer.status !== 'active' && <button type="button" onClick={() => void markPresent(engineer.full_name)} disabled={rosterBusy} aria-label={`Mark ${engineer.full_name} present`} className="ml-1 cursor-pointer text-[#166534] underline disabled:opacity-40">Mark present</button>}
                  {canManageRoster && engineer.status === 'active' && <button type="button" onClick={() => void removeEngineer(engineer.id)} disabled={rosterBusy} aria-label={`Mark ${engineer.full_name} away`} className="ml-1 cursor-pointer text-[#6e6e73] hover:text-[#b91c1c] disabled:opacity-40">Mark away</button>}
                </div>
              )) : <p className="text-[12px] text-[#6e6e73]">No Engineers added for today yet.</p>}
            </div>
          </section>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[#e5e5e7] bg-white p-8 text-center text-[13px] text-[#6e6e73]">Loading endorsements…</div>
        ) : dashboard && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Metric label="Total endorsements" value={Number(dashboard.totals.total || 0).toLocaleString()} />
              <Metric label="Pending work" value={Number(dashboard.totals.pending || 0).toLocaleString()} />
              <Metric label="Today's assignment count" value={Number(dashboard.availability?.assignment_count || 0).toLocaleString()} />
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
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
              <section className="overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white">
                <div className="border-b border-[#e5e5e7] px-5 py-4"><h2 className="text-[13px] font-semibold text-[#1d1d1f]">{isEngineer ? 'My endorsements' : 'All endorsements'}</h2></div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-[12px]">
                    <thead className="bg-[#fafafa] text-[10px] uppercase tracking-wider text-[#6e6e73]"><tr><th className="px-5 py-2">AR number</th><th className="px-5 py-2">Device/model</th><th className="px-5 py-2">Issue</th><th className="px-5 py-2">Division</th><th className="px-5 py-2">Engineer</th><th className="px-5 py-2">Status</th></tr></thead>
                    <tbody>{dashboard.endorsements.map((row) => <tr key={row.id} className="border-t border-[#f0f0f2]"><td className="px-5 py-2.5 font-medium text-[#3c3c43]">{row.ar_number}</td><td className="px-5 py-2.5 text-[#3c3c43]">{row.device_model || '—'}</td><td className="max-w-[24rem] truncate px-5 py-2.5 text-[#3c3c43]">{row.issue || '—'}</td><td className="px-5 py-2.5 text-[#3c3c43]">{row.product_division || '—'}</td><td className="px-5 py-2.5 text-[#3c3c43]">{row.engineer_name}</td><td className="px-5 py-2.5 text-[#3c3c43]">{row.status}</td></tr>)}</tbody>
                  </table>
                </div>
                {!dashboard.endorsements.length && <p className="px-5 py-8 text-center text-[12px] text-[#6e6e73]">No endorsements yet.</p>}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-[#e5e5e7] bg-white p-4"><p className="text-[11px] uppercase tracking-wider text-[#6e6e73]">{label}</p><p className="mt-2 text-[24px] font-semibold tracking-tight text-[#1d1d1f]">{value}</p></div>;
}

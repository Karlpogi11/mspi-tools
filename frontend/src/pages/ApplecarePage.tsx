import { useEffect, useMemo, useState } from 'react';
import { api, type ApplecarePackingList, type ApplecarePackingListDetail, type ApplecareSite } from '../lib/api';
import { useAuth } from '../lib/auth';
import ToolHelp from '../components/ToolHelp';

const button = 'inline-flex items-center justify-center rounded-full border border-[#d2d2d7] bg-white px-3.5 py-2 text-[12px] font-medium text-[#3c3c43] transition hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-45';
const disconnectButton = 'inline-flex items-center justify-center rounded-full border border-[#f1b8bd] bg-white px-3.5 py-2 text-[12px] font-medium text-[#c5221f] transition hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:opacity-45';
const primary = 'inline-flex items-center justify-center rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-black disabled:opacity-45';

export default function ApplecarePage() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [gmail, setGmail] = useState<string | null>(null);
  const [lists, setLists] = useState<ApplecarePackingList[]>([]);
  const [sites, setSites] = useState<ApplecareSite[]>([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [selected, setSelected] = useState<ApplecarePackingListDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [newShipTo, setNewShipTo] = useState('');
  const [newSite, setNewSite] = useState('');

  const refresh = async () => {
    const [status, rows, siteRows] = await Promise.all([api.applecare.status(), api.applecare.lists(), api.applecare.sites()]);
    setConnected(status.connected); setGmail(status.email); setLists(rows); setSites(siteRows);
  };
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, []);

  const filtered = useMemo(() => lists.filter((row) => {
    const haystack = `${row.subject} ${row.ship_to} ${row.site_name || ''} ${row.attachment_name}`.toLowerCase();
    return (!selectedSite || row.site_id === Number(selectedSite)) && haystack.includes(query.toLowerCase());
  }), [lists, query, selectedSite]);

  const sync = async () => {
    setBusy(true); setMessage('Checking Gmail…');
    try { const result = await api.applecare.sync(); await refresh(); setMessage(`${result.imported} new packing list${result.imported === 1 ? '' : 's'} imported`); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  const addSite = async () => {
    if (!newShipTo || !newSite) return;
    try { await api.applecare.createSite(newShipTo, newSite); setNewShipTo(''); setNewSite(''); await refresh(); }
    catch (error) { setMessage((error as Error).message); }
  };

  const disconnect = async () => {
    setBusy(true);
    try { await api.applecare.disconnect(); setConnected(false); setGmail(null); setMessage('Gmail disconnected'); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <header className="mb-7 flex items-start justify-between gap-4">
        <div><h1 className="text-[30px] font-semibold leading-tight tracking-[-.035em] text-[#1d1d1f]">AppleCare Packing Lists</h1><p className="mt-1.5 text-[14px] text-[#6e6e73]">Incoming parts from your connected Gmail.</p></div>
        <ToolHelp toolName="AppleCare Packing Lists" purpose="Collect AppleCare packing-list emails and attachments into one searchable page." steps={["Connect your company Gmail account.", "Sync matching emails or wait for automatic polling.", "Review packing lists, sites, and incoming parts."]} note="Only read-only Gmail access is requested. Your website role controls what you can view." />
      </header>

      <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-[#d2d2d7] pb-5">
        <div><p className={`text-[13px] font-medium ${connected ? 'text-[#248a3d]' : 'text-[#1d1d1f]'}`}>{connected ? `● Connected · ${gmail}` : 'Gmail not connected'}</p><p className="mt-1 text-[12px] text-[#6e6e73]">Read-only access · checks every five minutes</p></div>
        <div className="flex gap-2">{connected ? <><button className={disconnectButton} onClick={disconnect} disabled={busy}>Disconnect</button><button className={button} onClick={sync} disabled={busy}>{busy ? 'Syncing…' : 'Sync now'}</button></> : <button className={primary} onClick={() => { window.location.href = api.applecare.connectUrl(); }}>Connect Gmail</button>}</div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3"><input className="h-9 min-w-[240px] flex-1 rounded-lg border-0 bg-white px-3.5 text-[12px] shadow-[0_1px_3px_#00000012] outline-none ring-1 ring-[#e5e5ea] focus:ring-2 focus:ring-[#0071e34d]" placeholder="Search packing lists" value={query} onChange={(e) => setQuery(e.target.value)} /><select className="h-9 rounded-lg border-0 bg-white px-3 text-[12px] shadow-[0_1px_3px_#00000012] outline-none ring-1 ring-[#e5e5ea] focus:ring-2 focus:ring-[#0071e34d]" value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}><option value="">All sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.site_name}</option>)}</select></div>

      {message && <p className="mb-3 text-[12px] text-[#6e6e73]">{message}</p>}
      <div className="overflow-hidden rounded-xl bg-white shadow-[0_1px_3px_#00000012]">
        <div className="grid grid-cols-[1.1fr_1fr_1fr_.8fr_1fr] gap-3 bg-[#fafafd] px-4 py-3 text-[10px] font-semibold uppercase tracking-[.08em] text-[#86868b]"><span>Date</span><span>Site</span><span>ShipTo</span><span>Status</span><span>Attachment</span></div>
        {filtered.length === 0 ? <div className="p-12 text-center text-[13px] text-[#6e6e73]">{connected ? 'No AppleCare packing lists found yet.' : 'Connect Gmail to begin.'}</div> : filtered.map((row) => <button key={row.id} className="grid w-full grid-cols-[1.1fr_1fr_1fr_.8fr_1fr] gap-3 border-t border-[#f0f0f2] px-4 py-3.5 text-left text-[12px] text-[#3c3c43] transition hover:bg-[#fafafd]" onClick={async () => setSelected(await api.applecare.detail(row.id))}><span>{row.packing_date || row.received_at?.slice(0, 10) || '—'}<small className="block text-[11px] text-[#86868b]">{row.packing_time}</small></span><span>{row.site_name || <span className="text-[#b0b0b5]">Unmapped</span>}</span><span className="font-medium">{row.ship_to}</span><span>{row.status}</span><span className="truncate text-[#6e6e73]">{row.attachment_name || 'No attachment'}</span></button>)}
      </div>

      {selected && <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/25 p-5" onClick={() => setSelected(null)}><div className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between"><div><h2 className="text-[19px] font-semibold tracking-[-.02em] text-[#1d1d1f]">Packing list {selected.ship_to}</h2><p className="mt-1 text-[12px] text-[#6e6e73]">{selected.subject}</p></div><button className={button} onClick={() => setSelected(null)}>Close</button></div><div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-[12px] sm:grid-cols-4"><div><b className="text-[#86868b]">Site</b><p className="mt-1">{selected.site_id ? sites.find((s) => s.id === selected.site_id)?.site_name : 'Unmapped'}</p></div><div><b className="text-[#86868b]">Date</b><p className="mt-1">{selected.packing_date || '—'}</p></div><div><b className="text-[#86868b]">Time</b><p className="mt-1">{selected.packing_time || '—'}</p></div><div><b className="text-[#86868b]">Attachment</b><p className="mt-1 truncate">{selected.attachment_name || '—'}</p></div></div>{selected.attachment_name && <a className="mt-5 inline-block text-[12px] font-semibold text-[#0071e3]" href={api.applecare.attachmentUrl(selected.id)}>Download attachment</a>}<table className="mt-6 w-full text-left text-[12px]"><thead><tr className="border-b text-[#86868b]"><th className="py-2">Part number</th><th>Description</th><th>Serial number</th><th>Qty</th></tr></thead><tbody>{selected.items.map((item) => <tr key={item.id} className="border-b border-[#f0f0f2]"><td className="py-2">{item.part_number}</td><td>{item.description}</td><td>{item.serial_number || '—'}</td><td>{item.quantity}</td></tr>)}</tbody></table></div></div>}

      {user?.roleName === 'Admin' && <div className="mt-8 border-t border-[#d2d2d7] pt-5"><h2 className="text-[14px] font-semibold">Site mapping</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Map ShipTo numbers to site names.</p><div className="mt-3 flex flex-wrap gap-2"><input className="h-9 rounded-lg border-0 bg-white px-3 text-[12px] shadow-sm ring-1 ring-[#e5e5ea] outline-none focus:ring-2 focus:ring-[#0071e34d]" placeholder="ShipTo number" value={newShipTo} onChange={(e) => setNewShipTo(e.target.value)} /><input className="h-9 rounded-lg border-0 bg-white px-3 text-[12px] shadow-sm ring-1 ring-[#e5e5ea] outline-none focus:ring-2 focus:ring-[#0071e34d]" placeholder="Site name" value={newSite} onChange={(e) => setNewSite(e.target.value)} /><button className={primary} onClick={addSite}>Add site</button></div></div>}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PartsMasterItem, type PartsSite, type PartsUnit } from '../../lib/api';
import { parsePartsMasterWorkbook, todayIso } from '../../lib/parts';

type PartsTab = 'stock' | 'sites' | 'master' | 'sheet';

export default function AdminPartsPage() {
  const [sites, setSites] = useState<PartsSite[]>([]);
  const [siteCode, setSiteCode] = useState('ALL');
  const [siteForm, setSiteForm] = useState({ code: '', name: '' });
  const [master, setMaster] = useState<PartsMasterItem[]>([]);
  const [masterQuery, setMasterQuery] = useState('');
  const [editing, setEditing] = useState<PartsMasterItem | null>(null);
  const [stock, setStock] = useState<PartsUnit[]>([]);
  const [stockQuery, setStockQuery] = useState('');
  const [sheet, setSheet] = useState({ connected: false, email: '', spreadsheetId: '', spreadsheetName: '', sheetName: '', pendingSync: 0 });
  const [sheetIdInput, setSheetIdInput] = useState('');
  const [sheetOptions, setSheetOptions] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<PartsTab>('stock');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const masterFileRef = useRef<HTMLInputElement>(null);
  const notice = error || message;
  const noticeTone = error ? 'error' : messageTone(message);

  const refreshSites = async () => setSites((await api.admin.getPartsSites()).sites);
  const refreshMaster = async (q?: string) => setMaster((await api.admin.getPartsMaster(q)).items);
  const refreshSheet = async () => {
    const status = await api.parts.sheetStatus();
    setSheet({ connected: status.connected, email: status.email || '', spreadsheetId: status.spreadsheetId, spreadsheetName: status.spreadsheetName, sheetName: status.sheetName, pendingSync: status.pendingSync });
    if (!sheetIdInput && status.spreadsheetId) setSheetIdInput(status.spreadsheetId);
  };
  const refreshStock = async () => setStock((await api.parts.stock(siteCode, stockQuery.trim() || undefined)).stock);

  useEffect(() => {
    void (async () => {
      setBusy(true);
      try {
        await Promise.all([refreshSites(), refreshMaster(), refreshSheet()]);
        setStock((await api.parts.stock('ALL')).stock);
        const params = new URLSearchParams(window.location.search);
        if (params.get('sheetConnected')) setMessage('Google Sheet connected.');
        if (params.get('sheetError')) setError('Google Sheet connection failed. Try again.');
        window.history.replaceState(null, '', window.location.pathname);
      } catch (err) { setError((err as Error).message); }
      finally { setBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void refreshStock().catch((err) => setError((err as Error).message)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteCode]);
  useEffect(() => {
    const t = setTimeout(() => void refreshMaster(masterQuery.trim() || undefined).catch(() => undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterQuery]);
  useEffect(() => {
    const t = setTimeout(() => void refreshStock().catch(() => undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockQuery]);

  const saveSite = async () => {
    if (!siteForm.code.trim() || !siteForm.name.trim()) return;
    setBusy(true); setError('');
    try { await api.admin.addPartsSite(siteForm.code.trim(), siteForm.name.trim()); setSiteForm({ code: '', name: '' }); await refreshSites(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const removeSite = async (site: PartsSite) => {
    if (!window.confirm(`Remove site ${site.code}? Its stock records will be removed too.`)) return;
    try { await api.admin.deletePartsSite(site.id); await refreshSites(); }
    catch (err) { setError((err as Error).message); }
  };

  const savePart = async () => {
    if (!editing?.part_number.trim() || !editing?.description.trim()) return;
    setBusy(true); setError('');
    try {
      if (editing.id < 0) await api.admin.addPartsMaster({ part_number: editing.part_number.trim(), description: editing.description.trim(), eee_code: editing.eee_code, substitute_part: editing.substitute_part, serialized: editing.serialized });
      else await api.admin.updatePartsMaster(editing.id, { part_number: editing.part_number.trim(), description: editing.description.trim(), eee_code: editing.eee_code, substitute_part: editing.substitute_part, serialized: editing.serialized });
      setEditing(null); await refreshMaster(masterQuery.trim() || undefined);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const importMasterFile = async (file: File) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const items = await parsePartsMasterWorkbook(await file.arrayBuffer());
      const result = await api.admin.importPartsMaster(items);
      setMessage(`Master import: ${result.added} added, ${result.updated} updated.`);
      await refreshMaster();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const loadSheetOptions = async () => {
    if (!sheetIdInput.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api.parts.sheetList(sheetIdInput.trim());
      setSheetOptions(result.sheets);
      if (result.sheets.length && !result.sheets.includes(sheet.sheetName)) {
        await api.parts.saveSheetConfig(sheetIdInput.trim(), result.title, result.sheets[0]);
        await refreshSheet();
        setMessage('Sheet log destination saved.');
      }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const saveSheet = async (name: string) => {
    setBusy(true); setError('');
    try { await api.parts.saveSheetConfig(sheetIdInput.trim(), sheet.spreadsheetName, name); await refreshSheet(); setMessage('Sheet log destination saved.'); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const tabs: Array<{ key: PartsTab; label: string }> = [
    { key: 'stock', label: 'Stock' },
    { key: 'sites', label: 'Sites' },
    { key: 'master', label: 'Parts master' },
    { key: 'sheet', label: 'Sheet log' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin" className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">← Back to Manage</Link>
        <h1 className="text-[26px] font-semibold tracking-tight text-[#1d1d1f]">Parts Inventory</h1>
        <p className="mt-1 text-[14px] text-[#6e6e73]">Sites, parts master, all-site stock, and the shared Google Sheet log.</p>
      </div>

      {notice && <div role={error ? 'alert' : 'status'} className={`flex items-center justify-between gap-3 border px-4 py-3 text-[13px] ${noticeTone === 'error' ? 'border-[#fecaca] bg-[#fff7f7] text-[#b91c1c]' : noticeTone === 'success' ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'}`}><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => { setMessage(''); setError(''); }} className="cursor-pointer rounded-md px-1.5 text-[18px] leading-none opacity-60 hover:opacity-100">×</button></div>}

      <div className="border-b border-[#e5e5e7]">
        <div className="flex gap-5" role="tablist" aria-label="Parts Inventory administration">
          {tabs.map((tab) => (
            <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 px-1 pb-3 text-[13px] font-medium transition-colors ${activeTab === tab.key ? 'border-[#1d1d1f] text-[#1d1d1f]' : 'border-transparent text-[#6e6e73] hover:text-[#1d1d1f]'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'stock' && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">All-site stock · {stock.length}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <select value={siteCode} onChange={(e) => setSiteCode(e.target.value)} className="h-9 rounded-full border border-[#d2d2d7] bg-[#f5f5f7] px-3 text-[13px] outline-none focus:border-[#1d1d1f]">
            <option value="ALL">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.code}>{s.code}</option>)}
          </select>
          <input value={stockQuery} onChange={(e) => setStockQuery(e.target.value)} placeholder="Search part or serial"
            className="h-9 min-w-[200px] flex-1 rounded-full border border-[#d2d2d7] bg-[#f5f5f7] px-4 text-[13px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f]" />
          <span className="self-center text-[11px] text-[#86868b]">Exported {todayIso()}</span>
        </div>
        <div className="mt-3 max-h-[320px] divide-y overflow-y-auto">
          {stock.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[#1d1d1f]">{u.serial || `${u.quantity} × ${u.part_number}`}</p>
                <p className="truncate text-[11px] text-[#6e6e73]">{u.site_code} · {u.part_number}{u.description ? ` · ${u.description}` : ''}{u.reference ? ` · ref ${u.reference}` : ''}</p>
              </div>
            </div>
          ))}
          {!stock.length && <p className="py-4 text-[12px] text-[#6e6e73]">No stock in view.</p>}
        </div>
      </section>}

      {activeTab === 'sites' && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Sites · {sites.length}</h2>
        <p className="mt-1 text-[12px] text-[#6e6e73]">Podiums type one of these codes to enter the tool, locked to that site.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={siteForm.code} onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value.toUpperCase() })} placeholder="Code (e.g. PODIUM)"
            className="h-10 w-40 rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[13px] uppercase outline-none focus:border-[#1d1d1f]" />
          <input value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="Site name"
            className="h-10 min-w-[200px] flex-1 rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
          <button type="button" onClick={() => void saveSite()} disabled={busy} className="rounded-xl bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Add site</button>
        </div>
        <div className="mt-3 divide-y">
          {sites.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 py-2">
              <p className="text-[13px] text-[#1d1d1f]"><span className="font-semibold">{s.code}</span> <span className="text-[#6e6e73]">· {s.name}</span></p>
              <button type="button" onClick={() => void removeSite(s)} className="text-[12px] text-[#a33a3a]">Remove</button>
            </div>
          ))}
        </div>
      </section>}

      {activeTab === 'master' && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-[15px] font-semibold text-[#1d1d1f]">Parts master · {master.length}</h2>
          <p className="mt-1 text-[12px] text-[#6e6e73]">Part Number, Description, EEE code, substitute, and serialized flag.</p></div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing({ id: -1, part_number: '', description: '', eee_code: null, substitute_part: null, serialized: 'Y' })}
              className="rounded-full bg-[#1d1d1f] px-4 py-1.5 text-[12px] font-semibold text-white">Add part</button>
            <button type="button" onClick={() => masterFileRef.current?.click()} disabled={busy}
              className="rounded-full bg-[#f5f5f7] px-4 py-1.5 text-[12px] font-semibold text-[#3c3c43] disabled:opacity-40">Import file</button>
            <input ref={masterFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importMasterFile(f); }} />
          </div>
        </div>
        <input value={masterQuery} onChange={(e) => setMasterQuery(e.target.value)} placeholder="Search part, description, or EEE"
          className="mt-3 h-9 w-full rounded-full border border-[#d2d2d7] bg-[#f5f5f7] px-4 text-[13px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f]" />
        {editing && (
          <div className="mt-3 grid gap-2 rounded-xl bg-[#f7f7f8] p-3">
            <input value={editing.part_number} onChange={(e) => setEditing({ ...editing, part_number: e.target.value })} placeholder="Part number"
              className="h-10 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Description"
              className="h-10 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
            <div className="flex flex-wrap gap-2">
              <input value={editing.eee_code || ''} onChange={(e) => setEditing({ ...editing, eee_code: e.target.value || null })} placeholder="EEE code (optional)"
                className="h-10 min-w-[140px] flex-1 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
              <input value={editing.substitute_part || ''} onChange={(e) => setEditing({ ...editing, substitute_part: e.target.value || null })} placeholder="Substitute part (optional)"
                className="h-10 min-w-[140px] flex-1 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]" />
              <select value={editing.serialized} onChange={(e) => setEditing({ ...editing, serialized: e.target.value })}
                className="h-10 rounded-xl border border-[#d2d2d7] bg-white px-3 text-[13px] outline-none focus:border-[#1d1d1f]">
                <option value="Y">Serialized</option>
                <option value="N">Non-serialized</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void savePart()} disabled={busy} className="rounded-xl bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Save</button>
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl bg-[#f5f5f7] px-5 py-2 text-[12px] font-semibold text-[#3c3c43]">Cancel</button>
            </div>
          </div>
        )}
        <div className="mt-3 max-h-[320px] divide-y overflow-y-auto">
          {master.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[#1d1d1f]">{m.part_number} <span className="ml-1 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] text-[#6e6e73]">{m.serialized === 'N' ? 'qty' : 'serial'}</span></p>
                <p className="truncate text-[11px] text-[#6e6e73]">{m.description}{m.eee_code ? ` · EEE ${m.eee_code}` : ''}{m.substitute_part ? ` · sub ${m.substitute_part}` : ''}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setEditing(m)} className="text-[12px] text-[#3c3c43]">Edit</button>
                <button type="button" onClick={() => { if (window.confirm(`Remove ${m.part_number} from the master list?`)) void api.admin.deletePartsMaster(m.id).then(() => refreshMaster()).catch((err) => setError((err as Error).message)); }}
                  className="text-[12px] text-[#a33a3a]">Remove</button>
              </div>
            </div>
          ))}
          {!master.length && <p className="py-4 text-[12px] text-[#6e6e73]">No parts yet. Import your master file.</p>}
        </div>
      </section>}

      {activeTab === 'sheet' && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Google Sheet log</h2>
        <p className="mt-1 text-[12px] text-[#6e6e73]">One global append-only sheet. Every stock IN and OUT is added as a raw row.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${sheet.connected ? 'bg-[#ecfdf3] text-[#166534]' : 'bg-[#f5f5f7] text-[#6e6e73]'}`}>
            {sheet.connected ? `Connected · ${sheet.email}` : 'Not connected'}
          </span>
          {!sheet.connected
            ? <a href={api.parts.sheetConnectUrl()} className="rounded-full bg-[#1d1d1f] px-4 py-1.5 text-[12px] font-semibold text-white">Connect Google</a>
            : <button type="button" onClick={() => void api.parts.sheetDisconnect().then(() => refreshSheet()).catch((err) => setError((err as Error).message))}
              className="rounded-full bg-[#f5f5f7] px-4 py-1.5 text-[12px] font-semibold text-[#3c3c43]">Disconnect</button>}
          {sheet.pendingSync > 0 && (
            <button type="button" onClick={() => void api.parts.retrySheet().then((r) => { setMessage(`Retried sheet sync: ${r.synced} row(s).`); return refreshSheet(); }).catch((err) => setError((err as Error).message))}
              className="rounded-full bg-[#fff7ed] px-4 py-1.5 text-[12px] font-semibold text-[#9a3412]">
              Retry {sheet.pendingSync} pending
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={sheetIdInput} onChange={(e) => setSheetIdInput(e.target.value)} placeholder="Spreadsheet ID"
            className="h-10 min-w-[240px] flex-1 rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 font-mono text-[12px] outline-none focus:border-[#1d1d1f]" />
          <button type="button" onClick={() => void loadSheetOptions()} disabled={busy || !sheetIdInput.trim()}
            className="rounded-xl bg-[#1d1d1f] px-5 py-2 text-[12px] font-semibold text-white disabled:opacity-40">Load sheets</button>
        </div>
        {(sheetOptions.length > 0 || sheet.sheetName) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {(sheetOptions.length ? sheetOptions : [sheet.sheetName]).map((name) => (
              <button key={name} type="button" onClick={() => void saveSheet(name)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-semibold ${sheet.sheetName === name ? 'bg-[#1d1d1f] text-white' : 'bg-[#f5f5f7] text-[#3c3c43]'}`}>
                {name}
              </button>
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}

function messageTone(value: string) {
  if (/invalid|expired|failed|error|unable|required/i.test(value)) return 'error';
  if (/saved|imported|connected|success/i.test(value)) return 'success';
  return 'info';
}

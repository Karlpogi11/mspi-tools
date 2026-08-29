import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type FrontlineAccessRequest, type FrontlineSheet, type FrontlineSource } from '../../lib/api';

export default function AdminFrontlinePage() {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const [source, setSource] = useState<FrontlineSource | null>(null);
  const [sheets, setSheets] = useState<FrontlineSheet[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [writeSheetName, setWriteSheetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [accessRequests, setAccessRequests] = useState<FrontlineAccessRequest[]>([]);
  const [approvalSettings, setApprovalSettings] = useState<Record<number, { scope: 'cso' | 'all'; csoName: string }>>({});
  const [activeTab, setActiveTab] = useState<'source' | 'access'>('source');
  const [manualEmail, setManualEmail] = useState('');
  const [manualScope, setManualScope] = useState<'all' | 'cso'>('all');
  const [manualCsoName, setManualCsoName] = useState('');
  const [params] = useSearchParams();
  const messageStyle = messageTone(message);

  const load = async () => {
    const [nextStatus, nextSource, nextRequests] = await Promise.all([api.admin.frontlineGoogleStatus(), api.admin.frontlineSource(), api.admin.getFrontlineAccessRequests()]);
    setStatus(nextStatus); setSource(nextSource);
    setAccessRequests(nextRequests);
    if (nextSource) { setSpreadsheetId(nextSource.spreadsheet_id); setSpreadsheetName(nextSource.spreadsheet_name); setSelectedSheets(nextSource.selected_sheets); setWriteSheetName(nextSource.write_sheet_name || ''); }
  };

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);

  const chooseSpreadsheet = async (id: string) => {
    const normalizedId = id.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || id.trim();
    setSpreadsheetId(normalizedId); setSpreadsheetName(normalizedId); setSelectedSheets([]); setWriteSheetName(''); setSheets([]);
    if (!normalizedId) return;
    setLoadingSheets(true); setMessage('');
    try {
      const loaded = await api.admin.frontlineSheets(normalizedId);
      const loadedSheets = loaded.sheets;
      setSpreadsheetName(loaded.title);
      setSheets(loadedSheets);
      setSelectedSheets((current) => {
        const available = new Set(loadedSheets.map((sheet) => sheet.title));
        const retained = current.filter((title) => available.has(title));
        if (retained.length > 0) return retained;
        const recent = getRecentSheet(loadedSheets);
        return recent ? [recent.title] : [];
      });
    } catch (error) { setMessage((error as Error).message); } finally { setLoadingSheets(false); }
  };

  const save = async () => {
    if (!spreadsheetId || selectedSheets.length === 0 || !writeSheetName) return;
    setBusy(true); setSaving(true); setMessage('Saving source…');
    try { await api.admin.saveFrontlineSource(spreadsheetId, spreadsheetName || spreadsheetId, selectedSheets, writeSheetName); setMessage('Source saved.'); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); setSaving(false); }
  };

  const sync = async () => {
    setBusy(true); setMessage('Importing frontline records…');
    try { const result = await api.admin.syncFrontline(); setMessage(`${result.imported.toLocaleString()} records imported.`); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };
  const reviewRequest = async (id: number, decision: 'approved' | 'rejected') => { const setting = approvalSettings[id] || { scope: 'all' as const, csoName: '' }; setBusy(true); setMessage('Updating access request…'); try { await api.admin.updateFrontlineAccessRequest(id, decision, setting.scope, setting.csoName); setMessage(decision === 'approved' ? 'Frontline access updated.' : 'Frontline access removed.'); await load(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };
  const grantManualAccess = async () => { if (!manualEmail.trim() || (manualScope === 'cso' && !manualCsoName.trim())) return; setBusy(true); setMessage('Granting Frontline access…'); try { await api.admin.grantFrontlineAccess(manualEmail, manualScope, manualCsoName); setMessage('Frontline access granted.'); setManualEmail(''); setManualCsoName(''); setManualScope('all'); await load(); } catch (error) { setMessage((error as Error).message); } finally { setBusy(false); } };

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin" className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">← Back to Manage</Link>
        <h1 className="text-[26px] font-semibold tracking-tight text-[#1d1d1f]">Frontline Monitor</h1>
        <p className="mt-1 text-[14px] text-[#6e6e73]">Connect Google Sheets. Source tabs stay read-only; website entries use a separate destination tab.</p>
      </div>

      {params.get('error') && <div className="border border-[#fecaca] bg-[#fff7f7] px-4 py-3 text-[13px] text-[#b91c1c]">{params.get('error')}</div>}
      {message && <div className={`flex items-center justify-between gap-3 border px-4 py-3 text-[13px] ${messageStyle === 'error' ? 'border-[#fecaca] bg-[#fff7f7] text-[#b91c1c]' : messageStyle === 'success' ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'}`}><span>{message}</span><button type="button" aria-label="Dismiss message" onClick={() => setMessage('')} className="cursor-pointer rounded-md px-1.5 text-[18px] leading-none opacity-60 hover:opacity-100">×</button></div>}

      <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-[15px] font-semibold text-[#1d1d1f]">Google connection</h2><p className="mt-1 text-[12px] text-[#6e6e73]">{status.connected ? `Connected as ${status.email}` : 'No Google account connected.'}</p></div>
          {status.connected ? <button aria-label={googleBusy ? 'Disconnecting Google' : 'Disconnect Google'} disabled={googleBusy} onClick={async () => { setGoogleBusy(true); try { await api.admin.frontlineGoogleDisconnect(); await load(); } catch (error) { setMessage((error as Error).message); } finally { setGoogleBusy(false); } }} className="inline-flex h-[34px] min-w-[106px] items-center justify-center gap-2 rounded-full border border-[#d2d2d7] px-3.5 py-2 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7] disabled:opacity-40">{googleBusy ? <Spinner /> : 'Disconnect'}</button> : <a aria-label={googleBusy ? 'Connecting Google' : 'Connect Google'} onClick={(event) => { event.preventDefault(); setGoogleBusy(true); window.location.assign(api.admin.frontlineGoogleConnectUrl()); }} href={api.admin.frontlineGoogleConnectUrl()} className="inline-flex h-[34px] min-w-[122px] items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white no-underline hover:bg-black aria-disabled:pointer-events-none aria-disabled:opacity-40" aria-disabled={googleBusy}>{googleBusy ? <Spinner /> : 'Connect Google'}</a>}
        </div>
      </section>

      <div className="border-b border-[#e5e5e7]">
        <div className="flex gap-5" role="tablist" aria-label="Frontline Monitor administration">
          <button type="button" role="tab" aria-selected={activeTab === 'source'} onClick={() => setActiveTab('source')} className={`border-b-2 px-1 pb-3 text-[13px] font-medium transition-colors ${activeTab === 'source' ? 'border-[#1d1d1f] text-[#1d1d1f]' : 'border-transparent text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Report source</button>
          <button type="button" role="tab" aria-selected={activeTab === 'access'} onClick={() => setActiveTab('access')} className={`border-b-2 px-1 pb-3 text-[13px] font-medium transition-colors ${activeTab === 'access' ? 'border-[#1d1d1f] text-[#1d1d1f]' : 'border-transparent text-[#6e6e73] hover:text-[#1d1d1f]'}`}>Access requests</button>
        </div>
      </div>

      {activeTab === 'source' && !status.connected && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5"><h2 className="text-[15px] font-semibold text-[#1d1d1f]">Report source</h2><p className="mt-1 text-[12px] text-[#6e6e73]">Connect a Google account above to configure the spreadsheet and worksheets.</p></section>}

      {activeTab === 'source' && status.connected && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Report source</h2>
        <p className="mt-1 text-[12px] text-[#6e6e73]">Choose source worksheets for Frontline Monitor, then choose a separate tab for website entries. Source worksheets are never written to.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} placeholder="Paste Google Sheet ID or URL" className="h-10 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] bg-white px-3 text-[13px] text-[#1d1d1f]" /><button aria-label={loadingSheets ? 'Loading worksheets' : 'Load worksheets'} onClick={() => void chooseSpreadsheet(spreadsheetId)} disabled={busy || loadingSheets || !spreadsheetId.trim()} className="inline-flex h-10 min-w-[128px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d2d2d7] px-4 text-[12px] font-medium text-[#3c3c43] disabled:opacity-40">{loadingSheets ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#3c3c43]/30 border-t-[#3c3c43]" aria-hidden="true" /> : 'Load worksheets'}</button></div>
        {sheets.length > 0 && <><div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{sheets.map((sheet) => <label key={sheet.title} className="flex items-center gap-2 rounded-lg border border-[#e5e5e7] px-3 py-2 text-[12px] text-[#3c3c43]"><input type="checkbox" checked={selectedSheets.includes(sheet.title)} onChange={(event) => { if (event.target.checked) { setSelectedSheets((current) => [...current, sheet.title]); if (writeSheetName === sheet.title) setWriteSheetName(''); } else setSelectedSheets((current) => current.filter((name) => name !== sheet.title)); }} />{sheet.title}</label>)}</div><div className="mt-5 max-w-md"><label className="block text-[11px] font-medium text-[#6e6e73]">Website entry destination<select value={writeSheetName} onChange={(event) => { const value = event.target.value; setWriteSheetName(value); setSelectedSheets((current) => current.filter((name) => name !== value)); }} className="mt-1.5 h-10 w-full rounded-lg border border-[#d2d2d7] bg-white px-3 text-[13px] text-[#1d1d1f]"><option value="">Select a separate worksheet</option>{sheets.filter((sheet) => !selectedSheets.includes(sheet.title)).map((sheet) => <option key={sheet.title} value={sheet.title}>{sheet.title}</option>)}</select></label><p className="mt-1.5 text-[11px] text-[#86868b]">This tab must have its own complete header row. Website entries append only to this tab.</p></div></>}
        <div className="mt-5 flex flex-wrap items-center gap-2"><button aria-label={saving ? 'Saving source' : 'Save source'} disabled={busy || sheets.length === 0 || !spreadsheetId || selectedSheets.length === 0 || !writeSheetName} onClick={() => void save()} className="inline-flex h-[34px] min-w-[98px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/35 border-t-white" aria-hidden="true" /> : 'Save source'}</button><button disabled={busy || !source || sheets.length === 0 || source.spreadsheet_id !== spreadsheetId} onClick={() => void sync()} className="shrink-0 rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-medium text-[#3c3c43] disabled:opacity-40">Refresh data</button><span className="text-[11px] text-[#86868b]">{formatPhilippineTime(source?.last_synced_at || null)}</span></div>
      </section>}

      {activeTab === 'access' && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Access requests</h2>
        <p className="mt-1 text-[12px] text-[#6e6e73]">Approve users with full access by default, restrict access to one assigned CSO, or manage approved access.</p>
        <div className="mt-5 rounded-xl border border-[#e5e5e7] bg-[#fafafa] p-4"><h3 className="text-[13px] font-semibold text-[#1d1d1f]">Grant access manually</h3><p className="mt-1 text-[11px] text-[#6e6e73]">Grant Frontline Monitor access to an existing user without a request.</p><div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><input value={manualEmail} onChange={(event) => setManualEmail(event.target.value)} type="email" placeholder="User email" className="h-9 rounded-lg border border-[#d2d2d7] bg-white px-3 text-[12px] text-[#1d1d1f]" /><select value={manualScope} onChange={(event) => setManualScope(event.target.value as 'all' | 'cso')} className="h-9 rounded-lg border border-[#d2d2d7] bg-white px-2 text-[11px] text-[#3c3c43]"><option value="all">All records</option><option value="cso">Assigned CSO only</option></select>{manualScope === 'cso' ? <input value={manualCsoName} onChange={(event) => setManualCsoName(event.target.value)} placeholder="CSO name" className="h-9 rounded-lg border border-[#d2d2d7] bg-white px-3 text-[12px] text-[#1d1d1f]" /> : <span className="hidden sm:block" />}</div><div className="mt-3 flex justify-end"><button type="button" onClick={() => void grantManualAccess()} disabled={busy || !manualEmail.trim() || (manualScope === 'cso' && !manualCsoName.trim())} className="rounded-full bg-[#1d1d1f] px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-40">Grant access</button></div></div>
        <div className="mt-4 space-y-3">
          {accessRequests.length === 0 ? <p className="text-[12px] text-[#6e6e73]">No access requests.</p> : accessRequests.map((request) => {
            const setting = approvalSettings[request.id] || { scope: request.access_scope === 'cso' ? 'cso' as const : 'all' as const, csoName: request.cso_name || '' };
            const isPending = request.status === 'pending';
            const isApproved = request.status === 'approved';
            const savedScope = request.access_scope === 'cso' ? 'cso' : 'all';
            const hasAccessChanges = !isApproved || setting.scope !== savedScope || (setting.scope === 'cso' && setting.csoName.trim() !== (request.cso_name || '').trim());
            return <div key={request.id} className="rounded-xl border border-[#e5e5e7] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="text-[13px] font-medium text-[#1d1d1f]">{request.full_name} · {request.email}</p><p className="mt-1 text-[12px] text-[#3c3c43]">{request.reason}</p><p className="mt-1 text-[11px] uppercase tracking-wide text-[#86868b]">{request.status}</p></div>
                {(isPending || isApproved) && <div className="flex flex-wrap items-center justify-end gap-2">
                  <select value={setting.scope} onChange={(event) => setApprovalSettings((current) => ({ ...current, [request.id]: { ...setting, scope: event.target.value as 'cso' | 'all' } }))} className="h-8 rounded-lg border border-[#d2d2d7] px-2 text-[11px] text-[#3c3c43]"><option value="all">All records</option><option value="cso">Assigned CSO only</option></select>
                  {setting.scope === 'cso' && <input value={setting.csoName} onChange={(event) => setApprovalSettings((current) => ({ ...current, [request.id]: { ...setting, csoName: event.target.value } }))} placeholder="CSO name" className="h-8 w-32 rounded-lg border border-[#d2d2d7] px-2 text-[11px] text-[#3c3c43]" />}
                  {(isPending || hasAccessChanges) && <button type="button" disabled={busy || (setting.scope === 'cso' && !setting.csoName.trim())} onClick={() => void reviewRequest(request.id, 'approved')} className="rounded-full bg-[#1d1d1f] px-3 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{isPending ? 'Approve' : 'Save access'}</button>}
                  <button type="button" disabled={busy} onClick={() => { if (isPending || window.confirm(`Remove Frontline Monitor access for ${request.full_name || request.email}?`)) void reviewRequest(request.id, 'rejected'); }} className="rounded-full border border-[#d2d2d7] px-3 py-1.5 text-[11px] font-medium text-[#3c3c43] disabled:opacity-40">{isPending ? 'Reject' : 'Remove access'}</button>
                </div>}
              </div>
            </div>;
          })}
        </div>
      </section>}
    </div>
  );
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function Spinner() { return <span className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" aria-hidden="true" />; }

function messageTone(value: string) {
  if (/invalid|expired|failed|error|unable|required/i.test(value)) return 'error';
  if (/saved|imported|connected|success/i.test(value)) return 'success';
  return 'info';
}

function formatPhilippineTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'Asia/Manila' }).format(parseBackendTimestamp(value)) : 'Not synced yet';
}

function parseBackendTimestamp(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value);
}

function getRecentSheet(sheets: FrontlineSheet[]) {
  const monthly = sheets.map((sheet, index) => {
    const title = sheet.title.toLowerCase();
    const month = MONTHS.findIndex((name) => title.includes(name));
    const year = title.match(/20\d{2}/)?.[0];
    return { sheet, index, score: month >= 0 ? (year ? Number(year) * 12 + month : month) : -1 };
  }).filter((item) => item.score >= 0);
  const candidates = monthly.length > 0 ? monthly : sheets.map((sheet, index) => ({ sheet, index, score: index }));
  const sorted = candidates.sort((a, b) => a.score - b.score || a.index - b.index);
  return sorted[sorted.length - 1]?.sheet;
}

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, type FrontlineSheet, type FrontlineSource } from '../../lib/api';

export default function AdminFrontlinePage() {
  const [status, setStatus] = useState<{ connected: boolean; email: string | null }>({ connected: false, email: null });
  const [source, setSource] = useState<FrontlineSource | null>(null);
  const [sheets, setSheets] = useState<FrontlineSheet[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [spreadsheetName, setSpreadsheetName] = useState('');
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [params] = useSearchParams();
  const messageStyle = messageTone(message);

  const load = async () => {
    const [nextStatus, nextSource] = await Promise.all([api.admin.frontlineGoogleStatus(), api.admin.frontlineSource()]);
    setStatus(nextStatus); setSource(nextSource);
    if (nextSource) { setSpreadsheetId(nextSource.spreadsheet_id); setSpreadsheetName(nextSource.spreadsheet_name); setSelectedSheets(nextSource.selected_sheets); }
  };

  useEffect(() => { void load().catch((error) => setMessage(error.message)); }, []);

  const chooseSpreadsheet = async (id: string) => {
    const normalizedId = id.match(/\/spreadsheets\/d\/([^/]+)/)?.[1] || id.trim();
    setSpreadsheetId(normalizedId); setSpreadsheetName(normalizedId); setSelectedSheets([]); setSheets([]);
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
    if (!spreadsheetId || selectedSheets.length === 0) return;
    setBusy(true); setSaving(true); setMessage('Saving source…');
    try { await api.admin.saveFrontlineSource(spreadsheetId, spreadsheetName || spreadsheetId, selectedSheets); setMessage('Source saved.'); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); setSaving(false); }
  };

  const sync = async () => {
    setBusy(true); setMessage('Importing frontline records…');
    try { const result = await api.admin.syncFrontline(); setMessage(`${result.imported.toLocaleString()} records imported.`); await load(); }
    catch (error) { setMessage((error as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin" className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-[#6e6e73] hover:text-[#1d1d1f]">← Back to Manage</Link>
        <h1 className="text-[26px] font-semibold tracking-tight text-[#1d1d1f]">Frontline Monitor</h1>
        <p className="mt-1 text-[14px] text-[#6e6e73]">Connect a read-only Google Sheet source for MSPI Tools reports.</p>
      </div>

      {params.get('error') && <div className="border border-[#fecaca] bg-[#fff7f7] px-4 py-3 text-[13px] text-[#b91c1c]">{params.get('error')}</div>}
      {message && <div className={`border px-4 py-3 text-[13px] ${messageStyle === 'error' ? 'border-[#fecaca] bg-[#fff7f7] text-[#b91c1c]' : messageStyle === 'success' ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'}`}>{message}</div>}

      <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-[15px] font-semibold text-[#1d1d1f]">Google connection</h2><p className="mt-1 text-[12px] text-[#6e6e73]">{status.connected ? `Connected as ${status.email}` : 'No Google account connected.'}</p></div>
          {status.connected ? <button aria-label={googleBusy ? 'Disconnecting Google' : 'Disconnect Google'} disabled={googleBusy} onClick={async () => { setGoogleBusy(true); try { await api.admin.frontlineGoogleDisconnect(); await load(); } catch (error) { setMessage((error as Error).message); } finally { setGoogleBusy(false); } }} className="inline-flex h-[34px] min-w-[106px] items-center justify-center gap-2 rounded-full border border-[#d2d2d7] px-3.5 py-2 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7] disabled:opacity-40">{googleBusy ? <Spinner /> : 'Disconnect'}</button> : <a aria-label={googleBusy ? 'Connecting Google' : 'Connect Google'} onClick={(event) => { event.preventDefault(); setGoogleBusy(true); window.location.assign(api.admin.frontlineGoogleConnectUrl()); }} href={api.admin.frontlineGoogleConnectUrl()} className="inline-flex h-[34px] min-w-[122px] items-center justify-center gap-2 rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white no-underline hover:bg-black aria-disabled:pointer-events-none aria-disabled:opacity-40" aria-disabled={googleBusy}>{googleBusy ? <Spinner /> : 'Connect Google'}</a>}
        </div>
      </section>

      {status.connected && <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Report source</h2>
        <p className="mt-1 text-[12px] text-[#6e6e73]">Choose the spreadsheet and monthly worksheets used by Frontline Monitor.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} placeholder="Paste Google Sheet ID or URL" className="h-10 min-w-0 flex-1 rounded-lg border border-[#d2d2d7] bg-white px-3 text-[13px] text-[#1d1d1f]" /><button aria-label={loadingSheets ? 'Loading worksheets' : 'Load worksheets'} onClick={() => void chooseSpreadsheet(spreadsheetId)} disabled={busy || loadingSheets || !spreadsheetId.trim()} className="inline-flex h-10 min-w-[128px] shrink-0 items-center justify-center gap-2 rounded-lg border border-[#d2d2d7] px-4 text-[12px] font-medium text-[#3c3c43] disabled:opacity-40">{loadingSheets ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-[#3c3c43]/30 border-t-[#3c3c43]" aria-hidden="true" /> : 'Load worksheets'}</button></div>
        {sheets.length > 0 && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">{sheets.map((sheet) => <label key={sheet.title} className="flex items-center gap-2 rounded-lg border border-[#e5e5e7] px-3 py-2 text-[12px] text-[#3c3c43]"><input type="checkbox" checked={selectedSheets.includes(sheet.title)} onChange={(event) => setSelectedSheets((current) => event.target.checked ? [...current, sheet.title] : current.filter((name) => name !== sheet.title))} />{sheet.title}</label>)}</div>}
        <div className="mt-5 flex flex-wrap items-center gap-2"><button aria-label={saving ? 'Saving source' : 'Save source'} disabled={busy || sheets.length === 0 || !spreadsheetId || selectedSheets.length === 0} onClick={() => void save()} className="inline-flex h-[34px] min-w-[98px] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#1d1d1f] px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-40">{saving ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/35 border-t-white" aria-hidden="true" /> : 'Save source'}</button><button disabled={busy || !source || sheets.length === 0 || source.spreadsheet_id !== spreadsheetId} onClick={() => void sync()} className="shrink-0 rounded-full border border-[#d2d2d7] px-4 py-2 text-[12px] font-medium text-[#3c3c43] disabled:opacity-40">Refresh data</button><span className="text-[11px] text-[#86868b]">{formatPhilippineTime(source?.last_synced_at || null)}</span></div>
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

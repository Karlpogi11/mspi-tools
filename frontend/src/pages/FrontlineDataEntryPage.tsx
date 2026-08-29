import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function FrontlineDataEntryPage() {
  const [sheet, setSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api.admin.frontlineSource().then((source) => setSheet(source?.write_sheet_name || '')).catch((error) => setMessage((error as Error).message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!sheet) { setHeaders([]); setValues([]); return; }
    setLoadingSchema(true); setMessage('');
    void api.frontline.writeSchema(sheet).then((result) => { setHeaders(result.headers); setValues(result.headers.map(() => '')); }).catch((error) => { setHeaders([]); setValues([]); setMessage((error as Error).message); }).finally(() => setLoadingSchema(false));
  }, [sheet]);

  const canSubmit = useMemo(() => Boolean(sheet && headers.length && values.some((value) => value.trim())), [headers.length, sheet, values]);
  const updateValue = (index: number, value: string) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? value : item));
  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true); setMessage('');
    try { const result = await api.frontline.writeEntry({ sheet, headers, values }); setMessage(result.message); setValues(headers.map(() => '')); }
    catch (error) { setMessage((error as Error).message); }
    finally { setSaving(false); }
  };

  return <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-[12px] font-medium text-[#6e6e73]"><Link to="/" className="hover:text-[#1d1d1f]">Tools</Link><Chevron /><Link to="/frontline" className="hover:text-[#1d1d1f]">Frontline Monitor</Link><Chevron /><span className="text-[#1d1d1f]">Data Entry</span></nav>
      <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5 sm:p-6">
        <header><h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Frontline Data Entry</h1><p className="mt-1.5 text-[14px] text-[#3c3c43]">Add one row using the separate website-entry worksheet’s exact columns.</p></header>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {message && <div role="status" aria-live="polite" className="mb-8 rounded-lg bg-[#f5f5f7] px-4 py-3 text-[13px] text-[#3c3c43]">{message}</div>}
          <div className="mb-9 grid grid-cols-1 gap-2 border-b border-[#f0f0f0] pb-8 sm:grid-cols-[170px_minmax(0,360px)] sm:items-start sm:gap-x-8"><label className="pt-2 text-[13px] text-[#3c3c43]">Destination worksheet</label><div><input value={loading ? 'Loading…' : sheet || 'Not configured by Admin'} readOnly className="h-9 w-full rounded-lg border border-[#f0f0f0] bg-[#fbfbfb] px-3 text-[13px] text-[#3c3c43] outline-none" /><p className="mt-2 text-[11px] leading-4 text-[#86868b]">New entries append only to this worksheet.</p></div></div>
          {loadingSchema ? <p className="py-10 text-[13px] text-[#6e6e73]">Reading worksheet columns…</p> : headers.length ? <><div className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">{headers.map((header, index) => <SmartField key={`${header}-${index}`} header={header} value={values[index] || ''} onChange={(value) => updateValue(index, value)} />)}</div><div className="mt-12 flex justify-end gap-3 border-t border-[#f0f0f0] pt-8"><button type="button" onClick={() => setValues(headers.map(() => ''))} disabled={saving} className="h-9 rounded-lg border border-[#e8e8e8] bg-white px-5 text-[13px] text-[#3c3c43] hover:bg-[#fafafa] disabled:opacity-40">Clear</button><button type="submit" disabled={saving || !canSubmit} className="h-9 rounded-lg bg-[#0071c8] px-5 text-[13px] font-medium text-white hover:bg-[#0067b9] disabled:cursor-not-allowed disabled:opacity-40">{saving ? 'Adding…' : 'Add record'}</button></div></> : <p className="py-10 text-[13px] text-[#6e6e73]">{sheet ? 'The website-entry worksheet must contain a complete header row.' : 'Ask an Admin to configure a separate website-entry worksheet.'}</p>}
        </form>
      </section>
    </div>
  </div>;
}

function SmartField({ header, value, onChange }: { header: string; value: string; onChange: (value: string) => void }) {
  const key = header.toLowerCase();
  const multiline = /issue|remark|comment|description|note|detail|inspire/.test(key);
  const isTime = /time/.test(key);
  const type = /date/.test(key) && !isTime ? 'date' : isTime ? 'time' : /email/.test(key) ? 'email' : /phone|contact/.test(key) ? 'tel' : 'text';
  const placeholder = /ar|asset|record/.test(key) ? 'Enter reference number' : /name|cso|engineer/.test(key) ? 'Enter name' : multiline ? 'Enter details (optional)' : '';
  const setCurrentTime = (event: KeyboardEvent<HTMLInputElement>) => { if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === ';') { event.preventDefault(); const now = new Date(); onChange(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`); } };
  return <label className="block min-w-0 text-[13px] text-[#3c3c43]"><span className="block min-h-[18px]">{header}</span>{multiline ? <textarea rows={4} value={value} placeholder={placeholder} aria-label={header} onChange={(event) => onChange(event.target.value)} className="mt-2 block w-full resize-y rounded-lg border border-[#f0f0f0] px-3 py-2 text-[13px] leading-5 text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] focus:border-[#0071c8] focus:ring-2 focus:ring-[#0071c8]/10" /> : <input type={type} value={value} placeholder={placeholder} aria-label={header} autoComplete="off" enterKeyHint="next" onKeyDown={isTime ? setCurrentTime : undefined} onChange={(event) => onChange(event.target.value)} className="mt-2 block h-9 w-full rounded-lg border border-[#f0f0f0] px-3 text-[13px] text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] focus:border-[#0071c8] focus:ring-2 focus:ring-[#0071c8]/10" />}{isTime && <span className="mt-1.5 block text-[11px] text-[#86868b]">Press ⌘ ⇧ ; for the current time</span>}</label>;
}

function Chevron() { return <svg className="h-3 w-3 text-[#b5b5b5]" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

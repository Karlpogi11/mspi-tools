import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type FrontlineOptionLists, type FrontlineReport, type FrontlineSerialHistory } from '../lib/api';

type FieldKind = 'date' | 'startTime' | 'endTime' | 'aht' | 'transaction' | 'division' | 'cso' | 'ar' | 'serial' | 'device' | 'notes' | 'other';

const EMPTY_OPTIONS: FrontlineOptionLists = { product_division: [], transaction_type: [], cso: [] };

export default function FrontlineDataEntryPage() {
  const [sheet, setSheet] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [values, setValues] = useState<string[]>([]);
  const [options, setOptions] = useState<FrontlineOptionLists>(EMPTY_OPTIONS);
  const [deviceModels, setDeviceModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [schemaChanged, setSchemaChanged] = useState(false);
  const [autoFillMessage, setAutoFillMessage] = useState('');
  const [checkingEntry, setCheckingEntry] = useState(false);
  const [serialHistory, setSerialHistory] = useState<FrontlineSerialHistory[]>([]);
  const [loadingSerialHistory, setLoadingSerialHistory] = useState(false);
  const [arMismatchMessage, setArMismatchMessage] = useState('');
  const [autoFilledFields, setAutoFilledFields] = useState<Set<number>>(new Set());
  const [arRecordFields, setArRecordFields] = useState<Set<number>>(new Set());
  const [autoFillTransactionType, setAutoFillTransactionType] = useState('');
  const lastAutofillKey = useRef('');
  const lastArLookupKey = useRef('');

  useEffect(() => {
    void api.admin.frontlineSource().then((source) => setSheet(source?.write_sheet_name || '')).catch((error) => setMessage((error as Error).message)).finally(() => setLoading(false));
    void api.frontline.options().then(setOptions).catch(() => setOptions(EMPTY_OPTIONS));
    void api.frontline.deviceModels().then(setDeviceModels).catch(() => setDeviceModels([]));
  }, []);

  useEffect(() => {
    if (!sheet) { setHeaders([]); setValues([]); return; }
    setLoadingSchema(true); setMessage('');
    void api.frontline.writeSchema(sheet)
      .then((result) => { setHeaders(result.headers); setValues(initialValues(result.headers)); setDirty(false); setSchemaChanged(false); setSerialHistory([]); setAutoFillMessage(''); setArMismatchMessage(''); setAutoFilledFields(new Set()); setArRecordFields(new Set()); setAutoFillTransactionType(''); lastAutofillKey.current = ''; lastArLookupKey.current = ''; })
      .catch((error) => { setHeaders([]); setValues([]); setMessage((error as Error).message); })
      .finally(() => setLoadingSchema(false));
  }, [sheet]);

  useEffect(() => {
    if (!sheet || !headers.length) return;
    let disposed = false;
    const checkSchema = async () => {
      try {
        const result = await api.frontline.writeSchema(sheet);
        if (!disposed && (result.headers.length !== headers.length || result.headers.some((header, index) => header !== headers[index]))) setSchemaChanged(true);
      } catch { /* The submit-time check remains the source of truth if the background check is unavailable. */ }
    };
    const interval = window.setInterval(() => void checkSchema(), 30_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [headers, sheet]);

  const startIndex = headers.findIndex((header) => fieldKind(header) === 'startTime');
  const endIndex = headers.findIndex((header) => fieldKind(header) === 'endTime');
  const ahtIndex = headers.findIndex((header) => fieldKind(header) === 'aht');
  const dateIndex = headers.findIndex((header) => fieldKind(header) === 'date');
  const transactionIndex = headers.findIndex((header) => fieldKind(header) === 'transaction');
  const arIndex = headers.findIndex((header) => fieldKind(header) === 'ar');
  const serialIndex = headers.findIndex((header) => fieldKind(header) === 'serial');
  const divisionIndex = headers.findIndex((header) => fieldKind(header) === 'division');
  const deviceIndex = headers.findIndex((header) => fieldKind(header) === 'device');
  const csoIndex = headers.findIndex((header) => fieldKind(header) === 'cso');
  const notesIndex = headers.findIndex((header) => fieldKind(header) === 'notes');
  const canSubmit = useMemo(() => Boolean(sheet && headers.length && headers.some((header, index) => !['startTime', 'endTime'].includes(fieldKind(header)) && values[index]?.trim())), [headers, sheet, values]);
  const updateValue = (index: number, value: string) => { setDirty(true); setValues((current) => { const next = current.map((item, itemIndex) => itemIndex === index ? value : item); if (ahtIndex >= 0 && (index === startIndex || index === endIndex)) next[ahtIndex] = calculateAht(next[startIndex], next[endIndex]); return next; }); };
  const clearArLinkedFields = (clearKnownFields: boolean) => {
    const fieldsToClear = new Set([...arRecordFields, ...autoFilledFields]);
    if (clearKnownFields) [serialIndex, divisionIndex, deviceIndex, csoIndex, notesIndex].filter((index) => index >= 0).forEach((index) => fieldsToClear.add(index));
    if (fieldsToClear.size) setValues((current) => current.map((item, itemIndex) => fieldsToClear.has(itemIndex) ? '' : item));
    setAutoFilledFields(new Set());
    setArRecordFields(new Set());
    setAutoFillTransactionType('');
    setSerialHistory([]);
    setAutoFillMessage('');
  };
  const handleFieldChange = (index: number, kind: FieldKind, value: string) => {
    if (kind === 'ar' && !value.trim()) clearArLinkedFields(true);
    else if (kind === 'ar' && (arRecordFields.size || autoFilledFields.size)) clearArLinkedFields(false);
    if (kind === 'transaction' && autoFilledFields.size && autoFillTransactionType && value.trim().toLowerCase() !== autoFillTransactionType) {
      setAutoFilledFields(new Set());
      setAutoFillTransactionType('');
      setAutoFillMessage('Transaction type changed. Previous AR details can be edited for this new transaction.');
    }
    updateValue(index, kind === 'serial' ? value.toUpperCase() : value);
  };

  const loadSerialHistory = async (serialOverride?: string) => {
    const serial = serialOverride?.trim() || values[serialIndex]?.trim() || '';
    if (!serial) { setSerialHistory([]); return; }
    setLoadingSerialHistory(true);
    try { setSerialHistory(await api.frontline.serialHistory(serial)); }
    catch { setSerialHistory([]); }
    finally { setLoadingSerialHistory(false); }
  };

  const lookupArRecords = async () => {
    const transactionType = values[transactionIndex]?.trim() || '';
    const ar = values[arIndex]?.trim() || '';
    const serial = values[serialIndex]?.trim() || '';
    if (!ar) { setArMismatchMessage(''); return [] as FrontlineReport['records']; }
    const lookupKey = `${transactionType.toLowerCase()}|${ar.toLowerCase()}|${serial.toLowerCase()}`;
    if (lastArLookupKey.current === lookupKey) return [] as FrontlineReport['records'];
    lastArLookupKey.current = lookupKey;
    setCheckingEntry(true);
    try {
      const result = await api.frontline.report({ ar });
      const records = result.records.filter((item) => item.ar_number.trim().toLowerCase() === ar.toLowerCase());
      if (!records.length || !serial || records.some((record) => record.serial_number.trim().toLowerCase() === serial.toLowerCase())) setArMismatchMessage('');
      else {
        const knownSerials = [...new Set(records.map((record) => record.serial_number.trim()).filter(Boolean))];
        setArMismatchMessage(`AR ${ar} is linked to ${knownSerials.length ? `Serial Number ${knownSerials.join(', ')}` : 'another device'}. The entered Serial Number does not match. Verify before saving.`);
      }
      return records;
    } catch { setArMismatchMessage(''); return [] as FrontlineReport['records']; }
    finally { setCheckingEntry(false); }
  };

  const maybeAutofill = async () => {
    const transactionType = values[transactionIndex]?.trim() || '';
    const ar = values[arIndex]?.trim() || '';
    if (!ar) return;
    const records = await lookupArRecords();
    const lookupKey = `${transactionType.toLowerCase()}|${ar.toLowerCase()}`;
    if (lastAutofillKey.current === lookupKey) return;
    lastAutofillKey.current = lookupKey;
    setAutoFillMessage('');
    try {
      const record = records.find((item) => item.ar_number.trim().toLowerCase() === ar.toLowerCase());
      if (!record) { setArRecordFields(new Set()); return; }
      if (record.serial_number?.trim()) void loadSerialHistory(record.serial_number);
      const fillable = [[serialIndex, record.serial_number, 'Serial Number'], [divisionIndex, record.product_division, 'Product Division'], [deviceIndex, record.device_model, 'Device Model'], [csoIndex, record.cso, 'CSO'], [notesIndex, record.issue, 'Issue / Remarks']] as Array<[number, string, string]>;
      const filled: string[] = [];
      const filledIndices: number[] = [];
      setValues((current) => {
        const next = [...current];
        for (const [index, value, label] of fillable) if (index >= 0 && !next[index]?.trim() && value?.trim()) { next[index] = value; filled.push(label); filledIndices.push(index); }
        return next;
      });
      if (filledIndices.length) { setDirty(true); setAutoFilledFields((current) => new Set([...current, ...filledIndices])); setArRecordFields((current) => new Set([...current, ...filledIndices])); setAutoFillTransactionType(record.transaction_type?.trim().toLowerCase() || ''); setAutoFillMessage(`AR record found. Filled: ${filled.join(', ')}.`); }
      else setAutoFillMessage('AR record found. Existing values were kept.');
    } catch { setAutoFillMessage('Previous AR details could not be loaded. You can continue manually.'); }
  };

  const stop = () => {
    if (endIndex >= 0) updateValue(endIndex, currentTime());
  };

  const submit = async () => {
    if (!canSubmit) return;
    const entryValues = values.map((value, index) => fieldKind(headers[index]) === 'serial' ? value.toUpperCase() : value);
    if (endIndex >= 0 && !entryValues[endIndex]?.trim()) entryValues[endIndex] = currentTime();
    if (ahtIndex >= 0) entryValues[ahtIndex] = calculateAht(entryValues[startIndex], entryValues[endIndex]);
    setValues(entryValues);
    setSaving(true); setMessage('');
    try {
      if ((arIndex >= 0 || serialIndex >= 0) && transactionIndex >= 0 && dateIndex >= 0) {
        setCheckingEntry(true);
        const check = await api.frontline.checkEntry({ ar: entryValues[arIndex] || '', serial: entryValues[serialIndex] || '', transactionType: entryValues[transactionIndex] || '', date: entryValues[dateIndex] || '', issue: entryValues[notesIndex] || '' });
        setCheckingEntry(false);
        if (check.duplicate) { setMessage('This exact AR, Serial Number, transaction type, date, and issue already has a record. A returning client with a new AR or a different issue is allowed.'); setSaving(false); return; }
      }
      const result = await api.frontline.writeEntry({ sheet, headers, values: entryValues });
      setMessage(result.message); setValues(initialValues(headers)); setDirty(false); setSerialHistory([]); setAutoFillMessage(''); setArMismatchMessage(''); setAutoFilledFields(new Set()); setArRecordFields(new Set()); setAutoFillTransactionType(''); lastAutofillKey.current = ''; lastArLookupKey.current = '';
    } catch (error) { const errorMessage = (error as Error).message; if (errorMessage.includes('Worksheet columns changed')) setSchemaChanged(true); setMessage(errorMessage.includes('Worksheet columns changed') ? `${errorMessage} Your entered values are still here. Copy them if needed, reload the form, then enter the record again.` : errorMessage); }
    finally { setSaving(false); }
  };

  const clearForm = () => {
    if (dirty && !window.confirm('Clear all entered values and start a new record?')) return;
    setValues(initialValues(headers)); setDirty(false); setMessage(''); setSerialHistory([]); setAutoFillMessage(''); setArMismatchMessage(''); setAutoFilledFields(new Set()); setArRecordFields(new Set()); setAutoFillTransactionType(''); lastAutofillKey.current = ''; lastArLookupKey.current = '';
  };

  const groups = groupFields(headers);

  return <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
    <div className="mx-auto w-full max-w-4xl">
      <nav aria-label="Breadcrumb" className="mb-7 flex items-center gap-2 text-[12px] font-medium text-[#6e6e73]"><Link to="/" className="hover:text-[#1d1d1f]">Tools</Link><Chevron /><Link to="/frontline" className="hover:text-[#1d1d1f]">Frontline Monitor</Link><Chevron /><span className="text-[#1d1d1f]">Data Entry</span></nav>
      <section className="rounded-2xl border border-[#e5e5e7] bg-white p-5 sm:p-7">
        <header className="border-b border-[#f0f0f0] pb-6"><h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Frontline Data Entry</h1></header>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          {message && <div role="status" aria-live="polite" className="mt-6 rounded-lg bg-[#f5f5f7] px-4 py-3 text-[13px] text-[#3c3c43]">{message}</div>}
          <p className="mt-6 mb-1 text-[12px] leading-5 text-[#6e6e73]"><span className="font-semibold text-[#1d1d1f]">Destination worksheet</span><span className="mx-2 text-[#b5b5b5]">·</span>{loading ? 'Loading…' : sheet || 'Not configured by Admin'}</p>
          {schemaChanged && <div role="alert" className="mt-4 rounded-xl border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12px] leading-5 text-[#92400e]"><span className="font-semibold">Worksheet columns changed.</span> Do not submit this entry yet. Your current values are preserved; reload the form before continuing.</div>}
          {autoFillMessage && <p role="status" className="mt-4 text-[12px] text-[#3c3c43]">{checkingEntry ? 'Looking up the previous record…' : autoFillMessage}</p>}
          {loadingSchema ? <p className="py-12 text-[13px] text-[#6e6e73]">Reading worksheet columns…</p> : headers.length ? <>
            {groups.map((group) => <section key={group.title} className="border-b border-[#f0f0f0] py-6 last:border-b-0"><div className="mb-4"><h2 className="text-[15px] font-semibold text-[#1d1d1f]">{group.title}</h2></div><div className="grid grid-cols-1 gap-x-10 gap-y-6 md:grid-cols-2">{group.fields.map(({ header, index, kind }) => <SmartField key={`${header}-${index}`} header={header} kind={kind} value={values[index] || ''} options={kind === 'division' ? options.product_division.map((option) => option.label) : kind === 'transaction' ? options.transaction_type.map((option) => option.label) : kind === 'cso' ? options.cso.map((option) => option.label) : kind === 'device' ? deviceModels : []} onChange={(value) => { handleFieldChange(index, kind, value); if (kind === 'serial' || kind === 'ar') { setSerialHistory([]); setArMismatchMessage(''); lastArLookupKey.current = ''; } }} onBlur={kind === 'ar' || kind === 'transaction' || kind === 'serial' ? () => { if (kind === 'serial') void loadSerialHistory(); void maybeAutofill(); } : undefined} extra={kind === 'serial' ? <><SerialHistory history={serialHistory} loading={loadingSerialHistory} />{arMismatchMessage && <p role="alert" className="mt-2 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[11px] leading-5 text-[#92400e]">{arMismatchMessage}</p>}</> : undefined} onStop={kind === 'endTime' ? stop : undefined} readOnly={kind === 'aht' || (autoFilledFields.has(index) && (!autoFillTransactionType || !values[transactionIndex]?.trim() || values[transactionIndex].trim().toLowerCase() === autoFillTransactionType))} />)}</div></section>)}
            <div className="flex justify-end gap-3 border-t border-[#f0f0f0] pt-6"><button type="button" onClick={clearForm} disabled={saving || checkingEntry} className="h-9 rounded-lg border border-[#e8e8e8] bg-white px-5 text-[13px] text-[#3c3c43] hover:bg-[#fafafa] disabled:opacity-40">Clear</button><button type="submit" disabled={saving || checkingEntry || !canSubmit} className="h-9 rounded-lg bg-[#0071c8] px-5 text-[13px] font-medium text-white hover:bg-[#0067b9] disabled:cursor-not-allowed disabled:opacity-40">{checkingEntry ? 'Checking…' : saving ? 'Saving…' : 'Save record'}</button></div>
          </> : <p className="py-12 text-[13px] text-[#6e6e73]">{sheet ? 'The website-entry worksheet must contain a complete header row.' : 'Ask an Admin to configure a separate website-entry worksheet.'}</p>}
        </form>
      </section>
    </div>
  </div>;
}

function SmartField({ header, kind, value, options, onChange, onBlur, extra, onStop, readOnly }: { header: string; kind: FieldKind; value: string; options: string[]; onChange: (value: string) => void; onBlur?: () => void; extra?: ReactNode; onStop?: () => void; readOnly?: boolean }) {
  const key = header.toLowerCase();
  const multiline = kind === 'notes' || /remark|comment|description|note|detail|inspire/.test(key);
  const isTime = kind === 'startTime' || kind === 'endTime' || (/time/.test(key) && !/date/.test(key));
  const required = !['endTime', 'aht', 'notes'].includes(kind);
  const type = /date/.test(key) && !isTime ? 'date' : isTime ? 'time' : /email/.test(key) ? 'email' : /phone|contact/.test(key) ? 'tel' : 'text';
  const placeholder = kind === 'aht' ? 'Auto' : kind === 'ar' || kind === 'serial' ? 'Enter reference number' : kind === 'device' ? 'Search or type device model' : kind === 'notes' ? 'Enter details (optional)' : '';
  const setCurrentTime = (event: KeyboardEvent<HTMLInputElement>) => { if (isTime && (event.metaKey || event.ctrlKey) && event.shiftKey && event.key === ';') { event.preventDefault(); onChange(currentTime()); } };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => { setCurrentTime(event); if (event.key === 'Enter' && !event.shiftKey && !multiline) { event.preventDefault(); focusNextField(event); } };
  const input = multiline ? <textarea rows={4} value={value} placeholder={placeholder} aria-label={header} required={required} readOnly={readOnly} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} className={`mt-2 block w-full resize-y rounded-lg border border-[#e8e8e8] px-3 py-2 text-[13px] leading-5 text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] focus:border-[#0071c8] focus:ring-2 focus:ring-[#0071c8]/10 ${readOnly ? 'bg-[#f5f5f7] text-[#6e6e73]' : ''}`} /> : options.length ? <SmartListInput ariaLabel={header} value={value} options={options} placeholder={placeholder || 'Search or select'} required={required} readOnly={readOnly} onBlur={onBlur} onChange={onChange} /> : <input type={type} value={value} placeholder={placeholder} aria-label={header} required={required} readOnly={readOnly} autoComplete="off" enterKeyHint="next" onKeyDown={handleKeyDown} onBlur={onBlur} onChange={(event) => onChange(event.target.value)} className={`mt-2 block h-9 w-full rounded-lg border border-[#e8e8e8] px-3 text-[13px] text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] focus:border-[#0071c8] focus:ring-2 focus:ring-[#0071c8]/10 ${readOnly ? 'bg-[#f5f5f7] text-[#6e6e73]' : ''}`} />;
  return <label className="block min-w-0 text-[13px] text-[#3c3c43]"><span className="block min-h-[18px]">{header}{required && <span className="ml-1 text-[#b91c1c]" aria-hidden="true">*</span>}</span><div className={onStop ? 'flex items-start gap-2' : ''}>{input}{onStop && <button type="button" onClick={onStop} disabled={Boolean(value) || !onChange} className="mt-2 h-9 shrink-0 rounded-lg border border-[#d2d2d7] bg-white px-3 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-60">{value ? 'Stopped' : 'Stop now'}</button>}</div>{extra}</label>;
}

function SmartListInput({ ariaLabel, value, options, placeholder, required, readOnly, onBlur, onChange }: { ariaLabel: string; value: string; options: string[]; placeholder: string; required: boolean; readOnly?: boolean; onBlur?: () => void; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const query = value.trim().toLowerCase();
  const filtered = useMemo(() => options.filter((option) => !query || option.toLowerCase().includes(query)), [options, query]);
  const choose = (option: string) => { onChange(option); setOpen(false); setHighlighted(0); };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setHighlighted((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((index) => Math.max(index - 1, 0)); }
    else if (event.key === 'Enter' && open && filtered[highlighted]) { event.preventDefault(); choose(filtered[highlighted]); }
    else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); focusNextField(event); }
    else if (event.key === 'Escape') setOpen(false);
  };
  return <div className="relative mt-2"><input role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${ariaLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-suggestions`} value={value} placeholder={placeholder} aria-label={ariaLabel} required={required} readOnly={readOnly} autoComplete="off" enterKeyHint="next" onFocus={() => { if (!readOnly) setOpen(true); }} onBlur={() => { window.setTimeout(() => setOpen(false), 120); onBlur?.(); }} onKeyDown={handleKeyDown} onChange={(event) => { onChange(event.target.value); setOpen(true); setHighlighted(0); }} className={`block h-9 w-full rounded-lg border border-[#e8e8e8] px-3 text-[13px] text-[#1d1d1f] outline-none placeholder:text-[#a1a1a6] focus:border-[#0071c8] focus:ring-2 focus:ring-[#0071c8]/10 ${readOnly ? 'bg-[#f5f5f7] text-[#6e6e73]' : ''}`} />{open && <div id={`${ariaLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-suggestions`} role="listbox" className="absolute left-0 right-0 top-11 z-20 max-h-56 overflow-y-auto rounded-xl border border-[#d2d2d7] bg-white p-1 shadow-lg">{filtered.length ? filtered.map((option, index) => <button key={option} type="button" role="option" aria-selected={index === highlighted} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)} className={`block w-full rounded-lg px-3 py-2 text-left text-[12px] ${index === highlighted ? 'bg-[#f5f5f7] text-[#1d1d1f]' : 'text-[#3c3c43] hover:bg-[#fafafa]'}`}>{option}</button>) : <p className="px-3 py-2 text-[12px] text-[#6e6e73]">No matching option. You can continue with a custom value.</p>}</div>}</div>;
}

function SerialHistory({ history, loading }: { history: FrontlineSerialHistory[]; loading: boolean }) {
  if (loading) return <p className="mt-2 text-[11px] text-[#6e6e73]">Checking previous device records…</p>;
  if (!history.length) return null;
  return <div className="mt-2 rounded-lg bg-[#f5f5f7] px-3 py-2 text-[11px] leading-5 text-[#3c3c43]"><p className="font-semibold text-[#1d1d1f]">This device has previous records</p>{history.map((record) => <p key={record.id}><span className="font-medium">{formatHistoryDate(record.occurred_date)}</span>{record.transaction_type ? ` · ${record.transaction_type}` : ''}{record.issue ? ` · ${record.issue}` : ' · No issue recorded'}{record.source_sheet ? ` · ${record.source_sheet}` : ''}</p>)}</div>;
}

function formatHistoryDate(value: string | null) {
  if (!value) return 'Date not recorded';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function focusNextField(event: KeyboardEvent<HTMLInputElement>) {
  const form = event.currentTarget.form;
  if (!form) return;
  const fields = Array.from(form.elements).filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement => {
    if (element instanceof HTMLInputElement) return element.type !== 'hidden' && !element.readOnly && !element.disabled;
    return (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) && !element.disabled;
  });
  const currentIndex = fields.indexOf(event.currentTarget);
  fields[currentIndex + 1]?.focus();
}

function fieldKind(header: string): FieldKind {
  const key = header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/^start time$|start.*time/.test(key)) return 'startTime';
  if (/^end time$|end.*time/.test(key)) return 'endTime';
  if (/\baht\b|average handle time/.test(key)) return 'aht';
  if (/date/.test(key)) return 'date';
  if (/product division|division/.test(key)) return 'division';
  if (/name of cso|\bcso\b/.test(key)) return 'cso';
  if (/type of transaction|transaction type|service|disposition|status/.test(key)) return 'transaction';
  if (/a r number|ar number|asset|record/.test(key)) return 'ar';
  if (/serial/.test(key)) return 'serial';
  if (/device|model/.test(key)) return 'device';
  if (/issue|remark|comment|description|note|detail|inspire/.test(key)) return 'notes';
  return 'other';
}

function groupFields(headers: string[]) {
  const groups = [
    { title: 'Timing & visit', kinds: ['date', 'startTime', 'endTime', 'aht'] },
    { title: 'Service classification', kinds: ['transaction', 'division'] },
    { title: 'Customer & device', kinds: ['ar', 'serial', 'device', 'cso'] },
    { title: 'Notes', kinds: ['notes'] },
    { title: 'Additional fields', kinds: ['other'] },
  ] as const;
  const entries = headers.map((header, index) => ({ header, index, kind: fieldKind(header) }));
  return groups.map((group) => ({ ...group, fields: entries.filter((entry) => (group.kinds as readonly string[]).includes(entry.kind)) })).filter((group) => group.fields.length);
}

function initialValues(headers: string[]) {
  const values = headers.map(() => '');
  const dateIndex = headers.findIndex((header) => fieldKind(header) === 'date');
  const startIndex = headers.findIndex((header) => fieldKind(header) === 'startTime');
  if (dateIndex >= 0) values[dateIndex] = currentDate();
  if (startIndex >= 0) values[startIndex] = currentTime();
  return values;
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function currentDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function calculateAht(start: string | undefined, end: string | undefined) {
  const parse = (value: string | undefined) => {
    const match = value?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    if (match[4]?.toUpperCase() === 'PM' && hour < 12) hour += 12;
    if (match[4]?.toUpperCase() === 'AM' && hour === 12) hour = 0;
    return hour * 60 + Number(match[2]) + Number(match[3] || 0) / 60;
  };
  const startMinutes = parse(start); const endMinutes = parse(end);
  if (startMinutes === null || endMinutes === null) return '';
  const duration = endMinutes >= startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
  const totalMinutes = Math.round(duration * 100) / 100;
  if (totalMinutes >= 60) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round((totalMinutes % 60) * 100) / 100;
    return `${hours} hour${hours === 1 ? '' : 's'}${minutes ? ` ${minutes} minute${minutes === 1 ? '' : 's'}` : ''}`;
  }
  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

function Chevron() { return <svg className="h-3 w-3 text-[#b5b5b5]" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>; }

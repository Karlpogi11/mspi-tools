import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setPartsSiteToken, type PartsMasterItem, type PartsStockSummary, type PartsSite, type PartsUnit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { parseStockInWorkbook, parseStockOutWorkbook, todayIso } from '../lib/parts';

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '—');

function PartResultCard({ part, nonSerialized }: { part: PartsMasterItem; nonSerialized: boolean }) {
  return (
    <div className="mt-3 rounded-xl border border-[#e5e5e7] bg-white px-3.5 py-3">
      <p className="text-[15px] font-semibold text-[#1d1d1f]">{part.part_number}</p>
      <p className="mt-0.5 text-[12px] text-[#6e6e73]">{part.description}</p>
      <p className="mt-1 text-[11px] text-[#6e6e73]">
        {nonSerialized ? 'Non-serialized part — quantity applies, no serial needed.' : 'Serialized part — serial required.'}
        {part.substitute_part && ` · Substitute: ${part.substitute_part}`}
      </p>
    </div>
  );
}

export default function PartsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'Admin';
  const routedSite = (location.state as { site?: PartsSite; siteToken?: string } | null)?.site ?? null;
  const routedToken = (location.state as { site?: PartsSite; siteToken?: string } | null)?.siteToken ?? '';
  const [siteCode, setSiteCode] = useState(routedSite?.code ?? '');
  const [site, setSite] = useState<PartsSite | null>(routedSite);
  const [siteToken, setSiteToken] = useState(routedToken);
  const browsingAll = site?.code === 'ALL';
  const [codeInput, setCodeInput] = useState('');
  const [tab, setTab] = useState<'find' | 'in' | 'out'>('find');
  const [scan, setScan] = useState('');
  const [part, setPart] = useState<PartsMasterItem | null>(null);
  const [serial, setSerial] = useState('');
  const [unitSerial, setUnitSerial] = useState('');
  const [unitSerialMode, setUnitSerialMode] = useState(false);
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayIso());
  const [stock, setStock] = useState<PartsUnit[]>([]);
  const [summary, setSummary] = useState<PartsStockSummary>({ total: 0, units: 0, out_total: 0, parts: 0 });
  const [search, setSearch] = useState('');
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [partUnits, setPartUnits] = useState<PartsUnit[]>([]);
  const [partUnitsBusy, setPartUnitsBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ scan?: string; serial?: string; unitSerial?: string; reference?: string }>({});

  const clearAllNotices = () => { setError(''); setMessage(''); setFieldErrors({}); };
  const fieldBorder = (hasError: boolean) => (hasError ? 'border-[#e11d48]' : 'border-[#d2d2d7]');
  const setFieldError = (field: 'scan' | 'serial' | 'unitSerial' | 'reference', message: string) => {
    setError('');
    setFieldErrors((current) => ({ ...current, [field]: message }));
  };
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([]);
  const [gateDismissed, setGateDismissed] = useState(false);
  const [findView, setFindView] = useState<'serials' | 'parts'>('serials');
  const [findSerials, setFindSerials] = useState<PartsUnit[]>([]);
  const [findParts, setFindParts] = useState<PartsMasterItem[]>([]);
  const [findSiteParts, setFindSiteParts] = useState<{ part_number: string; description: string | null; date: string | null; serials: number }[]>([]);
  const [showingSiteParts, setShowingSiteParts] = useState(false);
  const [findSearched, setFindSearched] = useState(false);
  const [findBusy, setFindBusy] = useState(false);
  const [showAllParts, setShowAllParts] = useState(false);
  const [suggestions, setSuggestions] = useState<PartsMasterItem[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const fileInRef = useRef<HTMLInputElement>(null);
  const fileOutRef = useRef<HTMLInputElement>(null);
  const resolveSeq = useRef(0);
  const globalSearchBusy = useRef(false);

  // Module-level token must be current before any data fetch fires.
  setPartsSiteToken(siteToken);

  // Find serial results grouped to one row per unique part (totals only —
  // serials live in the right workbench when a row is tapped).
  const findSerialGroups = useMemo(() => {
    const groups = new Map<string, { part_number: string; description: string | null | undefined; count: number }>();
    for (const u of findSerials) {
      const g = groups.get(u.part_number) || { part_number: u.part_number, description: u.description, count: 0 };
      g.count += u.serial ? 1 : u.quantity;
      groups.set(u.part_number, g);
    }
    return [...groups.values()];
  }, [findSerials]);

  const verifySite = async (code: string) => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api.parts.verifySite(code.trim());
      setSite(result.site); setSiteCode(result.site.code); setSiteToken(result.siteToken);
      setPartsSiteToken(result.siteToken);
      setMessage(`Connected to ${result.site.name}.`);
    } catch (err) { setSite(null); setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const loadStock = async (code: string, q?: string) => {
    try {
      const result = await api.parts.stock(code, q);
      setStock(result.stock); setSummary(result.summary);
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    if (!site) return;
    void loadStock(site.code);
  }, [site]);
  useEffect(() => {
    if (!site) return;
    const t = setTimeout(() => void loadStock(site.code, search.trim() || undefined), 300);
    return () => clearTimeout(t);
  }, [search, site]);
  useEffect(() => {
    if (site) scanRef.current?.focus();
  }, [site, tab]);

  const doResolve = async (rawValue: string, field: 'scan' | 'serial' = 'scan'): Promise<{ part: PartsMasterItem | null; unit: PartsUnit | null }> => {
    const value = rawValue.trim().toUpperCase();
    if (!value || !site) return { part: null, unit: null };
    const seq = ++resolveSeq.current;
    setResolving(true); setError(''); setMessage(''); setPart(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const result = await api.parts.resolve({ serial: value, partNumber: value, eee: value, siteCode: site.code });
      if (seq !== resolveSeq.current) return { part: null, unit: null }; // stale — a newer lookup won
      setPart(result.part);
      if (result.unit?.serial) { setSerial(result.unit.serial); setUnitSerial(result.unit.serial); }
      else if (!result.part || String(result.part.serialized).toUpperCase() !== 'N') setSerial(value);
      if (result.part) {
        setPartNumber(result.part.part_number);
        // Reuse the shared search field for the unit serial when a serialized
        // part number was searched first.
        const searchedPartNumber = value === result.part.part_number.toUpperCase();
        setUnitSerial(searchedPartNumber ? '' : value);
        if (searchedPartNumber && String(result.part.serialized).toUpperCase() !== 'N') {
          setScan(''); setSerial(''); setUnitSerialMode(true);
        } else setUnitSerialMode(false);
      } else { setPartNumber(''); setUnitSerial(''); setUnitSerialMode(false); }
      if (!result.part) setFieldError(field, `"${value}" is not in the parts master. Ask an admin to add it.`);
      else if (result.unit?.status === 'in') setMessage(`${value} is currently IN at ${result.unit.site_code}.`);
      return { part: result.part, unit: result.unit };
    } catch (err) {
      if (seq !== resolveSeq.current) return { part: null, unit: null };
      setFieldError(field, (err as Error).message);
      return { part: null, unit: null };
    }
    finally { if (seq === resolveSeq.current) setResolving(false); }
  };

  // The one search bar has a tab-specific action: lookup on Find, resolve on
  // movement tabs. This keeps read-only results from racing movement state.
  const runGlobalSearch = async () => {
    if (!scan.trim() || globalSearchBusy.current || findBusy || resolving) return;
    globalSearchBusy.current = true;
    try {
      if (tab === 'find') await searchFind();
      else await doResolve(scan, 'scan');
    } finally {
      globalSearchBusy.current = false;
    }
  };

  const searchFind = async (query?: string, view?: 'serials' | 'parts', full?: boolean) => {
    const q = (query ?? scan).trim();
    const v = view ?? findView;
    if (!site) return;
    setFindBusy(true); setError(''); setFieldErrors({}); setShowSuggest(false); setShowingSiteParts(false);
    try {
      if (v === 'serials') {
        setFindSerials((await api.parts.stock(site.code, q || undefined, 2000)).stock);
      } else {
        setFindParts((await api.parts.master(q || undefined, full ? 12000 : q ? 200 : 500)).items);
        setShowAllParts(Boolean(full));
      }
      setFindSearched(true);
    } catch (err) { setFieldError('scan', (err as Error).message); }
    finally { setFindBusy(false); }
  };

  const pickSuggestion = (item: PartsMasterItem) => {
    setScan(item.part_number);
    setShowSuggest(false);
    void searchFind(item.part_number, findView);
  };

  const openPartSerials = (item: { part_number: string }) => {
    openPartWorkbench(item.part_number);
  };

  // Full on-site parts list — grouped stock at this site, not the master catalog.
  const showSiteParts = async () => {
    if (!site) return;
    setFindBusy(true); setError(''); setFieldErrors({}); setShowSuggest(false);
    try {
      setFindSiteParts((await api.parts.stockParts(site.code)).parts);
      setShowingSiteParts(true);
      setShowAllParts(true);
      setFindSearched(true);
    } catch (err) { setFieldError('scan', (err as Error).message); }
    finally { setFindBusy(false); }
  };

  // Smart suggestions while typing in Find — matches part number, description, EEE.
  useEffect(() => {
    if (!site || tab !== 'find') return;
    const q = scan.trim();
    if (q.length < 2) { setSuggestions([]); return; }
    const t = setTimeout(() => {
      void api.parts.master(q, 8).then((r) => setSuggestions(r.items)).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, tab, site]);

  const refresh = async () => {
    if (!site) return;
    await loadStock(site.code, search.trim() || undefined);
    if (selectedPart) await loadPartUnits(selectedPart);
  };

  const loadPartUnits = async (partNumber: string) => {
    if (!site) return;
    setPartUnitsBusy(true);
    try {
      setPartUnits((await api.parts.partUnits(site.code, partNumber)).units);
    } catch (err) { setError((err as Error).message); }
    finally { setPartUnitsBusy(false); }
  };

  const openPartWorkbench = (partNumber: string) => {
    setSelectedPart(partNumber);
    void loadPartUnits(partNumber);
  };

  const submitIn = async () => {
    if (!site) return;
    setBusy(true); setError(''); setMessage(''); setFieldErrors({});
    // Self-heal: if state was wiped (or never resolved), resolve fresh here.
    let pn = partNumber.trim();
    let currentPart = part && part.part_number === pn ? part : null;
    if (!pn && serial.trim()) {
      const fresh = await doResolve(serial.trim(), 'serial');
      if (fresh.part) { pn = fresh.part.part_number; currentPart = fresh.part; }
    }
    if (!pn && !serial.trim()) { setFieldError('serial', 'Scan a serial or enter a part number.'); setBusy(false); return; }
    const nonSerializedSubmit = currentPart?.serialized === 'N';
    const finalSerial = nonSerializedSubmit ? undefined : unitSerial.trim() || scan.trim() || undefined;
    if (!nonSerializedSubmit && !finalSerial) {
      const unitBoxVisible = Boolean(currentPart && !nonSerializedSubmit && unitSerial !== serial.trim().toUpperCase());
      setFieldError(unitBoxVisible ? 'unitSerial' : 'serial', 'Enter the unit serial number.');
      setBusy(false);
      return;
    }
    try {
      const result = await api.parts.stockIn({
        siteCode: site.code,
        partNumber: pn,
        serial: finalSerial,
        quantity: nonSerializedSubmit ? Number(quantity) || 1 : undefined,
        occurredDate: date,
      });
      setMessage(result.message);
      setScan(''); setSerial(''); setUnitSerial(''); setUnitSerialMode(false); setPartNumber(''); setPart(null); setQuantity('1'); setDate(todayIso());
      await refresh();
      scanRef.current?.focus();
    } catch (err) { setFieldError('serial', (err as Error).message); }
    finally { setBusy(false); }
  };

  const submitOut = async () => {
    if (!site || !serial.trim()) { setFieldError('serial', 'Serial number is required for stock out.'); return; }
    if (!reference.trim()) { setFieldError('reference', 'Reference number is required for stock out.'); return; }
    setBusy(true); setError(''); setMessage(''); setFieldErrors({});
    try {
      const result = await api.parts.stockOut({ siteCode: site.code, serial: serial.trim(), reference: reference.trim(), occurredDate: date });
      setMessage(result.message);
      setScan(''); setSerial(''); setReference(''); setPart(null); setPartNumber(''); setUnitSerialMode(false); setDate(todayIso());
      await refresh();
      scanRef.current?.focus();
    } catch (err) {
      const message = (err as Error).message;
      setFieldError(/reference/i.test(message) ? 'reference' : 'serial', message);
    }
    finally { setBusy(false); }
  };

  const runImport = async (kind: 'in' | 'out', file: File) => {
    if (!site) return;
    setBusy(true); setError(''); setMessage(''); setImportErrors([]);
    try {
      const buf = await file.arrayBuffer();
      const result = kind === 'in'
        ? await api.parts.importIn(site.code, await parseStockInWorkbook(buf))
        : await api.parts.importOut(site.code, await parseStockOutWorkbook(buf));
      setImportErrors(result.errors);
      if (result.failed) setError(`${result.imported} imported, ${result.failed} row(s) need attention.`);
      else setMessage(`${result.imported} row(s) imported.`);
      await refresh();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const nonSerialized = part && String(part.serialized).toUpperCase() === 'N';
  const changeSite = () => { setSite(null); setSiteCode(''); setSiteToken(''); setPartsSiteToken(''); setCodeInput(''); setStock([]); setSelectedPart(null); setPartUnits([]); setGateDismissed(false); };
  const browseAll = () => {
    setSite({ id: 0, code: 'ALL', name: 'All sites', active: 1 });
    setSiteCode('ALL');
    setSiteToken('');
    setPartsSiteToken('');
    setMessage('Browsing all sites (read-only). Enter a site code to stock in or out.');
  };

  return (
    <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <div className="w-full px-4 py-2 sm:px-6">
        {(message || error) && (
          <div role={error ? 'alert' : 'status'} className={`mb-4 rounded-xl px-4 py-3 text-[13px] ${error ? 'bg-[#fffafa] text-[#9b1c1c]' : 'bg-[#fbfefc] text-[#27633a]'}`}>
            {error || message}
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(420px,560px)_minmax(0,1fr)]">
          <section className="rounded-2xl bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Parts Inventory</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">Scan a serial or part number, then stock it in or out.</p>
              </div>
              {site ? (
                <button type="button" onClick={changeSite} className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#3c3c43]">
                  {site.code} · switch
                </button>
              ) : (
                <button type="button" onClick={() => setGateDismissed(false)} className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#3c3c43]">
                  Select site
                </button>
              )}
            </div>

            {!site ? (
              <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
                <p className="text-[13px] font-semibold text-[#1d1d1f]">Select a site to begin</p>
                <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Enter your site code. You will only see and move stock for this site.</p>
                <label className="mt-3 block text-[11px] font-semibold text-[#3c3c43]">Site code
                  <input value={codeInput} onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void verifySite(codeInput); } }}
                    placeholder="e.g. PODIUM"
                    className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] uppercase outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                </label>
                <button type="button" onClick={() => void verifySite(codeInput)} disabled={busy || !codeInput.trim()}
                  className="mt-3 w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy ? 'Verifying…' : 'Continue'}
                </button>
                {isAdmin && (
                  <button type="button" onClick={browseAll} className="mt-2 w-full rounded-2xl bg-white py-2.5 text-[12px] font-semibold text-[#3c3c43]">
                    Browse all stock (admin)
                  </button>
                )}
              </div>
            ) : browsingAll ? (
              <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
                <p className="text-[13px] font-semibold text-[#1d1d1f]">Read-only view</p>
                <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">You are browsing stock across all sites. Enter a site code to stock in or out.</p>
                <button type="button" onClick={changeSite} className="mt-3 w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white">
                  Enter site code
                </button>
              </div>
            ) : (
            <>
            <div className="relative mt-4">
                  <label className="block text-[11px] font-semibold text-[#3c3c43]">
                    {unitSerialMode ? 'Serial number — scan unit being stocked in' : 'Search serial, part number, description, or EEE'}
                    <input ref={scanRef} value={scan} autoFocus={Boolean(site)}
                  onChange={(e) => {
                    const value = e.target.value.toUpperCase();
                    const enteringUnitSerial = unitSerialMode;
                    setScan(value);
                    if (enteringUnitSerial) {
                      setUnitSerial(value); setSerial(value);
                    } else {
                      setPart(null); setPartNumber(''); setSerial(''); setUnitSerial(''); setUnitSerialMode(false);
                    }
                    setShowSuggest(true);
                    setFieldErrors((current) => ({ ...current, scan: undefined }));
                  }}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runGlobalSearch(); } }}
                  placeholder="Search serial or part…"
                  className={`mt-1 h-12 w-full rounded-xl border bg-white px-3 text-[15px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10 ${fieldBorder(Boolean(fieldErrors.scan))}`} />
              </label>
              {showSuggest && suggestions.length > 0 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[#e5e5e7] bg-white shadow-[0_12px_32px_rgba(0,0,0,.10)]">
                  {suggestions.map((s) => (
                    <button key={s.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(s)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f7f7f8]">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-[#1d1d1f]">{s.part_number}</span>
                        <span className="block truncate text-[11px] text-[#6e6e73]">{s.description}</span>
                      </span>
                      {s.eee_code && <span className="shrink-0 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] text-[#6e6e73]">{s.eee_code.split(';')[0]}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {fieldErrors.scan && <p role="alert" className="mt-1.5 text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.scan}</p>}
            {(resolving || findBusy) && <p className="mt-1.5 text-[11px] text-[#6e6e73]">{findBusy ? 'Searching…' : 'Checking…'}</p>}
            <button type="button" onClick={() => void runGlobalSearch()} disabled={findBusy || resolving || !scan.trim()}
              className="mt-3 w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
              {findBusy ? 'Searching…' : 'Search'}
            </button>
            <div className="mt-4 border-b border-[#e5e5e7]">
              <div className="flex gap-5" role="tablist" aria-label="Parts operations">
                {([['find', 'Find part'], ['in', 'Stock In'], ['out', 'Stock Out']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => {
                    setTab(key); setError(''); setMessage(''); setFieldErrors({});
                    if (key !== 'find' && scan.trim()) void doResolve(scan, 'scan');
                  }}
                    className={`border-b-2 px-1 pb-3 text-[13px] font-medium transition-colors ${tab === key ? 'border-[#1d1d1f] text-[#1d1d1f]' : 'border-transparent text-[#6e6e73] hover:text-[#1d1d1f]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'find' && (
            <div className="mt-4 rounded-2xl border border-[#e5e5e7] bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Results</h3>
                  <p className="mt-0.5 text-[11px] text-[#6e6e73]">Lookup only — nothing moves yet.</p>
                </div>
                <div className="flex gap-1 rounded-full bg-[#f5f5f7] p-1">
                  {(['serials', 'parts'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => { setFindView(v); }}
                      className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${findView === v ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73]'}`}>
                      {v === 'serials' ? 'Serials' : 'Parts'}
                    </button>
                  ))}
                </div>
              </div>
              {findView === 'parts' && !scan.trim() && !findSearched && (
                <button type="button" onClick={() => void showSiteParts()} disabled={findBusy}
                  className="mt-2 w-full rounded-2xl bg-[#f5f5f7] py-2.5 text-[12px] font-semibold text-[#3c3c43] disabled:opacity-40">
                  Show full parts list
                </button>
              )}
              {findSearched && (
                <p className="mt-3 text-[12px] font-semibold text-[#1d1d1f]">
                  {findView === 'serials' ? `${findSerialGroups.length.toLocaleString()} part${findSerialGroups.length === 1 ? '' : 's'} · ${findSerials.length.toLocaleString()} serial${findSerials.length === 1 ? '' : 's'}` : showingSiteParts ? `${findSiteParts.length.toLocaleString()} part${findSiteParts.length === 1 ? '' : 's'} on site` : `${findParts.length.toLocaleString()} part${findParts.length === 1 ? '' : 's'}`}
                  {scan.trim() && !showingSiteParts && <span className="font-normal text-[#6e6e73]"> for “{scan.trim()}”</span>}
                </p>
              )}
              {findView === 'serials' && findSerialGroups.length > 0 && (
                <div className="mt-2 overflow-x-auto rounded-xl border border-[#e5e5e7]">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead>
                      <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                        <th className="px-3 py-2 font-semibold">Part Number</th>
                        <th className="px-3 py-2 font-semibold">Description</th>
                        <th className="px-3 py-2 font-semibold">Serials</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findSerialGroups.map((g) => (
                        <tr key={g.part_number} onClick={() => openPartWorkbench(g.part_number)} className="cursor-pointer border-t border-[#f0f0f2] hover:bg-[#f7f7f8]">
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{g.part_number}</td>
                          <td className="px-3 py-2 text-[#3c3c43]">{g.description || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{g.count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {findView === 'parts' && showingSiteParts && findSiteParts.length > 0 && (
                <div className="mt-2 overflow-x-auto rounded-xl border border-[#e5e5e7]">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead>
                      <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                        <th className="px-3 py-2 font-semibold">Date</th>
                        <th className="px-3 py-2 font-semibold">Part</th>
                        <th className="px-3 py-2 font-semibold">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findSiteParts.map((m) => (
                        <tr key={m.part_number} onClick={() => openPartSerials(m)} className="cursor-pointer border-t border-[#f0f0f2] hover:bg-[#f7f7f8]">
                          <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{dateOnly(m.date)}</td>
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{m.part_number}</td>
                          <td className="px-3 py-2 text-[#3c3c43]">{m.description || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="border-t border-[#f0f0f2] px-3 py-2 text-[11px] text-[#6e6e73]">On-site stock only — tap a row to see its serials.</p>
                </div>
              )}
              {findView === 'parts' && !showingSiteParts && findParts.length > 0 && (
                <div className="mt-2 overflow-x-auto rounded-xl border border-[#e5e5e7]">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead>
                      <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                        <th className="px-3 py-2 font-semibold">Part Number</th>
                        <th className="px-3 py-2 font-semibold">Description</th>
                        <th className="px-3 py-2 font-semibold">EEE</th>
                        <th className="px-3 py-2 font-semibold">Substitute</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findParts.slice(0, 1000).map((m) => (
                        <tr key={m.id} onClick={() => openPartSerials(m)} className="cursor-pointer border-t border-[#f0f0f2] hover:bg-[#f7f7f8]">
                          <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{m.part_number}</td>
                          <td className="px-3 py-2 text-[#3c3c43]">{m.description}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{m.eee_code || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{m.substitute_part || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{m.serialized === 'N' ? 'qty' : 'serial'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {findParts.length > 1000 && <p className="border-t border-[#f0f0f2] px-3 py-2 text-[11px] text-[#6e6e73]">Showing first 1,000 of {findParts.length.toLocaleString()} — refine the search to narrow it.</p>}
                  {showAllParts && <p className="border-t border-[#f0f0f2] px-3 py-2 text-[11px] text-[#6e6e73]">Tap a row to see its serials.</p>}
                </div>
              )}
              {findSearched && findView === 'serials' && !findSerials.length && <p className="mt-3 py-4 text-center text-[12px] text-[#6e6e73]">No serials in stock for this search.</p>}
              {findSearched && findView === 'parts' && !showingSiteParts && !findParts.length && <p className="mt-3 py-4 text-center text-[12px] text-[#6e6e73]">No parts match this search.</p>}
              {findSearched && findView === 'parts' && showingSiteParts && !findSiteParts.length && <p className="mt-3 py-4 text-center text-[12px] text-[#6e6e73]">No stock on this site yet.</p>}
            </div>
            )}

            {tab === 'in' && (
            <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
              <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Stock In</h3>
              <p className="mt-0.5 text-[11px] text-[#6e6e73]">This writes to inventory + sheet log.</p>
              <div className="mt-4 space-y-3">
                {part ? <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} /> : (
                  <p className="rounded-xl border border-dashed border-[#d2d2d7] px-3 py-3 text-center text-[12px] text-[#6e6e73]">Search above to fill the part automatically.</p>
                )}
                {fieldErrors.serial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.serial}</p>}
                {fieldErrors.unitSerial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.unitSerial}</p>}
                {nonSerialized && (
                  <label className="block text-[11px] font-semibold text-[#3c3c43]">Quantity
                    <input value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric"
                      className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                  </label>
                )}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                </label>
                <button type="button" onClick={() => void submitIn()} disabled={busy}
                  className="w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy ? 'Saving…' : 'Stock IN'}
                </button>
              </div>
            </div>
            )}

            {tab === 'out' && (
            <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
              <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Stock Out</h3>
              <p className="mt-0.5 text-[11px] text-[#6e6e73]">This writes to inventory + sheet log.</p>
              <div className="mt-4 space-y-3">
                {part ? <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} /> : (
                  <p className="rounded-xl border border-dashed border-[#d2d2d7] px-3 py-3 text-center text-[12px] text-[#6e6e73]">Search above to fill the part automatically.</p>
                )}
                {fieldErrors.serial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.serial}</p>}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Reference number (repair / AR — required)
                  <input value={reference} onChange={(e) => { setReference(e.target.value); setFieldErrors((current) => ({ ...current, reference: undefined })); }} placeholder="e.g. AR-10234"
                    className={`mt-1 h-11 w-full rounded-xl border bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10 ${fieldBorder(Boolean(fieldErrors.reference))}`} />
                </label>
                {fieldErrors.reference && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.reference}</p>}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                </label>
                <button type="button" onClick={() => void submitOut()} disabled={busy}
                  className="w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy ? 'Saving…' : 'Stock OUT'}
                </button>
              </div>
            </div>
            )}

            <div className="mt-6 border-t pt-5">
              <p className="text-[11px] font-medium text-[#6e6e73]">Bulk import</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => void api.parts.downloadTemplate('in')} className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">IN template</button>
                <button type="button" onClick={() => void api.parts.downloadTemplate('out')} className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">OUT template</button>
                <button type="button" onClick={() => fileInRef.current?.click()} disabled={busy} className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] disabled:opacity-40">Import IN</button>
                <button type="button" onClick={() => fileOutRef.current?.click()} disabled={busy} className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] disabled:opacity-40">Import OUT</button>
                <input ref={fileInRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void runImport('in', f); }} />
                <input ref={fileOutRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void runImport('out', f); }} />
              </div>
              {importErrors.length > 0 && (
                <div className="mt-3 rounded-xl bg-[#fffafa] p-3 text-[12px] text-[#9b1c1c]">
                  {importErrors.slice(0, 8).map((r) => <p key={r.row}>Row {r.row}: {r.error}</p>)}
                  {importErrors.length > 8 && <p>…and {importErrors.length - 8} more.</p>}
                </div>
              )}
            </div>
            </>
            )}
          </section>

          <section className="h-full overflow-y-auto rounded-2xl bg-white p-4">
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Parts', value: summary.parts },
                { label: 'In stock', value: summary.units },
                { label: 'Out', value: summary.out_total },
              ].map((s) => (
                <div key={s.label} className="min-w-[96px] flex-1 rounded-xl bg-[#f7f7f8] px-3 py-2.5">
                  <p className="text-[20px] font-semibold tracking-tight text-[#1d1d1f]">{Number(s.value).toLocaleString()}</p>
                  <p className="text-[11px] text-[#6e6e73]">{s.label}</p>
                </div>
              ))}
            </div>
            {selectedPart ? (
              <>
                <div className="mt-4 flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{selectedPart}</h2>
                    <p className="mt-1 text-[12px] text-[#6e6e73]">
                      {partUnits.filter((u) => u.status === 'in').length} available · {partUnits.filter((u) => u.status !== 'in').length} out
                    </p>
                  </div>
                  <button type="button" onClick={() => { setSelectedPart(null); setPartUnits([]); }}
                    className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">
                    ← All stock
                  </button>
                </div>
                {partUnitsBusy ? (
                  <p className="py-6 text-center text-[12px] text-[#6e6e73]">Loading serials…</p>
                ) : partUnits.length ? (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-[#e5e5e7]">
                    <table className="w-full min-w-[560px] text-left text-[12px]">
                      <thead>
                        <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                          <th className="px-3 py-2 font-semibold">Serial</th>
                          <th className="px-3 py-2 font-semibold">Status</th>
                          <th className="px-3 py-2 font-semibold">Date</th>
                          <th className="px-3 py-2 font-semibold">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partUnits.map((u) => {
                          const available = u.status === 'in';
                          return (
                            <tr key={u.id} className="border-t border-[#f0f0f2]">
                              <td className="px-3 py-2 font-semibold text-[#1d1d1f]">{u.serial || `×${u.quantity}`}</td>
                              <td className="px-3 py-2">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${available ? 'bg-[#ecfdf3] text-[#166534]' : 'bg-[#f5f5f7] text-[#6e6e73]'}`}>
                                  {available ? 'Available' : 'Out'}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{dateOnly(!available && u.stocked_out_at ? u.stocked_out_at : u.occurred_date)}</td>
                              <td className="px-3 py-2 text-[#6e6e73]">{!available && u.reference ? u.reference : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="py-6 text-center text-[12px] text-[#6e6e73]">No serials recorded for this part.</p>
                )}
              </>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{site ? `${site.code} stock` : 'Site stock'}</h2>
                </div>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search part or serial"
                  className="mt-3 h-9 w-full rounded-full border border-[#d2d2d7] bg-[#f5f5f7] px-4 text-[13px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                <div className="mt-4 space-y-2">
                  {stock.map((u) => (
                    <button key={u.id} type="button" onClick={() => openPartWorkbench(u.part_number)} className="block w-full rounded-xl bg-[#f7f7f8] px-3 py-2.5 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-[#1d1d1f]">{u.serial || `${u.quantity} × ${u.part_number}`}</span>
                        <span className="text-[10px] text-[#86868b]">{dateOnly(u.occurred_date)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#6e6e73]">{u.part_number}{u.description ? ` · ${u.description}` : ''}</p>
                    </button>
                  ))}
                  {!stock.length && <p className="py-6 text-center text-[12px] text-[#6e6e73]">No stock found.</p>}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {!site && !gateDismissed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="parts-site-title">
          <form onSubmit={(event) => { event.preventDefault(); void verifySite(codeInput); }} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Parts Inventory</p>
              <button type="button" aria-label="Close" onClick={() => setGateDismissed(true)}
                className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#3c3c43]">✕</button>
            </div>
            <h2 id="parts-site-title" className="mt-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">Which site is this?</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">Enter your site code. You will only see and move stock for this site.</p>
            <label className="mt-5 block text-[11px] font-medium text-[#3c3c43]">Site code
              <input autoFocus value={codeInput} onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setError(''); }} placeholder="e.g. PODIUM"
                className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[14px] uppercase outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
            </label>
            {error && <p role="alert" className="mt-3 text-[12px] text-[#a33a3a]">{error}</p>}
            <button type="submit" disabled={busy || !codeInput.trim()} className="mt-5 w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">
              {busy ? 'Verifying…' : 'Continue'}
            </button>
            {isAdmin && (
              <button type="button" onClick={browseAll} className="mt-2 w-full rounded-xl bg-[#f5f5f7] py-3 text-[12px] font-semibold text-[#3c3c43]">
                Browse all stock (admin)
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

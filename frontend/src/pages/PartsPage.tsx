import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, setPartsSiteToken, type PartsMasterItem, type PartsMovement, type PartsSite, type PartsUnit } from '../lib/api';
import { useAuth } from '../lib/auth';
import { parseStockInWorkbook, parseStockOutWorkbook, todayIso } from '../lib/parts';

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : '—');
const priorityPartFamilies = ['display', 'battery'] as const;
const searchCountsKey = 'mspi.parts.search-counts';
const hideFrequentKey = 'mspi.parts.hide-frequent';

function prioritizeSuggestions(items: PartsMasterItem[]): PartsMasterItem[] {
  return [...items].sort((a, b) => {
    const rank = (item: PartsMasterItem) => {
      const description = item.description.trim().toLowerCase();
      const firstDescriptionTerm = description.split(/[,:/\-]/, 1)[0].trim();
      const index = priorityPartFamilies.findIndex((family) => firstDescriptionTerm === family);
      return index === -1 ? priorityPartFamilies.length : index;
    };
    return rank(a) - rank(b) || a.part_number.localeCompare(b.part_number);
  });
}

function PartResultCard({ part, nonSerialized }: { part: PartsMasterItem; nonSerialized: boolean }) {  return (
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

// Multiline serial entry: one serial per line, spaces stripped, deduped.
function parseSerialLines(text: string): string[] {  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (s && !seen.has(s)) { seen.add(s); out.push(s); }
  }
  return out;
}

// EEE check: serials containing none of the part's EEE codes. Parts without
// EEE codes can't be judged — never a mismatch.
function serialsOutsideEee(part: { eee_code: string | null } | null, serials: string[]): string[] {
  if (!part) return [];
  const codes = String(part.eee_code || '').split(';').map((c) => c.trim().toUpperCase().replace(/\s+/g, '')).filter((c) => c.length >= 3);
  if (!codes.length) return [];
  return serials.filter((s) => !codes.some((code) => s.includes(code)));
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
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [scan, setScan] = useState('');
  const [part, setPart] = useState<PartsMasterItem | null>(null);
  const [serial, setSerial] = useState('');
  const [unitSerial, setUnitSerial] = useState('');
  const [partNumber, setPartNumber] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(todayIso());
  const [stock, setStock] = useState<PartsUnit[]>([]);
  const [movementHistory, setMovementHistory] = useState<PartsMovement[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  // ALL-view drill level 3: serials of the selected part at this site.
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  // Right-panel table search — filters whichever drill level is showing.
  const [tableSearch, setTableSearch] = useState('');
  // Exact serial hit from Find — auto-opens its table with the row marked.
  const [highlightSerial, setHighlightSerial] = useState<string | null>(null);
  const highlightSeenRef = useRef<string | null>(null);
  const [partUnits, setPartUnits] = useState<PartsUnit[]>([]);
  const [partUnitsBusy, setPartUnitsBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [outMissingSerial, setOutMissingSerial] = useState<string | null>(null);
  const [masterMissing, setMasterMissing] = useState<string | null>(null);
  const [quickDescription, setQuickDescription] = useState('');
  const [serialLines, setSerialLines] = useState('');
  const [bulkErrors, setBulkErrors] = useState<{ serial: string; error: string }[]>([]);
  // EEE mismatches are shown only after the Stock IN button is clicked.
  const [mismatchList, setMismatchList] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<{ scan?: string; serial?: string; unitSerial?: string; reference?: string; lines?: string }>({});

  const clearAllNotices = () => { setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null); setMasterMissing(null); };
  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(clearAllNotices, 5000);
    return () => window.clearTimeout(timer);
  }, [message, error]);
  const fieldBorder = (hasError: boolean) => (hasError ? 'border-[#e11d48]' : 'border-[#d2d2d7]');
  const setFieldError = (field: 'scan' | 'serial' | 'unitSerial' | 'reference' | 'lines', message: string) => {
    setError('');
    setFieldErrors((current) => ({ ...current, [field]: message }));
  };
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([]);
  const [gateDismissed, setGateDismissed] = useState(false);
  // Switch-site holds the current site behind the modal — nothing changes
  // until Continue verifies the new code; X keeps the current site.
  const [switchingSite, setSwitchingSite] = useState(false);
  const [suggestions, setSuggestions] = useState<PartsMasterItem[]>([]);
  const [suggestionSource, setSuggestionSource] = useState<'stock' | 'master'>('master');
  const [showSuggest, setShowSuggest] = useState(false);
  const [frequentSearches, setFrequentSearches] = useState<string[]>([]);
  // Most-searched visibility — the × hides it persistently per device.
  const [hideFrequent, setHideFrequent] = useState(() => {
    try { return window.localStorage.getItem(hideFrequentKey) === '1'; } catch { return false; }
  });
  const setFrequentHidden = (hidden: boolean) => {
    setHideFrequent(hidden);
    try {
      if (hidden) window.localStorage.setItem(hideFrequentKey, '1');
      else window.localStorage.removeItem(hideFrequentKey);
    } catch { /* Ignore storage failures. */ }
  };
  const scanRef = useRef<HTMLInputElement>(null);
  const serialsRef = useRef<HTMLTextAreaElement>(null);
  const fileInRef = useRef<HTMLInputElement>(null);
  const fileOutRef = useRef<HTMLInputElement>(null);
  const resolveSeq = useRef(0);
  // True while the part came from the Part number box (manual) rather than a
  // serial resolve — the Serial box then acts as pure unit entry and must not
  // wipe or re-query the chosen part.
  const manualPartRef = useRef(false);

  // Module-level token must be current before any data fetch fires.
  setPartsSiteToken(siteToken);

  useEffect(() => {
    try {
      const counts = JSON.parse(localStorage.getItem(searchCountsKey) || '{}') as Record<string, number>;
      setFrequentSearches(Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([value]) => value));
    } catch { /* Ignore unavailable or malformed browser storage. */ }
  }, []);

  const rememberSearch = (rawValue: string) => {
    const value = rawValue.trim().toUpperCase();
    if (!value) return;
    setFrequentSearches((current) => {
      let counts: Record<string, number> = {};
      try { counts = JSON.parse(localStorage.getItem(searchCountsKey) || '{}') as Record<string, number>; } catch { /* Start fresh. */ }
      counts[value] = (counts[value] || 0) + 1;
      try { localStorage.setItem(searchCountsKey, JSON.stringify(counts)); } catch { /* Ignore storage failures. */ }
      return Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 5).map(([item]) => item);
    });
  };

  const verifySite = async (code: string) => {
    if (!code.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await api.parts.verifySite(code.trim());
      setSite(result.site); setSiteCode(result.site.code); setSiteToken(result.siteToken);
      setPartsSiteToken(result.siteToken);
      setSelectedPart(null); setPartUnits([]); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]);
      setSwitchingSite(false);
      setMessage(`Connected to ${result.site.name}.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const openSwitchModal = () => {
    setError(''); setCodeInput(''); setGateDismissed(false); setSwitchingSite(true);
  };

  const loadStock = async (code: string) => {
    try {
      const result = await api.parts.stock(code);
      setStock(result.stock);
    } catch (err) { setError((err as Error).message); }
  };

  const loadMovementHistory = async (code: string) => {
    try {
      setMovementHistory((await api.parts.recent(code)).history);
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    if (!site) return;
    void loadStock(site.code);
    void loadMovementHistory(site.code);
  }, [site]);
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
        setMasterMissing(null);
        manualPartRef.current = false;
        setPartNumber(result.part.part_number);
        const resolvedSerialized = String(result.part.serialized || 'Y').toUpperCase() !== 'N';
        // A searched part number locks the part: the multiline serial box
        // takes over, the search bar clears, date defaults to today.
        const searchedPartNumber = value === result.part.part_number.toUpperCase();
        setUnitSerial(searchedPartNumber ? '' : value);
        if (searchedPartNumber && resolvedSerialized) {
          setScan(''); setSerial('');
          setDate(todayIso());
          setTimeout(() => serialsRef.current?.focus(), 0);
        }
        // Prefill the multiline box with a resolved serial (never wipes lines).
        if (tab === 'in' && resolvedSerialized && !searchedPartNumber && value) {
          setSerialLines((prev) => (parseSerialLines(prev).includes(value) ? prev : prev.trim() ? prev : value));
        }
      }
      if (!result.part) {
        // Unknown to the catalog = not yet on this podium's stock either.
        // Any role can quick-add it via Stock IN — no admin needed. The
        // scanned value is a serial only, so the part number stays empty
        // for the user to fill. Manual quick-add entries are preserved when
        // re-resolving an already-known-missing value (tab switches).
        const alreadyKnownMissing = masterMissing === value;
        setMasterMissing(value);
        if (!alreadyKnownMissing && !manualPartRef.current) { setPartNumber(''); setQuickDescription(''); }
        setFieldError(field, `"${value}" is not yet on ${site?.name || 'this site'} stock.`);
      }
      else if (result.unit?.status === 'in') setMessage(`${value} is currently IN at ${result.unit.site_code}.`);
      return { part: result.part, unit: result.unit };
    } catch (err) {
      if (seq !== resolveSeq.current) return { part: null, unit: null };
      setFieldError(field, (err as Error).message);
      return { part: null, unit: null };
    }
    finally { if (seq === resolveSeq.current) setResolving(false); }
  };

  const pickSuggestion = (item: PartsMasterItem) => {
    setScan(item.part_number);
    rememberSearch(item.part_number);
    setShowSuggest(false);
    void doResolve(item.part_number, 'scan');
  };

  const pickSavedSearch = (value: string) => {
    setScan(value);
    rememberSearch(value);
    setShowSuggest(false);
    void doResolve(value, 'scan');
  };

  // Smart suggestions while typing — matches part number, description, and EEE.
  // Stock In only: Stock Out takes exact unit serials, so suggestions there
  // are noise (and save wasted lookups).
  useEffect(() => {
    if (!site || tab === 'out') {
      setSuggestions([]);
      return;
    }
    const q = scan.trim();
    if (q.length < 2) { setSuggestions([]); setSuggestionSource('master'); return; }
    const t = setTimeout(() => {
      const stockItems = [...new Map(
        stock
          .filter((item) => q.toLowerCase().split(/\s+/).every((term) => `${item.part_number} ${item.description || ''} ${item.serial || ''}`.toLowerCase().includes(term)))
          .map((item) => [item.part_number, {
            id: item.id,
            part_number: item.part_number,
            description: item.description || '',
            eee_code: null,
            substitute_part: null,
            serialized: item.serial ? 'Y' : 'N',
          } as PartsMasterItem]),
      ).values()];
      if (stockItems.length) {
        setSuggestionSource('stock');
        setSuggestions(prioritizeSuggestions(stockItems).slice(0, 8));
        return;
      }
      void api.parts.master(q, 50)
        .then((r) => { setSuggestionSource('master'); setSuggestions(prioritizeSuggestions(r.items).slice(0, 8)); })
        .catch(() => { setSuggestionSource('master'); setSuggestions([]); });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, site, tab]);

  // Movement tabs auto-resolve as the serial is typed. Minimum 4 chars and a
  // 600ms pause keep single scans to one request (scanner bursts + Enter
  // resolve immediately via the key handler) instead of one per keystroke.
  // Values already known-missing are skipped so re-resolves never wipe the
  // manual part number / description being typed in quick-add.
  useEffect(() => {
    if (!site || scan.trim().length < 4) return;
    if (manualPartRef.current) return;
    if (masterMissing && masterMissing === scan.trim().toUpperCase()) return;
    const timer = setTimeout(() => void doResolve(scan, 'scan'), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, site, tab, masterMissing]);

  const refresh = async () => {
    if (!site) return;
    await loadStock(site.code);
    await loadMovementHistory(site.code);
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

  const openPartWorkbench = (partNumber: string, highlight: string | null = null) => {
    setSelectedPart(partNumber);
    setSelectedSite(null);
    setHighlightSerial(highlight);
    if (!highlight) highlightSeenRef.current = null;
    void loadPartUnits(partNumber);
  };

  const backToParts = () => { setSelectedPart(null); setSelectedSite(null); setPartUnits([]); };
  const backToSites = () => { setSelectedSite(null); };

  // Serials workbench shared by single-site level 2 and ALL level 3.
  const renderSerials = (units: PartsUnit[], title: string, subtitle: string, onBack: () => void, backLabel: string) => {
    const shownUnits = tableTerms.length
      ? units.filter((u) => tableTerms.every((t) => (u.serial || '').toLowerCase().includes(t)))
      : units;
    return (
    <>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{title}</h2>
          <p className="mt-1 text-[12px] text-[#6e6e73]">{subtitle}</p>
        </div>
        <button type="button" onClick={onBack}
          className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">
          {backLabel}
        </button>
      </div>
      {partUnitsBusy ? (
        <p className="py-6 text-center text-[12px] text-[#6e6e73]">Loading serials…</p>
      ) : shownUnits.length ? (
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
              {shownUnits.map((u) => {
                const available = u.status === 'in';
                const highlighted = Boolean(u.serial && u.serial === highlightSerial);
                return (
                  <tr key={u.id} id={u.serial ? `serial-row-${u.serial}` : undefined} className={`border-t border-[#f0f0f2] ${highlighted ? 'bg-[#fffbeb]' : ''}`}>
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
        <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : 'No serials recorded for this part.'}</p>
      )}
    </>
    );
  };

  // Part number box (Stock IN): manual search — typing resolves the
  // description via the master without touching the serial entry.
  const onPartNumberInput = (raw: string) => {
    const v = raw.toUpperCase();
    if (part && v === part.part_number) return;
    setMismatchList([]);
    setPartNumber(v);
    setPart(null);
    manualPartRef.current = v.trim().length > 0;
  };

  // Dedicated serial/search box per movement tab — Stock In takes a part
  // number or a serial, Stock Out takes the unit serial. Shared state and
  // resolve flow.
  const renderSerialBox = (variant: 'in' | 'out') => {
    // One smart bar: on Stock IN it takes a part number (locks the part and
    // calls for the unit serial) or a serial (EEE auto-fills the part).
    const label = variant === 'in' ? 'Search part or serial' : 'Serial number';
    return (
      <>
        <div className="relative mt-4" key={variant}>
          <label className="block text-[11px] font-semibold text-[#3c3c43]">
            {label}
            <input ref={scanRef} value={scan} autoFocus={Boolean(site)}
              onChange={(e) => {
                const value = e.target.value.toUpperCase();
                setScan(value);
                setShowSuggest(true);
                setFieldErrors((current) => ({ ...current, scan: undefined }));
                setOutMissingSerial(null); setMismatchList([]);
                if (!value.trim()) {
                  // Clearing keeps the locked part and its serial lines.
                  setSerial(''); setUnitSerial('');
                  setMasterMissing(null);
                  return;
                }
                if (manualPartRef.current && (part || partNumber.trim())) {
                  // Serial for the manually chosen/typed part — attach it,
                  // never wipe or re-query the part.
                  setSerial(value); setUnitSerial(value);
                  setMasterMissing(null);
                  return;
                }
                setPart(null); setPartNumber(''); setSerial(''); setUnitSerial('');
                manualPartRef.current = false;
                setSerialLines(''); setBulkErrors([]);
                setMasterMissing(null); setQuickDescription('');
              }}
              onFocus={() => {
                if (!scan.trim()) {
                  setSuggestions([]);
                  setSuggestionSource('master');
                }
                setShowSuggest(true);
              }}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (manualPartRef.current && tab === 'in') void submitIn(); else void doResolve(scan, 'scan'); } }}
              placeholder={variant === 'in' ? 'Search part or serial…' : 'Scan or enter serial…'}
              className={`mt-1 h-12 w-full rounded-xl border bg-white px-3 text-[15px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10 ${fieldBorder(Boolean(fieldErrors.scan))}`} />
          </label>
          {tab !== 'out' && showSuggest && suggestions.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[#e5e5e7] bg-white shadow-[0_12px_32px_rgba(0,0,0,.10)]">
              <p className="border-b border-[#f0f0f2] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">
                {suggestionSource === 'stock' ? 'In-stock suggestions' : 'Suggestions'}
              </p>
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
          {tab !== 'out' && !hideFrequent && showSuggest && !scan.trim() && frequentSearches.length > 0 && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[#e5e5e7] bg-white p-3 shadow-[0_12px_32px_rgba(0,0,0,.10)]">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">Most searched</p>
                  <button type="button" aria-label="Hide most searched" onMouseDown={(e) => e.preventDefault()} onClick={() => { setFrequentHidden(true); setShowSuggest(false); }}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[14px] leading-none text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]">×</button>
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {frequentSearches.map((value) => (
                    <button key={`frequent-${value}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSavedSearch(value)}
                      className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] hover:bg-[#e5e5e7]">
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {tab !== 'out' && hideFrequent && (
            <p className="mt-1.5 text-[11px] text-[#6e6e73]">Suggestions hidden. <button type="button" onClick={() => setFrequentHidden(false)} className="cursor-pointer font-semibold underline underline-offset-2 hover:text-[#1d1d1f]">Show</button></p>
          )}
        </div>
        {fieldErrors.scan && !(masterMissing && !part && tab === 'in') && (
          <p role="alert" className="mt-1.5 text-[11px] leading-4 text-[#b91c1c]">
            {masterMissing && !part && tab === 'out'
              ? (<>“{masterMissing}” {masterMissingPartial ? 'looks like a partial scan — scan the full barcode' : `is not yet on ${site ? `${site.name || site.code} stock` : 'this site’s stock'}`} <button type="button" onClick={goAddHere} className="cursor-pointer font-semibold underline underline-offset-2 hover:opacity-70">Add here</button></>)
              : fieldErrors.scan}
          </p>
        )}
        {tab === 'out' && outMissingSerial && !masterMissing && (
          <p role="alert" className="mt-1.5 text-[11px] leading-4 text-[#b91c1c]">
            No stock record found for serial {outMissingSerial}. <button type="button" onClick={stockInMissingSerial} className="cursor-pointer font-semibold underline underline-offset-2 hover:opacity-70">Add here</button>
          </p>
        )}
        {resolving && <p className="mt-1.5 text-[11px] text-[#6e6e73]">Checking…</p>}
      </>
    );
  };

  const submitIn = async () => {
    if (!site) return;
    setBusy(true); setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null);
    // Self-heal: if state was wiped (or never resolved), resolve fresh here.
    let pn = partNumber.trim();
    let currentPart = part && part.part_number === pn ? part : null;
    if (!pn && serial.trim()) {
      const fresh = await doResolve(serial.trim(), 'serial');
      if (fresh.part) { pn = fresh.part.part_number; currentPart = fresh.part; }
    }
    // Unknown part: any role can quick-add the catalog entry inline, then
    // stock it in. A manually typed known number is pulled from the master
    // first (description included) — only truly new parts need it typed.
    if (!currentPart) {
      if (!pn) { setFieldError('serial', 'Enter the part number below, then Stock IN.'); setBusy(false); return; }
      try {
        const known = await api.parts.resolve({ partNumber: pn, siteCode: site.code });
        if (known.part) {
          currentPart = known.part;
          setPart(known.part);
          setMasterMissing(null);
          setFieldErrors((prev) => ({ ...prev, scan: undefined, serial: undefined }));
        }
      } catch { /* fall through to quick-add */ }
      if (!currentPart) {
        if (!quickDescription.trim()) { setFieldError('serial', `Add a short description for "${pn}" below, then Stock IN.`); setBusy(false); return; }
        try {
          const ensured = await api.parts.ensureMaster({ part_number: pn, description: quickDescription.trim() });
          currentPart = { id: ensured.item.id, part_number: ensured.item.part_number, description: ensured.item.description, eee_code: ensured.item.eee_code, substitute_part: ensured.item.substitute_part, serialized: ensured.item.serialized };
          setPart(currentPart);
          setPartNumber(currentPart.part_number);
          setMasterMissing(null);
        } catch (err) { setFieldError('serial', (err as Error).message); setBusy(false); return; }
      }
    }
    if (!pn && !serial.trim() && !lineSerials.length) { setFieldError('serial', 'Scan a serial or enter a part number.'); setBusy(false); return; }
    const nonSerializedSubmit = currentPart?.serialized === 'N';
    // Multiline box plus the search-box serial, deduped — one call per unit
    // for singles, one bulk call for many.
    const serials = nonSerializedSubmit ? [] : inSerials;
    if (!nonSerializedSubmit && !serials.length) {
      setFieldError('lines', 'Enter at least one unit serial number — one per line.');
      setBusy(false);
      return;
    }
    // EEE gate (submit-time only): serials outside the locked part's EEE
    // codes are rejected — review the serials against this part number.
    if (!nonSerializedSubmit && currentPart) {
      const misses = serialsOutsideEee(currentPart, serials);
      if (misses.length) {
        setMismatchList(misses);
        setBusy(false);
        return;
      }
    }
    setMismatchList([]);
    try {
      if (!nonSerializedSubmit && serials.length > 1) {
        const result = await api.parts.stockIn({ siteCode: site.code, partNumber: pn, serials, occurredDate: date });
        const failed = new Set((result.errors || []).map((row) => row.serial));
        setBulkErrors(result.errors || []);
        if (failed.size) {
          // Keep only failed lines for retry — successes are already saved.
          setSerialLines(serials.filter((s) => failed.has(s)).join('\n'));
          setError(`${result.imported} stocked in, ${failed.size} need attention — fix the lines and retry.`);
        } else {
          setMessage(result.message);
          setScan(''); setSerial(''); setUnitSerial(''); setPartNumber(''); setPart(null); setQuantity('1'); setDate(todayIso()); setMasterMissing(null); setQuickDescription(''); setSerialLines(''); setMismatchList([]); manualPartRef.current = false;
        }
        await refresh();
        serialsRef.current?.focus();
        return;
      }
      const finalSerial = nonSerializedSubmit ? undefined : serials[0];
      const result = await api.parts.stockIn({
        siteCode: site.code,
        partNumber: pn,
        serial: finalSerial,
        quantity: nonSerializedSubmit ? Number(quantity) || 1 : undefined,
        occurredDate: date,
      });
      setMessage(result.message);
      setScan(''); setSerial(''); setUnitSerial(''); setPartNumber(''); setPart(null); setQuantity('1'); setDate(todayIso()); setMasterMissing(null); setQuickDescription(''); setSerialLines(''); setBulkErrors([]); setMismatchList([]); manualPartRef.current = false;
      await refresh();
      scanRef.current?.focus();
    } catch (err) { setFieldError('serial', (err as Error).message); }
    finally { setBusy(false); }
  };

  const submitOut = async () => {
    if (!site || !serial.trim()) { setFieldError('serial', 'Serial number is required for stock out.'); return; }
    if (!reference.trim()) { setFieldError('reference', 'Reference number is required for stock out.'); return; }
    setBusy(true); setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null);
    try {
      const result = await api.parts.stockOut({ siteCode: site.code, serial: serial.trim(), reference: reference.trim(), occurredDate: date });
      setMessage(result.message);
      setScan(''); setSerial(''); setReference(''); setPart(null); setPartNumber(''); setDate(todayIso());
      await refresh();
      scanRef.current?.focus();
    } catch (err) {
      const message = (err as Error).message;
      const status = (err as { status?: number }).status;
      // Smart recovery: serial is not yet stocked IN here — offer a one-tap
      // jump to Stock IN with the serial prefilled and date reset to today.
      if (status === 404 || /no stock record|not yet stocked in/i.test(message)) {
        setOutMissingSerial(serial.trim().toUpperCase());
      }
      setFieldError(/reference/i.test(message) ? 'reference' : 'serial', message);
    }
    finally { setBusy(false); }
  };

  const stockInMissingSerial = () => {
    const missing = outMissingSerial || serial.trim().toUpperCase();
    if (!site || !missing) return;
    setOutMissingSerial(null);
    setError(''); setMessage(''); setFieldErrors({}); setMismatchList([]);
    setTab('in');
    setScan(missing); setSerial(missing); setUnitSerial(missing);
    setReference('');
    setDate(todayIso());
    void doResolve(missing, 'scan').then(({ part: found }) => {
      if (found) serialsRef.current?.focus();
      else scanRef.current?.focus();
    });
  };

  // Master-missing recovery: jump to Stock IN with the serial prefilled in
  // the serial box (never as the part number) and date reset to today.
  // Any role can add — part number + description + Stock IN tap remain.
  const goAddHere = () => {
    const missing = masterMissing || scan.trim().toUpperCase() || serial.trim().toUpperCase();
    if (!site || !missing) return;
    setOutMissingSerial(null);
    setError(''); setMessage(''); setFieldErrors({}); setMismatchList([]);
    setTab('in');
    setMasterMissing(missing);
    manualPartRef.current = false;
    setScan(missing); setSerial(missing); setUnitSerial(missing);
    setDate(todayIso());
    scanRef.current?.focus();
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
  // Every serial for this stock-in: pasted lines plus the search-box serial.
  const lineSerials = useMemo(() => parseSerialLines(serialLines), [serialLines]);
  const inSerials = useMemo(() => {
    const extra = (unitSerial.trim() || scan.trim()).toUpperCase();
    const base = [...lineSerials];
    if (extra && !base.includes(extra)) base.push(extra);
    return base;
  }, [lineSerials, unitSerial, scan]);
  const onSerialLinesInput = (raw: string) => {
    setMismatchList([]);
    setSerialLines(raw.toUpperCase().split('\n').map((l) => l.replace(/\s+/g, '')).join('\n'));
    setBulkErrors([]);
    setFieldErrors((current) => ({ ...current, lines: undefined }));
  };
  // Apple serials run 10+ chars — a shorter scan with no EEE match is most
  // likely a partial barcode scan, not a new part.
  const masterMissingPartial = (masterMissing?.trim().length || 0) < 10;
  // Stock IN accepts a serial (EEE fills the part) or a part number typed
  // below (master fills the description at submit) — either way a unit
  // serial is required before saving.
  const quickAddReady = Boolean(!part && partNumber.trim() && inSerials.length > 0);
  const stockInReady = tab === 'in' && (Boolean(part) && (Boolean(nonSerialized) || inSerials.length > 0) || quickAddReady);
  const stockOutReady = tab === 'out' && Boolean(serial.trim());
  const tabMovements = movementHistory.filter((movement) => movement.type === (tab === 'in' ? 'IN' : 'OUT'));
  const filteredHistory = tabMovements.filter((movement) => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return true;
    return `${movement.part_number} ${movement.serial || ''} ${movement.reference || ''} ${movement.occurred_date}`.toLowerCase().includes(query);
  });
  const stockGroups = useMemo(() => {
    // Single site: one row per part. ALL view: one row per site+part so the
    // site list is visible instead of merged away.
    const groups = new Map<string, { partNumber: string; description: string | null | undefined; serials: number; quantity: number; date: string | null | undefined; siteCode: string; siteName: string | undefined; serialKey: string }>();
    for (const unit of stock) {
      const key = browsingAll ? `${unit.site_code}||${unit.part_number}` : unit.part_number;
      const group = groups.get(key) || { partNumber: unit.part_number, description: unit.description, serials: 0, quantity: 0, date: unit.occurred_date, siteCode: unit.site_code, siteName: unit.site_name, serialKey: '' };
      group.serials += unit.serial ? 1 : 0;
      if (unit.serial) group.serialKey += ` ${unit.serial}`;
      group.quantity += unit.quantity;
      if (!group.date || (unit.occurred_date && unit.occurred_date > group.date)) group.date = unit.occurred_date;
      groups.set(key, group);
    }
    const byDesc = (a: { description: string | null | undefined; partNumber: string }, b: { description: string | null | undefined; partNumber: string }) =>
      (a.description || '').toLowerCase().localeCompare((b.description || '').toLowerCase()) || a.partNumber.localeCompare(b.partNumber);
    return [...groups.values()].sort((a, b) => browsingAll && a.siteCode !== b.siteCode ? a.siteCode.localeCompare(b.siteCode) : byDesc(a, b));
  }, [stock, browsingAll]);
  const distinctParts = useMemo(() => new Set(stockGroups.map((g) => g.partNumber)).size, [stockGroups]);
  const totalUnits = useMemo(() => stockGroups.reduce((n, g) => n + g.serials + (g.serials ? 0 : g.quantity), 0), [stockGroups]);
  // ALL level 1: every part merged across sites with per-site totals.
  const stockPartTotals = useMemo(() => {
    const totals = new Map<string, { partNumber: string; description: string | null | undefined; serials: number; quantity: number; sites: number; serialKey: string }>();
    for (const g of stockGroups) {
      const t = totals.get(g.partNumber) || { partNumber: g.partNumber, description: g.description, serials: 0, quantity: 0, sites: 0, serialKey: '' };
      t.serials += g.serials;
      t.quantity += g.serials ? 0 : g.quantity;
      t.sites += 1;
      t.serialKey += g.serialKey;
      totals.set(g.partNumber, t);
    }
    return [...totals.values()].sort((a, b) => (a.description || '').toLowerCase().localeCompare((b.description || '').toLowerCase()) || a.partNumber.localeCompare(b.partNumber));
  }, [stockGroups]);
  // ALL level 2: sites holding the selected part with their totals.
  const selectedPartSites = useMemo(() => {
    if (!browsingAll || !selectedPart) return [];
    const bySite = new Map<string, { siteCode: string; siteName: string | undefined; serials: number; quantity: number; date: string | null | undefined }>();
    for (const u of stock) {
      if (u.part_number !== selectedPart) continue;
      const s = bySite.get(u.site_code) || { siteCode: u.site_code, siteName: u.site_name, serials: 0, quantity: 0, date: u.occurred_date };
      s.serials += u.serial ? 1 : 0;
      s.quantity += u.quantity;
      if (!s.date || (u.occurred_date && u.occurred_date > s.date)) s.date = u.occurred_date;
      bySite.set(u.site_code, s);
    }
    return [...bySite.values()].sort((a, b) => a.siteCode.localeCompare(b.siteCode));
  }, [stock, browsingAll, selectedPart]);
  // ALL level 3: serials of the selected part at the selected site.
  const workbenchUnits = useMemo(
    () => (browsingAll && selectedSite ? partUnits.filter((u) => u.site_code === selectedSite) : partUnits),
    [browsingAll, selectedSite, partUnits]
  );
  const selectedSiteName = useMemo(
    () => selectedPartSites.find((s) => s.siteCode === selectedSite)?.siteName || selectedSite,
    [selectedPartSites, selectedSite]
  );
  const panelDepth = !selectedPart ? 0 : browsingAll ? (selectedSite ? 2 : 1) : 1;
  // Search resets on every drill or site move — it always applies to one level.
  useEffect(() => { setTableSearch(''); }, [selectedPart, selectedSite, site]);
  // Exact serial typed in the panel search jumps straight to its table.
  useEffect(() => {
    const q = tableSearch.trim().toUpperCase();
    if (q.length < 4 || !site) return;
    const hit = stock.find((u) => (u.serial || '').toUpperCase() === q);
    if (!hit) return;
    if (selectedPart === hit.part_number && (!browsingAll || selectedSite === hit.site_code)) return;
    openPartWorkbench(hit.part_number, hit.serial);
    if (browsingAll) setSelectedSite(hit.site_code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableSearch, stock, site, browsingAll, selectedPart, selectedSite]);
  // Scroll an exact-hit serial row into view once per highlight.
  useEffect(() => {
    if (!highlightSerial || highlightSeenRef.current === highlightSerial) return;
    highlightSeenRef.current = highlightSerial;
    document.getElementById(`serial-row-${highlightSerial}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightSerial, selectedPart, selectedSite, partUnits]);
  const tableTerms = tableSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredGroups = useMemo(
    () => (tableTerms.length ? stockGroups.filter((g) => tableTerms.every((t) => `${g.siteCode} ${g.partNumber} ${g.description || ''}${g.serialKey}`.toLowerCase().includes(t))) : stockGroups),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockGroups, tableSearch]
  );
  const filteredPartTotals = useMemo(
    () => (tableTerms.length ? stockPartTotals.filter((t) => tableTerms.every((term) => `${t.partNumber} ${t.description || ''}${t.serialKey}`.toLowerCase().includes(term))) : stockPartTotals),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockPartTotals, tableSearch]
  );
  const filteredPartSites = useMemo(
    () => (tableTerms.length ? selectedPartSites.filter((s) => tableTerms.every((t) => `${s.siteCode} ${s.siteName || ''}`.toLowerCase().includes(t))) : selectedPartSites),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPartSites, tableSearch]
  );
  const changeSite = () => { manualPartRef.current = false; setSite(null); setSiteCode(''); setSiteToken(''); setPartsSiteToken(''); setCodeInput(''); setStock([]); setSelectedPart(null); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]); setPartUnits([]); setGateDismissed(false); };
  const browseAll = () => {
    setSwitchingSite(false);
    // Drop the previous site's workbench/stock so nothing stale lingers.
    setSelectedPart(null); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]); setPartUnits([]); setStock([]);
    setPart(null); setPartNumber(''); setScan(''); setSerial(''); setUnitSerial('');
    setSite({ id: 0, code: 'ALL', name: 'All sites', active: 1 });
    setSiteCode('ALL');
    setSiteToken('');
    setPartsSiteToken('');
    setMessage('Browsing all sites (read-only). Enter a site code to stock in or out.');
  };

  return (
    <div className="min-h-[calc(100vh-128px)] bg-[#f4f3f6]">
      <div className="mx-auto w-full max-w-[1920px] px-4 py-3 sm:px-8 lg:px-10 xl:px-12">
        {(message || error) && (
          <div role={error ? 'alert' : 'status'} aria-live="polite" className="fixed right-5 top-16 z-40 flex w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-black/10 bg-white/95 px-3.5 py-3 shadow-[0_12px_40px_rgba(0,0,0,.14)] backdrop-blur-xl">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${error ? 'bg-[#fff1f2] text-[#be123c]' : 'bg-[#ecfdf3] text-[#166534]'}`} aria-hidden="true">
              {error ? '!' : '✓'}
            </span>
            <span className={`min-w-0 flex-1 pt-1 text-[12px] leading-5 ${error ? 'text-[#9b1c1c]' : 'text-[#1d1d1f]'}`}>{error || message}</span>
            <button type="button" aria-label="Dismiss notification" onClick={clearAllNotices} className="rounded-full px-1 text-[18px] leading-5 text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]">×</button>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Parts Inventory</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">Scan a serial or part number, then stock it in or out.</p>
              </div>
              {site ? (
                <button type="button" onClick={openSwitchModal} className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#3c3c43]">
                  {site.name || site.code} · switch
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
            <div className="mt-4 border-b border-[#e5e5e7]">
              <div className="flex gap-5" role="tablist" aria-label="Parts operations">
                {([['in', 'Stock In'], ['out', 'Stock Out']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => {
                    setTab(key); setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null); setMismatchList([]); manualPartRef.current = false;
                    if (key !== 'in') { setMasterMissing(null); setQuickDescription(''); }
                    if (scan.trim() && masterMissing !== scan.trim().toUpperCase()) void doResolve(scan, 'scan');
                  }}
                    className={`border-b-2 px-1 pb-3 text-[13px] font-medium transition-colors ${tab === key ? 'border-[#1d1d1f] text-[#1d1d1f]' : 'border-transparent text-[#6e6e73] hover:text-[#1d1d1f]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'in' && renderSerialBox('in')}
            {tab === 'out' && renderSerialBox('out')}

            {tab === 'in' && (
            <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
              <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Stock In</h3>
              <p className="mt-0.5 text-[11px] text-[#6e6e73]">This writes to inventory + sheet log.</p>
              <button type="button" onClick={() => { setHistorySearch(''); setHistoryOpen(true); }} className="mt-3 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm">
                View Stock In history ({tabMovements.length})
              </button>
              <div className="mt-4 space-y-3">
                {part ? <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} /> : masterMissing ? (
                  <div role="alert" className="rounded-xl border border-dashed border-[#d2d2d7] bg-white px-3 py-3">
                    <p className="text-[12px] font-semibold text-[#1d1d1f]">“{masterMissing}” {masterMissingPartial ? 'looks like a partial scan' : `is not yet on ${site ? `${site.name || site.code} stock` : 'this site’s stock'}`}.</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#6e6e73]">{masterMissingPartial ? 'Scan the full serial barcode — the part is identified from the EEE code inside it. Or enter the part number below:' : 'Enter the part number below — the description fills automatically when it’s known.'}</p>
                    <label className="mt-2 block text-[11px] font-semibold text-[#3c3c43]">Part number
                      <input value={partNumber} onChange={(e) => onPartNumberInput(e.target.value)}
                        placeholder="e.g. 661-12345"
                        className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] uppercase outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                    </label>
                    <label className="mt-2 block text-[11px] font-semibold text-[#3c3c43]">Description (required for new parts)
                      <input value={quickDescription} onChange={(e) => setQuickDescription(e.target.value)}
                        placeholder="Short description for this part"
                        className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                    </label>
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-[#d2d2d7] px-3 py-3 text-center text-[12px] text-[#6e6e73]">Search a part number or serial above — it fills automatically.</p>
                )}
                {!(masterMissing && !part) && fieldErrors.serial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.serial}</p>}
                {!nonSerialized && (part || masterMissing) && (
                  <>
                    <label className="block text-[11px] font-semibold text-[#3c3c43]">Serial numbers — one per line, no spaces
                      <textarea ref={serialsRef} rows={3} value={serialLines} onChange={(e) => onSerialLinesInput(e.target.value)}
                        onKeyDown={(e) => {
                          // Tab stays inside the box as a new line — never jumps fields.
                          if (e.key === 'Tab') {
                            e.preventDefault();
                            const el = serialsRef.current;
                            if (!el) return;
                            const pos = el.selectionStart ?? serialLines.length;
                            const end = el.selectionEnd ?? pos;
                            onSerialLinesInput(`${serialLines.slice(0, pos)}\n${serialLines.slice(end)}`);
                            requestAnimationFrame(() => {
                              const t = serialsRef.current;
                              if (t) { t.selectionStart = t.selectionEnd = pos + 1; t.focus(); }
                            });
                          }
                        }}
                        placeholder={'SN001\nSN002'}
                        className="mt-1 max-h-40 min-h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 py-2.5 text-[14px] uppercase outline-none placeholder:normal-case placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                    </label>
                    {lineSerials.length > 0 && <p className="text-[11px] text-[#6e6e73]">{lineSerials.length} serial{lineSerials.length === 1 ? '' : 's'} ready.</p>}
                    {mismatchList.length > 0 && part && (
                      <div role="alert" className="rounded-xl border border-[#fecaca] bg-[#fff7f7] px-3 py-2.5 text-[#b91c1c]">
                        <p className="text-[12px] font-semibold">{mismatchList.length} serial{mismatchList.length === 1 ? '' : 's'} outside {part.part_number}’s EEE code.</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {mismatchList.slice(0, 8).map((s) => (
                            <span key={s} className="break-all rounded-md bg-white/80 px-1.5 py-0.5 font-mono text-[11px]">{s}</span>
                          ))}
                          {mismatchList.length > 8 && <span className="px-1 py-0.5 text-[11px]">+{mismatchList.length - 8} more</span>}
                        </div>
                        <p className="mt-1.5 text-[11px] leading-4 opacity-80">Review against {part.part_number}, then fix the lines.</p>
                      </div>
                    )}
                    {fieldErrors.lines && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.lines}</p>}
                    {bulkErrors.length > 0 && (
                      <div className="rounded-xl bg-[#fffafa] p-3 text-[12px] text-[#9b1c1c]">
                        {bulkErrors.slice(0, 6).map((r) => <p key={r.serial}>{r.serial}: {r.error}</p>)}
                        {bulkErrors.length > 6 && <p>…and {bulkErrors.length - 6} more.</p>}
                      </div>
                    )}
                  </>
                )}
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
                <button type="button" onClick={() => void submitIn()} disabled={busy || resolving || !stockInReady || mismatchList.length > 0}
                  className="w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy ? 'Saving…' : resolving ? 'Checking…' : 'Stock IN'}
                </button>
              </div>
            </div>
            )}

            {tab === 'out' && (
            <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
              <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Stock Out</h3>
              <p className="mt-0.5 text-[11px] text-[#6e6e73]">This writes to inventory + sheet log.</p>
              <button type="button" onClick={() => { setHistorySearch(''); setHistoryOpen(true); }} className="mt-3 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm">
                View Stock Out history ({tabMovements.length})
              </button>
              <div className="mt-4 space-y-3">
                {part ? <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} /> : (
                  <p className="rounded-xl border border-dashed border-[#d2d2d7] px-3 py-3 text-center text-[12px] text-[#6e6e73]">Search above to fill the part automatically.</p>
                )}
                {!outMissingSerial && fieldErrors.serial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.serial}</p>}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Reference number (repair / AR — required)
                  <input value={reference} onChange={(e) => { setReference(e.target.value); setFieldErrors((current) => ({ ...current, reference: undefined })); }} placeholder="e.g. AR-10234"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (stockOutReady && reference.trim()) void submitOut(); } }}
                    className={`mt-1 h-11 w-full rounded-xl border bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10 ${fieldBorder(Boolean(fieldErrors.reference))}`} />
                </label>
                {fieldErrors.reference && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.reference}</p>}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Date
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                </label>
                <button type="button" onClick={() => void submitOut()} disabled={busy || resolving || !stockOutReady || Boolean(masterMissing && !part && masterMissingPartial)}
                  className="w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white disabled:opacity-40">
                  {busy ? 'Saving…' : resolving ? 'Checking…' : 'Stock OUT'}
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
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">{browsingAll ? 'All sites' : site?.name || 'Stock'}</p>
              <input value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Search part, description, or serial"
                className="h-9 w-44 rounded-full border border-[#d2d2d7] bg-white px-3.5 text-[12px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
            </div>
            {/* Drill-down slide track: parts → sites → serials (ALL), parts → serials (site). */}
            <div className="overflow-hidden">
              <div className="flex transition-transform duration-300 ease-out will-change-transform" style={{ transform: `translateX(-${panelDepth * 100}%)` }}>
                <div className="w-full shrink-0">
                  {browsingAll ? (
                    <>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-[15px] font-semibold text-[#1d1d1f]">ALL stock</h2>
                          <p className="mt-1 text-[12px] text-[#6e6e73]">
                            {distinctParts.toLocaleString()} part{distinctParts === 1 ? '' : 's'} · {totalUnits.toLocaleString()} unit{totalUnits === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      {filteredPartTotals.length ? (
                        <div className="mt-3 max-h-[62vh] overflow-auto rounded-xl border border-[#e5e5e7]">
                          <table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Part</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Description</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold">Sites</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold">Serials</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {filteredPartTotals.map((t) => (
                                <tr key={t.partNumber} onClick={() => openPartWorkbench(t.partNumber)} className="cursor-pointer border-t border-[#f0f0f2] transition-colors first:border-t-0 hover:bg-[#f7f7f8]">
                                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{t.partNumber}</td>
                                  <td className="max-w-[280px] truncate px-3 py-2 text-[#3c3c43]" title={t.description || undefined}>{t.description || '—'}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6e6e73]">{t.sites.toLocaleString()}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6e6e73]">{(t.serials || t.quantity).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : 'No stock found.'}</p>
                      )}
                      {filteredPartTotals.length > 0 && <p className="mt-2 text-[11px] text-[#6e6e73]">Tap a row to see its sites.</p>}
                    </>
                  ) : (
                    <>
                      <div className="mt-4 flex items-center justify-between gap-3">
                        <div>
                          <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{site ? `${site.name || site.code} stock` : 'Site stock'}</h2>
                          <p className="mt-1 text-[12px] text-[#6e6e73]">
                            {distinctParts.toLocaleString()} part{distinctParts === 1 ? '' : 's'} · {totalUnits.toLocaleString()} unit{totalUnits === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      {filteredGroups.length ? (
                        <div className="mt-3 max-h-[62vh] overflow-auto rounded-xl border border-[#e5e5e7]">
                          <table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Date</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Part</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Description</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold">Serials</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {filteredGroups.map((u) => (
                                <tr key={u.partNumber} onClick={() => openPartWorkbench(u.partNumber)} className="cursor-pointer border-t border-[#f0f0f2] transition-colors first:border-t-0 hover:bg-[#f7f7f8]">
                                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6e6e73]">{dateOnly(u.date)}</td>
                                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{u.partNumber}</td>
                                  <td className="max-w-[280px] truncate px-3 py-2 text-[#3c3c43]" title={u.description || undefined}>{u.description || '—'}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6e6e73]">{u.serials ? u.serials.toLocaleString() : u.quantity.toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : 'No stock found.'}</p>
                      )}
                      {filteredGroups.length > 0 && <p className="mt-2 text-[11px] text-[#6e6e73]">Tap a row to see its serials.</p>}
                    </>
                  )}
                </div>
                <div className="w-full shrink-0">
                  {browsingAll
                    ? (selectedPart ? (
                      <>
                        <div className="mt-4 flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{selectedPart}</h2>
                            <p className="mt-1 text-[12px] text-[#6e6e73]">
                              {selectedPartSites.length.toLocaleString()} site{selectedPartSites.length === 1 ? '' : 's'} · {selectedPartSites.reduce((n, s) => n + s.serials + (s.serials ? 0 : s.quantity), 0).toLocaleString()} serials
                            </p>
                          </div>
                          <button type="button" onClick={backToParts}
                            className="shrink-0 rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">
                            ‹ All parts
                          </button>
                        </div>
                        {filteredPartSites.length ? (
                          <div className="mt-3 max-h-[62vh] overflow-auto rounded-xl border border-[#e5e5e7]">
                            <table className="w-full min-w-[420px] border-collapse text-left text-[12px]">
                              <thead className="sticky top-0 z-10">
                                <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Site</th>
                                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold">Serials</th>
                                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Date</th>
                                </tr>
                              </thead>
                              <tbody className="bg-white">
                                {filteredPartSites.map((s) => (
                                  <tr key={s.siteCode} onClick={() => setSelectedSite(s.siteCode)} className="cursor-pointer border-t border-[#f0f0f2] transition-colors first:border-t-0 hover:bg-[#f7f7f8]">
                                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{s.siteName || s.siteCode}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6e6e73]">{(s.serials || s.quantity).toLocaleString()}</td>
                                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6e6e73]">{dateOnly(s.date)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : 'No sites hold this part.'}</p>
                        )}
                        {filteredPartSites.length > 0 && <p className="mt-2 text-[11px] text-[#6e6e73]">Tap a site to see its serials.</p>}
                      </>
                    ) : null)
                    : (selectedPart ? renderSerials(
                      partUnits,
                      selectedPart,
                      `${partUnits.filter((u) => u.status === 'in').length} available · ${partUnits.filter((u) => u.status !== 'in').length} out`,
                      backToParts,
                      '← All stock'
                    ) : null)}
                </div>
                <div className="w-full shrink-0">
                  {browsingAll && selectedPart && selectedSite ? renderSerials(
                    workbenchUnits,
                    `${selectedPart} · ${selectedSiteName}`,
                    `${workbenchUnits.filter((u) => u.status === 'in').length} available · ${workbenchUnits.filter((u) => u.status !== 'in').length} out`,
                    backToSites,
                    '‹ Sites'
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-50 bg-[#1d1d1f]/20" role="dialog" aria-modal="true" aria-labelledby="parts-history-title">
          <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)} className="absolute inset-0 h-full w-full cursor-default" />
          <aside className="absolute right-0 top-0 flex h-full w-[min(560px,100vw)] flex-col border-l border-[#e5e5e7] bg-white shadow-[-12px_0_40px_rgba(0,0,0,.12)]">
            <div className="flex items-start justify-between gap-4 border-b border-[#e5e5e7] px-5 py-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">{browsingAll ? 'All sites' : site?.name || ''}</p>
                <h2 id="parts-history-title" className="mt-1 text-[17px] font-semibold text-[#1d1d1f]">Stock {tab === 'in' ? 'In' : 'Out'} history</h2>
                <p className="mt-1 text-[11px] text-[#6e6e73]">{tabMovements.length} movement{tabMovements.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)} className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[16px] leading-5 text-[#6e6e73]">×</button>
            </div>
            <div className="border-b border-[#e5e5e7] p-4">
              <input autoFocus value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search part, serial, reference, or date"
                className="h-10 w-full rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[13px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {filteredHistory.length ? (
                <div className="space-y-2">
                  {filteredHistory.map((movement) => (
                    <div key={movement.id} className="rounded-xl border border-[#e5e5e7] bg-[#f7f7f8] px-3 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[12px] font-semibold text-[#1d1d1f]">{movement.part_number}</span>
                        <span className="text-[10px] text-[#6e6e73]">{dateOnly(movement.occurred_date)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#6e6e73]">
                        <span>{movement.serial || `${movement.quantity.toLocaleString()} unit${movement.quantity === 1 ? '' : 's'}`}</span>
                        {tab === 'out' && <span>Ref: {movement.reference || '—'}</span>}
                        <span>Qty: {movement.quantity.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-[12px] text-[#6e6e73]">No matching movements.</p>
              )}
            </div>
          </aside>
        </div>
      )}

      {((switchingSite && site) || (!site && !gateDismissed)) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1d1d1f]/25 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="parts-site-title">
          <form onSubmit={(event) => { event.preventDefault(); void verifySite(codeInput); }} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_18px_60px_rgba(0,0,0,.16)]">
            <div className="flex items-start justify-between gap-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Parts Inventory</p>
              <button type="button" aria-label="Close" onClick={() => { if (switchingSite) setSwitchingSite(false); else setGateDismissed(true); }}
                className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#3c3c43]">✕</button>
            </div>
            <h2 id="parts-site-title" className="mt-2 text-[22px] font-semibold tracking-tight text-[#1d1d1f]">{switchingSite ? 'Switch site' : 'Which site is this?'}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">{switchingSite && site ? `Currently at ${site.name || site.code}. Enter the new site code — nothing changes until you continue.` : 'Enter your site code. You will only see and move stock for this site.'}</p>
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

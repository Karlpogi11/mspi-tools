import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, recalledPartsSiteCode, setPartsSiteToken, type PartsMasterItem, type PartsMovement, type PartsSite, type PartsUnit } from '../lib/api';
import CameraScanSheet from '../components/parts/CameraScanSheet';
import { useAuth } from '../lib/auth';
import { classifyScanValue, parseStockInWorkbook, parseStockOutWorkbook, todayIso } from '../lib/parts';

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

// Box location standard: {ZONE}-{NN} with overflow suffix per extra box.
// B = batteries, A = displays. 2nd box of B-13 is B-13-B, 3rd is B-13-C.
const LOCATION_PATTERN = /^[A-Z]-\d+(-[B-Z])?$/;

// First letter of the box follows the part family: displays live in A,
// batteries live in B. Keyword anywhere in the description decides.
function locationPrefixForPart(part: { description?: string | null } | null): string | null {
  const text = String(part?.description || '');
  if (/\bbattery\b/i.test(text)) return 'B-';
  if (/\bdisplay\b/i.test(text)) return 'A-';
  return null;
}

function suggestLocation(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (!cleaned) return null;
  if (LOCATION_PATTERN.test(cleaned)) return null;
  // Legacy names: BB13 → B-13-B (2nd box), BC13 → B-13-C (3rd), B13 → B-13.
  // Plain zone+number is tried first so a future zone C ("C13") is not
  // mistaken for an overflow box.
  let m = cleaned.match(/^([A-Z])(\d+)$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = cleaned.match(/^([A-Z])B(\d+)$/);
  if (m) return `${m[1]}-${m[2]}-B`;
  m = cleaned.match(/^([A-Z])C(\d+)$/);
  if (m) return `${m[1]}-${m[2]}-C`;
  return null;
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
  const publicMode = !user;
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
  // Single storage box, prefilled with the family letter (B = batteries,
  // A = displays; 2nd box of B-13 is B-13-B). Type the number after it.
  const [boxLocation, setBoxLocation] = useState('');
  const [movingUnitId, setMovingUnitId] = useState<number | null>(null);
  const [movingValue, setMovingValue] = useState('');
  const [movingBusy, setMovingBusy] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [stock, setStock] = useState<PartsUnit[]>([]);
  const [movementHistory, setMovementHistory] = useState<PartsMovement[]>([]);
  const refreshInFlight = useRef(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [sheetSyncAt, setSheetSyncAt] = useState<string | null>(null);
  const [sheetDrifted, setSheetDrifted] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  // ALL-view drill level 3: serials of the selected part at this site.
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  // Right-panel table search — filters whichever drill level is showing.
  const [tableSearch, setTableSearch] = useState('');
  // Serials workbench filter: show every serial or only the available ones.
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  // Exact serial hit from Find — auto-opens its table with the row marked.
  const [highlightSerial, setHighlightSerial] = useState<string | null>(null);
  const highlightSeenRef = useRef<string | null>(null);
  const [partUnits, setPartUnits] = useState<PartsUnit[]>([]);
  const [partUnitsBusy, setPartUnitsBusy] = useState(false);
  const [stockBusy, setStockBusy] = useState(false);
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
  // Quiet one-line hint under the scan box (ignored aux barcode, part
  // barcode in Stock Out). Never red — the tech just rescans.
  const [scanHint, setScanHint] = useState('');
  // Phone camera smart-scan sheet.
  const [cameraOpen, setCameraOpen] = useState(false);

  const clearAllNotices = () => { setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null); setMasterMissing(null); setScanHint(''); };
  useEffect(() => {
    if (!message && !error) return;
    const timer = window.setTimeout(clearAllNotices, 5000);
    return () => window.clearTimeout(timer);
  }, [message, error]);
  // Auto-prefix the box from the part family (A- for displays, B- for
  // batteries) — only into an empty field, never over typed text, and never
  // refilled after you delete it for the current part.
  const activePartNumber = part?.part_number || null;
  const prefixDismissedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activePartNumber || prefixDismissedFor.current === activePartNumber) return;
    prefixDismissedFor.current = null;
    if (boxLocation.trim()) return;
    const prefix = locationPrefixForPart(part);
    if (prefix) setBoxLocation(prefix);
  }, [activePartNumber]);
  const fieldBorder = (hasError: boolean) => (hasError ? 'border-[#e11d48]' : 'border-[#d2d2d7]');
  const setFieldError = (field: 'scan' | 'serial' | 'unitSerial' | 'reference' | 'lines', message: string) => {
    setError('');
    setFieldErrors((current) => ({ ...current, [field]: message }));
  };
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([]);
  const [gateDismissed, setGateDismissed] = useState(false);
  // Re-checking the remembered site code on open — hides the gate briefly.
  const [restoring, setRestoring] = useState(false);
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
      const result = publicMode
        ? await api.partsPublic.verifySite(code.trim())
        : await api.parts.verifySite(code.trim());
      setSite(result.site); setSiteCode(result.site.code); setSiteToken(result.siteToken);
      setPartsSiteToken(result.siteToken);
      setSelectedPart(null); setPartUnits([]); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]);
      setStock([]); setStockBusy(true);
      setBoxLocation('');
      setSwitchingSite(false);
      setSwitchingSite(false);
      setMessage(`Connected to ${result.site.name}.`);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  // Device memory: on a fresh open, re-verify the saved site code so the tool
  // lands straight in the site — only the code is stored; a fresh 24h token is
  // issued here. Mount-only on purpose: changeSite() shows the gate again and
  // must not auto-restore the old site out from under it.
  useEffect(() => {
    if (site) return;
    const saved = recalledPartsSiteCode();
    if (!saved) return;
    setRestoring(true);
    setStockBusy(true);
    void (async () => {
      let restored = false;
      try {
        const result = publicMode
          ? await api.partsPublic.verifySite(saved)
          : await api.parts.verifySite(saved);
        setSite(result.site); setSiteCode(result.site.code); setSiteToken(result.siteToken);
        setPartsSiteToken(result.siteToken);
        setStock([]);
        restored = true;
        setMessage(`Restored ${result.site.name || result.site.code}.`);
      } catch { /* Unknown/offline — keep the saved code, show the normal gate. */ }
      finally { setRestoring(false); if (!restored) setStockBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSwitchModal = () => {
    setError(''); setCodeInput(''); setGateDismissed(false); setSwitchingSite(true);
  };

  const loadStock = async (code: string) => {
    setStockBusy(true);
    try {
      const result = publicMode && siteToken
        ? await api.partsPublic.stock(siteToken, undefined, true)
        : await api.parts.stock(code, undefined, undefined, true);
      setStock(result.stock);
    } catch (err) { setError((err as Error).message); }
    finally { setStockBusy(false); }
  };

  const loadMovementHistory = async (code: string) => {
    try {
      const result = publicMode && siteToken
        ? await api.partsPublic.recent(siteToken)
        : await api.parts.recent(code);
      setMovementHistory(result.history);
    } catch (err) { setError((err as Error).message); }
  };

  useEffect(() => {
    if (!site) return;
    void loadStock(site.code);
    void loadMovementHistory(site.code);
  }, [site]);
  // Another device may stock in/out while this tab sits open — refresh on
  // return instead of polling, so idle tabs cost the server nothing.
  useEffect(() => {
    if (!site) return;
    const onReturn = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('focus', onReturn);
    return () => { document.removeEventListener('visibilitychange', onReturn); window.removeEventListener('focus', onReturn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, selectedPart]);
  useEffect(() => {
    if (site) scanRef.current?.focus();
  }, [site, tab]);

  const doResolve = async (rawValue: string, field: 'scan' | 'serial' = 'scan'): Promise<{ part: PartsMasterItem | null; unit: PartsUnit | null }> => {
    const value = rawValue.trim().toUpperCase();
    if (!value || !site) return { part: null, unit: null };
    // Smart-scan gate: aux barcodes (lot codes like 2602+H0X, text like
    // CHINA MAINLAND) never resolve, and part numbers never resolve as
    // serials in Stock Out — drop the burst quietly instead of mis-filing.
    const kind = classifyScanValue(value);
    if (kind === 'aux' || (kind === 'part-number' && tab === 'out')) {
      // Drop the burst and reset the box for the next pull: Stock Out
      // keeps no lock, so its card goes too. Focus is returned so the
      // next scan lands in this box even on scanners with a Tab suffix.
      setScan(''); setSerial(''); setUnitSerial('');
      if (tab === 'out') { setPart(null); setPartNumber(''); }
      setScanHint(kind === 'aux' ? 'Ignored — not a serial.' : 'Part barcode — scan the serial.');
      scanRef.current?.focus();
      return { part: null, unit: null };
    }
    setScanHint('');
    const seq = ++resolveSeq.current;
    setResolving(true); setError(''); setMessage(''); setPart(null);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    try {
      const result = publicMode && siteToken
        ? await api.partsPublic.resolve(siteToken, { serial: value, partNumber: value, eee: value })
        : await api.parts.resolve({ serial: value, partNumber: value, eee: value, siteCode: site.code });
      if (seq !== resolveSeq.current) return { part: null, unit: null }; // stale — a newer lookup won
      setPart(result.part);
      // Family prefix straight into an empty box on every resolution.
      // A bare "B-"/"A-" prefix left over from the previous part follows the
      // new family; a full location is never overwritten — and if you deleted
      // the prefix for this part, it stays deleted.
      if (result.part) {
        const prefix = locationPrefixForPart(result.part);
        const code = result.part.part_number || null;
        if (prefix && prefixDismissedFor.current !== code) {
          prefixDismissedFor.current = null;
          setBoxLocation((prev) => {
            const trimmed = prev.trim().toUpperCase();
            if (!trimmed) return prefix;
            if (/^[AB]-$/.test(trimmed) && trimmed !== prefix.toUpperCase()) return prefix;
            return prev;
          });
        }
      }
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
        // Stock IN only: a searched part number locks the part and hands
        // over to the multiline serial box. Stock OUT takes unit serials,
        // so the input must stay visible — never wipe it into an orphan card.
        if (searchedPartNumber && resolvedSerialized && tab === 'in') {
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
      void (publicMode ? api.partsPublic.master(q, 50) : api.parts.master(q, 50))
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
    if (!site || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await loadStock(site.code);
      await loadMovementHistory(site.code);
      if (selectedPart) await loadPartUnits(selectedPart, true);
    } finally { refreshInFlight.current = false; }
  };

  const formatSheetTime = (value: string | null) =>
    value ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(value)) : null;

  // Sheet → web replay, mirroring the Frontline Monitor strategy: prominent
  // control, last-synced label, quiet auto-sync while visible.
  const syncSheet = async (quiet: boolean) => {
    if (!site || site.code === 'ALL' || syncingSheet) return null;
    setSyncingSheet(true);
    try {
      const result = await api.parts.syncFromSheet(site.code, quiet);
      if (!result.skipped) {
        try { setSheetSyncAt((await api.parts.sheetStatus()).lastSheetSyncAt); } catch { /* Label is optional. */ }
        await refresh();
      }
      return result;
    } finally { setSyncingSheet(false); }
  };

  const manualSheetSync = async () => {
    try {
      const result = await syncSheet(false);
      setSheetDrifted(false);
      if (result && !result.skipped) {
        const dupNote = result.duplicates
          ? ` · skipped ${result.duplicates} duplicate row${result.duplicates === 1 ? '' : 's'}`
          : '';
        setMessage(`Sheet sync finished — ${result.parts.toLocaleString()} part${result.parts === 1 ? '' : 's'} updated${dupNote}.`);
      } else if (result?.skipped) {
        setMessage('Sheet sync ran moments ago — no changes to apply.');
      }
    } catch (err) { setError((err as Error).message); }
  };

  // Cheap drift check (one Drive metadata read): only replay when the sheet
  // actually changed since the last sync, so most cycles cost nothing.
  const checkDriftAndSync = async () => {
    if (!site || site.code === 'ALL') return;
    let drift;
    try { drift = await api.parts.sheetDrift(); }
    catch { return; }
    if (!drift.changed) { setSheetDrifted(false); return; }
    setSheetDrifted(true);
    const result = await syncSheet(true);
    if (result && !result.skipped) setSheetDrifted(false);
  };

  useEffect(() => {
    if (!isAdmin || !site || site.code === 'ALL') { if (!isAdmin) setSheetSyncAt(null); return; }
    void api.parts.sheetStatus().then((status) => setSheetSyncAt(status.lastSheetSyncAt)).catch(() => undefined);
    void checkDriftAndSync().catch(() => undefined);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void checkDriftAndSync().catch(() => undefined);
    }, 300_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, site]);

  const loadPartUnits = async (partNumber: string, silent = false) => {
    if (!site) return;
    if (!silent) setPartUnitsBusy(true);
    try {
      const result = publicMode && siteToken
        ? await api.partsPublic.partUnits(siteToken, partNumber)
        : await api.parts.partUnits(site.code, partNumber);
      setPartUnits(result.units);
    } catch (err) { setError((err as Error).message); }
    finally { if (!silent) setPartUnitsBusy(false); }
  };

  const openPartWorkbench = (partNumber: string, highlight: string | null = null) => {
    setSelectedPart(partNumber);
    setSelectedSite(null);
    setHighlightSerial(highlight);
    if (!highlight) highlightSeenRef.current = null;
    void loadPartUnits(partNumber);
  };

  // Move stock between boxes without stocking in/out: quantity untouched,
  // no movement written. Non-serialized buckets merge when the destination
  // box already holds the same part.
  const saveMove = async (unitId: number) => {
    if (movingBusy) return;
    const target = movingValue.trim();
    if (!target) return;
    setMovingBusy(true);
    try {
      const result = await api.parts.relocateUnit(unitId, target);
      setMessage(result.message);
      setMovingUnitId(null);
      setMovingValue('');
      if (selectedPart) await loadPartUnits(selectedPart, true);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMovingBusy(false);
    }
  };

  const backToParts = () => { setSelectedPart(null); setSelectedSite(null); setPartUnits([]); };
  const backToSites = () => { setSelectedSite(null); };

  // Serials workbench shared by single-site level 2 and ALL level 3.
  const renderSerials = (units: PartsUnit[], title: string, subtitle: string, onBack: () => void, backLabel: string) => {
    const searchFiltered = tableTerms.length
      ? units.filter((u) => tableTerms.every((t) => (u.serial || '').toLowerCase().includes(t)))
      : units;
    const shownUnits = onlyAvailable ? searchFiltered.filter((u) => u.status === 'in') : searchFiltered;
    const description = selectedPartDescription || units.find((u) => u.description)?.description || '';
    // Same family prefix inside the Set-box editor when opening it empty.
    const familyPrefix = locationPrefixForPart({ description }) || '';
    return (
    <>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div>
          {description && <h2 className="text-[15px] font-semibold text-[#1d1d1f]">{description}</h2>}
          <p className="mt-0.5 text-[13px] text-[#3c3c43]">{title}</p>
          <p className="mt-1 text-[12px] text-[#6e6e73]">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-full bg-[#f5f5f7] p-0.5 text-[11px] font-semibold" role="group" aria-label="Filter serials">
            <button type="button" onClick={() => setOnlyAvailable(false)} aria-pressed={!onlyAvailable}
              className={`rounded-full px-2.5 py-1 ${!onlyAvailable ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73]'}`}>
              All
            </button>
            <button type="button" onClick={() => setOnlyAvailable(true)} aria-pressed={onlyAvailable}
              className={`rounded-full px-2.5 py-1 ${onlyAvailable ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73]'}`}>
              Available
            </button>
          </div>
          <button type="button" onClick={onBack}
            className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">
            {backLabel}
          </button>
        </div>
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
                <th className="px-3 py-2 font-semibold">Location</th>
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
                    <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">
                      {!available ? '—' : movingUnitId === u.id ? (
                        <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            value={movingValue}
                            onChange={(e) => setMovingValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void saveMove(u.id); }
                              if (e.key === 'Escape') { setMovingUnitId(null); setMovingValue(''); }
                            }}
                            placeholder="e.g. B-13-B"
                            autoFocus
                            aria-label={`New location for ${u.serial || u.part_number}`}
                            className="h-8 w-28 rounded-lg border border-[#2563eb] bg-white px-2 text-[12px] text-[#1d1d1f] outline-none"
                          />
                          <button type="button" disabled={movingBusy || !movingValue.trim()} onClick={() => void saveMove(u.id)} className="rounded-lg bg-[#1d1d1f] px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">Save</button>
                          <button type="button" onClick={() => { setMovingUnitId(null); setMovingValue(''); }} className="rounded-lg px-2 py-1 text-[11px] text-[#6e6e73] hover:bg-[#f5f5f7]">Cancel</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {u.location || '—'}
                          {!publicMode && (
                            <button
                              type="button"
                              title={u.location ? `Change box for ${u.serial || u.part_number} (no stock change)` : `Set box for ${u.serial || u.part_number}`}
                              onClick={() => { setMovingUnitId(u.id); setMovingValue(u.location || familyPrefix); }}
                              className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#2563eb] hover:bg-[#eff6ff]"
                            >
                              Set
                            </button>
                          )}
                        </span>
                      )}
                      {movingUnitId === u.id && suggestLocation(movingValue) && (
                        <span className="mt-1 block text-[10px] text-[#92400e]">
                          Did you mean <span className="font-mono font-semibold">{suggestLocation(movingValue)}</span>?{' '}
                          <button type="button" onClick={() => setMovingValue(suggestLocation(movingValue)!)} className="cursor-pointer font-semibold underline underline-offset-2">Use it</button>
                        </span>
                      )}
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
        <p className="py-6 text-center text-[12px] text-[#6e6e73]">
          {tableTerms.length ? 'No matches.' : onlyAvailable ? 'No available serials.' : 'No serials recorded for this part.'}
        </p>
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
            <span className="flex items-center justify-between gap-2">
              <span>{label}</span>
              <button type="button" onClick={() => setCameraOpen(true)} aria-label="Scan serial with camera"
                className="rounded-full bg-[#1d1d1f] px-2.5 py-1 text-[10px] font-semibold text-white">
                Scan
              </button>
            </span>
            <input ref={scanRef} value={scan} autoFocus={Boolean(site)}
              onChange={(e) => {
                const value = e.target.value.toUpperCase().replace(/[\r\n]+/g, '');
                setScan(value);
                setShowSuggest(true);
                setFieldErrors((current) => ({ ...current, scan: undefined }));
                setOutMissingSerial(null); setMismatchList([]);
                if (!value.trim()) {
                  // Stock IN keeps the locked part and its serial lines;
                  // Stock OUT has no lock — empty box means no part card.
                  setSerial(''); setUnitSerial('');
                  setMasterMissing(null);
                  if (variant === 'out') { setPart(null); setPartNumber(''); }
                  return;
                }
                // NOTE: no shape-filtering here on purpose — a scanner burst
                // arrives keystroke by keystroke and any prefix looks like
                // aux. Classification runs only on the completed burst
                // (Enter / idle auto-resolve inside doResolve).
                setScanHint('');
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
        {scanHint && <p className="mt-1.5 text-[11px] text-[#6e6e73]">{scanHint}</p>}
        {fieldErrors.scan && !(masterMissing && !part && tab === 'in') && (          <p role="alert" className="mt-1.5 text-[11px] leading-4 text-[#b91c1c]">
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
        const result = await api.parts.stockIn({ siteCode: site.code, partNumber: pn, serials, occurredDate: date, location: boxLocation });
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
        location: boxLocation,
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
      // The OUT form has no location field; the Stock IN box keeps its value
      // so the next stock-in reuses the same box without retyping.
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
  // Warn-only location check: anything may still be saved, but legacy names
  // get a one-click correction toward the ZONE-NN(-X) standard.
  const locationSuggestion = boxLocation.trim() ? suggestLocation(boxLocation) : null;
  const tabMovements = movementHistory.filter((movement) => movement.type === (tab === 'in' ? 'IN' : 'OUT'));
  const filteredHistory = tabMovements.filter((movement) => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return true;
    return `${movement.part_number} ${movement.serial || ''} ${movement.reference || ''} ${movement.occurred_date}`.toLowerCase().includes(query);
  });
  const stockGroups = useMemo(() => {
    // Single site: one row per part. ALL view: one row per site+part so the
    // site list is visible instead of merged away. Out units are included
    // (includeOut) so a part that hit 0 stays listed — they never count
    // toward available serials/quantity and are dated by when they left.
    const groups = new Map<string, { partNumber: string; description: string | null | undefined; serials: number; quantity: number; date: string | null | undefined; siteCode: string; siteName: string | undefined; serialKey: string; locations: Set<string> }>();
    for (const unit of stock) {
      const key = browsingAll ? `${unit.site_code}||${unit.part_number}` : unit.part_number;
      const inStock = unit.status === 'in';
      const group = groups.get(key) || { partNumber: unit.part_number, description: unit.description, serials: 0, quantity: 0, date: null, siteCode: unit.site_code, siteName: unit.site_name, serialKey: '', locations: new Set<string>() };
      if (unit.serial) {
        group.serialKey += ` ${unit.serial}`;
        if (inStock) group.serials += 1;
      } else if (inStock) {
        group.quantity += unit.quantity;
      }
      if (unit.location) group.locations.add(unit.location);
      const activity = !inStock && unit.stocked_out_at ? unit.stocked_out_at.slice(0, 10) : unit.occurred_date;
      if (!group.date || (activity && activity > group.date)) group.date = activity;
      groups.set(key, group);
    }
    const byDesc = (a: { description: string | null | undefined; partNumber: string }, b: { description: string | null | undefined; partNumber: string }) =>
      (a.description || '').toLowerCase().localeCompare((b.description || '').toLowerCase()) || a.partNumber.localeCompare(b.partNumber);
    return [...groups.values()].sort((a, b) => browsingAll && a.siteCode !== b.siteCode ? a.siteCode.localeCompare(b.siteCode) : byDesc(a, b));
  }, [stock, browsingAll]);
  // Distinct parts with stock vs parts fully out — in the ALL view one part
  // spans several site rows, so count part numbers, not groups.
  const partCounts = useMemo(() => {
    const all = new Set<string>();
    const stocked = new Set<string>();
    for (const g of stockGroups) {
      all.add(g.partNumber);
      if (g.serials > 0 || g.quantity > 0) stocked.add(g.partNumber);
    }
    return { stocked: stocked.size, out: all.size - stocked.size };
  }, [stockGroups]);
  const distinctParts = partCounts.stocked;
  const outParts = partCounts.out;
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
      const inStock = u.status === 'in';
      const s = bySite.get(u.site_code) || { siteCode: u.site_code, siteName: u.site_name, serials: 0, quantity: 0, date: null };
      if (u.serial) {
        if (inStock) s.serials += 1;
      } else if (inStock) {
        s.quantity += u.quantity;
      }
      const activity = !inStock && u.stocked_out_at ? u.stocked_out_at.slice(0, 10) : u.occurred_date;
      if (!s.date || (activity && activity > s.date)) s.date = activity;
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
  // Description for the selected part's headers (part-units response also
  // carries it, but the stock-derived list survives empty workbenches).
  const selectedPartDescription = useMemo(
    () => stockPartTotals.find((t) => t.partNumber === selectedPart)?.description || '',
    [stockPartTotals, selectedPart]
  );
  const panelDepth = !selectedPart ? 0 : browsingAll ? (selectedSite ? 2 : 1) : 1;
  // Search resets on every drill or site move — it always applies to one level —
  // except an exact-serial jump, which keeps its text to isolate the jumped row.
  const suppressSearchReset = useRef(false);
  useEffect(() => {
    if (suppressSearchReset.current) { suppressSearchReset.current = false; return; }
    setTableSearch('');
  }, [selectedPart, selectedSite, site]);
  // Exact serial typed in the panel search jumps straight to its table.
  useEffect(() => {
    const q = tableSearch.trim().toUpperCase();
    if (q.length < 4 || !site) return;
    const hit = stock.find((u) => (u.serial || '').toUpperCase() === q);
    if (!hit) return;
    if (selectedPart === hit.part_number && (!browsingAll || selectedSite === hit.site_code)) return;
    suppressSearchReset.current = true;
    // An OUT serial would stay hidden behind the Available filter — force All.
    setOnlyAvailable(false);
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
  const tableQuery = tableSearch.trim().toLowerCase();
  const matchGroup = (g: { siteCode: string; partNumber: string; description: string | null | undefined; serialKey: string; locations: Set<string> }) => {
    if (!tableQuery) return true;
    const allFields = `${g.siteCode} ${g.partNumber} ${g.description || ''} ${g.serialKey} ${[...g.locations].join(' ')}`.toLowerCase();
    // Single term: match across all fields (part number, serial, description)
    if (tableTerms.length <= 1) return allFields.includes(tableQuery);
    // Multi-term: full phrase must match description
    return (g.description || '').toLowerCase().includes(tableQuery);
  };
  const filteredGroups = useMemo(
    () => stockGroups.filter(matchGroup),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockGroups, tableSearch]
  );
  const filteredPartTotals = useMemo(
    () => {
      if (!tableQuery) return stockPartTotals;
      return stockPartTotals.filter((t) => {
        const allFields = `${t.partNumber} ${t.description || ''} ${t.serialKey}`.toLowerCase();
        if (tableTerms.length <= 1) return allFields.includes(tableQuery);
        return (t.description || '').toLowerCase().includes(tableQuery);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockPartTotals, tableSearch]
  );
  const filteredPartSites = useMemo(
    () => (tableTerms.length ? selectedPartSites.filter((s) => tableTerms.every((t) => `${s.siteCode} ${s.siteName || ''}`.toLowerCase().includes(t))) : selectedPartSites),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPartSites, tableSearch]
  );
  const changeSite = () => { manualPartRef.current = false; setSite(null); setSiteCode(''); setSiteToken(''); setPartsSiteToken(''); setCodeInput(''); setStock([]); setSelectedPart(null); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]); setPartUnits([]); setGateDismissed(false); setBoxLocation(''); };
  const browseAll = () => {
    setSwitchingSite(false);
    // Drop the previous site's workbench/stock so nothing stale lingers.
    setSelectedPart(null); setSelectedSite(null); setHighlightSerial(null); setMismatchList([]); setPartUnits([]); setStock([]); setStockBusy(true);
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
        <div className={`grid gap-5 ${publicMode && site ? '' : 'lg:grid-cols-2'}`}>
          {!(publicMode && site) && (
          <section className="rounded-2xl bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Parts Inventory</h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">
                  {publicMode ? 'View stock levels by site.' : 'Scan a serial or part number, then stock it in or out.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {publicMode && (
                  <Link to="/login?returnTo=/parts" className="shrink-0 rounded-full bg-[#1d1d1f] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#333] transition-colors">
                    Sign in
                  </Link>
                )}
            {site ? (
                <button type="button" onClick={openSwitchModal} className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#3c3c43]">
                  {site.name || site.code} · switch
                </button>
              ) : (
                <button type="button" onClick={() => { setGateDismissed(false); setSwitchingSite(false); }} className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[10px] font-semibold text-[#3c3c43]">
                  Select site
                </button>
              )}
              </div>
            </div>

            {(!site && (gateDismissed || restoring)) ? (
              restoring ? (
                <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
                  <p className="text-[13px] font-semibold text-[#1d1d1f]">Restoring saved site…</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Re-checking this device’s remembered site code.</p>
                </div>
              ) : (
              <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
                <p className="text-[13px] font-semibold text-[#1d1d1f]">Select a site to begin</p>
                <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">
                  {publicMode
                    ? 'Enter your site code to view stock levels.'
                    : 'Enter your site code. You will only see and move stock for this site.'}
                </p>
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
              )
            ) : browsingAll ? (
              <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
                <p className="text-[13px] font-semibold text-[#1d1d1f]">Read-only view</p>
                <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">You are browsing stock across all sites. Enter a site code to stock in or out.</p>
                <button type="button" onClick={changeSite} className="mt-3 w-full rounded-2xl bg-[#1d1d1f] py-2.5 text-[12px] font-semibold text-white">
                  Enter site code
                </button>
              </div>
            ) : publicMode ? (
            null
            ) : (
            <>
            <div className="mt-4 border-b border-[#e5e5e7]">
              <div className="flex gap-5" role="tablist" aria-label="Parts operations">
                {([['in', 'Stock In'], ['out', 'Stock Out']] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => {
                    setTab(key); setError(''); setMessage(''); setFieldErrors({}); setOutMissingSerial(null); setMismatchList([]); setScanHint(''); manualPartRef.current = false;
                    if (key !== 'in') { setMasterMissing(null); setQuickDescription(''); }
                    // A part locked by Stock IN (empty search bar) must not
                    // leak into Stock OUT as an orphan card.
                    if (key === 'out' && !scan.trim()) { setPart(null); setPartNumber(''); setSerial(''); setUnitSerial(''); return; }
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
            <CameraScanSheet open={cameraOpen} tab={tab} onClose={() => setCameraOpen(false)} onAccept={(value) => {
              setCameraOpen(false);
              setScan(value); setSerial(value); setUnitSerial(value);
              setScanHint(''); setMasterMissing(null);
              void doResolve(value, 'scan');
            }} />

            {tab === 'in' && (
            <div className="mt-4 rounded-2xl bg-[#f7f7f8] p-4">
              <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Stock In</h3>
              <button type="button" onClick={() => { setHistorySearch(''); setHistoryOpen(true); }} className="mt-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm">
                View Stock In history ({tabMovements.length})
              </button>
              <div className="mt-4 space-y-3">
                {part && (scan.trim() || serial.trim() || unitSerial.trim() || lineSerials.length > 0) ? <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} /> : masterMissing ? (
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
                ) : null}
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
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Location (box — B = batteries, A = displays, 2nd box adds a letter: B-13-B)
                  <input value={boxLocation} onChange={(e) => { const v = e.target.value; setBoxLocation(v); if (!v.trim()) prefixDismissedFor.current = part?.part_number || null; }} placeholder="e.g. B-13, B-13-B"
                    className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[14px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
                </label>
                {locationSuggestion && (
                  <p className="rounded-xl border border-[#fde68a] bg-[#fffbeb] px-3 py-2 text-[11px] leading-4 text-[#92400e]">
                    Did you mean <span className="font-mono font-semibold">{locationSuggestion}</span>?{' '}
                    <button type="button" onClick={() => setBoxLocation(locationSuggestion)} className="cursor-pointer font-semibold underline underline-offset-2 hover:opacity-70">Use {locationSuggestion}</button>
                  </p>
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
              <button type="button" onClick={() => { setHistorySearch(''); setHistoryOpen(true); }} className="mt-2 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm">
                View Stock Out history ({tabMovements.length})
              </button>
              <div className="mt-4 space-y-3">
                {part && (scan.trim() || serial.trim()) && <PartResultCard part={part} nonSerialized={Boolean(nonSerialized)} />}
                {!outMissingSerial && fieldErrors.serial && <p role="alert" className="text-[11px] leading-4 text-[#b91c1c]">{fieldErrors.serial}</p>}
                <label className="block text-[11px] font-semibold text-[#3c3c43]">Reference
                  <input value={reference} onChange={(e) => { setReference(e.target.value); setFieldErrors((current) => ({ ...current, reference: undefined })); }} placeholder="AR / repair #"
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
                <button type="button" onClick={() => void api.parts.downloadTemplate('in')} className="rounded-xl border border-[#d2d2d7] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">IN template</button>
                <button type="button" onClick={() => void api.parts.downloadTemplate('out')} className="rounded-xl border border-[#d2d2d7] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">OUT template</button>
                <button type="button" onClick={() => fileInRef.current?.click()} disabled={busy} className="rounded-xl border border-[#d2d2d7] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] disabled:opacity-40">Import IN</button>
                <button type="button" onClick={() => fileOutRef.current?.click()} disabled={busy} className="rounded-xl border border-[#d2d2d7] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] disabled:opacity-40">Import OUT</button>
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
          )}

          <section className={`h-full overflow-y-auto rounded-2xl bg-white p-4 ${publicMode && site ? 'col-span-2' : ''}`}>
            <div className="flex items-center gap-3 border-b border-[#e5e5e7] pb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[15px] font-semibold text-[#1d1d1f]">{browsingAll ? 'All sites' : site?.name || 'Stock'}</h2>
                  {site && (
                    <button type="button" onClick={openSwitchModal} className="shrink-0 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-semibold text-[#3c3c43]">
                      switch
                    </button>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-[#6e6e73]">
                  {distinctParts.toLocaleString()} part{distinctParts === 1 ? '' : 's'} · {totalUnits.toLocaleString()} unit{totalUnits === 1 ? '' : 's'}{outParts > 0 ? ` · ${outParts.toLocaleString()} out` : ''}{isAdmin && sheetSyncAt && formatSheetTime(sheetSyncAt) ? ` · sheet ${formatSheetTime(sheetSyncAt)}` : ''}
                </p>
              </div>
              {isAdmin && site && site.code !== 'ALL' && (
                <button type="button" onClick={() => void manualSheetSync()} disabled={syncingSheet} aria-label="Sync stock from Google Sheet" title="Sync stock from Google Sheet" className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#1d1d1f] px-3 text-[11px] font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                  <svg className={`h-3.5 w-3.5 ${syncingSheet ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg>
                  {syncingSheet ? 'Syncing…' : 'Sheet sync'}
                </button>
              )}
              {isAdmin && site && site.code !== 'ALL' && sheetDrifted && !syncingSheet && (
                <button type="button" onClick={() => void manualSheetSync()} title="The Google Sheet changed since the last sync" className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#fef3c7] px-3 text-[11px] font-semibold text-[#92400e] hover:bg-[#fde68a]">
                  <span className="h-2 w-2 rounded-full bg-[#d97706]" aria-hidden="true" />
                  Sheet changed
                </button>
              )}
              <input value={tableSearch} onChange={(e) => setTableSearch(e.target.value.replace(/[\r\n]+/g, ''))} placeholder="Search"
                className="h-8 w-40 shrink-0 rounded-full border border-[#d2d2d7] bg-white px-3 text-[12px] outline-none placeholder:text-[#9a9aa1] focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10" />
            </div>
            {/* Drill-down slide track: parts → sites → serials (ALL), parts → serials (site). */}
            <div className="overflow-hidden">
              <div className="flex transition-transform duration-300 ease-out will-change-transform" style={{ transform: `translateX(-${panelDepth * 100}%)` }}>
                <div className="w-full shrink-0">
                  {browsingAll ? (
                    <>
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
                        <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : stockBusy && !stock.length ? 'Loading stock…' : 'No stock found.'}</p>
                      )}
                      {filteredPartTotals.length > 0 && <p className="mt-2 text-[11px] text-[#6e6e73]">Tap a row to see its sites.</p>}
                    </>
                  ) : (
                    <>
                      {filteredGroups.length ? (
                        <div className="mt-3 max-h-[62vh] overflow-auto rounded-xl border border-[#e5e5e7]">
                          <table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Date</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Description</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Part</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Location</th>
                                <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold">Serials</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white">
                              {filteredGroups.map((u) => (
                                <tr key={u.partNumber} onClick={() => openPartWorkbench(u.partNumber)} className="cursor-pointer border-t border-[#f0f0f2] transition-colors first:border-t-0 hover:bg-[#f7f7f8]">
                                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6e6e73]">{dateOnly(u.date)}</td>
                                  <td className="max-w-[320px] truncate px-3 py-2 font-semibold text-[#1d1d1f]" title={u.description || undefined}>{u.description || '—'}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{u.partNumber}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{u.locations.size ? [...u.locations].join(', ') : '—'}</td>
                                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6e6e73]">{(u.serials || u.quantity).toLocaleString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="py-6 text-center text-[12px] text-[#6e6e73]">{tableTerms.length ? 'No matches.' : stockBusy && !stock.length ? 'Loading stock…' : 'No stock found.'}</p>
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
                            {selectedPartDescription && <p className="mt-0.5 text-[13px] text-[#3c3c43]">{selectedPartDescription}</p>}
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
                        {movement.location && <span>Loc: {movement.location}</span>}
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

      {((switchingSite && site) || (!site && !gateDismissed && !restoring)) && (
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

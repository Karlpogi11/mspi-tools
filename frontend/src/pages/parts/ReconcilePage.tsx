import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, recalledPartsSiteCode, setPartsSiteToken, type PartsMasterItem, type PartsSite, type PartsUnit } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { classifyScanValue, todayIso } from '../../lib/parts';

type StatusKind = 'in' | 'out' | 'missing' | 'mismatch' | 'noserial' | 'unknown';

interface ReconcileEntry {
  id: string;
  partNumber: string;
  serial: string;
  description: string;
  scannedAt: string;
}

const storageKey = (code: string) => `mspi.parts.reconcile.v1:${code}`;

const STATUS_STYLES: Record<StatusKind, { label: string; className: string }> = {
  in: { label: 'In system', className: 'bg-[#eef7ee] text-[#2f6b3a]' },
  out: { label: 'Out in system', className: 'bg-[#f5f5f7] text-[#6e6e73]' },
  missing: { label: 'Not in system', className: 'bg-[#fdf2f2] text-[#a33a3a]' },
  mismatch: { label: 'Part mismatch', className: 'bg-[#fdf6ec] text-[#9a6700]' },
  noserial: { label: 'No serial', className: 'bg-[#f5f5f7] text-[#6e6e73]' },
  unknown: { label: 'Not checked', className: 'bg-[#f5f5f7] text-[#6e6e73]' },
};

function StatusChip({ kind }: { kind: StatusKind }) {
  const style = STATUS_STYLES[kind];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${style.className}`}>{style.label}</span>;
}

function writeEntries(code: string, entries: ReconcileEntry[]) {
  try {
    window.localStorage.setItem(storageKey(code), JSON.stringify(entries));
  } catch {
    // Keep scanning even when browser storage is unavailable.
  }
}

function readEntries(code: string): ReconcileEntry[] {
  try {
    const raw = window.localStorage.getItem(storageKey(code));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is ReconcileEntry => {
      if (!row || typeof row !== 'object') return false;
      const item = row as Partial<ReconcileEntry>;
      return typeof item.id === 'string'
        && typeof item.partNumber === 'string'
        && typeof item.serial === 'string'
        && typeof item.description === 'string'
        && typeof item.scannedAt === 'string';
    });
  } catch {
    return [];
  }
}

function formatScannedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const text = rows.map((row) => row.map((cell) => {
    const value = String(cell ?? '');
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const valueClass = tone === 'good'
    ? 'text-[#2f6b3a]'
    : tone === 'warn'
      ? 'text-[#9a6700]'
      : tone === 'bad'
        ? 'text-[#a33a3a]'
        : 'text-[#1d1d1f]';
  return (
    <div className="rounded-xl border border-[#e5e5e7] bg-white px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[#86868b]">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums leading-none ${valueClass}`}>{value.toLocaleString()}</p>
    </div>
  );
}

export default function PartsReconcilePage() {
  const { user, loading: authLoading } = useAuth();
  const publicMode = !user;
  const [site, setSite] = useState<PartsSite | null>(null);
  const [siteToken, setSiteTokenState] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dataError, setDataError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [masterByPart, setMasterByPart] = useState<Map<string, PartsMasterItem>>(() => new Map());
  const [unitBySerial, setUnitBySerial] = useState<Map<string, PartsUnit>>(() => new Map());
  const [stockLoaded, setStockLoaded] = useState(false);
  const [entries, setEntries] = useState<ReconcileEntry[]>([]);
  const [partNumber, setPartNumber] = useState('');
  const [serial, setSerial] = useState('');
  const [scanError, setScanError] = useState('');
  const [resolvingSerial, setResolvingSerial] = useState('');
  const [search, setSearch] = useState('');
  const partInputRef = useRef<HTMLInputElement>(null);
  const serialInputRef = useRef<HTMLInputElement>(null);
  const restoreAttemptedRef = useRef(false);
  const hydratedSiteRef = useRef<string | null>(null);
  const loadIdRef = useRef(0);
  const resolveGenerationRef = useRef(0);
  const scannedSerialsRef = useRef<Set<string>>(new Set());
  const autoFilledPartRef = useRef<string | null>(null);

  const loadSiteData = useCallback(async (target: PartsSite, token: string) => {
    const loadId = ++loadIdRef.current;
    setDataError('');
    try {
      const [masterResult, stockResult] = await Promise.allSettled([
        publicMode ? api.partsPublic.master(undefined, 12000) : api.parts.master(undefined, 12000),
        publicMode
          ? api.partsPublic.stock(token, undefined, true)
          : api.parts.stock(target.code, undefined, 12000, true),
      ]);
      if (loadId !== loadIdRef.current) return;
      const failures: string[] = [];
      if (masterResult.status === 'fulfilled') {
        const nextMaster = new Map<string, PartsMasterItem>();
        for (const item of masterResult.value.items) nextMaster.set(item.part_number.trim().toUpperCase(), item);
        setMasterByPart(nextMaster);
      } else {
        failures.push('parts master');
      }
      if (stockResult.status === 'fulfilled') {
        const nextUnits = new Map<string, PartsUnit>();
        for (const unit of stockResult.value.stock) {
          if (unit.serial) nextUnits.set(unit.serial.trim().toUpperCase(), unit);
        }
        setUnitBySerial(nextUnits);
        setStockLoaded(true);
      } else {
        failures.push('system stock');
      }
      if (failures.length) {
        setDataError(`Could not load ${failures.join(' and ')}. Scans are still saved on this device.`);
      }
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      setDataError((err as Error).message || 'Could not load system stock.');
    }
  }, [publicMode]);

  const connect = useCallback(async (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const result = publicMode ? await api.partsPublic.verifySite(code) : await api.parts.verifySite(code);
      const storedEntries = readEntries(result.site.code);
      autoFilledPartRef.current = null;
      const knownSerials = new Set<string>();
      for (const entry of storedEntries) {
        const serialNumber = entry.serial.toUpperCase();
        if (serialNumber) knownSerials.add(serialNumber);
      }
      scannedSerialsRef.current = knownSerials;
      hydratedSiteRef.current = result.site.code;
      setSite(result.site);
      setSiteTokenState(result.siteToken);
      setPartsSiteToken(result.siteToken);
      setEntries(storedEntries);
      resolveGenerationRef.current += 1;
      setResolvingSerial('');
      setMasterByPart(new Map());
      setUnitBySerial(new Map());
      setStockLoaded(false);
      setPartNumber('');
      setSerial('');
      setScanError('');
      setSearch('');
      setNotice(`Connected to ${result.site.name || result.site.code}.`);
      await loadSiteData(result.site, result.siteToken);
    } catch (err) {
      setError((err as Error).message || 'Could not connect to that site.');
    } finally {
      setConnecting(false);
      setRestoring(false);
    }
  }, [loadSiteData, publicMode]);

  useEffect(() => {
    if (authLoading || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    const saved = recalledPartsSiteCode();
    if (!saved) return;
    setRestoring(true);
    void connect(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading]);

  const publicModeRef = useRef(publicMode);
  useEffect(() => {
    if (publicModeRef.current === publicMode) return;
    publicModeRef.current = publicMode;
    if (!site) return;
    void connect(site.code);
  }, [publicMode, site, connect]);

  useEffect(() => {
    if (!site || hydratedSiteRef.current !== site.code) return;
    writeEntries(site.code, entries);
  }, [entries, site]);

  const currentPart = useMemo(() => {
    const key = partNumber.trim().toUpperCase();
    return key ? masterByPart.get(key) ?? null : null;
  }, [partNumber, masterByPart]);

  const statusFor = useCallback((entry: ReconcileEntry): StatusKind => {
    if (!stockLoaded) return 'unknown';
    if (!entry.serial) return 'noserial';
    const unit = unitBySerial.get(entry.serial.toUpperCase());
    if (!unit) return 'missing';
    if (unit.part_number.trim().toUpperCase() !== entry.partNumber.trim().toUpperCase()) return 'mismatch';
    return unit.status === 'in' ? 'in' : 'out';
  }, [stockLoaded, unitBySerial]);

  const stats = useMemo(() => {
    const counts: Record<StatusKind, number> = { in: 0, out: 0, missing: 0, mismatch: 0, noserial: 0, unknown: 0 };
    const parts = new Set<string>();
    for (const entry of entries) {
      parts.add(entry.partNumber.trim().toUpperCase());
      counts[statusFor(entry)] += 1;
    }
    return { scanned: entries.length, parts: parts.size, ...counts };
  }, [entries, statusFor]);

  const scannedSerials = useMemo(
    () => new Set(entries.filter((entry) => entry.serial).map((entry) => entry.serial.toUpperCase())),
    [entries],
  );

  const systemInStock = useMemo(
    () => [...unitBySerial.values()].filter((unit) => unit.status === 'in' && unit.serial),
    [unitBySerial],
  );

  const missingUnits = useMemo(
    () => systemInStock
      .filter((unit) => !scannedSerials.has(String(unit.serial).toUpperCase()))
      .sort((a, b) => a.part_number.localeCompare(b.part_number) || String(a.serial).localeCompare(String(b.serial))),
    [systemInStock, scannedSerials],
  );

  const filteredEntries = useMemo(() => {
    const terms = search.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return entries;
    return entries.filter((entry) => {
      const haystack = `${entry.partNumber} ${entry.serial} ${entry.description}`.toUpperCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [entries, search]);

  const addEntry = () => {
    if (!site) return;
    const rawPart = partNumber.trim();
    if (!rawPart) {
      setScanError('Scan or enter a part number first.');
      partInputRef.current?.focus();
      return;
    }
    const master = masterByPart.get(rawPart.toUpperCase()) ?? null;
    const part = master?.part_number.trim() || rawPart;
    const serialNumber = serial.replace(/\s+/g, '').toUpperCase();
    const serialized = String(master?.serialized ?? 'Y').toUpperCase() !== 'N';
    if (serialized && !serialNumber) {
      setScanError('Scan or enter the serial number.');
      serialInputRef.current?.focus();
      return;
    }
    if (serialNumber && scannedSerialsRef.current.has(serialNumber)) {
      setScanError(`Duplicate serial: ${serialNumber} is already in this count.`);
      setSerial('');
      serialInputRef.current?.focus();
      return;
    }
    if (serialNumber) scannedSerialsRef.current.add(serialNumber);
    const entry: ReconcileEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      partNumber: part,
      serial: serialNumber,
      description: master?.description ?? '',
      scannedAt: new Date().toISOString(),
    };
    setEntries((current) => {
      const next = [entry, ...current];
      writeEntries(site.code, next);
      return next;
    });
    setPartNumber('');
    setSerial('');
    autoFilledPartRef.current = null;
    setScanError('');
    setNotice('');
    window.requestAnimationFrame(() => partInputRef.current?.focus());
  };

  const addSerialOnly = async (rawSerial: string, fillFields = true) => {
    if (!site) return;
    const serialNumber = rawSerial.replace(/\s+/g, '').toUpperCase();
    if (!serialNumber) {
      setScanError('Scan or enter a serial number.');
      serialInputRef.current?.focus();
      return;
    }
    if (scannedSerialsRef.current.has(serialNumber)) {
      setScanError(`Duplicate serial: ${serialNumber} is already in this count.`);
      setSerial('');
      serialInputRef.current?.focus();
      return;
    }
    scannedSerialsRef.current.add(serialNumber);
    const generation = resolveGenerationRef.current;
    const scannedAt = new Date().toISOString();
    setResolvingSerial(serialNumber);
    setScanError('');
    setNotice('');
    let partItem: PartsMasterItem | null = null;
    const knownUnit = unitBySerial.get(serialNumber);
    if (knownUnit?.part_number) {
      partItem = masterByPart.get(knownUnit.part_number.trim().toUpperCase()) ?? null;
    }
    if (!partItem) {
      try {
        const result = publicMode
          ? await api.partsPublic.resolve(siteToken, { serial: serialNumber })
          : await api.parts.resolve({ serial: serialNumber, siteCode: site.code });
        if (generation !== resolveGenerationRef.current) return;
        partItem = result.part;
        if (result.unit) {
          const resolvedUnit = result.unit;
          setUnitBySerial((current) => {
            const next = new Map(current);
            next.set(serialNumber, resolvedUnit);
            return next;
          });
        }
      } catch {
        if (generation !== resolveGenerationRef.current) return;
        partItem = null;
      }
    }
    if (generation !== resolveGenerationRef.current) return;
    if (!partItem) {
      scannedSerialsRef.current.delete(serialNumber);
      setResolvingSerial((current) => (current === serialNumber ? '' : current));
      autoFilledPartRef.current = null;
      setPartNumber('');
      setSerial(fillFields ? serialNumber : '');
      setNotice('Serial not recognized. Scan the part number to continue.');
      window.requestAnimationFrame(() => partInputRef.current?.focus());
      return;
    }
    const entry: ReconcileEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      partNumber: partItem.part_number,
      serial: serialNumber,
      description: partItem.description,
      scannedAt,
    };
    setEntries((current) => {
      if (current.some((row) => row.serial.toUpperCase() === serialNumber)) return current;
      const next = [entry, ...current];
      writeEntries(site.code, next);
      return next;
    });
    const resolvedPartNumber = partItem.part_number.trim();
    setMasterByPart((current) => {
      const key = resolvedPartNumber.toUpperCase();
      if (current.has(key)) return current;
      const next = new Map(current);
      next.set(key, partItem);
      return next;
    });
    if (fillFields) {
      setPartNumber(resolvedPartNumber);
      setSerial('');
      autoFilledPartRef.current = resolvedPartNumber.toUpperCase();
    }
    setResolvingSerial((current) => (current === serialNumber ? '' : current));
    setScanError('');
    setNotice(`Added ${partItem.part_number} · ${partItem.description || 'No description'}`);
    if (fillFields) {
      window.requestAnimationFrame(() => serialInputRef.current?.focus());
    }
  };

  const isSerialFirstValue = useCallback((raw: string) => {
    const normalized = raw.replace(/\s+/g, '').toUpperCase();
    if (!normalized || masterByPart.has(normalized)) return false;
    return unitBySerial.has(normalized) || classifyScanValue(raw) === 'serial';
  }, [masterByPart, unitBySerial]);

  const submitSerialFirst = (raw: string, fillFields = true) => {
    const serialNumber = raw.replace(/\s+/g, '').toUpperCase();
    const captured = serial.trim().toUpperCase();
    if (captured && captured !== serialNumber) {
      setScanError('A serial is already captured. Add it or clear the serial box first.');
      return;
    }
    autoFilledPartRef.current = null;
    setPartNumber('');
    setSerial('');
    void addSerialOnly(raw, fillFields);
  };

  const submitScan = (fromButton = false) => {
    const rawPart = partNumber.trim();
    const rawSerial = serial.trim();
    const partIsAutoFilled = Boolean(rawPart) && autoFilledPartRef.current === rawPart.toUpperCase();
    if (partIsAutoFilled && !rawSerial) {
      autoFilledPartRef.current = null;
      setPartNumber('');
      setScanError('');
      setNotice('Part number cleared. Scan the next serial.');
      window.requestAnimationFrame(() => serialInputRef.current?.focus());
      return;
    }
    if (rawSerial && (!rawPart || partIsAutoFilled)) {
      const normalized = rawSerial.replace(/\s+/g, '').toUpperCase();
      if (masterByPart.has(normalized) || classifyScanValue(rawSerial) === 'part-number') {
        if (fromButton) {
          setScanError('Scan the part number in the part field, then its serial.');
          return;
        }
        autoFilledPartRef.current = null;
        setPartNumber(normalized);
        setSerial('');
        setScanError('');
        setNotice('Part number detected. Scan the serial next.');
        window.requestAnimationFrame(() => serialInputRef.current?.focus());
        return;
      }
      autoFilledPartRef.current = null;
      setSerial('');
      void addSerialOnly(rawSerial, !fromButton);
      return;
    }
    if (isSerialFirstValue(rawPart)) {
      submitSerialFirst(rawPart, !fromButton);
      return;
    }
    addEntry();
  };

  const refreshStock = async () => {
    if (!site || !siteToken) return;
    setRefreshing(true);
    await loadSiteData(site, siteToken);
    setRefreshing(false);
    setNotice(`System stock reloaded at ${new Date().toLocaleTimeString()}.`);
  };

  const removeEntry = (id: string) => {
    if (!site) return;
    const target = entries.find((entry) => entry.id === id);
    const serialNumber = target?.serial.toUpperCase() ?? '';
    const stillScanned = serialNumber && entries.some((entry) => entry.id !== id && entry.serial.toUpperCase() === serialNumber);
    if (serialNumber && !stillScanned) scannedSerialsRef.current.delete(serialNumber);
    setEntries((current) => {
      const next = current.filter((entry) => entry.id !== id);
      writeEntries(site.code, next);
      return next;
    });
  };

  const clearEntries = () => {
    if (!site || !entries.length) return;
    if (!window.confirm(`Clear all ${entries.length} scanned entries for ${site.code}?`)) return;
    scannedSerialsRef.current.clear();
    resolveGenerationRef.current += 1;
    autoFilledPartRef.current = null;
    setResolvingSerial('');
    setEntries([]);
    writeEntries(site.code, []);
  };

  const exportCsv = () => {
    if (!site) return;
    const rows: (string | number)[][] = [['Result', 'Part Number', 'Serial', 'Description', 'System Status', 'Location', 'Scanned At']];
    for (const entry of entries) {
      const unit = entry.serial ? unitBySerial.get(entry.serial.toUpperCase()) : undefined;
      rows.push([
        'Scanned',
        entry.partNumber,
        entry.serial,
        entry.description,
        STATUS_STYLES[statusFor(entry)].label,
        unit?.location || '',
        formatScannedAt(entry.scannedAt),
      ]);
    }
    for (const unit of missingUnits) {
      rows.push([
        'System only',
        unit.part_number,
        unit.serial || '',
        unit.description || '',
        'In system (not scanned)',
        unit.location || '',
        '',
      ]);
    }
    downloadCsv(`parts-reconcile-${site.code}-${todayIso()}.csv`, rows);
  };

  const changeSite = () => {
    if (!site) return;
    setCodeInput(site.code);
    setSite(null);
    setSiteTokenState('');
    setPartNumber('');
    setSerial('');
    setScanError('');
    setError('');
    setNotice('');
  };

  if (!site) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Link to="/parts" className="text-[12px] font-medium text-[#6e6e73] hover:text-[#2563eb]">← Parts inventory</Link>
        <div className="mt-4 rounded-2xl bg-white p-6 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Parts inventory · temporary</p>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-[#1d1d1f]">Physical count reconciliation</h1>
          <p className="mt-1.5 text-[13px] leading-5 text-[#6e6e73]">
            Scan each part number, then its serial. The description fills automatically and the scan is compared with system stock.
          </p>
          {restoring ? (
            <div className="mt-5 rounded-xl bg-[#f7f7f8] p-4">
              <p className="text-[13px] font-semibold text-[#1d1d1f]">Restoring saved site…</p>
              <p className="mt-1 text-[12px] text-[#6e6e73]">Re-checking this device’s remembered site code.</p>
            </div>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void connect(codeInput); }}>
              <label className="mt-5 block text-[11px] font-medium text-[#3c3c43]">Site code
                <input
                  autoFocus
                  value={codeInput}
                  onChange={(event) => { setCodeInput(event.target.value.toUpperCase()); setError(''); }}
                  placeholder="e.g. PODIUM"
                  className="mt-1 h-11 w-full rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[16px] uppercase outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10 sm:text-[14px]"
                />
              </label>
              {error && <p role="alert" className="mt-3 text-[12px] text-[#a33a3a]">{error}</p>}
              <button type="submit" disabled={connecting || !codeInput.trim()} className="mt-5 w-full rounded-xl bg-[#1d1d1f] py-3 text-[12px] font-semibold text-white disabled:opacity-40">
                {connecting ? 'Checking…' : 'Start counting'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/parts" className="text-[12px] font-medium text-[#6e6e73] hover:text-[#2563eb]">← Parts inventory</Link>
            <span className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#6e6e73]">Temporary</span>
          </div>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-[-.035em] text-[#1d1d1f]">Physical count reconciliation</h1>
          <p className="mt-1 text-[13px] leading-5 text-[#6e6e73]">Scan the part number, then the serial. The description fills from the parts master.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43]">{site.name || site.code} · {site.code}</span>
          <button type="button" onClick={changeSite} className="rounded-full bg-[#f5f5f7] px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] hover:bg-[#ebebed]">Change site</button>
        </div>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-[#fdf2f2] px-3 py-2 text-[12px] text-[#a33a3a]">{error}</p>}
      {notice && <p className="mt-4 text-[12px] text-[#6e6e73]">{notice}</p>}
      {dataError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#fdf6ec] px-3 py-2">
          <p className="text-[12px] text-[#9a6700]">System stock could not be loaded: {dataError}</p>
          <button type="button" onClick={() => void refreshStock()} className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-[#3c3c43]">Retry</button>
        </div>
      )}

      <section className="mt-5 rounded-2xl bg-white p-4 shadow-[0_8px_28px_rgba(0,0,0,.03)]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-semibold text-[#3c3c43]">Part number
            <input
              ref={partInputRef}
              value={partNumber}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => { autoFilledPartRef.current = null; setPartNumber(event.target.value); setScanError(''); }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const scanned = partNumber.trim();
                if (isSerialFirstValue(scanned)) {
                  submitSerialFirst(scanned);
                  return;
                }
                if (serial.trim()) {
                  addEntry();
                  return;
                }
                if (scanned) serialInputRef.current?.focus();
              }}
              onBlur={(event) => {
                if (event.relatedTarget !== serialInputRef.current) return;
                const scanned = partNumber.trim();
                if (isSerialFirstValue(scanned)) submitSerialFirst(scanned);
              }}
              placeholder="Scan or type part number"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mt-1 h-12 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[16px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10"
            />
          </label>
          <label className="block text-[11px] font-semibold text-[#3c3c43]">Serial number
            <input
              ref={serialInputRef}
              value={serial}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => {
                const value = event.target.value.toUpperCase();
                setSerial(value);
                if (value.trim() && autoFilledPartRef.current) {
                  autoFilledPartRef.current = null;
                  setPartNumber('');
                }
                const normalized = value.replace(/\s+/g, '').toUpperCase();
                setScanError(normalized && scannedSerialsRef.current.has(normalized) ? `Duplicate serial: ${normalized} is already in this count.` : '');
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                if (!partNumber.trim() && !serial.trim()) {
                  setScanError('Scan or enter a serial number.');
                  return;
                }
                submitScan();
              }}
              placeholder="Scan or type serial number"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="mt-1 h-12 w-full rounded-xl border border-[#d2d2d7] bg-white px-3 text-[16px] uppercase outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f7f8] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">Description</p>
            <p className="mt-0.5 truncate text-[13px] font-medium text-[#1d1d1f]">
              {resolvingSerial
                ? `Resolving ${resolvingSerial}…`
                : currentPart
                  ? currentPart.description || 'No description'
                  : partNumber.trim()
                    ? 'Not found in the parts master'
                    : 'Fills automatically from the part number, or scan a serial alone'}
            </p>
            {currentPart && (
              <p className="mt-0.5 text-[11px] text-[#6e6e73]">
                {currentPart.serialized === 'N' ? 'Non-serialized part' : 'Serialized part'}
                {currentPart.substitute_part ? ` · Substitute: ${currentPart.substitute_part}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              const serialOnly = Boolean(autoFilledPartRef.current) || (Boolean(serial.trim()) && !partNumber.trim());
              submitScan(true);
              autoFilledPartRef.current = null;
              setPartNumber('');
              setSerial('');
              window.requestAnimationFrame(() => {
                (serialOnly ? serialInputRef.current : partInputRef.current)?.focus();
              });
            }}
            disabled={Boolean(resolvingSerial)}
            className="rounded-xl bg-[#1d1d1f] px-5 py-2.5 text-[12px] font-semibold text-white disabled:opacity-40"
          >Add scan</button>
        </div>
        {scanError && <p role="alert" className="mt-2 text-[11px] text-[#b91c1c]">{scanError}</p>}
        <p className="mt-2 text-[11px] text-[#86868b]">Serial-only works: scan a serial and the part number and description fill automatically. Duplicate serials are checked and blocked automatically.</p>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Scanned" value={stats.scanned} />
        <Stat label="Parts" value={stats.parts} />
        <Stat label="In system" value={stats.in} tone="good" />
        <Stat label="Not in system" value={stats.missing} tone="bad" />
        <Stat label="Part mismatch" value={stats.mismatch} tone="warn" />
        <Stat label="System not scanned" value={missingUnits.length} tone="warn" />
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void refreshStock()} disabled={refreshing} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm disabled:opacity-40">
          {refreshing ? 'Refreshing…' : 'Refresh system stock'}
        </button>
        <button type="button" onClick={exportCsv} disabled={!entries.length && !missingUnits.length} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#3c3c43] shadow-sm disabled:opacity-40">Export CSV</button>
        <button type="button" onClick={clearEntries} disabled={!entries.length} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-[#a33a3a] shadow-sm disabled:opacity-40">Clear count</button>
        <span className="text-[11px] text-[#86868b]">Saved on this device for {site.code}.</span>
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_8px_28px_rgba(0,0,0,.03)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e5e7] px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Scanned units</h2>
            <p className="mt-0.5 text-[11px] text-[#6e6e73]">{entries.length === filteredEntries.length ? `${entries.length.toLocaleString()} scan${entries.length === 1 ? '' : 's'}` : `${filteredEntries.length.toLocaleString()} of ${entries.length.toLocaleString()} scans`}</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter part, serial, or description"
            className="h-9 w-full max-w-[320px] rounded-xl border border-[#d2d2d7] bg-[#f7f7f8] px-3 text-[12px] outline-none focus:border-[#1d1d1f] focus:ring-2 focus:ring-[#1d1d1f]/10"
          />
        </div>
        {filteredEntries.length ? (
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-[12px]">
              <thead className="sticky top-0 z-10 bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                <tr>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Time</th>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Part number</th>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Serial</th>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Description</th>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">System</th>
                  <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 text-right font-semibold"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredEntries.map((entry) => (
                  <tr key={entry.id} className="border-t border-[#f0f0f2] first:border-t-0">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6e6e73]">{formatScannedAt(entry.scannedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{entry.partNumber}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[#3c3c43]">{entry.serial || '—'}</td>
                    <td className="max-w-[360px] truncate px-3 py-2 text-[#6e6e73]" title={entry.description || undefined}>{entry.description || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2"><StatusChip kind={statusFor(entry)} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button type="button" onClick={() => removeEntry(entry.id)} aria-label={`Remove ${entry.serial || entry.partNumber}`} className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[13px] leading-5 text-[#6e6e73] hover:text-[#a33a3a]">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-10 text-center text-[12px] text-[#6e6e73]">
            {entries.length ? 'No scans match this filter.' : 'No scans yet. Scan a part number, then its serial.'}
          </p>
        )}
      </section>

      <details className="mt-4 rounded-2xl bg-white shadow-[0_8px_28px_rgba(0,0,0,.03)]" open={missingUnits.length > 0}>
        <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-[#1d1d1f]">System stock not scanned</h2>
            <p className="mt-0.5 text-[11px] text-[#6e6e73]">{stockLoaded ? `${systemInStock.length.toLocaleString()} serial${systemInStock.length === 1 ? '' : 's'} currently in system stock` : 'System stock not loaded'}</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${missingUnits.length ? 'bg-[#fdf6ec] text-[#9a6700]' : 'bg-[#eef7ee] text-[#2f6b3a]'}`}>{missingUnits.length.toLocaleString()}</span>
        </summary>
        <div className="border-t border-[#e5e5e7] px-4 py-3">
          {missingUnits.length ? (
            <div className="max-h-[46vh] overflow-auto rounded-xl border border-[#e5e5e7]">
              <table className="w-full min-w-[620px] border-collapse text-left text-[12px]">
                <thead className="sticky top-0 z-10 bg-[#f7f7f8] text-[10px] uppercase tracking-wider text-[#6e6e73]">
                  <tr>
                    <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Part number</th>
                    <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Serial</th>
                    <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Description</th>
                    <th scope="col" className="border-b border-[#e5e5e7] px-3 py-2 font-semibold">Location</th>
                  </tr>
                </thead>
                <tbody>
                  {missingUnits.map((unit) => (
                    <tr key={unit.id} className="border-t border-[#f0f0f2] first:border-t-0">
                      <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#1d1d1f]">{unit.part_number}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[#3c3c43]">{unit.serial}</td>
                      <td className="max-w-[360px] truncate px-3 py-2 text-[#6e6e73]" title={unit.description || undefined}>{unit.description || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-[#6e6e73]">{unit.location || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-[12px] text-[#6e6e73]">
              {stockLoaded ? `Every serial in ${site.code} system stock has been scanned.` : 'Refresh system stock to compare.'}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

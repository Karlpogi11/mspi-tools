import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ExclusionSuggestion, type Session, type Product, type ScanResult, readJson } from '../../lib/api';
import { saveDefaultExcludes } from '../../lib/defaultExcludes';
import { useWebSocket } from '../../hooks/useWebSocket';
import ImportSystem from '../../components/pcount/ImportSystem';
import ImportCount from '../../components/pcount/ImportCount';
import ProductTable, { ALL_COLUMNS, ColumnPicker } from '../../components/pcount/ProductTable';
import ScanPanel from '../../components/pcount/ScanPanel';
import ScanBar from '../../components/pcount/ScanBar';
import ToolHelp from '../../components/ToolHelp';
import { createClientId } from '../../lib/clientId';
import { useAuth } from '../../lib/auth';

const PcountReportPreview = lazy(() => import('../../components/pcount/PcountReportPreview'));

type Stage = 'setup' | 'count' | 'verify' | 'report';

function isExcludedProduct(product: Product): boolean {
  return String(product.status || '').trim().toLowerCase() === 'excluded';
}

// Stolen missing rows stay in Missing — they must never move to Excluded.
function isStolenRow(product: Product): boolean {
  return String(product.notes || '').trim().toLowerCase() === 'stolen';
}

function normalizeProductStatus(product: Product): Product {
  if (isExcludedProduct(product)) return { ...product, status: 'excluded' };
  const countedQty = Number(product.counted_qty) || 0;
  const systemQty = Number(product.system_qty) || 0;
  const status = String(product.status || '').trim().toLowerCase();
  // Reconcile stale statuses with qty so Is Match and the pill never disagree
  // (e.g. a Missing row whose actual now equals system becomes Matched).
  // Explicit-zero Missing (count-sheet zero) stays Missing; untouched rows stay Pending.
  if (countedQty > 0) {
    return { ...product, status: countedQty >= systemQty ? 'matched' : 'missing' };
  }
  if (status === 'missing' || status === 'matched' || status === 'pending') {
    return { ...product, status };
  }
  return { ...product, status: 'pending' };
}

export default function PcountSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const sessionId = parseInt(id || '0');
  const isSuperAdmin = Boolean(user?.isSuperAdmin);

  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stage, setStage] = useState<Stage>('setup');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestedOnly, setShowSuggestedOnly] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [detailSource, setDetailSource] = useState<'scan' | 'selection'>('scan');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedStatusCodes, setSelectedStatusCodes] = useState<string[]>([]);
  const [selectedProductCodes, setSelectedProductCodes] = useState<string[]>([]);
  const [excludingPending, setExcludingPending] = useState(false);
  const [pendingExclusionError, setPendingExclusionError] = useState('');
  const [markingStolen, setMarkingStolen] = useState(false);
  const [quickStolenCode, setQuickStolenCode] = useState<string | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionByCode, setSuggestionByCode] = useState<Record<string, ExclusionSuggestion>>({});
  const [excludeCodes, setExcludeCodes] = useState('');
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [scannerCount, setScannerCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [scanSequence, setScanSequence] = useState(0);
  const [verifyPanelHeight, setVerifyPanelHeight] = useState<number | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const verifyPanelRef = useRef<HTMLDivElement>(null);
  
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState('');
  const [tableColumns, setTableColumns] = useState<string[]>(ALL_COLUMNS.map(column => column.key));
  const scanBarRef = useRef<HTMLInputElement>(null);
  const scannerId = useRef<string>(createClientId());
  const hasBeenInVerify = useRef(false);
  const productsRef = useRef<Product[]>([]);
  const pendingScansRef = useRef(new Map<string, number>());
  const loadRequestRef = useRef(0);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    setSelectedStatusCodes([]);
    setSelectedProductCodes([]);
    setPendingExclusionError('');
    setBulkMessage('');
    setShowSuggestedOnly(false);
  }, [statusFilter]);

  useEffect(() => {
    let active = true;
    setSuggestionsLoading(true);
    api.sessions.exclusionSuggestions(sessionId)
      .then((result) => {
        if (!active) return;
        const map: Record<string, ExclusionSuggestion> = {};
        for (const s of result.suggestions) map[s.productCode.trim().toUpperCase()] = s;
        setSuggestionByCode(map);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setSuggestionsLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    const panel = verifyPanelRef.current;
    if (!panel) return;
    const updateHeight = () => {
      setVerifyPanelHeight(window.matchMedia('(min-width: 1024px)').matches ? panel.getBoundingClientRect().height : null);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(panel);
    window.addEventListener('resize', updateHeight);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateHeight);
    };
  }, [stage, lastScan?.product_code, lastScan?.description, lastScan?.status]);

  const loadSession = useCallback(async (syncStage = false) => {
    const requestId = ++loadRequestRef.current;
    try {
      const s = await api.sessions.get(sessionId);
      const prods = (await api.products.list(sessionId, {
        sort: sortDesc ? 'desc' : 'asc',
        fresh: true,
      })).map(normalizeProductStatus);
      if (requestId !== loadRequestRef.current) return;
      setSession(s);
      setTableColumns(s.display_columns?.length ? s.display_columns : ALL_COLUMNS.map(column => column.key));
      productsRef.current = prods;
      setProducts(prods);

      if (syncStage) {
        setStage(prods.length === 0 ? 'setup' : 'verify');
      }
    } catch {
      if (requestId !== loadRequestRef.current) return;
      navigate('/pcount');
    } finally {
      setLoading(false);
    }
  }, [sessionId, sortDesc, navigate]);

  useEffect(() => {
    loadSession(true);
  }, [loadSession]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      api.sessions.get(sessionId).then(s => setSession(s)).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [sessionId]);

  const hasSessionProducts = products.length > 0;

  useWebSocket({
    sessionId,
    scannerId: scannerId.current,
    enabled: hasSessionProducts,
    scanning: stage === 'verify',
    onMessage: useCallback((msg: { type: string; [key: string]: unknown }) => {
      switch (msg.type) {
        case 'scanner_count':
          setScannerCount(msg.count as number);
          setOnlineCount((msg.online as number) || 0);
          return;
        case 'product_scanned':
        case 'product_updated':
          if (pendingScansRef.current.has((msg as any).product.product_code)) return;
          setProducts(prev => prev.map(p =>
            p.product_code === (msg as any).product.product_code
              ? { ...p, ...(msg as any).product } : p
          ));
          return;
        case 'products_imported':
        case 'counts_imported':
        case 'products_cleared':
          loadSession();
          return;
      }
    }, [loadSession]),
  });

  const hasActiveScans = scannerCount > 0;
  const availableDisplayColumns = Array.from(new Set(
    products.flatMap(product => Object.keys(product.extra || {}))
  ));

  const getOptimisticScan = useCallback((product: Product): ScanResult => {
    let countedQty = product.counted_qty;
    let status = product.status;

    if (['pending', 'missing', 'matched'].includes(product.status)) {
      countedQty += 1;
      status = countedQty >= product.system_qty ? 'matched' : 'missing';
    }

    return { ...product, counted_qty: countedQty, status, match: countedQty === product.system_qty };
  }, []);

  const handleScanQueued = useCallback((code: string) => {
    setStatusFilter('all');
    setCategoryFilter('all');
    setSearchQuery('');
    const product = productsRef.current.find(p => p.product_code === code);
    const pending = pendingScansRef.current.get(code) || 0;
    pendingScansRef.current.set(code, pending + 1);
    if (!product) return;

    const next = getOptimisticScan(product);
    const nextProducts = productsRef.current.map(p => p.product_code === code ? next : p);
    productsRef.current = nextProducts;
    setProducts(nextProducts);
    setLastScan(next);
    setScanSequence(sequence => sequence + 1);
    setDetailSource('scan');
    setSelectedProduct(null);
  }, [getOptimisticScan]);

  const handleScanFailed = useCallback((code: string) => {
    pendingScansRef.current.delete(code);
    void loadSession();
  }, [loadSession]);

  const handleScan = useCallback(async (result: ScanResult) => {
    const pending = pendingScansRef.current.get(result.product_code) || 1;
    if (pending > 1) {
      pendingScansRef.current.set(result.product_code, pending - 1);
      return;
    }
    pendingScansRef.current.delete(result.product_code);
    setLastScan(result);
    setScanSequence(sequence => sequence + 1);
    setDetailSource('scan');
    setSelectedProduct(null);

      setProducts(prev => {
        const updated = prev.map(p =>
          p.product_code === result.product_code ? { ...p, ...result } : p
        );
        productsRef.current = updated;
      const countable = updated.filter(p => p.status !== 'excluded');
      const checked = countable.filter(p => p.status !== 'pending').length;
      const total = countable.length;
      setSession(s => s ? {
        ...s,
        progress: total > 0 ? Math.round((checked / total) * 100) : 0,
        checked,
        total,
      } : s);
      return updated;
    });
  }, []);

  const handleProductUpdate = useCallback((updated: Product) => {
    const normalized = normalizeProductStatus(updated);
    setProducts(prev => prev.map(p =>
      p.product_code === normalized.product_code ? normalized : p
    ));
    loadSession();
  }, [loadSession]);

  const toggleStatusSelection = useCallback((code: string) => {
    setPendingExclusionError('');
    setSelectedStatusCodes(previous => previous.includes(code)
      ? previous.filter(value => value !== code)
      : [...previous, code]);
  }, []);

  const toggleAllStatusSelection = useCallback(() => {
    setPendingExclusionError('');
    // Stolen missing rows are not selectable for exclude — they stay in Missing.
    const selectableCodes = products
      .filter(product => product.status === statusFilter && !(statusFilter === 'missing' && isStolenRow(product)))
      .map(product => product.product_code);
    setSelectedStatusCodes(previous => previous.length === selectableCodes.length ? [] : selectableCodes);
  }, [products, statusFilter]);

  const toggleProductSelection = useCallback((code: string) => {
    setSelectedProductCodes(previous => previous.includes(code)
      ? previous.filter(value => value !== code)
      : [...previous, code]);
  }, []);

  const toggleAllProductSelection = useCallback(() => {
    const selectableCodes = products
      .filter(product => statusFilter === 'all' && product.status !== 'excluded')
      .filter(product => categoryFilter === 'all' || (product.category || '') === categoryFilter)
      .filter(product => !searchQuery || product.product_code.toLowerCase().includes(searchQuery.toLowerCase()) || product.description.toLowerCase().includes(searchQuery.toLowerCase()))
      .map(product => product.product_code);
    setSelectedProductCodes(previous => previous.length === selectableCodes.length ? [] : selectableCodes);
  }, [categoryFilter, products, searchQuery, statusFilter]);

  const completeSelectedProducts = useCallback(async () => {
    if (!isSuperAdmin || selectedProductCodes.length === 0 || bulkPending) return;
    setBulkPending(true);
    setBulkMessage('');
    try {
      const result = await api.sessions.bulkUpdate(sessionId, selectedProductCodes, 'complete');
      setSelectedProductCodes([]);
      const skipped = result.skippedMissing?.length || 0;
      setBulkMessage(`${result.updated} product${result.updated === 1 ? '' : 's'} completed.${skipped ? ` ${skipped} missing item${skipped === 1 ? '' : 's'} skipped — Missing stays Missing.` : ''}`);
      await loadSession();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : 'Could not complete selected products.');
    } finally {
      setBulkPending(false);
    }
  }, [bulkPending, isSuperAdmin, loadSession, selectedProductCodes, sessionId]);

  const excludeListedProducts = useCallback(async () => {
    const codes = Array.from(new Set(excludeCodes.split(/\r?\n/).map(code => code.trim()).filter(Boolean)));
    if (!isSuperAdmin || codes.length === 0 || bulkPending) return;
    setBulkPending(true);
    setBulkMessage('');
    try {
      const result = await api.sessions.bulkUpdate(sessionId, codes, 'exclude');
      setExcludeCodes('');
      setBulkMessage(`${result.updated} product${result.updated === 1 ? '' : 's'} excluded${result.missingCodes.length ? `; ${result.missingCodes.length} code${result.missingCodes.length === 1 ? '' : 's'} not found.` : '.'}`);
      await loadSession();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : 'Could not exclude the listed products.');
    } finally {
      setBulkPending(false);
    }
  }, [bulkPending, excludeCodes, isSuperAdmin, loadSession, sessionId]);

  const excludeSelectedStatus = useCallback(async () => {
    const selected = new Set(selectedStatusCodes);
    const eligible = products.filter(product => product.status === statusFilter && selected.has(product.product_code));
    // Stolen missing rows stay in Missing — never move them to Excluded.
    const skippedStolen = eligible.filter(product => statusFilter === 'missing' && isStolenRow(product)).length;
    const targets = eligible.filter(product => !(statusFilter === 'missing' && isStolenRow(product)));
    if (targets.length === 0) {
      if (skippedStolen > 0) setPendingExclusionError(`${skippedStolen} stolen item${skippedStolen === 1 ? '' : 's'} stay${skippedStolen === 1 ? 's' : ''} in Missing and cannot be excluded.`);
      return;
    }
    const nextStatus = statusFilter === 'excluded' ? 'pending' : 'excluded';

    setExcludingPending(true);
    setPendingExclusionError('');
    const results = await Promise.allSettled(targets.map(product => fetch(
      `/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(product.product_code)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: nextStatus, ...(nextStatus === 'pending' ? { counted_qty: 0 } : {}) }),
      },
    )));
    const succeeded = new Set(targets.filter((_, index) => {
      const result = results[index];
      return result.status === 'fulfilled' && result.value.ok;
    }).map(product => product.product_code));

    if (succeeded.size > 0) {
      setProducts(previous => {
        const updated = previous.map(product => succeeded.has(product.product_code)
          ? { ...product, status: nextStatus, ...(nextStatus === 'pending' ? { counted_qty: 0 } : {}) }
          : product);
        productsRef.current = updated;
        const countable = updated.filter(product => product.status !== 'excluded');
        const checked = countable.filter(product => product.status !== 'pending').length;
        setSession(current => current ? { ...current, checked, total: countable.length, progress: countable.length > 0 ? Math.round((checked / countable.length) * 100) : 0 } : current);
        return updated;
      });
      setSelectedStatusCodes(previous => previous.filter(code => !succeeded.has(code)));
    }
    if (succeeded.size < targets.length) {
      setPendingExclusionError(`${targets.length - succeeded.size} item${targets.length - succeeded.size === 1 ? '' : 's'} could not be excluded. Please try again.`);
    } else if (skippedStolen > 0) {
      setPendingExclusionError(`${skippedStolen} stolen item${skippedStolen === 1 ? '' : 's'} kept in Missing (not excluded).`);
    }
    setExcludingPending(false);
  }, [products, selectedStatusCodes, sessionId, statusFilter]);

  const handleCompleteCount = useCallback(async (code: string) => {
    const product = productsRef.current.find((item) => item.product_code === code);
    if (!product) return;
    try {
      const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ counted_qty: product.system_qty, status: 'matched' }),
      });
      const data = await readJson<Partial<Product>>(res);
      if (!res.ok) return;
      setProducts((prev) => {
        const updated = prev.map((item) => item.product_code === code ? { ...item, ...data } : item);
        productsRef.current = updated;
        return updated;
      });
      setLastScan((prev) => prev?.product_code === code ? { ...prev, ...data, match: true } as ScanResult : prev);
      await loadSession();
      scanBarRef.current?.focus();
    } catch {}
  }, [loadSession, sessionId]);

  const handleCountChange = useCallback(async (code: string, count: number): Promise<boolean> => {
    const product = productsRef.current.find((item) => item.product_code === code);
    if (!product) return false;
    const status = count === 0 ? 'pending' : count >= product.system_qty ? 'matched' : 'missing';
    try {
      const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ counted_qty: count, status }),
      });
      const data = await readJson<Partial<Product>>(res);
      if (!res.ok) return false;
      setProducts((prev) => {
        const updated = prev.map((item) => item.product_code === code ? { ...item, ...data } : item);
        productsRef.current = updated;
        return updated;
      });
      setLastScan((prev) => prev?.product_code === code ? { ...prev, ...data, match: count === product.system_qty } as ScanResult : prev);
      await loadSession();
      scanBarRef.current?.focus();
      return true;
    } catch {
      return false;
    }
  }, [loadSession, sessionId]);

  const handleSystemImportComplete = useCallback(async () => {
    await loadSession();
    setStage('count');
  }, [loadSession]);

  const handleCountImportComplete = useCallback(async () => {
    await loadSession();
    setStage('verify');
  }, [loadSession]);

  const handleClearImports = useCallback(async () => {
    await api.products.clearImports(sessionId);
    await loadSession();
    setStage('setup');
  }, [loadSession, sessionId]);

  const handleSkipToScan = useCallback(() => {
    setStage('verify');
  }, []);

  async function openReportPreview() {
    await loadSession();
    setStage('report');
  }

  async function handleExport() {
    if (!session || products.length === 0 || exporting) return;
    setExporting(true);
    setExportError('');

    try {
      const latestProducts = await api.products.list(sessionId, {
        sort: sortDesc ? 'desc' : 'asc',
        fresh: true,
      });
      productsRef.current = latestProducts;
      setProducts(latestProducts);
      const XLSX = await import('xlsx-js-style');
      // Excel is the detailed product export. The report preview owns the summary output.
      // Keep the match flag in the final column for quick row-by-row verification.
      const exportColumns = [
        { key: 'Product Code', label: 'Product Code' },
        { key: 'System Qty', label: 'System Qty' },
        { key: 'Actual Qty', label: 'Actual Qty' },
        { key: 'Is Match', label: 'Status' },
      ];
      const headers = exportColumns.map(column => column.label);
      const valueFor = (product: Product, names: string[]) => {
        const wanted = names.map(name => name.toLowerCase());
        const value = Object.entries(product.extra || {}).find(([key]) => wanted.includes(String(key).trim().toLowerCase()))?.[1];
        return String(value ?? '');
      };

      const rows = [...latestProducts]
        .filter(product => !isExcludedProduct(product))
        .sort((a, b) => String(a.product_code || '').localeCompare(String(b.product_code || ''), undefined, { sensitivity: 'base', numeric: true }))
        .map(product => {
          const brand = valueFor(product, ['brand']).trim().toLowerCase();
          const category = String(product.category || '').trim().toLowerCase();
          const sheet: 'Apple' | '3PP' = brand.includes('apple') || category === 'apple' ? 'Apple' : '3PP';
          const values = exportColumns.map(column => {
            switch (column.key) {
              case 'Product Code': return product.product_code;
              case 'System Qty': return product.system_qty;
              case 'Actual Qty': return product.counted_qty;
              case 'Is Match': return product.status === 'matched' || product.counted_qty === product.system_qty;
              default: return product.extra?.[column.key] ?? '';
            }
          });
          return {
            sheet,
            values,
            isMissing: product.status === 'missing',
          };
        });

      const workbook = XLSX.utils.book_new();
      for (const sheetName of ['Apple', '3PP'] as const) {
        const sheetRows = rows.filter(row => row.sheet === sheetName);
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sheetRows.map(row => row.values)]);
        sheetRows.forEach((row, index) => {
          if (row.isMissing) {
            for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
              const cell = worksheet[XLSX.utils.encode_cell({ r: index + 1, c: columnIndex })];
              if (cell) {
                cell.s = { font: { color: { rgb: 'FFDC2626' } } };
              }
            }
          }
        });
        worksheet['!cols'] = exportColumns.map(column => ({
          wch: column.key === 'Description' ? 42 : column.key === 'Product Code' ? 20 : 16,
        }));
        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      }

      const date = new Date().toISOString().slice(0, 10);
      const safeName = `${session.name || 'inventory-session'}`
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'inventory-session';
      const filename = `${safeName}-${date}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (error) {
      console.error('Failed to export inventory workbook', error);
      setExportError('Excel export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  const filteredProducts = products.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (showSuggestedOnly && (statusFilter === 'pending' || statusFilter === 'missing')) {
      if (!suggestionByCode[p.product_code.trim().toUpperCase()]) return false;
    }
    if (categoryFilter !== 'all' && (p.category || '') !== categoryFilter) return false;
    if (searchQuery && !p.product_code.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const progress = products.length > 0
    ? (() => {
        const countable = products.filter(p => p.status !== 'excluded');
        if (countable.length === 0) return 0;
        return Math.round((countable.filter(p => p.status !== 'pending').length / countable.length) * 100);
      })()
    : 0;

  const statusCounts = {
    all: products.length,
    pending: products.filter(p => p.status === 'pending').length,
    matched: products.filter(p => p.status === 'matched').length,
    missing: products.filter(p => p.status === 'missing').length,
    excluded: products.filter(p => p.status === 'excluded').length,
  };

  // Excluded rows are intentionally removed: they never count as missing and
  // never inflate progress. Countable = everything except excluded.
  const countableTotal = statusCounts.all - statusCounts.excluded;
  const countableChecked = statusCounts.matched + statusCounts.missing;
  const missingShortfallUnits = products
    .filter(p => p.status === 'missing')
    .reduce((sum, p) => sum + Math.max(0, (Number(p.system_qty) || 0) - (Number(p.counted_qty) || 0)), 0);

  const categoryCounts = {
    all: products.length,
    apple: products.filter(p => p.category === 'apple').length,
    '3pp': products.filter(p => p.category === '3pp').length,
  };

  const suggestiblePendingCodes = products
    .filter(p => p.status === 'pending' && suggestionByCode[p.product_code.trim().toUpperCase()])
    .map(p => p.product_code);

  const suggestibleMissingCodes = products
    .filter(p => p.status === 'missing' && suggestionByCode[p.product_code.trim().toUpperCase()] && !isStolenRow(p))
    .map(p => p.product_code);

  // Stolen missing rows stay in Missing — excluded from every exclude-target count.
  const excludableMissingCount = products.filter(p => p.status === 'missing' && !isStolenRow(p)).length;
  const stolenMissingCount = statusCounts.missing - excludableMissingCount;

  const excludeSuggestedFor = useCallback(async (statuses: Array<'pending' | 'missing'>) => {
    const wanted = new Set(statuses);
    // Stolen missing rows stay in Missing — never exclude them here.
    const targets = products.filter(p => wanted.has(p.status as 'pending' | 'missing') && suggestionByCode[p.product_code.trim().toUpperCase()] && !isStolenRow(p));
    if (targets.length === 0 || excludingPending) return;
    setExcludingPending(true);
    setPendingExclusionError('');
    setBulkMessage('');
    const results = await Promise.allSettled(targets.map(product => fetch(
      `/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(product.product_code)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'excluded' }),
      },
    )));
    const succeeded = new Set(targets.filter((_, index) => {
      const result = results[index];
      return result.status === 'fulfilled' && result.value.ok;
    }).map(product => product.product_code));
    if (succeeded.size > 0) {
      setProducts(previous => {
        const updated = previous.map(product => succeeded.has(product.product_code) ? { ...product, status: 'excluded' } : product);
        productsRef.current = updated;
        const countable = updated.filter(product => product.status !== 'excluded');
        const checked = countable.filter(product => product.status !== 'pending').length;
        setSession(current => current ? { ...current, checked, total: countable.length, progress: countable.length > 0 ? Math.round((checked / countable.length) * 100) : 0 } : current);
        return updated;
      });
      setBulkMessage(`${succeeded.size} suggested product${succeeded.size === 1 ? '' : 's'} excluded based on previous sessions.`);
    }
    if (succeeded.size < targets.length) {
      setPendingExclusionError(`${targets.length - succeeded.size} item${targets.length - succeeded.size === 1 ? '' : 's'} could not be excluded. Please try again.`);
    }
    setExcludingPending(false);
  }, [excludingPending, products, sessionId, suggestionByCode]);

  const excludeSuggestedPending = useCallback(() => void excludeSuggestedFor(['pending']), [excludeSuggestedFor]);
  const excludeSuggestedMissing = useCallback(() => void excludeSuggestedFor(['missing']), [excludeSuggestedFor]);

  const excludeAllMissing = useCallback(async () => {
    // Stolen missing rows stay in Missing — never move them to Excluded.
    const targets = products.filter(p => p.status === 'missing' && !isStolenRow(p));
    if (targets.length === 0 || excludingPending) return;
    setExcludingPending(true);
    setPendingExclusionError('');
    setBulkMessage('');
    const results = await Promise.allSettled(targets.map(product => fetch(
      `/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(product.product_code)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'excluded' }),
      },
    )));
    const succeeded = new Set(targets.filter((_, index) => {
      const result = results[index];
      return result.status === 'fulfilled' && result.value.ok;
    }).map(product => product.product_code));
    if (succeeded.size > 0) {
      setProducts(previous => {
        const updated = previous.map(product => succeeded.has(product.product_code) ? { ...product, status: 'excluded' } : product);
        productsRef.current = updated;
        const countable = updated.filter(product => product.status !== 'excluded');
        const checked = countable.filter(product => product.status !== 'pending').length;
        setSession(current => current ? { ...current, checked, total: countable.length, progress: countable.length > 0 ? Math.round((checked / countable.length) * 100) : 0 } : current);
        return updated;
      });
      setBulkMessage(`${succeeded.size} missing product${succeeded.size === 1 ? '' : 's'} excluded.`);
    }
    if (succeeded.size < targets.length) {
      setPendingExclusionError(`${targets.length - succeeded.size} item${targets.length - succeeded.size === 1 ? '' : 's'} could not be excluded. Please try again.`);
    }
    setExcludingPending(false);
  }, [excludingPending, products, sessionId]);

  // Missing rows stay missing (never auto-excluded). Theft remark + shortfall qty
  // is the record: notes='stolen' flows into the report remarks per category.
  const markStolenCodes = useCallback(async (codes: string[]) => {
    const targets = products.filter(p => p.status === 'missing' && codes.includes(p.product_code));
    if (targets.length === 0 || markingStolen) return;
    setMarkingStolen(true);
    setBulkMessage('');
    const results = await Promise.allSettled(targets.map(product => fetch(
      `/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(product.product_code)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes: 'stolen' }),
      },
    )));
    const succeeded = new Set(targets.filter((_, index) => {
      const result = results[index];
      return result.status === 'fulfilled' && result.value.ok;
    }).map(product => product.product_code));
    if (succeeded.size > 0) {
      setProducts(previous => {
        const updated = previous.map(product => succeeded.has(product.product_code) ? { ...product, notes: 'stolen' } : product);
        productsRef.current = updated;
        return updated;
      });
      const shortfall = targets
        .filter(t => succeeded.has(t.product_code))
        .reduce((sum, t) => sum + Math.max(0, (Number(t.system_qty) || 0) - (Number(t.counted_qty) || 0)), 0);
      setBulkMessage(`${succeeded.size} missing item${succeeded.size === 1 ? '' : 's'} marked stolen (${shortfall} pc${shortfall === 1 ? '' : 's'} short) — stays in Missing with remark for the report.`);
      setLastScan(prev => prev && succeeded.has(prev.product_code) ? { ...prev, notes: 'stolen' } : prev);
    }
    if (succeeded.size < targets.length) {
      setPendingExclusionError(`${targets.length - succeeded.size} item${targets.length - succeeded.size === 1 ? '' : 's'} could not be marked stolen. Please try again.`);
    }
    setMarkingStolen(false);
  }, [markingStolen, products, sessionId]);

  const markAllMissingStolen = useCallback(() => {
    // Only rows that still need it — already-stolen rows are skipped, not re-marked.
    void markStolenCodes(products.filter(p => p.status === 'missing' && !isStolenRow(p)).map(p => p.product_code));
  }, [markStolenCodes, products]);

  const markSuggestedMissingStolen = useCallback(() => {
    void markStolenCodes(products.filter(p => p.status === 'missing' && !isStolenRow(p) && suggestionByCode[p.product_code.trim().toUpperCase()]).map(p => p.product_code));
  }, [markStolenCodes, products, suggestionByCode]);

  const quickMarkStolen = useCallback(async (code: string) => {
    if (quickStolenCode) return;
    setQuickStolenCode(code);
    try {
      const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes: 'stolen' }),
      });
      if (!res.ok) throw new Error('Could not mark as stolen.');
      const data = await readJson<Partial<Product>>(res);
      setProducts(previous => {
        const updated = previous.map(product => product.product_code === code ? { ...product, ...data, notes: 'stolen' } : product);
        productsRef.current = updated;
        return updated;
      });
      setLastScan(prev => prev?.product_code === code ? { ...prev, notes: 'stolen' } : prev);
    } catch {
      setPendingExclusionError('Could not mark this item as stolen.');
    } finally {
      setQuickStolenCode(null);
    }
  }, [quickStolenCode, sessionId]);

  if (loading) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Loading...</div>;
  }

  if (!session) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Session not found</div>;
  }

  return (
    <div className="space-y-4 pb-12">
      <div className="pcount-session-header">
        <div className="pcount-header-main">
          <div className="pcount-session-identity">
            <div className="flex items-center gap-2 group">
              <input
                ref={nameInputRef}
                type="text"
                value={session.name}
                onChange={async (e) => {
                  const val = e.target.value;
                  setSession(s => s ? { ...s, name: val } : s);
                  await api.sessions.update(sessionId, { name: val });
                }}
                
                title="Click to rename session"
                className="text-[18px] font-semibold text-[#1d1d1f] bg-transparent border-none outline-none focus:border-b focus:border-[#1d1d1f] pb-0.5 cursor-text placeholder:text-[#9a9aa0]"
              />
              <button
                onClick={() => nameInputRef.current?.focus()}
                title="Rename session"
                className="text-[#6e6e73] hover:text-[#1d1d1f] transition-colors p-1 rounded-lg hover:bg-[#f5f5f7] cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            </div>
            <div className="pcount-session-meta">
              <span>Created {new Date(session.created_at).toLocaleDateString()}</span>
              {stage === 'verify' && products.length > 0 && scannerCount > 0 && (
                <span className="pcount-live-status">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#86efac] animate-pulse" />
                  {scannerCount} active {scannerCount === 1 ? 'scanner' : 'scanners'}
                </span>
              )}
            </div>
            {session.is_owner && session.join_code && (
              <div className="mt-2 inline-flex items-center gap-2">
                <span className="text-[12px] text-white/90">Join code</span>
                <span className="text-[16px] font-bold tracking-[0.35em] text-white">{session.join_code}</span>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(session.join_code!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  title="Copy code"
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-white/90 hover:text-white hover:underline cursor-pointer"
                >
                  {copied ? (
                    <>
                      <svg className="w-3.5 h-3.5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                      <span className="text-[#4ade80]">Copied</span>
                    </>
                  ) : (
                    'Copy'
                  )}
                </button>
              </div>
            )}
          </div>
          <div className="pcount-header-utility">
            <div className="pcount-header-actions">
              <ToolHelp
                toolName="PCount session"
                purpose="Import inventory, count products collaboratively, identify quantity differences, and prepare a verified physical-count result."
                steps={[
                  'Import the system inventory in System Import.',
                  'Import an existing count when available, or continue directly to scanning.',
                  'Share the join code with authorized counters.',
                  'Scan and review matched, missing, and excess quantities.',
                  'Correct exceptions and export the completed result.',
                ]}
                cards={[
                  { title: 'Live updates', description: 'Connected counters receive product and progress changes in real time.' },
                  { title: 'Scanning', description: 'Keep the scan field focused and verify visual feedback after each product code.' },
                ]}
              />
              {stage === 'verify' && (
                <button
                  onClick={handleExport}
                  disabled={products.length === 0 || exporting}
                  title="Export Excel"
                  aria-label="Export Excel"
                  className="pcount-header-button"
                >
                  {exporting ? <span className="text-[11px] text-white/80">&hellip;</span> : <span aria-hidden="true">Export Excel</span>}
                </button>
              )}
            </div>
          </div>
        </div>

        {exportError && <p className="mt-3 text-[12px] text-[#fca5a5]">{exportError}</p>}

        <nav className="pcount-stage-nav" aria-label="PCount workflow">
          {[
            { key: 'setup', label: '1. System Import' },
            { key: 'count', label: '2. Count Import' },
            { key: 'verify', label: '3. Scan & Verify' },
            { key: 'report', label: '4. Report' },
          ].map((item, i) => (
            <span key={item.key} className="pcount-stage-item">
              {i > 0 && <span className="pcount-stage-divider" aria-hidden="true" />}
              <button
                onClick={() => item.key === 'report' ? void openReportPreview() : setStage(item.key as Stage)}
                disabled={item.key === 'report' && products.length === 0}
                aria-current={stage === item.key ? 'step' : undefined}
                className={`pcount-stage-link ${
                  stage === item.key
                    ? 'is-active'
                    : ''
                }`}
              >
                {item.label}
              </button>
            </span>
          ))}
        </nav>
      </div>

      {stage === 'setup' && (
        <ImportSystem
          sessionId={sessionId}
          onComplete={handleSystemImportComplete}
          hasProducts={products.length > 0}
          currentDisplayColumns={session.display_columns || []}
          productCount={products.length}
          disabled={hasActiveScans}
          onlineCount={onlineCount}
          activeScannerCount={scannerCount}
          availableDisplayColumns={availableDisplayColumns}
          previewProducts={products}
          onClear={handleClearImports}
          onDisplayColumnsChange={(cols) => setSession(s => s ? { ...s, display_columns: cols } : s)}
        />
      )}

      {stage === 'count' && (
        <div>
          <ImportSystem
            sessionId={sessionId}
            onComplete={handleSystemImportComplete}
            hasProducts={products.length > 0}
            currentDisplayColumns={session.display_columns || []}
            productCount={products.length}
            disabled={hasActiveScans}
            onlineCount={onlineCount}
            activeScannerCount={scannerCount}
            availableDisplayColumns={availableDisplayColumns}
            previewProducts={products}
            onClear={handleClearImports}
            onDisplayColumnsChange={(cols) => setSession(s => s ? { ...s, display_columns: cols } : s)}
          />
          <ImportCount sessionId={sessionId} onComplete={handleCountImportComplete} systemProducts={products} />
          <div className="mt-3 text-center">
            <button
              onClick={handleSkipToScan}
              className="px-4 py-2 bg-[#15803d] text-white text-[13px] font-medium rounded-lg hover:bg-[#166534] transition-colors cursor-pointer"
            >
              Skip &mdash; start live scanning instead <span className="opacity-75">(recommended)</span>
            </button>
          </div>
        </div>
      )}

      {stage === 'verify' && products.length > 0 && (
        <>
          <div className="pcount-toolbar">
            <div className="pcount-toolbar-row">
              <div className="pcount-filter-group" aria-label="Filter by status">
                {([
                  { key: 'all', label: 'All', count: statusCounts.all },
                  { key: 'pending', label: 'Pending', count: statusCounts.pending },
                  { key: 'matched', label: 'Matched', count: statusCounts.matched },
                  { key: 'missing', label: 'Missing', count: statusCounts.missing },
                  { key: 'excluded', label: 'Excluded', count: statusCounts.excluded },
                ]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setStatusFilter(tab.key)}
                    title={tab.key === 'missing'
                      ? `${tab.count} rows · ${missingShortfallUnits} pcs short (under-counted only, excludes Excluded)`
                      : tab.key === 'excluded'
                        ? 'Intentionally removed — never counted as missing, ignored in progress'
                        : tab.key === 'all'
                          ? `${countableTotal} countable + ${statusCounts.excluded} excluded`
                          : undefined}
                    className={`pcount-filter-button ${
                      statusFilter === tab.key
                        ? 'bg-[#2563eb] text-white'
                        : 'bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                    }`}
                  >
                    {tab.label}
                    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-px ${
                      statusFilter === tab.key ? 'bg-white/25 text-white' : 'bg-[#e8e8ed] text-[#6e6e73]'
                    }`}>
                      {tab.key === 'missing' && missingShortfallUnits > 0 ? `${tab.count} · ${missingShortfallUnits} pcs` : tab.count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="pcount-filter-group" aria-label="Filter by category">
                {Object.entries(categoryCounts).map(([key, count]) => (
                  <button
                    key={key}
                    onClick={() => setCategoryFilter(categoryFilter === key ? 'all' : key)}
                    className={`pcount-filter-button ${
                      categoryFilter === key
                        ? 'bg-[#2563eb] text-white'
                        : 'bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                    }`}
                  >
                    {key === 'all' ? 'All categories' : key === '3pp' ? '3PP' : 'Apple'}
                    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-px ${
                      categoryFilter === key ? 'bg-white/25 text-white' : 'bg-[#e8e8ed] text-[#6e6e73]'
                    }`}>
                      {count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="pcount-toolbar-spacer" />
              <ColumnPicker
                columns={tableColumns}
                onChange={async (columns) => {
                  setTableColumns(columns);
                  setSession(current => current ? { ...current, display_columns: columns } : current);
                  try {
                    await fetch(`/api/pcount/sessions/${sessionId}/display-columns`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ columns }),
                    });
                  } catch {}
                }}
              />
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9aa0] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search by code or description..."
                  className="pcount-search-input"
                />
              </div>
            </div>
          </div>
          {/* Per-tab bulk actions: each tab owns its buttons. Excluded never counts as missing. */}
          {statusFilter === 'pending' && (
            <div className="pcount-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-[#6e6e73]">
                {statusCounts.pending} pending ·{' '}
                <button
                  type="button"
                  onClick={() => setShowSuggestedOnly(v => !v)}
                  disabled={suggestiblePendingCodes.length === 0}
                  title={showSuggestedOnly ? 'Show all pending rows' : 'Show only the flagged suggested rows in this tab'}
                  className="cursor-pointer font-semibold text-[#2563eb] underline underline-offset-2 hover:opacity-70 disabled:cursor-default disabled:text-[#6e6e73] disabled:no-underline"
                >
                  {suggestiblePendingCodes.length} flagged from history{showSuggestedOnly ? ' (showing flagged only — click to show all)' : ''}
                </button>
                {suggestionsLoading ? ' (checking history…)' : ''} · {countableChecked}/{countableTotal} countable checked
              </p>
              <button
                type="button"
                onClick={() => void excludeSuggestedPending()}
                disabled={excludingPending || suggestionsLoading || suggestiblePendingCodes.length === 0}
                title={suggestionsLoading ? 'Checking previous sessions…' : suggestiblePendingCodes.length === 0 ? 'No pending rows match previous sessions’ excluded or repeatedly-missing codes' : 'Exclude only the flagged pending rows in this tab'}
                className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
              >
                {excludingPending ? 'Excluding…' : suggestionsLoading ? 'Checking history…' : `Exclude suggested pending${suggestiblePendingCodes.length ? ` (${suggestiblePendingCodes.length})` : ''}`}
              </button>
            </div>
          )}
          {statusFilter === 'missing' && (
            <div className="pcount-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-[#6e6e73]">
                {statusCounts.missing} rows · {missingShortfallUnits} pcs short (under-counted only)
                {suggestibleMissingCodes.length > 0 && !suggestionsLoading ? (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={() => setShowSuggestedOnly(v => !v)}
                      title={showSuggestedOnly ? 'Show all missing rows' : 'Show only the flagged suggested rows in this tab'}
                      className="cursor-pointer font-semibold text-[#2563eb] underline underline-offset-2 hover:opacity-70"
                    >
                      {suggestibleMissingCodes.length} flagged from history{showSuggestedOnly ? ' (showing flagged only — click to show all)' : ''}
                    </button>
                  </>
                ) : ''}
                {showSuggestedOnly && suggestibleMissingCodes.length === 0 ? ' · showing flagged only' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestibleMissingCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void markSuggestedMissingStolen()}
                    disabled={markingStolen || excludingPending || suggestionsLoading}
                    title="Mark only the flagged missing rows as stolen (they stay in Missing with remark for the report)"
                    className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
                  >
                    {markingStolen ? 'Marking…' : `Mark suggested stolen (${suggestibleMissingCodes.length})`}
                  </button>
                )}
                {excludableMissingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void markAllMissingStolen()}
                    disabled={markingStolen}
                    title="Mark every still-unmarked row in this Missing tab as stolen (stays in Missing with remark + shortfall qty for the report)"
                    className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
                  >
                    {markingStolen ? 'Marking…' : `Mark all missing stolen (${excludableMissingCount})`}
                  </button>
                )}
                {suggestibleMissingCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void excludeSuggestedMissing()}
                    disabled={excludingPending || suggestionsLoading}
                    title="Exclude only the flagged missing rows in this tab (stolen rows are never excluded)"
                    className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
                  >
                    {excludingPending ? 'Excluding…' : `Exclude suggested missing (${suggestibleMissingCodes.length})`}
                  </button>
                )}
                {excludableMissingCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void excludeAllMissing()}
                    disabled={excludingPending}
                    title={stolenMissingCount > 0 ? `Exclude excludable missing rows (${stolenMissingCount} stolen stay in Missing)` : 'Exclude everything currently in this Missing tab (they leave Missing and go to Excluded)'}
                    className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
                  >
                    {excludingPending ? 'Excluding…' : `Exclude all missing (${excludableMissingCount})`}
                  </button>
                )}
                {stolenMissingCount > 0 && (
                  <span className="text-[11px] text-[#6e6e73] self-center" title="Stolen rows stay in Missing and cannot be excluded, so they show no checkbox">
                    {stolenMissingCount} stolen stays in Missing · no box to check
                  </span>
                )}
              </div>
            </div>
          )}
          {statusFilter === 'excluded' && (
            <div className="pcount-card flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-[#6e6e73]">
                {statusCounts.excluded} excluded — kept separate, never counted as missing, ignored in progress ({countableChecked}/{countableTotal} countable checked). Re-include via the table selection below.
              </p>
              <button
                type="button"
                onClick={() => {
                  const codes = products.filter(p => p.status === 'excluded').map(p => p.product_code);
                  const saved = saveDefaultExcludes(codes.join('\n'));
                  setBulkMessage(`${saved.length} codes saved as default to exclude. They will pre-fill on the next System Import.`);
                }}
                disabled={excludingPending || statusCounts.excluded === 0}
                title="Save all currently excluded codes as the default exclude list for future System Imports on this device"
                className="pcount-secondary-button shrink-0 disabled:cursor-not-allowed"
              >
                Save these as default to exclude ({statusCounts.excluded})
              </button>
            </div>
          )}
          {(statusFilter === 'all' || statusFilter === 'matched') && (
            <p className="text-[12px] text-[#6e6e73]">
              {countableChecked}/{countableTotal} countable checked · {statusCounts.excluded} excluded ignored
              {statusFilter === 'all' ? ` · ${statusCounts.all} total rows` : ''}
            </p>
          )}
          {isSuperAdmin && statusFilter === 'all' && (
            <div className="pcount-card flex flex-col gap-3 p-3 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void completeSelectedProducts()} disabled={selectedProductCodes.length === 0 || bulkPending} className="pcount-primary-button disabled:cursor-not-allowed">
                  {bulkPending ? 'Updating…' : `Complete selected${selectedProductCodes.length ? ` (${selectedProductCodes.length})` : ''}`}
                </button>
                <span className="text-[11px] text-[#6e6e73]">Super Admin tools</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2 lg:max-w-xl">
                <label htmlFor="pcount-exclude-codes" className="text-[12px] font-medium text-[#3c3c43]">Exclude product codes</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <textarea id="pcount-exclude-codes" value={excludeCodes} onChange={event => setExcludeCodes(event.target.value)} rows={2} placeholder="One product code per line" className="min-h-16 min-w-0 flex-1 rounded-lg border border-[#d8dee8] bg-white px-3 py-2 text-[12px] text-[#1d1d1f] outline-none focus:border-[#5274a8] focus:ring-2 focus:ring-[#5274a8]/15" />
                  <button type="button" onClick={() => void excludeListedProducts()} disabled={!excludeCodes.trim() || bulkPending} className="pcount-secondary-button self-end disabled:cursor-not-allowed">Exclude listed</button>
                </div>
              </div>
            </div>
          )}
          {bulkMessage && <p className="mt-2 text-[12px] text-[#3c3c43]" role="status">{bulkMessage}</p>}
          {pendingExclusionError && <p className="mt-2 text-[12px] text-[#b45309]">{pendingExclusionError}</p>}

          <ScanBar
            ref={scanBarRef}
            sessionId={sessionId}
            onScanned={handleScan}
            onScanQueued={handleScanQueued}
            onScanFailed={handleScanFailed}
          />

          <div className="pcount-verify-grid grid grid-cols-1 items-stretch gap-4 lg:grid-cols-3">
            <div className="pcount-verify-table-column h-full min-h-0 min-w-0 lg:col-span-2" style={verifyPanelHeight ? { height: verifyPanelHeight } : undefined}>
              <ProductTable
                products={filteredProducts}
                defaultColumns={session.display_columns || []}
                visibleColumns={tableColumns}
                sortDesc={sortDesc}
                onToggleSort={() => setSortDesc(!sortDesc)}
                onUpdate={handleProductUpdate}
                onSelect={(p) => {
                  setSelectedProduct(p);
                  setLastScan({ ...p, match: p.counted_qty === p.system_qty });
                  setDetailSource('selection');
                }}
                selectedCode={selectedProduct?.product_code || lastScan?.product_code}
                scrollToCode={detailSource === 'scan' ? lastScan?.product_code : null}
                scanSequence={scanSequence}
                editMode
                onCountChange={handleCountChange}
                showStatusSelection={statusFilter === 'pending' || statusFilter === 'missing' || statusFilter === 'excluded'}
                selectableStatus={statusFilter === 'missing' ? 'missing' : statusFilter === 'excluded' ? 'excluded' : 'pending'}
                selectedStatusCodes={selectedStatusCodes}
                onToggleStatus={toggleStatusSelection}
                onToggleAllStatus={toggleAllStatusSelection}
                onExcludeSelectedStatus={() => void excludeSelectedStatus()}
                selectionAction={statusFilter === 'excluded' ? 'restore' : 'exclude'}
                excludingPending={excludingPending}
                showProductSelection={isSuperAdmin && statusFilter === 'all'}
                selectedProductCodes={selectedProductCodes}
                onToggleProduct={toggleProductSelection}
                onToggleAllProducts={toggleAllProductSelection}
                productSelectionDisabled={bulkPending}
                suggestionByCode={suggestionByCode}
                onQuickStolen={(code) => void quickMarkStolen(code)}
                quickStolenCode={quickStolenCode}
                groupSuggested={statusFilter === 'missing'}
              />
            </div>
            <div ref={verifyPanelRef} className="self-start min-h-0 min-w-0 lg:col-span-1">
              <ScanPanel
                lastScan={lastScan}
                detailSource={detailSource}
                onRecount={async (code) => {
                  try {
                    const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ counted_qty: 0, status: 'pending' }),
                    });
                    const data = await readJson<Partial<Product>>(res);
                    if (res.ok) {
                      setLastScan(null);
                      setProducts(prev => prev.map(p => p.product_code === code ? { ...p, ...data } : p));
                      loadSession();
                    }
                  } catch {}
                }}
                onComplete={handleCompleteCount}
                onCountChange={handleCountChange}
                onStatusChange={async (code, status) => {
                  try {
                    const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ status }),
                    });
                    const data = await readJson<Partial<Product>>(res);
                    if (res.ok) {
                      setProducts(prev => prev.map(p => p.product_code === code ? { ...p, ...data } : p));
                      loadSession();
                      if (lastScan?.product_code === code) setLastScan(prev => prev ? { ...prev, status } as ScanResult : null);
                    }
                  } catch {}
                }}
                onNotesChange={async (code, notes) => {
                  try {
                    const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
                      method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ notes }),
                    });
                    const data = await readJson<Partial<Product>>(res);
                    if (res.ok) {
                      setProducts(prev => prev.map(p => p.product_code === code ? { ...p, ...data } : p));
                      productsRef.current = productsRef.current.map(p => p.product_code === code ? { ...p, ...data } : p);
                      if (lastScan?.product_code === code) setLastScan(prev => prev ? { ...prev, ...data } as ScanResult : null);
                    }
                  } catch {}
                }}
                stats={{
                  total: countableTotal,
                  checked: countableChecked,
                  matched: statusCounts.matched,
                  missing: statusCounts.missing,
                  pending: statusCounts.pending,
                  excluded: statusCounts.excluded,
                  shortfall: missingShortfallUnits,
                }}
                progress={progress}
              />
            </div>
          </div>
        </>
      )}

      {stage === 'verify' && products.length === 0 && (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-12 text-center">
          <p className="text-[14px] text-[#6e6e73] mb-3">No products imported yet.</p>
          <button
            onClick={() => setStage('setup')}
            className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
          >
            Import System Export
          </button>
        </div>
      )}
      {stage === 'report' && session && (
        <Suspense fallback={<div className="pcount-card p-6 text-[13px] text-[#6e6e73]">Loading report…</div>}>
          <PcountReportPreview
            session={session}
            products={products}
            onClose={() => setStage('verify')}
          />
        </Suspense>
      )}
    </div>
  );
}

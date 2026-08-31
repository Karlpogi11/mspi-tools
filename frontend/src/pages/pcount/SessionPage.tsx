import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Session, type Product, type ScanResult, readJson } from '../../lib/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import ImportSystem from '../../components/pcount/ImportSystem';
import ImportCount from '../../components/pcount/ImportCount';
import ProductTable, { ALL_COLUMNS, ColumnPicker } from '../../components/pcount/ProductTable';
import ScanPanel from '../../components/pcount/ScanPanel';
import ScanBar from '../../components/pcount/ScanBar';
import ToolHelp from '../../components/ToolHelp';
import PcountReportPreview from '../../components/pcount/PcountReportPreview';

type Stage = 'setup' | 'count' | 'verify' | 'report';

export default function PcountSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionId = parseInt(id || '0');

  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stage, setStage] = useState<Stage>('setup');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [detailSource, setDetailSource] = useState<'scan' | 'selection'>('scan');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedStatusCodes, setSelectedStatusCodes] = useState<string[]>([]);
  const [excludingPending, setExcludingPending] = useState(false);
  const [pendingExclusionError, setPendingExclusionError] = useState('');
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
  const scannerId = useRef<string>(crypto.randomUUID());
  const hasBeenInVerify = useRef(false);
  const productsRef = useRef<Product[]>([]);
  const pendingScansRef = useRef(new Map<string, number>());

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    setSelectedStatusCodes([]);
    setPendingExclusionError('');
  }, [statusFilter]);

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

  const loadSession = useCallback(async () => {
    try {
      const s = await api.sessions.get(sessionId);
      setSession(s);
      setTableColumns(s.display_columns?.length ? s.display_columns : ALL_COLUMNS.map(column => column.key));

      const prods = await api.products.list(sessionId, {
        sort: sortDesc ? 'desc' : 'asc',
      });
      productsRef.current = prods;
      setProducts(prods);

      if (prods.length === 0) {
        setStage('setup');
      } else {
        setStage('verify');
      }
    } catch {
      navigate('/pcount');
    } finally {
      setLoading(false);
    }
  }, [sessionId, sortDesc, navigate]);

  useEffect(() => {
    loadSession();
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
      const checked = updated.filter(p => p.status !== 'pending').length;
      const total = updated.length;
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
    setProducts(prev => prev.map(p =>
      p.product_code === updated.product_code ? updated : p
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
    const selectableCodes = products.filter(product => product.status === statusFilter).map(product => product.product_code);
    setSelectedStatusCodes(previous => previous.length === selectableCodes.length ? [] : selectableCodes);
  }, [products, statusFilter]);

  const excludeSelectedStatus = useCallback(async () => {
    const selected = new Set(selectedStatusCodes);
    const targets = products.filter(product => product.status === statusFilter && selected.has(product.product_code));
    if (targets.length === 0) return;
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
        const checked = updated.filter(product => product.status !== 'pending').length;
        setSession(current => current ? { ...current, checked, progress: updated.length > 0 ? Math.round((checked / updated.length) * 100) : 0 } : current);
        return updated;
      });
      setSelectedStatusCodes(previous => previous.filter(code => !succeeded.has(code)));
    }
    if (succeeded.size < targets.length) {
      setPendingExclusionError(`${targets.length - succeeded.size} item${targets.length - succeeded.size === 1 ? '' : 's'} could not be excluded. Please try again.`);
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

  const handleImportComplete = useCallback(() => {
    loadSession();
  }, [loadSession]);

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
        return Object.entries(product.extra || {}).find(([key]) => wanted.includes(key.trim().toLowerCase()))?.[1] || '';
      };

      const rows = [...products]
        .filter(product => product.status !== 'excluded')
        .sort((a, b) => a.product_code.localeCompare(b.product_code, undefined, { sensitivity: 'base', numeric: true }))
        .map(product => {
          const brand = valueFor(product, ['brand']).trim().toLowerCase();
          const sheet: 'Apple' | '3PP' = brand.includes('apple') || product.category.toLowerCase() === 'apple' ? 'Apple' : '3PP';
          const values = exportColumns.map(column => {
            switch (column.key) {
              case 'Product Code': return product.product_code;
              case 'System Qty': return product.system_qty;
              case 'Actual Qty': return product.counted_qty;
              case 'Is Match': return product.counted_qty === product.system_qty;
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
    if (categoryFilter !== 'all' && (p.category || '') !== categoryFilter) return false;
    if (searchQuery && !p.product_code.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !p.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const progress = products.length > 0
    ? Math.round((products.filter(p => p.status !== 'pending').length / products.length) * 100)
    : 0;

  const statusCounts = {
    all: products.length,
    pending: products.filter(p => p.status === 'pending').length,
    matched: products.filter(p => p.status === 'matched').length,
    missing: products.filter(p => p.status === 'missing').length,
    excluded: products.filter(p => p.status === 'excluded').length,
  };

  const categoryCounts = {
    all: products.length,
    apple: products.filter(p => p.category === 'apple').length,
    '3pp': products.filter(p => p.category === '3pp').length,
  };

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
          onComplete={handleImportComplete}
          hasProducts={products.length > 0}
          currentDisplayColumns={session.display_columns || []}
          productCount={products.length}
          disabled={hasActiveScans}
          onlineCount={onlineCount}
          activeScannerCount={scannerCount}
          availableDisplayColumns={availableDisplayColumns}
          previewProducts={products}
          onDisplayColumnsChange={(cols) => setSession(s => s ? { ...s, display_columns: cols } : s)}
        />
      )}

      {stage === 'count' && (
        <div>
          <ImportCount sessionId={sessionId} onComplete={handleImportComplete} systemProducts={products} />
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
                {Object.entries(statusCounts).map(([key, count]) => (
                  <button
                    key={key}
                    onClick={() => setStatusFilter(key)}
                    className={`pcount-filter-button ${
                      statusFilter === key
                        ? 'bg-[#2563eb] text-white'
                        : 'bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'
                    }`}
                  >
                    {key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1)}
                    <span className={`text-[10px] font-semibold rounded-full px-1.5 py-px ${
                      statusFilter === key ? 'bg-white/25 text-white' : 'bg-[#e8e8ed] text-[#6e6e73]'
                    }`}>
                      {count}
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
                  total: statusCounts.all,
                  checked: statusCounts.all - statusCounts.pending,
                  matched: statusCounts.matched,
                  missing: statusCounts.missing,
                  pending: statusCounts.pending,
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
        <PcountReportPreview
          session={session}
          products={products}
          onClose={() => setStage('verify')}
        />
      )}
    </div>
  );
}

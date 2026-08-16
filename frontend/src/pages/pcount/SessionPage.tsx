import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Session, type Product, type ScanResult, readJson } from '../../lib/api';
import { useWebSocket } from '../../hooks/useWebSocket';
import ProgressCircle from '../../components/pcount/ProgressCircle';
import ImportSystem from '../../components/pcount/ImportSystem';
import ImportCount from '../../components/pcount/ImportCount';
import ProductTable from '../../components/pcount/ProductTable';
import ScanPanel from '../../components/pcount/ScanPanel';
import ScanBar from '../../components/pcount/ScanBar';
import ToolHelp from '../../components/ToolHelp';

type Stage = 'setup' | 'count' | 'verify';

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
  const [reviewMode, setReviewMode] = useState(false);
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [detailSource, setDetailSource] = useState<'scan' | 'selection'>('scan');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [overscanCode, setOverscanCode] = useState<string | null>(null);
  const [scannerCount, setScannerCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exportError, setExportError] = useState('');
  const scanBarRef = useRef<HTMLInputElement>(null);
  const scannerId = useRef<string>(crypto.randomUUID());
  const hasBeenInVerify = useRef(false);
  const productsRef = useRef<Product[]>([]);
  const pendingScansRef = useRef(new Map<string, number>());

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  const loadSession = useCallback(async () => {
    try {
      const s = await api.sessions.get(sessionId);
      setSession(s);

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
      api.sessions.get(sessionId).then(s => setSession(s)).catch(() => {});
    }, 5000);
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
    setDetailSource('scan');
    setSelectedProduct(null);

    if (next.system_qty > 0 && next.counted_qty > next.system_qty) {
      setOverscanCode(code);
      setTimeout(() => setOverscanCode(null), 800);
    }
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
    setDetailSource('scan');
    setSelectedProduct(null);

    if (result.system_qty > 0 && result.counted_qty > result.system_qty) {
      setOverscanCode(result.product_code);
      setTimeout(() => setOverscanCode(null), 800);
    }
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

  async function handleExport() {
    if (!session || products.length === 0 || exporting) return;
    setExporting(true);
    setExportError('');

    try {
      const XLSX = await import('xlsx');
      // The final pcount output is the two paper summaries (Apple and 3PP),
      // rather than the row-level import used during scanning.
      const headers = ['Category', 'SOH', 'Actual Qty', 'Stock Issued', 'Variance', 'Remarks'];
      const valueFor = (product: Product, names: string[]) => {
        const wanted = names.map(name => name.toLowerCase());
        return Object.entries(product.extra || {}).find(([key]) => wanted.includes(key.trim().toLowerCase()))?.[1] || '';
      };
      const numericExtra = (product: Product, names: string[]) => {
        const value = valueFor(product, names).replace(/,/g, '').trim();
        return value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
      };
      const summaries = new Map<string, {
        sheet: 'Apple' | '3PP'; category: string; soh: number; actual: number;
        issued: number | null; remarks: Set<string>;
      }>();

      for (const product of products) {
        const brand = valueFor(product, ['brand']).trim().toLowerCase();
        const sheet: 'Apple' | '3PP' = brand.includes('apple') || product.category.toLowerCase() === 'apple' ? 'Apple' : '3PP';
        const category = valueFor(product, ['category', 'group']) || (sheet === 'Apple' ? 'Apple' : '3PP');
        const key = `${sheet}:${category.trim().toLowerCase()}`;
        const summary = summaries.get(key) || { sheet, category, soh: 0, actual: 0, issued: null, remarks: new Set<string>() };
        summary.soh += product.system_qty;
        summary.actual += product.counted_qty;
        const issued = numericExtra(product, ['stock issued', 'stock_issued', 'issued qty', 'issued quantity']);
        if (issued !== null) summary.issued = (summary.issued || 0) + issued;

        const note = product.notes?.trim() || valueFor(product, ['remarks', 'remark', 'notes']).trim();
        if (note) summary.remarks.add(note);
        if (product.counted_qty > product.system_qty) summary.remarks.add('Excess');
        else if (product.status === 'missing' || product.counted_qty < product.system_qty) summary.remarks.add('Missing');
        else if (product.status === 'pending') summary.remarks.add('Pending count');
        summaries.set(key, summary);
      }

      const rows = [...summaries.values()].map(summary => ({
        sheet: summary.sheet,
        values: [
          summary.category,
          summary.soh,
          summary.actual,
          summary.issued === null ? 'N/A' : summary.issued,
          summary.soh - summary.actual,
          summary.remarks.size ? [...summary.remarks].join('; ') : 'N/A',
        ],
      }));

      const workbook = XLSX.utils.book_new();
      for (const sheetName of ['Apple', '3PP'] as const) {
        const sheetRows = rows.filter(row => row.sheet === sheetName).map(row => row.values);
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sheetRows]);
        worksheet['!cols'] = [
          { wch: 28 },
          { wch: 12 },
          { wch: 14 },
          { wch: 15 },
          { wch: 12 },
          { wch: 42 },
        ];
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
  };

  useEffect(() => {
    if (reviewMode && statusCounts.missing === 0) {
      setReviewMode(false);
      setStatusFilter('all');
    }
  }, [reviewMode, statusCounts.missing]);

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
      <div className="relative overflow-hidden bg-[#0c0f18]/90 backdrop-blur-2xl rounded-xl border border-white/10 p-5">
        <div className="pointer-events-none absolute inset-0 rounded-xl overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#172554]/85 via-[#1e3a8a]/45 to-transparent" />
          <div
            className="absolute inset-0 opacity-[0.38] mix-blend-overlay"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            }}
          />
        <div
          className="absolute inset-0 opacity-[0.32] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n2'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n2)'/%3E%3C/svg%3E")`,
          }}
        />
        </div>
        <div className="relative flex items-center justify-between">
          <div>
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
                className="text-[18px] font-semibold text-white bg-transparent border-none outline-none focus:border-b focus:border-white/70 pb-0.5 cursor-text placeholder:text-white/50"
              />
              <button
                onClick={() => nameInputRef.current?.focus()}
                title="Rename session"
                className="text-white/60 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10 cursor-pointer shrink-0"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
            </div>
            <p className="text-[12px] text-white/90 mt-0.5">
              {session.status} &middot; Created {new Date(session.created_at).toLocaleDateString()}
            </p>
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
          <div className="flex items-center gap-4">
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
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/30 text-[#bbf7d0] transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exporting ? (
                  <span className="text-[11px] text-white/80">&hellip;</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M4 3h10l4 4v7H4z" fill="currentColor" opacity=".16" />
                    <path d="M4 3h10l4 4v7H4zM14 3v4h4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    <path d="m7 7 3 4m0-4-3 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                    <path d="M14 15v5m0 0-2-2m2 2 2-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span className="sr-only">Export Excel</span>
              </button>
            )}
            {stage === 'verify' && products.length > 0 && scannerCount > 0 && (
              <div className="flex items-center gap-1.5 text-[12px] text-white bg-white/20 rounded-full px-3 py-1.5 backdrop-blur-sm">
                <span className="w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
                {scannerCount}
              </div>
            )}
            <ProgressCircle progress={progress} size={56} strokeWidth={4} color="#bfdbfe" trackColor="rgba(255,255,255,0.25)" />
          </div>
        </div>

        {exportError && <p className="mt-3 text-[12px] text-[#fca5a5]">{exportError}</p>}

        <nav className="relative flex items-center gap-2 mt-4 text-[12px]">
          {[
            { key: 'setup', label: '1. System Import' },
            { key: 'count', label: '2. Count Import' },
            { key: 'verify', label: '3. Scan & Verify' },
          ].map((item, i) => (
            <span key={item.key} className="flex items-center gap-2">
              {i > 0 && <span className="text-white/40 text-[12px]">/</span>}
              <button
                onClick={() => setStage(item.key as 'setup' | 'count' | 'verify')}
                className={`transition-colors cursor-pointer pb-0.5 underline underline-offset-4 ${
                  stage === item.key
                    ? 'text-white font-medium'
                    : 'text-white/80 hover:text-white'
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
          <div className="bg-white rounded-xl border border-[#d2d2d7] p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex rounded-lg overflow-hidden border border-[#d2d2d7] divide-x divide-[#d2d2d7]">
                {Object.entries(statusCounts).map(([key, count]) => (
                  <button
                    key={key}
                    onClick={() => { setStatusFilter(key); setReviewMode(false); }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
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
              <div className="inline-flex rounded-lg overflow-hidden border border-[#d2d2d7] divide-x divide-[#d2d2d7]">
                {Object.entries(categoryCounts).map(([key, count]) => (
                  <button
                    key={key}
                    onClick={() => { setCategoryFilter(categoryFilter === key ? 'all' : key); setReviewMode(false); }}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
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
              {statusCounts.missing > 0 && (
                <button
                  onClick={() => {
                    if (reviewMode) {
                      setReviewMode(false);
                      setStatusFilter('all');
                    } else {
                      setReviewMode(true);
                      setStatusFilter('missing');
                      setCategoryFilter('all');
                      setSearchQuery('');
                      setLastScan(null);
                      setSelectedProduct(null);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                    reviewMode
                      ? 'border-[#2563eb] bg-[#eff6ff] text-[#1d4ed8]'
                      : 'border-[#fde68a] bg-[#fffbeb] text-[#a16207] hover:bg-[#fef3c7]'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M4 5h16M7 12h10M10 19h4" strokeLinecap="round" />
                  </svg>
                  {reviewMode ? 'Exit review' : 'Review differences'}
                  <span className="rounded-full bg-white/70 px-1.5 py-px text-[10px]">{statusCounts.missing}</span>
                </button>
              )}
              <div className="flex-1" />
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9aa0] pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setReviewMode(false); }}
                  placeholder="Search by code or description..."
                  className="pl-9 pr-3 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb] w-[220px] placeholder:text-[#9a9aa0]"
                />
              </div>
            </div>
          </div>

          <ScanBar
            ref={scanBarRef}
            sessionId={sessionId}
            onScanned={handleScan}
            onScanQueued={handleScanQueued}
            onScanFailed={handleScanFailed}
          />

          {reviewMode && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3.5 py-2.5 text-[12px] text-[#1e40af]">
              <span><strong>Review mode:</strong> only mismatched rows are shown. Edit the physical count directly in the Qty column.</span>
              <span className="whitespace-nowrap text-[#3b82f6]">Enter or Tab saves &middot; Esc cancels</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <ProductTable
                products={filteredProducts}
                defaultColumns={session.display_columns || []}
                sortDesc={sortDesc}
                onToggleSort={() => setSortDesc(!sortDesc)}
                onUpdate={handleProductUpdate}
                onSelect={(p) => {
                  setSelectedProduct(p);
                  setLastScan({ ...p, match: p.counted_qty === p.system_qty });
                  setDetailSource('selection');
                }}
                selectedCode={selectedProduct?.product_code || lastScan?.product_code}
                overscanCode={overscanCode}
                scrollToCode={lastScan?.product_code || selectedProduct?.product_code}
                editMode={reviewMode}
                onCountChange={handleCountChange}
              />
            </div>
            <div className="lg:col-span-1">
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
    </div>
  );
}

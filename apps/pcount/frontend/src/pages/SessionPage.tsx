import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type Session, type Product, type ScanResult } from '../lib/api';
import { useWebSocket } from '../hooks/useWebSocket';
import ProgressCircle from '../components/ProgressCircle';
import ImportSystem from '../components/ImportSystem';
import ImportCount from '../components/ImportCount';
import ProductTable from '../components/ProductTable';
import ScanPanel from '../components/ScanPanel';
import ScanBar from '../components/ScanBar';

type Stage = 'setup' | 'count' | 'verify';

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const sessionId = parseInt(id || '0');

  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [stage, setStage] = useState<Stage>('setup');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [overscanCode, setOverscanCode] = useState<string | null>(null);
  const [scannerCount, setScannerCount] = useState(0);
  const [onlineCount, setOnlineCount] = useState(0);
  const [exporting, setExporting] = useState(false);
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
      } else if (prods.some(p => p.counted_qty > 0)) {
        hasBeenInVerify.current = true;
        setStage('verify');
      } else if (hasBeenInVerify.current) {
        setStage('verify');
      } else {
        setStage('count');
      }
    } catch {
      navigate('/');
    } finally {
      setLoading(false);
    }
  }, [sessionId, sortDesc, navigate]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const hasSessionProducts = products.length > 0;

  useWebSocket({
    sessionId,
    scannerId: scannerId.current,
    enabled: hasSessionProducts,
    scanning: stage === 'verify',
    onMessage: useCallback((msg) => {
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

    if (['pending', 'missing', 'matched', 'over'].includes(product.status)) {
      countedQty += 1;
      status = countedQty > product.system_qty
        ? 'over'
        : countedQty === product.system_qty ? 'matched' : 'missing';
    }

    return { ...product, counted_qty: countedQty, status, match: countedQty === product.system_qty };
  }, []);

  const handleScanQueued = useCallback((code: string) => {
    const product = productsRef.current.find(p => p.product_code === code);
    const pending = pendingScansRef.current.get(code) || 0;
    pendingScansRef.current.set(code, pending + 1);
    if (!product) return;

    const next = getOptimisticScan(product);
    const nextProducts = productsRef.current.map(p => p.product_code === code ? next : p);
    productsRef.current = nextProducts;
    setProducts(nextProducts);
    setLastScan(next);
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
      const headers = ['Product Code', 'System Quantity', 'Actual Quantity', 'Is Match'];
      const rows = [...products]
        .sort((a, b) => a.product_code.localeCompare(b.product_code))
        .map(product => {
          const brand = Object.entries(product.extra || {})
            .find(([key]) => key.trim().toLowerCase() === 'brand')?.[1] || '';
          const normalizedBrand = brand.trim().toLowerCase().replace(/[\s_]+/g, '-');
          const sheet = normalizedBrand === 'apple' || normalizedBrand === 'apple-parts' ? 'Apple' : '3PP';
          return {
            sheet,
            values: [
              product.product_code,
              product.system_qty,
              product.counted_qty,
              product.counted_qty === product.system_qty,
            ],
          };
        });

      const workbook = XLSX.utils.book_new();
      for (const sheetName of ['Apple', '3PP'] as const) {
        const sheetRows = rows.filter(row => row.sheet === sheetName).map(row => row.values);
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sheetRows]);
        worksheet['!cols'] = [
          { wch: 24 },
          { wch: 17 },
          { wch: 17 },
          { wch: 12 },
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
    over: products.filter(p => p.status === 'over').length,
    defect: products.filter(p => p.status === 'defect').length,
    stolen: products.filter(p => p.status === 'stolen').length,
    ignored: products.filter(p => p.status === 'ignored').length,
  };

  if (loading) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Loading...</div>;
  }

  if (!session) {
    return <div className="text-center py-20 text-[14px] text-[#6e6e73]">Session not found</div>;
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-5">
        <div className="flex items-center justify-between">
          <div>
            <input
              type="text"
              value={session.name}
              onChange={async (e) => {
                const val = e.target.value;
                setSession(s => s ? { ...s, name: val } : s);
                await api.sessions.update(sessionId, { name: val });
              }}
              className="text-[18px] font-semibold text-[#1d1d1f] bg-transparent border-none outline-none focus:border-b focus:border-[#2563eb] pb-0.5"
            />
            <p className="text-[12px] text-[#6e6e73] mt-0.5">
              {session.status} &middot; Created {new Date(session.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {stage === 'verify' && (
              <button
                onClick={handleExport}
                disabled={products.length === 0 || exporting}
                title="Export Excel"
                aria-label="Export Excel"
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[#d2d2d7] text-[#15803d] transition-colors hover:bg-[#f0fdf4] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exporting ? (
                  <span className="text-[11px] text-[#6e6e73]">…</span>
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
            <div className="text-right text-[13px] text-[#6e6e73]">
              <span className="font-medium text-[#1d1d1f]">{statusCounts.matched}</span> matched
              <br />
              <span className="font-medium text-[#1d1d1f]">{statusCounts.missing}</span> missing
            </div>
            {stage === 'verify' && products.length > 0 && scannerCount > 0 && (
              <div className="flex items-center gap-1.5 text-[12px] text-[#6e6e73] bg-[#f5f5f7] rounded-full px-3 py-1.5">
                <span className="w-2 h-2 rounded-full bg-[#16a34a] animate-pulse" />
                {scannerCount}
              </div>
            )}
            <ProgressCircle progress={progress} size={56} strokeWidth={4} />
          </div>
        </div>

        {exportError && <p className="mt-3 text-[12px] text-[#dc2626]">{exportError}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => setStage('setup')}
            className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer ${
              stage === 'setup' ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            1. System Import
          </button>
          <button
            onClick={() => setStage('count')}
            className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer ${
              stage === 'count' ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            2. Count Import
          </button>
          <button
            onClick={() => setStage('verify')}
            className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer ${
              stage === 'verify' ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f]'
            }`}
          >
            3. Scan & Verify
          </button>
        </div>
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
              className="text-[13px] text-[#2563eb] hover:text-[#1d4ed8] cursor-pointer"
            >
              Skip — start live scanning instead
            </button>
          </div>
        </div>
      )}

      {stage === 'verify' && products.length > 0 && (
        <div className="pb-28">
          <div className="bg-white rounded-xl border border-[#d2d2d7] p-4 mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(statusCounts).map(([key, count]) => (
                <button
                  key={key}
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer ${
                    statusFilter === key
                      ? 'bg-[#2563eb] text-white'
                      : 'bg-[#f5f5f7] text-[#6e6e73] hover:text-[#1d1d1f]'
                  }`}
                >
                  {key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1)} ({count})
                </button>
              ))}
              <div className="flex-1" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by code or description..."
                className="px-3 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb] max-w-[250px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <ProductTable
                products={filteredProducts}
                displayColumns={session.display_columns || []}
                sortDesc={sortDesc}
                onToggleSort={() => setSortDesc(!sortDesc)}
                onUpdate={handleProductUpdate}
                onSelect={(p) => { setSelectedProduct(p); setLastScan(null); }}
                selectedCode={selectedProduct?.product_code || lastScan?.product_code}
                overscanCode={overscanCode}
              />
            </div>
            <div className="lg:col-span-1">
              <ScanPanel
                lastScan={lastScan}
                onRecount={async (code) => {
                  try {
                    const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ counted_qty: 0, status: 'pending' }),
                    });
                    const data = await res.json();
                    if (res.ok) {
                      setLastScan(null);
                      setProducts(prev => prev.map(p => p.product_code === code ? { ...p, ...data } : p));
                      loadSession();
                    }
                  } catch {}
                }}
                onStatusChange={async (code, status) => {
                  try {
                    const res = await fetch(`/api/pcount/sessions/${sessionId}/products/${encodeURIComponent(code)}`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ status }),
                    });
                    const data = await res.json();
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
        </div>
      )}

      {stage === 'verify' && products.length === 0 && (
        <div className="bg-white rounded-xl border border-[#d2d2d7] p-12 text-center">
          <p className="text-[14px] text-[#6e6e73] mb-3">No products imported yet.</p>
          <button
            onClick={() => setStage('setup')}
            className="px-4 py-2 bg-[#2563eb] text-white text-[13px] rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
          >
            Import System Export
          </button>
        </div>
      )}

      {stage === 'verify' && products.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-4 pt-4 bg-gradient-to-t from-[#f5f5f7] from-60% to-transparent">
          <div className="max-w-7xl mx-auto">
              <ScanBar
                sessionId={sessionId}
                onScanned={handleScan}
                onScanQueued={handleScanQueued}
                onScanFailed={handleScanFailed}
              />
          </div>
        </div>
      )}
    </div>
  );
}

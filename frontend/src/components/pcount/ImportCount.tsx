import { useState, useRef, useCallback, useMemo } from 'react';
import type { WorkBook } from 'xlsx';
import { type Product, readJson } from '../../lib/api';

interface Props {
  sessionId: number;
  onComplete: () => void;
  systemProducts?: Product[];
}

interface CountProduct {
  product_code: string;
  counted_qty: number;
  source_tab: string;
}

interface TabData {
  name: string;
  products: CountProduct[];
}

interface AlignedProduct {
  product_code: string;
  system_qty: number;
  counted_qty: number | null;
}

function productKey(code: string): string {
  const normalized = code.trim().toUpperCase().replace(/^0+/, '');
  return normalized || '0';
}

function headerKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function sortZToA<T extends { product_code: string }>(products: T[]): T[] {
  return [...products].sort((a, b) => b.product_code.localeCompare(a.product_code));
}

export default function ImportCount({ sessionId, onComplete, systemProducts = [] }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [tabs, setTabs] = useState<TabData[]>([]);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const workbookRef = useRef<WorkBook | null>(null);
  const xlsxRef = useRef<typeof import('xlsx') | null>(null);

  function parseSheet(headerIdx: number) {
    const workbook = workbookRef.current;
    const XLSX = xlsxRef.current;
    if (!workbook || !XLSX) return;

    try {
      const parsed: TabData[] = [];
      const requiredTabs = ['Apple', '3PP'] as const;

      for (const tabName of requiredTabs) {
        const actualSheetName = workbook.SheetNames.find(name => name.trim().toLowerCase() === tabName.toLowerCase());
        if (!actualSheetName) continue;

        const sheet = workbook.Sheets[actualSheetName];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
        const headers = raw[headerIdx] || [];
        const normalizedHeaders = headers.map(headerKey);
        const codeCol = normalizedHeaders.findIndex(value => value === 'productcode' || value.includes('productcode'));
        const qtyCol = normalizedHeaders.findIndex(value => value === 'qty' || value === 'quantity' || value.includes('quantity'));

        if (codeCol < 0 || qtyCol < 0) {
          throw new Error(`${tabName} tab must have Product code and QTY columns`);
        }

        const totals = new Map<string, CountProduct>();
        const dataRows = raw.slice(headerIdx + 1).filter(row => row.some(cell => String(cell || '').trim() !== ''));
        for (const row of dataRows) {
          const productCode = String(row[codeCol] || '').trim();
          if (!productCode) continue;

          const rawQty = String(row[qtyCol] ?? '').trim().replace(/,/g, '');
          const countedQty = rawQty === '' ? 0 : Math.max(0, Number.parseInt(rawQty, 10) || 0);
          const key = productKey(productCode);
          const existing = totals.get(key);
          if (existing) {
            existing.counted_qty += countedQty;
          } else {
            totals.set(key, { product_code: productCode, counted_qty: countedQty, source_tab: tabName });
          }
        }

        parsed.push({ name: tabName, products: sortZToA([...totals.values()]) });
      }

      const totalRows = parsed.reduce((total, tab) => total + tab.products.length, 0);
      if (parsed.length === 0) {
        setError('The workbook must contain Apple and/or 3PP tabs.');
        setTabs([]);
        return;
      }
      if (totalRows === 0) {
        setError('No count rows found in the Apple or 3PP tabs.');
        setTabs(parsed);
        return;
      }

      setTabs(parsed);
      setError('');
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Failed to parse count workbook');
      setTabs([]);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    setFile(selectedFile);
    setHeaderRow(1);
    setError('');

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        xlsxRef.current = XLSX;
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        workbookRef.current = XLSX.read(data, { type: 'array' });
        parseSheet(0);
      } catch {
        setError('Failed to parse Excel file');
        setTabs([]);
      }
    };
    reader.readAsArrayBuffer(selectedFile);
  }

  const handleHeaderRowChange = useCallback((value: number) => {
    const nextHeaderRow = Math.max(1, value);
    setHeaderRow(nextHeaderRow);
    setError('');
    parseSheet(nextHeaderRow - 1);
  }, []);

  const pivotedProducts = useMemo(() => {
    const totals = new Map<string, CountProduct>();
    for (const product of tabs.flatMap(tab => tab.products)) {
      const key = productKey(product.product_code);
      const existing = totals.get(key);
      if (existing) {
        existing.counted_qty += product.counted_qty;
      } else {
        totals.set(key, { ...product });
      }
    }
    return sortZToA([...totals.values()]);
  }, [tabs]);

  const alignedProducts = useMemo<AlignedProduct[]>(() => {
    const countMap = new Map(pivotedProducts.map(product => [productKey(product.product_code), product.counted_qty]));
    return [...systemProducts]
      .sort((a, b) => b.product_code.localeCompare(a.product_code))
      .map(product => ({
        product_code: product.product_code,
        system_qty: product.system_qty,
        counted_qty: countMap.has(productKey(product.product_code))
          ? countMap.get(productKey(product.product_code))!
          : null,
      }));
  }, [pivotedProducts, systemProducts]);

  async function handleDownloadTemplate() {
    if (downloadingTemplate) return;
    setDownloadingTemplate(true);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      for (const tabName of ['Apple', '3PP']) {
        const worksheet = XLSX.utils.aoa_to_sheet([['Product code', 'QTY']]);
        worksheet['!cols'] = [{ wch: 24 }, { wch: 12 }];
        XLSX.utils.book_append_sheet(workbook, worksheet, tabName);
      }
      XLSX.writeFile(workbook, 'pcount-count-template.xlsx');
    } catch {
      setError('Failed to download the count template');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleImport() {
    const sourceProducts = systemProducts.length > 0
      ? alignedProducts.filter(product => product.counted_qty !== null)
      : pivotedProducts;
    if (sourceProducts.length === 0) {
      setError('There are no count rows aligned to the system import.');
      return;
    }

    setImporting(true);
    setError('');
    try {
      const res = await fetch(`/api/pcount/sessions/${sessionId}/import-count`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          products: sourceProducts.map(product => ({
            product_code: product.product_code,
            counted_qty: product.counted_qty,
          })),
        }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error);
      onComplete();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  const totalProducts = pivotedProducts.length;
  const blankRows = alignedProducts.filter(product => product.counted_qty === null).length;

  return (
    <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
      <h2 className="text-[16px] font-semibold text-[#1d1d1f] mb-4">Import Actual Count</h2>
      <p className="text-[13px] text-[#6e6e73] mb-4">
        Upload the Apple and 3PP count workbook. Rows are pivoted, sorted Z\u2013A, and aligned to the system import by product code.
      </p>

      {!file ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              className="px-3 py-1.5 border border-[#d2d2d7] text-[13px] font-medium rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
            >
              Select count Excel file
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
            <button
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              className="text-[12px] text-[#2563eb] hover:text-[#1d4ed8] disabled:opacity-50 cursor-pointer"
            >
              {downloadingTemplate ? 'Preparing template\u2026' : 'Download count template'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-[13px] text-[#6e6e73] mb-3">File: {file.name}</p>

          <div className="flex items-center gap-3 mb-4">
            <label className="text-[12px] font-medium text-[#6e6e73]">Header row:</label>
            <input
              type="number"
              min={1}
              value={headerRow}
              onChange={e => handleHeaderRowChange(Number.parseInt(e.target.value, 10) || 1)}
              className="w-20 px-3 py-2 border border-[#d2d2d7] rounded-lg text-[13px] bg-white"
            />
            <span className="text-[12px] text-[#6e6e73]">
              {tabs.length > 0 ? `${tabs.length} tabs, ${totalProducts} unique count products` : ''}
            </span>
          </div>

          {tabs.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {tabs.map(tab => (
                  <span key={tab.name} className="rounded-full bg-[#f5f5f7] px-3 py-1 text-[12px] text-[#6e6e73]">
                    {tab.name}: {tab.products.length} rows
                  </span>
                ))}
              </div>

              {systemProducts.length > 0 ? (
                <>
                  <p className="text-[12px] font-medium text-[#6e6e73] mb-2">
                    Aligned to system import &middot; sorted Z\u2013A &middot; blank Actual Qty means no matching count row ({blankRows} blank rows)
                  </p>
                  <div className="max-h-80 overflow-y-auto border border-[#d2d2d7] rounded-lg">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-[#f5f5f7]">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-[#6e6e73]">Product Code</th>
                          <th className="text-right px-3 py-2 font-medium text-[#6e6e73]">System Qty</th>
                          <th className="text-right px-3 py-2 font-medium text-[#6e6e73]">Actual Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alignedProducts.slice(0, 50).map(product => (
                          <tr key={product.product_code} className="border-t border-[#d2d2d7]">
                            <td className="px-3 py-1.5 text-[#1d1d1f]">{product.product_code}</td>
                            <td className="px-3 py-1.5 text-right text-[#1d1d1f]">{product.system_qty}</td>
                            <td className="px-3 py-1.5 text-right text-[#1d1d1f]">{product.counted_qty ?? ''}</td>
                          </tr>
                        ))}
                        {alignedProducts.length > 50 && (
                          <tr className="border-t border-[#d2d2d7]">
                            <td colSpan={3} className="px-3 py-1.5 text-center text-[#6e6e73]">
                              ... and {alignedProducts.length - 50} more aligned rows
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="text-[12px] text-[#d97706] mb-3">System import is empty; count rows will be imported by product code.</p>
              )}

              {error && <p className="text-[13px] text-[#dc2626] mt-3 mb-3">{error}</p>}

              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => { setFile(null); setTabs([]); workbookRef.current = null; }}
                  className="px-4 py-2 border border-[#d2d2d7] text-[13px] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || (systemProducts.length > 0 ? alignedProducts.every(product => product.counted_qty === null) : pivotedProducts.length === 0)}
                  className="px-4 py-2 bg-[#2563eb] text-white text-[13px] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {importing ? 'Importing\u2026' : `Import ${systemProducts.length > 0 ? alignedProducts.filter(product => product.counted_qty !== null).length : totalProducts} Products`}
                </button>
              </div>
            </>
          )}

          {tabs.length === 0 && error && <p className="text-[13px] text-[#dc2626]">{error}</p>}
        </div>
      )}
    </div>
  );
}

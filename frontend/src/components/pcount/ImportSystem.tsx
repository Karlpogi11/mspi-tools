import { useState, useRef, useCallback, useEffect } from 'react';
import type { WorkBook } from 'xlsx';
import { type Product, readJson } from '../../lib/api';

interface Props {
  sessionId: number;
  onComplete: () => void;
  hasProducts: boolean;
  currentDisplayColumns: string[];
  productCount: number;
  disabled?: boolean;
  onlineCount?: number;
  activeScannerCount?: number;
  availableDisplayColumns?: string[];
  previewProducts?: Product[];
  onDisplayColumnsChange?: (columns: string[]) => void;
}

interface ColumnMapping {
  productCode: string;
  description: string;
  quantity: string;
  displayColumns: string[];
}

export default function ImportSystem({ sessionId, onComplete, hasProducts, currentDisplayColumns, productCount, disabled, onlineCount = 0, activeScannerCount = 0, availableDisplayColumns = [], previewProducts = [], onDisplayColumnsChange }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({ productCode: '', description: '', quantity: '', displayColumns: currentDisplayColumns.length > 0 ? currentDisplayColumns : [] });
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [excludedPartNumbers, setExcludedPartNumbers] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const workbookRef = useRef<WorkBook | null>(null);
  const xlsxRef = useRef<typeof import('xlsx') | null>(null);

  useEffect(() => {
    setMapping(mappingState => {
      const sameColumns = mappingState.displayColumns.length === currentDisplayColumns.length
        && mappingState.displayColumns.every((column, index) => column === currentDisplayColumns[index]);
      return sameColumns ? mappingState : { ...mappingState, displayColumns: currentDisplayColumns };
    });
  }, [currentDisplayColumns]);

  function detectHeaderRow(raw: string[][]): number {
    const maxScan = Math.min(raw.length, 8);
    let best = 0;
    let bestScore = -1;
    const headerHints = /(code|sku|description|name|qty|quantity|brand|category|price|cost|barcode|serial|retail|group|model)/i;
    for (let i = 0; i < maxScan; i++) {
      const cells = raw[i] || [];
      const nonEmpty = cells.filter(c => c !== undefined && String(c).trim() !== '').length;
      const named = cells.filter(c => headerHints.test(String(c || ''))).length;
      const numeric = cells.filter(c => !isNaN(Number(String(c || '').trim()))).length;
      const score = named * 3 + nonEmpty - numeric;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  function parseSheet(headerIdx: number) {
    const wb = workbookRef.current;
    const XLSX = xlsxRef.current;
    if (!wb || !XLSX) return;
    try {
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
      if (raw.length === 0) { setError('File is empty'); return; }
      const hdrRow = raw[headerIdx] || [];
      const dataRows = raw.slice(headerIdx + 1).filter(r => r.some(c => c !== undefined && c !== ''));
      if (dataRows.length === 0) { setError('No data rows found after header'); return; }
      const cols = hdrRow.map((h, i) => String(h || `Column_${i + 1}`));
      setRawRows(dataRows);
      const json = dataRows.map(row => {
        const obj: Record<string, string> = {};
        cols.forEach((h, i) => { obj[h] = String(row[i] || ''); });
        return obj;
      });
      setHeaders(cols);
      setPreview(json.slice(0, 5));
      setError('');
      const firstValCols = cols.filter(c => { const v = json.find(r => r[c]?.trim()); return v && isNaN(Number(v[c])); });
      const qtyCols = cols.filter(c => { const v = json.find(r => r[c]?.trim()); return v && !isNaN(Number(v[c])); });
      setMapping(m => ({
        ...m,
        productCode: firstValCols[0] || cols[0] || '',
        description: firstValCols[1] || cols[1] || cols[0] || '',
        quantity: qtyCols[0] || cols[2] || cols[1] || '',
        displayColumns: m.displayColumns.length > 0 ? m.displayColumns : cols.filter(c => c !== cols[0] && c !== cols[1]).slice(0, 8),
      }));
    } catch { setError('Failed to parse Excel file'); }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setError('');
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const XLSX = await import('xlsx');
        xlsxRef.current = XLSX;
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        workbookRef.current = XLSX.read(data, { type: 'array' });
        const sheet = workbookRef.current.Sheets[workbookRef.current.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
        const detected = detectHeaderRow(raw);
        setHeaderRow(detected + 1);
        parseSheet(detected);
      } catch { setError('Failed to parse Excel file'); }
    };
    reader.readAsArrayBuffer(f);
  }

  const handleHeaderRowChange = useCallback((val: number) => {
    const idx = Math.max(0, val - 1);
    setHeaderRow(val);
    setError('');
    parseSheet(idx);
  }, []);

  async function importWithFullData(replace: boolean) {
    if (!mapping.productCode) { setError('Select a column for product code'); return; }
    setImporting(true);
    setError('');
    try {
      const json = rawRows.map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = String(row[i] || ''); });
        return obj;
      });
      const excluded = new Set(
        excludedPartNumbers
          .split(/[\s,;]+/)
          .map(code => code.trim().toUpperCase())
          .filter(Boolean),
      );
      const products = json.map(row => {
        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k !== mapping.productCode && k !== mapping.description && k !== mapping.quantity) {
            extra[k] = v;
          }
        }
        return {
          product_code: row[mapping.productCode] || '',
          description: row[mapping.description] || '',
          system_qty: parseInt(row[mapping.quantity]) || 0,
          extra,
        };
      }).filter(product => product.product_code.trim() && !excluded.has(product.product_code.trim().toUpperCase()));
      if (products.length === 0) {
        throw new Error('All imported rows were excluded. Keep at least one product.');
      }
      const qs = replace ? '?replace=true' : '';
      const res = await fetch(`/api/pcount/sessions/${sessionId}/import-system${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ display_columns: mapping.displayColumns, products }),
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data.error);
      setShowUpload(false);
      setConfirmReplace(false);
      onComplete();
    } catch (err) {
      setError((err as Error).message || 'Import failed');
    } finally { setImporting(false); }
  }

  async function updateDisplayColumns(cols: string[]) {
    setMapping(m => ({ ...m, displayColumns: cols }));
    try {
      await fetch(`/api/pcount/sessions/${sessionId}/display-columns`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ columns: cols }),
      });
      onDisplayColumnsChange?.(cols);
    } catch {}
  }

  function toggleDisplay(col: string) {
    const newCols = mapping.displayColumns.includes(col)
      ? mapping.displayColumns.filter(c => c !== col)
      : [...mapping.displayColumns, col];
    updateDisplayColumns(newCols);
  }

  function handleStartReplace() {
    setConfirmReplace(true);
    setShowUpload(true);
    setFile(null);
    setHeaders([]);
    setPreview([]);
    setRawRows([]);
    setError('');
  }

  if (hasProducts && !showUpload) {
    const displayColumnOptions = Array.from(new Set(['Description', ...availableDisplayColumns, ...currentDisplayColumns]));
    const selectedColumns = mapping.displayColumns;
    const previewColumns = selectedColumns.length > 0
      ? ['Description', ...selectedColumns.filter(column => column !== 'Description')]
      : displayColumnOptions;
    return (
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
        {disabled && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Scanning is active on {activeScannerCount} device{activeScannerCount === 1 ? '' : 's'} &mdash; file replacement is locked.
          </div>
        )}
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-[16px] font-semibold text-[#1d1d1f]">System Export Imported</h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] text-[#6e6e73]">
            <span className={`h-1.5 w-1.5 rounded-full ${onlineCount > 0 ? 'bg-[#16a34a]' : 'bg-[#9ca3af]'}`} />
            {onlineCount} online
          </span>
        </div>
        <p className="text-[13px] text-[#6e6e73] mb-4">
          {productCount} products imported. Configure which extra columns to display below.
        </p>

        <div className="mb-4">
          <label className="text-[12px] font-medium text-[#6e6e73] block mb-2">Display these extra columns</label>
          <div className="flex flex-wrap gap-2">
            {displayColumnOptions.length === 0 ? (
              <p className="text-[13px] text-[#6e6e73]">No extra columns found in the imported file.</p>
            ) : (
              displayColumnOptions.map(col => (
                  <label key={col} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={col === 'Description' || mapping.displayColumns.includes(col)}
                      disabled={col === 'Description'}
                      onChange={() => toggleDisplay(col)}
                      className="accent-[#2563eb]"
                    />
                    {col}
                    {col === 'Description' && <span className="text-[11px] text-[#9ca3af]">always shown</span>}
                </label>
              ))
            )}
          </div>
        </div>

        {previewColumns.length > 0 && previewProducts.length > 0 && (
          <div className="mt-5 overflow-hidden rounded-lg border border-[#d2d2d7]">
            <div className="border-b border-[#d2d2d7] bg-[#f5f5f7] px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-[#6e6e73]">
              Imported data preview{selectedColumns.length === 0 ? ' &middot; select columns to show in the table' : ''}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="border-b border-[#d2d2d7] text-[#6e6e73]">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">Product Code</th>
                    {previewColumns.map(column => (
                      <th key={column} className="whitespace-nowrap px-3 py-2 text-left font-medium">{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewProducts.slice(0, 5).map(product => (
                    <tr key={product.id} className="border-b border-[#d2d2d7]/60 last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[#1d1d1f]">{product.product_code}</td>
                      {previewColumns.map(column => (
                        <td key={column} className="max-w-[180px] truncate px-3 py-2 text-[#6e6e73]">{column === 'Description' ? product.description || '\u2014' : product.extra[column] || '\u2014'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4">
          <button
            onClick={handleStartReplace}
            disabled={disabled}
            className="px-4 py-2 border border-[#dc2626] text-[#dc2626] text-[13px] rounded-lg hover:bg-[#fef2f2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {disabled ? 'Locked' : 'Replace File'}
          </button>
        </div>
      </div>
    );
  }

  if (hasProducts && showUpload && confirmReplace) {
    return (
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f] mb-4">Replace System Export</h2>
        <p className="text-[13px] text-[#dc2626] mb-4">
          This will replace all {productCount} existing products with the new file. This cannot be undone.
        </p>

        {renderUpload()}
      </div>
    );
  }

  function renderUpload() {
    return (
      <div>
        {disabled && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            Import is locked &mdash; {activeScannerCount} device{activeScannerCount === 1 ? '' : 's'} are actively scanning. Wait until scanning finishes.
          </div>
        )}
        {!file ? (
          <div onClick={() => { if (!disabled) inputRef.current?.click(); }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              disabled
                ? 'border-[#d2d2d7] opacity-50 cursor-not-allowed'
                : 'border-[#d2d2d7] hover:border-[#2563eb] cursor-pointer'
            }`}>
            <p className="text-[14px] text-[#6e6e73]">Click to select Excel file (.xlsx or .xls)</p>
            <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
          </div>
        ) : (
          <div>
            <p className="text-[13px] text-[#6e6e73] mb-3">File: {file.name}</p>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-[12px] font-medium text-[#6e6e73]">Header row:</label>
              <input type="number" min={1} value={headerRow}
                onChange={e => handleHeaderRowChange(parseInt(e.target.value) || 1)}
                className="w-20 px-3 py-2 border border-[#d2d2d7] rounded-lg text-[13px] bg-white" />
              <span className="text-[12px] text-[#6e6e73]">
                {headers.length > 0 ? `${headers.length} columns, ${rawRows.length} data rows` : ''}
              </span>
            </div>

            {headers.length > 0 && (
              <>
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="text-[12px] font-medium text-[#6e6e73] block mb-1">Product Code column</label>
                    <select value={mapping.productCode} onChange={e => setMapping(m => ({ ...m, productCode: e.target.value }))}
                      className="w-full border border-[#d2d2d7] rounded-lg px-3 py-2 text-[13px] bg-white">
                      <option value="">Select column...</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6e6e73] block mb-1">Description column</label>
                    <select value={mapping.description} onChange={e => setMapping(m => ({ ...m, description: e.target.value }))}
                      className="w-full border border-[#d2d2d7] rounded-lg px-3 py-2 text-[13px] bg-white">
                      <option value="">Select column...</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[12px] font-medium text-[#6e6e73] block mb-1">Quantity column</label>
                    <select value={mapping.quantity} onChange={e => setMapping(m => ({ ...m, quantity: e.target.value }))}
                      className="w-full border border-[#d2d2d7] rounded-lg px-3 py-2 text-[13px] bg-white">
                      <option value="">Select column...</option>
                      {headers.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>

                <div className="mb-4">
                  <label className="text-[12px] font-medium text-[#6e6e73] block mb-2">Display these columns</label>
                  <div className="flex flex-wrap gap-2">
                    {headers.filter(h => h !== mapping.productCode && h !== mapping.description && h !== mapping.quantity).map(h => (
                      <label key={h} className="flex items-center gap-1.5 text-[13px] cursor-pointer">
                        <input type="checkbox" checked={mapping.displayColumns.includes(h)}
                          onChange={() => toggleDisplay(h)} className="accent-[#2563eb]" />
                        {h}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="mb-4 rounded-lg border border-[#d2d2d7] bg-[#fafafa] p-3">
                  <label className="text-[12px] font-medium text-[#6e6e73] block mb-1">
                    Exclude whole-unit part numbers
                  </label>
                  <p className="text-[12px] text-[#6e6e73] mb-2">
                    These codes will not be imported, so they cannot remain pending or appear in the final count.
                  </p>
                  <textarea
                    value={excludedPartNumbers}
                    onChange={e => setExcludedPartNumbers(e.target.value)}
                    placeholder="One code per line, or separate codes with commas"
                    rows={2}
                    className="w-full resize-y rounded-lg border border-[#d2d2d7] bg-white px-3 py-2 text-[13px] font-mono outline-none focus:border-[#2563eb]"
                  />
                </div>

                <div className="mb-4">
                  <p className="text-[12px] font-medium text-[#6e6e73] mb-1">Preview (first {preview.length} rows)</p>
                  <div className="overflow-x-auto border border-[#d2d2d7] rounded-lg">
                    <table className="w-full text-[12px]">
                      <thead>
                        <tr className="bg-[#f5f5f7]">
                          <th className="text-left px-3 py-2 font-medium text-[#6e6e73]">#</th>
                          <th className="text-left px-3 py-2 font-medium text-[#2563eb]">Product Code</th>
                          <th className="text-left px-3 py-2 font-medium text-[#2563eb]">Description</th>
                          {mapping.quantity && (
                            <th className="text-left px-3 py-2 font-medium text-[#2563eb]">System Qty ({mapping.quantity})</th>
                          )}
                          {mapping.displayColumns.map(h => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-[#2563eb]">{h}</th>
                          ))}
                          {mapping.displayColumns.length === 0 && headers.slice(0, 6).map(h => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-[#6e6e73]">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.map((row, i) => (
                          <tr key={i} className="border-t border-[#d2d2d7]">
                            <td className="px-3 py-2 text-[#6e6e73]">{i + 1}</td>
                            <td className="px-3 py-2 text-[#1d1d1f] font-mono text-[12px] max-w-[140px] truncate">{row[mapping.productCode]}</td>
                            <td className="px-3 py-2 text-[#1d1d1f] max-w-[200px] truncate">{row[mapping.description]}</td>
                            {mapping.quantity && (
                              <td className="px-3 py-2 text-[#1d1d1f] tabular-nums">{row[mapping.quantity]}</td>
                            )}
                            {mapping.displayColumns.length > 0
                              ? mapping.displayColumns.map(h => <td key={h} className="px-3 py-2 text-[#1d1d1f] truncate max-w-[120px]">{row[h]}</td>)
                              : headers.filter(h => h !== mapping.productCode && h !== mapping.description).slice(0, 6).map(h => (
                                  <td key={h} className="px-3 py-2 text-[#6e6e73] truncate max-w-[120px]">{row[h]}</td>
                                ))
                            }
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {error && <p className="text-[13px] text-[#dc2626] mb-3">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => { if (confirmReplace) { setShowUpload(false); setConfirmReplace(false); } else { setFile(null); setHeaders([]); setPreview([]); setRawRows([]); workbookRef.current = null; } }}
                className="px-4 py-2 border border-[#d2d2d7] text-[13px] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer">
                Cancel
              </button>
              <button onClick={() => importWithFullData(confirmReplace)} disabled={importing || disabled || !mapping.productCode || headers.length === 0}
                className="px-4 py-2 bg-[#2563eb] text-white text-[13px] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors cursor-pointer">
                {importing ? 'Importing...' : confirmReplace ? `Replace with ${rawRows.length} Products` : `Import ${rawRows.length} Products`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return renderUpload();
}

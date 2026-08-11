import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { api, type AwbLogRow, type ExtractResult, type ExtractStatus } from '../../lib/api';

const LOG_COLUMNS = ['HAWB', 'InvoiceReference', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty', 'ReceivedDate', 'OriginalFilename', 'DateLogged'];

const secondaryBtnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#d2d2d7] bg-white text-[12px] font-medium text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const primaryBtnCls =
  'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#2563eb] text-white text-[12px] font-semibold hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer';

const iconUpload = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);
const iconCopy = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const iconDownload = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const statusMeta: Record<ExtractStatus | 'ok', { label: string; cls: string }> = {
  ok: { label: 'Logged', cls: 'bg-[#ecfdf5] text-[#047857] border-[#a7f3d0]' },
  duplicate: { label: 'Already logged', cls: 'bg-[#f5f5f7] text-[#6e6e73] border-[#d2d2d7]' },
  error: { label: 'Error', cls: 'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]' },
  permit: { label: 'Permit', cls: 'bg-[#fffbeb] text-[#b45309] border-[#fde68a]' },
};

function Badge({ status }: { status: ExtractStatus }) {
  const meta = statusMeta[status] ?? statusMeta.error;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  );
}

function AutoValue({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="min-h-[24px] flex items-center">
      {children || <span className={muted ? 'text-[#c7c7cc]' : 'text-[#a1a1a6]'}>{'\u2014'}</span>}
    </div>
  );
}

function toTsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n');
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function exportXlsx(rows: Array<Array<string | number>>, filename: string) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([[LOG_COLUMNS], ...rows]);
  XLSX.utils.book_append_sheet(wb, ws, 'AWB Log');
  XLSX.writeFile(wb, filename);
}

interface ResultRow {
  file: string;
  status: ExtractStatus;
  reasons?: string[];
  fields?: ExtractResult['fields'];
  monthFolder?: string;
}

export default function PdfExtractorPage() {
  const [results, setResults] = useState<ResultRow[]>([]);
  const [log, setLog] = useState<AwbLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  function loadLog() {
    api.pdfExtractor
      .log()
      .then(setLog)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load log'));
  }

  useEffect(() => {
    loadLog();
  }, []);

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    }
    function onDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (busyRef.current) return;
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (files.length > 0) void handleFiles(files);
    }
    function onDocDragOver(e: DragEvent) {
      e.preventDefault();
    }
    function onDocDrop(e: DragEvent) {
      e.preventDefault();
    }
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    document.addEventListener('dragover', onDocDragOver);
    document.addEventListener('drop', onDocDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      document.removeEventListener('dragover', onDocDragOver);
      document.removeEventListener('drop', onDocDrop);
    };
  }, []);

  async function handleFiles(files: File[]) {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setError('No PDF files found. Drop or import .pdf files.');
      return;
    }
    setError('');
    setBusy(true);
    setNotice('');
    try {
      const out = await api.pdfExtractor.extract(pdfs);
      setResults(
        out.map((r) => ({
          file: r.file,
          status: r.status,
          reasons: r.reasons,
          fields: r.fields,
          monthFolder: r.monthFolder,
        }))
      );
      const logged = out.filter((r) => r.status === 'ok').length;
      const failed = out.filter((r) => r.status === 'error').length;
      const parts: string[] = [];
      if (logged > 0) parts.push(`${logged} invoice${logged === 1 ? '' : 's'} logged`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (parts.length > 0) setNotice(`Processed ${out.length} file${out.length === 1 ? '' : 's'} — ${parts.join(', ')}.`);
      loadLog();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process files');
    } finally {
      setBusy(false);
    }
  }

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) void handleFiles(files);
  }

  const resultRows = results.map((r) => [
    r.fields?.HAWB ?? '',
    r.fields?.InvoiceReference ?? '',
    r.fields?.InvoiceTotalAmount ?? '',
    r.fields?.DeliveryDate ?? '',
    r.fields?.TotalQty ?? '',
    '',
    r.file,
    '',
  ]);

  const logRows = log.map((r) => [
    r.hawb,
    r.invoice_reference,
    r.invoice_total_amount,
    r.delivery_date,
    r.total_qty,
    r.received_date ?? '',
    r.original_filename,
    r.date_logged ? new Date(r.date_logged).toLocaleString() : '',
  ]);

  async function copyResults() {
    if (resultRows.length === 0) return;
    await copyText(toTsv(resultRows));
    setNotice('Results copied to clipboard');
  }

  async function copyLog() {
    if (logRows.length === 0) return;
    await copyText(toTsv(logRows));
    setNotice('Log copied to clipboard');
  }

  function exportResults() {
    if (resultRows.length === 0) return;
    exportXlsx(resultRows, 'awb-log.xlsx');
    setNotice('Exported log to Excel');
  }

  function exportLog() {
    if (logRows.length === 0) return;
    exportXlsx(logRows, 'awb-log.xlsx');
    setNotice('Exported log to Excel');
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[#1d1d1f] tracking-tight">PDF Extractor</h1>
          <p className="text-[12px] text-[#6e6e73] mt-0.5">
            Drop or import AWB/invoice PDFs — extracts the invoice reference, HAWB, amount, delivery date, and quantity,
            then files them by month. Received date is left blank. &middot; Drag &amp; drop anywhere on this page.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-[#dc2626] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#ecfdf5] border border-[#a7f3d0] text-[13px] text-[#047857] flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-[#047857] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#d2d2d7] p-6 mb-6">
        <input ref={importRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleImport} />
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[#eff6ff] flex items-center justify-center text-[#2563eb] mb-3">
            {iconUpload}
          </div>
          <p className="text-[14px] font-medium text-[#1d1d1f]">
            {busy ? 'Extracting PDFs…' : 'Drag &amp; drop PDFs here'}
          </p>
          <p className="text-[12px] text-[#9ca3af] mt-1">
            {busy ? 'Scanning pages and pulling out the invoice details — this can take a few seconds per file.' : 'Any filename works — unrenamed files are fine, they get renamed to the invoice reference automatically.'}
          </p>
          <div className="mt-4">
            <button onClick={() => importRef.current?.click()} disabled={busy} className={primaryBtnCls}>
              {iconUpload}
              {busy ? 'Processing…' : 'Import PDFs'}
            </button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden mb-6">
          <div className="px-4 py-2 border-b border-[#d2d2d7]/60 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium text-[#1d1d1f]">Latest extraction</h2>
            <div className="flex items-center gap-2">
              <button onClick={copyResults} disabled={busy} className={secondaryBtnCls}>
                {iconCopy}
                Copy results
              </button>
              <button onClick={exportResults} disabled={busy} className={secondaryBtnCls}>
                {iconDownload}
                Export Excel
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">File</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Status</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Invoice Ref</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">HAWB</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Amount</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Delivery Date</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Qty</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Received Date</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Filed to</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-[#d2d2d7]/60">
                    <td className="px-3 py-1.5 text-[#1d1d1f] max-w-[200px] truncate" title={r.file}>{r.file}</td>
                    <td className="px-3 py-1.5">
                      <Badge status={r.status} />
                    </td>
                    <td className="px-3 py-1.5 font-medium text-[#1d1d1f]">
                      <AutoValue>{r.fields?.InvoiceReference}</AutoValue>
                    </td>
                    <td className="px-3 py-1.5"><AutoValue>{r.fields?.HAWB}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.fields?.InvoiceTotalAmount}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.fields?.DeliveryDate}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.fields?.TotalQty}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue muted>{null}</AutoValue></td>
                    <td className="px-3 py-1.5 text-[#6e6e73]">
                      {r.status === 'error' ? (
                        <span className="text-[#dc2626]">{r.reasons?.join(', ') || 'Failed'}</span>
                      ) : r.status === 'permit' ? (
                        <span>permits/</span>
                      ) : r.monthFolder ? (
                        <span>{r.monthFolder}/</span>
                      ) : (
                        '\u2014'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
        <div className="px-4 py-2 border-b border-[#d2d2d7]/60 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium text-[#1d1d1f]">
            AWB Log <span className="text-[#9ca3af] font-normal">({log.length})</span>
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={copyLog} className={secondaryBtnCls}>
              {iconCopy}
              Copy log
            </button>
            <button onClick={exportLog} className={secondaryBtnCls}>
              {iconDownload}
              Export Excel
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          {log.length === 0 ? (
            <p className="text-[13px] text-[#9ca3af] text-center py-10">
              No invoices logged yet. Drop or import your first PDF above.
            </p>
          ) : (
            <table className="w-full text-[13px]" style={{ minWidth: '1000px' }}>
              <thead>
                <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Invoice Ref</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">HAWB</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Amount</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Delivery Date</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Qty</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Received Date</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Original File</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Month</th>
                  <th className="px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">Date Logged</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} className="border-b border-[#d2d2d7]/60">
                    <td className="px-3 py-1.5 font-medium text-[#1d1d1f]">{r.invoice_reference}</td>
                    <td className="px-3 py-1.5"><AutoValue>{r.hawb}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.invoice_total_amount}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.delivery_date}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue>{r.total_qty}</AutoValue></td>
                    <td className="px-3 py-1.5"><AutoValue muted>{r.received_date || null}</AutoValue></td>
                    <td className="px-3 py-1.5 text-[#6e6e73] max-w-[220px] truncate" title={r.original_filename}>
                      <AutoValue>{r.original_filename}</AutoValue>
                    </td>
                    <td className="px-3 py-1.5"><AutoValue>{r.month_folder}</AutoValue></td>
                    <td className="px-3 py-1.5 text-[#6e6e73]">
                      <AutoValue>{r.date_logged ? new Date(r.date_logged).toLocaleString() : null}</AutoValue>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {dragActive && (
        <div className="fixed inset-0 z-50 bg-[#2563eb]/10 border-4 border-dashed border-[#2563eb] rounded-2xl flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-center">
            <p className="text-[15px] font-semibold text-[#1d1d1f]">Drop to extract PDFs</p>
            <p className="text-[12px] text-[#6e6e73] mt-1">Any filenames accepted — they get renamed to the invoice reference</p>
          </div>
        </div>
      )}
    </div>
  );
}
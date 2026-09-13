import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import * as XLSX from 'xlsx';
import { api, type AwbLogRow, type ExtractDownload, type ExtractResult, type ExtractStatus, type PdfDiagnostic } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import ToolHelp from '../../components/ToolHelp';
import { createClientId } from '../../lib/clientId';

const LOG_COLUMNS = ['HAWB', 'InvoiceReference', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty', 'ReceivedDate', 'OriginalFilename', 'DateLogged'];

const secondaryBtnCls =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#d2d2d7] bg-white text-[12px] font-medium text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const primaryBtnCls =
  'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#2563eb] text-white text-[12px] font-semibold hover:bg-[#1d4ed8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer';
const MAX_FILES_PER_RUN = 50;
// Keep multipart uploads comfortably below shared-hosting proxy limits. The
// overall run is still 50 files and each group remains resumable and ordered.
const PROCESSING_BATCH_SIZE = 5;
const MAX_UPLOAD_GROUP_BYTES = 48 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 60 * 1024 * 1024;
const BATCH_REQUEST_TIMEOUT_MS = 6 * 60 * 1000;

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

function ProcessingSpinner() {
  return (
    <div className="relative w-16 h-16" role="img" aria-label="Scanning PDF documents">
      <div className="absolute inset-0 rounded-full border-2 border-[#dbeafe] border-t-[#2563eb] border-r-[#2563eb] animate-spin" />
      <div
        className="absolute inset-[6px] rounded-full border border-dashed border-[#93c5fd] border-b-[#1d4ed8] animate-spin"
        style={{ animationDirection: 'reverse', animationDuration: '1.6s' }}
      />
      <div className="absolute left-1/2 top-0 w-2 h-2 -translate-x-1/2 -translate-y-0.5 rounded-full bg-[#2563eb] shadow-[0_0_10px_#2563eb]" />
      <div className="absolute right-0 top-1/2 w-1.5 h-1.5 -translate-y-1/2 rounded-full bg-[#60a5fa]" />
      <div className="absolute inset-[14px] rounded-lg bg-white border border-[#bfdbfe] shadow-sm flex items-center justify-center overflow-hidden">
        <svg className="w-6 h-6 text-[#2563eb]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h6" />
        </svg>
        <div className="absolute left-1 right-1 top-1/2 h-px bg-[#2563eb] shadow-[0_0_6px_#2563eb] animate-pulse" />
      </div>
    </div>
  );
}

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
  const ws = XLSX.utils.aoa_to_sheet([LOG_COLUMNS, ...rows]);
  ws['!autofilter'] = { ref: `A1:H${Math.max(1, rows.length + 1)}` };
  ws['!cols'] = [
    { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 16 },
    { wch: 12 }, { wch: 16 }, { wch: 32 }, { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'AWB Log');
  XLSX.writeFile(wb, filename);
}

function nextUploadGroup(files: File[], maxFiles: number): File[] {
  const group: File[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (group.length >= maxFiles) break;
    if (group.length > 0 && totalBytes + file.size > MAX_UPLOAD_GROUP_BYTES) break;
    group.push(file);
    totalBytes += file.size;
  }
  return group;
}

interface ResultRow {
  id: string;
  file: string;
  status: ExtractStatus;
  reasons?: string[];
  fields?: ExtractResult['fields'];
  monthFolder?: string;
  renamedFile?: string;
  pageCount?: number;
  deepAnalysis?: boolean;
  retryFile?: File;
  viewUrl?: string;
  retryUrl?: string;
}

interface RunSummary {
  total: number;
  completed: number;
  logged: number;
  duplicate: number;
  permit: number;
  errors: number;
  elapsedSeconds: number;
}

export default function PdfExtractorPage() {
  const { user } = useAuth();
  const [results, setResults] = useState<ResultRow[]>([]);
  const [log, setLog] = useState<AwbLogRow[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [queuedCount, setQueuedCount] = useState(0);
  const [processingFiles, setProcessingFiles] = useState<string[]>([]);
  const [completedFiles, setCompletedFiles] = useState(0);
  const [runTotalFiles, setRunTotalFiles] = useState(0);
  const [runCompletedFiles, setRunCompletedFiles] = useState(0);
  const [completedGroupCount, setCompletedGroupCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [processingStage, setProcessingStage] = useState<'uploading' | 'analyzing' | 'finalizing'>('uploading');
  const [activeFile, setActiveFile] = useState('');
  const [estimatedSeconds, setEstimatedSeconds] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<ExtractDownload[]>([]);
  const [resultsCopied, setResultsCopied] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PdfDiagnostic[]>([]);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [uploadGroupSize, setUploadGroupSize] = useState(PROCESSING_BATCH_SIZE);
  const importRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const busyRef = useRef(false);
  const queueRef = useRef<File[]>([]);
  const runStartedAtRef = useRef(0);
  const runTotalFilesRef = useRef(0);
  const runCompletedFilesRef = useRef(0);
  const completedGroupCountRef = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const activeBatchRef = useRef<File[]>([]);
  const activeBatchIdRef = useRef<string | null>(null);
  const uploadGroupSizeRef = useRef(PROCESSING_BATCH_SIZE);
  const timedOutRef = useRef(false);
  const runOutcomeRef = useRef<Omit<RunSummary, 'total' | 'completed' | 'elapsedSeconds'>>({
    logged: 0,
    duplicate: 0,
    permit: 0,
    errors: 0,
  });

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!busy || !runStartedAtRef.current) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - runStartedAtRef.current) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const hasCurrentSession = busy || queuedCount > 0 || results.length > 0 || downloads.length > 0;
    if (!hasCurrentSession) return;
    function confirmRefresh(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = 'Refreshing will reset the current PDF Extractor session.';
    }
    window.addEventListener('beforeunload', confirmRefresh);
    return () => window.removeEventListener('beforeunload', confirmRefresh);
  }, [busy, downloads.length, queuedCount, results.length]);

  async function toggleLogs() {
    if (showLogs) {
      setShowLogs(false);
      return;
    }
    setLogsLoading(true);
    setError('');
    try {
      setLog(await api.pdfExtractor.log());
      setShowLogs(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved logs');
    } finally {
      setLogsLoading(false);
    }
  }

  async function refreshLogsIfVisible() {
    if (!showLogs) return;
    try {
      setLog(await api.pdfExtractor.log());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh AWB history');
    }
  }

  async function loadDiagnostics() {
    if (user?.roleName !== 'Admin') return;
    setDiagnosticsLoading(true);
    try {
      setDiagnostics(await api.pdfExtractor.diagnostics());
      setShowDiagnostics(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load temporary diagnostics');
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  async function clearDiagnostics() {
    try {
      await api.pdfExtractor.clearDiagnostics();
      setDiagnostics([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear temporary diagnostics');
    }
  }

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
      if (busyRef.current) return;
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
      if (files.length > 0) enqueueFiles(files);
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

  function enqueueFiles(files: File[]) {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) {
      setError('No PDF files found. Drop or import .pdf files.');
      return;
    }
    const oversized = pdfs.filter((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversized.length > 0) {
      setError(`${oversized.map((file) => file.name).join(', ')} exceeds the 60 MB per-file limit.`);
      return;
    }
    if (queueRef.current.length + pdfs.length > MAX_FILES_PER_RUN) {
      setError(`A run can contain up to ${MAX_FILES_PER_RUN} PDFs. Please start the current run before adding more files.`);
      return;
    }
    queueRef.current.push(...pdfs);
    setQueuedCount(queueRef.current.length);
    setNotice(`${queueRef.current.length} PDF${queueRef.current.length === 1 ? '' : 's'} ready to run.`);
  }

  async function processQueue() {
    if (busyRef.current || queueRef.current.length === 0) return;
    if (!runIdRef.current) {
      runIdRef.current = createClientId();
      cancelledRef.current = false;
      runStartedAtRef.current = Date.now();
      runTotalFilesRef.current = queueRef.current.length;
      runCompletedFilesRef.current = 0;
      completedGroupCountRef.current = 0;
      activeBatchIdRef.current = null;
      uploadGroupSizeRef.current = PROCESSING_BATCH_SIZE;
      setUploadGroupSize(PROCESSING_BATCH_SIZE);
      runOutcomeRef.current = { logged: 0, duplicate: 0, permit: 0, errors: 0 };
      setRunSummary(null);
      setRunTotalFiles(runTotalFilesRef.current);
      setRunCompletedFiles(0);
      setCompletedGroupCount(0);
      setElapsedSeconds(0);
    }
    busyRef.current = true;
    const pdfs = nextUploadGroup(queueRef.current, uploadGroupSizeRef.current);
    const batchId = activeBatchIdRef.current ?? createClientId();
    // Completed-file offsets stay unique and ordered even when a proxy rejection
    // causes later upload groups to use a smaller adaptive size.
    const batchNumber = runCompletedFilesRef.current;
    activeBatchIdRef.current = batchId;
    activeBatchRef.current = pdfs;
    setQueuedCount(Math.max(0, queueRef.current.length - pdfs.length));
    setProcessingFiles(pdfs.map((file) => file.name));
    setCompletedFiles(0);
    setActiveFile(pdfs[0]?.name ?? '');
    setEstimatedSeconds(null);
    setProcessingStage('uploading');
    setError('');
    setBusy(true);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    timedOutRef.current = false;
    const batchTimeout = window.setTimeout(() => {
      timedOutRef.current = true;
      abortController.abort();
    }, BATCH_REQUEST_TIMEOUT_MS);
    const remainingFiles = queueRef.current.length - pdfs.length;
    setNotice(
      remainingFiles > 0
        ? `Running ${pdfs.length} files. ${remainingFiles} ${remainingFiles === 1 ? 'file remains' : 'files remain'} and will start automatically.`
        : `Running a batch of ${pdfs.length} file${pdfs.length === 1 ? '' : 's'}.`
    );
    let batchCompleted = false;
    let retrySmallerGroup = false;
    try {
      const response = await api.pdfExtractor.extractStream(pdfs, (completed, _total, file) => {
        setCompletedFiles(completed);
        setActiveFile(file);
        setProcessingStage('analyzing');
        const overallCompleted = runCompletedFilesRef.current + completed;
        const remaining = Math.max(0, runTotalFilesRef.current - overallCompleted);
        const elapsed = (Date.now() - runStartedAtRef.current) / 1000;
        setEstimatedSeconds(overallCompleted === 0 ? null : Math.ceil((elapsed / overallCompleted) * remaining));
      }, abortController.signal, runIdRef.current ?? undefined, batchId, batchNumber);
      const out = response.results;
      if (out.length !== pdfs.length) {
        throw new Error(`Batch incomplete: received ${out.length} of ${pdfs.length} results. The batch remains queued.`);
      }
      setResults(
        (current) => [...current, ...out.map((r, index) => ({
          id: `${Date.now()}-${index}-${r.file}`,
          file: r.file,
          status: r.status,
          reasons: r.reasons,
          fields: r.fields,
          monthFolder: r.monthFolder,
          renamedFile: r.renamedFile,
          pageCount: r.pageCount,
          deepAnalysis: r.deepAnalysis,
          retryFile: r.status === 'error' ? pdfs[index] : undefined,
          viewUrl: r.viewUrl,
          retryUrl: r.retryUrl,
        }))]
      );
      if (response.download) setDownloads((current) => [...current, response.download!]);
      const logged = out.filter((r) => r.status === 'ok').length;
      const duplicates = out.filter((r) => r.status === 'duplicate').length;
      const permits = out.filter((r) => r.status === 'permit').length;
      const failed = out.filter((r) => r.status === 'error').length;
      runOutcomeRef.current.logged += logged;
      runOutcomeRef.current.duplicate += duplicates;
      runOutcomeRef.current.permit += permits;
      runOutcomeRef.current.errors += failed;
      const parts: string[] = [];
      if (logged > 0) parts.push(`${logged} invoice${logged === 1 ? '' : 's'} logged`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (parts.length > 0) setNotice(`Processed ${out.length} file${out.length === 1 ? '' : 's'} — ${parts.join(', ')}.`);
      await refreshLogsIfVisible();
      queueRef.current.splice(0, pdfs.length);
      runCompletedFilesRef.current += out.length;
      completedGroupCountRef.current += 1;
      activeBatchIdRef.current = null;
      setRunCompletedFiles(runCompletedFilesRef.current);
      setCompletedGroupCount(completedGroupCountRef.current);
      batchCompleted = true;
    } catch (err) {
      if (cancelledRef.current) {
        setNotice('Analysis cancelled. The remaining files were removed from the queue.');
      } else if (timedOutRef.current) {
        setError('This group took longer than 6 minutes. It was paused safely; resume to continue from its saved checkpoint.');
        setNotice(`This group timed out safely. The ${pdfs.length} files remain queued and completed files will not repeat.`);
        void loadDiagnostics();
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        setNotice('Analysis was stopped. The current group remains queued and can be resumed safely.');
      } else {
        const status = (err as { status?: number } | null)?.status;
        if (status === 403 && pdfs.length > 1) {
          const smallerSize = Math.max(1, Math.floor(pdfs.length / 2));
          uploadGroupSizeRef.current = smallerSize;
          setUploadGroupSize(smallerSize);
          activeBatchIdRef.current = null;
          retrySmallerGroup = true;
          setError('');
          setNotice(`The hosting proxy rejected ${pdfs.length} files together. Retrying automatically in groups of ${smallerSize}.`);
        } else {
          setError(status === 403
            ? `The hosting proxy rejected ${pdfs[0]?.name ?? 'this PDF'} even as a single-file upload (403). Try signing in again or use a different network.`
            : err instanceof Error ? err.message : 'Failed to process files');
          setNotice(`This group was paused safely. The ${pdfs.length} files remain queued; resume to continue without repeating completed files.`);
        }
        void loadDiagnostics();
      }
    } finally {
      window.clearTimeout(batchTimeout);
      abortControllerRef.current = null;
      busyRef.current = false;
      setBusy(false);
      setProcessingFiles([]);
      setCompletedFiles(0);
      setActiveFile('');
      setEstimatedSeconds(null);
      setQueuedCount(queueRef.current.length);
      activeBatchRef.current = [];
      if (retrySmallerGroup && !cancelledRef.current) {
        void processQueue();
      } else if (batchCompleted && queueRef.current.length > 0 && !cancelledRef.current) {
        void processQueue();
      } else if (batchCompleted && !cancelledRef.current && runIdRef.current) {
        const completedRunId = runIdRef.current;
        runIdRef.current = null;
        setProcessingStage('finalizing');
        setNotice('All batches complete. Preparing one combined ZIP...');
        try {
          const download = await api.pdfExtractor.finalizeRun(completedRunId);
          if (download) setDownloads((current) => [...current, download]);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to prepare combined download');
        }
        setRunSummary({
          total: runTotalFilesRef.current,
          completed: runCompletedFilesRef.current,
          elapsedSeconds: Math.max(0, Math.ceil((Date.now() - runStartedAtRef.current) / 1000)),
          ...runOutcomeRef.current,
        });
        setProcessingStage('uploading');
      } else {
        if (cancelledRef.current) {
          runIdRef.current = null;
          activeBatchIdRef.current = null;
        }
        setProcessingStage('uploading');
      }
    }
  }

  function cancelAnalysis() {
    if (!busyRef.current) return;
    if (!window.confirm('Cancel analysis? The current file will stop when possible, and remaining files will be removed from the queue.')) return;
    cancelledRef.current = true;
    activeBatchIdRef.current = null;
    queueRef.current = [];
    setQueuedCount(0);
    abortControllerRef.current?.abort();
  }

  function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length > 0) enqueueFiles(files);
  }

  const invoiceResults = results.filter((r) => r.status !== 'permit' && r.status !== 'error');
  const permitResults = results.filter((r) => r.status === 'permit');
  const errorResults = results.filter((r) => r.status === 'error');

  const resultRows = invoiceResults.map((r) => [
    r.fields?.HAWB ?? '',
    r.fields?.InvoiceReference ?? '',
    r.fields?.InvoiceTotalAmount ?? '',
    r.fields?.DeliveryDate ?? '',
    r.fields?.TotalQty ?? '',
    '',
    r.file,
    '',
  ]);

  const savedLogRows = log.map((row) => [
    row.hawb,
    row.invoice_reference,
    row.invoice_total_amount,
    row.delivery_date,
    row.total_qty,
    row.received_date ?? '',
    row.original_filename,
    row.date_logged ? new Date(row.date_logged).toLocaleString() : '',
  ]);

  async function copyResults() {
    if (resultRows.length === 0) return;
    await copyText(toTsv(resultRows));
    setResultsCopied(true);
    setNotice('Results copied to clipboard');
    window.setTimeout(() => setResultsCopied(false), 2200);
  }

  function exportResults() {
    if (resultRows.length === 0) return;
    exportXlsx(resultRows, 'awb-log.xlsx');
    setNotice('Exported log to Excel');
  }

  function downloadArtifact(download: ExtractDownload) {
    window.location.assign(api.pdfExtractor.downloadUrl(download.url));
  }

  function exportSavedLog() {
    if (savedLogRows.length === 0) return;
    exportXlsx(savedLogRows, 'awb-history.xlsx');
    setNotice('AWB history exported to Excel');
  }

  function clearSelection() {
    if (busyRef.current) return;
    queueRef.current = [];
    activeBatchIdRef.current = null;
    setQueuedCount(0);
    setNotice('');
    setError('');
  }

  function clearCurrentResults() {
    setResults([]);
    setDownloads([]);
    setNotice('');
    setError('');
    setRunTotalFiles(0);
    setRunCompletedFiles(0);
    runTotalFilesRef.current = 0;
    runCompletedFilesRef.current = 0;
    completedGroupCountRef.current = 0;
    activeBatchIdRef.current = null;
    uploadGroupSizeRef.current = PROCESSING_BATCH_SIZE;
    setUploadGroupSize(PROCESSING_BATCH_SIZE);
    setCompletedGroupCount(0);
    runOutcomeRef.current = { logged: 0, duplicate: 0, permit: 0, errors: 0 };
    setRunSummary(null);
  }

  function extractAnotherFiles() {
    if (busyRef.current) return;
    clearCurrentResults();
    queueRef.current = [];
    setQueuedCount(0);
    window.setTimeout(() => importRef.current?.click(), 0);
  }

  function retryResult(result: ResultRow) {
    if ((!result.retryFile && !result.retryUrl) || busyRef.current) return;
    setResults((current) => current.filter((item) => item.id !== result.id));
    if (result.retryFile) {
      enqueueFiles([result.retryFile]);
      void processQueue();
      return;
    }
    void api.pdfExtractor.retry(result.retryUrl!).then(({ result: retried, download }) => {
      setResults((current) => [...current, {
        id: `${Date.now()}-${retried.file}`,
        file: retried.file,
        status: retried.status,
        reasons: retried.reasons,
        fields: retried.fields,
        monthFolder: retried.monthFolder,
        renamedFile: retried.renamedFile,
        pageCount: retried.pageCount,
        deepAnalysis: retried.deepAnalysis,
        viewUrl: retried.viewUrl,
        retryUrl: retried.retryUrl,
      }]);
      if (download) setDownloads((current) => [...current, download]);
      setNotice(`Retried ${retried.file}.`);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to retry file');
      setResults((current) => [...current, result]);
    });
  }

  const overallCompleted = Math.min(runTotalFiles, runCompletedFiles + completedFiles);
  const overallPercent = runTotalFiles ? Math.round((overallCompleted / runTotalFiles) * 100) : 0;
  const remainingBatchCount = Math.ceil(Math.max(0, runTotalFiles - runCompletedFiles) / Math.max(1, uploadGroupSize));
  const activeBatch = completedGroupCount + 1;
  const batchCount = Math.max(activeBatch, completedGroupCount + remainingBatchCount);
  const stageLabel = processingStage === 'uploading'
    ? 'Preparing protected group'
    : processingStage === 'finalizing'
      ? 'Preparing your download'
      : 'Reading and extracting PDFs';

  return (
    <div>
      <div className="w-full max-w-5xl mx-auto flex items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-[20px] font-semibold text-[#1d1d1f] tracking-tight">PDF Extractor</h1>
          <p className="text-[12px] text-[#6e6e73] mt-0.5">
            Add AWB and invoice PDFs. Files stay in upload order, are renamed using their SG invoice reference, and are separated by permit status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ToolHelp
            toolName="PDF Extractor"
            purpose="Reduce manual encoding by extracting shipment and invoice details from PDFs, renaming files consistently, organizing them by status and delivery month, and recording valid invoices in the AWB log."
            steps={[
              'Add PDF files and start extraction.',
              'The tool reads document text and uses OCR when needed.',
              'It extracts the invoice reference, HAWB, amount, delivery date, and quantity.',
              'Valid files are renamed using the SG invoice reference and organized automatically.',
              'Completed batches are combined into one ordered download.',
            ]}
            cards={[
              { title: 'File limits', description: 'Up to 50 PDFs per run and 60 MB per file. Processing is safely grouped to keep the service responsive.' },
              { title: 'Needs attention', description: 'Review failed files with the eye button, then use Retry after confirming the document data.' },
            ]}
            note="Keep this page open while processing. Refreshing resets the current browser session."
          />
          {user?.roleName === 'Admin' && (
            <button
              onClick={() => showDiagnostics ? setShowDiagnostics(false) : void loadDiagnostics()}
              disabled={diagnosticsLoading}
              className={secondaryBtnCls}
            >
              {showDiagnostics ? 'Close error log' : diagnosticsLoading ? 'Loading log…' : 'Temporary error log'}
            </button>
          )}
          {(results.length > 0 || downloads.length > 0) && (
            <button onClick={clearCurrentResults} disabled={busy} className={secondaryBtnCls}>
              Reset current batch
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-[#dc2626] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}
      {notice && !busy && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#ecfdf5] border border-[#a7f3d0] text-[13px] text-[#047857] flex items-start justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-[#047857] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}

      {user?.roleName === 'Admin' && showDiagnostics && (
        <section className="mb-4 overflow-hidden rounded-lg border border-[#3f3f46] bg-[#18181b] text-[#e4e4e7]" aria-label="Temporary PDF extractor diagnostics">
          <div className="flex items-center justify-between gap-3 border-b border-[#3f3f46] px-3 py-2">
            <div>
              <p className="font-mono text-[11px] font-medium">PDF Extractor · temporary diagnostics</p>
              <p className="mt-0.5 text-[10px] text-[#a1a1aa]">In-memory server events only. Cleared on restart; document text is never shown.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => void loadDiagnostics()} disabled={diagnosticsLoading} className="font-mono text-[10px] text-[#d4d4d8] hover:text-white disabled:opacity-40">Refresh</button>
              <button onClick={() => void clearDiagnostics()} className="font-mono text-[10px] text-[#fca5a5] hover:text-[#fecaca]">Clear</button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto px-3 py-2 font-mono text-[11px] leading-5">
            {diagnostics.length === 0 ? (
              <p className="text-[#a1a1aa]">No temporary errors recorded.</p>
            ) : diagnostics.map((entry) => (
              <p key={entry.id} className={entry.level === 'error' ? 'text-[#fca5a5]' : entry.level === 'warn' ? 'text-[#fde68a]' : 'text-[#d4d4d8]'}>
                <span className="text-[#71717a]">[{new Date(entry.timestamp).toLocaleTimeString()}]</span> {entry.level.toUpperCase()} {entry.event}
                {entry.file ? ` · ${entry.file}` : ''} — {entry.message}
              </p>
            ))}
          </div>
        </section>
      )}

      {runSummary ? (
        <section className="w-full max-w-5xl mx-auto rounded-xl border border-[#bfdbfe] bg-[#f8fbff] p-6 mb-6 text-center">
          <div className="mx-auto flex max-w-xl flex-col items-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eff6ff] text-[#2563eb]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="mt-3 text-[16px] font-semibold text-[#1d1d1f]">Extraction complete</h2>
            <p className="mt-1 text-[13px] text-[#6e6e73]">
              {runSummary.completed} of {runSummary.total} PDFs completed in {formatElapsed(runSummary.elapsedSeconds)}.
            </p>
            <div className="mt-5 grid w-full grid-cols-2 gap-2 sm:grid-cols-4 text-left text-[11px]">
              <div className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2"><p className="text-[#86868b]">Logged</p><p className="mt-0.5 font-semibold text-[#1d1d1f]">{runSummary.logged}</p></div>
              <div className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2"><p className="text-[#86868b]">Already logged</p><p className="mt-0.5 font-semibold text-[#1d1d1f]">{runSummary.duplicate}</p></div>
              <div className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2"><p className="text-[#86868b]">With permit</p><p className="mt-0.5 font-semibold text-[#1d1d1f]">{runSummary.permit}</p></div>
              <div className="rounded-lg border border-[#dbeafe] bg-white px-3 py-2"><p className="text-[#86868b]">Needs attention</p><p className="mt-0.5 font-semibold text-[#1d1d1f]">{runSummary.errors}</p></div>
            </div>
            <button onClick={extractAnotherFiles} className={`${primaryBtnCls} mt-5 min-w-[190px] justify-center px-5 py-2`}>
              {iconUpload}
              Extract another files
            </button>
          </div>
        </section>
      ) : (
      <div className="w-full max-w-5xl mx-auto bg-white rounded-xl border border-[#d2d2d7] p-6 mb-6">
        <input ref={importRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleImport} />
        <h2 className="text-[16px] font-semibold text-[#1d1d1f] mb-1">Drop your PDFs</h2>
        <p className="text-[13px] text-[#6e6e73] mb-5">
          PDF files only. Up to {MAX_FILES_PER_RUN} files per run, with a 60 MB limit per file. Files are processed in protected groups for reliability.
        </p>
        <div
          onClick={() => !busy && queuedCount === 0 && importRef.current?.click()}
          className={`min-h-[320px] border-2 border-dashed rounded-xl px-8 py-10 flex flex-col items-center justify-center text-center transition-all ${
            busy
              ? 'border-[#d2d2d7] bg-[#fafafa]'
              : dragActive
                ? 'border-[#2563eb] bg-[#eff6ff]'
                : queuedCount === 0
                  ? 'border-[#d2d2d7] hover:border-[#2563eb] cursor-pointer'
                  : 'border-[#93c5fd] bg-[#fafcff]'
          }`}
        >
          <div className="mb-3">
            {busy ? <ProcessingSpinner /> : (
              <div className="w-12 h-12 rounded-full bg-[#eff6ff] flex items-center justify-center text-[#2563eb]">{iconUpload}</div>
            )}
          </div>
          {busy ? (
            <div className="w-full max-w-xl mt-4 rounded-xl border border-[#d2d2d7] bg-white px-5 py-5 text-left shadow-sm" role="status" aria-live="polite">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-[#1d1d1f]">{stageLabel}</p>
                  <p className="text-[12px] text-[#6e6e73] mt-0.5 tabular-nums">
                    {processingStage === 'finalizing'
                      ? `${runTotalFiles} files processed; preparing your combined download`
                      : `Group ${activeBatch} of ${batchCount} · ${completedFiles} of ${processingFiles.length} files complete`}
                  </p>
                </div>
                <span className="shrink-0 inline-flex items-center rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-medium text-[#515154]">
                  {overallCompleted} / {runTotalFiles} complete
                </span>
              </div>
              <div className="mt-4 rounded-lg border border-[#e5e7eb] bg-[#fafafa] px-3 py-2.5">
                <p className="text-[10px] font-medium uppercase tracking-wide text-[#86868b]">Current document</p>
                <p className="mt-0.5 text-[12px] text-[#1d1d1f] truncate" title={activeFile}>
                  {processingStage === 'finalizing' ? 'Combining completed files into your download' : activeFile || 'Starting secure upload...'}
                </p>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-[#6e6e73]">
                  <span>Overall progress</span>
                  <span className="tabular-nums font-medium text-[#1d1d1f]">{overallPercent}%</span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-[#e5e7eb] overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[#2563eb] transition-[width] duration-500 ease-out"
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] text-[#6e6e73]">
                  <span>Current group</span>
                  <span className="tabular-nums">{processingFiles.length ? Math.round((completedFiles / processingFiles.length) * 100) : 0}%</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-[#e5e7eb] overflow-hidden" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-[#9ca3af] transition-[width] duration-500 ease-out"
                    style={{ width: `${processingFiles.length ? Math.round((completedFiles / processingFiles.length) * 100) : 0}%` }}
                  />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-md bg-[#f5f5f7] px-2.5 py-2">
                  <p className="text-[#86868b]">Elapsed</p>
                  <p className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">{formatElapsed(elapsedSeconds)}</p>
                </div>
                <div className="rounded-md bg-[#f5f5f7] px-2.5 py-2">
                  <p className="text-[#86868b]">Remaining</p>
                  <p className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">{estimatedSeconds === null ? 'Estimating' : estimatedSeconds === 0 ? 'Finishing' : formatEta(estimatedSeconds)}</p>
                </div>
                <div className="rounded-md bg-[#f5f5f7] px-2.5 py-2">
                  <p className="text-[#86868b]">Waiting</p>
                  <p className="mt-0.5 font-medium tabular-nums text-[#1d1d1f]">{queuedCount} files</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-[11px] text-[#6e6e73]">Keep this page open. The next group starts only after this one finishes.</p>
                <button onClick={cancelAnalysis} className={`${secondaryBtnCls} shrink-0 px-3 py-1 text-[11px]`}>Cancel</button>
              </div>
            </div>
          ) : queuedCount > 0 ? (
            <div className="w-full max-w-md">
              <p className="text-[20px] font-semibold text-[#1d1d1f]">{queuedCount}</p>
              <p className="text-[14px] font-medium text-[#1d1d1f]">PDF{queuedCount === 1 ? '' : 's'} uploaded and ready</p>
              <p className="text-[12px] text-[#9ca3af] mt-1">Review the count, then run the extraction when you are ready.</p>
              <div className="flex items-center justify-center gap-2 mt-4">
                <button onClick={clearSelection} className={`${secondaryBtnCls} min-w-[140px] justify-center`}>Clear selection</button>
                <button onClick={() => void processQueue()} className={`${primaryBtnCls} min-w-[140px] justify-center px-6 py-2`}>Run extraction</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[14px] font-medium text-[#1d1d1f]">Drag and drop PDFs here</p>
              <p className="text-[12px] text-[#9ca3af] mt-1.5">or click anywhere in this area to browse</p>
              <p className="text-[12px] text-[#9ca3af] mt-3">.pdf only</p>
            </>
          )}
        </div>
      </div>
      )}

      {downloads.length > 0 && (
        <div className="bg-[#eff6ff] rounded-xl border border-[#bfdbfe] px-5 py-6 mb-6 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="max-w-2xl">
              <h2 className="text-[13px] font-semibold text-[#1d1d1f]">Renamed files ready</h2>
              <p className="text-[12px] text-[#6e6e73] mt-1">One upload downloads as PDF. Multiple uploads download as ZIP with Without Permit, With Permit, and Needs Attention folders.</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              {downloads.map((download, index) => (
                <button key={`${download.url}-${index}`} onClick={() => downloadArtifact(download)} className={`${primaryBtnCls} min-w-[200px] justify-center px-5 py-2`}>
                  {iconDownload}
                  Download {download.count === 1 ? 'renamed PDF' : `${download.count} files (ZIP)`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {invoiceResults.length > 0 && (
        <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden mb-6">
          <div className="px-4 py-2 border-b border-[#d2d2d7]/60 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-[#1d1d1f]">Current batch results</h2>
              <p className="text-[10px] text-[#9ca3af] mt-0.5">Temporary results from files processed in this browser session</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={copyResults} disabled={busy} className={secondaryBtnCls}>
                {resultsCopied ? (
                  <svg className="w-3.5 h-3.5 text-[#16a34a]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : iconCopy}
                {resultsCopied ? 'Copied' : 'Copy results'}
              </button>
              <button onClick={exportResults} disabled={busy} className={secondaryBtnCls}>
                {iconDownload}
                Export Excel
              </button>
            </div>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-[13px]" style={{ minWidth: '900px' }}>
              <thead>
                <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                  {['File', 'Status', 'Invoice Ref', 'HAWB', 'Amount', 'Delivery Date', 'Qty', 'Received Date', 'Filed to'].map((heading) => (
                    <th key={heading} className="sticky top-0 z-10 bg-[#f5f5f7] px-3 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoiceResults.map((r, i) => (
                  <tr key={i} className="border-b border-[#d2d2d7]/60">
                    <td className="px-3 py-1.5 text-[#1d1d1f] max-w-[220px]" title={r.file}>
                      <span className="block truncate">{r.renamedFile || r.file}</span>
                      {r.renamedFile && r.renamedFile !== r.file && <span className="block text-[10px] text-[#9ca3af] truncate">from {r.file}</span>}
                    </td>
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

      {permitResults.length > 0 && (
        <section className="bg-white rounded-xl border border-[#fde68a] overflow-hidden mb-6">
          <div className="px-4 py-3 bg-[#fffbeb] border-b border-[#fde68a]">
            <h2 className="text-[13px] font-semibold text-[#92400e]">With permit ({permitResults.length})</h2>
            <p className="text-[11px] text-[#b45309] mt-0.5">Kept separate and excluded from Excel and the AWB table.</p>
          </div>
          <div className="max-h-[360px] overflow-y-auto divide-y divide-[#f3f4f6]">
            {permitResults.map((r, index) => (
              <div key={`${r.file}-${index}`} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#1d1d1f] truncate">{r.renamedFile || r.file}</p>
                  <p className="text-[11px] text-[#6e6e73] truncate">Original: {r.file} · {r.pageCount ?? 0} pages</p>
                </div>
                <Badge status="permit" />
              </div>
            ))}
          </div>
        </section>
      )}

      {errorResults.length > 0 && (
        <section className="bg-white rounded-xl border border-[#fecaca] overflow-hidden mb-6">
          <div className="px-4 py-3 bg-[#fef2f2] border-b border-[#fecaca]">
            <h2 className="text-[13px] font-semibold text-[#991b1b]">Needs attention ({errorResults.length})</h2>
            <p className="text-[11px] text-[#b91c1c] mt-0.5">Enhanced OCR was attempted before these files were marked as errors.</p>
          </div>
          <div className="max-h-[360px] overflow-y-auto divide-y divide-[#f3f4f6]">
            {errorResults.map((r, index) => (
              <div key={`${r.file}-${index}`} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[#1d1d1f] truncate">{r.file}</p>
                  <ul className="mt-1 space-y-0.5">
                    {(r.reasons ?? ['UNREADABLE']).map((reason) => <li key={reason} className="text-[11px] text-[#b91c1c]">{reasonLabel(reason)}</li>)}
                  </ul>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <span className="text-[10px] text-[#6e6e73]">{r.deepAnalysis ? 'Deep analysis completed' : 'Analysis completed'}</span>
                  {r.viewUrl && (
                    <button
                      onClick={() => window.open(api.pdfExtractor.downloadUrl(r.viewUrl!), '_blank', 'noopener,noreferrer')}
                      title="View failed PDF"
                      aria-label={`View ${r.file}`}
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg border border-[#d2d2d7] bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] transition-colors cursor-pointer"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    </button>
                  )}
                  <button onClick={() => retryResult(r)} disabled={busy || (!r.retryFile && !r.retryUrl)} className={`${secondaryBtnCls} px-2.5 py-1 text-[11px]`}>Retry</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-center mt-8">
        <button onClick={() => void toggleLogs()} disabled={logsLoading} className={`${secondaryBtnCls} min-w-[140px] justify-center px-5 py-2`}>
          {logsLoading ? 'Loading logs...' : showLogs ? 'Hide logs' : 'View logs'}
        </button>
      </div>

      {showLogs && (
        <section className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden mt-4">
          <div className="px-4 py-3 border-b border-[#d2d2d7]/60 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium text-[#1d1d1f]">AWB History <span className="text-[#9ca3af] font-normal">({log.length})</span></h2>
            <button
              onClick={exportSavedLog}
              disabled={log.length === 0}
              title="Export AWB history to Excel"
              aria-label="Export AWB history to Excel"
              className="w-8 h-8 inline-flex items-center justify-center rounded-lg border border-[#d2d2d7] bg-white text-[#217346] hover:bg-[#f0fdf4] hover:border-[#86efac] transition-colors disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6M8 13l4 5M12 13l-4 5M15 13h2M15 16h2M15 19h2" />
              </svg>
            </button>
          </div>
          <div className="max-h-[560px] overflow-auto">
            {log.length === 0 ? (
              <p className="text-[13px] text-[#9ca3af] text-center py-10">No saved invoices yet.</p>
            ) : (
              <table className="w-full text-[13px]" style={{ minWidth: '850px' }}>
                <thead>
                  <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                    {['Invoice Ref', 'HAWB', 'Amount', 'Delivery Date', 'Qty', 'Original File', 'Month', 'Date Logged'].map((heading) => (
                      <th key={heading} className="sticky top-0 z-10 bg-[#f5f5f7] px-3 py-2 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.map((row) => (
                    <tr key={row.id} className="border-b border-[#d2d2d7]/60 last:border-0">
                      <td className="px-3 py-2 font-medium text-[#1d1d1f]">{row.invoice_reference}</td>
                      <td className="px-3 py-2">{row.hawb || '—'}</td>
                      <td className="px-3 py-2">{row.invoice_total_amount || '—'}</td>
                      <td className="px-3 py-2">{row.delivery_date || '—'}</td>
                      <td className="px-3 py-2">{row.total_qty || '—'}</td>
                      <td className="px-3 py-2 text-[#6e6e73] max-w-[200px] truncate" title={row.original_filename}>{row.original_filename || '—'}</td>
                      <td className="px-3 py-2">{row.month_folder || '—'}</td>
                      <td className="px-3 py-2 text-[#6e6e73]">{row.date_logged ? new Date(row.date_logged).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {dragActive && (
        <div className="fixed inset-0 z-50 bg-[#2563eb]/10 border-4 border-dashed border-[#2563eb] flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-center">
            <p className="text-[15px] font-semibold text-[#1d1d1f]">Drop PDFs to add them to the queue</p>
            <p className="text-[12px] text-[#6e6e73] mt-1">Existing results stay in place, and new files continue processing in order.</p>
          </div>
        </div>
      )}

    </div>
  );
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    MISSING_PAGE_2: 'Page 2 is missing',
    INVOICE_REF: 'No valid SG invoice reference found',
    HAWB: 'HAWB is missing',
    InvoiceTotalAmount: 'Invoice amount is missing',
    DeliveryDate: 'Delivery date is missing',
    TotalQty: 'Total quantity is missing',
    UNREADABLE: 'The PDF could not be read',
  };
  return labels[reason] ?? reason.replace(/_/g, ' ').toLowerCase();
}

function formatEta(seconds: number): string {
  if (seconds < 5) return 'A few seconds remaining';
  if (seconds < 60) return `About ${seconds} seconds remaining`;
  const minutes = Math.ceil(seconds / 60);
  return `About ${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`;
}

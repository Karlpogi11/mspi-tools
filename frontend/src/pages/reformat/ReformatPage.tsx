import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api, type ReformatColumn, type ReformatTemplate } from '../../lib/api';
import {
  parseSpreadsheet,
  detectHeaderRow,
  buildHeaders,
  transformRows,
  dataRowCount,
  isAllowedFile,
  toCsv,
  copySpreadsheet,
  downloadCsv,
  downloadXlsx,
  filterRows,
  sortRows,
  buildPivot,
  type ParsedFile,
  type SmartFilterRule,
  type SortRule,
  type PivotConfig,
} from '../../lib/reformat';
import TemplateSelector from '../../components/reformat/TemplateSelector';
import UploadPanel from '../../components/reformat/UploadPanel';
import MappingPanel from '../../components/reformat/MappingPanel';
import ResultPanel from '../../components/reformat/ResultPanel';
import ToolHelp from '../../components/ToolHelp';

type Phase = 'upload' | 'mapping' | 'result';

const STEP_ORDER: Phase[] = ['upload', 'mapping', 'result'];
const STEP_LABELS: Record<Phase, string> = {
  upload: 'Upload',
  mapping: 'Arrange',
  result: 'Result',
};

interface Config {
  id: number | null;
  name: string;
  header_row: number;
  columns: ReformatColumn[];
  is_owner: boolean;
  dirty: boolean;
}

const emptyConfig: Config = {
  id: null,
  name: '',
  header_row: 1,
  columns: [],
  is_owner: true,
  dirty: false,
};

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export default function ReformatPage() {
  const [templates, setTemplates] = useState<{ owned: ReformatTemplate[]; shared: ReformatTemplate[] }>({
    owned: [],
    shared: [],
  });
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [config, setConfig] = useState<Config>(emptyConfig);
  const [removedColumns, setRemovedColumns] = useState<ReformatColumn[]>([]);
  const [phase, setPhase] = useState<Phase>('upload');
  const [rows, setRows] = useState<string[][]>([]);
  const [filters, setFilters] = useState<SmartFilterRule[]>([]);
  const [filterMode, setFilterMode] = useState<'and' | 'or'>('and');
  const [sortRules, setSortRules] = useState<SortRule[]>([]);
  const [pivot, setPivot] = useState<PivotConfig | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const prevPhase = useRef<Phase>('result');

  const loadTemplates = useCallback(async () => {
    try {
      const list = await api.reformat.listTemplates();
      setTemplates(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const headerIdx = clamp(config.header_row - 1, 0, Math.max(0, (file?.raw.length ?? 1) - 1));
  const headers = file ? buildHeaders(file.raw, headerIdx) : [];
  const outputNames = useMemo(() => {
    const seen = new Map<string, number>();
    return config.columns.map((c) => {
      const base = c.name.trim() || 'Column';
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });
  }, [config.columns]);

  function setColumns(columns: ReformatColumn[]) {
    setConfig((c) => ({ ...c, columns, dirty: true }));
  }

  function handleRemoveColumn(index: number) {
    const col = config.columns[index];
    if (!col) return;
    setConfig((c) => ({ ...c, columns: c.columns.filter((_, i) => i !== index), dirty: true }));
    setRemovedColumns((r) => [col, ...r]);
  }

  function handleRestoreColumn(col: ReformatColumn) {
    const next = [...config.columns, col];
    setConfig((c) => ({ ...c, columns: next, dirty: true }));
    setRemovedColumns((r) => r.filter((c2) => c2 !== col));
    if (file && phase === 'result') {
      setRows(transformRows(file.raw, headerIdx, next));
    }
  }

  function resetError() {
    setError('');
  }

  function goToStep(s: Phase) {
    if (s === 'upload') {
      handleReplaceFile();
    } else if (s === 'mapping') {
      setPhase('mapping');
    } else if (s === 'result') {
      handleApply();
    }
  }

  async function handleFileParsed(f: File) {
    if (!isAllowedFile(f)) {
      setError('Only Excel (.xlsx, .xls) and CSV files are allowed');
      return;
    }
    setBusy(true);
    resetError();
    try {
      const parsed = await parseSpreadsheet(f);
      if (parsed.raw.length === 0) {
        setError('The file appears to be empty');
        return;
      }
      setFile(parsed);
      setRemovedColumns([]);
      setFilters([]);
      setSortRules([]);
      setPivot(null);

      const detected = detectHeaderRow(parsed.raw);
      const useSaved = config.id !== null && config.header_row - 1 < parsed.raw.length;
      const hIdx = useSaved ? config.header_row - 1 : detected;
      const cols = config.columns.length > 0 ? config.columns : buildHeaders(parsed.raw, hIdx).map((h) => ({ name: h, source: h, constant: '' }));
      setConfig((c) => ({
        ...c,
        columns: config.columns.length > 0 ? c.columns : cols,
        header_row: hIdx + 1,
        dirty: c.id === null || c.header_row !== hIdx + 1 || (c.columns.length === 0 ? true : c.dirty),
      }));
      setRows(transformRows(parsed.raw, hIdx, cols));
      setPhase('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setBusy(false);
    }
  }

  function handleHeaderRowChange(n: number) {
    const max = Math.max(1, (file?.raw.length ?? 1));
    const next = clamp(n, 1, max);
    setFilters([]);
    setSortRules([]);
    setPivot(null);
    setConfig((c) => ({
      ...c,
      header_row: next,
      dirty: c.id === null || c.header_row !== next,
    }));
    if (file && phase === 'result') {
      setRows(transformRows(file.raw, next - 1, config.columns));
    }
  }

  function handleApply() {
    if (!file) return;
    setRows(transformRows(file.raw, headerIdx, config.columns));
    setPhase('result');
  }

  function handleCellEdit(r: number, c: number, value: string) {
    setRows((prev) => prev.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row)));
  }

  function handleReorderColumns(from: number, to: number) {
    const next = [...config.columns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setConfig((c) => ({ ...c, columns: next, dirty: true }));
    if (file) setRows(transformRows(file.raw, headerIdx, next));
  }

  async function handleSaveTemplate() {
    if (config.columns.length === 0 || !config.name.trim()) {
      setError('Give the template a name before saving');
      return;
    }
    setBusy(true);
    resetError();
    try {
      const payload = { name: config.name.trim(), header_row: config.header_row, columns: config.columns, removed_columns: removedColumns };
      const saved = config.id && config.is_owner
        ? await api.reformat.updateTemplate(config.id, payload)
        : await api.reformat.createTemplate(payload);
      setConfig((c) => ({ ...c, id: saved.id, is_owner: true, dirty: false }));
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setBusy(false);
    }
  }

  async function handleRenameTemplate(id: number, name: string) {
    if (!name.trim()) return;
    try {
      await api.reformat.updateTemplate(id, { name: name.trim() });
      await loadTemplates();
      if (config.id === id) {
        setConfig((c) => ({ ...c, name: name.trim() }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename template');
    }
  }

  async function handleDeleteTemplate(id: number) {
    try {
      await api.reformat.deleteTemplate(id);
      if (config.id === id) {
        setConfig((c) => ({ ...c, id: null, is_owner: true, dirty: true, name: '' }));
        if (!file) setPhase('upload');
      }
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete template');
    }
  }

  function handleUseTemplate(t: ReformatTemplate) {
    setError('');
    setRemovedColumns(t.removed_columns ?? []);
    setFilters([]);
    setSortRules([]);
    setPivot(null);
    if (file) {
      const hIdx = t.header_row - 1 < file.raw.length ? t.header_row - 1 : detectHeaderRow(file.raw);
      setConfig({
        id: t.id,
        name: t.name,
        header_row: hIdx + 1,
        columns: t.columns,
        is_owner: t.is_owner,
        dirty: false,
      });
      setRows(transformRows(file.raw, hIdx, t.columns));
      setPhase('result');
    } else {
      setConfig({
        id: t.id,
        name: t.name,
        header_row: t.header_row,
        columns: t.columns,
        is_owner: t.is_owner,
        dirty: false,
      });
      setPhase('upload');
    }
  }

  function handleStartFromScratch() {
    setError('');
    setRemovedColumns([]);
    if (!file) {
      setPhase('upload');
      return;
    }
    setConfig({
      ...emptyConfig,
      header_row: headerIdx + 1,
      columns: buildHeaders(file.raw, headerIdx).map((h) => ({ name: h, source: h, constant: '' })),
      dirty: true,
    });
    setPhase('mapping');
  }

  async function handleCopy(withHeader: boolean) {
    try {
      await copySpreadsheet(copyHeaders, copyRows, withHeader);
    } catch {
      setError('Copy failed — clipboard is not available');
    }
  }

  function handleExport(kind: 'xlsx' | 'csv') {
    const base = (config.name || (file ? file.fileName.replace(/\.[^.]+$/, '') : 'reformatted') || 'reformatted')
      .replace(/[^a-z0-9-_ ]/gi, '')
      .trim()
      .replace(/\s+/g, '-') || 'reformatted';
    const fname = `${base}.${kind}`;
    if (kind === 'csv') {
      downloadCsv(copyHeaders, copyRows, fname);
    } else {
      downloadXlsx(copyHeaders, copyRows, fname).catch(() => setError('Export failed'));
    }
  }

  function handleReplaceFile() {
    prevPhase.current = phase;
    setPhase('upload');
  }

  function handleReset() {
    setError('');
    setRemovedColumns([]);
    setFilters([]);
    setSortRules([]);
    setPivot(null);
    if (!file) {
      setConfig(emptyConfig);
      setPhase('upload');
      return;
    }
    const cols = buildHeaders(file.raw, headerIdx).map((h) => ({ name: h, source: h, constant: '' }));
    setConfig({ ...emptyConfig, header_row: headerIdx + 1, columns: cols, dirty: true });
    setRows(transformRows(file.raw, headerIdx, cols));
    setPhase('result');
  }

  const fileStats = file
    ? { fileName: file.fileName, rowCount: dataRowCount(file.raw, headerIdx) }
    : null;

  const previewRows = useMemo(() => {
    if (!file) return [];
    const sliceEnd = Math.min(file.raw.length, headerIdx + 26);
    return transformRows(file.raw.slice(0, sliceEnd), headerIdx, config.columns).slice(0, 8);
  }, [file, headerIdx, config.columns]);

  const filteredRows = useMemo(() => filterRows(rows, outputNames, filters, filterMode), [rows, outputNames, filters, filterMode]);
  const sortedRows = useMemo(() => sortRows(filteredRows, outputNames, sortRules), [filteredRows, outputNames, sortRules]);
  const pivotResult = useMemo(
    () => (pivot ? buildPivot(filteredRows.map((f) => f.row), outputNames, pivot) : null),
    [pivot, filteredRows, outputNames]
  );
  const pivotActive = pivot !== null && pivot.values.length > 0 && pivotResult !== null;
  const copyHeaders = pivotActive ? pivotResult!.headers : outputNames;
  const copyRows = pivotActive ? pivotResult!.rows.map((row) => row.map((cell) => cell ?? '')) : sortedRows.map((f) => f.row);

  function toggleSort(column: string) {
    setSortRules((prev) => {
      const i = prev.findIndex((s) => s.column === column);
      if (i === 0) {
        if (prev[0].dir === 'asc') return [{ ...prev[0], dir: 'desc' }];
        return prev.slice(1);
      }
      return [{ column, dir: 'asc' }, ...prev];
    });
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-[24px] font-semibold text-[#1d1d1f] tracking-tight">ReFormat</h1>
          <p className="text-[13px] text-[#6e6e73] mt-1">
            Import an Excel/CSV file, rearrange and rename its columns with a saved template, then export or copy the result.
          </p>
        </div>
        <ToolHelp
          toolName="ReFormat"
          purpose="Standardize Excel and CSV data by applying reusable column mappings, names, filters, sorting, and summaries before copying or exporting the final dataset."
          steps={[
            'Select an existing template or start a new mapping.',
            'Upload an Excel or CSV source file.',
            'Arrange, rename, add, or remove output columns.',
            'Apply optional filters, sorting, or pivot summaries.',
            'Copy the result or export it as Excel or CSV.',
          ]}
          cards={[
            { title: 'Templates', description: 'Save mappings for repeated workflows and use templates shared with you by other users.' },
            { title: 'Source files', description: 'Supports .xlsx, .xls, and .csv files with automatic header-row detection.' },
          ]}
        />
      </div>

      <nav className="mb-5 flex items-center gap-1.5 flex-wrap">
        {STEP_ORDER.map((s, i) => {
          const active = s === phase;
          const done = i < STEP_ORDER.indexOf(phase);
          const clickable = i < STEP_ORDER.indexOf(phase);
          return (
            <div key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className={`h-px w-4 ${i <= STEP_ORDER.indexOf(phase) ? 'bg-[#2563eb]' : 'bg-[#d2d2d7]'}`} />}
              <button
                onClick={() => clickable && goToStep(s)}
                disabled={!clickable}
                title={clickable ? `Go back to step ${i + 1}` : undefined}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                  active
                    ? 'bg-[#2563eb] text-white border-[#2563eb]'
                    : done
                      ? 'bg-[#eff6ff] text-[#2563eb] border-[#2563eb]/40 hover:bg-[#dbeafe] cursor-pointer'
                      : 'bg-white text-[#9ca3af] border-[#d2d2d7]'
                }`}
              >
                <span
                  className={`w-4 h-4 flex items-center justify-center rounded-full text-[10px] font-semibold ${
                    active ? 'bg-white/25' : done ? 'bg-[#2563eb] text-white' : 'bg-[#f5f5f7] text-[#9ca3af]'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </span>
                {STEP_LABELS[s]}
              </button>
            </div>
          );
        })}
      </nav>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={resetError} className="text-[#dc2626] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}

      <div className="min-w-0">
        {file && phase !== 'upload' && fileStats && (
          <div className="bg-white rounded-xl border border-[#d2d2d7] mb-4">
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#d2d2d7]/60">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#9ca3af] shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
              <span className="text-[13px] font-medium text-[#1d1d1f] truncate max-w-[280px]">{fileStats.fileName}</span>
              <span className="text-[12px] text-[#9ca3af] whitespace-nowrap">
                {fileStats.rowCount} rows &middot; {headers.length} columns
              </span>
              <div className="ml-auto flex items-center gap-2">
                {(config.id !== null || config.dirty || removedColumns.length > 0) && (
                  <button
                    onClick={handleReset}
                    title="Undo the applied format and show the raw data"
                    className="px-3 py-1.5 border border-[#d2d2d7] text-[12px] text-[#6e6e73] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                    Reset format
                  </button>
                )}
                {phase === 'result' && (
                  <button
                    onClick={() => setPhase('mapping')}
                    className="px-3 py-1.5 border border-[#d2d2d7] text-[12px] text-[#6e6e73] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                  >
                    Edit columns
                  </button>
                )}
                <button
                  onClick={handleReplaceFile}
                  className="px-3 py-1.5 border border-[#d2d2d7] text-[12px] text-[#6e6e73] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
                >
                  Change file
                </button>
              </div>
            </div>
            <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Template</span>
              <TemplateSelector
                templates={templates}
                activeName={config.name || null}
                dirty={config.dirty}
                onApply={handleUseTemplate}
                onNew={handleStartFromScratch}
                onRename={handleRenameTemplate}
                onDelete={handleDeleteTemplate}
                onChanged={loadTemplates}
                onError={setError}
              />
              {(config.id === null || config.dirty) && (
                <div className="flex items-center gap-2">
                  {config.id === null && (
                    <input
                      value={config.name}
                      onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
                      placeholder="e.g. REPTAT format"
                      className="px-2.5 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb] w-44"
                    />
                  )}
                  <button
                    onClick={handleSaveTemplate}
                    disabled={busy || (config.id === null && !config.name.trim())}
                    className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#16a34a] rounded-lg hover:bg-[#15803d] disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {busy ? 'Saving...' : config.id === null ? 'Save template' : config.is_owner ? 'Update saved template' : 'Save as my copy'}
                  </button>
                </div>
              )}
              <div className="w-px h-6 bg-[#d2d2d7]" />
              <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Header row</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, file.raw.length)}
                  value={config.header_row}
                  onChange={(e) => handleHeaderRowChange(parseInt(e.target.value) || 1)}
                  className="w-16 px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white"
                />
                <button
                  onClick={() => handleHeaderRowChange(detectHeaderRow(file.raw) + 1)}
                  className="text-[12px] text-[#2563eb] hover:underline cursor-pointer"
                >
                  auto-detect
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'upload' && (
          <UploadPanel
            onFile={handleFileParsed}
            busy={busy}
            hasFile={file !== null}
            onCancel={file ? (() => setPhase(prevPhase.current)) : undefined}
          />
        )}

        {phase === 'mapping' && file && (
          <MappingPanel
            headers={headers}
            columns={config.columns}
            removedColumns={removedColumns}
            previewRows={previewRows}
            onChange={setColumns}
            onRemoveColumn={handleRemoveColumn}
            onRestoreColumn={handleRestoreColumn}
            onApply={handleApply}
            onSave={handleSaveTemplate}
            savedId={config.id}
            canSave={config.is_owner}
            dirty={config.dirty}
            fileName={file.fileName}
            rowCount={dataRowCount(file.raw, headerIdx)}
          />
        )}

        {phase === 'result' && (
          <ResultPanel
            headers={outputNames}
            rows={rows}
            displayRows={sortedRows}
            onCellEdit={handleCellEdit}
            onCopy={handleCopy}
            onExport={handleExport}
            onEditMapping={() => setPhase('mapping')}
            onReorder={handleReorderColumns}
            onHeaderClick={toggleSort}
            filters={filters}
            filterMode={filterMode}
            onFiltersChange={setFilters}
            onFilterModeChange={setFilterMode}
            sortRules={sortRules}
            onSortChange={setSortRules}
            pivot={pivot}
            pivotResult={pivotResult}
            onPivotChange={setPivot}
            removedColumns={removedColumns}
            onRestoreColumn={handleRestoreColumn}
          />
        )}
      </div>
    </div>
  );
}

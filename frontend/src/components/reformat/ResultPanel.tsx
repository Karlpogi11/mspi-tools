import { useEffect, useMemo, useRef, useState } from 'react';
import { type ReformatColumn } from '../../lib/api';
import {
  filterRows,
  uniqueColumnValues,
  FILTER_OP_GROUPS,
  PIVOT_AGG_LABELS,
  valueLabel,
  columnLooksNumeric,
  type SmartFilterOp,
  type SmartFilterRule,
  type SortRule,
  type PivotConfig,
  type PivotResult,
  type PivotValue,
  type PivotAgg,
} from '../../lib/reformat';

interface Props {
  headers: string[];
  rows: string[][];
  displayRows: { row: string[]; index: number }[];
  onCellEdit: (r: number, c: number, value: string) => void;
  onCopy: (withHeader: boolean) => void;
  onExport: (kind: 'xlsx' | 'csv') => void;
  onEditMapping: () => void;
  onReorder: (from: number, to: number) => void;
  onHeaderClick: (column: string) => void;
  filters: SmartFilterRule[];
  filterMode: 'and' | 'or';
  onFiltersChange: (filters: SmartFilterRule[]) => void;
  onFilterModeChange: (mode: 'and' | 'or') => void;
  sortRules: SortRule[];
  onSortChange: (rules: SortRule[]) => void;
  pivot: PivotConfig | null;
  pivotResult: PivotResult | null;
  onPivotChange: (pivot: PivotConfig | null) => void;
  removedColumns: ReformatColumn[];
  onRestoreColumn: (col: ReformatColumn) => void;
}

const MAX_EDITABLE_ROWS = 1000;
const OP_LABELS: Record<SmartFilterOp, string> = {
  contains: 'contains',
  'not contains': 'does not contain',
  equals: 'equals',
  'not equals': 'does not equal',
  'starts with': 'starts with',
  'ends with': 'ends with',
  'is empty': 'is empty',
  'is not empty': 'is not empty',
  '>': 'greater than',
  '<': 'less than',
  '>=': 'at least',
  '<=': 'at most',
};
const OPS_WITHOUT_VALUE: SmartFilterOp[] = ['is empty', 'is not empty'];

export default function ResultPanel({
  headers,
  rows,
  displayRows,
  onCellEdit,
  onCopy,
  onExport,
  onEditMapping,
  onReorder,
  onHeaderClick,
  filters,
  filterMode,
  onFiltersChange,
  onFilterModeChange,
  sortRules,
  onSortChange,
  pivot,
  pivotResult,
  onPivotChange,
  removedColumns,
  onRestoreColumn,
}: Props) {
  const [showCopyMenu, setShowCopyMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const [showPivot, setShowPivot] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [draftFilters, setDraftFilters] = useState<SmartFilterRule[]>([]);
  const [draftMode, setDraftMode] = useState<'and' | 'or'>('and');
  const [suggestFor, setSuggestFor] = useState<number | null>(null);
  const [draftSort, setDraftSort] = useState<SortRule[]>([]);
  const [openPivotMenu, setOpenPivotMenu] = useState<string | null>(null);
  const [pivotSearch, setPivotSearch] = useState('');
  const [dragField, setDragField] = useState<string | null>(null);
  const dragFieldRef = useRef<string | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const menusRef = useRef<HTMLDivElement>(null);
  const thRefs = useRef<(HTMLTableCellElement | null)[]>([]);
  const dragFromRef = useRef<number | null>(null);
  const overRef = useRef<number | null>(null);
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!showCopyMenu && !showExportMenu && !showFilter && !showSort && !showPivot && !showHidden) return;
    const onDown = (e: MouseEvent) => {
      if (menusRef.current && !menusRef.current.contains(e.target as Node)) {
        setShowCopyMenu(false);
        setShowExportMenu(false);
        setShowFilter(false);
        setShowSort(false);
        setShowPivot(false);
        setShowHidden(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showCopyMenu, showExportMenu, showFilter, showSort, showPivot, showHidden]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const visibleRows = useMemo(() => displayRows.slice(0, MAX_EDITABLE_ROWS), [displayRows]);
  const hiddenCount = displayRows.length - visibleRows.length;
  const filterActive = filters.length > 0;
  const sortActive = sortRules.length > 0;
  const pivotActive = pivot !== null && pivot.values.length > 0 && pivotResult !== null;
  const previewCount = useMemo(
    () => filterRows(rows, headers, draftFilters, draftMode).length,
    [rows, headers, draftFilters, draftMode]
  );
  const pivotZones = useMemo(
    () => ({
      filters: pivot?.filterField ? [pivot.filterField] : [],
      columns: pivot?.colField ? [pivot.colField] : [],
      rows: pivot?.rowFields ?? [],
      values: pivot?.values ?? [],
    }),
    [pivot]
  );
  const pivotTotalCols = useMemo(() => {
    const set = new Set<number>();
    if (pivotResult?.colHeaders.length) {
      pivotResult.colHeaders.forEach((h, i) => {
        if (h === 'Total') set.add((pivotResult.rowLabels?.length ?? 0) + i);
      });
    }
    return set;
  }, [pivotResult]);
  const filterFieldValues = useMemo(() => {
    if (!pivot?.filterField) return [];
    const idx = headers.indexOf(pivot.filterField);
    if (idx === -1) return [];
    return uniqueColumnValues(displayRows.map((f) => f.row), idx, 300);
  }, [pivot?.filterField, displayRows, headers]);
  const searchHeaders = useMemo(() => {
    const q = pivotSearch.trim().toLocaleLowerCase();
    return q ? headers.filter((h) => h.toLocaleLowerCase().includes(q)) : headers;
  }, [headers, pivotSearch]);

  function closeMenus() {
    setShowCopyMenu(false);
    setShowExportMenu(false);
  }

  function togglePanel(which: 'filter' | 'sort' | 'pivot' | 'hidden') {
    setShowCopyMenu(false);
    setShowExportMenu(false);
    if (which === 'filter') {
      setShowFilter(!showFilter);
      setShowSort(false);
      setShowPivot(false);
      setShowHidden(false);
      if (!showFilter) {
        setDraftFilters(filters);
        setDraftMode(filterMode);
      }
    } else if (which === 'sort') {
      setShowSort(!showSort);
      setShowFilter(false);
      setShowPivot(false);
      setShowHidden(false);
      if (!showSort) setDraftSort(sortRules);
    } else if (which === 'hidden') {
      setShowHidden(!showHidden);
      setShowFilter(false);
      setShowSort(false);
      setShowPivot(false);
    } else {
      setShowPivot(!showPivot);
      setShowFilter(false);
      setShowSort(false);
      setShowHidden(false);
      setOpenPivotMenu(null);
    }
  }

  function startHeaderDrag(e: React.MouseEvent, i: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragFromRef.current = i;
    overRef.current = i;
    downPosRef.current = { x: e.clientX, y: e.clientY };
    setDragFrom(i);
    setDragOver(i);

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const ths = thRefs.current.filter(Boolean) as HTMLTableCellElement[];
      let over: number | null = null;
      for (let k = 0; k < ths.length; k++) {
        const r = ths[k].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) {
          over = k;
          break;
        }
      }
      if (over === null) over = ths.length - 1;
      overRef.current = over;
      setDragOver(over);
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
      }
    };

    const onUp = (upEv: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const from = dragFromRef.current;
      const target = overRef.current;
      const downPos = downPosRef.current;
      dragFromRef.current = null;
      overRef.current = null;
      downPosRef.current = null;
      setDragFrom(null);
      setDragOver(null);
      if (from === null || target === null) return;
      const dist = downPos ? Math.hypot(downPos.x - upEv.clientX, downPos.y - upEv.clientY) : 0;
      if (dist < 5) {
        onHeaderClick(headers[from]);
        return;
      }
      let insertAt = target;
      if (from < insertAt) insertAt -= 1;
      if (insertAt === from || insertAt === from + 1) return;
      onReorder(from, insertAt);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  async function doCopy(withHeader: boolean) {
    setShowCopyMenu(false);
    await onCopy(withHeader);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function updateRule(i: number, patch: Partial<SmartFilterRule>) {
    setDraftFilters((prev) => prev.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  }

  function removeRule(i: number) {
    setDraftFilters((prev) => prev.filter((_, k) => k !== i));
    if (suggestFor === i) setSuggestFor(null);
  }

  function commitFilters() {
    onFiltersChange(draftFilters);
    onFilterModeChange(draftMode);
    setShowFilter(false);
  }

  function clearFilters() {
    setDraftFilters([]);
    setDraftMode('and');
    onFiltersChange([]);
    onFilterModeChange('and');
  }

  function commitSort() {
    onSortChange(draftSort);
    setShowSort(false);
  }

  function clearSort() {
    setDraftSort([]);
    onSortChange([]);
  }

  function updateSortRule(i: number, patch: Partial<SortRule>) {
    setDraftSort((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  }

  function addSortLevel() {
    setDraftSort((prev) => [
      ...prev,
      { column: headers.find((h) => !prev.some((s) => s.column === h)) ?? (headers[0] || ''), dir: 'asc' },
    ]);
  }

  function patchPivot(patch: Partial<PivotConfig>) {
    setOpenPivotMenu(null);
    onPivotChange({
      filterField: null,
      filterValue: '',
      rowFields: [],
      colField: null,
      values: [],
      ...pivot,
      ...patch,
    });
  }

  function removeFromReport(column: string) {
    const cur = pivot;
    patchPivot({
      filterField: cur?.filterField === column ? null : cur?.filterField ?? null,
      filterValue: cur?.filterField === column ? '' : cur?.filterValue ?? '',
      colField: cur?.colField === column ? null : cur?.colField ?? null,
      rowFields: (cur?.rowFields ?? []).filter((f) => f !== column),
      values: (cur?.values ?? []).filter((v) => v.column !== column),
    });
  }

  function moveField(column: string, to: PivotZoneName, agg: PivotAgg = 'sum') {
    const next: PivotConfig = {
      filterField: null,
      filterValue: '',
      colField: null,
      rowFields: [],
      values: [],
      ...pivot,
    };
    next.filterField = next.filterField === column ? null : next.filterField;
    next.colField = next.colField === column ? null : next.colField;
    next.rowFields = next.rowFields.filter((f) => f !== column);
    next.values = next.values.filter((v) => v.column !== column);
    if (next.filterField === null) next.filterValue = '';
    if (to === 'filters') {
      next.filterField = column;
      next.filterValue = '';
    } else if (to === 'columns') {
      next.colField = column;
    } else if (to === 'rows') {
      next.rowFields = [...next.rowFields, column];
    } else {
      const existing = next.values.find((v) => v.column === column);
      next.values = [...next.values, { column, agg: existing?.agg ?? agg }];
    }
    setOpenPivotMenu(null);
    onPivotChange(next);
  }

  function startFieldDrag(e: React.DragEvent, column: string) {
    e.dataTransfer.setData('text/plain', column);
    e.dataTransfer.effectAllowed = 'move';
    dragFieldRef.current = column;
    setDragField(column);
    setOpenPivotMenu(null);
    const ghost = document.createElement('div');
    ghost.textContent = column;
    ghost.className =
      'fixed top-0 left-0 z-[999] px-2.5 py-1.5 rounded-lg bg-[#1d1d1f] text-white text-[12px] font-medium whitespace-nowrap shadow-lg pointer-events-none';
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
    e.dataTransfer.setDragImage(ghost, 10, 10);
  }

  function endFieldDrag() {
    dragFieldRef.current = null;
    setDragField(null);
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }

  function dropOnZone(e: React.DragEvent, zone: PivotZoneName) {
    const col = e.dataTransfer.getData('text/plain') || dragFieldRef.current;
    endFieldDrag();
    if (col) moveField(col, zone);
  }

  function dropOnPill(e: React.DragEvent, zone: PivotZoneName, index: number) {
    const col = e.dataTransfer.getData('text/plain') || dragFieldRef.current;
    endFieldDrag();
    if (!col || !pivot) return;
    if (zone === 'rows' && pivot.rowFields.includes(col)) {
      const rows = pivot.rowFields.filter((f) => f !== col);
      rows.splice(Math.min(index, rows.length), 0, col);
      patchPivot({ rowFields: rows });
    } else if (zone === 'values' && pivot.values.some((v) => v.column === col)) {
      const existing = pivot.values.find((v) => v.column === col)!;
      const values = pivot.values.filter((v) => v.column !== col);
      values.splice(Math.min(index, values.length), 0, existing);
      patchPivot({ values });
    } else {
      moveField(col, zone);
    }
  }

  function changeValueAgg(column: string, agg: PivotAgg) {
    patchPivot({ values: (pivot?.values ?? []).map((v) => (v.column === column ? { ...v, agg } : v)) });
  }

  function toggleCheckbox(column: string, checked: boolean) {
    if (!checked) {
      removeFromReport(column);
      return;
    }
    if (columnLooksNumeric(rows, headers, column)) moveField(column, 'values');
    else moveField(column, 'rows');
  }

  function fieldInUse(column: string): boolean {
    return (
      pivotZones.filters.includes(column) ||
      pivotZones.columns.includes(column) ||
      pivotZones.rows.includes(column) ||
      pivotZones.values.some((v) => v.column === column)
    );
  }

  function clearPivot() {
    setOpenPivotMenu(null);
    setPivotSearch('');
    onPivotChange(null);
  }

  function zoneMenuItems(): { key: string; label: string; onClick: () => void }[] {
    return [{ key: 'rem', label: 'Remove from report', onClick: () => removeFromReport(openPivotMenu?.startsWith('f:') || openPivotMenu?.startsWith('c:') || openPivotMenu?.startsWith('r:') ? openPivotMenu.slice(2) : '') }];
  }

  const sortDescText = draftSort.map((s) => `${s.column} (${s.dir === 'asc' ? 'ascending' : 'descending'})`).join(', ');

  return (
    <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f]">
          Step 3 — Result {pivotActive && <span className="ml-2 text-[12px] font-medium text-[#2563eb]">· pivot summary</span>}
        </h2>
        <span className="text-[12px] text-[#9ca3af]">
          {pivotActive ? (
            <>
              {pivotResult!.groupCount.toLocaleString()} groups &times; {pivotResult!.colCount.toLocaleString()} column values
            </>
          ) : filterActive ? (
            <>
              <span className="text-[#2563eb] font-medium">{displayRows.length.toLocaleString()}</span> of {rows.length.toLocaleString()} rows &times; {headers.length} columns
            </>
          ) : (
            <>
              {rows.length.toLocaleString()} rows &times; {headers.length} columns
            </>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2" ref={menusRef}>
          <button
            onClick={onEditMapping}
            className="px-3 py-1.5 text-[12px] text-[#6e6e73] border border-[#d2d2d7] rounded-lg hover:bg-[#f5f5f7] transition-colors cursor-pointer"
          >
            Edit mapping
          </button>

          {removedColumns.length > 0 && (
            <div className="relative">
              <Tooltip label="Hidden columns" show={!showHidden}>
                <button
                  onClick={() => togglePanel('hidden')}
                  className={`px-2.5 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 border ${
                    showHidden
                      ? 'text-[#2563eb] border-[#2563eb]/50 bg-[#eff6ff] hover:bg-[#dbeafe]'
                      : 'text-[#6e6e73] border-[#d2d2d7] hover:bg-[#f5f5f7]'
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                  <span className="min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#6e6e73] text-white text-[10px] font-semibold">
                    {removedColumns.length}
                  </span>
                </button>
              </Tooltip>
              {showHidden && (
                <div className="absolute right-0 top-full mt-1 w-[340px] bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7]/60 bg-[#fafafa]">
                    <div className="flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#6e6e73]"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                      <span className="text-[13px] font-semibold text-[#1d1d1f]">Hidden columns</span>
                    </div>
                    <span className="text-[11px] text-[#9ca3af]">not in this template</span>
                  </div>
                  <div className="px-4 py-3 max-h-[280px] overflow-y-auto space-y-1.5">
                    {removedColumns.map((col) => (
                      <div key={`${col.name}:${col.source}`} className="flex items-center gap-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium text-[#1d1d1f] truncate">{col.name || 'Column'}</div>
                          <div className="text-[11px] text-[#9ca3af] truncate">from {col.source || '—'}</div>
                        </div>
                        <button
                          onClick={() => onRestoreColumn(col)}
                          className="px-2.5 py-1 text-[11px] font-medium text-[#2563eb] border border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer shrink-0"
                        >
                          + Add
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-2.5 border-t border-[#d2d2d7]/60 bg-[#fafafa]">
                    <p className="text-[11px] text-[#9ca3af] leading-snug">
                      Added columns appear at the end of the table. Click <span className="font-medium text-[#6e6e73]">Update saved template</span> to keep them.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!pivotActive && (
            <div className="relative">
              <Tooltip label="Sort columns" show={!showSort}>
                <button
                  onClick={() => togglePanel('sort')}
                  className={`px-2.5 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 border ${
                    sortActive
                      ? 'text-[#2563eb] border-[#2563eb]/50 bg-[#eff6ff] hover:bg-[#dbeafe]'
                      : 'text-[#6e6e73] border-[#d2d2d7] hover:bg-[#f5f5f7]'
                  }`}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5h10M11 9h7M11 13h4" /><path d="m3 17 3 3 3-3" /><path d="M6 5v15" /></svg>
                  {sortActive && (
                    <span className="min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#2563eb] text-white text-[10px] font-semibold">
                      {sortRules.length}
                    </span>
                  )}
                </button>
              </Tooltip>
              {showSort && (
                <div className="absolute right-0 top-full mt-1 w-[340px] bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7]/60 bg-[#fafafa]">
                    <div className="flex items-center gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb]"><path d="M11 5h10M11 9h7M11 13h4" /><path d="m3 17 3 3 3-3" /><path d="M6 5v15" /></svg>
                      <span className="text-[13px] font-semibold text-[#1d1d1f]">Sort</span>
                    </div>
                    {(sortRules.length > 0 || draftSort.length > 0) && (
                      <button onClick={clearSort} className="text-[12px] text-[#2563eb] hover:underline cursor-pointer">
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="px-4 py-3 max-h-[280px] overflow-y-auto space-y-2.5">
                    <p className="text-[12px] text-[#9ca3af]">
                      Levels sort top to bottom. You can also click a column header to sort quickly.
                    </p>
                    {draftSort.length === 0 && (
                      <p className="text-[12px] text-[#9ca3af] py-1">No sort levels yet.</p>
                    )}
                    {draftSort.map((s, i) => (
                      <div key={i} className="bg-[#fafafa] border border-[#d2d2d7]/70 rounded-lg p-2.5 flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-[#9ca3af] w-5">{i + 1}.</span>
                        <select
                          value={s.column}
                          onChange={(e) => updateSortRule(i, { column: e.target.value })}
                          className="flex-1 min-w-0 px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb] cursor-pointer"
                        >
                          {headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => updateSortRule(i, { dir: s.dir === 'asc' ? 'desc' : 'asc' })}
                          title={s.dir === 'asc' ? 'Ascending' : 'Descending'}
                          className={`px-2 py-1.5 text-[12px] font-medium rounded-lg border transition-colors cursor-pointer ${
                            s.dir === 'asc'
                              ? 'text-[#2563eb] border-[#2563eb]/50 bg-[#eff6ff]'
                              : 'text-[#b45309] border-[#f59e0b]/50 bg-[#fffbeb]'
                          }`}
                        >
                          {s.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                        </button>
                        <button
                          onClick={() => setDraftSort((prev) => prev.filter((_, k) => k !== i))}
                          title="Remove level"
                          className="p-1 text-[#9ca3af] hover:text-[#dc2626] transition-colors cursor-pointer"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addSortLevel}
                      disabled={draftSort.length >= headers.length}
                      className="w-full px-3 py-2 text-[12px] font-medium text-[#2563eb] border border-dashed border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      + Add level
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#d2d2d7]/60 bg-[#fafafa]">
                    <span className="text-[12px] text-[#6e6e73] truncate">
                      {draftSort.length > 0 ? <><span className="font-semibold text-[#1d1d1f]">Sorted by</span> {sortDescText}</> : 'No sorting applied'}
                    </span>
                    <button
                      onClick={commitSort}
                      className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer shrink-0"
                    >
                      Apply sort
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="relative">
            <Tooltip label="Smart filter" show={!showFilter}>
              <button
                onClick={() => togglePanel('filter')}
                className={`px-2.5 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 border ${
                  filterActive
                    ? 'text-[#2563eb] border-[#2563eb]/50 bg-[#eff6ff] hover:bg-[#dbeafe]'
                    : 'text-[#6e6e73] border-[#d2d2d7] hover:bg-[#f5f5f7]'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                {filterActive && (
                  <span className="min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#2563eb] text-white text-[10px] font-semibold">
                    {filters.length}
                  </span>
                )}
              </button>
            </Tooltip>
            {showFilter && (
              <div className="absolute right-0 top-full mt-1 w-[380px] bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7]/60 bg-[#fafafa]">
                  <div className="flex items-center gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb]"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
                    <span className="text-[13px] font-semibold text-[#1d1d1f]">Smart filter</span>
                  </div>
                  {(filters.length > 0 || draftFilters.length > 0) && (
                    <button onClick={clearFilters} className="text-[12px] text-[#2563eb] hover:underline cursor-pointer">
                      Clear all
                    </button>
                  )}
                </div>

                <div className="px-4 py-3 border-b border-[#d2d2d7]/60">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Match</span>
                  <div className="mt-1.5 inline-flex rounded-lg border border-[#d2d2d7] overflow-hidden">
                    {(['and', 'or'] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setDraftMode(m)}
                        className={`px-3 py-1 text-[12px] font-medium transition-colors cursor-pointer ${
                          draftMode === m ? 'bg-[#2563eb] text-white' : 'bg-white text-[#6e6e73] hover:bg-[#f5f5f7]'
                        }`}
                      >
                        {m === 'and' ? 'ALL rules' : 'ANY rule'}
                      </button>
                    ))}
                  </div>
                  <span className="ml-2 text-[12px] text-[#9ca3af]">
                    {draftMode === 'and' ? 'match every rule' : 'match at least one rule'}
                  </span>
                </div>

                <div className="px-4 py-3 max-h-[280px] overflow-y-auto space-y-2.5">
                  {draftFilters.length === 0 && (
                    <p className="text-[12px] text-[#9ca3af] py-1">No rules yet — add one to start filtering.</p>
                  )}
                  {draftFilters.map((f, i) => (
                    <div key={i} className="bg-[#fafafa] border border-[#d2d2d7]/70 rounded-lg p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-semibold text-[#9ca3af] w-5">{i + 1}.</span>
                        <select
                          value={f.column}
                          onChange={(e) => { updateRule(i, { column: e.target.value }); setSuggestFor(null); }}
                          title="Column"
                          className="flex-1 min-w-0 px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb] cursor-pointer"
                        >
                          {headers.map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                        <select
                          value={f.op}
                          onChange={(e) => updateRule(i, { op: e.target.value as SmartFilterOp })}
                          title="Condition"
                          className="w-[128px] shrink-0 px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb] cursor-pointer"
                        >
                          {FILTER_OP_GROUPS.map((g) => (
                            <optgroup key={g.label} label={g.label}>
                              {g.ops.map((op) => (
                                <option key={op} value={op}>{OP_LABELS[op]}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        <button
                          onClick={() => removeRule(i)}
                          title="Remove rule"
                          className="p-1 text-[#9ca3af] hover:text-[#dc2626] transition-colors cursor-pointer"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </button>
                      </div>
                      {!OPS_WITHOUT_VALUE.includes(f.op) && (
                        <div className="relative pl-[26px]">
                          <input
                            value={f.value}
                            onChange={(e) => updateRule(i, { value: e.target.value })}
                            onFocus={() => setSuggestFor(i)}
                            onBlur={() => {
                              if (blurTimer.current) clearTimeout(blurTimer.current);
                              blurTimer.current = setTimeout(() => setSuggestFor(null), 150);
                            }}
                            placeholder={`e.g. type a ${f.column || 'value'}...`}
                            className="w-full px-2.5 py-1.5 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb]"
                          />
                          {suggestFor === i && f.column && (
                            <SuggestionList
                              headers={headers}
                              rows={rows}
                              column={f.column}
                              query={f.value}
                              onPick={(v) => updateRule(i, { value: v })}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setDraftFilters((prev) => [...prev, { column: headers[0] || '', op: 'contains', value: '' }])}
                    disabled={headers.length === 0}
                    className="w-full px-3 py-2 text-[12px] font-medium text-[#2563eb] border border-dashed border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    + Add rule
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#d2d2d7]/60 bg-[#fafafa]">
                  <span className="text-[12px] text-[#6e6e73]">
                    Shows <span className="font-semibold text-[#1d1d1f]">{previewCount.toLocaleString()}</span> of {rows.length.toLocaleString()} rows
                  </span>
                  <button
                    onClick={commitFilters}
                    className="px-4 py-1.5 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
                  >
                    Apply filter
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <Tooltip label="Pivot table" show={!showPivot}>
              <button
                onClick={() => togglePanel('pivot')}
                className={`px-2.5 py-1.5 text-[12px] rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 border ${
                  pivotActive
                    ? 'text-[#2563eb] border-[#2563eb]/50 bg-[#eff6ff] hover:bg-[#dbeafe]'
                    : 'text-[#6e6e73] border-[#d2d2d7] hover:bg-[#f5f5f7]'
                }`}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
                {pivotActive && (
                  <span className="w-2 h-2 rounded-full bg-[#2563eb]" />
                )}
              </button>
            </Tooltip>
            {showPivot && (
              <div className="absolute right-0 top-full mt-1 w-[400px] bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                <div className="flex items-center justify-between px-4 py-3 border-b border-[#d2d2d7]/60 bg-[#fafafa]">
                  <div className="flex items-center gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb]"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>
                    <span className="text-[13px] font-semibold text-[#1d1d1f]">PivotTable Fields</span>
                  </div>
                  {pivot !== null && (
                    <button onClick={clearPivot} className="text-[12px] text-[#2563eb] hover:underline cursor-pointer">
                      Clear
                    </button>
                  )}
                </div>

                <div className="px-4 py-3 border-b border-[#d2d2d7]/60">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">Choose fields to add to report</span>
                  <p className="mt-0.5 text-[11px] text-[#9ca3af]">Check to auto-add, or drag a field into a zone below.</p>
                  <div className="mt-1.5 relative">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9ca3af] pointer-events-none"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                    <input
                      value={pivotSearch}
                      onChange={(e) => setPivotSearch(e.target.value)}
                      placeholder="Search fields…"
                      className="w-full pl-7 pr-2.5 py-1.5 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb]"
                    />
                  </div>
                  <div className="mt-2 max-h-[160px] overflow-y-auto">
                    {searchHeaders.length === 0 && (
                      <p className="text-[12px] text-[#9ca3af] py-1">No fields match.</p>
                    )}
                    {searchHeaders.map((h) => {
                      const used = fieldInUse(h);
                      return (
                        <label
                          key={h}
                          draggable
                          onDragStart={(e) => startFieldDrag(e, h)}
                          onDragEnd={endFieldDrag}
                          className={`flex items-center gap-2 px-1.5 py-1 rounded transition-colors cursor-grab active:cursor-grabbing select-none ${used ? 'bg-[#eff6ff]' : 'hover:bg-[#f5f5f7]'} ${dragField === h ? 'opacity-40' : ''}`}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#c4c4c8] shrink-0">
                            <circle cx="9" cy="5" r="1.6" /><circle cx="15" cy="5" r="1.6" />
                            <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
                            <circle cx="9" cy="19" r="1.6" /><circle cx="15" cy="19" r="1.6" />
                          </svg>
                          <input
                            type="checkbox"
                            checked={used}
                            onChange={(e) => toggleCheckbox(h, e.target.checked)}
                            className="accent-[#2563eb] cursor-pointer"
                          />
                          <span className="text-[12px] text-[#1d1d1f] truncate">{h}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="px-4 py-3 space-y-3 max-h-[300px] overflow-y-auto">
                  <PivotZone zone="filters" title="Filters" hint="report filter" onDropField={dropOnZone}>
                    {pivotZones.filters.map((f) => (
                      <PivotPill key={f} column={f} zone="filters" index={0} label={f} open={openPivotMenu === `f:${f}`} onToggle={() => setOpenPivotMenu(openPivotMenu === `f:${f}` ? null : `f:${f}`)} onDragStart={startFieldDrag} onDragEnd={endFieldDrag} onDropPill={dropOnPill}>
                        {openPivotMenu === `f:${f}` && <PivotMenu items={zoneMenuItems(f)} />}
                      </PivotPill>
                    ))}
                  </PivotZone>

                  <PivotZone zone="columns" title="Columns" onDropField={dropOnZone}>
                    {pivotZones.columns.map((f) => (
                      <PivotPill key={f} column={f} zone="columns" index={0} label={f} open={openPivotMenu === `c:${f}`} onToggle={() => setOpenPivotMenu(openPivotMenu === `c:${f}` ? null : `c:${f}`)} onDragStart={startFieldDrag} onDragEnd={endFieldDrag} onDropPill={dropOnPill}>
                        {openPivotMenu === `c:${f}` && <PivotMenu items={zoneMenuItems(f)} />}
                      </PivotPill>
                    ))}
                  </PivotZone>

                  <PivotZone zone="rows" title="Rows" hint="drag to reorder" onDropField={dropOnZone}>
                    {pivotZones.rows.map((f, i) => (
                      <PivotPill
                        key={f}
                        column={f}
                        zone="rows"
                        index={i}
                        label={f}
                        open={openPivotMenu === `r:${f}`}
                        onToggle={() => setOpenPivotMenu(openPivotMenu === `r:${f}` ? null : `r:${f}`)}
                        onDragStart={startFieldDrag}
                        onDragEnd={endFieldDrag}
                        onDropPill={dropOnPill}
                      >
                        {openPivotMenu === `r:${f}` && <PivotMenu items={zoneMenuItems(f)} />}
                      </PivotPill>
                    ))}
                  </PivotZone>

                  <PivotZone zone="values" title="Values" hint="Σ" onDropField={dropOnZone}>
                    {pivotZones.values.map((v, i) => (
                      <PivotPill key={v.column} column={v.column} zone="values" index={i} label={valueLabel(v)} active open={openPivotMenu === `v:${v.column}`} onToggle={() => setOpenPivotMenu(openPivotMenu === `v:${v.column}` ? null : `v:${v.column}`)} onDragStart={startFieldDrag} onDragEnd={endFieldDrag} onDropPill={dropOnPill}>
                        {openPivotMenu === `v:${v.column}` && (
                          <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-[#d2d2d7] rounded-lg shadow-lg z-50 overflow-hidden">
                            {(Object.keys(PIVOT_AGG_LABELS) as PivotAgg[]).map((a) => (
                              <button
                                key={a}
                                onClick={() => changeValueAgg(v.column, a)}
                                className="w-full text-left px-3 py-1.5 text-[12px] text-[#1d1d1f] hover:bg-[#eff6ff] transition-colors cursor-pointer flex items-center justify-between gap-2"
                              >
                                {PIVOT_AGG_LABELS[a]}
                                {v.agg === a && <span className="text-[#2563eb] text-[11px]">✓</span>}
                              </button>
                            ))}
                            <div className="h-px bg-[#d2d2d7]/60" />
                            <button
                              onClick={() => removeFromReport(v.column)}
                              className="w-full text-left px-3 py-1.5 text-[12px] text-[#dc2626] hover:bg-[#fef2f2] transition-colors cursor-pointer"
                            >
                              Remove from report
                            </button>
                          </div>
                        )}
                      </PivotPill>
                    ))}
                  </PivotZone>
                </div>

                <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-[#d2d2d7]/60 bg-[#fafafa]">
                  <span className="text-[12px] text-[#6e6e73]">
                    {pivotResult ? (
                      <>
                        <span className="font-semibold text-[#1d1d1f]">{pivotResult.groupCount.toLocaleString()}</span> groups &times; {pivotResult.colCount.toLocaleString()} column values
                      </>
                    ) : (
                      'Check fields to build the pivot'
                    )}
                    <span className="ml-1 text-[#9ca3af]">· updates live</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setShowCopyMenu(!showCopyMenu); closeMenus(); setShowSort(false); setShowPivot(false); }}
              className={`px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                copied
                  ? 'text-white bg-[#16a34a] border border-[#16a34a]'
                  : 'text-[#1d1d1f] border border-[#d2d2d7] hover:bg-[#f5f5f7]'
              }`}
            >
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Copied!
                </>
              ) : (
                'Copy raw data'
              )}
            </button>
            {showCopyMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                <button onClick={() => doCopy(true)} className="w-full text-left px-4 py-2.5 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer">
                  Copy with headers
                </button>
                <button onClick={() => doCopy(false)} className="w-full text-left px-4 py-2.5 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer">
                  Copy without headers
                </button>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setShowExportMenu(!showExportMenu); closeMenus(); setShowSort(false); setShowPivot(false); }}
              className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] transition-colors cursor-pointer"
            >
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-[#d2d2d7] rounded-xl shadow-lg overflow-hidden z-40">
                <button onClick={() => { setShowExportMenu(false); onExport('xlsx'); }} className="w-full text-left px-4 py-2.5 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer">
                  Excel file (.xlsx)
                </button>
                <button onClick={() => { setShowExportMenu(false); onExport('csv'); }} className="w-full text-left px-4 py-2.5 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer">
                  CSV file (.csv)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {pivotActive ? (
        <>
          <p className="mb-3 px-4 py-2.5 rounded-lg bg-[#eff6ff] border border-[#bfdbfe] text-[12px] text-[#1d4ed8] flex items-center justify-between gap-3">
            <span>
              Pivot view — grouped summary of {displayRows.length.toLocaleString()} rows. Copy and export include this pivot table.
            </span>
            <button
              onClick={() => onPivotChange(null)}
              className="text-[12px] font-medium text-[#2563eb] hover:underline cursor-pointer shrink-0"
            >
              Back to data
            </button>
          </p>
          {pivot!.filterField && (
            <div className="mb-3 px-4 py-2.5 rounded-lg bg-[#fafafa] border border-[#d2d2d7] flex items-center gap-2 text-[12px]">
              <span className="font-medium text-[#1d1d1f]">{pivot!.filterField}:</span>
              <select
                value={pivot!.filterValue}
                onChange={(e) => patchPivot({ filterValue: e.target.value })}
                className="px-2 py-1 border border-[#d2d2d7] rounded-lg text-[12px] bg-white text-[#1d1d1f] focus:outline-none focus:border-[#2563eb] cursor-pointer"
              >
                <option value="">(All)</option>
                {filterFieldValues.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <span className="ml-auto text-[#9ca3af]">report filter</span>
            </div>
          )}
          <div className="overflow-auto rounded-xl border border-[#d2d2d7] max-h-[600px]">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                {pivotResult!.colHeaders.length > 0 ? (
                  <>
                    <tr>
                      {pivotResult!.rowLabels.length > 0 && (
                        <th rowSpan={2} className="sticky top-0 bg-[#f5f5f7] text-left px-3 py-2 font-medium whitespace-nowrap border-b border-[#d2d2d7] z-10 text-[#6e6e73]">
                          Values
                        </th>
                      )}
                      {pivotResult!.topHeaders.map((h, i) => (
                        <th
                          key={i}
                          colSpan={h.span}
                          className="sticky top-0 bg-[#f5f5f7] text-left px-3 py-2 font-semibold whitespace-nowrap border-b border-[#d2d2d7] z-10 text-[#4338ca]"
                        >
                          {h.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {pivotResult!.colHeaders.map((h, i) => (
                        <th
                          key={i}
                          className={`sticky top-[33px] text-left px-3 py-2 font-medium whitespace-nowrap border-b border-[#d2d2d7] z-10 ${
                            h === 'Total' ? 'bg-[#e0e7ff] text-[#4338ca]' : 'bg-[#f5f5f7] text-[#6e6e73]'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </>
                ) : (
                  <tr>
                    {pivotResult!.headers.map((h, i) => (
                      <th
                        key={i}
                        className={`sticky top-0 text-left px-3 py-2 font-medium whitespace-nowrap border-b border-[#d2d2d7] z-10 ${
                          h.includes('Total') ? 'bg-[#e0e7ff] text-[#4338ca]' : 'bg-[#f5f5f7] text-[#6e6e73]'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {pivotResult!.rows.map((row, r) => {
                  const isGrand = r === pivotResult!.rows.length - 1 && pivotResult!.rows.length > 1;
                  return (
                    <tr key={r} className={isGrand ? 'bg-[#eef2ff]' : r % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className={`px-3 py-1.5 border-b border-[#d2d2d7]/60 whitespace-nowrap ${
                            isGrand
                              ? 'font-semibold text-[#4338ca]'
                              : pivotTotalCols.has(c)
                                ? 'font-medium text-[#4338ca] bg-[#faf5ff]'
                                : 'text-[#1d1d1f]'
                          }`}
                        >
                          {cell ?? ''}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {hiddenCount > 0 && (
            <p className="mb-3 px-4 py-2.5 rounded-lg bg-[#fffbeb] border border-[#fde68a] text-[12px] text-[#b45309]">
              Showing and allowing edits on the first {MAX_EDITABLE_ROWS.toLocaleString()} rows only. All {displayRows.length.toLocaleString()} rows are included in copy and export.
            </p>
          )}
          <p className="mb-3 text-[12px] text-[#9ca3af]">
            Drag a column header to rearrange (the whole column's data moves with it) or click it to sort. Click any cell to edit a value (edits apply to this result only, never to the template).
          </p>

          <div className={`overflow-auto rounded-xl border border-[#d2d2d7] max-h-[600px] ${dragFrom !== null ? 'select-none' : ''}`}>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr>
                  {headers.map((h, i) => {
                    const isDragging = dragFrom === i;
                    const isOver = dragFrom !== null && dragOver === i && !isDragging;
                    const sIdx = sortRules.findIndex((s) => s.column === h);
                    const isPrimarySort = sIdx === 0;
                    return (
                      <th
                        key={i}
                        ref={(el) => { thRefs.current[i] = el; }}
                        onMouseDown={(e) => startHeaderDrag(e, i)}
                        title="Click to sort · drag to reorder — the column data moves with it"
                        className={`sticky top-0 bg-[#f5f5f7] text-left px-3 py-2 font-medium whitespace-nowrap border-b border-[#d2d2d7] z-10 cursor-grab active:cursor-grabbing select-none transition-colors ${
                          isDragging ? 'text-[#2563eb] opacity-50' : isOver ? 'text-[#2563eb]' : sIdx >= 0 ? 'text-[#2563eb]' : 'text-[#6e6e73]'
                        }`}
                      >
                        <span className={`flex items-center gap-1.5 ${isOver ? 'border-b-2 border-[#2563eb] pb-0.5' : ''}`}>
                          {isOver && (
                            <span className="w-0.5 h-3.5 bg-[#2563eb] rounded" />
                          )}
                          {h}
                          {isPrimarySort && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb] shrink-0">
                              {sortRules[0].dir === 'asc' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
                            </svg>
                          )}
                          {sIdx > 0 && (
                            <span className="text-[9px] font-semibold text-[#93c5fd]">{sIdx + 1}</span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={Math.max(1, headers.length)} className="px-3 py-6 text-center text-[#9ca3af]">
                      {filterActive ? 'No rows match your filter. Adjust the rules or clear it.' : 'No data rows to show. Check the header row or column arrangement.'}
                    </td>
                  </tr>
                )}
                {visibleRows.map(({ row, index }, r) => (
                  <tr key={index} className={r % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]'}>
                    {row.map((cell, c) => (
                      <td key={c} className="px-0 py-0 border-b border-[#d2d2d7]/60 align-top">
                        <input
                          value={cell}
                          onChange={(e) => onCellEdit(index, c, e.target.value)}
                          className="w-full min-w-[120px] px-3 py-1.5 bg-transparent focus:bg-[#eff6ff] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[#2563eb] text-[#1d1d1f]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {dragFrom !== null && headers[dragFrom] && (
            <div
              ref={ghostRef}
              className="fixed left-0 top-0 z-50 pointer-events-none flex items-center gap-2 bg-white border border-[#2563eb] rounded-lg shadow-xl px-3 py-2"
              style={{ transform: 'translate(-9999px, -9999px)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#2563eb]"><path d="M9 3v18M15 3v18" /></svg>
              <span className="text-[13px] font-medium text-[#1d1d1f] max-w-[180px] truncate">{headers[dragFrom]}</span>
              <span className="text-[11px] text-[#9ca3af] whitespace-nowrap">moves with its data</span>
              <span className="ml-1 text-[11px] font-semibold text-[#2563eb] whitespace-nowrap">
                → Position {dragOver !== null ? dragOver + 1 : '?'} of {headers.length}
              </span>
            </div>
          )}
        </>
      )}

      <div className="mt-4 flex items-center gap-2 text-[12px] text-[#9ca3af]">
        <button
          onClick={() => { onExport('csv'); }}
          className="px-3 py-1.5 text-[12px] text-[#2563eb] border border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer"
        >
          Download CSV
        </button>
        <button
          onClick={() => { onExport('xlsx'); }}
          className="px-3 py-1.5 text-[12px] text-[#2563eb] border border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer"
        >
          Download Excel
        </button>
        {(filterActive || sortActive || pivotActive) && (
          <span className="ml-auto text-[12px] text-[#9ca3af]">
            Copy &amp; export include {pivotActive ? 'the pivot summary' : filterActive || sortActive ? 'the visible (filtered/sorted) rows' : 'all rows'} only.
          </span>
        )}
      </div>
    </div>
  );
}

function Tooltip({ label, show, children }: { label: string; show: boolean; children: React.ReactNode }) {
  const [hover, setHover] = useState(false);
  const visible = show && hover;
  return (
    <span
      className="inline-flex"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {visible && (
        <span className="absolute top-full right-0 mt-1.5 px-2 py-1 rounded-md bg-[#1d1d1f] text-white text-[11px] font-medium whitespace-nowrap shadow-lg z-50 pointer-events-none">
          {label}
        </span>
      )}
    </span>
  );
}

type PivotZoneName = 'filters' | 'columns' | 'rows' | 'values';

function PivotZone({ zone, title, hint, onDropField, children }: {
  zone: PivotZoneName;
  title: string;
  hint?: string;
  onDropField: (e: React.DragEvent, zone: PivotZoneName) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const empty = Array.isArray(children) ? children.length === 0 : false;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af]">{title}</span>
        {hint && <span className="text-[10px] text-[#c4c4c8]">{hint}</span>}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          onDropField(e, zone);
        }}
        className={`mt-1.5 min-h-[36px] flex flex-wrap items-center gap-1.5 border rounded-lg p-1.5 transition-colors ${
          over ? 'border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#2563eb]/30' : 'bg-[#fafafa] border-[#d2d2d7]/70'
        }`}
      >
        {children}
        {empty && <span className="text-[11px] text-[#c4c4c8] px-1">Drop fields here</span>}
      </div>
    </div>
  );
}

function PivotPill({ column, zone, index, label, active, open, onToggle, onDragStart, onDragEnd, onDropPill, children }: {
  column: string;
  zone: PivotZoneName;
  index: number;
  label: string;
  active?: boolean;
  open: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent, column: string) => void;
  onDragEnd: () => void;
  onDropPill: (e: React.DragEvent, zone: PivotZoneName, index: number) => void;
  children?: React.ReactNode;
}) {
  return (
    <span
      draggable
      onDragStart={(e) => onDragStart(e, column)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropPill(e, zone, index);
      }}
      className="relative inline-flex items-center gap-1 pl-1 pr-1 py-1 rounded-lg border border-[#d2d2d7] bg-white cursor-grab active:cursor-grabbing select-none hover:border-[#2563eb]/50 transition-colors"
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-[#c4c4c8] shrink-0">
        <circle cx="9" cy="5" r="1.6" /><circle cx="15" cy="5" r="1.6" />
        <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
        <circle cx="9" cy="19" r="1.6" /><circle cx="15" cy="19" r="1.6" />
      </svg>
      <span className={`max-w-[120px] truncate font-medium ${active ? 'text-[#2563eb]' : 'text-[#1d1d1f]'}`}>{label}</span>
      <button
        onClick={onToggle}
        title="Options"
        className="p-0.5 text-[#9ca3af] hover:text-[#2563eb] transition-colors cursor-pointer flex items-center"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {children}
    </span>
  );
}

function PivotMenu({ items }: { items: { key: string; label: string; onClick: () => void }[] }) {
  return (
    <div className="absolute left-0 top-full mt-1 w-48 bg-white border border-[#d2d2d7] rounded-lg shadow-lg z-50 overflow-hidden">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={it.onClick}
          className={`w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer ${
            it.key === 'rem' ? 'text-[#dc2626] hover:bg-[#fef2f2]' : 'text-[#1d1d1f] hover:bg-[#eff6ff]'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function SuggestionList({ headers, rows, column, query, onPick }: {  headers: string[];
  rows: string[][];
  column: string;
  query: string;
  onPick: (v: string) => void;
}) {
  const values = useMemo(() => {
    const idx = headers.indexOf(column);
    if (idx === -1) return [];
    const q = query.trim().toLocaleLowerCase();
    const all = uniqueColumnValues(rows, idx, 100);
    return q ? all.filter((v) => v.toLocaleLowerCase().includes(q)).slice(0, 40) : all.slice(0, 40);
  }, [headers, rows, column, query]);

  if (values.length === 0) return null;

  return (
    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#d2d2d7] rounded-lg shadow-lg max-h-[180px] overflow-y-auto z-50">
      {values.map((v) => (
        <button
          key={v}
          onMouseDown={(e) => { e.preventDefault(); onPick(v); }}
          className="w-full text-left px-3 py-1.5 text-[12px] text-[#1d1d1f] hover:bg-[#eff6ff] truncate cursor-pointer"
        >
          {v}
        </button>
      ))}
    </div>
  );
}

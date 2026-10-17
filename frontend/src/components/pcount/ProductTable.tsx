import { Fragment, useEffect, useRef, useState } from 'react';
import { type ExclusionSuggestion, type Product, readJson } from '../../lib/api';

interface Props {
  products: Product[];
  defaultColumns?: string[];
  sortDesc: boolean;
  onToggleSort: () => void;
  onUpdate: (product: Product) => void;
  onSelect?: (product: Product) => void;
  selectedCode?: string | null;
  readOnly?: boolean;
  scrollToCode?: string | null;
  scanSequence?: number;
  editMode?: boolean;
  onCountChange?: (code: string, count: number) => void | boolean | Promise<void | boolean>;
  visibleColumns?: string[];
  onVisibleColumnsChange?: (columns: string[]) => void;
  showStatusSelection?: boolean;
  selectableStatus?: 'pending' | 'missing' | 'excluded';
  selectedStatusCodes?: string[];
  onToggleStatus?: (code: string) => void;
  onToggleAllStatus?: () => void;
  onExcludeSelectedStatus?: () => void;
  onSetStatus?: (codes: string[], status: Product['status']) => void;
  selectionAction?: 'exclude' | 'restore';
  excludingPending?: boolean;
  showProductSelection?: boolean;
  selectedProductCodes?: string[];
  onToggleProduct?: (code: string) => void;
  onToggleAllProducts?: () => void;
  productSelectionDisabled?: boolean;
  suggestionByCode?: Record<string, ExclusionSuggestion>;
  onQuickStolen?: (code: string) => void;
  quickStolenCode?: string | null;
  groupSuggested?: boolean;
}

export const ALL_COLUMNS = [
  { key: 'Product Code', label: 'Product Code', core: true },
  { key: 'Description', label: 'Description', core: true },
  { key: 'System Qty', label: 'System Qty', core: true },
  { key: 'Qty', label: 'Qty', core: true },
  { key: 'Is Match', label: 'Is Match' },
  { key: 'Product SKU Number', label: 'Product SKU Number' },
  { key: 'Barcode', label: 'Barcode' },
  { key: 'Brand', label: 'Brand' },
  { key: 'Category', label: 'Category' },
  { key: 'Group', label: 'Group' },
  { key: 'Price', label: 'Price' },
  { key: 'Retail value', label: 'Retail value' },
  { key: 'Available Qty', label: 'Available Qty' },
  { key: 'Serial Total Qty', label: 'Serial Total Qty' },
  { key: 'Unit Cost', label: 'Unit Cost' },
  { key: 'Total Cost', label: 'Total Cost' },
];

const CORE_KEYS = ALL_COLUMNS.filter(c => c.core).map(c => c.key);
const STORAGE_KEY = 'pcount.tableColumns.v2';

const statusStyles: Record<string, { label: string }> = {
  pending:  { label: 'Pending' },
  excluded: { label: 'Excluded' },
  matched:  { label: 'Matched' },
  missing:  { label: 'Missing' },
};

function loadSaved(): string[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as string[];
      const valid = ALL_COLUMNS.map(c => c.key).filter(k => parsed.includes(k));
      if (valid.length > 0) return valid;
    }
    const legacy = localStorage.getItem('pcount.tableColumns');
    if (legacy) {
      const parsed = JSON.parse(legacy) as string[];
      const valid = ALL_COLUMNS.map(c => c.key).filter(k => parsed.includes(k));
      if (valid.length > 0) return Array.from(new Set([...valid, 'System Qty']));
    }
  } catch {}
  return ALL_COLUMNS.map(c => c.key);
}

function resolveColumns(defaultColumns: string[]): string[] {
  if (defaultColumns.length > 0) {
    const mapped = ALL_COLUMNS.map(c => c.key).filter(k => defaultColumns.includes(k));
    return Array.from(new Set([...CORE_KEYS, ...mapped]));
  }
  return loadSaved();
}

export function ColumnPicker({ columns, onChange }: { columns: string[]; onChange: (columns: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return <div className="relative" ref={ref}>
    <button onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d2d2d7] bg-white px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]">
      Display columns <span className="text-[#6e6e73]">{columns.length}/{ALL_COLUMNS.length}</span>
    </button>
    {open && <div className="absolute right-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-[#d2d2d7] bg-white p-2 shadow-lg">
      <div className="flex items-center justify-between border-b border-[#d2d2d7]/60 px-2 pb-2 pt-1"><span className="text-[12px] font-semibold">Display these columns</span><button onClick={() => onChange(columns.length === ALL_COLUMNS.length ? [] : ALL_COLUMNS.map(column => column.key))} className="text-[12px] font-medium text-[#2563eb]">{columns.length === ALL_COLUMNS.length ? 'Clear all' : 'Select all'}</button></div>
      <div className="max-h-64 overflow-y-auto py-1">{ALL_COLUMNS.map(column => <label key={column.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-[#f5f5f7]"><input type="checkbox" checked={columns.includes(column.key)} onChange={() => onChange(columns.includes(column.key) ? columns.filter(key => key !== column.key) : [...columns, column.key])} className="h-4 w-4 accent-[#2563eb]" />{column.label}</label>)}</div>
    </div>}
  </div>;
}

export default function ProductTable({ products, defaultColumns = [], sortDesc, onToggleSort, onUpdate, onSelect, selectedCode, readOnly, scrollToCode, scanSequence = 0, editMode = false, onCountChange, visibleColumns, onVisibleColumnsChange, showStatusSelection = false, selectableStatus = 'pending', selectedStatusCodes = [], onToggleStatus, onToggleAllStatus, onExcludeSelectedStatus, onSetStatus, selectionAction = 'exclude', excludingPending = false, showProductSelection = false, selectedProductCodes = [], onToggleProduct, onToggleAllProducts, productSelectionDisabled = false, suggestionByCode, onQuickStolen, quickStolenCode = null, groupSuggested = false }: Props) {
  const [visible, setVisible] = useState<string[]>(() => resolveColumns(defaultColumns));
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState('');
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const countInputRefs = useRef(new Map<string, HTMLInputElement>());
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const lastDefaultRef = useRef<string[]>([]);

  useEffect(() => {
    if (defaultColumns.length > 0 && JSON.stringify(lastDefaultRef.current) !== JSON.stringify(defaultColumns)) {
      lastDefaultRef.current = defaultColumns;
      if (!visibleColumns) setVisible(resolveColumns(defaultColumns));
    }
  }, [defaultColumns]);

  useEffect(() => {
    if (!editMode) setEditingCode(null);
  }, [editMode]);

  useEffect(() => {
    if (scanSequence > 0) setEditingCode(null);
  }, [scanSequence]);

  useEffect(() => {
    if (!editingCode) return;
    window.requestAnimationFrame(() => {
      const input = countInputRefs.current.get(editingCode);
      input?.focus();
      input?.select();
    });
  }, [editingCode]);

  useEffect(() => {
    if (!scrollToCode) return;
    const row = rowRefs.current.get(scrollToCode);
    const container = tableScrollRef.current;
    if (!row || !container) return;
    window.requestAnimationFrame(() => {
      const rowRect = row.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const rowTop = rowRect.top - containerRect.top + container.scrollTop;
      const targetTop = rowTop - (container.clientHeight - rowRect.height) / 2;
      container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    });
  }, [scrollToCode, products]);

  useEffect(() => {
    if (!visibleColumns) localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
  }, [visible, visibleColumns]);

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-[#d2d2d7] p-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#f5f5f7] mb-3">
          <svg className="w-6 h-6 text-[#6e6e73]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 11.625l2.25-2.25M12 11.625l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
        </div>
        <p className="text-[14px] text-[#6e6e73]">No products match the current filter.</p>
      </div>
    );
  }

  const sorted = [...products].sort((a, b) =>
    sortDesc ? b.product_code.localeCompare(a.product_code) : a.product_code.localeCompare(b.product_code)
  );

  const hasHistory = (code: string) => Boolean(suggestionByCode?.[code.trim().toUpperCase()]);
  // On the Missing tab: plain rows first ("find these"), history-flagged rows
  // grouped after ("consider excluding").
  const doGroup = groupSuggested && sorted.length > 0 && sorted.every((p) => p.status === 'missing');
  const displayed = doGroup
    ? [...sorted.filter((p) => !hasHistory(p.product_code)), ...sorted.filter((p) => hasHistory(p.product_code))]
    : sorted;

  const shown = ALL_COLUMNS.filter(c => (visibleColumns ?? visible).includes(c.key) || (editMode && c.key === 'Is Match'));
  const showSelection = showProductSelection || showStatusSelection;
  const selectableProducts = showProductSelection
    ? products.filter(product => product.status !== 'excluded')
    : products.filter(product => product.status === selectableStatus && !(selectableStatus === 'missing' && String(product.notes || '').trim().toLowerCase() === 'stolen'));
  const selectedStatusSet = new Set(selectedStatusCodes);
  const selectedProductSet = new Set(selectedProductCodes);
  const activeSelectionSet = showProductSelection ? selectedProductSet : selectedStatusSet;
  const selectedCodes = showProductSelection ? selectedProductCodes : selectedStatusCodes;
  const selectedCount = selectedCodes.length;
  const allSelected = selectableProducts.length > 0 && selectableProducts.every(product => activeSelectionSet.has(product.product_code));
  const selectableLabel = selectableStatus === 'missing' ? 'missing' : selectableStatus === 'excluded' ? 'excluded' : 'pending';
  const actionLabel = selectionAction === 'restore' ? 'Re-include selected' : 'Exclude selected';

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedCount > 0 && !allSelected;
    }
  }, [selectedCount, allSelected]);

  const rowSelectable = (product: Product) => showProductSelection
    ? product.status !== 'excluded'
    : product.status === selectableStatus && !(selectableStatus === 'missing' && String(product.notes || '').trim().toLowerCase() === 'stolen');
  const handleToggleRow = showProductSelection ? onToggleProduct : onToggleStatus;
  const handleToggleAll = showProductSelection ? onToggleAllProducts : onToggleAllStatus;

  function beginEdit(product: Product) {
    if (!editMode || readOnly || savingCode) return;
    setEditingCode(product.product_code);
    setEditingValue(String(product.counted_qty));
  }

  async function saveEdit(product: Product, nextProduct?: Product) {
    const count = Number(editingValue);
    if (!Number.isInteger(count) || count < 0 || !onCountChange || savingCode) return;

    setSavingCode(product.product_code);
    const result = await onCountChange(product.product_code, count);
    setSavingCode(null);
    if (result === false) return;

    if (nextProduct) {
      beginEdit(nextProduct);
    } else {
      setEditingCode(null);
    }
  }

  async function handleRecount(product: Product) {
    try {
      const res = await fetch(`/api/pcount/sessions/${product.session_id}/products/${encodeURIComponent(product.product_code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ counted_qty: 0, status: 'pending' }),
      });
      const data = await readJson<Partial<Product>>(res);
      if (res.ok) onUpdate({ ...product, ...data });
    } catch {}
  }

  return (
    <div className="pcount-table flex h-full min-h-0 flex-col">
      <style>{`
        @keyframes overscan-shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-4px); }
          30%, 70% { transform: translateX(4px); }
        }
      `}</style>
      {showSelection && selectableProducts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e7eb] bg-[#f5f5f7] px-3 py-2.5">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#1d1d1f]">
            <input type="checkbox" checked={allSelected} onChange={handleToggleAll} disabled={excludingPending || productSelectionDisabled} className="h-4 w-4 accent-[#2563eb]" />
            Select all {showProductSelection ? 'visible' : selectableLabel}
          </label>
          {selectedCount > 0 && <span className="pcount-chip pcount-chip--pending">{selectedCount} selected</span>}
          <div className="pcount-toolbar-spacer" />
          {onSetStatus && (
            <div className="flex items-center gap-2">
              <select
                value={bulkStatus}
                onChange={e => setBulkStatus(e.target.value)}
                disabled={selectedCount === 0 || excludingPending}
                title="Set the status of all selected rows"
                className="pcount-select"
              >
                <option value="">Set status…</option>
                <option value="matched">Matched</option>
                <option value="missing">Missing</option>
                <option value="pending">Pending</option>
                <option value="excluded">Excluded</option>
              </select>
              <button
                type="button"
                disabled={selectedCount === 0 || !bulkStatus || excludingPending}
                onClick={() => { onSetStatus(selectedCodes, bulkStatus as Product['status']); setBulkStatus(''); }}
                className="pcount-secondary-button disabled:cursor-not-allowed"
              >
                Apply{selectedCount ? ` (${selectedCount})` : ''}
              </button>
            </div>
          )}
          {onExcludeSelectedStatus && !showProductSelection && (
            <button type="button" onClick={onExcludeSelectedStatus} disabled={selectedCount === 0 || excludingPending} className="pcount-secondary-button disabled:cursor-not-allowed">
              {excludingPending ? (selectionAction === 'restore' ? 'Re-including…' : 'Excluding…') : `${actionLabel}${selectedCount ? ` (${selectedCount})` : ''}`}
            </button>
          )}
        </div>
      )}
      <div ref={tableScrollRef} className="pcount-product-table-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="pcount-table-head sticky top-0 z-10">
              {showSelection && (
                <th className="w-10 px-3 py-3 text-center">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={handleToggleAll}
                    disabled={excludingPending || productSelectionDisabled}
                    className="h-4 w-4 align-middle accent-[#2563eb]"
                    aria-label={showProductSelection ? 'Select all products' : `Select all ${selectableLabel}`}
                  />
                </th>
              )}
                  {shown.map(col => (
                <th
                  key={col.key}
                  onClick={col.key === 'Product Code' ? onToggleSort : undefined}
                  className={`px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider ${
                    col.key === 'Product Code'
                      ? 'text-left cursor-pointer select-none hover:text-[#1d1d1f]'
                      : col.key === 'Qty' || col.key === 'System Qty' ? 'text-right'
                      : col.key === 'Is Match' ? 'text-center' : 'text-left'
                  }`}
                >
                  {editMode && col.key === 'System Qty' ? 'System Quantity' :
                    editMode && col.key === 'Qty' ? 'Actual Quantity' : col.label}
                  {col.key === 'Product Code' ? ` ${sortDesc ? '\u2193' : '\u2191'}` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((p, rowIndex) => {
              const st = statusStyles[p.status] || statusStyles.pending;
              const isSelected = selectedCode === p.product_code;
              const isMatch = p.system_qty === p.counted_qty && p.counted_qty > 0;
              const isOver = p.counted_qty > p.system_qty;
              const flagged = doGroup && hasHistory(p.product_code);
              const showGroupHeader = doGroup && (rowIndex === 0 || hasHistory(displayed[rowIndex - 1].product_code) !== flagged);

              return (
                <Fragment key={p.id}>
                  {showGroupHeader && (
                    <tr className="bg-[#f5f5f7]">
                      <td colSpan={shown.length + (showSelection ? 1 : 0)} className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6e6e73]">
                        {flagged ? 'Flagged from previous sessions — consider excluding' : 'Needs attention — find these'}
                      </td>
                    </tr>
                  )}
                <tr
                  key={p.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(p.product_code, node);
                    else rowRefs.current.delete(p.product_code);
                  }}
                  onClick={() => onSelect?.(p)}
                  className={`border-b border-[#e5e7eb] hover:bg-[#f5f5f7] cursor-pointer ${
                    isSelected ? 'bg-[#eff6ff] ring-2 ring-inset ring-[#2563eb]' : ''
                  } ${
                    p.status === 'excluded' ? 'opacity-50' : ''
                  }`}
                >
                  {showSelection && (
                    <td className="w-10 px-3 py-3 text-center">
                      {rowSelectable(p) && (
                        <input
                          type="checkbox"
                          checked={activeSelectionSet.has(p.product_code)}
                          onChange={() => handleToggleRow?.(p.product_code)}
                          onClick={e => e.stopPropagation()}
                          disabled={showProductSelection ? productSelectionDisabled : excludingPending}
                          className="h-4 w-4 accent-[#2563eb]"
                          aria-label={`Select ${p.product_code}`}
                        />
                      )}
                    </td>
                  )}
                  {shown.map(col => {
                    if (col.key === 'Product Code') {
                      return (
                        <td key={col.key} className="px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-[12px] font-medium text-[#1d1d1f]">{p.product_code}</span>
                            <span className={`pcount-chip pcount-chip--${p.status}`}>{st.label}</span>
                          </div>
                        </td>
                      );
                    }
                    if (col.key === 'Description') {
                      return (
                        <td key={col.key} className="px-4 py-3 text-[#1d1d1f] max-w-[220px] truncate">{p.description}</td>
                      );
                    }
                    if (col.key === 'System Qty') {
                      return (
                        <td key={col.key} className="px-4 py-3 text-right">
                          <span className="font-medium tabular-nums text-[#6e6e73]">{p.system_qty}</span>
                        </td>
                      );
                    }
                    if (col.key === 'Qty') {
                      const isEditing = editingCode === p.product_code;
                      const shortfall = p.status === 'missing' ? Math.max(0, (Number(p.system_qty) || 0) - (Number(p.counted_qty) || 0)) : 0;
                      return (
                        <td
                          key={col.key}
                          className={`px-4 py-3 ${editMode && !readOnly ? 'cursor-text' : ''}`}
                          onDoubleClick={() => beginEdit(p)}
                          title={editMode && !readOnly ? 'Double-click to edit physical count' : undefined}
                        >
                          <div className="flex items-center justify-end gap-2">
                            {isEditing ? (
                              <input
                                ref={(node) => {
                                  if (node) countInputRefs.current.set(p.product_code, node);
                                  else countInputRefs.current.delete(p.product_code);
                                }}
                                type="number"
                                min="0"
                                step="1"
                                value={editingValue}
                                disabled={savingCode === p.product_code}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onBlur={() => { void saveEdit(p); }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditingCode(null);
                                  }
                                  if (e.key === 'Enter' || e.key === 'Tab') {
                                    e.preventDefault();
                                    const index = sorted.findIndex(item => item.product_code === p.product_code);
                                    const nextProduct = e.key === 'Tab' ? sorted[index + 1] : undefined;
                                    void saveEdit(p, nextProduct);
                                  }
                                }}
                                className="w-20 rounded-md border border-[#2563eb] bg-white px-2 py-1 text-right text-[13px] font-semibold tabular-nums text-[#1d1d1f] outline-none ring-2 ring-[#2563eb]/15"
                                aria-label={`Physical count for ${p.product_code}`}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); if (editMode) beginEdit(p); }}
                                className={`font-semibold tabular-nums ${
                                  isOver ? 'text-[#dc2626]' :
                                  isMatch ? 'text-[#16a34a]' :
                                  p.counted_qty > 0 ? 'text-[#d97706]' :
                                  'text-[#6e6e73]'
                                } ${editMode && !readOnly ? 'rounded-md px-2 py-1 hover:bg-[#eff6ff]' : ''}`}
                                title={editMode && !readOnly ? 'Edit physical count' : undefined}
                              >
                                {p.counted_qty}
                              </button>
                            )}
                            {shortfall > 0 && !isEditing && (
                              <span title={`${shortfall} pcs short (system ${p.system_qty}, actual ${p.counted_qty})`} className="rounded-full bg-[#fef3c7] px-1.5 py-px text-[10px] font-semibold text-[#b45309]">
                                {shortfall} short
                              </span>
                            )}
                            {!readOnly && !isEditing && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleRecount(p); }}
                                title="Reset count"
                                className="p-1 rounded-lg hover:bg-[#f5f5f7] text-[#6e6e73] hover:text-[#dc2626] transition-colors"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    }
                    if (col.key === 'Is Match') {
                      const matchesExport = p.counted_qty === p.system_qty;
                      return (
                        <td key={col.key} className="px-4 py-3 text-center">
                          <span className={`inline-flex min-w-12 justify-center rounded-md px-2 py-1 text-[11px] font-semibold ${
                            matchesExport
                              ? 'bg-[#f0fdf4] text-[#16a34a]'
                              : 'bg-[#fef2f2] text-[#dc2626]'
                          }`}>
                            {matchesExport ? 'TRUE' : 'FALSE'}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} className="px-4 py-3 text-[#6e6e73] max-w-[140px] truncate text-[12px]">{p.extra[col.key] || '\u2014'}</td>
                    );
                  })}
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

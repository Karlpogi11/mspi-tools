import { useEffect, useRef, useState } from 'react';
import { type Product, readJson } from '../../lib/api';

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
  selectionAction?: 'exclude' | 'restore';
  excludingPending?: boolean;
  showProductSelection?: boolean;
  selectedProductCodes?: string[];
  onToggleProduct?: (code: string) => void;
  onToggleAllProducts?: () => void;
  productSelectionDisabled?: boolean;
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

const statusStyles: Record<string, { bg: string; dot: string; label: string }> = {
  pending:  { bg: 'bg-[#f5f5f7]',        dot: 'bg-[#6e6e73]', label: 'Pending' },
  excluded: { bg: 'bg-[#f5f5f7]',        dot: 'bg-[#9a9aa0]', label: 'Excluded' },
  matched:  { bg: 'bg-[#f0fdf4]',        dot: 'bg-[#16a34a]', label: 'Matched' },
  missing:  { bg: 'bg-[#fffbeb]',        dot: 'bg-[#d97706]', label: 'Missing' },
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

export default function ProductTable({ products, defaultColumns = [], sortDesc, onToggleSort, onUpdate, onSelect, selectedCode, readOnly, scrollToCode, scanSequence = 0, editMode = false, onCountChange, visibleColumns, onVisibleColumnsChange, showStatusSelection = false, selectableStatus = 'pending', selectedStatusCodes = [], onToggleStatus, onToggleAllStatus, onExcludeSelectedStatus, selectionAction = 'exclude', excludingPending = false, showProductSelection = false, selectedProductCodes = [], onToggleProduct, onToggleAllProducts, productSelectionDisabled = false }: Props) {
  const [visible, setVisible] = useState<string[]>(() => resolveColumns(defaultColumns));
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const countInputRefs = useRef(new Map<string, HTMLInputElement>());
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
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

  const shown = ALL_COLUMNS.filter(c => (visibleColumns ?? visible).includes(c.key) || (editMode && c.key === 'Is Match'));
  const selectableProducts = showProductSelection
    ? products.filter(product => product.status !== 'excluded')
    : products.filter(product => product.status === selectableStatus);
  const selectedStatusSet = new Set(selectedStatusCodes);
  const allStatusSelected = selectableProducts.length > 0 && selectableProducts.every(product => selectedStatusSet.has(product.product_code));
  const selectableLabel = selectableStatus === 'missing' ? 'missing' : selectableStatus === 'excluded' ? 'excluded' : 'pending';
  const actionLabel = selectionAction === 'restore' ? 'Re-include selected' : 'Exclude selected';
  const selectedProductSet = new Set(selectedProductCodes);
  const allProductsSelected = selectableProducts.length > 0 && selectableProducts.every(product => selectedProductSet.has(product.product_code));

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
      {showStatusSelection && selectableProducts.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b border-[#d2d2d7]/60 bg-[#fbfbfd] px-4 py-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] font-medium text-[#1d1d1f]">
            <input type="checkbox" checked={allStatusSelected} onChange={onToggleAllStatus} disabled={excludingPending} className="h-4 w-4 accent-[#2563eb]" />
            Select all {selectableLabel}
          </label>
          <button type="button" onClick={onExcludeSelectedStatus} disabled={selectedStatusCodes.length === 0 || excludingPending} className="rounded-lg border border-[#d2d2d7] bg-white px-3 py-1.5 text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:cursor-not-allowed disabled:opacity-50">
            {excludingPending ? (selectionAction === 'restore' ? 'Re-including…' : 'Excluding…') : `${actionLabel}${selectedStatusCodes.length ? ` (${selectedStatusCodes.length})` : ''}`}
          </button>
        </div>
      )}
      <div ref={tableScrollRef} className="pcount-product-table-scroll min-h-0 flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="pcount-table-head sticky top-0 z-10">
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
                  {col.key === 'Product Code' && showProductSelection && (
                    <input type="checkbox" checked={allProductsSelected} onChange={onToggleAllProducts} disabled={productSelectionDisabled} onClick={e => e.stopPropagation()} className="mr-2 h-4 w-4 align-middle accent-[#2563eb]" aria-label="Select all products" />
                  )}
                  {editMode && col.key === 'System Qty' ? 'System Quantity' :
                    editMode && col.key === 'Qty' ? 'Actual Quantity' : col.label}
                  {col.key === 'Product Code' ? ` ${sortDesc ? '\u2193' : '\u2191'}` : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const st = statusStyles[p.status] || statusStyles.pending;
              const isSelected = selectedCode === p.product_code;
              const isMatch = p.system_qty === p.counted_qty && p.counted_qty > 0;
              const isOver = p.counted_qty > p.system_qty;

              return (
                <tr
                  key={p.id}
                  ref={(node) => {
                    if (node) rowRefs.current.set(p.product_code, node);
                    else rowRefs.current.delete(p.product_code);
                  }}
                  onClick={() => onSelect?.(p)}
                  className={`border-b border-[#d2d2d7]/60 hover:bg-[#fafafa] cursor-pointer ${
                    isSelected ? 'bg-[#eff6ff] ring-2 ring-inset ring-[#2563eb]' : ''
                  } ${
                    p.status === 'excluded' ? 'opacity-50 bg-[#fafafa]' : ''
                  }`}
                >
                  {shown.map(col => {
                    if (col.key === 'Product Code') {
                      return (
                        <td key={col.key} className="px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {showProductSelection && p.status !== 'excluded' && <input type="checkbox" checked={selectedProductSet.has(p.product_code)} onChange={() => onToggleProduct?.(p.product_code)} onClick={e => e.stopPropagation()} disabled={productSelectionDisabled} className="h-4 w-4 flex-shrink-0 accent-[#2563eb]" aria-label={`Select ${p.product_code} to complete`} />}
                            {showStatusSelection && p.status === selectableStatus && <input type="checkbox" checked={selectedStatusSet.has(p.product_code)} onChange={() => onToggleStatus?.(p.product_code)} onClick={e => e.stopPropagation()} disabled={excludingPending} className="h-4 w-4 flex-shrink-0 accent-[#2563eb]" aria-label={`Select ${p.product_code} for exclusion`} />}
                            <span className={`w-2 h-2 rounded-full ${st.dot} flex-shrink-0`} />
                            <span className="font-mono text-[12px] text-[#1d1d1f] font-medium">{p.product_code}</span>
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${st.bg} ${
                              p.status === 'matched' ? 'text-[#16a34a]' :
                              p.status === 'missing' ? 'text-[#d97706]' :
                              'text-[#6e6e73]'
                            }`}>
                              {st.label}
                            </span>
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
                              ? 'bg-[#f0fdf4] text-[#15803d]'
                              : 'bg-[#fef2f2] text-[#b91c1c]'
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

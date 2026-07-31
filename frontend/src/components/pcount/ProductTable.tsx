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
  overscanCode?: string | null;
  readOnly?: boolean;
}

const ALL_COLUMNS = [
  { key: 'Product Code', label: 'Product Code', core: true },
  { key: 'Description', label: 'Description', core: true },
  { key: 'System Qty', label: 'System Qty', core: true },
  { key: 'Qty', label: 'Qty', core: true },
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

export default function ProductTable({ products, defaultColumns = [], sortDesc, onToggleSort, onUpdate, onSelect, selectedCode, overscanCode, readOnly }: Props) {
  const [visible, setVisible] = useState<string[]>(() => resolveColumns(defaultColumns));
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const lastDefaultRef = useRef<string[]>([]);

  useEffect(() => {
    if (defaultColumns.length > 0 && JSON.stringify(lastDefaultRef.current) !== JSON.stringify(defaultColumns)) {
      lastDefaultRef.current = defaultColumns;
      setVisible(resolveColumns(defaultColumns));
    }
  }, [defaultColumns]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visible));
  }, [visible]);

  useEffect(() => {
    if (!showPicker) return;
    function onDocClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showPicker]);

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

  const shown = ALL_COLUMNS.filter(c => visible.includes(c.key));

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
    <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
      <style>{`
        @keyframes overscan-shake {
          0%, 100% { transform: translateX(0); }
          10%, 50%, 90% { transform: translateX(-4px); }
          30%, 70% { transform: translateX(4px); }
        }
      `}</style>
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#d2d2d7] bg-[#fafafa]">
        <span className="text-[12px] font-medium text-[#6e6e73] uppercase tracking-wider">Display these columns</span>
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPicker(!showPicker)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#d2d2d7] bg-white text-[13px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5 text-[#6e6e73]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
            </svg>
            {visible.length === 0 ? 'None' : `${visible.length}/${ALL_COLUMNS.length} selected`}
            <svg className="w-3.5 h-3.5 text-[#6e6e73]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl border border-[#d2d2d7] shadow-lg p-2 z-20">
              <div className="flex items-center justify-between px-2 pt-1 pb-2 border-b border-[#d2d2d7]/60">
                <span className="text-[12px] font-semibold text-[#1d1d1f]">Display these columns</span>
                <button
                  onClick={() => setVisible(visible.length === ALL_COLUMNS.length ? [] : ALL_COLUMNS.map(c => c.key))}
                  className="text-[12px] font-medium text-[#2563eb] hover:text-[#1d4ed8] hover:underline transition-colors cursor-pointer"
                >
                  {visible.length === ALL_COLUMNS.length ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {ALL_COLUMNS.map(col => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#f5f5f7] cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={visible.includes(col.key)}
                      onChange={() => {
                        setVisible(prev =>
                          prev.includes(col.key) ? prev.filter(k => k !== col.key) : [...prev, col.key]
                        );
                      }}
                      className="w-4 h-4 rounded accent-[#2563eb] cursor-pointer"
                    />
                    <span className="text-[13px] text-[#1d1d1f]">{col.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto max-h-[65vh]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7] sticky top-0 z-10">
              {shown.map(col => (
                <th
                  key={col.key}
                  onClick={col.key === 'Product Code' ? onToggleSort : undefined}
                  className={`px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider ${
                    col.key === 'Product Code'
                      ? 'text-left cursor-pointer select-none hover:text-[#1d1d1f]'
                      : col.key === 'Qty' || col.key === 'System Qty' ? 'text-right' : 'text-left'
                  }`}
                >
                  {col.label}{col.key === 'Product Code' ? ` ${sortDesc ? '\u2193' : '\u2191'}` : ''}
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
                  onClick={() => onSelect?.(p)}
                  className={`border-b border-[#d2d2d7]/60 hover:bg-[#fafafa] cursor-pointer ${
                    isSelected ? 'bg-[#eff6ff] ring-2 ring-inset ring-[#2563eb]' : ''
                  } ${
                    overscanCode === p.product_code ? 'animate-[overscan-shake_0.4s_ease-in-out] bg-[#fef2f2]' : ''
                  }`}
                >
                  {shown.map(col => {
                    if (col.key === 'Product Code') {
                      return (
                        <td key={col.key} className="px-4 py-3">
                          <div className="flex items-center gap-2 min-w-0">
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
                      return (
                        <td key={col.key} className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <span className={`font-semibold tabular-nums ${
                              isOver ? 'text-[#dc2626]' :
                              isMatch ? 'text-[#16a34a]' :
                              p.counted_qty > 0 ? 'text-[#d97706]' :
                              'text-[#6e6e73]'
                            }`}>
                              {p.counted_qty}
                            </span>
                            {!readOnly && (
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

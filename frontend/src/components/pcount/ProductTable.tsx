import { type Product } from '../../lib/api';

interface Props {
  products: Product[];
  displayColumns: string[];
  sortDesc: boolean;
  onToggleSort: () => void;
  onUpdate: (product: Product) => void;
  onSelect?: (product: Product) => void;
  selectedCode?: string | null;
  overscanCode?: string | null;
}

const statusStyles: Record<string, { bg: string; dot: string; label: string }> = {
  pending:  { bg: 'bg-[#f5f5f7]',        dot: 'bg-[#6e6e73]', label: 'Pending' },
  matched:  { bg: 'bg-[#f0fdf4]',        dot: 'bg-[#16a34a]', label: 'Matched' },
  missing:  { bg: 'bg-[#fffbeb]',        dot: 'bg-[#d97706]', label: 'Missing' },
  over:     { bg: 'bg-[#fef2f2]',        dot: 'bg-[#dc2626]', label: 'Over' },
  defect:   { bg: 'bg-[#fef2f2]',        dot: 'bg-[#dc2626]', label: 'Defect' },
  stolen:   { bg: 'bg-[#fef2f2]',        dot: 'bg-[#dc2626]', label: 'Stolen' },
  ignored:  { bg: 'bg-[#f5f5f7]',        dot: 'bg-[#6e6e73]', label: 'Ignored' },
};

export default function ProductTable({ products, displayColumns, sortDesc, onToggleSort, onUpdate, onSelect, selectedCode, overscanCode }: Props) {
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

  async function handleRecount(product: Product) {
    try {
      const res = await fetch(`/api/pcount/sessions/${product.session_id}/products/${encodeURIComponent(product.product_code)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ counted_qty: 0, status: 'pending' }),
      });
      const data = await res.json();
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
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
              <th className="text-left px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider cursor-pointer select-none hover:text-[#1d1d1f]" onClick={onToggleSort}>
                Product Code {sortDesc ? '\u2193' : '\u2191'}
              </th>
              <th className="text-left px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Description</th>
              <th className="text-left px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Cat</th>
              <th className="text-right px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">System Qty</th>
              <th className="text-right px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Actual Qty</th>
              <th className="text-center px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">Status</th>
              {displayColumns.map(col => (
                <th key={col} className="text-left px-4 py-3 font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">{col}</th>
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
                  } ${p.status === 'stolen' ? 'bg-red-50/50' : ''} ${
                    overscanCode === p.product_code ? 'animate-[overscan-shake_0.4s_ease-in-out] bg-[#fef2f2]' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${st.dot} flex-shrink-0`} />
                      <span className="font-mono text-[12px] text-[#1d1d1f] font-medium">{p.product_code}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#1d1d1f] max-w-[220px] truncate">{p.description}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${
                      p.category === 'apple' ? 'text-[#2563eb] bg-[#eff6ff]' :
                      p.category === '3pp' ? 'text-[#7c3aed] bg-[#f5f3ff]' :
                      'text-[#6e6e73] bg-[#f5f5f7]'
                    }`}>
                      {p.category || '\u2014'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-semibold text-[#1d1d1f]">{p.system_qty}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <span className={`font-semibold tabular-nums ${
                        isOver ? 'text-[#dc2626]' :
                        isMatch ? 'text-[#16a34a]' :
                        p.counted_qty > 0 ? 'text-[#d97706]' :
                        'text-[#6e6e73]'
                      }`}>
                        {p.counted_qty}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRecount(p); }}
                        title="Reset count"
                        className="p-1 rounded hover:bg-[#f5f5f7] text-[#6e6e73] hover:text-[#dc2626] transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${st.bg} ${
                      p.status === 'matched' ? 'text-[#16a34a]' :
                      p.status === 'over' ? 'text-[#dc2626]' :
                      p.status === 'missing' ? 'text-[#d97706]' :
                      p.status === 'stolen' ? 'text-[#dc2626]' :
                      p.status === 'defect' ? 'text-[#dc2626]' :
                      'text-[#6e6e73]'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        p.status === 'matched' ? 'bg-[#16a34a]' :
                        p.status === 'over' ? 'bg-[#dc2626]' :
                        p.status === 'missing' ? 'bg-[#d97706]' :
                        'bg-[#6e6e73]'
                      }`} />
                      {st.label}
                    </span>
                  </td>
                  {displayColumns.map(col => (
                    <td key={col} className="px-4 py-3 text-[#6e6e73] max-w-[140px] truncate text-[12px]">{p.extra[col] || '\u2014'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { api, type PcountComparison as Comparison, type PcountComparisonRow, type Session } from '../../lib/api';

interface Props {
  currentSessionId: number;
  onClose: () => void;
}

const changeLabels: Record<PcountComparisonRow['change'], string> = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  unchanged: 'Unchanged',
};

export default function PcountComparison({ currentSessionId, onClose }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [filter, setFilter] = useState<'all' | PcountComparisonRow['change'] | 'category'>('all');
  const [search, setSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.sessions.list()
      .then(list => {
        const available = list.filter(session => session.id !== currentSessionId && (session.is_owner || session.joined));
        setSessions(available);
        if (available[0]) setSelectedId(String(available[0].id));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Could not load PCount sessions.'))
      .finally(() => setLoadingSessions(false));
  }, [currentSessionId]);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingComparison(true);
    setError('');
    api.sessions.compare(currentSessionId, Number(selectedId))
      .then(setComparison)
      .catch(err => setError(err instanceof Error ? err.message : 'Could not compare sessions.'))
      .finally(() => setLoadingComparison(false));
  }, [currentSessionId, selectedId]);

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (comparison?.products || []).filter(product => {
      if (filter !== 'all' && filter !== 'category' && product.change !== filter) return false;
      if (filter === 'category' && product.change === 'unchanged') return false;
      if (!query) return true;
      return [product.product_code, product.description, product.brand].some(value => value.toLowerCase().includes(query));
    });
  }, [comparison, filter, search]);

  const counts = useMemo(() => {
    const products = comparison?.products || [];
    const categoryCount = (category: string, field: 'previous_count' | 'current_count') =>
      products.filter(product => (field === 'previous_count' ? product.previous_category : product.current_category) === category)
        .reduce((sum, product) => sum + product[field], 0);
    return {
      total: products.length,
      changed: products.filter(product => product.change === 'changed').length,
      added: products.filter(product => product.change === 'added').length,
      removed: products.filter(product => product.change === 'removed').length,
      category: products.filter(product => product.category_changed).length,
      previousApple: categoryCount('Apple', 'previous_count'),
      currentApple: categoryCount('Apple', 'current_count'),
      previous3pp: categoryCount('3PP', 'previous_count'),
      current3pp: categoryCount('3PP', 'current_count'),
      difference: products.reduce((sum, product) => sum + product.difference, 0),
    };
  }, [comparison]);

  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-[#111827]/60 p-4">
      <div className="mx-auto min-h-full max-w-6xl rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[#1d1d1f]">Compare PCount reports</h2>
            <p className="mt-1 text-[12px] text-[#6e6e73]">Compare the current report with another accessible session.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-[#d2d2d7] px-3 py-1.5 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7]">Close</button>
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label htmlFor="pcount-compare-session" className="text-[12px] font-medium text-[#3c3c43]">Compare against</label>
            <select id="pcount-compare-session" value={selectedId} onChange={event => setSelectedId(event.target.value)} disabled={loadingSessions || sessions.length === 0} className="pcount-select min-w-0 flex-1 sm:max-w-xl">
              <option value="">{loadingSessions ? 'Loading sessions…' : 'No other accessible sessions'}</option>
              {sessions.map(session => <option key={session.id} value={session.id}>{session.name} · {new Date(session.created_at).toLocaleDateString()}</option>)}
            </select>
          </div>

          {error && <p className="rounded-lg bg-[#fff7ed] px-3 py-2 text-[12px] text-[#9a3412]" role="alert">{error}</p>}
          {loadingComparison && <p className="text-[12px] text-[#6e6e73]">Comparing sessions…</p>}
          {comparison && !loadingComparison && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[['Products', counts.total], ['Changed', counts.changed], ['Apple count', `${counts.previousApple} → ${counts.currentApple}`], ['3PP count', `${counts.previous3pp} → ${counts.current3pp}`], ['Category changes', counts.category], ['Added', counts.added], ['Removed', counts.removed], ['Count difference', counts.difference > 0 ? `+${counts.difference}` : counts.difference]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] px-3 py-2"><p className="text-[11px] text-[#6e6e73]">{label}</p><p className="mt-1 text-[16px] font-semibold text-[#1d1d1f]">{value}</p></div>)}
              </div>
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'changed', 'category', 'added', 'removed', 'unchanged'] as const).map(value => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-3 py-1.5 text-[11px] font-medium ${filter === value ? 'bg-[#1d1d1f] text-white' : 'border border-[#d2d2d7] text-[#6e6e73] hover:bg-[#f5f5f7]'}`}>{value === 'all' ? 'All' : value === 'category' ? 'Apple / 3PP differences' : changeLabels[value]}</button>)}
                </div>
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search code, description, or brand" className="h-9 rounded-lg border border-[#d8dee8] px-3 text-[12px] outline-none focus:border-[#5274a8] focus:ring-2 focus:ring-[#5274a8]/15 lg:w-72" />
              </div>
              <div className="overflow-x-auto rounded-xl border border-[#e5e7eb]"><table className="w-full min-w-[900px] text-left text-[12px]"><thead className="bg-[#f8fafc] text-[11px] uppercase tracking-wide text-[#6e6e73]"><tr><th className="px-3 py-2.5">Product code</th><th className="px-3 py-2.5">Description</th><th className="px-3 py-2.5">Brand</th><th className="px-3 py-2.5">Category</th><th className="px-3 py-2.5 text-right">Previous count</th><th className="px-3 py-2.5 text-right">Current count</th><th className="px-3 py-2.5 text-right">Difference</th><th className="px-3 py-2.5">Change</th></tr></thead><tbody>{visibleProducts.map(product => <tr key={product.product_code} className="border-t border-[#eef0f3]"><td className="px-3 py-2 font-mono font-medium text-[#1d1d1f]">{product.product_code}</td><td className="max-w-[260px] truncate px-3 py-2 text-[#3c3c43]">{product.description || '—'}</td><td className="px-3 py-2 text-[#3c3c43]">{product.brand || '—'}</td><td className="px-3 py-2 text-[#3c3c43]">{product.category_changed ? `${product.previous_category || '—'} → ${product.current_category || '—'}` : (product.current_category || product.previous_category || '—')}</td><td className="px-3 py-2 text-right tabular-nums text-[#6e6e73]">{product.previous_count}</td><td className="px-3 py-2 text-right tabular-nums text-[#1d1d1f]">{product.current_count}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${product.difference > 0 ? 'text-[#15803d]' : product.difference < 0 ? 'text-[#b91c1c]' : 'text-[#6e6e73]'}`}>{product.difference > 0 ? `+${product.difference}` : product.difference}</td><td className="px-3 py-2 text-[#6e6e73]">{product.category_changed ? 'Apple / 3PP changed' : changeLabels[product.change]}</td></tr>)}</tbody></table>{visibleProducts.length === 0 && <p className="px-3 py-8 text-center text-[12px] text-[#6e6e73]">No products match this comparison filter.</p>}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

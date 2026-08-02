import { useState, useMemo, useRef, useCallback } from 'react';
import type { ReformatColumn } from '../../lib/api';

interface Props {
  headers: string[];
  columns: ReformatColumn[];
  removedColumns: ReformatColumn[];
  previewRows: string[][];
  onChange: (columns: ReformatColumn[]) => void;
  onRemoveColumn: (index: number) => void;
  onRestoreColumn: (col: ReformatColumn) => void;
  onApply: () => void;
  onSave: () => void;
  savedId: number | null;
  canSave: boolean;
  dirty: boolean;
  fileName: string;
  rowCount: number;
}

export default function MappingPanel({ headers, columns, removedColumns, previewRows, onChange, onRemoveColumn, onRestoreColumn, onApply, onSave, savedId, canSave, dirty, fileName, rowCount }: Props) {
  const [addName, setAddName] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addPos, setAddPos] = useState(columns.length);
  const [showAdd, setShowAdd] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const rowEls = useRef<(HTMLDivElement | null)[]>([]);
  const listEl = useRef<HTMLDivElement>(null);
  const ghostEl = useRef<HTMLDivElement>(null);
  const slotRef = useRef<number | null>(null);

  const previewNames = useMemo(() => {
    const seen = new Map<string, number>();
    return columns.map((c) => {
      const base = c.name.trim() || 'Column';
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });
  }, [columns]);

  function update(index: number, patch: Partial<ReformatColumn>) {
    onChange(columns.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addColumn() {
    if (!addName.trim()) return;
    const col: ReformatColumn = { name: addName.trim(), source: '', constant: addValue };
    const next = [...columns];
    const pos = Math.min(Math.max(addPos, 0), next.length);
    next.splice(pos, 0, col);
    onChange(next);
    setAddName('');
    setAddValue('');
    setAddPos(next.length);
    setShowAdd(false);
  }

  const computeSlot = useCallback((clientY: number): number => {
    const rows = rowEls.current.filter(Boolean) as HTMLDivElement[];
    if (rows.length === 0) return 0;
    for (let k = 0; k < rows.length; k++) {
      const rect = rows[k].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return k;
    }
    return rows.length;
  }, []);

  function startDrag(e: React.MouseEvent, i: number) {
    e.preventDefault();
    if (e.button !== 0) return;
    setDragIdx(i);
    setOverSlot(i);
    slotRef.current = i;

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const slot = computeSlot(ev.clientY);
      slotRef.current = slot;
      setOverSlot(slot);
      if (ghostEl.current) {
        ghostEl.current.style.transform = `translate(${ev.clientX + 14}px, ${ev.clientY + 10}px)`;
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const from = i;
      const slot = slotRef.current;
      setDragIdx(null);
      setOverSlot(null);
      slotRef.current = null;
      if (slot === null) return;
      let insertAt = slot;
      if (from < insertAt) insertAt -= 1;
      insertAt = Math.min(Math.max(insertAt, 0), columns.length);
      if (insertAt === from || insertAt === from + 1) return;
      const next = [...columns];
      const [moved] = next.splice(from, 1);
      next.splice(insertAt, 0, moved);
      onChange(next);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const dragging = dragIdx !== null;
  const unmatched = columns.filter((c) => c.source && !headers.includes(c.source)).map((c) => c.name);
  const dragged = dragIdx !== null ? columns[dragIdx] : null;

  return (
    <div className="bg-white rounded-xl border border-[#d2d2d7] p-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[16px] font-semibold text-[#1d1d1f]">Step 2 — Arrange the output columns</h2>
        <span className="text-[12px] text-[#9ca3af]">{fileName}</span>
      </div>
      <p className="text-[13px] text-[#6e6e73] mb-5">
        Drag a column's grip <span className="text-[#2563eb]">⋮⋮</span> and drop it on the blue line at the exact position. Or use the arrows. Each column takes its values from a source column and can be renamed. {rowCount} data rows will be transformed.
      </p>

      {unmatched.length > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fffbeb] border border-[#fde68a] text-[13px] text-[#b45309]">
          These output columns don't match any column in the current file (values will be blank): {unmatched.join(', ')}
        </div>
      )}

      <div
        ref={listEl}
        className={`border border-[#d2d2d7] rounded-xl overflow-hidden mb-4 ${dragging ? 'select-none' : ''}`}
      >
        <div className="grid grid-cols-[30px_30px_1fr_1.1fr_120px_96px] gap-2 items-center px-3 py-2 bg-[#f5f5f7] text-[11px] font-medium uppercase tracking-wider text-[#6e6e73]">
          <span className="col-span-2">Position</span>
          <span>Output name</span>
          <span>Source column</span>
          <span>Constant value</span>
          <span className="text-right">Actions</span>
        </div>
        {columns.length === 0 && (
          <p className="px-4 py-6 text-[13px] text-[#9ca3af] text-center">
            No output columns yet. Use &ldquo;Add column&rdquo; below to start building the arrangement.
          </p>
        )}
        {columns.map((col, i) => {
          const isDragging = dragging && dragIdx === i;
          const showLineAbove = dragging && overSlot === i;
          return (
            <div
              key={i}
              ref={(el) => { rowEls.current[i] = el; }}
              className={`relative grid grid-cols-[30px_30px_1fr_1.1fr_120px_96px] gap-2 items-center px-3 py-2 bg-white ${
                isDragging ? 'opacity-30' : ''
              }`}
            >
              {showLineAbove && !isDragging && (
                <div className="absolute -top-[3px] left-0 right-0 z-10 h-[3px] bg-[#2563eb] rounded" />
              )}
              <span className="text-[12px] text-[#9ca3af]">{i + 1}</span>
              <span
                onMouseDown={(e) => startDrag(e, i)}
                title={`Drag to reorder — currently position ${i + 1} of ${columns.length}`}
                className={`flex items-center justify-center rounded cursor-grab active:cursor-grabbing select-none text-[#c7c7cc] hover:text-[#2563eb] hover:bg-[#f5f5f7] transition-colors py-1.5`}
              >
                <svg width="12" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.8" /><circle cx="15" cy="5" r="1.8" /><circle cx="9" cy="12" r="1.8" /><circle cx="15" cy="12" r="1.8" /><circle cx="9" cy="19" r="1.8" /><circle cx="15" cy="19" r="1.8" /></svg>
              </span>
              <input
                value={col.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Output column name"
                className="w-full px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb]"
              />
              <select
                value={col.source}
                onChange={(e) => update(i, { source: e.target.value })}
                className={`w-full px-2 py-1.5 border rounded-lg text-[13px] bg-white focus:outline-none ${
                  col.source && !headers.includes(col.source) ? 'border-[#f59e0b] text-[#b45309]' : 'border-[#d2d2d7] focus:border-[#2563eb]'
                }`}
              >
                <option value="">— Custom value —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <input
                value={col.source ? '' : col.constant}
                onChange={(e) => update(i, { constant: e.target.value })}
                disabled={!!col.source}
                placeholder={col.source ? '—' : 'e.g. N/A'}
                className="w-full px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb] disabled:bg-[#f5f5f7] disabled:text-[#c7c7cc]"
              />
              <div className="flex items-center justify-end gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="p-1 text-[#6e6e73] hover:text-[#2563eb] disabled:opacity-30 cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
                </button>
                <button onClick={() => move(i, 1)} disabled={i === columns.length - 1} title="Move down" className="p-1 text-[#6e6e73] hover:text-[#2563eb] disabled:opacity-30 cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                <button onClick={() => onRemoveColumn(i)} title="Remove column (can add it back below)" className="p-1 text-[#6e6e73] hover:text-[#dc2626] cursor-pointer">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
          );
        })}
        {dragging && (
          <div className={`relative h-0.5 bg-transparent ${overSlot === columns.length ? 'bg-[#2563eb]' : ''}`}>
            {overSlot === columns.length && (
              <span className="absolute -top-2 right-3 text-[11px] font-medium text-[#2563eb] bg-[#eff6ff] border border-[#2563eb]/40 rounded px-1.5 py-0.5">
                Position {columns.length + 1} of {columns.length + 1} (end)
              </span>
            )}
          </div>
        )}
      </div>

      {dragging && dragged && (
        <div
          ref={ghostEl}
          className="fixed left-0 top-0 z-50 pointer-events-none flex items-center gap-2 bg-white border border-[#2563eb] rounded-lg shadow-xl px-3 py-2 min-w-[200px]"
          style={{ transform: 'translate(-9999px, -9999px)' }}
        >
          <span className="text-[#2563eb] text-[12px]">
            <svg width="12" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.8" /><circle cx="15" cy="5" r="1.8" /><circle cx="9" cy="12" r="1.8" /><circle cx="15" cy="12" r="1.8" /><circle cx="9" cy="19" r="1.8" /><circle cx="15" cy="19" r="1.8" /></svg>
          </span>
          <span className="text-[13px] font-medium text-[#1d1d1f] max-w-[180px] truncate">
            {dragged.name || '(unnamed column)'}
          </span>
          <span className="text-[11px] text-[#9ca3af] max-w-[140px] truncate">{dragged.source || 'custom value'}</span>
          <span className="ml-2 text-[11px] font-semibold text-[#2563eb] whitespace-nowrap">
            → Position {overSlot !== null ? overSlot + 1 : '?'} of {columns.length + 1}
          </span>
        </div>
      )}

      {showAdd ? (
        <div className="border border-[#2563eb] rounded-xl p-4 mb-4 bg-[#eff6ff]">
          <p className="text-[13px] font-medium text-[#1d1d1f] mb-3">Add a new column</p>
          <div className="grid grid-cols-[150px_1fr_1fr_auto] gap-3 items-end">
            <div>
              <label className="text-[11px] font-medium text-[#6e6e73] block mb-1">Insert at position</label>
              <select
                value={addPos}
                onChange={(e) => setAddPos(parseInt(e.target.value))}
                className="w-full px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white"
              >
                <option value={0}>Beginning (position 1)</option>
                {columns.map((c, i) => (
                  <option key={i} value={i + 1}>After &ldquo;{c.name || `#${i + 1}`}&rdquo; (position {i + 2})</option>
                ))}
                <option value={columns.length}>At the end (position {columns.length + 1})</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#6e6e73] block mb-1">Column name</label>
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                placeholder="e.g. Status"
                className="w-full px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb]"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#6e6e73] block mb-1">Value for every row</label>
              <input
                value={addValue}
                onChange={(e) => setAddValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addColumn()}
                placeholder="e.g. Done"
                className="w-full px-2 py-1.5 border border-[#d2d2d7] rounded-lg text-[13px] bg-white focus:outline-none focus:border-[#2563eb]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addColumn}
                disabled={!addName.trim()}
                className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 cursor-pointer"
              >
                Add
              </button>
              <button
                onClick={() => setShowAdd(false)}
                className="px-3 py-1.5 text-[12px] text-[#6e6e73] border border-[#d2d2d7] rounded-lg hover:bg-[#f5f5f7] cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setShowAdd(true); setAddPos(columns.length); }}
          className="mb-4 px-3 py-1.5 text-[12px] font-medium text-[#2563eb] border border-[#2563eb]/40 rounded-lg hover:bg-[#eff6ff] transition-colors cursor-pointer"
        >
          + Add a column
        </button>
      )}

      {removedColumns.length > 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca]">
          <p className="text-[12px] font-medium text-[#b91c1c] mb-2">
            Removed columns — click &ldquo;Add back&rdquo; to restore one (it will be added at the end, then drag it into position)
          </p>
          <div className="flex flex-wrap gap-2">
            {removedColumns.map((col, i) => (
              <span key={i} className="flex items-center gap-1.5 border border-[#fecaca] bg-white rounded-lg px-2 py-1">
                <span className="text-[12px] font-medium text-[#1d1d1f] max-w-[160px] truncate">{col.name || '(unnamed column)'}</span>
                <span className="text-[11px] text-[#9ca3af] max-w-[120px] truncate">
                  {col.source ? col.source : col.constant ? `value: ${col.constant}` : 'custom value'}
                </span>
                <button
                  onClick={() => onRestoreColumn(col)}
                  className="ml-1 px-2 py-0.5 text-[11px] font-medium text-white bg-[#2563eb] rounded-md hover:bg-[#1d4ed8] cursor-pointer"
                >
                  Add back
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {previewRows.length > 0 && (
        <div className="mb-5 overflow-hidden rounded-lg border border-[#d2d2d7]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#d2d2d7] bg-[#f5f5f7] text-[11px] font-medium uppercase tracking-wider text-[#6e6e73]">
            <span>Live data preview</span>
            <span className="font-normal normal-case">updates as you arrange &middot; first {previewRows.length} of {rowCount} rows</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="border-b border-[#d2d2d7] text-[#2563eb]">
                <tr>
                  {previewNames.map((h, i) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                      <span className="text-[#9ca3af] mr-1">{i + 1}.</span>{h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => (
                  <tr key={r} className="border-b border-[#d2d2d7]/60 last:border-0">
                    {row.map((cell, c) => (
                      <td key={c} className="max-w-[160px] truncate px-3 py-2 text-[#1d1d1f]">{cell || '\u2014'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onApply}
          disabled={columns.length === 0}
          className="px-4 py-2 text-[13px] font-medium text-white bg-[#2563eb] rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-colors cursor-pointer"
        >
          Apply & show result
        </button>
        {canSave && (savedId === null || dirty) && (
          <button
            onClick={onSave}
            disabled={savedId === null && columns.length === 0}
            className="px-4 py-2 text-[13px] font-medium text-white bg-[#16a34a] rounded-lg hover:bg-[#15803d] disabled:opacity-50 transition-colors cursor-pointer"
          >
            {savedId === null ? 'Save template' : 'Update saved template'}
          </button>
        )}
        {!canSave && (
          <span className="text-[12px] text-[#9ca3af]">This is a shared template — save it as your own copy from the result screen.</span>
        )}
      </div>
    </div>
  );
}

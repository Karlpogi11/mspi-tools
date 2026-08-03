import { useState, useEffect, useMemo, useRef, Fragment, type ChangeEvent, type ReactNode } from 'react';
import { api, type ConsumableMaster } from '../../lib/api';
import {
  parseReceivingWorkbook,
  productionDateFromCode,
  expiryDateFromProduction,
  masterLookup,
  buildLabels,
  uid,
  type ConsumableEntry,
} from '../../lib/consumables';

const emptyEntry = (): ConsumableEntry => ({
  key: uid(),
  partNumber: '',
  code: '',
  dateReceived: '',
  qty: 1,
});

const inputCls =
  'w-full px-2.5 py-1.5 text-[13px] border border-[#d2d2d7] rounded-lg focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] bg-white text-[#1d1d1f] placeholder:text-[#a1a1a6]';
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
const iconDownload = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const iconPrinter = (
  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

function AutoValue({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <div className="min-h-[36px] flex items-center">
      {children || <span className={muted ? 'text-[#c7c7cc]' : 'text-[#a1a1a6]'}>{'\u2014'}</span>}
    </div>
  );
}

export default function ConsumablesPage() {
  const [entries, setEntries] = useState<ConsumableEntry[]>([emptyEntry()]);
  const [master, setMaster] = useState<ConsumableMaster[]>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addDesc, setAddDesc] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const partRefs = useRef(new Map<string, HTMLInputElement | null>());

  function focusNextRow(key: string) {
    const idx = entries.findIndex((e) => e.key === key);
    if (idx === -1) return;
    if (idx === entries.length - 1) {
      const next = emptyEntry();
      setEntries((list) => [...list, next]);
      setTimeout(() => partRefs.current.get(next.key)?.focus(), 0);
    } else {
      partRefs.current.get(entries[idx + 1].key)?.focus();
    }
  }

  function moveNextOnEnter(e: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      focusNextRow(key);
    }
  }

  function moveNextOnEnterOrTab(e: React.KeyboardEvent<HTMLInputElement>, key: string) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      focusNextRow(key);
    }
  }

  function loadMaster() {
    api.consumables
      .listMaster()
      .then(setMaster)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load parts list'));
  }

  useEffect(() => {
    loadMaster();
  }, []);

  const derived = useMemo(
    () =>
      entries.map((e) => {
        const part = masterLookup(e.partNumber, master);
        const production = productionDateFromCode(e.code);
        const expiry = expiryDateFromProduction(production, part);
        return { entry: e, part, production, expiry };
      }),
    [entries, master]
  );

  const labels = useMemo(() => buildLabels(entries, master), [entries, master]);
  const labelCount = labels.length;

  function updateEntry(key: string, patch: Partial<ConsumableEntry>) {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function removeEntry(key: string) {
    setEntries((list) => (list.length === 1 ? [emptyEntry()] : list.filter((e) => e.key !== key)));
  }

  function addEntry() {
    setEntries((list) => [...list, emptyEntry()]);
  }

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { rows } = await parseReceivingWorkbook(buf);
      if (rows.length === 0) {
        setError('No entries found in ' + file.name + '. Use the exported template.');
        return;
      }
      setEntries(
        rows.map((r) => ({
          key: uid(),
          partNumber: r.partNumber,
          code: r.code,
          dateReceived: r.dateReceived,
          qty: r.qty,
        }))
      );
      setNotice(`Imported ${rows.length} row${rows.length === 1 ? '' : 's'} from ${file.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import file');
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setError('');
    setBusy(true);
    try {
      await api.consumables.exportLabels(labels);
      setNotice(`Downloaded ${labelCount} label${labelCount === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build labels file');
    } finally {
      setBusy(false);
    }
  }

  function startAdd(entry: ConsumableEntry) {
    setAddingKey(entry.key);
    setAddDesc(entry.partNumber ? '' : '');
    setError('');
  }

  async function saveAdd(entry: ConsumableEntry) {
    const partNumber = entry.partNumber.trim();
    const description = addDesc.trim();
    if (!partNumber || !description) {
      setError('Part Number and Description are required to add a part.');
      return;
    }
    setBusy(true);
    try {
      await api.consumables.createMaster({
        part_number: partNumber,
        description,
        category: 'Other',
        expires: 'Y',
        unit: 'pcs',
      });
      await loadMaster();
      setAddingKey(null);
      setNotice(`Added "${partNumber}" to the parts list`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add part');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[26px] font-semibold text-[#1d1d1f] tracking-tight">Label Maker</h1>
          <p className="text-[14px] text-[#6e6e73] mt-1">
            Add received consumables and print expiry labels. Production date auto-computes from the 9D code.
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

      <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden">
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#d2d2d7]/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-1.5 rounded-lg bg-[#f5f5f7] text-[#6e6e73] shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            </span>
            <span className="text-[13px] font-medium text-[#1d1d1f]">Received items</span>
            <span className="text-[12px] text-[#9ca3af] whitespace-nowrap">
              {entries.length} rows &middot; {master.length.toLocaleString()} parts on file
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleImport}
            />
            <button
              onClick={() => importRef.current?.click()}
              disabled={busy}
              className={secondaryBtnCls}
            >
              {iconUpload}
              Import file
            </button>
            <button
              onClick={() =>
                api.consumables
                  .downloadTemplate()
                  .catch((err) => setError(err instanceof Error ? err.message : 'Download failed'))
              }
              className={secondaryBtnCls}
            >
              {iconDownload}
              Download template
            </button>
            <button onClick={handleExport} disabled={busy || labelCount === 0} className={primaryBtnCls}>
              {iconPrinter}
              {busy ? 'Building\u2026' : `Download labels (${labelCount})`}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: '900px' }}>
            <thead>
              <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider w-48">Part Number</th>
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider w-40">9D Code</th>
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider">
                  Description <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider w-28">Qty Arrived</th>
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider w-44">
                  Production Date <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-4 py-3 text-left font-medium text-[#6e6e73] text-[12px] uppercase tracking-wider w-44">
                  Expiry Date <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-2 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {derived.map(({ entry, part, production, expiry }) => {
                const notFound = !!entry.partNumber.trim() && !part;
                const isAdding = addingKey === entry.key;
                return (
                  <Fragment key={entry.key}>
                    <tr className="border-b border-[#d2d2d7]/60">
                      <td className="px-4 py-2">
                        <input
                          ref={(el) => {
                            partRefs.current.set(entry.key, el);
                          }}
                          className={inputCls}
                          value={entry.partNumber}
                          onChange={(e) => updateEntry(entry.key, { partNumber: e.target.value })}
                          placeholder="e.g. 923-12051"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className={inputCls}
                          value={entry.code}
                          onChange={(e) => updateEntry(entry.key, { code: e.target.value })}
                          onKeyDown={(e) => moveNextOnEnterOrTab(e, entry.key)}
                          placeholder="9D code"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <AutoValue>
                          {part ? (
                            <span className="text-[#1d1d1f]">{part.description}</span>
                          ) : notFound ? (
                            <button
                              onClick={() => startAdd(entry)}
                              className="text-[12px] font-medium text-[#2563eb] hover:bg-[#eff6ff] px-2 py-1 -mx-2 rounded-lg transition-colors cursor-pointer"
                            >
                              + Add to parts list
                            </button>
                          ) : null}
                        </AutoValue>
                      </td>
                      <td className="px-4 py-2 w-28">
                        <input
                          className={inputCls + ' text-right'}
                          type="number"
                          min={1}
                          value={entry.qty}
                          onChange={(e) => updateEntry(entry.key, { qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                          onKeyDown={(e) => moveNextOnEnter(e, entry.key)}
                        />
                      </td>
                      <td className="px-4 py-2">
  <AutoValue muted={!production}>{production || null}</AutoValue>
</td>
<td className="px-4 py-2">
  <AutoValue muted={!expiry}>{expiry || null}</AutoValue>
</td>
                      <td className="px-2 py-2 text-center">
                        <button
                          onClick={() => removeEntry(entry.key)}
                          className="p-1.5 rounded-lg text-[#a1a1a6] hover:text-[#dc2626] hover:bg-[#fef2f2] transition-colors cursor-pointer"
                          title="Remove row"
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                    {isAdding && (
                      <tr className="border-b border-[#d2d2d7]/60 bg-[#fafafa]">
                        <td colSpan={7} className="px-5 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-medium text-[#1d1d1f] whitespace-nowrap">{entry.partNumber.trim()}</span>
                            <input
                              className={inputCls + ' max-w-md flex-1'}
                              placeholder="Description for this part"
                              value={addDesc}
                              autoFocus
                              onChange={(e) => setAddDesc(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveAdd(entry);
                              }}
                            />
                            <button
                              onClick={() => saveAdd(entry)}
                              disabled={busy}
                              className="px-4 py-2 text-[13px] font-semibold text-white rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors cursor-pointer"
                            >
                              {busy ? 'Saving...' : 'Add part'}
                            </button>
                            <button
                              onClick={() => setAddingKey(null)}
                              className="px-4 py-2 text-[13px] font-medium border border-[#d2d2d7] rounded-lg text-[#6e6e73] hover:text-[#1d1d1f] transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-[#d2d2d7]/60 flex items-center justify-between gap-3">
          <button
            onClick={addEntry}
            className="px-2.5 py-1 text-[12px] font-medium text-[#2563eb] hover:bg-[#eff6ff] rounded-lg transition-colors cursor-pointer"
          >
            + Add row
          </button>
          {labelCount > 0 && (
            <span className="text-[12px] text-[#9ca3af]">
              {labelCount} label{labelCount === 1 ? '' : 's'} ready to print &middot; {Math.max(1, Math.ceil(labelCount / 30))} sheet
              {Math.ceil(labelCount / 30) === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#d2d2d7] mt-4 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#d2d2d7]/60">
          <h2 className="text-[13px] font-medium text-[#1d1d1f]">Print preview</h2>
        </div>
        <div className="p-4 overflow-x-auto">
          {labelCount === 0 ? (
            <p className="text-[13px] text-[#9ca3af] text-center py-8">
              Fill in the received items above to build your label sheet preview.
            </p>
          ) : (
            <div className="mx-auto max-w-3xl bg-white outline outline-1 outline-[#d2d2d7] rounded-lg">
              <div className="px-4 pt-3 pb-2 text-center border-b border-[#d2d2d7]">
                <p className="text-[13px] font-bold text-[#1d1d1f] tracking-wide">PRINT LABELS - CUT ALONG BORDERS</p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5">
                  One label per unit. Cut along the borders and stick on each consumable item.
                </p>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-3 gap-1">
                  {labels.map((label, i) => (
                    <div
                      key={i}
                      className="border border-[#1d1d1f] px-2.5 py-2 flex items-center justify-center text-center"
                      style={{ minHeight: '34px' }}
                    >
                      <div className="leading-tight">
                        <div className="text-[11px] font-bold text-[#1d1d1f] break-words">{label.line1}</div>
                        {label.line2 && <div className="text-[10px] text-[#6e6e73] mt-0.5">{label.line2}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
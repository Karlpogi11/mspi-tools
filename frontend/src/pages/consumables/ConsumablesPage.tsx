import { useState, useEffect, useMemo, useRef, Fragment, type ChangeEvent, type ReactNode } from 'react';
import { api, saveBlob, type ConsumableMaster } from '../../lib/api';
import {
  parseReceivingWorkbook,
  productionDateFromCode,
  expiryDateFromProduction,
  masterLookup,
  buildLabels,
  buildInventoryCsv,
  todayIso,
  uid,
  type ConsumableEntry,
  type InventoryRow,
} from '../../lib/consumables';

const emptyEntry = (): ConsumableEntry => ({
  key: uid(),
  partNumber: '',
  code: '',
  dateReceived: '',
  qty: 1,
});

const STORAGE_KEY = 'consumables.labelDraft.v1';

function loadDraft(): ConsumableEntry[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(
      (e): e is ConsumableEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof e.key === 'string' &&
        typeof e.partNumber === 'string' &&
        typeof e.code === 'string' &&
        typeof e.dateReceived === 'string' &&
        typeof e.qty === 'number'
    );
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

function saveDraft(entries: ConsumableEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage full/unavailable - ignore, entries still live in memory
  }
}

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
  const restoredRef = useRef(0);
  const entriesRef = useRef<ConsumableEntry[]>([]);
  const [entries, setEntries] = useState<ConsumableEntry[]>(() => {
    const draft = loadDraft();
    restoredRef.current = draft?.length ?? 0;
    return draft ?? [emptyEntry()];
  });
  const [master, setMaster] = useState<ConsumableMaster[]>([]);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [addDesc, setAddDesc] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasContent, setHasContent] = useState(false);
  const [inventoryMenu, setInventoryMenu] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const busyRef = useRef(false);
  const inventoryMenuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (restoredRef.current > 0) {
      const msg = `Restored ${restoredRef.current} row${restoredRef.current === 1 ? '' : 's'} from your saved draft`;
      setNotice(msg);
      const t = setTimeout(() => {
        setNotice((cur) => (cur === msg ? '' : cur));
      }, 4000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    entriesRef.current = entries;
    const content = entries.some((e) => e.partNumber.trim() || e.code.trim());
    setHasContent(content);
    if (!content) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      return;
    }
    const t = setTimeout(() => {
      saveDraft(entries);
    }, 400);
    return () => clearTimeout(t);
  }, [entries]);

  useEffect(() => {
    function flush() {
      if (entriesRef.current.some((e) => e.partNumber.trim() || e.code.trim())) {
        saveDraft(entriesRef.current);
      }
    }
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  useEffect(() => {
    if (!inventoryMenu) return;
    function onDocClick(e: MouseEvent) {
      if (inventoryMenuRef.current && !inventoryMenuRef.current.contains(e.target as Node)) {
        setInventoryMenu(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [inventoryMenu]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    };
  }, []);

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes('Files')) return;
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
      const file = e.dataTransfer?.files?.[0];
      if (file) void importFile(file);
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

  const inventoryRows = useMemo<InventoryRow[]>(
    () =>
      derived
        .filter(({ entry }) => entry.partNumber.trim() || entry.code.trim())
        .map(({ entry, part, production, expiry }) => ({
          partNumber: entry.partNumber.trim(),
          code: entry.code.trim(),
          description: part?.description ?? '',
          dateReceived: entry.dateReceived || todayIso(),
          qty: Math.max(1, Math.floor(Number(entry.qty)) || 1),
          productionDate: production,
          expiryDate: expiry,
        })),
    [derived]
  );

  function updateEntry(key: string, patch: Partial<ConsumableEntry>) {
    setEntries((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  }

  function removeEntry(key: string) {
    setEntries((list) => (list.length === 1 ? [emptyEntry()] : list.filter((e) => e.key !== key)));
  }

  function addEntry() {
    setEntries((list) => [...list, emptyEntry()]);
  }

  function clearDraft() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setEntries([emptyEntry()]);
    setNotice('Draft cleared. New scans will autosave to this browser.');
  }

  function onResetClick() {
    if (!confirmReset) {
      setConfirmReset(true);
      confirmTimerRef.current = window.setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmReset(false);
    clearDraft();
  }

  async function importFile(file: File) {
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xls') && !name.endsWith('.csv')) {
      setError('Unsupported file type. Drop a .xlsx, .xls, or .csv receiving file.');
      return;
    }
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

  async function handleImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importFile(file);
  }

  function handlePrint() {
    if (labelCount === 0) return;
    window.print();
  }

  async function handleExportInventory(format: 'xlsx' | 'csv') {
    if (inventoryRows.length === 0) {
      setError('No entries to download. Scan or enter at least one part first.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (format === 'csv') {
        const blob = new Blob([buildInventoryCsv(inventoryRows)], { type: 'text/csv;charset=utf-8' });
        await saveBlob(blob, 'consumable-inventory.csv');
      } else {
        await api.consumables.exportInventory(inventoryRows);
      }
      setNotice(`Downloaded inventory (${inventoryRows.length} row${inventoryRows.length === 1 ? '' : 's'})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download inventory');
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
      <div className="flex items-start justify-between gap-4 mb-6 print:hidden">
        <div>
          <h1 className="text-[20px] font-semibold text-[#1d1d1f] tracking-tight">Label Maker</h1>
          <p className="text-[12px] text-[#6e6e73] mt-0.5">
            Add received consumables and print expiry labels. &middot; Drag &amp; drop a file anywhere on this page to import.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
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
          <div className="w-px h-6 bg-[#d2d2d7] mx-1 hidden sm:block" aria-hidden />
          <div className="relative" ref={inventoryMenuRef}>
            <button
              onClick={() => setInventoryMenu((v) => !v)}
              disabled={busy || inventoryRows.length === 0}
              className={secondaryBtnCls}
            >
              {iconDownload}
              Download inventory
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {inventoryMenu && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-white rounded-xl border border-[#d2d2d7] shadow-lg py-1 min-w-[160px]">
                <button
                  onClick={() => {
                    setInventoryMenu(false);
                    handleExportInventory('xlsx');
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer"
                >
                  Excel (.xlsx)
                </button>
                <button
                  onClick={() => {
                    setInventoryMenu(false);
                    handleExportInventory('csv');
                  }}
                  className="w-full text-left px-3 py-2 text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer"
                >
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>
          <button onClick={handlePrint} disabled={busy || labelCount === 0} className={primaryBtnCls}>
            {iconPrinter}
            Print labels ({labelCount})
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626] flex items-start justify-between gap-3 print:hidden">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-[#dc2626] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}
      {notice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-[#ecfdf5] border border-[#a7f3d0] text-[13px] text-[#047857] flex items-start justify-between gap-3 print:hidden">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-[#047857] hover:opacity-70 cursor-pointer text-[15px] leading-none">×</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden print:hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: '760px' }}>
            <thead>
              <tr className="bg-[#f5f5f7] border-b border-[#d2d2d7]">
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide w-40">Part Number</th>
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide w-28">9D Code</th>
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide">
                  Description <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide w-24">Qty Arrived</th>
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide w-32">
                  Production Date <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-2.5 py-1 text-left font-semibold text-[#6e6e73] text-[11px] uppercase tracking-wide w-32">
                  Expiry Date <span className="font-normal normal-case text-[#a1a1a6]">(auto)</span>
                </th>
                <th className="px-1 py-1 w-8" />
              </tr>
            </thead>
            <tbody>
              {derived.map(({ entry, part, production, expiry }) => {
                const notFound = !!entry.partNumber.trim() && !part;
                const isAdding = addingKey === entry.key;
                return (
                  <Fragment key={entry.key}>
                    <tr className="border-b border-[#d2d2d7]/60">
                      <td className="px-3 py-1.5">
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
                      <td className="px-3 py-1.5">
                        <input
                          className={inputCls}
                          value={entry.code}
                          onChange={(e) => updateEntry(entry.key, { code: e.target.value })}
                          onKeyDown={(e) => moveNextOnEnterOrTab(e, entry.key)}
                          placeholder="9D code"
                        />
                      </td>
                      <td className="px-3 py-1.5">
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
                      <td className="px-3 py-1.5 w-20">
                        <input
                          className={inputCls + ' text-right'}
                          type="number"
                          min={1}
                          value={entry.qty}
                          onChange={(e) => updateEntry(entry.key, { qty: Math.max(1, Math.floor(Number(e.target.value)) || 1) })}
                          onKeyDown={(e) => moveNextOnEnter(e, entry.key)}
                        />
                      </td>
                      <td className="px-3 py-1.5">
  <AutoValue muted={!production}>{production || null}</AutoValue>
</td>
<td className="px-3 py-1.5">
  <AutoValue muted={!expiry}>{expiry || null}</AutoValue>
</td>
                      <td className="px-2 py-1.5 text-center">
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
      </div>

      <div className="flex items-center justify-between gap-3 mt-2 mb-4 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={addEntry}
            className="px-2.5 py-1 text-[12px] font-medium text-[#2563eb] hover:bg-[#eff6ff] rounded-lg transition-colors cursor-pointer"
          >
            + Add row
          </button>
          {hasContent && !confirmReset && (
            <button
              onClick={onResetClick}
              className="text-[12px] text-[#9ca3af] hover:text-[#dc2626] hover:bg-[#fef2f2] px-1.5 py-0.5 -mx-1.5 rounded transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
          {confirmReset && (
            <span className="flex items-center gap-1.5 text-[12px] text-[#dc2626]">
              Reset all scanned rows?
              <button
                onClick={onResetClick}
                className="font-semibold hover:bg-[#fef2f2] px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                Confirm
              </button>
              <button
                onClick={() => {
                  if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
                  confirmTimerRef.current = null;
                  setConfirmReset(false);
                }}
                className="text-[#9ca3af] hover:text-[#1d1d1f] px-1.5 py-0.5 -mx-1.5 rounded transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
        {labelCount > 0 && (
          <span className="text-[12px] text-[#9ca3af]">
            {labelCount} label{labelCount === 1 ? '' : 's'} ready to print &middot; {Math.max(1, Math.ceil(labelCount / 30))} sheet
            {Math.ceil(labelCount / 30) === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[#d2d2d7] overflow-hidden print:border-0 print:rounded-none print:shadow-none print:overflow-visible">
        <div className="px-4 py-2 border-b border-[#d2d2d7]/60 print:hidden">
          <h2 className="text-[13px] font-medium text-[#1d1d1f]">Print preview</h2>
        </div>
        <div className="p-3 overflow-x-auto print:p-0 print:overflow-visible">
          {labelCount === 0 ? (
            <p className="text-[13px] text-[#9ca3af] text-center py-8">
              Fill in the received items above to build your label sheet preview.
            </p>
          ) : (
            <div className="mx-auto max-w-3xl bg-white outline outline-1 outline-[#d2d2d7] rounded-lg print:max-w-none print:outline-0 print:rounded-none">
              <div className="px-4 pt-3 pb-2 text-center border-b border-[#d2d2d7] print:border-0">
                <p className="text-[13px] font-bold text-[#1d1d1f] tracking-wide">PRINT LABELS - CUT ALONG BORDERS</p>
                <p className="text-[11px] text-[#9ca3af] mt-0.5 print:hidden">
                  One label per unit. Cut along the borders and stick on each consumable item.
                </p>
              </div>
              <div className="p-3 print:p-0">
                <div className="grid grid-cols-3 gap-1">
                  {labels.map((label, i) => (
                    <div
                      key={i}
                      className="relative border border-[#1d1d1f] px-2.5 py-2 flex items-center justify-center text-center"
                      style={{ minHeight: '34px' }}
                    >
                      <span className="absolute top-0.5 left-1 text-[8px] font-bold text-[#6e6e73] leading-none">
                        {i + 1}
                      </span>
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

      {dragActive && (
        <div className="fixed inset-0 z-50 bg-[#2563eb]/10 border-4 border-dashed border-[#2563eb] rounded-2xl flex items-center justify-center pointer-events-none">
          <div className="bg-white rounded-xl shadow-xl px-8 py-6 text-center">
            <p className="text-[15px] font-semibold text-[#1d1d1f]">Drop to import receiving file</p>
            <p className="text-[12px] text-[#6e6e73] mt-1">.xlsx, .xls, or .csv</p>
          </div>
        </div>
      )}
    </div>
  );
}
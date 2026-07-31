import { useState, useRef, useEffect, useCallback } from 'react';
import { type ScanResult, readJson } from '../../lib/api';

interface Props {
  sessionId: number;
  onScanned: (result: ScanResult) => void;
  onScanQueued?: (code: string) => void;
  onScanFailed?: (code: string) => void;
}

function playTing() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 1567.98;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch {}
}

function playBuzz() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 180;
    osc.type = 'sawtooth';
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

export default function ScanBar({ sessionId, onScanned, onScanQueued, onScanFailed }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [overscan, setOverscan] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout>>();
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest) return;
      if (inputRef.current === target || inputRef.current?.contains(target)) return;
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target.closest('[role="dialog"], .fixed.inset-0')) return;
      const active = document.activeElement;
      if (active && active !== inputRef.current && active !== document.body &&
          (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) {
        return;
      }
      inputRef.current?.focus();
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    setSyncing(true);

    while (queueRef.current.length > 0) {
      const code = queueRef.current.shift()!;
      setPendingCount(queueRef.current.length);

      try {
        const res = await fetch(`/api/pcount/sessions/${sessionId}/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ product_code: code }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error || 'Product not found');
          onScanFailed?.(code);
          continue;
        }

        const result: ScanResult = await readJson(res);
        const isOverscan = result.system_qty > 0 && result.counted_qty > result.system_qty;
        if (result.match) playTing();
        if (isOverscan) {
          playBuzz();
          setOverscan(true);
          setTimeout(() => setOverscan(false), 600);
        }
        onScanned(result);
      } catch {
        setError('Scan failed');
        onScanFailed?.(code);
      }
    }

    processingRef.current = false;
    setPendingCount(0);
    setSyncing(false);
  }, [onScanFailed, onScanned, sessionId]);

  const enqueueScan = useCallback((code: string) => {
    const normalizedCode = code.trim();
    if (!normalizedCode) return;
    setError('');
    onScanQueued?.(normalizedCode);
    queueRef.current.push(normalizedCode);
    setPendingCount(queueRef.current.length);
    void processQueue();
  }, [onScanQueued, processQueue]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    if (scanTimer.current) clearTimeout(scanTimer.current);
    enqueueScan(code);
    setValue('');
    inputRef.current?.focus();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setValue(val);
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = setTimeout(() => {
      if (val.trim().length > 0) {
        enqueueScan(val.trim());
        setValue('');
      }
    }, 120);
  }

  useEffect(() => () => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
  }, []);

  return (
    <div className={`bg-white rounded-xl border shadow-sm p-3 transition-colors duration-200 ${
      overscan ? 'border-[#dc2626] ring-2 ring-[#dc2626]/30' : 'border-[#d2d2d7]'
    }`}>
      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <label className="text-[13px] font-medium text-[#6e6e73] whitespace-nowrap">Scan</label>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="Scan or type barcode..."
            className="w-full px-3 py-2 border border-[#d2d2d7] rounded-lg text-[14px] font-mono bg-[#f5f5f7] focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] focus:bg-white transition-colors"
            autoComplete="off"
            autoFocus
          />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-[#6e6e73] whitespace-nowrap">
          {syncing && pendingCount > 0 && <span className="text-[#a16207]">{pendingCount} queued</span>}
          {syncing && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 bg-[#2563eb] rounded-full animate-pulse" />saving</span>}
        </div>
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-4 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors cursor-pointer"
        >
          Enter
        </button>
      </form>
      {error && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[12px] text-[#dc2626]">
          {error}
        </div>
      )}
    </div>
  );
}

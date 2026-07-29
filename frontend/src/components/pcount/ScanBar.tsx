import { useState, useRef, useEffect, useCallback } from 'react';
import { type ScanResult } from '../../lib/api';

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

        const result: ScanResult = await res.json();
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
    <div className={`bg-white rounded-xl border shadow-sm p-2.5 transition-colors duration-200 ${
      overscan ? 'border-[#dc2626] ring-2 ring-[#dc2626]/30' : 'border-[#d2d2d7]'
    }`}>
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <div className="flex-1 relative">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6e6e73]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
              <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
              <rect x="7" y="7" width="10" height="10" rx="1" />
            </svg>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder="Scan barcode..."
            className="w-full pl-8 pr-3 py-2 border border-[#d2d2d7] rounded-lg text-[14px] font-mono bg-[#f5f5f7] focus:outline-none focus:border-[#2563eb] focus:ring-1 focus:ring-[#2563eb] focus:bg-white transition-colors"
            autoComplete="off"
            autoFocus
          />
        </div>
        <button
          type="submit"
          disabled={!value.trim()}
          className="px-3 py-2 bg-[#2563eb] text-white text-[13px] font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-40 transition-colors cursor-pointer"
        >
          {syncing ? 'Syncing\u2026' : 'Scan'}
        </button>
      </form>
      {syncing && (
        <div className="mt-2 flex items-center justify-between text-[11px] text-[#6e6e73]">
          <span>Scan accepted instantly; saving in background.</span>
          {pendingCount > 0 && <span>{pendingCount} queued</span>}
        </div>
      )}
      {error && (
        <div className="mt-3 px-4 py-2 rounded-lg bg-[#fef2f2] border border-[#fecaca] text-[13px] text-[#dc2626]">
          {error}
        </div>
      )}
    </div>
  );
}

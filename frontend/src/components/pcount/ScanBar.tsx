import { forwardRef, useState, useRef, useEffect, useCallback, useImperativeHandle } from 'react';
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

function playInvalid() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
    for (const [offset, frequency] of [[0, 240], [0.14, 170]] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = frequency;
      osc.connect(gain);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.11);
    }
  } catch {}
}

const INVALID_FLASH_MS = 900;

const ScanBar = forwardRef<HTMLInputElement, Props>(function ScanBar({ sessionId, onScanned, onScanQueued, onScanFailed }, forwardedRef) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [overscan, setOverscan] = useState(false);
  const [invalidFlash, setInvalidFlash] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout>>();
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);

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
          playInvalid();
          setInvalidFlash(true);
          window.setTimeout(() => setInvalidFlash(false), INVALID_FLASH_MS);
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
        playInvalid();
        setInvalidFlash(true);
        window.setTimeout(() => setInvalidFlash(false), INVALID_FLASH_MS);
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

  function submitCode() {
    const code = value.trim();
    if (!code) return;
    if (scanTimer.current) clearTimeout(scanTimer.current);
    enqueueScan(code);
    setValue('');
    inputRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitCode();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Tab' || !value.trim()) return;
    e.preventDefault();
    submitCode();
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
            onKeyDown={handleKeyDown}
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
      {invalidFlash && (
        <div
          className="fixed inset-0 z-[100] pointer-events-none scan-invalid-vignette"
          role="alert"
          aria-live="assertive"
        >
          <div className="absolute top-5 left-1/2 -translate-x-1/2 rounded-full bg-[#dc2626] px-4 py-2 text-[13px] font-semibold text-white shadow-lg">
            Invalid scan
          </div>
        </div>
      )}
    </div>
  );
});

export default ScanBar;

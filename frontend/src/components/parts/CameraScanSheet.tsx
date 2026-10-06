import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyScanValue } from '../../lib/parts';

interface CameraScanSheetProps {
  open: boolean;
  tab: 'in' | 'out';
  onAccept: (value: string) => void;
  onClose: () => void;
}

// How many consecutive frames must agree before a serial auto-fills.
const STABLE_HITS = 3;
const NATIVE_POLL_MS = 350;

// Broad 1D coverage for part-box labels, plus QR/DataMatrix in case a
// vendor prints the serial as 2D. Unknown names are probe-filtered.
const WANTED_FORMATS = [
  'code_128', 'code_39', 'code_93', 'ean_13', 'ean_8',
  'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code', 'data_matrix',
];

type CameraError = 'denied' | 'missing' | 'insecure' | 'failed';

export default function CameraScanSheet({ open, tab, onAccept, onClose }: CameraScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const acceptedRef = useRef(false);
  const stableRef = useRef<{ value: string; hits: number }>({ value: '', hits: 0 });
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [serials, setSerials] = useState<string[]>([]);
  const [parts, setParts] = useState<string[]>([]);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchReady, setTorchReady] = useState(false);

  const pushUnique = useCallback((list: string[], value: string, cap: number) => {
    if (list.includes(value)) return list;
    return [value, ...list].slice(0, cap);
  }, []);

  const accept = useCallback((value: string) => {
    if (acceptedRef.current) return;
    acceptedRef.current = true;
    onAcceptRef.current(value);
  }, []);

  // Every decoded value runs through the same shape classifier as the USB
  // path: only pure-alphanumeric 10+ char serials auto-fill. Part numbers
  // and aux codes (2602+H0X, CHINA MAINLAND) can never fill the box.
  const handleValue = useCallback((raw: unknown) => {
    // No normalization here — classifyScanValue must see inner spaces and
    // symbols so aux text can never collapse into a fake serial.
    const value = String(raw ?? '').trim().toUpperCase();
    if (!value || acceptedRef.current) return;
    const kind = classifyScanValue(value);
    if (kind === 'serial') {
      setSerials((current) => pushUnique(current, value, 4));
      const stable = stableRef.current;
      const hits = stable.value === value ? stable.hits + 1 : 1;
      stableRef.current = { value, hits };
      if (hits >= STABLE_HITS) accept(value);
    } else if (kind === 'part-number') {
      stableRef.current = { value: '', hits: 0 };
      if (tabRef.current === 'in') setParts((current) => pushUnique(current, value, 2));
    }
    // aux: ignored entirely — keeps the rhythm while sweeping a label.
  }, [accept, pushUnique]);

  const stopAll = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    try { controlsRef.current?.stop(); } catch { /* Already stopped. */ }
    controlsRef.current = null;
    for (const track of streamRef.current?.getTracks() || []) {
      try { track.stop(); } catch { /* Already stopped. */ }
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    acceptedRef.current = false;
    stableRef.current = { value: '', hits: 0 };
    setSerials([]); setParts([]); setCameraError(null); setErrorDetail('');
    setTorchOn(false); setTorchReady(false);
    let cancelled = false;
    const handleRef = { current: handleValue };
    handleRef.current = handleValue;

    const start = async () => {
      // Browsers only expose the camera in a secure context (HTTPS or
      // localhost). Over plain http:// — e.g. a dev server via LAN IP —
      // there is no permission prompt by design, so explain it directly.
      if (!window.isSecureContext) { setCameraError('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setCameraError('missing'); return; }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (err) {
        if (cancelled) return;
        const name = (err as Error)?.name || '';
        try { console.warn('camera scan: getUserMedia failed', name, err); } catch { /* Logging only. */ }
        if (name === 'NotAllowedError' || name === 'SecurityError') setCameraError('denied');
        else { setCameraError('failed'); setErrorDetail(name); }
        return;
      }
      if (cancelled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try { await video.play(); } catch { /* Autoplay with gesture is enough. */ }
      }
      // Torch when the hardware offers it (dim podium lighting).
      try {
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean };
        if (track && caps.torch) setTorchReady(true);
      } catch { /* Torch probe is optional. */ }
      if (cancelled) return;

      const NativeDetector = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect(v: HTMLVideoElement): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (NativeDetector) {
        let detector;
        try {
          const supported = await (NativeDetector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.();
          const formats = supported?.length ? WANTED_FORMATS.filter((f) => supported.includes(f)) : WANTED_FORMATS;
          detector = new NativeDetector({ formats });
        } catch {
          try { detector = new NativeDetector(); } catch { detector = null; }
        }
        if (detector && video) {
          timerRef.current = window.setInterval(async () => {
            if (acceptedRef.current || !videoRef.current) return;
            if (videoRef.current.readyState < 2) return;
            try {
              const codes = await detector.detect(videoRef.current);
              for (const code of codes) {
                const text = code?.rawValue;
                if (text) handleRef.current(text);
              }
            } catch { /* A bad frame is skipped — the next poll continues. */ }
          }, NATIVE_POLL_MS);
          return;
        }
      }
      // Fallback: bundled ZXing decoder (heavier, full 1D coverage).
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled || acceptedRef.current) return;
        const reader = new BrowserMultiFormatReader();
        controlsRef.current = await reader.decodeFromVideoDevice(
          undefined,
          video || undefined,
          (result) => { if (result) handleRef.current(result.getText()); },
        );
      } catch {
        if (!cancelled && !acceptedRef.current) setCameraError('failed');
      }
    };

    void start();
    return () => { cancelled = true; stopAll(); };
  }, [open, handleValue, stopAll]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch { /* Leave the toggle as-is when hardware refuses. */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1d1d1f]/95" role="dialog" aria-modal="true" aria-label="Scan serial with camera">
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[13px] font-semibold text-white">Scan serial</p>
        <button type="button" aria-label="Close camera scan" onClick={onClose}
          className="rounded-full bg-white/10 px-2.5 py-1 text-[16px] leading-5 text-white">×</button>
      </div>
      {cameraError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[14px] font-semibold text-white">
            {cameraError === 'denied' && 'Camera access was denied.'}
            {cameraError === 'insecure' && 'Camera needs HTTPS.'}
            {cameraError === 'missing' && 'No camera available.'}
            {cameraError === 'failed' && 'Camera failed to start.'}
          </p>
          <p className="text-[12px] leading-5 text-white/70">
            {cameraError === 'denied' && 'Allow camera access in the browser settings, or keep using the USB scanner.'}
            {cameraError === 'insecure' && 'This page was opened over plain http — browsers never show the camera prompt there. Open the https:// address instead and try again.'}
            {cameraError === 'missing' && 'This browser view has no camera support. Open the page in Safari or Chrome, or use the USB scanner.'}
            {cameraError === 'failed' && 'Use the USB scanner for this device.'}
          </p>
          {cameraError === 'failed' && errorDetail && (
            <p className="font-mono text-[10px] text-white/40">{errorDetail}</p>
          )}
          <button type="button" onClick={onClose}
            className="mt-3 rounded-xl bg-white px-4 py-2 text-[12px] font-semibold text-[#1d1d1f]">
            Close
          </button>
        </div>
      ) : (
        <>
          <div className="px-4">
            <div className="overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline muted autoPlay
                className="aspect-[4/3] w-full object-cover" />
            </div>
            <p className="mt-2 text-center text-[11px] text-white/70">
              Point at the serial barcode — part and aux codes are ignored.
            </p>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            {serials.map((s) => (
              <button key={s} type="button" onClick={() => accept(s)}
                className="rounded-xl bg-white px-3 py-2.5 text-left font-mono text-[13px] font-semibold text-[#1d1d1f]">
                {s}
              </button>
            ))}
            {tab === 'in' && parts.map((p) => (
              <button key={p} type="button" onClick={() => accept(p)}
                className="rounded-xl border border-white/20 bg-transparent px-3 py-2 text-left text-[12px] text-white/80">
                Part {p} — use for part search
              </button>
            ))}
          </div>
          <div className="flex gap-2 px-4 pb-5">
            {torchReady && (
              <button type="button" onClick={() => void toggleTorch()}
                className="flex-1 rounded-xl bg-white/10 py-2.5 text-[12px] font-semibold text-white">
                {torchOn ? 'Light off' : 'Light on'}
              </button>
            )}
            <button type="button" onClick={onClose}
              className="flex-1 rounded-xl bg-white py-2.5 text-[12px] font-semibold text-[#1d1d1f]">
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

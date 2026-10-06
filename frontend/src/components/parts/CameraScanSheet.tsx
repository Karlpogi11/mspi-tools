import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyScanValue } from '../../lib/parts';

// Stamp shown in diagnostics — confirms the phone runs the current build.
const SHEET_VERSION = 'v9';

interface CameraScanSheetProps {
  open: boolean;
  onAccept: (value: string) => void;
  onClose: () => void;
}

// Accept once the same serial has been seen this many times inside the
// recent window — detections alternate when several barcodes share the
// frame, so consecutive agreement can never happen with a serial sitting
// between other codes.
const HITS_TO_ACCEPT = 2;
const WINDOW_SIZE = 8;
const NATIVE_POLL_MS = 250;

// 1D formats actually printed on part-box labels. The native detector is
// only used when it can see at least one of these — e.g. iOS Safari may
// expose QR only, which must fall through to ZXing instead of going blind.
const ONE_D_FORMATS = [
  'code_128', 'code_39', 'code_93',
  'ean_13', 'ean_8', 'upc_a', 'upc_e', 'itf', 'codabar',
];

// Broad 1D coverage for part-box labels, plus QR/DataMatrix in case a
// vendor prints the serial as 2D. Unknown names are probe-filtered.
const WANTED_FORMATS = [...ONE_D_FORMATS, 'qr_code', 'data_matrix'];

type CameraError = 'denied' | 'missing' | 'insecure' | 'failed';

export default function CameraScanSheet({ open, onAccept, onClose }: CameraScanSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const acceptedRef = useRef(false);
  const recentRef = useRef<string[]>([]);
  // Serial-only counter driving the ZXing watchdog: aux/part reads must
  // never satisfy it, or a half-blind native engine looks "productive".
  const serialCountRef = useRef(0);
  const zxingStartedRef = useRef(false);
  const onAcceptRef = useRef(onAccept);
  onAcceptRef.current = onAccept;
  const [serials, setSerials] = useState<string[]>([]);
  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  // On-device diagnostics (temporary): which engine runs, frames polled,
  // every raw detection with its classification.
  const [engine, setEngine] = useState('');
  const [formatsInfo, setFormatsInfo] = useState('');
  const [frames, setFrames] = useState(0);
  // Heartbeat proving the effect loop is alive even when an engine
  // produces no callbacks (ZXing only calls back on success).
  const [ticks, setTicks] = useState(0);
  const beatRef = useRef<number | null>(null);
  const [seen, setSeen] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [torchReady, setTorchReady] = useState(false);
  // Detection boxes as % of the displayed video (object-cover aware).
  // Colored by classification: serial green, part amber, aux dim.
  const [boxes, setBoxes] = useState<Array<{ x: number; y: number; w: number; h: number; kind: string }>>([]);
  // Last non-serial read, shown under the status line so a working-but-
  // filtered scanner never looks identical to a dead one.
  const [lastRejected, setLastRejected] = useState('');
  // Zoom range probed from the hardware (null = unsupported).
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // Brief "Focusing…" badge so every tap is visibly acknowledged.
  const [focusing, setFocusing] = useState(false);

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
    setSeen((current) => {
      const entry = `${value} → ${kind}`;
      if (current[0] === entry) return current;
      return [entry, ...current].slice(0, 5);
    });
    if (kind === 'serial') {
      serialCountRef.current += 1;
      setSerials((current) => pushUnique(current, value, 4));
      const recent = [...recentRef.current, value].slice(-WINDOW_SIZE);
      recentRef.current = recent;
      if (recent.filter((v) => v === value).length >= HITS_TO_ACCEPT) accept(value);
    } else {
      // Surface rejections in plain UI — a working-but-filtered scanner
      // must never look identical to a dead one.
      const short = value.length > 24 ? `${value.slice(0, 24)}…` : value;
      setLastRejected(`${short} — not a serial`);
    }
    // Part numbers and aux codes never fill the box — serial-only.
  }, [accept, pushUnique]);

  const stopAll = useCallback(() => {
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (beatRef.current !== null) { window.clearInterval(beatRef.current); beatRef.current = null; }
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
    recentRef.current = [];
    serialCountRef.current = 0;
    zxingStartedRef.current = false;
    setLastRejected(''); setZoomCap(null); setZoom(1);
    setSerials([]); setCameraError(null); setErrorDetail('');
    setEngine(''); setFormatsInfo(''); setFrames(0); setSeen([]); setShowDebug(true);
    setTicks(0);
    beatRef.current = window.setInterval(() => setTicks((n) => n + 1), 1000);
    setTorchOn(false); setTorchReady(false); setFocusing(false); setBoxes([]);
    let cancelled = false;
    const handleRef = { current: handleValue };
    handleRef.current = handleValue;

    const start = async () => {
      // Browsers only expose the camera in a secure context (HTTPS or
      // localhost). Over plain http:// — e.g. a dev server via LAN IP —
      // there is no permission prompt by design, so explain it directly.
      if (!window.isSecureContext) { setCameraError('insecure'); return; }
      if (!navigator.mediaDevices?.getUserMedia) { setCameraError('missing'); return; }
      // HD request: dense Code 128 serial labels need ≥720p to decode,
      // and many phones default to ~480p without explicit ideals. The
      // debug panel's video WxH confirms the real resolution on-device.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
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
        // Never awaited: on some phones play() never settles, which used
        // to stall the whole pipeline while the preview kept showing.
        video.play().catch(() => undefined);
        // Phones often block programmatic play until a user gesture: one
        // delayed retry, then tapping the video always plays + refocuses.
        window.setTimeout(() => {
          const v = videoRef.current;
          if (v && v.paused && !cancelled) v.play().catch(() => undefined);
        }, 1200);
      }
      // Torch/focus/zoom probes, fire-and-forget: applyConstraints can
      // hang on some hardware and must never stall detection startup.
      // Focus is requested in both plain and advanced forms — browsers
      // honor only one of the two depending on vendor.
      try {
        const track = stream.getVideoTracks()[0];
        const caps = (track?.getCapabilities?.() || {}) as { torch?: boolean; zoom?: { min: number; max: number; step: number } };
        if (track && caps.torch) setTorchReady(true);
        if (caps.zoom && caps.zoom.max > 1) {
          setZoomCap({ min: caps.zoom.min ?? 1, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
        }
        if (track) {
          void track.applyConstraints({
            focusMode: 'continuous',
            advanced: [{ focusMode: 'continuous', exposureMode: 'continuous' }],
          } as unknown as MediaTrackConstraints).catch(() => undefined);
        }
      } catch { /* Focus/torch/zoom probes are optional. */ }
      if (cancelled) return;

      // Fallback decoder. Limited to label-plausible formats and a short
      // inter-scan delay so close-up 1D sweeps stay fast. Reuses the
      // already-open stream (a second getUserMedia often fails silently).
      const startZxing = async () => {
        // One retry: a stale-precached first chunk can fail once after a
        // deploy, then succeed (service worker refreshes underneath).
        const loadZxing = async () => {
          try { return await import('@zxing/browser'); }
          catch {
            await new Promise((r) => window.setTimeout(r, 600));
            return await import('@zxing/browser');
          }
        };
        try {
          const { BrowserMultiFormatReader, BarcodeFormat } = await loadZxing();
          if (cancelled || acceptedRef.current) return;
          const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanSuccess: 120 });
          reader.possibleFormats = [
            BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
            BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
            BarcodeFormat.ITF, BarcodeFormat.CODABAR,
            BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
          ];
          controlsRef.current = await reader.decodeFromStream(
            stream,
            video || undefined,
            (result, error) => {
              if (result) { handleRef.current(result.getText()); return; }
              // NotFound per frame is normal silence — anything else means
              // the decoder itself is broken, so surface it in diagnostics.
              if (error && !/notfound/i.test(String((error as Error)?.name || error))) {
                const name = String((error as Error)?.name || error).slice(0, 40);
                setSeen((current) => (current[0] === `zxing: ${name}` ? current : [`zxing: ${name}`, ...current].slice(0, 5)));
              }
            },
          );
        } catch {
          if (!cancelled && !acceptedRef.current) setCameraError('failed');
        }
      };

      let nativeStarted = false;
      type DetectedCode = { rawValue?: string; boundingBox?: { x: number; y: number; width: number; height: number } };
      const NativeDetector = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect(v: HTMLVideoElement): Promise<DetectedCode[]> } }).BarcodeDetector;
      if (NativeDetector) {
        let detector = null;
        try {
          const supported = await (NativeDetector as unknown as { getSupportedFormats?: () => Promise<string[]> }).getSupportedFormats?.();
          const formats = supported?.length ? WANTED_FORMATS.filter((f) => supported.includes(f)) : WANTED_FORMATS;
          setFormatsInfo(supported?.length ? supported.join(',') : 'all (unprobed)');
          // A native detector that only sees 2D codes is blind to box
          // labels — skip it so ZXing gets the frames instead.
          if (formats.some((f) => ONE_D_FORMATS.includes(f))) {
            detector = new NativeDetector({ formats });
          }
        } catch {
          try { detector = new NativeDetector(); } catch { detector = null; }
        }
        if (detector && video) {
          nativeStarted = true;
          setEngine('native');
          timerRef.current = window.setInterval(async () => {
            if (acceptedRef.current || !videoRef.current) return;
            if (videoRef.current.readyState < 2) return;
            setFrames((n) => n + 1);
            try {
              const v = videoRef.current;
              const codes = await detector.detect(v);
              // Map stream-space bounding boxes onto the displayed
              // (object-cover cropped) video so boxes sit on the codes.
              const dw = v.clientWidth || 1;
              const dh = v.clientHeight || 1;
              const vw = v.videoWidth || 1;
              const vh = v.videoHeight || 1;
              const scale = Math.max(dw / vw, dh / vh);
              const visW = dw / scale;
              const visH = dh / scale;
              const ox = (vw - visW) / 2;
              const oy = (vh - visH) / 2;
              const clamp = (n: number) => Math.min(100, Math.max(0, n));
              const nextBoxes: Array<{ x: number; y: number; w: number; h: number; kind: string }> = [];
              for (const code of codes) {
                const text = code?.rawValue;
                if (text) {
                  handleRef.current(text);
                  const b = code?.boundingBox;
                  if (b) {
                    nextBoxes.push({
                      x: clamp(((b.x - ox) / visW) * 100),
                      y: clamp(((b.y - oy) / visH) * 100),
                      w: clamp((b.width / visW) * 100),
                      h: clamp((b.height / visH) * 100),
                      kind: classifyScanValue(text),
                    });
                  }
                }
              }
              setBoxes(nextBoxes.slice(0, 6));
            } catch { /* A bad frame is skipped — the next poll continues. */ }
          }, NATIVE_POLL_MS);
        }
      }
      if (!nativeStarted) {
        setEngine('zxing');
        zxingStartedRef.current = true;
        await startZxing();
        return;
      }
      // Watchdog: if no serial has been seen a few seconds in, run ZXing
      // alongside native — whichever engine decodes first wins
      // (acceptedRef guards duplicates). The counter is serial-only, so a
      // half-blind native engine reading just part/aux codes can't
      // satisfy it and stall here.
      window.setTimeout(() => {
        if (cancelled || acceptedRef.current || zxingStartedRef.current) return;
        if (serialCountRef.current > 0) return;
        zxingStartedRef.current = true;
        setEngine((current) => (current === 'native' ? 'native+zxing' : current));
        void startZxing();
      }, 3000);
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

  // Hardware zoom for close-up labels that sit in the blur zone — shown
  // only when the camera reports a zoom range.
  const changeZoom = async (direction: 1 | -1) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !zoomCap) return;
    const raw = zoom + direction * zoomCap.step;
    const next = Math.min(zoomCap.max, Math.max(zoomCap.min, Math.round(raw / zoomCap.step) * zoomCap.step));
    if (next === zoom) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: next }] } as unknown as MediaTrackConstraints);
      setZoom(next);
    } catch { /* Leave zoom as-is when hardware refuses. */ }
  };

  // Tap the viewfinder to refocus — close-up labels often sit inside the
  // blur zone until focus hunts again. Fires a single-shot AF sweep first
  // (the trigger most phone hardware honors), falling back to the
  // manual→continuous toggle. Also (re)starts playback: phones block
  // programmatic play until a user gesture.
  const refocus = async () => {
    setFocusing(true);
    window.setTimeout(() => setFocusing(false), 900);
    const v = videoRef.current;
    if (v && v.paused) {
      try { await v.play(); } catch { /* Still blocked — user can retry. */ }
    }
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] } as unknown as MediaTrackConstraints);
      return;
    } catch { /* Single-shot unsupported — try the toggle below. */ }
    try {
      await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] } as unknown as MediaTrackConstraints);
      window.setTimeout(() => {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints).catch(() => undefined);
      }, 250);
    } catch { /* Best effort. */ }
  };

  if (!open) return null;

  const vid = videoRef.current;
  const vidInfo = !vid
    ? 'no element'
    : `rs:${vid.readyState} ${vid.videoWidth}x${vid.videoHeight}${vid.paused ? ' PAUSED — tap video' : ''}`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#1d1d1f]/95" role="dialog" aria-modal="true" aria-label="Scan serial with camera">
      <style>{`@keyframes parts-scanline { 0% { top: 8%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 92%; opacity: 0; } }`}</style>
      <div className="flex items-center justify-between px-4 py-3">
        <p className="text-[13px] font-semibold text-white">Scan serial</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowDebug((v) => !v)} aria-label="Toggle scan diagnostics"
            className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/80">
            Debug
          </button>
          <button type="button" aria-label="Close camera scan" onClick={onClose}
            className="rounded-full bg-white/10 px-2.5 py-1 text-[16px] leading-5 text-white">×</button>
        </div>
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
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} playsInline muted autoPlay onClick={() => void refocus()}
                className="aspect-[4/3] w-full object-cover" />
              {/* Viewfinder: corner brackets + center dot + sweeping laser
                  while searching. Brackets turn green on serial lock. */}
              <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                {[
                  'left-3 top-3 border-l-2 border-t-2 rounded-tl-lg',
                  'right-3 top-3 border-r-2 border-t-2 rounded-tr-lg',
                  'bottom-3 left-3 border-b-2 border-l-2 rounded-bl-lg',
                  'bottom-3 right-3 border-b-2 border-r-2 rounded-br-lg',
                ].map((pos) => (
                  <span key={pos} className={`absolute h-7 w-7 ${pos} ${serials.length ? 'border-emerald-400' : 'border-red-400/90'}`} />
                ))}
                {/* Live detection boxes: green on serials, amber on part
                    numbers, dim on aux — red brackets mean still searching. */}
                {boxes.map((b, i) => (
                  <span
                    key={`${b.x.toFixed(1)}-${b.y.toFixed(1)}-${i}`}
                    className={`absolute rounded-sm border-2 ${b.kind === 'serial' ? 'border-emerald-400' : b.kind === 'part-number' ? 'border-amber-400/80' : 'border-white/40'}`}
                    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` }}
                  />
                ))}
                <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
                {focusing && (
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-1 text-[11px] font-semibold text-white">
                    Focusing…
                  </span>
                )}
                {serials.length === 0 && (
                  <>
                    <span className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border border-white/40" />
                    <span
                      className="absolute left-[6%] right-[6%] h-0.5 rounded bg-red-400/90 shadow-[0_0_12px_rgba(248,113,113,.9)]"
                      style={{ animation: 'parts-scanline 2.2s ease-in-out infinite' }}
                    />
                  </>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-white/70">
              {serials.length
                ? 'Serial found — hold steady…'
                : 'Point at the serial barcode — tap the video to refocus.'}
            </p>
            {serials.length === 0 && lastRejected && (
              <p className="mt-1 text-center font-mono text-[10px] text-white/50">
                Read {lastRejected}
              </p>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            {serials.map((s) => (
              <button key={s} type="button" onClick={() => accept(s)}
                className="rounded-xl bg-white px-3 py-2.5 text-left font-mono text-[13px] font-semibold text-[#1d1d1f]">
                {s}
              </button>
            ))}
          </div>
          {showDebug && (
            <div className="mx-4 mb-2 rounded-xl bg-black/60 p-2 font-mono text-[10px] leading-4 text-white/70">
              <p>scan {SHEET_VERSION} · engine: {engine || 'starting…'} · alive: {ticks}s · polls: {frames}{formatsInfo ? ` · fmts: ${formatsInfo}` : ''}</p>
              <p>video: {vidInfo}</p>
              {seen.length ? seen.map((entry) => <p key={entry}>{entry}</p>) : <p>no detections yet</p>}
            </div>
          )}
          <div className="flex gap-2 px-4 pb-5">
            {zoomCap && (
              <span className="flex items-center gap-1 rounded-xl bg-white/10 px-1 py-1">
                <button type="button" onClick={() => void changeZoom(-1)} aria-label="Zoom out"
                  className="rounded-lg px-2.5 py-1 text-[14px] font-semibold text-white">−</button>
                <span className="w-9 text-center text-[10px] tabular-nums text-white/70">{zoom.toFixed(1)}×</span>
                <button type="button" onClick={() => void changeZoom(1)} aria-label="Zoom in"
                  className="rounded-lg px-2.5 py-1 text-[14px] font-semibold text-white">+</button>
              </span>
            )}
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

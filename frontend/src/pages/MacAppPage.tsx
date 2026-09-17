import { useEffect, useState } from 'react';
import { pulseApi } from '../lib/messenger';

interface AppVersion {
  name: string;
  version: string;
  notes: string;
  dmgUrl: string;
  exeUrl: string;
  vsixUrl: string;
  appcastUrl: string;
  minOs: string;
}

export default function MacAppPage() {
  const [info, setInfo] = useState<AppVersion | null>(null);

  useEffect(() => {
    pulseApi.appVersion().then(setInfo).catch(() => setInfo(null));
  }, []);

  const version = info?.version || '0.1.0';

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Desktop App</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">MSPI Pulse {version}</h1>
        <p className="mt-2 text-[14px] leading-6 text-[#6e6e73]">
          Fast, smart team messaging for MSPI. Same login and roles as the web tools, AR/serial smart cards, bot alerts, and raw backup to Excel or Google Sheets. Free — no license, no new vendor.
        </p>
        <p className="mt-1 text-[12px] text-[#8e8e93]">{info?.minOs || 'macOS 13+ / Windows 10+'}{info?.notes ? ` · ${info.notes}` : ''}</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
          <h2 className="text-[14px] font-semibold text-[#1d1d1f]">macOS</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Native Swift build when ready; Tauri trial .dmg today. Auto-updates via appcast.</p>
          {info?.dmgUrl ? (
            <a href={info.dmgUrl} className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white hover:bg-[#3a3a3c]">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
              Download .dmg
            </a>
          ) : (
            <span className="mt-4 inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full bg-[#e5e5ea] px-4 text-[12px] font-medium text-[#8e8e93]" aria-disabled="true">
              macOS build coming soon
            </span>
          )}
          <p className="mt-2 text-[11px] text-[#8e8e93]">Unsigned trial: right-click → Open on first launch.</p>
        </div>
        <div className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
          <h2 className="text-[14px] font-semibold text-[#1d1d1f]">Windows</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Same React UI wrapped by Tauri. Test the full Pulse flow on your PC today.</p>
          {info?.exeUrl ? (
            <a href={info.exeUrl} className="mt-4 inline-flex h-9 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white hover:bg-[#3a3a3c]">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
              Download .exe
            </a>
          ) : (
            <span className="mt-4 inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full bg-[#e5e5ea] px-4 text-[12px] font-medium text-[#8e8e93]" aria-disabled="true">
              Windows build coming soon
            </span>
          )}
          <p className="mt-2 text-[11px] text-[#8e8e93]">Installer ships once the Tauri release is tagged.</p>
        </div>
        <div className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
          <h2 className="text-[14px] font-semibold text-[#1d1d1f]">VS Code</h2>
          <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">Trial Pulse inside VS Code on Windows: sidebar chat + Ctrl+Shift+M lookup.</p>
          <a href={info?.vsixUrl || '#'} className="mt-4 inline-flex h-9 items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-4 text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]">
            Download .vsix
          </a>
          <p className="mt-2 text-[11px] text-[#8e8e93]">Install via Extensions → Install from VSIX.</p>
        </div>
      </section>

      <section className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Install</h2>
        <ol className="mt-4 space-y-3">
          {[
            <>Download the build for your OS above (or the <strong>.vsix</strong> for VS Code).</>,
            <>Sign in with your <strong>tools.mspi.io</strong> account — roles carry over automatically.</>,
            <>Join <strong>#general</strong> or <strong>#podium-frontline</strong>; bot alerts arrive live over WebSocket.</>,
            <>Type <strong>AR-12345</strong>, <strong>SN-XXX</strong>, or <strong>661-1234</strong> to attach smart reference cards.</>,
            <>Back up anytime: channel → <strong>Google Sheet backup…</strong> (paste ID, choose tab) or <strong>Download .xlsx</strong>.</>,
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-[13px] leading-5 text-[#3c3c43]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[11px] font-semibold text-[#6e6e73]">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-[#d2d2d7] bg-[#fffaf0] p-5">
        <h2 className="text-[14px] font-semibold text-[#1d1d1f]">Native path</h2>
        <p className="mt-2 text-[13px] leading-5 text-[#6e6e73]">
          The trial shell (Tauri) and the future native SwiftUI app share one frozen API contract (<strong>/api/messenger/*</strong> + <strong>/ws-pulse</strong>), so converting to fully native macOS later rewrites only the UI layer — like LabelMerger, distributed free via GitHub Releases.
        </p>
      </section>
    </div>
  );
}

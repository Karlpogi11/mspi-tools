import { useState } from 'react';
import { labelMergerApi } from '../lib/api';

const steps = [
  <>Download <strong>LabelMerger</strong> using the button below and extract the ZIP file.</>,
  <>Download the <strong>safekeeping overlay</strong> DOCX file below — this is the label template used for merging.</>,
  <>Double-click the downloaded <strong>.dmg</strong> or <strong>.zip</strong> to install to <strong>Applications</strong>.</>,
  <>Open <strong>LabelMerger</strong> from your Applications folder.</>,
  <>Click <strong>"Set overlay"</strong> to load the safekeeping DOCX template.</>,
  <>Drop a <strong>shipping label PDF</strong> onto the window — it merges automatically.</>,
  <>The merged PDF is saved to your Desktop with the <strong>_merged</strong> suffix.</>,
];

export default function LabelMergerPage() {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      const { url } = await labelMergerApi.downloadUrl();
      window.open(url, '_blank');
    } catch {
      window.open('https://github.com/Karlpogi11/LabelMerger/releases/latest/download/LabelMerger-macOS.zip', '_blank');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Label Merger</p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Label Merger</h1>
            <p className="mt-2 text-[14px] leading-6 text-[#6e6e73]">Overlays the safekeeping label onto shipping labels automatically — no reprinting or reinserting needed.</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#3a3a3c] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              {downloading ? 'Opening...' : 'Download LabelMerger'}
            </button>
            <a href="/assets/SAFEKEEPING_LOGO_FOR_STAND_ALONE.docx" download className="inline-flex h-9 items-center gap-2 rounded-full border border-[#d2d2d7] bg-white px-4 text-[12px] font-medium text-[#1d1d1f] transition-colors hover:bg-[#f5f5f7] whitespace-nowrap">
              <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6" />
              </svg>
              Download Overlay
            </a>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-[#d2d2d7] bg-[#fffaf0] p-5">
        <h2 className="text-[14px] font-semibold text-[#1d1d1f]">How it works</h2>
        <p className="mt-2 text-[13px] leading-5 text-[#6e6e73]">The safekeeping overlay is applied to each shipping label automatically. Confidential marker text is removed from the final output so you don't have to reprint or reinsert labels.</p>
      </section>

      <section className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Install</h2>
        <ol className="mt-4 space-y-3">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-3 text-[13px] leading-5 text-[#3c3c43]">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f5f5f7] text-[11px] font-semibold text-[#6e6e73]">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">What you get</h2>
        <ul className="mt-3 space-y-2 pl-5 list-disc text-[13px] leading-5 text-[#6e6e73]">
          <li>Safekeeping overlay is merged onto every shipping label page automatically.</li>
          <li>Confidential marker text is removed from the final output.</li>
          <li>Merged PDFs are saved directly to your Desktop with the <strong>_merged</strong> suffix.</li>
          <li>No need to reprint or reinsert labels after merging.</li>
          <li>Safekeeping DOCX overlay template is available for download above.</li>
        </ul>
      </section>
    </div>
  );
}

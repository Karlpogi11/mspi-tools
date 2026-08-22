const steps = [
  <>Click <strong>Download Extension</strong>, then extract the downloaded ZIP file.</>,
  <>Keep the extracted <strong>workpermit-extension</strong> folder on your computer. Do not select the ZIP file.</>,
  <>Open Chrome using your <strong>personal-email profile</strong>.</>,
  <>Open <strong>chrome://extensions</strong> in a new tab.</>,
  <>On the <strong>top-right</strong>, turn on the <strong>Developer mode</strong> switch. It should change color when enabled.</>,
  <>Click <strong>Load unpacked</strong>.</>,
  <>Select the extracted <strong>workpermit-extension</strong> folder—the folder that directly contains <strong>manifest.json</strong>.</>,
  <>Pin <strong>Work Permit Autofill</strong> from Chrome’s Extensions menu.</>,
  <>Open the supported Work Permit page, review the profile, and select <strong>Fill current page</strong>.</>,
];

export default function ChromeExtensionPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6e6e73]">Chrome Extension</p>
            <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Work Permit Autofill</h1>
            <p className="mt-2 text-[14px] leading-6 text-[#6e6e73]">Install the approved Chrome extension to autofill supported Work Permit forms.</p>
          </div>
          <a href="/assets/workpermit-extension.zip" download className="inline-flex h-9 items-center gap-2 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-medium text-white transition-colors hover:bg-[#3a3a3c]">
            <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
            </svg>
            Download Extension
          </a>
        </div>
      </div>

      <section className="rounded-2xl border border-[#d2d2d7] bg-[#fffaf0] p-5">
        <h2 className="text-[14px] font-semibold text-[#1d1d1f]">Important access rule</h2>
        <p className="mt-2 text-[13px] leading-5 text-[#6e6e73]">This extension is for approved users using Chrome with a <strong className="font-semibold text-[#1d1d1f]">personal email profile only</strong>. Do not install or use it with a company-managed/work email profile unless an administrator explicitly approves it.</p>
      </section>

      <section className="rounded-2xl border border-[#d2d2d7] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Install in Chrome</h2>
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
        <h2 className="text-[15px] font-semibold text-[#1d1d1f]">Before submitting</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[13px] leading-5 text-[#6e6e73]">
          <li>Review every autofilled value.</li>
          <li>Dates remain manual by design.</li>
          <li>Use the extension only on the approved Work Permit site.</li>
        </ul>
        <p className="mt-4 text-[12px] text-[#8a8a91]">The extension is distributed separately from the web tools and must be obtained from the approved project folder.</p>
      </section>
    </div>
  );
}

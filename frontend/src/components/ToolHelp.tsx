import { useEffect, useId, useState } from 'react';

export interface ToolHelpCard {
  title: string;
  description: string;
}

interface ToolHelpProps {
  toolName: string;
  purpose: string;
  steps: string[];
  cards?: ToolHelpCard[];
  note?: string;
}

export default function ToolHelp({ toolName, purpose, steps, cards = [], note }: ToolHelpProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`How ${toolName} works`}
        aria-label={`How ${toolName} works`}
        className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded-full border border-[#d2d2d7] bg-white text-[#6e6e73] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] transition-colors cursor-pointer"
      >
        <span className="text-[12px] font-semibold leading-none" aria-hidden="true">?</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] bg-black/20 px-4 py-8 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-[#d2d2d7] bg-white shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-[#e5e7eb] bg-white px-5 py-4">
              <div>
                <h2 id={titleId} className="text-[16px] font-semibold text-[#1d1d1f]">How {toolName} works</h2>
                <p className="text-[11px] text-[#86868b] mt-0.5">Purpose and usage guide</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="w-8 h-8 inline-flex items-center justify-center rounded-full text-[#6e6e73] hover:bg-[#f5f5f7] transition-colors cursor-pointer"
              >
                <span className="text-[20px] leading-none">×</span>
              </button>
            </div>

            <div className="px-5 py-5 space-y-5 text-[13px] text-[#3a3a3c]">
              <div>
                <h3 className="font-semibold text-[#1d1d1f]">Main purpose</h3>
                <p className="mt-1 leading-5 text-[#6e6e73]">{purpose}</p>
              </div>

              <div>
                <h3 className="font-semibold text-[#1d1d1f]">How to use it</h3>
                <ol className="mt-2 space-y-2 text-[#6e6e73]">
                  {steps.map((step, index) => (
                    <li key={step}><span className="font-medium text-[#1d1d1f]">{index + 1}.</span> {step}</li>
                  ))}
                </ol>
              </div>

              {cards.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {cards.map((card) => (
                    <div key={card.title} className="rounded-xl border border-[#e5e7eb] bg-[#fafafa] p-3">
                      <h3 className="font-semibold text-[#1d1d1f]">{card.title}</h3>
                      <p className="mt-1 text-[12px] leading-5 text-[#6e6e73]">{card.description}</p>
                    </div>
                  ))}
                </div>
              )}

              {note && <p className="text-[11px] leading-5 text-[#86868b]">{note}</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

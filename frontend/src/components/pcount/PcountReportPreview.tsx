import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { Product, Session } from '../../lib/api';

const DEFAULT_CATEGORIES = [
  'APPLE', 'AUDIO', 'PROTECTION A', 'PROTECTION B', 'CCPS', 'ENHCANCEMENTS', 'MAC ACCS',
  'PAPER BAGS - SMALL', 'PAPER BAGS - MED', 'PAPER BAGS - LARGE', 'GIFT CERTS', 'VOUCHERS',
];

interface Props {
  session: Session;
  products: Product[];
  onClose: () => void;
}

function importedCategory(product: Product): string {
  const values = Object.entries(product.extra || {});
  const raw = values.find(([key]) => ['category', 'group'].includes(key.trim().toLowerCase()))?.[1] || product.category;
  return (raw || '').trim();
}

function categoryFor(product: Product): string {
  const storedCategory = (product.category || '').trim().toLowerCase();
  const brand = Object.entries(product.extra || {})
    .find(([key]) => key.trim().toLowerCase() === 'brand')?.[1]
    ?.trim()
    .toLowerCase() || '';
  const imported = importedCategory(product).toLowerCase();
  const raw = [
    imported,
    product.description,
    ...Object.entries(product.extra || {}).map(([key, value]) => `${key} ${value}`),
  ].join(' ').toLowerCase();
  const code = product.product_code.toLowerCase();
  if (storedCategory === 'apple' || brand.includes('apple') || code.startsWith('app') || code.startsWith('apl')) return 'APPLE';
  for (const category of DEFAULT_CATEGORIES) {
    if (raw === category.toLowerCase() || raw.includes(category.toLowerCase())) return category;
  }
  if (raw.includes('paper bag')) {
    if (raw.includes('small')) return 'PAPER BAGS - SMALL';
    if (raw.includes('medium') || raw.includes(' med')) return 'PAPER BAGS - MED';
    if (raw.includes('large')) return 'PAPER BAGS - LARGE';
  }
  if (raw.includes('enhancement')) return 'ENHCANCEMENTS';
  if (raw.includes('mac acc') || raw.includes('accessor')) return 'MAC ACCS';
  if (raw.includes('protection a')) return 'PROTECTION A';
  if (raw.includes('protection b')) return 'PROTECTION B';
  if (raw.includes('audio') || /earphone|headphone|speaker/.test(raw)) return 'AUDIO';
  if (raw.includes('cleaner') || raw.includes('protector')) return 'PROTECTION A';
  if (raw.includes('case')) return 'PROTECTION B';
  if (raw.includes('cable') || raw.includes('charger') || raw.includes('travel')) return raw.includes('car') ? 'ENHCANCEMENTS' : 'CCPS';
  if (raw.includes('peripheral') || raw.includes('skin')) return 'MAC ACCS';
  return raw ? raw.toUpperCase() : 'OTHER';
}

function hasUnsupportedCanvasColor(value: string): boolean {
  return /(oklab|oklch|\blab\(|\blch\(|color\()/i.test(value);
}

export default function PcountReportPreview({ session, products, onClose }: Props) {
  const defaultDate = useMemo(() => {
    try {
      const d = new Date(session.created_at);
      return d.toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase();
    } catch {
      return new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' }).toUpperCase();
    }
  }, [session.created_at]);

  const [site, setSite] = useState(() => {
    const name = session.name || '';
    return name.toUpperCase().includes('PODIUM') ? 'PODIUM' : name.toUpperCase();
  });
  const [date, setDate] = useState(defaultDate);
  const [conductedBy, setConductedBy] = useState('Meliza Monge / Admin / Rore Gubon / Karl David Garcia');
  const [approvedBy, setApprovedBy] = useState('PAUL ANGELO AGUILAR');
  const [notedBy, setNotedBy] = useState('Danilyn Manuel');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportError, setExportError] = useState('');
  const reportPagesRef = useRef<HTMLDivElement>(null);
  const [selectedForm, setSelectedForm] = useState<'1st' | '2nd'>('2nd');
  const [summaryEdits, setSummaryEdits] = useState<Record<string, Record<string, string>>>({});
  const [appleTotalOverride, setAppleTotalOverride] = useState<string | null>(null);
  const [tppTotalOverride, setTppTotalOverride] = useState<string | null>(null);

  const countedProducts = products.filter(product => product.status !== 'excluded');

  const defaultSummaries = useMemo(() => {
    const map = new Map<string, {
      category: string;
      description: string;
      soh: number | 'N/A';
      actual: number | 'N/A';
      issued: number | 'N/A';
      variance: number | 'N/A';
      remarks: string;
      hasProducts: boolean;
    }>();

    const categoryDescriptions: Record<string, string> = {
      'APPLE': '',
      'AUDIO': 'Earphones / Headphone / Speaker',
      'PROTECTION A': 'Cleaners / Protectors',
      'PROTECTION B': 'Cases',
      'CCPS': 'Charging Cables / Wall Charger & Travel',
      'ENHCANCEMENTS': 'Power Supply / Car Charger',
      'MAC ACCS': 'Peripherals / Skins',
      'PAPER BAGS - SMALL': '',
      'PAPER BAGS - MED': '',
      'PAPER BAGS - LARGE': '',
      'GIFT CERTS': '',
      'VOUCHERS': '',
    };

    for (const cat of DEFAULT_CATEGORIES) {
      map.set(cat.toUpperCase(), {
        category: cat,
        description: categoryDescriptions[cat] || '',
        soh: 'N/A',
        actual: 'N/A',
        issued: 'N/A',
        variance: 'N/A',
        remarks: 'N/A',
        hasProducts: false,
      });
    }

    for (const product of countedProducts) {
      const category = categoryFor(product).toUpperCase();
      let current = map.get(category);
      if (!current) {
        current = {
          category: categoryFor(product),
          description: '',
          soh: 0,
          actual: 0,
          issued: 'N/A',
          variance: 'N/A',
          remarks: '',
          hasProducts: true,
        };
        map.set(category, current);
      }

      current.hasProducts = true;
      if (current.soh === 'N/A') current.soh = 0;
      if (current.actual === 'N/A') current.actual = 0;

      current.soh = (current.soh as number) + product.system_qty;
      current.actual = (current.actual as number) + product.counted_qty;

      const values = Object.entries(product.extra || {});
      const issuedVal = values.find(([k]) => ['stock issued', 'stock_issued', 'issued qty', 'issued quantity'].includes(k.trim().toLowerCase()))?.[1];
      if (issuedVal) {
        const parsed = parseFloat(String(issuedVal).replace(/,/g, '').trim());
        if (!isNaN(parsed)) {
          if (current.issued === 'N/A') current.issued = 0;
          current.issued = (current.issued as number) + parsed;
        }
      }

      const note = product.status === 'missing' ? product.notes?.trim() : '';
      if (note) {
        const existing = current.remarks === 'N/A' ? [] : current.remarks.split(';').map(value => value.trim()).filter(Boolean);
        current.remarks = Array.from(new Set([...existing, note])).join('; ');
      }

    }

    for (const current of map.values()) {
      if (!current.hasProducts) continue;

      const sohNum = current.soh === 'N/A' ? 0 : (current.soh as number);
      const actualNum = current.actual === 'N/A' ? 0 : (current.actual as number);
      const issuedNum = current.issued === 'N/A' ? 0 : (current.issued as number);

      const diff = sohNum - (actualNum + issuedNum);
      if (diff !== 0) {
        current.variance = diff;
        if (current.remarks === 'N/A') current.remarks = '';
      } else {
        current.variance = 'N/A';
        if (current.remarks === '') {
          current.remarks = 'N/A';
        }
      }
    }

    return DEFAULT_CATEGORIES.map(category => map.get(category.toUpperCase())!);
  }, [countedProducts]);

  function summaryValue(category: string, field: string, fallback: string | number) {
    return summaryEdits[category]?.[field] ?? String(fallback);
  }

  function editSummary(category: string, field: string, value: string) {
    setSummaryEdits(prev => ({ ...prev, [category]: { ...prev[category], [field]: value } }));
  }

  async function saveRemark(category: string, value: string) {
    const note = value.trim() && value.trim() !== 'N/A' ? value.trim() : '';
    const targets = countedProducts.filter(product =>
      product.status === 'missing' && categoryFor(product).toUpperCase() === category.toUpperCase(),
    );

    await Promise.allSettled(targets.map(product => fetch(
      `/api/pcount/sessions/${session.id}/products/${encodeURIComponent(product.product_code)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ notes: note }),
      },
    )));
  }

  const getSohValue = (cat: string, defaultSoh: string | number) => {
    const val = summaryValue(cat, 'soh', defaultSoh);
    if (val === 'N/A') return 0;
    const num = parseFloat(val.replace(/,/g, ''));
    return isNaN(num) ? 0 : num;
  };

  const appleDefaultSoh = defaultSummaries.find(s => s.category === 'APPLE')?.soh ?? 'N/A';
  const appleSohSum = getSohValue('APPLE', appleDefaultSoh);

  const tppSohSum = useMemo(() => {
    const categoriesToSum = ['AUDIO', 'PROTECTION A', 'PROTECTION B', 'CCPS', 'ENHCANCEMENTS', 'MAC ACCS'];
    return categoriesToSum.reduce((acc, cat) => {
      const def = defaultSummaries.find(s => s.category === cat)?.soh ?? 'N/A';
      return acc + getSohValue(cat, def);
    }, 0);
  }, [defaultSummaries, summaryEdits]);

  const appleTotalText = appleTotalOverride ?? `Apple - ${appleSohSum}`;
  const tppTotalText = tppTotalOverride ?? `3PP - ${tppSohSum}`;

  async function exportPdf() {
    const pagesContainer = reportPagesRef.current;
    if (!pagesContainer || exportingPdf) return;

    setExportingPdf(true);
    setExportError('');
    try {
      const pages = Array.from(pagesContainer.children).filter(
        (element): element is HTMLElement => element instanceof HTMLElement && element.classList.contains('pcount-report-paper'),
      );
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          onclone: clonedDocument => {
            const clonedPage = clonedDocument.querySelector('.pcount-report-pages');
            clonedPage?.querySelectorAll<HTMLElement>('*').forEach(element => {
              const computed = clonedDocument.defaultView?.getComputedStyle(element);
              if (!computed) return;
              if (hasUnsupportedCanvasColor(computed.color)) element.style.color = '#4b4540';
              if (hasUnsupportedCanvasColor(computed.backgroundColor)) element.style.backgroundColor = '#ffffff';
              if (hasUnsupportedCanvasColor(computed.borderTopColor)) element.style.borderTopColor = '#dedbd7';
              if (hasUnsupportedCanvasColor(computed.borderRightColor)) element.style.borderRightColor = '#dedbd7';
              if (hasUnsupportedCanvasColor(computed.borderBottomColor)) element.style.borderBottomColor = '#dedbd7';
              if (hasUnsupportedCanvasColor(computed.borderLeftColor)) element.style.borderLeftColor = '#dedbd7';
            });
          },
        });
        if (index > 0) pdf.addPage('a4', 'portrait');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }

      const filename = `pcount-report-${(session.name || `session-${session.id}`).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report'}.pdf`;
      const pdfUrl = URL.createObjectURL(pdf.output('blob'));
      const previewWindow = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      if (!previewWindow) {
        pdf.save(filename);
        URL.revokeObjectURL(pdfUrl);
      } else {
        window.setTimeout(() => URL.revokeObjectURL(pdfUrl), 60_000);
      }
    } catch (error) {
      console.error('Failed to export PDF', error);
      setExportError('PDF export failed. Please try again.');
    } finally {
      setExportingPdf(false);
    }
  }

  const reportHeader = (
    <header className="flex items-start justify-between pb-4 border-b border-[#dedbd7]">
      <img src="/assets/images/logo-mobilecare.png" alt="Mobile Care" className="h-10 w-auto object-contain self-start" />
      <div className="flex flex-col items-end gap-3">
        <h1 className="text-[22px] font-bold tracking-[0.15em] text-[#1d1d1f] m-0">PCOUNT REPORT</h1>
        <table className="border-collapse border border-[#746c65] text-[9px] uppercase tracking-wider w-[240px]">
          <thead><tr className="bg-[#ecebe9] text-[#746c65]"><th className="border border-[#746c65] px-2 py-1 text-center font-bold w-1/2">AASP SITE</th><th className="border border-[#746c65] px-2 py-1 text-center font-bold w-1/2">PCOUNT DATE</th></tr></thead>
          <tbody><tr className="bg-white"><td className="border border-[#746c65] p-0 text-center"><input value={site} onChange={e => setSite(e.target.value)} className="w-full text-center border-0 py-1.5 text-[11px] font-semibold outline-none bg-transparent" placeholder="PODIUM" /></td><td className="border border-[#746c65] p-0 text-center"><input value={date} onChange={e => setDate(e.target.value)} className="w-full text-center border-0 py-1.5 text-[11px] font-semibold outline-none bg-transparent" placeholder="JULY 04, 2026" /></td></tr></tbody>
        </table>
      </div>
    </header>
  );

  const signatures = (
    <div className="signature-section mt-8 border border-[#746c65] text-[10px]">
      <div className="grid grid-cols-2 border-b border-[#746c65]"><div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider">CONDUCTED BY</div><div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider border-l border-[#746c65]">APPROVED BY</div></div>
      <div className="grid grid-cols-2"><div className="p-4 text-center border-r border-[#746c65] flex flex-col justify-end min-h-[100px]"><input value={conductedBy} onChange={e => setConductedBy(e.target.value)} className="w-full text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]" /><div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">CASHIER / PMA</div><div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name</div></div><div className="p-4 text-center flex flex-col justify-end min-h-[100px]"><input value={approvedBy} onChange={e => setApprovedBy(e.target.value)} className="w-full text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]" /><div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">SITE HEAD / ASST SPV</div><div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name</div></div></div>
      <div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider border-t border-[#746c65]">NOTED BY:</div><div className="p-4 text-center flex flex-col items-center justify-end min-h-[100px]"><input value={notedBy} onChange={e => setNotedBy(e.target.value)} className="w-2/3 text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]" /><div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">SECURITY GUARD ON DUTY</div><div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name and Date</div></div>
    </div>
  );

  const actualTable = (
    <>
      <table className="report-table mt-8"><thead><tr><th>Category</th><th>SOH</th><th>Actual Qty</th><th>Stock Issued</th><th>Variance</th><th>Remarks</th></tr></thead><tbody>{defaultSummaries.map(row => <tr key={row.category}><td className="p-1"><input value={summaryValue(row.category, 'category', row.category)} onChange={e => editSummary(row.category, 'category', e.target.value)} className="w-full bg-transparent border-0 outline-none text-left font-bold text-[#1d1d1f] focus:ring-0 p-0 text-[11px]" /></td>{(['soh', 'actual', 'issued', 'variance'] as const).map(field => <td key={field}><input type="text" value={summaryValue(row.category, field, row[field])} onChange={e => editSummary(row.category, field, e.target.value)} className="w-full bg-transparent border-0 outline-none text-center font-medium focus:ring-0 p-0" /></td>)}<td><input type="text" value={summaryValue(row.category, 'remarks', row.remarks) || 'N/A'} onFocus={e => { if (e.currentTarget.value === 'N/A') editSummary(row.category, 'remarks', ''); }} onChange={e => editSummary(row.category, 'remarks', e.target.value)} onBlur={e => { const value = e.currentTarget.value.trim() || 'N/A'; editSummary(row.category, 'remarks', value); void saveRemark(row.category, value); }} className="w-full bg-transparent border-0 outline-none text-left pl-1 focus:ring-0 p-0" aria-label={`Remarks for ${row.category}`} /></td></tr>)}</tbody></table>
      <div className="mt-3 flex justify-between items-start"><div className="flex flex-col gap-1 text-left"><input value={appleTotalText} onChange={e => setAppleTotalOverride(e.target.value)} className="bg-transparent border-0 outline-none text-[11px] font-semibold text-[#4b4540] p-0 w-48 focus:ring-0" placeholder="Apple - 237" /><input value={tppTotalText} onChange={e => setTppTotalOverride(e.target.value)} className="bg-transparent border-0 outline-none text-[11px] font-semibold text-[#4b4540] p-0 w-48 focus:ring-0" placeholder="3PP - 1092" /></div><div className="flex-1" /></div>
    </>
  );

  return (
    <div className="pcount-report-print-root fixed inset-0 z-50 overflow-auto bg-[#111827]/60 p-4 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="pcount-report-preview-content mx-auto w-full max-w-none print:max-w-none">
        <div className="pcount-report-toolbar print:hidden"><div className="pcount-report-toolbar-actions"><button onClick={() => void exportPdf()} disabled={exportingPdf} title="Download the report as a PDF" className="pcount-report-export-button">{exportingPdf ? 'Exporting…' : 'Export PDF'}</button><button onClick={() => window.print()} className="pcount-report-print-button">Print A4</button><button onClick={onClose} aria-label="Close report preview" title="Close" className="pcount-report-close-button"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button></div>{exportError && <span className="pcount-report-export-error" role="alert">{exportError}</span>}</div>
        <div ref={reportPagesRef} className="pcount-report-pages">
          <section className="pcount-paper pcount-report-paper bg-white text-[#4b4540] shadow-xl print:shadow-none p-[14mm_16mm] relative">{reportHeader}<table className="report-table mt-8"><thead><tr><th>Category</th><th colSpan={5}></th></tr></thead><tbody>{defaultSummaries.map(row => <tr key={row.category}><td className="p-1"><input value={summaryValue(row.category, 'category', row.category)} onChange={e => editSummary(row.category, 'category', e.target.value)} className="w-full bg-transparent border-0 outline-none text-left font-bold text-[#1d1d1f] focus:ring-0 p-0 text-[11px]" /></td><td colSpan={5} className="p-1"><input value={summaryValue(row.category, 'description', row.description)} onChange={e => editSummary(row.category, 'description', e.target.value)} className="w-full bg-transparent border-0 outline-none text-left text-[11px] text-[#6e6e73] focus:ring-0 p-0" /></td></tr>)}</tbody></table>{signatures}</section>
          <section className="pcount-paper pcount-report-paper bg-white text-[#4b4540] shadow-xl print:shadow-none p-[14mm_16mm] relative">{reportHeader}{actualTable}{signatures}</section>
        </div>
      </div>
    </div>
  );

  return (
    <div className="pcount-report-print-root fixed inset-0 z-50 overflow-auto bg-[#111827]/60 p-4 print:static print:overflow-visible print:bg-white print:p-0">
      <div className="pcount-report-preview-content mx-auto w-full max-w-[210mm] print:max-w-none">
        <div className="pcount-report-toolbar print:hidden">
          <div className="pcount-report-form-switcher" role="tablist" aria-label="Report form">
            <button
              onClick={() => setSelectedForm('1st')}
              aria-selected={selectedForm === '1st'}
              role="tab"
              className={`pcount-report-form-option ${selectedForm === '1st' ? 'is-active' : ''}`}
            >
              Template
            </button>
            <button
              onClick={() => setSelectedForm('2nd')}
              aria-selected={selectedForm === '2nd'}
              role="tab"
              className={`pcount-report-form-option ${selectedForm === '2nd' ? 'is-active' : ''}`}
            >
              System vs Actual Qty
            </button>
          </div>
          <div className="pcount-report-toolbar-actions">
            <button
              onClick={() => window.print()}
              title="Export the report as a PDF"
              className="pcount-report-export-button"
            >
              Export PDF
            </button>
            <button onClick={() => window.print()} className="pcount-report-print-button">
              Print A4
            </button>
            <button onClick={onClose} aria-label="Close report preview" title="Close" className="pcount-report-close-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <section className="pcount-paper pcount-report-paper bg-white text-[#4b4540] shadow-xl print:shadow-none w-[210mm] min-h-[297mm] mx-auto p-[14mm_16mm] relative">
          <header className="flex items-start justify-between pb-4 border-b border-[#dedbd7]">
            <img src="/assets/images/logo-mobilecare.png" alt="Mobile Care" className="h-10 w-auto object-contain self-start" />
            <div className="flex flex-col items-end gap-3">
              <h1 className="text-[22px] font-bold tracking-[0.15em] text-[#1d1d1f] m-0">PCOUNT REPORT</h1>

              {/* 2x2 Grid for AASP SITE & PCOUNT DATE */}
              <table className="border-collapse border border-[#746c65] text-[9px] uppercase tracking-wider w-[240px]">
                <thead>
                  <tr className="bg-[#ecebe9] text-[#746c65]">
                    <th className="border border-[#746c65] px-2 py-1 text-center font-bold w-1/2">AASP SITE</th>
                    <th className="border border-[#746c65] px-2 py-1 text-center font-bold w-1/2">PCOUNT DATE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-white">
                    <td className="border border-[#746c65] p-0 text-center">
                      <input
                        value={site}
                        onChange={e => setSite(e.target.value)}
                        className="w-full text-center border-0 py-1.5 text-[11px] font-semibold outline-none bg-transparent"
                        placeholder="PODIUM"
                      />
                    </td>
                    <td className="border border-[#746c65] p-0 text-center">
                      <input
                        value={date}
                        onChange={e => setDate(e.target.value)}
                        className="w-full text-center border-0 py-1.5 text-[11px] font-semibold outline-none bg-transparent"
                        placeholder="JULY 04, 2026"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </header>

          {selectedForm === '1st' && <table className="report-table mt-8">
            <thead><tr><th>Category</th><th colSpan={5}></th></tr></thead>
            <tbody>{defaultSummaries.map(row => <tr key={row.category}>
              <td className="font-bold text-[#1d1d1f]">{row.category}</td>
              <td colSpan={5} className="text-left text-[11px] text-[#6e6e73]">{row.description}</td>
            </tr>)}</tbody>
          </table>}

          {selectedForm === '2nd' && <table className="report-table mt-8">
            <thead>
              <tr>
                <th>Category</th>
                <th>SOH</th>
                <th>Actual Qty</th>
                <th>Stock Issued</th>
                <th>Variance</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {defaultSummaries.map(row => (
                <tr key={row.category}>
                  <td className="p-1">
                    <div className="flex flex-col text-left">
                      <input
                        value={summaryValue(row.category, 'category', row.category)}
                        onChange={e => editSummary(row.category, 'category', e.target.value)}
                        className="w-full bg-transparent border-0 outline-none text-left font-bold text-[#1d1d1f] focus:ring-0 p-0 text-[11px]"
                      />
                      <input
                        value={summaryValue(row.category, 'description', row.description)}
                        onChange={e => editSummary(row.category, 'description', e.target.value)}
                        className="w-full bg-transparent border-0 outline-none text-left text-[9px] text-[#6e6e73] italic focus:ring-0 p-0 mt-0.5"
                        placeholder="Description"
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={summaryValue(row.category, 'soh', row.soh)}
                      onChange={e => editSummary(row.category, 'soh', e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-center font-medium focus:ring-0 p-0"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={summaryValue(row.category, 'actual', row.actual)}
                      onChange={e => editSummary(row.category, 'actual', e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-center font-medium focus:ring-0 p-0"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={summaryValue(row.category, 'issued', row.issued)}
                      onChange={e => editSummary(row.category, 'issued', e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-center font-medium focus:ring-0 p-0"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={summaryValue(row.category, 'variance', row.variance)}
                      onChange={e => editSummary(row.category, 'variance', e.target.value)}
                      className="w-full bg-transparent border-0 outline-none text-center font-medium focus:ring-0 p-0"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={summaryValue(row.category, 'remarks', row.remarks) || 'N/A'}
                      onFocus={e => {
                        if (e.currentTarget.value === 'N/A') editSummary(row.category, 'remarks', '');
                      }}
                      onChange={e => editSummary(row.category, 'remarks', e.target.value)}
                      onBlur={e => {
                        const value = e.currentTarget.value.trim() || 'N/A';
                        editSummary(row.category, 'remarks', value);
                        void saveRemark(row.category, value);
                      }}
                      className="w-full bg-transparent border-0 outline-none text-left pl-1 focus:ring-0 p-0"
                      aria-label={`Remarks for ${row.category}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>}

          {/* SOH Summaries */}
          {selectedForm === '2nd' && <div className="mt-3 flex justify-between items-start">
            <div className="flex flex-col gap-1 text-left">
              <input
                value={appleTotalText}
                onChange={e => setAppleTotalOverride(e.target.value)}
                className="bg-transparent border-0 outline-none text-[11px] font-semibold text-[#4b4540] p-0 w-48 focus:ring-0"
                placeholder="Apple - 237"
              />
              <input
                value={tppTotalText}
                onChange={e => setTppTotalOverride(e.target.value)}
                className="bg-transparent border-0 outline-none text-[11px] font-semibold text-[#4b4540] p-0 w-48 focus:ring-0"
                placeholder="3PP - 1092"
              />
            </div>
            <div className="flex-1" />
          </div>}

          {/* Signatures Section */}
          <div className="signature-section mt-8 border border-[#746c65] text-[10px]">
            {/* Conducted By & Approved By Headers */}
            <div className="grid grid-cols-2 border-b border-[#746c65]">
              <div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider">
                CONDUCTED BY
              </div>
              <div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider border-l border-[#746c65]">
                APPROVED BY
              </div>
            </div>
            {/* Conducted By & Approved By Body */}
            <div className="grid grid-cols-2">
              <div className="p-4 text-center border-r border-[#746c65] flex flex-col justify-end min-h-[100px]">
                <input
                  value={conductedBy}
                  onChange={e => setConductedBy(e.target.value)}
                  className="w-full text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]"
                />
                <div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">CASHIER / PMA</div>
                <div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name</div>
              </div>
              <div className="p-4 text-center flex flex-col justify-end min-h-[100px]">
                <input
                  value={approvedBy}
                  onChange={e => setApprovedBy(e.target.value)}
                  className="w-full text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]"
                />
                <div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">SITE HEAD / ASST SPV</div>
                <div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name</div>
              </div>
            </div>
            {/* Noted By Header */}
            <div className="signature-header bg-[#1d1d1f] text-white py-1.5 text-center font-bold uppercase tracking-wider border-t border-[#746c65]">
              NOTED BY:
            </div>
            {/* Noted By Body */}
            <div className="p-4 text-center flex flex-col items-center justify-end min-h-[100px]">
              <input
                value={notedBy}
                onChange={e => setNotedBy(e.target.value)}
                className="w-2/3 text-center font-medium border-0 border-b border-gray-400 outline-none pb-1 bg-transparent focus:ring-0 text-[11px]"
              />
              <div className="font-bold mt-1.5 uppercase tracking-wider text-[#4b4540]">SECURITY GUARD ON DUTY</div>
              <div className="text-[9px] text-[#6e6e73] normal-case tracking-normal">Signature over Printed Name and Date</div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

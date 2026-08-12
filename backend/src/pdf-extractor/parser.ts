export interface ParsedFields {
  HAWB: string;
  InvoiceReference: string;
  InvoiceTotalAmount: string;
  DeliveryDate: string;
  TotalQty: string;
  [key: string]: string;
}

export const REQUIRED_FIELDS = ['HAWB', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty'];

const SG_NAME = /^SG\d{6,}$/i;

export function isInvoiceRefFilename(name: string): boolean {
  const stem = name.replace(/\.pdf$/i, '').trim();
  return SG_NAME.test(stem);
}

const MONTHS = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ── OCR last-resort: 0→O, |→1, S→G/5/$ normalizations ──────────────────────

export function ocrSgRef(region: string, text: string): string {
  for (const t of [region, text]) {
    const n = t.replace(/O/g, '0').replace(/o/g, '0').replace(/\|/g, '1');
    let m = n.match(/(?<![A-Za-z])([GgCcSs5$]{1,3})(0\d{7})(?!\d)/);
    if (m) return 'SG' + m[2];
    m = n.match(/(?<![A-Za-z])([GgSs5$]{1,2})(0\d{8})(?!\d)/);
    if (m) return 'SG' + m[2];
  }
  return '';
}

// ── Field parsing ────────────────────────────────────────────────────────────

function find(patterns: RegExp[], ...texts: string[]): string {
  for (const t of texts) {
    for (const p of patterns) {
      const m = t.match(p);
      if (m) return (m[1] ?? '').trim();
    }
  }
  return '';
}

function hawbAboveDeliveryDate(region: string): string {
  const lines = region.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const deliveryIndex = lines.findIndex((line) => /delivery\s+date/i.test(line));
  if (deliveryIndex < 0) return '';
  for (let index = deliveryIndex - 1; index >= Math.max(0, deliveryIndex - 4); index--) {
    const match = lines[index].match(/(?:HAWBS?\s*)?(\d[\d\s-]{5,20})\s*$/i);
    if (match) return match[1].replace(/[\s-]+/g, '');
  }
  return '';
}

export function parseFields(text: string, region = ''): ParsedFields {
  let hawb = find([
    /\bHAWBS?\b\s*(?:NO\.?|NUMBER|#)?\s*[:;#-]?\s*\n?\s*([0-9][0-9\s-]{5,20})/i,
    /\bH[A4]WB[S5]?\b\s*(?:N[O0]\.?|#)?\s*[:;#-]?\s*\n?\s*([0-9][0-9\s-]{5,20})/i,
    /(?:Lon|AWB)[:\s#]+([0-9]{6,})/i,
    /(?:oN|aN)\s*[=\w]+[=:\s;]+\s*([0-9]{6,})/i,
  ], region, text).replace(/[\s-]+/g, '');
  if (!hawb) hawb = hawbAboveDeliveryDate(region);

  let invoiceRef = find([
    /\b(SG0\d{7,})\b/i,
    /[Ss][Gg][Oo]?(0\d{7,})/,
    /[Ss][Cc](0\d{7,})/,
    /[5$]G?(0\d{7,})/,
    /\$[Gg](0\d{7,})/,
  ], region, text);
  if (!invoiceRef) invoiceRef = ocrSgRef(region, text);
  if (invoiceRef && !invoiceRef.startsWith('SG')) invoiceRef = 'SG' + invoiceRef;

  let amount = find([
    /COMMENT\s*\n?\s*([0-9,]+\.[0-9]{2})/i,
    /(?:Invoice\s+)?Total[:\s]+([0-9,]+\.[0-9]{2})/i,
    /Grand\s+Total[:\s]+([0-9,]+\.[0-9]{2})/i,
  ], text);
  if (!amount) {
    const lineTotals = text.match(/(\d+\.\d{2})\s*$/gm) ?? [];
    if (lineTotals.length > 0) {
      const total = lineTotals.reduce((s, v) => s + parseFloat(v), 0);
      amount = total.toFixed(2);
    }
  }

  const deliveryDate = find([
    /Delivery\s+Date\s*[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
  ], text);

  let totalQty = find([
    /Total\s+Quantity[:\s]+(\d+)/i,
    /Total\s+Qty[:\s]+(\d+)/i,
  ], text);
  if (!totalQty) {
    const itemLines = text.match(/^\S.*\d+\.\d{2}\s*$/gm) ?? [];
    if (itemLines.length > 0) totalQty = String(itemLines.length);
  }

  return {
    HAWB: hawb,
    InvoiceReference: invoiceRef,
    InvoiceTotalAmount: amount,
    DeliveryDate: deliveryDate,
    TotalQty: totalQty,
  };
}

export function mergeFields(...dicts: Array<Partial<ParsedFields>>): ParsedFields {
  const out: ParsedFields = {
    HAWB: '',
    InvoiceReference: '',
    InvoiceTotalAmount: '',
    DeliveryDate: '',
    TotalQty: '',
  };
  for (const key of ['HAWB', 'InvoiceReference', 'InvoiceTotalAmount', 'DeliveryDate', 'TotalQty']) {
    for (const d of dicts) {
      if (d[key]) {
        out[key] = d[key]!;
        break;
      }
    }
  }
  return out;
}

export function missingFields(fields: Partial<ParsedFields>): string[] {
  return REQUIRED_FIELDS.filter((k) => !fields[k]);
}

// ── Month labels ─────────────────────────────────────────────────────────────

export function monthLabelFor(deliveryDate: string): string | null {
  if (!deliveryDate) return null;
  const s = deliveryDate.trim();

  const numeric = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (numeric) {
    const month = parseInt(numeric[1], 10);
    const day = parseInt(numeric[2], 10);
    let year = parseInt(numeric[3], 10);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return `${MONTHS[month]} ${year}`;
  }

  const textual =
    s.match(/([A-Za-z]{3,9})[a-z]*\.?\s+(\d{1,2})\s*,?\s+(\d{4})/i) ||
    s.match(/([A-Za-z]{3,9})[a-z]*\.?\s+(\d{4})/i);
  if (textual) {
    const idx = MONTHS.findIndex((m) => m && m.toLowerCase().startsWith(textual[1].toLowerCase().slice(0, 3)));
    if (idx > 0) {
      const year = textual.length >= 4 ? textual[3] : textual[2];
      return `${MONTHS[idx]} ${year}`;
    }
  }
  return null;
}

export function monthFolderFor(deliveryDate: string): { folder: string; label: string } {
  const label = monthLabelFor(deliveryDate);
  const now = new Date();
  return {
    folder: label ?? `${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`,
    label: label ?? '',
  };
}

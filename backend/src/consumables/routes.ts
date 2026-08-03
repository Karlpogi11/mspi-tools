import { Router, Request, Response } from 'express';
import { eq, sql, inArray } from 'drizzle-orm';
import Excel from 'exceljs';
import { getDb } from '../db/index.js';
import { consumableMaster } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

router.use(authenticateToken);

interface MasterInput {
  part_number: string;
  description: string;
  category: string;
  expires: string;
  unit: string;
}

function parseMasterItem(raw: any): MasterInput | null {
  const partNumber = typeof raw?.part_number === 'string' ? raw.part_number.trim() : '';
  const description = typeof raw?.description === 'string' ? raw.description.trim() : '';
  if (!partNumber || !description) return null;
  const category = typeof raw?.category === 'string' && raw.category.trim() ? raw.category.trim() : 'Other';
  const unit = typeof raw?.unit === 'string' && raw.unit.trim() ? raw.unit.trim() : 'pcs';
  const expires = typeof raw?.expires === 'string' && raw.expires.trim().toUpperCase() === 'N' ? 'N' : 'Y';
  return { part_number: partNumber, description, category, expires, unit };
}

function serializeMaster(row: any) {
  return {
    id: row.id,
    part_number: row.part_number,
    description: row.description,
    category: row.category,
    expires: row.expires,
    unit: row.unit,
  };
}

router.get('/master', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db.select().from(consumableMaster).orderBy(sql`${consumableMaster.part_number} asc`);
    res.json(rows.map(serializeMaster));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load master list' });
  }
});

router.post('/master', async (req: Request, res: Response) => {
  try {
    const item = parseMasterItem(req.body);
    if (!item) {
      res.status(400).json({ error: 'Part number and description are required' });
      return;
    }
    const db = getDb();
    const existing = await db
      .select({ id: consumableMaster.id })
      .from(consumableMaster)
      .where(eq(consumableMaster.part_number, item.part_number))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: `"${item.part_number}" is already in the master list` });
      return;
    }
    const [row] = await db.insert(consumableMaster).values({ ...item, created_by: (req as any).user?.id ?? null }).$returningId();
    const [saved] = await db.select().from(consumableMaster).where(eq(consumableMaster.id, row.id));
    res.json(serializeMaster(saved));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to add part' });
  }
});

router.put('/master/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      res.status(400).json({ error: 'Invalid part id' });
      return;
    }
    const patch = parseMasterItem({ ...req.body });
    if (!patch) {
      res.status(400).json({ error: 'Part number and description are required' });
      return;
    }
    const db = getDb();
    await db.update(consumableMaster).set(patch).where(eq(consumableMaster.id, id));
    const [saved] = await db.select().from(consumableMaster).where(eq(consumableMaster.id, id));
    if (!saved) {
      res.status(404).json({ error: 'Part not found' });
      return;
    }
    res.json(serializeMaster(saved));
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update part' });
  }
});

router.delete('/master/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    await db.delete(consumableMaster).where(eq(consumableMaster.id, id));
    res.json({ message: 'Removed from master list' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to remove part' });
  }
});

router.post('/master/import', async (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = raw.map((x: any) => parseMasterItem(x)).filter((x: any): x is MasterInput => x !== null);
    if (items.length === 0) {
      res.status(400).json({ error: 'No valid rows to import' });
      return;
    }
    const db = getDb();
    const unique = new Map<string, MasterInput>();
    for (const item of items) {
      if (!unique.has(item.part_number)) unique.set(item.part_number, item);
    }
    const entries = [...unique.values()];
    const createdBy = (req as any).user?.id ?? null;
    let added = 0;
    let updated = 0;
    for (let i = 0; i < entries.length; i += 800) {
      const chunk = entries
        .slice(i, i + 800)
        .map((item) => ({ ...item, created_by: createdBy }));
      const before = await db
        .select({ part_number: consumableMaster.part_number })
        .from(consumableMaster)
        .where(inArray(consumableMaster.part_number, chunk.map((c) => c.part_number)));
    const existing = new Set(before.map((r) => r.part_number));
      added += chunk.filter((c) => !existing.has(c.part_number)).length;
      updated += chunk.filter((c) => existing.has(c.part_number)).length;
      await db.insert(consumableMaster).values(chunk).onDuplicateKeyUpdate({
        set: { description: sql`VALUES(description)` },
      });
    }
    res.json({ added, updated, count: entries.length });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to import master list' });
  }
});

router.get('/template', async (_req: Request, res: Response) => {
  try {
    const wb = new Excel.Workbook();

    const ws = wb.addWorksheet('Receiving Log');
    ws.mergeCells('A1:E1');
    ws.getCell('A1').value = 'RECEIVING LOG';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };
    ws.mergeCells('A2:E2');
    ws.getCell('A2').value =
      'Fill in Part Number, 9D Code, and Qty Arrived. Description, Production Date, and Expiry fill automatically when the file is imported.';
    ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
    const headers = ['Part Number', '9D Code', 'Qty Arrived', 'Production Date (auto)', 'Expiry Date (auto)'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(4, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F7' } };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    for (let r = 5; r <= 2004; r++) {
      ws.getCell(`D${r}`).value = {
        formula: `IF($B${r}="","",IF(ISNUMBER(VALUE(MID($B${r},1,4))),DATE(2000+VALUE(LEFT($B${r},2)),1,4)-WEEKDAY(DATE(2000+VALUE(LEFT($B${r},2)),1,4),3)+(VALUE(MID($B${r},3,2))-1)*7+3,"Invalid 9D code"))`,
        result: '',
      };
      ws.getCell(`E${r}`).value = {
        formula: `IF(OR($A${r}="",$D${r}="",ISTEXT($D${r})),"",EDATE($D${r},18))`,
        result: '',
      };
    }
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    ws.getColumn(1).width = 16;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 12;
    ws.getColumn(4).width = 18;
    ws.getColumn(5).width = 18;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="consumables-template.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build template' });
  }
});

router.post('/export-labels', async (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.body?.labels) ? req.body.labels : [];
    const labels = raw
      .filter((x: any) => x)
      .map((x: any) => ({
        line1: typeof x?.line1 === 'string' ? x.line1 : '',
        line2: typeof x?.line2 === 'string' ? x.line2 : '',
      }))
      .filter((x: any) => x.line1 || x.line2);
    if (labels.length === 0) {
      res.status(400).json({ error: 'No labels to export' });
      return;
    }

    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet('Print Labels');

    ws.mergeCells('A1:H1');
    ws.getCell('A1').value = 'PRINT LABELS - CUT ALONG BORDERS';
    ws.getCell('A1').font = { bold: true, size: 12 };
    ws.mergeCells('A2:H2');
    ws.getCell('A2').value = 'One label per unit. Cut along the borders and stick on each consumable item.';
    ws.getCell('A2').font = { size: 9, color: { argb: '6E6E73' } };

    const thin: any = { style: 'thin' };
    const LABEL_COLS = [1, 4, 7];
    for (let i = 0; i < labels.length; i++) {
      const block = Math.floor(i / 3);
      const rowStart = 3 + block * 3;
      const colStart = LABEL_COLS[i % 3];
      const label = labels[i];
      const top = ws.getCell(rowStart, colStart);
      const bottom = ws.getCell(rowStart + 1, colStart);
      ws.mergeCells(rowStart, colStart, rowStart, colStart + 1);
      ws.mergeCells(rowStart + 1, colStart, rowStart + 1, colStart + 1);
      top.value = label.line1;
      top.font = { bold: true, size: 10 };
      top.alignment = { wrapText: true, vertical: 'middle' };
      bottom.value = label.line2;
      bottom.font = { size: 9, color: { argb: '6E6E73' } };
      bottom.alignment = { vertical: 'top' };
      top.border = { top: thin, left: thin, right: thin };
      bottom.border = { bottom: thin, left: thin, right: thin };
    }

    ws.getColumn(1).width = 15;
    ws.getColumn(2).width = 15;
    ws.getColumn(3).width = 1.5;
    ws.getColumn(4).width = 15;
    ws.getColumn(5).width = 15;
    ws.getColumn(6).width = 1.5;
    ws.getColumn(7).width = 15;
    ws.getColumn(8).width = 15;
    const lastRow = 3 + Math.ceil(labels.length / 3) * 3;
    ws.pageSetup = {
      orientation: 'portrait',
      fitToHeight: 0,
      fitToWidth: 1,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0, footer: 0 },
    } as any;
    ws.pageSetup.printArea = `A1:H${Math.max(lastRow, 7)}`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('consumable-labels.xlsx')}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to build labels file' });
  }
});

export default router;
import { Router } from 'express';
import ExcelJS from 'exceljs';
import * as store from '../store.js';

const router = Router();

router.get('/sessions', async (_req, res) => {
  try {
    const sessions = await store.adminListSessions();
    res.json(sessions);
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.adminGetSession(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const products = await store.adminListSessionProducts(id);
    const creator = session.created_by ? await store.adminGetUser(session.created_by) : null;
    const submitter = session.submitted_by ? await store.adminGetUser(session.submitted_by) : null;
    res.json({ session, products, creator, submitter });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to get session' });
  }
});

router.get('/sessions/:id/export', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.adminGetSession(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const products = await store.adminListSessionProducts(id);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MSPI Tools';

    const summary = workbook.addWorksheet('Summary');
    summary.addRow(['Session', session.name]);
    summary.addRow(['Status', session.status]);
    summary.addRow(['Submitted', session.submitted_at ? new Date(session.submitted_at).toLocaleString() : 'Not submitted']);
    summary.addRow(['Created', new Date(session.created_at).toLocaleString()]);
    summary.addRow(['Total products', session.total]);
    summary.addRow(['Checked', session.checked]);
    summary.addRow(['Progress', `${session.progress}%`]);
    summary.getColumn(1).width = 16;
    summary.getColumn(2).width = 40;

    const headers = ['Product Code', 'Description', 'Category', 'System Qty', 'Counted Qty', 'Adjusted Qty', 'Status', 'Notes'];
    const extraColumns = new Set<string>();
    for (const p of products) {
      for (const key of Object.keys(p.extra || {})) extraColumns.add(key);
    }
    const extraHeaders = Array.from(extraColumns);

    const detail = workbook.addWorksheet('Products');
    detail.addRow([...headers, ...extraHeaders]);
    for (const p of products) {
      detail.addRow([
        p.product_code,
        p.description,
        p.category,
        p.system_qty,
        p.counted_qty,
        p.adjusted_qty ?? '',
        p.status,
        p.notes ?? '',
        ...extraHeaders.map(h => p.extra[h] ?? ''),
      ]);
    }
    detail.getRow(1).font = { bold: true };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const safeName = session.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session';
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${id}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to export session' });
  }
});

export default router;

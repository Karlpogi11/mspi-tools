import { Router } from 'express';
import * as store from '../store.js';
import { getOnlineCountWs, getScannerCountWs } from '../ws.js';

const router = Router();

router.post('/sessions', async (_req, res) => {
  try {
    const session = await store.createSession('New Session');
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/sessions', async (_req, res) => {
  try {
    const sessions = await store.listSessions();
    res.json(sessions.map(session => ({
      ...session,
      online_count: getOnlineCountWs(session.id),
      active_scanner_count: getScannerCountWs(session.id),
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.getSession(id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session' });
  }
});

router.put('/sessions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, status, sort_desc } = req.body;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) update.status = status;
    if (sort_desc !== undefined) update.sort_desc = sort_desc;

    const session = await store.updateSession(id, update);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.put('/sessions/:id/display-columns', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { columns } = req.body;
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns must be an array' });
    await store.setDisplayColumns(id, columns);
    res.json({ message: 'Display columns updated', columns });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update display columns' });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await store.deleteSession(id);
    res.json({ message: 'Session deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;

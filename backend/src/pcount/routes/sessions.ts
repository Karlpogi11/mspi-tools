import { Router } from 'express';
import * as store from '../store.js';
import { getOnlineCountWs, getScannerCountWs } from '../ws.js';

const router = Router();

router.post('/sessions', async (req, res) => {
  try {
    const session = await store.createSession('New Session', req.user!.userId);
    res.json({ ...session, is_owner: true, joined: true });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create session' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const sessions = await store.listSessions(req.user!.userId);
    res.json(sessions.map(session => ({
      ...session,
      online_count: getOnlineCountWs(session.id),
      active_scanner_count: getScannerCountWs(session.id),
    })));
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.get('/sessions/search', async (req, res) => {
  try {
    const q = (req.query.q as string) || '';
    const sessions = await store.searchSessions(q, req.user!.userId);
    res.json(sessions);
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to search sessions' });
  }
});

router.get('/sessions/:id/compare/:otherId', requireMember, async (req, res) => {
  try {
    const currentId = parseInt(req.params.id);
    const otherId = parseInt(req.params.otherId);
    if (!Number.isInteger(otherId) || currentId === otherId) {
      res.status(400).json({ error: 'Choose a different PCount session to compare' });
      return;
    }
    await store.assertExists(otherId);
    await store.assertMember(otherId, req.user!.userId);
    const [currentSession, previousSession, products] = await Promise.all([
      store.getSession(currentId, req.user!.userId),
      store.getSession(otherId, req.user!.userId),
      store.compareProducts(currentId, otherId),
    ]);
    if (!currentSession || !previousSession) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ currentSession, previousSession, products });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error(error);
    res.status(500).json({ error: 'Failed to compare sessions' });
  }
});

router.post('/sessions/join', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string' || !/^\d{4}$/.test(code.trim())) {
      res.status(400).json({ error: 'A valid 4-digit code is required' });
      return;
    }
    const session = await store.joinSession(code, req.user!.userId);
    res.json({ ...session, is_owner: session.created_by === req.user!.userId, joined: true });
  } catch (error) {
    if (error instanceof store.PcountError) {
      const data = error.data as { sessionId?: number } | undefined;
      res.status(error.status).json({ error: error.message, ...(data?.sessionId ? { sessionId: data.sessionId } : {}) });
      return;
    }
    res.status(500).json({ error: 'Failed to join session' });
  }
});

async function requireMember(req: any, res: any, next: any) {
  try {
    const id = parseInt(req.params.id);
    await store.assertExists(id);
    await store.assertMember(id, req.user!.userId);
    next();
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.get('/sessions/:id', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.getSession(id, req.user!.userId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to get session' });
  }
});

router.put('/sessions/:id', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, status, sort_desc } = req.body;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (status !== undefined) update.status = status;
    if (sort_desc !== undefined) update.sort_desc = sort_desc;

    await store.assertWritable(id);
    if (name !== undefined && !(await store.isOwner(id, req.user!.userId))) {
      res.status(403).json({ error: 'Only the session creator can rename the session' });
      return;
    }

    const session = await store.updateSession(id, update);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update session' });
  }
});

router.post('/sessions/:id/submit', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.submitSession(id, req.user!.userId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ message: 'Session submitted', session });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to submit session' });
  }
});

router.post('/sessions/:id/reopen', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const session = await store.reopenSession(id, req.user!.userId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ message: 'Session reopened', session });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to reopen session' });
  }
});

router.put('/sessions/:id/display-columns', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { columns } = req.body;
    if (!Array.isArray(columns)) return res.status(400).json({ error: 'columns must be an array' });
    await store.assertWritable(id);
    await store.setDisplayColumns(id, columns);
    res.json({ message: 'Display columns updated', columns });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to update display columns' });
  }
});

router.delete('/sessions/:id', requireMember, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (!(await store.isOwner(id, req.user!.userId))) {
      res.status(403).json({ error: 'Only the session creator can delete this session' });
      return;
    }
    await store.deleteSession(id);
    res.json({ message: 'Session deleted' });
  } catch (error) {
    if (error instanceof store.PcountError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

export default router;

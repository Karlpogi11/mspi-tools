import { Router, Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tools, roleToolAccess } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

router.get('/my-tools', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { roleId, roleName } = req.user!;

    if (roleName === 'Admin') {
      const allTools = await db.select().from(tools);
      res.json(allTools);
      return;
    }

    if (!roleId) {
      res.json([]);
      return;
    }

    const accessRows = await db
      .select({ toolId: roleToolAccess.tool_id })
      .from(roleToolAccess)
      .where(eq(roleToolAccess.role_id, roleId));

    if (accessRows.length === 0) {
      res.json([]);
      return;
    }

    const toolIds = accessRows.map((r) => r.toolId);
    const userTools = await db
      .select()
      .from(tools)
      .where(inArray(tools.id, toolIds));

    res.json(userTools);
  } catch (error) {
    console.error('my-tools error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

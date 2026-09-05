import { Router, Request, Response } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tools, roleToolAccess, roles } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

router.get('/my-tools', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { roleId } = req.user!;

    let userTools;
    let accessibleToolIds: number[] = [];

    userTools = await db.select().from(tools);
    if (req.user!.isSuperAdmin) {
      accessibleToolIds = userTools.map((tool) => tool.id);
    } else if (roleId) {
      const accessRows = await db
        .select({ toolId: roleToolAccess.tool_id })
        .from(roleToolAccess)
        .where(eq(roleToolAccess.role_id, roleId));
      accessibleToolIds = accessRows.map((row) => row.toolId);
    }

    const toolIds = userTools.map((tool) => tool.id);
    const roleRows = toolIds.length === 0
      ? []
      : await db
        .select({ toolId: roleToolAccess.tool_id, roleName: roles.name })
        .from(roleToolAccess)
        .innerJoin(roles, eq(roleToolAccess.role_id, roles.id))
        .where(inArray(roleToolAccess.tool_id, toolIds));

    const roleNamesByTool = new Map<number, string[]>();
    for (const row of roleRows) {
      const names = roleNamesByTool.get(row.toolId) || [];
      names.push(row.roleName);
      roleNamesByTool.set(row.toolId, names);
    }

    res.json(userTools.map((tool) => ({
      ...tool,
      roleNames: roleNamesByTool.get(tool.id) || [],
      canAccess: accessibleToolIds.includes(tool.id),
    })));
  } catch (error) {
    console.error('my-tools error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

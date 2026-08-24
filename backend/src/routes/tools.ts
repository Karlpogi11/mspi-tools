import { Router, Request, Response } from 'express';
import { eq, inArray, or } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { tools, roleToolAccess, roles } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

router.get('/my-tools', authenticateToken, async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { roleId, roleName } = req.user!;

    let userTools;

    if (roleName === 'Admin') {
      userTools = await db.select().from(tools);
    } else {
      if (!roleId) {
        res.json([]);
        return;
      }

      const accessRows = await db
        .select({ toolId: roleToolAccess.tool_id })
        .from(roleToolAccess)
        .where(eq(roleToolAccess.role_id, roleId));

      const toolIds = accessRows.map((r) => r.toolId);
      userTools = await db
        .select()
        .from(tools)
        .where(toolIds.length > 0 ? or(inArray(tools.id, toolIds), eq(tools.name, 'Frontline Monitor')) : eq(tools.name, 'Frontline Monitor'));
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
    })));
  } catch (error) {
    console.error('my-tools error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

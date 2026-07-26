import { Router, Request, Response } from 'express';
import { eq, isNull } from 'drizzle-orm';
import { getDb } from '@mspi/shared-db';
import { users, roles, tools, roleToolAccess } from '@mspi/shared-db/schema';
import { authenticateToken, requireAdmin } from '@mspi/shared-auth';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/users', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.full_name,
        roleId: users.role_id,
        roleName: roles.name,
        createdAt: users.created_at,
      })
      .from(users)
      .leftJoin(roles, eq(users.role_id, roles.id))
      .orderBy(users.created_at);

    res.json(result);
  } catch (error) {
    console.error('admin users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/users/:id/role', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { roleId } = req.body;

    if (roleId === undefined || roleId === null) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }

    const db = getDb();
    await db.update(users).set({ role_id: roleId }).where(eq(users.id, Number(id)));

    res.json({ message: 'Role updated' });
  } catch (error) {
    console.error('admin update role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/roles', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const allRoles = await db.select().from(roles);
    res.json(allRoles);
  } catch (error) {
    console.error('admin roles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/roles', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Role name is required' });
      return;
    }

    const db = getDb();
    const [newRole] = await db.insert(roles).values({ name: name.trim() }).$returningId();

    const created = await db.select().from(roles).where(eq(roles.id, newRole.id)).limit(1);
    res.status(201).json(created[0]);
  } catch (error) {
    console.error('admin create role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/roles/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    await db.delete(roles).where(eq(roles.id, Number(id)));
    res.json({ message: 'Role deleted' });
  } catch (error) {
    console.error('admin delete role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/tools', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const allTools = await db.select().from(tools);

    const result = await Promise.all(
      allTools.map(async (tool) => {
        const accessRows = await db
          .select({ roleId: roleToolAccess.role_id })
          .from(roleToolAccess)
          .where(eq(roleToolAccess.tool_id, tool.id));
        return { ...tool, roleIds: accessRows.map((r) => r.roleId) };
      })
    );

    res.json(result);
  } catch (error) {
    console.error('admin tools error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/tools', async (req: Request, res: Response) => {
  try {
    const { name, url, icon, description, roleIds } = req.body;

    if (!name || !url || !icon || !description) {
      res.status(400).json({ error: 'name, url, icon, and description are required' });
      return;
    }

    const db = getDb();
    const [newTool] = await db
      .insert(tools)
      .values({ name, url, icon, description })
      .$returningId();

    if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
      await db.insert(roleToolAccess).values(
        roleIds.map((roleId: number) => ({ role_id: roleId, tool_id: newTool.id }))
      );
    }

    const created = await db.select().from(tools).where(eq(tools.id, newTool.id)).limit(1);
    res.status(201).json({ ...created[0], roleIds: roleIds || [] });
  } catch (error) {
    console.error('admin create tool error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/tools/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, url, icon, description, roleIds } = req.body;

    const db = getDb();
    await db
      .update(tools)
      .set({ name, url, icon, description })
      .where(eq(tools.id, Number(id)));

    await db.delete(roleToolAccess).where(eq(roleToolAccess.tool_id, Number(id)));

    if (roleIds && Array.isArray(roleIds) && roleIds.length > 0) {
      await db.insert(roleToolAccess).values(
        roleIds.map((roleId: number) => ({ role_id: roleId, tool_id: Number(id) }))
      );
    }

    const updated = await db.select().from(tools).where(eq(tools.id, Number(id))).limit(1);
    res.json({ ...updated[0], roleIds: roleIds || [] });
  } catch (error) {
    console.error('admin update tool error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/tools/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const db = getDb();
    await db.delete(tools).where(eq(tools.id, Number(id)));
    res.json({ message: 'Tool deleted' });
  } catch (error) {
    console.error('admin delete tool error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

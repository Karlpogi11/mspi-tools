import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq, isNull, asc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, roles, tools, roleToolAccess } from '../db/schema.js';
import { authenticateToken, requireAdmin } from '../auth.js';
import { passwordValidationError } from './auth.js';
import { writeAuditLog } from '../db/audit.js';

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
      .orderBy(asc(isNull(users.role_id)), users.created_at);

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
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'admin.user_role_changed', resourceType: 'user', resourceId: id, metadata: { roleId } });

    res.json({ message: 'Role updated' });
  } catch (error) {
    console.error('admin update role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/users/:id/password', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!id || !Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }

    if (id === req.user!.userId) {
      res.status(400).json({ error: 'You cannot reset your own password here. Ask another admin to reset it for you.' });
      return;
    }

    const validationError = passwordValidationError(req.body?.newPassword);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const db = getDb();
    const result = await db
      .select({ id: users.id, tokenVersion: users.token_version })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (result.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const passwordHash = await bcrypt.hash(req.body.newPassword, 12);
    await db.update(users)
      .set({ password_hash: passwordHash, token_version: result[0].tokenVersion + 1 })
      .where(eq(users.id, id));
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'admin.user_password_reset', resourceType: 'user', resourceId: id });
    res.json({ message: 'Password reset. The user can now sign in with the new password.' });
  } catch (error) {
    console.error('admin reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/users/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid user id' });
      return;
    }
    if (id === req.user!.userId) {
      res.status(403).json({ error: 'Cannot delete your own account' });
      return;
    }
    const db = getDb();
    await db.delete(users).where(eq(users.id, id));
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'admin.user_deleted', resourceType: 'user', resourceId: id });
    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error('admin delete user error:', error);
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

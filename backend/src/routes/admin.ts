import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq, isNull, asc } from 'drizzle-orm';
import { getDb, getDbPool } from '../db/index.js';
import { users, roles, tools, roleToolAccess } from '../db/schema.js';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../auth.js';
import { passwordValidationError } from './auth.js';
import { writeAuditLog } from '../db/audit.js';
import { ensureFrontlineTables } from '../frontline/store.js';

const router = Router();

router.use(authenticateToken, requireAdmin);

router.get('/frontline/access-requests', async (_req, res) => {
  await ensureFrontlineTables();
  const [rows] = await getDbPool().query(`SELECT r.id, r.user_id, u.email, u.full_name, r.reason, r.status, r.created_at, r.reviewed_at, a.access_scope, a.cso_name FROM frontline_access_requests r INNER JOIN users u ON u.id = r.user_id LEFT JOIN frontline_user_access a ON a.user_id = r.user_id ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected'), r.created_at DESC`);
  res.json(rows);
});

router.post('/frontline/access', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const scope = String(req.body?.scope || 'all').trim();
  const csoName = String(req.body?.csoName || '').trim();
  if (!email) { res.status(400).json({ error: 'Email is required.' }); return; }
  if (scope !== 'all' && scope !== 'cso') { res.status(400).json({ error: 'Scope must be all or cso.' }); return; }
  if (scope === 'cso' && !csoName) { res.status(400).json({ error: 'Provide the assigned CSO.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  const [userRows] = await pool.query('SELECT id FROM users WHERE LOWER(email) = ? LIMIT 1', [email]);
  const user = (userRows as Array<{ id: number }>)[0];
  if (!user) { res.status(404).json({ error: 'No registered user found for that email.' }); return; }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`INSERT INTO frontline_access_requests (user_id, reason, status, reviewed_by, reviewed_at) VALUES (?, 'Granted manually by Admin', 'approved', ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE reason = VALUES(reason), status = 'approved', reviewed_by = VALUES(reviewed_by), reviewed_at = CURRENT_TIMESTAMP`, [user.id, req.user!.userId]);
    await connection.execute(`INSERT INTO frontline_user_access (user_id, access_scope, cso_name, granted_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE access_scope = VALUES(access_scope), cso_name = VALUES(cso_name), granted_by = VALUES(granted_by), granted_at = CURRENT_TIMESTAMP`, [user.id, scope, scope === 'cso' ? csoName : null, req.user!.userId]);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  void writeAuditLog({ actorUserId: req.user!.userId, action: 'frontline.access_manual_grant', resourceType: 'user', resourceId: String(user.id), metadata: { scope, csoName: scope === 'cso' ? csoName : null } });
  res.json({ message: 'Frontline access granted.' });
});

router.patch('/frontline/access-requests/:id', async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (status !== 'approved' && status !== 'rejected') { res.status(400).json({ error: 'Status must be approved or rejected.' }); return; }
  const scope = String(req.body?.scope || 'all').trim();
  const csoName = String(req.body?.csoName || '').trim();
  if (scope !== 'all' && scope !== 'cso') { res.status(400).json({ error: 'Scope must be all or cso.' }); return; }
  if (status === 'approved' && scope === 'cso' && !csoName) { res.status(400).json({ error: 'Provide the assigned CSO.' }); return; }
  await ensureFrontlineTables();
  const pool = getDbPool();
  const [requestRows] = await pool.query('SELECT user_id FROM frontline_access_requests WHERE id = ? LIMIT 1', [Number(req.params.id)]);
  const request = (requestRows as Array<{ user_id: number }>)[0];
  if (!request) { res.status(404).json({ error: 'Access request not found.' }); return; }
  const [result] = await pool.execute(`UPDATE frontline_access_requests SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, req.user!.userId, Number(req.params.id)]);
  if ((result as { affectedRows: number }).affectedRows === 0) { res.status(404).json({ error: 'Access request not found.' }); return; }
  if (status === 'approved') await pool.execute(`INSERT INTO frontline_user_access (user_id, access_scope, cso_name, granted_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE access_scope = VALUES(access_scope), cso_name = VALUES(cso_name), granted_by = VALUES(granted_by), granted_at = CURRENT_TIMESTAMP`, [request.user_id, scope, scope === 'cso' ? csoName : null, req.user!.userId]);
  else await pool.execute('DELETE FROM frontline_user_access WHERE user_id = ?', [request.user_id]);
  void writeAuditLog({ actorUserId: req.user!.userId, action: `frontline.access_${status}`, resourceType: 'frontline_access_request', resourceId: req.params.id });
  res.json({ message: `Frontline access request ${status}.` });
});

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
        isSuperAdmin: users.is_super_admin,
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
    const id = Number(req.params.id);
    const roleId = Number(req.body?.roleId);

    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(roleId) || roleId <= 0) {
      res.status(400).json({ error: 'roleId is required' });
      return;
    }

    const db = getDb();
    const role = await db.select({ id: roles.id, name: roles.name }).from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role.length) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    const [target] = await db.select({ id: users.id, isSuperAdmin: users.is_super_admin }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.isSuperAdmin && !req.user!.isSuperAdmin) {
      res.status(403).json({ error: 'Only the Super Admin can modify the Super Admin account.' });
      return;
    }
    if (target.isSuperAdmin && id === req.user!.userId && role[0].name !== 'Admin') {
      res.status(400).json({ error: 'The Super Admin account must keep the Admin role.' });
      return;
    }
    await db.update(users).set({ role_id: roleId }).where(eq(users.id, id));
    void writeAuditLog({ actorUserId: req.user!.userId, action: 'admin.user_role_changed', resourceType: 'user', resourceId: String(id), metadata: { roleId, roleName: role[0].name } });

    res.json({ message: 'Role updated', userId: id, roleId, roleName: role[0].name });
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
    const [target] = await db.select({ isSuperAdmin: users.is_super_admin }).from(users).where(eq(users.id, id)).limit(1);
    if (!target) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (target.isSuperAdmin && !req.user!.isSuperAdmin) {
      res.status(403).json({ error: 'Only the Super Admin can delete the Super Admin account.' });
      return;
    }
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

router.post('/tools', requireSuperAdmin, async (req: Request, res: Response) => {
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

router.put('/tools/:id', requireSuperAdmin, async (req: Request, res: Response) => {
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

router.delete('/tools/:id', requireSuperAdmin, async (req: Request, res: Response) => {
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

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { roles, users } from './db/schema.js';

export interface JwtPayload {
  userId: number;
  email: string;
  roleId: number | null;
  roleName: string | null;
  isSuperAdmin: boolean;
  tokenVersion: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let payload: JwtPayload | null;
  try {
    payload = await verifyAccessToken(token);
  } catch (error) {
    console.error('Token verification unavailable:', error);
    res.status(503).json({ error: 'Authentication service unavailable' });
    return;
  }
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = payload;
  next();
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  } catch {
    return null;
  }
  if (!Number.isInteger(payload.userId) || !Number.isInteger(payload.tokenVersion)) return null;
  const [user] = await getDb()
    .select({
      email: users.email,
      roleId: users.role_id,
      roleName: roles.name,
      isSuperAdmin: users.is_super_admin,
      tokenVersion: users.token_version,
    })
    .from(users)
    .leftJoin(roles, eq(users.role_id, roles.id))
    .where(eq(users.id, payload.userId))
    .limit(1);
  if (!user || user.tokenVersion !== payload.tokenVersion) return null;
  return {
    ...payload,
    email: user.email,
    roleId: user.roleId,
    roleName: user.roleName,
    isSuperAdmin: Boolean(user.isSuperAdmin),
    tokenVersion: user.tokenVersion,
  };
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user || req.user.roleName !== 'Admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function requireSuperAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: 'Super Admin access required' });
    return;
  }
  next();
}

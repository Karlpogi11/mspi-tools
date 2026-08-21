import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { getDb } from './db/index.js';
import { users } from './db/schema.js';

export interface JwtPayload {
  userId: number;
  email: string;
  roleId: number | null;
  roleName: string | null;
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

  const payload = await verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = payload;
  next();
}

export async function verifyAccessToken(token: string): Promise<JwtPayload | null> {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    if (!Number.isInteger(payload.userId) || !Number.isInteger(payload.tokenVersion)) return null;
    const [user] = await getDb()
      .select({ tokenVersion: users.token_version })
      .from(users)
      .where(eq(users.id, payload.userId))
      .limit(1);
    if (!user || user.tokenVersion !== payload.tokenVersion) return null;
    return payload;
  } catch {
    return null;
  }
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

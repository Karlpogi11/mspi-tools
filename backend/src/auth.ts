import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  userId: number;
  email: string;
  roleId: number | null;
  roleName: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const token = req.cookies?.token;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.user = payload;
  next();
}

export function verifyAccessToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
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

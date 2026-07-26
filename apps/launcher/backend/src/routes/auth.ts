import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq, isNull } from 'drizzle-orm';
import { getDb } from '@mspi/shared-db';
import { users, roles } from '@mspi/shared-db/schema';
import { authenticateToken } from '@mspi/shared-auth';

const router = Router();

function getEmailDomain(email: string): string | null {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

router.post('/signup', async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Email, password, and full name are required' });
      return;
    }

    const domain = getEmailDomain(email);
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase();

    if (!domain || !allowedDomain || domain !== allowedDomain) {
      res.status(403).json({ error: `Only @${allowedDomain} email addresses are allowed` });
      return;
    }

    const db = getDb();

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const [newUser] = await db
      .insert(users)
      .values({ email, password_hash: passwordHash, full_name: fullName })
      .$returningId();

    const token = jwt.sign(
      {
        userId: newUser.id,
        email,
        roleId: null,
        roleName: null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.COOKIE_DOMAIN,
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.status(201).json({
      message: 'Account created. An admin must assign your role before you can access tools.',
      user: { id: newUser.id, email, fullName, roleId: null, roleName: null },
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const domain = getEmailDomain(email);
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN?.toLowerCase();

    if (!domain || !allowedDomain || domain !== allowedDomain) {
      res.status(403).json({ error: `Only @${allowedDomain} email addresses are allowed` });
      return;
    }

    const db = getDb();

    const result = await db
      .select({
        user: users,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(roles, eq(users.role_id, roles.id))
      .where(eq(users.email, email))
      .limit(1);

    if (result.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const { user, roleName } = result[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roleId: user.role_id,
        roleName: roleName ?? null,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: process.env.COOKIE_DOMAIN,
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        roleId: user.role_id,
        roleName,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: process.env.COOKIE_DOMAIN,
    path: '/',
  });
  res.json({ message: 'Logged out' });
});

router.get('/me', authenticateToken, async (req: Request, res: Response) => {
  const db = getDb();
  const result = await db
    .select({
      user: users,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(roles, eq(users.role_id, roles.id))
    .where(eq(users.id, req.user!.userId))
    .limit(1);

  if (result.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  const { user, roleName } = result[0];
  res.json({
    id: user.id,
    email: user.email,
    fullName: user.full_name,
    roleId: user.role_id,
    roleName,
    createdAt: user.created_at,
  });
});

export default router;

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users, roles } from '../db/schema.js';
import { authenticateToken } from '../auth.js';

const router = Router();

function getEmailDomain(email: string): string | null {
  const parts = email.split('@');
  return parts.length === 2 ? parts[1].toLowerCase() : null;
}

function getAllowedDomains(): string[] {
  const raw = (process.env.ALLOWED_EMAIL_DOMAINS || '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') {
    return ['mspi.io', 'mobilecare.com', 'powermaccenter.com'];
  }
  return raw.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

function formatDomainList(domains: string[]): string {
  if (domains.length === 0) return '(none configured)';
  return domains.map((d) => `@${d}`).join(', ');
}

function isDomainAllowed(domain: string | null, allowed: string[]): boolean {
  if (!domain || allowed.length === 0) return false;
  return allowed.includes(domain);
}

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts. Please try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts. Please try again later.' },
});

function passwordValidationError(password: unknown): string | null {
  if (typeof password !== 'string') return 'A new password is required';
  if (password.length < 12) return 'New password must be at least 12 characters';
  if (password.length > 128) return 'New password must be 128 characters or fewer';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'New password must include uppercase, lowercase, number, and special characters';
  }
  return null;
}

router.post('/signup', signupLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, fullName } = req.body;

    if (!email || !password || !fullName) {
      res.status(400).json({ error: 'Email, password, and full name are required' });
      return;
    }

    const domain = getEmailDomain(email);
    const allowedDomains = getAllowedDomains();

    if (!isDomainAllowed(domain, allowedDomains)) {
      res.status(403).json({
        error: `Signup is restricted to ${formatDomainList(allowedDomains)} email addresses`,
      });
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
      { userId: newUser.id, email, roleId: null, roleName: null },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1'].includes(req.hostname),
      sameSite: 'lax',
      domain: ['localhost', '127.0.0.1'].includes(req.hostname) ? undefined : process.env.COOKIE_DOMAIN,
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

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const domain = getEmailDomain(email);
    const allowedDomains = getAllowedDomains();

    if (!isDomainAllowed(domain, allowedDomains)) {
      res.status(403).json({
        error: `Login is restricted to ${formatDomainList(allowedDomains)} email addresses`,
      });
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
      secure: process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1'].includes(req.hostname),
      sameSite: 'lax',
      domain: ['localhost', '127.0.0.1'].includes(req.hostname) ? undefined : process.env.COOKIE_DOMAIN,
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

router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1'].includes(req.hostname),
    sameSite: 'lax',
    domain: ['localhost', '127.0.0.1'].includes(req.hostname) ? undefined : process.env.COOKIE_DOMAIN,
    path: '/',
  });
  res.json({ message: 'Logged out' });
});

router.post('/change-password', authenticateToken, passwordChangeLimiter, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      res.status(400).json({ error: 'Current password is required' });
      return;
    }

    const validationError = passwordValidationError(newPassword);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const db = getDb();
    const result = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (result.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const currentMatches = await bcrypt.compare(currentPassword, result[0].password_hash);
    if (!currentMatches) {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (await bcrypt.compare(newPassword, result[0].password_hash)) {
      res.status(400).json({ error: 'New password must be different from your current password' });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ password_hash: passwordHash }).where(eq(users.id, req.user!.userId));

    res.clearCookie('token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && !['localhost', '127.0.0.1'].includes(req.hostname),
      sameSite: 'lax',
      domain: ['localhost', '127.0.0.1'].includes(req.hostname) ? undefined : process.env.COOKIE_DOMAIN,
      path: '/',
    });
    res.json({ message: 'Password changed. Please sign in again.' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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

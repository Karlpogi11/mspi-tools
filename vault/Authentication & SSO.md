# Authentication & SSO

The system uses a custom **Single Sign-On (SSO)** architecture implemented via cookie-based JSON Web Tokens (JWT) scoped to the wildcard parent domain `.mspi.io`. This allows users to authenticate once on the launcher (`tools.mspi.io`) and automatically propagate credentials to any other internal subdomain tools (like `rfpu.mspi.io` or `pcount.mspi.io`).

---

## 🔑 Cookie-Based SSO Flow

1. **User Login**: The user signs in at `/login` on the launcher frontend.
2. **Token Generation**: The backend auth controller validates the user credentials and signs a JWT containing the user's metadata.
3. **Cookie Setting**: The backend sets an `httpOnly` cookie named `token`:
   - `httpOnly: true` (prevents XSS reading of the token)
   - `Secure: true` (transmitted only over HTTPS)
   - `SameSite: 'Lax'` (CSRF prevention)
   - **`Domain: .mspi.io`** (allows any subdomain under `mspi.io` to read the cookie header!)
4. **Subdomain Requests**: When the frontend requests any resource from another subdomain API, the browser automatically attaches the `Cookie: token=...` header.

---

## 📦 JWT Payload Schema

The JWT token contains the following decoded structure (defined in [backend/src/auth.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/auth.ts)):

```typescript
export interface JwtPayload {
  userId: number;
  email: string;
  roleId: number | null;
  roleName: string | null;
  isSuperAdmin: boolean;
  tokenVersion: number;
}
```

---

## 🛡️ Backend Guards

The backend routes are guarded using Express middleware defined in `auth.ts`:

### 1. `authenticateToken`
- Extracts the token from `req.cookies.token` (or upgrade headers in WebSocket).
- Verifies it against `process.env.JWT_SECRET`, then reloads the user row and rejects when `users.token_version !== payload.tokenVersion` (revocation on password change/reset).
- Attaches the parsed payload to `req.user`.
- Rejects requests with `401 Unauthorized` if invalid or expired, `503` when the DB backing verification is unavailable.

```typescript
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const payload = await verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = payload;
  next();
}
```

### 2. `requireAdmin` / `requireSuperAdmin` / `requireToolAccess`
- `requireAdmin` — rejects with `403 Forbidden` if `req.user.roleName` is not `'Admin'`.
- `requireSuperAdmin` — rejects with `403` unless `req.user.isSuperAdmin` (seed-promoted account; bypasses per-tool checks in the frontend `ProtectedRoute` and backend `requireToolAccess`).
- `requireToolAccess(toolUrl)` — checks `role_tool_access` × `tools.url`; super-admins bypass, users without a role are rejected. Applied per tool in `backend/src/index.ts` (e.g. `/api/applecare`, `/api/endorsements`, `/api/storage-locator`).

---

## 🔌 WebSocket Handshake Authentication
Because WebSocket handshakes (`ws://` / `wss://`) do not support custom request headers like standard AJAX `Authorization`, the system reads the cookie from the upgrade handshake request:

```typescript
function getSessionAuth(request: IncomingMessage): { userId: number } | null {
  const token = request.headers.cookie
    ?.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('token='))
    ?.slice('token='.length);
  if (!token) return null;
  
  const payload = verifyAccessToken(decodeURIComponent(token));
  return payload ? { userId: payload.userId } : null;
}
```

---

## 🔒 Admin Account (Seeded)
- The seed script requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` environment variables.
- The password must be at least 6 characters and is stored only as a bcrypt hash.
- **Allowed email domain filter**: `ALLOWED_EMAIL_DOMAINS` env variable restricts self-registration to specific domain emails (e.g. `@mspi.io`).

---

## 🔁 Password Flows

### Self-service change
`POST /api/auth/change-password` (authenticated, rate-limited) — requires the user to know their **current** password. Clears the session cookie on success. Password rules: 12–128 characters with uppercase, lowercase, number, and special character.

### Admin reset (forgotten password)
`PATCH /api/admin/users/:id/password` (admin-only) — sets a new password for any user directly:

- Reuses the same validation rules as self-service change (`passwordValidationError` in `backend/src/routes/auth.ts`).
- Admins **cannot** reset their own account — another admin must do it.
- The user signs in with the new password; the admin hands it over in person or via a secure channel (no email/SMTP involved).
- Password change/reset bumps `users.token_version`, immediately invalidating previously issued JWTs (token-version revocation; JWT expiry is 8h).

UI: **Admin → Users → Reset password** button opens a modal to enter the new password.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]

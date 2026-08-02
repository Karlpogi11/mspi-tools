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
}
```

---

## 🛡️ Backend Guards

The backend routes are guarded using Express middleware defined in `auth.ts`:

### 1. `authenticateToken`
- Extracts the token from `req.cookies.token` (or upgrade headers in WebSocket).
- Verifies it against `process.env.JWT_SECRET`.
- Attaches the parsed payload to `req.user`.
- Rejects requests with `401 Unauthorized` if invalid or expired.

```typescript
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  const payload = verifyAccessToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = payload;
  next();
}
```

### 2. `requireAdmin`
- Rejects requests with `403 Forbidden` if `req.user.roleName` is not `'Admin'`.
- Applied to administrative control routes (user approvals, tool registration).

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

## 🔒 Default Admin Account (Seeded)
- **Email**: `admin@mspi.io`
- **Password**: `admin123`
- **Allowed email domain filter**: `ALLOWED_EMAIL_DOMAIN` env variable restricts self-registration to specific domain emails (e.g. `@mspi.io`).

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Database Schema]]

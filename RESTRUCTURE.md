# Restructure: Flat backend/frontend Layout

Eliminate the npm workspaces monorepo (`apps/*`, `packages/*`) and flatten everything to `backend/` and `frontend/` at root. The shared packages (`shared-db`, `shared-auth`) get inlined into `backend/src/db/` and `backend/src/auth.ts` (already done). The three apps (launcher, pcount, rfpu) become subdirectories under the unified backend and frontend.

---

## Current State (what's already in place)

| Path | Status |
|------|--------|
| `backend/package.json` | ✅ Done — has all production deps |
| `backend/tsconfig.json` | ✅ Done — uses direct tsconfig (no extends) |
| `backend/src/auth.ts` | ✅ Done — inlined from `@mspi/shared-auth` |
| `backend/src/db/index.ts` | ✅ Done — inlined from `@mspi/shared-db` |
| `backend/src/db/schema.ts` | ✅ Done — inlined from `@mspi/shared-db/schema` |

---

## Phase 1: Backend — Copy & Fix Imports

### Import rewrite rules

All source files under `apps/` use `@mspi/shared-db`, `@mspi/shared-db/schema`, and `@mspi/shared-auth`. These must be rewritten:

| Old import | New import |
|------------|------------|
| `@mspi/shared-db` | `../db/index.js` |
| `@mspi/shared-db/schema` | `../db/schema.js` |
| `@mspi/shared-auth` | `../auth.js` |

Internal cross-references stay relative (e.g., `../store.js` → `../store.js`).

### Files to create

| # | File | Source | Notes |
|---|------|--------|-------|
| 1 | `backend/src/index.ts` | `apps/launcher/backend/src/index.ts` | Replace `@mspi/shared-db` → `./db/index.js`, `@mspi/pcount-backend/gateway` → `./pcount/gateway.js`, `@mspi/rfpu-backend/routes` → `./rfpu/routes.js` |
| 2 | `backend/src/routes/auth.ts` | `apps/launcher/backend/src/routes/auth.ts` | Fix imports per table above |
| 3 | `backend/src/routes/tools.ts` | `apps/launcher/backend/src/routes/tools.ts` | Fix imports per table above |
| 4 | `backend/src/routes/admin.ts` | `apps/launcher/backend/src/routes/admin.ts` | Fix imports per table above |
| 5 | `backend/src/db/seed.ts` | `apps/launcher/backend/src/seed.ts` | Fix imports per table above |
| 6 | `backend/src/pcount/gateway.ts` | `apps/pcount/backend/src/gateway.ts` | Fix `@mspi/shared-db` → `../db/index.js`, `@mspi/shared-auth` → `../auth.js` |
| 7 | `backend/src/pcount/store.ts` | `apps/pcount/backend/src/store.ts` | Fix `@mspi/shared-db` → `../db/index.js`, `@mspi/shared-db/schema` → `../db/schema.js` |
| 8 | `backend/src/pcount/ws.ts` | `apps/pcount/backend/src/ws.ts` | Fix `@mspi/shared-auth` → `../auth.js` |
| 9 | `backend/src/pcount/routes/sessions.ts` | `apps/pcount/backend/src/routes/sessions.ts` | Relative imports (`../store.js`, `../ws.js`) stay as-is |
| 10 | `backend/src/pcount/routes/products.ts` | `apps/pcount/backend/src/routes/products.ts` | Relative imports stay as-is |
| 11 | `backend/src/rfpu/routes.ts` | `apps/rfpu/backend/src/routes.ts` | Fix `@mspi/shared-auth` → `../auth.js` |
| 12 | `backend/drizzle.config.ts` | `apps/launcher/backend/drizzle.config.ts` | Update schema path: `../../packages/shared-db/src/schema.ts` → `./src/db/schema.ts` |

---

## Phase 2: Frontend — Create Unified App

The frontend structure brings all three app frontends under one Vite project, sharing auth, API client, and layout. The pcount and rfpu pages become sub-paths served by the launcher's router.

### New `frontend/` structure

```
frontend/
├── package.json           # Combined deps: react, react-dom, react-router-dom, xlsx, tailwindcss, vite
├── tsconfig.json          # Copy from apps/launcher/frontend/tsconfig.json (already has "types": ["vite/client"])
├── vite.config.ts         # Copy from apps/launcher/frontend/vite.config.ts (proxy /api → :3000)
├── index.html             # Copy from apps/launcher/frontend/index.html
└── src/
    ├── main.tsx           # Copy from apps/launcher/frontend/src/main.tsx
    ├── index.css          # Copy from apps/launcher/frontend/src/index.css
    ├── App.tsx            # **MERGED** — add routes for /pcount/* and /rfpu/*
    ├── lib/
    │   ├── api.ts         # Copy from apps/launcher/frontend/src/lib/api.ts + extend with pcount API
    │   └── auth.tsx       # Copy from apps/launcher/frontend/src/lib/auth.tsx
    ├── components/
    │   ├── Layout.tsx     # Copy from apps/launcher/frontend/src/components/Layout.tsx
    │   └── pcount/        # **ALL** from apps/pcount/frontend/src/components/
    │       ├── ImportSystem.tsx
    │       ├── ImportCount.tsx
    │       ├── ProductTable.tsx
    │       ├── ProgressCircle.tsx
    │       ├── ScanBar.tsx
    │       └── ScanPanel.tsx
    ├── hooks/
    │   └── useWebSocket.ts  # Copy from apps/pcount/frontend/src/hooks/useWebSocket.ts
    └── pages/
        ├── LoginPage.tsx           # Copy from launcher
        ├── PendingApprovalPage.tsx  # Copy from launcher
        ├── DashboardPage.tsx       # Copy from launcher
        ├── AdminUsersPage.tsx      # Copy from launcher
        ├── AdminToolsPage.tsx      # Copy from launcher
        └── pcount/
            ├── IndexPage.tsx       # Copy from apps/pcount/frontend/src/pages/IndexPage.tsx
            └── SessionPage.tsx     # Copy from apps/pcount/frontend/src/pages/SessionPage.tsx
```

### Unified `App.tsx` routing — merge strategy

The merged `App.tsx` wraps `BrowserRouter` once (no basename). Pcount pages get a `/pcount` prefix, rfpu gets `/rfpu`. The common auth/layout wraps the launcher routes; pcount and rfpu get their own lightweight layout (or reuse the common one).

```tsx
// frontend/src/App.tsx — merged routing
<BrowserRouter>
  <AuthProvider>
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />

      {/* Launcher (protected, with shared layout) */}
      <Route element={<Layout />}>
        <Route path="/" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute><AdminUsersPage /></ProtectedRoute>} />
        <Route path="/admin/tools" element={<ProtectedRoute><AdminToolsPage /></ProtectedRoute>} />
      </Route>

      {/* PCount (no shared layout — has its own) */}
      <Route path="/pcount" element={<PcountLayout />}>
        <Route index element={<PcountIndexPage />} />
        <Route path="session/:id" element={<PcountSessionPage />} />
      </Route>

      {/* RFPU (standalone page) */}
      <Route path="/rfpu" element={<RfpuApp />} />
    </Routes>
  </AuthProvider>
</BrowserRouter>
```

### Frontend `package.json` — combined dependencies

Merge the `dependencies` from all three apps:

- `react`, `react-dom`, `react-router-dom` — from launcher
- `xlsx` — from pcount (used in ImportSystem, ImportCount, SessionPage export)
- `@tailwindcss/vite`, `@vitejs/plugin-react`, `tailwindcss`, `typescript`, `vite` — common to all
- `@types/react`, `@types/react-dom` — from launcher

```json
{
  "name": "mspi-tools-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "xlsx": "^0.18.5",
    "@tailwindcss/vite": "^4.1.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "tailwindcss": "^4.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

---

## Phase 3: Root Files

### `package.json`

Remove `workspaces`, remove `turbo` dependency. Scripts simplify to:

```json
{
  "name": "mspi-tools",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev -w backend\" \"npm run dev -w frontend\"",
    "build": "npm run build -w backend && npm run build -w frontend",
    "start": "node backend/dist/index.js",
    "seed": "npm run seed -w backend",
    "db:push": "npm run db:push -w backend",
    "db:generate": "npm run db:generate -w backend"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

Since there are no more workspaces, each sub-project's scripts are invoked via `-w` (workspace) or directly. Actually, since we're removing workspaces entirely, scripts should use `cd`:

```json
{
  "name": "mspi-tools",
  "private": true,
  "scripts": {
    "dev": "concurrently \"cd backend && npm run dev\" \"cd frontend && npm run dev\"",
    "build": "cd backend && npm run build && cd ../frontend && npm run build",
    "start": "node backend/dist/index.js",
    "seed": "cd backend && npm run seed",
    "db:push": "cd backend && npm run db:push",
    "db:generate": "cd backend && npm run db:generate"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

### `.gitignore`

Add `frontend/dist/`, keep existing entries, remove `.turbo/` (no longer relevant).

```
node_modules/
dist/
frontend/dist/
.env
.env.local
*.tsbuildinfo
```

---

## Phase 4: Cleanup

```
Remove-Item -Recurse -Force apps, packages, turbo.json
```

---

## Phase 5: Verify

```powershell
# From repo root:
cd backend; npm install; npm run build
cd ../frontend; npm install; npm run build
cd ..

# Or if root package.json is set up:
npm install
npm run build
npm run seed
npm start
```

Test the gateway at `http://localhost:3000`.

---

## Phase 6: Deploy

```powershell
git add -A
git commit -m "restructure: flat backend/frontend layout"
git push
```

Then deploy from git in Hostinger hpanel. Only the `backend/` dist is served (the frontend build output is copied into `backend/dist/public/` during build, or served separately via CDN).

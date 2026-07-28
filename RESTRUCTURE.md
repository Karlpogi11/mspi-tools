# Restructure: Flat backend/frontend Layout

Remove monorepo workspaces, flatten to `backend/` and `frontend/` at root.

---

## Backend Files

| # | File | Source |
|---|------|--------|
| 1 | `backend/src/index.ts` | Merge `apps/launcher/backend/src/index.ts` — adjust imports to local paths |
| 2 | `backend/src/routes/auth.ts` | Copy from `apps/launcher/backend/src/routes/auth.ts`, fix `@mspi/shared-db` → `../db/index.js`, `@mspi/shared-auth` → `../auth.js` |
| 3 | `backend/src/routes/tools.ts` | Same import fixes |
| 4 | `backend/src/routes/admin.ts` | Same import fixes |
| 5 | `backend/src/db/seed.ts` | Copy from `apps/launcher/backend/src/seed.ts`, fix imports |
| 6 | `backend/src/pcount/gateway.ts` | Copy from `apps/pcount/backend/src/gateway.ts`, fix imports |
| 7 | `backend/src/pcount/store.ts` | Copy from `apps/pcount/backend/src/store.ts`, fix imports |
| 8 | `backend/src/pcount/ws.ts` | Copy from `apps/pcount/backend/src/ws.ts` |
| 9 | `backend/src/pcount/routes/sessions.ts` | Copy from `apps/pcount/backend/src/routes/sessions.ts`, fix `../store.js` → `../store.js` (keeps working) |
| 10 | `backend/src/pcount/routes/products.ts` | Same |
| 11 | `backend/src/rfpu/routes.ts` | Copy from `apps/rfpu/backend/src/routes.ts` |
| 12 | `backend/drizzle.config.ts` | Copy from `apps/launcher/backend/drizzle.config.ts` |

**Import path mapping:**
- `@mspi/shared-db` → `../db/index.js`
- `@mspi/shared-db/schema` → `../db/schema.js`
- `@mspi/shared-auth` → `../auth.js`

---

## Frontend Files

| # | File | Source |
|---|------|--------|
| 13 | `frontend/package.json` | Combined deps from launcher + pcount + rfpu frontends |
| 14 | `frontend/tsconfig.json` | Copy from `apps/launcher/frontend/tsconfig.json`, add `"types": ["vite/client"]` |
| 15 | `frontend/vite.config.ts` | Copy from `apps/launcher/frontend/vite.config.ts` |
| 16 | `frontend/index.html` | Copy from `apps/launcher/frontend/index.html` |
| 17 | `frontend/src/main.tsx` | Copy from `apps/launcher/frontend/src/main.tsx` |
| 18 | `frontend/src/App.tsx` | Merge routing: add `/pcount/*` and `/rfpu/*` routes |
| 19 | `frontend/src/lib/api.ts` | Copy from `apps/launcher/frontend/src/lib/api.ts` |
| 20 | `frontend/src/lib/auth.tsx` | Copy from `apps/launcher/frontend/src/lib/auth.tsx` |
| 21 | `frontend/src/components/Layout.tsx` | Copy from `apps/launcher/frontend/src/components/Layout.tsx` |
| 22 | `frontend/src/pages/LoginPage.tsx` | Copy from launcher frontend |
| 23 | `frontend/src/pages/PendingApprovalPage.tsx` | Copy from launcher frontend |
| 24 | `frontend/src/pages/DashboardPage.tsx` | Copy from launcher frontend |
| 25 | `frontend/src/pages/AdminUsersPage.tsx` | Copy from launcher frontend |
| 26 | `frontend/src/pages/AdminToolsPage.tsx` | Copy from launcher frontend |
| 27 | `frontend/src/pages/pcount/IndexPage.tsx` | Copy from `apps/pcount/frontend/src/pages/IndexPage.tsx` |
| 28 | `frontend/src/pages/pcount/SessionPage.tsx` | Copy from `apps/pcount/frontend/src/pages/SessionPage.tsx` |
| 29 | `frontend/src/components/pcount/*` | Copy all from `apps/pcount/frontend/src/components/` |
| 30 | `frontend/src/pages/rfpu/*` | Copy from `apps/rfpu/frontend/src/` |

---

## Root Files

| # | File | Change |
|---|------|--------|
| 31 | `package.json` | Remove workspaces, turbo. Scripts: `build`, `start`, `dev` pointing to backend |
| 32 | `.gitignore` | Keep `node_modules/`, `dist/`, `.env` |

---

## Cleanup

```
rm -rf apps packages turbo.json
```

## Test

```
npm install
npm run build
npm start
```

## Deploy

```
git add -A
git commit -m "restructure: flat backend/frontend layout"
git push
```

Then deploy from git in Hostinger hpanel.

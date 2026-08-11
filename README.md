# MSPI Internal Tools — Monorepo

Centralized internal tools launcher with role-based access and subdomain SSO
via shared JWT cookies. Built as a Turborepo monorepo.

## Architecture

- **Monorepo:** Turborepo + npm workspaces
- **Launcher (tools.mspi.io):** React + Vite frontend, Express backend
- **RFPU (rfpu.mspi.io):** Already live — placeholder in monorepo with shared auth
- **Shared packages:** `@mspi/shared-db` (Drizzle schema + connection), `@mspi/shared-auth` (JWT middleware)
- **Database:** MySQL, one shared DB across all apps
- **Auth:** Custom JWT httpOnly cookie at root domain (`.mspi.io`) for cross-subdomain SSO

## Prerequisites

- Node.js 18+
- MySQL database
- Turborepo (`npx turbo` or `npm install -g turbo`)

## Environment Variables

### Launcher Backend (`apps/launcher/backend/.env`)

```
DATABASE_URL=mysql://user:password@host:port/mspi_tools
JWT_SECRET=your-secret-key-change-in-production
ALLOWED_EMAIL_DOMAIN=mspi.io
COOKIE_DOMAIN=.mspi.io
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

### RFPU Backend (`apps/rfpu/backend/.env`)

```
PORT=3001
JWT_SECRET=your-secret-key-change-in-production
COOKIE_DOMAIN=.mspi.io
NODE_ENV=development
FRONTEND_URL=http://localhost:5180
```

## Setup

```bash
# Install all dependencies (root)
npm install

# Push DB schema and seed initial data
npm run db:push
npm run seed

# Start all dev servers
npm run dev
```

This starts:
- Launcher backend on `:3000`
- Launcher frontend on `:5173`
- RFPU backend on `:3001`
- RFPU frontend on `:5180`

To run a single app's dev server:
```bash
npm run dev -w @mspi/launcher-backend
npm run dev -w @mspi/launcher-frontend
```

## Default Admin Account (after seeding)

- Email: `admin@mspi.io`
- Password: `admin123`

## Adding New Tools

1. Log in as Admin on the launcher
2. Go to **Tools** in the nav
3. Click **Add tool**, fill in the URL and details
4. Assign the tool to appropriate roles

New tools appear on the launcher dashboard for users with matching roles.

## Adding a New App to the Monorepo

1. Create `apps/your-app/backend/` and `apps/your-app/frontend/`
2. In the backend, add `@mspi/shared-auth` as a dependency
3. Use `authenticateToken` middleware from `@mspi/shared-auth` for protected routes
4. Use connection/schema from `@mspi/shared-db` if DB access is needed
5. Register the app's URL in the launcher's tools table via the admin panel

## Cookie-Based SSO

The JWT token is set as an httpOnly cookie with `Domain=.mspi.io`. Any subdomain
reads the same session cookie, enabling seamless redirects between tools without
re-authentication.

The `authenticateToken` middleware in `packages/shared-auth/src/index.ts` works
in any Express backend with zero modification — just install `@mspi/shared-auth`
and use it.

## Deployment

Each app deploys independently to its own subdomain:

```bash
# Build everything
npm run build

# Deploy each app's dist/ to its respective host
# Backend: host the backend/src with Node on Hostinger
# Frontend: host dist/ as static files
```

## Available Tools

- **Site Monitor** (`/rfpu`) — real-time RFPU deployment monitoring
- **PCount** (`/pcount`) — product counting sessions
- **ReFormat** (`/reformat`) — Excel/CSV column remapping
- **Label Maker** (`/consumables`) — consumables expiry labels
- **PDF Extractor** (`/pdf-extractor`) — drag-and-drop AWB/invoice PDFs; extracts invoice ref, HAWB, amount, delivery date and qty via OCR (tesseract.js), files them by month, logs to the `awb_log` table (Received Date is blank by design). Copy or export the results as Excel. A local inbox watcher is available via `npm run watch:pdf-extractor -w backend`. See `vault/Tool - PDF Extractor.md`.

## Project Structure

```
mspi-tools/
├── turbo.json
├── package.json              # Workspace root
├── apps/
│   ├── launcher/
│   │   ├── backend/          # Express server (tools.mspi.io)
│   │   │   ├── src/
│   │   │   │   ├── routes/   # auth, tools, admin
│   │   │   │   ├── seed.ts
│   │   │   │   └── index.ts
│   │   │   └── drizzle.config.ts
│   │   └── frontend/         # React + Vite
│   │       ├── src/
│   │       │   ├── components/
│   │       │   ├── lib/
│   │       │   ├── pages/
│   │       │   └── App.tsx
│   │       └── vite.config.ts
│   └── rfpu/
│       ├── backend/          # Express server (rfpu.mspi.io)
│       └── frontend/         # Placeholder React app
├── packages/
│   ├── shared-auth/          # authenticateToken middleware
│   ├── shared-db/            # Drizzle schema + connection
│   └── shared-config/        # Shared tsconfig base
└── README.md
```

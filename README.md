# MSPI Tools

Internal operations platform for `tools.mspi.io`, built for secure, role-based access to MSPI workflows.

## What it provides

- **Launcher** — role-aware access to internal tools
- **PCount** — collaborative product counting with live WebSocket updates
- **ReFormat** — Excel/CSV column mapping and export
- **Consumables** — consumable master data and label workflows
- **PDF Extractor** — PDF upload, OCR extraction, validation, filing, and AWB logging
- **Site Monitor** — RFPU deployment and health monitoring
- **Chrome Extension — Work Permit Autofill** — standalone Chrome extension for approved personal-email Chrome users
- **Admin** — users, roles, tool access, password resets, and audit events

## Architecture

- React + Vite frontend
- Express + TypeScript backend
- MySQL with Drizzle ORM
- JWT authentication in secure HTTP-only cookies
- Token-version revocation for password changes and resets
- Helmet security headers, request throttling, structured logging, and audit logging
- PDF magic-byte validation before processing
- Shared API cache with stale-while-revalidate behavior for fast navigation

## Requirements

- Node.js 18+
- MySQL 8+
- npm 10+

## Local development

Install dependencies:

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..
```

Configure `backend/.env`:

```env
DATABASE_URL=mysql://user:password@host:port/database
JWT_SECRET=replace-with-a-long-random-secret
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=use-a-unique-password-at-least-6-characters
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
COOKIE_DOMAIN=
# Optional: Google Sheets OAuth callback for Frontline Monitor
GOOGLE_SHEETS_REDIRECT_URI=http://localhost:3001/api/frontline/google/callback
```

Start the frontend and backend:

```bash
npm run dev
```

Run validation builds:

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

Apply the reviewed database migration:

```bash
npx drizzle-kit migrate --config=./backend/drizzle.config.ts
```

## Project structure

```text
mspi-tools/
├── backend/
│   ├── src/
│   │   ├── auth.ts
│   │   ├── db/
│   │   ├── pdf-extractor/
│   │   ├── pcount/
│   │   └── routes/
│   └── drizzle/
├── frontend/
│   └── src/
│       ├── components/
│       ├── lib/
│       └── pages/
├── workpermit-extension/       # Standalone Chrome extension
│   ├── manifest.json
│   ├── content/
│   ├── popup/
│   └── README.md
├── .github/
│   ├── dependabot.yml
│   └── workflows/
└── vault/
```

## Security and deployment

- Production builds and deployments are scoped to `tools.mspi.io`.
- Do not commit `.env` files, credentials, JWT secrets, or customer data.
- PDF uploads are checked by file signature, not only filename extension.
- Authentication changes invalidate previously issued tokens when required.
- CI runs TypeScript/build validation and high-severity dependency auditing.
- Dependabot monitors npm dependencies.

## Adding a tool

Prefer adding a focused domain module to the existing backend and frontend rather than creating a separate application. New tools should use the shared authentication, database access, audit logging, API cache, and restrained visual system.

## Chrome Extension

**Work Permit Autofill** is a separate browser tool, not a web route. It is intended only for approved users using Chrome with a personal email profile. Install it manually through `chrome://extensions` using **Developer mode → Load unpacked**. See [`workpermit-extension/README.md`](workpermit-extension/README.md) for the complete steps and restrictions.

Before opening a pull request, verify:

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

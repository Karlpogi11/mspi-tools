# Architecture Overview

This project implements the internal tools hub for MSPI (`tools.mspi.io`). 

Initially, it was built as a Turborepo monorepo with multiple independent workspaces under `apps/` and `packages/`. It has since been **restructured into a flat layout** comprising a single unified `backend/` and `frontend/` directory to simplify development, dependency management, and deployment.

---

## 🛠️ The Flat Layout

```mermaid
graph TD
    Root[mspi-tools/ root] --> Backend[backend/]
    Root --> Frontend[frontend/]
    
    Backend --> B_Src[src/]
    B_Src --> B_Auth[auth.ts - Inlined shared-auth]
    B_Src --> B_DB[db/ - Inlined shared-db]
    B_Src --> B_PCount[pcount/]
    B_Src --> B_Reformat[reformat/]
    B_Src --> B_RFPU[rfpu/]
    B_Src --> B_Consumables[consumables/]
    B_Src --> B_PdfExtractor[pdf-extractor/]
    B_Src --> B_Applecare[applecare/ - Gmail packing lists]
    B_Src --> B_Frontline[frontline/ - Sheets monitor]
    B_Src --> B_Endorse[endorsements/ - queue]
    B_Src --> B_Storage[storage-locator/ - cabinets]
    B_Src --> B_Parts[parts/ - inventory + sheet log]
    B_Src --> B_Routes[routes/ - Auth/Admin/Tools]
    
    Frontend --> F_Src[src/]
    F_Src --> F_Components[components/]
    F_Src --> F_Pages[pages/]
    F_Src --> F_Lib[lib/]
    F_Src --> F_Hooks[hooks/]
```

### 1. Inlined Shared Libraries
The common packages from the monorepo were consolidated inside the backend:
- **`@mspi/shared-auth`** → Inlined to [backend/src/auth.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/auth.ts)
- **`@mspi/shared-db`** → Inlined to [backend/src/db/](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/db/)

### 2. Unified Express Gateway
The backend [backend/src/index.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/index.ts) is an Express server functioning as a API Gateway. It:
- Initializes the MySQL connection pool.
- Registers core middleware: CORS (supporting custom allowed origins), body parser, cookie parser, compression.
- Applies rate limiting: general `/api` limiter (600 req / 15 min) plus a strict limiter (20 req / 15 min) on `/api/frontline/sync` and `/api/pdf-extractor/extract*`.
- Mounts shared routes: Auth (`/api/auth`), Admin (`/api/admin`), and Tools management (`/api`).
- Dynamically imports and mounts tool-specific sub-routers and startup initializers:
  - `/api/pcount` (Physical Count) + `/api/pcount/admin` (admin-only session export)
  - `/api/rfpu` (RFPU Tool)
  - `/api/reformat` (Excel Reformatting)
  - `/api/consumables` (Label Maker)
  - `/api/pdf-extractor` (PDF Extractor)
  - `/api/applecare` (AppleCare packing lists, per-tool `requireToolAccess`)
  - `/api/frontline` (Frontline Monitor, mounted directly; record-level access via `frontline_user_access`)
  - `/api/endorsements` (Engineer Endorsements, `requireToolAccess('/endorsements')`)
  - `/api/storage-locator` (Storage Locator, `requireToolAccess('/storage-locator')`)
  - `/api/parts` (Parts Inventory, `requireToolAccess('/parts')`)
- Serves the frontend static bundle in production (from `backend/src/public`).

### 3. Shared React Frontend
The frontend [frontend/src/App.tsx](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/frontend/src/App.tsx) is a React Single Page Application (SPA) powered by Vite. It:
- Integrates all pages for different tools (PCount, RFPU, Reformat, Consumables, PDF Extractor, AppleCare, Frontline, Endorsements, Storage Locator, Parts Inventory) under one React Router config.
- Employs React lazy-loading (`Suspense` + `lazy`) to split bundles for optimal load times.
- Uses a unified authorization context provider (`AuthProvider` in `frontend/src/lib/auth.tsx`) to guard private routes.
- Interacts with backend API routes via a central `/api` proxy configured in `vite.config.ts`.
- Implements visual layouts (`Layout.tsx` navbar, dashboard launcher grid) with per-tool pages under `pages/<tool>/`.

At startup the backend runs `syncBuiltinToolCatalog()` ([backend/src/db/tool-catalog.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/db/tool-catalog.ts)) which registers missing built-in tools (Site Monitor, PCount, ReFormat, Label Maker, PDF Extractor, Chrome Extension, AppleCare Packing Lists, Frontline Monitor, Engineer Endorsements, Storage Locator, Parts Inventory) in the `tools` table and grants role access, without overwriting Admin-configured entries. It also removes the retired `/permit-tracker` entry (`backend/src/permit-tracker/` is empty and unmounted).

---

## 🔗 Related Notes
- [[Authentication & SSO]]
- [[Database Schema]]
- [[Tool - PCount]]
- [[Tool - Reformat]]
- [[Tool - Consumables]]
- [[Tool - PDF Extractor]]
- [[Tool - AppleCare]]
- [[Tool - Frontline Monitor]]
- [[Tool - Endorsements]]
- [[Tool - Storage Locator]]
- [[Tool - Parts Inventory]]

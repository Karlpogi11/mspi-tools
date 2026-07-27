# Adding a New Tool

This repo is a monorepo where every tool lives at `apps/<name>/{frontend,backend}`
and the launcher backend serves as a unified gateway. Below is the checklist for
adding tool #3, #4, etc.

## Checklist

### 1. Scaffold the app

```bash
mkdir -p apps/<name>/frontend/src apps/<name>/backend/src
```

Each gets its own `package.json` with `"type": "module"` and the npm workspace
name `@mspi/<name>-backend` / `@mspi/<name>-frontend`.

### 2. Backend — create `apps/<name>/backend/src/routes.ts` (or `gateway.ts`)

- Export an Express `Router` with your API routes (paths relative, no `/api/<name>` prefix — that gets added by the gateway).
- If the tool needs DB init, WebSocket, or other startup hooks, also export `async function init<Name>(server: http.Server)` and place it in a `gateway.ts` instead.

Use the existing tools as templates:
- **Plain router only** → copy `apps/rfpu/backend/src/routes.ts`
- **Router + startup hook** → copy `apps/pcount/backend/src/gateway.ts`

### 3. Backend `package.json` — add `exports` map

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "./routes": { "types": "./dist/routes.d.ts", "default": "./dist/routes.js" }
}
```

If you created a `gateway.ts`, use `"./gateway"` instead of `"./routes"`.

### 4. Register the tool in the gateway

Edit `apps/launcher/backend/src/index.ts` and add ONE entry to the `tools` array:

```ts
const tools = [
  { name: 'pcount', router: pcountRouter, hasGateway: true, init: initPcount },
  { name: 'rfpu', router: rfpuRoutes, hasGateway: false },
  { name: '<name>', router: <name>Routes, hasGateway: false }, // ← add here
];
```

If your tool has a gateway file (with `init<Name>`), set `hasGateway: true`
and add the `init` function to the object.

Then add the import at the top of the same file:

```ts
import <name>Routes from '@mspi/<name>-backend/routes';
// or for gateway-style:
import { <name>Router, init<Name> } from '@mspi/<name>-backend/gateway';
```

### 5. Launcher `package.json` — add dependency

In `apps/launcher/backend/package.json`:

```json
"@mspi/<name>-backend": "*",
```

Run `npm install` at the root.

### 6. Frontend — set Vite `base`

In `apps/<name>/frontend/vite.config.ts`, add:

```ts
base: '/tools/<name>/',
```

### 7. Frontend — React Router `basename` (if using client-side routing)

In your `<BrowserRouter>`, add:

```tsx
<BrowserRouter basename="/tools/<name>">
```

### 8. Seed the database

In `apps/launcher/backend/src/seed.ts`, add a new tool entry:

```ts
const [<name>Tool] = await db.insert(tools).values({
  name: '<Display Name>',
  url: '/tools/<name>',
  icon: '<icon-name>',
  description: '<description>',
}).$returningId();

await db.insert(roleToolAccess).values([
  { role_id: someRole.id, tool_id: <name>Tool.id },
]);
```

### 9. Root build script — add copy step

In `package.json`, update the `build:assemble` script to copy the new tool's
frontend build into the public directory:

```bash
mkdir -p apps/launcher/backend/dist/public/tools/<name> && rm -rf apps/launcher/backend/dist/public/tools/<name>/* && cp -r apps/<name>/frontend/dist/. apps/launcher/backend/dist/public/tools/<name>/
```

Also add the tsc build to `build:tool-backends`:

```bash
npm exec --workspace=@mspi/<name>-backend -- tsc
```

And the frontend build to `build:frontends`:

```bash
npm exec --workspace=@mspi/<name>-frontend -- tsc -b && npm exec --workspace=@mspi/<name>-frontend -- vite build
```

Then run `npm run build` to verify everything compiles and assembles.

---

That's it — **no changes to the Hostinger panel settings** are ever needed
again. The single build command (`npm run build`), single output directory
(`apps/launcher/backend/dist`), and single entry file (`index.js`) cover every
tool forever.

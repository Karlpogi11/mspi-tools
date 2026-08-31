# Deployment & Rules

This note covers building, running, and deploying the MSPI Internal Tools application, as well as critical constraints that must be respected during modification or deployments.

---

## 🚫 CRITICAL REGULATORY RULE

> [!CAUTION]
> ### NEVER TOUCH THE MAIN DOMAIN `mspi.io`
> - The main domain **`mspi.io`** must **NEVER** be modified, updated, or deployed to.
> - Only the subdomain **`tools.mspi.io`** may be used for builds and deployments of this internal tools repository.

---

## ⚙️ Environment Variables

### Backend Configuration (`backend/.env`)

```ini
DATABASE_URL=mysql://user:password@host:port/mspi_tools
JWT_SECRET=your-secret-key-change-in-production
ALLOWED_EMAIL_DOMAIN=mspi.io
COOKIE_DOMAIN=.mspi.io
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
```

---

## 🛠️ Development Scripts

The project uses `concurrently` in the root `package.json` to manage sub-project tasks. Execute these from the root directory:

### 1. Installation
```bash
npm install
```

### 2. Database Migration & Seeding
```bash
# Push Drizzle schema mappings to MySQL
npm run db:push

# Populate roles, core tools dashboard entries, and the configured admin account
# Requires SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env
npm run seed
```

### 3. Local Development
```bash
# Starts both frontend (port 5173) and backend API gateway (port 3000)
npm run dev
```

### 4. Compiling & Building
```bash
# Builds TypeScript files in backend and builds static files for the React application
npm run build
```

---

## 📦 Deployment Mechanism

During the build phase (`npm run build`):
1. **Frontend Assets**: Vite generates static output in `frontend/dist/`.
2. **Backend Distribution**: Backend source code compiles to `backend/dist/`.
3. **Public Directory**: The built frontend static files are served directly by the Express gateway (from `backend/dist/public/` directory).
4. **Subdomain Deployment**: The application is deployed to **`tools.mspi.io`** (e.g. hosted on Hostinger using Node.js execution for the backend while serving frontend assets).

---

## 🔗 Related Notes
- [[Index]]
- [[Architecture Overview]]
- [[Authentication & SSO]]

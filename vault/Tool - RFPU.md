# Tool - RFPU

The **Request For Price Utility (RFPU)** is an external application already deployed and hosted live on `rfpu.mspi.io`.

---

## 🏗️ Integration within the Launcher

Although RFPU operates as an independent service:
1. **Shared Authentication**: It uses the same backend JWT validation logic by checking the wildcard domain cookie (`.mspi.io`).
2. **Dashboard Placement**: RFPU is registered inside the launcher's `tools` table and shows up dynamically on the user dashboard if the user's role has permission to access it.
3. **Portal Portal Page**: The launcher includes a simple tracking layout in the unified React app under [RfpuPage.tsx](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/frontend/src/pages/RfpuPage.tsx). It acts as a site monitor check indicating that the service is live.

---

## 📡 API Endpoints
The backend [backend/src/rfpu/routes.ts](file:///Users/karlgarcia/Desktop/Dev/mspi-tools/backend/src/rfpu/routes.ts) exposes:
- **`GET /health`**: Returns `{ status: 'ok', app: 'rfpu' }`.
- **`GET /me`**: Returns the decoded JWT payload of the requester to verify their current session status.

---

## 🔗 Related Notes
- [[Architecture Overview]]
- [[Authentication & SSO]]

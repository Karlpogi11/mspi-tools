import { eq, inArray } from 'drizzle-orm';
import { getDb } from './index.js';
import { roles, tools, roleToolAccess } from './schema.js';

const BUILTIN_TOOLS = [
  { name: 'Site Monitor', url: '/rfpu', icon: 'monitor', description: 'Real-time site monitoring and performance tracking for RFPU deployments.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'Label Merger', url: '/label-merger', icon: 'merge', description: 'Quickly merge label PDFs with a standard overlay. Download and install on your Mac, then drag labels to merge.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'PCount', url: '/pcount', icon: 'clipboard', description: 'Weekly merchandise inventory — import system export, scan products, and reconcile counts.', roles: ['Admin', 'PMG', 'CSO'] },
  { name: 'ReFormat', url: '/reformat', icon: 'table', description: 'Import Excel/CSV files, map and rearrange columns, and export the reformatted result.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'Label Maker', url: '/consumables', icon: 'tag', description: 'Consumables label maker - log parts, auto-compute production/expiry from the 9D code, and print cut-out labels.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'PDF Extractor', url: '/pdf-extractor', icon: 'file', description: 'Drop or import AWB/invoice PDFs — extracts HAWB, invoice ref, amount, and delivery date, files them by month, and logs every invoice.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'Chrome Extension', url: '/chrome-extension', icon: 'extension', description: 'Install Work Permit Autofill in Chrome. For approved users with a personal-email Chrome profile only.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'AppleCare Packing Lists', url: '/applecare', icon: 'package', description: 'Connect Gmail and automatically collect AppleCare packing lists, attachments, sites, and incoming parts.', roles: ['Admin', 'PMG'] },
  { name: 'Frontline Monitor', url: '/frontline', icon: 'frontline', description: 'Podium only — review CSO frontline activity, AHT, transaction trends, and operational exceptions from Google Sheets.', roles: ['Admin'] },
  { name: 'Engineer Endorsements', url: '/endorsements', icon: 'wrench', description: 'Podium only — join the daily Engineer queue and manage customer device endorsements from Frontline Monitor.', roles: ['Admin', 'ENGR'] },
  { name: 'MSPI Pulse', url: '/pulse', icon: 'fa-bolt', description: 'Structured operational communication — endorsements, parts, releases.', roles: [] as const },
  { name: 'Storage Locator', url: '/storage-locator', icon: 'storage', description: 'Track customer units in IOS and Mac cabinet storage with verified employee IN/OUT history.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'Parts Inventory', url: '/parts', icon: 'parts', description: 'Stock Apple service parts in and out per site with serial tracking and a shared Google Sheet log.', roles: ['Admin', 'PMG', 'CSO', 'ENGR'] },
  { name: 'Pulse Messenger', url: '/messenger', icon: 'chat', description: 'Fast team chat with AR/serial smart cards, bot alerts, and Sheet + Excel backup.', roles: [] as const },
  { name: 'Desktop App', url: '/mac-app', icon: 'download', description: 'Install MSPI Pulse on macOS or Windows, or trial it as a VS Code extension.', roles: [] as const },
] as const;

const BUILTIN_ROLE_NAMES = ['Admin', 'PMG', 'CSO', 'ENGR'];
const REMOVED_BUILTIN_URLS = ['/permit-tracker'];
// Super-admin-only tools (for now): no role grants — super-admins bypass
// role checks in requireToolAccess()/my-tools, so this hides them from
// everyone else on dashboard and API while staying reversible from Admin.
const SUPER_ADMIN_ONLY_URLS = ['/messenger', '/mac-app', '/pulse', '/mspi-tools'];

/** Register missing built-ins without overwriting tools or access configured in Admin. */
export async function syncBuiltinToolCatalog() {
  const db = getDb();
  const roleRows = await db.select().from(roles).where(inArray(roles.name, BUILTIN_ROLE_NAMES));

  for (const url of REMOVED_BUILTIN_URLS) {
    const staleTools = await db.select({ id: tools.id }).from(tools).where(eq(tools.url, url));
    for (const staleTool of staleTools) {
      await db.delete(roleToolAccess).where(eq(roleToolAccess.tool_id, staleTool.id));
      await db.delete(tools).where(eq(tools.id, staleTool.id));
    }
  }

  for (const url of SUPER_ADMIN_ONLY_URLS) {
    const [tool] = await db.select({ id: tools.id }).from(tools).where(eq(tools.url, url)).limit(1);
    if (tool) await db.delete(roleToolAccess).where(eq(roleToolAccess.tool_id, tool.id));
  }

  for (const definition of BUILTIN_TOOLS) {
    let [tool] = await db.select().from(tools).where(eq(tools.url, definition.url)).limit(1);
    let isNewTool = false;
    if (!tool) {
      const { roles: _roleNames, ...toolValues } = definition;
      const [inserted] = await db.insert(tools).values(toolValues).$returningId();
      [tool] = await db.select().from(tools).where(eq(tools.id, inserted.id)).limit(1);
      isNewTool = true;
      console.log(`Registered built-in tool: ${definition.name}`);
    } else if (tool.icon !== definition.icon) {
      await db.update(tools).set({ icon: definition.icon }).where(eq(tools.id, tool.id));
    }

    if (isNewTool) {
      const defaultAccess = roleRows.filter((role) => definition.roles.some((roleName) => roleName === role.name)).map((role) => ({ role_id: role.id, tool_id: tool.id }));
      if (defaultAccess.length > 0) await db.insert(roleToolAccess).values(defaultAccess);
    }
  }
}

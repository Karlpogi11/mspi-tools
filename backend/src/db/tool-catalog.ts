import { eq, inArray } from 'drizzle-orm';
import { getDb } from './index.js';
import { roles, tools, roleToolAccess } from './schema.js';

const BUILTIN_TOOLS = [
  { name: 'Site Monitor', url: '/rfpu', icon: 'monitor', description: 'Real-time site monitoring and performance tracking for RFPU deployments.', roles: ['Admin', 'PMS', 'CSO', 'ENGR'] },
  { name: 'PCount', url: '/pcount', icon: 'clipboard', description: 'Weekly merchandise inventory — import system export, scan products, and reconcile counts.', roles: ['Admin', 'PMS', 'CSO'] },
  { name: 'ReFormat', url: '/reformat', icon: 'table', description: 'Import Excel/CSV files, map and rearrange columns, and export the reformatted result.', roles: ['Admin', 'PMS', 'CSO', 'ENGR'] },
  { name: 'Label Maker', url: '/consumables', icon: 'tag', description: 'Consumables label maker - log parts, auto-compute production/expiry from the 9D code, and print cut-out labels.', roles: ['Admin', 'PMS', 'CSO', 'ENGR'] },
  { name: 'PDF Extractor', url: '/pdf-extractor', icon: 'file', description: 'Drop or import AWB/invoice PDFs — extracts HAWB, invoice ref, amount, and delivery date, files them by month, and logs every invoice.', roles: ['Admin', 'PMS', 'CSO', 'ENGR'] },
  { name: 'Chrome Extension', url: '/chrome-extension', icon: 'extension', description: 'Install Work Permit Autofill in Chrome. For approved users with a personal-email Chrome profile only.', roles: ['Admin', 'PMS', 'CSO', 'ENGR'] },
  { name: 'AppleCare Packing Lists', url: '/applecare', icon: 'package', description: 'Connect Gmail and automatically collect AppleCare packing lists, attachments, sites, and incoming parts.', roles: ['Admin', 'PMS'] },
] as const;

const BUILTIN_ROLE_NAMES = ['Admin', 'PMS', 'CSO', 'ENGR'];

/** Add missing built-ins without overwriting tools configured in Admin. */
export async function syncBuiltinToolCatalog() {
  const db = getDb();
  const roleRows = await db.select().from(roles).where(inArray(roles.name, BUILTIN_ROLE_NAMES));

  for (const definition of BUILTIN_TOOLS) {
    let [tool] = await db.select().from(tools).where(eq(tools.url, definition.url)).limit(1);
    if (!tool) {
      const { roles: _roleNames, ...toolValues } = definition;
      const [inserted] = await db.insert(tools).values(toolValues).$returningId();
      [tool] = await db.select().from(tools).where(eq(tools.id, inserted.id)).limit(1);
      console.log(`Registered built-in tool: ${definition.name}`);
    }

    const existing = await db.select({ roleId: roleToolAccess.role_id }).from(roleToolAccess).where(eq(roleToolAccess.tool_id, tool.id));
    const existingRoleIds = new Set(existing.map((row) => row.roleId));
    const missingAccess = roleRows.filter((role) => definition.roles.some((roleName) => roleName === role.name) && !existingRoleIds.has(role.id)).map((role) => ({ role_id: role.id, tool_id: tool.id }));
    if (missingAccess.length > 0) await db.insert(roleToolAccess).values(missingAccess);
  }
}

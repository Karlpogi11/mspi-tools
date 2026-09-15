import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { initDb, getDb } from './index.js';
import { roles, users, tools, roleToolAccess } from './schema.js';

async function getOrCreateRole(name: string) {
  const db = getDb();
  const [existing] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(roles).values({ name }).$returningId();
  return created.id;
}

async function getOrCreateTool(tool: { name: string; url: string; icon: string; description: string }) {
  const db = getDb();
  const [existing] = await db.select({ id: tools.id }).from(tools).where(eq(tools.url, tool.url)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(tools).values(tool).$returningId();
  return created.id;
}

async function grantAccess(toolId: number, roleIds: number[]) {
  const db = getDb();
  for (const roleId of roleIds) {
    const [existing] = await db.select({ roleId: roleToolAccess.role_id })
      .from(roleToolAccess)
      .where(and(eq(roleToolAccess.tool_id, toolId), eq(roleToolAccess.role_id, roleId)))
      .limit(1);
    if (!existing) await db.insert(roleToolAccess).values({ tool_id: toolId, role_id: roleId });
  }
}

async function seed() {
  const adminEmail = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.SEED_ADMIN_PASSWORD || '');
  if (!adminEmail || !adminPassword) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set before seeding.');
  if (adminPassword.length < 6) throw new Error('SEED_ADMIN_PASSWORD must be at least 6 characters.');
  await initDb();
  const db = getDb();

  console.log('Seeding database...');
  const [adminRole, pmgRole, csoRole, engrRole] = await Promise.all(['Admin', 'PMG', 'CSO', 'ENGR'].map(getOrCreateRole));

  const [existingSuperAdmin] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.is_super_admin, 1)).limit(1);
  if (existingSuperAdmin) {
    console.log(`Super Admin already configured: ${existingSuperAdmin.email}`);
  } else {
    const [existingAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.email, adminEmail)).limit(1);
    if (existingAdmin) {
      await db.update(users).set({ is_super_admin: 1 }).where(eq(users.id, existingAdmin.id));
      console.log(`Existing admin promoted to Super Admin: ${adminEmail}`);
    } else {
      await db.insert(users).values({ email: adminEmail, password_hash: await bcrypt.hash(adminPassword, 12), full_name: 'Admin User', role_id: adminRole, is_super_admin: 1 });
      console.log(`Super Admin user created: ${adminEmail}`);
    }
  }

  const definitions = [
    { name: 'Site Monitor', url: '/rfpu', icon: 'monitor', description: 'Real-time site monitoring and performance tracking for RFPU deployments.', roles: [pmgRole, csoRole, engrRole] },
    { name: 'PCount', url: '/pcount', icon: 'clipboard', description: 'Product counting and inventory management tool.', roles: [pmgRole, csoRole] },
    { name: 'ReFormat', url: '/reformat', icon: 'table', description: 'Import Excel/CSV files, map and rearrange columns, and export the reformatted result.', roles: [pmgRole, csoRole, engrRole] },
    { name: 'Label Maker', url: '/consumables', icon: 'tag', description: 'Consumables label maker — log parts, auto-compute production/expiry from the 9D code, and print cut-out labels.', roles: [pmgRole, csoRole, engrRole] },
    { name: 'PDF Extractor', url: '/pdf-extractor', icon: 'file', description: 'Drop or import AWB/invoice PDFs — extracts HAWB, invoice ref, amount, and delivery date.', roles: [pmgRole, csoRole, engrRole] },
    { name: 'Label Merger', url: '/label-merger', icon: 'merge', description: 'Quickly merge label PDFs with a standard overlay.', roles: [pmgRole, csoRole, engrRole] },
  ];
  for (const definition of definitions) {
    const toolId = await getOrCreateTool({ name: definition.name, url: definition.url, icon: definition.icon, description: definition.description });
    await grantAccess(toolId, [adminRole, ...definition.roles]);
  }

  console.log('Seed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

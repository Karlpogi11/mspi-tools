import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { initDb, getDb } from './index.js';
import { roles, users, tools, roleToolAccess } from './schema.js';

async function seed() {
  const adminEmail = String(process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = String(process.env.SEED_ADMIN_PASSWORD || '');
  if (!adminEmail || !adminPassword) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set before seeding.');
  if (adminPassword.length < 6) throw new Error('SEED_ADMIN_PASSWORD must be at least 6 characters.');
  await initDb();
  const db = getDb();

  console.log('Seeding database...');

  const [adminRole] = await db.insert(roles).values({ name: 'Admin' }).$returningId();
  const [pmgRole] = await db.insert(roles).values({ name: 'PMG' }).$returningId();
  const [csoRole] = await db.insert(roles).values({ name: 'CSO' }).$returningId();
  const [engrRole] = await db.insert(roles).values({ name: 'ENGR' }).$returningId();

  console.log('Roles created: Admin, PMG, CSO, ENGR');

  const hash = await bcrypt.hash(adminPassword, 12);
  await db.insert(users).values({
    email: adminEmail,
    password_hash: hash,
    full_name: 'Admin User',
    role_id: adminRole.id,
  });

  console.log(`Admin user created: ${adminEmail}`);

  const [rfpuTool] = await db.insert(tools).values({
    name: 'Site Monitor',
    url: '/rfpu',
    icon: 'monitor',
    description: 'Real-time site monitoring and performance tracking for RFPU deployments.',
  }).$returningId();

  console.log('Tool created: Site Monitor (/rfpu)');

  await db.insert(roleToolAccess).values([
    { role_id: pmgRole.id, tool_id: rfpuTool.id },
    { role_id: csoRole.id, tool_id: rfpuTool.id },
    { role_id: engrRole.id, tool_id: rfpuTool.id },
  ]);

  console.log('Site Monitor assigned to PMG, CSO, and ENGR roles');

  const [pcountTool] = await db.insert(tools).values({
    name: 'PCount',
    url: '/pcount',
    icon: 'clipboard',
    description: 'Product counting and inventory management tool.',
  }).$returningId();

  console.log('Tool created: PCount (/pcount)');

  await db.insert(roleToolAccess).values([
    { role_id: pmgRole.id, tool_id: pcountTool.id },
    { role_id: csoRole.id, tool_id: pcountTool.id },
  ]);

  console.log('PCount assigned to PMG and CSO roles');

  await db.insert(roleToolAccess).values([
    { role_id: adminRole.id, tool_id: rfpuTool.id },
    { role_id: adminRole.id, tool_id: pcountTool.id },
  ]);

  console.log('Site Monitor and PCount assigned to Admin role');

  const [reformatTool] = await db.insert(tools).values({
    name: 'ReFormat',
    url: '/reformat',
    icon: 'table',
    description: 'Import Excel/CSV files, map and rearrange columns, and export the reformatted result.',
  }).$returningId();

  console.log('Tool created: ReFormat (/reformat)');

  await db.insert(roleToolAccess).values([
    { role_id: pmgRole.id, tool_id: reformatTool.id },
    { role_id: csoRole.id, tool_id: reformatTool.id },
    { role_id: engrRole.id, tool_id: reformatTool.id },
    { role_id: adminRole.id, tool_id: reformatTool.id },
  ]);

  console.log('ReFormat assigned to PMG, CSO, ENGR, and Admin roles');

  const [consumablesTool] = await db.insert(tools).values({
    name: 'Label Maker',
    url: '/consumables',
    icon: 'tag',
    description: 'Consumables label maker — log parts, auto-compute production/expiry from the 9D code, and print cut-out labels.',
  }).$returningId();

  console.log('Tool created: Label Maker (/consumables)');

  await db.insert(roleToolAccess).values([
    { role_id: pmgRole.id, tool_id: consumablesTool.id },
    { role_id: csoRole.id, tool_id: consumablesTool.id },
    { role_id: engrRole.id, tool_id: consumablesTool.id },
    { role_id: adminRole.id, tool_id: consumablesTool.id },
  ]);

  console.log('Label Maker assigned to PMG, CSO, ENGR, and Admin roles');

  const [pdfExtractorTool] = await db.insert(tools).values({
    name: 'PDF Extractor',
    url: '/pdf-extractor',
    icon: 'file',
    description: 'Drop or import AWB/invoice PDFs — extracts HAWB, invoice ref, amount, and delivery date, files them by month, and logs every invoice.',
  }).$returningId();

  console.log('Tool created: PDF Extractor (/pdf-extractor)');

  await db.insert(roleToolAccess).values([
    { role_id: pmgRole.id, tool_id: pdfExtractorTool.id },
    { role_id: csoRole.id, tool_id: pdfExtractorTool.id },
    { role_id: engrRole.id, tool_id: pdfExtractorTool.id },
    { role_id: adminRole.id, tool_id: pdfExtractorTool.id },
  ]);

  console.log('PDF Extractor assigned to PMG, CSO, ENGR, and Admin roles');
  console.log('\nSeed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

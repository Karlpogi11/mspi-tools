import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { initDb, getDb } from '@mspi/shared-db';
import { roles, users, tools, roleToolAccess } from '@mspi/shared-db/schema';

async function seed() {
  await initDb();
  const db = getDb();

  console.log('Seeding database...');

  const [adminRole] = await db.insert(roles).values({ name: 'Admin' }).$returningId();
  const [pmsRole] = await db.insert(roles).values({ name: 'PMS' }).$returningId();
  const [csoRole] = await db.insert(roles).values({ name: 'CSO' }).$returningId();
  const [engrRole] = await db.insert(roles).values({ name: 'ENGR' }).$returningId();

  console.log('Roles created: Admin, PMS, CSO, ENGR');

  const hash = await bcrypt.hash('admin123', 12);
  await db.insert(users).values({
    email: 'admin@mspi.io',
    password_hash: hash,
    full_name: 'Admin User',
    role_id: adminRole.id,
  });

  console.log('Admin user created: admin@mspi.io / admin123');

  const [rfpuTool] = await db.insert(tools).values({
    name: 'Site Monitor',
    url: '/tools/rfpu',
    icon: 'monitor',
    description: 'Real-time site monitoring and performance tracking for RFPU deployments.',
  }).$returningId();

  console.log('Tool created: Site Monitor (/tools/rfpu)');

  await db.insert(roleToolAccess).values([
    { role_id: pmsRole.id, tool_id: rfpuTool.id },
    { role_id: csoRole.id, tool_id: rfpuTool.id },
    { role_id: engrRole.id, tool_id: rfpuTool.id },
  ]);

  console.log('Site Monitor assigned to PMS, CSO, and ENGR roles');

  const [pcountTool] = await db.insert(tools).values({
    name: 'PCount',
    url: '/tools/pcount',
    icon: 'clipboard',
    description: 'Product counting and inventory management tool.',
  }).$returningId();

  console.log('Tool created: PCount (/tools/pcount)');

  await db.insert(roleToolAccess).values([
    { role_id: pmsRole.id, tool_id: pcountTool.id },
    { role_id: csoRole.id, tool_id: pcountTool.id },
  ]);

  console.log('PCount assigned to PMS and CSO roles');
  console.log('\nSeed complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

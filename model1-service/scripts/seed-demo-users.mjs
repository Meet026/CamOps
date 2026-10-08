// seed-demo-users.mjs — inserts the 4 demo accounts
// Run with: node scripts/seed-demo-users.mjs

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const PASSWORD = 'Sentinel@2026';

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  console.log('Password hash generated.');

  // Ensure a "Police" department exists for field_officer and dept_viewer
  let dept = await prisma.department.findFirst({ where: { code: 'POLICE' } });
  if (!dept) {
    dept = await prisma.department.create({
      data: { name: 'Home Department (Police)', code: 'POLICE' },
    });
    console.log(`Created department: ${dept.name} (${dept.departmentId})`);
  } else {
    console.log(`Using existing department: ${dept.name} (${dept.departmentId})`);
  }

  const users = [
    {
      email: 'admin.demo@sentinel.local',
      role: 'admin',
      departmentId: null,
    },
    {
      email: 'officer.demo@sentinel.local',
      role: 'field_officer',
      departmentId: dept.departmentId,
    },
    {
      email: 'viewer.demo@sentinel.local',
      role: 'dept_viewer',
      departmentId: dept.departmentId,
    },
    {
      email: 'auditor.demo@sentinel.local',
      role: 'auditor',
      departmentId: null,
    },
  ];

  for (const u of users) {
    const existing = await prisma.appUser.findUnique({ where: { email: u.email } });
    if (existing) {
      // Update password hash in case it changed
      await prisma.appUser.update({
        where: { email: u.email },
        data: { passwordHash: hash },
      });
      console.log(`Updated (already existed): ${u.email}`);
    } else {
      await prisma.appUser.create({
        data: {
          email: u.email,
          passwordHash: hash,
          role: u.role,
          departmentId: u.departmentId,
        },
      });
      console.log(`Created: ${u.email}  [${u.role}]`);
    }
  }

  console.log('\nAll demo users ready. Login with password: Sentinel@2026');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

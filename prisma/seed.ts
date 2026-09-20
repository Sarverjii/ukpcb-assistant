// Loaded directly by `tsx` (see package.json "db:seed") — unlike the Next.js
// app itself, tsx doesn't auto-load .env, so this must do it explicitly.
//
// IMPORTANT: dependent modules are imported dynamically INSIDE main(),
// after dotenv.config() runs. Static ES module imports are all resolved and
// evaluated before any of this file's own top-level statements — including
// a plain dotenv.config() call — regardless of source order, so a static
// `import { prisma } from '../lib/db/prisma'` here would load lib/config.ts
// (which reads env vars at import time) before dotenv had populated them.
// Dynamic import() is not hoisted, so it runs after dotenv.config() as
// written.
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

const ADMIN_EMAIL = 'admin@ukpcb.gov.in';
const ADMIN_PASSWORD = 'Password123!';

// Deliberately seeds ONLY the role hierarchy (organizational configuration)
// and a single Member Secretary admin account — no demo employees, no
// fixture documents. The Member Secretary logs in and adds real
// employees/documents themselves through the admin dashboard. (The full
// multi-user, multi-document fixture set used to prove the authorization
// boundary still exists in scripts/seed-authz-fixtures.ts — that's used
// only by tests/authz.test.ts against the separate test database, never
// this dev seed.)
async function main() {
  const { seedRoles } = await import('../scripts/seed-authz-fixtures');
  const { prisma } = await import('../lib/db/prisma');
  const { hashPassword } = await import('../lib/auth/password');

  await seedRoles();

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'Member Secretary' } });
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  // Every employee must belong to at least one department (see
  // lib/db/queries/departments.ts's requireNonEmptyDepartments) — the
  // seeded admin is no exception. Connected to every department that
  // exists at seed time (normally all of them: the departments migration
  // seeds a default set before this ever runs) rather than just one,
  // since an org-wide admin account plausibly belongs everywhere and this
  // avoids an arbitrary pick among equals.
  const departments = await prisma.department.findMany({ select: { id: true } });
  if (departments.length === 0) {
    console.warn('No departments exist yet — the seeded admin has none either; assign one from Admin → Departments before it can be used for anything department-gated.');
  }

  // Unlike departments, location is a mandatory SINGLE scalar (User.locationId
  // — see its schema.prisma comment) with no "belongs everywhere" umbrella
  // option: a document tagged Location A is invisible to anyone whose own
  // location isn't A, admin included, with no bypass. The seeded admin gets
  // whichever location sorts first (normally "Location A", seeded by the
  // locations migration) purely as an arbitrary but valid starting point —
  // reassign it from Admin → Employees if that's not the right one.
  const firstLocation = await prisma.location.findFirst({ orderBy: { name: 'asc' } });
  if (!firstLocation) {
    throw new Error('No locations exist yet — the locations migration should have seeded Location A-E before this runs.');
  }

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      email: ADMIN_EMAIL,
      name: 'Member Secretary Admin',
      passwordHash,
      roleId: adminRole.id,
      status: 'ACTIVE',
      departments: { connect: departments.map((d) => ({ id: d.id })) },
      locationId: firstLocation.id,
    },
  });

  console.log('Seeded the role hierarchy and one Member Secretary admin account.');
  console.log(`  ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log('No demo employees or documents were seeded — add your own via /admin.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

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

const CXO_EMAIL = 'cxo@evon.com';
const CXO_PASSWORD = 'Password123!';

// Deliberately seeds ONLY the role hierarchy (organizational configuration)
// and a single CXO admin account — no demo employees, no fixture documents.
// The CXO logs in and adds real employees/documents themselves through the
// admin dashboard. (The full multi-user, multi-document fixture set used to
// prove the authorization boundary still exists in
// scripts/seed-authz-fixtures.ts — that's used only by tests/authz.test.ts
// against the separate test database, never this dev seed.)
async function main() {
  const { seedRoles } = await import('../scripts/seed-authz-fixtures');
  const { prisma } = await import('../lib/db/prisma');
  const { hashPassword } = await import('../lib/auth/password');

  await seedRoles();

  const cxoRole = await prisma.role.findUniqueOrThrow({ where: { name: 'CXO' } });
  const passwordHash = await hashPassword(CXO_PASSWORD);

  await prisma.user.upsert({
    where: { email: CXO_EMAIL },
    update: {},
    create: {
      email: CXO_EMAIL,
      name: 'CXO Admin',
      passwordHash,
      roleId: cxoRole.id,
      status: 'ACTIVE',
    },
  });

  console.log('Seeded the role hierarchy and one CXO admin account.');
  console.log(`  ${CXO_EMAIL} / ${CXO_PASSWORD}`);
  console.log('No demo employees or documents were seeded — add your own via /admin.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

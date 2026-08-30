import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '@/lib/config';

// Prisma 7: a driver adapter is required (prisma/schema.prisma's datasource
// no longer carries a `url`) — see prisma7.config.ts for the CLI/migration
// side of this same split.
function createPrismaClient() {
  const adapter = new PrismaPg(config.DATABASE_URL);
  return new PrismaClient({ adapter });
}

// Standard Next.js dev-mode singleton: without this, every hot-reload would
// create a fresh PrismaClient (and a fresh connection pool) on top of the
// last one.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

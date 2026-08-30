// Prisma 7 config file (the CLI looks for this exact filename — see
// prisma/schema.prisma's datasource comment). Used by `prisma migrate`,
// `prisma db seed`, etc. — the Next.js app itself does not read this file;
// it constructs its own PrismaClient with an explicit adapter/url in
// lib/db/prisma.ts, loaded through Next's own env handling.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});

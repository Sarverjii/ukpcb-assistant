import { prisma } from '@/lib/db/prisma';

/** Every past bulk-import upload, newest first — see EmployeeImportBatch's schema.prisma comment. */
export function listImportBatches() {
  return prisma.employeeImportBatch.findMany({
    include: { uploadedBy: { select: { name: true } } },
    orderBy: { uploadedAt: 'desc' },
  });
}

export function getImportBatchById(id: string) {
  return prisma.employeeImportBatch.findUniqueOrThrow({ where: { id } });
}

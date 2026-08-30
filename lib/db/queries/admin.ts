import { prisma } from '@/lib/db/prisma';

export async function getDashboardOverview() {
  const [
    totalEmployees,
    activeUsers,
    totalDocuments,
    documentsByClearance,
    aiQuestionsAsked,
    recentActivity,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.document.count(),
    prisma.document.groupBy({
      by: ['clearanceLevel'],
      _count: { _all: true },
      orderBy: { clearanceLevel: 'desc' },
    }),
    prisma.auditLog.count({ where: { action: 'CHAT_QUERY' } }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 15,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  return {
    totalEmployees,
    activeUsers,
    totalDocuments,
    documentsByClearance,
    aiQuestionsAsked,
    recentActivity,
  };
}

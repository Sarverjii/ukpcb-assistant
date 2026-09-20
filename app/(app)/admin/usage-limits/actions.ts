'use server';

import { revalidatePath } from 'next/cache';
import { getAuthContext } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/rbac';
import { logAuditEvent } from '@/lib/audit/log';
import { getOrgUsagePolicy, updateOrgUsagePolicy, updatePublicOrgUsagePolicy } from '@/lib/db/queries/usage';

export type ActionResult = { error?: string };

/**
 * Sets the company-wide daily message ceiling — the final circuit
 * breaker (see OrgUsagePolicy's own schema comment). Deliberately no
 * "unlimited" option, same as every other level of this feature.
 */
export async function setOrgMessageLimitAction(limit: number): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (!Number.isInteger(limit) || limit < 1) {
    return { error: 'Daily message limit must be a positive whole number.' };
  }

  const before = await getOrgUsagePolicy();
  await updateOrgUsagePolicy(limit, ctx.userId);

  await logAuditEvent({
    action: 'USAGE_LIMIT_CONFIG_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    metadata: { scope: 'ORG', oldLimit: before.dailyMessageLimit, newLimit: limit },
  });

  revalidatePath('/admin/usage-limits');
  return {};
}

/**
 * Sets the public (unauthenticated) chat's own daily message ceiling —
 * a separate pool from setOrgMessageLimitAction above, which only ever
 * governs employee usage (see OrgUsagePolicy.publicDailyMessageLimit's own
 * comment). Same "no unlimited" rule.
 */
export async function setPublicOrgMessageLimitAction(limit: number): Promise<ActionResult> {
  const ctx = await getAuthContext();
  await requireAdmin(ctx);

  if (!Number.isInteger(limit) || limit < 1) {
    return { error: 'Daily message limit must be a positive whole number.' };
  }

  const before = await getOrgUsagePolicy();
  await updatePublicOrgUsagePolicy(limit, ctx.userId);

  await logAuditEvent({
    action: 'USAGE_LIMIT_CONFIG_CHANGED',
    result: 'SUCCESS',
    userId: ctx.userId,
    metadata: { scope: 'PUBLIC_ORG', oldLimit: before.publicDailyMessageLimit, newLimit: limit },
  });

  revalidatePath('/admin/usage-limits');
  return {};
}

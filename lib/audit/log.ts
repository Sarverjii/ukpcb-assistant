import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_PROCESSED'
  | 'DOCUMENT_CLEARANCE_CHANGED'
  | 'DOCUMENT_DEPARTMENTS_CHANGED'
  | 'DOCUMENT_REPLACED'
  | 'DOCUMENT_DELETED'
  | 'DOCUMENT_DOWNLOADED'
  | 'CHAT_QUERY'
  | 'CITATION_PREVIEWED'
  | 'CONVERSATION_DELETED'
  | 'EMPLOYEE_CREATED'
  | 'EMPLOYEE_ROLE_CHANGED'
  | 'EMPLOYEE_STATUS_CHANGED'
  | 'EMPLOYEE_PASSWORD_RESET'
  | 'EMPLOYEE_CONVERSATIONS_VIEWED'
  | 'EMPLOYEE_REMOVED'
  | 'EMPLOYEE_DELETED'
  | 'EMPLOYEE_BULK_IMPORTED'
  | 'EMPLOYEE_ROSTER_EXPORTED'
  | 'EMPLOYEE_DEPARTMENTS_CHANGED'
  | 'DEPARTMENT_CREATED'
  | 'DEPARTMENT_RENAMED'
  | 'DEPARTMENT_DELETED'
  | 'DEPARTMENT_HEAD_FLAG_CHANGED'
  | 'DEPARTMENT_MEMBER_ADDED'
  | 'DEPARTMENT_MEMBER_REMOVED'
  | 'ADMIN_REAUTH_FAILED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_CHANGE_FAILED'
  | 'ROLE_CREATED'
  | 'ROLE_HIERARCHY_CHANGED'
  | 'ACCESS_DENIED';

export type AuditResult = 'SUCCESS' | 'DENIED' | 'ERROR';

export async function logAuditEvent(event: {
  action: AuditAction;
  result: AuditResult;
  userId?: string;
  resource?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
}): Promise<void> {
  // Audit logging must never block or fail the request it's describing —
  // swallow errors after logging to the server console so a DB hiccup on
  // the audit table can't take down login/chat/upload.
  try {
    await prisma.auditLog.create({
      data: {
        action: event.action,
        result: event.result,
        userId: event.userId,
        resource: event.resource,
        metadata: event.metadata,
        ipAddress: event.ipAddress,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log entry', event, err);
  }
}

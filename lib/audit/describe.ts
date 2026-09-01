import type { Prisma } from '@prisma/client';

/**
 * Turns one audit log entry into a plain-English sentence — "deleted a
 * document, resource abc123" told an admin nothing they could act on;
 * "CXO Admin deleted document 'Case Study - Julius'" does. Relies entirely
 * on metadata captured at write time (see each action's own logAuditEvent
 * call) — this never re-fetches the entity the entry is about, since by
 * the time someone's reading the log it may well be gone (that's exactly
 * the case a deletion entry needs to survive).
 *
 * `roleNameByRank` resolves a raw clearanceLevel number (rank) to its
 * role's current name, e.g. clearance level 3 → "Architect" — falls back
 * to "level N" if the rank isn't found (the role itself may have since
 * been renamed or removed).
 */
export function describeAuditEvent(
  action: string,
  metadata: Prisma.JsonValue,
  resource: string | null,
  roleNameByRank: Map<number, string>,
): string {
  const m = (metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}) as Record<
    string,
    unknown
  >;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  const roleName = (rank: unknown): string => {
    const n = num(rank);
    return n === null ? 'an unknown level' : (roleNameByRank.get(n) ?? `level ${n}`);
  };
  const truncate = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  switch (action) {
    case 'LOGIN':
      return 'Signed in';
    case 'LOGIN_FAILED':
      return str(m.email) ? `Failed sign-in attempt for ${m.email}` : 'Failed sign-in attempt';
    case 'LOGOUT':
      return 'Signed out';

    case 'DOCUMENT_UPLOAD': {
      const name = str(m.name);
      return name ? `Uploaded document "${name}" at ${roleName(m.clearanceLevel)} clearance` : 'Uploaded a document';
    }
    case 'DOCUMENT_PROCESSED': {
      const count = num(m.chunkCount);
      const error = str(m.error);
      if (error) return `Document processing failed: ${truncate(error)}`;
      return count !== null ? `Finished indexing a document (${count} chunk${count === 1 ? '' : 's'})` : 'Finished indexing a document';
    }
    case 'DOCUMENT_CLEARANCE_CHANGED': {
      const name = str(m.documentName);
      const label = name ? `"${name}"` : 'a document';
      if (m.previousClearanceLevel !== undefined && m.newClearanceLevel !== undefined) {
        return `Changed ${label} clearance from ${roleName(m.previousClearanceLevel)} to ${roleName(m.newClearanceLevel)}`;
      }
      return `Changed ${label} clearance to ${roleName(m.newClearanceLevel)}`;
    }
    case 'DOCUMENT_REPLACED': {
      const name = str(m.documentName);
      return name ? `Replaced the file for "${name}"` : 'Replaced a document’s file';
    }
    case 'DOCUMENT_DELETED': {
      const name = str(m.documentName);
      return name ? `Deleted document "${name}"` : 'Deleted a document';
    }
    case 'DOCUMENT_DOWNLOADED': {
      const name = str(m.documentName);
      return name ? `Downloaded "${name}"` : 'Downloaded a document';
    }

    case 'CHAT_QUERY': {
      const q = str(m.question);
      if (!q) return 'Asked a question in chat';
      return m.gotNoAuthorizedInfoAnswer === true
        ? `Asked (no answer found): "${truncate(q)}"`
        : `Asked: "${truncate(q)}"`;
    }
    case 'CITATION_PREVIEWED': {
      const name = str(m.documentName);
      return name ? `Previewed a citation from "${name}"` : 'Previewed a citation';
    }
    case 'CONVERSATION_DELETED': {
      const title = str(m.conversationTitle);
      const count = num(m.messageCount);
      const suffix = count !== null ? ` (${count} message${count === 1 ? '' : 's'})` : '';
      return title ? `Deleted conversation "${title}"${suffix}` : `Deleted an untitled conversation${suffix}`;
    }

    case 'EMPLOYEE_CREATED': {
      const name = str(m.employeeName);
      const role = str(m.roleName);
      if (name && role) return `Created employee ${name} (${role})`;
      return name ? `Created employee ${name}` : 'Created an employee';
    }
    case 'EMPLOYEE_ROLE_CHANGED': {
      const name = str(m.employeeName) ?? 'an employee';
      const prev = str(m.previousRoleName);
      const next = str(m.newRoleName);
      if (prev && next) return `Changed ${name}'s role from ${prev} to ${next}`;
      return next ? `Changed ${name}'s role to ${next}` : `Changed ${name}'s role`;
    }
    case 'EMPLOYEE_STATUS_CHANGED': {
      const name = str(m.employeeName) ?? 'an employee';
      return m.newStatus === 'ACTIVE' ? `Re-enabled ${name}'s account` : `Disabled ${name}'s account`;
    }
    case 'EMPLOYEE_PASSWORD_RESET': {
      const name = str(m.employeeName);
      return name ? `Reset the password for ${name}` : 'Reset an employee’s password';
    }
    case 'EMPLOYEE_CONVERSATIONS_VIEWED': {
      const name = str(m.employeeName);
      const count = num(m.conversationCount);
      return name ? `Viewed ${name}'s conversations (${count ?? 0})` : "Viewed an employee's conversations";
    }

    case 'PASSWORD_CHANGED':
      return 'Changed their own password';
    case 'PASSWORD_CHANGE_FAILED':
      return 'Failed attempt to change their own password';

    case 'ROLE_CREATED': {
      const name = str(m.name);
      return name ? `Created role "${name}"` : 'Created a role';
    }
    case 'ROLE_HIERARCHY_CHANGED': {
      const role = str(m.roleName) ?? 'a role';
      if (str(m.direction) && str(m.swappedWithRoleName)) {
        return `Moved "${role}" ${m.direction} in the hierarchy (past "${m.swappedWithRoleName}")`;
      }
      if (m.field === 'canUploadDocuments') {
        return `${m.newValue ? 'Granted' : 'Revoked'} document upload rights for "${role}"`;
      }
      if (m.field === 'isAdmin') {
        return `${m.newValue ? 'Granted' : 'Revoked'} admin dashboard access for "${role}"`;
      }
      return `Changed "${role}"'s settings`;
    }

    case 'ACCESS_DENIED': {
      if (resource === 'admin') return 'Blocked: tried to open the admin dashboard without access';
      if (resource === 'documents:upload') return 'Blocked: tried to upload a document without permission';
      if (resource === 'documents:manage') return 'Blocked: tried to manage a document above their clearance';
      return resource ? `Blocked: access denied for ${resource}` : 'Blocked: access denied';
    }

    default:
      return action
        .toLowerCase()
        .split('_')
        .map((w) => w[0]?.toUpperCase() + w.slice(1))
        .join(' ');
  }
}

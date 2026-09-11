/**
 * Composes the {to, subject, body} of every employee-lifecycle email as
 * plain data — nothing here actually sends anything. This is a deliberate
 * seam, mirroring how lib/llm's LLMProvider interface abstracts model
 * calls: every admin action that used to display a raw temp password now
 * returns one of these composed objects instead, and the UI renders it in
 * an "email preview" modal ("MAIL TO BE SENT ON — {to}") rather than a mail
 * client actually sending it. Wiring in a real transport later (Resend,
 * SES, etc.) means writing one function that takes this same {to, subject,
 * body} shape and actually calls out — no call site above this file needs
 * to change.
 */

export type ComposedEmail = {
  to: string;
  subject: string;
  body: string;
};

const SIGN_OFF = '\n\n— UKPCB Assistant';

export function composeWelcomeEmail(input: {
  name: string;
  email: string;
  tempPassword: string;
  roleName: string;
}): ComposedEmail {
  return {
    to: input.email,
    subject: 'Your UKPCB Assistant account has been created',
    body:
      `Hi ${input.name},\n\n` +
      `A UKPCB Assistant account has been created for you at ${input.roleName} clearance.\n\n` +
      `Email: ${input.email}\n` +
      `Temporary password: ${input.tempPassword}\n\n` +
      `Please sign in and change this password as soon as possible.` +
      SIGN_OFF,
  };
}

export function composePasswordResetEmail(input: { name: string; email: string; tempPassword: string }): ComposedEmail {
  return {
    to: input.email,
    subject: 'Your UKPCB Assistant password has been reset',
    body:
      `Hi ${input.name},\n\n` +
      `An administrator has reset your UKPCB Assistant password.\n\n` +
      `Email: ${input.email}\n` +
      `New temporary password: ${input.tempPassword}\n\n` +
      `Please sign in and change this password as soon as possible. If you did not expect this, ` +
      `contact your administrator.` +
      SIGN_OFF,
  };
}

export function composeAccountStatusEmail(input: {
  name: string;
  email: string;
  newStatus: 'DISABLED' | 'ACTIVE';
}): ComposedEmail {
  const isDisabled = input.newStatus === 'DISABLED';
  return {
    to: input.email,
    subject: isDisabled ? 'Your UKPCB Assistant account has been disabled' : 'Your UKPCB Assistant account has been re-enabled',
    body:
      `Hi ${input.name},\n\n` +
      (isDisabled
        ? `Your UKPCB Assistant account has been disabled by an administrator. You will not be able to sign in ` +
          `until it is re-enabled.`
        : `Your UKPCB Assistant account has been re-enabled by an administrator. You can sign in as usual.`) +
      SIGN_OFF,
  };
}

/**
 * Formats one or more composed emails as a single, human-readable document
 * — one clearly-delimited block per email — for the bulk-import download
 * (see bulkImportEmployeesAction). Not a mail-merge/CSV shape: this is
 * meant to be read top-to-bottom and sent manually until real sending is
 * wired in.
 */
export function formatEmailsAsDocument(emails: ComposedEmail[]): string {
  return emails
    .map((e) => `To: ${e.to}\nSubject: ${e.subject}\nBody:\n${e.body}`)
    .join('\n\n' + '-'.repeat(40) + '\n\n');
}

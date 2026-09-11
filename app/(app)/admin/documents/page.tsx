import { redirect } from 'next/navigation';

// Document management moved out of the admin-only dashboard and into the
// UKPCB Knowledge Base — reachable by any role granted upload rights, not
// just admins (see app/(app)/knowledge-base/page.tsx's own doc comment).
// Kept as a redirect so an old bookmark or muscle memory still lands
// somewhere real instead of a 404.
export default function AdminDocumentsRedirect() {
  redirect('/knowledge-base');
}

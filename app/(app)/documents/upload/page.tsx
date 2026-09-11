import { redirect } from 'next/navigation';

// This page moved and grew into the full UKPCB Knowledge Base (uploading
// is now one part of managing the whole document library, not a separate
// page) — kept as a redirect so an old bookmark or muscle memory still
// lands somewhere real instead of a 404.
export default function UploadDocumentsRedirect() {
  redirect('/knowledge-base');
}

import 'dotenv/config';
import { readFileSync } from 'fs';
import { extname, join } from 'path';
import { extractText } from './lib/documents/textExtraction';

const DOCS_DIR = '/home/sarthverma/Evon/Ask Evon/EVON_Documents';
const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const files = readFileSync('/tmp/final_upload_list.txt', 'utf-8').trim().split('\n');

type Result = { file: string; rank: number; reason: string };

async function classify(file: string): Promise<Result> {
  if (/case stud/i.test(file)) {
    const ext = extname(file).toLowerCase();
    const buffer = readFileSync(join(DOCS_DIR, file));
    const text = await extractText(buffer, MIME_BY_EXT[ext]);
    if (/cannot disclose the (name|identity)|strict confidentiality agreement|non-disclosure agreement|\bnda\b/i.test(text)) {
      return { file, rank: 4, reason: 'case study, but text states an explicit NDA/confidentiality restriction on this client engagement' };
    }
    return { file, rank: 1, reason: 'generic client case study' };
  }

  if (/portfolio|presentation|gaming profile|^evontech.*profile|^copy of evontech.*profile/i.test(file)) {
    return { file, rank: 2, reason: 'company portfolio/capability presentation deck' };
  }

  if (/talk track|talking guide|follow-up|one-pager|leave-behind|email template/i.test(file)) {
    return { file, rank: 3, reason: 'internal sales playbook/script' };
  }

  if (/migration strategy|devsecops process/i.test(file)) {
    return { file, rank: 3, reason: 'internal technical strategy/process document' };
  }

  if (/^security guidelines/i.test(file) || /^hipaa/i.test(file)) {
    return { file, rank: 4, reason: "Evon's own internal security/compliance policy document" };
  }

  if (/marketing proposal/i.test(file)) {
    return { file, rank: 4, reason: 'client-specific marketing/commercial proposal' };
  }

  if (/rate card/i.test(file)) {
    return { file, rank: 5, reason: "Evon's own service rate card — real commercial pricing" };
  }

  if (/financial proposal template|technical proposal template/i.test(file)) {
    return { file, rank: 5, reason: 'template used to construct real client financial/technical proposals' };
  }

  if (/proposal/i.test(file) && /\d{6,8}/.test(file)) {
    return { file, rank: 5, reason: 'a specific, dated client proposal document' };
  }

  if (/pitch|proposal/i.test(file) && /(for\s+[A-Z]|×|for\s+\w+$)/.test(file)) {
    return { file, rank: 5, reason: 'deal-specific pitch/proposal naming a specific prospect' };
  }

  return { file, rank: 2, reason: 'general internal company document (default)' };
}

async function main() {
  const results: Result[] = [];
  for (const f of files) {
    const r = await classify(f);
    results.push(r);
  }

  const overrides: Record<string, [number, string]> = {
    'Copy of EvonTech_Proposal_Rola.docx': [5, 'named client deal proposal ("Proposal for Rola", Client: Rola)'],
    'Copy of aboutUltralinq.docx': [1, 'generic client case study (about UltraLinq medical imaging) - just missing "Case Study" in filename'],
    'Copy of References_.docx': [6, 'contains real client PII (names, personal emails, phone numbers) - genuine privacy exposure, strictest clearance'],
  };
  for (const r of results) {
    if (overrides[r.file]) {
      [r.rank, r.reason] = overrides[r.file];
    }
  }

  for (const r of results) console.log(`[${r.rank}] ${r.file}`);
  console.log('\n--- distribution ---');
  for (let rank = 1; rank <= 6; rank++) console.log(`rank ${rank}: ${results.filter((r) => r.rank === rank).length}`);

  const fs = await import('fs');
  fs.writeFileSync('/tmp/classification.json', JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

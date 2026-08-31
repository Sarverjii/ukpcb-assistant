import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';

function normalize(s: string) {
  return s
    .replace(/[●•◦‣▪]/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toGapAwareText(items: { str: string; transform: number[]; width: number }[]): string {
  let haystack = '';
  let prevEndX: number | null = null;
  let prevY: number | null = null;
  for (const item of items) {
    const piece = normalize(item.str);
    const x = item.transform[4];
    const y = item.transform[5];
    const fontSize = item.transform[0] || 9;
    const sameLine = prevY !== null && Math.abs(y - prevY) < 2;
    const gap = sameLine && prevEndX !== null ? x - prevEndX : Infinity;
    const noSpaceNeeded = gap > -1 && gap <= fontSize * 0.15;
    if (haystack.length > 0 && !haystack.endsWith(' ') && !noSpaceNeeded) haystack += ' ';
    haystack += piece;
    prevEndX = x + item.width;
    prevY = y;
  }
  return haystack;
}

function tryMatch(haystack: string, highlightText: string): { found: boolean; window: number | null } {
  const words = normalize(highlightText).trim().split(' ').filter(Boolean);
  if (words.length === 0) return { found: false, window: null };
  const windows = [...new Set([20, 14, 10, 6, words.length].filter((n) => n <= words.length))].sort((a, b) => b - a);
  for (const wordCount of windows) {
    const needle = words.slice(0, wordCount).join(' ');
    if (haystack.indexOf(needle) !== -1) return { found: true, window: wordCount };
  }
  return { found: false, window: null };
}

async function main() {
  const url = process.env.PROD_DATABASE_URL!;
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  const chunks = await prisma.documentChunk.findMany({
    where: { document: { name: 'Case Study - Julius' }, pageNumber: 2 },
    orderBy: { chunkIndex: 'asc' },
    select: { chunkIndex: true, content: true },
  });
  console.log('page-2 chunks:', chunks.map((c) => c.chunkIndex));

  const buf = fs.readFileSync('/tmp/claude-1000/-home-sarthverma-Evon-Ask-Evon/ef02edbb-f8cd-44e8-9600-d7014835262f/scratchpad/pdfs/cmthosjnz002004l4ebn0yhci.pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const page = await doc.getPage(2);
  const textContent = await page.getTextContent();
  const items = textContent.items as { str: string; transform: number[]; width: number }[];
  const haystack = toGapAwareText(items);
  console.log('\nhaystack (first 200):', JSON.stringify(haystack.slice(0, 200)));

  for (const chunk of chunks) {
    const result = tryMatch(haystack, chunk.content);
    console.log(`chunk ${chunk.chunkIndex}: found=${result.found} window=${result.window}`);
    if (!result.found) {
      console.log('  content:', JSON.stringify(normalize(chunk.content).slice(0, 150)));
    }
  }

  await doc.destroy();
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

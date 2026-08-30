export type Chunk = { index: number; content: string };

/**
 * Simple character-based chunking with overlap, splitting on paragraph/
 * sentence boundaries where possible so a chunk doesn't cut off mid-thought.
 * Good enough for the MVP's ~100-document scale; a smarter (token-aware,
 * heading-aware) splitter is a drop-in replacement later since callers only
 * depend on this function's signature.
 */
export function chunkText(text: string, opts: { size?: number; overlap?: number } = {}): Chunk[] {
  const size = opts.size ?? 1000;
  const overlap = opts.overlap ?? 150;

  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // Prefer paragraph breaks, fall back to sentence breaks, then hard-split.
  const paragraphs = normalized.split(/\n{2,}/).filter((p) => p.trim().length > 0);

  const chunks: Chunk[] = [];
  let buffer = '';

  // Flushes the current buffer as a chunk, then seeds the next buffer with
  // the trailing `overlap` characters of what was just flushed (captured
  // BEFORE clearing) so consecutive chunks share context.
  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) chunks.push({ index: chunks.length, content: trimmed });
    buffer = overlap > 0 ? tail(trimmed, overlap) : '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      // A single paragraph longer than the chunk size: hard-split on
      // sentence boundaries.
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (buffer.length + sentence.length + 1 > size) flush();
        buffer += (buffer ? ' ' : '') + sentence;
      }
      continue;
    }

    if (buffer.length + paragraph.length + 2 > size) flush();
    buffer += (buffer ? '\n\n' : '') + paragraph;
  }
  flush();

  return chunks;
}

/**
 * Returns the trailing `n` characters of `s`, used to seed the next chunk's
 * overlap. A raw `s.slice(-n)` can land inside a word — e.g. slicing the
 * last 150 characters of "...various branches. • Tools –\no VPN..." can cut
 * right after the "T" of "Tools", so the next chunk's overlap-seeded text
 * starts "ools –\no VPN..." instead of "Tools –\no VPN...". Confirmed this
 * happening in real processed documents (a chunk starting mid-word), traced
 * to this exact raw slice — not a text-extraction artifact, since
 * re-extracting the same PDF produces the intact word every time. If the
 * cut lands inside a word, advance forward to the next whitespace so the
 * seed always starts cleanly.
 */
function tail(s: string, n: number): string {
  if (s.length <= n) return s;
  const raw = s.slice(-n);
  const cutIndex = s.length - n;
  const charBeforeCut = s[cutIndex - 1];
  if (charBeforeCut && !/\s/.test(charBeforeCut)) {
    const boundary = raw.search(/\s/);
    if (boundary !== -1) return raw.slice(boundary + 1);
  }
  return raw;
}

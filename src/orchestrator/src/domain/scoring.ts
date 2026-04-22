/**
 * Computes bounded vote bias so human feedback can influence ranking without drowning out semantic relevance.
 *
 * @param up - Positive vote count recorded for the candidate memory.
 * @param down - Negative vote count recorded for the candidate memory.
 * @returns Ranking adjustment constrained to the inclusive range from -0.15 to 0.15.
 */
export function voteBias(up: number, down: number): number {
  const total = up + down;
  if (total <= 0) {
    return 0;
  }

  const raw = Math.tanh((up - down) / Math.max(1, total)) * 0.15;
  return Number(raw.toFixed(3));
}

/**
 * Computes lexical overlap used as a fallback boost when semantic embeddings are weak or unavailable.
 *
 * @param query - Recall query text after request normalization.
 * @param content - Candidate memory content under ranking.
 * @returns Boost constrained to the inclusive range from 0 to 0.3.
 */
export function lexicalBoost(query: string, content: string): number {
  const normalize = (value: string): string[] =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3);

  const queryTokens = new Set(normalize(query));
  const contentTokens = new Set(normalize(content));
  if (queryTokens.size === 0 || contentTokens.size === 0) {
    return 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      hits += 1;
    }
  }

  const ratio = hits / queryTokens.size;
  return Number(Math.min(0.3, ratio * 0.3).toFixed(3));
}

/**
 * Computes cosine similarity between embedding vectors while rejecting malformed or zero-norm inputs.
 *
 * @param a - First embedding vector.
 * @param b - Second embedding vector.
 * @returns Similarity score in the inclusive range from -1 to 1, or 0 when comparison is not meaningful.
 */
export function similarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index] ?? 0);
    const bv = Number(b[index] ?? 0);
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / Math.sqrt(normA * normB);
}

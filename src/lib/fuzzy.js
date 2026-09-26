// Small fuzzy matcher for the command palette. Characters of the query must
// appear in order; matches at word starts, consecutive runs and the very
// beginning score higher. Accents and case are ignored ("ceske" finds "České").

export function normalize(text) {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const isBoundary = (text, i) => i === 0 || /[\s\-_.,:;/()[\]|+&]/.test(text[i - 1]);

/**
 * Scores `text` (already normalized) against `query` (already normalized).
 * Returns -1 when the query isn't a subsequence of the text; higher is better.
 */
export function fuzzyScore(query, text) {
  if (!query) return 0;
  // Fast path: a plain substring is always a good match.
  const direct = text.indexOf(query);
  if (direct !== -1) {
    return 1000 - direct * 2 - (text.length - query.length) * 0.1 + (isBoundary(text, direct) ? 200 : 0);
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of query) {
    if (ch === ' ') continue;
    const at = text.indexOf(ch, from);
    if (at === -1) return -1;
    score += 10;
    if (at === previous + 1) score += 15;
    if (isBoundary(text, at)) score += 20;
    score -= Math.min(at - from, 10);
    previous = at;
    from = at + 1;
  }
  return score - text.length * 0.1;
}

/** Best `limit` matches for `query` as [{ item, score }], using `key(item)` (normalized, cached by the caller). */
export function fuzzyRank(items, query, key, limit = 30, { minScore = 0 } = {}) {
  const q = normalize(query.trim());
  if (!q) return items.slice(0, limit).map((item) => ({ item, score: 0 }));
  const scored = [];
  for (const item of items) {
    const score = fuzzyScore(q, key(item));
    if (score >= minScore) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Like fuzzyRank, but just the items. */
export function fuzzyFilter(items, query, key, limit = 30) {
  return fuzzyRank(items, query, key, limit).map((s) => s.item);
}

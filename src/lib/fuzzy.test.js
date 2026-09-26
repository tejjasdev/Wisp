import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore, normalize } from './fuzzy.js';

describe('fuzzy', () => {
  it('ignores case and accents', () => {
    expect(normalize('České Rádio')).toBe('ceske radio');
    expect(fuzzyScore('ceske', normalize('České Rádio'))).toBeGreaterThan(0);
  });

  it('requires the query characters in order', () => {
    expect(fuzzyScore('bbc', 'bbc one')).toBeGreaterThan(0);
    expect(fuzzyScore('cbb', 'bbc one')).toBe(-1);
  });

  it('ranks substrings, word starts and short names higher', () => {
    const names = ['Al Jazeera English', 'Deutsche Welle English', 'DW English', 'Doctor Who Classics'];
    const result = fuzzyFilter(names, 'dw', (n) => normalize(n));
    expect(result[0]).toBe('DW English');
    expect(fuzzyFilter(names, 'dwe', (n) => normalize(n))[0]).toBe('DW English');
    expect(fuzzyFilter(names, 'xyz', (n) => normalize(n))).toEqual([]);
  });

  it('returns the first items unchanged for an empty query', () => {
    expect(fuzzyFilter([1, 2, 3], '  ', String, 2)).toEqual([1, 2]);
  });
});

import { fuzzyRank } from './fuzzy.js';

describe('fuzzyRank minScore', () => {
  it('drops scattered matches below the threshold but keeps real ones', () => {
    const labels = ['Turn off background data saver bandwidth hidden tab quality', 'Show stream stats', 'Multiview grid'];
    const rank = (q) => fuzzyRank(labels, q, normalize, 5, { minScore: normalize(q).length * 12 }).map((r) => r.item);
    expect(rank('bunny')).toEqual([]);
    expect(rank('stats')).toEqual(['Show stream stats']);
    expect(rank('mv')[0]).toBe('Multiview grid');
    expect(rank('multi')[0]).toBe('Multiview grid');
  });
});

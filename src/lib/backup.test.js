import { describe, expect, it } from 'vitest';
import { makeBackup, mergeItems, parseBackup } from './backup.js';

const fav = { id: 'tv:https://a.example/1.m3u8', kind: 'tv', name: 'One', url: 'https://a.example/1.m3u8', logo: '' };

describe('backup', () => {
  it('round-trips favorites, settings, playlist and guide', () => {
    const file = JSON.stringify(
      makeBackup({
        favorites: [fav],
        recents: [],
        settings: { quality: 'low', backgroundSaver: false, stats: true, mode: 'radio' },
        playlist: { url: 'https://a.example/list.m3u', name: 'My list' },
        guide: { url: 'https://a.example/guide.xml.gz', label: 'a.example' },
      }),
    );
    const parsed = parseBackup(file);
    expect(parsed.favorites).toEqual([fav]);
    expect(parsed.settings).toEqual({ quality: 'low', backgroundSaver: false, stats: true, mode: 'radio' });
    expect(parsed.playlist).toEqual({ url: 'https://a.example/list.m3u', text: '', name: 'My list' });
    expect(parsed.guide.url).toBe('https://a.example/guide.xml.gz');
  });

  it('rejects files that are not Wisp backups', () => {
    expect(() => parseBackup('not json')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/exported from Wisp/);
    expect(() => parseBackup('{"app":"wisp","version":99}')).toThrow(/newer version/);
  });

  it('sanitizes everything it imports', () => {
    const parsed = parseBackup(
      JSON.stringify({
        app: 'wisp',
        version: 1,
        settings: { quality: 'ultra', mode: '<script>' },
        favorites: [
          { ...fav, name: 'Evil\u202Ename', logo: 'javascript:alert(1)' },
          { id: 'x', kind: 'tv', name: 'Bad', url: 'javascript:alert(1)' },
          { id: 'y', kind: 'weird', name: 'Bad kind', url: 'https://a.example/y' },
        ],
        playlist: { url: 'file:///etc/passwd' },
      }),
    );
    expect(parsed.settings).toEqual({});
    expect(parsed.favorites).toHaveLength(1);
    expect(parsed.favorites[0]).toMatchObject({ name: 'Evil name', logo: '' });
    expect(parsed.playlist).toBeNull();
  });

  it('merges favorites without duplicates', () => {
    const two = { ...fav, id: 'tv:2', url: 'https://a.example/2.m3u8' };
    expect(mergeItems([fav], [two, fav]).map((i) => i.id)).toEqual(['tv:2', fav.id]);
  });
});

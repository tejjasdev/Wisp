// Export / import of everything Wisp remembers, as a JSON file. There are no
// accounts, so this is how favorites and settings move between browsers.
// An imported file is untrusted input: every field is validated and sanitized.

import { cleanText, safeUrl } from './sanitize.js';

export const BACKUP_VERSION = 1;
const MAX_ITEMS = 2000;
const MAX_PLAYLIST_TEXT = 5_000_000;

const QUALITIES = ['auto', 'low', 'high'];
const MODES = ['tv', 'radio', 'saved'];

/** Re-validates a saved channel/station; returns null if it can't be played. */
export function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const url = safeUrl(item.url);
  if (!url || !['tv', 'radio', 'stream'].includes(item.kind)) return null;
  const clean = {
    id: cleanText(item.id, 2100) || `${item.kind}:${url}`,
    kind: item.kind,
    name: cleanText(item.name) || 'Untitled',
    url,
    logo: safeUrl(item.logo, { allowImageData: true }),
  };
  if (Array.isArray(item.groups)) clean.groups = item.groups.map((g) => cleanText(g, 80)).filter(Boolean).slice(0, 10);
  if (item.headers && typeof item.headers === 'object') {
    clean.headers = {};
    for (const [k, v] of Object.entries(item.headers).slice(0, 10)) {
      const key = cleanText(k, 60);
      if (key && typeof v === 'string') clean.headers[key] = cleanText(v, 500);
    }
  }
  if (item.hls === true) clean.hls = true;
  if (item.audio === true) clean.audio = true;
  if (item.prefer === 'hls' || item.prefer === 'native') clean.prefer = item.prefer;
  if (typeof item.uuid === 'string') clean.uuid = cleanText(item.uuid, 64);
  if (typeof item.tvgId === 'string') clean.tvgId = cleanText(item.tvgId, 120);
  if (item.meta && typeof item.meta === 'object') {
    clean.meta = {
      country: cleanText(item.meta.country, 4),
      tags: Array.isArray(item.meta.tags) ? item.meta.tags.map((t) => cleanText(t, 30)).filter(Boolean).slice(0, 3) : [],
      bitrate: Number(item.meta.bitrate) > 0 ? Math.round(Number(item.meta.bitrate)) : 0,
    };
  }
  return clean;
}

const items = (list) =>
  Array.isArray(list) ? list.slice(0, MAX_ITEMS).map(sanitizeItem).filter(Boolean) : [];

/** Builds the export file's contents from the current app state. */
export function makeBackup({ favorites, recents, settings, playlist, guide }) {
  return {
    app: 'wisp',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    favorites,
    recents,
    playlist: playlist || null,
    guide: guide || null,
  };
}

export class BackupError extends Error {}

/** Parses and validates an imported file. Throws BackupError with a readable message. */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError("This file isn't valid JSON.");
  }
  if (!data || data.app !== 'wisp') throw new BackupError("This file wasn't exported from Wisp.");
  if (typeof data.version !== 'number' || data.version > BACKUP_VERSION) {
    throw new BackupError('This file comes from a newer version of Wisp. Update this copy and try again.');
  }

  const s = data.settings && typeof data.settings === 'object' ? data.settings : {};
  const settings = {};
  if (QUALITIES.includes(s.quality)) settings.quality = s.quality;
  if (MODES.includes(s.mode)) settings.mode = s.mode;
  if (typeof s.backgroundSaver === 'boolean') settings.backgroundSaver = s.backgroundSaver;
  if (typeof s.stats === 'boolean') settings.stats = s.stats;

  let playlist = null;
  if (data.playlist && typeof data.playlist === 'object') {
    const url = safeUrl(data.playlist.url);
    const text = typeof data.playlist.text === 'string' && data.playlist.text.length <= MAX_PLAYLIST_TEXT ? data.playlist.text : '';
    if (url || text) playlist = { url, text, name: cleanText(data.playlist.name) };
  }

  let guide = null;
  const guideUrl = safeUrl(data.guide?.url);
  if (guideUrl) guide = { url: guideUrl, label: cleanText(data.guide.label, 80) };

  return { settings, favorites: items(data.favorites), recents: items(data.recents), playlist, guide };
}

/** Favorites from the file are added to the current ones (no duplicates, file order first). */
export function mergeItems(current, incoming) {
  const seen = new Set();
  return [...incoming, ...current].filter((item) => !seen.has(item.id) && seen.add(item.id));
}

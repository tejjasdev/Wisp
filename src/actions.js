// What happens when the user opens something: a pasted link, pasted playlist
// text, a ?stream= / ?playlist= deep link, or the saved session on startup.

import { parseM3u } from './lib/m3u.js';
import { cachedGuide, cacheGuide, forgetGuide, loadGuide } from './lib/epg.js';
import { makeBackup, mergeItems, parseBackup } from './lib/backup.js';
import { cleanText, safeUrl } from './lib/sanitize.js';
import { guessUrlType, inspectUrl, isPlaylistText, SourceError } from './lib/source.js';
import { load, save } from './lib/storage.js';
import {
  backgroundSaver, channelGroup, channelQuery, favorites, guide, guideStatus, mode, playItem, playlist, quality,
  recents, sanitizeItem, showSourceForm, statsOpen,
} from './state.js';

// Big playlists are stored as a URL only; smaller ones keep their text so the
// list is back instantly (and works offline) on the next visit.
const MAX_STORED_PLAYLIST_CHARS = 1_500_000;

function nameFromUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const file = decodeURIComponent(pathname.split('/').filter(Boolean).pop() || '');
    return cleanText(file.replace(/\.(m3u8?|mp4|webm|mp3|aac)$/i, '')) || hostname;
  } catch {
    return 'Stream';
  }
}

export function streamItem(url, { name, audio = false, prefer } = {}) {
  const item = { id: `stream:${url}`, kind: 'stream', name: cleanText(name) || nameFromUrl(url), url, logo: '', audio };
  if (prefer) item.prefer = prefer;
  return item;
}

/** Parses playlist text and shows it. Throws SourceError if it has no channels. */
export function openPlaylistText(text, { url = '', name = '', reveal = true } = {}) {
  const { channels, groups, epgUrls } = parseM3u(text, url || undefined);
  if (!channels.length) {
    throw new SourceError('empty', 'No channels found. Make sure this is an M3U playlist.');
  }
  // A guide belongs to the playlist it was matched against.
  if (reveal && playlist.value && playlist.value.url !== url) removeGuide();
  playlist.value = { name: cleanText(name) || (url ? nameFromUrl(url) : 'Pasted playlist'), url, channels, groups, epgUrls };
  channelQuery.value = '';
  channelGroup.value = '';
  showSourceForm.value = false;
  if (reveal) mode.value = 'tv';

  const saved = { url, name: playlist.value.name };
  if (text.length > MAX_STORED_PLAYLIST_CHARS || !save('playlist', { ...saved, text })) save('playlist', saved);
  return channels.length;
}

// The user's optional "type" hint → which playback engine to try first.
const HINT_ENGINE = { hls: 'hls', video: 'native', audio: 'native' };

/**
 * Opens whatever the user entered. Resolves to 'playlist' or 'stream'.
 *
 * What a link is gets decided in this order: the content itself (a peek at
 * its first bytes), then the user's type `hint`, then the file extension.
 * If the content can't be read (usually CORS), the player still tries every
 * way of playing it — hint first — before reporting an error. Throws a
 * SourceError only when there's nothing left to try; its `code` tells the
 * form whether offering "paste the playlist text instead" makes sense.
 */
export async function openInput(input, { name, hint = 'auto', audio = false, auto = false } = {}) {
  const raw = input.trim();
  if (!raw) throw new SourceError('invalid', 'Paste a link or playlist first.');

  if (isPlaylistText(raw)) {
    openPlaylistText(raw);
    return 'playlist';
  }

  const url = safeUrl(raw);
  if (!url) throw new SourceError('invalid', 'Enter a link starting with http:// or https://, or paste playlist text.');

  // Shared radio links are known audio streams; no need to peek.
  if (audio) {
    playItem(streamItem(url, { name, audio: true, prefer: 'native' }), { auto });
    return 'stream';
  }

  const urlType = guessUrlType(url);
  let detected = 'unknown';
  try {
    const result = await inspectUrl(url);
    if (result.type === 'playlist') {
      openPlaylistText(result.text, { url, name });
      return 'playlist';
    }
    detected = result.type;
  } catch (err) {
    // Definitive answers (a web page, raw MPEG-TS, too large) end here.
    if (!(err instanceof SourceError) || ['ts', 'html', 'size'].includes(err.code)) throw err;
    // An unreadable channel list is a dead end for the player too — the form
    // offers the paste fallback. Anything else may still play: media elements
    // don't need CORS, and Safari plays HLS natively.
    if (hint === 'playlist' || (hint === 'auto' && urlType === 'playlist')) throw err;
  }

  const isAudio =
    detected === 'audio' || (detected === 'unknown' && (hint === 'audio' || (hint === 'auto' && urlType === 'audio-file')));
  const prefer =
    detected === 'hls' ? 'hls'
      : detected === 'video' || detected === 'audio' ? 'native'
        : HINT_ENGINE[hint];
  playItem(streamItem(url, { name, audio: isAudio, prefer }), { auto });
  return 'stream';
}

/** Brings back the last playlist. Refetches it if only its URL was stored. */
export async function restorePlaylist() {
  const saved = load('playlist');
  if (!saved) return;
  try {
    if (saved.text) {
      openPlaylistText(saved.text, { ...saved, reveal: false });
      return;
    }
    const url = safeUrl(saved.url);
    if (!url) return;
    const result = await inspectUrl(url);
    if (result.type === 'playlist' && !playlist.value) openPlaylistText(result.text, { ...saved, reveal: false });
  } catch {
    // Not fatal: the TV panel simply shows the "open a playlist" form.
  }
}

// ---- Programme guide ----

/**
 * Loads an XMLTV guide for the current playlist and remembers it.
 * source: { kind: 'url', url } | { kind: 'text', text } | { kind: 'blob', blob }
 */
export async function openGuide(source, label) {
  const channels = playlist.value?.channels ?? [];
  guideStatus.value = { state: 'loading', bytes: 0 };
  try {
    const result = await loadGuide(source, channels, {
      onProgress: (bytes) => (guideStatus.value = { state: 'loading', bytes }),
    });
    const key = source.kind === 'url' ? source.url : 'local';
    guide.value = { label, key, data: result.guide, matched: result.matched, programmes: result.programmes };
    guideStatus.value = { state: 'idle' };
    cacheGuide(key, { label, data: result.guide, matched: result.matched, programmes: result.programmes });
    save('guide', { key, url: source.kind === 'url' ? source.url : '', label });
    return result;
  } catch (err) {
    guideStatus.value = { state: 'error', message: err.message, code: err.code };
    throw err;
  }
}

export function removeGuide() {
  if (guide.value) forgetGuide(guide.value.key);
  guide.value = null;
  guideStatus.value = { state: 'idle' };
  save('guide', null);
}

/** Brings back the guide from the local cache, or re-downloads it if it has gone stale. */
async function restoreGuide() {
  const saved = load('guide');
  if (!saved?.key || !playlist.value) return;
  const cached = await cachedGuide(saved.key);
  if (cached) {
    guide.value = { label: cached.label, key: saved.key, data: cached.data, matched: cached.matched, programmes: cached.programmes };
    return;
  }
  const url = safeUrl(saved.url);
  // The user opted in to this guide before; refresh it quietly in the background.
  if (url) openGuide({ kind: 'url', url }, saved.label).catch(() => {});
}

// ---- Export / import ----

/** Downloads favorites, history, settings and the playlist/guide links as a JSON file. */
export function exportSettings() {
  const saved = load('playlist');
  const savedGuide = load('guide');
  const data = makeBackup({
    favorites: favorites.value,
    recents: recents.value,
    settings: { quality: quality.value, backgroundSaver: backgroundSaver.value, stats: statsOpen.value, mode: mode.value },
    playlist: saved ? { url: saved.url || '', name: saved.name || '', text: saved.text || '' } : null,
    guide: savedGuide?.url ? { url: savedGuide.url, label: savedGuide.label } : null,
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = `wisp-settings-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

/**
 * Applies an exported file. Favorites are merged with the current ones; the
 * playlist and guide are only restored if none is loaded, so importing never
 * silently replaces what you're watching. Resolves to a summary sentence.
 */
export async function importSettings(file) {
  const data = parseBackup(await file.text());
  const before = favorites.value.length;
  favorites.value = mergeItems(favorites.value, data.favorites);
  recents.value = mergeItems(recents.value, data.recents).slice(0, 40);
  const { settings } = data;
  if (settings.quality) quality.value = settings.quality;
  if (settings.backgroundSaver !== undefined) backgroundSaver.value = settings.backgroundSaver;
  if (settings.stats !== undefined) statsOpen.value = settings.stats;

  const parts = [`${favorites.value.length - before} new favorites`];
  if (data.playlist && !playlist.value) {
    try {
      if (data.playlist.text) openPlaylistText(data.playlist.text, data.playlist);
      else await openInput(data.playlist.url);
      parts.push('your playlist');
      if (data.guide) {
        save('guide', { key: data.guide.url, url: data.guide.url, label: data.guide.label });
        restoreGuide();
        parts.push('its guide');
      }
    } catch {
      parts.push("but the playlist link couldn't be opened");
    }
  } else if (data.playlist) {
    parts.push('(kept the playlist you have open)');
  }
  if (settings.mode) mode.value = settings.mode;
  return `Imported ${parts.join(', ').replace(/, \(/, ' (')}.`;
}

/** Startup order: a deep link always wins over resuming the last item. */
export async function start() {
  const params = new URLSearchParams(location.search);
  const streamParam = params.get('stream');
  const playlistParam = params.get('playlist');

  const restoring = playlistParam ? Promise.resolve() : restorePlaylist();

  if (playlistParam) {
    openInput(playlistParam, { auto: true }).catch(() => (showSourceForm.value = true));
  }

  if (streamParam) {
    const audio = params.get('audio') === '1';
    openInput(streamParam, { name: params.get('name') || '', audio, auto: true }).catch(() => {});
  } else {
    const last = sanitizeItem(load('last'));
    if (last) playItem(last, { auto: true });
  }
  await restoring;
  restoreGuide();
}

export function shareUrl(item) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('stream', item.url);
  url.searchParams.set('name', item.name);
  if (item.kind === 'radio' || item.audio) url.searchParams.set('audio', '1');
  return url.href;
}

// What happens when the user opens something: a pasted link, pasted playlist
// text, a ?stream= / ?playlist= deep link, or the saved session on startup.

import { parseM3u } from './lib/m3u.js';
import { cleanText, safeUrl } from './lib/sanitize.js';
import { guessUrlType, inspectUrl, isPlaylistText, SourceError } from './lib/source.js';
import { load, save } from './lib/storage.js';
import {
  channelGroup, channelQuery, mode, playItem, playlist, sanitizeItem, showSourceForm,
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

export function streamItem(url, { name, audio = false } = {}) {
  return { id: `stream:${url}`, kind: 'stream', name: cleanText(name) || nameFromUrl(url), url, logo: '', audio };
}

/** Parses playlist text and shows it. Throws SourceError if it has no channels. */
export function openPlaylistText(text, { url = '', name = '', reveal = true } = {}) {
  const { channels, groups } = parseM3u(text, url || undefined);
  if (!channels.length) {
    throw new SourceError('empty', 'No channels found. Make sure this is an M3U playlist.');
  }
  playlist.value = { name: cleanText(name) || (url ? nameFromUrl(url) : 'Pasted playlist'), url, channels, groups };
  channelQuery.value = '';
  channelGroup.value = '';
  showSourceForm.value = false;
  if (reveal) mode.value = 'tv';

  const saved = { url, name: playlist.value.name };
  if (text.length > MAX_STORED_PLAYLIST_CHARS || !save('playlist', { ...saved, text })) save('playlist', saved);
  return channels.length;
}

/**
 * Opens whatever the user entered. Resolves to 'playlist' or 'stream'.
 * Throws SourceError when the input can't be used; `code` tells the form
 * whether offering "paste the playlist text instead" makes sense.
 */
export async function openInput(input, { name, audio = false, auto = false } = {}) {
  const raw = input.trim();
  if (!raw) throw new SourceError('invalid', 'Paste a link or playlist first.');

  if (isPlaylistText(raw)) {
    openPlaylistText(raw);
    return 'playlist';
  }

  const url = safeUrl(raw);
  if (!url) throw new SourceError('invalid', 'Enter a link starting with http:// or https://, or paste playlist text.');

  const type = guessUrlType(url);
  if (audio || type === 'video-file' || type === 'audio-file') {
    playItem(streamItem(url, { name, audio: audio || type === 'audio-file' }), { auto });
    return 'stream';
  }

  try {
    const result = await inspectUrl(url);
    if (result.type === 'playlist') {
      openPlaylistText(result.text, { url, name });
      return 'playlist';
    }
  } catch (err) {
    // A .m3u link we can't read is a dead end for the player too — let the
    // form offer the paste fallback. Anything else might still be a stream the
    // media element can load without CORS (e.g. native HLS in Safari), so try it.
    if (type === 'playlist' || ['format', 'size', 'empty'].includes(err.code)) throw err;
  }

  playItem(streamItem(url, { name, audio }), { auto });
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
    return;
  }

  const last = sanitizeItem(load('last'));
  if (last) playItem(last, { auto: true });
  await restoring;
}

export function shareUrl(item) {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('stream', item.url);
  url.searchParams.set('name', item.name);
  if (item.kind === 'radio' || item.audio) url.searchParams.set('audio', '1');
  return url.href;
}

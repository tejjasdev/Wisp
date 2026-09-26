// Figures out what the user gave us: a channel playlist, an HLS stream, a
// plain media file, or raw pasted playlist text — and fetches playlists with
// hard size/time limits so a bad URL can never hang the app.

import { isHlsPlaylist, looksLikeM3u } from './m3u.js';

const VIDEO_FILE = /\.(mp4|m4v|webm|ogv|mov)$/i;
const AUDIO_FILE = /\.(mp3|aac|m4a|ogg|oga|opus|flac|wav)$/i;

const MAX_PLAYLIST_BYTES = 30 * 1024 * 1024;
const PLAYLIST_TIMEOUT_MS = 20000;

/** 'video-file' | 'audio-file' | 'hls' | 'playlist' | 'unknown' — based on the URL alone. */
export function guessUrlType(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return 'unknown';
  }
  if (VIDEO_FILE.test(path)) return 'video-file';
  if (AUDIO_FILE.test(path)) return 'audio-file';
  if (/\.m3u8$/i.test(path)) return 'hls'; // may still turn out to be a channel list
  if (/\.m3u$/i.test(path)) return 'playlist';
  return 'unknown';
}

/** Is the input pasted playlist text rather than a single URL? */
export function isPlaylistText(input) {
  const trimmed = input.trim();
  return trimmed.includes('\n') || looksLikeM3u(trimmed);
}

export const pageIsSecure = () =>
  typeof location !== 'undefined' && location.protocol === 'https:';

/** An http:// URL on an https:// page is blocked by the browser (mixed content). */
export function isMixedContent(url) {
  return pageIsSecure() && url.startsWith('http:');
}

/**
 * The URL to actually request. On an HTTPS page we try the HTTPS version of an
 * http:// URL, because many servers support both and the plain one would be
 * blocked outright.
 */
export function upgradeUrl(url) {
  return isMixedContent(url) ? 'https:' + url.slice(5) : url;
}

export class SourceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Fetches a URL and decides whether it's a channel list or a stream.
 * Resolves to { type: 'playlist', text, url } or { type: 'stream', url }.
 * Rejects with a SourceError when the URL can't be read (CORS, network, size).
 */
export async function inspectUrl(url, { signal } = {}) {
  const requestUrl = upgradeUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLAYLIST_TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());

  let response;
  try {
    response = await fetch(requestUrl, { signal: controller.signal, credentials: 'omit' });
  } catch (err) {
    clearTimeout(timer);
    if (signal?.aborted) throw err;
    if (controller.signal.aborted) {
      throw new SourceError('timeout', 'The server took too long to respond.');
    }
    throw new SourceError(
      isMixedContent(url) ? 'mixed' : 'blocked',
      isMixedContent(url)
        ? 'This link uses http://, which browsers block on secure pages, and no https:// version was found.'
        : "Couldn't read this link. The server may be offline, or it doesn't allow other websites to load it (CORS).",
    );
  }

  if (!response.ok) {
    clearTimeout(timer);
    throw new SourceError('http', `The server answered with an error (${response.status}).`);
  }

  // Endless audio/video streams must not be read to the end.
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (/^(audio|video)\//.test(type) && !type.includes('mpegurl')) {
    clearTimeout(timer);
    controller.abort();
    return { type: 'stream', url: requestUrl };
  }

  try {
    const text = await readLimited(response, MAX_PLAYLIST_BYTES);
    if (isHlsPlaylist(text)) return { type: 'stream', url: requestUrl };
    if (looksLikeM3u(text)) return { type: 'playlist', text, url: requestUrl };
    throw new SourceError('format', "This link doesn't point to a playlist or a stream Wisp can play.");
  } catch (err) {
    if (err instanceof SourceError || signal?.aborted) throw err;
    throw new SourceError(
      controller.signal.aborted ? 'timeout' : 'network',
      controller.signal.aborted ? 'The playlist took too long to download.' : 'The download was interrupted.',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response, maxBytes) {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel();
      throw new SourceError('size', 'This playlist is too large (over 30 MB).');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

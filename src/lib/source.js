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

const ascii = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * Classifies a response from its first bytes (magic numbers) and Content-Type.
 * Returns 'm3u' (text playlist — HLS or channel list, decided later),
 * 'video' | 'audio' (a file/stream the media element can play directly),
 * 'ts' (raw MPEG-TS), 'html' (a web page) or 'unknown'.
 */
export function sniffBytes(bytes, contentType = '') {
  const type = contentType.toLowerCase().split(';')[0].trim();
  if (bytes.length >= 8 && ascii(bytes, 4, 4) === 'ftyp') return 'video'; // MP4 / MOV / M4A
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video'; // WebM / Matroska
  if (bytes.length >= 189 && bytes[0] === 0x47 && bytes[188] === 0x47) return 'ts'; // 188-byte TS packets
  const magic = ascii(bytes, 0, 4);
  if (magic.startsWith('ID3') || magic === 'OggS' || magic === 'fLaC' || magic === 'RIFF') return 'audio';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio'; // MP3 / AAC (ADTS) frame sync

  const text = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  if (text.startsWith('#EXTM3U') || text.startsWith('#EXTINF')) return 'm3u';
  if (/^<(!doctype html|html|head|body)/i.test(text)) return 'html';

  if (type.includes('mpegurl')) return 'm3u';
  if (type === 'video/mp2t') return 'ts';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'text/html') return 'html';
  return 'unknown';
}

/**
 * Fetches the start of a URL and works out what it is, reading as little as
 * possible (endless radio/video streams are never read to the end).
 * Resolves to { type, url, text? } where type is:
 *   'playlist' (a channel list; `text` holds it), 'hls', 'video', 'audio', or 'unknown'.
 * Rejects with a SourceError when the URL can't be read (CORS, network, HTTP
 * error) or is definitely not playable (web page, raw MPEG-TS, too large).
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

  const reader = response.body?.getReader();
  const stop = () => {
    clearTimeout(timer);
    reader?.cancel().catch(() => {});
    controller.abort();
  };

  try {
    const head = reader ? await readAtLeast(reader, 1024) : new Uint8Array(await response.arrayBuffer());
    const kind = sniffBytes(head, response.headers.get('content-type') || '');

    if (kind !== 'm3u') {
      stop();
      if (kind === 'ts') {
        throw new SourceError('ts', "This is a raw MPEG-TS stream (.ts). Browsers can't play those directly; look for an HLS (.m3u8) version of it.");
      }
      if (kind === 'html') throw new SourceError('html', 'This link opens a web page, not a stream or a playlist.');
      return { type: kind, url: requestUrl };
    }

    const text = reader ? await readRest(reader, head, MAX_PLAYLIST_BYTES) : new TextDecoder().decode(head);
    clearTimeout(timer);
    if (isHlsPlaylist(text)) return { type: 'hls', url: requestUrl };
    if (looksLikeM3u(text)) return { type: 'playlist', text, url: requestUrl };
    return { type: 'unknown', url: requestUrl };
  } catch (err) {
    stop();
    if (err instanceof SourceError || signal?.aborted) throw err;
    throw new SourceError(
      controller.signal.aborted ? 'timeout' : 'network',
      controller.signal.aborted ? 'The playlist took too long to download.' : 'The download was interrupted.',
    );
  }
}

async function readAtLeast(reader, minBytes) {
  const chunks = [];
  let length = 0;
  while (length < minBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readRest(reader, head, maxBytes) {
  const decoder = new TextDecoder();
  let received = head.byteLength;
  let text = decoder.decode(head, { stream: true });
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

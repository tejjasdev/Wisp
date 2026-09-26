// Parser for IPTV-style M3U / M3U8 channel playlists.
//
// Supports the de-facto "extended M3U" dialect used by IPTV lists:
//   #EXTM3U
//   #EXTINF:-1 tvg-id="x" tvg-logo="https://…/logo.png" group-title="News",Channel name
//   #EXTVLCOPT:http-user-agent=…
//   #EXTGRP:News
//   https://example.com/stream.m3u8|Referer=https://example.com
//
// Also answers the question "is this actually an HLS stream rather than a
// channel list?", since both commonly use the .m3u8 extension.

import { cleanText, safeUrl } from './sanitize.js';

export const MAX_CHANNELS = 50000;
export const UNGROUPED = 'Other';

/**
 * A channel's name without the decoration lists add to variants of the same
 * channel: "BBC One HD (1080p) [Geo-blocked]" → "bbc one". Used to find backup
 * sources for a channel and to match guide entries by name.
 */
export function baseName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(hd|fhd|uhd|sd|4k|8k|hevc|h\.?26[45]|\d{3,4}[pi]|backup|alt|mirror|feed|low|high)\b/g, ' ')
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();
}

/** True if the text is an HLS master/media playlist (a stream, not a channel list). */
export function isHlsPlaylist(text) {
  return /^#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|MEDIA:)/m.test(text.slice(0, 20000));
}

/** True if the text looks like an M3U channel list. */
export function looksLikeM3u(text) {
  const head = text.slice(0, 4000).replace(/^\uFEFF/, '').trimStart();
  return head.startsWith('#EXTM3U') || /^#EXTINF:/m.test(head);
}

/**
 * Parses `key="value"` pairs from an #EXTINF line and returns
 * { attrs, title } where title is the text after the first comma that is not
 * inside quotes.
 */
export function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  const attrs = {};
  let title = '';
  let attrPart = body;
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) {
      title = body.slice(i + 1);
      attrPart = body.slice(0, i);
      break;
    }
  }
  const attrPattern = /([\w-]+)="([^"]*)"/g;
  let match;
  while ((match = attrPattern.exec(attrPart))) {
    attrs[match[1].toLowerCase()] = match[2];
  }
  return { attrs, title };
}

// Kodi-style header suffix: "https://host/stream.m3u8|User-Agent=Foo&Referer=https://bar"
function splitPipeHeaders(value) {
  const pipe = value.indexOf('|');
  if (pipe === -1) return { url: value, headers: {} };
  const headers = {};
  for (const pair of value.slice(pipe + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq > 0) headers[pair.slice(0, eq).trim()] = safeDecode(pair.slice(eq + 1).trim());
  }
  return { url: value.slice(0, pipe), headers };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const VLC_HEADER_OPTS = {
  'http-user-agent': 'User-Agent',
  'http-referrer': 'Referer',
  'http-referer': 'Referer',
  'http-origin': 'Origin',
};

function nameFromUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    const file = pathname.split('/').filter(Boolean).pop();
    return file ? decodeURIComponent(file) : hostname;
  } catch {
    return url;
  }
}

/**
 * Parses playlist text into channels.
 * @param {string} text   Raw playlist text.
 * @param {string} [base] URL the playlist was loaded from, for relative entries.
 * @returns {{ channels: Channel[], groups: {name: string, count: number}[], epgUrls: string[] }}
 *
 * @typedef {object} Channel
 * @property {string} id       Stable id (used for favorites / recents).
 * @property {'tv'} kind
 * @property {string} name
 * @property {string} url
 * @property {string} logo
 * @property {string[]} groups
 * @property {Record<string,string>} headers
 */
export function parseM3u(text, base) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const channels = [];
  const epgUrls = [];
  const groupCounts = new Map();
  const seen = new Set();
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      if (/^#EXTM3U/i.test(line)) {
        // Guide location(s) in the header: x-tvg-url="a.xml.gz,b.xml" (or url-tvg=).
        const { attrs } = parseExtinf(`#EXTM3U:${line.slice(7)},`);
        for (const u of (attrs['x-tvg-url'] || attrs['url-tvg'] || '').split(',')) {
          const epg = safeUrl(u, { base });
          if (epg && !epgUrls.includes(epg)) epgUrls.push(epg);
        }
      } else if (/^#EXTINF:/i.test(line)) {
        const { attrs, title } = parseExtinf(line);
        pending = {
          name: cleanText(title) || cleanText(attrs['tvg-name']),
          logo: attrs['tvg-logo'] || attrs['logo'] || '',
          group: attrs['group-title'] || '',
          tvgId: cleanText(attrs['tvg-id'], 120),
          headers: {},
        };
        if (attrs['user-agent']) pending.headers['User-Agent'] = attrs['user-agent'];
      } else if (/^#EXTGRP:/i.test(line)) {
        pending ??= { name: '', logo: '', group: '', headers: {} };
        pending.group ||= line.slice(8);
      } else if (/^#EXTVLCOPT:/i.test(line)) {
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        const header = VLC_HEADER_OPTS[opt.slice(0, eq).trim().toLowerCase()];
        if (eq > 0 && header) {
          pending ??= { name: '', logo: '', group: '', headers: {} };
          pending.headers[header] = opt.slice(eq + 1).trim();
        }
      }
      continue;
    }

    // Any non-comment line is a media URL, closing the current entry.
    const { url: rawUrl, headers: pipeHeaders } = splitPipeHeaders(line);
    const url = safeUrl(rawUrl, { base });
    const entry = pending ?? { name: '', logo: '', group: '', headers: {} };
    pending = null;
    if (!url) continue;

    const groups = entry.group
      .split(';')
      .map((g) => cleanText(g, 80))
      .filter(Boolean);
    if (!groups.length) groups.push(UNGROUPED);

    // Duplicate URLs are common in merged lists; the first entry wins.
    const id = `tv:${url}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const headers = {};
    for (const [k, v] of Object.entries({ ...entry.headers, ...pipeHeaders })) {
      const value = cleanText(v, 500);
      if (value) headers[cleanText(k, 60)] = value;
    }

    const channel = {
      id,
      kind: 'tv',
      number: channels.length + 1, // position in the playlist, shown like a channel number
      name: entry.name || cleanText(nameFromUrl(url)) || 'Untitled',
      url,
      logo: safeUrl(entry.logo, { base, allowImageData: true }),
      groups,
      headers,
    };
    if (entry.tvgId) channel.tvgId = entry.tvgId;
    channels.push(channel);
    for (const g of groups) groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);

    if (channels.length >= MAX_CHANNELS) break;
  }

  const groups = [...groupCounts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      a.name === UNGROUPED ? 1 : b.name === UNGROUPED ? -1 : a.name.localeCompare(b.name),
    );

  return { channels, groups, epgUrls };
}

// Client for the free, community-run Radio Browser directory
// (https://api.radio-browser.info). No key needed and CORS is enabled.
//
// The project runs several mirror servers. Per their guidelines we discover
// the current list, pick one at random, fail over to the next on errors, and
// report a "click" whenever a station is played.

import { cleanText, safeUrl } from './sanitize.js';

const DISCOVERY_URL = 'https://all.api.radio-browser.info/json/servers';
const FALLBACK_SERVERS = ['de1.api.radio-browser.info', 'de2.api.radio-browser.info', 'fi1.api.radio-browser.info'];
const REQUEST_TIMEOUT_MS = 8000;

let serversPromise;

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchJson(url, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function getServers() {
  serversPromise ??= fetchJson(DISCOVERY_URL)
    .then((list) => {
      const names = [...new Set(list.map((s) => s.name).filter((n) => /^[\w.-]+\.radio-browser\.info$/.test(n)))];
      return names.length ? shuffle(names) : shuffle(FALLBACK_SERVERS);
    })
    .catch(() => shuffle(FALLBACK_SERVERS));
  return serversPromise;
}

async function request(path, params = {}, signal) {
  const servers = await getServers();
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
  for (const host of [...servers, 'all.api.radio-browser.info']) {
    try {
      const data = await fetchJson(`https://${host}${path}?${query}`, signal);
      // Stick with a server that works.
      if (servers[0] !== host && servers.includes(host)) servers.unshift(...servers.splice(servers.indexOf(host), 1));
      return data;
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }
  throw new Error('The radio directory is unreachable right now. Check your connection and try again.');
}

/** Converts an API station into a Wisp item, or null if it has no usable URL. */
export function toStationItem(station) {
  const url = safeUrl(station.url_resolved) || safeUrl(station.url);
  const uuid = cleanText(station.stationuuid, 64);
  if (!url || !uuid) return null;
  return {
    id: `radio:${uuid}`,
    kind: 'radio',
    uuid,
    name: cleanText(station.name) || 'Untitled station',
    url,
    logo: safeUrl(station.favicon),
    hls: station.hls === 1,
    meta: {
      country: cleanText(station.countrycode, 4),
      tags: cleanText(station.tags, 200).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 3),
      bitrate: Number(station.bitrate) || 0,
      codec: cleanText(station.codec, 12),
    },
  };
}

/** Searches stations, most-played first. All filters are optional. */
export async function searchStations({ name = '', country = '', tag = '' } = {}, signal) {
  const list = await request(
    '/json/stations/search',
    {
      name: name.trim(),
      countrycode: country,
      tag,
      tagExact: tag ? 'true' : '',
      order: 'clickcount',
      reverse: 'true',
      hidebroken: 'true',
      limit: 200,
    },
    signal,
  );
  return list.map(toStationItem).filter(Boolean);
}

export async function listCountries(signal) {
  const list = await request('/json/countries', { hidebroken: 'true' }, signal);
  return list
    .filter((c) => c.stationcount > 0 && /^[A-Z]{2}$/.test(c.iso_3166_1))
    .map((c) => ({ code: c.iso_3166_1, name: cleanText(c.name, 60) || c.iso_3166_1 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listTags(signal) {
  const list = await request('/json/tags', { order: 'stationcount', reverse: 'true', hidebroken: 'true', limit: 60 }, signal);
  return list.map((t) => cleanText(t.name, 30)).filter(Boolean);
}

/** Tells the directory a station was played; keeps its popularity ranking honest. */
export function countClick(uuid) {
  request(`/json/url/${encodeURIComponent(uuid)}`).catch(() => {});
}

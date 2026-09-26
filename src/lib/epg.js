// Programme guide (XMLTV EPG): matching guide entries to playlist channels,
// "on now / up next" lookups, and a small IndexedDB cache so a guide isn't
// downloaded again on every visit. Parsing happens in epg.worker.js.

import { baseName } from './m3u.js';

const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Keys a channel can be found under in a guide: its tvg-id (with and without "@feed"), then its name. */
export function channelKeys(channel) {
  const keys = [];
  if (channel.tvgId) {
    const id = channel.tvgId.toLowerCase();
    keys.push(`id:${id}`);
    if (id.includes('@')) keys.push(`id:${id.split('@')[0]}`);
  }
  const name = baseName(channel.name || '');
  if (name) keys.push(`name:${name}`);
  return keys;
}

function wantedFor(channels) {
  const ids = new Map();
  const names = new Map();
  for (const channel of channels) {
    for (const key of channelKeys(channel)) {
      const [type, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      if (type === 'id' && !ids.has(value)) ids.set(value, key);
      if (type === 'name' && !names.has(value)) names.set(value, key);
    }
  }
  return { ids: [...ids], names: [...names] };
}

/**
 * Loads a guide for `channels` in a worker.
 * source: { kind: 'url', url } | { kind: 'text', text } | { kind: 'blob', blob }
 * Resolves to { guide, matched, programmes }; rejects with an Error that has `code`.
 */
export function loadGuide(source, channels, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./epg.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        onProgress?.(data.bytes);
        return;
      }
      worker.terminate();
      if (data.type === 'done') resolve(data);
      else reject(Object.assign(new Error(data.message), { code: data.code }));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(Object.assign(new Error("Couldn't start the guide reader."), { code: 'worker' }));
    };
    worker.postMessage({ source, wanted: wantedFor(channels), now: Date.now() });
  });
}

/** Programmes for a channel: [[start, stop, title, desc], …] or undefined. */
export function programmesFor(guide, channel) {
  if (!guide || !channel) return undefined;
  for (const key of channelKeys(channel)) {
    if (guide[key]) return guide[key];
  }
  return undefined;
}

/** { now, next } for a channel at time `at`; entries are { start, stop, title, desc }. */
export function nowNext(guide, channel, at = Date.now()) {
  const list = programmesFor(guide, channel);
  if (!list) return { now: null, next: null };
  const toEntry = (p) => (p ? { start: p[0], stop: p[1], title: p[2], desc: p[3] } : null);
  const index = list.findIndex((p) => p[1] > at);
  if (index === -1) return { now: null, next: null };
  const entry = list[index];
  return entry[0] <= at ? { now: toEntry(entry), next: toEntry(list[index + 1]) } : { now: null, next: toEntry(entry) };
}

// ---- IndexedDB cache ---------------------------------------------------------

function db() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wisp', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('kv');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idb(mode, fn) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('kv', mode);
    const request = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(request?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheGuide(key, value) {
  try {
    await idb('readwrite', (store) => store.put({ ...value, savedAt: Date.now() }, `guide:${key}`));
  } catch {
    // Private mode / storage full: the guide still works for this session.
  }
}

/** A cached guide for `key` if it's recent enough, else null. */
export async function cachedGuide(key) {
  try {
    const value = await idb('readonly', (store) => store.get(`guide:${key}`));
    return value && Date.now() - value.savedAt < CACHE_MAX_AGE_MS ? value : null;
  } catch {
    return null;
  }
}

export async function forgetGuide(key) {
  try {
    await idb('readwrite', (store) => store.delete(`guide:${key}`));
  } catch {
    // Nothing to forget.
  }
}

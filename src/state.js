// App-wide state as Preact signals. Components read `.value` and re-render
// only when what they read changes; persistence is handled by effects below.

import { computed, effect, signal } from '@preact/signals';
import { load, save } from './lib/storage.js';
import { sanitizeItem } from './lib/backup.js';
import { baseName } from './lib/m3u.js';

const MAX_RECENTS = 40;

// Items in storage were written by us, but re-validate anyway: it's cheap and
// keeps a tampered/old entry from ever reaching the player.
export { sanitizeItem };
const loadItems = (key) => (load(key, []) || []).map(sanitizeItem).filter(Boolean);

/** Which panel is showing: 'tv' | 'radio' | 'saved'. */
export const mode = signal(['tv', 'radio', 'saved'].includes(load('mode')) ? load('mode') : 'tv');

/** Loaded channel playlist: { name, url, channels, groups } or null. */
export const playlist = signal(null);
/** Whether the TV panel shows the "open a playlist" form instead of the list. */
export const showSourceForm = signal(false);
export const channelQuery = signal('');
export const channelGroup = signal('');

export const filteredChannels = computed(() => {
  const list = playlist.value?.channels ?? [];
  const group = channelGroup.value;
  const terms = channelQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!group && !terms.length) return list;
  return list.filter((channel) => {
    if (group && !channel.groups.includes(group)) return false;
    if (!terms.length) return true;
    const haystack = (channel.name + ' ' + channel.groups.join(' ')).toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
});

// ---- Backup sources ----
// Playlists often list the same channel several times (different quality or
// mirrors). Those other entries become backups the player tries, in playlist
// order, if the chosen one fails.
const sameChannelKey = (channel) =>
  channel.tvgId ? `id:${channel.tvgId.toLowerCase().split('@')[0]}` : `name:${baseName(channel.name)}`;

const duplicates = computed(() => {
  const index = new Map();
  for (const channel of playlist.value?.channels ?? []) {
    const key = sameChannelKey(channel);
    if (key === 'name:') continue;
    const list = index.get(key);
    if (list) list.push(channel);
    else index.set(key, [channel]);
  }
  return index;
});

/** The item with `alternates` attached (TV channels that have duplicates in the playlist). */
export function withBackups(item) {
  if (item.kind !== 'tv' || item.alternates) return item;
  const same = duplicates.value.get(sameChannelKey(item));
  if (!same || same.length < 2) return item;
  return {
    ...item,
    alternates: same.filter((c) => c.id !== item.id).slice(0, 3).map((c) => ({ url: c.url, headers: c.headers })),
  };
}

/** The item being played, and the list it was picked from (for next/previous). */
export const current = signal(null);
export const queue = signal([]);
/** Bumped to force a reload of the current item ("Try again"). */
export const retryToken = signal(0);
/** True when playback was started without a user gesture (resume / deep link). */
export const autoStarted = signal(false);

/** Player status: { state: 'idle'|'loading'|'playing'|'buffering'|'paused'|'blocked'|'error', message? } */
export const status = signal({ state: 'idle' });
export const levels = signal([]);
export const activeLevel = signal(null);

export const quality = signal(['auto', 'low', 'high'].includes(load('quality')) ? load('quality') : 'auto');
export const favorites = signal(loadItems('favorites'));
export const recents = signal(loadItems('recents'));
export const favoriteIds = computed(() => new Set(favorites.value.map((f) => f.id)));

// ---- View state ----
/** Live stats overlay on the player. */
export const statsOpen = signal(load('stats') === true);
/** Zen mode: everything but the picture hidden. */
export const zen = signal(false);
/** Command palette (Ctrl/Cmd+K). */
export const paletteOpen = signal(false);
/** Keys typed after Ctrl+K but before the palette's field had focus. */
export const paletteSeed = { text: '' };
/** Settings dialog. */
export const settingsOpen = signal(false);
/** Multiview: { tiles: (item|null)[4], focus: index } or null when off. */
export const multiview = signal(null);
/** Drop to the lowest quality while the tab is hidden. */
export const backgroundSaver = signal(load('backgroundSaver') !== false);

// ---- Programme guide ----
/** Loaded guide: { label, key, data, matched, programmes } or null. */
export const guide = signal(null);
/** { state: 'idle' | 'loading' | 'error', bytes?, message? } */
export const guideStatus = signal({ state: 'idle' });
/** Current time, ticking every 30 s, for "on now" displays. */
export const clock = signal(Date.now());
if (typeof window !== 'undefined') setInterval(() => (clock.value = Date.now()), 30000);

/** Short-lived message at the bottom of the screen. */
export const toast = signal('');
let toastTimer;
export function showToast(message, duration = 2600) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), duration);
}

// Only what's needed to play an item again later (not UI-only fields).
function storable(item) {
  const { id, kind, name, url, logo, groups, headers, hls, audio, prefer, uuid, meta, tvgId } = item;
  return { id, kind, name, url, logo, groups, headers, hls, audio, prefer, uuid, meta, tvgId };
}

export function playItem(item, { list = [], auto = false } = {}) {
  item = withBackups(item);
  autoStarted.value = auto;
  queue.value = list;
  if (multiview.value) {
    addToMultiview(item);
    return;
  }
  if (current.value?.id === item.id) retryToken.value++;
  // Set synchronously so the UI never shows the previous item's status for a frame.
  status.value = { state: 'loading' };
  current.value = item;
  const entry = storable(item);
  recents.value = [entry, ...recents.value.filter((r) => r.id !== item.id)].slice(0, MAX_RECENTS);
  save('last', entry);
}

/** Plays the next (+1) or previous (-1) item in the list the current one came from. */
export function step(delta) {
  const list = queue.value;
  const index = list.findIndex((item) => item.id === current.value?.id);
  if (index === -1 || list.length < 2) return;
  playItem(list[(index + delta + list.length) % list.length], { list });
}

export function toggleFavorite(item) {
  if (favoriteIds.value.has(item.id)) {
    favorites.value = favorites.value.filter((f) => f.id !== item.id);
    showToast('Removed from favorites');
  } else {
    favorites.value = [storable(item), ...favorites.value];
    showToast('Added to favorites');
  }
}

export function clearRecents() {
  recents.value = [];
}

effect(() => save('mode', mode.value));
effect(() => save('quality', quality.value));
effect(() => save('stats', statsOpen.value));
effect(() => save('backgroundSaver', backgroundSaver.value));
effect(() => save('favorites', favorites.value));
effect(() => save('recents', recents.value));

// ---- Multiview ----
export const MAX_TILES = 4;

export function enterMultiview() {
  const tiles = Array(MAX_TILES).fill(null);
  tiles[0] = current.value;
  multiview.value = { tiles, focus: 0 };
}

export function exitMultiview() {
  const view = multiview.value;
  multiview.value = null;
  const focused = view?.tiles[view.focus] ?? view?.tiles.find(Boolean) ?? null;
  // The single player starts fresh on the focused stream.
  if (focused) status.value = { state: 'loading' };
  current.value = focused;
}

/** Puts `item` in the first empty tile (or replaces the focused one) and listens to it. */
function addToMultiview(item) {
  const view = multiview.value;
  const tiles = [...view.tiles];
  let index = tiles.findIndex((t) => t?.id === item.id);
  if (index === -1) index = tiles.indexOf(null);
  if (index === -1) index = view.focus;
  tiles[index] = item;
  multiview.value = { tiles, focus: index };
  current.value = item;
  const entry = storable(item);
  recents.value = [entry, ...recents.value.filter((r) => r.id !== item.id)].slice(0, MAX_RECENTS);
}

export function focusTile(index) {
  const view = multiview.value;
  if (!view?.tiles[index] || view.focus === index) return;
  multiview.value = { ...view, focus: index };
  current.value = view.tiles[index];
}

export function closeTile(index) {
  const view = multiview.value;
  if (!view) return;
  const tiles = view.tiles.map((t, i) => (i === index ? null : t));
  let focus = view.focus;
  if (focus === index) {
    const next = tiles.findIndex(Boolean);
    focus = next === -1 ? 0 : next;
  }
  multiview.value = { tiles, focus };
  current.value = tiles[focus];
}

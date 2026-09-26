// App-wide state as Preact signals. Components read `.value` and re-render
// only when what they read changes; persistence is handled by effects below.

import { computed, effect, signal } from '@preact/signals';
import { load, save } from './lib/storage.js';
import { cleanText, safeUrl } from './lib/sanitize.js';

const MAX_RECENTS = 40;

// Items in storage were written by us, but re-validate anyway: it's cheap and
// keeps a tampered/old entry from ever reaching the player.
export function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const url = safeUrl(item.url);
  if (!url || !['tv', 'radio', 'stream'].includes(item.kind)) return null;
  return {
    ...item,
    id: cleanText(item.id, 2100) || `${item.kind}:${url}`,
    name: cleanText(item.name) || 'Untitled',
    url,
    logo: safeUrl(item.logo, { allowImageData: true }),
  };
}
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

/** Short-lived message at the bottom of the screen. */
export const toast = signal('');
let toastTimer;
export function showToast(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ''), 2600);
}

// Only what's needed to play an item again later (not UI-only fields).
function storable(item) {
  const { id, kind, name, url, logo, groups, headers, hls, audio, uuid, meta } = item;
  return { id, kind, name, url, logo, groups, headers, hls, audio, uuid, meta };
}

export function playItem(item, { list = [], auto = false } = {}) {
  autoStarted.value = auto;
  queue.value = list;
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
effect(() => save('favorites', favorites.value));
effect(() => save('recents', recents.value));

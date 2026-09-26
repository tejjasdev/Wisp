// Glue between the playback engine (lib/player.js) and components: a hook
// that runs one playback on one media element, plus a registry of whichever
// playback currently has the user's attention (the single player, or the
// focused multiview tile) for stats, keyboard shortcuts, PiP and snapshots.

import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { startPlayback } from './lib/player.js';
import { activeLevel, backgroundSaver, levels, quality, status } from './state.js';

/** The playback with the user's attention. Not a signal: read on demand. */
export const active = { controller: null, media: null, item: null };
/** Bumped whenever `active` changes, for components that must re-render. */
export const activeVersion = signal(0);

function setActive(controller, media, item) {
  active.controller = controller;
  active.media = media;
  active.item = item;
  activeVersion.value++;
}

/**
 * Plays `item` on the element in `mediaRef` for as long as the component
 * lives. With `publish`, status/levels are mirrored into the global signals
 * and this playback becomes the `active` one.
 */
export function usePlayback(mediaRef, item, { publish = false, lowPower = false, retry = 0 } = {}) {
  const [state, setState] = useState({ status: { state: item ? 'loading' : 'idle' }, levels: [], level: null, source: null });
  const controller = useRef(null);
  const startedFor = useRef(undefined);
  const latest = useRef(state);
  const publishRef = useRef(publish);
  publishRef.current = publish;

  const update = (patch) => {
    latest.current = { ...latest.current, ...patch };
    setState(latest.current);
    if (!publishRef.current) return;
    if ('status' in patch) status.value = patch.status;
    if ('levels' in patch) levels.value = patch.levels;
    if ('level' in patch) activeLevel.value = patch.level;
  };

  useEffect(() => {
    if (!item) {
      update({ status: { state: 'idle' }, levels: [], level: null });
      return;
    }
    const media = mediaRef.current;
    const playback = startPlayback(media, item, {
      quality: quality.peek(),
      lowPower,
      onStatus: (next) => update({ status: next }),
      onLevels: (list) => update({ levels: list, level: null }),
      onLevel: (level) => update({ level }),
      onSource: (source) => update({ source }),
    });
    controller.current = playback;
    startedFor.current = item;
    playback.setBackground(isBackground());
    if (publishRef.current) setActive(playback, media, item);
    return () => {
      playback.destroy();
      controller.current = null;
      if (active.controller === playback) setActive(null, null, null);
    };
  }, [item, retry]);

  // Becoming the focused one (multiview): take over the global status.
  useEffect(() => {
    if (!publish || !controller.current) return;
    setActive(controller.current, mediaRef.current, item);
    status.value = latest.current.status;
    levels.value = latest.current.levels;
    activeLevel.value = latest.current.level;
  }, [publish]);

  useEffect(() => controller.current?.setQuality(quality.value), [quality.value]);
  useEffect(() => controller.current?.setLowPower(lowPower), [lowPower]);

  // Between an item change and its effect running, don't show the previous item's state.
  if (startedFor.current !== item && item) {
    return { status: { state: 'loading' }, levels: [], level: null, source: null, controller };
  }
  return { ...state, controller };
}

// ---- Background-tab bandwidth saver ----------------------------------------
// A hidden tab keeps playing (people listen to news in the background) but
// drops to the lowest quality. Picture-in-picture counts as visible.

const listeners = new Set();

export function isBackground() {
  return backgroundSaver.value && document.visibilityState === 'hidden' && !document.pictureInPictureElement;
}

/** Subscribe to background changes; returns an unsubscribe function. */
export function onBackgroundChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function notifyBackground() {
  const hidden = isBackground();
  active.controller?.setBackground(hidden);
  for (const callback of listeners) callback(hidden);
}

// Re-evaluate when the setting itself changes.
backgroundSaver.subscribe(() => typeof document !== 'undefined' && notifyBackground());

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', notifyBackground);
  document.addEventListener('leavepictureinpicture', notifyBackground, true);
  document.addEventListener('enterpictureinpicture', notifyBackground, true);
}

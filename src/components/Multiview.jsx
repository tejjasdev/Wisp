// Multiview: up to four streams at once, like a broadcast monitor wall.
// The focused tile has sound, full adaptive quality and the red tally frame.
// The others are muted and held at their lowest quality, and they stop
// downloading altogether while the tab is hidden, so four streams stay
// affordable on a modest connection. Loaded on demand.

import { useEffect, useRef, useState } from 'preact/hooks';
import { onBackgroundChange, usePlayback } from '../playback.js';
import { closeTile, focusTile, multiview, status, statsOpen } from '../state.js';
import { toggleFullscreen } from '../playerActions.js';
import { Logo } from './Logo.jsx';
import { isAudioItem, StatsOverlay } from './Monitor.jsx';
import { Controls } from './Controls.jsx';
import { CloseIcon, PlusIcon, RetryIcon } from './icons.jsx';

export default function Multiview() {
  const view = multiview.value;
  if (!view) return null;
  const filled = view.tiles.filter(Boolean).length;
  // Show the filled tiles plus one empty slot to add to, up to four.
  const slots = view.tiles
    .map((item, index) => ({ item, index }))
    .filter(({ item }, i, all) => item || all.findIndex((s) => !s.item) === i)
    .slice(0, 4);
  const focusedItem = view.tiles[view.focus];

  return (
    <div class={`stage multiview count-${slots.length}`} role="group" aria-label={`Multiview, ${filled} of 4 screens`}>
      <div class="mv-grid">
        {slots.map(({ item, index }) =>
          item ? (
            <Tile key={item.id} item={item} index={index} focused={index === view.focus} />
          ) : (
            <EmptySlot key={`empty-${index}`} />
          ),
        )}
      </div>
      {focusedItem && <Controls state={status.value.state} audioMode={isAudioItem(focusedItem)} />}
      {focusedItem && statsOpen.value && <StatsOverlay />}
    </div>
  );
}

function Tile({ item, index, focused }) {
  const videoRef = useRef(null);
  const [retry, setRetry] = useState(0);
  const { status, level, controller } = usePlayback(videoRef, item, { publish: focused, lowPower: !focused, retry });
  const { state, message } = status;
  const audioOnly = isAudioItem(item);

  // Only the focused tile makes sound.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = !focused;
  }, [focused]);

  // Muted tiles stop downloading entirely while the tab is hidden.
  useEffect(() => {
    if (focused) return;
    return onBackgroundChange((hidden) => controller.current?.setSuspended(hidden));
  }, [focused]);

  const label = `${focused ? 'Listening to' : 'Listen to'} ${item.name}, screen ${index + 1}`;

  return (
    <div class={`tile state-${state}${focused ? ' is-focused' : ''}`}>
      <video ref={videoRef} class="video" playsInline muted={!focused} preload="none" hidden={audioOnly} />

      {(state === 'loading' || state === 'error' || audioOnly) && (
        <div class="tile-card">
          <Logo key={item.id} src={item.logo} name={item.name} size="md" />
          {state === 'error' && <p class="tile-error">{message}</p>}
        </div>
      )}

      <button type="button" class="tile-focus" aria-pressed={focused} aria-label={label}
        onClick={() => focusTile(index)} onDblClick={toggleFullscreen} />

      <div class="tile-bar">
        <span class="tile-num" aria-hidden="true">{index + 1}</span>
        <span class="tile-name">{item.name}</span>
        {level?.height > 0 && <span class="tile-res">{level.height}p</span>}
        {state === 'error' && (
          <button type="button" class="ctl small" aria-label={`Try ${item.name} again`} onClick={() => setRetry((n) => n + 1)}>
            <RetryIcon />
          </button>
        )}
        <button type="button" class="ctl small" aria-label={`Close ${item.name}`} onClick={() => closeTile(index)}>
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <button type="button" class="tile tile-empty"
      onClick={() => (document.getElementById('search') || document.querySelector('.vlist'))?.focus()}>
      <PlusIcon />
      <span>Pick a channel or station from the list to add it here</span>
    </button>
  );
}

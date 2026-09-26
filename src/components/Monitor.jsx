import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { usePlayback } from '../playback.js';
import { countClick } from '../lib/radio-browser.js';
import { lazyComponent } from '../lazy.js';
import { autoStarted, current, mode, playlist, queue, retryToken, showSourceForm, showToast, statsOpen, step } from '../state.js';
import { toggleFullscreen, togglePlay } from '../playerActions.js';
import { Controls } from './Controls.jsx';
import { Logo } from './Logo.jsx';
import { PlayIcon, RetryIcon } from './icons.jsx';

export const StatsOverlay = lazyComponent(() => import('./StatsOverlay.jsx'));

export const isAudioItem = (item) => Boolean(item && (item.kind === 'radio' || item.audio));

const IDLE_MS = 2600;

/** The single-stream player: picture, status overlays and controls. */
export function Monitor() {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const [noVideoTrack, setNoVideoTrack] = useState(false);
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef(0);

  const item = current.value;
  // Resolved when playback starts, so it always matches the item being played.
  const mediaRef = { get current() { return isAudioItem(current.peek()) ? audioRef.current : videoRef.current; } };
  const { status, source } = usePlayback(mediaRef, item, { publish: true, retry: retryToken.value });
  const { state, message, detail } = status;

  // Say so when a backup source took over — otherwise it would be invisible.
  const backupPlaying = state === 'playing' && source?.index > 0;
  useEffect(() => {
    if (backupPlaying) showToast('The main source failed, so a backup source is playing');
  }, [backupPlaying, item]);
  const audioMode = isAudioItem(item) || noVideoTrack;

  useEffect(() => {
    setNoVideoTrack(false);
    if (item?.kind === 'radio' && item.uuid) countClick(item.uuid);
  }, [item]);

  // Hide controls and cursor after a moment of no pointer activity while playing.
  const wake = (event) => {
    if (event?.pointerType === 'touch') return; // touch toggles controls with a tap instead
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  // Start the auto-hide countdown when the picture appears (touch screens have no hover to start it).
  useEffect(() => {
    if (state === 'playing') wake();
  }, [state === 'playing']);

  // A stream with no picture (e.g. a radio station shared as a plain link).
  const checkVideoTrack = () => {
    const el = videoRef.current;
    if (el && el.readyState >= 1 && el.videoWidth === 0) setNoVideoTrack(true);
  };

  const hideControls = idle && state === 'playing' && !audioMode;

  return (
    <div
      class={`stage monitor state-${state}${audioMode ? ' is-audio' : ''}${hideControls ? ' is-idle' : ''}`}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      <video
        ref={videoRef}
        class="video"
        playsInline
        preload="none"
        hidden={audioMode}
        onLoadedMetadata={checkVideoTrack}
        onPlaying={checkVideoTrack}
      />
      <audio ref={audioRef} preload="none" />

      {item && !audioMode && ['playing', 'paused', 'buffering'].includes(state) && (
        <GestureSurface videoRef={videoRef} onTap={() => (idle ? wake() : setIdle(true))} />
      )}

      <StageOverlay item={item} state={state} message={message} detail={detail} audioMode={audioMode} />
      {item && !audioMode && <ChannelOsd key={item.id} item={item} />}

      {/* Transport controls only make sense once there's something to control. */}
      {item && (audioMode ? state !== 'error' : ['playing', 'paused', 'buffering'].includes(state)) && (
        <Controls state={state} audioMode={audioMode} />
      )}
      {item && statsOpen.value && <StatsOverlay />}
    </div>
  );
}

// ---- Touch gestures ----
// Vertical swipe on the right half: volume. Left half: brightness. Tap: show or
// hide the controls. Mouse: click to play/pause, double-click for fullscreen.
// Websites can't change the screen's brightness, so "brightness" here brightens
// or dims the picture itself. iOS ignores volume set by websites (hardware
// buttons only), so the volume swipe is only offered where it works.

const brightness = signal(1);
const canSetVolume = (() => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('audio');
  probe.volume = 0.5;
  return probe.volume === 0.5;
})();

function GestureSurface({ videoRef, onTap }) {
  const drag = useRef(null);
  const [meter, setMeter] = useState(null);
  const hideTimer = useRef(0);

  useEffect(() => {
    if (videoRef.current) videoRef.current.style.filter = brightness.value === 1 ? '' : `brightness(${brightness.value})`;
  }, [brightness.value]);

  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side = e.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      side,
      height: rect.height,
      start: side === 'left' ? brightness.peek() : videoRef.current?.volume ?? 1,
      moved: false,
      at: Date.now(),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dy = d.y - e.clientY;
    if (!d.moved) {
      if (Math.abs(dy) < 12 || Math.abs(dy) < Math.abs(e.clientX - d.x)) return;
      if (d.side === 'right' && !canSetVolume) return;
      d.moved = true;
    }
    const delta = dy / (d.height * 0.8);
    clearTimeout(hideTimer.current);
    if (d.side === 'left') {
      const value = Math.min(1.6, Math.max(0.3, d.start + delta));
      brightness.value = Math.round(value * 100) / 100;
      setMeter({ side: 'left', label: 'Brightness', fill: (value - 0.3) / 1.3 });
    } else {
      const media = videoRef.current;
      const value = Math.min(1, Math.max(0, d.start + delta));
      if (media) {
        media.volume = value;
        media.muted = value === 0;
      }
      setMeter({ side: 'right', label: 'Volume', fill: value });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved && Date.now() - d.at < 400) onTap();
    hideTimer.current = setTimeout(() => setMeter(null), 700);
  };

  return (
    <div
      class="surface"
      aria-hidden="true"
      onClick={(e) => e.pointerType !== 'touch' && togglePlay()}
      onDblClick={toggleFullscreen}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {meter && (
        <div class={`gesture-meter is-${meter.side}`}>
          <span class="meter"><span style={{ height: `${Math.round(meter.fill * 100)}%` }} /></span>
          {meter.label}
        </div>
      )}
    </div>
  );
}

/** Colour bars, like a broadcaster's test card: what the monitor shows with no picture. */
function TestCard({ scanning = false }) {
  return (
    <div class={scanning ? 'test-card is-scanning' : 'test-card'} aria-hidden="true">
      <div class="bars">{Array.from({ length: 7 }, (_, i) => <span key={i} />)}</div>
      <div class="castellations">{Array.from({ length: 7 }, (_, i) => <span key={i} />)}</div>
      <div class="pluge"><span /><span /><span /><span /></div>
    </div>
  );
}

/**
 * The channel number and name, keyed on in the corner for a few seconds after
 * a channel change, like a TV's own on-screen display. Decorative: the lower
 * third already says the same thing to assistive tech.
 */
function ChannelOsd({ item }) {
  return (
    <div class="osd" aria-hidden="true">
      {item.number && <span class="osd-num">{String(item.number).padStart(3, '0')}</span>}
      <span class="osd-name">{item.name}</span>
    </div>
  );
}

function StageOverlay({ item, state, message, detail, audioMode }) {
  if (!item) {
    // The blue screen a set shows when nothing is coming in.
    return (
      <div class="overlay no-signal">
        <p class="osd-tag">No signal</p>
        <p class="no-signal-text">
          {playlist.value || mode.value !== 'tv'
            ? 'Pick a channel or station from the list.'
            : 'Open a playlist or a stream link, or pick a radio station.'}
        </p>
      </div>
    );
  }

  const kindWord = item.kind === 'radio' ? 'station' : item.kind === 'tv' ? 'channel' : 'stream';

  if (state === 'error') {
    return (
      <div class="overlay is-off-air">
        {!audioMode && <TestCard />}
        <div class="slate">
          <p class="slate-title">This {kindWord} isn't available</p>
          <p class="slate-text" role="alert">{message}</p>
          <div class="slate-actions">
            <button type="button" class="btn primary" onClick={() => retryToken.value++}>
              <RetryIcon /> Try again
            </button>
            {queue.value.length > 1 && (
              <button type="button" class="btn" onClick={() => step(1)}>Next {kindWord}</button>
            )}
            {item.kind === 'stream' && !item.audio && (
              <button type="button" class="btn" onClick={() => {
                mode.value = 'tv';
                showSourceForm.value = 'paste';
              }}>Paste playlist text</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state === 'blocked') {
    return (
      <div class="overlay">
        {!audioMode && <TestCard />}
        <button type="button" class="slate tap-to-play" onClick={togglePlay}>
          <span class="big-play"><PlayIcon size={30} /></span>
          <span class="slate-title">Play {item.name}</span>
          <span class="slate-text">
            {autoStarted.value ? 'Your browser needs a tap or click before it plays sound.' : 'Tap to start playback.'}
          </span>
        </button>
      </div>
    );
  }

  if (audioMode) {
    // The station is the picture; its status lives in the lower third.
    return (
      <div class={`overlay radio-card state-${state}`}>
        <Logo key={item.id} src={item.logo} name={item.name} size="lg" />
        <p class="radio-name">{item.name}</p>
        {state === 'loading' && <p class="radio-status" aria-live="polite">{detail || 'Tuning in…'}</p>}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div class="overlay">
        <TestCard scanning />
        <div class="slate is-tuning" key={item.id}>
          <Logo src={item.logo} name={item.name} size="md" />
          <p class="slate-title">{item.name}</p>
          <p class="slate-text" aria-live="polite">{detail || 'Tuning in…'}</p>
        </div>
      </div>
    );
  }

  if (state === 'buffering') {
    return <div class="buffering-chip" aria-live="polite">Buffering…</div>;
  }
  return null;
}

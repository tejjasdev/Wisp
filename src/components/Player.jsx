import { useEffect, useRef, useState } from 'preact/hooks';
import { startPlayback } from '../lib/player.js';
import { countClick } from '../lib/radio-browser.js';
import { shareUrl } from '../actions.js';
import {
  activeLevel, autoStarted, current, favoriteIds, levels, mode, quality, queue, retryToken,
  showSourceForm, showToast, status, step, toggleFavorite,
} from '../state.js';
import { describeItem } from './ItemRow.jsx';
import { Logo } from './Logo.jsx';
import { PauseIcon, PlayIcon, RetryIcon, ShareIcon, StarIcon, VolumeIcon } from './icons.jsx';

/** Imperative controls for keyboard shortcuts (set while the Player is mounted). */
export const playerApi = { toggle() {}, toggleMute() {}, fullscreen() {} };

const isAudioItem = (item) => item && (item.kind === 'radio' || item.audio);

export function Player() {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const controller = useRef(null);
  const [noVideoTrack, setNoVideoTrack] = useState(false);
  const [muted, setMuted] = useState(false);

  const item = current.value;
  const { state, message } = status.value;
  const audioMode = isAudioItem(item) || noVideoTrack;
  const media = () => (isAudioItem(current.peek()) ? audioRef.current : videoRef.current);

  // (Re)start playback whenever the item changes or the user hits "Try again".
  useEffect(() => {
    setNoVideoTrack(false);
    if (!item) {
      status.value = { state: 'idle' };
      return;
    }
    controller.current = startPlayback(media(), item, {
      quality: quality.peek(),
      onStatus: (next) => (status.value = next),
      onLevels: (list) => {
        levels.value = list;
        activeLevel.value = null;
      },
      onLevel: (level) => (activeLevel.value = level),
    });
    return () => {
      controller.current?.destroy();
      controller.current = null;
    };
  }, [item, retryToken.value]);

  useEffect(() => {
    if (item?.kind === 'radio' && item.uuid) countClick(item.uuid);
    document.title = item ? `${item.name} – Wisp` : 'Wisp';
  }, [item]);

  useEffect(() => controller.current?.setQuality(quality.value), [quality.value]);

  // Lock-screen / hardware media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !item) return;
    const artwork = item.logo && !item.logo.startsWith('data:') ? [{ src: item.logo }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.name, artist: describeItem(item) || 'Wisp', artwork });
    const actions = {
      play: () => controller.current?.play(),
      pause: () => media()?.pause(),
      nexttrack: queue.value.length > 1 ? () => step(1) : null,
      previoustrack: queue.value.length > 1 ? () => step(-1) : null,
    };
    for (const [action, handler] of Object.entries(actions)) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Unsupported action in this browser.
      }
    }
  }, [item]);

  const toggle = () => {
    const el = media();
    if (!el || !current.peek()) return;
    const s = status.peek().state;
    if (s === 'error') retryToken.value++;
    else if (s === 'blocked' || el.paused) controller.current?.play();
    else el.pause();
  };
  const toggleMute = () => {
    const el = media();
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };
  playerApi.toggle = toggle;
  playerApi.toggleMute = toggleMute;
  playerApi.fullscreen = () => {
    const el = videoRef.current;
    if (!el || audioMode) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else el.webkitEnterFullscreen?.();
  };

  // A stream with no picture (e.g. a radio station shared as a plain link).
  const checkVideoTrack = () => {
    const el = videoRef.current;
    if (el && el.readyState >= 1 && el.videoWidth === 0) setNoVideoTrack(true);
  };

  const showVideoControls = !audioMode && ['playing', 'paused', 'buffering'].includes(state);

  return (
    <section class="player" aria-label="Player">
      <div class={`stage state-${state}${audioMode ? ' is-audio' : ''}`}>
        <video
          ref={videoRef}
          class="video"
          playsInline
          preload="none"
          controls={showVideoControls}
          hidden={audioMode}
          onLoadedMetadata={checkVideoTrack}
          onPlaying={checkVideoTrack}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        />
        <audio ref={audioRef} preload="none" onVolumeChange={(e) => setMuted(e.currentTarget.muted)} />
        <StageOverlay item={item} state={state} message={message} audioMode={audioMode} onToggle={toggle} />
      </div>

      {item && (
        <div class="now">
          {audioMode && state !== 'error' && (
            <div class="transport">
              <button type="button" class="round-btn" onClick={toggle}
                aria-label={['playing', 'buffering', 'loading'].includes(state) ? 'Pause' : 'Play'}>
                {['playing', 'buffering', 'loading'].includes(state) ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
              </button>
              <button type="button" class="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
                <VolumeIcon muted={muted} />
              </button>
            </div>
          )}
          <div class="now-text">
            <h2 class="now-name">{item.name}</h2>
            <p class="now-meta">{describeItem(item)}</p>
          </div>
          <div class="now-actions">
            <QualityPicker />
            <button type="button" class={favoriteIds.value.has(item.id) ? 'icon-btn fav is-on' : 'icon-btn fav'}
              aria-label={favoriteIds.value.has(item.id) ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={favoriteIds.value.has(item.id)} onClick={() => toggleFavorite(item)}>
              <StarIcon filled={favoriteIds.value.has(item.id)} />
            </button>
            <button type="button" class="icon-btn" aria-label="Copy link to this stream" onClick={() => share(item)}>
              <ShareIcon />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function StageOverlay({ item, state, message, audioMode, onToggle }) {
  if (!item) {
    return (
      <div class="overlay">
        <div class="stage-empty">
          <p class="stage-title">Nothing playing</p>
          <p class="stage-text">Open a playlist or stream link, or pick a radio station.</p>
        </div>
      </div>
    );
  }

  const kindWord = item.kind === 'radio' ? 'station' : item.kind === 'tv' ? 'channel' : 'stream';

  if (state === 'error') {
    return (
      <div class="overlay">
        <div class="stage-card">
          <Logo key={item.id} src={item.logo} name={item.name} size="lg" />
          <p class="stage-title">This {kindWord} isn't available</p>
          <p class="stage-text" role="alert">{message}</p>
          <div class="stage-actions">
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
        <button type="button" class="stage-card tap-to-play" onClick={onToggle}>
          <span class="big-play"><PlayIcon size={34} /></span>
          <span class="stage-title">Play {item.name}</span>
          <span class="stage-text">
            {autoStarted.value ? 'Your browser needs a tap or click before it plays sound.' : 'Tap to start playback.'}
          </span>
        </button>
      </div>
    );
  }

  if (state === 'loading' || audioMode) {
    const label = { loading: 'Connecting…', buffering: 'Buffering…', paused: 'Paused', playing: 'Live' }[state] || '';
    return (
      <div class="overlay">
        <div class={`stage-card${state === 'playing' ? ' is-playing' : ''}`}>
          <div class="glow-wrap">
            <span class="glow" aria-hidden="true" />
            <Logo key={item.id} src={item.logo} name={item.name} size="lg" />
          </div>
          <p class="stage-title">{item.name}</p>
          <p class="stage-text" aria-live="polite">{label}</p>
        </div>
      </div>
    );
  }

  if (state === 'buffering') {
    return <div class="buffering-chip" aria-live="polite">Buffering…</div>;
  }
  return null;
}

function QualityPicker() {
  const list = levels.value;
  if (list.filter((l) => l.height > 0).length < 2) return null;
  const heights = list.map((l) => l.height).filter(Boolean);
  const current = activeLevel.value?.height;
  return (
    <select class="quality" aria-label="Video quality" value={quality.value}
      onChange={(e) => (quality.value = e.currentTarget.value)}>
      <option value="auto">Auto{current ? ` (${current}p)` : ''}</option>
      <option value="low">Low ({Math.min(...heights)}p)</option>
      <option value="high">High ({Math.max(...heights)}p)</option>
    </select>
  );
}

async function share(item) {
  const url = shareUrl(item);
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: item.name, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    showToast('Link copied');
  } catch (err) {
    if (err?.name !== 'AbortError') showToast("Couldn't copy the link");
  }
}

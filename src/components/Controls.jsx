import { useEffect, useState } from 'preact/hooks';
import { active, activeVersion } from '../playback.js';
import { activeLevel, levels, quality, statsOpen } from '../state.js';
import { pipSupported, setVolume, toggleFullscreen, toggleMute, togglePip, togglePlay } from '../playerActions.js';
import { FullscreenIcon, PauseIcon, PipIcon, PlayIcon, StatsIcon, VolumeIcon } from './icons.jsx';

const formatTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

/** Tracks the active media element's play state, volume and position. */
function useMediaState() {
  const version = activeVersion.value;
  const read = () => {
    const m = active.media;
    return m
      ? { paused: m.paused, muted: m.muted, volume: m.volume, time: m.currentTime, duration: m.duration }
      : { paused: true, muted: false, volume: 1, time: 0, duration: NaN };
  };
  const [media, setMedia] = useState(read);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));

  useEffect(() => {
    const m = active.media;
    setMedia(read());
    if (!m) return;
    const events = ['play', 'pause', 'volumechange', 'timeupdate', 'durationchange', 'emptied'];
    const sync = () => setMedia(read());
    for (const e of events) m.addEventListener(e, sync);
    return () => events.forEach((e) => m.removeEventListener(e, sync));
  }, [version]);

  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  return { ...media, fullscreen };
}

/** On-picture controls. Every control is a real button/range, so keyboards and screen readers work. */
export function Controls({ state, audioMode }) {
  const media = useMediaState();
  const playing = ['playing', 'buffering'].includes(state) || (state === 'loading' && !media.paused);
  const live = !Number.isFinite(media.duration);
  const videoLevels = levels.value.filter((l) => l.height > 0);

  return (
    <div class="controls" role="group" aria-label="Playback controls">
      <button type="button" class="ctl" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (K)' : 'Play (K)'}>
        {playing ? <PauseIcon size={22} /> : <PlayIcon size={22} />}
      </button>
      <button type="button" class="ctl" onClick={toggleMute} aria-label={media.muted ? 'Unmute' : 'Mute'} title="Mute (M)">
        <VolumeIcon muted={media.muted || media.volume === 0} />
      </button>
      <input
        class="volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={media.muted ? 0 : media.volume}
        style={{ '--fill': `${(media.muted ? 0 : media.volume) * 100}%` }}
        aria-label="Volume"
        onInput={(e) => setVolume(Number(e.currentTarget.value))}
      />

      {audioMode ? null : live ? (
        <span class={state === 'playing' ? 'live-badge is-on' : 'live-badge'}>Live</span>
      ) : (
        <div class="seek">
          <span class="time">{formatTime(media.time)}</span>
          <input
            type="range"
            min="0"
            max={media.duration || 0}
            step="1"
            value={media.time}
            style={{ '--fill': `${media.duration ? (media.time / media.duration) * 100 : 0}%` }}
            aria-label="Seek"
            aria-valuetext={`${formatTime(media.time)} of ${formatTime(media.duration || 0)}`}
            onInput={(e) => active.media && (active.media.currentTime = Number(e.currentTarget.value))}
          />
          <span class="time">{formatTime(media.duration || 0)}</span>
        </div>
      )}

      <span class="ctl-spacer" />

      {videoLevels.length > 1 && (
        <select class="quality" aria-label="Video quality" value={quality.value} onChange={(e) => (quality.value = e.currentTarget.value)}>
          <option value="auto">Auto{activeLevel.value?.height ? ` (${activeLevel.value.height}p)` : ''}</option>
          <option value="low">Low ({Math.min(...videoLevels.map((l) => l.height))}p)</option>
          <option value="high">High ({Math.max(...videoLevels.map((l) => l.height))}p)</option>
        </select>
      )}
      <button type="button" class="ctl" aria-pressed={statsOpen.value} onClick={() => (statsOpen.value = !statsOpen.value)}
        aria-label="Stream stats" title="Stream stats (I)">
        <StatsIcon />
      </button>
      {!audioMode && pipSupported() && (
        <button type="button" class="ctl" onClick={togglePip} aria-label="Picture-in-picture" title="Picture-in-picture (P)">
          <PipIcon />
        </button>
      )}
      {!audioMode && (
        <button type="button" class="ctl" onClick={toggleFullscreen} aria-label={media.fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title="Fullscreen (F)">
          <FullscreenIcon on={media.fullscreen} />
        </button>
      )}
    </div>
  );
}

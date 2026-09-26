import { shareUrl } from '../actions.js';
import { clock, current, enterMultiview, exitMultiview, favoriteIds, guide, multiview, showToast, status, toggleFavorite } from '../state.js';
import { nowNext } from '../lib/epg.js';
import { lazyComponent } from '../lazy.js';
import { snapshot, toggleZen } from '../playerActions.js';
import { describeItem } from './ItemRow.jsx';
import { isAudioItem, Monitor } from './Monitor.jsx';
import { CameraIcon, GridIcon, ShareIcon, StarIcon, ZenIcon } from './icons.jsx';

const Multiview = lazyComponent(() => import('./Multiview.jsx'));

export const toggleMultiview = () => (multiview.value ? exitMultiview() : enterMultiview());

/** The program area: the monitor, and a bar with what's on and what you can do with it. */
export function Player() {
  return (
    <section class="program" aria-label="Player" data-fullscreen-root>
      {multiview.value ? <Multiview /> : <Monitor />}
      <NowBar />
    </section>
  );
}

const STATUS_WORDS = {
  playing: 'On air',
  buffering: 'Buffering',
  loading: 'Tuning',
  paused: 'Paused',
  blocked: 'Ready to play',
  error: 'Off air',
};

/** Broadcast-style lower third: channel number, name, on-air tally, what's on, and actions. */
function NowBar() {
  const item = current.value;
  if (!item && !multiview.value) return null;
  if (!item) {
    return (
      <div class="lower-third">
        <p class="lt-empty">Multiview: pick channels or stations from the list to fill the screens.</p>
        <div class="lt-actions"><MultiviewButton /></div>
      </div>
    );
  }
  const favorite = favoriteIds.value.has(item.id);
  const state = status.value.state;
  const onAir = state === 'playing' || state === 'buffering';
  return (
    <div class="lower-third">
      <div class="lt-id">
        {item.number && <span class="lt-num" aria-label={`Channel ${item.number}`}>{String(item.number).padStart(3, '0')}</span>}
        <div class="lt-text">
          <h2 class="lt-name">{item.name}</h2>
          <p class={`lt-status${onAir ? ' is-on-air' : ''}`}>
            <span class="tally-dot" aria-hidden="true" />
            {STATUS_WORDS[state] || ''}
            {!(item.kind === 'tv' && guide.value) && describeItem(item) && <span class="lt-meta">{describeItem(item)}</span>}
          </p>
        </div>
      </div>
      {item.kind === 'tv' && guide.value && <OnNow item={item} />}
      <div class="lt-actions">
        <button type="button" class={favorite ? 'icon-btn fav is-on' : 'icon-btn fav'} aria-pressed={favorite}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(item)}>
          <StarIcon filled={favorite} />
        </button>
        {!isAudioItem(item) && (
          <button type="button" class="icon-btn" aria-label="Save a snapshot of the picture" title="Snapshot (S)" onClick={snapshot}>
            <CameraIcon />
          </button>
        )}
        <button type="button" class="icon-btn" aria-label="Copy link to this stream" onClick={() => share(item)}>
          <ShareIcon />
        </button>
        <MultiviewButton />
        <button type="button" class="icon-btn" aria-label="Zen mode: hide everything but the picture" title="Zen mode (Z)" onClick={toggleZen}>
          <ZenIcon />
        </button>
      </div>
    </div>
  );
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const time = (ms) => timeFormat.format(ms);

/** "On now" with a progress bar, and what's next — from the programme guide. */
function OnNow({ item }) {
  const at = clock.value;
  const { now, next } = nowNext(guide.value.data, item, at);
  if (!now && !next) return <div class="on-now"><p class="on-now-next">No listings for this channel</p></div>;
  const progress = now ? Math.min(1, (at - now.start) / (now.stop - now.start)) : 0;
  return (
    <div class="on-now">
      {now && (
        <p class="on-now-title">
          <span>{now.title}</span>
          <span class="on-now-time">{time(now.start)}–{time(now.stop)}</span>
        </p>
      )}
      {now && (
        <div class="on-now-bar" role="progressbar" aria-label={`${now.title} progress`}
          aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {next && <p class="on-now-next">Next at {time(next.start)}: {next.title}</p>}
      {now?.desc && <p class="on-now-desc">{now.desc}</p>}
    </div>
  );
}

function MultiviewButton() {
  const on = Boolean(multiview.value);
  return (
    <button type="button" class="icon-btn" aria-pressed={on} onClick={toggleMultiview}
      aria-label={on ? 'Back to a single screen' : 'Multiview: watch up to four streams'} title="Multiview (G)">
      <GridIcon />
    </button>
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

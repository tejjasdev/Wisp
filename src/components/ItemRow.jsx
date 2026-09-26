import { current, favoriteIds, status, toggleFavorite } from '../state.js';
import { Logo } from './Logo.jsx';
import { StarIcon } from './icons.jsx';

export function describeItem(item) {
  if (item.kind === 'radio') {
    const { country, tags = [], bitrate } = item.meta || {};
    return [country, tags.join(', '), bitrate ? `${bitrate} kbps` : ''].filter(Boolean).join('  ');
  }
  if (item.kind === 'tv') return item.groups?.join(', ') || '';
  return item.audio ? 'Audio stream' : 'Stream';
}

/** One row in any list: logo, name, details, and a favorite toggle. */
export function ItemRow({ item }) {
  const isCurrent = current.value?.id === item.id;
  const isFavorite = favoriteIds.value.has(item.id);
  const live = isCurrent && ['playing', 'buffering'].includes(status.value.state);
  return (
    <>
      <Logo src={item.logo} name={item.name} />
      <span class="row-text">
        <span class={isCurrent ? 'row-name is-current' : 'row-name'}>
          {live && <span class="live-dot" aria-label="Now playing" />}
          {item.name}
        </span>
        <span class="row-meta">{describeItem(item)}</span>
      </span>
      <button
        type="button"
        class={isFavorite ? 'icon-btn fav is-on' : 'icon-btn fav'}
        tabIndex={-1}
        aria-label={isFavorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite(item);
        }}
      >
        <StarIcon filled={isFavorite} />
      </button>
    </>
  );
}

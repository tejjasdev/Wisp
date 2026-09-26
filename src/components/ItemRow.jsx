import { clock, current, favoriteIds, guide, status, toggleFavorite } from '../state.js';
import { nowNext } from '../lib/epg.js';
import { Logo } from './Logo.jsx';
import { StarIcon } from './icons.jsx';

export function describeItem(item) {
  if (item.kind === 'radio') {
    const { country, tags = [], bitrate } = item.meta || {};
    return [country, tags.join(', '), bitrate ? `${bitrate} kbps` : ''].filter(Boolean).join('  ');
  }
  if (item.kind === 'tv') {
    // With a guide loaded, the row says what's on instead of the category.
    const onNow = guide.value && nowNext(guide.value.data, item, clock.value).now;
    return onNow ? onNow.title : item.groups?.join(', ') || '';
  }
  return item.audio ? 'Audio stream' : 'Stream';
}

/** "*" on the highlighted row toggles it as a favorite. */
export const FAVORITE_KEY = { '*': toggleFavorite };

/** One row in any list: logo, name, details, and a favorite toggle. */
export function ItemRow({ item }) {
  const isCurrent = current.value?.id === item.id;
  const isFavorite = favoriteIds.value.has(item.id);
  const live = isCurrent && ['playing', 'buffering'].includes(status.value.state);
  return (
    <>
      {item.number && <span class="row-num" aria-hidden="true">{item.number}</span>}
      <Logo src={item.logo} name={item.name} />
      <span class="row-text">
        <span class={isCurrent ? 'row-name is-current' : 'row-name'}>
          {live && <span class="tally-dot" role="img" aria-label="On air" />}
          {item.name}
        </span>
        <span class="row-meta">{describeItem(item)}</span>
        {isFavorite && <span class="visually-hidden">, favorite</span>}
      </span>
      {/* Mouse shortcut only: inside a listbox option a real button isn't reachable by
          assistive tech, so keyboards use "*" on the highlighted row instead. */}
      <span
        class={isFavorite ? 'icon-btn fav is-on' : 'icon-btn fav'}
        aria-hidden="true"
        title={isFavorite ? 'Remove from favorites (*)' : 'Add to favorites (*)'}
        onClick={(event) => {
          event.stopPropagation();
          toggleFavorite(item);
        }}
      >
        <StarIcon filled={isFavorite} />
      </span>
    </>
  );
}

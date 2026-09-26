import { useState } from 'preact/hooks';
import { clearRecents, current, favorites, playItem, recents } from '../state.js';
import { ItemRow } from './ItemRow.jsx';
import { ROW_HEIGHT } from './SearchField.jsx';
import { VirtualList } from './VirtualList.jsx';

export function SavedPanel() {
  const [view, setView] = useState(favorites.value.length || !recents.value.length ? 'favorites' : 'recent');
  const items = view === 'favorites' ? favorites.value : recents.value;
  const initialIndex = items.findIndex((i) => i.id === current.peek()?.id);

  return (
    <div class="panel">
      <div class="panel-head">
        <div class="segmented" role="group" aria-label="Saved items">
          <button type="button" aria-pressed={view === 'favorites'} onClick={() => setView('favorites')}>
            Favorites
          </button>
          <button type="button" aria-pressed={view === 'recent'} onClick={() => setView('recent')}>
            Recently played
          </button>
        </div>
        {view === 'recent' && recents.value.length > 0 && (
          <button type="button" class="btn small" onClick={clearRecents}>Clear</button>
        )}
      </div>

      {items.length ? (
        <VirtualList
          id={`saved-${view}`}
          label={view === 'favorites' ? 'Favorites' : 'Recently played'}
          items={items}
          rowHeight={ROW_HEIGHT}
          initialIndex={initialIndex}
          onSelect={(item) => playItem(item, { list: items })}
          renderRow={(item) => <ItemRow item={item} />}
        />
      ) : (
        <p class="empty">
          {view === 'favorites'
            ? 'Tap the star on any channel or station to keep it here.'
            : 'Channels and stations you play will show up here.'}
        </p>
      )}
    </div>
  );
}

import { useRef } from 'preact/hooks';
import { channelGroup, channelQuery, current, filteredChannels, guide, guideStatus, playItem, playlist, showSourceForm } from '../state.js';
import { lazyComponent } from '../lazy.js';
import { GuideIcon } from './icons.jsx';
import { FAVORITE_KEY, ItemRow } from './ItemRow.jsx';
import { SourceForm } from './SourceForm.jsx';
import { VirtualList } from './VirtualList.jsx';
import { ROW_HEIGHT, SearchField } from './SearchField.jsx';

const GuideForm = lazyComponent(() => import('./GuideForm.jsx'));

export function TvPanel() {
  const listRef = useRef(null);
  const list = playlist.value;
  if (list && showSourceForm.value === 'guide') return <GuideForm />;
  if (!list || showSourceForm.value) return <SourceForm />;

  const channels = filteredChannels.value;
  const initialIndex = channels.findIndex((c) => c.id === current.peek()?.id);

  return (
    <div class="panel">
      <div class="panel-head">
        <div class="panel-head-text">
          <h2 class="panel-title" title={list.name}>{list.name}</h2>
          <p class="hint">
            {list.channels.length.toLocaleString()} channels
            {guideStatus.value.state === 'loading' ? ', loading guide…' : guide.value ? ', with guide' : ''}
          </p>
        </div>
        <button type="button" class={guide.value ? 'icon-btn is-on' : 'icon-btn'} onClick={() => (showSourceForm.value = 'guide')}
          aria-label={guide.value ? 'Programme guide (loaded)' : list.epgUrls?.length ? 'Programme guide (available for this playlist)' : 'Add a programme guide'}
          title="Programme guide">
          <GuideIcon />
          {!guide.value && list.epgUrls?.length > 0 && <span class="dot" aria-hidden="true" />}
        </button>
        <button type="button" class="btn small" onClick={() => (showSourceForm.value = true)}>Change</button>
      </div>

      <div class="filters">
        <SearchField value={channelQuery.value} onInput={(v) => (channelQuery.value = v)} placeholder="Search channels" listRef={listRef} />
        {list.groups.length > 1 && (
          <select class="field select" aria-label="Category" value={channelGroup.value}
            onChange={(e) => (channelGroup.value = e.currentTarget.value)}>
            <option value="">All categories</option>
            {list.groups.map((g) => (
              <option key={g.name} value={g.name}>{g.name} ({g.count})</option>
            ))}
          </select>
        )}
      </div>

      {channels.length ? (
        <VirtualList
          id="channels"
          label="Channels"
          items={channels}
          rowHeight={ROW_HEIGHT}
          initialIndex={initialIndex}
          listRef={listRef}
          onSelect={(item) => playItem(item, { list: channels })}
          renderRow={(item) => <ItemRow item={item} />}
          keys={FAVORITE_KEY}
        />
      ) : (
        <p class="empty">No channels match your search.</p>
      )}
    </div>
  );
}

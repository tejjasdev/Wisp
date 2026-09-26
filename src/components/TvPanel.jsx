import { useRef } from 'preact/hooks';
import { channelGroup, channelQuery, current, filteredChannels, playItem, playlist, showSourceForm } from '../state.js';
import { ItemRow } from './ItemRow.jsx';
import { SourceForm } from './SourceForm.jsx';
import { VirtualList } from './VirtualList.jsx';
import { ROW_HEIGHT, SearchField } from './SearchField.jsx';

export function TvPanel() {
  const listRef = useRef(null);
  const list = playlist.value;
  if (!list || showSourceForm.value) return <SourceForm />;

  const channels = filteredChannels.value;
  const initialIndex = channels.findIndex((c) => c.id === current.peek()?.id);

  return (
    <div class="panel">
      <div class="panel-head">
        <div class="panel-head-text">
          <h2 class="panel-title" title={list.name}>{list.name}</h2>
          <p class="hint">{list.channels.length.toLocaleString()} channels</p>
        </div>
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
        />
      ) : (
        <p class="empty">No channels match your search.</p>
      )}
    </div>
  );
}

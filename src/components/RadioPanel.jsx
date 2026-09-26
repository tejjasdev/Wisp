import { useEffect, useRef, useState } from 'preact/hooks';
import { listCountries, listTags, searchStations } from '../lib/radio-browser.js';
import { load, save } from '../lib/storage.js';
import { current, playItem } from '../state.js';
import { FAVORITE_KEY, ItemRow } from './ItemRow.jsx';
import { ROW_HEIGHT, SearchField } from './SearchField.jsx';
import { VirtualList } from './VirtualList.jsx';

// Filter lists rarely change; fetch them once per session.
let countriesCache;
let tagsCache;

function savedFilter(key) {
  const value = load('radio', {})?.[key];
  return typeof value === 'string' ? value : '';
}

export function RadioPanel() {
  const [name, setName] = useState(() => savedFilter('name'));
  const [country, setCountry] = useState(() => savedFilter('country'));
  const [tag, setTag] = useState(() => savedFilter('tag'));
  const [countries, setCountries] = useState(countriesCache || []);
  const [tags, setTags] = useState(tagsCache || []);
  const [stations, setStations] = useState([]);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef(null);

  useEffect(() => {
    if (!countriesCache) listCountries().then((list) => setCountries((countriesCache = list))).catch(() => {});
    if (!tagsCache) listTags().then((list) => setTags((tagsCache = list))).catch(() => {});
  }, []);

  // Debounced search; each new query cancels the previous request.
  useEffect(() => {
    save('radio', { name, country, tag });
    const controller = new AbortController();
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const results = await searchStations({ name, country, tag }, controller.signal);
        setStations(results);
        setState('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err.message);
        setState('error');
      }
    }, name ? 350 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [name, country, tag, attempt]);

  const initialIndex = stations.findIndex((s) => s.id === current.peek()?.id);

  return (
    <div class="panel">
      <div class="panel-head">
        <div class="panel-head-text">
          <h2 class="panel-title">Internet radio</h2>
          <p class="hint">
            From the free <a href="https://www.radio-browser.info" target="_blank" rel="noopener noreferrer">Radio Browser</a> directory
          </p>
        </div>
      </div>

      <div class="filters">
        <SearchField value={name} onInput={setName} placeholder="Search stations" listRef={listRef} />
        <div class="filter-row">
          <select class="field select" aria-label="Country" value={country} onChange={(e) => setCountry(e.currentTarget.value)}>
            <option value="">All countries</option>
            {country && !countries.some((c) => c.code === country) && <option value={country}>{country}</option>}
            {countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
          <select class="field select" aria-label="Genre" value={tag} onChange={(e) => setTag(e.currentTarget.value)}>
            <option value="">All genres</option>
            {tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}
            {tags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      {state === 'error' ? (
        <div class="empty">
          <p>{error}</p>
          <button type="button" class="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : state === 'loading' && !stations.length ? (
        <p class="empty">Loading stations…</p>
      ) : stations.length ? (
        <VirtualList
          id="stations"
          label="Radio stations"
          items={stations}
          rowHeight={ROW_HEIGHT}
          initialIndex={initialIndex}
          listRef={listRef}
          onSelect={(item) => playItem(item, { list: stations })}
          renderRow={(item) => <ItemRow item={item} />}
          keys={FAVORITE_KEY}
        />
      ) : (
        <p class="empty">No stations found. Try a different name, country or genre.</p>
      )}
    </div>
  );
}

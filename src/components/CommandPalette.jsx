// Command palette (Ctrl/Cmd+K): jump to any channel, saved item or radio
// station by typing, or run an action. Loaded on demand, and preloaded while
// the browser is idle so the first open is instant.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fuzzyFilter, fuzzyRank, normalize } from '../lib/fuzzy.js';
import { searchStations } from '../lib/radio-browser.js';
import {
  backgroundSaver, current, favorites, multiview, paletteOpen, paletteSeed, playItem, playlist, recents, statsOpen,
} from '../state.js';
import { describeItem } from './ItemRow.jsx';
import { Logo } from './Logo.jsx';
import { paletteActions } from './paletteActions.js';

const keys = new WeakMap();
const keyOf = (item) => {
  let key = keys.get(item);
  if (!key) {
    key = normalize(`${item.name} ${item.groups?.join(' ') || ''} ${item.meta?.tags?.join(' ') || ''}`);
    keys.set(item, key);
  }
  return key;
};
const actionKey = (action) => normalize(`${action.label} ${action.keywords || ''}`);

const close = () => (paletteOpen.value = false);

function useRadioSearch(query) {
  const [radio, setRadio] = useState({ query: '', items: [], loading: false });
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRadio({ query: '', items: [], loading: false });
      return;
    }
    const controller = new AbortController();
    setRadio((r) => ({ ...r, loading: true }));
    const timer = setTimeout(() => {
      searchStations({ name: q }, controller.signal)
        .then((items) => setRadio({ query: q, items: items.slice(0, 8), loading: false }))
        .catch(() => !controller.signal.aborted && setRadio({ query: q, items: [], loading: false }));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  return radio;
}

export default function CommandPalette() {
  const [query, setQuery] = useState(() => paletteSeed.text);
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef(null);
  const list = useRef(null);
  const radio = useRadioSearch(query);

  // Focus the field as soon as it exists (before paint, so no keystroke is lost);
  // give focus back to where it was on close.
  useLayoutEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    // Pick up anything typed while the palette was rendering.
    if (paletteSeed.text && paletteSeed.text !== input.current?.value) setQuery(paletteSeed.text);
    paletteSeed.text = '';
    return () => previous?.focus?.();
  }, []);

  const sections = useMemo(() => {
    const channels = playlist.value?.channels ?? [];
    const library = [...favorites.value, ...recents.value.filter((r) => !favorites.value.some((f) => f.id === r.id))];
    const q = query.trim();
    const result = [];
    let bestChannel = -1;

    const itemEntry = (item, source) => ({
      key: `${source}:${item.id}`,
      label: item.name,
      meta: describeItem(item),
      item,
      run: () => playItem(item, { list: source === 'channel' ? channels : [] }),
    });

    if (!q) {
      if (library.length) result.push({ label: 'Favorites and recent', entries: library.slice(0, 8).map((i) => itemEntry(i, 'saved')) });
    } else {
      const channelRanked = fuzzyRank(channels, q, keyOf, 20);
      bestChannel = channelRanked[0]?.score ?? -1;
      const channelHits = channelRanked.map((r) => r.item);
      if (channelHits.length) result.push({ label: 'Channels', entries: channelHits.map((i) => itemEntry(i, 'channel')) });
      const channelIds = new Set(channelHits.map((c) => c.id));
      const savedHits = fuzzyFilter(library, q, keyOf, 8).filter((i) => !channelIds.has(i.id));
      if (savedHits.length) result.push({ label: 'Favorites and recent', entries: savedHits.map((i) => itemEntry(i, 'saved')) });
      if (radio.items.length || radio.loading) {
        result.push({
          label: 'Radio stations',
          loading: radio.loading && !radio.items.length,
          entries: radio.items.map((s) => ({ ...itemEntry(s, 'radio'), run: () => playItem(s, { list: radio.items }) })),
        });
      }
    }

    // Actions need a reasonably close match; letters scattered across a long label are noise.
    const ranked = fuzzyRank(paletteActions(), q, actionKey, q ? 6 : 20, { minScore: normalize(q).length * 12 });
    if (ranked.length) {
      const actions = { label: 'Actions', entries: ranked.map(({ item: a }) => ({ key: `action:${a.id}`, label: a.label, meta: a.hint, run: a.run })) };
      // A strong action match ("stats", "multiview") goes first; otherwise actions come last.
      if (q && ranked[0].score > bestChannel) result.unshift(actions);
      else result.push(actions);
    }
    return result;
  }, [query, radio, playlist.value, favorites.value, recents.value, statsOpen.value, multiview.value, backgroundSaver.value, current.value]);

  const flat = sections.flatMap((s) => s.entries);
  const active = Math.min(activeIndex, Math.max(0, flat.length - 1));

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (entry) => {
    if (!entry) return;
    close();
    entry.run();
  };

  const onKeyDown = (event) => {
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
    if (event.key in moves) {
      event.preventDefault();
      setActiveIndex(Math.max(0, Math.min(flat.length - 1, active + moves[event.key])));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(flat[active]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault(); // focus stays in the palette
    }
  };

  let index = -1;
  return (
    <div class="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="palette" role="dialog" aria-modal="true" aria-label="Jump to a channel, station or action">
        <input
          ref={input}
          class="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? `palette-opt-${active}` : undefined}
          placeholder="Jump to a channel, station or action…"
          spellcheck={false}
          autoComplete="off"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
        <div id="palette-list" class="palette-list" role="listbox" aria-label="Results" ref={list}>
          {sections.map((section) => (
            <div role="group" aria-label={section.label} key={section.label}>
              <div class="palette-section" aria-hidden="true">{section.label}</div>
              {section.loading && <div class="palette-note">Searching radio stations…</div>}
              {section.entries.map((entry) => {
                index++;
                const i = index;
                return (
                  <div
                    key={entry.key}
                    id={`palette-opt-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    class={i === active ? 'palette-option is-active' : 'palette-option'}
                    onMouseMove={() => i !== active && setActiveIndex(i)}
                    onClick={() => run(entry)}
                  >
                    {entry.item && <Logo src={entry.item.logo} name={entry.item.name} />}
                    <span class="palette-text">
                      <span class="palette-label">{entry.label}</span>
                      {entry.meta && <span class="palette-meta">{entry.meta}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {!flat.length && !radio.loading && <p class="palette-note">Nothing matches “{query}”.</p>}
        </div>
        <p class="palette-help" aria-hidden="true">
          <kbd>↑</kbd><kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}

// A windowed list: only the rows in view (plus a few extra) exist in the DOM,
// so a 10,000-channel playlist scrolls as smoothly as a 10-channel one.
// Implements the ARIA listbox pattern with arrow-key navigation.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const OVERSCAN = 6;

export function VirtualList({ items, rowHeight, renderRow, onSelect, label, initialIndex = -1, listRef, id, keys = {} }) {
  const scroller = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const [active, setActive] = useState(initialIndex);
  const frame = useRef(0);

  // Expose the element so a search box can move focus into the list.
  useEffect(() => {
    if (listRef) listRef.current = scroller.current;
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    setViewport(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  // A new list (search, group change) starts from the top.
  useLayoutEffect(() => {
    setActive(initialIndex);
    const top = initialIndex > 0 ? Math.max(0, initialIndex * rowHeight - rowHeight * 2) : 0;
    scroller.current.scrollTop = top;
    setScrollTop(top);
  }, [items]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setScrollTop(scroller.current.scrollTop));
  };

  const moveTo = (index) => {
    if (!items.length) return;
    const next = Math.max(0, Math.min(items.length - 1, index));
    setActive(next);
    const el = scroller.current;
    const top = next * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
  };

  const onKeyDown = (event) => {
    const page = Math.max(1, Math.floor(viewport / rowHeight) - 1);
    const actions = {
      ArrowDown: () => moveTo(active + 1),
      ArrowUp: () => moveTo(active - 1),
      PageDown: () => moveTo(active + page),
      PageUp: () => moveTo(active - page),
      Home: () => moveTo(0),
      End: () => moveTo(items.length - 1),
      Enter: () => items[active] && onSelect(items[active], active),
    };
    // Extra per-item keys from the caller (e.g. "*" to toggle favorite).
    for (const [key, handler] of Object.entries(keys)) {
      actions[key] = () => items[active] && handler(items[active]);
    }
    if (actions[event.key]) {
      event.preventDefault();
      actions[event.key]();
    }
  };

  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const rows = [];
  for (let i = first; i < last; i++) {
    const item = items[i];
    rows.push(
      <div
        key={item.id}
        id={`${id}-${i}`}
        role="option"
        aria-selected={i === active}
        class={i === active ? 'row is-active' : 'row'}
        style={{ transform: `translateY(${i * rowHeight}px)`, height: rowHeight }}
        onClick={() => {
          setActive(i);
          onSelect(item, i);
        }}
      >
        {renderRow(item, i)}
      </div>,
    );
  }

  return (
    <div
      ref={scroller}
      class="vlist"
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={active >= 0 && active < items.length ? `${id}-${active}` : undefined}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={() => active < 0 && items.length && setActive(0)}
    >
      <div class="vlist-inner" style={{ height: items.length * rowHeight }}>
        {rows}
      </div>
    </div>
  );
}

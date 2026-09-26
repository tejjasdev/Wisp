import { useState } from 'preact/hooks';

// Logos that failed once are remembered, so scrolling a long list doesn't
// re-request hundreds of dead images.
const failed = new Set();

function initials(name) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(' ').filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}

/**
 * Channel/station logo. Shows lettered initials immediately and swaps in the
 * image once it has loaded. `size` is 'sm' or 'lg'.
 */
export function Logo({ src, name, size = 'sm' }) {
  const [state, setState] = useState(src && !failed.has(src) ? 'loading' : 'none');
  return (
    <span class={`logo logo-${size}${state === 'loaded' ? ' is-loaded' : ''}`} aria-hidden="true">
      <span class="logo-initials">{initials(name || '')}</span>
      {state !== 'none' && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          onLoad={() => setState('loaded')}
          onError={() => {
            failed.add(src);
            setState('none');
          }}
        />
      )}
    </span>
  );
}

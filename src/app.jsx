import { useEffect } from 'preact/hooks';
import { mode, toast } from './state.js';
import { Player, playerApi } from './components/Player.jsx';
import { TvPanel } from './components/TvPanel.jsx';
import { RadioPanel } from './components/RadioPanel.jsx';
import { SavedPanel } from './components/SavedPanel.jsx';

const TABS = [
  { id: 'tv', label: 'TV' },
  { id: 'radio', label: 'Radio' },
  { id: 'saved', label: 'Saved' },
];

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Space: play/pause · /: search · F: fullscreen · M: mute.
// Arrow keys and Enter are handled by the focused list itself.
function useShortcuts() {
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      // Let Space keep its native meaning on buttons, links and media controls.
      if (event.key === ' ' && event.target.closest?.('button, a, video, audio')) return;
      const actions = {
        ' ': () => playerApi.toggle(),
        k: () => playerApi.toggle(),
        '/': () => document.getElementById('search')?.focus(),
        f: () => playerApi.fullscreen(),
        m: () => playerApi.toggleMute(),
      };
      const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App({ canPlayHls }) {
  useShortcuts();
  const Panel = { tv: TvPanel, radio: RadioPanel, saved: SavedPanel }[mode.value];

  return (
    <div class="app">
      <header class="topbar">
        <a class="brand" href="/" aria-label="Wisp home">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <path d="M8 24c0-6 9-5 9-11 0-3.5-3-5-5.5-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            <path d="M17 26c3-1.2 7-3.8 7-8.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55" />
          </svg>
          <span>wisp</span>
        </a>
        <nav class="tabs" aria-label="Sections">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" class="tab" aria-current={mode.value === tab.id ? 'page' : undefined}
              onClick={() => (mode.value = tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {!canPlayHls && (
        <p class="banner" role="status">
          This browser can't play HLS (.m3u8) streams, so most TV channels won't work here. Radio and direct video files still play.
        </p>
      )}

      <main class="layout">
        <Player />
        <aside class="sidebar" aria-label={TABS.find((t) => t.id === mode.value).label}>
          <Panel />
        </aside>
      </main>

      <div class={toast.value ? 'toast is-visible' : 'toast'} role="status" aria-live="polite">{toast.value}</div>
    </div>
  );
}

import { useEffect } from 'preact/hooks';
import { focusTile, mode, multiview, paletteOpen, paletteSeed, settingsOpen, statsOpen, step, toast, zen } from './state.js';
import { CloseIcon, GearIcon, SearchIcon } from './components/icons.jsx';
import { useState } from 'preact/hooks';
import { lazyComponent } from './lazy.js';

const CommandPalette = lazyComponent(() => import('./components/CommandPalette.jsx'));
const SettingsDialog = lazyComponent(() => import('./components/SettingsDialog.jsx'));
import { Player, toggleMultiview } from './components/Player.jsx';
import { toggleFullscreen, toggleMute, togglePip, togglePlay, toggleZen, snapshot } from './playerActions.js';
import { TvPanel } from './components/TvPanel.jsx';
import { RadioPanel } from './components/RadioPanel.jsx';
import { SavedPanel } from './components/SavedPanel.jsx';

const TABS = [
  { id: 'tv', label: 'TV' },
  { id: 'radio', label: 'Radio' },
  { id: 'saved', label: 'Saved' },
];

const isTyping = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

// Space/K play-pause, / search, F fullscreen, M mute, I stats, P picture-in-picture, S snapshot,
// G multiview, 1–4 focus a multiview screen.
// Arrow keys and Enter are handled by the focused list itself.
function useShortcuts() {
  useEffect(() => {
    const onKey = (event) => {
      // Ctrl/Cmd+K works everywhere, even while typing.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        paletteSeed.text = '';
        paletteOpen.value = !paletteOpen.value;
        return;
      }
      if (paletteOpen.value) {
        // Typed before the palette field took focus: keep it for the query.
        if (!event.target.closest?.('.palette') && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          paletteSeed.text += event.key;
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || settingsOpen.value) return;
      // A focused list has already used this key (arrows, Page Up/Down, Enter).
      if (event.defaultPrevented) return;
      // Let Space keep its native meaning on buttons, links and media controls.
      if (event.key === ' ' && event.target.closest?.('button, a, video, audio')) return;
      const actions = {
        ' ': togglePlay,
        k: togglePlay,
        '/': () => document.getElementById('search')?.focus(),
        f: toggleFullscreen,
        m: toggleMute,
        i: () => (statsOpen.value = !statsOpen.value),
        p: togglePip,
        s: snapshot,
        g: toggleMultiview,
        z: toggleZen,
        PageUp: () => step(-1),
        PageDown: () => step(1),
      };
      if (zen.value) {
        // TV-remote style: up/down change channel; Esc comes back.
        Object.assign(actions, {
          ArrowUp: () => step(-1),
          ArrowDown: () => step(1),
          Escape: () => (zen.value = false),
          '/': () => {
            zen.value = false;
            requestAnimationFrame(() => document.getElementById('search')?.focus());
          },
        });
      }
      if (multiview.value && /^[1-4]$/.test(event.key)) {
        event.preventDefault();
        focusTile(Number(event.key) - 1);
        return;
      }
      const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    // Fetch the palette while the browser is idle so the first Ctrl+K is instant.
    const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 2000));
    idle(() => CommandPalette.preload().catch(() => {}));
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** The one control left in zen mode; it fades out while the mouse is still. */
function ZenExit() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let timer;
    const wake = () => {
      setHidden(false);
      clearTimeout(timer);
      timer = setTimeout(() => setHidden(true), 2500);
    };
    wake();
    window.addEventListener('pointermove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, []);
  return (
    <button type="button" class={`btn zen-exit${hidden ? ' is-hidden' : ''}`} onClick={() => (zen.value = false)} onFocus={() => setHidden(false)}>
      <CloseIcon size={16} /> Leave zen mode
    </button>
  );
}

export function App({ canPlayHls }) {
  useShortcuts();
  const Panel = { tv: TvPanel, radio: RadioPanel, saved: SavedPanel }[mode.value];

  return (
    <div class={zen.value ? 'app is-zen' : 'app'}>
      {zen.value && <ZenExit />}
      <header class="topbar">
        <h1 class="brand-heading">
        <a class="brand" href="/" aria-label="Wisp home">
          <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
            <path d="M8 24c0-6 9-5 9-11 0-3.5-3-5-5.5-4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
            <path d="M17 26c3-1.2 7-3.8 7-8.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55" />
          </svg>
          <span class="wordmark">wisp</span>
        </a>
        </h1>
        <nav class="tabs" aria-label="Sections">
          {TABS.map((tab) => (
            <button key={tab.id} type="button" class="tab" aria-current={mode.value === tab.id ? 'page' : undefined}
              onClick={() => (mode.value = tab.id)}>
              {tab.label}
            </button>
          ))}
        </nav>
        <button type="button" class="jump" onClick={() => (paletteOpen.value = true)} aria-keyshortcuts="Control+K Meta+K"
          aria-label="Jump to a channel, station or action">
          <SearchIcon />
          <span class="jump-label" aria-hidden="true">Jump to…</span>
          <kbd aria-hidden="true">{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <button type="button" class="icon-btn" aria-label="Settings" onClick={() => (settingsOpen.value = true)}>
          <GearIcon />
        </button>
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

      {paletteOpen.value && <CommandPalette />}
      {settingsOpen.value && <SettingsDialog />}
      <div class={toast.value ? 'toast is-visible' : 'toast'} role="status" aria-live="polite">{toast.value}</div>
    </div>
  );
}

// Settings: playback preferences, export/import, shortcuts and what Wisp is.
// Uses the native <dialog> element for focus handling and Esc-to-close.
// Loaded on demand.

import { useEffect, useRef, useState } from 'preact/hooks';
import { exportSettings, importSettings } from '../actions.js';
import { backgroundSaver, quality, settingsOpen, statsOpen } from '../state.js';
import { CloseIcon } from './icons.jsx';

export const SHORTCUTS = [
  ['Ctrl K or ⌘ K', 'Jump to a channel, station or action'],
  ['Space or K', 'Play or pause'],
  ['↑ ↓, Enter', 'Move through a list, play the highlighted item'],
  ['*', 'Add or remove the highlighted item as a favorite'],
  ['/', 'Search the list'],
  ['F', 'Fullscreen'],
  ['M', 'Mute'],
  ['I', 'Stream stats'],
  ['P', 'Picture-in-picture'],
  ['S', 'Snapshot of the picture'],
  ['G', 'Multiview'],
  ['1 – 4', 'Listen to a multiview screen'],
  ['Z', 'Zen mode (hide everything but the picture)'],
  ['PgUp PgDn', 'Previous or next channel (in zen mode, also ↑ ↓)'],
];

export default function SettingsDialog() {
  const dialog = useRef(null);
  const fileInput = useRef(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const importFile = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      setMessage(await importSettings(file));
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <dialog ref={dialog} class="settings" aria-labelledby="settings-title" onClose={() => (settingsOpen.value = false)}>
      <header class="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button type="button" class="icon-btn" aria-label="Close settings" onClick={() => dialog.current.close()}>
          <CloseIcon />
        </button>
      </header>

      <section aria-labelledby="set-playback">
        <h3 id="set-playback">Playback</h3>
        <label class="setting">
          <span>
            <span class="setting-name">Starting quality</span>
            <span class="setting-note">Auto adapts to your connection. Low saves the most data.</span>
          </span>
          <select class="field select" value={quality.value} onChange={(e) => (quality.value = e.currentTarget.value)}>
            <option value="auto">Auto</option>
            <option value="low">Low</option>
            <option value="high">High</option>
          </select>
        </label>
        <label class="setting">
          <span>
            <span class="setting-name">Save data in the background</span>
            <span class="setting-note">Drops to the lowest quality while Wisp's tab is hidden. Sound keeps playing.</span>
          </span>
          <input type="checkbox" class="switch" checked={backgroundSaver.value}
            onChange={(e) => (backgroundSaver.value = e.currentTarget.checked)} />
        </label>
        <label class="setting">
          <span>
            <span class="setting-name">Show stream stats</span>
            <span class="setting-note">Bitrate, resolution and connection speed over the picture.</span>
          </span>
          <input type="checkbox" class="switch" checked={statsOpen.value} onChange={(e) => (statsOpen.value = e.currentTarget.checked)} />
        </label>
      </section>

      <section aria-labelledby="set-data">
        <h3 id="set-data">Your data</h3>
        <p class="setting-note">
          Wisp has no accounts. To move your favorites, history, settings and playlist link to another browser, export
          them to a file and import it there.
        </p>
        <div class="form-actions">
          <button type="button" class="btn" onClick={exportSettings}>Export to a file</button>
          <button type="button" class="btn" onClick={() => fileInput.current.click()}>Import a file</button>
        </div>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importFile} />
        {message && <p class="setting-note" role="status">{message}</p>}
      </section>

      <section aria-labelledby="set-keys">
        <h3 id="set-keys">Keyboard shortcuts</h3>
        <dl class="shortcuts">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="set-about">
        <h3 id="set-about">About Wisp</h3>
        <p class="setting-note">
          Wisp is a generic player. It hosts, bundles and recommends no channels or playlists: it plays the links you
          give it, straight from their source to your browser. No accounts, ads or tracking. Open source under the MIT
          license.
        </p>
      </section>
    </dialog>
  );
}

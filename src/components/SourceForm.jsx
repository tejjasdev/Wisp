import { useEffect, useRef, useState } from 'preact/hooks';
import { openInput, openPlaylistText } from '../actions.js';
import { playlist, showSourceForm } from '../state.js';

// Errors where the link itself was fine but the browser couldn't read it —
// pasting the playlist's contents is the way around those.
const PASTE_HELPS = ['blocked', 'timeout', 'http', 'network', 'mixed'];

const HINTS = [
  { value: 'auto', label: 'Detect automatically' },
  { value: 'playlist', label: 'Channel playlist (M3U)' },
  { value: 'hls', label: 'HLS stream (.m3u8)' },
  { value: 'video', label: 'Video file' },
  { value: 'audio', label: 'Audio stream' },
];

// Autofocus on desktop only; on phones it would pop up the keyboard unasked.
const focusOnOpen = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

/**
 * One field for everything: a link, or pasted playlist text. The type menu is
 * only a hint — Wisp checks what the link really is and tries other ways of
 * playing it if the hint turns out to be wrong.
 */
export function SourceForm() {
  const [value, setValue] = useState('');
  const [hint, setHint] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const field = useRef(null);
  const fileInput = useRef(null);
  const multiline = value.includes('\n');

  // "Paste playlist text" from the player's error screen.
  useEffect(() => {
    if (showSourceForm.value === 'paste') {
      setError(null);
      field.current?.focus();
    }
  }, [showSourceForm.value]);

  const submit = async (event) => {
    event?.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await openInput(value, { hint });
      if (result === 'stream') setValue('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setError(null);
    try {
      openPlaylistText(await file.text(), { name: file.name.replace(/\.m3u8?$/i, '') });
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form class="source" onSubmit={submit}>
      <h2 class="panel-title">Open a playlist or stream</h2>
      <p class="hint" id="source-help">
        Paste a link to an M3U playlist, an HLS stream or a media file — or paste the playlist's text itself.
        Everything stays in your browser.
      </p>

      <textarea
        ref={field}
        class={multiline ? 'field source-input is-multiline' : 'field source-input'}
        rows={multiline ? 7 : 1}
        spellcheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder="https://example.com/playlist.m3u"
        aria-label="Playlist or stream link, or playlist text"
        aria-describedby="source-help"
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          // Enter opens a single link; in pasted playlist text it's a newline.
          if (e.key === 'Enter' && !e.shiftKey && !multiline) {
            e.preventDefault();
            submit();
          }
        }}
        autoFocus={focusOnOpen}
      />

      <label class="hint-select">
        <span>Type</span>
        <select class="field select" value={hint} onChange={(e) => setHint(e.currentTarget.value)}>
          {HINTS.map((h) => (
            <option key={h.value} value={h.value}>{h.label}</option>
          ))}
        </select>
      </label>

      {error && (
        <div class="form-error" role="alert">
          <p>{error.message}</p>
          {!multiline && PASTE_HELPS.includes(error.code) && (
            <p>If it's a playlist, open the link in a new tab, copy all of its text, and paste it into the box above.</p>
          )}
        </div>
      )}

      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={busy || !value.trim()}>
          {busy ? 'Opening…' : 'Open'}
        </button>
        <button type="button" class="btn" onClick={() => fileInput.current.click()}>Choose file</button>
        {playlist.value && (
          <button type="button" class="btn quiet" onClick={() => (showSourceForm.value = false)}>Cancel</button>
        )}
      </div>
      <input ref={fileInput} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" hidden onChange={openFile} />
    </form>
  );
}

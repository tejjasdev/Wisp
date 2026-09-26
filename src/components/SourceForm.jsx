import { useEffect, useRef, useState } from 'preact/hooks';
import { openInput, openPlaylistText } from '../actions.js';
import { playlist, showSourceForm } from '../state.js';

// Errors where the link itself was fine but the browser couldn't read it —
// pasting the playlist's contents is the way around those.
const PASTE_HELPS = ['blocked', 'timeout', 'http', 'network', 'mixed'];

// Autofocus on desktop only; on phones it would pop up the keyboard unasked.
const focusOnOpen = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches;

export function SourceForm() {
  const [tab, setTab] = useState(showSourceForm.value === 'paste' ? 'paste' : 'link');
  const [link, setLink] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  // "Paste playlist text" from the player's error screen.
  useEffect(() => {
    if (showSourceForm.value === 'paste') setTab('paste');
  }, [showSourceForm.value]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await openInput(tab === 'link' ? link : text);
      if (result === 'stream') setLink('');
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

  const switchTab = (next) => {
    setTab(next);
    setError(null);
  };

  return (
    <form class="source" onSubmit={submit}>
      <h2 class="panel-title">Open a playlist or stream</h2>
      <p class="hint">
        Paste a link to an M3U playlist, an HLS stream (.m3u8) or a video file. Everything stays in your browser.
      </p>

      <div class="segmented" role="group" aria-label="Input type">
        <button type="button" aria-pressed={tab === 'link'} onClick={() => switchTab('link')}>Link</button>
        <button type="button" aria-pressed={tab === 'paste'} onClick={() => switchTab('paste')}>Playlist text</button>
      </div>

      {tab === 'link' ? (
        <input
          class="field"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellcheck={false}
          placeholder="https://example.com/playlist.m3u"
          aria-label="Playlist or stream link"
          value={link}
          onInput={(e) => setLink(e.currentTarget.value)}
          autoFocus={focusOnOpen}
        />
      ) : (
        <>
          <textarea
            class="field"
            rows={7}
            spellcheck={false}
            placeholder={'#EXTM3U\n#EXTINF:-1 group-title="News",Channel name\nhttps://example.com/stream.m3u8'}
            aria-label="Playlist text"
            value={text}
            onInput={(e) => setText(e.currentTarget.value)}
            autoFocus={focusOnOpen}
          />
          <button type="button" class="text-btn" onClick={() => fileInput.current.click()}>
            Or choose a .m3u file from your device
          </button>
          <input ref={fileInput} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain" hidden onChange={openFile} />
        </>
      )}

      {error && (
        <div class="form-error" role="alert">
          <p>{error.message}</p>
          {tab === 'link' && PASTE_HELPS.includes(error.code) && (
            <p>
              If it's a playlist, open the link in a new tab, copy all of its text, and{' '}
              <button type="button" class="text-btn inline" onClick={() => switchTab('paste')}>paste it here</button>.
            </p>
          )}
        </div>
      )}

      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={busy || !(tab === 'link' ? link : text).trim()}>
          {busy ? 'Opening…' : 'Open'}
        </button>
        {playlist.value && (
          <button type="button" class="btn" onClick={() => (showSourceForm.value = false)}>Cancel</button>
        )}
      </div>
    </form>
  );
}

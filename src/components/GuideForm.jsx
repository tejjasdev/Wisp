// Adding an XMLTV programme guide: by link, pasted text, or a local file
// (.xml or .xml.gz). Loaded on demand.

import { useRef, useState } from 'preact/hooks';
import { openGuide, removeGuide } from '../actions.js';
import { safeUrl } from '../lib/sanitize.js';
import { guide, guideStatus, playlist, showSourceForm } from '../state.js';

const PASTE_HELPS = ['blocked', 'http'];

export default function GuideForm() {
  const suggested = playlist.value?.epgUrls?.[0] || '';
  const [value, setValue] = useState(guide.value ? '' : suggested);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);
  const status = guideStatus.value;
  const loading = status.state === 'loading';
  const multiline = value.includes('\n');

  const load = async (source, label) => {
    setError(null);
    try {
      await openGuide(source, label);
      setValue('');
    } catch (err) {
      setError(err);
    }
  };

  const submit = (event) => {
    event?.preventDefault();
    const raw = value.trim();
    if (!raw || loading) return;
    if (raw.startsWith('<')) {
      load({ kind: 'text', text: raw }, 'Pasted guide');
      return;
    }
    const url = safeUrl(raw);
    if (!url) {
      setError({ message: 'Enter a link starting with http:// or https://, or paste the guide’s XML.' });
      return;
    }
    load({ kind: 'url', url }, new URL(url).hostname);
  };

  const openFile = (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) load({ kind: 'blob', blob: file }, file.name);
  };

  const channelCount = playlist.value?.channels.length ?? 0;

  return (
    <form class="source" onSubmit={submit}>
      <h2 class="panel-title">Programme guide</h2>
      <p class="hint" id="guide-help">
        Add an XMLTV guide to see what's on now and next. Paste its link or its XML, or choose a .xml or .xml.gz file.
        {suggested && !guide.value && ' This playlist names a guide, so its link is filled in.'}
      </p>

      {guide.value && (
        <p class="guide-summary">
          {guide.value.label}: listings for {guide.value.matched.toLocaleString()} of {channelCount.toLocaleString()} channels
          ({guide.value.programmes.toLocaleString()} programmes over the next 24 hours).
        </p>
      )}

      <textarea
        class={multiline ? 'field source-input is-multiline' : 'field source-input'}
        rows={multiline ? 7 : 1}
        spellcheck={false}
        autoComplete="off"
        placeholder="https://example.com/guide.xml.gz"
        aria-label="Guide link or XMLTV text"
        aria-describedby="guide-help"
        value={value}
        onInput={(e) => setValue(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !multiline) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {loading && (
        <p class="hint" role="status">
          Reading the guide{status.bytes ? `: ${(status.bytes / 1e6).toFixed(1)} MB so far` : '…'}
        </p>
      )}

      {error && (
        <div class="form-error" role="alert">
          <p>{error.message}</p>
          {PASTE_HELPS.includes(error.code) && (
            <p>Download the guide file and choose it with “Choose file”, or open the link in a new tab and paste its text above.</p>
          )}
        </div>
      )}

      <div class="form-actions">
        <button type="submit" class="btn primary" disabled={loading || !value.trim()}>
          {loading ? 'Loading…' : 'Load guide'}
        </button>
        <button type="button" class="btn" disabled={loading} onClick={() => fileInput.current.click()}>Choose file</button>
        {guide.value && <button type="button" class="btn quiet" onClick={removeGuide}>Remove guide</button>}
        <button type="button" class="btn quiet" onClick={() => (showSourceForm.value = false)}>Done</button>
      </div>
      <input ref={fileInput} type="file" accept=".xml,.gz,.xmltv,application/xml,text/xml,application/gzip" hidden onChange={openFile} />
    </form>
  );
}

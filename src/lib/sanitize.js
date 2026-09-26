// Everything that comes from a playlist or a third-party API is untrusted.
// Text is always rendered through Preact (never innerHTML), so the goal here is
// to strip invisible/control characters and cap lengths, and to make sure URLs
// can only ever be http(s) — never javascript:, file:, etc.

// C0/C1 control characters plus zero-width and bidi-override characters that
// can be abused to spoof how a name looks.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

export function cleanText(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i;
const MAX_DATA_URL = 64 * 1024;

/**
 * Returns a normalized http(s) URL, or '' if the value isn't one.
 * `base` resolves relative URLs (e.g. entries inside a playlist).
 * `allowImageData` permits small data:image URLs (used for inline logos).
 */
export function safeUrl(value, { base, allowImageData = false } = {}) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';
  if (allowImageData && DATA_IMAGE.test(raw)) {
    return raw.length <= MAX_DATA_URL ? raw : '';
  }
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

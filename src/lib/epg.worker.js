// Loads an XMLTV guide off the main thread. The file (often tens or hundreds
// of MB, frequently gzipped) is streamed: decompressed and scanned chunk by
// chunk, keeping only the next 24 hours for channels that are actually in the
// playlist. The raw XML is never held in memory as a whole.

import { createXmltvScanner } from './xmltv.js';
import { baseName } from './m3u.js';
import { cleanText } from './sanitize.js';

const MAX_XML_BYTES = 800 * 1024 * 1024; // after decompression
const STALL_MS = 25000; // no data for this long → give up
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_PER_CHANNEL = 60;

class GuideError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function openSource(source, signal) {
  if (source.kind === 'text') return new Blob([source.text]).stream();
  if (source.kind === 'blob') return source.blob.stream();
  let response;
  try {
    response = await fetch(source.url, { signal, credentials: 'omit' });
  } catch {
    throw new GuideError('blocked', "Couldn't download the guide. The server may be offline, or it doesn't allow other websites to load it (CORS).");
  }
  if (!response.ok) throw new GuideError('http', `The guide server answered with an error (${response.status}).`);
  return response.body;
}

/** Re-attaches an already-read first chunk in front of the rest of a stream. */
function prepend(first, reader) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(first);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

self.onmessage = async ({ data }) => {
  const { source, wanted, now } = data;
  const controller = new AbortController();
  let stallTimer;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => controller.abort(), STALL_MS);
  };

  const idToKey = new Map(wanted.ids); // lowercased tvg-id (and its part before "@") → key
  const nameToKey = new Map(wanted.names); // base name → key
  const channelKey = new Map(); // XMLTV channel id → key
  const guide = {};
  let programmes = 0;

  const keyForXmltvId = (id) => {
    const lower = id.toLowerCase();
    return idToKey.get(lower) ?? idToKey.get(lower.split('@')[0]);
  };

  const scanner = createXmltvScanner({
    onChannel({ id, names }) {
      const key = keyForXmltvId(id) ?? names.map((n) => nameToKey.get(baseName(n))).find(Boolean);
      if (key) channelKey.set(id, key);
    },
    onProgramme(p) {
      const key = channelKey.get(p.channel) ?? keyForXmltvId(p.channel);
      if (!key || !(p.stop > now) || !(p.start < now + WINDOW_MS)) return;
      const list = (guide[key] ??= []);
      if (list.length >= MAX_PER_CHANNEL) return;
      const title = cleanText(p.title, 160);
      if (!title) return;
      list.push([p.start, p.stop, title, cleanText(p.desc, 280)]);
      programmes++;
    },
  });

  try {
    armStall();
    const body = await openSource(source, controller.signal);
    const reader = body.getReader();
    const first = await reader.read();
    if (first.done) throw new GuideError('empty', 'The guide file is empty.');
    let stream = prepend(first.value, reader);
    // gzip magic bytes: 1f 8b
    if (first.value[0] === 0x1f && first.value[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));

    let downloaded = 0;
    let lastReport = 0;
    const counted = stream.pipeThrough(
      new TransformStream({
        transform(chunk, out) {
          armStall();
          downloaded += chunk.byteLength;
          if (downloaded > MAX_XML_BYTES) throw new GuideError('size', 'This guide is too large to load in a browser.');
          if (downloaded - lastReport > 4 * 1024 * 1024) {
            lastReport = downloaded;
            self.postMessage({ type: 'progress', bytes: downloaded });
          }
          out.enqueue(chunk);
        },
      }),
    );

    const textReader = counted.pipeThrough(new TextDecoderStream()).getReader();
    let sawXmltv = false;
    for (;;) {
      const { done, value } = await textReader.read();
      if (done) break;
      if (!sawXmltv && /<tv[\s>]/.test(value)) sawXmltv = true;
      scanner.push(value);
    }
    scanner.end();
    clearTimeout(stallTimer);

    if (!sawXmltv) throw new GuideError('format', "This doesn't look like an XMLTV guide.");
    for (const list of Object.values(guide)) list.sort((a, b) => a[0] - b[0]);
    self.postMessage({ type: 'done', guide, matched: Object.keys(guide).length, programmes });
  } catch (err) {
    clearTimeout(stallTimer);
    const message =
      err instanceof GuideError ? err.message
        : controller.signal.aborted ? 'The guide download stalled. Try again, or load the file from your device.'
          : "Couldn't read the guide. If it's compressed, make sure it's a .xml.gz file.";
    self.postMessage({ type: 'error', code: err.code || 'failed', message });
  }
};

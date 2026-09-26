// Playback engine. Given a <video>/<audio> element and an item, it picks the
// right way to play it (native file, hls.js, or the browser's own HLS support
// on iOS), reports a simple status, and gives up quickly with a clear reason
// instead of spinning forever.
//
// hls.js is imported on first use so it never slows down the first paint.

import { networkHints } from './network.js';
import { guessUrlType, isMixedContent, upgradeUrl } from './source.js';

const START_TIMEOUT_MS = 15000; // no first frame by then → show "unavailable"
const STALL_TIMEOUT_MS = 20000; // stuck buffering mid-playback for this long → show error
const MAX_RECOVERIES = 2;

let hlsPromise;
export function loadHls() {
  hlsPromise ??= import('hls.js').then((module) => module.default);
  hlsPromise.catch(() => (hlsPromise = undefined)); // allow a retry after going offline
  return hlsPromise;
}

// Headers a web page is not allowed to set (Fetch spec forbidden names, plus
// User-Agent, which browsers still refuse in practice).
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers',
  'access-control-request-method', 'connection', 'content-length', 'cookie',
  'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer',
  'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'user-agent', 'via',
]);
const isForbiddenHeader = (name) => {
  const lower = name.toLowerCase();
  return FORBIDDEN_HEADERS.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-');
};

export function splitHeaders(headers = {}) {
  const allowed = {};
  const blocked = [];
  for (const [name, value] of Object.entries(headers)) {
    if (isForbiddenHeader(name)) blocked.push(name);
    else allowed[name] = value;
  }
  return { allowed, blocked };
}

// Tuned for weak, unstable connections: small buffers, short timeouts, quick
// to step down in quality, slow to step back up.
export function buildHlsConfig(item, quality) {
  const { saveData, slow, estimate } = networkHints();
  const { allowed } = splitHeaders(item.headers);
  const retry = (maxNumRetry, retryDelayMs = 1000, maxRetryDelayMs = 4000) => ({
    maxNumRetry,
    retryDelayMs,
    maxRetryDelayMs,
  });

  const config = {
    enableWorker: true, // transmux off the main thread
    lowLatencyMode: false, // LL-HLS makes many tiny requests; standard latency is sturdier on bad links
    // Buffer ~20 s ahead instead of 30 s (and never balloon to 600 s), and keep
    // only 30 s behind the playhead so long live sessions don't grow memory.
    maxBufferLength: 20,
    maxMaxBufferLength: 40,
    maxBufferSize: 30 * 1000 * 1000,
    backBufferLength: 30,
    // Don't download 1080p into a 360p-sized player.
    capLevelToPlayerSize: true,
    startFragPrefetch: true,
    // ABR: the "slow" average dominates up-switches, the "fast" one down-switches.
    abrEwmaDefaultEstimate: estimate ?? 500_000,
    abrBandWidthFactor: 0.9, // step down a bit sooner than default (0.95)
    abrBandWidthUpFactor: 0.6, // step up later than default (0.7)
    abrEwmaSlowLive: 12,
    abrEwmaSlowVoD: 12,
    manifestLoadPolicy: {
      default: { maxTimeToFirstByteMs: 8000, maxLoadTimeMs: 12000, timeoutRetry: retry(1, 0, 0), errorRetry: retry(1) },
    },
    playlistLoadPolicy: {
      default: { maxTimeToFirstByteMs: 8000, maxLoadTimeMs: 12000, timeoutRetry: retry(2, 0, 0), errorRetry: retry(2) },
    },
    fragLoadPolicy: {
      default: { maxTimeToFirstByteMs: 10000, maxLoadTimeMs: 30000, timeoutRetry: retry(3, 0, 0), errorRetry: retry(3, 1000, 6000) },
    },
  };

  if (quality === 'low' || saveData || slow) config.startLevel = 0;

  if (Object.keys(allowed).length) {
    config.xhrSetup = (xhr) => {
      for (const [name, value] of Object.entries(allowed)) {
        try {
          xhr.setRequestHeader(name, value);
        } catch {
          // The browser refused this header; carry on without it.
        }
      }
    };
  }
  return config;
}

// Index of the level to lock to for a quality preference, or -1 for automatic.
export function levelForQuality(levels, quality) {
  if (quality === 'auto' || levels.length < 2) return -1;
  // Prefer levels that actually carry video (some masters include an audio-only rendition).
  const candidates = levels.map((level, index) => ({ level, index })).filter(({ level }) => level.height > 0);
  const pool = candidates.length ? candidates : levels.map((level, index) => ({ level, index }));
  const byBitrate = pool.sort((a, b) => a.level.bitrate - b.level.bitrate);
  return (quality === 'low' ? byBitrate[0] : byBitrate.at(-1)).index;
}

const MIXED_MESSAGE =
  'This stream uses http://, which browsers block on secure (https://) pages, and the server has no https:// version.';

function networkMessage(code, item, mixed) {
  if (mixed) return MIXED_MESSAGE;
  const { blocked } = splitHeaders(item.headers);
  const headerNote = blocked.length
    ? ` This channel asks for a custom ${blocked.join(' / ')} header, which browsers don't let websites set.`
    : '';
  if (code === 401 || code === 403) return `The server refused access (${code}). The stream may be geo-blocked or need a login.${headerNote}`;
  if (code === 404 || code === 410) return `The stream wasn't found (${code}). The link is probably outdated.`;
  if (code >= 500) return `The stream's server is having trouble (${code}).`;
  return `Couldn't connect. The stream may be offline, or its server doesn't allow playback from other websites (CORS).${headerNote}`;
}

const NATIVE_ERRORS = {
  1: 'Playback was stopped.',
  2: 'A network error interrupted the stream.',
  3: "The stream's data couldn't be decoded.",
  4: "This stream isn't available, or its format isn't supported by your browser.",
};

/**
 * Starts playing `item` on `media`.
 * Callbacks: onStatus({state, message?}), onLevels(levels), onLevel(level).
 * States: loading | playing | buffering | paused | blocked | error.
 * Returns a controller: { play(), setQuality(q), destroy() }.
 */
export function startPlayback(media, item, { quality = 'auto', onStatus, onLevels = () => {}, onLevel = () => {} }) {
  const mixed = isMixedContent(item.url);
  const url = upgradeUrl(item.url);
  const urlType = guessUrlType(item.url);
  const isRadio = item.kind === 'radio' || item.audio;
  const wantsHls = item.hls || urlType === 'hls' || (urlType === 'unknown' && !isRadio);
  // For URLs with no telling extension, fall back to native playback if it isn't HLS after all.
  const nativeFallback = !item.hls && urlType !== 'hls';

  let hls = null;
  let Hls = null;
  let destroyed = false;
  let started = false;
  let failed = false;
  let recoveries = 0;
  let startTimer;
  let stallTimer;
  let currentQuality = quality;

  const report = (state, extra = {}) => !destroyed && onStatus({ state, ...extra });

  const clearTimers = () => {
    clearTimeout(startTimer);
    clearTimeout(stallTimer);
  };

  const fail = (message) => {
    if (destroyed || failed) return;
    failed = true;
    clearTimers();
    hls?.stopLoad();
    media.pause();
    report('error', { message });
  };

  const armStartTimer = () => {
    clearTimeout(startTimer);
    startTimer = setTimeout(
      () => fail(mixed ? MIXED_MESSAGE : "The stream didn't start within 15 seconds. It may be offline or too slow right now."),
      START_TIMEOUT_MS,
    );
  };

  const attemptPlay = () => {
    const promise = media.play();
    promise?.catch((err) => {
      if (destroyed) return;
      if (err.name === 'NotAllowedError') {
        // Autoplay with sound was blocked; wait for a tap.
        clearTimers();
        report('blocked');
      }
      // Other rejections (AbortError, NotSupportedError) surface via 'error' events.
    });
  };

  const listeners = {
    playing: () => {
      started = true;
      clearTimers();
      report('playing');
    },
    waiting: () => {
      if (!started || failed) return;
      report('buffering');
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => fail('The stream stopped sending data.'), STALL_TIMEOUT_MS);
    },
    pause: () => {
      if (started && !failed) {
        clearTimeout(stallTimer);
        report('paused');
      }
    },
    error: () => {
      if (hls) return; // hls.js reports its own errors
      fail(mixed ? MIXED_MESSAGE : NATIVE_ERRORS[media.error?.code] || NATIVE_ERRORS[4]);
    },
  };
  for (const [event, handler] of Object.entries(listeners)) media.addEventListener(event, handler);

  const playNative = () => {
    media.src = url;
    attemptPlay();
  };

  const onHlsError = (_event, data) => {
    if (!data.fatal) return;
    const { ErrorTypes, ErrorDetails } = Hls;

    if (data.details === ErrorDetails.MANIFEST_PARSING_ERROR || data.details === ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR) {
      if (nativeFallback && data.details === ErrorDetails.MANIFEST_PARSING_ERROR) {
        // Not an HLS stream after all — maybe the browser can play it directly.
        hls.destroy();
        hls = null;
        playNative();
        return;
      }
      fail("This stream's format isn't supported by your browser.");
      return;
    }

    if (data.type === ErrorTypes.NETWORK_ERROR) {
      const isManifest =
        data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT;
      if (!isManifest && recoveries < MAX_RECOVERIES) {
        recoveries++;
        hls.startLoad();
        return;
      }
      fail(networkMessage(data.response?.code ?? 0, item, mixed));
      return;
    }

    if (data.type === ErrorTypes.MEDIA_ERROR && recoveries < MAX_RECOVERIES) {
      recoveries++;
      if (recoveries === MAX_RECOVERIES) hls.swapAudioCodec();
      hls.recoverMediaError();
      return;
    }

    fail(data.type === ErrorTypes.MEDIA_ERROR ? "The stream's data couldn't be decoded." : 'Playback failed.');
  };

  const applyQuality = () => {
    if (!hls || !hls.levels?.length) return;
    hls.nextLevel = levelForQuality(hls.levels, currentQuality);
  };

  const playWithHls = async () => {
    try {
      Hls = await loadHls();
    } catch {
      fail("Couldn't load the video player. Check your internet connection.");
      return;
    }
    if (destroyed) return;

    if (!Hls.isSupported()) {
      // iOS Safari before 17.1 has no MediaSource but plays HLS natively.
      if (media.canPlayType('application/vnd.apple.mpegurl')) playNative();
      else if (nativeFallback) playNative();
      else fail("This browser can't play HLS streams. Try a recent Chrome, Firefox, Edge or Safari.");
      return;
    }

    hls = new Hls(buildHlsConfig(item, currentQuality));
    hls.on(Hls.Events.ERROR, onHlsError);
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      onLevels(data.levels.map((level) => ({ height: level.height, bitrate: level.bitrate })));
      applyQuality();
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      if (level) onLevel({ height: level.height, bitrate: level.bitrate });
    });
    hls.attachMedia(media);
    hls.loadSource(url);
    attemptPlay();
  };

  report('loading');
  armStartTimer();
  onLevels([]);
  if (wantsHls) playWithHls();
  else playNative();

  return {
    /** Resume after an autoplay block or a pause. */
    play() {
      if (!started) {
        report('loading');
        armStartTimer();
      }
      attemptPlay();
    },
    setQuality(next) {
      currentQuality = next;
      applyQuality();
    },
    destroy() {
      destroyed = true;
      clearTimers();
      for (const [event, handler] of Object.entries(listeners)) media.removeEventListener(event, handler);
      hls?.destroy();
      hls = null;
      // Actually stop the download (important for endless radio streams).
      media.pause();
      media.removeAttribute('src');
      media.load();
    },
  };
}

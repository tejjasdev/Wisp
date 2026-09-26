// Playback engine. Given a <video>/<audio> element and an item, it picks the
// right way to play it (native file, hls.js, or the browser's own HLS support
// on iOS), reports a simple status, and gives up quickly with a clear reason
// instead of spinning forever.
//
// hls.js is imported on first use so it never slows down the first paint.

import { networkHints } from './network.js';
import { guessUrlType, isMixedContent, upgradeUrl } from './source.js';

const ATTEMPT_TIMEOUT_MS = 12000; // one way of playing one source gets this long to show a frame
const CHAIN_TIMEOUT_MS = 30000; // everything together, before "unavailable" is shown
const STALL_TIMEOUT_MS = 20000; // stuck buffering mid-playback for this long → try the next option
const MAX_RECOVERIES = 2;
const MAX_SOURCES = 4;

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
export function buildHlsConfig(item, quality, { lowPower = false } = {}) {
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
    liveDurationInfinity: true, // live streams report duration = Infinity, like Safari's native player
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

  if (quality === 'low' || lowPower || saveData || slow) config.startLevel = 0;

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

// Messages carry a rank so the chain reports the most useful one: a mixed-content
// or HTTP-status explanation beats a generic "couldn't connect".
const specific = (text) => ({ text, rank: 2 });
const generic = (text) => ({ text, rank: 1 });

function networkMessage(code, source, mixed) {
  if (mixed) return specific(MIXED_MESSAGE);
  const { blocked } = splitHeaders(source.headers);
  const headerNote = blocked.length
    ? ` This channel asks for a custom ${blocked.join(' / ')} header, which browsers don't let websites set.`
    : '';
  if (code === 401 || code === 403) return specific(`The server refused access (${code}). The stream may be geo-blocked or need a login.${headerNote}`);
  if (code === 404 || code === 410) return specific(`The stream wasn't found (${code}). The link is probably outdated.`);
  if (code >= 500) return specific(`The stream's server is having trouble (${code}).`);
  return generic(`Couldn't connect. The stream may be offline, or its server doesn't allow playback from other websites (CORS).${headerNote}`);
}

const NATIVE_ERRORS = {
  1: 'Playback was stopped.',
  2: 'A network error interrupted the stream.',
  3: "The stream's data couldn't be decoded.",
  4: "This stream isn't available, or its format isn't supported by your browser.",
};

/**
 * The order in which to try the two ways of playing a URL: hls.js ('hls') and
 * the browser's own media element ('native'). `item.prefer` — from content
 * sniffing or the user's type hint — goes first; the other is always tried too,
 * so a wrong guess never on its own stops something from playing.
 */
export function engineOrder(item, url = item.url) {
  let first = item.prefer;
  if (first !== 'hls' && first !== 'native') {
    const type = guessUrlType(url);
    const audio = item.kind === 'radio' || item.audio;
    first = item.hls || type === 'hls' || (type === 'unknown' && !audio) ? 'hls' : 'native';
  }
  return first === 'hls' ? ['hls', 'native'] : ['native', 'hls'];
}

/** Every (source, engine) pair to try, main source first, then any backups. */
export function buildAttempts(item) {
  const sources = [{ url: item.url, headers: item.headers }, ...(item.alternates || [])].slice(0, MAX_SOURCES);
  return sources.flatMap((source, sourceIndex) =>
    engineOrder(item, source.url).map((engine) => ({ source, sourceIndex, engine })),
  );
}

function bufferAhead(media) {
  const t = media.currentTime;
  for (let i = 0; i < media.buffered.length; i++) {
    if (media.buffered.start(i) <= t + 0.5 && media.buffered.end(i) >= t) return media.buffered.end(i) - t;
  }
  return 0;
}

/**
 * Starts playing `item` on `media`, trying each source/engine combination in
 * turn and only reporting an error once all of them have failed.
 *
 * Callbacks: onStatus({state, message?, detail?}), onLevels(levels), onLevel(level),
 *            onSource({index, url, engine}).
 * States: loading | playing | buffering | paused | blocked | error.
 * Returns a controller:
 *   play(), setQuality(q), setLowPower(bool), setBackground(bool), setSuspended(bool),
 *   getStats(), destroy().
 */
export function startPlayback(
  media,
  item,
  { quality = 'auto', lowPower = false, onStatus, onLevels = () => {}, onLevel = () => {}, onSource = () => {} },
) {
  const attempts = buildAttempts(item);
  let index = -1;
  let attempt = null;
  let hls = null;
  let Hls = null;
  let destroyed = false;
  let started = false;
  let failed = false;
  let recoveries = 0;
  let bestError = null;
  let attemptTimer;
  let chainTimer;
  let stallTimer;
  let currentQuality = quality;
  let background = false;
  let suspended = false;
  let appliedLevel = -1;
  const measured = { fragBitrate: 0, throughput: 0 };

  const report = (state, extra = {}) => !destroyed && onStatus({ state, ...extra });
  const clearAttemptTimers = () => {
    clearTimeout(attemptTimer);
    clearTimeout(stallTimer);
  };

  const fail = () => {
    if (destroyed || failed) return;
    failed = true;
    clearAttemptTimers();
    clearTimeout(chainTimer);
    teardownEngine();
    report('error', { message: bestError?.text || NATIVE_ERRORS[4] });
  };

  const noteError = (message) => {
    if (!bestError || message.rank > bestError.rank) bestError = message;
  };

  /** Give up on the current attempt and move on to the next one. */
  const next = (message) => {
    if (destroyed || failed) return;
    if (message) noteError(message);
    clearAttemptTimers();
    teardownEngine();
    started = false;
    recoveries = 0;
    index++;
    if (index >= attempts.length) {
      fail();
      return;
    }
    attempt = attempts[index];
    const mixed = isMixedContent(attempt.source.url);
    attempt.url = upgradeUrl(attempt.source.url);
    attempt.mixed = mixed;
    onSource({ index: attempt.sourceIndex, url: attempt.source.url, engine: attempt.engine });
    report('loading', attempt.sourceIndex > 0 ? { detail: 'Trying a backup source…' } : {});
    attemptTimer = setTimeout(
      () => next(mixed ? specific(MIXED_MESSAGE) : generic("The stream didn't start in time. It may be offline or too slow right now.")),
      ATTEMPT_TIMEOUT_MS,
    );
    if (attempt.engine === 'hls') playWithHls(attempt);
    else playNative(attempt);
  };

  function teardownEngine() {
    if (hls) {
      hls.destroy();
      hls = null;
    }
    appliedLevel = -1;
    if (media.getAttribute('src')) {
      media.removeAttribute('src');
      media.load();
    }
  }

  const attemptPlay = () => {
    const promise = media.play();
    promise?.catch((err) => {
      if (destroyed || failed) return;
      if (err.name === 'NotAllowedError') {
        // Autoplay with sound was blocked; wait for a tap. The stream keeps loading meanwhile.
        clearAttemptTimers();
        clearTimeout(chainTimer);
        report('blocked');
      }
      // Other rejections (AbortError, NotSupportedError) surface via 'error' events.
    });
  };

  const listeners = {
    playing: () => {
      if (failed) return;
      started = true;
      clearAttemptTimers();
      clearTimeout(chainTimer);
      report('playing');
    },
    waiting: () => {
      if (!started || failed) return;
      report('buffering');
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => next(generic('The stream stopped sending data.')), STALL_TIMEOUT_MS);
    },
    pause: () => {
      if (started && !failed && !suspended) {
        clearTimeout(stallTimer);
        report('paused');
      }
    },
    error: () => {
      // hls.js reports its own errors; ignore stale events from a previous attempt.
      if (!attempt || hls || failed) return;
      if (!media.currentSrc || media.currentSrc !== attempt.url) return;
      next(attempt.mixed ? specific(MIXED_MESSAGE) : generic(NATIVE_ERRORS[media.error?.code] || NATIVE_ERRORS[4]));
    },
  };
  for (const [event, handler] of Object.entries(listeners)) media.addEventListener(event, handler);

  function playNative(current) {
    media.src = current.url;
    attemptPlay();
  }

  function isLive() {
    const details = hls?.latestLevelDetails ?? hls?.levels?.[hls.currentLevel]?.details;
    return details ? Boolean(details.live) : !Number.isFinite(media.duration);
  }

  function lowestLevel() {
    return levelForQuality(hls.levels, 'low');
  }

  // Quality changes the user asked for use a smooth switch (at the next
  // fragment); saving bandwidth uses loadLevel, which never throws away what
  // is already buffered.
  function applyLevel() {
    if (!hls?.levels?.length) return;
    if (lowPower || background) {
      const low = lowestLevel();
      if (low !== appliedLevel) {
        appliedLevel = low;
        hls.loadLevel = low;
      }
      return;
    }
    const target = levelForQuality(hls.levels, currentQuality);
    if (target !== appliedLevel) {
      appliedLevel = target;
      hls.nextLevel = target;
    }
  }

  async function playWithHls(current) {
    try {
      Hls = await loadHls();
    } catch {
      next(generic("Couldn't load the video player. Check your internet connection."));
      return;
    }
    if (destroyed || failed || attempt !== current) return;

    if (!Hls.isSupported()) {
      // iOS Safari before 17.1 has no MediaSource but plays HLS natively.
      if (media.canPlayType('application/vnd.apple.mpegurl')) playNative(current);
      else next(generic("This browser can't play HLS streams. Try a recent Chrome, Firefox, Edge or Safari."));
      return;
    }

    const instance = new Hls(buildHlsConfig({ ...item, headers: current.source.headers }, currentQuality, { lowPower }));
    hls = instance;
    const { Events, ErrorTypes, ErrorDetails } = Hls;

    instance.on(Events.ERROR, (_event, data) => {
      if (!data.fatal || hls !== instance) return;
      if (data.details === ErrorDetails.MANIFEST_PARSING_ERROR) {
        next(generic("This link isn't an HLS stream, or its format isn't supported by your browser."));
        return;
      }
      if (data.type === ErrorTypes.NETWORK_ERROR) {
        const isManifest =
          data.details === ErrorDetails.MANIFEST_LOAD_ERROR || data.details === ErrorDetails.MANIFEST_LOAD_TIMEOUT;
        if (!isManifest && recoveries < MAX_RECOVERIES) {
          recoveries++;
          instance.startLoad();
          return;
        }
        next(networkMessage(data.response?.code ?? 0, current.source, current.mixed));
        return;
      }
      if (data.type === ErrorTypes.MEDIA_ERROR && recoveries < MAX_RECOVERIES) {
        recoveries++;
        if (recoveries === MAX_RECOVERIES) instance.swapAudioCodec();
        instance.recoverMediaError();
        return;
      }
      next(generic(data.type === ErrorTypes.MEDIA_ERROR ? "The stream's data couldn't be decoded." : 'Playback failed.'));
    });
    instance.on(Events.MANIFEST_PARSED, (_event, data) => {
      onLevels(data.levels.map((level) => ({ height: level.height, bitrate: level.bitrate })));
      applyLevel();
    });
    instance.on(Events.LEVEL_SWITCHED, (_event, data) => {
      const level = instance.levels[data.level];
      if (level) onLevel({ height: level.height, bitrate: level.bitrate });
    });
    instance.on(Events.FRAG_LOADED, (_event, data) => {
      const { frag } = data;
      const stats = frag.stats;
      const bytes = stats?.loaded || 0;
      const ms = stats ? stats.loading.end - stats.loading.start : 0;
      if (bytes && frag.duration) measured.fragBitrate = (bytes * 8) / frag.duration;
      if (bytes && ms > 0) measured.throughput = (bytes * 8 * 1000) / ms;
    });
    instance.attachMedia(media);
    instance.loadSource(current.url);
    attemptPlay();
  }

  report('loading');
  onLevels([]);
  chainTimer = setTimeout(() => {
    noteError(generic("The stream didn't start in time. It may be offline or too slow right now."));
    fail();
  }, CHAIN_TIMEOUT_MS);
  next();

  return {
    /** Resume after an autoplay block or a pause. */
    play() {
      if (failed) return;
      if (!started) {
        report('loading');
        clearTimeout(attemptTimer);
        attemptTimer = setTimeout(() => next(generic("The stream didn't start in time.")), ATTEMPT_TIMEOUT_MS);
      }
      attemptPlay();
    },
    setQuality(next) {
      currentQuality = next;
      applyLevel();
    },
    /** Multiview thumbnails: stay on the lowest quality. */
    setLowPower(on) {
      lowPower = on;
      applyLevel();
    },
    /** Hidden tab: drop to the lowest quality until visible again. */
    setBackground(on) {
      background = on;
      applyLevel();
    },
    /** Stop downloading entirely (muted multiview tiles in a hidden tab). */
    setSuspended(on) {
      if (on === suspended || failed) return;
      suspended = on;
      if (hls) {
        if (on) hls.stopLoad();
        else hls.startLoad();
      } else if (on) media.pause();
      else attemptPlay();
    },
    getStats() {
      const level = hls && hls.currentLevel >= 0 ? hls.levels[hls.currentLevel] : null;
      const quality = media.getVideoPlaybackQuality?.();
      return {
        engine: hls ? 'hls.js' : media.currentSrc ? (attempt?.engine === 'hls' ? 'Native HLS' : 'Native') : '—',
        backup: attempt?.sourceIndex > 0 ? attempt.sourceIndex : 0,
        width: media.videoWidth || level?.width || 0,
        height: media.videoHeight || level?.height || 0,
        levelBitrate: level?.bitrate || 0,
        fragBitrate: hls ? measured.fragBitrate : 0,
        throughput: hls ? measured.throughput : 0,
        estimate: hls ? hls.bandwidthEstimate : 0,
        levelIndex: hls ? hls.currentLevel : -1,
        levelCount: hls ? hls.levels.length : 0,
        auto: hls ? hls.autoLevelEnabled : false,
        latency: hls && isLive() && Number.isFinite(hls.latency) && hls.latency > 0 ? hls.latency : 0,
        buffer: bufferAhead(media),
        dropped: quality?.droppedVideoFrames || 0,
        frames: quality?.totalVideoFrames || 0,
        codecs: level ? [level.videoCodec, level.audioCodec].filter(Boolean).join(', ') : '',
        saving: lowPower || background,
      };
    },
    destroy() {
      destroyed = true;
      clearAttemptTimers();
      clearTimeout(chainTimer);
      for (const [event, handler] of Object.entries(listeners)) media.removeEventListener(event, handler);
      if (hls) hls.destroy();
      hls = null;
      // Actually stop the download (important for endless radio streams).
      media.pause();
      media.removeAttribute('src');
      media.load();
    },
  };
}

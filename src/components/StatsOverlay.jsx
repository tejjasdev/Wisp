// Live stream statistics, sampled once a second from the active playback.
// Loaded on demand: none of this code ships until someone opens it.

import { useEffect, useState } from 'preact/hooks';
import { active } from '../playback.js';
import { statsOpen } from '../state.js';
import { CloseIcon } from './icons.jsx';

const HISTORY = 60;

export function formatBits(bps) {
  if (!bps || !Number.isFinite(bps)) return '–';
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mb/s`;
  return `${Math.round(bps / 1e3)} kb/s`;
}

function Sparkline({ speed, bitrate }) {
  const max = Math.max(1, ...speed, ...bitrate) * 1.1;
  const points = (series) =>
    series.map((v, i) => `${((i + HISTORY - series.length) / (HISTORY - 1)) * 120},${36 - (v / max) * 34}`).join(' ');
  const last = (series) => formatBits(series.at(-1));
  return (
    <figure class="spark">
      <svg viewBox="0 0 120 36" preserveAspectRatio="none" role="img"
        aria-label={`Last minute: download speed ${last(speed)}, stream bitrate ${last(bitrate)}`}>
        <polyline class="spark-speed" points={points(speed)} />
        <polyline class="spark-bitrate" points={points(bitrate)} />
      </svg>
      <figcaption>
        <span class="key key-speed">Download speed</span>
        <span class="key key-bitrate">Stream bitrate</span>
      </figcaption>
    </figure>
  );
}

export default function StatsOverlay() {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState({ speed: [], bitrate: [] });

  useEffect(() => {
    const sample = () => {
      const next = active.controller?.getStats();
      setStats(next || null);
      if (!next) return;
      setHistory((h) => ({
        speed: [...h.speed, next.throughput || next.estimate].slice(-HISTORY),
        bitrate: [...h.bitrate, next.fragBitrate || next.levelBitrate].slice(-HISTORY),
      }));
    };
    sample();
    const timer = setInterval(sample, 1000);
    return () => clearInterval(timer);
  }, []);

  const rows = [];
  if (stats) {
    const levelNote =
      stats.levelCount > 1 ? ` (${stats.levelIndex + 1} of ${stats.levelCount}${stats.auto ? ', auto' : ', locked'})` : '';
    if (stats.width) rows.push(['Picture', `${stats.width}×${stats.height}${levelNote}`]);
    if (stats.fragBitrate || stats.levelBitrate) rows.push(['Stream bitrate', formatBits(stats.fragBitrate || stats.levelBitrate)]);
    if (stats.throughput) rows.push(['Download speed', formatBits(stats.throughput)]);
    if (stats.estimate) rows.push(['Speed estimate', formatBits(stats.estimate)]);
    rows.push(['Buffered ahead', `${stats.buffer.toFixed(1)} s`]);
    if (stats.latency) rows.push(['Behind live', `${stats.latency.toFixed(1)} s`]);
    if (stats.frames) rows.push(['Dropped frames', `${stats.dropped.toLocaleString()} of ${stats.frames.toLocaleString()}`]);
    rows.push(['Player', stats.backup ? `${stats.engine}, backup source ${stats.backup}` : stats.engine]);
    if (stats.codecs) rows.push(['Codecs', stats.codecs]);
    if (stats.saving) rows.push(['Data saver', 'Lowest quality while in the background']);
  }

  return (
    <section class="stats" aria-label="Stream stats">
      <header class="stats-head">
        <h2>Stream stats</h2>
        <button type="button" class="ctl small" aria-label="Close stream stats" onClick={() => (statsOpen.value = false)}>
          <CloseIcon size={16} />
        </button>
      </header>
      {history.speed.some(Boolean) && <Sparkline speed={history.speed} bitrate={history.bitrate} />}
      {rows.length ? (
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p class="stats-empty">Waiting for the stream…</p>
      )}
    </section>
  );
}

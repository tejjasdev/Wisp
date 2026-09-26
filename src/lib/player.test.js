import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildHlsConfig, levelForQuality, splitHeaders } from './player.js';

describe('levelForQuality', () => {
  const levels = [
    { height: 0, bitrate: 64_000 }, // audio-only rendition
    { height: 360, bitrate: 800_000 },
    { height: 1080, bitrate: 5_000_000 },
    { height: 720, bitrate: 2_500_000 },
  ];

  it('returns -1 (automatic) for auto or single-level streams', () => {
    expect(levelForQuality(levels, 'auto')).toBe(-1);
    expect(levelForQuality([levels[1]], 'low')).toBe(-1);
  });

  it('locks to the lowest/highest video level, skipping audio-only ones', () => {
    expect(levelForQuality(levels, 'low')).toBe(1);
    expect(levelForQuality(levels, 'high')).toBe(2);
  });
});

describe('splitHeaders', () => {
  it('separates headers browsers refuse from ones that can be sent', () => {
    const { allowed, blocked } = splitHeaders({
      'User-Agent': 'VLC',
      Referer: 'https://a.example',
      'X-Token': 'abc',
      'Sec-Fetch-Mode': 'cors',
    });
    expect(allowed).toEqual({ 'X-Token': 'abc' });
    expect(blocked).toEqual(['User-Agent', 'Referer', 'Sec-Fetch-Mode']);
  });
});

describe('buildHlsConfig', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses conservative buffers and the worker', () => {
    const config = buildHlsConfig({ headers: {} }, 'auto');
    expect(config.enableWorker).toBe(true);
    expect(config.maxBufferLength).toBeLessThan(30);
    expect(config.backBufferLength).toBeLessThan(Infinity);
    expect(config.abrBandWidthUpFactor).toBeLessThan(config.abrBandWidthFactor);
    expect('startLevel' in config).toBe(false);
    expect('xhrSetup' in config).toBe(false);
  });

  it('seeds the bandwidth estimate from the Network Information API', () => {
    vi.stubGlobal('navigator', { connection: { downlink: 2, effectiveType: '4g', saveData: false } });
    expect(buildHlsConfig({}, 'auto').abrEwmaDefaultEstimate).toBe(1_400_000);
  });

  it('starts at the lowest level on slow links, data saver or a "low" lock', () => {
    vi.stubGlobal('navigator', { connection: { downlink: 0.2, effectiveType: '2g' } });
    expect(buildHlsConfig({}, 'auto').startLevel).toBe(0);
    vi.stubGlobal('navigator', { connection: { downlink: 10, effectiveType: '4g', saveData: true } });
    expect(buildHlsConfig({}, 'auto').startLevel).toBe(0);
    vi.unstubAllGlobals();
    expect(buildHlsConfig({}, 'low').startLevel).toBe(0);
  });

  it('only installs xhrSetup when there are headers a browser can send', () => {
    expect('xhrSetup' in buildHlsConfig({ headers: { 'User-Agent': 'x' } }, 'auto')).toBe(false);
    const config = buildHlsConfig({ headers: { 'X-Token': 'abc' } }, 'auto');
    const xhr = { setRequestHeader: vi.fn() };
    config.xhrSetup(xhr);
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-Token', 'abc');
  });
});

import { buildAttempts, engineOrder } from './player.js';

describe('engineOrder / buildAttempts', () => {
  it('tries the preferred engine first but always keeps the other', () => {
    expect(engineOrder({ url: 'https://a.example/x.mp4', prefer: 'hls' })).toEqual(['hls', 'native']);
    expect(engineOrder({ url: 'https://a.example/live.m3u8', prefer: 'native' })).toEqual(['native', 'hls']);
  });

  it('guesses from the URL and item kind when there is no preference', () => {
    expect(engineOrder({ url: 'https://a.example/live.m3u8' })).toEqual(['hls', 'native']);
    expect(engineOrder({ url: 'https://a.example/clip.webm' })).toEqual(['native', 'hls']);
    expect(engineOrder({ url: 'https://a.example/stream', kind: 'tv' })).toEqual(['hls', 'native']);
    expect(engineOrder({ url: 'https://a.example/stream', kind: 'radio' })).toEqual(['native', 'hls']);
    expect(engineOrder({ url: 'https://a.example/stream', kind: 'radio', hls: true })).toEqual(['hls', 'native']);
  });

  it('lists the main source first, then up to three backups', () => {
    const attempts = buildAttempts({
      url: 'https://a.example/1.m3u8',
      alternates: ['2', '3', '4', '5'].map((n) => ({ url: `https://a.example/${n}.m3u8`, headers: {} })),
    });
    expect(attempts).toHaveLength(8);
    expect(attempts.map((a) => `${a.sourceIndex}:${a.engine}`).slice(0, 3)).toEqual(['0:hls', '0:native', '1:hls']);
  });
});

import { describe, expect, it } from 'vitest';
import { guessUrlType, isPlaylistText } from './source.js';
import { cleanText, safeUrl } from './sanitize.js';

describe('guessUrlType', () => {
  it('classifies by file extension, ignoring query strings', () => {
    expect(guessUrlType('https://a.example/v.mp4?token=1')).toBe('video-file');
    expect(guessUrlType('https://a.example/radio.mp3')).toBe('audio-file');
    expect(guessUrlType('https://a.example/live/master.m3u8')).toBe('hls');
    expect(guessUrlType('https://a.example/list.m3u')).toBe('playlist');
    expect(guessUrlType('https://a.example/stream')).toBe('unknown');
    expect(guessUrlType('not a url')).toBe('unknown');
  });
});

describe('isPlaylistText', () => {
  it('detects pasted playlist contents', () => {
    expect(isPlaylistText('#EXTM3U\n#EXTINF:-1,A\nhttps://a.example/a.m3u8')).toBe(true);
    expect(isPlaylistText('  https://a.example/a.m3u8  ')).toBe(false);
  });
});

describe('sanitize', () => {
  it('allows only http(s) URLs', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('file:///etc/passwd')).toBe('');
    expect(safeUrl('data:image/png;base64,AAA')).toBe('');
    expect(safeUrl('data:image/png;base64,AAA', { allowImageData: true })).toBe('data:image/png;base64,AAA');
    expect(safeUrl('data:text/html,<script>', { allowImageData: true })).toBe('');
  });

  it('cleans and caps text', () => {
    expect(cleanText('  a\n\tb  ')).toBe('a b');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(42)).toBe('');
  });
});

import { sniffBytes } from './source.js';

describe('sniffBytes', () => {
  const bytes = (...parts) =>
    Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

  it('recognizes media containers by their magic numbers', () => {
    expect(sniffBytes(bytes([0, 0, 0, 0x20], 'ftypisom'))).toBe('video');
    expect(sniffBytes(bytes([0x1a, 0x45, 0xdf, 0xa3, 1, 2]))).toBe('video');
    expect(sniffBytes(bytes('ID3', [4, 0, 0]))).toBe('audio');
    expect(sniffBytes(bytes('OggS', [0]))).toBe('audio');
    expect(sniffBytes(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('audio'); // MP3 frame
    expect(sniffBytes(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe('audio'); // AAC ADTS
  });

  it('recognizes raw MPEG-TS by its 188-byte packet sync', () => {
    const ts = new Uint8Array(376);
    ts[0] = 0x47;
    ts[188] = 0x47;
    expect(sniffBytes(ts)).toBe('ts');
    expect(sniffBytes(bytes('Great news'))).toBe('unknown'); // a lone "G" isn't enough
  });

  it('recognizes playlists and web pages from text', () => {
    expect(sniffBytes(new TextEncoder().encode('\uFEFF#EXTM3U\n#EXT-X-VERSION:3'))).toBe('m3u'); // UTF-8 BOM
    expect(sniffBytes(bytes('  <!DOCTYPE html><html>'))).toBe('html');
  });

  it('falls back to the Content-Type header', () => {
    expect(sniffBytes(bytes('????'), 'application/vnd.apple.mpegurl')).toBe('m3u');
    expect(sniffBytes(bytes('????'), 'audio/aacp')).toBe('audio');
    expect(sniffBytes(bytes('????'), 'video/mp2t')).toBe('ts');
    expect(sniffBytes(bytes('????'), 'application/octet-stream')).toBe('unknown');
  });
});

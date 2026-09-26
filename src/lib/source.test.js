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

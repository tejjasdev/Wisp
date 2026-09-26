import { describe, expect, it } from 'vitest';
import { createXmltvScanner, decodeEntities, parseXmltvTime } from './xmltv.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="DWEnglish.de"><display-name lang="en">DW English</display-name><display-name>DW</display-name></channel>
  <channel id="Empty.xx"/>
  <programme start="20260926140000 +0200" stop="20260926143000 +0200" channel="DWEnglish.de">
    <title lang="en">News &amp; Views</title>
    <desc lang="en"><![CDATA[Headlines <live>]]></desc>
  </programme>
  <programme start="20260926123000 +0000" stop="20260926130000 +0000" channel="DWEnglish.de"><title>Focus on Europe</title></programme>
</tv>`;

describe('xmltv', () => {
  it('parses times with and without offsets', () => {
    expect(parseXmltvTime('20260926140000 +0200')).toBe(Date.UTC(2026, 8, 26, 12, 0, 0));
    expect(parseXmltvTime('20260926140000 -0130')).toBe(Date.UTC(2026, 8, 26, 15, 30, 0));
    expect(parseXmltvTime('202609261400')).toBe(Date.UTC(2026, 8, 26, 14, 0, 0));
    expect(parseXmltvTime('garbage')).toBeNaN();
  });

  it('decodes entities and CDATA', () => {
    expect(decodeEntities('A &amp; B &#233;&#x1F4FA; &lt;x&gt;')).toBe('A & B é📺 <x>');
    expect(decodeEntities('<![CDATA[a <b>]]>')).toBe('a <b>');
  });

  it('scans channels and programmes even when split at awkward chunk boundaries', () => {
    for (const size of [7, 13, 64, SAMPLE.length]) {
      const channels = [];
      const programmes = [];
      const scanner = createXmltvScanner({
        onChannel: (c) => channels.push(c),
        onProgramme: (p) => programmes.push({ channel: p.channel, start: p.start, stop: p.stop, title: p.title, desc: p.desc }),
      });
      for (let i = 0; i < SAMPLE.length; i += size) scanner.push(SAMPLE.slice(i, i + size));
      scanner.end();
      expect(channels).toEqual([{ id: 'DWEnglish.de', names: ['DW English', 'DW'] }]);
      expect(programmes.map((p) => p.title)).toEqual(['News & Views', 'Focus on Europe']);
      expect(programmes[0]).toMatchObject({ channel: 'DWEnglish.de', desc: 'Headlines <live>', start: Date.UTC(2026, 8, 26, 12, 0, 0) });
    }
  });
});

import { channelKeys, nowNext } from './epg.js';

describe('guide lookups', () => {
  const guide = {
    'id:dwenglish.de': [
      [1000, 2000, 'Morning News', ''],
      [2000, 3000, 'Business', 'Markets'],
      [3000, 4000, 'Focus', ''],
    ],
  };

  it('finds channels by tvg-id (with or without @feed) and by name', () => {
    expect(channelKeys({ tvgId: 'DWEnglish.de@SD', name: 'DW English (1080p)' })).toEqual([
      'id:dwenglish.de@sd',
      'id:dwenglish.de',
      'name:dw english',
    ]);
  });

  it('returns what is on now and next', () => {
    const channel = { tvgId: 'DWEnglish.de@SD', name: 'DW' };
    expect(nowNext(guide, channel, 2500)).toMatchObject({ now: { title: 'Business', desc: 'Markets' }, next: { title: 'Focus' } });
    expect(nowNext(guide, channel, 500)).toMatchObject({ now: null, next: { title: 'Morning News' } });
    expect(nowNext(guide, channel, 5000)).toEqual({ now: null, next: null });
    expect(nowNext(guide, { name: 'Other' }, 2500)).toEqual({ now: null, next: null });
  });
});

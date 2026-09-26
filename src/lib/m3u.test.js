import { describe, expect, it } from 'vitest';
import { isHlsPlaylist, looksLikeM3u, parseExtinf, parseM3u, UNGROUPED } from './m3u.js';

const SAMPLE = `#EXTM3U x-tvg-url="https://epg.example/guide.xml"
#EXTINF:-1 tvg-id="news.1" tvg-logo="https://img.example/news.png" group-title="News",World News, Live
https://cdn.example/news/master.m3u8
#EXTINF:-1 tvg-logo="javascript:alert(1)" group-title="Kids;Animation",Cartoons
#EXTVLCOPT:http-user-agent=Mozilla/5.0 Test
#EXTVLCOPT:http-referrer=https://ref.example/
https://cdn.example/kids.m3u8
#EXTINF:-1,No Group
relative/stream.m3u8
#EXTINF:-1 group-title="News",Duplicate of first
https://cdn.example/news/master.m3u8
#EXTINF:-1,Bad scheme
javascript:alert(1)
#EXTINF:-1 group-title="Sports",Piped
https://cdn.example/sport.m3u8|User-Agent=Kodi%2F20&Referer=https://sport.example
`;

describe('parseExtinf', () => {
  it('keeps commas inside quoted attributes and in the title', () => {
    const { attrs, title } = parseExtinf('#EXTINF:-1 tvg-name="A, B" group-title="X",Title, with comma');
    expect(attrs['tvg-name']).toBe('A, B');
    expect(attrs['group-title']).toBe('X');
    expect(title).toBe('Title, with comma');
  });

  it('does not read attributes out of the title', () => {
    const { attrs } = parseExtinf('#EXTINF:-1,Name group-title="nope"');
    expect(attrs['group-title']).toBeUndefined();
  });
});

describe('parseM3u', () => {
  const { channels, groups } = parseM3u(SAMPLE, 'https://lists.example/tv/list.m3u');

  it('parses entries, resolving relative URLs and dropping duplicates and bad schemes', () => {
    expect(channels.map((c) => c.name)).toEqual(['World News, Live', 'Cartoons', 'No Group', 'Piped']);
    expect(channels[2].url).toBe('https://lists.example/tv/relative/stream.m3u8');
  });

  it('only keeps http(s) logos', () => {
    expect(channels[0].logo).toBe('https://img.example/news.png');
    expect(channels[1].logo).toBe('');
  });

  it('splits multi-group titles and falls back to a default group', () => {
    expect(channels[1].groups).toEqual(['Kids', 'Animation']);
    expect(channels[2].groups).toEqual([UNGROUPED]);
    expect(groups.at(-1).name).toBe(UNGROUPED);
    expect(groups.find((g) => g.name === 'News').count).toBe(1);
  });

  it('collects VLC and Kodi-style headers', () => {
    expect(channels[1].headers).toEqual({ 'User-Agent': 'Mozilla/5.0 Test', Referer: 'https://ref.example/' });
    expect(channels[3].url).toBe('https://cdn.example/sport.m3u8');
    expect(channels[3].headers).toEqual({ 'User-Agent': 'Kodi/20', Referer: 'https://sport.example' });
  });

  it('handles CRLF, a BOM and bare URLs without #EXTINF', () => {
    const result = parseM3u('\uFEFF#EXTM3U\r\nhttps://a.example/live/cam.m3u8\r\n');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0].name).toBe('cam.m3u8');
  });

  it('strips control and bidi characters from names', () => {
    const result = parseM3u('#EXTINF:-1,Evil\u202Egnp.exe\u0007\nhttps://a.example/x.m3u8');
    expect(result.channels[0].name).toBe('Evil gnp.exe');
  });
});

describe('playlist detection', () => {
  it('tells HLS streams apart from channel lists', () => {
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8')).toBe(true);
    expect(isHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg1.ts')).toBe(true);
    expect(isHlsPlaylist(SAMPLE)).toBe(false);
    expect(looksLikeM3u(SAMPLE)).toBe(true);
    expect(looksLikeM3u('<html>')).toBe(false);
  });
});

import { baseName } from './m3u.js';

describe('guide info and base names', () => {
  it('reads the guide URL from the header and keeps tvg-id', () => {
    const { channels, epgUrls } = parseM3u(
      '#EXTM3U x-tvg-url="https://epg.example/a.xml.gz,https://epg.example/b.xml"\n#EXTINF:-1 tvg-id="DWEnglish.de@SD",DW\nhttps://a.example/dw.m3u8',
    );
    expect(epgUrls).toEqual(['https://epg.example/a.xml.gz', 'https://epg.example/b.xml']);
    expect(channels[0].tvgId).toBe('DWEnglish.de@SD');
  });

  it('strips quality and status decoration from names', () => {
    expect(baseName('BBC One HD (1080p) [Geo-blocked]')).toBe('bbc one');
    expect(baseName('BBC One')).toBe('bbc one');
    expect(baseName('Čt24 FHD')).toBe('ct24');
    expect(baseName('ITV +1')).toBe('itv +1'); // a timeshift channel is a different channel
  });
});

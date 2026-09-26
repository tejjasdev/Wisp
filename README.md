# Wisp

A fast, lightweight player for HLS / IPTV playlists and internet radio that runs entirely in your browser.

Paste an M3U playlist or a stream link and Wisp shows the channels, grouped and searchable, and plays them with adaptive streaming tuned for slow and unstable connections. Switch to **Radio** to browse more than 40,000 internet radio stations from the free [Radio Browser](https://www.radio-browser.info) directory.

## What Wisp is, and what it isn't

- **Wisp is a generic media player**, in the same spirit as VLC. It plays links that *you* provide.
- **Wisp hosts no content.** It doesn't bundle, host or recommend any channel list or playlist, and it has no server. Streams go directly from their source to your browser.
- **Wisp keeps no data about you.** No accounts, analytics, ads or tracking. Favorites, history and settings stay in your browser's local storage.

You're responsible for making sure you have the right to watch or listen to the streams you open.

## Features

- **TV:** open an M3U/M3U8 playlist by link, by pasting its text, or from a file. Channels are grouped by category, searchable, and scroll smoothly even with 10,000+ entries.
- **Direct links:** HLS streams (`.m3u8`) and video/audio files (`.mp4`, `.webm`, `.mp3`, …) play straight away.
- **Radio:** search stations by name, country or genre.
- **Favorites and recently played**, stored locally.
- **Resume:** reopening Wisp picks up where you left off.
- **Shareable links:** `?stream=<url>` opens and plays a stream, and a shared link always wins over resume.
- **Quality:** Auto (adaptive), or lock to Low / High.
- **Installable app (PWA):** after the first visit, the app opens instantly, even offline.
- **Lock-screen controls** through the Media Session API, including next and previous channel.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| ↑ / ↓, Page Up / Page Down, Home / End | Move through the list |
| Enter | Play the highlighted channel or station |
| Space or K | Play / pause |
| / | Search |
| F | Fullscreen |
| M | Mute |

## Try it

Paste any of these into the **TV** tab:

| What | Link |
| --- | --- |
| Big Buck Bunny, an adaptive HLS test stream (Mux) | `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` |
| DW English, live (Deutsche Welle's official public stream) | `https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8` |
| Live test signal with separate audio tracks (Unified Streaming demo) | `https://demo.unified-streaming.com/k8s/live/stable/scte35.isml/.m3u8` |
| Apple's HLS example, fMP4 | `https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8` |
| A plain MP4 file | `https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4` |

Or open one directly: `https://<your-wisp-domain>/?stream=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8`

To try a large channel list, community projects such as [iptv-org](https://github.com/iptv-org/iptv) publish playlists of publicly available channels. Wisp isn't affiliated with them.

These links belong to third parties and may change or stop working.

## Why some streams won't play

Wisp runs entirely in the browser with no proxy server. That keeps it free to host and simple to trust, but browsers enforce rules that native apps like VLC don't have to follow:

- **CORS:** a stream's server has to allow playback from other websites. Many IPTV servers don't. If a *playlist* link is blocked, open it in a new tab, copy its text, and use **Playlist text**, or download it and pick the file. The channels inside often play fine.
- **Mixed content:** secure (`https://`) pages can't load `http://` streams. Wisp automatically tries the `https://` version first, and explains the problem if there isn't one.
- **Custom headers:** some playlists ask for a specific `User-Agent` or `Referer` (`#EXTVLCOPT:http-user-agent=…`). Browsers don't let websites set those headers, so such channels only work in native players. Wisp does send any other custom headers a playlist specifies. It also never sends a `Referer` of its own, because many CDNs block foreign referrers but allow none.
- **Formats:** raw MPEG-TS (`.ts`) channels, MPEG-DASH (`.mpd`) and DRM-protected streams aren't supported.
- **Geo-blocking and dead links:** Wisp says so quickly instead of spinning forever. Streams that don't start within 15 seconds show a clear message with **Try again**.

## Development

Requires Node.js 20 or newer.

```sh
npm install
npm run dev       # dev server at http://localhost:5173
npm test          # unit tests (Vitest)
npm run build     # production build in dist/
npm run preview   # serve the production build locally
```

### Deploying

`dist/` is a plain static site. On [Vercel](https://vercel.com), import the repository and deploy; `vercel.json` sets the build command, the security headers (Content Security Policy, `no-referrer`) and cache headers. Any static host works the same way.

## How it works

```
input (link, pasted text, file, ?stream=)
  └─ lib/source.js       what is it? channel list, HLS stream or plain file
       ├─ lib/m3u.js     parse and sanitize the playlist → channels + groups
       └─ state.js       signals: playlist, current item, status, favorites …
            └─ components/Player.jsx → lib/player.js
                 ├─ hls.js (loaded on first play)
                 ├─ native HLS (older iOS Safari)
                 └─ native <video>/<audio> (files and most radio streams)
```

- **Stack:** [Preact](https://preactjs.com) with [signals](https://preactjs.com/guide/v10/signals/), [hls.js](https://github.com/video-dev/hls.js) and [Vite](https://vitejs.dev). The app shell is about 22 KB gzipped, with no CSS framework and no web fonts.
- **Fast first paint:** hls.js (about 180 KB gzipped) is only downloaded when something plays. The service worker then caches it in the background, so later visits never wait for it.
- **Built for poor connections:**
  - Small forward buffer (20 s) and back buffer (30 s), so long live sessions don't keep growing in memory.
  - Short load timeouts with few retries.
  - Quality steps down quickly and steps up cautiously.
  - The first quality guess comes from the Network Information API where the browser provides it, and data saver or 2G starts at the lowest quality.
  - Resolution is capped to the player's size.
- **Large playlists:** the list is virtualized, so only visible rows exist in the page. Logos load lazily, and broken ones are remembered so they aren't requested again.
- **Untrusted data:** everything from playlists and the radio directory is treated as hostile. Text is stripped of control characters and rendered as text, never as HTML. Only `http(s)` links are accepted. A strict Content Security Policy is set on deploy.
- **Graceful failure:** loading states always show the channel's logo or initials. Errors say what went wrong (offline, CORS, 403/404, unsupported format, http-on-https) and offer **Try again** or **Next channel**.

Not in v1, but the code is set up for them: MPEG-DASH (a second engine behind `lib/player.js`), EPG, casting, and audio/subtitle track menus.

## License

[MIT](LICENSE)

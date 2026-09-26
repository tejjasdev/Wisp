import { render } from 'preact';
import { App } from './app.jsx';
import { start } from './actions.js';
import './styles.css';

// hls.js needs MediaSource Extensions (ManagedMediaSource on newer iOS);
// older iOS Safari can still play HLS natively.
const hasMse = 'MediaSource' in window || 'ManagedMediaSource' in window;
const nativeHls = document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';

render(<App canPlayHls={hasMse || nativeHls} />, document.getElementById('app'));
start();

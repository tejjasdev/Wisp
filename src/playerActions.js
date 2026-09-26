// Actions on whichever playback has the user's attention, shared by the
// on-screen controls, keyboard shortcuts and the command palette.

import { active } from './playback.js';
import { cleanText } from './lib/sanitize.js';
import { current, retryToken, showToast, status, zen } from './state.js';

export function togglePlay() {
  const { media, controller } = active;
  if (!media || !controller) return;
  const state = status.peek().state;
  if (state === 'error') retryToken.value++;
  else if (state === 'blocked' || media.paused) controller.play();
  else media.pause();
}

export function toggleMute() {
  if (active.media) active.media.muted = !active.media.muted;
}

export function setVolume(value) {
  const media = active.media;
  if (!media) return;
  media.volume = Math.min(1, Math.max(0, value));
  media.muted = media.volume === 0;
}

/** Fullscreen the whole player area so Wisp's own controls stay available. */
export function toggleFullscreen() {
  const root = document.querySelector('[data-fullscreen-root]');
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else if (root?.requestFullscreen) {
    root.requestFullscreen().catch(() => {});
  } else {
    // iPhone Safari only allows fullscreen on the <video> itself.
    active.media?.webkitEnterFullscreen?.();
  }
}

export const pipSupported = () =>
  typeof document !== 'undefined' &&
  (document.pictureInPictureEnabled || 'webkitSetPresentationMode' in HTMLVideoElement.prototype);

export async function togglePip() {
  const video = active.media;
  if (!(video instanceof HTMLVideoElement)) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else if (video.requestPictureInPicture) await video.requestPictureInPicture();
    else video.webkitSetPresentationMode?.(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
  } catch {
    showToast("Picture-in-picture isn't available for this stream");
  }
}

/** Saves the current video frame as a PNG. */
export async function snapshot() {
  const video = active.media;
  if (!(video instanceof HTMLVideoElement) || !video.videoWidth) {
    showToast('Nothing to capture yet');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  let blob;
  try {
    blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject()), 'image/png'));
  } catch {
    // Frames from servers that don't allow cross-site use can't be read back.
    showToast("This stream's server doesn't allow screenshots");
    return;
  }
  const name = cleanText(current.peek()?.name || 'wisp', 60).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'wisp';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${name}-${stamp}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  showToast('Snapshot saved');
}

/** Zen mode: hide everything but the picture. */
export function toggleZen() {
  zen.value = !zen.value;
  if (zen.value) showToast('Zen mode: ↑ ↓ change channel, Z or Esc to come back');
}

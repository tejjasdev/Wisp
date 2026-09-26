// Uses the Network Information API (Chromium-based browsers) to give hls.js a
// realistic first bandwidth guess, so the first segments are neither too
// ambitious on a slow link nor needlessly blurry on a fast one.
// Browsers without the API fall back to hls.js defaults.

export function networkHints() {
  const connection = typeof navigator !== 'undefined' ? navigator.connection : undefined;
  if (!connection) return { saveData: false, slow: false, estimate: undefined };

  const saveData = Boolean(connection.saveData);
  const slow = /(^|-)2g$/.test(connection.effectiveType || '');
  // `downlink` is in Mbit/s (Chrome caps it at 10). Use 70% of it to stay on the safe side.
  const downlink = Number(connection.downlink);
  const estimate =
    downlink > 0 ? Math.round(Math.min(Math.max(downlink * 1e6 * 0.7, 150e3), 7e6)) : undefined;

  return { saveData, slow, estimate };
}

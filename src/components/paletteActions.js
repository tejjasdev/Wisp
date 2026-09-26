// Actions offered by the command palette. Each has a label people would
// search for, optional extra keywords, the keyboard shortcut as a hint, and
// whether it applies right now.

import {
  backgroundSaver, current, mode, multiview, settingsOpen, showSourceForm, showToast, statsOpen,
} from '../state.js';
import { exportSettings, importSettings } from '../actions.js';
import { snapshot, toggleFullscreen, togglePip, toggleZen } from '../playerActions.js';
import { toggleMultiview } from './Player.jsx';

export function paletteActions() {
  const playing = Boolean(current.value);
  const video = playing && current.value.kind !== 'radio' && !current.value.audio;
  const actions = [
    { id: 'open', label: 'Open a playlist or stream link', keywords: 'm3u url paste add', run: () => { mode.value = 'tv'; showSourceForm.value = true; } },
    { id: 'tv', label: 'Show TV channels', keywords: 'list', run: () => (mode.value = 'tv') },
    { id: 'radio', label: 'Browse internet radio', keywords: 'stations music', run: () => (mode.value = 'radio') },
    { id: 'saved', label: 'Show favorites and recently played', keywords: 'history saved', run: () => (mode.value = 'saved') },
    { id: 'multiview', label: multiview.value ? 'Back to a single screen' : 'Multiview: watch up to four streams', keywords: 'grid split mosaic', hint: 'G', run: toggleMultiview },
    playing && { id: 'stats', label: statsOpen.value ? 'Hide stream stats' : 'Show stream stats', keywords: 'bitrate bandwidth speed quality info', hint: 'I', run: () => (statsOpen.value = !statsOpen.value) },
    playing && { id: 'zen', label: 'Zen mode: hide everything but the picture', keywords: 'focus distraction free tv', hint: 'Z', run: toggleZen },
    video && { id: 'fullscreen', label: 'Fullscreen', hint: 'F', run: toggleFullscreen },
    video && { id: 'pip', label: 'Picture-in-picture', keywords: 'pip float', hint: 'P', run: togglePip },
    video && { id: 'snapshot', label: 'Save a snapshot of the picture', keywords: 'screenshot capture image', hint: 'S', run: snapshot },
    { id: 'settings', label: 'Settings', keywords: 'preferences options shortcuts about', run: () => (settingsOpen.value = true) },
    { id: 'export', label: 'Export favorites and settings to a file', keywords: 'backup save download json', run: exportSettings },
    { id: 'import', label: 'Import favorites and settings from a file', keywords: 'restore load upload json', run: pickImportFile },
    {
      id: 'saver',
      label: backgroundSaver.value ? 'Turn off background data saver' : 'Turn on background data saver',
      keywords: 'bandwidth hidden tab quality',
      run: () => (backgroundSaver.value = !backgroundSaver.value),
    },
  ];
  return actions.filter(Boolean);
}

function pickImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      showToast(await importSettings(file));
    } catch (err) {
      showToast(err.message);
    }
  };
  input.click();
}

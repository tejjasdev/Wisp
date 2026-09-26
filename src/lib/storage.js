// localStorage can be missing, full, or throw (private mode, blocked cookies).
// Nothing in Wisp should break because of that, so every access goes through here.

const PREFIX = 'wisp:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Returns false if the value couldn't be stored (e.g. quota exceeded). */
export function save(key, value) {
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

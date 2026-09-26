// Streaming XMLTV scanner. XMLTV guides are routinely hundreds of megabytes,
// so instead of building a DOM this walks the text chunk by chunk and only
// extracts the few fields Wisp shows. Runs inside the EPG worker.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[code] ?? match;
    });
}

/** "20260926143000 +0200" → epoch ms (no offset means UTC). NaN if malformed. */
export function parseXmltvTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(value || '');
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s = '0', sign, oh = '0', om = '0'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const offset = sign ? (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60000 : 0;
  return utc - offset;
}

// Compiled once per name: this runs for every programme in huge files.
const patterns = new Map();
const pattern = (key, source) => {
  let re = patterns.get(key);
  if (!re) patterns.set(key, (re = new RegExp(source)));
  return re;
};
const attr = (tag, name) => {
  const m = pattern(`a:${name}`, `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeEntities(m[2] ?? m[3]) : '';
};
const element = (body, name) => {
  const m = pattern(`e:${name}`, `<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
};

/**
 * Returns a scanner: call `push(textChunk)` repeatedly and `end()` at the end.
 * Calls onChannel({ id, names }) and onProgramme({ channel, start, stop, title, desc }).
 */
export function createXmltvScanner({ onChannel, onProgramme }) {
  let buffer = '';

  const handle = (kind, block) => {
    const open = block.slice(0, block.indexOf('>') + 1);
    if (kind === 'channel') {
      const id = attr(open, 'id');
      const names = [...block.matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name>/g)].map((m) => decodeEntities(m[1]).trim());
      if (id) onChannel({ id, names });
    } else {
      onProgramme({
        channel: attr(open, 'channel'),
        // Everything else is only parsed for programmes the caller keeps.
        get start() { return parseXmltvTime(attr(open, 'start')); },
        get stop() { return parseXmltvTime(attr(open, 'stop')); },
        get title() { return element(block, 'title'); },
        get desc() { return element(block, 'desc'); },
      });
    }
  };

  const drain = (final) => {
    let position = 0;
    // Where the next tag of each kind starts (-1: none left in this buffer).
    // Remembered between iterations so each search covers the text only once.
    let channelAt = -2;
    let programmeAt = -2;
    for (;;) {
      if (channelAt !== -1 && channelAt < position) channelAt = buffer.indexOf('<channel', position);
      if (programmeAt !== -1 && programmeAt < position) programmeAt = buffer.indexOf('<programme', position);
      const at = channelAt === -1 ? programmeAt : programmeAt === -1 ? channelAt : Math.min(channelAt, programmeAt);
      if (at === -1) {
        // Keep a short tail in case a tag name is split across chunks.
        position = final ? buffer.length : Math.max(position, buffer.length - 16);
        break;
      }
      const kind = at === programmeAt ? 'programme' : 'channel';
      const closing = `</${kind}>`;
      const end = buffer.indexOf(closing, at);
      const selfClosing = buffer.indexOf('/>', at);
      const openEnd = buffer.indexOf('>', at);
      if (openEnd !== -1 && selfClosing !== -1 && selfClosing + 1 === openEnd) {
        position = openEnd + 1; // <channel id="x"/> — nothing useful inside
        continue;
      }
      if (end === -1) {
        position = at; // incomplete: wait for more text
        break;
      }
      handle(kind, buffer.slice(at, end));
      position = end + closing.length;
    }
    buffer = buffer.slice(position);
  };

  return {
    push(chunk) {
      buffer += chunk;
      drain(false);
    },
    end() {
      drain(true);
    },
  };
}

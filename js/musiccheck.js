// Verificação SIMPLES de direitos autorais: lê só os metadados do arquivo de áudio
// (ID3 do MP3, Vorbis comments do FLAC/OGG/Opus, átomos do M4A, INFO do WAV).
// Bloqueia quando encontra aviso de copyright, código ISRC, gravadora/editora ou
// licença restritiva. Libera quando a licença declarada é livre (Creative Commons,
// domínio público, royalty free...). NÃO identifica a música pelo som: um arquivo
// sem metadados passa, mesmo que seja protegido.
(function () {
  const latin1 = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };
  const utf8 = b => { try { return new TextDecoder('utf-8').decode(b); } catch (e) { return ''; } };
  const clean = s => String(s || '').replace(/\0/g, ' ').replace(/\s+/g, ' ').trim();
  const be32 = (u, p) => ((u[p] << 24) >>> 0) + (u[p + 1] << 16) + (u[p + 2] << 8) + u[p + 3];
  const le32 = (u, p) => u[p] + (u[p + 1] << 8) + (u[p + 2] << 16) + ((u[p + 3] << 24) >>> 0);
  const syncsafe = (u, p) => (u[p] << 21) | (u[p + 1] << 14) | (u[p + 2] << 7) | u[p + 3];

  function decodeText(b, enc) {
    try {
      if (enc === 0) return latin1(b);
      if (enc === 1) {
        if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
        if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
        return new TextDecoder('utf-16le').decode(b);
      }
      if (enc === 2) return new TextDecoder('utf-16be').decode(b);
      return utf8(b);
    } catch (e) { return ''; }
  }

  function find(u, str, from = 0, to = u.length) {
    const pat = Array.from(str, c => c.charCodeAt(0));
    const last = Math.min(to, u.length) - pat.length;
    outer: for (let i = from; i <= last; i++) {
      for (let j = 0; j < pat.length; j++) if (u[i + j] !== pat[j]) continue outer;
      return i;
    }
    return -1;
  }

  function add(tags, key, val) {
    val = clean(val);
    if (!key || !val) return;
    (tags[key] = tags[key] || []).includes(val) || tags[key].push(val);
  }

  const KEYMAP = {
    COPYRIGHT: 'copyright', LICENSE: 'license', LICENCE: 'license', ISRC: 'isrc',
    ORGANIZATION: 'publisher', LABEL: 'publisher', PUBLISHER: 'publisher',
    TITLE: 'title', ARTIST: 'artist',
  };

  // ---- MP3 (ID3v2.2 / 2.3 / 2.4) ----
  const ID3MAP = {
    TCOP: 'copyright', TCR: 'copyright', WCOP: 'copyright',
    TPUB: 'publisher', TPB: 'publisher', TSRC: 'isrc', TRC: 'isrc',
    TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist',
  };
  function parseID3(u, tags) {
    if (u.length < 10 || latin1(u.subarray(0, 3)) !== 'ID3') return false;
    const ver = u[3], flags = u[5];
    const end = Math.min(u.length, 10 + syncsafe(u, 6));
    let p = 10;
    if ((flags & 0x40) && ver >= 3) p += ver === 4 ? syncsafe(u, p) : be32(u, p) + 4;
    const idLen = ver === 2 ? 3 : 4, hdr = ver === 2 ? 6 : 10;
    while (p + hdr <= end) {
      const id = latin1(u.subarray(p, p + idLen));
      if (!/^[A-Z0-9]+$/.test(id)) break;
      const size = ver === 2 ? (u[p + 3] << 16) | (u[p + 4] << 8) | u[p + 5] : ver === 4 ? syncsafe(u, p + 4) : be32(u, p + 4);
      if (size <= 0) break;
      const body = u.subarray(p + hdr, Math.min(end, p + hdr + size));
      p += hdr + size;
      if (id === 'TXXX' || id === 'TXX') {
        const parts = decodeText(body.subarray(1), body[0]).split('\0').filter(Boolean);
        if (parts.length >= 2) add(tags, KEYMAP[clean(parts[0]).toUpperCase()], parts.slice(1).join(' '));
      } else if (ID3MAP[id]) {
        add(tags, ID3MAP[id], id[0] === 'W' ? latin1(body) : decodeText(body.subarray(1), body[0]));
      }
    }
    return true;
  }

  // ---- Vorbis comments (FLAC / OGG / Opus) ----
  function parseVorbis(u, p, tags) {
    const vlen = le32(u, p); p += 4 + vlen;
    if (p + 4 > u.length) return;
    const n = le32(u, p); p += 4;
    for (let i = 0; i < n && p + 4 <= u.length; i++) {
      const len = le32(u, p); p += 4;
      if (len > u.length - p) break;
      const s = utf8(u.subarray(p, p + len)); p += len;
      const eq = s.indexOf('=');
      if (eq > 0) add(tags, KEYMAP[s.slice(0, eq).toUpperCase()], s.slice(eq + 1));
    }
  }
  function parseFLAC(u, tags) {
    if (latin1(u.subarray(0, 4)) !== 'fLaC') return false;
    let p = 4;
    while (p + 4 <= u.length) {
      const last = u[p] & 0x80, type = u[p] & 0x7f;
      const len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
      if (type === 4) parseVorbis(u, p + 4, tags);
      p += 4 + len;
      if (last) break;
    }
    return true;
  }
  function parseOGG(u, tags) {
    if (latin1(u.subarray(0, 4)) !== 'OggS') return false;
    const lim = Math.min(u.length, 512 * 1024);
    let i = find(u, '\x03vorbis', 0, lim);
    if (i >= 0) parseVorbis(u, i + 7, tags);
    i = find(u, 'OpusTags', 0, lim);
    if (i >= 0) parseVorbis(u, i + 8, tags);
    return true;
  }

  // ---- M4A / MP4 (iTunes) ----
  function mp4Item(u, code, key, tags) {
    let i = 0;
    while ((i = find(u, code, i)) >= 0) {
      if (latin1(u.subarray(i + 8, i + 12)) === 'data' && i >= 4) {
        const size = be32(u, i - 4);
        const end = Math.min(u.length, i - 4 + size);
        if (end > i + 20) add(tags, key, utf8(u.subarray(i + 20, end)));
      }
      i += 4;
    }
  }
  function parseMP4(u, tags) {
    if (latin1(u.subarray(4, 8)) !== 'ftyp') return false;
    mp4Item(u, 'cprt', 'copyright', tags);
    mp4Item(u, '\xA9nam', 'title', tags);
    mp4Item(u, '\xA9ART', 'artist', tags);
    // campos livres "----" (ex.: ISRC, LABEL)
    for (const name of ['ISRC', 'LABEL', 'PUBLISHER', 'LICENSE', 'COPYRIGHT']) {
      let i = 0;
      while ((i = find(u, name, i)) >= 0) {
        if (latin1(u.subarray(i - 8, i - 4)) === 'name' && latin1(u.subarray(i + name.length + 4, i + name.length + 8)) === 'data') {
          const d = i + name.length;
          const end = Math.min(u.length, d + be32(u, d));
          add(tags, KEYMAP[name], utf8(u.subarray(d + 16, end)));
        }
        i += name.length;
      }
    }
    return true;
  }

  // ---- WAV (RIFF LIST/INFO) ----
  function parseWAV(u, tags) {
    if (latin1(u.subarray(0, 4)) !== 'RIFF' || latin1(u.subarray(8, 12)) !== 'WAVE') return false;
    const map = { ICOP: 'copyright', INAM: 'title', IART: 'artist', ISRC: 'isrc' };
    let p = 12;
    while (p + 8 <= u.length) {
      const id = latin1(u.subarray(p, p + 4)), len = le32(u, p + 4);
      if (id === 'LIST' && latin1(u.subarray(p + 8, p + 12)) === 'INFO') {
        let q = p + 12;
        const end = Math.min(u.length, p + 8 + len);
        while (q + 8 <= end) {
          const sid = latin1(u.subarray(q, q + 4)), slen = le32(u, q + 4);
          if (map[sid]) add(tags, map[sid], latin1(u.subarray(q + 8, Math.min(end, q + 8 + slen))));
          q += 8 + slen + (slen & 1);
        }
      }
      p += 8 + len + (len & 1);
    }
    return true;
  }

  const FREE = /(creative\s*commons|\bcc[\s-]?(by|0|sa|nc)\b|cc0|public\s*domain|dom[ií]nio\s*p[uú]blico|royalty[\s-]?free|livre\s+de\s+direitos|sem\s+direitos\s+autorais|copyright[\s-]?free|no\s*copyright|copyleft)/i;

  PF.musicCheck = function (u, fileName) {
    const tags = {};
    let format = 'desconhecido';
    try {
      if (parseID3(u, tags)) format = 'MP3 (ID3)';
      else if (parseFLAC(u, tags)) format = 'FLAC';
      else if (parseOGG(u, tags)) format = 'OGG';
      else if (parseMP4(u, tags)) format = 'M4A/MP4';
      else if (parseWAV(u, tags)) format = 'WAV';
    } catch (e) { /* metadados corrompidos: segue com o que foi lido */ }

    const res = {
      format,
      title: (tags.title || [])[0] || '',
      artist: (tags.artist || [])[0] || '',
      allowed: true,
      verdict: 'clean',
      reasons: [],
    };
    const licText = [...(tags.copyright || []), ...(tags.license || [])].join(' | ');
    if (licText && FREE.test(licText)) {
      res.verdict = 'free';
      res.reasons.push('Licença livre declarada: ' + licText);
      return res;
    }
    if (tags.copyright) res.reasons.push('Aviso de copyright: ' + tags.copyright.join(' | '));
    if (tags.license) res.reasons.push('Licença restritiva: ' + tags.license.join(' | '));
    if (tags.isrc) res.reasons.push('Código ISRC (música lançada comercialmente): ' + tags.isrc.join(', '));
    if (tags.publisher) res.reasons.push('Gravadora/editora: ' + tags.publisher.join(' | '));
    if (res.reasons.length) { res.allowed = false; res.verdict = 'blocked'; }
    else res.reasons.push('Nenhum sinal de direitos autorais nos metadados.');
    return res;
  };
})();

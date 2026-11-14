// Keyframes, curvas de easing e eventos da fase (PF.ease, PF.kf, PF.anim).
// Um só sistema de tempo para tudo: objetos (posição, rotação, escala, cor), câmera e tema.
// Uma trilha é uma lista de chaves { t, e, ...campos } em ordem de t; a curva "e" de uma chave
// vale para o trecho que CHEGA nela (da chave anterior até ela). Antes da 1ª chave vale a 1ª,
// depois da última vale a última. Roda também no vm do servidor (normalização).
(function () {
  const Math = globalThis.Math; // local: no vm do servidor a busca global é lenta
  const { u } = PF;
  const PI = Math.PI;

  // ---------- easing ----------
  const c1 = 1.70158, c2 = c1 * 1.525, c3 = c1 + 1, c4 = 2 * PI / 3, c5 = 2 * PI / 4.5;
  function bounceOut(p) {
    const n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) { p -= 1.5 / d; return n * p * p + 0.75; }
    if (p < 2.5 / d) { p -= 2.25 / d; return n * p * p + 0.9375; }
    p -= 2.625 / d; return n * p * p + 0.984375;
  }
  const EASE = PF.ease = {
    linear: p => p,
    instant: p => (p < 1 ? 0 : 1), // segura o valor anterior e pula na chave
    inSine: p => 1 - Math.cos(p * PI / 2),
    outSine: p => Math.sin(p * PI / 2),
    inOutSine: p => -(Math.cos(PI * p) - 1) / 2,
    inQuad: p => p * p,
    outQuad: p => 1 - (1 - p) * (1 - p),
    inOutQuad: p => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    inCubic: p => p * p * p,
    outCubic: p => 1 - Math.pow(1 - p, 3),
    inOutCubic: p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    inExpo: p => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
    outExpo: p => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutExpo: p => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    inElastic: p => (p <= 0 ? 0 : p >= 1 ? 1 : -Math.pow(2, 10 * p - 10) * Math.sin((p * 10 - 10.75) * c4)),
    outElastic: p => (p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1),
    inOutElastic: p => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5
      ? -(Math.pow(2, 20 * p - 10) * Math.sin((20 * p - 11.125) * c5)) / 2
      : (Math.pow(2, -20 * p + 10) * Math.sin((20 * p - 11.125) * c5)) / 2 + 1),
    inBack: p => c3 * p * p * p - c1 * p * p,
    outBack: p => 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2),
    inOutBack: p => (p < 0.5
      ? (Math.pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2
      : (Math.pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2),
    inBounce: p => 1 - bounceOut(1 - p),
    outBounce: bounceOut,
    inOutBounce: p => (p < 0.5 ? (1 - bounceOut(1 - 2 * p)) / 2 : (1 + bounceOut(2 * p - 1)) / 2),
  };
  // opções para o painel: [id, nome]
  const FAMILIES = [['Sine', 'Seno'], ['Quad', 'Quadrática'], ['Cubic', 'Cúbica'], ['Expo', 'Exponencial'], ['Elastic', 'Elástica'], ['Back', 'Recuo'], ['Bounce', 'Quique']];
  PF.EASE_OPTIONS = [['linear', 'Linear'], ['instant', 'Instantâneo']];
  for (const [f, name] of FAMILIES) {
    PF.EASE_OPTIONS.push(['in' + f, name + ' · entrada'], ['out' + f, name + ' · saída'], ['inOut' + f, name + ' · entrada e saída']);
  }

  // ---------- cores ----------
  const HEX = /^#[0-9a-f]{6}$/i;
  const rgbCache = new Map();
  function rgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      if (rgbCache.size > 512) rgbCache.clear();
      rgbCache.set(hex, v);
    }
    return v;
  }
  const hex2 = v => Math.round(u.clamp(v, 0, 255)).toString(16).padStart(2, '0');
  function mixHex(a, b, p) {
    if (p <= 0) return a;
    if (p >= 1) return b;
    const A = rgb(a), B = rgb(b);
    return '#' + hex2(A[0] + (B[0] - A[0]) * p) + hex2(A[1] + (B[1] - A[1]) * p) + hex2(A[2] + (B[2] - A[2]) * p);
  }
  const rgba = (hex, a) => { const c = rgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

  // ---------- canais (campos de cada trilha) ----------
  // campo: [chave, nome, unidade, mín, máx] ou [chave, nome, 'color']
  PF.KF_CHANNELS = { // objetos; tempo relativo ao começo do objeto
    pos: { label: 'Posição', fields: [['x', 'X', 'px', -4000, 4000], ['y', 'Y', 'px', -4000, 4000]], def: { x: 0, y: 0 } },
    rot: { label: 'Rotação', fields: [['v', 'Ângulo', '°', -36000, 36000]], def: { v: 0 } },
    scl: { label: 'Escala', fields: [['x', 'X', '%', -1000, 1000], ['y', 'Y', '%', -1000, 1000]], def: { x: 100, y: 100 } },
    col: { label: 'Cor', fields: [['c', 'Cor', 'color']], def: { c: '#FF4D5E' } },
  };
  PF.CAM_CHANNELS = { // câmera; tempo da fase
    pos: { label: 'Posição', fields: [['x', 'X', 'px', -4000, 4000], ['y', 'Y', 'px', -4000, 4000]], def: { x: 0, y: 0 } },
    zoom: { label: 'Zoom', fields: [['v', 'Zoom', '%', 10, 1000]], def: { v: 100 } },
    rot: { label: 'Rotação', fields: [['v', 'Ângulo', '°', -36000, 36000]], def: { v: 0 } },
    shake: { label: 'Tremor', fields: [['v', 'Força', 'px', 0, 200]], def: { v: 0 } },
  };
  const BASE_THEME = { bg: '#0B1416', hz: '#FF4D5E', pl: '#FFB347', ui: '#7CFFB2' };
  PF.THEME_FIELDS = [['bg', 'Fundo', 'color'], ['hz', 'Perigo', 'color'], ['pl', 'Jogador', 'color'], ['ui', 'Grade / acento', 'color']];
  PF.THEMES = [ // paletas prontas (originais do Pulsefield)
    { name: 'Osciloscópio', pal: BASE_THEME },
    { name: 'Brasa', pal: { bg: '#150D0B', hz: '#FF7A3D', pl: '#FFE08A', ui: '#FFB36B' } },
    { name: 'Gelo', pal: { bg: '#0A1220', hz: '#5CC8FF', pl: '#F4F7FF', ui: '#9FB8FF' } },
    { name: 'Neon roxo', pal: { bg: '#120B1C', hz: '#FF3DCB', pl: '#FFE66D', ui: '#B48CFF' } },
    { name: 'Musgo', pal: { bg: '#0D140C', hz: '#E8F05A', pl: '#FF8FA3', ui: '#7EDB8A' } },
    { name: 'Papel', pal: { bg: '#E9E4DA', hz: '#D6334A', pl: '#1E2A3A', ui: '#4F6B78' } },
  ];

  // ---------- trilhas ----------
  const ease = id => EASE[id] || EASE.linear;
  // índice da última chave com t <= tempo (busca binária); -1 antes da primeira
  function seek(track, t) {
    let lo = 0, hi = track.length - 1, r = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (track[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1;
    }
    return r;
  }
  // ---------- aleatório fixo ----------
  // hash inteiro (igual em qualquer navegador e no servidor) → número em [0, 1)
  function hash01(a, b, c, d) {
    let h = Math.imul((a | 0) ^ 0x9E3779B9, 0x85EBCA6B);
    h ^= Math.imul(b | 0, 0xC2B2AE35); h = Math.imul(h ^ (h >>> 16), 0x27D4EB2F);
    h ^= Math.imul(c | 0, 0x165667B1); h = Math.imul(h ^ (h >>> 13), 0x9E3779B1);
    h ^= Math.imul(d | 0, 0x7FEB352D); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12;
    return (h >>> 0) / 4294967296;
  }
  // valor de um campo da chave: com "rnd", sorteia em [v - amp, v + amp] (fixo pela semente, pelo
  // tempo da chave e pelo campo) e, com "rs", encaixa em múltiplos de rs. seed null = valor base.
  function keyVal(k, key, fi, seed, salt) {
    const v = k[key];
    if (seed == null || !k.rnd || !k.rnd[key]) return v;
    // rk: número fixo da chave (mover a chave no tempo não muda o sorteio)
    let r = v + (hash01(seed, salt, k.rk != null ? k.rk : Math.round(k.t * 1000), fi) * 2 - 1) * k.rnd[key];
    if (k.rs > 0) r = Math.round(r / k.rs) * k.rs;
    return r;
  }
  // valor da trilha no tempo t (objeto com os campos), ou null se a trilha está vazia.
  // seed (opcional): liga o aleatório das chaves; salt separa canais com a mesma semente
  function sample(track, t, fields, seed, salt = 0) {
    const n = track ? track.length : 0;
    if (!n) return null;
    const i = seek(track, t);
    const out = {};
    if (i < 0 || i >= n - 1) {
      const k = track[i < 0 ? 0 : n - 1];
      fields.forEach((f, fi) => { out[f[0]] = keyVal(k, f[0], fi, seed, salt); });
      return out;
    }
    const a = track[i], b = track[i + 1];
    const p = ease(b.e)(b.t > a.t ? (t - a.t) / (b.t - a.t) : 1);
    fields.forEach((f, fi) => {
      const k = f[0];
      if (f[2] === 'color') out[k] = mixHex(a[k], b[k], u.clamp(p, 0, 1));
      else { const va = keyVal(a, k, fi, seed, salt); out[k] = va + (keyVal(b, k, fi, seed, salt) - va) * p; }
    });
    return out;
  }
  // põe (ou atualiza) uma chave no tempo t; devolve a chave
  function setKey(track, t, vals, e) {
    t = u.round(Math.max(0, t), 4);
    let k = track.find(q => Math.abs(q.t - t) < 1e-4);
    if (k) { Object.assign(k, vals); if (e) k.e = e; return k; }
    k = { t, e: e || 'linear', ...vals };
    const i = seek(track, t);
    track.splice(i + 1, 0, k);
    return k;
  }
  const sortTrack = track => track.sort((a, b) => a.t - b.t);

  // normaliza uma trilha vinda de JSON (números presos aos limites, cores válidas, ordenada)
  const MAX_KEYS = 256;
  function normTrack(raw, fields) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object' || out.length >= MAX_KEYS) continue;
      const t = Number(r.t);
      if (!Number.isFinite(t)) continue;
      const k = { t: u.round(u.clamp(t, 0, 3600), 4), e: typeof r.e === 'string' && EASE[r.e] ? r.e : 'linear' };
      let ok = true;
      for (const f of fields) {
        if (f[2] === 'color') {
          if (typeof r[f[0]] === 'string' && HEX.test(r[f[0]])) k[f[0]] = r[f[0]].toUpperCase();
          else ok = false;
        } else {
          const v = Number(r[f[0]]);
          if (Number.isFinite(v)) k[f[0]] = u.round(u.clamp(v, f[3], f[4]), 3);
          else ok = false;
        }
      }
      if (!ok) continue;
      // aleatório: amplitude por campo numérico (só grava o que for > 0) e encaixe opcional
      if (r.rnd && typeof r.rnd === 'object') {
        let rnd = null;
        for (const f of fields) {
          if (f[2] === 'color') continue;
          const a = Number(r.rnd[f[0]]);
          if (Number.isFinite(a) && a > 0) (rnd || (rnd = {}))[f[0]] = u.round(Math.min(a, f[4] - f[3]), 3);
        }
        if (rnd) {
          k.rnd = rnd;
          const rs = Number(r.rs);
          if (Number.isFinite(rs) && rs > 0) k.rs = u.round(Math.min(rs, 1000), 3);
          const rk = Number(r.rk);
          if (Number.isInteger(rk) && rk >= 0) k.rk = Math.min(rk, 2147483647);
        }
      }
      out.push(k);
    }
    sortTrack(out);
    // mesmo tempo duas vezes: fica a última
    return out.filter((k, i) => i === out.length - 1 || Math.abs(out[i + 1].t - k.t) >= 1e-4);
  }
  // objeto de trilhas { canal: trilha }; devolve null se todas vazias (JSON das fases antigas não muda)
  function normTracks(raw, spec) {
    if (!raw || typeof raw !== 'object') return null;
    let out = null;
    for (const ch in spec) {
      const tr = normTrack(raw[ch], spec[ch].fields);
      if (tr.length) (out || (out = {}))[ch] = tr;
    }
    return out;
  }

  // ---------- eventos da fase ----------
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const MAX_BG = 6;
  PF.BG_KINDS = [[0, 'Grade'], [1, 'Pontos'], [2, 'Anéis'], [3, 'Listras diagonais'], [4, 'Estrelas'], [5, 'Losangos']];
  PF.BG_FIELDS = [ // camadas do fundo (parallax)
    { key: 'kind', label: 'Desenho', type: 'select', options: PF.BG_KINDS },
    { key: 'color', label: 'Cor', type: 'color' },
    { key: 'alpha', label: 'Opacidade', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'depth', label: 'Profundidade', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'size', label: 'Espaço', min: 8, max: 800, step: 1, unit: 'px' },
    { key: 'thick', label: 'Grossura', min: 0.5, max: 40, step: 0.5, unit: 'px' },
    { key: 'sx', label: 'Rolagem X', min: -2000, max: 2000, step: 5, unit: 'px/s' },
    { key: 'sy', label: 'Rolagem Y', min: -2000, max: 2000, step: 5, unit: 'px/s' },
    { key: 'pulse', label: 'Pulsar na batida', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'from', label: 'Aparece em', min: 0, max: 3600, step: 0.05, unit: 's' },
    { key: 'to', label: 'Some em (0 = nunca)', min: 0, max: 3600, step: 0.05, unit: 's' },
  ];
  const BG_DEF = { kind: 0, color: '#7CFFB2', alpha: 12, depth: 40, size: 120, thick: 1, sx: 0, sy: 0, pulse: 0, from: 0, to: 0 };
  PF.anim = {
    BASE_THEME,
    BG_DEF,
    newBg: () => ({ ...BG_DEF }),
    // completa a fase normalizada com marcadores, checkpoints, câmera, tema e fundo
    normLevel(raw, lvl) {
      const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      lvl.markers = [];
      if (Array.isArray(raw.markers)) {
        for (const m of raw.markers.slice(0, 200)) {
          if (!m || !Number.isFinite(Number(m.t))) continue;
          lvl.markers.push({
            t: u.round(u.clamp(Number(m.t), 0, 3600), 4),
            name: str(m.name, 40) || 'Marcador',
            color: typeof m.color === 'string' && HEX.test(m.color) ? m.color.toUpperCase() : '#7CFFB2',
            desc: str(m.desc, 300),
          });
        }
        sortTrack(lvl.markers);
      }
      lvl.checkpoints = [];
      if (Array.isArray(raw.checkpoints)) {
        for (const c of raw.checkpoints.slice(0, 64)) {
          if (!c || !Number.isFinite(Number(c.t))) continue;
          lvl.checkpoints.push({
            t: u.round(u.clamp(Number(c.t), 0, 3600), 4),
            x: u.round(u.clamp(num(c.x, PF.W / 2), 12, PF.W - 12), 2),
            y: u.round(u.clamp(num(c.y, PF.H / 2), 12, PF.H - 12), 2),
          });
        }
        sortTrack(lvl.checkpoints);
      }
      lvl.cam = normTracks(raw.cam, PF.CAM_CHANNELS) || {};
      const seed = Number(raw.seed);
      if (Number.isInteger(seed) && seed > 0) lvl.seed = Math.min(seed, 999999); // aleatório da câmera
      lvl.theme = normTrack(raw.theme, PF.THEME_FIELDS);
      lvl.bg = [];
      if (Array.isArray(raw.bg)) {
        for (const b of raw.bg.slice(0, MAX_BG)) {
          if (!b || typeof b !== 'object') continue;
          const o = {};
          for (const f of PF.BG_FIELDS) {
            if (f.type === 'color') o[f.key] = typeof b[f.key] === 'string' && HEX.test(b[f.key]) ? b[f.key].toUpperCase() : BG_DEF[f.key];
            else if (f.type === 'select') o[f.key] = f.options.some(q => q[0] === Number(b[f.key])) ? Number(b[f.key]) : BG_DEF[f.key];
            else o[f.key] = u.round(u.clamp(num(b[f.key], BG_DEF[f.key]), f.min, f.max), 3);
          }
          lvl.bg.push(o);
        }
      }
      return lvl;
    },
    // paleta no tempo t
    themeAt(level, t) {
      return (level && level.theme && sample(level.theme, t, PF.THEME_FIELDS)) || BASE_THEME;
    },
    // câmera no tempo t: centro deslocado (x, y), zoom (fator), rotação (°) e tremor (px)
    camAt(level, t) {
      const c = (level && level.cam) || {}, CH = PF.CAM_CHANNELS;
      const sd = (level && level.seed) || 0; // aleatório das chaves da câmera: semente da fase
      const p = sample(c.pos, t, CH.pos.fields, sd, 11), z = sample(c.zoom, t, CH.zoom.fields, sd, 12);
      const r = sample(c.rot, t, CH.rot.fields, sd, 13), s = sample(c.shake, t, CH.shake.fields, sd, 14);
      return { x: p ? p.x : 0, y: p ? p.y : 0, zoom: z ? Math.max(0.1, z.v / 100) : 1, rot: r ? r.v : 0, shake: s ? s.v : 0 };
    },
    hasCam(level) { const c = level && level.cam; return !!c && Object.keys(c).some(k => c[k] && c[k].length); },
    // marcador anterior/seguinte a partir de t
    stepMarker(level, t, dir) {
      const ms = level.markers || [];
      if (dir > 0) { for (const m of ms) if (m.t > t + 1e-3) return m; return null; }
      for (let i = ms.length - 1; i >= 0; i--) if (ms[i].t < t - 1e-3) return ms[i];
      return null;
    },
  };

  PF.kf = { sample, setKey, seek, hash01, keyVal, sortTrack, normTrack, normTracks, mixHex, rgba, rgb, HEX, MAX_KEYS };
})();

// Constantes globais, paleta e utilitários do Pulsefield.
window.PF = window.PF || {};

PF.VERSION = '0.0.1';
PF.W = 1280; // largura lógica da arena
PF.H = 720;  // altura lógica da arena

// Jogador simples: losango com vidas e dash.
PF.PLAYER = {
  hp: 3,           // vidas
  r: 7,            // raio de colisão
  speed: 360,      // px/s
  dashSpeed: 1000, // px/s durante o dash
  dashTime: 0.16,  // s (invencível durante o dash)
  dashCd: 0.45,    // s de recarga do dash
  hurtTime: 1.2,   // s invencível depois de levar dano
};

PF.C = {
  bg: '#0B1416',
  panel: '#151E21',
  line: '#24333A',
  player: '#FFB347',
  danger: '#FF4D5E',
  dangerSoft: '#FF8A95',
  accent: '#7CFFB2',
  text: '#D8E2E4',
  muted: '#7B8D92',
};

PF.u = {
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  round(v, d = 2) { const m = 10 ** d; return Math.round(v * m) / m; },
  distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let k = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    k = Math.max(0, Math.min(1, k));
    return Math.hypot(px - (x1 + k * dx), py - (y1 + k * dy));
  },
  fmtTime(t) {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return String(m).padStart(2, '0') + ':' + s.toFixed(2).padStart(5, '0');
  },
};

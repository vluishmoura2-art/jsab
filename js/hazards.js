// Definição dos perigos. Cada perigo é uma função pura do tempo local (lt = t - h.time):
// shapes() devolve formas para desenhar e colidir. Estados: 'warn' (aviso, sem dano),
// 'active' (causa dano) e 'fx' (efeito visual, sem dano).
(function () {
  const { W, H, u } = PF;
  const TAU = Math.PI * 2;
  const BALL_WARN = 0.5; // aviso antes de cada bola sair
  const FADE = 0.15;     // sumiço de linhas/círculos depois de ativos

  const off = (x, y, r) => x + r < 0 || x - r > W || y + r < 0 || y - r > H;

  function lineEnds(h) {
    const a = h.angle * Math.PI / 180, hl = h.length / 2;
    const c = Math.cos(a) * hl, s = Math.sin(a) * hl;
    return [h.x - c, h.y - s, h.x + c, h.y + s];
  }

  const circleHit = key => (h, x, y, tol) => Math.hypot(x - h.x, y - h.y) <= Math.max(h[key], tol);

  // Linha e círculo compartilham o mesmo ciclo: aviso -> ativo -> some.
  function appearCycle(h, lt, out, make) {
    if (lt < 0) return;
    if (h.warn > 0 && lt < h.warn) {
      const p = lt / h.warn;
      out.push(make({ state: 'warn', alpha: 0.05 + 0.35 * p, scale: 1 }));
    } else if (lt < h.warn + h.active) {
      const a = lt - h.warn;
      const pop = a < 0.1 ? 1 + 0.35 * (1 - a / 0.1) : 1;
      out.push(make({ state: 'active', alpha: 1, scale: pop }));
    } else {
      const f = (lt - h.warn - h.active) / FADE;
      if (f < 1) out.push(make({ state: 'fx', alpha: 1 - f, scale: 1 - f }));
    }
  }

  const WARN_PROP = { key: 'warn', label: 'Tempo para aparecer', min: 0, max: 10, step: 0.05, unit: 's' };
  const ACTIVE_PROP = { key: 'active', label: 'Tempo ativa', min: 0.05, max: 10, step: 0.05, unit: 's' };

  PF.HAZARDS = {
    ball: {
      label: 'Bola',
      desc: 'Dispara bolas em linha reta para a direita ou para a esquerda. A recarga é o intervalo entre uma bola e a próxima.',
      defaults: { dir: 1, size: 18, speed: 320, count: 3, reload: 0.5 },
      props: [
        { key: 'dir', label: 'Direção', type: 'select', options: [[1, 'Direita →'], [-1, '← Esquerda']] },
        { key: 'size', label: 'Tamanho', min: 4, max: 120, step: 1, unit: 'px' },
        { key: 'speed', label: 'Velocidade', min: 20, max: 1500, step: 10, unit: 'px/s' },
        { key: 'count', label: 'Quantidade', min: 1, max: 30, step: 1 },
        { key: 'reload', label: 'Recarga', min: 0.05, max: 5, step: 0.05, unit: 's' },
      ],
      lead: () => BALL_WARN,
      warnLen: () => 0,
      length(h) {
        const travel = h.dir > 0 ? (W + h.size - h.x) / h.speed : (h.x + h.size) / h.speed;
        return (h.count - 1) * h.reload + Math.max(0, travel);
      },
      shapes(h, lt, out) {
        for (let i = 0; i < h.count; i++) {
          const dt = lt - i * h.reload;
          if (dt < 0) {
            // aviso no ponto de disparo antes da próxima bola
            if (dt > -BALL_WARN) {
              out.push({ kind: 'circle', x: h.x, y: h.y, r: h.size, state: 'warn', alpha: 0.1 + 0.35 * (1 + dt / BALL_WARN) });
            }
            break;
          }
          const x = h.x + h.dir * h.speed * dt;
          if (off(x, h.y, h.size)) continue;
          out.push({ kind: 'circle', x, y: h.y, r: h.size, state: 'active', alpha: 1 });
        }
      },
      hit: circleHit('size'),
    },

    explosive: {
      label: 'Bola explosiva',
      desc: 'Fica parada pulsando e, quando o tempo acaba, explode soltando bolinhas em todas as direções.',
      defaults: { size: 30, fuse: 1.5, fragments: 8, fragSpeed: 380, fragSize: 9, spin: 0 },
      props: [
        { key: 'size', label: 'Tamanho', min: 8, max: 160, step: 1, unit: 'px' },
        { key: 'fuse', label: 'Tempo até explodir', min: 0.1, max: 10, step: 0.05, unit: 's' },
        { key: 'fragments', label: 'Qtd. de bolinhas', min: 2, max: 48, step: 1 },
        { key: 'fragSpeed', label: 'Velocidade da explosão', min: 40, max: 1500, step: 10, unit: 'px/s' },
        { key: 'fragSize', label: 'Tamanho das bolinhas', min: 2, max: 60, step: 1, unit: 'px' },
        { key: 'spin', label: 'Rotação do padrão', min: 0, max: 360, step: 1, unit: '°' },
      ],
      lead: () => 0,
      warnLen: () => 0,
      length: h => h.fuse + (Math.hypot(W, H) + h.fragSize) / h.fragSpeed,
      shapes(h, lt, out) {
        if (lt < 0) return;
        if (lt < h.fuse) {
          const p = lt / h.fuse;
          const phase = TAU * (2 * lt + 5 * lt * lt / h.fuse); // pulsa cada vez mais rápido
          const r = h.size * (1 + 0.08 * p * Math.sin(phase));
          out.push({ kind: 'ring', x: h.x, y: h.y, r: h.size + 20 + 50 * (1 - p), w: 2, state: 'warn', alpha: 0.15 + 0.5 * p, dashed: true });
          out.push({ kind: 'circle', x: h.x, y: h.y, r, state: 'active', alpha: 1 });
          return;
        }
        const dt = lt - h.fuse;
        if (dt < 0.2) out.push({ kind: 'circle', x: h.x, y: h.y, r: h.size * (1 + dt * 6), state: 'fx', alpha: 1 - dt / 0.2 });
        const d = h.fragSpeed * dt, base = h.spin * Math.PI / 180;
        for (let k = 0; k < h.fragments; k++) {
          const a = base + TAU * k / h.fragments;
          const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
          if (off(x, y, h.fragSize)) continue;
          out.push({ kind: 'circle', x, y, r: h.fragSize, state: 'active', alpha: 1 });
        }
      },
      hit: circleHit('size'),
    },

    line: {
      label: 'Linha',
      desc: 'Aparece aos poucos com pouca opacidade (aviso, sem dano) e depois fica sólida e perigosa.',
      defaults: { warn: 1, active: 0.6, thickness: 24, length: 1400, angle: 0 },
      props: [
        WARN_PROP, ACTIVE_PROP,
        { key: 'thickness', label: 'Grossura', min: 2, max: 400, step: 1, unit: 'px' },
        { key: 'length', label: 'Comprimento', min: 20, max: 2000, step: 10, unit: 'px' },
        { key: 'angle', label: 'Ângulo', min: -180, max: 180, step: 1, unit: '°' },
      ],
      lead: () => 0,
      warnLen: h => h.warn,
      length: h => h.warn + h.active + FADE,
      shapes(h, lt, out) {
        const [x1, y1, x2, y2] = lineEnds(h);
        appearCycle(h, lt, out, s => ({ kind: 'line', x1, y1, x2, y2, w: h.thickness * s.scale, state: s.state, alpha: s.alpha }));
      },
      hit(h, x, y, tol) {
        const [x1, y1, x2, y2] = lineEnds(h);
        return u.distToSeg(x, y, x1, y1, x2, y2) <= Math.max(h.thickness / 2, tol);
      },
    },

    circle: {
      label: 'Círculo',
      desc: 'Igual à linha, mas em forma de círculo. Com grossura 0 ele é preenchido; acima de 0 vira um anel.',
      defaults: { warn: 1, active: 0.6, thickness: 0, radius: 120 },
      props: [
        WARN_PROP, ACTIVE_PROP,
        { key: 'thickness', label: 'Grossura (0 = cheio)', min: 0, max: 300, step: 1, unit: 'px' },
        { key: 'radius', label: 'Raio', min: 10, max: 800, step: 1, unit: 'px' },
      ],
      lead: () => 0,
      warnLen: h => h.warn,
      length: h => h.warn + h.active + FADE,
      shapes(h, lt, out) {
        appearCycle(h, lt, out, s => h.thickness > 0
          ? { kind: 'ring', x: h.x, y: h.y, r: h.radius, w: h.thickness * s.scale, state: s.state, alpha: s.alpha }
          : { kind: 'circle', x: h.x, y: h.y, r: h.radius * (s.state === 'fx' ? 1 : s.scale), state: s.state, alpha: s.alpha });
      },
      hit(h, x, y, tol) {
        const d = Math.hypot(x - h.x, y - h.y);
        if (d <= tol * 1.5) return true;
        return h.thickness > 0 ? Math.abs(d - h.radius) <= Math.max(h.thickness / 2, tol) : d <= h.radius;
      },
    },

    snake: {
      label: 'Rastro',
      desc: 'Um quadrado que corre em linha reta deixando um rastro de quadrados atrás de si. Os últimos do rastro vão diminuindo. Todos causam dano.',
      defaults: { dir: 1, width: 30, height: 30, speed: 520, tail: 16 },
      props: [
        { key: 'dir', label: 'Direção', type: 'select', options: [[1, 'Direita →'], [-1, '← Esquerda']] },
        { key: 'width', label: 'Largura', min: 4, max: 200, step: 1, unit: 'px' },
        { key: 'height', label: 'Altura', min: 4, max: 200, step: 1, unit: 'px' },
        { key: 'speed', label: 'Velocidade', min: 20, max: 2000, step: 10, unit: 'px/s' },
        { key: 'tail', label: 'Quadrados atrás', min: 0, max: 60, step: 1 },
      ],
      lead: () => BALL_WARN,
      warnLen: () => 0,
      length(h) {
        const edge = h.dir > 0 ? W - h.x : h.x;
        return Math.max(0, edge + h.width / 2 + h.tail * snakeGap(h)) / h.speed;
      },
      shapes(h, lt, out) {
        if (lt < 0) {
          out.push({ kind: 'rect', x: h.x, y: h.y, w: h.width, h: h.height, state: 'warn', alpha: 0.1 + 0.35 * (1 + lt / BALL_WARN) });
          return;
        }
        const head = h.speed * lt, gap = snakeGap(h);
        // do fim do rastro para a cabeça, assim a cabeça fica por cima
        for (let i = h.tail; i >= 0; i--) {
          const back = i * gap;
          if (back > head) continue; // ainda não saiu do ponto de partida
          const k = snakeScale(i, h.tail);
          const w = h.width * k, hh = h.height * k;
          const x = h.x + h.dir * (head - back);
          if (off(x, h.y, Math.max(w, hh) / 2)) continue;
          out.push({ kind: 'rect', x, y: h.y, w, h: hh, state: 'active', alpha: i === 0 ? 1 : 0.92, head: i === 0 });
        }
      },
      hit: (h, x, y, tol) => Math.abs(x - h.x) <= Math.max(h.width / 2, tol) && Math.abs(y - h.y) <= Math.max(h.height / 2, tol),
    },
  };

  // espaço entre os quadrados do rastro e o tamanho de cada um (os últimos ~35% diminuem)
  function snakeGap(h) { return h.width * 1.12; }
  function snakeScale(i, n) {
    if (i === 0) return 1.12; // cabeça um pouco maior
    const start = Math.max(1, Math.floor(n * 0.65));
    if (i < start || n <= start) return 1;
    return 1 - 0.55 * (i - start + 1) / (n - start + 1);
  }

  let seq = 1;

  PF.hz = {
    lineEnds,
    create(type, x, y, time) {
      return { id: seq++, type, time, x, y, ...JSON.parse(JSON.stringify(PF.HAZARDS[type].defaults)) };
    },
    clone(h) { return { ...JSON.parse(JSON.stringify(h)), id: seq++ }; },
    window(h) {
      const d = PF.HAZARDS[h.type];
      return [h.time - d.lead(h), h.time + d.length(h)];
    },
    collect(level, t, out = []) {
      for (const h of level.hazards) {
        const d = PF.HAZARDS[h.type];
        const lt = t - h.time;
        if (lt < -d.lead(h) || lt > d.length(h)) continue;
        d.shapes(h, lt, out);
      }
      return out;
    },
    hitsPlayer(s, px, py, pr) {
      if (s.state !== 'active') return false;
      if (s.kind === 'circle') return Math.hypot(px - s.x, py - s.y) < s.r + pr;
      if (s.kind === 'ring') return Math.abs(Math.hypot(px - s.x, py - s.y) - s.r) < s.w / 2 + pr;
      if (s.kind === 'line') return u.distToSeg(px, py, s.x1, s.y1, s.x2, s.y2) < s.w / 2 + pr;
      if (s.kind === 'rect') {
        const dx = Math.max(0, Math.abs(px - s.x) - s.w / 2), dy = Math.max(0, Math.abs(py - s.y) - s.h / 2);
        return dx * dx + dy * dy < pr * pr;
      }
      return false;
    },
    normalize(raw) {
      const def = raw && PF.HAZARDS[raw.type];
      if (!def) return null;
      const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const h = {
        id: Number.isInteger(raw.id) && raw.id > 0 ? raw.id : 0,
        type: raw.type,
        time: Math.max(0, num(raw.time, 0)),
        x: u.clamp(num(raw.x, W / 2), -400, W + 400),
        y: u.clamp(num(raw.y, H / 2), -400, H + 400),
      };
      for (const p of def.props) {
        const v = Number(raw[p.key]);
        if (p.type === 'select') h[p.key] = p.options.some(o => o[0] === v) ? v : def.defaults[p.key];
        else h[p.key] = Number.isFinite(v) ? u.clamp(v, p.min, p.max) : def.defaults[p.key];
      }
      return h;
    },
    // Garante ids únicos e ajusta o contador.
    syncIds(list) {
      const seen = new Set();
      let max = 0;
      for (const h of list) if (h.id && !seen.has(h.id)) { seen.add(h.id); max = Math.max(max, h.id); } else h.id = 0;
      for (const h of list) if (!h.id) h.id = ++max;
      seq = max + 1;
    },
  };
})();

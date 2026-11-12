// Definição dos perigos. Cada perigo é uma função pura do tempo local (lt = t - h.time):
// shapes() devolve formas para desenhar e colidir. Estados: 'warn' (aviso, sem dano),
// 'active' (causa dano) e 'fx' (efeito visual, sem dano).
(function () {
  const Math = globalThis.Math; // local: no vm do servidor a busca global é lenta
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
      desc: 'Um quadrado que corre em linha reta soltando quadrados de luz pelo caminho. Cada quadrado nasce com um brilho, fica onde caiu e vai encolhendo até sumir. Todos causam dano.',
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
      length: h => snakeRun(h) / h.speed + snakeLife(h),
      shapes(h, lt, out) {
        if (lt < 0) {
          out.push({ kind: 'rect', x: h.x, y: h.y, w: h.width, h: h.height, state: 'warn', alpha: 0.1 + 0.35 * (1 + lt / BALL_WARN) });
          return;
        }
        const gap = snakeGap(h), life = snakeLife(h), run = snakeRun(h);
        const head = Math.min(h.speed * lt, run);
        // quadrados soltos pela cabeça a cada "gap": ficam parados e encolhem com a idade.
        // do mais velho para o mais novo, assim os novos ficam por cima
        const kMin = Math.max(1, Math.ceil((h.speed * (lt - life)) / gap));
        const kMax = Math.floor(head / gap);
        for (let k = kMin; k <= kMax; k++) {
          const age = lt - k * gap / h.speed;
          const p = age / life; // 0 = acabou de nascer, 1 = sumiu
          if (p < 0 || p >= 1) continue;
          let s, a = 0.9;
          if (age < 0.09) s = 1.3 - 0.3 * (age / 0.09);        // nasce com um "pop"
          else if (p < 0.55) s = 1;
          else s = 1 - 0.8 * ((p - 0.55) / 0.45);               // encolhe até sumir
          if (p > 0.8) a = 0.9 * (1 - (p - 0.8) / 0.2) + 0.15;
          const x = h.x + h.dir * k * gap, w = h.width * s, hh = h.height * s;
          if (off(x, h.y, Math.max(w, hh) / 2)) continue;
          out.push({ kind: 'rect', x, y: h.y, w, h: hh, state: s < 0.3 ? 'fx' : 'active', alpha: a, flash: age < 0.09 ? 1 - age / 0.09 : 0 });
        }
        // cabeça: pulsa enquanto corre
        if (h.speed * lt <= run) {
          const k = 1.12 * (1 + 0.07 * Math.sin(TAU * 7 * lt));
          const x = h.x + h.dir * head;
          if (!off(x, h.y, Math.max(h.width, h.height) * k / 2)) {
            out.push({ kind: 'rect', x, y: h.y, w: h.width * k, h: h.height * k, state: 'active', alpha: 1, head: true });
          }
        }
      },
      hit: (h, x, y, tol) => Math.abs(x - h.x) <= Math.max(h.width / 2, tol) && Math.abs(y - h.y) <= Math.max(h.height / 2, tol),
    },

    thunder: {
      label: 'Trovão',
      desc: 'Uma nuvem presa na borda de cima ou de baixo que fica soltando partículas durante toda a duração. De tempos em tempos cai um quadrado maior girando; quando ele bate na outra borda, abre um círculo oco. Para durar a fase inteira, use uma duração grande.',
      defaults: { side: 0, warn: 0.8, duration: 8, rate: 16, partSize: 6, speed: 260, every: 1.2, sqSize: 22, ringR: 110, ringW: 14 },
      props: [
        { key: 'side', label: 'Lado da nuvem', type: 'select', options: [[0, 'Em cima ↓'], [1, 'Embaixo ↑']] },
        { key: 'warn', label: 'Tempo para aparecer', min: 0, max: 5, step: 0.05, unit: 's' },
        { key: 'duration', label: 'Duração', min: 0.5, max: 600, step: 0.5, unit: 's' },
        { key: 'rate', label: 'Partículas por segundo', min: 0, max: 80, step: 1 },
        { key: 'partSize', label: 'Tamanho das partículas', min: 2, max: 30, step: 1, unit: 'px' },
        { key: 'speed', label: 'Velocidade de queda', min: 40, max: 1200, step: 10, unit: 'px/s' },
        { key: 'every', label: 'Quadrado a cada (0 = nunca)', min: 0, max: 20, step: 0.1, unit: 's' },
        { key: 'sqSize', label: 'Tamanho do quadrado', min: 6, max: 120, step: 1, unit: 'px' },
        { key: 'ringR', label: 'Raio do círculo oco', min: 20, max: 600, step: 5, unit: 'px' },
        { key: 'ringW', label: 'Grossura do círculo oco', min: 2, max: 80, step: 1, unit: 'px' },
      ],
      // o lado vem de onde você clicou: metade de cima -> nuvem em cima
      init(h) { h.side = h.y < H / 2 ? 0 : 1; h.y = h.side ? H - CLOUD_Y : CLOUD_Y; },
      lead: () => 0,
      warnLen: h => h.warn,
      length: h => h.warn + h.duration + Math.max(CLOUD_OUT, thunderFall(h) + RING_T),
      shapes(h, lt, out) {
        if (lt < 0) return;
        const end = h.warn + h.duration;
        const down = h.side ? -1 : 1;                 // sentido da queda
        const edgeY = h.side ? H : 0, floorY = h.side ? 0 : H;
        const seed = h.x * 0.137 + h.time * 3.1;

        // partículas (do mais velho para o mais novo)
        const life = (H + 40) / (h.speed * 0.75);
        if (h.rate > 0) {
          const i0 = Math.max(0, Math.ceil((lt - h.warn - life) * h.rate));
          const i1 = Math.floor((Math.min(lt, end) - h.warn) * h.rate);
          for (let i = i0; i <= i1; i++) {
            const age = lt - h.warn - i / h.rate;
            if (age < 0) continue;
            const sp = h.speed * (0.75 + 0.5 * rnd(i, seed + 1));
            const x = rnd(i, seed) * W + Math.sin(age * 3 + i) * 6;
            const y = edgeY + down * (CLOUD_Y + sp * age);
            if (off(x, y, h.partSize)) continue;
            out.push({ kind: 'circle', x, y, r: h.partSize, state: 'active', alpha: 1 });
          }
        }

        // quadrados maiores: caem girando e abrem um círculo oco no chão
        if (h.every > 0) {
          const fall = thunderFall(h), sSpeed = h.speed * 0.9;
          const j0 = Math.max(1, Math.ceil((lt - h.warn - fall - RING_T) / h.every));
          const j1 = Math.floor((Math.min(lt, end) - h.warn) / h.every);
          for (let j = j0; j <= j1; j++) {
            const age = lt - h.warn - j * h.every;
            if (age < 0) continue;
            const x = 60 + rnd(j, seed + 7) * (W - 120);
            if (age < fall) {
              const y = edgeY + down * (CLOUD_Y + sSpeed * age);
              const pop = age < 0.12 ? 1.35 - 0.35 * age / 0.12 : 1;
              const sz = h.sqSize * pop;
              out.push({ kind: 'rect', x, y, w: sz, h: sz, rot: age * 5 * (rnd(j, seed + 3) < 0.5 ? -1 : 1), state: 'active', alpha: 1, flash: age < 0.12 ? 1 - age / 0.12 : 0 });
            } else {
              const ra = age - fall; // anel: cresce, fica, some
              if (ra < 0.08) out.push({ kind: 'circle', x, y: floorY, r: h.sqSize * (1 + ra * 12), state: 'fx', alpha: 1 - ra / 0.08 });
              if (ra < 0.35) {
                const e = 1 - Math.pow(1 - ra / 0.35, 3);
                out.push({ kind: 'ring', x, y: floorY, r: h.ringR * e, w: h.ringW, state: 'active', alpha: 1 });
              } else if (ra < 0.6) {
                out.push({ kind: 'ring', x, y: floorY, r: h.ringR, w: h.ringW, state: 'active', alpha: 1 });
              } else if (ra < RING_T) {
                const f = (ra - 0.6) / (RING_T - 0.6);
                out.push({ kind: 'ring', x, y: floorY, r: h.ringR * (1 + 0.15 * f), w: h.ringW * (1 - f), state: 'fx', alpha: 1 - f });
              }
            }
          }
        }

        // nuvem: fileira de bolhas na borda que ondula; desce no aviso e sobe no fim
        let slide = 1, state = 'active', alpha = 1;
        if (lt < h.warn) { const p = lt / h.warn; slide = p; state = 'warn'; alpha = 0.15 + 0.45 * p; }
        else if (lt > end) { const p = (lt - end) / CLOUD_OUT; if (p >= 1) return; slide = 1 - p; state = 'fx'; alpha = 1 - p; }
        const STEP = 26;
        for (let k = -1; k * STEP < W + STEP; k++) {
          const wob = Math.sin(TAU * 0.9 * lt + k * 1.7) * 0.5 + Math.sin(TAU * 1.7 * lt + k * 0.6) * 0.5;
          const r = 19 + 5 * wob;
          const y = edgeY + down * (-r + (CLOUD_Y + 4 + 3 * wob) * slide);
          out.push({ kind: 'circle', x: k * STEP + 13, y, r, state, alpha });
        }
      },
      hit(h, x, y, tol) {
        const band = CLOUD_Y + 20;
        return h.side ? y >= H - band - tol : y <= band + tol;
      },
    },

    double: {
      label: 'Linha dupla',
      desc: 'Faixa com duas fileiras de círculos intercalados (cheios e ocos). Modo Centro: fica no ponto escolhido com a largura e a altura dadas. Vertical: cobre a tela de cima a baixo, grossura = largura. Horizontal: cobre a tela de lado a lado, grossura = altura. Os círculos correm ao longo da faixa conforme o fluxo.',
      defaults: { mode: 1, warn: 1, active: 2, width: 70, height: 320, flow: 120 },
      props: [
        { key: 'mode', label: 'Posição', type: 'select', options: [[0, 'Centro (largura × altura)'], [1, 'Vertical (tela toda)'], [2, 'Horizontal (tela toda)']] },
        WARN_PROP, ACTIVE_PROP,
        { key: 'width', label: 'Largura', min: 16, max: 1280, step: 1, unit: 'px' },
        { key: 'height', label: 'Altura', min: 16, max: 720, step: 1, unit: 'px' },
        { key: 'flow', label: 'Fluxo (0 = parado)', min: -800, max: 800, step: 10, unit: 'px/s' },
      ],
      lead: () => 0,
      warnLen: h => h.warn,
      length: h => h.warn + h.active + DBL_OUT,
      shapes(h, lt, out) {
        if (lt < 0) return;
        const b = doubleBox(h);
        const ax = b.vert ? 0 : 1, ay = b.vert ? 1 : 0; // eixo da faixa
        const nx = ay, ny = ax;                         // eixo da grossura
        const half = b.len / 2;
        if (lt < h.warn) {
          // aviso: faixa translúcida que se estende do centro para as pontas
          const p = lt / h.warn, e = half * (0.25 + 0.75 * (1 - Math.pow(1 - p, 2)));
          out.push({ kind: 'line', x1: b.cx - ax * e, y1: b.cy - ay * e, x2: b.cx + ax * e, y2: b.cy + ay * e,
            w: b.thick, state: 'warn', alpha: 0.05 + 0.3 * p });
          return;
        }
        const a = lt - h.warn, endT = h.active;
        const r = b.thick / 4 * 1.08, sp = r * 1.7;
        const shift = ((h.flow * a) % (2 * sp) + 2 * sp) % (2 * sp);
        const n = Math.ceil(b.len / sp) + 3;
        const beat = 1 + 0.06 * Math.sin(TAU * 4 * a); // pulsa
        for (let lane = 0; lane < 2; lane++) {
          const off = (lane ? 1 : -1) * b.thick / 4;
          for (let i = -2; i < n; i++) {
            const d = -half + i * sp + (lane ? sp / 2 : 0) + shift - sp; // posição ao longo da faixa
            if (d < -half - r * 0.2 || d > half + r * 0.2) continue;
            const q = (d + half) / b.len; // 0..1 ao longo da faixa: entra e sai em onda
            const tin = a - q * DBL_WAVE, tout = a - endT - q * DBL_WAVE;
            let s;
            if (tin < 0) continue;
            if (tin < 0.12) s = 1.4 - 0.4 * tin / 0.12;
            else s = beat;
            let state = 'active', alpha = 1;
            if (tout > 0) { const f = tout / (DBL_OUT - DBL_WAVE); if (f >= 1) continue; s *= 1 - f; alpha = 1 - f * 0.5; if (s < 0.35) state = 'fx'; }
            const x = b.cx + ax * d + nx * off, y = b.cy + ay * d + ny * off;
            // alterna cheio/oco ao longo da fileira e entre as fileiras (o fluxo anda 2 posições por ciclo)
            const hollow = (((i + lane) % 2) + 2) % 2 === 1;
            const rr = r * s;
            out.push(hollow
              ? { kind: 'ring', x, y, r: rr * 0.8, w: rr * 0.4, state, alpha, core: true }
              : { kind: 'circle', x, y, r: rr, state, alpha });
          }
        }
      },
      hit(h, x, y, tol) {
        const b = doubleBox(h);
        const hw = (b.vert ? b.thick : b.len) / 2, hh = (b.vert ? b.len : b.thick) / 2;
        return Math.abs(x - b.cx) <= Math.max(hw, tol) && Math.abs(y - b.cy) <= Math.max(hh, tol);
      },
    },
  };

  // Água: tempo para subir / escoar e altura da superfície num instante
  const WATER_RISE = 0.5, WATER_DRAIN = 0.5;
  function waterLevel(h, lt) {
    const a = lt - h.warn;
    if (a < 0) return 0;
    const ease = p => p * p * (3 - 2 * p);
    const p = u.clamp(a / Math.max(0.01, h.duration), 0, 1);
    let lvl = h.height + (h.heightEnd - h.height) * ease(p);
    if (a < WATER_RISE) lvl *= 1 - Math.pow(1 - a / WATER_RISE, 3);
    const d = a - h.duration;
    if (d > 0) lvl *= 1 - ease(u.clamp(d / WATER_DRAIN, 0, 1));
    return lvl;
  }

  PF.HAZARDS.water = {
    label: 'Água',
    desc: 'Água que sobe do fundo da fase, feita de colunas com a superfície ondulando. Durante o bloco na timeline a altura vai suavemente da inicial até a final; no fim ela escoa. Para fazer a água subir e descer várias vezes, use vários blocos.',
    defaults: { warn: 0.8, duration: 6, height: 140, heightEnd: 140, waveAmp: 18, waveSpeed: 1.2, barW: 12 },
    props: [
      { key: 'warn', label: 'Tempo para subir (aviso)', min: 0, max: 5, step: 0.05, unit: 's' },
      { key: 'duration', label: 'Duração', min: 0.5, max: 600, step: 0.5, unit: 's' },
      { key: 'height', label: 'Altura inicial', min: 10, max: 700, step: 1, unit: 'px' },
      { key: 'heightEnd', label: 'Altura final', min: 10, max: 700, step: 1, unit: 'px' },
      { key: 'waveAmp', label: 'Tamanho das ondas', min: 0, max: 150, step: 1, unit: 'px' },
      { key: 'waveSpeed', label: 'Velocidade das ondas', min: 0, max: 6, step: 0.1, unit: 'Hz' },
      { key: 'barW', label: 'Largura das colunas', min: 6, max: 60, step: 1, unit: 'px' },
    ],
    // só fica embaixo: a alça vai para a superfície, no meio da tela
    init(h) { h.x = W / 2; h.y = H - h.height; },
    lead: () => 0,
    warnLen: h => h.warn,
    length: h => h.warn + h.duration + WATER_DRAIN,
    shapes(h, lt, out) {
      if (lt < 0) return;
      if (lt < h.warn) {
        // aviso: linha tracejada onde a superfície vai chegar, ficando mais forte
        const p = lt / h.warn, y = H - h.height;
        out.push({ kind: 'line', x1: 0, y1: y, x2: W, y2: y, w: 3, state: 'warn', alpha: 0.1 + 0.5 * p });
        out.push({ kind: 'rect', x: W / 2, y: H - 3 * p, w: W, h: 6 * p, state: 'warn', alpha: 0.2 + 0.4 * p });
        return;
      }
      const lvl = waterLevel(h, lt);
      if (lvl < 1) return;
      const a = lt - h.warn, draining = a > h.duration;
      const amp = Math.min(h.waveAmp, lvl * 0.6);
      const gap = Math.max(1, h.barW * 0.14), step = h.barW + gap;
      const w1 = TAU * h.waveSpeed * a, k1 = TAU / 520, k2 = TAU / 190, k3 = TAU / 1500;
      for (let x = step / 2; x < W + step; x += step) {
        // ondas que andam + uma ondulação larga e lenta + cada coluna balança um pouco
        const wave = 0.55 * Math.sin(k1 * x - w1) + 0.25 * Math.sin(k2 * x + w1 * 1.7)
          + 0.35 * Math.sin(k3 * x - w1 * 0.35) + 0.08 * Math.sin(x * 0.9 + w1 * 3);
        const top = H - Math.max(4, lvl + amp * wave);
        const bh = H - top + 8;
        out.push({ kind: 'rect', x, y: top + bh / 2, w: h.barW, h: bh, round: h.barW / 2,
          state: draining ? 'fx' : 'active', alpha: draining ? 0.85 : 1, noGlow: true, light: wave > 0.75 });
      }
    },
    hit(h, x, y, tol) { return y >= H - Math.max(h.height, h.heightEnd) - tol; },
  };

  // Roda: direções (dx, dy) e distância até sair da tela
  const WHEEL_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function wheelRun(h) {
    const m = h.radius + h.size * 1.2;
    return Math.max(0, [W - h.x, h.x, H - h.y, h.y][h.dir] + m);
  }

  PF.HAZARDS.wheel = {
    label: 'Roda',
    desc: 'Um anel de alvos que gira sem parar e anda em linha reta numa direção fixa (direita, esquerda, baixo ou cima) até sair da tela. O tamanho do arco é o raio da roda.',
    defaults: { dir: 0, radius: 90, count: 10, size: 20, speed: 160, spin: 90 },
    props: [
      { key: 'dir', label: 'Direção', type: 'select', options: [[0, 'Direita →'], [1, '← Esquerda'], [2, 'Baixo ↓'], [3, 'Cima ↑']] },
      { key: 'radius', label: 'Tamanho do arco', min: 20, max: 500, step: 1, unit: 'px' },
      { key: 'count', label: 'Quantidade de rodas', min: 2, max: 32, step: 1 },
      { key: 'size', label: 'Tamanho de cada roda', min: 6, max: 80, step: 1, unit: 'px' },
      { key: 'speed', label: 'Velocidade de movimento', min: 20, max: 1500, step: 10, unit: 'px/s' },
      { key: 'spin', label: 'Velocidade do giro (− = anti-horário)', min: -720, max: 720, step: 5, unit: '°/s' },
    ],
    lead: () => BALL_WARN,
    warnLen: () => 0,
    length: h => wheelRun(h) / h.speed,
    shapes(h, lt, out) {
      const [dx, dy] = WHEEL_DIRS[h.dir] || WHEEL_DIRS[0];
      const a = Math.max(0, lt);
      const cx = h.x + dx * h.speed * a, cy = h.y + dy * h.speed * a;
      const base = h.spin * Math.PI / 180 * a;
      if (lt < 0) {
        // aviso: o contorno da roda aparece tracejado
        const al = 0.1 + 0.4 * (1 + lt / BALL_WARN);
        out.push({ kind: 'ring', x: cx, y: cy, r: h.radius, w: 2, state: 'warn', alpha: al, dashed: true });
        for (let k = 0; k < h.count; k++) {
          const ang = TAU * k / h.count;
          out.push({ kind: 'circle', x: cx + Math.cos(ang) * h.radius, y: cy + Math.sin(ang) * h.radius, r: h.size, state: 'warn', alpha: al * 0.6 });
        }
        return;
      }
      // abre do centro ao surgir e cada alvo pulsa de leve, um depois do outro
      const open = a < 0.25 ? 1 - Math.pow(1 - a / 0.25, 3) : 1;
      const R = h.radius * (0.35 + 0.65 * open);
      for (let k = 0; k < h.count; k++) {
        const ang = base + TAU * k / h.count;
        const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
        const s = h.size * (1 + 0.06 * Math.sin(TAU * 2 * a - k * 0.8)) * (a < 0.12 ? 1.3 - 0.3 * a / 0.12 : 1);
        if (off(x, y, s)) continue;
        out.push({ kind: 'ring', x, y, r: s * 0.78, w: s * 0.44, state: 'active', alpha: 1, core: true });
        out.push({ kind: 'circle', x, y, r: s * 0.3, state: 'active', alpha: 1 });
      }
    },
    hit: (h, x, y, tol) => Math.abs(Math.hypot(x - h.x, y - h.y) - h.radius) <= h.size + tol || Math.hypot(x - h.x, y - h.y) <= tol * 2,
  };

  // Linha dupla: caixa da faixa conforme o modo; tempo da onda de entrada/saída
  const DBL_WAVE = 0.3, DBL_OUT = 0.55;
  function doubleBox(h) {
    if (h.mode === 1) return { cx: h.x, cy: H / 2, len: H + 40, thick: h.width, vert: true };
    if (h.mode === 2) return { cx: W / 2, cy: h.y, len: W + 40, thick: h.height, vert: false };
    const vert = h.height >= h.width;
    return { cx: h.x, cy: h.y, len: vert ? h.height : h.width, thick: vert ? h.width : h.height, vert };
  }

  // Trovão: altura da nuvem, tempo para ela sumir, duração do círculo oco
  const CLOUD_Y = 14, CLOUD_OUT = 0.4, RING_T = 0.9;
  function thunderFall(h) { return (H - CLOUD_Y) / (h.speed * 0.9); }
  // número "aleatório" fixo por índice (o perigo continua sendo função pura do tempo)
  function rnd(i, seed) { const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return s - Math.floor(s); }

  // espaço entre os quadrados do rastro; quanto tempo cada um vive (o rastro tem ~"tail" quadrados);
  // distância que a cabeça percorre até sair da tela
  function snakeGap(h) { return h.width * 1.12; }
  function snakeLife(h) { return h.tail * snakeGap(h) / h.speed; }
  function snakeRun(h) { return Math.max(0, (h.dir > 0 ? W - h.x : h.x) + h.width); }

  let seq = 1;

  PF.hz = {
    lineEnds,
    doubleBox,
    create(type, x, y, time) {
      const h = { id: seq++, type, time, x, y, ...JSON.parse(JSON.stringify(PF.HAZARDS[type].defaults)) };
      if (PF.HAZARDS[type].init) PF.HAZARDS[type].init(h);
      return h;
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
        let lx = px - s.x, ly = py - s.y;
        if (s.rot) { const c = Math.cos(-s.rot), n = Math.sin(-s.rot); [lx, ly] = [lx * c - ly * n, lx * n + ly * c]; }
        const dx = Math.max(0, Math.abs(lx) - s.w / 2), dy = Math.max(0, Math.abs(ly) - s.h / 2);
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

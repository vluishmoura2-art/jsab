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
  // make() devolve a forma a empurrar, ou nada (quando ela mesma já empurrou em "out").
  function appearCycle(h, lt, out, make) {
    if (lt < 0) return;
    let s;
    if (h.warn > 0 && lt < h.warn) {
      const p = lt / h.warn;
      s = make({ state: 'warn', alpha: 0.05 + 0.35 * p, scale: 1 });
    } else if (lt < h.warn + h.active) {
      const a = lt - h.warn;
      const pop = a < 0.1 ? 1 + 0.35 * (1 - a / 0.1) : 1;
      s = make({ state: 'active', alpha: 1, scale: pop });
    } else {
      const f = (lt - h.warn - h.active) / FADE;
      if (f < 1) s = make({ state: 'fx', alpha: 1 - f, scale: 1 - f });
    }
    if (s) out.push(s);
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

  // Plataforma pontuda: barra com espinhos na frente. Nasce devagar e acelera até a velocidade.
  const SPK_T = 70, SPK_S = 30, SPK_RAMP = 0.9, SPK_CREEP = 30;
  function spikeDist(h, t) {
    if (t <= 0) return 0;
    const v0 = Math.min(SPK_CREEP, h.speed), R = SPK_RAMP;
    if (t < R) return v0 * t + (h.speed - v0) * t * t * t / (3 * R * R);
    return v0 * R + (h.speed - v0) * R / 3 + h.speed * (t - R);
  }
  function spikeRun(h) { return Math.max(0, [W - h.x, h.x, H - h.y, h.y][h.dir] + SPK_T / 2 + 6); }
  // pontos do polígono (x, y, x, y…) com o centro da barra em (cx, cy)
  function spikePts(h, cx, cy) {
    const [dx, dy] = WHEEL_DIRS[h.dir] || WHEEL_DIRS[1];
    const sx = -dy, sy = dx, L = h.height, back = -SPK_T / 2, front = SPK_T / 2, r = SPK_T * 0.4;
    const n = Math.max(1, Math.round(L / (SPK_S * 1.15))), w = L / n;
    const loc = [[front, -L / 2]];
    for (let i = 0; i < n; i++) loc.push([front + SPK_S, -L / 2 + (i + 0.5) * w], [front, -L / 2 + (i + 1) * w]);
    for (let k = 0; k <= 4; k++) { const a = Math.PI / 2 + Math.PI / 2 * k / 4; loc.push([back + r + r * Math.cos(a), L / 2 - r + r * Math.sin(a)]); }
    for (let k = 0; k <= 4; k++) { const a = Math.PI + Math.PI / 2 * k / 4; loc.push([back + r + r * Math.cos(a), -L / 2 + r + r * Math.sin(a)]); }
    const pts = [];
    for (const [f, s] of loc) pts.push(cx + dx * f + sx * s, cy + dy * f + sy * s);
    return pts;
  }

  PF.HAZARDS.spike = {
    label: 'Plataforma pontuda',
    desc: 'Uma barra com espinhos na frente que atravessa a tela numa direção (direita, esquerda, baixo ou cima). Ela nasce devagar, tremendo, e depois dispara até a velocidade escolhida.',
    defaults: { dir: 1, height: 320, speed: 900 },
    props: [
      { key: 'dir', label: 'Direção', type: 'select', options: [[0, 'Direita →'], [1, '← Esquerda'], [2, 'Baixo ↓'], [3, 'Cima ↑']] },
      { key: 'height', label: 'Altura', min: 40, max: 1440, step: 5, unit: 'px' },
      { key: 'speed', label: 'Velocidade', min: 50, max: 3000, step: 10, unit: 'px/s' },
    ],
    lead: () => BALL_WARN,
    warnLen: () => 0,
    length(h) {
      const run = spikeRun(h);
      if (run <= spikeDist(h, SPK_RAMP)) { // ainda acelerando: procura o tempo
        let a = 0, b = SPK_RAMP;
        for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (spikeDist(h, m) < run) a = m; else b = m; }
        return b;
      }
      return SPK_RAMP + (run - spikeDist(h, SPK_RAMP)) / h.speed;
    },
    shapes(h, lt, out) {
      const [dx, dy] = WHEEL_DIRS[h.dir] || WHEEL_DIRS[1];
      if (lt < 0) {
        out.push({ kind: 'poly', pts: spikePts(h, h.x, h.y), state: 'warn', alpha: 0.1 + 0.35 * (1 + lt / BALL_WARN) });
        return;
      }
      const d = spikeDist(h, lt);
      // treme enquanto ganha velocidade
      const shake = lt < SPK_RAMP ? (1 - lt / SPK_RAMP) : 0;
      const jf = Math.sin(lt * 53) * 2.5 * shake, js = Math.sin(lt * 71) * 2 * shake;
      const cx = h.x + dx * (d + jf) - dy * js, cy = h.y + dy * (d + jf) + dx * js;
      out.push({ kind: 'poly', pts: spikePts(h, cx, cy), state: 'active', alpha: lt < 0.12 ? 0.6 + 0.4 * lt / 0.12 : 1 });
    },
    hit(h, x, y, tol) { return PF.hz.hitsPlayer({ kind: 'poly', pts: spikePts(h, h.x, h.y), state: 'active' }, x, y, tol); },
  };

  // Rastro curvo: igual ao rastro, mas a cabeça anda num arco de círculo (vira sempre o mesmo
  // tanto a cada 100 px). Na frente da cabeça aparece o caminho em aviso.
  const CRV_PREVIEW = 0.6, CRV_STEP = 6;
  const crvK = h => h.curve * Math.PI / 180 / 100; // radianos por px
  // ponto e ângulo do caminho depois de andar "s" px
  function curvePos(h, s) {
    const a0 = h.angle * Math.PI / 180, k = crvK(h);
    if (Math.abs(k) < 1e-7) return [h.x + Math.cos(a0) * s, h.y + Math.sin(a0) * s, a0];
    const a = a0 + k * s;
    return [h.x + (Math.sin(a) - Math.sin(a0)) / k, h.y + (Math.cos(a0) - Math.cos(a)) / k, a];
  }
  const curveGap = h => h.size * 1.12;
  const curveLife = h => h.tail * curveGap(h) / h.speed;
  // até onde a cabeça anda: até sair da tela pela primeira vez (no máximo duas voltas)
  const crvCache = new Map();
  function curveRun(h) {
    const key = h.x + ',' + h.y + ',' + h.angle + ',' + h.curve + ',' + h.size;
    let run = crvCache.get(key);
    if (run !== undefined) return run;
    const k = Math.abs(crvK(h));
    const max = k > 1e-7 ? Math.min(12000, 4 * Math.PI / k) : 12000, r = h.size * 0.8;
    let seen = false; // pode nascer fora da tela: conta a partir de quando entra
    run = 0;
    for (let s = 0; s <= max; s += CRV_STEP) {
      const [x, y] = curvePos(h, s);
      if (!off(x, y, r)) { seen = true; run = s; } else if (seen) break;
    }
    run = seen ? Math.min(max, run + h.size) : 0;
    if (crvCache.size > 600) crvCache.clear();
    crvCache.set(key, run);
    return run;
  }

  PF.HAZARDS.curve = {
    label: 'Rastro curvo',
    desc: 'Um quadrado que corre fazendo uma curva e solta quadrados de luz pelo caminho, que ficam parados e encolhem até sumir. Na frente dele aparece o caminho que ele vai fazer (aviso, sem dano). Curva positiva vira para a direita de quem anda; negativa, para a esquerda.',
    defaults: { angle: -90, curve: 10, size: 22, speed: 480, tail: 22 },
    props: [
      { key: 'angle', label: 'Direção inicial (0 = →, −90 = ↑)', min: -180, max: 180, step: 1, unit: '°' },
      { key: 'curve', label: 'Curva (0 = reta)', min: -90, max: 90, step: 1, unit: '°/100px' },
      { key: 'size', label: 'Tamanho', min: 4, max: 120, step: 1, unit: 'px' },
      { key: 'speed', label: 'Velocidade', min: 20, max: 2000, step: 10, unit: 'px/s' },
      { key: 'tail', label: 'Quadrados atrás', min: 0, max: 60, step: 1 },
    ],
    lead: () => BALL_WARN,
    warnLen: () => 0,
    length: h => curveRun(h) / h.speed + curveLife(h),
    shapes(h, lt, out) {
      const gap = curveGap(h), life = curveLife(h), run = curveRun(h), sz = h.size;
      const head = Math.min(h.speed * Math.max(0, lt), run);
      // caminho à frente da cabeça, nos mesmos lugares onde os quadrados vão cair
      const ahead = h.speed * CRV_PREVIEW * (lt < 0 ? 1 + lt / BALL_WARN : 1);
      const kHead = lt < 0 ? 0 : Math.floor(head / gap);
      const kEnd = Math.floor(Math.min(run, head + ahead) / gap);
      for (let k = kEnd; k > kHead; k--) {
        const [x, y, a] = curvePos(h, k * gap);
        const f = 1 - (k * gap - head) / Math.max(1, ahead); // mais forte perto da cabeça
        out.push({ kind: 'rect', x, y, w: sz * 0.8, h: sz * 0.8, rot: a, state: 'warn', alpha: 0.12 + 0.3 * f, solid: true, noGlow: true });
      }
      if (lt < 0) {
        out.push({ kind: 'rect', x: h.x, y: h.y, w: sz, h: sz, rot: h.angle * Math.PI / 180, state: 'warn', alpha: 0.1 + 0.35 * (1 + lt / BALL_WARN) });
        return;
      }
      const kMin = Math.max(1, Math.ceil((h.speed * (lt - life)) / gap));
      for (let k = kMin; k <= kHead; k++) {
        const age = lt - k * gap / h.speed;
        const p = age / life;
        if (p < 0 || p >= 1) continue;
        let s, al = 0.9;
        if (age < 0.09) s = 1.3 - 0.3 * (age / 0.09);
        else if (p < 0.55) s = 1;
        else s = 1 - 0.8 * ((p - 0.55) / 0.45);
        if (p > 0.8) al = 0.9 * (1 - (p - 0.8) / 0.2) + 0.15;
        const [x, y, a] = curvePos(h, k * gap);
        if (off(x, y, sz * s)) continue;
        out.push({ kind: 'rect', x, y, w: sz * s, h: sz * s, rot: a, state: s < 0.3 ? 'fx' : 'active', alpha: al, flash: age < 0.09 ? 1 - age / 0.09 : 0 });
      }
      if (h.speed * lt <= run) {
        const m = 1.12 * (1 + 0.07 * Math.sin(TAU * 7 * lt));
        const [x, y, a] = curvePos(h, head);
        if (!off(x, y, sz * m)) out.push({ kind: 'rect', x, y, w: sz * m, h: sz * m, rot: a, state: 'active', alpha: 1, head: true });
      }
    },
    hit: (h, x, y, tol) => Math.hypot(x - h.x, y - h.y) <= Math.max(h.size * 0.75, tol),
  };

  // ---------- comportamentos (modo manual) ----------
  // Cada comportamento é função pura do tempo "t" (s desde que ele começou) e acumula num delta
  // d = { x, y, rot, s }. A pilha é aplicada de cima para baixo. "bt" nos parâmetros = batidas
  // da fase (sem BPM, 1 batida = 0,5 s). collect() atualiza BEAT/OFFSET com a fase atual.
  let BEAT = 0.5, OFFSET = 0;
  const D2R = Math.PI / 180;
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const easeOut3 = p => 1 - (1 - p) * (1 - p) * (1 - p);
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  // ida e volta entre lo e hi (quicar sem simular)
  const fold = (v, lo, hi) => {
    const w = hi - lo;
    if (w <= 0) return (lo + hi) / 2;
    const m = (((v - lo) % (2 * w)) + 2 * w) % (2 * w);
    return lo + (m <= w ? m : 2 * w - m);
  };
  const tri = x => 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1; // onda triangular -1..1
  const DIR = { key: 'dir', label: 'Direção (0 = →, 90 = ↓)', min: -180, max: 180, step: 1, unit: '°' };
  const BEH_TIME = [
    { key: 'start', label: 'Começa (depois de ativa)', min: 0, max: 600, step: 0.05, unit: 's' },
    { key: 'end', label: 'Para em (0 = não para)', min: 0, max: 600, step: 0.05, unit: 's' },
  ];

  PF.BEHAVIORS = {
    move: {
      label: 'Mover', group: 'Posição',
      defaults: { dir: 0, speed: 240, accel: 0 },
      params: [DIR,
        { key: 'speed', label: 'Velocidade', min: -3000, max: 3000, step: 10, unit: 'px/s' },
        { key: 'accel', label: 'Aceleração', min: -5000, max: 5000, step: 10, unit: 'px/s²' }],
      apply(b, t, d) {
        const a = b.dir * D2R, s = b.speed * t + 0.5 * b.accel * t * t;
        d.x += Math.cos(a) * s; d.y += Math.sin(a) * s;
      },
    },
    dash: {
      label: 'Investida', group: 'Posição',
      defaults: { dir: 0, dist: 400, time: 0.25 },
      params: [DIR,
        { key: 'dist', label: 'Distância', min: -3000, max: 3000, step: 5, unit: 'px' },
        { key: 'time', label: 'Duração', min: 0.02, max: 10, step: 0.01, unit: 's' }],
      apply(b, t, d) {
        const a = b.dir * D2R, s = b.dist * easeOut3(clamp01(t / b.time));
        d.x += Math.cos(a) * s; d.y += Math.sin(a) * s;
      },
    },
    wave: {
      label: 'Onda', group: 'Posição',
      defaults: { axis: 1, amp: 60, period: 2 },
      params: [{ key: 'axis', label: 'Eixo', type: 'select', options: [[0, 'Horizontal'], [1, 'Vertical']] },
        { key: 'amp', label: 'Amplitude', min: 0, max: 1500, step: 1, unit: 'px' },
        { key: 'period', label: 'Período', min: 0.25, max: 64, step: 0.25, unit: 'bt' }],
      apply(b, t, d) {
        const v = b.amp * Math.sin(TAU * t / (b.period * BEAT));
        if (b.axis) d.y += v; else d.x += v;
      },
    },
    zigzag: {
      label: 'Zigue-zague', group: 'Posição',
      defaults: { dir: 0, speed: 200, amp: 60, period: 1 },
      params: [DIR,
        { key: 'speed', label: 'Velocidade', min: -3000, max: 3000, step: 10, unit: 'px/s' },
        { key: 'amp', label: 'Amplitude', min: 0, max: 1500, step: 1, unit: 'px' },
        { key: 'period', label: 'Período', min: 0.25, max: 64, step: 0.25, unit: 'bt' }],
      apply(b, t, d) {
        const a = b.dir * D2R, f = b.speed * t, s = b.amp * tri(t / (b.period * BEAT) + 0.25);
        d.x += Math.cos(a) * f - Math.sin(a) * s;
        d.y += Math.sin(a) * f + Math.cos(a) * s;
      },
    },
    orbit: {
      label: 'Órbita', group: 'Posição',
      defaults: { radius: 100, speed: 120, angle: 180 },
      params: [{ key: 'radius', label: 'Raio', min: 0, max: 2000, step: 1, unit: 'px' },
        { key: 'speed', label: 'Velocidade', min: -1440, max: 1440, step: 5, unit: '°/s' },
        { key: 'angle', label: 'Onde está o centro (0 = →)', min: -180, max: 180, step: 1, unit: '°' }],
      apply(b, t, d) {
        // o centro fica a "raio" px na direção "angle": começa parado no lugar e gira em volta dele
        const a0 = (b.angle + 180) * D2R, a = a0 + b.speed * t * D2R;
        d.x += b.radius * (Math.cos(a) - Math.cos(a0));
        d.y += b.radius * (Math.sin(a) - Math.sin(a0));
      },
    },
    spiral: {
      label: 'Espiral', group: 'Posição',
      defaults: { speed: 240, grow: 80, angle: 0 },
      params: [{ key: 'speed', label: 'Giro', min: -1440, max: 1440, step: 5, unit: '°/s' },
        { key: 'grow', label: 'Abre', min: -2000, max: 2000, step: 5, unit: 'px/s' },
        { key: 'angle', label: 'Ângulo inicial', min: -180, max: 180, step: 1, unit: '°' }],
      apply(b, t, d) {
        const a = (b.angle + b.speed * t) * D2R, r = b.grow * t;
        d.x += r * Math.cos(a); d.y += r * Math.sin(a);
      },
    },
    path: {
      label: 'Caminho (curva)', group: 'Posição',
      defaults: { c1x: 160, c1y: -200, c2x: 320, c2y: 200, ex: 480, ey: 0, time: 2, ease: 0, face: 0 },
      params: [
        { key: 'c1x', label: 'Controle 1 X', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'c1y', label: 'Controle 1 Y', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'c2x', label: 'Controle 2 X', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'c2y', label: 'Controle 2 Y', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'ex', label: 'Fim X', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'ey', label: 'Fim Y', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'time', label: 'Duração', min: 0.05, max: 120, step: 0.05, unit: 's' },
        { key: 'ease', label: 'Ritmo', type: 'select', options: [[0, 'Constante'], [1, 'Suave'], [2, 'Freia no fim']] },
        { key: 'face', label: 'Virar para o caminho', type: 'select', options: [[0, 'Não'], [1, 'Sim']] }],
      apply(b, t, d) {
        let p = clamp01(t / b.time);
        if (b.ease === 1) p = easeInOut(p); else if (b.ease === 2) p = easeOut3(p);
        const q = 1 - p, k0 = 3 * q * q * p, k1 = 3 * q * p * p, k2 = p * p * p;
        d.x += k0 * b.c1x + k1 * b.c2x + k2 * b.ex;
        d.y += k0 * b.c1y + k1 * b.c2y + k2 * b.ey;
        if (b.face) { // derivada da Bézier (início em 0,0)
          const tx = 3 * q * q * b.c1x + 6 * q * p * (b.c2x - b.c1x) + 3 * p * p * (b.ex - b.c2x);
          const ty = 3 * q * q * b.c1y + 6 * q * p * (b.c2y - b.c1y) + 3 * p * p * (b.ey - b.c2y);
          if (tx || ty) d.rot += Math.atan2(ty, tx) / D2R;
        }
      },
    },
    bounce: {
      label: 'Quicar nas bordas', group: 'Posição',
      defaults: { dir: 35, speed: 320, pad: 40 },
      params: [DIR,
        { key: 'speed', label: 'Velocidade', min: 0, max: 3000, step: 10, unit: 'px/s' },
        { key: 'pad', label: 'Distância da borda', min: 0, max: 360, step: 1, unit: 'px' }],
      apply(b, t, d, h) {
        const a = b.dir * D2R;
        const x = h.x + d.x + Math.cos(a) * b.speed * t, y = h.y + d.y + Math.sin(a) * b.speed * t;
        d.x = fold(x, b.pad, W - b.pad) - h.x;
        d.y = fold(y, b.pad, H - b.pad) - h.y;
      },
    },
    teleport: {
      label: 'Teletransporte', group: 'Posição',
      defaults: { dx: 320, dy: 0, every: 2 },
      params: [{ key: 'dx', label: 'Salto X', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'dy', label: 'Salto Y', min: -3000, max: 3000, step: 1, unit: 'px' },
        { key: 'every', label: 'A cada', min: 0.25, max: 64, step: 0.25, unit: 'bt' }],
      apply(b, t, d) {
        if (Math.floor(t / (b.every * BEAT)) % 2) { d.x += b.dx; d.y += b.dy; }
      },
    },
    shake: {
      label: 'Tremer', group: 'Posição',
      defaults: { amp: 6, freq: 18 },
      params: [{ key: 'amp', label: 'Força', min: 0, max: 200, step: 0.5, unit: 'px' },
        { key: 'freq', label: 'Rapidez', min: 1, max: 60, step: 1, unit: 'Hz' }],
      apply(b, t, d) {
        d.x += b.amp * Math.sin(TAU * b.freq * t);
        d.y += b.amp * Math.sin(TAU * b.freq * 1.37 * t + 1.3);
      },
    },
    spin: {
      label: 'Girar', group: 'Rotação',
      defaults: { speed: 90 },
      params: [{ key: 'speed', label: 'Velocidade', min: -2880, max: 2880, step: 5, unit: '°/s' }],
      apply(b, t, d) { d.rot += b.speed * t; },
    },
    pulse: {
      label: 'Pulsar na batida', group: 'Escala',
      defaults: { period: 1, amount: 20, shape: 0 },
      params: [{ key: 'period', label: 'A cada', min: 0.25, max: 16, step: 0.25, unit: 'bt' },
        { key: 'amount', label: 'Quanto cresce', min: -90, max: 300, step: 1, unit: '%' },
        { key: 'shape', label: 'Jeito', type: 'select', options: [[0, 'Batida'], [1, 'Suave']] }],
      // segue a batida da música (tempo da fase), não o início do comportamento
      apply(b, t, d, h, T) {
        const ph = ((((T - OFFSET) / (b.period * BEAT)) % 1) + 1) % 1;
        const k = b.shape ? 0.5 - 0.5 * Math.cos(ph * TAU) : Math.exp(-ph * 8);
        d.s *= Math.max(0.01, 1 + b.amount / 100 * k);
      },
    },
    scale: {
      label: 'Crescer / encolher', group: 'Escala',
      defaults: { from: 100, to: 200, time: 1 },
      params: [{ key: 'from', label: 'De', min: 0, max: 1000, step: 1, unit: '%' },
        { key: 'to', label: 'Para', min: 0, max: 1000, step: 1, unit: '%' },
        { key: 'time', label: 'Duração', min: 0.02, max: 120, step: 0.02, unit: 's' }],
      apply(b, t, d) {
        d.s *= Math.max(0.001, (b.from + (b.to - b.from) * easeInOut(clamp01(t / b.time))) / 100);
      },
    },
  };

  // novo comportamento com os valores padrão
  function newBehavior(type) {
    const def = PF.BEHAVIORS[type];
    return { type, on: 1, start: 0, end: 0, ...JSON.parse(JSON.stringify(def.defaults)) };
  }
  // limpa os comportamentos vindos de um JSON (máx. 12; números presos aos limites)
  const MAX_BEHAVIORS = 12;
  function normBehaviors(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
      if (out.length >= MAX_BEHAVIORS) break;
      const def = r && PF.BEHAVIORS[r.type];
      if (!def) continue;
      const b = { type: r.type, on: r.on === 0 || r.on === false ? 0 : 1 };
      for (const p of BEH_TIME) b[p.key] = normProp(r, p, 0);
      for (const p of def.params) b[p.key] = normProp(r, p, def.defaults[p.key]);
      out.push(b);
    }
    return out;
  }

  // ---------- gatilhos e ações (modo manual) ----------
  // Um gatilho diz QUANDO (ao aparecer, num tempo, na batida, na meia batida, quando um
  // comportamento termina, no fim) e uma ação diz O QUÊ (rajada, explodir, dividir, convergir,
  // espelhar, acelerar, transformar, sumir). Tudo é calculado antes, a partir do tempo: os
  // disparos viram uma lista de eventos com instante e pose fixos (shapeEvents), então a forma
  // continua sendo função pura do tempo (scrub, levelCheck e servidor funcionam igual).
  const TRG_SPAWN = 0, TRG_TIME = 1, TRG_BEAT = 2, TRG_HALF = 3, TRG_KEY = 4, TRG_END = 5, TRG_NEAR = 6, TRG_TOUCH = 7;
  // Reativos (perto do jogador / encostar no jogador) dependem de onde o jogador está:
  // no modo teste disparam de verdade (REACT, preenchido pelo main.js); no editor a prévia
  // imagina o jogador parado no início da fase; o levelCheck e o servidor os ignoram.
  const isReactive = t => t.when === TRG_NEAR || t.when === TRG_TOUCH;
  let REACT = null, SPAWN = { x: W / 2, y: H / 2 };
  const MAX_TRIGGERS = 8, MAX_FIRES = 64, MAX_CHILDREN = 1500;
  const TRG_WHEN = [
    { key: 'when', label: 'Quando', type: 'select', options: [
      [TRG_SPAWN, 'Ao aparecer (On Spawn)'], [TRG_TIME, 'Num tempo (On Time)'], [TRG_BEAT, 'Na batida (On Beat)'],
      [TRG_HALF, 'Na meia batida (On Half Beat)'], [TRG_KEY, 'Fim de comportamento (On Keyframe)'], [TRG_END, 'No fim (On End)'],
      [TRG_NEAR, 'Jogador perto (On Proximity)'], [TRG_TOUCH, 'Encostar no jogador (On Collision)']] },
    { key: 'at', label: 'Tempo (depois de ativa)', min: 0, max: 600, step: 0.05, unit: 's', show: [TRG_TIME] },
    { key: 'every', label: 'A cada', min: 0.25, max: 64, step: 0.25, unit: 'bt', show: [TRG_BEAT] },
    { key: 'from', label: 'A partir de', min: 0, max: 600, step: 0.05, unit: 's', show: [TRG_BEAT, TRG_HALF] },
    { key: 'times', label: 'Quantas vezes (0 = até o fim)', min: 0, max: MAX_FIRES, step: 1, unit: '', show: [TRG_BEAT, TRG_HALF] },
    { key: 'beh', label: 'Comportamento nº', min: 1, max: 12, step: 1, unit: '', show: [TRG_KEY] },
    { key: 'dist', label: 'Distância', min: 10, max: 1500, step: 5, unit: 'px', show: [TRG_NEAR] },
  ];
  const TRG_LEAD = { key: 'lead', label: 'Aviso antes', min: 0, max: 4, step: 0.05, unit: 's' };
  const SHOT = [ // parâmetros dos tiros (rajada/explodir)
    { key: 'count', label: 'Quantidade', min: 1, max: 48, step: 1, unit: '' },
    { key: 'angle', label: 'Ângulo (0 = →)', min: -180, max: 180, step: 1, unit: '°' },
    { key: 'spread', label: 'Abertura (360 = em volta)', min: 0, max: 360, step: 5, unit: '°' },
    { key: 'speed', label: 'Velocidade', min: 20, max: 3000, step: 10, unit: 'px/s' },
    { key: 'size', label: 'Tamanho', min: 2, max: 200, step: 1, unit: 'px' },
    { key: 'life', label: 'Duração', min: 0.1, max: 20, step: 0.1, unit: 's' },
    { key: 'aim', label: 'Direção', type: 'select', options: [[0, 'Fixa'], [1, 'Gira com a forma']] },
  ];
  const SHAPE_KINDS = [[0, 'Círculo'], [1, 'Quadrado'], [2, 'Triângulo'], [3, 'Laser']];

  PF.TRIGGER_ACTIONS = {
    burst: { label: 'Rajada (Burst)', children: true, params: SHOT,
      defaults: { count: 8, angle: 0, spread: 360, speed: 360, size: 12, life: 3, aim: 0 } },
    explode: { label: 'Explodir (Explode)', children: true, hides: true, params: SHOT,
      defaults: { count: 14, angle: 0, spread: 360, speed: 420, size: 10, life: 3, aim: 0 } },
    split: { label: 'Dividir (Split)', children: true, hides: true, params: [
      { key: 'count', label: 'Cópias', min: 2, max: 16, step: 1, unit: '' },
      { key: 'angle', label: 'Ângulo (0 = →)', min: -180, max: 180, step: 1, unit: '°' },
      { key: 'speed', label: 'Velocidade', min: 0, max: 3000, step: 10, unit: 'px/s' },
      { key: 'size', label: 'Tamanho das cópias', min: 5, max: 200, step: 1, unit: '%' },
      { key: 'spin', label: 'Giro das cópias', min: -1440, max: 1440, step: 5, unit: '°/s' },
      { key: 'life', label: 'Duração', min: 0.1, max: 20, step: 0.1, unit: 's' }],
      defaults: { count: 4, angle: 45, speed: 260, size: 50, spin: 180, life: 2.5 } },
    converge: { label: 'Convergir (Converge)', children: true, params: [
      { key: 'count', label: 'Quantidade', min: 1, max: 48, step: 1, unit: '' },
      { key: 'radius', label: 'De que distância', min: 20, max: 2000, step: 5, unit: 'px' },
      { key: 'time', label: 'Tempo até o centro', min: 0.05, max: 10, step: 0.05, unit: 's' },
      { key: 'size', label: 'Tamanho', min: 2, max: 200, step: 1, unit: 'px' }],
      defaults: { count: 12, radius: 280, time: 0.9, size: 10 } },
    mirror: { label: 'Espelhar (Mirror)', children: true, params: [
      { key: 'axis', label: 'Espelho', type: 'select', options: [[0, 'Esquerda ↔ direita'], [1, 'Cima ↔ baixo'], [2, 'Pelo centro']] }],
      defaults: { axis: 0 } },
    accel: { label: 'Acelerar (Accelerate)', params: [
      { key: 'mult', label: 'Velocidade nova', min: 0, max: 10, step: 0.05, unit: '×' },
      { key: 'ramp', label: 'Em quanto tempo', min: 0, max: 10, step: 0.05, unit: 's' }],
      defaults: { mult: 2.5, ramp: 0.3 } },
    transform: { label: 'Transformar (Transform)', params: [
      { key: 'kind', label: 'Vira', type: 'select', options: SHAPE_KINDS },
      { key: 'size', label: 'Tamanho', min: 5, max: 500, step: 1, unit: '%' }],
      defaults: { kind: 0, size: 100 } },
    despawn: { label: 'Sumir', hides: true, params: [], defaults: {} },
  };

  function newTrigger(action = 'burst') {
    const def = PF.TRIGGER_ACTIONS[action];
    return { on: 1, when: TRG_BEAT, at: 0, every: 1, from: 0, times: 4, beh: 1, dist: 180, lead: 0.4, action,
      ...JSON.parse(JSON.stringify(def.defaults)) };
  }
  function normTriggers(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const r of raw) {
      if (out.length >= MAX_TRIGGERS) break;
      const def = r && PF.TRIGGER_ACTIONS[r.action];
      if (!def) continue;
      const base = newTrigger(r.action);
      const t = { on: r.on === 0 || r.on === false ? 0 : 1, action: r.action };
      for (const p of TRG_WHEN) t[p.key] = normProp(r, p, base[p.key]);
      t.lead = normProp(r, TRG_LEAD, base.lead);
      for (const p of def.params) t[p.key] = normProp(r, p, def.defaults[p.key]);
      out.push(t);
    }
    return out;
  }

  // instantes (s depois de ativa) em que o gatilho dispara
  function triggerTimes(h, t, ti) {
    const A = h.active;
    if (isReactive(t)) {
      if (inGroup) return []; // dentro de grupo: sem disparo reativo
      if (REACT) { const v = REACT.get(h.id + ':' + ti); return v != null && v <= A ? [v] : []; }
      if (!PF.hz.preview) return [];
      // prévia no editor: primeiro instante em que o jogador parado no início seria alcançado
      const pr = PF.PLAYER ? PF.PLAYER.r : 8;
      for (let bt = 0; bt <= A; bt += 1 / 30) {
        const p = shapePose(h, bt);
        if (t.when === TRG_NEAR ? Math.hypot(p.x - SPAWN.x, p.y - SPAWN.y) < t.dist
          : parentShapesAt(h, p).some(s => PF.hz.hitsPlayer(s, SPAWN.x, SPAWN.y, pr))) return [Math.min(A, bt + t.lead)];
      }
      return [];
    }
    if (t.when === TRG_SPAWN) return [0];
    if (t.when === TRG_TIME) return t.at <= A ? [t.at] : [];
    if (t.when === TRG_END) return [A];
    if (t.when === TRG_KEY) {
      const b = h.behaviors[t.beh - 1];
      if (!b) return [];
      let e = b.end > b.start ? b.end : (b.time ? b.start + b.time : -1); // investida/caminho/crescer têm duração
      return e >= 0 && e <= A ? [e] : [];
    }
    // batida / meia batida: na grade da música (tempo da fase), não a partir do começo da forma
    const step = (t.when === TRG_HALF ? 0.5 : t.every) * BEAT;
    const act = h.time + h.warn, T0 = act + t.from;
    let k = Math.ceil((T0 - OFFSET) / step - 1e-6);
    const out = [], max = t.times > 0 ? t.times : MAX_FIRES;
    for (; out.length < max; k++) {
      const at = OFFSET + k * step - act;
      if (at > A + 1e-6) break;
      out.push(Math.max(0, at));
    }
    return out;
  }

  // a forma acelera: o relógio dos comportamentos anda "mult" vezes mais rápido depois do evento
  function warpTime(ev, bt) {
    let w = bt;
    for (const a of ev.accels) {
      const d = bt - a.at;
      if (d <= 0) continue;
      const m = a.t.mult - 1, r = a.t.ramp;
      w += r > 0 && d < r ? m * d * d / (2 * r) : m * (d - r / 2);
    }
    return w;
  }

  // Eventos da forma: lista ordenada com instante e pose; quando ela some; acelerações;
  // transformações; espelhos; e até quando vão os filhos (para o tamanho do bloco).
  const evCache = new WeakMap();
  function shapeEvents(h) {
    let sig = JSON.stringify(h) + '|' + BEAT + '|' + OFFSET;
    if ((h.triggers || []).some(isReactive)) { // disparos reativos mudam os eventos
      sig += inGroup ? '|G' : REACT ? '|R' + (h.triggers || []).map((t, i) => REACT.get(h.id + ':' + i)).join(',')
        : PF.hz.preview ? '|P' + SPAWN.x + ',' + SPAWN.y : '|-';
    }
    const c = evCache.get(h);
    if (c && c.sig === sig) return c.ev;
    const raw = [];
    (h.triggers || []).forEach((t, ti) => {
      if (!t.on || !PF.TRIGGER_ACTIONS[t.action]) return;
      for (const at of triggerTimes(h, t, ti)) raw.push({ t, at });
    });
    raw.sort((a, b) => a.at - b.at);
    let hideAt = Infinity;
    for (const e of raw) if (PF.TRIGGER_ACTIONS[e.t.action].hides) { hideAt = e.at; break; }
    const ev = { list: [], accels: [], transforms: [], mirrors: [], hideAt, maxEnd: 0 };
    let children = 0, kind = h.kind, ks = 1;
    for (const e of raw) {
      if (e.at > hideAt) break;
      const a = e.t.action;
      if (a === 'accel') ev.accels.push(e);
      if (a === 'transform') { kind = e.t.kind; ks = e.t.size / 100; ev.transforms.push(e); }
      const n = a === 'burst' || a === 'explode' || a === 'converge' || a === 'split' ? e.t.count : 0;
      if (children + n > MAX_CHILDREN) continue; // limite de segurança
      children += n;
      const p = shapePose(h, warpTime(ev, e.at), h.time + h.warn + e.at);
      Object.assign(e, { x: p.x, y: p.y, rot: p.rot, s: p.s, kind, ks });
      if (a === 'mirror') ev.mirrors.push(e);
      const end = a === 'converge' ? e.at + e.t.time : e.t.life ? e.at + e.t.life : e.at;
      ev.maxEnd = Math.max(ev.maxEnd, end);
      ev.list.push(e);
    }
    evCache.set(h, { sig, ev });
    return ev;
  }

  const MIRROR = [[-1, 0, 0, 1, W, 0], [1, 0, 0, -1, 0, H], [-1, 0, 0, -1, W, H]];
  const shotAngle = (t, i, rot) => {
    const base = t.angle + (t.aim ? rot : 0);
    if (t.spread >= 360) return (base + 360 * i / t.count) * D2R;
    return (t.count > 1 ? base - t.spread / 2 + t.spread * i / (t.count - 1) : base) * D2R;
  };

  // filhos de um evento (tiros, cópias, bolinhas que convergem) e o aviso antes dele
  function emitChildren(h, e, bt, out) {
    const t = e.t, a = t.action, dt = bt - e.at;
    if (dt < 0) {
      if (dt < -t.lead || !t.lead) return;
      const pr = 1 + dt / t.lead, al = 0.08 + 0.35 * pr;
      if (a === 'burst' || a === 'explode' || a === 'split') { // linhas de mira
        const n = a === 'split' ? t.count : t.count;
        const len = Math.min(170, (t.speed || 200) * 0.45);
        for (let i = 0; i < n; i++) {
          const g = a === 'split' ? (t.angle + 360 * i / t.count) * D2R : shotAngle(t, i, e.rot);
          out.push({ kind: 'line', x1: e.x, y1: e.y, x2: e.x + Math.cos(g) * len, y2: e.y + Math.sin(g) * len, w: 3, state: 'warn', alpha: al });
        }
      } else if (a === 'converge') {
        out.push({ kind: 'ring', x: e.x, y: e.y, r: t.radius, w: 3, state: 'warn', alpha: al });
        for (let i = 0; i < t.count; i++) {
          const g = TAU * i / t.count;
          out.push({ kind: 'circle', x: e.x + Math.cos(g) * t.radius, y: e.y + Math.sin(g) * t.radius, r: t.size, state: 'warn', alpha: al });
        }
      }
      return;
    }
    if (a === 'burst' || a === 'explode') {
      if (dt > t.life) return;
      for (let i = 0; i < t.count; i++) {
        const g = shotAngle(t, i, e.rot), x = e.x + Math.cos(g) * t.speed * dt, y = e.y + Math.sin(g) * t.speed * dt;
        if (!off(x, y, t.size)) out.push({ kind: 'circle', x, y, r: t.size, state: 'active', alpha: 1 });
      }
    } else if (a === 'split') {
      if (dt > t.life) return;
      const fade = dt > t.life - 0.2 ? (t.life - dt) / 0.2 : 1;
      for (let i = 0; i < t.count; i++) {
        const g = (t.angle + 360 * i / t.count) * D2R;
        const pose = { x: e.x + Math.cos(g) * t.speed * dt, y: e.y + Math.sin(g) * t.speed * dt,
          rot: e.rot + t.spin * dt, s: e.s * t.size / 100, ks: e.ks, kind: e.kind };
        if (!off(pose.x, pose.y, Math.max(h.w, h.h) * pose.s)) shapeOut(h, 1, { state: fade < 1 ? 'fx' : 'active', alpha: fade }, out, pose);
      }
    } else if (a === 'converge') {
      if (dt > t.time) return;
      const r = t.radius * (1 - dt / t.time);
      for (let i = 0; i < t.count; i++) {
        const g = TAU * i / t.count;
        out.push({ kind: 'circle', x: e.x + Math.cos(g) * r, y: e.y + Math.sin(g) * r, r: t.size, state: 'active', alpha: 1 });
      }
    }
  }

  // ---------- Forma (modo manual) ----------
  // Círculo, quadrado, triângulo ou laser com rotação e ponto de pivô. (x, y) é onde fica o pivô;
  // pivotX/pivotY é o pivô em relação ao centro da forma, antes de girar. Os comportamentos
  // contam o tempo a partir de quando a forma fica ativa; no aviso ela fica na pose inicial.
  const SHP_CIRCLE = 0, SHP_SQUARE = 1, SHP_TRI = 2, SHP_LASER = 3;
  // pose (posição do pivô, rotação e escala) no tempo bt desde que ficou ativa; T = tempo da fase
  function shapePose(h, bt, T) {
    const d = { x: 0, y: 0, rot: 0, s: 1 };
    const list = h.behaviors;
    if (list) {
      for (const b of list) {
        if (!b.on || bt < b.start) continue;
        const def = PF.BEHAVIORS[b.type];
        if (!def) continue;
        const t = (b.end > b.start ? Math.min(bt, b.end) : bt) - b.start;
        def.apply(b, t, d, h, T == null ? h.time + h.warn + bt : T);
      }
    }
    return { x: h.x + d.x, y: h.y + d.y, rot: h.rot + d.rot, s: d.s };
  }
  const REST = h => ({ x: h.x, y: h.y, rot: h.rot, s: 1 });
  // pre: matriz aplicada depois (ex.: espelho)
  const shapeMatrix = (h, k = 1, pose = REST(h), pre) => {
    const sk = k * pose.s * (pose.ks || 1);
    const m = PF.m.compose(pose.x, pose.y, pose.rot, sk, sk, h.pivotX, h.pivotY);
    return pre ? PF.m.mul(pre, m) : m;
  };
  // contorno da forma em coords locais (centro em 0,0), como lista x,y,x,y…
  function shapeLocal(h, kind = h.kind) {
    const w2 = h.w / 2, h2 = h.h / 2;
    if (kind === SHP_SQUARE) return [-w2, -h2, w2, -h2, w2, h2, -w2, h2];
    if (kind === SHP_TRI) return [0, -h2, w2, h2, -w2, h2];
    const n = 32, pts = []; // elipse
    for (let i = 0; i < n; i++) { const a = TAU * i / n; pts.push(Math.cos(a) * w2, Math.sin(a) * h2); }
    return pts;
  }
  // formas prontas para desenhar/colidir, com escala extra k (o "pop" ao aparecer)
  function shapeOut(h, k, base, out, pose, pre) {
    const m = shapeMatrix(h, k, pose, pre);
    const kind = pose && pose.kind != null ? pose.kind : h.kind;
    const sk = k * (pose ? pose.s * (pose.ks || 1) : 1);
    if (kind === SHP_LASER) {
      const [x1, y1] = PF.m.apply(m, -h.w / 2, 0), [x2, y2] = PF.m.apply(m, h.w / 2, 0);
      out.push({ ...base, kind: 'line', x1, y1, x2, y2, w: h.h * sk });
      return;
    }
    if (kind === SHP_CIRCLE && h.w === h.h) { // círculo de verdade: mais barato que o polígono
      const [x, y] = PF.m.apply(m, 0, 0), r = h.w / 2 * sk;
      if (h.hollow) out.push({ ...base, kind: 'ring', x, y, r, w: Math.min(h.stroke, h.w) * sk });
      else out.push({ ...base, kind: 'circle', x, y, r });
      return;
    }
    const loc = shapeLocal(h, kind), pts = [];
    for (let i = 0; i < loc.length; i += 2) pts.push(...PF.m.apply(m, loc[i], loc[i + 1]));
    if (!h.hollow) { out.push({ ...base, kind: 'poly', pts }); return; }
    const n = pts.length / 2; // vazada: uma linha por lado, centrada no contorno
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      out.push({ ...base, kind: 'line', x1: pts[i * 2], y1: pts[i * 2 + 1], x2: pts[j * 2], y2: pts[j * 2 + 1], w: h.stroke * sk });
    }
  }
  // formas ativas da própria forma numa pose (para "encostar no jogador")
  function parentShapesAt(h, pose) {
    const tmp = [];
    shapeOut(h, 1, { state: 'active', alpha: 1 }, tmp, pose);
    return tmp;
  }
  // pose da forma no tempo bt, com aceleração e transformação aplicadas
  function livePose(h, ev, bt) {
    const p = shapePose(h, warpTime(ev, bt), h.time + h.warn + bt);
    let tr = null;
    for (const e of ev.transforms) if (e.at <= bt) tr = e;
    if (tr) { p.kind = tr.kind; p.ks = tr.ks; p.trAt = tr.at; }
    return p;
  }

  PF.HAZARDS.shape = {
    label: 'Forma',
    desc: 'Forma livre: círculo, quadrado, triângulo ou laser, do tamanho e no ângulo que você quiser. Ela gira em volta do ponto de pivô (o losango verde). No mapa: arraste para mover, a bolinha de cima gira (Shift: de 15 em 15°), o quadradinho do canto muda o tamanho (Shift: proporcional) e Alt+arrastar muda o pivô sem mexer na forma. Em "Comportamentos" você empilha movimentos (mover, onda, órbita, caminho, pulsar…): eles começam quando a forma fica ativa e são aplicados de cima para baixo. Em "Gatilhos" você escolhe quando (na batida, num tempo…) ela faz uma ação (rajada, explodir, dividir…); os losangos no bloco da timeline mostram os disparos.',
    defaults: { kind: SHP_SQUARE, w: 120, h: 120, rot: 0, pivotX: 0, pivotY: 0, hollow: 0, stroke: 16, warn: 0.6, active: 1, behaviors: [], triggers: [] },
    props: [
      { key: 'kind', label: 'Forma', type: 'select', options: SHAPE_KINDS },
      { key: 'w', label: 'Largura (laser: comprimento)', min: 4, max: 3000, step: 1, unit: 'px' },
      { key: 'h', label: 'Altura (laser: grossura)', min: 2, max: 3000, step: 1, unit: 'px' },
      { key: 'rot', label: 'Rotação', min: -360, max: 360, step: 1, unit: '°' },
      { key: 'pivotX', label: 'Pivô X (do centro)', min: -1500, max: 1500, step: 1, unit: 'px' },
      { key: 'pivotY', label: 'Pivô Y (do centro)', min: -1500, max: 1500, step: 1, unit: 'px' },
      { key: 'hollow', label: 'Preenchimento', type: 'select', options: [[0, 'Cheia'], [1, 'Vazada']] },
      { key: 'stroke', label: 'Grossura do contorno (vazada)', min: 2, max: 200, step: 1, unit: 'px' },
      WARN_PROP,
      { key: 'active', label: 'Tempo ativa', min: 0.05, max: 120, step: 0.05, unit: 's' },
    ],
    extra(raw, h) { h.behaviors = normBehaviors(raw.behaviors); h.triggers = normTriggers(raw.triggers); },
    lead: () => 0,
    warnLen: h => h.warn,
    length: h => h.warn + Math.max(h.active, shapeEvents(h).maxEnd) + FADE,
    shapes(h, lt, out) {
      if (lt < 0) return;
      const ev = shapeEvents(h);
      const bt = lt - h.warn;
      const btc = Math.max(0, Math.min(bt, h.active)); // no aviso fica na pose inicial; no sumiço, onde parou
      if (bt < ev.hideAt) {
        const pose = livePose(h, ev, btc);
        const tp = pose.trAt != null && btc - pose.trAt < 0.12 ? 1 + 0.35 * (1 - (btc - pose.trAt) / 0.12) : 1; // "pop" ao transformar
        appearCycle(h, lt, out, ({ state, alpha, scale }) => {
          shapeOut(h, scale * tp, { state, alpha }, out, pose);
          for (const m of ev.mirrors) { // cópia espelhada (em aviso antes do evento)
            const d = btc - m.at;
            if (d >= 0) shapeOut(h, scale * tp, { state, alpha }, out, pose, MIRROR[m.t.axis]);
            else if (m.t.lead && d > -m.t.lead) shapeOut(h, 1, { state: 'warn', alpha: 0.08 + 0.35 * (1 + d / m.t.lead) }, out, pose, MIRROR[m.t.axis]);
          }
        });
      } else if (bt - ev.hideAt < 0.18) { // some com um brilho que cresce
        const f = (bt - ev.hideAt) / 0.18, pose = livePose(h, ev, ev.hideAt);
        shapeOut(h, 1 + f * 0.6, { state: 'fx', alpha: 1 - f }, out, pose);
      }
      for (const e of ev.list) if (PF.TRIGGER_ACTIONS[e.t.action].children && e.t.action !== 'mirror') emitChildren(h, e, bt, out);
    },
    hit(h, x, y, tol) {
      const test = pose => {
        const tmp = [];
        shapeOut(h, 1, { state: 'active', alpha: 1 }, tmp, pose);
        return tmp.some(s => PF.hz.hitsPlayer(s, x, y, tol));
      };
      if (test(REST(h)) || Math.hypot(x - h.x, y - h.y) <= tol * 1.5) return true;
      // também onde ela está agora (no editor), se estiver na tela
      const T = PF.app ? PF.app.t : null, lt = T == null ? -1 : T - h.time;
      if (lt < 0 || lt > h.warn + h.active) return false;
      const ev = shapeEvents(h), bt = Math.max(0, lt - h.warn);
      return bt < ev.hideAt && test(livePose(h, ev, bt));
    },
  };

  // ---------- Grupo (modo manual) ----------
  // Guarda formas (ou outros grupos) dentro dele, em coordenadas relativas ao pivô do grupo
  // (x, y) e com tempo relativo ao começo do grupo. O grupo tem rotação, escala e a mesma pilha
  // de comportamentos da Forma, aplicadas em volta do pivô (pivô coletivo), e um repetidor que
  // copia os itens: radial (mandala), em grade ou em espiral, com atraso entre as cópias.
  // A saída continua sendo circle/ring/line/rect/poly: colisão, levelCheck e servidor não mudam.
  const MAX_ITEMS = 32, MAX_DEPTH = 3, MAX_INSTANCES = 256;
  const REP_NONE = 0, REP_RADIAL = 1, REP_GRID = 2, REP_SPIRAL = 3;
  let inGroup = 0; // > 0 enquanto avalia itens de grupo (gatilhos reativos não valem lá dentro)
  const repCount = g => (g.repeat ? Math.max(1, g.count) : 1);
  // matriz da cópia i em coords do grupo (gira/escala em volta do pivô, que é a origem)
  function repMatrix(g, i) {
    if (!g.repeat || i === 0) return null;
    if (g.repeat === REP_RADIAL) return PF.m.compose(0, 0, g.angle * i, 1, 1, 0, 0);
    if (g.repeat === REP_GRID) return [1, 0, 0, 1, (i % g.cols) * g.dx, Math.floor(i / g.cols) * g.dy];
    const k = Math.max(0.02, 1 + g.grow / 100 * i);
    return PF.m.compose(0, 0, g.angle * i, k, k, 0, 0);
  }
  // matriz do grupo (coords locais → mundo) numa pose
  const groupMatrix = (g, p) => {
    const s = g.scale / 100 * (p ? p.s : 1);
    return PF.m.compose(p ? p.x : g.x, p ? p.y : g.y, p ? p.rot : g.rot, s, s, 0, 0);
  };
  const groupPose = (g, lt) => { const t = Math.max(0, lt); return shapePose(g, t, g.time + t); };
  // matrizes de todas as cópias (pose do grupo opcional; sem ela, pose de repouso)
  function copyMatrices(g, pose) {
    const G = groupMatrix(g, pose), out = [];
    for (let i = 0, n = repCount(g); i < n; i++) { const R = repMatrix(g, i); out.push(R ? PF.m.mul(G, R) : G); }
    return out;
  }
  // leva uma forma de saída das coords do grupo para o mundo (escala uniforme k, giro rr em rad)
  function xform(s, M, k, rr) {
    const o = { ...s };
    if (s.kind === 'line') {
      [o.x1, o.y1] = PF.m.apply(M, s.x1, s.y1);
      [o.x2, o.y2] = PF.m.apply(M, s.x2, s.y2);
      o.w = s.w * k;
    } else if (s.kind === 'poly') {
      const p = s.pts, q = new Array(p.length);
      for (let i = 0; i < p.length; i += 2) { const [x, y] = PF.m.apply(M, p[i], p[i + 1]); q[i] = x; q[i + 1] = y; }
      o.pts = q;
    } else {
      [o.x, o.y] = PF.m.apply(M, s.x, s.y);
      if (s.kind === 'circle') o.r = s.r * k;
      else if (s.kind === 'ring') { o.r = s.r * k; o.w = s.w * k; }
      else if (s.kind === 'rect') { o.w = s.w * k; o.h = s.h * k; o.rot = (s.rot || 0) + rr; }
    }
    return o;
  }
  const itemLen = it => { const d = PF.HAZARDS[it.type]; return it.time + d.length(it); };

  PF.HAZARDS.group = {
    label: 'Grupo',
    desc: 'Grupo de formas com um pivô só (o losango): girar, escalar e os comportamentos do grupo acontecem em volta dele. O repetidor copia os itens em volta do pivô (radial = mandala), em grade ou em espiral, com atraso em batidas entre as cópias. No mapa: arraste para mover, a bolinha gira o grupo, Alt+arrastar muda o pivô sem mexer nas formas. Os itens são editados aqui no painel; "Desagrupar" (Ctrl+Shift+G) solta as formas no mapa.',
    defaults: { rot: 0, scale: 100, repeat: REP_NONE, count: 6, angle: 60, delay: 0, cols: 3, dx: 140, dy: 140, grow: 12, items: [], behaviors: [] },
    props: [
      { key: 'rot', label: 'Rotação', min: -360, max: 360, step: 1, unit: '°' },
      { key: 'scale', label: 'Escala', min: 5, max: 500, step: 1, unit: '%' },
      { key: 'repeat', label: 'Repetir', type: 'select', rebuild: true,
        options: [[REP_NONE, 'Sem repetir'], [REP_RADIAL, 'Radial (mandala)'], [REP_GRID, 'Em grade'], [REP_SPIRAL, 'Em espiral']] },
      { key: 'count', label: 'Cópias', min: 1, max: 64, step: 1, unit: '', show: g => g.repeat },
      { key: 'angle', label: 'Ângulo entre cópias', min: -360, max: 360, step: 1, unit: '°', show: g => g.repeat === REP_RADIAL || g.repeat === REP_SPIRAL },
      { key: 'grow', label: 'Cresce por cópia', min: -50, max: 200, step: 1, unit: '%', show: g => g.repeat === REP_SPIRAL },
      { key: 'cols', label: 'Colunas', min: 1, max: 16, step: 1, unit: '', show: g => g.repeat === REP_GRID },
      { key: 'dx', label: 'Espaço X', min: -1500, max: 1500, step: 1, unit: 'px', show: g => g.repeat === REP_GRID },
      { key: 'dy', label: 'Espaço Y', min: -1500, max: 1500, step: 1, unit: 'px', show: g => g.repeat === REP_GRID },
      { key: 'delay', label: 'Atraso entre cópias', min: 0, max: 16, step: 0.125, unit: 'bt', show: g => g.repeat },
    ],
    extra(raw, h, depth) {
      h.behaviors = normBehaviors(raw.behaviors);
      h.items = [];
      if (Array.isArray(raw.items) && depth < MAX_DEPTH) {
        for (const r of raw.items) {
          if (h.items.length >= MAX_ITEMS) break;
          if (!r || (r.type !== 'shape' && !(r.type === 'group' && depth + 1 < MAX_DEPTH))) continue;
          const n = PF.hz.normalize(r, depth + 1);
          if (!n) continue;
          const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
          n.x = u.clamp(num(r.x, 0), -3000, 3000); // coords relativas ao pivô do grupo
          n.y = u.clamp(num(r.y, 0), -3000, 3000);
          n.time = u.clamp(num(r.time, 0), 0, 600);
          n.id = h.items.length + 1;
          h.items.push(n);
        }
      }
      // limite de cópias × itens (mandalas grandes ainda cabem; o servidor não engasga)
      const per = Math.max(1, countInstances(h) / repCount(h));
      if (h.repeat && repCount(h) * per > MAX_INSTANCES) h.count = Math.max(1, Math.floor(MAX_INSTANCES / per));
    },
    lead: () => 0,
    warnLen: () => 0,
    length(g) {
      let m = 0;
      inGroup++;
      try { for (const it of g.items) m = Math.max(m, itemLen(it)); } finally { inGroup--; }
      return m + (repCount(g) - 1) * g.delay * BEAT;
    },
    shapes(g, lt, out) {
      if (lt < 0 || !g.items.length) return;
      const Ms = copyMatrices(g, groupPose(g, lt)), delay = g.delay * BEAT;
      inGroup++;
      try {
        Ms.forEach((M, i) => {
          const k = Math.hypot(M[0], M[1]), rr = Math.atan2(M[1], M[0]), lti = lt - i * delay;
          for (const it of g.items) {
            const d = PF.HAZARDS[it.type], l = lti - it.time;
            if (l < -d.lead(it) || l > d.length(it)) continue;
            const tmp = [];
            d.shapes(it, l, tmp);
            for (const s of tmp) out.push(xform(s, M, k, rr));
          }
        });
      } finally { inGroup--; }
    },
    // clique: o ponto volta para as coords de cada cópia e testa nos itens em repouso
    hit(g, x, y, tol) {
      if (Math.hypot(x - g.x, y - g.y) <= tol * 1.5) return true;
      for (const M of copyMatrices(g)) {
        const k = Math.hypot(M[0], M[1]) || 1;
        const [lx, ly] = PF.m.apply(PF.m.invert(M), x, y);
        for (const it of g.items) if (PF.HAZARDS[it.type].hit(it, lx, ly, tol / k)) return true;
      }
      return false;
    },
  };
  // quantas formas o grupo desenha (cópias × itens, contando grupos dentro)
  function countInstances(g) {
    let n = 0;
    for (const it of g.items || []) n += it.type === 'group' ? countInstances(it) : 1;
    return n * repCount(g);
  }

  // Contornos dos itens em repouso, no mundo (para o gizmo): lista de { pts, copy }
  function groupOutlines(g, M0, out = [], copyBase = 0) {
    copyMatrices(g).forEach((Mg, i) => {
      const M = M0 ? PF.m.mul(M0, Mg) : Mg;
      for (const it of g.items) {
        if (it.type === 'group') { groupOutlines(it, M, out, copyBase + i); continue; }
        const m = PF.m.mul(M, shapeMatrix(it));
        const loc = it.kind === SHP_LASER ? [-it.w / 2, -it.h / 2, it.w / 2, -it.h / 2, it.w / 2, it.h / 2, -it.w / 2, it.h / 2] : shapeLocal(it);
        const pts = [];
        for (let j = 0; j < loc.length; j += 2) pts.push(...PF.m.apply(m, loc[j], loc[j + 1]));
        out.push({ pts, copy: copyBase + i });
      }
    });
    return out;
  }

  // Junta formas/grupos soltos num grupo: pivô no centro deles, tempo do mais cedo.
  function makeGroup(list) {
    const ok = list.filter(h => h.type === 'shape' || h.type === 'group');
    if (!ok.length) return null;
    let cx = 0, cy = 0, t0 = Infinity;
    for (const h of ok) { cx += h.x; cy += h.y; t0 = Math.min(t0, h.time); }
    cx = Math.round(cx / ok.length); cy = Math.round(cy / ok.length);
    const g = PF.hz.create('group', cx, cy, t0);
    g.items = ok.map((h, i) => ({ ...JSON.parse(JSON.stringify(h)), id: i + 1, x: h.x - cx, y: h.y - cy, time: u.round(h.time - t0, 4) }));
    return g;
  }
  // Solta os itens do grupo no mapa (cada cópia do repetidor vira peças separadas). Os
  // comportamentos do grupo não têm como ir para as peças: ficam de fora.
  function ungroup(g) {
    const out = [], delay = g.delay * BEAT;
    copyMatrices(g).forEach((M, i) => {
      const k = Math.hypot(M[0], M[1]), deg = Math.atan2(M[1], M[0]) / D2R;
      for (const it of g.items) {
        const c = JSON.parse(JSON.stringify(it));
        [c.x, c.y] = PF.m.apply(M, it.x, it.y);
        c.x = u.round(c.x, 2); c.y = u.round(c.y, 2);
        c.rot = u.round(((it.rot + deg + 540) % 360) - 180, 2);
        if (c.type === 'shape') {
          c.w = u.clamp(it.w * k, 4, 3000); c.h = u.clamp(it.h * k, 2, 3000); c.stroke = u.clamp(it.stroke * k, 2, 200);
          c.pivotX = it.pivotX * k; c.pivotY = it.pivotY * k;
        } else c.scale = u.clamp(it.scale * k, 5, 500);
        c.time = u.round(g.time + it.time + i * delay, 4);
        out.push(c);
      }
    });
    return out;
  }

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

  // um valor numérico/select vindo de JSON, preso aos limites do prop (ou o padrão)
  function normProp(raw, p, dflt) {
    const v = Number(raw[p.key]);
    if (p.type === 'select') return p.options.some(o => o[0] === v) ? v : dflt;
    return Number.isFinite(v) ? u.clamp(v, p.min, p.max) : dflt;
  }

  let seq = 1;

  PF.hz = {
    lineEnds,
    doubleBox,
    spikePts,
    shapeMatrix,
    shapeLocal,
    shapePose,
    newBehavior,
    MAX_BEHAVIORS,
    shapeEvents,
    groupOutlines,
    MAX_ITEMS,
    makeGroup,
    ungroup,
    copyMatrices,
    countInstances,
    // pose com aceleração/transformação (como aparece no jogo) e até quando a forma existe
    livePose: (h, bt) => livePose(h, shapeEvents(h), bt),
    shapeEnd: h => Math.min(h.active, shapeEvents(h).hideAt),
    newTrigger,
    MAX_TRIGGERS,
    TRG_WHEN,
    TRG_LEAD,
    BEH_TIME,
    // batida da fase usada pelos comportamentos (sem BPM: 0,5 s)
    preview: false, // o editor liga: prévia dos gatilhos reativos com o jogador no início
    // modo teste: mapa "id:índice do gatilho" -> instante do disparo (null = fora do teste)
    setReactive(map) { REACT = map; },
    getReactive: () => REACT,
    isReactive,
    parentShapesAt,
    setBeat(level) {
      if (level && level.spawn) SPAWN = level.spawn;
      BEAT = level && level.bpm > 0 ? 60 / level.bpm : 0.5;
      OFFSET = level && level.bpm > 0 ? level.offset || 0 : 0;
    },
    curvePos,
    curveRun,
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
      PF.hz.setBeat(level);
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
      if (s.kind === 'poly') {
        // dentro do polígono, ou a menos de "pr" de alguma borda
        const p = s.pts, n = p.length / 2;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
          const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
          if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
          if (u.distToSeg(px, py, xi, yi, xj, yj) < pr) return true;
        }
        return inside;
      }
      return false;
    },
    normalize(raw, depth = 0) {
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
      for (const p of def.props) h[p.key] = normProp(raw, p, def.defaults[p.key]);
      if (def.extra) def.extra(raw, h, depth); // dados além dos props (comportamentos, itens do grupo…)
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

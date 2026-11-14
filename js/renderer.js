// Desenho da arena: fundo, perigos, gizmos do editor e jogador.
(function () {
  const { W, H, C, u } = PF;
  const TAU = Math.PI * 2;
  const ORDER = { warn: 0, fx: 1, active: 2 };
  const mix = (a, b, p) => PF.kf.mixHex(a, b, p);

  // cores do tema no quadro atual (tema dinâmico da fase)
  const COL = { bg: C.bg, hz: C.danger, hzSoft: C.dangerSoft, pl: C.player, ui: C.accent, head: '#FFD3DA', light: '#FF7483' };
  function setTheme(th) {
    if (COL.src === th) return;
    COL.src = th;
    COL.bg = th.bg; COL.hz = th.hz; COL.pl = th.pl; COL.ui = th.ui;
    COL.hzSoft = mix(th.hz, '#FFFFFF', 0.35);
    COL.head = mix(th.hz, '#FFFFFF', 0.78);
    COL.light = mix(th.hz, '#FFFFFF', 0.18);
    COL.grid = PF.kf.rgba(th.ui, 0.045);
    COL.void = mix(th.bg, '#000000', 0.45);
  }

  function background(ctx) {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COL.grid || 'rgba(124,255,178,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 80; x < W; x += 80) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 80; y < H; y += 80) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  // Camadas do fundo com parallax: profundidade 0 = presa à tela, 100% = anda junto com a arena.
  // off: deslocamento da câmera (o fundo anda menos que ela conforme a profundidade)
  function rnd(i, s) { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); }
  function bgLayers(ctx, level, t, cam) {
    const list = level.bg;
    if (!list || !list.length) return;
    const beat = level.bpm > 0 ? 60 / level.bpm : 0;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    list.forEach((L, li) => {
      if (t < L.from || (L.to > 0 && t > L.to)) return;
      const d = 1 - L.depth / 100; // quanto o fundo "fica para trás" da câmera
      let k = 1;
      if (L.pulse && beat) k = 1 + L.pulse / 100 * Math.exp(-(((t - level.offset) / beat % 1 + 1) % 1) * 6);
      const sz = L.size * k;
      const ox = cam.x * d + L.sx * t, oy = cam.y * d + L.sy * t;
      const x0 = ((ox % sz) + sz) % sz, y0 = ((oy % sz) + sz) % sz;
      ctx.globalAlpha = L.alpha / 100;
      ctx.strokeStyle = ctx.fillStyle = L.color;
      ctx.lineWidth = L.thick;
      ctx.beginPath();
      if (L.kind === 0) { // grade
        for (let x = x0 - sz; x < W + sz; x += sz) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (let y = y0 - sz; y < H + sz; y += sz) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      } else if (L.kind === 1 || L.kind === 5) { // pontos / losangos
        const r = Math.max(0.5, L.thick);
        for (let x = x0 - sz; x < W + sz; x += sz) {
          for (let y = y0 - sz; y < H + sz; y += sz) {
            if (L.kind === 1) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
            else { const q = r * 2.5; ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); }
          }
        }
        ctx.fill();
      } else if (L.kind === 2) { // anéis concêntricos em volta do centro
        const cx = W / 2 - cam.x * d, cy = H / 2 - cam.y * d, ph = ((L.sx + L.sy) * t % sz + sz) % sz;
        for (let r = ph; r < Math.hypot(W, H); r += sz) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
        ctx.stroke();
      } else if (L.kind === 3) { // listras diagonais
        for (let x = x0 - H - sz; x < W + sz; x += sz) { ctx.moveTo(x, 0); ctx.lineTo(x + H, H); }
        ctx.stroke();
      } else { // estrelas: pontos fixos, repetidos em blocos de 4×4 células
        const cell = sz * 4, bx = ((ox % cell) + cell) % cell, by = ((oy % cell) + cell) % cell;
        for (let gx = -1; gx * cell < W + cell; gx++) {
          for (let gy = -1; gy * cell < H + cell; gy++) {
            for (let i = 0; i < 12; i++) {
              const x = gx * cell + bx + rnd(i, li + 1) * cell, y = gy * cell + by + rnd(i, li + 7.7) * cell;
              const r = Math.max(0.4, L.thick * (0.4 + rnd(i, li + 3.3)));
              ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
            }
          }
        }
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function drawShape(ctx, s) {
    ctx.save();
    ctx.globalAlpha = u.clamp(s.alpha, 0, 1);
    const base = s.col || COL.hz;
    const color = s.state === 'fx' ? (s.col ? mix(s.col, '#FFFFFF', 0.35) : COL.hzSoft) : base;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (s.state === 'active') { ctx.shadowColor = base; ctx.shadowBlur = 16; }
    if (s.dashed) ctx.setLineDash([8, 8]);

    if (s.kind === 'circle') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.1, s.r), 0, TAU);
      ctx.fill();
      if (s.state === 'warn') {
        ctx.globalAlpha = Math.min(1, s.alpha * 2);
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (s.kind === 'ring') {
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(0.1, s.r), 0, TAU);
      ctx.lineWidth = Math.max(0.5, s.w);
      ctx.stroke();
      if (s.core && s.r > s.w / 2) { // miolo escuro: o brilho não "enche" o anel
        ctx.shadowBlur = 0;
        ctx.fillStyle = COL.bg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r - s.w / 2, 0, TAU);
        ctx.fill();
      }
    } else if (s.kind === 'poly') {
      const p = s.pts;
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.closePath();
      ctx.fill();
      if (s.state === 'warn') {
        ctx.globalAlpha = Math.min(1, s.alpha * 2);
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else if (s.kind === 'rect') {
      if (s.rot) { ctx.translate(s.x, s.y); ctx.rotate(s.rot); ctx.translate(-s.x, -s.y); }
      if (s.noGlow) ctx.shadowBlur = 0;
      if (s.round && ctx.roundRect) { // colunas da água: topo arredondado
        if (s.light) ctx.fillStyle = s.col ? mix(s.col, '#FFFFFF', 0.18) : COL.light;
        ctx.beginPath();
        ctx.roundRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, [s.round, s.round, 0, 0]);
        ctx.fill();
        ctx.restore();
        return;
      }
      const head = s.col ? mix(s.col, '#FFFFFF', 0.78) : COL.head;
      if (s.head) { ctx.fillStyle = head; ctx.shadowColor = head; ctx.shadowBlur = 22; } // cabeça, quase branca
      ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      if (s.flash > 0) { // brilho ao nascer
        ctx.globalAlpha = u.clamp(s.flash, 0, 1) * 0.8;
        ctx.fillStyle = head;
        ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      }
      if (s.state === 'warn' && !s.solid) {
        ctx.globalAlpha = Math.min(1, s.alpha * 2);
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      }
    } else if (s.kind === 'line') {
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.5, s.w);
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      if (s.state === 'warn') {
        ctx.globalAlpha = Math.min(1, s.alpha * 2.2);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 8]);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function gizmos(ctx, app, scale) {
    const t = app.t;
    const lw = 1.5 / scale, dash = [5 / scale, 4 / scale];
    for (const h of app.level.hazards) {
      const sel = app.isSelected(h.id), single = sel && !app.multi.size; // alças só com um selecionado
      const [a, b] = PF.hz.window(h);
      const inWin = t >= a && t <= b;
      ctx.save();
      // keyframes/pai: o gizmo fica onde o objeto está agora (o mouse é convertido igual no main.js)
      const M = h.keys || h.parent ? PF.hz.worldMatrix(app.level, h, t) : null;
      if (M) ctx.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
      ctx.globalAlpha = sel ? 1 : inWin ? 0.65 : 0.16;
      ctx.strokeStyle = ctx.fillStyle = sel ? C.accent : C.muted;
      ctx.lineWidth = lw;
      ctx.setLineDash(dash);
      ctx.beginPath();

      if (h.type === 'ball') {
        ctx.arc(h.x, h.y, h.size, 0, TAU);
        ctx.stroke();
        const d = h.dir, x0 = h.x + d * (h.size + 6), x1 = h.x + d * (h.size + 46);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x0, h.y); ctx.lineTo(x1, h.y);
        ctx.moveTo(x1 - d * 8, h.y - 6); ctx.lineTo(x1, h.y); ctx.lineTo(x1 - d * 8, h.y + 6);
        ctx.stroke();
      } else if (h.type === 'explosive') {
        ctx.arc(h.x, h.y, h.size, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        const base = h.spin * Math.PI / 180;
        for (let k = 0; k < h.fragments; k++) {
          const ang = base + TAU * k / h.fragments, c = Math.cos(ang), s = Math.sin(ang);
          ctx.moveTo(h.x + c * (h.size + 6), h.y + s * (h.size + 6));
          ctx.lineTo(h.x + c * (h.size + 18), h.y + s * (h.size + 18));
        }
        ctx.stroke();
      } else if (h.type === 'line') {
        const ang = h.angle * Math.PI / 180;
        const ax = Math.cos(ang), ay = Math.sin(ang), nx = -ay, ny = ax;
        const hl = h.length / 2, ht = h.thickness / 2;
        const pts = [[-hl, -ht], [hl, -ht], [hl, ht], [-hl, ht]]
          .map(([a, b]) => [h.x + ax * a + nx * b, h.y + ay * a + ny * b]);
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.stroke();
      } else if (h.type === 'circle') {
        if (h.thickness > 0) {
          ctx.arc(h.x, h.y, h.radius + h.thickness / 2, 0, TAU);
          ctx.moveTo(h.x + Math.max(0, h.radius - h.thickness / 2), h.y);
          ctx.arc(h.x, h.y, Math.max(0, h.radius - h.thickness / 2), 0, TAU);
        } else {
          ctx.arc(h.x, h.y, h.radius, 0, TAU);
        }
        ctx.stroke();
      } else if (h.type === 'snake') {
        ctx.strokeRect(h.x - h.width / 2, h.y - h.height / 2, h.width, h.height);
        const d = h.dir, x0 = h.x + d * (h.width / 2 + 6), x1 = h.x + d * (h.width / 2 + 46);
        // contorno do rastro atrás
        const tailLen = h.tail * h.width * 1.12;
        if (tailLen > 0) {
          ctx.globalAlpha *= 0.5;
          const xe = h.x - d * (h.width / 2), xs = xe - d * tailLen;
          ctx.strokeRect(Math.min(xs, xe), h.y - h.height / 2, Math.abs(xe - xs), h.height);
          ctx.globalAlpha /= 0.5;
        }
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x0, h.y); ctx.lineTo(x1, h.y);
        ctx.moveTo(x1 - d * 8, h.y - 6); ctx.lineTo(x1, h.y); ctx.lineTo(x1 - d * 8, h.y + 6);
        ctx.stroke();
      } else if (h.type === 'curve') {
        // quadrado de partida e o caminho inteiro da cabeça
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.rotate(h.angle * Math.PI / 180);
        ctx.strokeRect(-h.size / 2, -h.size / 2, h.size, h.size);
        ctx.restore();
        const run = PF.hz.curveRun(h);
        ctx.globalAlpha *= 0.5;
        ctx.beginPath();
        for (let s = 0; s <= run; s += 12) {
          const [x, y] = PF.hz.curvePos(h, s);
          if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha /= 0.5;
        // seta na direção inicial
        const a = h.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), px = -dy, py = dx;
        const r0 = h.size / 2 + 6, r1 = r0 + 40, ax = h.x + dx * r1, ay = h.y + dy * r1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(h.x + dx * r0, h.y + dy * r0); ctx.lineTo(ax, ay);
        ctx.moveTo(ax - dx * 8 + px * 6, ay - dy * 8 + py * 6); ctx.lineTo(ax, ay); ctx.lineTo(ax - dx * 8 - px * 6, ay - dy * 8 - py * 6);
        ctx.stroke();
      } else if (h.type === 'double') {
        const b = PF.hz.doubleBox(h);
        const bw = b.vert ? b.thick : b.len, bh = b.vert ? b.len : b.thick;
        ctx.strokeRect(b.cx - bw / 2, b.cy - bh / 2, bw, bh);
        ctx.beginPath(); // divisão entre as duas fileiras
        if (b.vert) { ctx.moveTo(b.cx, b.cy - bh / 2); ctx.lineTo(b.cx, b.cy + bh / 2); }
        else { ctx.moveTo(b.cx - bw / 2, b.cy); ctx.lineTo(b.cx + bw / 2, b.cy); }
        ctx.globalAlpha *= 0.5;
        ctx.stroke();
        ctx.globalAlpha /= 0.5;
      } else if (h.type === 'spike') {
        const p = PF.hz.spikePts(h, h.x, h.y);
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
        ctx.closePath();
        ctx.stroke();
        // seta na direção do movimento, saindo da ponta dos espinhos
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][h.dir] || [-1, 0];
        const r0 = 35 + 30 + 10, r1 = r0 + 40;
        const ax = h.x + dx * r1, ay = h.y + dy * r1, px = -dy, py = dx;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(h.x + dx * r0, h.y + dy * r0); ctx.lineTo(ax, ay);
        ctx.moveTo(ax - dx * 8 + px * 6, ay - dy * 8 + py * 6); ctx.lineTo(ax, ay); ctx.lineTo(ax - dx * 8 - px * 6, ay - dy * 8 - py * 6);
        ctx.stroke();
      } else if (h.type === 'wheel') {
        ctx.arc(h.x, h.y, h.radius, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        for (let k = 0; k < h.count; k++) {
          const ang = TAU * k / h.count, x = h.x + Math.cos(ang) * h.radius, y = h.y + Math.sin(ang) * h.radius;
          ctx.moveTo(x + h.size, y);
          ctx.arc(x, y, h.size, 0, TAU);
        }
        // seta na direção do movimento
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][h.dir] || [1, 0];
        const r0 = h.radius + h.size + 8, r1 = r0 + 40;
        const ax = h.x + dx * r1, ay = h.y + dy * r1, px = -dy, py = dx;
        ctx.moveTo(h.x + dx * r0, h.y + dy * r0); ctx.lineTo(ax, ay);
        ctx.moveTo(ax - dx * 8 + px * 6, ay - dy * 8 + py * 6); ctx.lineTo(ax, ay); ctx.lineTo(ax - dx * 8 - px * 6, ay - dy * 8 - py * 6);
        ctx.stroke();
      } else if (h.type === 'water') {
        // altura inicial (contorno) e final (linha pontilhada)
        ctx.strokeRect(0, H - h.height, W, h.height);
        if (h.heightEnd !== h.height) {
          ctx.setLineDash([2 / scale, 5 / scale]);
          ctx.beginPath();
          ctx.moveTo(0, H - h.heightEnd); ctx.lineTo(W, H - h.heightEnd);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath(); // seta da inicial para a final
          const d = h.heightEnd > h.height ? -1 : 1, x = W - 60, y0 = H - h.height, y1 = H - h.heightEnd;
          ctx.moveTo(x, y0); ctx.lineTo(x, y1);
          ctx.moveTo(x - 6, y1 - d * 8); ctx.lineTo(x, y1); ctx.lineTo(x + 6, y1 - d * 8);
          ctx.stroke();
        }
      } else if (h.type === 'shape') {
        shapeGizmo(ctx, h, single, scale);
        ctx.restore();
        continue;
      } else if (h.type === 'group') {
        groupGizmo(ctx, h, single, scale);
        ctx.restore();
        continue;
      } else if (h.type === 'prefab') {
        const g = PF.hz.prefabGroup(h);
        if (g) groupGizmo(ctx, g, single, scale, true);
        ctx.restore();
        continue;
      } else if (h.type === 'anchor') { // mira: círculo com cruz
        const r = 14 / scale;
        ctx.arc(h.x, h.y, r, 0, TAU);
        ctx.moveTo(h.x - r * 1.6, h.y); ctx.lineTo(h.x + r * 1.6, h.y);
        ctx.moveTo(h.x, h.y - r * 1.6); ctx.lineTo(h.x, h.y + r * 1.6);
        ctx.stroke();
      } else if (h.type === 'emitter') { // círculo e o leque da direção/abertura
        const r = 12 / scale, R = 60 / scale;
        ctx.arc(h.x, h.y, r, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        const a0 = (h.angle - h.spread / 2) * Math.PI / 180, a1 = (h.angle + h.spread / 2) * Math.PI / 180;
        if (h.spread >= 360) ctx.arc(h.x, h.y, R, 0, TAU);
        else { ctx.moveTo(h.x, h.y); ctx.arc(h.x, h.y, R, a0, a1); ctx.closePath(); }
        ctx.globalAlpha *= 0.5;
        ctx.stroke();
        ctx.globalAlpha /= 0.5;
      } else if (h.type === 'activator') { // zona tracejada com o nome da ação
        ctx.strokeStyle = ctx.fillStyle = sel ? C.accent : PF.C.player;
        ctx.strokeRect(h.x - h.w / 2, h.y - h.h / 2, h.w, h.h);
        ctx.font = `${10 / scale}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'left';
        const act = PF.HAZARDS.activator.props.find(p => p.key === 'action').options.find(o => o[0] === h.action);
        ctx.fillText('⚑ ' + (act ? act[1] : ''), h.x - h.w / 2 + 4 / scale, h.y - h.h / 2 + 12 / scale);
      } else if (h.type === 'thunder') {
        // faixa da nuvem e setas no sentido da queda
        const top = !h.side, band = 34, y0 = top ? 0 : H - band;
        ctx.strokeRect(0, y0, W, band);
        ctx.setLineDash([]);
        ctx.beginPath();
        const d = top ? 1 : -1, ya = top ? band + 8 : H - band - 8;
        for (let x = 160; x < W; x += 320) {
          ctx.moveTo(x, ya); ctx.lineTo(x, ya + d * 34);
          ctx.moveTo(x - 6, ya + d * 26); ctx.lineTo(x, ya + d * 34); ctx.lineTo(x + 6, ya + d * 26);
        }
        ctx.stroke();
      }

      // alça (no Trovão fica na nuvem, onde dá para clicar)
      ctx.setLineDash([]);
      const hs = (sel ? 5 : 3.5) / scale;
      const hx = h.type === 'thunder' ? u.clamp(h.x, 20, W - 20) : h.x;
      const hy = h.type === 'thunder' ? (h.side ? H - 17 : 17) : h.type === 'water' ? H - h.height : h.y;
      ctx.fillRect(hx - hs, hy - hs, hs * 2, hs * 2);
      ctx.restore();
    }
  }

  // Alças da Forma no mundo: giro (bolinha acima), tamanho (canto) e pivô (losango em x,y).
  // path: pontos da curva de cada comportamento "Caminho" (relativos a onde ele começa)
  PF.shapeHandles = function (h, scale) {
    const m = PF.hz.shapeMatrix(h);
    const path = [];
    (h.behaviors || []).forEach((b, bi) => {
      if (b.type !== 'path' || !b.on) return;
      const o = PF.hz.shapePose(h, b.start);
      path.push({ bi, ox: o.x, oy: o.y, pts: [['c1x', 'c1y'], ['c2x', 'c2y'], ['ex', 'ey']].map(([kx, ky]) => ({ kx, ky, x: o.x + b[kx], y: o.y + b[ky] })) });
    });
    // topo da forma em coords locais (no caminho: a caixa dos pontos)
    let tx = 0, ty = -h.h / 2;
    if (h.kind === 4 && h.pts.length) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
      for (let i = 0; i < h.pts.length; i += 2) { x0 = Math.min(x0, h.pts[i]); x1 = Math.max(x1, h.pts[i]); y0 = Math.min(y0, h.pts[i + 1]); }
      tx = (x0 + x1) / 2; ty = y0;
    }
    const rotLocal = [tx, ty - 30 / scale];
    // pontos do caminho no mundo (para arrastar)
    const verts = [];
    if (h.kind === 4) for (let i = 0; i < h.pts.length; i += 2) verts.push(PF.m.apply(m, h.pts[i], h.pts[i + 1]));
    return {
      rot: PF.m.apply(m, rotLocal[0], rotLocal[1]),
      rotLocal,
      top: PF.m.apply(m, tx, ty),
      size: h.kind === 4 ? null : PF.m.apply(m, h.w / 2, h.h / 2), // caminho: tamanho pelos pontos/painel
      pivot: [h.x, h.y],
      verts,
      path,
    };
  };

  // Caneta: linha do último ponto até o mouse e o círculo para fechar no primeiro
  function penGizmo(ctx, app, scale) {
    const pen = app.pen, h = pen && app.level.hazards.find(z => z.id === pen.id);
    if (!h || !pen.hover) return;
    const m = PF.hz.shapeMatrix(h), n = h.pts.length / 2;
    const [lx, ly] = PF.m.apply(m, h.pts[h.pts.length - 2], h.pts[h.pts.length - 1]);
    const [fx, fy] = PF.m.apply(m, h.pts[0], h.pts[1]);
    ctx.save();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([4 / scale, 4 / scale]);
    ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(pen.hover.x, pen.hover.y); ctx.stroke();
    ctx.setLineDash([]);
    if (n >= 3) {
      const close = Math.hypot(pen.hover.x - fx, pen.hover.y - fy) <= 10 / scale;
      ctx.globalAlpha = close ? 1 : 0.5;
      ctx.beginPath(); ctx.arc(fx, fy, 8 / scale, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  // rastro do pivô durante o tempo ativo (só se algum comportamento mexe na posição)
  function motionTrail(ctx, h, scale) {
    if (!h.behaviors || !h.behaviors.length) return;
    PF.hz.setBeat(PF.app.level);
    const end = PF.hz.shapeEnd(h);
    const n = Math.min(240, Math.max(24, Math.ceil(end * 30)));
    const pts = [];
    let moved = false;
    for (let i = 0; i <= n; i++) {
      const p = PF.hz.livePose(h, end * i / n);
      pts.push(p.x, p.y);
      if (Math.abs(p.x - h.x) > 0.5 || Math.abs(p.y - h.y) > 0.5) moved = true;
    }
    if (!moved) return;
    ctx.save();
    ctx.setLineDash([2 / scale, 5 / scale]);
    ctx.globalAlpha *= 0.7;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
    // ponto final
    ctx.setLineDash([]);
    const ex = pts[pts.length - 2], ey = pts[pts.length - 1], r = 4 / scale;
    ctx.beginPath();
    ctx.moveTo(ex - r, ey - r); ctx.lineTo(ex + r, ey + r);
    ctx.moveTo(ex + r, ey - r); ctx.lineTo(ex - r, ey + r);
    ctx.stroke();
    ctx.restore();
  }

  // Grupo: alça de giro acima do pivô coletivo (gira junto com o grupo)
  PF.groupHandles = function (g, scale) {
    const a = g.rot * Math.PI / 180, r = 46 / scale;
    return { rot: [g.x + Math.sin(a) * r, g.y - Math.cos(a) * r] };
  };

  // contornos dos itens (1ª cópia forte, as outras do repetidor fracas), pivô e alça de giro
  function groupGizmo(ctx, g, sel, scale) {
    const outl = PF.hz.groupOutlines(g);
    for (const o of outl) {
      ctx.save();
      if (o.copy) ctx.globalAlpha *= 0.35;
      ctx.beginPath();
      for (let i = 0; i < o.pts.length; i += 2) i ? ctx.lineTo(o.pts[i], o.pts[i + 1]) : ctx.moveTo(o.pts[i], o.pts[i + 1]);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
    if (sel) {
      // raios do pivô até cada cópia do repetidor
      if (g.repeat) {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        for (const M of PF.hz.copyMatrices(g)) {
          let cx = 0, cy = 0;
          for (const it of g.items) { cx += it.x; cy += it.y; }
          const [x, y] = PF.m.apply(M, cx / Math.max(1, g.items.length), cy / Math.max(1, g.items.length));
          ctx.moveTo(g.x, g.y); ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
      const hr = PF.groupHandles(g, scale).rot;
      ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(hr[0], hr[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(hr[0], hr[1], 5 / scale, 0, TAU);
      ctx.fillStyle = C.bg; ctx.fill(); ctx.stroke();
    }
    // pivô coletivo: losango maior, com anel
    const r = (sel ? 8 : 6) / scale;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y - r); ctx.lineTo(g.x + r, g.y); ctx.lineTo(g.x, g.y + r); ctx.lineTo(g.x - r, g.y);
    ctx.closePath();
    ctx.fillStyle = sel ? C.accent : C.muted;
    ctx.fill();
    ctx.beginPath(); ctx.arc(g.x, g.y, r * 1.7, 0, TAU); ctx.stroke();
  }

  function shapeGizmo(ctx, h, sel, scale) {
    const m = PF.hz.shapeMatrix(h);
    ctx.beginPath();
    if (h.kind === 3) { // laser: retângulo do comprimento × grossura
      const loc = [-h.w / 2, -h.h / 2, h.w / 2, -h.h / 2, h.w / 2, h.h / 2, -h.w / 2, h.h / 2];
      for (let i = 0; i < 8; i += 2) { const [x, y] = PF.m.apply(m, loc[i], loc[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    } else {
      const loc = PF.hz.shapeLocal(h);
      for (let i = 0; i < loc.length; i += 2) { const [x, y] = PF.m.apply(m, loc[i], loc[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    }
    if (!(h.kind === 4 && !h.closed)) ctx.closePath(); // caminho aberto não fecha
    ctx.stroke();
    ctx.setLineDash([]);
    const hd = PF.shapeHandles(h, scale), r = (sel ? 6 : 4.5) / scale;
    if (sel || h.behaviors.length) motionTrail(ctx, h, scale);
    if (sel) {
      // onde cada gatilho dispara (pequenos losangos; tiros mostram a direção)
      PF.hz.setBeat(PF.app.level);
      const ev = PF.hz.shapeEvents(h), q = 4 / scale;
      ctx.save();
      ctx.fillStyle = '#FFD3DA';
      ctx.strokeStyle = '#FFD3DA';
      for (const e of ev.list) {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - q); ctx.lineTo(e.x + q, e.y); ctx.lineTo(e.x, e.y + q); ctx.lineTo(e.x - q, e.y);
        ctx.closePath();
        ctx.fill();
        const a = e.t.action;
        if (a === 'burst' || a === 'explode') {
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          const n = e.t.count, base = e.t.angle + (e.t.aim ? e.rot : 0);
          for (let i = 0; i < n; i++) {
            const g = (e.t.spread >= 360 ? base + 360 * i / n : n > 1 ? base - e.t.spread / 2 + e.t.spread * i / (n - 1) : base) * Math.PI / 180;
            ctx.moveTo(e.x + Math.cos(g) * 8 / scale, e.y + Math.sin(g) * 8 / scale);
            ctx.lineTo(e.x + Math.cos(g) * 26 / scale, e.y + Math.sin(g) * 26 / scale);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
      // pontos de controle das curvas: hastes até os controles, bolinhas arrastáveis
      for (const c of hd.path) {
        const [c1, c2, e] = c.pts;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        ctx.moveTo(c.ox, c.oy); ctx.lineTo(c1.x, c1.y);
        ctx.moveTo(e.x, e.y); ctx.lineTo(c2.x, c2.y);
        ctx.stroke();
        ctx.restore();
        for (const q of c.pts) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 4.5 / scale, 0, TAU);
          ctx.fillStyle = q === e ? C.accent : C.bg;
          ctx.fill(); ctx.stroke();
        }
      }
      // centro da forma → pivô (mostra em volta de onde ela gira)
      const [cx, cy] = PF.m.apply(m, 0, 0);
      if (Math.hypot(cx - h.x, cy - h.y) > 2) {
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([2 / scale, 4 / scale]);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); // haste e bolinha de giro
      ctx.moveTo(hd.top[0], hd.top[1]); ctx.lineTo(hd.rot[0], hd.rot[1]);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hd.rot[0], hd.rot[1], 5 / scale, 0, TAU);
      ctx.fillStyle = C.bg; ctx.fill(); ctx.stroke();
      const s = 4.5 / scale; // quadradinho do tamanho
      ctx.fillStyle = C.accent;
      if (hd.size) ctx.fillRect(hd.size[0] - s, hd.size[1] - s, s * 2, s * 2);
      // pontos do caminho: quadradinhos ocos (o escolhido fica cheio)
      hd.verts.forEach(([vx, vy], i) => {
        const q = (i === PF.app.vtx ? 5 : 3.5) / scale;
        ctx.fillStyle = i === PF.app.vtx ? C.accent : C.bg;
        ctx.fillRect(vx - q, vy - q, q * 2, q * 2);
        ctx.strokeRect(vx - q, vy - q, q * 2, q * 2);
      });
    }
    // pivô: losango (a cor do acento quando selecionado)
    ctx.beginPath();
    ctx.moveTo(h.x, h.y - r); ctx.lineTo(h.x + r, h.y); ctx.lineTo(h.x, h.y + r); ctx.lineTo(h.x - r, h.y);
    ctx.closePath();
    ctx.fillStyle = sel ? C.accent : C.muted;
    ctx.fill();
  }

  function spawnMarker(ctx, app, scale) {
    const s = app.level.spawn;
    ctx.save();
    ctx.globalAlpha = app.spawnSelected ? 1 : 0.7;
    ctx.strokeStyle = C.player;
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([4 / scale, 3 / scale]);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 14); ctx.lineTo(s.x + 14, s.y); ctx.lineTo(s.x, s.y + 14); ctx.lineTo(s.x - 14, s.y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C.player;
    ctx.font = `${11 / scale}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('início', s.x, s.y + 14 + 14 / scale);
    ctx.restore();
  }

  function endScreen(ctx, title, sub, color) {
    ctx.save();
    ctx.fillStyle = 'rgba(11,20,22,0.72)';
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.font = '700 64px "Space Grotesk", sans-serif';
    ctx.shadowColor = color;
    ctx.shadowBlur = 24;
    ctx.fillText(title, W / 2, H / 2 - 10);
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.text;
    ctx.font = '18px "JetBrains Mono", monospace';
    ctx.fillText(sub, W / 2, H / 2 + 36);
    ctx.restore();
  }

  // Losango com a ponta virada para `ang`, esticado (sx) na direção do movimento.
  function diamond(ctx, x, y, s, ang = 0, sx = 1, sy = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.scale(sx, sy);
    ctx.beginPath();
    ctx.moveTo(s, 0); ctx.lineTo(0, s); ctx.lineTo(-s, 0); ctx.lineTo(0, -s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function player(ctx, p) {
    ctx.save();
    ctx.fillStyle = COL.pl;
    for (const tr of p.trail) { ctx.globalAlpha = tr.a * 0.45; diamond(ctx, tr.x, tr.y, 9 * tr.a + 2, tr.ang, 1.3, 0.8); }
    const blink = p.hurt > 0 && Math.floor(p.hurt * 14) % 2 === 0;
    if (!blink) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = COL.pl;
      ctx.shadowBlur = p.dash > 0 ? 28 : 16;
      diamond(ctx, p.x, p.y, 11, p.ang, 1 + p.stretch, 1 - p.stretch * 0.45);
    }
    ctx.restore();
  }

  // linha tracejada do filho até o pai (objeto selecionado)
  function parentLink(ctx, app, scale) {
    const h = app.multi.size ? null : app.selected();
    if (!h || !h.parent) return;
    const P = PF.hz.parentOf(app.level, h);
    if (!P) return;
    const pt = z => {
      const o = [z.x + (z.ox || 0), z.y + (z.oy || 0)], M = PF.hz.worldMatrix(app.level, z, app.t);
      return M ? PF.m.apply(M, o[0], o[1]) : o;
    };
    const [ax, ay] = pt(h), [bx, by] = pt(P);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = PF.C.player;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.2 / scale;
    ctx.setLineDash([3 / scale, 4 / scale]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(bx, by, 4 / scale, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // checkpoints: losango tracejado do jogador com o número (o escolhido fica forte)
  function checkpointMarkers(ctx, app, scale) {
    const list = app.level.checkpoints || [];
    list.forEach((c, i) => {
      const sel = app.sel2 && app.sel2.kind === 'cp' && app.sel2.i === i;
      ctx.save();
      ctx.globalAlpha = sel ? 1 : 0.5;
      ctx.strokeStyle = ctx.fillStyle = sel ? C.accent : C.player;
      ctx.lineWidth = 1.5 / scale;
      ctx.setLineDash([2 / scale, 3 / scale]);
      const r = 10;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y - r); ctx.lineTo(c.x + r, c.y); ctx.lineTo(c.x, c.y + r); ctx.lineTo(c.x - r, c.y);
      ctx.closePath();
      ctx.stroke();
      ctx.font = `${10 / scale}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('cp' + (i + 1) + ' ' + c.t.toFixed(2) + 's', c.x, c.y + r + 12 / scale);
      ctx.restore();
    });
  }

  // câmera: transformação mundo → tela e a moldura da vista (gizmo com a câmera desligada)
  const camInverse = c => PF.m.compose(W / 2 + c.x, H / 2 + c.y, c.rot, 1 / c.zoom, 1 / c.zoom, W / 2, H / 2);
  PF.camView = function (level, t) {
    const c = PF.anim.camAt(level, t), M = camInverse(c);
    return { cam: c, corners: [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => PF.m.apply(M, x, y)) };
  };
  function camFrame(ctx, app, scale) {
    if (!PF.anim.hasCam(app.level)) return;
    const v = PF.camView(app.level, app.t), q = v.corners;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = PF.C.signal || '#4DD8FF';
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([10 / scale, 6 / scale]);
    ctx.beginPath();
    q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.font = `${10 / scale}px "JetBrains Mono", monospace`;
    ctx.fillText('câmera ' + Math.round(v.cam.zoom * 100) + '%', q[0][0] + 6 / scale, q[0][1] + 14 / scale);
    ctx.restore();
  }

  PF.render = function (ctx, app, view) {
    const lvl = app.level, t = app.t;
    setTheme(PF.anim.themeAt(lvl, t));
    const T = app.mode === 'test' ? app.test : null;
    // a câmera vale no teste e tocando; parado no editor ela aparece só como moldura
    const camOn = !!T || app.playing;
    const cam = PF.anim.camAt(lvl, t);
    const fx = PF.hz.timeFx(lvl, t);
    if (T && T.fx) for (const e of T.fx) {
      const a = t - e.at;
      if (a < 0 || a > e.dur) continue;
      const f = 1 - a / e.dur;
      if (e.kind === 'shake') fx.shake = Math.max(fx.shake, e.amount * f);
      else fx.flash = Math.max(fx.flash, e.amount / 100 * f);
    }
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
    const useCam = camOn && (cam.x || cam.y || cam.zoom !== 1 || cam.rot);
    if (useCam) { ctx.fillStyle = COL.void; ctx.fillRect(0, 0, W, H); }
    if (T && T.shake > 0) {
      const m = 14 * (T.shake / 0.3);
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    const sh = (camOn ? cam.shake : 0) + fx.shake;
    if (sh > 0) { // tremor fixo pelo tempo (igual em toda reprodução)
      ctx.translate(Math.sin(t * 91.7) * sh * 0.8 + Math.sin(t * 37.3) * sh * 0.4, Math.cos(t * 83.1) * sh * 0.8 + Math.sin(t * 29.9) * sh * 0.4);
    }
    if (useCam) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(cam.zoom, cam.zoom);
      ctx.rotate(-cam.rot * Math.PI / 180);
      ctx.translate(-(W / 2 + cam.x), -(H / 2 + cam.y));
    }
    background(ctx);
    bgLayers(ctx, lvl, t, camOn ? cam : { x: 0, y: 0 });

    const shapes = PF.hz.collect(lvl, t, []);
    shapes.sort((a, b) => ORDER[a.state] - ORDER[b.state]);
    for (const s of shapes) drawShape(ctx, s);

    if (app.mode === 'edit') {
      gizmos(ctx, app, view.scale);
      parentLink(ctx, app, view.scale);
      if (app.pen) penGizmo(ctx, app, view.scale);
      checkpointMarkers(ctx, app, view.scale);
      spawnMarker(ctx, app, view.scale);
      if (!camOn) camFrame(ctx, app, view.scale);
    }
    if (T && !T.over) player(ctx, T.player);
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0); // daqui para baixo: na tela, sem câmera
    if (fx.flash > 0) {
      ctx.fillStyle = PF.kf.rgba(COL.ui, Math.min(0.85, fx.flash * 0.7));
      ctx.fillRect(0, 0, W, H);
    }
    if (T) {
      if (T.flash > 0) {
        ctx.fillStyle = PF.kf.rgba(COL.hz, T.flash * 0.22);
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }
      if (T.cpMsg > 0) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, T.cpMsg);
        ctx.fillStyle = COL.pl;
        ctx.font = '600 16px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(T.cpText || '◆ checkpoint', W / 2, 64);
        ctx.restore();
      }
      if (T.over) endScreen(ctx, 'VOCÊ PERDEU', 'R tentar de novo · Esc voltar ao editor', COL.hz);
      else if (T.done) endScreen(ctx, 'FASE CONCLUÍDA', `acertos: ${T.hits} · R jogar de novo · Esc editor`, COL.ui);
    }
  };
})();

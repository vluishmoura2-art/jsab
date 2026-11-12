// Desenho da arena: fundo, perigos, gizmos do editor e jogador.
(function () {
  const { W, H, C, u } = PF;
  const TAU = Math.PI * 2;
  const ORDER = { warn: 0, fx: 1, active: 2 };

  function background(ctx) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(124,255,178,0.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 80; x < W; x += 80) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 80; y < H; y += 80) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();
  }

  function drawShape(ctx, s) {
    ctx.save();
    ctx.globalAlpha = u.clamp(s.alpha, 0, 1);
    const color = s.state === 'fx' ? C.dangerSoft : C.danger;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (s.state === 'active') { ctx.shadowColor = C.danger; ctx.shadowBlur = 16; }
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
        ctx.fillStyle = C.bg;
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
        if (s.light) ctx.fillStyle = '#FF7483';
        ctx.beginPath();
        ctx.roundRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, [s.round, s.round, 0, 0]);
        ctx.fill();
        ctx.restore();
        return;
      }
      if (s.head) { ctx.fillStyle = '#FFD3DA'; ctx.shadowColor = '#FFD3DA'; ctx.shadowBlur = 22; } // cabeça, quase branca
      ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      if (s.flash > 0) { // brilho ao nascer
        ctx.globalAlpha = u.clamp(s.flash, 0, 1) * 0.8;
        ctx.fillStyle = '#FFD3DA';
        ctx.fillRect(s.x - s.w / 2, s.y - s.h / 2, s.w, s.h);
      }
      if (s.state === 'warn') {
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
      const sel = h.id === app.selectedId;
      const [a, b] = PF.hz.window(h);
      const inWin = t >= a && t <= b;
      ctx.save();
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
    ctx.fillStyle = C.player;
    for (const tr of p.trail) { ctx.globalAlpha = tr.a * 0.45; diamond(ctx, tr.x, tr.y, 9 * tr.a + 2, tr.ang, 1.3, 0.8); }
    const blink = p.hurt > 0 && Math.floor(p.hurt * 14) % 2 === 0;
    if (!blink) {
      ctx.globalAlpha = 1;
      ctx.shadowColor = C.player;
      ctx.shadowBlur = p.dash > 0 ? 28 : 16;
      diamond(ctx, p.x, p.y, 11, p.ang, 1 + p.stretch, 1 - p.stretch * 0.45);
    }
    ctx.restore();
  }

  PF.render = function (ctx, app, view) {
    ctx.setTransform(view.k, 0, 0, view.k, 0, 0);
    const T = app.mode === 'test' ? app.test : null;
    if (T && T.shake > 0) {
      const m = 14 * (T.shake / 0.3);
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }
    background(ctx);

    const shapes = PF.hz.collect(app.level, app.t, []);
    shapes.sort((a, b) => ORDER[a.state] - ORDER[b.state]);
    for (const s of shapes) drawShape(ctx, s);

    if (app.mode === 'edit') {
      gizmos(ctx, app, view.scale);
      spawnMarker(ctx, app, view.scale);
    }
    if (T) {
      if (!T.over) player(ctx, T.player);
      if (T.flash > 0) {
        ctx.fillStyle = `rgba(255,77,94,${T.flash * 0.22})`;
        ctx.fillRect(-20, -20, W + 40, H + 40);
      }
      if (T.over) endScreen(ctx, 'VOCÊ PERDEU', 'R tentar de novo · Esc voltar ao editor', C.danger);
      else if (T.done) endScreen(ctx, 'FASE CONCLUÍDA', `acertos: ${T.hits} · R jogar de novo · Esc editor`, C.accent);
    }
  };
})();

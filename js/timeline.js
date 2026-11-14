// Timeline em canvas: régua, uma faixa por tipo de perigo, playhead, arrastar e zoom.
(function () {
  const { C, u } = PF;
  const GUT = 100, RULER = 24, MUS = 30, LANE = 22;
  const TOP = RULER + MUS; // início das faixas de perigos
  const LANES = ['ball', 'explosive', 'line', 'circle', 'snake', 'curve', 'thunder', 'double', 'water', 'wheel', 'spike', 'shape'];
  const FONT_MONO = '10px "JetBrains Mono", monospace';
  const FONT_UI = '11px "Space Grotesk", system-ui, sans-serif';

  const tl = PF.timeline = { pps: 40, scroll: 0, w: 0, h: 0, dpr: 1, canvas: null, ctx: null, drag: null };

  const tx = t => GUT + (t - tl.scroll) * tl.pps;
  const xt = x => (x - GUT) / tl.pps + tl.scroll;

  tl.init = function (canvas) {
    tl.canvas = canvas;
    tl.ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    tl.resize();
  };

  tl.resize = function () {
    const r = tl.canvas.getBoundingClientRect();
    tl.dpr = window.devicePixelRatio || 1;
    tl.w = r.width; tl.h = r.height;
    tl.canvas.width = Math.round(r.width * tl.dpr);
    tl.canvas.height = Math.round(r.height * tl.dpr);
  };

  // Mantém o playhead visível durante a reprodução.
  tl.follow = function (t) {
    const x = tx(t);
    if (x > tl.w - 40 || x < GUT) tl.scroll = Math.max(0, t - (tl.w - GUT) * 0.1 / tl.pps);
  };

  function majorStep() {
    for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) if (s * tl.pps >= 64) return s;
    return 120;
  }

  // Forma de onda da música na faixa logo abaixo da régua.
  function drawWave(ctx, w) {
    const A = PF.audio;
    ctx.fillStyle = 'rgba(124,255,178,0.035)';
    ctx.fillRect(GUT, RULER, w - GUT, MUS);
    ctx.fillStyle = C.line;
    ctx.fillRect(GUT, TOP - 1, w - GUT, 1);
    if (!A.peaks) {
      ctx.fillStyle = C.muted;
      ctx.font = FONT_UI;
      ctx.textBaseline = 'middle';
      ctx.fillText('Sem música — use "♪ Música" no topo para importar', GUT + 10, RULER + MUS / 2);
      return;
    }
    const pk = A.peaks, rate = A.peakRate, mid = RULER + MUS / 2, amp = MUS / 2 - 3;
    ctx.fillStyle = 'rgba(124,255,178,0.6)';
    for (let x = GUT; x < w; x++) {
      const t0 = xt(x), t1 = xt(x + 1);
      if (t1 < 0) continue;
      if (t0 > A.duration) break;
      const b0 = Math.max(0, Math.floor(t0 * rate)), b1 = Math.min(pk.length - 1, Math.ceil(t1 * rate));
      let m = 0;
      for (let b = b0; b <= b1; b++) if (pk[b] > m) m = pk[b];
      const hh = Math.max(0.5, m * amp);
      ctx.fillRect(x, mid - hh, 1, hh * 2);
    }
  }

  function blockRange(h) {
    const [a, b] = PF.hz.window(h);
    const xa = tx(a), xb = Math.max(tx(b), xa + 8);
    return [xa, xb];
  }

  tl.draw = function () {
    const { ctx, w, h } = tl;
    const app = PF.app;
    if (!ctx || !w) return;
    ctx.setTransform(tl.dpr, 0, 0, tl.dpr, 0, 0);
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, w, h);

    // faixas
    LANES.forEach((_, i) => {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.012)' : 'rgba(255,255,255,0.03)';
      ctx.fillRect(GUT, TOP + i * LANE, w - GUT, LANE);
    });
    drawWave(ctx, w);

    // depois do fim da fase
    const xe = tx(app.level.duration);
    if (xe < w) {
      const x0 = Math.max(GUT, xe);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x0, RULER, w - x0, h - RULER);
      if (xe >= GUT) {
        ctx.fillStyle = C.muted;
        ctx.fillRect(xe, RULER, 1, h - RULER);
      }
    }

    // régua
    ctx.fillStyle = '#10181B';
    ctx.fillRect(0, 0, w, RULER);
    const major = majorStep(), minor = major / (major === 0.25 || major === 15 ? 5 : 4);
    ctx.font = FONT_MONO;
    ctx.textBaseline = 'middle';
    let t = Math.max(0, Math.floor(tl.scroll / minor) * minor);
    for (let guard = 0; tx(t) < w && guard < 2000; guard++, t = u.round(t + minor, 4)) {
      const x = Math.round(tx(t)) + 0.5;
      if (x < GUT) continue;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.fillStyle = isMajor ? C.muted : '#3A4F57';
      ctx.fillRect(x, isMajor ? 12 : 17, 1, RULER - (isMajor ? 12 : 17));
      if (isMajor) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(x, RULER, 1, h - RULER);
        ctx.fillStyle = C.muted;
        ctx.fillText(major < 1 ? t.toFixed(2) + 's' : u.fmtTime(t).replace(/\.00$/, ''), x + 4, 7);
      }
    }

    drawBeatGrid(ctx, w, h, app);

    // blocos
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUT, RULER, w - GUT, h - RULER);
    ctx.clip();
    const ordered = app.level.hazards.slice().sort((a, b) => a.time - b.time || (a.id === app.selectedId) - (b.id === app.selectedId));
    for (const hz of ordered) {
      const lane = LANES.indexOf(hz.type);
      const [xa, xb] = blockRange(hz);
      if (xb < GUT || xa > w) continue;
      const def = PF.HAZARDS[hz.type];
      const y = TOP + lane * LANE + 4, bh = LANE - 8;
      const xs = tx(hz.time), xw = tx(hz.time + def.warnLen(hz));
      const sel = hz.id === app.selectedId;

      ctx.fillStyle = 'rgba(255,77,94,0.16)';
      ctx.fillRect(xa, y, xb - xa, bh);
      ctx.fillStyle = 'rgba(255,77,94,0.5)';
      ctx.fillRect(Math.max(xa, xw), y, xb - Math.max(xa, xw), bh);
      ctx.fillStyle = C.danger;
      ctx.fillRect(xs - 1, y, 2, bh);
      if (sel) {
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(xa + 0.75, y + 0.75, xb - xa - 1.5, bh - 1.5);
      }
      if (xb - Math.max(xs, GUT) > 30) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(xs + 1, y, xb - xs - 1, bh);
        ctx.clip();
        ctx.fillStyle = sel ? C.accent : C.text;
        ctx.font = FONT_MONO;
        ctx.fillText('#' + hz.id + ' ' + hz.time.toFixed(2) + 's', Math.max(xs, GUT) + 5, y + bh / 2 + 1);
        ctx.restore();
      }
    }
    ctx.restore();

    // rótulos das faixas
    ctx.fillStyle = C.panel;
    ctx.fillRect(0, 0, GUT, h);
    ctx.fillStyle = '#10181B';
    ctx.fillRect(0, 0, GUT, RULER);
    ctx.fillStyle = C.line;
    ctx.fillRect(GUT - 1, 0, 1, h);
    ctx.fillRect(0, RULER - 1, w, 1);
    ctx.font = FONT_MONO;
    ctx.fillStyle = C.muted;
    ctx.fillText('TEMPO', 12, RULER / 2);
    ctx.font = FONT_UI;
    ctx.fillStyle = C.accent;
    ctx.fillText('♪ Música', 12, RULER + MUS / 2 + 1);
    ctx.fillStyle = C.line;
    ctx.fillRect(0, TOP - 1, GUT, 1);
    LANES.forEach((type, i) => {
      ctx.fillStyle = C.danger;
      ctx.fillRect(12, TOP + i * LANE + LANE / 2 - 3, 6, 6);
      ctx.fillStyle = C.text;
      ctx.fillText(PF.HAZARDS[type].label, 26, TOP + i * LANE + LANE / 2 + 1);
    });

    drawPlayhead(ctx, w, h, app);
  };

  // Grade de batidas (só com BPM): compasso forte, batida média, subdivisão do encaixe fraca.
  // Na régua: número do compasso. A batida que a agulha acabou de passar acende.
  function drawBeatGrid(ctx, w, h, app) {
    const lvl = app.level, beat = app.beatLen();
    if (!beat) return;
    const bpb = lvl.beatsPerBar, bx = beat * tl.pps;
    const div = app.snapOn ? app.snapDiv : 1;
    const showSub = div > 1 && bx / div >= 9;
    const showBeat = bx >= 6;
    const barMode = !showSub && !showBeat;              // zoom bem longe: só compassos
    const step = showSub ? beat / div : showBeat ? beat : beat * bpb;
    const per = showSub ? div : 1;                      // passos por batida
    const t0 = Math.max(lvl.offset, tl.scroll), tEnd = Math.min(lvl.duration, xt(w));
    let i = Math.floor((t0 - lvl.offset) / step);
    const playing = app.playing, now = app.t;
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUT, 0, w - GUT, h);
    ctx.clip();
    for (let guard = 0; guard < 4000; guard++, i++) {
      const t = lvl.offset + i * step;
      if (t > tEnd) break;
      const x = Math.round(tx(t)) + 0.5;
      if (x < GUT) continue;
      const isBeat = barMode || i % per === 0, bi = barMode ? i * bpb : i / per;
      const isBar = isBeat && bi % bpb === 0;
      let a = isBar ? 0.13 : isBeat ? 0.06 : 0.03;
      if (playing && isBeat) {                          // brilho logo depois que a agulha passa
        const since = now - t;
        if (since >= 0 && since < 0.25) a += 0.35 * (1 - since / 0.25);
      }
      ctx.fillStyle = `rgba(124,255,178,${a})`;
      ctx.fillRect(x - 0.5, RULER, 1, h - RULER);
      if (isBar) {
        ctx.fillStyle = 'rgba(124,255,178,0.55)';
        ctx.fillRect(x - 0.5, RULER - 6, 1, 6);
        if (bx * bpb >= 22) {
          ctx.font = FONT_MONO;
          ctx.textBaseline = 'middle';
          ctx.fillText(String(bi / bpb + 1), x + 3, RULER - 5);
        }
      } else if (isBeat && showBeat) {
        ctx.fillStyle = 'rgba(124,255,178,0.3)';
        ctx.fillRect(x - 0.5, RULER - 3, 1, 3);
      }
    }
    ctx.restore();
  }

  // Agulha: linha fina com cabeça em losango; tocando, deixa um rastro de brilho atrás.
  let trail = 0; // 0..1, aparece ao tocar e some ao pausar
  function drawPlayhead(ctx, w, h, app) {
    const xp = Math.round(tx(app.t)) + 0.5;
    trail += ((app.playing ? 1 : 0) - trail) * 0.15;
    if (xp < GUT - 8 || xp > w + 8) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(GUT, 0, w - GUT, h);
    ctx.clip();
    if (trail > 0.01) {
      const len = 48 * trail;
      const g = ctx.createLinearGradient(xp - len, 0, xp, 0);
      g.addColorStop(0, 'rgba(124,255,178,0)');
      g.addColorStop(1, `rgba(124,255,178,${0.14 * trail})`);
      ctx.fillStyle = g;
      ctx.fillRect(xp - len, RULER, len, h - RULER);
    }
    // "kick" na batida: 1 no instante da batida, cai rápido
    const beat = app.beatLen();
    let kick = 0;
    if (beat && app.playing && app.t >= app.level.offset) {
      kick = Math.exp(-(((app.t - app.level.offset) / beat) % 1) * 9);
    }
    ctx.shadowColor = C.accent;
    ctx.shadowBlur = 6 + 6 * trail + 10 * kick;
    ctx.fillStyle = C.accent;
    ctx.fillRect(xp - 0.5 - kick * 0.5, 6, 1.5 + kick, h - 6);
    // cabeça em losango (a forma do jogador) com miolo escuro
    const cy = 9, r = 6 * (1 + 0.3 * kick);
    ctx.beginPath();
    ctx.moveTo(xp, cy - r); ctx.lineTo(xp + r, cy); ctx.lineTo(xp, cy + r); ctx.lineTo(xp - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#10181B';
    ctx.beginPath();
    ctx.moveTo(xp, cy - 2.5); ctx.lineTo(xp + 2.5, cy); ctx.lineTo(xp, cy + 2.5); ctx.lineTo(xp - 2.5, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function local(e) {
    const r = tl.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function hitBlock(x, y) {
    if (y < TOP || x < GUT) return null;
    const type = LANES[Math.floor((y - TOP) / LANE)];
    if (!type) return null;
    const app = PF.app;
    const list = app.level.hazards.filter(h => h.type === type);
    const sel = list.find(h => h.id === app.selectedId);
    if (sel) list.push(sel); // o selecionado tem prioridade
    for (let i = list.length - 1; i >= 0; i--) {
      const [xa, xb] = blockRange(list[i]);
      if (x >= xa - 3 && x <= xb + 3) return list[i];
    }
    return null;
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (x < GUT) return;
    tl.canvas.setPointerCapture(e.pointerId);
    const app = PF.app;
    const blk = hitBlock(x, y);
    if (blk) {
      app.select(blk.id);
      tl.drag = { kind: 'move', id: blk.id, grab: xt(x) - blk.time, moved: false };
      return;
    }
    if (y > RULER) app.select(null);
    tl.drag = { kind: 'scrub' };
    app.setTime(xt(x));
  }

  function onMove(e) {
    const { x, y } = local(e);
    const app = PF.app;
    const d = tl.drag;
    if (!d) {
      tl.canvas.style.cursor = hitBlock(x, y) ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'scrub') { app.setTime(xt(x)); return; }
    const h = app.level.hazards.find(z => z.id === d.id);
    if (!h) return;
    let nt = xt(x) - d.grab;
    nt = e.altKey ? u.round(nt, 2) : app.snapTime(nt);
    nt = u.round(u.clamp(nt, 0, app.level.duration), 4);
    if (nt !== h.time) { h.time = nt; d.moved = true; app.changed(false); }
    tl.canvas.style.cursor = 'grabbing';
  }

  function onUp() {
    if (tl.drag && tl.drag.kind === 'move' && tl.drag.moved) PF.app.commit();
    tl.drag = null;
  }

  function onWheel(e) {
    e.preventDefault();
    const { x } = local(e);
    if (e.ctrlKey || e.metaKey) {
      const at = xt(Math.max(GUT, x));
      tl.pps = u.clamp(tl.pps * Math.exp(-e.deltaY * 0.0015), 6, 800);
      tl.scroll = Math.max(0, at - (Math.max(GUT, x) - GUT) / tl.pps);
    } else {
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      tl.scroll = u.clamp(tl.scroll + delta / tl.pps, 0, Math.max(0, PF.app.level.duration));
    }
  }
})();

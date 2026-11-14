// Timeline em canvas: régua, uma faixa por tipo de perigo, playhead, arrastar e zoom.
(function () {
  const { C, u } = PF;
  const GUT = 100, RULER = 24, MUS = 30;
  let LANE = 22; // altura da faixa: encolhe um pouco (até 15 px) para todas caberem
  const TOP = RULER + MUS; // início das faixas de perigos
  // 'ctrl' = Âncora / Partículas / Ativador; 'events' = câmera, tema e checkpoints da fase
  const LANES = ['ball', 'explosive', 'line', 'circle', 'snake', 'curve', 'thunder', 'double', 'water', 'wheel', 'spike', 'shape', 'ctrl', 'events'];
  const LANE_NAME = { shape: 'Forma / grupo', ctrl: 'Âncora / fx', events: 'Câm. / tema / cp' };
  const FONT_MONO = '10px "JetBrains Mono", monospace';
  const FONT_UI = '11px "Space Grotesk", system-ui, sans-serif';
  const KEY_COL = { pos: '#7CFFB2', rot: '#4DD8FF', scl: '#FFB347', col: '#FF8A95' };

  const tl = PF.timeline = { pps: 40, scroll: 0, w: 0, h: 0, dpr: 1, canvas: null, ctx: null, drag: null };

  const CTRL = { anchor: 1, emitter: 1, activator: 1 };
  const laneOf = h => (h.type === 'group' || h.type === 'prefab' ? 'shape' : CTRL[h.type] ? 'ctrl' : h.type); // grupos e prefabs ficam na faixa das Formas
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
    canvas.addEventListener('dblclick', onDbl);
    tl.resize();
  };

  tl.resize = function () {
    const r = tl.canvas.getBoundingClientRect();
    tl.dpr = window.devicePixelRatio || 1;
    tl.w = r.width; tl.h = r.height;
    tl.canvas.width = Math.round(r.width * tl.dpr);
    tl.canvas.height = Math.round(r.height * tl.dpr);
    LANE = Math.max(15, Math.min(22, Math.floor((r.height - TOP) / LANES.length)));
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

  // com BPM: "c3 b2" (compasso 3, batida 2; frações como b2.5); sem BPM: segundos
  function timeLabel(t, app) {
    const beat = app.beatLen();
    if (!beat) return t.toFixed(2) + 's';
    const bpb = app.level.beatsPerBar, bi = (t - app.level.offset) / beat;
    if (bi < -1e-6) return t.toFixed(2) + 's';
    const r = Math.round(bi * 8) / 8; // até 1/8 de batida
    const bar = Math.floor(r / bpb + 1e-9), inBar = r - bar * bpb + 1;
    const exact = Math.abs(bi - r) < 1e-3;
    return 'c' + (bar + 1) + ' b' + (+inBar.toFixed(3)) + (exact ? '' : '~');
  }

  function blockRange(h) {
    const [a, b] = PF.hz.window(h);
    const xa = tx(a), xb = Math.max(tx(b), xa + 8);
    return [xa, xb];
  }

  // chaves do objeto juntas por tempo (absoluto): [{ t, chs }]
  function keyTimes(h) {
    const m = new Map();
    if (h.keys) for (const ch in h.keys) for (const k of h.keys[ch]) {
      const t = u.round(h.time + k.t, 4);
      if (!m.has(t)) m.set(t, []);
      m.get(t).push(ch);
    }
    return [...m.entries()].map(([t, chs]) => ({ t, chs }));
  }
  // itens da faixa de eventos: checkpoints, chaves da câmera e do tema
  function eventItems(lvl) {
    const out = [];
    (lvl.checkpoints || []).forEach((c, i) => out.push({ kind: 'cp', i, t: c.t }));
    const cam = lvl.cam || {};
    for (const ch in cam) cam[ch].forEach((k, i) => out.push({ kind: 'cam', ch, i, t: k.t }));
    (lvl.theme || []).forEach((k, i) => out.push({ kind: 'theme', i, t: k.t, col: k.hz, bg: k.bg }));
    return out;
  }
  const sameEv = (a, b) => !!a && !!b && a.kind === b.kind && a.i === b.i && (a.ch || '') === (b.ch || '');
  const laneY = name => TOP + LANES.indexOf(name) * LANE;
  // largura do rótulo de um marcador na régua
  function markerLabelW(ctx, m) { ctx.font = FONT_MONO; return ctx.measureText(m.name).width + 14; }

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
    // linhas dos marcadores (atrás dos blocos)
    (app.level.markers || []).forEach((m, i) => {
      const x = Math.round(tx(m.t)) + 0.5;
      if (x < GUT || x > w) return;
      const sel = app.sel2 && app.sel2.kind === 'marker' && app.sel2.i === i;
      ctx.fillStyle = PF.kf.rgba(m.color, sel ? 0.6 : 0.28);
      ctx.fillRect(x - 0.5, RULER, sel ? 2 : 1, h - RULER);
    });
    const ordered = app.level.hazards.slice().sort((a, b) => a.time - b.time || app.isSelected(a.id) - app.isSelected(b.id));
    for (const hz of ordered) {
      const lane = LANES.indexOf(laneOf(hz));
      const [xa, xb] = blockRange(hz);
      if (xb < GUT || xa > w) continue;
      const def = PF.HAZARDS[hz.type];
      const pad = LANE >= 20 ? 4 : 3, y = TOP + lane * LANE + pad, bh = LANE - pad * 2;
      const xs = tx(hz.time), xw = tx(hz.time + def.warnLen(hz));
      const sel = app.isSelected(hz.id);

      ctx.fillStyle = 'rgba(255,77,94,0.16)';
      ctx.fillRect(xa, y, xb - xa, bh);
      ctx.fillStyle = 'rgba(255,77,94,0.5)';
      ctx.fillRect(Math.max(xa, xw), y, xb - Math.max(xa, xw), bh);
      ctx.fillStyle = C.danger;
      ctx.fillRect(xs - 1, y, 2, bh);
      if (hz.type === 'shape') { // losangos nos disparos dos gatilhos
        const ev = PF.hz.shapeEvents(hz);
        ctx.fillStyle = sel ? C.accent : '#FFD3DA';
        for (const e of ev.list) {
          const xe = tx(hz.time + hz.warn + e.at), cy = y + bh / 2;
          if (xe < xa - 4 || xe > xb + 4) continue;
          ctx.beginPath();
          ctx.moveTo(xe, cy - 4); ctx.lineTo(xe + 4, cy); ctx.lineTo(xe, cy + 4); ctx.lineTo(xe - 4, cy);
          ctx.closePath();
          ctx.fill();
        }
      }
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
        const tag = hz.type === 'group' || hz.type === 'prefab' ? '▣' : CTRL[hz.type] ? PF.HAZARDS[hz.type].label.slice(0, 3) + ' #' : '#';
        ctx.fillText(tag + hz.id + (hz.parent ? '↑' + hz.parent : '') + ' ' + timeLabel(hz.time, app), Math.max(xs, GUT) + 5, y + bh / 2 + 1);
        ctx.restore();
      }
      // keyframes: losangos coloridos por canal (só no selecionado, para não poluir)
      if (sel && !app.multi.size && hz.keys) {
        const cy = y + bh / 2, kt = keyTimes(hz), selT = app.selKey && app.selKey.id === hz.id ? app.selKey.t : null;
        for (const k of kt) {
          const xk = tx(k.t);
          if (xk < GUT - 6 || xk > w + 6) continue;
          const r = selT != null && Math.abs(selT - k.t) < 1e-4 ? 6 : 4.5;
          ctx.fillStyle = C.bg;
          ctx.beginPath();
          ctx.moveTo(xk, cy - r - 1.5); ctx.lineTo(xk + r + 1.5, cy); ctx.lineTo(xk, cy + r + 1.5); ctx.lineTo(xk - r - 1.5, cy);
          ctx.closePath();
          ctx.fill();
          // um pedaço do losango para cada canal que tem chave neste tempo
          k.chs.forEach((ch, j) => {
            ctx.fillStyle = KEY_COL[ch];
            ctx.beginPath();
            const n = k.chs.length, a0 = -Math.PI / 2 + j * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(xk, cy - r); ctx.lineTo(xk + r, cy); ctx.lineTo(xk, cy + r); ctx.lineTo(xk - r, cy);
            ctx.closePath();
            ctx.clip();
            ctx.beginPath();
            ctx.moveTo(xk, cy); ctx.arc(xk, cy, r * 2, a0, a1); ctx.closePath();
            ctx.fill();
            ctx.restore();
          });
        }
        // alça do fim do bloco (tempo de vida)
        ctx.fillStyle = C.accent;
        ctx.fillRect(xb - 2, y - 1, 3, bh + 2);
      }
    }
    drawEvents(ctx, w, app);
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
      ctx.fillStyle = type === 'events' ? C.signal : type === 'ctrl' ? C.player : C.danger;
      ctx.fillRect(12, TOP + i * LANE + LANE / 2 - 3, 6, 6);
      ctx.fillStyle = C.text;
      ctx.fillText(LANE_NAME[type] || PF.HAZARDS[type].label, 26, TOP + i * LANE + LANE / 2 + 1);
    });

    drawMarkerFlags(ctx, w, app);
    drawPlayhead(ctx, w, h, app);
  };

  // faixa de eventos da fase: checkpoints (bandeira), câmera (losango ciano), tema (quadrado na cor)
  function drawEvents(ctx, w, app) {
    const y0 = laneY('events'), cy = y0 + LANE / 2;
    for (const e of eventItems(app.level)) {
      const x = tx(e.t);
      if (x < GUT - 8 || x > w + 8) continue;
      const sel = sameEv(e, app.sel2);
      ctx.save();
      if (e.kind === 'cp') {
        ctx.fillStyle = sel ? C.accent : C.player;
        ctx.fillRect(x - 0.5, y0 + 3, 1.5, LANE - 6);
        ctx.beginPath(); ctx.moveTo(x + 1, y0 + 3); ctx.lineTo(x + 9, y0 + 6); ctx.lineTo(x + 1, y0 + 9); ctx.closePath(); ctx.fill();
      } else if (e.kind === 'cam') {
        const r = sel ? 5.5 : 4, oy = { pos: -2, zoom: 2, rot: -2, shake: 2 }[e.ch] || 0;
        ctx.fillStyle = sel ? C.accent : C.signal;
        ctx.beginPath(); ctx.moveTo(x, cy + oy - r); ctx.lineTo(x + r, cy + oy); ctx.lineTo(x, cy + oy + r); ctx.lineTo(x - r, cy + oy); ctx.closePath(); ctx.fill();
      } else {
        const r = sel ? 5 : 4;
        ctx.fillStyle = e.bg; ctx.fillRect(x - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = e.col; ctx.fillRect(x - r + 2, cy - r + 2, r * 2 - 4, r * 2 - 4);
        ctx.strokeStyle = sel ? C.accent : C.muted; ctx.lineWidth = 1;
        ctx.strokeRect(x - r + 0.5, cy - r + 0.5, r * 2 - 1, r * 2 - 1);
      }
      ctx.restore();
    }
  }

  // bandeirinhas dos marcadores na régua, com o nome (cortado no próximo marcador)
  function drawMarkerFlags(ctx, w, app) {
    const ms = app.level.markers || [];
    ctx.save();
    ctx.beginPath(); ctx.rect(GUT, 0, w - GUT, RULER); ctx.clip();
    ms.forEach((m, i) => {
      const x = Math.round(tx(m.t)) + 0.5, next = i + 1 < ms.length ? tx(ms[i + 1].t) : w;
      if (next < GUT || x > w) return;
      const sel = app.sel2 && app.sel2.kind === 'marker' && app.sel2.i === i;
      const lw = Math.min(markerLabelW(ctx, m), Math.max(10, next - x - 2));
      ctx.fillStyle = PF.kf.rgba(m.color, sel ? 0.4 : 0.2);
      ctx.fillRect(x, 1, lw, 13);
      ctx.fillStyle = m.color;
      ctx.fillRect(x - 0.5, 0, sel ? 2.5 : 1.5, RULER);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, 0, lw, 14); ctx.clip();
      ctx.font = FONT_MONO;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = sel ? '#FFFFFF' : m.color;
      ctx.fillText(m.name, x + 5, 8);
      ctx.restore();
    });
    ctx.restore();
  }

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
    const list = app.level.hazards.filter(h => laneOf(h) === type);
    const sel = list.find(h => h.id === app.selectedId);
    if (sel) list.push(sel); // o selecionado tem prioridade
    for (let i = list.length - 1; i >= 0; i--) {
      const [xa, xb] = blockRange(list[i]);
      if (x >= xa - 3 && x <= xb + 3) return list[i];
    }
    return null;
  }

  // marcador sob o mouse na régua (linha ou rótulo)
  function hitMarker(x, y) {
    if (y >= RULER) return -1;
    const ms = PF.app.level.markers || [];
    for (let i = ms.length - 1; i >= 0; i--) {
      const xm = tx(ms[i].t);
      if (Math.abs(x - xm) <= 5 || (y < 15 && x >= xm && x <= xm + markerLabelW(tl.ctx, ms[i]))) return i;
    }
    return -1;
  }
  // losango de keyframe do objeto selecionado sob o mouse: tempo absoluto ou null
  function hitKey(x, y) {
    const app = PF.app, h = app.multi.size ? null : app.selected();
    if (!h || !h.keys) return null;
    const y0 = laneY(laneOf(h));
    if (y < y0 || y > y0 + LANE) return null;
    let best = null, bd = 6;
    for (const k of keyTimes(h)) { const d = Math.abs(tx(k.t) - x); if (d <= bd) { bd = d; best = k.t; } }
    return best == null ? null : { h, t: best };
  }
  // fim do bloco selecionado (arrastar muda o tempo de vida)
  function hitEdge(x, y) {
    const app = PF.app, h = app.multi.size ? null : app.selected();
    if (!h) return null;
    const y0 = laneY(laneOf(h));
    if (y < y0 || y > y0 + LANE) return null;
    const xb = blockRange(h)[1];
    return Math.abs(x - xb) <= 4 ? h : null;
  }
  function hitEvent(x, y) {
    const y0 = laneY('events');
    if (y < y0 || y > y0 + LANE) return null;
    let best = null, bd = 7;
    for (const e of eventItems(PF.app.level)) { const d = Math.abs(tx(e.t) - x); if (d <= bd) { bd = d; best = e; } }
    return best;
  }
  // objeto do evento (marcador, checkpoint, chave da câmera/tema) para mudar o tempo
  function eventRef(lvl, e) {
    if (e.kind === 'marker') return lvl.markers[e.i];
    if (e.kind === 'cp') return lvl.checkpoints[e.i];
    if (e.kind === 'cam') return lvl.cam[e.ch] && lvl.cam[e.ch][e.i];
    if (e.kind === 'theme') return lvl.theme[e.i];
    return null;
  }
  function eventList(lvl, e) {
    if (e.kind === 'marker') return lvl.markers;
    if (e.kind === 'cp') return lvl.checkpoints;
    if (e.kind === 'cam') return lvl.cam[e.ch];
    return lvl.theme;
  }
  const snapAbs = (e, t) => u.round(u.clamp(e.altKey ? u.round(t, 2) : PF.app.snapTime(t), 0, PF.app.level.duration), 4);

  function onDbl(e) {
    const { x, y } = local(e);
    if (x < GUT) return;
    const app = PF.app;
    if (y < RULER) { app.addMarker(snapAbs(e, xt(x))); return; }
    const y0 = laneY('events');
    if (y >= y0 && y <= y0 + LANE && !hitEvent(x, y)) app.addCheckpoint(snapAbs(e, xt(x)));
  }

  function onDown(e) {
    if (e.button !== 0) return;
    const { x, y } = local(e);
    if (x < GUT) return;
    tl.canvas.setPointerCapture(e.pointerId);
    const app = PF.app;
    if (app.mode !== 'edit') { tl.drag = { kind: 'scrub' }; app.setTime(xt(x)); return; }
    const mi = hitMarker(x, y);
    if (mi >= 0) {
      const m = app.level.markers[mi];
      app.selectEvent('marker', mi);
      tl.drag = { kind: 'event', ref: m, ev: { kind: 'marker' }, grab: xt(x) - m.t, moved: false };
      return;
    }
    const hk = hitKey(x, y);
    if (hk) {
      app.selKey = { id: hk.h.id, t: hk.t };
      PF.panel.refresh();
      tl.drag = { kind: 'key', id: hk.h.id, rel: u.round(hk.t - hk.h.time, 4), moved: false };
      return;
    }
    const he = hitEdge(x, y);
    if (he) { tl.drag = { kind: 'life', id: he.id, moved: false }; return; }
    const ev = hitEvent(x, y);
    if (ev) {
      const ref = eventRef(app.level, ev);
      app.selectEvent(ev.kind, ev.i, ev.ch);
      tl.drag = { kind: 'event', ref, ev, grab: xt(x) - ref.t, moved: false };
      return;
    }
    const blk = hitBlock(x, y);
    if (blk) {
      if (e.shiftKey) { // soma/tira da seleção
        app.toggleSelect(blk.id);
        if (!app.isSelected(blk.id)) return;
      } else if (!app.isSelected(blk.id)) app.select(blk.id);
      else { app.selectedId = blk.id; PF.panel.refresh(); }
      tl.drag = { kind: 'move', id: blk.id, grab: xt(x) - blk.time, moved: false, shift: e.shiftKey, t0: blk.time };
      // vários selecionados: todos andam juntos no tempo
      if (app.multi.size) tl.drag.others = app.selection().filter(h => h.id !== blk.id).map(h => ({ h, t: h.time }));
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
      if (x < GUT) tl.canvas.style.cursor = 'default';
      else if (hitMarker(x, y) >= 0 || hitKey(x, y)) tl.canvas.style.cursor = 'pointer';
      else if (hitEdge(x, y)) tl.canvas.style.cursor = 'ew-resize';
      else tl.canvas.style.cursor = hitEvent(x, y) || hitBlock(x, y) ? 'grab' : 'default';
      return;
    }
    if (d.kind === 'scrub') { app.setTime(xt(x)); return; }
    if (d.kind === 'event') {
      const nt = snapAbs(e, xt(x) - d.grab);
      if (d.ref && nt !== d.ref.t) { d.ref.t = nt; d.moved = true; app.changed(false); }
      return;
    }
    const h = app.level.hazards.find(z => z.id === d.id);
    if (!h) return;
    if (d.kind === 'key') { // todas as chaves desse tempo andam juntas
      const nr = u.round(Math.max(0, snapAbs(e, xt(x)) - h.time), 4);
      if (nr !== d.rel) {
        for (const ch in h.keys) {
          for (const k of h.keys[ch]) if (Math.abs(k.t - d.rel) < 1e-4) k.t = nr;
          PF.kf.sortTrack(h.keys[ch]);
        }
        d.rel = nr; d.moved = true;
        app.selKey = { id: h.id, t: u.round(h.time + nr, 4) };
        app.changed(false);
      }
      return;
    }
    if (d.kind === 'life') {
      const def = PF.HAZARDS[h.type], len = Math.max(0.05, snapAbs(e, xt(x)) - h.time);
      if (def.lifeKey) { // âncora/partículas/ativador: muda a duração do próprio objeto
        const extra = def.length(h) - h[def.lifeKey], p = def.props.find(q => q.key === def.lifeKey);
        const v = u.round(u.clamp(len - extra, p.min, p.max), 4);
        if (v !== h[def.lifeKey]) { h[def.lifeKey] = v; d.moved = true; app.changed(false); }
      } else {
        const nat = def.length(h);
        if (len >= nat - 1e-3) { if (h.life) { delete h.life; d.moved = true; app.changed(false); } }
        else if (h.life !== u.round(len, 4)) { h.life = u.round(len, 4); d.moved = true; app.changed(false); }
      }
      tl.canvas.style.cursor = 'ew-resize';
      return;
    }
    let nt = xt(x) - d.grab;
    nt = e.altKey ? u.round(nt, 2) : app.snapTime(nt);
    nt = u.round(u.clamp(nt, 0, app.level.duration), 4);
    if (nt !== h.time) {
      h.time = nt; d.moved = true;
      if (d.others) for (const o of d.others) o.h.time = u.round(u.clamp(o.t + nt - d.t0, 0, app.level.duration), 4);
      app.changed(false);
    }
    tl.canvas.style.cursor = 'grabbing';
  }

  function onUp() {
    const d = tl.drag;
    if (d && d.kind === 'event' && d.moved) { // reordena e mantém o mesmo item escolhido
      const lvl = PF.app.level, list = eventList(lvl, d.ev);
      if (list) {
        PF.kf.sortTrack(list);
        if (PF.app.sel2) PF.app.sel2.i = list.indexOf(d.ref);
      }
      PF.panel.rebuild();
      PF.app.commit();
    } else if (d && (d.kind === 'key' || d.kind === 'life') && d.moved) { PF.panel.rebuild(); PF.app.commit(); }
    else if (d && d.kind === 'move' && d.moved) PF.app.commit();
    // clique sem arrastar num bloco de uma seleção múltipla: fica só ele
    else if (d && d.kind === 'move' && !d.shift && PF.app.multi.size) PF.app.select(d.id);
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

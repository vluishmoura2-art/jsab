// Estado do app, entrada do usuário, modo teste e loop principal.
(function () {
  const { W, H, u } = PF;
  const $ = id => document.getElementById(id);

  const app = PF.app = {
    level: null,
    t: 0,
    playing: false,
    selectedId: null,
    tool: 'select',
    mode: 'edit', // 'edit' | 'test'
    test: null,
    history: [],
    hIndex: -1,

    selected() { return this.level.hazards.find(h => h.id === this.selectedId) || null; },
    spawnSelected: false,
    // seleção múltipla (Shift+clique, Ctrl+A): ids; vazio = só selectedId
    multi: new Set(),
    isSelected(id) { return id === this.selectedId || this.multi.has(id); },
    selection() {
      const ids = this.multi.size ? this.multi : new Set(this.selectedId == null ? [] : [this.selectedId]);
      return this.level.hazards.filter(h => ids.has(h.id));
    },

    select(id) { this.selectedId = id; this.multi.clear(); this.spawnSelected = false; this.vtx = null; PF.panel.refresh(); },
    vtx: null, // ponto escolhido do caminho selecionado (Delete apaga)
    pen: null, // caneta desenhando: { id, down, free, sx, sy, lx, ly, hover }
    // soma/tira da seleção (Shift+clique)
    toggleSelect(id) {
      if (!this.multi.size && this.selectedId != null) this.multi.add(this.selectedId);
      if (this.multi.has(id)) this.multi.delete(id); else this.multi.add(id);
      if (this.multi.size <= 1) {
        const only = [...this.multi][0];
        this.multi.clear();
        this.selectedId = only == null ? null : only;
      } else this.selectedId = this.multi.has(id) ? id : [...this.multi].pop();
      this.spawnSelected = false;
      PF.panel.refresh();
    },
    selectAll() {
      const hs = this.level.hazards;
      if (!hs.length) return;
      this.multi = new Set(hs.map(h => h.id));
      this.selectedId = hs[hs.length - 1].id;
      if (this.multi.size === 1) this.multi.clear();
      PF.panel.refresh();
    },
    setTime(t) {
      this.t = u.clamp(t, 0, this.level.duration);
      if (this.playing) PF.audio.play(this.t); // reposiciona a música junto
    },
    changed(commit) { PF.panel.refresh(); if (commit) this.commit(); },

    // ---- ritmo: grade de batidas ----
    snapOn: true,
    snapDiv: 4, // subdivisões por batida: 1, 2, 3, 4 ou 8
    beatLen() { return this.level.bpm > 0 ? 60 / this.level.bpm : 0; },
    // encaixa um tempo na grade (batida/snapDiv); sem BPM usa passos de 0,05 s
    snapTime(t) {
      const b = this.beatLen();
      if (!b || !this.snapOn) return u.round(Math.round(t / 0.05) * 0.05, 2);
      const step = b / this.snapDiv, o = this.level.offset;
      return u.round(o + Math.round((t - o) / step) * step, 4);
    },
    // batida (ou compasso) seguinte/anterior a partir de t
    stepBeat(t, dir, bar) {
      const b = this.beatLen() * (bar ? this.level.beatsPerBar : 1), o = this.level.offset;
      const i = (t - o) / b;
      const n = dir > 0 ? Math.floor(i + 1e-6) + 1 : Math.ceil(i - 1e-6) - 1;
      return o + n * b;
    },

    editLevel: null, // fase do editor guardada enquanto uma fase online é jogada

    commit() {
      if (this.editLevel) return; // nunca salvar a fase online por cima da sua
      const snap = JSON.stringify(this.level);
      if (this.history[this.hIndex] !== snap) {
        this.history = this.history.slice(0, this.hIndex + 1);
        this.history.push(snap);
        if (this.history.length > 200) this.history.shift();
        this.hIndex = this.history.length - 1;
      }
      PF.storage.save(this.level);
      updateUndo();
    },
    undo() { if (this.hIndex > 0) { this.hIndex--; this.restore(); } },
    redo() { if (this.hIndex < this.history.length - 1) { this.hIndex++; this.restore(); } },
    restore() {
      this.level = PF.storage.normalize(JSON.parse(this.history[this.hIndex]));
      if (!this.selected()) this.selectedId = null;
      const ids = new Set(this.level.hazards.map(h => h.id));
      for (const id of [...this.multi]) if (!ids.has(id)) this.multi.delete(id);
      if (this.multi.size === 1) this.multi.clear();
      this.setTime(this.t);
      PF.panel.rebuild();
      PF.storage.save(this.level);
      updateUndo();
    },

    deleteSelected() {
      const ids = new Set(this.selection().map(h => h.id));
      if (!ids.size) return;
      this.level.hazards = this.level.hazards.filter(h => !ids.has(h.id));
      this.selectedId = null;
      this.multi.clear();
      PF.panel.rebuild();
      this.commit();
    },
    // Remove todos os perigos da fase (nome, duração, início e música ficam). Ctrl+Z desfaz.
    clearAll() {
      if (this.editLevel || !this.level.hazards.length) return;
      const n = this.level.hazards.length;
      if (!confirm(`Apagar todos os ${n} perigo(s) da fase? Você pode desfazer com Ctrl+Z.`)) return;
      pause();
      this.level.hazards = [];
      this.selectedId = null;
      PF.panel.rebuild();
      this.commit();
      if (PF.toast) PF.toast(`${n} perigo(s) apagado(s) · Ctrl+Z desfaz`);
    },
    // ---- copiar / colar ----
    clipboard: null, // cópia (JSON) do perigo copiado

    copy() {
      const list = this.selection();
      if (!list.length || this.editLevel) return false;
      this.clipboard = JSON.stringify(list);
      if (PF.toast) PF.toast((list.length > 1 ? list.length + ' perigos copiados' : PF.HAZARDS[list[0].type].label + ' copiada') + ' · Ctrl+V cola no tempo do playhead');
      return true;
    },
    // seleciona uma lista recém-criada (um só = seleção simples)
    selectList(list) {
      this.select(list.length ? list[list.length - 1].id : null);
      if (list.length > 1) { for (const c of list) this.multi.add(c.id); PF.panel.refresh(); }
    },
    // Cola no tempo atual do playhead (o mais cedo vai para lá, os outros mantêm a distância);
    // se for o mesmo tempo do original, desloca um pouco no mapa.
    paste() {
      if (!this.clipboard || this.editLevel) return;
      let src = JSON.parse(this.clipboard);
      if (!Array.isArray(src)) src = [src];
      const t0 = Math.min(...src.map(h => h.time));
      const to = u.round(u.clamp(this.t, 0, this.level.duration), 2), same = Math.abs(to - t0) < 0.01;
      const out = src.map(h => {
        const c = PF.hz.clone(h);
        c.time = u.round(u.clamp(to + (h.time - t0), 0, this.level.duration), 4);
        if (same) { c.x = u.clamp(c.x + 30, -400, W + 400); c.y = u.clamp(c.y + 30, -400, H + 400); }
        return c;
      });
      this.level.hazards.push(...out);
      this.clipboard = JSON.stringify(out); // colar de novo continua deslocando
      this.selectList(out);
      this.commit();
    },
    // Copiar e colar de uma vez: cópias no mesmo tempo, um pouco ao lado.
    duplicate() {
      const list = this.selection();
      if (!list.length || this.editLevel) return;
      const out = list.map(h => {
        const c = PF.hz.clone(h);
        c.x = u.clamp(c.x + 30, -400, W + 400);
        c.y = u.clamp(c.y + 30, -400, H + 400);
        return c;
      });
      this.level.hazards.push(...out);
      this.selectList(out);
      this.commit();
    },
  };

  // no editor, gatilhos reativos mostram uma prévia com o jogador parado no início da fase
  PF.hz.preview = true;

  // ---------- arena ----------
  const stage = $('stage');
  const sctx = stage.getContext('2d');
  const view = { scale: 1, k: 1 };

  function resizeStage() {
    const r = $('stage-wrap').getBoundingClientRect();
    const aw = r.width - 32, ah = r.height - 32;
    let cw = aw;
    if (cw * H / W > ah) cw = ah * W / H;
    cw = Math.max(160, Math.floor(cw));
    const ch = Math.floor(cw * H / W);
    stage.style.width = cw + 'px';
    stage.style.height = ch + 'px';
    const dpr = window.devicePixelRatio || 1;
    stage.width = Math.round(cw * dpr);
    stage.height = Math.round(ch * dpr);
    view.scale = cw / W;
    view.k = view.scale * dpr;
  }

  function toWorld(e) {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }

  function pick(x, y) {
    const tol = 10 / view.scale;
    const list = app.level.hazards;
    const sel = app.selected();
    if (sel && PF.HAZARDS[sel.type].hit(sel, x, y, tol)) return sel;
    const inWin = h => { const [a, b] = PF.hz.window(h); return app.t >= a && app.t <= b; };
    for (const pass of [inWin, () => true]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const h = list[i];
        if (pass(h) && PF.HAZARDS[h.type].hit(h, x, y, tol)) return h;
      }
    }
    return null;
  }

  let drag = null;
  stage.addEventListener('pointerdown', e => {
    if (app.mode !== 'edit' || e.button !== 0) return;
    const p = toWorld(e);
    stage.setPointerCapture(e.pointerId);
    if (app.tool === 'pen') { penDown(p); return; }
    if (app.tool !== 'select') {
      // com BPM e encaixe ligado, nasce na batida mais perto da agulha
      const t0 = app.level.bpm > 0 && app.snapOn ? app.snapTime(app.t) : u.round(app.t, 2);
      const h = PF.hz.create(app.tool, Math.round(p.x), Math.round(p.y), u.clamp(t0, 0, app.level.duration));
      app.level.hazards.push(h);
      app.select(h.id);
      drag = { id: h.id, dx: 0, dy: 0, moved: true };
      return;
    }
    // alças da Forma selecionada: giro, tamanho, e Alt+arrastar para mudar o pivô
    const cur = app.multi.size ? null : app.selected();
    if (cur && cur.type === 'group' && !e.shiftKey) {
      const near = q => Math.hypot(p.x - q[0], p.y - q[1]) <= 9 / view.scale;
      if (near(PF.groupHandles(cur, view.scale).rot)) { drag = { id: cur.id, kind: 'grot', moved: false }; return; }
      if (e.altKey && PF.HAZARDS.group.hit(cur, p.x, p.y, 10 / view.scale)) { drag = { id: cur.id, kind: 'gpivot', moved: false }; return; }
    }
    if (cur && cur.type === 'shape' && cur.kind === 4) {
      const vi = vertexAt(cur, p);
      if (vi < 0 && !e.shiftKey) app.vtx = null;
      if (vi >= 0 && !e.shiftKey) {
        app.vtx = vi;
        drag = { id: cur.id, kind: 'vtx', vi, moved: false };
        return;
      }
      if (e.shiftKey) { // Shift+clique na borda: ponto novo ali (e já dá para arrastar)
        const ed = edgeAt(cur, p);
        if (ed && cur.pts.length < PF.hz.MAX_PTS * 2) {
          cur.pts.splice((ed.i + 1) * 2, 0, u.round(ed.x, 2), u.round(ed.y, 2));
          app.vtx = ed.i + 1;
          drag = { id: cur.id, kind: 'vtx', vi: ed.i + 1, moved: true };
          app.changed(false);
          return;
        }
      }
    }
    if (cur && cur.type === 'shape' && !e.shiftKey) {
      const hd = PF.shapeHandles(cur, view.scale), near = q => Math.hypot(p.x - q[0], p.y - q[1]) <= 9 / view.scale;
      for (const c of hd.path) {
        for (const q of c.pts) {
          if (near([q.x, q.y])) { drag = { id: cur.id, kind: 'path', bi: c.bi, kx: q.kx, ky: q.ky, ox: c.ox, oy: c.oy, moved: false }; return; }
        }
      }
      if (near(hd.rot)) {
        // ângulo do pivô até a alça, sem a rotação: a alça fica embaixo do mouse ao girar
        const [lx, ly] = [hd.rotLocal[0] - cur.pivotX, hd.rotLocal[1] - cur.pivotY];
        drag = { id: cur.id, kind: 'rot', base: Math.atan2(ly, lx) * 180 / Math.PI, moved: false };
        return;
      }
      if (hd.size && near(hd.size)) { drag = { id: cur.id, kind: 'size', moved: false }; return; }
      if (e.altKey && PF.HAZARDS.shape.hit(cur, p.x, p.y, 10 / view.scale)) {
        drag = { id: cur.id, kind: 'pivot', moved: false };
        return;
      }
    }
    const sp = app.level.spawn;
    if (Math.hypot(p.x - sp.x, p.y - sp.y) <= 16) {
      app.select(null);
      app.spawnSelected = true;
      drag = { spawn: true, dx: sp.x - p.x, dy: sp.y - p.y, moved: false };
      return;
    }
    const h = pick(p.x, p.y);
    if (h) {
      if (e.shiftKey) { // soma/tira da seleção
        app.toggleSelect(h.id);
        if (!app.isSelected(h.id)) return;
      } else if (!app.isSelected(h.id)) app.select(h.id);
      else { app.selectedId = h.id; PF.panel.refresh(); }
      const hy = h.type === 'water' ? H - h.height : h.y; // na água a alça fica na superfície
      drag = { id: h.id, dx: h.x - p.x, dy: hy - p.y, moved: false, shift: e.shiftKey };
      if (app.multi.size) { // vários: todos andam juntos
        drag.others = app.selection().filter(z => z.id !== h.id && z.type !== 'water').map(z => ({ z, x: z.x, y: z.y }));
        drag.x0 = h.x; drag.y0 = h.y;
      }
    } else if (!e.shiftKey) {
      app.select(null);
    }
  });
  stage.addEventListener('pointermove', e => {
    if (app.mode !== 'edit') return;
    const p = toWorld(e);
    if (app.pen) { penMove(p); return; }
    if (!drag) {
      if (app.tool === 'select') {
        const sp = app.level.spawn;
        const overSpawn = Math.hypot(p.x - sp.x, p.y - sp.y) <= 16;
        const cur = app.multi.size ? null : app.selected();
        if (cur && cur.type === 'group') {
          const near = q => Math.hypot(p.x - q[0], p.y - q[1]) <= 9 / view.scale;
          if (near(PF.groupHandles(cur, view.scale).rot)) { stage.style.cursor = 'grab'; return; }
          if (e.altKey && PF.HAZARDS.group.hit(cur, p.x, p.y, 10 / view.scale)) { stage.style.cursor = 'crosshair'; return; }
        }
        if (cur && cur.type === 'shape') {
          const hd = PF.shapeHandles(cur, view.scale), near = q => Math.hypot(p.x - q[0], p.y - q[1]) <= 9 / view.scale;
          if (hd.path.some(c => c.pts.some(q => near([q.x, q.y])))) { stage.style.cursor = 'move'; return; }
          if (near(hd.rot)) { stage.style.cursor = 'grab'; return; }
          if (hd.size && near(hd.size)) { stage.style.cursor = 'nwse-resize'; return; }
          if (hd.verts.some(v => near(v))) { stage.style.cursor = 'move'; return; }
          if (e.altKey && PF.HAZARDS.shape.hit(cur, p.x, p.y, 10 / view.scale)) { stage.style.cursor = 'crosshair'; return; }
        }
        stage.style.cursor = overSpawn || pick(p.x, p.y) ? 'move' : 'default';
      }
      return;
    }
    const h = drag.spawn ? app.level.spawn : app.level.hazards.find(z => z.id === drag.id);
    if (!h) return;
    if (drag.kind) { shapeDrag(h, p, e); return; }
    let nx = p.x + drag.dx, ny = p.y + drag.dy;
    if (e.shiftKey) { nx = Math.round(nx / 40) * 40; ny = Math.round(ny / 40) * 40; }
    const m = drag.spawn ? -12 : 400; // o início do jogador fica dentro da arena
    nx = u.clamp(Math.round(nx), -m, W + m);
    ny = u.clamp(Math.round(ny), -m, H + m);
    if (h.type === 'water') {
      // arrastar a água muda a altura (a final acompanha se as duas eram iguais)
      const hgt = u.clamp(H - ny, 10, 700);
      if (hgt !== h.height) {
        if (h.heightEnd === h.height) h.heightEnd = hgt;
        h.height = hgt; h.y = H - hgt; h.x = u.clamp(nx, 20, W - 20);
        drag.moved = true; app.changed(false);
      }
      return;
    }
    if (nx !== h.x || ny !== h.y) {
      h.x = nx; h.y = ny; drag.moved = true;
      if (drag.others) {
        const dx = nx - drag.x0, dy = ny - drag.y0;
        for (const o of drag.others) { o.z.x = u.clamp(o.x + dx, -400, W + 400); o.z.y = u.clamp(o.y + dy, -400, H + 400); }
      }
      app.changed(false);
    }
  });
  // arrastar uma alça da Forma
  function shapeDrag(h, p, e) {
    const set = (k, v) => { if (h[k] !== v) { h[k] = v; drag.moved = true; } };
    if (drag.kind === 'vtx') {
      let q = p;
      if (e.shiftKey) q = { x: Math.round(p.x / 20) * 20, y: Math.round(p.y / 20) * 20 }; // Shift: grade de 20 px
      const [lx, ly] = PF.m.apply(PF.m.invert(PF.hz.shapeMatrix(h)), q.x, q.y);
      const i = drag.vi * 2, nx = u.round(u.clamp(lx, -3000, 3000), 2), ny = u.round(u.clamp(ly, -3000, 3000), 2);
      if (h.pts[i] !== nx || h.pts[i + 1] !== ny) { h.pts[i] = nx; h.pts[i + 1] = ny; drag.moved = true; }
    } else if (drag.kind === 'grot') { // a alça fica acima do pivô quando a rotação é 0
      let a = Math.atan2(p.y - h.y, p.x - h.x) * 180 / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      set('rot', ((Math.round(a) + 540) % 360) - 180);
    } else if (drag.kind === 'gpivot') {
      // pivô coletivo vai para o mouse e as formas ficam paradas: itens andam o contrário
      const [lx, ly] = PF.m.apply(PF.m.invert(PF.hz.copyMatrices(h)[0]), p.x, p.y);
      if (Math.abs(lx) + Math.abs(ly) > 0.5) {
        for (const it of h.items) { it.x = u.round(it.x - lx, 2); it.y = u.round(it.y - ly, 2); }
        h.x = u.round(p.x, 2); h.y = u.round(p.y, 2);
        drag.moved = true;
      }
    } else if (drag.kind === 'path') {
      const b = h.behaviors[drag.bi];
      if (!b) return;
      let nx = p.x - drag.ox, ny = p.y - drag.oy;
      if (e.shiftKey) { nx = Math.round(nx / 40) * 40; ny = Math.round(ny / 40) * 40; }
      nx = u.clamp(Math.round(nx), -3000, 3000); ny = u.clamp(Math.round(ny), -3000, 3000);
      if (b[drag.kx] !== nx || b[drag.ky] !== ny) { b[drag.kx] = nx; b[drag.ky] = ny; drag.moved = true; }
    } else if (drag.kind === 'rot') {
      let a = Math.atan2(p.y - h.y, p.x - h.x) * 180 / Math.PI - drag.base;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      a = ((Math.round(a) + 540) % 360) - 180; // -180..180
      set('rot', a);
    } else if (drag.kind === 'size') {
      // mouse nas coords locais da forma (centro em 0,0): tamanho = 2× a distância ao centro
      const [lx, ly] = PF.m.apply(PF.m.invert(PF.hz.shapeMatrix(h)), p.x, p.y);
      let w = Math.abs(lx) * 2, hh = Math.abs(ly) * 2;
      if (e.shiftKey && h.kind !== 3) { const s = Math.max(w, hh); w = hh = s; }
      set('w', u.clamp(Math.round(w), 4, 3000));
      if (h.kind !== 3) set('h', u.clamp(Math.round(hh), 2, 3000)); // no laser a altura é a grossura
    } else if (drag.kind === 'pivot') {
      // o pivô vai para o mouse e a forma fica parada: converte o ponto para coords locais
      const [lx, ly] = PF.m.apply(PF.m.invert(PF.hz.shapeMatrix(h)), p.x, p.y);
      let nx = Math.round(p.x), ny = Math.round(p.y), px = Math.round(lx), py = Math.round(ly);
      if (e.shiftKey && Math.hypot(lx, ly) < 24 / view.scale) { // Shift perto do centro: volta para o centro
        const [cx, cy] = PF.m.apply(PF.hz.shapeMatrix(h), 0, 0);
        nx = cx; ny = cy; px = 0; py = 0;
      }
      if (px !== h.pivotX || py !== h.pivotY) {
        h.pivotX = u.clamp(px, -1500, 1500); h.pivotY = u.clamp(py, -1500, 1500);
        h.x = u.clamp(nx, -400, W + 400); h.y = u.clamp(ny, -400, H + 400);
        drag.moved = true;
      }
    }
    if (drag.moved) app.changed(false);
  }
  const endDrag = () => {
    if (app.pen) { penUp(); return; }
    if (drag && drag.moved) app.commit();
    // clique (sem arrastar) num item de uma seleção múltipla: fica só ele
    else if (drag && !drag.shift && !drag.kind && !drag.spawn && app.multi.size) app.select(drag.id);
    drag = null;
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', () => { if (app.pen) finishPen(); });

  // ---------- pontos do caminho ----------
  function vertexAt(h, p) {
    const m = PF.hz.shapeMatrix(h);
    for (let i = h.pts.length / 2 - 1; i >= 0; i--) {
      const [x, y] = PF.m.apply(m, h.pts[i * 2], h.pts[i * 2 + 1]);
      if (Math.hypot(p.x - x, p.y - y) <= 8 / view.scale) return i;
    }
    return -1;
  }
  // borda mais perto do mouse: índice do ponto antes dela e o ponto (coords locais) onde dividir
  function edgeAt(h, p) {
    const inv = PF.m.invert(PF.hz.shapeMatrix(h)), [lx, ly] = PF.m.apply(inv, p.x, p.y), P = h.pts, n = P.length / 2;
    const k = Math.hypot(inv[0], inv[1]); // px do mundo → px locais
    let best = null;
    for (let i = 0, segs = h.closed ? n : n - 1; i < segs; i++) {
      const j = (i + 1) % n, ax = P[i * 2], ay = P[i * 2 + 1], bx = P[j * 2], by = P[j * 2 + 1];
      const d = u.distToSeg(lx, ly, ax, ay, bx, by);
      if (d <= 8 / view.scale * k && (!best || d < best.d)) {
        const dx = bx - ax, dy = by - ay, t = u.clamp(((lx - ax) * dx + (ly - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        best = { i, d, x: ax + dx * t, y: ay + dy * t };
      }
    }
    return best;
  }
  function deleteVertex() {
    const h = app.selected();
    if (!h || h.type !== 'shape' || h.kind !== 4 || app.vtx == null) return false;
    if (h.pts.length / 2 <= (h.closed ? 3 : 2)) { if (PF.toast) PF.toast('O caminho precisa de pelo menos ' + (h.closed ? 3 : 2) + ' pontos', 'info', 'vtx'); return true; }
    h.pts.splice(app.vtx * 2, 2);
    app.vtx = null;
    app.changed(true);
    return true;
  }

  // ---------- caneta (clique = ponto, arrastar = pincel) ----------
  const penShape = () => app.pen && app.level.hazards.find(z => z.id === app.pen.id);
  function penPoint(h, p) {
    const [lx, ly] = PF.m.apply(PF.m.invert(PF.hz.shapeMatrix(h)), p.x, p.y);
    h.pts.push(u.round(lx, 2), u.round(ly, 2));
    app.changed(false);
  }
  function penDown(p) {
    let h = penShape();
    if (!h) {
      const t0 = app.level.bpm > 0 && app.snapOn ? app.snapTime(app.t) : u.round(app.t, 2);
      h = PF.hz.create('shape', Math.round(p.x), Math.round(p.y), u.clamp(t0, 0, app.level.duration));
      Object.assign(h, { kind: 4, pts: [0, 0], closed: 0, smooth: 0, hollow: 0, stroke: 12 });
      app.level.hazards.push(h);
      app.select(h.id);
      app.pen = { id: h.id, down: true, free: false, sx: p.x, sy: p.y, lx: p.x, ly: p.y, hover: p };
      return;
    }
    const m = PF.hz.shapeMatrix(h), n = h.pts.length / 2, [fx, fy] = PF.m.apply(m, h.pts[0], h.pts[1]);
    if (n >= 3 && Math.hypot(p.x - fx, p.y - fy) <= 10 / view.scale) { h.closed = 1; finishPen(); return; } // fecha no 1º ponto
    if (n >= PF.hz.MAX_PTS) { finishPen(); return; }
    penPoint(h, p);
    Object.assign(app.pen, { down: true, free: false, sx: p.x, sy: p.y, lx: p.x, ly: p.y });
  }
  function penMove(p) {
    const pen = app.pen, h = penShape();
    pen.hover = p;
    if (!h || !pen.down) return;
    if (!pen.free && Math.hypot(p.x - pen.sx, p.y - pen.sy) > 8 / view.scale) pen.free = true; // virou pincel
    if (pen.free && Math.hypot(p.x - pen.lx, p.y - pen.ly) >= 10 / view.scale && h.pts.length < PF.hz.MAX_PTS * 2) {
      penPoint(h, p);
      pen.lx = p.x; pen.ly = p.y;
    }
  }
  function penUp() {
    const pen = app.pen, h = penShape();
    if (!pen) return;
    if (pen.down && pen.free && h) { // traço livre: limpa os pontos e termina
      h.pts = PF.geo.simplify(h.pts, false, 2.5);
      finishPen();
      return;
    }
    pen.down = false;
  }
  // termina o desenho: tira pontos repetidos, põe o pivô no centro e salva
  function finishPen() {
    const h = penShape();
    app.pen = null;
    if (!h) return;
    h.pts = PF.geo.merge(h.pts, !!h.closed, 1.5);
    if (h.pts.length < 4) {
      app.level.hazards = app.level.hazards.filter(z => z.id !== h.id);
      app.select(null);
      return;
    }
    if (h.closed && h.pts.length < 6) h.closed = 0;
    PF.geo.recenter(h);
    const [cx, cy] = PF.m.apply(PF.hz.shapeMatrix(h), 0, 0); // pivô no centro do desenho
    h.x = u.round(cx, 2); h.y = u.round(cy, 2); h.pivotX = 0; h.pivotY = 0;
    app.select(h.id);
    PF.panel.rebuild();
    app.commit();
  }

  // ---------- barra de ferramentas ----------
  const ICON = {
    select: '<path d="M5 3l14 8-6 1.6L10 19z"/>',
    ball: '<circle cx="9" cy="12" r="5" fill="currentColor"/><path d="M16 12h6M19 9l3 3-3 3"/>',
    explosive: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    line: '<path d="M3 19L21 5" stroke-width="3.5" stroke-linecap="round"/>',
    circle: '<circle cx="12" cy="12" r="8" stroke-width="3"/>',
    thunder: '<path d="M4 6.5a3 3 0 0 1 5-2 3.5 3.5 0 0 1 6.5 0 3 3 0 0 1 4.5 2.5H4z" fill="currentColor"/><path d="M12.5 10l-2.5 4h3l-2 4.5" stroke-linecap="round"/><circle cx="6" cy="13" r="1" fill="currentColor"/><circle cx="18" cy="15" r="1" fill="currentColor"/><circle cx="16" cy="20" r="1" fill="currentColor"/>',
    double: '<circle cx="9" cy="4.5" r="2.6" fill="currentColor"/><circle cx="15" cy="8.5" r="2.2"/><circle cx="9" cy="12.5" r="2.2"/><circle cx="15" cy="16.5" r="2.6" fill="currentColor"/><circle cx="9" cy="20" r="2.2"/>',
    water: '<path d="M3 21V13c2 0 2.5-2 4.5-2s2.5 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2v8z" fill="currentColor"/><path d="M8 7c1.5-1 3-1 4.5 0M12 4c1.5-1 3-1 4.5 0" stroke-linecap="round"/>',
    wheel: '<circle cx="12" cy="4.5" r="2.3"/><circle cx="19.5" cy="12" r="2.3"/><circle cx="12" cy="19.5" r="2.3"/><circle cx="4.5" cy="12" r="2.3"/><circle cx="17.3" cy="6.7" r="1.6" fill="currentColor" stroke="none"/><circle cx="6.7" cy="17.3" r="1.6" fill="currentColor" stroke="none"/><circle cx="17.3" cy="17.3" r="1.6" fill="currentColor" stroke="none"/><circle cx="6.7" cy="6.7" r="1.6" fill="currentColor" stroke="none"/>',
    spike: '<path d="M10 3h8a2.5 2.5 0 0 1 2.5 2.5V21H10l-4-2 4-2-4-2 4-2-4-2 4-2-4-2 4-2-4-2z" fill="currentColor"/>',
    curve: '<rect x="13.5" y="2.5" width="6" height="6" transform="rotate(20 16.5 5.5)" fill="currentColor"/><rect x="8" y="10" width="4.5" height="4.5" transform="rotate(40 10.25 12.25)" fill="currentColor" stroke="none"/><rect x="3.5" y="17" width="3.2" height="3.2" transform="rotate(55 5.1 18.6)" fill="currentColor" stroke="none"/>',
    pen: '<path d="M4 20l3-9 9-8 5 5-8 9z"/><path d="M7 11l6 6"/><circle cx="4" cy="20" r="1.4" fill="currentColor"/>',
    shape: '<circle cx="8" cy="8" r="5"/><path d="M12 12h9v9h-9z" fill="currentColor"/><path d="M15.5 2.5l4.5 7.5h-9z"/><path d="M3 21l6-6" stroke-width="2.6" stroke-linecap="round"/>',
    snake: '<rect x="15" y="8" width="7" height="7" fill="currentColor"/><rect x="8.5" y="9" width="5" height="5" fill="currentColor" stroke="none"/><rect x="3" y="10" width="3.5" height="3.5" fill="currentColor" stroke="none"/>',
  };
  // agrupadas por comportamento; o nome fica no tooltip, a tecla no canto
  const TOOL_GROUPS = [
    { label: null, tools: [{ id: 'select', label: 'Selecionar', key: 'V' }] },
    { label: 'PROJÉTIL', tools: [
      { id: 'ball', label: 'Bola', key: '1' },
      { id: 'explosive', label: 'Bola explosiva', key: '2' },
      { id: 'wheel', label: 'Roda', key: '9' },
    ] },
    { label: 'ZONA', tools: [
      { id: 'line', label: 'Linha', key: '3' },
      { id: 'circle', label: 'Círculo', key: '4' },
      { id: 'double', label: 'Linha dupla', key: '7' },
      { id: 'water', label: 'Água', key: '8' },
    ] },
    { label: 'CORPO', tools: [
      { id: 'snake', label: 'Rastro', key: '5' },
      { id: 'curve', label: 'Rastro curvo', key: 'C' },
      { id: 'spike', label: 'Plataforma pontuda', key: '0' },
    ] },
    { label: 'CLIMA', tools: [{ id: 'thunder', label: 'Trovão', key: '6' }] },
    { label: 'MANUAL', tools: [
      { id: 'shape', label: 'Forma livre', key: 'F' },
      { id: 'pen', label: 'Caneta: clique = ponto, arrastar = pincel, clique no 1º ponto fecha, Enter/duplo clique termina', key: 'P' },
    ] },
  ];
  const toolbar = $('toolbar');
  const toolBtns = {};
  const groupLabel = text => {
    const d = document.createElement('div');
    d.className = 'pf-group-label shrink-0';
    d.textContent = text;
    toolbar.appendChild(d);
  };
  for (const g of TOOL_GROUPS) {
    if (g.label) groupLabel(g.label);
    for (const t of g.tools) {
      const b = document.createElement('button');
      b.className = 'pf-tool' + (t.id === 'select' ? '' : ' hazard');
      b.title = t.label + ' (' + t.key + ')';
      b.setAttribute('aria-label', t.label);
      b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${ICON[t.id]}</svg>` +
        `<span class="kbd">${t.key}</span>`;
      b.addEventListener('click', () => setTool(t.id));
      toolbar.appendChild(b);
      toolBtns[t.id] = b;
    }
  }
  // atalhos de edição (abaixo das ferramentas)
  const EDIT_ICON = {
    copy: '<path d="M8 8h12v12H8z"/><path d="M16 8V4H4v12h4"/>',
    paste: '<path d="M5 4h14v17H5z"/><path d="M9 4V2.5h6V4M9 11h6M9 15h4"/>',
    dup: '<path d="M3 3h11v11H3z"/><path d="M10 10h11v11H10z"/><path d="M15.5 13.5v4M13.5 15.5h4"/>',
    group: '<path d="M2 6V2h4M18 2h4v4M22 18v4h-4M6 22H2v-4"/><circle cx="9" cy="9" r="3"/><path d="M13 12h6v6h-6z"/><path d="M6 19l3-5 3 5z"/>',
  };
  const EDITS = [
    { id: 'copy', label: 'Copiar', key: 'Ctrl+C', short: '^C', run: () => app.copy(), needs: () => !!app.selected() },
    { id: 'paste', label: 'Colar', key: 'Ctrl+V', short: '^V', run: () => app.paste(), needs: () => !!app.clipboard },
    { id: 'dup', label: 'Copiar e colar', key: 'Ctrl+D', short: '^D', run: () => app.duplicate(), needs: () => !!app.selected() },
    { id: 'group', label: 'Agrupar (Shift+clique soma à seleção)', key: 'Ctrl+G', short: '^G', run: () => PF.mass.group(), needs: () => app.selection().some(h => h.type === 'shape' || h.type === 'group') },
  ];
  groupLabel('EDITAR');
  for (const t of EDITS) {
    const b = document.createElement('button');
    b.className = 'pf-tool pf-tool-edit';
    b.title = t.label + ' (' + t.key + ')';
    b.setAttribute('aria-label', t.label);
    b.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${EDIT_ICON[t.id]}</svg>` +
      `<span class="kbd">${t.short}</span>`;
    b.addEventListener('click', t.run);
    toolbar.appendChild(b);
    t.btn = b;
  }
  // habilita/desabilita conforme a seleção e a área de cópia (chamado a cada quadro)
  function updateEditButtons() {
    const editing = app.mode === 'edit';
    for (const t of EDITS) {
      const off = !editing || !t.needs();
      if (t.btn.disabled !== off) t.btn.disabled = off;
    }
  }

  function setTool(id) {
    if (app.pen && id !== 'pen') finishPen();
    app.tool = id;
    for (const k in toolBtns) toolBtns[k].classList.toggle('active', k === id);
    stage.classList.toggle('placing', id !== 'select');
    if (id !== 'select') stage.style.cursor = '';
  }

  // ---------- transporte e cabeçalho ----------
  const svg16 = (body, size = 12, fill = 'currentColor') =>
    `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="${fill}" stroke="currentColor" stroke-width="1.5">${body}</svg>`;
  const BTN_HTML = {
    play: svg16('<path d="M4 2.5v11L13 8z" stroke="none"/>') + 'Tocar',
    pause: svg16('<rect x="3.5" y="3" width="3" height="10" stroke="none"/><rect x="9.5" y="3" width="3" height="10" stroke="none"/>') + 'Pausar',
    test: svg16('<path d="M8 1l7 7-7 7-7-7z" stroke="none"/>') + 'Testar <span class="font-mono text-[10px] opacity-60">T</span>',
    exitTest: svg16('<rect x="3" y="3" width="10" height="10" stroke="none"/>') + 'Sair do teste <span class="font-mono text-[10px] opacity-60">Esc</span>',
    globe: '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" style="display:inline;vertical-align:-1px"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8h12.4M8 1.8c2 2.2 2 10.2 0 12.4M8 1.8c-2 2.2-2 10.2 0 12.4"/></svg>',
  };

  // brilho dos botões segue o mouse
  document.addEventListener('pointermove', e => {
    const b = e.target.closest && e.target.closest('.pf-btn, .pf-tool');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    b.style.setProperty('--my', (e.clientY - r.top) + 'px');
  });

  const playBtn = $('btn-play'), testBtn = $('btn-test'), hud = $('hud'), timeDisplay = $('time-display');

  function togglePlay() {
    if (app.mode !== 'edit') return;
    if (!app.playing && app.t >= app.level.duration - 0.001) app.t = 0;
    app.playing = !app.playing;
    if (app.playing) PF.audio.play(app.t);
    else PF.audio.stop();
  }
  function pause() { app.playing = false; PF.audio.stop(); }
  function updateUndo() {
    $('btn-undo').disabled = app.hIndex <= 0;
    $('btn-redo').disabled = app.hIndex >= app.history.length - 1;
    $('btn-clear').disabled = !app.level.hazards.length;
  }

  playBtn.addEventListener('click', togglePlay);
  $('btn-stop').addEventListener('click', () => { pause(); app.setTime(0); PF.timeline.scroll = 0; });
  $('btn-undo').addEventListener('click', () => app.undo());
  $('btn-redo').addEventListener('click', () => app.redo());
  $('btn-clear').addEventListener('click', () => app.clearAll());
  $('btn-export').addEventListener('click', () => PF.storage.exportFile(app.level));
  $('btn-import').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    PF.storage.importFile(f).then(lvl => {
      pause();
      app.level = lvl;
      app.selectedId = null;
      app.t = 0;
      PF.timeline.scroll = 0;
      PF.panel.rebuild();
      app.commit();
    }).catch(err => alert('Não foi possível importar: ' + err.message));
  });
  testBtn.addEventListener('click', () => (app.mode === 'test' ? stopTest() : startTest()));

  // ---------- modo teste ----------
  const keys = new Set();

  const P = PF.PLAYER;

  // override: fase de outra pessoa (online) jogada sem substituir a fase do editor.
  // withMusic: a fase online trouxe música própria (já carregada com PF.audio.pushTemp)
  function startTest(t0 = app.t, override = null, label = '', withMusic = false) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    pause();
    if (override) {
      if (!app.editLevel) app.editLevel = app.level;
      app.level = override;
    }
    app.mode = 'test';
    app.t = t0;
    PF.hz.setReactive(new Map()); // gatilhos reativos começam sem disparar
    const sp = app.level.spawn;
    app.test = {
      t0, hits: 0, shake: 0, flash: 0, done: false, over: false, online: app.editLevel ? label : '',
      music: app.editLevel ? withMusic : true,
      player: {
        x: sp.x, y: sp.y, hp: P.hp, dash: 0, dashCd: 0, hurt: 0, spawn: 0.6,
        dir: [1, 0], dashDir: [1, 0], trail: [], ang: 0, targetAng: 0, stretch: 0,
      },
    };
    keys.clear();
    hud.classList.remove('hidden');
    testBtn.innerHTML = BTN_HTML.exitTest;
    stage.style.cursor = 'none';
    if (app.test.music) PF.audio.play(t0); // fase online sem música fica em silêncio
  }

  function stopTest() {
    if (app.mode !== 'test') return;
    PF.audio.stop();
    app.t = app.test.t0;
    app.mode = 'edit';
    app.test = null;
    PF.hz.setReactive(null); // volta para a prévia do editor
    if (app.editLevel) {
      app.level = app.editLevel;
      app.editLevel = null;
      PF.hz.syncIds(app.level.hazards);
      app.setTime(app.t);
      PF.audio.popTemp(); // volta a sua música
      PF.panel.rebuild();
      updateMusicUI();
    }
    keys.clear();
    hud.classList.add('hidden');
    testBtn.innerHTML = BTN_HTML.test;
    stage.style.cursor = '';
  }

  function dash() {
    const T = app.test, p = T.player;
    if (p.dashCd > 0 || T.done || T.over) return;
    p.dash = P.dashTime;
    p.dashCd = P.dashCd;
    p.dashDir = p.dir.slice();
  }

  // Gatilhos reativos da Forma: "jogador perto" e "encostar no jogador" disparam uma vez,
  // no instante em que acontece (mais o aviso, para dar tempo de reagir).
  function reactiveTriggers(p) {
    const R = PF.hz.getReactive();
    if (!R) return;
    PF.hz.setBeat(app.level);
    for (const h of app.level.hazards) {
      if (h.type !== 'shape' || !h.triggers.some(PF.hz.isReactive)) continue;
      const bt = app.t - h.time - h.warn;
      if (bt < 0 || bt > h.active || bt >= PF.hz.shapeEvents(h).hideAt) continue;
      const pose = PF.hz.livePose(h, bt);
      let parts = null;
      h.triggers.forEach((t, i) => {
        const key = h.id + ':' + i;
        if (!t.on || !PF.hz.isReactive(t) || R.has(key)) return;
        let hit;
        if (t.when === 6) hit = Math.hypot(p.x - pose.x, p.y - pose.y) < t.dist;
        else hit = (parts || (parts = PF.hz.parentShapesAt(h, pose))).some(s => PF.hz.hitsPlayer(s, p.x, p.y, P.r));
        if (hit) R.set(key, Math.min(h.active, bt + t.lead));
      });
    }
  }

  function updateTest(dt) {
    const T = app.test, p = T.player;
    T.shake = Math.max(0, T.shake - dt);
    T.flash = Math.max(0, T.flash - dt * 3);
    p.trail.forEach(tr => { tr.a -= dt * 4; });
    p.trail = p.trail.filter(tr => tr.a > 0);
    if (T.done || T.over) return;

    app.t = PF.audio.playing ? PF.audio.time() : app.t + dt;
    const k = n => keys.has(n);
    let ix = (k('d') || k('arrowright') ? 1 : 0) - (k('a') || k('arrowleft') ? 1 : 0);
    let iy = (k('s') || k('arrowdown') ? 1 : 0) - (k('w') || k('arrowup') ? 1 : 0);
    const len = Math.hypot(ix, iy);
    if (len) { ix /= len; iy /= len; p.dir = [ix, iy]; }

    // vira a ponta do losango para onde ele anda e estica com a velocidade
    const moving = p.dash > 0 || len > 0;
    if (moving) {
      const d = p.dash > 0 ? p.dashDir : [ix, iy];
      p.targetAng = Math.atan2(d[1], d[0]);
    }
    const diff = Math.atan2(Math.sin(p.targetAng - p.ang), Math.cos(p.targetAng - p.ang));
    p.ang += diff * Math.min(1, dt * 14);
    const st = p.dash > 0 ? 0.5 : moving ? 0.2 : 0;
    p.stretch += (st - p.stretch) * Math.min(1, dt * 12);

    if (p.dash > 0) {
      p.x += p.dashDir[0] * P.dashSpeed * dt;
      p.y += p.dashDir[1] * P.dashSpeed * dt;
      p.trail.push({ x: p.x, y: p.y, a: 1, ang: p.ang });
    } else {
      p.x += ix * P.speed * dt;
      p.y += iy * P.speed * dt;
    }
    p.x = u.clamp(p.x, 12, W - 12);
    p.y = u.clamp(p.y, 12, H - 12);
    p.dash = Math.max(0, p.dash - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    p.spawn = Math.max(0, p.spawn - dt);

    reactiveTriggers(p);

    if (p.dash <= 0 && p.hurt <= 0 && p.spawn <= 0) {
      for (const s of PF.hz.collect(app.level, app.t, [])) {
        if (PF.hz.hitsPlayer(s, p.x, p.y, P.r)) {
          T.hits++;
          p.hp--;
          p.hurt = P.hurtTime;
          T.shake = 0.3;
          T.flash = 1;
          if (p.hp <= 0) { T.over = true; PF.audio.stop(); }
          break;
        }
      }
    }

    if (!T.over && app.t >= app.level.duration) { app.t = app.level.duration; T.done = true; PF.audio.stop(); }
  }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function hudText() {
    const T = app.test, p = T.player;
    const hearts = (T.online ? `<span class="text-pf-accent">${BTN_HTML.globe} ${esc(T.online)}</span> · ` : '') +
      `<span class="text-pf-player">${'◆'.repeat(Math.max(0, p.hp))}</span><span class="text-pf-muted">${'◇'.repeat(P.hp - Math.max(0, p.hp))}</span>`;
    if (T.over) return `${hearts} · <span class="text-pf-danger">VOCÊ PERDEU</span> · R tentar de novo · Esc editor`;
    if (T.done) return `${hearts} · <span class="text-pf-accent">FASE CONCLUÍDA</span> · acertos: ${T.hits} · R jogar de novo · Esc editor`;
    return `${hearts} · ${u.fmtTime(app.t)} · WASD/setas mover · Espaço/Shift dash · R reiniciar · Esc sair`;
  }

  // ---------- música ----------
  const musicName = $('music-name'), musicClear = $('btn-music-clear'), volume = $('volume');
  volume.value = PF.audio.volume;
  volume.addEventListener('input', () => PF.audio.setVolume(parseFloat(volume.value)));

  function updateMusicUI() {
    const A = PF.audio;
    musicName.textContent = A.buffer ? A.name : 'sem música';
    musicName.title = A.buffer ? A.name : '';
    musicName.classList.toggle('text-pf-accent', !!A.buffer);
    musicName.classList.toggle('text-pf-muted', !A.buffer);
    musicClear.classList.toggle('hidden', !A.buffer);
    if (!app.selected()) PF.panel.rebuild();
  }

  function showCheck(res, fileName) {
    const body = $('modal-body');
    body.innerHTML = '';
    const mk = (tag, cls, txt) => { const e = document.createElement(tag); e.className = cls; if (txt != null) e.textContent = txt; body.appendChild(e); return e; };
    const blocked = !res.allowed;
    mk('h2', 'text-lg font-semibold mb-1 ' + (blocked ? 'text-pf-danger' : 'text-pf-accent'),
      blocked ? '✕ Música bloqueada' : '✓ Música liberada');
    mk('p', 'text-xs text-pf-muted mb-4 font-mono truncate', fileName + ' · ' + res.format);
    if (res.title || res.artist) mk('p', 'text-sm mb-3', [res.title, res.artist].filter(Boolean).join(' — '));
    const ul = mk('ul', 'space-y-1.5 mb-4');
    for (const r of res.reasons) {
      const li = document.createElement('li');
      li.className = 'text-xs text-pf-text/90 leading-relaxed';
      li.textContent = '• ' + r;
      ul.appendChild(li);
    }
    if (blocked) mk('p', 'text-xs text-pf-text/80 mb-3 leading-relaxed',
      'Os metadados indicam que essa música tem direitos autorais. Use uma música sua, de domínio público ou com licença livre (ex.: Creative Commons).');
    mk('p', 'text-[11px] text-pf-muted leading-relaxed border-t border-pf-line pt-3',
      'Verificação simples: só lê as informações gravadas no arquivo (copyright, ISRC, gravadora, licença). Ela não reconhece a música pelo som, então não garante que uma faixa liberada seja realmente livre.');
    $('modal').classList.remove('hidden');
    $('modal-ok').focus();
  }
  $('modal-ok').addEventListener('click', () => $('modal').classList.add('hidden'));

  $('btn-music').addEventListener('click', () => $('music-input').click());
  $('music-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (app.editLevel) { PF.toast('Saia da fase online (Esc) antes de trocar a música.', 'error'); return; }
    let data;
    try { data = await f.arrayBuffer(); } catch (err) { alert('Não consegui ler o arquivo.'); return; }
    const res = PF.musicCheck(new Uint8Array(data), f.name);
    showCheck(res, f.name);
    if (!res.allowed) return; // bloqueada: não carrega
    pause();
    try {
      await PF.audio.load(data, f.name, res);
    } catch (err) {
      alert('Não consegui decodificar esse áudio. Tente MP3, WAV, OGG ou M4A.');
      return;
    }
    PF.audio.persist(data);
    app.level.duration = Math.max(1, Math.ceil(PF.audio.duration));
    app.setTime(app.t);
    PF.panel.rebuild();
    app.commit();
    updateMusicUI();
  });
  musicClear.addEventListener('click', () => {
    if (app.editLevel) return; // tocando a música de uma fase online
    pause(); PF.audio.clear(); updateMusicUI();
  });

  // ---------- fases de outras pessoas (usado por online.js) ----------
  // music: { data: ArrayBuffer, name } quando a fase online tem música
  app.playLevel = async (raw, label, music) => {
    if (app.mode === 'test') stopTest();
    let withMusic = false;
    if (music) {
      try {
        await PF.audio.pushTemp(music.data, music.name);
        withMusic = true;
      } catch (err) {
        PF.toast('Não consegui tocar a música desta fase; ela vai sem som.', 'error');
      }
    }
    startTest(0, PF.storage.normalize(raw), label, withMusic);
    updateMusicUI();
  };
  app.openLevel = async (raw, music) => {
    if (app.mode === 'test') stopTest();
    pause();
    app.level = PF.storage.normalize(raw);
    app.selectedId = null;
    app.t = 0;
    PF.timeline.scroll = 0;
    if (music) {
      // passa pela mesma verificação de quando você importa uma música
      const res = PF.musicCheck(new Uint8Array(music.data), music.name);
      if (res.allowed) {
        try {
          await PF.audio.load(music.data, music.name, res);
          PF.audio.persist(music.data);
        } catch (err) {
          PF.toast('A música desta fase não pôde ser carregada.', 'error');
        }
      }
    }
    PF.panel.rebuild();
    app.commit();
    updateMusicUI();
  };

  // ---------- ritmo: snap e tap tempo ----------
  const SNAP_DIVS = [1, 2, 4, 8, 3];
  // preferência do encaixe fica no navegador (não é da fase)
  const SNAP_KEY = 'pulsefield.snap';
  try {
    const sv = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null');
    if (sv && SNAP_DIVS.includes(sv.div)) { app.snapDiv = sv.div; app.snapOn = !!sv.on; }
  } catch (e) { /* armazenamento indisponível */ }
  const saveSnap = () => { try { localStorage.setItem(SNAP_KEY, JSON.stringify({ on: app.snapOn, div: app.snapDiv })); } catch (e) { /* ignora */ } };
  const divName = d => d === 1 ? '1 batida' : '1/' + d + ' de batida';
  function toggleSnap() {
    app.snapOn = !app.snapOn;
    saveSnap();
    if (PF.toast) PF.toast(app.snapOn ? 'Encaixe ligado · ' + divName(app.snapDiv) : 'Encaixe desligado · tempo livre', 'info', 'snap');
    PF.panel.refresh();
  }
  function cycleSnapDiv() {
    app.snapDiv = SNAP_DIVS[(SNAP_DIVS.indexOf(app.snapDiv) + 1) % SNAP_DIVS.length];
    app.snapOn = true;
    saveSnap();
    if (PF.toast) PF.toast('Encaixe em ' + divName(app.snapDiv), 'info', 'snap');
    PF.panel.refresh();
  }
  PF.app.toggleSnap = toggleSnap;
  PF.app.setSnapDiv = d => { app.snapDiv = d; app.snapOn = true; saveSnap(); PF.panel.refresh(); };
  PF.app.setSnapOff = () => { app.snapOn = false; saveSnap(); PF.panel.refresh(); };

  // Bater B no ritmo: média dos últimos intervalos. Tocando, a última batida vira a referência (offset).
  let taps = [], tapCommit = 0;
  function tapTempo() {
    if (app.editLevel) return;
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1].ms > 2000) taps = [];
    taps.push({ ms: now, t: app.t });
    if (taps.length > 9) taps.shift();
    if (taps.length < 4) {
      if (PF.toast) PF.toast('Tap tempo: continue batendo B no ritmo (' + taps.length + '/4)', 'info', 'tap');
      return;
    }
    const iv = (taps[taps.length - 1].ms - taps[0].ms) / (taps.length - 1);
    const bpm = Math.round(60000 / iv);
    if (bpm < 20 || bpm > 400) return;
    app.level.bpm = bpm;
    if (app.playing) {
      const b = 60 / bpm;
      app.level.offset = u.round(((taps[taps.length - 1].t % b) + b) % b, 3);
    }
    PF.panel.refresh();
    if (PF.toast) PF.toast(bpm + ' BPM' + (app.playing ? ' · batida alinhada à música' : ''), 'info', 'tap');
    clearTimeout(tapCommit);
    tapCommit = setTimeout(() => app.commit(), 1200);
  }
  PF.app.tapTempo = tapTempo;

  // ---------- teclado ----------
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (!$('modal').classList.contains('hidden')) {
      if (k === 'escape' || k === 'enter') { $('modal').classList.add('hidden'); e.preventDefault(); }
      return;
    }
    if (PF.online && PF.online.isOpen()) {
      if (k === 'escape') { PF.online.close(); e.preventDefault(); }
      return;
    }
    if (app.mode === 'test') {
      if (k === 'escape' || k === 't') { stopTest(); e.preventDefault(); return; }
      if (k === 'r') { startTest(app.test.t0, app.editLevel ? app.level : null, app.test.online, app.test.music); e.preventDefault(); return; }
      if (!e.repeat && (k === ' ' || k === 'shift')) dash();
      keys.add(k);
      if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
      return;
    }
    const typing = /^(input|select|textarea)$/i.test(e.target.tagName) && e.target.type !== 'range';
    if (typing) { if (k === 'escape') e.target.blur(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod) {
      if (k === 'z') { e.shiftKey ? app.redo() : app.undo(); e.preventDefault(); }
      else if (k === 'y') { app.redo(); e.preventDefault(); }
      else if (k === 'd') { app.duplicate(); e.preventDefault(); }
      else if (k === 'a') { app.selectAll(); e.preventDefault(); }
      else if (k === 'g') { if (e.shiftKey) PF.mass.ungroup(); else PF.mass.group(); e.preventDefault(); }
      else if (k === 'c') { if (app.copy()) e.preventDefault(); }
      else if (k === 'v') { if (app.clipboard) { app.paste(); e.preventDefault(); } }
      return;
    }
    switch (k) {
      case ' ': togglePlay(); e.preventDefault(); break;
      case 'v': setTool('select'); break;
      case 'escape': if (app.pen) { finishPen(); break; } setTool('select'); app.select(null); break;
      case 'enter': if (app.pen) { finishPen(); e.preventDefault(); } break;
      case 'p': setTool('pen'); break;
      case '1': setTool('ball'); break;
      case '2': setTool('explosive'); break;
      case '3': setTool('line'); break;
      case '4': setTool('circle'); break;
      case '5': setTool('snake'); break;
      case '6': setTool('thunder'); break;
      case '7': setTool('double'); break;
      case '8': setTool('water'); break;
      case '9': setTool('wheel'); break;
      case '0': setTool('spike'); break;
      case 'c': setTool('curve'); break;
      case 'f': setTool('shape'); break;
      case 'delete': case 'backspace': if (!deleteVertex()) app.deleteSelected(); e.preventDefault(); break;
      case 't': startTest(); break;
      case 'g': if (e.shiftKey) cycleSnapDiv(); else toggleSnap(); break;
      case 'b': if (!e.repeat) tapTempo(); break;
      case ',': case '.': case '<': case '>': {
        if (!app.beatLen()) { if (PF.toast) PF.toast('Defina o BPM da fase (painel da fase ou tecla B) para andar por batidas', 'info', 'bpm'); break; }
        const fwd = k === '.' || k === '>', bar = e.shiftKey || k === '<' || k === '>';
        app.setTime(app.stepBeat(app.t, fwd ? 1 : -1, bar));
        PF.timeline.follow(app.t);
        e.preventDefault();
        break;
      }
      case 'home': pause(); app.setTime(0); PF.timeline.scroll = 0; break;
      case 'arrowleft': app.setTime(app.t - (e.shiftKey ? 1 : 0.1)); PF.timeline.follow(app.t); e.preventDefault(); break;
      case 'arrowright': app.setTime(app.t + (e.shiftKey ? 1 : 0.1)); PF.timeline.follow(app.t); e.preventDefault(); break;
    }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // ---------- início ----------
  app.level = PF.storage.load() || PF.storage.demo();
  PF.hz.syncIds(app.level.hazards);
  app.history = [JSON.stringify(app.level)];
  app.hIndex = 0;

  PF.panel.init($('panel'));
  PF.panel.rebuild();
  PF.timeline.init($('timeline'));
  setTool('select');
  updateUndo();
  updateMusicUI();
  PF.audio.restore().then(ok => { if (ok) updateMusicUI(); });

  const ro = new ResizeObserver(() => { resizeStage(); PF.timeline.resize(); });
  ro.observe($('stage-wrap'));
  ro.observe($('timeline-wrap'));
  resizeStage();

  let last = performance.now(), lastPlay = '', lastTime = '', lastHud = '', lastSnap = '';
  const snapBtn = $('btn-snap');
  snapBtn.addEventListener('click', () => {
    if (app.level.bpm > 0) toggleSnap();
    else { app.select(null); if (PF.toast) PF.toast('Defina o BPM no painel da fase (Ritmo) ou bata B no ritmo', 'info', 'bpm'); }
  });
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (app.mode === 'test') updateTest(dt);
    else if (app.playing) {
      // a música é o relógio principal; sem música (ou depois que ela acaba) usa o tempo do quadro
      app.t = PF.audio.playing ? PF.audio.time() : app.t + dt;
      if (app.t >= app.level.duration) { app.t = app.level.duration; pause(); }
      PF.timeline.follow(app.t);
    }

    PF.render(sctx, app, view);
    PF.timeline.draw();
    updateEditButtons();

    const tt = u.fmtTime(app.t);
    if (tt !== lastTime) { timeDisplay.textContent = tt; lastTime = tt; }
    const lv = app.level;
    const sn = lv.bpm > 0 ? lv.bpm + ' BPM · ' + (app.snapOn ? (app.snapDiv === 1 ? '1 bt' : '1/' + app.snapDiv) : 'livre') : 'sem BPM';
    if (sn !== lastSnap) {
      snapBtn.textContent = sn;
      snapBtn.classList.toggle('text-pf-accent', lv.bpm > 0 && app.snapOn);
      snapBtn.classList.toggle('text-pf-muted', !(lv.bpm > 0 && app.snapOn));
      lastSnap = sn;
    }
    const pl = app.playing ? 'pause' : 'play';
    if (pl !== lastPlay) { playBtn.innerHTML = BTN_HTML[pl]; playBtn.classList.toggle('text-pf-accent', app.playing); lastPlay = pl; }
    if (app.mode === 'test') {
      const ht = hudText();
      if (ht !== lastHud) { hud.innerHTML = ht; lastHud = ht; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

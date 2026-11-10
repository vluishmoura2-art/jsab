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

    select(id) { this.selectedId = id; this.spawnSelected = false; PF.panel.refresh(); },
    setTime(t) {
      this.t = u.clamp(t, 0, this.level.duration);
      if (this.playing) PF.audio.play(this.t); // reposiciona a música junto
    },
    changed(commit) { PF.panel.refresh(); if (commit) this.commit(); },

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
      this.setTime(this.t);
      PF.panel.rebuild();
      PF.storage.save(this.level);
      updateUndo();
    },

    deleteSelected() {
      if (this.selectedId == null) return;
      this.level.hazards = this.level.hazards.filter(h => h.id !== this.selectedId);
      this.selectedId = null;
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
      const h = this.selected();
      if (!h || this.editLevel) return false;
      this.clipboard = JSON.stringify(h);
      if (PF.toast) PF.toast(`${PF.HAZARDS[h.type].label} copiada · Ctrl+V cola no tempo do playhead`);
      return true;
    },
    // Cola no tempo atual do playhead; se for o mesmo tempo do original, desloca um pouco no mapa.
    paste() {
      if (!this.clipboard || this.editLevel) return;
      const src = JSON.parse(this.clipboard);
      const c = PF.hz.clone(src);
      c.time = u.round(u.clamp(this.t, 0, this.level.duration), 2);
      if (Math.abs(c.time - src.time) < 0.01) {
        c.x = u.clamp(c.x + 30, -400, W + 400);
        c.y = u.clamp(c.y + 30, -400, H + 400);
      }
      this.level.hazards.push(c);
      this.clipboard = JSON.stringify(c); // colar de novo continua deslocando
      this.select(c.id);
      this.commit();
    },
    // Copiar e colar de uma vez: cópia no mesmo tempo, um pouco ao lado.
    duplicate() {
      const h = this.selected();
      if (!h || this.editLevel) return;
      const c = PF.hz.clone(h);
      c.x = u.clamp(c.x + 30, -400, W + 400);
      c.y = u.clamp(c.y + 30, -400, H + 400);
      this.level.hazards.push(c);
      this.select(c.id);
      this.commit();
    },
  };

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
    if (app.tool !== 'select') {
      const h = PF.hz.create(app.tool, Math.round(p.x), Math.round(p.y), u.round(app.t, 2));
      app.level.hazards.push(h);
      app.select(h.id);
      drag = { id: h.id, dx: 0, dy: 0, moved: true };
      return;
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
      app.select(h.id);
      drag = { id: h.id, dx: h.x - p.x, dy: h.y - p.y, moved: false };
    } else {
      app.select(null);
    }
  });
  stage.addEventListener('pointermove', e => {
    if (app.mode !== 'edit') return;
    const p = toWorld(e);
    if (!drag) {
      if (app.tool === 'select') {
        const sp = app.level.spawn;
        const overSpawn = Math.hypot(p.x - sp.x, p.y - sp.y) <= 16;
        stage.style.cursor = overSpawn || pick(p.x, p.y) ? 'move' : 'default';
      }
      return;
    }
    const h = drag.spawn ? app.level.spawn : app.level.hazards.find(z => z.id === drag.id);
    if (!h) return;
    let nx = p.x + drag.dx, ny = p.y + drag.dy;
    if (e.shiftKey) { nx = Math.round(nx / 40) * 40; ny = Math.round(ny / 40) * 40; }
    const m = drag.spawn ? -12 : 400; // o início do jogador fica dentro da arena
    nx = u.clamp(Math.round(nx), -m, W + m);
    ny = u.clamp(Math.round(ny), -m, H + m);
    if (nx !== h.x || ny !== h.y) { h.x = nx; h.y = ny; drag.moved = true; app.changed(false); }
  });
  const endDrag = () => { if (drag && drag.moved) app.commit(); drag = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---------- barra de ferramentas ----------
  const ICON = {
    select: '<path d="M5 3l14 8-6 1.6L10 19z"/>',
    ball: '<circle cx="9" cy="12" r="5" fill="currentColor"/><path d="M16 12h6M19 9l3 3-3 3"/>',
    explosive: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    line: '<path d="M3 19L21 5" stroke-width="3.5" stroke-linecap="round"/>',
    circle: '<circle cx="12" cy="12" r="8" stroke-width="3"/>',
  };
  const TOOLS = [
    { id: 'select', label: 'Selecionar', key: 'V' },
    { id: 'ball', label: 'Bola', key: '1' },
    { id: 'explosive', label: 'Explosiva', key: '2' },
    { id: 'line', label: 'Linha', key: '3' },
    { id: 'circle', label: 'Círculo', key: '4' },
  ];
  const toolbar = $('toolbar');
  const toolBtns = {};
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.className = 'pf-tool';
    b.title = t.label + ' (' + t.key + ')';
    b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${ICON[t.id]}</svg>` +
      `<span>${t.label}</span><span class="kbd">${t.key}</span>`;
    b.addEventListener('click', () => setTool(t.id));
    toolbar.appendChild(b);
    toolBtns[t.id] = b;
    if (t.id === 'select') {
      const sep = document.createElement('div');
      sep.className = 'w-8 h-px bg-pf-line my-1 shrink-0';
      toolbar.appendChild(sep);
    }
  }
  // atalhos de edição (abaixo das ferramentas)
  const EDIT_ICON = {
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11h6M9 15h4"/>',
    dup: '<rect x="3" y="3" width="11" height="11" rx="2"/><rect x="10" y="10" width="11" height="11" rx="2"/><path d="M15.5 13.5v4M13.5 15.5h4"/>',
  };
  const EDITS = [
    { id: 'copy', label: 'Copiar', key: 'Ctrl+C', run: () => app.copy(), needs: () => !!app.selected() },
    { id: 'paste', label: 'Colar', key: 'Ctrl+V', run: () => app.paste(), needs: () => !!app.clipboard },
    { id: 'dup', label: 'Copiar e colar', key: 'Ctrl+D', run: () => app.duplicate(), needs: () => !!app.selected() },
  ];
  const sep2 = document.createElement('div');
  sep2.className = 'w-8 h-px bg-pf-line my-1 shrink-0';
  toolbar.appendChild(sep2);
  for (const t of EDITS) {
    const b = document.createElement('button');
    b.className = 'pf-tool';
    b.title = t.label + ' (' + t.key + ')';
    b.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${EDIT_ICON[t.id]}</svg>` +
      `<span class="text-center">${t.label}</span><span class="kbd">${t.key}</span>`;
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
    app.tool = id;
    for (const k in toolBtns) toolBtns[k].classList.toggle('active', k === id);
    stage.classList.toggle('placing', id !== 'select');
    if (id !== 'select') stage.style.cursor = '';
  }

  // ---------- transporte e cabeçalho ----------
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
  function startTest(t0 = app.t, override = null, label = '') {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    pause();
    if (override) {
      if (!app.editLevel) app.editLevel = app.level;
      app.level = override;
    }
    app.mode = 'test';
    app.t = t0;
    const sp = app.level.spawn;
    app.test = {
      t0, hits: 0, shake: 0, flash: 0, done: false, over: false, online: app.editLevel ? label : '',
      player: {
        x: sp.x, y: sp.y, hp: P.hp, dash: 0, dashCd: 0, hurt: 0, spawn: 0.6,
        dir: [1, 0], dashDir: [1, 0], trail: [], ang: 0, targetAng: 0, stretch: 0,
      },
    };
    keys.clear();
    hud.classList.remove('hidden');
    testBtn.textContent = '■ Sair do teste';
    stage.style.cursor = 'none';
    if (!app.editLevel) PF.audio.play(t0); // fases online vêm sem música
  }

  function stopTest() {
    if (app.mode !== 'test') return;
    PF.audio.stop();
    app.t = app.test.t0;
    app.mode = 'edit';
    app.test = null;
    if (app.editLevel) {
      app.level = app.editLevel;
      app.editLevel = null;
      PF.hz.syncIds(app.level.hazards);
      app.setTime(app.t);
      PF.panel.rebuild();
    }
    keys.clear();
    hud.classList.add('hidden');
    testBtn.textContent = '◆ Testar (T)';
    stage.style.cursor = '';
  }

  function dash() {
    const T = app.test, p = T.player;
    if (p.dashCd > 0 || T.done || T.over) return;
    p.dash = P.dashTime;
    p.dashCd = P.dashCd;
    p.dashDir = p.dir.slice();
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
    const hearts = (T.online ? `<span class="text-pf-accent">🌐 ${esc(T.online)}</span> · ` : '') +
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
  musicClear.addEventListener('click', () => { pause(); PF.audio.clear(); updateMusicUI(); });

  // ---------- fases de outras pessoas (usado por online.js) ----------
  app.playLevel = (raw, label) => {
    if (app.mode === 'test') stopTest();
    startTest(0, PF.storage.normalize(raw), label);
  };
  app.openLevel = raw => {
    if (app.mode === 'test') stopTest();
    pause();
    app.level = PF.storage.normalize(raw);
    app.selectedId = null;
    app.t = 0;
    PF.timeline.scroll = 0;
    PF.panel.rebuild();
    app.commit();
  };

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
      if (k === 'r') { startTest(app.test.t0, app.editLevel ? app.level : null, app.test.online); e.preventDefault(); return; }
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
      else if (k === 'c') { if (app.copy()) e.preventDefault(); }
      else if (k === 'v') { if (app.clipboard) { app.paste(); e.preventDefault(); } }
      return;
    }
    switch (k) {
      case ' ': togglePlay(); e.preventDefault(); break;
      case 'v': setTool('select'); break;
      case 'escape': setTool('select'); app.select(null); break;
      case '1': setTool('ball'); break;
      case '2': setTool('explosive'); break;
      case '3': setTool('line'); break;
      case '4': setTool('circle'); break;
      case 'delete': case 'backspace': app.deleteSelected(); e.preventDefault(); break;
      case 't': startTest(); break;
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

  let last = performance.now(), lastPlay = '', lastTime = '', lastHud = '';
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
    const pl = app.playing ? '❚❚ Pausar' : '▶ Tocar';
    if (pl !== lastPlay) { playBtn.textContent = pl; lastPlay = pl; }
    if (app.mode === 'test') {
      const ht = hudText();
      if (ht !== lastHud) { hud.innerHTML = ht; lastHud = ht; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

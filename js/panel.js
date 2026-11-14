// Painel de propriedades: gerado a partir de PF.HAZARDS[type].props.
(function () {
  const { W, H, u } = PF;
  const P = PF.panel = {};
  let root = null, boundId, syncers = [];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  P.init = r => { root = r; };
  P.rebuild = () => { boundId = undefined; P.refresh(); };
  P.refresh = () => {
    if (!root) return;
    const h = PF.app.selected(), multi = PF.app.multi;
    const id = multi.size ? 'm:' + [...multi].sort((a, b) => a - b).join(',') : h ? h.id : null;
    if (id !== boundId) { boundId = id; build(h); }
    else syncers.forEach(f => f());
  };

  function section(title) {
    const s = el('section', 'px-4 py-3 border-b border-pf-line');
    if (title) s.appendChild(el('h3', 'pf-sec text-[10px] uppercase tracking-[0.18em] text-pf-muted mb-3 font-semibold', title));
    root.appendChild(s);
    return s;
  }

  function numberField(parent, obj, p, cls = 'mb-2') {
    const row = el('div', 'flex items-center justify-between gap-2 ' + cls);
    row.appendChild(el('label', 'text-xs text-pf-text/80', p.label));
    const right = el('div', 'flex items-center gap-1');
    const num = el('input', 'pf-num');
    Object.assign(num, { type: 'number', step: p.step, min: p.min, max: p.max });
    right.appendChild(num);
    right.appendChild(el('span', 'pf-unit', p.unit || ''));
    row.appendChild(right);
    parent.appendChild(row);

    num.value = obj[p.key];
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v) && v >= p.min && v <= p.max) { obj[p.key] = v; PF.app.changed(false); }
    });
    num.addEventListener('change', () => {
      let v = parseFloat(num.value);
      if (!Number.isFinite(v)) v = obj[p.key];
      obj[p.key] = u.round(u.clamp(v, p.min, p.max), 3);
      num.value = obj[p.key];
      PF.app.changed(true);
    });
    syncers.push(() => { if (document.activeElement !== num) num.value = obj[p.key]; });
    return row;
  }

  function rangeField(parent, obj, p) {
    const wrap = el('div', 'mb-3');
    numberField(wrap, obj, p, 'mb-1');
    const rng = el('input', 'w-full');
    Object.assign(rng, { type: 'range', min: p.min, max: p.max, step: p.step });
    rng.value = obj[p.key];
    rng.addEventListener('input', () => { obj[p.key] = u.round(parseFloat(rng.value), 3); PF.app.changed(false); });
    rng.addEventListener('change', () => PF.app.changed(true));
    syncers.push(() => { rng.value = obj[p.key]; });
    wrap.appendChild(rng);
    parent.appendChild(wrap);
  }

  function selectField(parent, obj, p) {
    const row = el('div', 'flex items-center justify-between gap-2 mb-3');
    row.appendChild(el('label', 'text-xs text-pf-text/80', p.label));
    const sel = el('select', 'pf-select');
    for (const [v, label] of p.options) {
      const o = el('option', '', label);
      o.value = String(v);
      sel.appendChild(o);
    }
    sel.value = String(obj[p.key]);
    sel.addEventListener('change', () => { obj[p.key] = Number(sel.value); PF.app.changed(true); });
    syncers.push(() => { sel.value = String(obj[p.key]); });
    row.appendChild(sel);
    parent.appendChild(row);
  }

  function build(h) {
    syncers = [];
    root.innerHTML = '';
    if (PF.app.multi.size > 1) return buildMulti(PF.app.selection());
    if (!h) return buildLevel();
    const def = PF.HAZARDS[h.type];

    const head = section();
    const top = el('div', 'flex items-center gap-2 mb-3');
    top.appendChild(el('span', 'w-2.5 h-2.5 rounded-full bg-pf-danger shadow-[0_0_8px_#FF4D5E]'));
    top.appendChild(el('h2', 'font-semibold text-sm', def.label));
    top.appendChild(el('span', 'ml-auto font-mono text-[11px] text-pf-muted', '#' + h.id));
    head.appendChild(top);
    const actions = el('div', 'flex flex-wrap gap-2');
    const copy = el('button', 'pf-btn flex-1', 'Copiar');
    copy.title = 'Ctrl+C';
    copy.addEventListener('click', () => PF.app.copy());
    const dup = el('button', 'pf-btn flex-1', 'Copiar e colar');
    dup.title = 'Ctrl+D';
    dup.addEventListener('click', () => PF.app.duplicate());
    const del = el('button', 'pf-btn pf-btn-danger flex-1', 'Excluir');
    del.title = 'Delete';
    del.addEventListener('click', () => PF.app.deleteSelected());
    actions.append(copy, dup, del);
    head.appendChild(actions);

    const s1 = section('Tempo e posição');
    numberField(s1, h, { key: 'time', label: 'Início', min: 0, max: PF.app.level.duration, step: 0.05, unit: 's' });
    numberField(s1, h, { key: 'x', label: 'X', min: -400, max: W + 400, step: 1, unit: 'px' });
    numberField(s1, h, { key: 'y', label: 'Y', min: -400, max: H + 400, step: 1, unit: 'px' });

    const s2 = section(h.type === 'group' ? 'Grupo e repetidor' : 'Propriedades');
    propFields(s2, h, def.props);

    if (h.type === 'shape') { buildGeometry(h); buildBehaviors(h); buildTriggers(h); }
    if (h.type === 'group') { buildItems(h); buildBehaviors(h, 'Comportamentos do grupo'); buildGroupActions(h); }

    const s3 = section();
    s3.appendChild(el('p', 'text-xs leading-relaxed text-pf-muted', def.desc));
  }

  // ---------- pilha de comportamentos da Forma ----------
  const collapsed = new WeakSet(); // cartões fechados (só no editor, não vai para a fase)
  const ICO = {
    up: '<path d="M4 10l4-4 4 4"/>',
    down: '<path d="M4 6l4 4 4-4"/>',
    del: '<path d="M4 4l8 8M12 4l-8 8"/>',
    open: '<path d="M6 4l4 4-4 4"/>',
  };
  function iconBtn(name, title, run) {
    const b = el('button', 'pf-btn pf-btn-icon');
    b.title = title;
    b.innerHTML = `<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6">${ICO[name]}</svg>`;
    b.addEventListener('click', e => { e.stopPropagation(); run(); });
    return b;
  }

  // mini-gráfico do efeito deste comportamento sozinho, durante o tempo ativo
  function drawSpark(cv, h, b) {
    const def = PF.BEHAVIORS[b.type], g = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth || 220, hh = 30;
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    PF.hz.setBeat(PF.app.level);
    const solo = { ...h, behaviors: [{ ...b, on: 1 }] }, n = 80;
    const series = def.group === 'Posição' ? [[], []] : [[]];
    for (let i = 0; i <= n; i++) {
      const p = PF.hz.shapePose(solo, durOf(h) * i / n);
      if (def.group === 'Posição') { series[0].push(p.x - h.x); series[1].push(p.y - h.y); }
      else if (def.group === 'Rotação') series[0].push(p.rot - h.rot);
      else series[0].push(p.s);
    }
    let lo = Infinity, hi = -Infinity;
    for (const s of series) for (const v of s) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    g.strokeStyle = 'rgba(124,255,178,0.12)';
    g.beginPath(); g.moveTo(0, hh - 0.5); g.lineTo(w, hh - 0.5); g.stroke();
    const colors = ['#7CFFB2', '#4DD8FF'];
    series.forEach((s, k) => {
      g.strokeStyle = colors[k];
      g.lineWidth = 1.4;
      g.beginPath();
      s.forEach((v, i) => {
        const x = i / n * (w - 2) + 1, y = hh - 3 - (v - lo) / (hi - lo) * (hh - 6);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
    });
  }

  // duração usada nos mini-gráficos (grupo não tem "tempo ativa")
  const durOf = h => (h.type === 'group' ? Math.max(1, PF.HAZARDS.group.length(h)) : h.active);

  function buildBehaviors(h, title = 'Comportamentos') {
    const s = section(title);
    const list = h.behaviors;
    if (!list.length) {
      s.appendChild(el('p', 'text-[11px] text-pf-muted mb-3 leading-relaxed',
        'Nenhum. Adicione movimentos abaixo: eles começam quando a forma fica ativa e somam de cima para baixo.'));
    }
    list.forEach((b, i) => {
      const def = PF.BEHAVIORS[b.type];
      const card = el('div', 'pf-card mb-2' + (b.on ? '' : ' opacity-50'));
      const head = el('div', 'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer');
      const caret = el('span', 'text-pf-muted transition-transform');
      caret.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8">${ICO.open}</svg>`;
      if (!collapsed.has(b)) caret.style.transform = 'rotate(90deg)';
      const on = el('input', 'shrink-0');
      on.type = 'checkbox';
      on.checked = !!b.on;
      on.title = 'Ligar / desligar';
      on.addEventListener('click', e => e.stopPropagation());
      on.addEventListener('change', () => { b.on = on.checked ? 1 : 0; P.rebuild(); PF.app.commit(); });
      const name = el('span', 'text-xs font-semibold flex-1 truncate', (i + 1) + '. ' + def.label);
      head.append(caret, on, name);
      if (i > 0) head.appendChild(iconBtn('up', 'Subir (aplica antes)', () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); P.rebuild(); PF.app.commit(); }));
      if (i < list.length - 1) head.appendChild(iconBtn('down', 'Descer (aplica depois)', () => { list.splice(i + 1, 0, list.splice(i, 1)[0]); P.rebuild(); PF.app.commit(); }));
      head.appendChild(iconBtn('del', 'Remover', () => { list.splice(i, 1); P.rebuild(); PF.app.commit(); }));
      head.addEventListener('click', () => { collapsed.has(b) ? collapsed.delete(b) : collapsed.add(b); P.rebuild(); });
      card.appendChild(head);

      const spark = el('div', 'px-2');
      const cv = el('canvas', 'block w-full h-[30px]');
      spark.appendChild(cv);
      card.appendChild(spark);
      requestAnimationFrame(() => drawSpark(cv, h, b));
      let lastKey = '';
      syncers.push(() => { // redesenha quando os valores mudam
        const k = JSON.stringify(b) + h.active + PF.app.level.bpm;
        if (k !== lastKey) { lastKey = k; drawSpark(cv, h, b); }
      });

      if (!collapsed.has(b)) {
        const body = el('div', 'px-2 pt-2 pb-1');
        for (const p of def.params) (p.type === 'select' ? selectField : numberField)(body, b, p);
        for (const p of PF.hz.BEH_TIME) numberField(body, b, p);
        card.appendChild(body);
      }
      s.appendChild(card);
    });

    // adicionar
    const add = el('select', 'pf-select w-full mt-1');
    const first = el('option', '', list.length >= PF.hz.MAX_BEHAVIORS ? 'Limite de ' + PF.hz.MAX_BEHAVIORS + ' comportamentos' : '+ Adicionar comportamento…');
    first.value = '';
    add.appendChild(first);
    add.disabled = list.length >= PF.hz.MAX_BEHAVIORS;
    const groups = {};
    for (const [type, def] of Object.entries(PF.BEHAVIORS)) {
      if (!groups[def.group]) { groups[def.group] = el('optgroup'); groups[def.group].label = def.group; add.appendChild(groups[def.group]); }
      const o = el('option', '', def.label);
      o.value = type;
      groups[def.group].appendChild(o);
    }
    add.addEventListener('change', () => {
      if (!add.value) return;
      list.push(PF.hz.newBehavior(add.value));
      // movimento curto demais para ver? estica o tempo ativa
      if (h.type === 'shape' && h.active < 2) h.active = 2;
      P.rebuild();
      PF.app.commit();
    });
    s.appendChild(add);
    s.appendChild(el('p', 'text-[10px] text-pf-muted mt-2 leading-relaxed',
      '"bt" = batidas da fase (sem BPM, 1 batida = 0,5 s). "Pulsar na batida" segue a música. O tracejado no mapa é o caminho da forma.'));
  }

  // ---------- gatilhos da Forma ----------
  function buildTriggers(h, title = 'Gatilhos') {
    const s = section(title);
    const list = h.triggers, A = PF.TRIGGER_ACTIONS;
    const whenOpts = PF.hz.TRG_WHEN[0].options;
    const whenName = w => (whenOpts.find(o => o[0] === w) || [0, ''])[1].replace(/ \(.*\)$/, '');
    if (!list.length) {
      s.appendChild(el('p', 'text-[11px] text-pf-muted mb-3 leading-relaxed',
        'Nenhum. Um gatilho escolhe quando (na batida, num tempo, quando um comportamento termina…) a forma faz uma ação (rajada, explodir, dividir, espelhar…).'));
    }
    list.forEach((t, i) => {
      const def = A[t.action];
      const card = el('div', 'pf-card mb-2' + (t.on ? '' : ' opacity-50'));
      const head = el('div', 'flex items-center gap-1.5 px-2 py-1.5 cursor-pointer');
      const caret = el('span', 'text-pf-muted');
      caret.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8">${ICO.open}</svg>`;
      if (!collapsed.has(t)) caret.style.transform = 'rotate(90deg)';
      const on = el('input', 'shrink-0');
      on.type = 'checkbox';
      on.checked = !!t.on;
      on.title = 'Ligar / desligar';
      on.addEventListener('click', e => e.stopPropagation());
      on.addEventListener('change', () => { t.on = on.checked ? 1 : 0; P.rebuild(); PF.app.commit(); });
      const name = el('span', 'text-xs font-semibold flex-1 truncate', (i + 1) + '. ' + whenName(t.when) + ' → ' + def.label.replace(/ \(.*\)$/, ''));
      name.title = name.textContent;
      head.append(caret, on, name);
      if (i > 0) head.appendChild(iconBtn('up', 'Subir', () => { list.splice(i - 1, 0, list.splice(i, 1)[0]); P.rebuild(); PF.app.commit(); }));
      head.appendChild(iconBtn('del', 'Remover', () => { list.splice(i, 1); P.rebuild(); PF.app.commit(); }));
      head.addEventListener('click', () => { collapsed.has(t) ? collapsed.delete(t) : collapsed.add(t); P.rebuild(); });
      card.appendChild(head);

      if (!collapsed.has(t)) {
        const body = el('div', 'px-2 pt-1 pb-1');
        // quando: os campos mudam conforme o tipo
        selectField(body, t, PF.hz.TRG_WHEN[0]);
        body.lastChild.querySelector('select').addEventListener('change', () => P.rebuild());
        for (const p of PF.hz.TRG_WHEN.slice(1)) if (p.show.includes(t.when)) numberField(body, t, p);
        if (t.when === 4 && !h.behaviors[t.beh - 1]) {
          body.appendChild(el('p', 'text-[10px] text-pf-danger mb-2', 'Não existe o comportamento nº ' + t.beh + '.'));
        }
        // ação: trocar recomeça os parâmetros dela
        const row = el('div', 'flex items-center justify-between gap-2 mb-3 mt-1 pt-2 border-t border-pf-line');
        row.appendChild(el('label', 'text-xs text-pf-text/80', 'Ação'));
        const act = el('select', 'pf-select');
        for (const [k, d] of Object.entries(A)) { const o = el('option', '', d.label); o.value = k; act.appendChild(o); }
        act.value = t.action;
        act.addEventListener('change', () => {
          const keep = { on: t.on, when: t.when, at: t.at, every: t.every, from: t.from, times: t.times, beh: t.beh, lead: t.lead };
          for (const k of Object.keys(t)) delete t[k];
          Object.assign(t, PF.hz.newTrigger(act.value), keep, { action: act.value });
          P.rebuild();
          PF.app.commit();
        });
        row.appendChild(act);
        body.appendChild(row);
        for (const p of def.params) (p.type === 'select' ? selectField : numberField)(body, t, p);
        if (def.children) numberField(body, t, PF.hz.TRG_LEAD);
        card.appendChild(body);
      }
      s.appendChild(card);
    });

    const add = el('select', 'pf-select w-full mt-1');
    const first = el('option', '', list.length >= PF.hz.MAX_TRIGGERS ? 'Limite de ' + PF.hz.MAX_TRIGGERS + ' gatilhos' : '+ Adicionar gatilho…');
    first.value = '';
    add.appendChild(first);
    add.disabled = list.length >= PF.hz.MAX_TRIGGERS;
    for (const [k, d] of Object.entries(A)) { const o = el('option', '', d.label); o.value = k; add.appendChild(o); }
    add.addEventListener('change', () => {
      if (!add.value) return;
      list.push(PF.hz.newTrigger(add.value));
      if (h.active < 2) h.active = 2;
      P.rebuild();
      PF.app.commit();
    });
    s.appendChild(add);
    s.appendChild(el('p', 'text-[10px] text-pf-muted mt-2 leading-relaxed',
      'Na batida/meia batida segue a grade da música. "Aviso antes" mostra as linhas de mira. Explodir, Dividir e Sumir tiram a forma da tela; os losangos no bloco da timeline são os disparos.'));
  }

  // campos de props, respeitando "show" (só aparece em alguns casos) e "rebuild" (muda o painel)
  function propFields(parent, obj, props) {
    for (const p of props) {
      if (p.show && !p.show(obj)) continue;
      (p.type === 'select' ? selectField : rangeField)(parent, obj, p);
      if (p.rebuild) parent.lastChild.querySelector('select').addEventListener('change', () => P.rebuild());
    }
  }

  // ---------- geometria (caminho de pontos) ----------
  const geoOpts = { gen: 0, sides: 6, radius: 120, inner: 45, sweep: 240, start: -90, thick: 18, turns: 3, r0: 20, len: 480, amp: 50, waves: 3, d: 14, tol: 3, skew: 15, sx: 120, sy: 100 };
  const GEN = [[0, 'Polígono'], [1, 'Estrela'], [2, 'Arco'], [3, 'Anel'], [4, 'Espiral'], [5, 'Onda']];
  function buildGeometry(h) {
    const s = section('Geometria');
    const G = PF.geo;
    const row = () => { const r = el('div', 'grid grid-cols-2 gap-1.5 mb-2'); s.appendChild(r); return r; };
    const op = (parent, label, title, fn) => {
      const b = el('button', 'pf-btn', label);
      b.title = title;
      b.addEventListener('click', () => { fn(); PF.app.vtx = null; P.rebuild(); PF.app.commit(); });
      parent.appendChild(b);
      return b;
    };
    if (h.kind !== 4) {
      s.appendChild(el('p', 'text-[11px] text-pf-muted mb-2 leading-relaxed', 'Para mexer ponto a ponto, converta em caminho (o desenho fica igual).'));
      op(row(), 'Converter em caminho', 'Vira uma forma de pontos editáveis', () => G.toPath(h));
      const r2 = row();
      op(r2, 'Exportar SVG', 'Baixa esta forma como .svg', () => G.download('forma-' + h.id + '.svg', G.toSVG([h]), 'image/svg+xml'));
      return;
    }
    // trocou o tipo para Caminho no select: começa do retângulo w×h
    if (!h.pts.length && !PF.app.pen) { h.pts =[-h.w / 2, -h.h / 2, h.w / 2, -h.h / 2, h.w / 2, h.h / 2, -h.w / 2, h.h / 2]; h.closed = 1; }
    s.appendChild(el('p', 'text-[10px] text-pf-muted mb-3 leading-relaxed',
      h.pts.length / 2 + ' pontos · arraste os quadradinhos no mapa (Shift: grade) · Shift+clique na borda adiciona · clique num ponto e Delete apaga.'));

    // gerar contorno
    selectField(s, geoOpts, { key: 'gen', label: 'Gerar', type: 'select', options: GEN });
    s.lastChild.querySelector('select').addEventListener('change', () => P.rebuild());
    const g = geoOpts.gen;
    if (g === 0 || g === 1) numberField(s, geoOpts, { key: 'sides', label: g ? 'Pontas' : 'Lados', min: 3, max: 32, step: 1, unit: '' });
    if (g <= 3) numberField(s, geoOpts, { key: 'radius', label: 'Raio', min: 5, max: 1500, step: 1, unit: 'px' });
    if (g === 1) numberField(s, geoOpts, { key: 'inner', label: 'Raio de dentro', min: 5, max: 95, step: 1, unit: '%' });
    if (g === 2) { numberField(s, geoOpts, { key: 'start', label: 'Começa em', min: -360, max: 360, step: 1, unit: '°' }); numberField(s, geoOpts, { key: 'sweep', label: 'Abertura', min: 5, max: 360, step: 1, unit: '°' }); }
    if (g === 2 || g === 3 || g === 4 || g === 5) numberField(s, geoOpts, { key: 'thick', label: 'Grossura', min: 2, max: 200, step: 1, unit: 'px' });
    if (g === 4) { numberField(s, geoOpts, { key: 'turns', label: 'Voltas', min: 0.5, max: 8, step: 0.25, unit: '' }); numberField(s, geoOpts, { key: 'r0', label: 'Raio inicial', min: 0, max: 1000, step: 1, unit: 'px' }); numberField(s, geoOpts, { key: 'radius', label: 'Raio final', min: 5, max: 1500, step: 1, unit: 'px' }); }
    if (g === 5) { numberField(s, geoOpts, { key: 'len', label: 'Comprimento', min: 20, max: 3000, step: 1, unit: 'px' }); numberField(s, geoOpts, { key: 'amp', label: 'Altura da onda', min: 0, max: 600, step: 1, unit: 'px' }); numberField(s, geoOpts, { key: 'waves', label: 'Ondas', min: 0.5, max: 12, step: 0.5, unit: '' }); }
    const gb = el('button', 'pf-btn pf-btn-primary w-full mb-3', 'Gerar (troca os pontos)');
    gb.addEventListener('click', () => {
      const o = geoOpts;
      const set = (pts, closed, smooth, hollow) => Object.assign(h, { pts, closed, smooth, hollow, pivotX: 0, pivotY: 0 });
      if (g === 0) set(G.polygon(o.sides, o.radius), 1, 0, h.hollow);
      else if (g === 1) set(G.star(o.sides, o.radius, o.inner / 100), 1, 0, h.hollow);
      else if (g === 2) set(G.arc(o.radius, o.start, o.sweep), 0, 0, 0);
      else if (g === 3) set(G.polygon(48, o.radius), 1, 0, 1);
      else if (g === 4) set(G.spiral(o.turns, o.r0, o.radius), 0, 1, 0);
      else set(G.wave(o.len, o.amp, o.waves), 0, 1, 0);
      if (g >= 2) h.stroke = o.thick;
      PF.app.vtx = null;
      P.rebuild();
      PF.app.commit();
    });
    s.appendChild(gb);

    // operações nos pontos
    numberField(s, geoOpts, { key: 'd', label: 'Distância (chanfro, contorno, unir)', min: 1, max: 400, step: 1, unit: 'px' });
    const c = !!h.closed;
    let r = row();
    op(r, 'Suavizar', 'Cada canto vira dois pontos (Chaikin); repita para ficar mais redondo', () => { h.pts = G.chaikin(h.pts, c); });
    op(r, 'Simplificar', 'Tira pontos que quase não mudam o desenho', () => { h.pts = G.simplify(h.pts, c, geoOpts.tol); });
    r = row();
    op(r, 'Chanfrar cantos', 'Corta cada canto na distância (bevel)', () => { h.pts = G.bevel(h.pts, c, geoOpts.d); });
    op(r, 'Arredondar cantos', 'Cantos redondos na distância (fillet)', () => { h.pts = G.fillet(h.pts, c, geoOpts.d); });
    r = row();
    op(r, 'Engordar contorno', 'Desloca o contorno para fora pela distância', () => { h.pts = G.offset(h.pts, c, geoOpts.d); });
    op(r, 'Afinar contorno', 'Desloca o contorno para dentro pela distância', () => { h.pts = G.offset(h.pts, c, -geoOpts.d); });
    r = row();
    op(r, 'Unir pontos perto', 'Junta pontos vizinhos mais perto que a distância (weld)', () => { h.pts = G.merge(h.pts, c, geoOpts.d); });
    op(r, c ? 'Abrir caminho' : 'Fechar caminho', c ? 'Vira uma linha aberta' : 'Liga o último ponto ao primeiro', () => { h.closed = c ? 0 : 1; if (h.closed && h.pts.length < 6) h.closed = 0; });
    r = row();
    op(r, 'Inverter ↔', 'Espelha na horizontal (flip)', () => { h.pts = G.flip(h.pts, 0); h.pivotX = -h.pivotX; });
    op(r, 'Inverter ↕', 'Espelha na vertical (flip)', () => { h.pts = G.flip(h.pts, 1); h.pivotY = -h.pivotY; });
    numberField(s, geoOpts, { key: 'skew', label: 'Inclinar', min: -80, max: 80, step: 1, unit: '°' });
    r = row();
    op(r, 'Inclinar X', 'Skew/shear na horizontal', () => { h.pts = G.skew(h.pts, geoOpts.skew, 0); });
    op(r, 'Inclinar Y', 'Skew/shear na vertical', () => { h.pts = G.skew(h.pts, 0, geoOpts.skew); });
    numberField(s, geoOpts, { key: 'sx', label: 'Esticar X', min: 5, max: 500, step: 1, unit: '%' });
    numberField(s, geoOpts, { key: 'sy', label: 'Esticar Y', min: 5, max: 500, step: 1, unit: '%' });
    r = row();
    op(r, 'Esticar / achatar', 'Stretch/squash pelos dois valores', () => { h.pts = G.stretch(h.pts, geoOpts.sx / 100, geoOpts.sy / 100); });
    op(r, 'Pivô no centro', 'Põe o pivô no meio dos pontos (a forma não sai do lugar)', () => {
      G.recenter(h);
      const [cx, cy] = PF.m.apply(PF.hz.shapeMatrix(h), 0, 0);
      h.x = Math.round(cx * 100) / 100; h.y = Math.round(cy * 100) / 100; h.pivotX = 0; h.pivotY = 0;
    });
    r = row();
    op(r, 'Exportar SVG', 'Baixa esta forma como .svg', () => G.download('forma-' + h.id + '.svg', G.toSVG([h]), 'image/svg+xml'));
    const imp = el('button', 'pf-btn', 'Importar SVG');
    imp.title = 'Cria formas a partir de um arquivo .svg';
    imp.addEventListener('click', () => P.importSVG());
    r.appendChild(imp);
  }

  // Importar SVG: cada caminho do arquivo vira uma Forma; com vários, já vêm agrupados
  P.importSVG = function () {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.svg,image/svg+xml';
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      f.text().then(txt => {
        const app = PF.app, list = PF.geo.shapesFromSVG(txt);
        if (!list.length) { if (PF.toast) PF.toast('Nenhuma forma encontrada no SVG (path, polygon, rect, circle…)', 'error', 'svg'); return; }
        const t0 = app.level.bpm > 0 && app.snapOn ? app.snapTime(app.t) : Math.round(app.t * 100) / 100;
        for (const h of list) { h.time = Math.max(0, Math.min(app.level.duration, t0)); app.level.hazards.push(h); }
        if (list.length > 1) { app.selectList(list); PF.mass.group(); } else { app.select(list[0].id); app.commit(); }
        if (PF.toast) PF.toast(list.length + ' forma(s) importada(s) do SVG', 'info', 'svg');
      }).catch(() => { if (PF.toast) PF.toast('Não deu para ler esse SVG', 'error', 'svg'); });
    });
    inp.click();
  };

  // ---------- itens do grupo ----------
  let openItem = null; // item do grupo aberto para edição (só no editor)
  const KIND_NAME = ['Círculo', 'Quadrado', 'Triângulo', 'Laser'];
  function buildItems(g) {
    const s = section('Itens (' + g.items.length + ')');
    if (!g.items.includes(openItem)) openItem = null;
    g.items.forEach((it, i) => {
      const row = el('div', 'pf-card mb-1.5 flex items-center gap-2 px-2 py-1.5 cursor-pointer' + (it === openItem ? ' border-pf-accent' : ''));
      if (it === openItem) row.style.borderColor = 'var(--pf-accent)';
      const name = it.type === 'group' ? 'Grupo (' + it.items.length + ')' : KIND_NAME[it.kind] || 'Forma';
      row.appendChild(el('span', 'text-xs flex-1 truncate', (i + 1) + '. ' + name));
      row.appendChild(el('span', 'font-mono text-[10px] text-pf-muted', '+' + it.time.toFixed(2) + 's'));
      row.appendChild(iconBtn('del', 'Tirar do grupo', () => {
        if (g.items.length <= 1) { if (PF.toast) PF.toast('O grupo precisa de pelo menos 1 item · use Desagrupar ou Excluir', 'info', 'grp'); return; }
        g.items.splice(i, 1);
        P.rebuild();
        PF.app.commit();
      }));
      row.addEventListener('click', () => { openItem = openItem === it ? null : it; P.rebuild(); });
      s.appendChild(row);
    });
    s.appendChild(el('p', 'text-[10px] text-pf-muted mt-2 leading-relaxed',
      'Clique num item para editar. X/Y são relativos ao pivô do grupo e o tempo, ao começo do grupo.'));
    if (!openItem) return;
    const it = openItem, idx = g.items.indexOf(it) + 1;
    const ed = section('Item ' + idx);
    numberField(ed, it, { key: 'time', label: 'Começa (+s no grupo)', min: 0, max: 600, step: 0.05, unit: 's' });
    numberField(ed, it, { key: 'x', label: 'X (do pivô)', min: -3000, max: 3000, step: 1, unit: 'px' });
    numberField(ed, it, { key: 'y', label: 'Y (do pivô)', min: -3000, max: 3000, step: 1, unit: 'px' });
    if (it.type === 'group') {
      ed.appendChild(el('p', 'text-[11px] text-pf-muted mt-2', 'Grupo dentro de grupo: para mexer nos itens dele, desagrupe este grupo primeiro.'));
      propFields(ed, it, PF.HAZARDS.group.props);
      return;
    }
    propFields(ed, it, PF.HAZARDS.shape.props);
    buildBehaviors(it, 'Comportamentos do item ' + idx);
    buildTriggers(it, 'Gatilhos do item ' + idx);
  }

  function buildGroupActions(g) {
    const s = section('Grupo');
    const row = el('div', 'flex flex-wrap gap-2');
    const un = el('button', 'pf-btn flex-1', 'Desagrupar');
    un.title = 'Ctrl+Shift+G · solta as formas (e as cópias do repetidor) no mapa';
    un.addEventListener('click', () => PF.mass.ungroup());
    const pr = el('button', 'pf-btn flex-1', 'Salvar preset');
    pr.title = 'Guarda este grupo no navegador para usar de novo (painel da fase)';
    pr.addEventListener('click', () => PF.mass.savePreset(g));
    row.append(un, pr);
    s.appendChild(row);
    const n = PF.hz.countInstances(g);
    s.appendChild(el('p', 'text-[10px] text-pf-muted mt-2', n + ' forma(s) desenhada(s) · máx. 256 por grupo. Gatilhos "jogador perto/encostar" não valem dentro de grupos.'));
  }

  // ---------- seleção múltipla: edição em massa ----------
  const massOpts = { deg: 15, around: 0, pct: 120, mode: 0, radius: 220, start: -90, face: 1, cols: 4, gap: 120, r0: 60, rstep: 30, astep: 40, step: 1, amount: 25 };
  function buildMulti(list) {
    const head = section();
    const top = el('div', 'flex items-center gap-2 mb-3');
    top.appendChild(el('span', 'w-2.5 h-2.5 rotate-45 bg-pf-accent shadow-[0_0_8px_#7CFFB2]'));
    top.appendChild(el('h2', 'font-semibold text-sm', list.length + ' selecionados'));
    head.appendChild(top);
    const kinds = {};
    for (const h of list) kinds[PF.HAZARDS[h.type].label] = (kinds[PF.HAZARDS[h.type].label] || 0) + 1;
    head.appendChild(el('p', 'text-[11px] text-pf-muted mb-3', Object.entries(kinds).map(([k, n]) => n + '× ' + k).join(' · ')));
    const row = el('div', 'flex flex-wrap gap-2');
    const btn = (label, title, run, cls = '') => { const b = el('button', 'pf-btn flex-1 ' + cls, label); b.title = title; b.addEventListener('click', run); row.appendChild(b); return b; };
    const grp = btn('Agrupar', 'Ctrl+G · Formas e Grupos viram um grupo com pivô no centro', () => PF.mass.group());
    grp.disabled = !list.some(h => h.type === 'shape' || h.type === 'group');
    btn('Duplicar', 'Ctrl+D', () => PF.app.duplicate());
    btn('Excluir', 'Delete', () => PF.app.deleteSelected(), 'pf-btn-danger');
    head.appendChild(row);
    head.appendChild(el('p', 'text-[10px] text-pf-muted mt-2', 'Shift+clique soma ou tira · arrastar move todos (no mapa e na timeline) · Ctrl+A seleciona tudo.'));

    const aroundSel = { key: 'around', label: 'Em volta de', type: 'select', options: [[0, 'Centro da seleção'], [1, 'Centro da arena']] };
    const apply = (parent, label, run) => { const b = el('button', 'pf-btn pf-btn-primary w-full mt-1', label); b.addEventListener('click', run); parent.appendChild(b); };

    const sr = section('Girar e escalar');
    selectField(sr, massOpts, aroundSel);
    numberField(sr, massOpts, { key: 'deg', label: 'Ângulo', min: -360, max: 360, step: 1, unit: '°' });
    const rr = el('div', 'flex gap-2 mb-3');
    const rot = (sign, label) => { const b = el('button', 'pf-btn flex-1', label); b.addEventListener('click', () => PF.mass.rotate(sign * massOpts.deg, massOpts.around)); rr.appendChild(b); };
    rot(-1, '↺ Girar −'); rot(1, 'Girar + ↻');
    sr.appendChild(rr);
    numberField(sr, massOpts, { key: 'pct', label: 'Escala', min: 5, max: 500, step: 1, unit: '%' });
    apply(sr, 'Escalar', () => PF.mass.scale(massOpts.pct, massOpts.around));

    const sd = section('Distribuir');
    selectField(sd, massOpts, { key: 'mode', label: 'Jeito', type: 'select', options: [[0, 'Radial'], [1, 'Grade'], [2, 'Espiral']] });
    sd.lastChild.querySelector('select').addEventListener('change', () => P.rebuild());
    if (massOpts.mode === 0) {
      numberField(sd, massOpts, { key: 'radius', label: 'Raio', min: 0, max: 2000, step: 1, unit: 'px' });
      numberField(sd, massOpts, { key: 'start', label: 'Ângulo inicial', min: -180, max: 180, step: 1, unit: '°' });
    } else if (massOpts.mode === 1) {
      numberField(sd, massOpts, { key: 'cols', label: 'Colunas', min: 1, max: 32, step: 1, unit: '' });
      numberField(sd, massOpts, { key: 'gap', label: 'Espaço', min: 0, max: 1000, step: 1, unit: 'px' });
    } else {
      numberField(sd, massOpts, { key: 'r0', label: 'Raio inicial', min: 0, max: 2000, step: 1, unit: 'px' });
      numberField(sd, massOpts, { key: 'rstep', label: 'Raio a mais por item', min: -500, max: 500, step: 1, unit: 'px' });
      numberField(sd, massOpts, { key: 'start', label: 'Ângulo inicial', min: -180, max: 180, step: 1, unit: '°' });
      numberField(sd, massOpts, { key: 'astep', label: 'Ângulo a mais por item', min: -360, max: 360, step: 1, unit: '°' });
    }
    if (massOpts.mode !== 1) selectField(sd, massOpts, { key: 'face', label: 'Apontar para fora', type: 'select', options: [[1, 'Sim'], [0, 'Não']] });
    selectField(sd, massOpts, aroundSel);
    apply(sd, 'Distribuir (na ordem do tempo)', () => PF.mass.distribute(massOpts));

    const st = section('Tempo e ritmo');
    numberField(st, massOpts, { key: 'step', label: 'Escada: um a cada', min: 0, max: 32, step: 0.125, unit: 'bt' });
    apply(st, 'Aplicar escada no tempo', () => PF.mass.stagger(massOpts.step));
    st.appendChild(el('p', 'text-[10px] text-pf-muted mt-1 mb-3', '0 = todos no tempo do primeiro.'));
    numberField(st, massOpts, { key: 'amount', label: 'Pulsar: cresce', min: -90, max: 300, step: 1, unit: '%' });
    apply(st, 'Pulsar na batida (todos)', () => PF.mass.pulseAll(massOpts.amount));
  }

  // presets de grupo guardados no navegador
  function buildPresets() {
    const list = PF.mass ? PF.mass.presets() : [];
    const s = section('Presets');
    if (!list.length) {
      s.appendChild(el('p', 'text-[11px] text-pf-muted leading-relaxed', 'Nenhum. Selecione um Grupo e clique em "Salvar preset" para reaproveitar (mandalas, túneis…).'));
      return;
    }
    list.forEach((pr, i) => {
      const row = el('div', 'pf-card mb-1.5 flex items-center gap-2 px-2 py-1.5');
      row.appendChild(el('span', 'text-xs flex-1 truncate', pr.name));
      const ins = el('button', 'pf-btn', 'Inserir');
      ins.title = 'No centro da arena, no tempo da agulha';
      ins.addEventListener('click', () => PF.mass.insertPreset(i));
      row.appendChild(ins);
      row.appendChild(iconBtn('del', 'Apagar preset', () => PF.mass.removePreset(i)));
      s.appendChild(row);
    });
  }

  // BPM, primeira batida, compasso e encaixe na grade
  function buildRhythm(lvl) {
    const app = PF.app;
    const s = section('Ritmo');
    const bpmRow = numberField(s, lvl, { key: 'bpm', label: 'BPM', min: 0, max: 400, step: 1, unit: '' });
    // 1–19 não é um andamento: a troca vira 20 (0 desliga a grade)
    bpmRow.querySelector('input').addEventListener('change', () => {
      if (lvl.bpm > 0 && lvl.bpm < 20) { lvl.bpm = 20; PF.app.changed(true); }
    });
    numberField(s, lvl, { key: 'offset', label: '1ª batida', min: 0, max: 60, step: 0.01, unit: 's' });
    numberField(s, lvl, { key: 'beatsPerBar', label: 'Batidas/compasso', min: 1, max: 16, step: 1, unit: '' });

    const row = el('div', 'flex items-center justify-between gap-2 mb-2');
    row.appendChild(el('label', 'text-xs text-pf-text/80', 'Encaixe'));
    const sel = el('select', 'pf-select');
    for (const [v, label] of [['off', 'Livre'], ['1', '1 batida'], ['2', '1/2'], ['3', '1/3'], ['4', '1/4'], ['8', '1/8']]) {
      const o = el('option', '', label);
      o.value = v;
      sel.appendChild(o);
    }
    const syncSel = () => { sel.value = app.snapOn ? String(app.snapDiv) : 'off'; };
    syncSel();
    sel.addEventListener('change', () => {
      if (sel.value === 'off') app.setSnapOff();
      else app.setSnapDiv(Number(sel.value));
    });
    row.appendChild(sel);
    s.appendChild(row);

    const info = el('p', 'text-[11px] text-pf-muted font-mono mt-1 mb-2');
    const syncInfo = () => {
      info.textContent = lvl.bpm > 0
        ? '1 batida = ' + (60 / lvl.bpm).toFixed(3) + ' s · compasso = ' + (60 / lvl.bpm * lvl.beatsPerBar).toFixed(2) + ' s'
        : 'BPM 0 = sem grade (encaixe a cada 0,05 s)';
    };
    syncInfo();
    s.appendChild(info);
    syncers.push(syncSel, syncInfo);

    const tap = el('button', 'pf-btn w-full', 'Bater o ritmo (B)');
    tap.title = 'Bata no ritmo da música; tocando, a última batida vira a 1ª batida';
    tap.addEventListener('click', () => app.tapTempo());
    s.appendChild(tap);
  }

  function buildLevel() {
    const lvl = PF.app.level;
    const s = section('Fase');
    const row = el('div', 'flex items-center justify-between gap-2 mb-2');
    row.appendChild(el('label', 'text-xs text-pf-text/80', 'Nome'));
    const name = el('input', 'pf-text w-40');
    name.type = 'text';
    name.maxLength = 80;
    name.value = lvl.name;
    name.addEventListener('input', () => { lvl.name = name.value; PF.app.changed(false); });
    name.addEventListener('change', () => PF.app.changed(true));
    row.appendChild(name);
    s.appendChild(row);
    numberField(s, lvl, { key: 'duration', label: 'Duração', min: 1, max: 3600, step: 1, unit: 's' });
    s.appendChild(el('p', 'text-[11px] text-pf-muted mt-2', lvl.hazards.length + ' perigo(s) na fase'));

    buildRhythm(lvl);
    buildPresets();
    const sv = section('Formas');
    const ib = el('button', 'pf-btn w-full', 'Importar SVG');
    ib.title = 'Cria formas de pontos a partir de um arquivo .svg';
    ib.addEventListener('click', () => P.importSVG());
    sv.appendChild(ib);
    sv.appendChild(el('p', 'text-[10px] text-pf-muted mt-2 leading-relaxed', 'P = caneta: clique põe ponto, arrastar desenha à mão livre, clique no 1º ponto fecha, Enter ou duplo clique termina.'));

    const sp = section('Jogador');
    numberField(sp, lvl.spawn, { key: 'x', label: 'Início X', min: 12, max: W - 12, step: 1, unit: 'px' });
    numberField(sp, lvl.spawn, { key: 'y', label: 'Início Y', min: 12, max: H - 12, step: 1, unit: 'px' });
    sp.appendChild(el('p', 'text-[11px] text-pf-muted mt-2 leading-relaxed',
      PF.PLAYER.hp + ' vidas · dash invencível com Espaço/Shift. Arraste o losango "início" no mapa.'));

    const sm = section('Música');
    const A = PF.audio;
    if (!A.buffer) {
      sm.appendChild(el('p', 'text-xs text-pf-muted', 'Nenhuma música. Importe pelo botão "♪ Música".'));
    } else {
      sm.appendChild(el('p', 'text-xs text-pf-text truncate', A.name));
      sm.appendChild(el('p', 'text-[11px] font-mono text-pf-muted mt-1', PF.u.fmtTime(A.duration)));
      const ok = A.check && A.check.verdict === 'free' ? 'Licença livre declarada' : 'Sem sinais de copyright nos metadados';
      sm.appendChild(el('p', 'text-[11px] text-pf-accent mt-2', '✓ ' + ok));
      const fit = el('button', 'pf-btn w-full mt-3', 'Ajustar duração à música');
      fit.addEventListener('click', () => { lvl.duration = Math.max(1, Math.ceil(A.duration)); PF.panel.rebuild(); PF.app.commit(); });
      sm.appendChild(fit);
    }

    const s2 = section('Como usar');
    const items = [
      ['1 – 9, 0','escolher perigo e clicar no mapa'],
      ['F', 'forma livre (círculo, quadrado, triângulo, laser)'],
      ['P', 'caneta: pontos / pincel à mão livre'],
      ['Shift+clique', 'somar à seleção (mapa e timeline)'],
      ['Ctrl+A', 'selecionar tudo'],
      ['Ctrl+G', 'agrupar formas (pivô coletivo, repetidor)'],
      ['Ctrl+Shift+G', 'desagrupar'],
      ['Alt+arrastar', 'mudar o pivô da forma'],
      ['V / Esc', 'ferramenta de seleção'],
      ['Arrastar', 'mover no mapa ou na timeline'],
      ['Shift', 'encaixar na grade ao arrastar'],
      ['Alt', 'tempo livre ao arrastar na timeline'],
      ['Espaço', 'tocar / pausar'],
      ['← →', 'andar 0,1 s (Shift: 1 s)'],
      [', .', 'batida anterior / seguinte (Shift: compasso)'],
      ['G', 'encaixe na batida liga/desliga'],
      ['Shift+G', 'trocar a subdivisão do encaixe'],
      ['B', 'bater o ritmo para achar o BPM'],
      ['Del', 'excluir selecionado'],
      ['Ctrl+C', 'copiar o perigo selecionado'],
      ['Ctrl+V', 'colar no tempo do playhead'],
      ['Ctrl+D', 'copiar e colar (mesmo tempo, ao lado)'],
      ['Ctrl+Z / Y', 'desfazer / refazer'],
      ['Ctrl+roda', 'zoom na timeline'],
      ['T', 'testar a fase a partir do playhead'],
      ['R', 'reiniciar o teste'],
    ];
    const list = el('ul', 'space-y-1.5');
    for (const [k, txt] of items) {
      const li = el('li', 'flex items-center gap-2 text-xs text-pf-text/80');
      li.appendChild(el('span', 'pf-kbd', k));
      li.appendChild(el('span', '', txt));
      list.appendChild(li);
    }
    s2.appendChild(list);
  }
})();

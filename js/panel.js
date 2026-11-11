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
    const h = PF.app.selected();
    const id = h ? h.id : null;
    if (id !== boundId) { boundId = id; build(h); }
    else syncers.forEach(f => f());
  };

  function section(title) {
    const s = el('section', 'px-4 py-3 border-b border-pf-line');
    if (title) s.appendChild(el('h3', 'text-[10px] uppercase tracking-[0.18em] text-pf-muted mb-3 font-semibold', title));
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

    const s2 = section('Propriedades');
    for (const p of def.props) (p.type === 'select' ? selectField : rangeField)(s2, h, p);

    const s3 = section();
    s3.appendChild(el('p', 'text-xs leading-relaxed text-pf-muted', def.desc));
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
      ['1 – 5','escolher perigo e clicar no mapa'],
      ['V / Esc', 'ferramenta de seleção'],
      ['Arrastar', 'mover no mapa ou na timeline'],
      ['Shift', 'encaixar na grade ao arrastar'],
      ['Alt', 'tempo livre ao arrastar na timeline'],
      ['Espaço', 'tocar / pausar'],
      ['← →', 'andar 0,1 s (Shift: 1 s)'],
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

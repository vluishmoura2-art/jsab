// Edição em massa (PF.mass): agrupar/desagrupar, girar e escalar vários perigos em volta de um
// centro, distribuir (radial, grade, espiral), escada no tempo, pulsar todos e presets de grupo.
// Age sobre a seleção do editor (PF.app.selection()); cada operação vira um passo do desfazer.
(function () {
  const { W, H, u } = PF;
  const M = PF.mass = {};
  const PRESET_KEY = 'pulsefield.presets';
  const toast = (m, k) => { if (PF.toast) PF.toast(m, 'info', k); };
  const editable = () => PF.app.mode === 'edit' && !PF.app.editLevel;
  const done = () => { PF.panel.rebuild(); PF.app.commit(); };
  const wrap = a => u.round(((a + 540) % 360 + 360) % 360 - 180, 2);

  // centro: 0 = centro da seleção, 1 = centro da arena
  function center(list, around) {
    if (around === 1 || !list.length) return [W / 2, H / 2];
    let x = 0, y = 0;
    for (const h of list) { x += h.x; y += h.y; }
    return [x / list.length, y / list.length];
  }
  // campo de ângulo de cada tipo (os que têm direção livre)
  const angleKey = h => (h.type === 'shape' || h.type === 'group' ? 'rot' : h.type === 'line' || h.type === 'curve' ? 'angle' : null);
  const byTime = list => list.slice().sort((a, b) => a.time - b.time || a.id - b.id);
  const place = (h, x, y) => { h.x = u.round(u.clamp(x, -400, W + 400), 2); h.y = u.round(u.clamp(y, -400, H + 400), 2); };

  M.rotate = function (deg, around = 0) {
    const list = PF.app.selection();
    if (!editable() || !list.length || !deg) return;
    const [cx, cy] = center(list, around);
    for (const h of list) {
      const [x, y] = PF.m.rotateAround(h.x, h.y, cx, cy, deg);
      place(h, x, y);
      const k = angleKey(h);
      if (k) h[k] = wrap(h[k] + deg);
    }
    done();
  };

  M.scale = function (pct, around = 0) {
    const list = PF.app.selection(), k = pct / 100;
    if (!editable() || !list.length || !(k > 0) || k === 1) return;
    const [cx, cy] = center(list, around);
    for (const h of list) {
      place(h, cx + (h.x - cx) * k, cy + (h.y - cy) * k);
      if (h.type === 'shape') {
        if (h.kind === 4) h.pts = PF.geo.stretch(h.pts, k, k);
        h.w = u.clamp(u.round(h.w * k, 2), 4, 3000);
        h.h = u.clamp(u.round(h.h * k, 2), 2, 3000);
        h.stroke = u.clamp(u.round(h.stroke * k, 2), 2, 200);
        h.pivotX = u.round(h.pivotX * k, 2); h.pivotY = u.round(h.pivotY * k, 2);
      } else if (h.type === 'group') h.scale = u.clamp(u.round(h.scale * k, 2), 5, 500);
    }
    done();
  };

  // o: { mode: 0 radial | 1 grade | 2 espiral, radius, start, face, cols, gap, r0, rstep, astep }
  M.distribute = function (o) {
    const list = byTime(PF.app.selection()), n = list.length;
    if (!editable() || n < 2) return;
    const [cx, cy] = center(list, o.around);
    list.forEach((h, i) => {
      let x, y, a = null;
      if (o.mode === 0) {
        a = o.start + 360 * i / n;
        x = cx + Math.cos(a * Math.PI / 180) * o.radius; y = cy + Math.sin(a * Math.PI / 180) * o.radius;
      } else if (o.mode === 1) {
        const cols = Math.max(1, Math.min(n, o.cols)), rows = Math.ceil(n / cols);
        x = cx + (i % cols - (cols - 1) / 2) * o.gap; y = cy + (Math.floor(i / cols) - (rows - 1) / 2) * o.gap;
      } else {
        a = o.start + i * o.astep;
        const r = o.r0 + i * o.rstep;
        x = cx + Math.cos(a * Math.PI / 180) * r; y = cy + Math.sin(a * Math.PI / 180) * r;
      }
      place(h, x, y);
      const k = angleKey(h);
      if (o.face && a != null && k) h[k] = wrap(a + (k === 'rot' ? 90 : 0)); // aponta para fora
    });
    done();
  };

  // escada: cada um "step" batidas depois do anterior (0 = todos no tempo do primeiro)
  M.stagger = function (stepBt) {
    const list = byTime(PF.app.selection());
    if (!editable() || list.length < 2) return;
    const beat = PF.app.beatLen() || 0.5, t0 = list[0].time;
    list.forEach((h, i) => { h.time = u.round(u.clamp(t0 + i * stepBt * beat, 0, PF.app.level.duration), 4); });
    done();
  };

  M.pulseAll = function (amount) {
    const list = PF.app.selection().filter(h => h.type === 'shape' || h.type === 'group');
    if (!editable() || !list.length) { toast('Pulsar em massa vale para Formas e Grupos', 'mass'); return; }
    for (const h of list) {
      if (h.behaviors.length >= PF.hz.MAX_BEHAVIORS) continue;
      h.behaviors.push({ ...PF.hz.newBehavior('pulse'), amount });
    }
    done();
    toast('Pulsar na batida adicionado em ' + list.length + ' item(ns)', 'mass');
  };

  M.group = function () {
    if (!editable()) return;
    const list = PF.app.selection();
    const g = PF.hz.makeGroup(list);
    if (!g) { toast('Selecione Formas (ou Grupos) para agrupar · Shift+clique soma à seleção', 'mass'); return; }
    const used = new Set(list.filter(h => h.type === 'shape' || h.type === 'group').map(h => h.id));
    if (used.size > PF.hz.MAX_ITEMS) { toast('Um grupo guarda no máximo ' + PF.hz.MAX_ITEMS + ' itens', 'mass'); return; }
    PF.app.level.hazards = PF.app.level.hazards.filter(h => !used.has(h.id));
    PF.app.level.hazards.push(g);
    PF.app.select(g.id);
    done();
    const skipped = list.length - used.size;
    toast('Grupo com ' + used.size + ' item(ns)' + (skipped ? ' · ' + skipped + ' perigo(s) pronto(s) ficaram de fora (só Formas entram)' : '') + ' · Ctrl+Shift+G desagrupa', 'mass');
  };

  M.ungroup = function () {
    if (!editable()) return;
    const g = PF.app.selected();
    if (!g || g.type !== 'group') { toast('Selecione um Grupo para desagrupar', 'mass'); return; }
    PF.hz.setBeat(PF.app.level);
    const pieces = PF.hz.ungroup(g).map(p => PF.hz.clone(p));
    PF.app.level.hazards = PF.app.level.hazards.filter(h => h.id !== g.id).concat(pieces);
    PF.app.select(null);
    for (const p of pieces) PF.app.multi.add(p.id);
    PF.app.selectedId = pieces.length ? pieces[0].id : null;
    if (pieces.length === 1) PF.app.multi.clear();
    done();
    toast(pieces.length + ' peça(s) soltas' + (g.behaviors.length ? ' · os comportamentos do grupo ficaram de fora' : ''), 'mass');
  };

  // ---------- presets (no navegador) ----------
  M.presets = function () {
    try { const v = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  };
  const savePresets = list => { try { localStorage.setItem(PRESET_KEY, JSON.stringify(list.slice(0, 40))); return true; } catch (e) { return false; } };
  M.savePreset = function (g) {
    if (!g || g.type !== 'group') return;
    const name = (prompt('Nome do preset:', 'Mandala ' + (M.presets().length + 1)) || '').trim().slice(0, 40);
    if (!name) return;
    const data = JSON.parse(JSON.stringify(g));
    delete data.id;
    const list = M.presets();
    list.unshift({ name, data });
    if (savePresets(list)) toast('Preset "' + name + '" salvo · ele aparece no painel da fase', 'preset');
    PF.panel.rebuild();
  };
  M.insertPreset = function (i) {
    const p = M.presets()[i];
    if (!p || !editable()) return;
    const n = PF.hz.normalize({ ...p.data, type: 'group' });
    if (!n) return;
    const c = PF.hz.clone(n);
    c.x = W / 2; c.y = H / 2;
    const app = PF.app;
    c.time = u.clamp(app.level.bpm > 0 && app.snapOn ? app.snapTime(app.t) : u.round(app.t, 2), 0, app.level.duration);
    app.level.hazards.push(c);
    app.select(c.id);
    done();
  };
  M.removePreset = function (i) {
    const list = M.presets();
    if (!list[i] || !confirm('Apagar o preset "' + list[i].name + '"?')) return;
    list.splice(i, 1);
    savePresets(list);
    PF.panel.rebuild();
  };
})();

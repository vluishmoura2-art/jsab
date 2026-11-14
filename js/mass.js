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

  // ---------- prefabs (guardados na fase, cópias vinculadas) ----------
  const CARRY = ['keys', 'parent', 'pin', 'pdelay', 'life']; // são da cópia, não do conteúdo
  const lvl = () => PF.app.level;
  const findPrefab = id => lvl().prefabs.find(p => p.id === id) || null;
  const nextPrefabId = () => lvl().prefabs.reduce((m, p) => Math.max(m, p.id), 0) + 1;
  const carry = (from, to) => { for (const k of CARRY) if (from[k] != null) to[k] = JSON.parse(JSON.stringify(from[k])); };
  // conteúdo do grupo (sem posição/tempo/vínculos) normalizado
  function groupData(g) {
    const d = JSON.parse(JSON.stringify(g));
    for (const k of ['id', 'prefabOf', 'pRot', 'pScale', ...CARRY]) delete d[k];
    const n = PF.hz.normalize({ ...d, type: 'group', x: 0, y: 0, time: 0 });
    if (n) delete n.id;
    return n;
  }
  const replaceHazard = (old, nu) => { const hs = lvl().hazards, i = hs.indexOf(old); if (i >= 0) hs[i] = nu; else hs.push(nu); };
  M.instances = id => lvl().hazards.filter(h => h.type === 'prefab' && h.ref === id).length;

  M.createPrefab = function (g) {
    if (!editable() || !g || g.type !== 'group') return;
    if (lvl().prefabs.length >= 32) { toast('Limite de 32 prefabs por fase', 'prefab'); return; }
    const name = (prompt('Nome do prefab:', 'Prefab ' + (lvl().prefabs.length + 1)) || '').trim().slice(0, 40);
    if (!name) return;
    const data = groupData(g);
    if (!data || !data.items.length) return;
    const id = nextPrefabId();
    lvl().prefabs.push({ id, name, group: data });
    const inst = PF.hz.create('prefab', g.x, g.y, g.time);
    Object.assign(inst, { id: g.id, ref: id, rot: 0, scale: 100 });
    carry(g, inst);
    replaceHazard(g, inst);
    PF.app.select(inst.id);
    done();
    toast('Prefab "' + name + '" criado · insira mais cópias no painel da fase (Prefabs)', 'prefab');
  };
  M.insertPrefab = function (id) {
    const p = findPrefab(id), app = PF.app;
    if (!p || !editable()) return;
    const t0 = u.clamp(app.level.bpm > 0 && app.snapOn ? app.snapTime(app.t) : u.round(app.t, 2), 0, app.level.duration);
    const inst = PF.hz.create('prefab', W / 2, H / 2, t0);
    inst.ref = id;
    app.level.hazards.push(inst);
    app.select(inst.id);
    done();
  };
  M.duplicatePrefab = function (id) {
    const p = findPrefab(id);
    if (!p || !editable() || lvl().prefabs.length >= 32) return;
    lvl().prefabs.push({ id: nextPrefabId(), name: (p.name + ' (cópia)').slice(0, 40), group: JSON.parse(JSON.stringify(p.group)) });
    done();
  };
  M.renamePrefab = function (id) {
    const p = findPrefab(id);
    if (!p || !editable()) return;
    const name = (prompt('Novo nome:', p.name) || '').trim().slice(0, 40);
    if (!name || name === p.name) return;
    p.name = name;
    done();
  };
  // cópia vinculada → grupo comum (rotação/escala da cópia somadas às do conteúdo)
  function toGroup(inst, keepLink) {
    const p = findPrefab(inst.ref);
    if (!p) return null;
    const g = { ...JSON.parse(JSON.stringify(p.group)), type: 'group', id: inst.id, x: inst.x, y: inst.y, time: inst.time };
    if (keepLink) Object.assign(g, { prefabOf: p.id, pRot: inst.rot, pScale: inst.scale });
    else { g.rot = u.clamp(g.rot + inst.rot, -360, 360); g.scale = u.clamp(g.scale * inst.scale / 100, 5, 500); }
    carry(inst, g);
    return g;
  }
  M.deletePrefab = function (id) {
    const p = findPrefab(id);
    if (!p || !editable()) return;
    const n = M.instances(id);
    if (!confirm('Apagar o prefab "' + p.name + '"?' + (n ? ' As ' + n + ' cópia(s) viram grupos comuns.' : ''))) return;
    for (const h of lvl().hazards.slice()) if (h.type === 'prefab' && h.ref === id) { const g = toGroup(h, false); if (g) replaceHazard(h, g); }
    lvl().prefabs = lvl().prefabs.filter(q => q.id !== id);
    PF.app.select(null);
    done();
  };
  // abre o conteúdo do prefab como grupo editável no lugar da cópia
  M.editPrefab = function (inst) {
    if (!editable() || !inst || inst.type !== 'prefab') return;
    const g = toGroup(inst, true);
    if (!g) { toast('Este prefab não existe mais na fase', 'prefab'); return; }
    replaceHazard(inst, g);
    PF.app.select(g.id);
    done();
    toast('Editando o prefab · mexa nos itens e clique em "Salvar no prefab" para atualizar todas as cópias', 'prefab');
  };
  M.savePrefab = function (g) {
    if (!editable() || !g || !g.prefabOf) return;
    const p = findPrefab(g.prefabOf);
    if (!p) { toast('O prefab foi apagado; o grupo fica comum', 'prefab'); M.unlinkPrefab(g); return; }
    const data = groupData(g);
    if (!data || !data.items.length) return;
    p.group = data;
    const inst = PF.hz.create('prefab', g.x, g.y, g.time);
    Object.assign(inst, { id: g.id, ref: p.id, rot: g.pRot || 0, scale: g.pScale || 100 });
    carry(g, inst);
    replaceHazard(g, inst);
    PF.app.select(inst.id);
    done();
    toast('Prefab "' + p.name + '" salvo · ' + M.instances(p.id) + ' cópia(s) atualizada(s)', 'prefab');
  };
  M.unlinkPrefab = function (h) {
    if (!editable() || !h) return;
    if (h.type === 'prefab') { const g = toGroup(h, false); if (g) { replaceHazard(h, g); PF.app.select(g.id); } }
    else if (h.type === 'group') { delete h.prefabOf; delete h.pRot; delete h.pScale; }
    done();
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

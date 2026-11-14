// Autosave no navegador e exportar/importar fases em JSON.
(function () {
  const { u } = PF;
  const KEY = 'pulsefield.autosave.v1';

  const S = PF.storage = {
    blank() {
      // bpm 0 = sem grade de batidas; offset = tempo (s) da 1ª batida; beatsPerBar = batidas por compasso
      // markers: marcadores da timeline; checkpoints: onde o jogador volta; cam/theme: trilhas de
      // keyframes da câmera e do tema; bg: camadas do fundo (parallax); prefabs: grupos reutilizáveis
      return {
        format: 'pulsefield-level', version: PF.VERSION, name: 'Nova fase', duration: 30, bpm: 0, offset: 0, beatsPerBar: 4,
        spawn: { x: 320, y: 360 }, hazards: [], markers: [], checkpoints: [], cam: {}, theme: [], bg: [], prefabs: [],
      };
    },

    demo() {
      const lvl = S.blank();
      lvl.name = 'Demo';
      const add = (type, x, y, time, props) => {
        const h = PF.hz.create(type, x, y, time);
        Object.assign(h, props);
        lvl.hazards.push(h);
      };
      add('ball', 0, 180, 1, { count: 4, reload: 0.4, speed: 420 });
      add('ball', 1280, 540, 1.8, { dir: -1, count: 4, reload: 0.4, speed: 420 });
      add('explosive', 640, 360, 3, { fuse: 1.4, fragments: 12, fragSpeed: 340 });
      add('line', 640, 120, 5.5, { warn: 1, thickness: 40 });
      add('line', 640, 600, 6, { warn: 1, thickness: 40 });
      add('circle', 960, 360, 7.5, { warn: 1.2, radius: 160 });
      add('circle', 320, 360, 8, { warn: 1.2, radius: 220, thickness: 30 });
      return lvl;
    },

    normalize(raw) {
      const lvl = S.blank();
      if (!raw || typeof raw !== 'object') return lvl;
      if (typeof raw.name === 'string') lvl.name = raw.name.slice(0, 80);
      const d = Number(raw.duration);
      if (Number.isFinite(d) && d > 0) lvl.duration = u.clamp(d, 1, 3600);
      const bpm = Number(raw.bpm);
      if (Number.isFinite(bpm) && bpm > 0) lvl.bpm = u.round(u.clamp(bpm, 20, 400), 2);
      const off = Number(raw.offset);
      if (Number.isFinite(off)) lvl.offset = u.round(u.clamp(off, 0, 60), 3);
      const bpb = Number(raw.beatsPerBar);
      if (Number.isFinite(bpb)) lvl.beatsPerBar = u.clamp(Math.round(bpb), 1, 16);
      if (raw.spawn && Number.isFinite(Number(raw.spawn.x)) && Number.isFinite(Number(raw.spawn.y))) {
        lvl.spawn = { x: u.clamp(Number(raw.spawn.x), 12, PF.W - 12), y: u.clamp(Number(raw.spawn.y), 12, PF.H - 12) };
      }
      if (Array.isArray(raw.hazards)) {
        for (const h of raw.hazards) {
          const n = PF.hz.normalize(h);
          if (n) lvl.hazards.push(n);
        }
      }
      PF.hz.syncIds(lvl.hazards);
      PF.anim.normLevel(raw, lvl);
      if (Array.isArray(raw.prefabs)) {
        const seen = new Set();
        for (const p of raw.prefabs.slice(0, 32)) {
          if (!p || !Number.isInteger(p.id) || p.id <= 0 || seen.has(p.id)) continue;
          const g = PF.hz.normalize({ ...(p.group || {}), type: 'group', x: 0, y: 0, time: 0 });
          if (!g || !g.items.length) continue;
          delete g.id; delete g.prefabOf; delete g.pRot; delete g.pScale;
          seen.add(p.id);
          lvl.prefabs.push({ id: p.id, name: (typeof p.name === 'string' ? p.name.slice(0, 40) : '') || 'Prefab ' + p.id, group: g });
        }
      }
      return lvl;
    },

    save(level) {
      try { localStorage.setItem(KEY, JSON.stringify(level)); } catch (e) { /* armazenamento indisponível */ }
    },

    load() {
      try {
        const s = localStorage.getItem(KEY);
        return s ? S.normalize(JSON.parse(s)) : null;
      } catch (e) { return null; }
    },

    exportFile(level) {
      const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
      const slug = (level.name || 'fase').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fase';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = slug + '.pulsefield.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },

    importFile(file) {
      return file.text().then(txt => {
        const raw = JSON.parse(txt);
        if (!raw || raw.format !== 'pulsefield-level') throw new Error('Este arquivo não é uma fase do Pulsefield.');
        return S.normalize(raw);
      });
    },
  };
})();

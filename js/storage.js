// Autosave no navegador e exportar/importar fases em JSON.
(function () {
  const { u } = PF;
  const KEY = 'pulsefield.autosave.v1';

  const S = PF.storage = {
    blank() {
      return { format: 'pulsefield-level', version: PF.VERSION, name: 'Nova fase', duration: 30, spawn: { x: 320, y: 360 }, hazards: [] };
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

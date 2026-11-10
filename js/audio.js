// Música da fase: decodifica, toca sincronizada com o playhead, calcula a forma
// de onda e guarda o arquivo no navegador (IndexedDB) para sobreviver ao recarregar.
(function () {
  const PEAK_RATE = 50; // picos por segundo
  const DB = 'pulsefield', STORE = 'files', KEY = 'music';

  function computePeaks(buf) {
    const n = Math.ceil(buf.duration * PEAK_RATE);
    const peaks = new Float32Array(n);
    const per = buf.sampleRate / PEAK_RATE;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const s0 = Math.floor(i * per), s1 = Math.min(data.length, Math.floor((i + 1) * per));
        let m = peaks[i];
        for (let s = s0; s < s1; s += 4) { const v = Math.abs(data[s]); if (v > m) m = v; }
        peaks[i] = m;
      }
    }
    let max = 0;
    for (let i = 0; i < n; i++) if (peaks[i] > max) max = peaks[i];
    if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
    return peaks;
  }

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbRun(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }

  const A = PF.audio = {
    ctx: null, gain: null, buffer: null, source: null,
    peaks: null, peakRate: PEAK_RATE, duration: 0,
    name: '', check: null,
    playing: false, startedAt: 0, startOffset: 0,
    volume: 0.8,

    ensureCtx() {
      if (!A.ctx) {
        A.ctx = new (window.AudioContext || window.webkitAudioContext)();
        A.gain = A.ctx.createGain();
        A.gain.gain.value = A.volume;
        A.gain.connect(A.ctx.destination);
      }
      if (A.ctx.state === 'suspended') A.ctx.resume();
    },

    raw: null,   // bytes originais do arquivo (para publicar junto com a fase)
    saved: null, // sua música guardada enquanto toca a música de uma fase online

    async load(arrayBuffer, name, check) {
      A.ensureCtx();
      const buf = await A.ctx.decodeAudioData(arrayBuffer.slice(0));
      A.stop();
      A.buffer = buf;
      A.duration = buf.duration;
      A.peaks = computePeaks(buf);
      A.name = name;
      A.check = check;
      A.raw = arrayBuffer;
    },

    // Toca temporariamente a música de outra fase sem perder a sua.
    async pushTemp(arrayBuffer, name) {
      A.ensureCtx();
      const buf = await A.ctx.decodeAudioData(arrayBuffer.slice(0));
      A.stop();
      if (!A.saved) A.saved = { buffer: A.buffer, peaks: A.peaks, duration: A.duration, name: A.name, check: A.check, raw: A.raw };
      A.buffer = buf;
      A.duration = buf.duration;
      A.peaks = computePeaks(buf);
      A.name = name;
      A.check = null;
      A.raw = null;
    },
    popTemp() {
      if (!A.saved) return;
      A.stop();
      Object.assign(A, A.saved);
      A.saved = null;
    },

    play(t) {
      A.stop();
      if (!A.buffer || t >= A.buffer.duration) return;
      A.ensureCtx();
      const src = A.ctx.createBufferSource();
      src.buffer = A.buffer;
      src.connect(A.gain);
      src.start(0, Math.max(0, t));
      src.onended = () => { if (A.source === src) { A.source = null; A.playing = false; } };
      A.source = src;
      A.startedAt = A.ctx.currentTime;
      A.startOffset = Math.max(0, t);
      A.playing = true;
    },

    stop() {
      if (A.source) {
        A.source.onended = null;
        try { A.source.stop(); } catch (e) { /* já parou */ }
        A.source.disconnect();
        A.source = null;
      }
      A.playing = false;
    },

    time() { return A.startOffset + (A.ctx.currentTime - A.startedAt); },

    setVolume(v) {
      A.volume = v;
      if (A.gain) A.gain.gain.value = v;
      try { localStorage.setItem('pulsefield.volume', String(v)); } catch (e) { /* ok */ }
    },

    clear() {
      A.stop();
      A.buffer = null; A.peaks = null; A.duration = 0; A.name = ''; A.check = null; A.raw = null;
      idbRun('readwrite', s => s.delete(KEY)).catch(() => {});
    },

    persist(arrayBuffer) {
      return idbRun('readwrite', s => s.put({ name: A.name, check: A.check, data: arrayBuffer }, KEY)).catch(() => {});
    },

    async restore() {
      try {
        const rec = await idbRun('readonly', s => s.get(KEY));
        if (rec && rec.data && rec.check && rec.check.allowed) {
          await A.load(rec.data, rec.name, rec.check);
          return true;
        }
      } catch (e) { /* sem IndexedDB ou arquivo inválido */ }
      return false;
    },
  };

  try {
    const v = parseFloat(localStorage.getItem('pulsefield.volume'));
    if (Number.isFinite(v)) A.volume = PF.u.clamp(v, 0, 1);
  } catch (e) { /* ok */ }
})();

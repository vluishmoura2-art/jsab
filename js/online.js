// Fases online: publicar a fase atual, ver ao vivo as fases que todos publicaram
// e quantas pessoas estão no jogo. Conversa com server.js (API + Server-Sent Events).
(function () {
  const $ = id => document.getElementById(id);
  const KEY_URL = 'pulsefield.server', KEY_AUTHOR = 'pulsefield.author';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ok */ } },
  };

  const O = PF.online = { base: '', online: 0, connected: false, levels: [], es: null, retry: null };

  const defaultBase = () => (/^https?:$/.test(location.protocol) ? location.origin : 'http://localhost:5173');

  // ---------- cópia local das fases publicadas (localStorage) ----------
  // Guarda a lista e o JSON de cada fase de todos, por servidor, para ver e jogar sem conexão.
  // A música não entra (localStorage tem só alguns MB); offline a fase toca sem som.
  const KEY_CACHE = 'pulsefield.publishedCache', CACHE_MAX = 300;
  const cache = (() => {
    try { const c = JSON.parse(ls.get(KEY_CACHE)); if (c && typeof c === 'object') return c; } catch (e) { /* vazio */ }
    return {};
  })();
  const bucket = () => (cache[O.base] = cache[O.base] || { list: [], levels: {} });
  function saveCache() {
    const b = bucket();
    b.list = b.list.slice(0, CACHE_MAX);
    const keep = new Set(b.list.map(m => m.id));
    for (const id of Object.keys(b.levels)) if (!keep.has(id)) delete b.levels[id];
    // sem espaço: descarta o JSON das fases mais antigas até caber
    for (;;) {
      try { localStorage.setItem(KEY_CACHE, JSON.stringify(cache)); return; } catch (e) {
        const old = [...b.list].reverse().find(m => b.levels[m.id]);
        if (!old) return;
        delete b.levels[old.id];
      }
    }
  }
  function cacheList(list) { bucket().list = list.slice(); saveCache(); }
  function cachedLevel(id) { return bucket().levels[id] || null; }
  O.cachedCount = () => Object.keys(bucket().levels).length;

  // baixa em segundo plano o JSON das fases que ainda não estão guardadas
  let prefetching = false;
  async function prefetch() {
    if (prefetching) return;
    prefetching = true;
    try {
      for (const m of bucket().list.slice(0, CACHE_MAX)) {
        if (!O.connected) break;
        if (cachedLevel(m.id)) continue;
        try {
          const d = await O.fetchLevel(m.id);
          if (d && d.level && bucket().list.some(x => x.id === m.id)) { bucket().levels[m.id] = d.level; saveCache(); }
        } catch (e) { /* tenta na próxima conexão */ }
      }
    } finally { prefetching = false; }
    renderList();
  }

  function useCachedList() {
    if (!O.connected) { O.levels = bucket().list.slice(); renderList(); }
  }

  // ---------- conexão ----------
  O.connect = function () {
    clearTimeout(O.retry);
    if (O.es) O.es.close();
    O.connected = false;
    O.online = 0;
    renderStatus();
    useCachedList(); // mostra as fases guardadas enquanto conecta
    let es;
    try { es = new EventSource(O.base + '/api/events'); } catch (e) { return; }
    O.es = es;
    es.addEventListener('hello', e => {
      const d = JSON.parse(e.data);
      O.connected = true;
      O.online = d.online;
      O.levels = d.levels || [];
      cacheList(O.levels);
      renderStatus();
      renderList();
      prefetch();
    });
    es.addEventListener('online', e => { O.online = JSON.parse(e.data).online; renderStatus(); });
    es.addEventListener('level', e => {
      const m = JSON.parse(e.data);
      O.levels = [m, ...O.levels.filter(l => l.id !== m.id)];
      cacheList(O.levels);
      renderList();
      prefetch();
      PF.toast(`Nova fase online: “${m.name}” por ${m.author}`);
    });
    es.addEventListener('removed', e => {
      const { id } = JSON.parse(e.data);
      O.levels = O.levels.filter(l => l.id !== id);
      cacheList(O.levels);
      renderList();
    });
    es.onerror = () => {
      if (O.connected) { O.connected = false; renderStatus(); renderList(); return; } // o navegador reconecta sozinho
      // nunca conectou: para e tenta de novo mais tarde, sem encher o console
      es.close();
      renderStatus();
      useCachedList();
      O.retry = setTimeout(O.connect, 15000);
    };
  };

  O.setBase = function (url) {
    url = String(url).trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Endereço inválido. Ex.: http://192.168.0.10:5173');
    O.base = url;
    ls.set(KEY_URL, url);
    O.connect();
  };

  async function req(path, opts) {
    const r = await fetch(O.base + path, opts);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Erro ' + r.status);
    return d;
  }
  const MAX_MUSIC = 10 * 1024 * 1024; // mesmo limite padrão do servidor

  // music: { data: ArrayBuffer, name } (opcional). Com música o corpo é binário:
  // [4 bytes tamanho do JSON][JSON][bytes do áudio] — evita inflar o áudio em base64.
  O.publish = (level, author, music) => {
    if (!music) {
      return req('/api/levels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, level }),
      });
    }
    const head = new TextEncoder().encode(JSON.stringify({ author, level, musicName: music.name, musicRights: true }));
    const buf = new Uint8Array(4 + head.length + music.data.byteLength);
    new DataView(buf.buffer).setUint32(0, head.length);
    buf.set(head, 4);
    buf.set(new Uint8Array(music.data), 4 + head.length);
    return req('/api/levels', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
  };
  O.fetchLevel = id => req('/api/levels/' + encodeURIComponent(id));
  O.fetchMusic = async id => {
    const r = await fetch(O.base + '/api/levels/' + encodeURIComponent(id) + '/music');
    if (!r.ok) throw new Error('Erro ' + r.status);
    return r.arrayBuffer();
  };

  // sua música atual (mesmo enquanto toca a de uma fase online)
  function myMusic() {
    const src = PF.audio.saved || PF.audio;
    return src.raw ? { data: src.raw, name: src.name } : null;
  }

  // ---------- avisos ----------
  PF.toast = function (msg, kind = 'info') {
    const t = document.createElement('div');
    t.className = 'pf-toast ' + (kind === 'error' ? 'border-pf-danger' : 'border-pf-accent');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.classList.add('opacity-0'); setTimeout(() => t.remove(), 300); }, 4500);
  };

  // ---------- janela ----------
  const modal = $('online-modal');
  O.isOpen = () => !modal.classList.contains('hidden');
  O.open = () => {
    modal.classList.remove('hidden');
    renderPublish();
    renderList();
    $('online-author').focus();
  };
  O.close = () => modal.classList.add('hidden');

  function el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
    return `há ${Math.floor(s / 86400)} d`;
  }

  function myLevel() { return PF.app.editLevel || PF.app.level; }

  function renderStatus() {
    $('online-dot').className = 'inline-block w-2 h-2 rotate-45 ' + (O.connected ? 'bg-pf-accent shadow-[0_0_6px_#7CFFB2]' : 'bg-pf-danger');
    $('online-count').textContent = O.connected ? String(O.online) : 'off';
    $('online-status').textContent = O.connected
      ? `Conectado · ${O.online} ${O.online === 1 ? 'pessoa' : 'pessoas'} no jogo`
      : 'Sem conexão com o servidor';
    $('online-status').className = 'text-xs ' + (O.connected ? 'text-pf-accent' : 'text-pf-danger');
  }

  function renderPublish() {
    const lvl = myLevel();
    $('online-level').textContent = `“${lvl.name || 'Sem nome'}” · ${lvl.hazards.length} perigo(s) · ${PF.u.fmtTime(lvl.duration)}`;
    $('online-msg').textContent = '';

    // opções da música
    const box = $('online-music');
    box.innerHTML = '';
    const mu = myMusic();
    if (!mu) {
      box.appendChild(el('p', 'text-[11px] text-pf-muted', 'Sem música carregada: a fase vai sem som.'));
      return;
    }
    const mb = mu.data.byteLength / 1048576;
    const check = (id, label, checked, disabled) => {
      const row = el('label', 'flex items-start gap-2 text-xs text-pf-text/90 cursor-pointer');
      const cb = el('input', 'mt-0.5 accent-[#7CFFB2]');
      Object.assign(cb, { type: 'checkbox', id, checked, disabled });
      row.append(cb, el('span', 'leading-snug', label));
      box.appendChild(row);
      return cb;
    };
    if (mu.data.byteLength > MAX_MUSIC) {
      box.appendChild(el('p', 'text-[11px] text-pf-danger',
        `A música “${mu.name}” tem ${mb.toFixed(1)} MB; o limite é ${MAX_MUSIC / 1048576} MB. A fase vai sem som.`));
      return;
    }
    const withMusic = check('online-with-music', `Incluir a música “${mu.name}” (${mb.toFixed(1)} MB)`, true, false);
    const rights = check('online-rights', 'Confirmo que essa música é minha, é livre (domínio público / Creative Commons) ou tenho permissão para compartilhar.', false, false);
    withMusic.addEventListener('change', () => { rights.disabled = !withMusic.checked; });
  }

  function renderList() {
    const box = $('online-list');
    box.innerHTML = '';
    if (!O.levels.length) {
      const msg = O.connected
        ? 'Nenhuma fase publicada ainda. Seja a primeira pessoa!'
        : 'Sem conexão. Rode "node server.js" na pasta do projeto ou informe o endereço do servidor abaixo.';
      box.appendChild(el('p', 'text-xs text-pf-muted py-6 text-center leading-relaxed', msg));
      return;
    }
    if (!O.connected) {
      box.appendChild(el('p', 'text-[11px] text-pf-muted pb-1',
        `Sem conexão · mostrando as fases guardadas neste navegador (${O.cachedCount()} jogáveis, sem música).`));
    }
    for (const m of O.levels) {
      const saved = !!cachedLevel(m.id);
      const row = el('div', 'flex items-center gap-3 px-3 py-2.5 rounded-md bg-pf-bg/60 border border-pf-line');
      const info = el('div', 'min-w-0 flex-1');
      info.appendChild(el('p', 'text-sm font-semibold truncate', m.name));
      info.appendChild(el('p', 'text-[11px] text-pf-muted truncate',
        `por ${m.author} · ${PF.u.fmtTime(m.duration)} · ${m.hazards} perigo(s) · ${ago(m.createdAt)}`));
      if (m.hasMusic) {
        const mu = el('p', 'text-[11px] text-pf-accent truncate', '♪ ' + m.musicName);
        mu.title = m.musicName;
        info.appendChild(mu);
      }
      if (saved) {
        const tag = el('span', 'text-[10px] text-pf-muted font-mono', '● salva');
        tag.title = 'Guardada neste navegador: dá para jogar mesmo sem conexão (sem a música)';
        info.firstChild.append(' ', tag);
      }
      row.appendChild(info);
      const play = el('button', 'pf-btn pf-btn-primary', '▶ Jogar');
      play.addEventListener('click', () => load(m, 'play', play));
      const open = el('button', 'pf-btn', 'Abrir');
      open.title = 'Abrir no editor (substitui a fase atual; Ctrl+Z desfaz)';
      open.addEventListener('click', () => load(m, 'open', open));
      if (!O.connected && !saved) play.disabled = open.disabled = true;
      row.append(play, open);
      box.appendChild(row);
    }
  }

  async function load(m, how, btn) {
    btn.disabled = true;
    try {
      if (how === 'open' && !confirm(
        `Abrir “${m.name}” no editor? Sua fase atual será substituída (Ctrl+Z desfaz)` +
        (m.hasMusic ? ' e a música dela vai substituir a sua.' : '.'))) return;
      let d = null;
      if (O.connected) {
        try {
          d = await O.fetchLevel(m.id);
          if (d && d.level) { bucket().levels[m.id] = d.level; saveCache(); }
        } catch (err) { if (!cachedLevel(m.id)) throw err; }
      }
      if (!d) {
        const lvl = cachedLevel(m.id);
        if (!lvl) throw new Error('fase não guardada neste navegador e sem conexão');
        d = { level: lvl, hasMusic: false };
        if (m.hasMusic) PF.toast('Jogando a cópia guardada, sem a música (sem conexão).');
      }
      let music = null;
      if (d.hasMusic) {
        PF.toast('Baixando a música da fase…');
        try { music = { data: await O.fetchMusic(m.id), name: d.musicName }; }
        catch (err) { PF.toast('Não consegui baixar a música; a fase vai sem som.', 'error'); }
      }
      if (how === 'open') {
        await PF.app.openLevel(d.level, music);
        PF.toast(`“${m.name}” aberta no editor`);
      } else {
        await PF.app.playLevel(d.level, `${m.name} — ${m.author}`, music);
      }
      O.close();
    } catch (err) {
      PF.toast('Não foi possível carregar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  $('btn-online').addEventListener('click', O.open);
  $('online-close').addEventListener('click', O.close);
  modal.addEventListener('pointerdown', e => { if (e.target === modal) O.close(); });

  $('online-author').value = ls.get(KEY_AUTHOR) || '';
  $('online-publish').addEventListener('click', async () => {
    const btn = $('online-publish'), msg = $('online-msg');
    const author = $('online-author').value.trim();
    if (!author) { msg.className = 'text-xs mt-2 text-pf-danger'; msg.textContent = 'Escreva seu nome antes de publicar.'; return; }
    ls.set(KEY_AUTHOR, author);
    btn.disabled = true;
    msg.className = 'text-xs mt-2 text-pf-muted';
    msg.textContent = 'Publicando…';
    const music = $('online-with-music') && $('online-with-music').checked ? myMusic() : null;
    if (music && !$('online-rights').checked) {
      msg.className = 'text-xs mt-2 text-pf-danger';
      msg.textContent = 'Confirme que você pode compartilhar essa música (ou desmarque “Incluir a música”).';
      btn.disabled = false;
      return;
    }
    // fase impossível não é publicada (o servidor confere de novo)
    msg.textContent = 'Verificando se a fase é possível…';
    await new Promise(r => setTimeout(r, 30)); // deixa a mensagem aparecer antes da conta
    const chk = PF.levelCheck(PF.storage.normalize(JSON.parse(JSON.stringify(myLevel()))));
    if (!chk.ok) {
      msg.className = 'text-xs mt-2 text-pf-danger';
      msg.textContent = `Fase impossível: aos ${PF.u.fmtTime(chk.at)} não sobra nenhum lugar seguro, nem com dash e as ${PF.PLAYER.hp} vidas. Abra um espaço para o jogador e tente de novo.`;
      btn.disabled = false;
      return;
    }
    msg.textContent = music ? 'Publicando com a música…' : 'Publicando…';
    try {
      const m = await O.publish(myLevel(), author, music);
      msg.className = 'text-xs mt-2 text-pf-accent';
      msg.textContent = `Publicada${m.hasMusic ? ' com música' : ''}! Todos online já veem “${m.name}”.`;
    } catch (err) {
      msg.className = 'text-xs mt-2 text-pf-danger';
      msg.textContent = err instanceof TypeError ? 'Sem conexão com o servidor.' : err.message;
    } finally {
      btn.disabled = false;
    }
  });

  $('online-server').value = ls.get(KEY_URL) || defaultBase();
  $('online-connect').addEventListener('click', () => {
    try { O.setBase($('online-server').value); PF.toast('Conectando a ' + O.base); }
    catch (err) { PF.toast(err.message, 'error'); }
  });

  O.base = ls.get(KEY_URL) || defaultBase();
  O.connect();
})();

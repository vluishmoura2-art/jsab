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

  // ---------- conexão ----------
  O.connect = function () {
    clearTimeout(O.retry);
    if (O.es) O.es.close();
    O.connected = false;
    O.online = 0;
    renderStatus();
    let es;
    try { es = new EventSource(O.base + '/api/events'); } catch (e) { return; }
    O.es = es;
    es.addEventListener('hello', e => {
      const d = JSON.parse(e.data);
      O.connected = true;
      O.online = d.online;
      O.levels = d.levels || [];
      renderStatus();
      renderList();
    });
    es.addEventListener('online', e => { O.online = JSON.parse(e.data).online; renderStatus(); });
    es.addEventListener('level', e => {
      const m = JSON.parse(e.data);
      O.levels = [m, ...O.levels.filter(l => l.id !== m.id)];
      renderList();
      PF.toast(`Nova fase online: “${m.name}” por ${m.author}`);
    });
    es.addEventListener('removed', e => {
      const { id } = JSON.parse(e.data);
      O.levels = O.levels.filter(l => l.id !== id);
      renderList();
    });
    es.onerror = () => {
      if (O.connected) { O.connected = false; renderStatus(); return; } // o navegador reconecta sozinho
      // nunca conectou: para e tenta de novo mais tarde, sem encher o console
      es.close();
      renderStatus();
      renderList();
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
  O.publish = (level, author) => req('/api/levels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author, level }),
  });
  O.fetchLevel = id => req('/api/levels/' + encodeURIComponent(id));

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
    $('online-dot').className = 'inline-block w-2 h-2 rounded-full mr-1.5 ' + (O.connected ? 'bg-pf-accent shadow-[0_0_6px_#7CFFB2]' : 'bg-pf-danger');
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
    for (const m of O.levels) {
      const row = el('div', 'flex items-center gap-3 px-3 py-2.5 rounded-md bg-pf-bg/60 border border-pf-line');
      const info = el('div', 'min-w-0 flex-1');
      info.appendChild(el('p', 'text-sm font-semibold truncate', m.name));
      info.appendChild(el('p', 'text-[11px] text-pf-muted truncate',
        `por ${m.author} · ${PF.u.fmtTime(m.duration)} · ${m.hazards} perigo(s) · ${ago(m.createdAt)}`));
      row.appendChild(info);
      const play = el('button', 'pf-btn pf-btn-primary', '▶ Jogar');
      play.addEventListener('click', () => load(m, 'play', play));
      const open = el('button', 'pf-btn', 'Abrir');
      open.title = 'Abrir no editor (substitui a fase atual; Ctrl+Z desfaz)';
      open.addEventListener('click', () => load(m, 'open', open));
      row.append(play, open);
      box.appendChild(row);
    }
  }

  async function load(m, how, btn) {
    btn.disabled = true;
    try {
      const d = await O.fetchLevel(m.id);
      if (how === 'open') {
        if (!confirm(`Abrir “${m.name}” no editor? Sua fase atual será substituída (Ctrl+Z desfaz).`)) return;
        PF.app.openLevel(d.level);
        PF.toast(`“${m.name}” aberta no editor`);
      } else {
        PF.app.playLevel(d.level, `${m.name} — ${m.author}`);
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
    try {
      const m = await O.publish(myLevel(), author);
      msg.className = 'text-xs mt-2 text-pf-accent';
      msg.textContent = `Publicada! Todos online já veem “${m.name}”.`;
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

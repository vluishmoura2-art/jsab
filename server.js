// Servidor do Pulsefield (Node.js, sem dependências).
// - Serve o editor (index.html, css/, js/)
// - API de fases publicadas: GET /api/levels, GET /api/levels/:id, POST /api/levels
// - Ao vivo (Server-Sent Events): GET /api/events -> quantos estão online e novas fases
//
// Uso:  node server.js          (só neste computador: http://localhost:5173)
//       node server.js --lan    (outras pessoas da mesma rede também podem entrar)
//
// Hospedagem (variáveis de ambiente, ver HOSPEDAR.md):
//   PORT         porta (definida pela hospedagem; quando existe, escuta em 0.0.0.0)
//   DATA_DIR     pasta onde as fases ficam salvas (use um disco/volume persistente)
//   TRUST_PROXY  "1" quando estiver atrás do proxy da hospedagem (IP real vem do X-Forwarded-For)
//   ADMIN_TOKEN  senha longa para apagar fases: DELETE /api/levels/:id com "Authorization: Bearer <token>"
//   SUPABASE_URL + SUPABASE_SECRET_KEY  guardam fases (tabela "levels") e músicas (bucket "music")
//                no Supabase, para nada sumir em hospedagens sem disco persistente
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5173;
const LAN = process.argv.includes('--lan');
const HOSTED = !!process.env.PORT;
const HOST = process.env.HOST || (LAN || HOSTED ? '0.0.0.0' : '127.0.0.1');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'levels.json');
const MAX_BODY = 300 * 1024;            // tamanho máximo de uma fase enviada
const MAX_LEVELS = 500;                 // guarda as 500 mais recentes
const RATE = { max: 5, windowMs: 10 * 60 * 1000 }; // 5 publicações a cada 10 min por IP
const MAX_SSE = 2000;                   // conexões ao vivo no total
const MAX_SSE_PER_IP = 20;              // conexões ao vivo por IP (várias abas ok)
const MUSIC_DIR = path.join(DATA_DIR, 'music');
const MAX_MUSIC = (Number(process.env.MAX_MUSIC_MB) || 10) * 1024 * 1024;        // por fase
const MUSIC_TOTAL = (Number(process.env.MUSIC_TOTAL_MB) || 1024) * 1024 * 1024;  // espaço total para músicas

// IP de quem chamou. Atrás de proxy, o último item do X-Forwarded-For é o que o
// proxy da hospedagem adicionou (os anteriores podem ser inventados pelo cliente).
function clientIp(req) {
  if (TRUST_PROXY) {
    const f = req.headers['x-forwarded-for'];
    if (f) {
      const parts = String(f).split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket.remoteAddress || '?';
}

// ---------- validação: usa o mesmo código do editor ----------
const sandbox = { console, TextDecoder };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/config.js', 'js/hazards.js', 'js/levelcheck.js', 'js/storage.js', 'js/musiccheck.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const PF = sandbox.PF;

// ---------- armazenamento ----------
// Sempre grava em DATA_DIR/levels.json (e as músicas em DATA_DIR/music). Com SUPABASE_URL +
// SUPABASE_SECRET_KEY as fases também vão para a tabela "levels" do Supabase e as músicas para
// o bucket privado "music" do Supabase Storage, e tudo é lido de lá: assim nada some nos resets
// de hospedagens sem disco persistente (ex.: plano grátis do Render). A chave secreta só fica
// no servidor; a tabela tem RLS ligado e sem políticas, então só ela consegue ler e escrever.
// aceita a URL completa (https://<id>.supabase.co), sem "https://" ou só o id do projeto
function supabaseUrl(v) {
  v = String(v || '').trim().replace(/\/+$/, '');
  if (!v) return '';
  if (/^[a-z0-9]{15,40}$/i.test(v)) return `https://${v.toLowerCase()}.supabase.co`; // só o id
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { return new URL(v).origin; } catch (e) { return ''; }
}
const SB_URL = supabaseUrl(process.env.SUPABASE_URL);
if (process.env.SUPABASE_URL && !SB_URL) console.error(`SUPABASE_URL inválida: use https://<id-do-projeto>.supabase.co`);
const SB_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const USE_SB = !!(SB_URL && SB_KEY);
const SB_TABLE = 'levels', SB_BUCKET = 'music';

let levels = [];

function persistFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(levels));
  fs.renameSync(tmp, DB_FILE);
}

// chamada à API do Supabase; lança erro com a mensagem dele se falhar
async function sb(method, p, { body, headers = {}, raw = false } = {}) {
  const h = { apikey: SB_KEY, ...headers };
  if (SB_KEY.startsWith('eyJ')) h.Authorization = 'Bearer ' + SB_KEY; // chave antiga (JWT service_role)
  if (body !== undefined && !Buffer.isBuffer(body)) { h['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  const r = await fetch(SB_URL + p, { method, headers: h, body, signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const e = new Error(`Supabase ${method} ${p.split('?')[0]} → ${r.status} ${t.slice(0, 200)}`);
    e.status = r.status;
    throw e;
  }
  if (raw) return r;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function loadLevels() {
  if (USE_SB) {
    const rows = await sb('GET', `/rest/v1/${SB_TABLE}?select=entry&order=created_at.desc&limit=${MAX_LEVELS}`);
    levels = rows.map(r => r.entry).filter(e => e && e.id && e.level);
    // cria o bucket das músicas se ainda não existir (privado)
    try { await sb('POST', '/storage/v1/bucket', { body: { id: SB_BUCKET, name: SB_BUCKET, public: false } }); }
    catch (e) { if (!/already exists|Duplicate|409/i.test(e.message)) console.error('[supabase] bucket:', e.message); }
    // primeira vez com o banco: leva junto as fases que já estavam no arquivo (sem as músicas)
    if (!levels.length) {
      try {
        const old = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (Array.isArray(old) && old.length) {
          levels = old.slice(0, MAX_LEVELS).map(l => ({ ...l, music: null }));
          await persist(levels, []);
          console.log(`[supabase] ${levels.length} fase(s) do arquivo copiadas para o banco`);
        }
      } catch (e) { /* sem arquivo */ }
    }
  } else {
    try {
      levels = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!Array.isArray(levels)) levels = [];
    } catch (e) { levels = []; }
    // sem Supabase a música só existe no disco: se ele foi apagado, a fase segue sem som
    for (const l of levels) if (l.music && !fs.existsSync(musicPath(l.id))) l.music = null;
  }
}

// salva as mudanças: "put" = fases novas/alteradas, "del" = ids removidos
async function persist(put = [], del = []) {
  persistFile();
  if (!USE_SB) return;
  if (put.length) {
    await sb('POST', `/rest/v1/${SB_TABLE}?on_conflict=id`, {
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: put.map(l => ({ id: l.id, created_at: l.createdAt, entry: l })),
    });
  }
  if (del.length) await sb('DELETE', `/rest/v1/${SB_TABLE}?id=in.(${del.join(',')})`);
}

const meta = l => ({
  id: l.id, name: l.name, author: l.author, createdAt: l.createdAt,
  duration: l.level.duration, hazards: l.level.hazards.length,
  hasMusic: !!l.music, musicName: l.music ? l.music.name : '',
});

// ---------- músicas das fases (disco local + Supabase Storage) ----------
const musicPath = id => path.join(MUSIC_DIR, id + '.bin');
const sbMusic = id => `/storage/v1/object/${SB_BUCKET}/${id}.bin`;

async function saveMusic(id, audio, type) {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(musicPath(id), audio);
  if (USE_SB) await sb('POST', sbMusic(id), { body: audio, headers: { 'Content-Type': type, 'x-upsert': 'true' } });
}

// devolve o caminho local da música, baixando do Supabase se o disco foi apagado
async function localMusic(id) {
  const p = musicPath(id);
  if (fs.existsSync(p)) return p;
  if (!USE_SB) return null;
  const r = await sb('GET', sbMusic(id), { raw: true });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(p, buf);
  return p;
}

function dropMusic(entry) {
  if (!entry || !entry.music) return;
  try { fs.unlinkSync(musicPath(entry.id)); } catch (e) { /* já não existe */ }
  if (USE_SB) {
    sb('DELETE', `/storage/v1/object/${SB_BUCKET}`, { body: { prefixes: [entry.id + '.bin'] } })
      .catch(e => console.error('[supabase] apagar música:', e.message));
  }
  entry.music = null;
}

// mantém no máximo MAX_LEVELS fases e MUSIC_TOTAL de músicas (tira das mais antigas).
// Devolve o que mudou, para salvar: { put: fases que perderam a música, del: ids removidos }
function enforceLimits() {
  const put = [], del = [];
  while (levels.length > MAX_LEVELS) { const g = levels.pop(); dropMusic(g); del.push(g.id); }
  let total = levels.reduce((s, l) => s + (l.music ? l.music.size : 0), 0);
  for (let i = levels.length - 1; i >= 0 && total > MUSIC_TOTAL; i--) {
    if (levels[i].music) { total -= levels[i].music.size; dropMusic(levels[i]); put.push(levels[i]); }
  }
  return { put, del };
}

// confere pelos primeiros bytes que é mesmo um áudio suportado
function sniffAudio(b) {
  const s = (i, n) => b.toString('latin1', i, i + n);
  if (b.length < 12) return null;
  if (s(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return 'audio/mpeg';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return 'audio/wav';
  if (s(0, 4) === 'OggS') return 'audio/ogg';
  if (s(0, 4) === 'fLaC') return 'audio/flac';
  if (s(4, 4) === 'ftyp') return 'audio/mp4';
  return null;
}

const cleanText = (s, max, fallback) => {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
};

// ---------- ao vivo (SSE) ----------
const clients = new Set();
const sseByIp = new Map();
const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const broadcast = (event, data) => { for (const c of clients) send(c, event, data); };
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();

// ---------- respostas ----------
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function text(res, code, msg) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(msg);
}
function cors(res) {
  // dados públicos: qualquer página (inclusive o editor aberto via file://) pode ler e publicar
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function isAdmin(req) {
  if (!ADMIN_TOKEN) return false;
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const a = Buffer.from(m[1]), b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', c => {
      if (failed) return;
      size += c.length;
      if (size > limit) {
        failed = true;
        const e = new Error('too big');
        e.code = 413;
        reject(e);
      } else chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Corpo da publicação:
//  - application/json: { author, level }
//  - application/octet-stream (com música): [4 bytes tamanho do JSON][JSON][bytes do áudio]
//    JSON = { author, level, musicName, musicRights: true }
async function readPublish(req) {
  const binary = String(req.headers['content-type'] || '').startsWith('application/octet-stream');
  const buf = await readBody(req, binary ? MAX_BODY + MAX_MUSIC + 4 : MAX_BODY);
  if (!binary) return { body: JSON.parse(buf.toString('utf8')), audio: null };
  if (buf.length < 4) throw new SyntaxError('curto');
  const jlen = buf.readUInt32BE(0);
  if (jlen > MAX_BODY || 4 + jlen > buf.length) throw new SyntaxError('tamanho');
  const audio = buf.subarray(4 + jlen);
  return { body: JSON.parse(buf.subarray(4, 4 + jlen).toString('utf8')), audio: audio.length ? audio : null };
}

// ---------- API ----------
const rate = new Map();

async function publish(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (rate.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (hits.length >= RATE.max) return json(res, 429, { error: 'Muitas publicações seguidas. Espere alguns minutos.' });

  let body, audio;
  try { ({ body, audio } = await readPublish(req)); } catch (e) {
    return e.code === 413
      ? json(res, 413, { error: `Fase ou música grande demais (música até ${Math.round(MAX_MUSIC / 1048576)} MB).` })
      : json(res, 400, { error: 'JSON inválido.' });
  }
  const raw = body && body.level;
  if (!raw || raw.format !== 'pulsefield-level' || !Array.isArray(raw.hazards)) {
    return json(res, 400, { error: 'Isso não é uma fase do Pulsefield.' });
  }
  if (raw.hazards.length > 2000) return json(res, 400, { error: 'Perigos demais (máx. 2000).' });

  const level = JSON.parse(JSON.stringify(PF.storage.normalize(raw)));
  if (!level.hazards.length) return json(res, 400, { error: 'A fase está vazia: coloque pelo menos um perigo.' });
  level.name = cleanText(level.name, 40, 'Sem nome');
  // fase impossível (não tem como sobreviver até o fim) não entra
  const check = PF.levelCheck(level, 2500); // limite de tempo: o servidor não trava
  if (!check.ok) {
    return json(res, 400, { error: `Fase impossível: aos ${PF.u.fmtTime(check.at)} não sobra nenhum lugar seguro, nem com dash e as ${PF.PLAYER.hp} vidas.`, impossibleAt: check.at });
  }

  // música (opcional): mesma verificação de direitos autorais do editor, feita de novo aqui
  let music = null;
  if (audio) {
    if (body.musicRights !== true) return json(res, 400, { error: 'Confirme que você pode compartilhar essa música.' });
    if (audio.length > MAX_MUSIC) return json(res, 413, { error: `Música grande demais (máx. ${Math.round(MAX_MUSIC / 1048576)} MB).` });
    const type = sniffAudio(audio);
    if (!type) return json(res, 400, { error: 'Formato de música não suportado (use MP3, WAV, OGG, FLAC ou M4A).' });
    const name = cleanText(body.musicName, 80, 'música');
    const check = PF.musicCheck(new Uint8Array(audio.buffer, audio.byteOffset, audio.length), name);
    if (!check.allowed) return json(res, 400, { error: 'Música bloqueada: ' + check.reasons.join(' / ') });
    music = { name, type, size: audio.length };
  }

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name: level.name,
    author: cleanText(body.author, 24, 'Anônimo'),
    createdAt: new Date().toISOString(),
    level,
    music,
  };
  try {
    if (music) await saveMusic(entry.id, audio, music.type);
  } catch (err) {
    console.error('[erro ao salvar a música]', err.message);
    dropMusic(entry);
    return json(res, 503, { error: 'Não consegui salvar a música agora. Tente de novo em instantes (ou publique sem música).' });
  }
  levels.unshift(entry);
  const changed = enforceLimits();
  try {
    await persist([entry, ...changed.put], changed.del);
  } catch (err) {
    // não conseguiu salvar no banco: desfaz, para a fase não sumir no próximo reset sem aviso
    console.error('[erro ao salvar]', err.message);
    levels = levels.filter(l => l !== entry);
    dropMusic(entry);
    persistFile();
    return json(res, 503, { error: 'Não consegui salvar a fase agora. Tente de novo em instantes.' });
  }
  hits.push(now);
  rate.set(ip, hits);

  broadcast('level', meta(entry));
  console.log(`[publicada] "${entry.name}" por ${entry.author}${music ? ` · música "${music.name}" (${(music.size / 1048576).toFixed(1)} MB)` : ''}`);
  json(res, 201, meta(entry));
}

async function api(req, res, p) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (p === '/api/events' && req.method === 'GET') {
    const ip = clientIp(req);
    const mine = sseByIp.get(ip) || 0;
    if (clients.size >= MAX_SSE || mine >= MAX_SSE_PER_IP) return json(res, 503, { error: 'Servidor cheio. Tente de novo em instantes.' });
    sseByIp.set(ip, mine + 1);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // proxies não seguram os eventos
    });
    res.write('retry: 3000\n\n');
    clients.add(res);
    send(res, 'hello', { online: clients.size, levels: levels.map(meta) });
    broadcast('online', { online: clients.size });
    req.on('close', () => {
      clients.delete(res);
      const n = (sseByIp.get(ip) || 1) - 1;
      if (n > 0) sseByIp.set(ip, n); else sseByIp.delete(ip);
      broadcast('online', { online: clients.size });
    });
    return;
  }
  if (p === '/api/levels' && req.method === 'GET') return json(res, 200, levels.map(meta));
  if (p === '/api/levels' && req.method === 'POST') return publish(req, res);

  const mm = p.match(/^\/api\/levels\/([a-f0-9]{12})\/music$/);
  if (mm && req.method === 'GET') {
    const l = levels.find(x => x.id === mm[1]);
    if (!l || !l.music) return json(res, 404, { error: 'Esta fase não tem música.' });
    let file;
    try { file = await localMusic(l.id); } catch (err) {
      console.error('[erro ao baixar a música]', err.message);
      return json(res, err.status === 404 || err.status === 400 ? 404 : 503, { error: 'Música indisponível agora.' });
    }
    if (!file) return json(res, 404, { error: 'Música não encontrada.' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => { if (!res.headersSent) json(res, 404, { error: 'Música não encontrada.' }); else res.destroy(); });
    stream.on('open', () => {
      res.writeHead(200, {
        'Content-Type': l.music.type,
        'Content-Length': l.music.size,
        'Content-Disposition': 'inline',
        'Cache-Control': 'public, max-age=86400', // o id nunca muda de conteúdo
      });
      stream.pipe(res);
    });
    return;
  }

  const m = p.match(/^\/api\/levels\/([a-f0-9]{12})$/);
  if (m && req.method === 'GET') {
    const l = levels.find(x => x.id === m[1]);
    return l ? json(res, 200, { ...meta(l), level: l.level }) : json(res, 404, { error: 'Fase não encontrada.' });
  }
  if (m && req.method === 'DELETE') {
    if (!isAdmin(req)) return json(res, 403, { error: 'Sem permissão.' });
    const i = levels.findIndex(x => x.id === m[1]);
    if (i < 0) return json(res, 404, { error: 'Fase não encontrada.' });
    const [gone] = levels.splice(i, 1);
    dropMusic(gone);
    try { await persist([], [gone.id]); } catch (err) {
      console.error('[erro ao apagar no banco]', err.message);
      return json(res, 503, { error: 'Apagada daqui, mas não do banco. Tente de novo.' });
    }
    broadcast('removed', { id: gone.id });
    console.log(`[removida] "${gone.name}" por ${gone.author}`);
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'Rota não encontrada.' });
}

// ---------- arquivos do editor ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function serveStatic(req, res, p) {
  let rel;
  try { rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html'; } catch (e) { return text(res, 400, 'Requisição inválida'); }
  // só estes arquivos são públicos (server.js e data/ ficam de fora)
  if (!/^(index\.html|css\/[\w-]+\.css|js\/[\w-]+\.js)$/.test(rel)) return text(res, 404, 'Não encontrado');
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) return text(res, 404, 'Não encontrado');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  let p;
  try { p = new URL(req.url, 'http://localhost').pathname; } catch (e) { return text(res, 400, 'Requisição inválida'); }
  try {
    if (p === '/healthz') return text(res, 200, 'ok');
    if (p.startsWith('/api/')) return await api(req, res, p);
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, 'Método não permitido');
    serveStatic(req, res, p);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: 'Erro interno do servidor.' });
    else res.end();
  }
});

// limpa contadores antigos de publicação para a memória não crescer
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rate) {
    const keep = hits.filter(t => now - t < RATE.windowMs);
    if (keep.length) rate.set(ip, keep); else rate.delete(ip);
  }
}, RATE.windowMs).unref();

// desligamento limpo (a hospedagem manda SIGTERM ao reiniciar/atualizar)
function shutdown() {
  console.log('Desligando…');
  for (const c of clients) c.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// carrega as fases (do Supabase, se configurado) antes de abrir a porta
async function start() {
  for (let attempt = 1; ; attempt++) {
    try { await loadLevels(); break; } catch (err) {
      console.error(`[erro ao carregar as fases do banco] ${err.message} (tentativa ${attempt})`);
      if (attempt >= 5) {
        // sem o banco não dá para saber quais fases existem; melhor não subir vazio
        console.error('Desisti de carregar as fases. Confira SUPABASE_URL, SUPABASE_SECRET_KEY e se a tabela "levels" foi criada (HOSPEDAR.md).');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  server.listen(PORT, HOST, onListen);
}

function onListen() {
  console.log(`Pulsefield rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (${levels.length} fase(s) publicada(s))`);
  console.log(`  dados em ${USE_SB ? 'Supabase + ' : ''}${DB_FILE}${TRUST_PROXY ? ' · atrás de proxy' : ''}${ADMIN_TOKEN ? ' · admin ativo' : ''}`);
  if (HOSTED && !USE_SB) console.log('  aviso: sem Supabase, as fases só ficam salvas se DATA_DIR estiver num disco persistente.');
  if (HOSTED) {
    // hospedado: nada a mais para mostrar
  } else if (LAN) {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  na rede: http://${a.address}:${PORT}`);
      }
    }
  } else {
    console.log('  (só neste computador; use "node server.js --lan" para outras pessoas da rede entrarem)');
  }
}

start();

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
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/config.js', 'js/hazards.js', 'js/storage.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const PF = sandbox.PF;

// ---------- armazenamento (arquivo JSON) ----------
let levels = [];
try {
  levels = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  if (!Array.isArray(levels)) levels = [];
} catch (e) { levels = []; }

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(levels));
  fs.renameSync(tmp, DB_FILE);
}

const meta = l => ({
  id: l.id, name: l.name, author: l.author, createdAt: l.createdAt,
  duration: l.level.duration, hazards: l.level.hazards.length,
});

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', c => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) {
        failed = true;
        const e = new Error('too big');
        e.code = 413;
        reject(e);
      } else chunks.push(c);
    });
    req.on('end', () => { if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// ---------- API ----------
const rate = new Map();

async function publish(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (rate.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (hits.length >= RATE.max) return json(res, 429, { error: 'Muitas publicações seguidas. Espere alguns minutos.' });

  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) {
    return e.code === 413 ? json(res, 413, { error: 'Fase grande demais.' }) : json(res, 400, { error: 'JSON inválido.' });
  }
  const raw = body && body.level;
  if (!raw || raw.format !== 'pulsefield-level' || !Array.isArray(raw.hazards)) {
    return json(res, 400, { error: 'Isso não é uma fase do Pulsefield.' });
  }
  if (raw.hazards.length > 2000) return json(res, 400, { error: 'Perigos demais (máx. 2000).' });

  const level = JSON.parse(JSON.stringify(PF.storage.normalize(raw)));
  if (!level.hazards.length) return json(res, 400, { error: 'A fase está vazia: coloque pelo menos um perigo.' });
  level.name = cleanText(level.name, 40, 'Sem nome');

  const entry = {
    id: crypto.randomBytes(6).toString('hex'),
    name: level.name,
    author: cleanText(body.author, 24, 'Anônimo'),
    createdAt: new Date().toISOString(),
    level,
  };
  levels.unshift(entry);
  if (levels.length > MAX_LEVELS) levels.length = MAX_LEVELS;
  persist();
  hits.push(now);
  rate.set(ip, hits);

  broadcast('level', meta(entry));
  console.log(`[publicada] "${entry.name}" por ${entry.author}`);
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
    persist();
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

server.listen(PORT, HOST, () => {
  console.log(`Pulsefield rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (${levels.length} fase(s) publicada(s))`);
  console.log(`  dados em ${DB_FILE}${TRUST_PROXY ? ' · atrás de proxy' : ''}${ADMIN_TOKEN ? ' · admin ativo' : ''}`);
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
});

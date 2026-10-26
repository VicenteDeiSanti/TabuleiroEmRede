// Defesas do servidor: limite de requisições, bloqueio de IPs, força bruta no login,
// limite de conexões, cabeçalhos de segurança e registro de eventos suspeitos.
// Ajuste os valores em seguranca.json (criado automaticamente na primeira execução).
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'seguranca.json');
const LOG_DIR = path.join(ROOT, 'dados');
const LOG_FILE = path.join(LOG_DIR, 'seguranca.log');

/* ==================== Configuração ==================== */
const DEFAULTS = {
  _ajuda: 'somenteRedeLocal: aceita só IPs de rede local. permitirIPs/bloquearIPs aceitam IP ou faixa CIDR (ex.: 192.168.0.0/24). Limites: [quantidade, segundos].',
  somenteRedeLocal: true,
  permitirIPs: [],
  bloquearIPs: [],
  limites: {
    geral: [400, 60],          // qualquer requisição (inclui arquivos do site)
    api: [240, 60],            // chamadas à API
    login: [10, 60],           // tentativas de login por IP
    cadastro: [3, 600],        // perfis criados por IP
    criarSala: [8, 60],
    chat: [12, 20],
    lance: [90, 60],
    acao: [40, 60]             // ofertas, desistir, +15 s etc.
  },
  conexoesPorIP: 40,           // conexões TCP simultâneas por IP
  tempoRealPorIP: 12,          // conexões de partida ao vivo por IP
  tempoRealPorPerfil: 6,
  tempoRealTotal: 500,
  salasAbertasPorPerfil: 5,
  salasTotal: 300,
  perfisTotal: 500,
  perfisPorIPPorDia: 5,
  sessoesPorPerfil: 10,
  sessaoExpiraDias: 30,
  bloqueioMinutos: 5,          // bloqueio após repetidos excessos (dobra a cada reincidência, até 1 h)
  administradores: []          // nomes de perfis que sempre são administradores (além dos marcados no painel)
};

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2)); } catch (_) {} }
    else console.error('Aviso: seguranca.json inválido, usando valores padrão.');
  }
  return { ...DEFAULTS, ...cfg, limites: { ...DEFAULTS.limites, ...(cfg.limites || {}) } };
}
const config = loadConfig();

/* ==================== Registro ==================== */
function log(kind, ip, detail) {
  const line = `${new Date().toISOString()} ${kind} ${ip || '-'} ${detail || ''}\n`;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const st = fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE);
    if (st && st.size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFile(LOG_FILE, line, () => {});
  } catch (e) {}
}
// Evita encher o log com o mesmo evento repetido
const lastLogged = new Map();
function logOnce(kind, ip, detail) {
  const k = kind + ip;
  if (Date.now() - (lastLogged.get(k) || 0) < 60000) return;
  lastLogged.set(k, Date.now());
  log(kind, ip, detail);
}

/* ==================== IPs ==================== */
function normIp(ip) {
  ip = String(ip || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}
function ipv4ToInt(ip) {
  const p = ip.split('.');
  if (p.length !== 4 || p.some(x => !/^\d{1,3}$/.test(x) || +x > 255)) return null;
  return ((+p[0] << 24) >>> 0) + (+p[1] << 16) + (+p[2] << 8) + +p[3];
}
function inRule(ip, rule) {
  rule = String(rule).trim();
  if (!rule.includes('/')) return normIp(rule) === ip;
  const [base, bits] = rule.split('/');
  const a = ipv4ToInt(ip), b = ipv4ToInt(base), n = Number(bits);
  if (a === null || b === null || !(n >= 0 && n <= 32)) return false;
  const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
  return (a & mask) === (b & mask);
}
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10'];
function isLocal(ip) {
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return PRIVATE.some(r => inRule(ip, r));
}
function ipAllowed(ip) {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (config.bloquearIPs.some(r => inRule(ip, r))) return false;
  if (config.permitirIPs.length) return config.permitirIPs.some(r => inRule(ip, r));
  if (config.somenteRedeLocal) return isLocal(ip);
  return true;
}

/* ==================== Limite de requisições (balde de fichas) ==================== */
const buckets = new Map();     // `${nome}|${chave}` -> {tokens, at}
const strikes = new Map();     // ip -> [timestamps de excesso]
const bans = new Map();        // ip -> {until, level}

function take(name, key, cost = 1) {
  const [max, secs] = config.limites[name] || [60, 60];
  const k = name + '|' + key, now = Date.now(), rate = max / (secs * 1000);
  let b = buckets.get(k);
  if (!b) { b = { tokens: max, at: now }; buckets.set(k, b); }
  b.tokens = Math.min(max, b.tokens + (now - b.at) * rate);
  b.at = now;
  if (b.tokens < cost) return Math.ceil((cost - b.tokens) / rate / 1000); // segundos até liberar
  b.tokens -= cost;
  return 0;
}

function banned(ip) {
  const b = bans.get(ip);
  return b && b.until > Date.now() ? Math.ceil((b.until - Date.now()) / 1000) : 0;
}
// Para o painel do administrador
function bansList() {
  const now = Date.now();
  return [...bans].filter(([, b]) => b.until > now).map(([ip, b]) => ({ ip, secs: Math.ceil((b.until - now) / 1000) }));
}
function unban(ip) {
  const had = banned(ip) > 0;
  bans.delete(ip); strikes.delete(ip);
  return had;
}
function strike(ip, reason) {
  const now = Date.now();
  const list = (strikes.get(ip) || []).filter(t => now - t < 60000);
  list.push(now);
  strikes.set(ip, list);
  logOnce('LIMITE', ip, reason);
  if (list.length >= 20 && ip !== '127.0.0.1' && ip !== '::1') {
    const prev = bans.get(ip);
    const level = prev ? Math.min(prev.level + 1, 4) : 0;
    const mins = Math.min(60, config.bloqueioMinutos * Math.pow(2, level));
    bans.set(ip, { until: now + mins * 60000, level });
    strikes.delete(ip);
    log('BLOQUEIO', ip, `${mins} min por excesso de requisições (${reason})`);
  }
}

/* ==================== Força bruta no login ==================== */
const loginFails = new Map(); // chave (nome ou ip) -> {count, until}
function loginBlocked(keys) {
  const now = Date.now();
  let wait = 0;
  for (const k of keys) { const f = loginFails.get(k); if (f && f.until > now) wait = Math.max(wait, f.until - now); }
  return Math.ceil(wait / 1000);
}
function loginFailed(keys, ip, name) {
  for (const k of keys) {
    const f = loginFails.get(k) || { count: 0, until: 0 };
    f.count++;
    if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60000, 30000 * Math.pow(2, f.count - 5)); // 30 s, 1 min, 2 min… até 15 min
    loginFails.set(k, f);
  }
  log('LOGIN_FALHOU', ip, `perfil "${name}"`);
}
function loginOk(keys) { for (const k of keys) loginFails.delete(k); }

/* ==================== Conexões ==================== */
const sockets = new Map(); // ip -> quantidade
function guardServer(server) {
  server.headersTimeout = 10000;      // cabeçalhos precisam chegar em 10 s (contra slowloris)
  server.requestTimeout = 15000;      // a requisição inteira precisa chegar em 15 s
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 60;
  server.timeout = 0;                 // respostas longas (tempo real) são controladas à parte
  server.on('connection', socket => {
    const ip = normIp(socket.remoteAddress);
    if (!ipAllowed(ip)) { logOnce('IP_RECUSADO', ip, 'fora da lista permitida'); return socket.destroy(); }
    if (banned(ip)) return socket.destroy();
    const n = (sockets.get(ip) || 0) + 1;
    if (n > config.conexoesPorIP) { logOnce('CONEXOES', ip, `${n} conexões simultâneas`); strike(ip, 'conexões demais'); return socket.destroy(); }
    sockets.set(ip, n);
    // Contra slowloris: a conexão precisa mandar uma requisição completa em 10 s
    armIdle(socket);
    socket.on('close', () => {
      clearTimeout(socket._idleTimer); const m = (sockets.get(ip) || 1) - 1; if (m <= 0) sockets.delete(ip); else sockets.set(ip, m); });
  });
  server.on('request', (req, res) => {
    const sock = req.socket;
    clearTimeout(sock._idleTimer);
    res.on('finish', () => armIdle(sock));
  });
  server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
}

function armIdle(socket) {
  clearTimeout(socket._idleTimer);
  socket._idleTimer = setTimeout(() => {
    logOnce('CONEXAO_LENTA', normIp(socket.remoteAddress), 'requisição incompleta por 10 s');
    socket.destroy();
  }, 10000);
  socket._idleTimer.unref();
}

/* ==================== Cabeçalhos ==================== */
const HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin'
};
function securityHeaders(res) { for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v); }

// Requisições que alteram dados precisam vir do próprio site (contra CSRF)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}

/* ==================== Limpeza periódica ==================== */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.at > 15 * 60000) buckets.delete(k);
  for (const [k, l] of strikes) if (!l.some(t => now - t < 60000)) strikes.delete(k);
  for (const [k, b] of bans) if (b.until < now - 24 * 3600e3) bans.delete(k);
  for (const [k, f] of loginFails) if (f.until < now - 3600e3) loginFails.delete(k);
  for (const [k, t] of lastLogged) if (now - t > 3600e3) lastLogged.delete(k);
}, 5 * 60000).unref();

module.exports = {
  config, log, normIp, ipAllowed, isLocal, take, banned, bansList, unban, strike,
  loginBlocked, loginFailed, loginOk, guardServer, securityHeaders, sameOrigin
};

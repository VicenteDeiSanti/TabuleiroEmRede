// Tabuleiro em Rede — servidor de xadrez e damas para rede local.
// Sem dependências: rode com `node server.js`.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const SEC = require('./seguranca.js');
const ENGINES = { chess: require('./public/chess.js'), checkers: require('./public/checkers.js') };
const M = require('./public/magnata.js');
const L = require('./public/ludo.js');
const Tr = require('./public/truco.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DIR = path.join(__dirname, 'dados');
const CHAT_MAX = 200;
const ABANDON_MS = 30000;          // tempo desconectado para o adversário poder reivindicar vitória
const START_RATING = 1200;
fs.mkdirSync(DIR, { recursive: true });

/* ==================== Persistência (SQLite: dados/tabuleiro.db) ==================== */
const banco = require('./banco.js').open(DIR);
const migrados = banco.migrateJson();
if (migrados) console.log(`Migrados ${migrados} perfis dos arquivos JSON antigos para o banco SQLite.`);
const db = banco.loadAll();   // perfis, sessões, salas e partidas ficam em memória e são gravados no banco
// Gravação agrupada: marca o que mudou e grava tudo numa só vez, na ordem certa (perfis antes de sessões)
const dirty = new Set();
let flushTimer = null;
const savedGames = new Set(db.games.map(g => g.id));
function flush() {
  clearTimeout(flushTimer); flushTimer = null;
  if (dirty.has('profiles')) banco.saveProfiles(db.profiles);
  if (dirty.has('sessions')) banco.saveSessions(db.sessions);
  if (dirty.has('rooms')) banco.saveRooms(db.rooms);
  if (dirty.has('magnata')) banco.saveMagnata(db.magnata);
  if (dirty.has('suggestions')) banco.saveSuggestions(db.suggestions);
  if (dirty.has('games')) {
    const novos = db.games.filter(g => !savedGames.has(g.id));
    banco.saveGames(novos);
    novos.forEach(g => savedGames.add(g.id));
  }
  dirty.clear();
}
const mark = k => { dirty.add(k); if (!flushTimer) flushTimer = setTimeout(flush, 200); };
const saveProfiles = () => mark('profiles');
const saveSessions = () => mark('sessions');
const saveRooms = () => mark('rooms');
const saveGames = () => mark('games');
const saveMagnata = () => mark('magnata');
const STARTED_AT = Date.now();

/* ==================== Administradores ==================== */
// Admin: marcado no perfil (pelo painel) ou pelo nome em "administradores" no seguranca.json
const isAdmin = p => !!p && (!!p.admin || (SEC.config.administradores || []).some(n => String(n).toLowerCase() === p.name.toLowerCase()));
// Se ninguém é administrador, o perfil mais antigo vira (o dono do servidor costuma ser o primeiro a se cadastrar)
function ensureAdmin() {
  const all = Object.values(db.profiles);
  if (!all.length || all.some(isAdmin)) return;
  const first = all.sort((a, b) => a.created - b.created)[0];
  first.admin = true; saveProfiles();
  console.log(`Perfil "${first.name}" virou administrador (era o mais antigo e não havia nenhum).`);
}
ensureAdmin();
// Grava o que estiver pendente antes de fechar (Ctrl+C)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { flush(); banco.close(); } catch (e) {} process.exit(0); });

/* ==================== Utilidades ==================== */
const rid = n => crypto.randomBytes(n).toString('hex');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const other = c => (c === 'w' ? 'b' : 'w');
const turnOf = room => (room.moves.length % 2 === 0 ? 'w' : 'b');
const AVATAR_COLORS = ['#c3801f', '#3d8a55', '#2f62b0', '#a8456b', '#7a5bb5', '#c2412d', '#2a8f8f', '#5b655e'];

const DEFAULT_SETTINGS = {
  theme: 'auto', board: 'verde', pieces: 'cburnett', coords: true, legal: true, lastMove: true,
  animation: 'normal', sound: true, volume: 0.6, premove: true, autoQueen: false,
  confirmResign: true, notify: true, chat: true, arrows: true, flash: true
};
function sanitizeSettings(input, base) {
  const out = { ...DEFAULT_SETTINGS, ...(base || {}) };
  if (!input || typeof input !== 'object') return out;
  const pick = (k, allowed) => { if (allowed.includes(input[k])) out[k] = input[k]; };
  pick('theme', ['auto', 'light', 'dark']);
  pick('board', ['verde', 'madeira', 'azul', 'cinza', 'roxo', 'coral']);
  pick('pieces', ['cburnett', 'unicode']);
  pick('animation', ['off', 'fast', 'normal', 'slow']);
  for (const k of ['coords', 'legal', 'lastMove', 'sound', 'premove', 'autoQueen', 'confirmResign', 'notify', 'chat', 'arrows', 'flash'])
    if (typeof input[k] === 'boolean') out[k] = input[k];
  if (typeof input.volume === 'number') out.volume = Math.max(0, Math.min(1, input.volume));
  return out;
}

// Hash assíncrono (não trava o servidor enquanto calcula) e comparação em tempo constante
function hashPass(pass, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(String(pass).slice(0, 128), salt, 32, (e, k) => (e ? reject(e) : resolve(k.toString('hex')))));
}
async function checkPass(p, pass) {
  const h = Buffer.from(await hashPass(pass || '', p.salt), 'hex'), ref = Buffer.from(p.pass, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}
// Nomes: letras (com acento), números, espaço, ponto, hífen e sublinhado
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u;
const nameError = name => (name.length < 2 ? 'O nome precisa ter pelo menos 2 caracteres.'
  : !NAME_RE.test(name) ? 'Use só letras, números, espaço, ponto, hífen ou sublinhado no nome.' : null);
const MIN_PASS = 6;

function newRating() { return { r: START_RATING, games: 0, w: 0, d: 0, l: 0, peak: START_RATING, hist: [] }; }

function publicProfile(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.name, color: p.color, bio: p.bio || '', created: p.created,
    online: isOnline(p.id),
    learn: { lessons: Object.keys((p.learn || {}).lessons || {}).length, openings: Object.keys((p.learn || {}).openings || {}).length },
    ratings: { chess: pubRating(p.ratings.chess), checkers: pubRating(p.ratings.checkers) },
    magnata: p.ratings.magnata || { games: 0, w: 0 }, ludo: p.ratings.ludo || { games: 0, w: 0 }, truco: p.ratings.truco || { games: 0, w: 0 }
  };
}
const pubRating = r => ({ r: Math.round(r.r), games: r.games, w: r.w, d: r.d, l: r.l, peak: Math.round(r.peak), prov: r.games < 10 });
function brief(pid, game) {
  const p = db.profiles[pid];
  if (!p) return null;
  return { id: p.id, name: p.name, color: p.color, rating: Math.round(p.ratings[game].r), prov: p.ratings[game].games < 10 };
}

/* ==================== Presença ==================== */
const lastSeen = {};               // id do perfil -> timestamp
const listeners = {};              // id da sala -> Set<{res, pid}>
const touch = pid => { if (pid) lastSeen[pid] = Date.now(); };
function isOnline(pid) {
  if (Date.now() - (lastSeen[pid] || 0) < 12000) return true;
  for (const set of Object.values(listeners)) for (const l of set) if (l.pid === pid) return true;
  return false;
}
function seatOnline(room, color) {
  const pid = room.seats[color];
  for (const l of listeners[room.id] || []) if (l.pid === pid) return true;
  return false;
}

/* ==================== Elo ==================== */
function applyRatings(room, end) {
  const g = room.game, pw = db.profiles[room.seats.w], pb = db.profiles[room.seats.b];
  if (!pw || !pb) return null;
  const rw = pw.ratings[g], rb = pb.ratings[g];
  const score = end.winner === 'w' ? 1 : end.winner === 'b' ? 0 : 0.5;
  const exp = 1 / (1 + Math.pow(10, (rb.r - rw.r) / 400));
  const k = r => (r.games < 10 ? 40 : r.games < 30 ? 28 : 20);
  const dw = k(rw) * (score - exp), db_ = k(rb) * ((1 - score) - (1 - exp));
  const now = Date.now();
  const upd = (r, d, res) => {
    r.r = Math.max(100, r.r + d); r.games++; r[res]++;
    r.peak = Math.max(r.peak, r.r);
    r.hist.push([now, Math.round(r.r)]);
    if (r.hist.length > 200) r.hist.splice(0, r.hist.length - 200);
  };
  const before = { w: Math.round(rw.r), b: Math.round(rb.r) };
  upd(rw, dw, score === 1 ? 'w' : score === 0 ? 'l' : 'd');
  upd(rb, db_, score === 0 ? 'w' : score === 1 ? 'l' : 'd');
  saveProfiles();
  return { w: Math.round(rw.r) - before.w, b: Math.round(rb.r) - before.b, before };
}

/* ==================== Relógio ==================== */
const TC_PRESETS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0', '30+20'];
function parseTc(v) {
  if (!v || v === 'none') return null;
  const m = /^(\d{1,3}(?:\.\d+)?)\+(\d{1,2})$/.exec(String(v));
  if (!m) return null;
  const min = Number(m[1]), inc = Number(m[2]);
  if (!(min > 0 && min <= 180) || inc > 60) return null;
  return { label: `${min}+${inc}`, base: Math.round(min * 60000), inc: inc * 1000 };
}
function remaining(room, color, now) {
  let ms = room.clock[color];
  if (room.clock.turnStart && turnOf(room) === color) ms -= now - room.clock.turnStart;
  return Math.max(0, ms);
}
function resetClock(room) {
  room.clock = room.tc ? { w: room.tc.base, b: room.tc.base, turnStart: null } : { w: 0, b: 0, turnStart: null };
}
function stopClock(room, now) {
  if (!room.tc || !room.clock.turnStart) return;
  const c = turnOf(room);
  room.clock[c] = remaining(room, c, now);
  room.clock.turnStart = null;
}
const flagTimers = {};
function scheduleFlag(room) {
  clearTimeout(flagTimers[room.id]);
  if (!room.tc || room.end || !room.clock.turnStart) return;
  flagTimers[room.id] = setTimeout(() => checkFlag(room), remaining(room, turnOf(room), Date.now()) + 30);
}
function checkFlag(room) {
  if (!room.tc || room.end || !room.clock.turnStart) return false;
  const now = Date.now(), c = turnOf(room);
  if (remaining(room, c, now) > 0) return false;
  room.clock[c] = 0;
  room.clock.turnStart = null;
  const E = ENGINES[room.game], hist = E.play(room.moves);
  const winner = other(c);
  finish(room, E.cannotWin(hist[hist.length - 1].s.b, winner) ? { winner: null, reason: 'timeout-draw' } : { winner, reason: 'time' });
  return true;
}

/* ==================== Salas ==================== */
function sysMsg(room, text) {
  room.chat.push({ n: null, c: null, t: text, ts: Date.now() });
  if (room.chat.length > CHAT_MAX) room.chat.splice(0, room.chat.length - CHAT_MAX);
}
function seatOf(room, pid) {
  if (!room || !pid) return null;
  if (room.seats.w === pid) return 'w';
  if (room.seats.b === pid) return 'b';
  return null;
}
function roomStatus(room) {
  const E = ENGINES[room.game];
  return E.status(E.play(room.moves), room.end);
}

function finish(room, end) {
  if (room.end) return;
  const now = Date.now();
  stopClock(room, now);
  room.end = { ...end };
  room.offers = { draw: null, takeback: null, rematch: null };
  if (end.reason !== 'aborted') {
    const E = ENGINES[room.game];
    const hist = E.play(room.moves);
    room.end.diff = room.rated ? applyRatings(room, end) : null;
    const pts = end.winner ? { [room.seats[end.winner]]: 1 } : { [room.seats.w]: 0.5, [room.seats.b]: 0.5 };
    for (const [pid, v] of Object.entries(pts)) room.series[pid] = (room.series[pid] || 0) + v;
    const rec = {
      id: rid(4), game: room.game, tc: room.tc ? room.tc.label : null, rated: !!room.rated, room: room.id,
      white: { ...brief(room.seats.w, room.game), diff: room.end.diff ? room.end.diff.w : null, rating: room.end.diff ? room.end.diff.before.w : brief(room.seats.w, room.game).rating },
      black: { ...brief(room.seats.b, room.game), diff: room.end.diff ? room.end.diff.b : null, rating: room.end.diff ? room.end.diff.before.b : brief(room.seats.b, room.game).rating },
      winner: end.winner, reason: end.reason, moves: room.moves.slice(), plies: hist.length - 1,
      started: room.startedAt || now, ended: now
    };
    db.games.push(rec);
    room.end.gameId = rec.id;
    saveGames();
  }
  room.updated = now;
  clearTimeout(flagTimers[room.id]);
  saveRooms(); broadcast(room.id);
}

function publicRoom(room, pid) {
  const E = ENGINES[room.game];
  const hist = E.play(room.moves);
  const st = E.status(hist, room.end);
  const now = Date.now();
  const players = {};
  for (const c of ['w', 'b']) {
    const b = room.seats[c] ? brief(room.seats[c], room.game) : null;
    if (b) {
      b.online = seatOnline(room, c);
      b.awayMs = b.online || !room.away[c] ? 0 : now - room.away[c];
    }
    players[c] = b;
  }
  let spectators = 0;
  for (const l of listeners[room.id] || []) if (!seatOf(room, l.pid)) spectators++;
  return {
    id: room.id, name: room.name, game: room.game, gameNo: room.gameNo, rated: !!room.rated, private: !!room.private,
    creator: room.creator, invite: room.invite || null, players, spectators,
    series: { w: room.series[room.seats.w] || 0, b: room.series[room.seats.b] || 0 },
    tc: room.tc ? room.tc.label : null,
    clock: room.tc ? { w: remaining(room, 'w', now), b: remaining(room, 'b', now), running: room.clock.turnStart ? turnOf(room) : null } : null,
    moves: room.moves, status: st, end: room.end, offers: room.offers, chat: room.chat,
    you: seatOf(room, pid), updated: room.updated, serverTime: now
  };
}

function broadcast(id) {
  const room = db.rooms[id];
  if (!room) return;
  for (const l of listeners[id] || []) l.res.write(`data: ${JSON.stringify(publicRoom(room, l.pid))}\n\n`);
}

function roomSummary(room, pid) {
  const st = roomStatus(room);
  return {
    id: room.id, name: room.name, game: room.game, rated: !!room.rated, private: !!room.private,
    tc: room.tc ? room.tc.label : null, players: { w: room.seats.w ? brief(room.seats.w, room.game) : null, b: room.seats.b ? brief(room.seats.b, room.game) : null },
    plies: room.moves.length, over: st.over, mine: !!seatOf(room, pid), creator: room.creator,
    invite: room.invite || null, updated: room.updated, wantColor: room.wantColor
  };
}

// Limpeza: salas encerradas e paradas há mais de 6 h, ou vazias há mais de 2 h
function cleanup() {
  const now = Date.now();
  let changed = false;
  for (const r of Object.values(db.rooms)) {
    const idle = now - r.updated;
    const waiting = !r.seats.w || !r.seats.b;
    if ((r.end && idle > 6 * 3600e3) || (waiting && !r.moves.length && idle > 2 * 3600e3)) {
      delete db.rooms[r.id]; changed = true;
    }
  }
  for (const [t, s] of Object.entries(db.sessions)) if (!db.profiles[s.pid]) { delete db.sessions[t]; }
  if (changed) saveRooms();
  // Magnata: encerradas há 6 h, não iniciadas há 2 h ou sem nenhuma ação há 2 dias
  let mChanged = false;
  for (const r of Object.values(db.magnata)) {
    const idle = now - r.updated, over = r.state && r.state.phase === 'over';
    if ((over && idle > 6 * 3600e3) || (!r.state && idle > 2 * 3600e3) || idle > 48 * 3600e3) { delete db.magnata[r.id]; mChanged = true; }
  }
  if (mChanged) saveMagnata();
}
setInterval(cleanup, 10 * 60e3);

// Restaura relógios ao reiniciar
for (const r of Object.values(db.rooms)) { if (!checkFlag(r)) scheduleFlag(r); r.away = r.away || {}; }

/* ==================== HTTP ==================== */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json'
};
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
// Corpo da requisição: no máximo 16 KB, JSON de objeto, chegando em até 5 s
const BODY_MAX = 16 * 1024;
function readBody(req) {
  return new Promise(resolve => {
    let d = '', done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { finish(null); req.destroy(); }, 5000);
    req.setEncoding('utf8');
    req.on('data', c => { d += c; if (d.length > BODY_MAX) { d = ''; req.removeAllListeners('data'); finish('big'); } });
    req.on('end', () => {
      try { const v = JSON.parse(d || '{}'); finish(v && typeof v === 'object' && !Array.isArray(v) ? v : null); }
      catch (e) { finish(null); }
    });
    req.on('error', () => finish(null));
  });
}
const SESSION_TTL = SEC.config.sessaoExpiraDias * 86400e3;
function auth(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  if (!token || !/^[a-f0-9]{32}$/.test(token)) return null;
  const s = db.sessions[token];
  if (!s) return null;
  const now = Date.now();
  if (now - (s.used || s.created) > SESSION_TTL) { delete db.sessions[token]; saveSessions(); return null; }
  if (now - (s.used || 0) > 3600e3) { s.used = now; saveSessions(); }
  const p = db.profiles[s.pid];
  if (p && p.banned) return null;
  if (p) touch(p.id);
  return p || null;
}

// Aplica um limite de requisições; responde 429 e retorna false se estourou
function rate(res, ctx, name, key = ctx.ip) {
  const wait = SEC.take(name, key);
  if (!wait) return true;
  SEC.strike(ctx.ip, name);
  res.setHeader('Retry-After', String(wait));
  send(res, 429, { error: `Muitas ações seguidas. Aguarde ${wait} s.` });
  return false;
}

const routes = [];
const route = (method, pattern, fn, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, open: opts.open });
};

/* ---------- Perfis e sessão ---------- */
function startSession(p) {
  const token = rid(16);
  db.sessions[token] = { pid: p.id, created: Date.now(), used: Date.now() };
  // Mantém só as sessões mais recentes de cada perfil
  const mine = Object.entries(db.sessions).filter(([, s]) => s.pid === p.id).sort((a, b) => (b[1].used || b[1].created) - (a[1].used || a[1].created));
  for (const [t] of mine.slice(SEC.config.sessoesPorPerfil)) delete db.sessions[t];
  saveSessions();
  return token;
}
const registeredByIp = new Map(); // ip -> [timestamps]
const learnOf = p => (p.learn = p.learn || { lessons: {}, openings: {} });
const meView = p => ({ ...publicProfile(p), settings: sanitizeSettings(null, p.settings), learn: learnOf(p), admin: isAdmin(p) });

route('POST', '/api/register', async (req, res, ctx) => {
  const name = clean(ctx.body.name, 20), pass = String(ctx.body.password || '');
  const ne = nameError(name);
  if (ne) return send(res, 400, { error: ne });
  if (pass.length < MIN_PASS) return send(res, 400, { error: `A senha precisa ter pelo menos ${MIN_PASS} caracteres.` });
  if (pass.toLowerCase() === name.toLowerCase()) return send(res, 400, { error: 'A senha não pode ser igual ao nome.' });
  if (Object.values(db.profiles).some(p => p.name.toLowerCase() === name.toLowerCase()))
    return send(res, 409, { error: 'Já existe um perfil com esse nome. Escolha outro ou entre com a senha.' });
  if (Object.keys(db.profiles).length >= SEC.config.perfisTotal) return send(res, 403, { error: 'O servidor atingiu o limite de perfis.' });
  const day = Date.now() - 86400e3, recent = (registeredByIp.get(ctx.ip) || []).filter(t => t > day);
  if (recent.length >= SEC.config.perfisPorIPPorDia && ctx.ip !== '127.0.0.1' && ctx.ip !== '::1') {
    SEC.log('CADASTRO_LIMITE', ctx.ip, `${recent.length} perfis em 24 h`);
    return send(res, 429, { error: 'Muitos perfis criados a partir desta máquina hoje. Tente amanhã.' });
  }
  if (!rate(res, ctx, 'cadastro')) return;
  recent.push(Date.now()); registeredByIp.set(ctx.ip, recent);
  const salt = rid(8);
  const p = {
    id: rid(4), name, salt, pass: await hashPass(pass, salt), created: Date.now(),
    color: AVATAR_COLORS[Object.keys(db.profiles).length % AVATAR_COLORS.length], bio: '',
    settings: { ...DEFAULT_SETTINGS }, ratings: { chess: newRating(), checkers: newRating() }
  };
  db.profiles[p.id] = p;
  saveProfiles();
  ensureAdmin();
  SEC.log('CADASTRO', ctx.ip, `perfil "${name}"`);
  send(res, 200, { token: startSession(p), me: meView(p) });
}, { open: true });

route('POST', '/api/login', async (req, res, ctx) => {
  if (!rate(res, ctx, 'login')) return;
  const name = clean(ctx.body.name, 20).toLowerCase();
  const keys = ['n:' + name, 'ip:' + ctx.ip];
  const wait = SEC.loginBlocked(keys);
  if (wait) return send(res, 429, { error: `Muitas tentativas erradas. Tente de novo em ${wait} s.` });
  const p = Object.values(db.profiles).find(x => x.name.toLowerCase() === name);
  const ok = p ? await checkPass(p, ctx.body.password) : (await hashPass('x', 'x'), false); // mesmo tempo com ou sem perfil
  if (!ok) { SEC.loginFailed(keys, ctx.ip, name); return send(res, 401, { error: 'Nome ou senha incorretos.' }); }
  SEC.loginOk(keys);
  if (p.banned) { SEC.log('LOGIN_BANIDO', ctx.ip, `perfil "${p.name}"`); return send(res, 403, { error: 'Este perfil foi suspenso pelo administrador.' }); }
  send(res, 200, { token: startSession(p), me: meView(p) });
}, { open: true });

// Perfis existentes (para facilitar a escolha na tela de entrada)
route('GET', '/api/known', async (req, res) => {
  send(res, 200, Object.values(db.profiles).sort((a, b) => (lastSeen[b.id] || b.created) - (lastSeen[a.id] || a.created))
    .slice(0, 30).map(p => ({ name: p.name, color: p.color })));
}, { open: true });

route('POST', '/api/logout', async (req, res, ctx) => {
  const h = req.headers.authorization || '';
  delete db.sessions[h.slice(7)];
  saveSessions();
  send(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res, ctx) => send(res, 200, meView(ctx.me)));

route('POST', '/api/me', async (req, res, ctx) => {
  const p = ctx.me, b = ctx.body;
  if (b.settings) p.settings = sanitizeSettings(b.settings, p.settings);
  if (typeof b.bio === 'string') p.bio = clean(b.bio, 120);
  if (AVATAR_COLORS.includes(b.color)) p.color = b.color;
  if (typeof b.name === 'string' && clean(b.name, 20) !== p.name) {
    const name = clean(b.name, 20);
    const ne = nameError(name);
    if (ne) return send(res, 400, { error: ne });
    if (Object.values(db.profiles).some(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase()))
      return send(res, 409, { error: 'Esse nome já está em uso.' });
    p.name = name;
  }
  saveProfiles();
  send(res, 200, meView(p));
});

route('POST', '/api/me/password', async (req, res, ctx) => {
  const p = ctx.me, keys = ['pw:' + p.id];
  if (!rate(res, ctx, 'login')) return;
  const wait = SEC.loginBlocked(keys);
  if (wait) return send(res, 429, { error: `Muitas tentativas erradas. Tente de novo em ${wait} s.` });
  if (!(await checkPass(p, ctx.body.old))) { SEC.loginFailed(keys, ctx.ip, p.name + ' (troca de senha)'); return send(res, 401, { error: 'A senha atual está incorreta.' }); }
  SEC.loginOk(keys);
  const np = String(ctx.body.new || '');
  if (np.length < MIN_PASS) return send(res, 400, { error: `A nova senha precisa ter pelo menos ${MIN_PASS} caracteres.` });
  p.salt = rid(8); p.pass = await hashPass(np, p.salt);
  // Encerra as outras sessões deste perfil
  const current = (req.headers.authorization || '').slice(7);
  for (const [t, s] of Object.entries(db.sessions)) if (s.pid === p.id && t !== current) delete db.sessions[t];
  saveProfiles(); saveSessions();
  SEC.log('SENHA_ALTERADA', ctx.ip, `perfil "${p.name}"`);
  send(res, 200, { ok: true });
});

// Progresso na trilha de aprendizado: {lesson: id} ou {opening: id}
const LEARN_ID = /^[a-z0-9-]{2,40}$/;
route('POST', '/api/me/learn', async (req, res, ctx) => {
  const L = learnOf(ctx.me), b = ctx.body;
  if (typeof b.lesson === 'string' && LEARN_ID.test(b.lesson) && Object.keys(L.lessons).length < 300 && !L.lessons[b.lesson]) L.lessons[b.lesson] = Date.now();
  if (typeof b.opening === 'string' && LEARN_ID.test(b.opening) && (L.openings[b.opening] || Object.keys(L.openings).length < 300))
    L.openings[b.opening] = Math.min(9999, (L.openings[b.opening] || 0) + 1);
  if (b.reset === true) { L.lessons = {}; L.openings = {}; }
  saveProfiles();
  send(res, 200, L);
});

route('GET', '/api/profiles/:id', async (req, res, ctx) => {
  const p = db.profiles[ctx.params.id];
  if (!p) return send(res, 404, { error: 'Perfil não encontrado.' });
  const games = db.games.filter(g => g.white.id === p.id || g.black.id === p.id).slice(-60).reverse().map(gameSummary);
  const hist = { chess: p.ratings.chess.hist, checkers: p.ratings.checkers.hist };
  // Confronto direto com quem está vendo
  let h2h = null;
  if (ctx.me.id !== p.id) {
    h2h = { w: 0, d: 0, l: 0 };
    for (const g of db.games) {
      const meW = g.white.id === ctx.me.id && g.black.id === p.id, meB = g.black.id === ctx.me.id && g.white.id === p.id;
      if (!meW && !meB) continue;
      const myColor = meW ? 'w' : 'b';
      if (!g.winner) h2h.d++; else if (g.winner === myColor) h2h.w++; else h2h.l++;
    }
  }
  send(res, 200, { ...publicProfile(p), games, hist, h2h });
});

route('GET', '/api/ranking', async (req, res, ctx) => {
  const game = ctx.url.searchParams.get('game') === 'checkers' ? 'checkers' : 'chess';
  const list = Object.values(db.profiles)
    .filter(p => p.ratings[game].games > 0)
    .map(p => ({ id: p.id, name: p.name, color: p.color, online: isOnline(p.id), ...pubRating(p.ratings[game]) }))
    .sort((a, b) => b.r - a.r);
  send(res, 200, list);
});

/* ---------- Partidas encerradas ---------- */
function gameSummary(g) {
  const { moves, ...rest } = g;
  return rest;
}
route('GET', '/api/games', async (req, res, ctx) => {
  const pid = ctx.url.searchParams.get('player');
  const list = db.games.filter(g => !pid || g.white.id === pid || g.black.id === pid).slice(-100).reverse().map(gameSummary);
  send(res, 200, list);
});
route('GET', '/api/games/:id', async (req, res, ctx) => {
  const g = db.games.find(x => x.id === ctx.params.id);
  if (!g) return send(res, 404, { error: 'Partida não encontrada.' });
  send(res, 200, g);
});
// Partida contra o computador (jogada no navegador): só registra no histórico, sem ranking
route('POST', '/api/games/bot', async (req, res, ctx) => {
  const b = ctx.body, game = b.game === 'checkers' ? 'checkers' : 'chess', E = ENGINES[game];
  const hist = E.play(Array.isArray(b.moves) ? b.moves.slice(0, 1000) : []);
  const moves = hist.slice(1).map(h => E.strip(h.move));
  if (moves.length < 2) return send(res, 200, { ok: false });
  const level = Math.max(1, Math.min(6, Number(b.level) || 1));
  const bot = { id: null, name: `Computador ${level}`, color: '#5b655e', rating: null, bot: level };
  const me = { ...brief(ctx.me.id, game), rating: null, diff: null };
  const myColor = b.color === 'b' ? 'b' : 'w';
  const st = E.status(hist, null);
  const winner = st.over ? st.winner : (['w', 'b', null].includes(b.winner) ? b.winner : null);
  const reason = st.over ? st.reason : ['resign', 'time', 'timeout-draw'].includes(b.reason) ? b.reason : 'resign';
  const rec = {
    id: rid(4), game, tc: parseTc(b.tc) ? parseTc(b.tc).label : null, rated: false, room: null, vsBot: level,
    white: myColor === 'w' ? me : bot, black: myColor === 'b' ? me : bot,
    winner, reason, moves, plies: moves.length, started: Date.now() - 1000, ended: Date.now()
  };
  db.games.push(rec); saveGames();
  send(res, 200, { ok: true, id: rec.id });
});

/* ---------- Partidas contra o computador ao vivo ---------- */
// O computador joga no navegador de quem está jogando; o navegador manda cada lance para cá
// e quem quiser assiste pelo servidor. Fica só na memória.
const botLive = {};                     // id -> {id, pid, game, level, color, tc, moves, end, clock, started, updated}
const botKey = id => 'b:' + id;
function publicBot(g, pid) {
  const E = ENGINES[g.game], p = db.profiles[g.pid], now = Date.now();
  const human = p ? { id: p.id, name: p.name, color: p.color, rating: null, online: true } : { id: null, name: 'Jogador', color: '#5b655e', online: true };
  const bot = { id: null, name: `Computador nível ${g.level}`, color: '#5b655e', bot: g.level, online: true };
  let spectators = 0;
  for (const l of listeners[botKey(g.id)] || []) if (l.pid !== g.pid) spectators++;
  const k = g.clock;
  return {
    id: g.id, botLive: true, name: `${human.name} × Computador nível ${g.level}`, game: g.game, tc: g.tc, level: g.level, rated: false,
    players: { [g.color]: human, [g.color === 'w' ? 'b' : 'w']: bot }, moves: g.moves,
    status: E.status(E.play(g.moves), g.end), end: g.end, offers: {}, chat: [], spectators, you: null, owner: g.pid,
    clock: k ? { w: Math.max(0, k.w - (k.running === 'w' && !g.end ? now - g.at : 0)), b: Math.max(0, k.b - (k.running === 'b' && !g.end ? now - g.at : 0)), running: g.end ? null : k.running } : null,
    updated: g.updated, serverTime: now
  };
}
function botBroadcast(id) {
  const g = botLive[id];
  if (!g) return;
  for (const l of listeners[botKey(id)] || []) l.res.write(`data: ${JSON.stringify(publicBot(g, l.pid))}\n\n`);
}
const botSummary = g => ({
  id: g.id, kind: 'bot', game: g.game, level: g.level, tc: g.tc, plies: g.moves.length, over: !!g.end || roomStatus({ game: g.game, moves: g.moves }).over,
  player: brief(g.pid, g.game), color: g.color, spectators: [...(listeners[botKey(g.id)] || [])].filter(l => l.pid !== g.pid).length, updated: g.updated
});
// Some com partidas encerradas há 15 min ou paradas há 30 min
setInterval(() => {
  const now = Date.now();
  for (const g of Object.values(botLive)) if ((g.end && now - g.updated > 15 * 60e3) || now - g.updated > 30 * 60e3) { closeStreams(botKey(g.id)); delete botLive[g.id]; }
}, 60e3).unref();

route('POST', '/api/bot/live', async (req, res, ctx) => {
  const b = ctx.body, me = ctx.me;
  const game = b.game === 'checkers' ? 'checkers' : 'chess', E = ENGINES[game];
  let g = typeof b.id === 'string' && botLive[b.id] && botLive[b.id].pid === me.id ? botLive[b.id] : null;
  if (!g) {
    // Uma partida ao vivo por perfil: a nova substitui a anterior
    for (const old of Object.values(botLive)) if (old.pid === me.id) { closeStreams(botKey(old.id)); delete botLive[old.id]; }
    g = { id: rid(4), pid: me.id, started: Date.now() };
    botLive[g.id] = g;
  }
  const hist = E.play(Array.isArray(b.moves) ? b.moves.slice(0, 1000) : []);
  g.game = game; g.level = Math.max(1, Math.min(6, Number(b.level) || 1)); g.color = b.color === 'b' ? 'b' : 'w';
  g.tc = parseTc(b.tc) ? parseTc(b.tc).label : null;
  g.moves = hist.slice(1).map(h => E.strip(h.move));
  const st = E.status(hist, null);
  const e = b.end && typeof b.end === 'object' ? b.end : null;
  g.end = st.over ? { winner: st.winner, reason: st.reason } : e ? { winner: ['w', 'b'].includes(e.winner) ? e.winner : null, reason: clean(e.reason, 20) } : null;
  if (g.end && typeof (e && e.gameId) === 'string' && ID_RE.test(e.gameId)) g.end.gameId = e.gameId;
  const k = b.clock;
  g.clock = k && g.tc ? { w: Math.max(0, Number(k.w) || 0), b: Math.max(0, Number(k.b) || 0), running: ['w', 'b'].includes(k.running) ? k.running : null } : null;
  g.at = g.updated = Date.now();
  botBroadcast(g.id);
  send(res, 200, { id: g.id });
});
route('GET', '/api/bot/live/:id', async (req, res, ctx) => {
  const g = botLive[ctx.params.id];
  if (!g) return send(res, 404, { error: 'Essa partida não está mais ao vivo.' });
  send(res, 200, publicBot(g, ctx.me.id));
});
route('GET', '/api/bot/live/:id/events', async (req, res, ctx) => {
  const g = botLive[ctx.params.id];
  if (!g) return send(res, 404, { error: 'Essa partida não está mais ao vivo.' });
  if (!streamAllowed(res, ctx)) return;
  req.socket.setTimeout(0);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 1500\n\n');
  const key = botKey(g.id), l = { res, pid: ctx.me.id, ip: ctx.ip };
  (listeners[key] = listeners[key] || new Set()).add(l);
  botBroadcast(g.id);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); listeners[key] && listeners[key].delete(l); botBroadcast(g.id); });
});

/* ---------- Assistir: tudo o que está acontecendo agora ---------- */
route('GET', '/api/live', async (req, res, ctx) => {
  const me = ctx.me.id;
  const count = key => (listeners[key] ? listeners[key].size : 0);
  const rooms = Object.values(db.rooms).filter(r => inProgress(r)).sort((a, b) => b.updated - a.updated)
    .map(r => ({ ...roomSummary(r, me), kind: 'room', moves: r.moves, spectators: [...(listeners[r.id] || [])].filter(l => !seatOf(r, l.pid)).length }));
  const bots = Object.values(botLive).sort((a, b) => b.updated - a.updated).map(g => ({ ...botSummary(g), moves: g.moves }));
  const magnata = Object.values(db.magnata).filter(r => r.state && r.state.phase !== 'over').sort((a, b) => b.updated - a.updated)
    .map(r => ({ ...magSummary(r, me), kind: 'magnata', spectators: Math.max(0, count(magKey(r.id)) - r.seats.length) }));
  send(res, 200, { rooms, bots, magnata });
});

/* ---------- Lobby ---------- */
route('GET', '/api/lobby', async (req, res, ctx) => {
  const me = ctx.me.id;
  // Toda partida começada é pública para assistir; sala privada só fica escondida enquanto espera o adversário
  const rooms = Object.values(db.rooms)
    .filter(r => !r.private || seatOf(r, me) || r.invite === me || bothSeated(r))
    .sort((a, b) => b.updated - a.updated).map(r => roomSummary(r, me));
  const online = Object.values(db.profiles).filter(p => isOnline(p.id)).map(p => ({
    id: p.id, name: p.name, color: p.color, chess: Math.round(p.ratings.chess.r), checkers: Math.round(p.ratings.checkers.r),
    playing: Object.values(db.rooms).some(r => !r.end && r.seats.w && r.seats.b && seatOf(r, p.id))
  }));
  const magnata = Object.values(db.magnata)
    .filter(r => !r.private || r.seats.includes(me) || r.state)
    .sort((a, b) => b.updated - a.updated).map(r => magSummary(r, me));
  const bots = Object.values(botLive).filter(g => !g.end && g.pid !== me).sort((a, b) => b.updated - a.updated).map(botSummary);
  send(res, 200, { rooms, magnata, bots, online, me: meView(ctx.me), announce });
});

route('POST', '/api/rooms', async (req, res, ctx) => {
  const b = ctx.body, me = ctx.me;
  const open = Object.values(db.rooms).filter(r => !r.end && (r.seats.w === me.id || r.seats.b === me.id));
  if (open.length >= SEC.config.salasAbertasPorPerfil)
    return send(res, 409, { error: `Você já tem ${open.length} salas abertas. Termine ou saia de alguma antes de criar outra.` });
  if (Object.keys(db.rooms).length >= SEC.config.salasTotal) { cleanup(); if (Object.keys(db.rooms).length >= SEC.config.salasTotal) return send(res, 503, { error: 'O servidor atingiu o limite de salas. Tente mais tarde.' }); }
  const game = b.game === 'checkers' ? 'checkers' : 'chess';
  const want = ['w', 'b'].includes(b.color) ? b.color : 'r';
  const color = want === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : want;
  const invite = b.invite && db.profiles[b.invite] && b.invite !== me.id ? b.invite : null;
  const gameLabel = game === 'chess' ? 'Xadrez' : 'Damas';
  const room = {
    id: rid(3), name: clean(b.name, 40) || `${gameLabel} de ${me.name}`, game,
    tc: parseTc(b.tc), rated: b.rated !== false, private: !!b.private || !!invite, invite, wantColor: want,
    creator: me.id, seats: { w: null, b: null }, moves: [], end: null, chat: [], gameNo: 1,
    offers: { draw: null, takeback: null, rematch: null }, series: {}, away: {},
    created: Date.now(), updated: Date.now(), startedAt: null
  };
  room.seats[color] = me.id;
  resetClock(room);
  sysMsg(room, `Sala criada por ${me.name}. ${room.tc ? 'Tempo ' + room.tc.label.replace('+', ' + ') : 'Sem relógio'}${room.rated ? ', valendo ranking' : ', partida amistosa'}.`);
  db.rooms[room.id] = room;
  saveRooms();
  send(res, 200, { id: room.id, color });
});

/* ---------- Dentro da sala ---------- */
function withRoom(fn) {
  return async (req, res, ctx) => {
    const room = db.rooms[ctx.params.id];
    if (!room) return send(res, 404, { error: 'Essa sala não existe mais.' });
    ctx.room = room;
    ctx.color = seatOf(room, ctx.me.id);
    return fn(req, res, ctx);
  };
}
const playerOnly = fn => withRoom((req, res, ctx) => ctx.color ? fn(req, res, ctx) : send(res, 403, { error: 'Você não é jogador desta sala.' }));
const bothSeated = room => room.seats.w && room.seats.b;
const inProgress = room => bothSeated(room) && !room.end && !roomStatus(room).over;

// Confere o limite de conexões ao vivo; responde 429 e retorna false se estourou
function streamAllowed(res, ctx) {
  let total = 0, byIp = 0, byMe = 0;
  for (const set of Object.values(listeners)) for (const l of set) { total++; if (l.ip === ctx.ip) byIp++; if (l.pid === ctx.me.id) byMe++; }
  if (total >= SEC.config.tempoRealTotal || byIp >= SEC.config.tempoRealPorIP || byMe >= SEC.config.tempoRealPorPerfil) {
    SEC.log('TEMPO_REAL_LIMITE', ctx.ip, `total=${total} ip=${byIp} perfil=${byMe}`);
    send(res, 429, { error: 'Conexões ao vivo demais abertas. Feche outras abas da partida.' });
    return false;
  }
  return true;
}

route('GET', '/api/rooms/:id/events', withRoom(async (req, res, ctx) => {
  const { room } = ctx;
  if (!streamAllowed(res, ctx)) return;
  req.socket.setTimeout(0);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 1500\n\n');
  const l = { res, pid: ctx.me.id, ip: ctx.ip };
  (listeners[room.id] = listeners[room.id] || new Set()).add(l);
  if (ctx.color) delete room.away[ctx.color];
  broadcast(room.id);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    listeners[room.id] && listeners[room.id].delete(l);
    const r = db.rooms[room.id];
    if (!r) return;
    const c = seatOf(r, l.pid);
    if (c && !seatOnline(r, c)) r.away[c] = Date.now();
    broadcast(room.id);
    // Atualiza o contador de "desconectado" do adversário
    setTimeout(() => broadcast(room.id), ABANDON_MS + 200);
  });
}));

route('GET', '/api/rooms/:id', withRoom(async (req, res, ctx) => send(res, 200, publicRoom(ctx.room, ctx.me.id))));

route('POST', '/api/rooms/:id/join', withRoom(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (ctx.color) return send(res, 200, { color: ctx.color });
  const free = !room.seats.w ? 'w' : !room.seats.b ? 'b' : null;
  if (!free || room.end || ctx.body.spectate) return send(res, 200, { color: null });
  if (room.invite && room.invite !== me.id) return send(res, 200, { color: null });
  room.seats[free] = me.id;
  room.invite = null;
  room.updated = Date.now();
  sysMsg(room, `${me.name} entrou na sala. Boa partida!`);
  saveRooms(); broadcast(room.id);
  send(res, 200, { color: free });
}));

// Sair da sala antes de a partida começar (libera a vaga ou fecha a sala)
route('POST', '/api/rooms/:id/leave', playerOnly(async (req, res, ctx) => {
  const { room, me, color } = ctx;
  if (inProgress(room) && room.moves.length >= 2) return send(res, 409, { error: 'A partida está em andamento. Desista ou peça empate.' });
  if (inProgress(room)) finish(room, { winner: null, reason: 'aborted' });
  room.seats[color] = null;
  sysMsg(room, `${me.name} saiu da sala.`);
  if (room.end) {
    // Reabre a sala para um novo adversário
    room.moves = []; room.end = null; room.gameNo++; room.startedAt = null; room.series = {};
    room.offers = { draw: null, takeback: null, rematch: null };
    resetClock(room);
  }
  if (!room.seats.w && !room.seats.b) delete db.rooms[room.id];
  else { room.updated = Date.now(); broadcast(room.id); }
  saveRooms();
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/decline', withRoom(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (room.invite === me.id) {
    room.invite = null; room.private = false;
    sysMsg(room, `${me.name} recusou o desafio. A sala agora está aberta a todos.`);
    room.updated = Date.now(); saveRooms(); broadcast(room.id);
  }
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/chat', withRoom(async (req, res, ctx) => {
  const { room, me, color } = ctx;
  const text = clean(ctx.body.text, 300);
  if (!text) return send(res, 400, { error: 'A mensagem está vazia.' });
  const mine = room.chat.filter(m => m.pid === me.id && Date.now() - m.ts < 30000).slice(-3);
  if (mine.length === 3 && mine.every(m => m.t === text)) return send(res, 429, { error: 'Você já mandou essa mensagem várias vezes.' });
  room.chat.push({ n: me.name, pid: me.id, c: color, t: text, ts: Date.now() });
  if (room.chat.length > CHAT_MAX) room.chat.splice(0, room.chat.length - CHAT_MAX);
  saveRooms(); broadcast(room.id);
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/move', playerOnly(async (req, res, ctx) => {
  const { room, color, body } = ctx;
  if (checkFlag(room)) return send(res, 409, { error: 'O tempo acabou.' });
  if (!bothSeated(room)) return send(res, 409, { error: 'Aguarde o adversário entrar.' });
  if (room.end) return send(res, 409, { error: 'A partida já terminou.' });
  const E = ENGINES[room.game];
  const hist = E.play(room.moves);
  if (E.status(hist, null).over) return send(res, 409, { error: 'A partida já terminou.' });
  if (body.ply !== room.moves.length) return send(res, 409, { error: 'O tabuleiro estava desatualizado. Tente de novo.' });
  const cur = hist[hist.length - 1];
  if (cur.s.turn !== color) return send(res, 409, { error: 'Não é a sua vez.' });
  const m = cur.legal.find(x => E.match(x, body.move || {}));
  if (!m) return send(res, 400, { error: 'Lance ilegal.' });

  const now = Date.now();
  if (room.tc && room.clock.turnStart) room.clock[color] = remaining(room, color, now) + room.tc.inc;
  room.moves.push(E.strip(m));
  if (room.moves.length === 1) room.startedAt = now;
  room.clock.turnStart = room.tc && room.moves.length >= 2 ? now : null;
  // Um lance recusa as ofertas pendentes do adversário (como no lichess)
  if (room.offers.draw && room.offers.draw !== color) room.offers.draw = null;
  if (room.offers.takeback) room.offers.takeback = null;
  room.updated = now;
  const st = E.status(E.play(room.moves), null);
  if (st.over) return finish(room, { winner: st.winner, reason: st.reason }), send(res, 200, { ok: true });
  scheduleFlag(room);
  saveRooms(); broadcast(room.id);
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/resign', playerOnly(async (req, res, ctx) => {
  const { room, color } = ctx;
  if (!checkFlag(room) && inProgress(room)) {
    if (room.moves.length < 2) finish(room, { winner: null, reason: 'aborted' });
    else finish(room, { winner: other(color), reason: 'resign' });
  }
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/abort', playerOnly(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (!inProgress(room) || room.moves.length >= 2) return send(res, 409, { error: 'Só dá para abortar antes de cada lado jogar o primeiro lance.' });
  sysMsg(room, `${me.name} abortou a partida.`);
  finish(room, { winner: null, reason: 'aborted' });
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/claim', playerOnly(async (req, res, ctx) => {
  const { room, color } = ctx;
  const op = other(color);
  if (!inProgress(room)) return send(res, 409, { error: 'Não há partida em andamento.' });
  if (seatOnline(room, op) || !room.away[op] || Date.now() - room.away[op] < ABANDON_MS)
    return send(res, 409, { error: 'O adversário ainda pode voltar.' });
  if (ctx.body.draw) finish(room, { winner: null, reason: 'abandon-draw' });
  else if (room.moves.length < 2) finish(room, { winner: null, reason: 'aborted' });
  else finish(room, { winner: color, reason: 'abandon' });
  send(res, 200, { ok: true });
}));

route('POST', '/api/rooms/:id/addtime', playerOnly(async (req, res, ctx) => {
  const { room, color, me } = ctx;
  if (!room.tc || !inProgress(room)) return send(res, 409, { error: 'Não há relógio correndo.' });
  const op = other(color), now = Date.now();
  room.clock[op] = remaining(room, op, now) + 15000;
  if (room.clock.turnStart && turnOf(room) === op) room.clock.turnStart = now;
  sysMsg(room, `${me.name} deu 15 segundos ao adversário.`);
  scheduleFlag(room); saveRooms(); broadcast(room.id);
  send(res, 200, { ok: true });
}));

// Ofertas: empate, voltar lance, revanche. {kind, accept?}
route('POST', '/api/rooms/:id/offer', playerOnly(async (req, res, ctx) => {
  const { room, color, me } = ctx;
  const kind = ctx.body.kind;
  if (!['draw', 'takeback', 'rematch'].includes(kind)) return send(res, 400, { error: 'Oferta inválida.' });
  const op = other(color);
  const pending = room.offers[kind];

  if (ctx.body.cancel) {
    if (pending === color) { room.offers[kind] = null; broadcast(room.id); }
    return send(res, 200, { ok: true });
  }
  if (ctx.body.decline) {
    if (pending === op) {
      room.offers[kind] = null;
      sysMsg(room, `${me.name} recusou ${kind === 'draw' ? 'o empate' : kind === 'takeback' ? 'voltar o lance' : 'a revanche'}.`);
      saveRooms(); broadcast(room.id);
    }
    return send(res, 200, { ok: true });
  }

  if (kind === 'rematch') {
    if (!room.end && !roomStatus(room).over) return send(res, 409, { error: 'A partida ainda não terminou.' });
    if (!bothSeated(room)) return send(res, 409, { error: 'O adversário saiu da sala.' });
    if (pending === op) {
      // Aceito: nova partida com as cores trocadas
      room.seats = { w: room.seats.b, b: room.seats.w };
      room.moves = []; room.end = null; room.gameNo++; room.startedAt = null;
      room.offers = { draw: null, takeback: null, rematch: null };
      resetClock(room);
      sysMsg(room, `Revanche aceita! Partida ${room.gameNo}, cores trocadas.`);
    } else room.offers.rematch = color;
  } else {
    if (!inProgress(room)) return send(res, 409, { error: 'Não há partida em andamento.' });
    if (kind === 'draw') {
      if (pending === op) { finish(room, { winner: null, reason: 'agreement' }); return send(res, 200, { ok: true }); }
      room.offers.draw = color;
      sysMsg(room, `${me.name} propôs empate.`);
    } else {
      const mine = room.moves.length - (turnOf(room) === color ? 2 : 1);
      if (pending === op) {
        // Aceito: volta até antes do último lance de quem pediu
        const now = Date.now();
        stopClock(room, now);
        const n = turnOf(room) === op ? 2 : 1;
        room.moves.splice(Math.max(0, room.moves.length - n));
        room.clock.turnStart = room.tc && room.moves.length >= 2 ? now : null;
        room.offers.takeback = null; room.offers.draw = null;
        sysMsg(room, `${me.name} aceitou voltar o lance.`);
        scheduleFlag(room);
      } else {
        if (mine < 0) return send(res, 409, { error: 'Você ainda não fez nenhum lance.' });
        room.offers.takeback = color;
        sysMsg(room, `${me.name} pediu para voltar o lance.`);
      }
    }
  }
  room.updated = Date.now();
  saveRooms(); broadcast(room.id);
  send(res, 200, { ok: true });
}));

/* ==================== Mesas: Magnata (2 a 8) e Ludo (2 a 4) ==================== */
// As duas usam a mesma estrutura de mesa (sentar, escolher peão/cor, começar, ações, chat); muda só o motor de regras.
const TABLE_GAMES = {
  magnata: { E: M, seats: 8, label: 'Magnata' },
  ludo: { E: L, seats: 4, label: 'Ludo' },
  // Truco: 1×1 ou duplas; a ordem na mesa segue o lugar escolhido e cada um só vê as próprias cartas
  truco: { E: Tr, seats: 4, label: 'Truco', counts: [2, 4], fixedOrder: true }
};
const tg = room => TABLE_GAMES[room.game] || TABLE_GAMES.magnata;
// Peão de cada jogador (índice em PAWNS do jogo: peão no Magnata, cor no Ludo). Quem senta pega o primeiro livre e pode trocar antes de começar.
function magPawns(room) {
  room.pawns = room.pawns || {};
  for (const pid of Object.keys(room.pawns)) if (!room.seats.includes(pid)) delete room.pawns[pid];
  const used = new Set(Object.values(room.pawns));
  for (const pid of room.seats) if (room.pawns[pid] === undefined) {
    const free = tg(room).E.PAWNS.findIndex((_, i) => !used.has(i));
    room.pawns[pid] = free; used.add(free);
  }
  return room.pawns;
}
const MAG_AWAY_MS = 60000;           // tempo desconectado na sua vez para os outros poderem tirá-lo da partida
const MAG_ROUNDS = [0, 20, 30, 50];   // limite de rodadas (0 = até sobrar um)
const magKey = id => 'm:' + id;       // chave em `listeners`, separada das salas de xadrez/damas
const diceRng = n => crypto.randomInt(n);
const who = pid => { const p = db.profiles[pid]; return p ? { id: p.id, name: p.name, color: p.color } : { id: pid, name: 'Perfil removido', color: '#5b655e' }; };
function magOnline(room, pid) {
  for (const l of listeners[magKey(room.id)] || []) if (l.pid === pid) return true;
  return false;
}
const magSeat = (room, pid) => (room.state ? room.state.players.findIndex(p => p.pid === pid && !p.out) : room.seats.indexOf(pid));
// Quem precisa agir agora (para saber se está travando a partida)
const magWaitingOn = s => (s.phase === 'over' ? null : s.phase === 'debt' ? s.debts[0].from
  : s.phase === 'raise' ? s.players.findIndex(p => p.team !== s.pending.team)        // truco: quem precisa responder
  : s.phase === 'eleven' ? s.players.findIndex(p => p.team === s.elevenTeam) : s.turn);
function magSysMsg(room, text) {
  room.chat.push({ n: null, t: text, ts: Date.now() });
  if (room.chat.length > CHAT_MAX) room.chat.splice(0, room.chat.length - CHAT_MAX);
}
function publicMag(room, pid) {
  const now = Date.now();
  let state = null;
  if (room.state) {
    const { deck, ...rest } = room.state;   // a ordem das cartas fica só no servidor
    const w = magWaitingOn(room.state);
    const wp = w === null ? null : room.state.players[w].pid;
    const E = tg(room).E;
    if (E.view) Object.assign(rest, E.view(rest, room.state.players.findIndex(p => p.pid === pid)));
    state = { ...rest, waitingAwayMs: wp && !magOnline(room, wp) && room.away[wp] ? now - room.away[wp] : 0 };
  }
  let spectators = 0;
  for (const l of listeners[magKey(room.id)] || []) if (!room.seats.includes(l.pid)) spectators++;
  return {
    id: room.id, game: room.game || 'magnata', name: room.name, creator: room.creator, private: !!room.private, maxRounds: room.maxRounds, maxSeats: tg(room).seats,
    seats: room.seats.map(id => ({ ...who(id), online: magOnline(room, id), pawn: magPawns(room)[id], ink: (room.inks || {})[id] || null })), state, chat: room.chat, spectators,
    you: room.seats.includes(pid) ? magSeat(room, pid) : null, joined: room.seats.includes(pid),
    awayLimit: MAG_AWAY_MS, updated: room.updated, serverTime: now
  };
}
function magBroadcast(id) {
  const room = db.magnata[id];
  if (!room) return;
  for (const l of listeners[magKey(id)] || []) l.res.write(`data: ${JSON.stringify(publicMag(room, l.pid))}\n\n`);
}
function magSummary(room, pid) {
  const s = room.state;
  return {
    id: room.id, game: room.game || 'magnata', name: room.name, private: !!room.private, creator: room.creator, maxRounds: room.maxRounds, maxSeats: tg(room).seats,
    players: room.seats.map(who), started: !!s, over: !!s && s.phase === 'over', round: s ? s.round : 0,
    mine: room.seats.includes(pid), updated: room.updated
  };
}
// Atualiza as estatísticas quando a partida termina
function magFinished(room) {
  const s = room.state;
  if (room.recorded || !s || s.phase !== 'over') return;
  room.recorded = true;
  s.players.forEach((pl, i) => {
    const p = db.profiles[pl.pid];
    if (!p) return;
    const key = room.game || 'magnata';
    const st = p.ratings[key] = p.ratings[key] || { games: 0, w: 0 };
    st.games++;
    if (room.game === 'truco' ? pl.team === s.winner : s.winner === i) st.w++;
  });
  saveProfiles();
}
function magChanged(room) {
  room.updated = Date.now();
  magFinished(room);
  saveMagnata(); magBroadcast(room.id);
}
function withMag(fn) {
  return async (req, res, ctx) => {
    const room = db.magnata[ctx.params.id];
    if (!room) return send(res, 404, { error: 'Essa mesa não existe mais.' });
    ctx.room = room;
    return fn(req, res, ctx);
  };
}

route('POST', '/api/magnata', async (req, res, ctx) => {
  const b = ctx.body, me = ctx.me;
  const game = TABLE_GAMES[b.game] ? b.game : 'magnata', G_ = TABLE_GAMES[game];
  const open = Object.values(db.magnata).filter(r => r.seats.includes(me.id) && !(r.state && r.state.phase === 'over'));
  if (open.length >= SEC.config.salasAbertasPorPerfil) return send(res, 409, { error: `Você já está em ${open.length} mesas. Saia de alguma antes de criar outra.` });
  if (Object.keys(db.magnata).length >= SEC.config.salasTotal) return send(res, 503, { error: 'O servidor atingiu o limite de mesas. Tente mais tarde.' });
  const room = {
    id: rid(3), game, name: clean(b.name, 40) || `${G_.label} de ${me.name}`, creator: me.id, private: !!b.private,
    maxRounds: game === 'magnata' && MAG_ROUNDS.includes(Number(b.maxRounds)) ? Number(b.maxRounds) : 0,
    seats: [me.id], state: null, chat: [], away: {}, created: Date.now(), updated: Date.now()
  };
  magSysMsg(room, `Mesa criada por ${me.name}. Esperando de 2 a ${G_.seats} jogadores.`);
  db.magnata[room.id] = room;
  saveMagnata();
  send(res, 200, { id: room.id });
});

route('GET', '/api/magnata/:id', withMag(async (req, res, ctx) => send(res, 200, publicMag(ctx.room, ctx.me.id))));

route('GET', '/api/magnata/:id/events', withMag(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (!streamAllowed(res, ctx)) return;
  req.socket.setTimeout(0);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 1500\n\n');
  const key = magKey(room.id), l = { res, pid: me.id, ip: ctx.ip };
  (listeners[key] = listeners[key] || new Set()).add(l);
  delete room.away[me.id];
  magBroadcast(room.id);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    listeners[key] && listeners[key].delete(l);
    const r = db.magnata[room.id];
    if (!r) return;
    if (r.seats.includes(l.pid) && !magOnline(r, l.pid)) r.away[l.pid] = Date.now();
    magBroadcast(r.id);
    setTimeout(() => magBroadcast(r.id), MAG_AWAY_MS + 200);
  });
}));

route('POST', '/api/magnata/:id/join', withMag(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (room.seats.includes(me.id)) return send(res, 200, { joined: true });
  if (room.state) return send(res, 200, { joined: false, error: 'A partida já começou. Você está assistindo.' });
  if (room.seats.length >= tg(room).seats) return send(res, 200, { joined: false, error: 'A mesa está cheia. Você está assistindo.' });
  room.seats.push(me.id);
  magPawns(room);
  magSysMsg(room, `${me.name} sentou à mesa.`);
  magChanged(room);
  send(res, 200, { joined: true });
}));

route('POST', '/api/magnata/:id/leave', withMag(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (room.state && room.state.phase !== 'over') return send(res, 409, { error: 'A partida já começou. Para sair, desista da partida.' });
  if (!room.seats.includes(me.id)) return send(res, 200, { ok: true });
  room.seats = room.seats.filter(id => id !== me.id);
  magPawns(room);
  if (!room.seats.length) { delete db.magnata[room.id]; saveMagnata(); return send(res, 200, { ok: true }); }
  if (room.creator === me.id) room.creator = room.seats[0];
  magSysMsg(room, `${me.name} saiu da mesa.`);
  magChanged(room);
  send(res, 200, { ok: true });
}));

route('POST', '/api/magnata/:id/pawn', withMag(async (req, res, ctx) => {
  const { room, me } = ctx, i = Number(ctx.body.pawn);
  if (room.state && room.state.phase !== 'over') return send(res, 409, { error: 'A partida já começou.' });
  if (!room.seats.includes(me.id)) return send(res, 403, { error: 'Sente à mesa para escolher um peão.' });
  if (!Number.isInteger(i) || !tg(room).E.PAWNS[i]) return send(res, 400, { error: 'Peão inválido.' });
  const pawns = magPawns(room);
  if (Object.entries(pawns).some(([pid, v]) => v === i && pid !== me.id)) return send(res, 409, { error: room.game === 'ludo' ? 'Outra pessoa já escolheu essa cor.' : 'Outra pessoa já escolheu esse peão.' });
  pawns[me.id] = i;
  // Ludo: cor RGB livre (o índice continua definindo o lado do tabuleiro)
  if (room.game === 'ludo' && ctx.body.ink !== undefined) {
    room.inks = room.inks || {};
    if (ctx.body.ink === null) delete room.inks[me.id];
    else if (/^#[0-9a-f]{6}$/i.test(ctx.body.ink)) room.inks[me.id] = ctx.body.ink.toLowerCase();
    else return send(res, 400, { error: 'Cor inválida.' });
  }
  magChanged(room);
  send(res, 200, { ok: true });
}));

route('POST', '/api/magnata/:id/start', withMag(async (req, res, ctx) => {
  const { room, me } = ctx;
  if (room.creator !== me.id) return send(res, 403, { error: 'Só quem criou a mesa pode começar.' });
  if (room.state && room.state.phase !== 'over') return send(res, 409, { error: 'A partida já começou.' });
  if (room.seats.length < 2) return send(res, 409, { error: 'São precisos pelo menos 2 jogadores.' });
  const G_ = tg(room);
  if (G_.counts && !G_.counts.includes(room.seats.length)) return send(res, 409, { error: `${G_.label} é com ${G_.counts.join(' ou ')} jogadores.` });
  if (room.game === 'truco') {
    const t = Object.values(magPawns(room)).map(i => i % 2);
    if (t.filter(x => x === 0).length !== t.filter(x => x === 1).length) return send(res, 409, { error: 'As duplas precisam ter o mesmo número de jogadores. Troquem de lugar.' });
  }
  // Ordem de jogo sorteada
  const order = room.seats.slice();
  if (!G_.fixedOrder) for (let i = order.length - 1; i > 0; i--) { const j = diceRng(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const pawns = magPawns(room);
  const E = tg(room).E;
  room.state = E.create(order.map(pid => { const pw = E.PAWNS[pawns[pid]]; return { pid, name: who(pid).name, color: pw.color, icon: pw.icon, pawn: pawns[pid], ink: (room.inks || {})[pid] }; }), { maxRounds: room.maxRounds }, diceRng);
  room.recorded = false;
  magSysMsg(room, `A partida começou! Ordem: ${order.map(pid => who(pid).name).join(', ')}.`);
  magChanged(room);
  send(res, 200, { ok: true });
}));

route('POST', '/api/magnata/:id/act', withMag(async (req, res, ctx) => {
  const { room, me, body } = ctx;
  const s = room.state;
  if (!s) return send(res, 409, { error: 'A partida ainda não começou.' });
  const seat = magSeat(room, me.id);
  if (seat < 0) return send(res, 403, { error: 'Você não está jogando nesta mesa.' });
  if (typeof body.type !== 'string') return send(res, 400, { error: 'Ação inválida.' });
  if (body.type === 'kick') {
    // Tira da partida quem sumiu na própria vez (as propriedades voltam ao banco)
    const w = magWaitingOn(s);
    const pid = w === null ? null : s.players[w].pid;
    if (w === null || w === seat || magOnline(room, pid) || !room.away[pid] || Date.now() - room.away[pid] < MAG_AWAY_MS)
      return send(res, 409, { error: 'O jogador ainda pode voltar.' });
    tg(room).E.log(s, `${s.players[w].name} ficou desconectado e foi tirado da partida por ${me.name}.`);
    tg(room).E.bankrupt(s, w, null);
  } else {
    const r = tg(room).E.act(s, seat, body, diceRng);
    if (r.error) return send(res, 409, { error: r.error });
  }
  magChanged(room);
  send(res, 200, { ok: true });
}));

route('POST', '/api/magnata/:id/chat', withMag(async (req, res, ctx) => {
  const { room, me } = ctx;
  const text = clean(ctx.body.text, 300);
  if (!text) return send(res, 400, { error: 'A mensagem está vazia.' });
  room.chat.push({ n: me.name, pid: me.id, c: me.color, t: text, ts: Date.now() });
  if (room.chat.length > CHAT_MAX) room.chat.splice(0, room.chat.length - CHAT_MAX);
  saveMagnata(); magBroadcast(room.id);
  send(res, 200, { ok: true });
}));

/* ==================== Painel do administrador ==================== */
let announce = null;   // aviso para todos: {text, by, ts}
const adminOnly = fn => async (req, res, ctx) => (isAdmin(ctx.me) ? fn(req, res, ctx) : send(res, 403, { error: 'Só administradores podem fazer isso.' }));
const fileSize = f => { try { return fs.statSync(f).size; } catch (e) { return 0; } };
function readLogTail(lines) {
  const f = path.join(DIR, 'seguranca.log');
  try {
    const size = fileSize(f), len = Math.min(size, 64 * 1024), buf = Buffer.alloc(len);
    const fd = fs.openSync(f, 'r');
    fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-lines).reverse().map(l => {
      const [ts, kind, ip, ...rest] = l.split(' ');
      return { ts, kind, ip, detail: rest.join(' ') };
    });
  } catch (e) { return []; }
}
function adminProfile(p) {
  const games = db.games.filter(g => g.white.id === p.id || g.black.id === p.id).length;
  return {
    id: p.id, name: p.name, color: p.color, created: p.created, lastSeen: lastSeen[p.id] || null, online: isOnline(p.id),
    admin: isAdmin(p), adminByConfig: isAdmin(p) && !p.admin, banned: !!p.banned,
    chess: Math.round(p.ratings.chess.r), checkers: Math.round(p.ratings.checkers.r), games,
    magnata: p.ratings.magnata || { games: 0, w: 0 },
    sessions: Object.values(db.sessions).filter(s => s.pid === p.id).length
  };
}
const endSessions = pid => { for (const [t, s] of Object.entries(db.sessions)) if (s.pid === pid) delete db.sessions[t]; saveSessions(); };
// Fecha as conexões ao vivo de uma sala (os navegadores voltam ao lobby ao não achar mais a sala)
function closeStreams(key) { for (const l of listeners[key] || []) l.res.end(); delete listeners[key]; }

route('GET', '/api/admin/overview', adminOnly(async (req, res) => {
  const now = Date.now(), day = now - 86400e3;
  const rooms = Object.values(db.rooms), mag = Object.values(db.magnata);
  let streams = 0;
  for (const set of Object.values(listeners)) streams += set.size;
  send(res, 200, {
    profiles: Object.keys(db.profiles).length, online: Object.values(db.profiles).filter(p => isOnline(p.id)).length,
    banned: Object.values(db.profiles).filter(p => p.banned).length,
    rooms: rooms.length, playing: rooms.filter(r => inProgress(r)).length,
    magnata: mag.length, magnataPlaying: mag.filter(r => r.state && r.state.phase !== 'over').length,
    games: db.games.length, gamesToday: db.games.filter(g => g.ended > day).length,
    sessions: Object.keys(db.sessions).length, streams,
    uptime: now - STARTED_AT, memory: process.memoryUsage().rss, node: process.version,
    dbSize: fileSize(banco.file) + fileSize(banco.file + '-wal'),
    announce, bans: SEC.bansList(), log: readLogTail(150),
    config: { somenteRedeLocal: SEC.config.somenteRedeLocal, permitirIPs: SEC.config.permitirIPs, bloquearIPs: SEC.config.bloquearIPs }
  });
}));

route('GET', '/api/admin/profiles', adminOnly(async (req, res) => {
  send(res, 200, Object.values(db.profiles).map(adminProfile).sort((a, b) => (b.lastSeen || b.created) - (a.lastSeen || a.created)));
}));

route('POST', '/api/admin/profiles/:id', adminOnly(async (req, res, ctx) => {
  const p = db.profiles[ctx.params.id], action = ctx.body.action, me = ctx.me;
  if (!p) return send(res, 404, { error: 'Perfil não encontrado.' });
  if (p.id === me.id && ['unadmin', 'ban', 'delete'].includes(action)) return send(res, 409, { error: 'Você não pode fazer isso com o seu próprio perfil.' });
  const done = (msg, extra) => { SEC.log('ADMIN', ctx.ip, `${me.name}: ${msg}`); send(res, 200, { ok: true, msg, ...extra }); };
  switch (action) {
    case 'admin': p.admin = true; saveProfiles(); return done(`${p.name} agora é administrador.`);
    case 'unadmin':
      if (isAdmin(p) && !p.admin) return send(res, 409, { error: 'Esse perfil é administrador pelo seguranca.json. Tire o nome de lá.' });
      p.admin = false; saveProfiles(); return done(`${p.name} deixou de ser administrador.`);
    case 'ban': p.banned = true; endSessions(p.id); saveProfiles(); return done(`${p.name} foi suspenso e desconectado.`);
    case 'unban': p.banned = false; saveProfiles(); return done(`${p.name} pode entrar de novo.`);
    case 'logout': endSessions(p.id); return done(`${p.name} foi desconectado de todas as máquinas.`);
    case 'resetpass': {
      // Senha temporária legível (sem 0/O, 1/l)
      const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
      const pass = Array.from({ length: 8 }, () => abc[crypto.randomInt(abc.length)]).join('');
      p.salt = rid(8); p.pass = await hashPass(pass, p.salt);
      endSessions(p.id); saveProfiles();
      return done(`Senha de ${p.name} redefinida.`, { password: pass });
    }
    case 'delete': {
      for (const r of Object.values(db.rooms)) {
        if (!seatOf(r, p.id)) continue;
        sysMsg(r, `${p.name} foi removido pelo administrador.`);
        if (inProgress(r)) finish(r, { winner: null, reason: 'aborted' });
        closeStreams(r.id); delete db.rooms[r.id];
      }
      for (const r of Object.values(db.magnata)) {
        if (!r.seats.includes(p.id)) continue;
        const seat = magSeat(r, p.id);
        if (r.state && r.state.phase !== 'over' && seat >= 0) tg(r).E.bankrupt(r.state, seat, null);
        else if (!r.state) r.seats = r.seats.filter(id => id !== p.id);
        if (!r.seats.length) { closeStreams(magKey(r.id)); delete db.magnata[r.id]; } else magChanged(r);
      }
      delete db.profiles[p.id]; endSessions(p.id);
      saveProfiles(); saveRooms(); saveMagnata();
      return done(`Perfil ${p.name} apagado. O histórico de partidas foi mantido.`);
    }
  }
  send(res, 400, { error: 'Ação inválida.' });
}));

route('GET', '/api/admin/rooms', adminOnly(async (req, res) => {
  const count = key => (listeners[key] ? listeners[key].size : 0);
  const rooms = Object.values(db.rooms).sort((a, b) => b.updated - a.updated).map(r => ({
    id: r.id, kind: 'room', game: r.game, name: r.name, private: !!r.private, rated: !!r.rated,
    players: ['w', 'b'].map(c => (r.seats[c] ? who(r.seats[c]).name : null)), plies: r.moves.length,
    status: r.end || roomStatus(r).over ? 'Encerrada' : bothSeated(r) ? 'Em andamento' : 'Aguardando', watching: count(r.id), updated: r.updated
  }));
  const mag = Object.values(db.magnata).sort((a, b) => b.updated - a.updated).map(r => ({
    id: r.id, kind: 'magnata', game: r.game || 'magnata', name: r.name, private: !!r.private,
    players: r.seats.map(id => who(id).name), round: r.state ? r.state.round : 0,
    status: !r.state ? 'Aguardando' : r.state.phase === 'over' ? 'Encerrada' : 'Em andamento', watching: count(magKey(r.id)), updated: r.updated
  }));
  send(res, 200, [...rooms, ...mag]);
}));

route('POST', '/api/admin/rooms/:id/close', adminOnly(async (req, res, ctx) => {
  const id = ctx.params.id;
  if (ctx.body.kind === 'magnata') {
    if (!db.magnata[id]) return send(res, 404, { error: 'Mesa não encontrada.' });
    closeStreams(magKey(id)); delete db.magnata[id]; saveMagnata();
  } else {
    const r = db.rooms[id];
    if (!r) return send(res, 404, { error: 'Sala não encontrada.' });
    if (inProgress(r)) finish(r, { winner: null, reason: 'aborted' });
    clearTimeout(flagTimers[id]);
    closeStreams(id); delete db.rooms[id]; saveRooms();
  }
  SEC.log('ADMIN', ctx.ip, `${ctx.me.name}: fechou a sala ${id}`);
  send(res, 200, { ok: true });
}));

route('POST', '/api/admin/announce', adminOnly(async (req, res, ctx) => {
  const text = clean(ctx.body.text, 200);
  announce = text ? { text, by: ctx.me.name, ts: Date.now() } : null;
  SEC.log('ADMIN', ctx.ip, `${ctx.me.name}: aviso ${text ? `"${text}"` : 'removido'}`);
  send(res, 200, { ok: true, announce });
}));

route('POST', '/api/admin/unblock', adminOnly(async (req, res, ctx) => {
  const ip = clean(ctx.body.ip, 64);
  if (!SEC.unban(ip)) return send(res, 404, { error: 'Esse IP não está bloqueado.' });
  SEC.log('ADMIN', ctx.ip, `${ctx.me.name}: desbloqueou ${ip}`);
  send(res, 200, { ok: true });
}));

/* ---------- Servidor ---------- */
// Qual limite vale para cada rota que altera dados
function bucketFor(method, pathname) {
  if (method !== 'POST') return null;
  if (pathname === '/api/rooms' || pathname === '/api/magnata') return 'criarSala';
  if (pathname.endsWith('/chat')) return 'chat';
  if (pathname.endsWith('/move') || pathname.endsWith('/act') || pathname === '/api/bot/live') return 'lance';
  if (pathname.startsWith('/api/cassino/')) return 'cassino';
  if (pathname.startsWith('/api/sugestoes')) return pathname.endsWith('/comment') ? 'chat' : 'acao';
  if (pathname.startsWith('/api/rooms/') || pathname.startsWith('/api/magnata/') || pathname.startsWith('/api/admin/')) return 'acao';
  return null;
}
const ID_RE = /^[a-f0-9]{4,16}$/;

/* ==================== Cassino (fichas de mentira) ==================== */
require('./cassino.js').install({ route, send, db, saveProfiles, listeners, streamAllowed });
/* ==================== Sugestões de jogos ==================== */
require('./sugestoes.js').install({ route, send, db, save: () => mark('suggestions'), isAdmin, clean, rid });

const server = http.createServer(async (req, res) => {
  const ip = SEC.normIp(req.socket.remoteAddress);
  SEC.securityHeaders(res);
  const ban = SEC.banned(ip);
  if (ban) { res.setHeader('Retry-After', String(ban)); return send(res, 429, { error: `Acesso bloqueado temporariamente por excesso de requisições. Aguarde ${Math.ceil(ban / 60)} min.` }); }
  if (!['GET', 'POST', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Método não permitido.' });
  if ((req.url || '').length > 2048) return send(res, 414, { error: 'Endereço longo demais.' });
  if (!rate(res, { ip }, 'geral')) return;
  let url;
  try { url = new URL(req.url, 'http://x'); decodeURIComponent(url.pathname); }
  catch (e) { return send(res, 400, { error: 'Endereço inválido.' }); }

  if (!url.pathname.startsWith('/api/')) {
    if (req.method === 'POST') return send(res, 405, { error: 'Método não permitido.' });
    const rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    if (rel.includes('\0') || rel.split('/').some(seg => seg.startsWith('.'))) return send(res, 404, { error: 'não encontrado' });
    const file = path.join(PUBLIC, path.normalize(rel));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'proibido' });
    return fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, { error: 'não encontrado' });
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.svg' ? 'max-age=86400' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  }

  if (!rate(res, { ip }, 'api')) return;
  if (req.method === 'POST' && !SEC.sameOrigin(req)) {
    SEC.log('ORIGEM_RECUSADA', ip, String(req.headers.origin));
    return send(res, 403, { error: 'Requisição de outro site recusada.' });
  }
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    if (params.id !== undefined && !ID_RE.test(params.id)) return send(res, 404, { error: 'Não encontrado.' });
    const me = auth(req, url);
    if (!r.open && !me) return send(res, 401, { error: 'Entre no seu perfil para continuar.' });
    const ctx = { url, params, me, ip, body: {} };
    const bucket = bucketFor(req.method, url.pathname);
    if (bucket && !rate(res, ctx, bucket, me ? me.id : ip)) return;
    if (req.method === 'POST') {
      ctx.body = await readBody(req);
      if (ctx.body === 'big') {
        SEC.log('CORPO_GRANDE', ip, url.pathname);
        res.setHeader('Connection', 'close');
        res.on('finish', () => req.destroy());
        return send(res, 413, { error: 'Dados grandes demais.' });
      }
      if (!ctx.body) return send(res, 400, { error: 'Dados inválidos na requisição.' });
    }
    try { return await r.fn(req, res, ctx); }
    catch (e) { console.error(e); SEC.log('ERRO', ip, e.message); return send(res, 500, { error: 'Erro interno no servidor.' }); }
  }
  send(res, 404, { error: 'Rota não encontrada.' });
});
SEC.guardServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nTabuleiro em Rede rodando na porta ${PORT}\n`);
  console.log(`  Nesta máquina:  http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  Na rede:        http://${a.address}:${PORT}`);
  const c = SEC.config;
  console.log(`\nProteções ativas: ${c.permitirIPs.length ? 'só os IPs de seguranca.json' : c.somenteRedeLocal ? 'só aceita máquinas da rede local' : 'aceita qualquer IP'}` +
    `${c.bloquearIPs.length ? `, ${c.bloquearIPs.length} IP(s) bloqueado(s)` : ''}; limites de requisições e de login ligados.`);
  console.log('Ajuste em seguranca.json. Eventos suspeitos ficam em dados/seguranca.log.');
  console.log(`Banco de dados: ${banco.file}`);
  console.log('Ctrl+C para encerrar.\n');
});

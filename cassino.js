// Cassino com fichas de mentira (F$): Crash ao vivo, Mines, Double, Dice, Limbo e Plinko.
// Tudo é sorteado no servidor; o navegador só desenha. Nada aqui vale dinheiro de verdade.
const crypto = require('crypto');

const START = 1000, BONUS = 1000, BONUS_BELOW = 50, BONUS_MS = 5 * 60e3;
const MIN_BET = 1, MAX_BET = 100000, HIST_MAX = 20;
const EDGE = 0.99;                                  // retorno de 99% (1% fica com a "casa")
const cents = x => Math.round(x * 100) / 100;
const rand = () => crypto.randomInt(2 ** 47) / 2 ** 47;   // [0, 1)
// Multiplicador "estilo crash": 1% de chance de 1,00×, cauda longa até 1000×
const crashPoint = () => Math.min(1000, Math.max(1, Math.floor((EDGE / (1 - rand())) * 100) / 100));

// Plinko: multiplicadores por número de linhas e risco
const PLINKO = {
  8: { low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6], mid: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13], high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29] },
  12: { low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10], mid: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33], high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170] },
  16: { low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16], mid: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110], high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000] }
};
// Double: 15 casas — 0 é branco (14×), 1–7 vermelho (2×), 8–14 preto (2×)
const DOUBLE_COLOR = n => (n === 0 ? 'white' : n <= 7 ? 'red' : 'black');
const DOUBLE_PAY = { white: 14, red: 2, black: 2 };
// Mines: multiplicador depois de k casas livres com m minas (25 casas)
function minesMult(m, k) {
  let x = EDGE;
  for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i);
  return Math.floor(x * 100) / 100;
}
// Crash: o multiplicador cresce exponencialmente (2× em ~11,5 s)
const CRASH_RATE = 0.00006, BET_MS = 7000, AFTER_MS = 3500;
const crashAt = ms => Math.floor(Math.exp(CRASH_RATE * Math.max(0, ms)) * 100) / 100;

function install({ route, send, db, saveProfiles, listeners, streamAllowed }) {
  const wallet = p => {
    p.ratings.casino = p.ratings.casino || { bal: START, wagered: 0, won: 0, bets: 0, best: 0, bonusAt: 0, hist: [] };
    return p.ratings.casino;
  };
  const view = w => ({ bal: w.bal, wagered: w.wagered, won: w.won, bets: w.bets, best: w.best, hist: w.hist,
    bonusIn: w.bal < BONUS_BELOW ? Math.max(0, w.bonusAt + BONUS_MS - Date.now()) : null,
    mines: w.mines && !w.mines.over ? minesView(w.mines) : null });
  const amountOf = (w, v) => {
    const a = cents(Number(v));
    if (!(a >= MIN_BET)) return { error: `Aposta mínima: F$ ${MIN_BET}.` };
    if (a > MAX_BET) return { error: `Aposta máxima: F$ ${MAX_BET.toLocaleString('pt-BR')}.` };
    if (a > w.bal) return { error: 'Saldo insuficiente.' };
    return { a };
  };
  // Debita a aposta; settle() paga e registra no histórico
  const take = (w, a) => { w.bal = cents(w.bal - a); w.wagered = cents(w.wagered + a); w.bets++; };
  function settle(p, game, a, mult, extra) {
    const w = wallet(p), pay = cents(a * mult);
    w.bal = cents(w.bal + pay); w.won = cents(w.won + pay);
    if (pay > a && mult > w.best) w.best = mult;
    w.hist.unshift({ g: game, a, m: mult, p: cents(pay - a), ts: Date.now(), ...(extra || {}) });
    w.hist.length = Math.min(w.hist.length, HIST_MAX);
    saveProfiles();
    return pay;
  }
  const ok = (res, p, more) => send(res, 200, { ...more, wallet: view(wallet(p)) });

  route('GET', '/api/cassino', async (req, res, ctx) => {
    const top = Object.values(db.profiles).filter(p => p.ratings && p.ratings.casino && !p.banned)
      .map(p => ({ id: p.id, name: p.name, color: p.color, bal: p.ratings.casino.bal, best: p.ratings.casino.best }))
      .sort((a, b) => b.bal - a.bal).slice(0, 10);
    ok(res, ctx.me, { top, plinko: PLINKO });
  });
  route('POST', '/api/cassino/bonus', async (req, res, ctx) => {
    const w = wallet(ctx.me);
    if (w.bal >= BONUS_BELOW) return send(res, 409, { error: `O bônus é para quem tem menos de F$ ${BONUS_BELOW}.` });
    if (Date.now() < w.bonusAt + BONUS_MS) return send(res, 409, { error: 'Espere um pouco para pegar o bônus de novo.' });
    w.bal = cents(w.bal + BONUS); w.bonusAt = Date.now();
    saveProfiles();
    ok(res, ctx.me);
  });

  /* ---------- Jogos de uma rodada só ---------- */
  route('POST', '/api/cassino/dice', async (req, res, ctx) => {
    const w = wallet(ctx.me), b = ctx.body, A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    const target = Math.round(Number(b.target) * 100) / 100, over = !!b.over;
    if (!(target >= 2 && target <= 98)) return send(res, 400, { error: 'Escolha um alvo entre 2 e 98.' });
    const chance = over ? 100 - target : target, mult = Math.floor((99 / chance) * 10000) / 10000;
    take(w, A.a);
    const roll = Math.floor(rand() * 10000) / 100, win = over ? roll > target : roll < target;
    settle(ctx.me, 'dice', A.a, win ? mult : 0, { r: roll.toFixed(2) });
    ok(res, ctx.me, { roll, win, mult });
  });
  route('POST', '/api/cassino/limbo', async (req, res, ctx) => {
    const w = wallet(ctx.me), b = ctx.body, A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    const target = Math.floor(Number(b.target) * 100) / 100;
    if (!(target >= 1.01 && target <= 1000)) return send(res, 400, { error: 'O alvo vai de 1,01× a 1000×.' });
    take(w, A.a);
    const result = crashPoint(), win = result >= target;
    settle(ctx.me, 'limbo', A.a, win ? target : 0, { r: result.toFixed(2) + '×' });
    ok(res, ctx.me, { result, win });
  });
  route('POST', '/api/cassino/double', async (req, res, ctx) => {
    const w = wallet(ctx.me), b = ctx.body, A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    if (!DOUBLE_PAY[b.color]) return send(res, 400, { error: 'Escolha vermelho, preto ou branco.' });
    take(w, A.a);
    const n = crypto.randomInt(15), color = DOUBLE_COLOR(n), win = color === b.color;
    settle(ctx.me, 'double', A.a, win ? DOUBLE_PAY[color] : 0, { r: { white: 'branco', red: 'vermelho', black: 'preto' }[color] });
    ok(res, ctx.me, { n, color, win });
  });
  route('POST', '/api/cassino/plinko', async (req, res, ctx) => {
    const w = wallet(ctx.me), b = ctx.body, A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    const table = PLINKO[b.rows] && PLINKO[b.rows][b.risk];
    if (!table) return send(res, 400, { error: 'Configuração inválida.' });
    take(w, A.a);
    const path = Array.from({ length: Number(b.rows) }, () => crypto.randomInt(2));
    const slot = path.reduce((s, x) => s + x, 0), mult = table[slot];
    settle(ctx.me, 'plinko', A.a, mult, { r: mult + '×' });
    ok(res, ctx.me, { path, slot, mult });
  });

  /* ---------- Mines ---------- */
  function minesView(g) {
    return { bet: g.bet, count: g.count, revealed: g.revealed, over: g.over, mult: minesMult(g.count, g.revealed.length),
      next: g.revealed.length < 25 - g.count ? minesMult(g.count, g.revealed.length + 1) : null, mines: g.over ? g.mines : null, hit: g.hit ?? null };
  }
  route('POST', '/api/cassino/mines/start', async (req, res, ctx) => {
    const w = wallet(ctx.me), b = ctx.body;
    if (w.mines && !w.mines.over) return send(res, 409, { error: 'Termine a partida de Mines em andamento.' });
    const A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    const count = Number(b.mines);
    if (!(Number.isInteger(count) && count >= 1 && count <= 24)) return send(res, 400, { error: 'Escolha de 1 a 24 minas.' });
    const cells = [...Array(25).keys()];
    for (let i = 24; i > 0; i--) { const j = crypto.randomInt(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
    take(w, A.a);
    w.mines = { bet: A.a, count, mines: cells.slice(0, count).sort((x, y) => x - y), revealed: [], over: false };
    saveProfiles();
    ok(res, ctx.me, { game: minesView(w.mines) });
  });
  route('POST', '/api/cassino/mines/reveal', async (req, res, ctx) => {
    const w = wallet(ctx.me), g = w.mines, i = Number(ctx.body.cell);
    if (!g || g.over) return send(res, 409, { error: 'Nenhuma partida de Mines em andamento.' });
    if (!(Number.isInteger(i) && i >= 0 && i < 25) || g.revealed.includes(i)) return send(res, 400, { error: 'Casa inválida.' });
    if (g.mines.includes(i)) {
      g.over = true; g.hit = i;
      settle(ctx.me, 'mines', g.bet, 0, { r: `💣 ${g.count} minas` });
      return ok(res, ctx.me, { game: minesView(g), boom: true });
    }
    g.revealed.push(i);
    if (g.revealed.length === 25 - g.count) {          // abriu tudo: recebe automaticamente
      g.over = true;
      const m = minesMult(g.count, g.revealed.length);
      settle(ctx.me, 'mines', g.bet, m, { r: `${g.revealed.length} 💎` });
      return ok(res, ctx.me, { game: minesView(g), cashed: m });
    }
    saveProfiles();
    ok(res, ctx.me, { game: minesView(g) });
  });
  route('POST', '/api/cassino/mines/cashout', async (req, res, ctx) => {
    const w = wallet(ctx.me), g = w.mines;
    if (!g || g.over) return send(res, 409, { error: 'Nenhuma partida de Mines em andamento.' });
    if (!g.revealed.length) return send(res, 409, { error: 'Abra pelo menos uma casa antes de retirar.' });
    g.over = true;
    const m = minesMult(g.count, g.revealed.length);
    settle(ctx.me, 'mines', g.bet, m, { r: `${g.revealed.length} 💎` });
    ok(res, ctx.me, { game: minesView(g), cashed: m });
  });

  /* ---------- Crash (rodada compartilhada, ao vivo) ---------- */
  const C = { round: 0, phase: 'bet', betEnds: Date.now() + BET_MS, start: 0, point: 0, endedAt: 0, bets: new Map(), hist: [] };
  const KEY = 'cassino:crash';
  function crashPublic() {
    return {
      round: C.round, phase: C.phase, betEnds: C.betEnds, start: C.start, point: C.phase === 'crashed' ? C.point : null, rate: CRASH_RATE,
      hist: C.hist, serverTime: Date.now(),
      bets: [...C.bets.values()].map(b => ({ id: b.pid, name: b.name, color: b.color, amount: b.amount, auto: b.auto, cashed: b.cashed }))
        .sort((a, b) => b.amount - a.amount)
    };
  }
  function crashBroadcast() {
    const set = listeners[KEY];
    if (!set || !set.size) return;
    const msg = `data: ${JSON.stringify(crashPublic())}\n\n`;
    for (const l of set) l.res.write(msg);
  }
  function crashCashout(b, m) {
    b.cashed = m;
    const p = db.profiles[b.pid];
    if (p) settle(p, 'crash', b.amount, m, { r: m.toFixed(2) + '×' });
  }
  setInterval(() => { try { crashTick(); } catch (e) { console.error(e); } }, 50);
  function crashTick() {
    const now = Date.now();
    if (C.phase === 'bet' && now >= C.betEnds) {
      C.phase = 'run'; C.start = now; C.point = crashPoint();
      crashBroadcast();
    } else if (C.phase === 'run') {
      const m = crashAt(now - C.start);
      let changed = false;
      // Retirada automática (mesmo que o tick tenha passado do ponto, vale o alvo se ele veio antes da explosão)
      for (const b of C.bets.values()) if (b.cashed === null && b.auto && b.auto <= m && b.auto < C.point) { crashCashout(b, b.auto); changed = true; }
      if (m >= C.point) {
        C.phase = 'crashed'; C.endedAt = now;
        for (const b of C.bets.values()) if (b.cashed === null) {
          const p = db.profiles[b.pid];
          if (p) settle(p, 'crash', b.amount, 0, { r: `💥 ${C.point.toFixed(2)}×` });
        }
        C.hist.unshift(C.point); C.hist.length = Math.min(C.hist.length, 24);
        changed = true;
      }
      if (changed) crashBroadcast();
    } else if (C.phase === 'crashed' && now >= C.endedAt + AFTER_MS) {
      C.phase = 'bet'; C.round++; C.betEnds = now + BET_MS; C.bets = new Map();
      crashBroadcast();
    }
  }

  route('GET', '/api/cassino/crash/events', async (req, res, ctx) => {
    if (!streamAllowed(res, ctx)) return;
    req.socket.setTimeout(0);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    const l = { res, pid: ctx.me.id, ip: ctx.ip };
    (listeners[KEY] = listeners[KEY] || new Set()).add(l);
    res.write(`data: ${JSON.stringify(crashPublic())}\n\n`);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); listeners[KEY] && listeners[KEY].delete(l); });
  });
  route('POST', '/api/cassino/crash/bet', async (req, res, ctx) => {
    const p = ctx.me, w = wallet(p), b = ctx.body;
    if (C.phase !== 'bet') return send(res, 409, { error: 'Espere a próxima rodada para apostar.' });
    if (C.bets.has(p.id)) return send(res, 409, { error: 'Você já apostou nesta rodada.' });
    const A = amountOf(w, b.amount);
    if (A.error) return send(res, 400, A);
    let auto = b.auto ? Math.floor(Number(b.auto) * 100) / 100 : null;
    if (auto !== null && !(auto >= 1.01 && auto <= 1000)) return send(res, 400, { error: 'Retirada automática: de 1,01× a 1000×.' });
    take(w, A.a);
    saveProfiles();
    C.bets.set(p.id, { pid: p.id, name: p.name, color: p.color, amount: A.a, auto, cashed: null });
    crashBroadcast();
    ok(res, p);
  });
  route('POST', '/api/cassino/crash/cancel', async (req, res, ctx) => {
    const p = ctx.me, b = C.bets.get(p.id);
    if (C.phase !== 'bet' || !b) return send(res, 409, { error: 'Não dá para cancelar agora.' });
    const w = wallet(p);
    w.bal = cents(w.bal + b.amount); w.wagered = cents(w.wagered - b.amount); w.bets--;
    C.bets.delete(p.id);
    saveProfiles();
    crashBroadcast();
    ok(res, p);
  });
  route('POST', '/api/cassino/crash/cashout', async (req, res, ctx) => {
    const p = ctx.me, b = C.bets.get(p.id);
    if (C.phase !== 'run' || !b || b.cashed !== null) return send(res, 409, { error: 'Não há aposta para retirar.' });
    const m = crashAt(Date.now() - C.start);
    if (m >= C.point) return send(res, 409, { error: 'Tarde demais: explodiu!' });
    crashCashout(b, m);
    crashBroadcast();
    ok(res, p, { cashed: m });
  });
}

module.exports = { install, PLINKO, minesMult };

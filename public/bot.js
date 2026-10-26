// Bot de xadrez e damas (Web Worker). Busca alfa-beta com aprofundamento iterativo.
// Mensagem de entrada: { game, moves, level }  ->  saída: { move } (no formato strip da engine)
importScripts('chess.js', 'checkers.js');

// Níveis: profundidade máxima, tempo (ms) e ruído na avaliação (centipeões)
const LEVELS = {
  1: { depth: 1, time: 300, noise: 260 },
  2: { depth: 2, time: 500, noise: 120 },
  3: { depth: 3, time: 800, noise: 50 },
  4: { depth: 4, time: 1500, noise: 15 },
  5: { depth: 6, time: 2500, noise: 0 },
  6: { depth: 10, time: 4500, noise: 0 }
};

let deadline = 0, nodes = 0, stop = false;
const timeUp = () => ((++nodes & 1023) === 0 && Date.now() > deadline ? (stop = true) : stop);

/* ===================== XADREZ ===================== */
const VAL = { p: 100, n: 320, b: 335, r: 500, q: 910, k: 0 };
// Tabelas de posição (do ponto de vista das brancas, índice 0 = a8)
const PST = {
  p: [0,0,0,0,0,0,0,0, 60,60,60,60,60,60,60,60, 15,15,25,35,35,25,15,15, 6,6,12,28,28,12,6,6, 2,2,6,22,22,6,2,2, 4,-2,-6,4,4,-6,-2,4, 4,8,8,-18,-18,8,8,4, 0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,5,5,0,-20,-40, -30,5,12,16,16,12,5,-30, -30,0,16,22,22,16,0,-30, -30,5,16,22,22,16,5,-30, -30,0,12,16,16,12,0,-30, -40,-20,0,0,0,0,-20,-40, -50,-35,-30,-30,-30,-30,-35,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,6,10,10,6,0,-10, -10,6,6,10,10,6,6,-10, -10,0,12,10,10,12,0,-10, -10,10,10,10,10,10,10,-10, -10,8,0,0,0,0,8,-10, -20,-10,-12,-10,-10,-12,-10,-20],
  r: [0,0,0,0,0,0,0,0, 8,12,12,12,12,12,12,8, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,3,8,8,5,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 15,15,-5,-5,-5,-5,15,15, 20,30,10,0,0,10,30,20],
  ke: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50]
};

function evalChess(s) {
  let score = 0, mat = 0;
  for (const p of s.b) if (p && p[1] !== 'k' && p[1] !== 'p') mat += VAL[p[1]];
  const endgame = mat <= 2600;
  for (let i = 0; i < 64; i++) {
    const p = s.b[i]; if (!p) continue;
    const t = p[1], w = p[0] === 'w', sq = w ? i : (7 - (i >> 3)) * 8 + (i & 7);
    const tab = t === 'k' ? (endgame ? PST.ke : PST.k) : PST[t];
    const v = VAL[t] + tab[sq];
    score += w ? v : -v;
  }
  return s.turn === 'w' ? score : -score;
}

function orderChess(s, moves) {
  for (const m of moves) {
    const victim = m.ep ? 'p' : s.b[m.to] && s.b[m.to][1];
    m._o = (victim ? 10 * VAL[victim] - VAL[s.b[m.from][1]] + 10000 : 0) + (m.promo === 'q' ? 9000 : 0);
  }
  return moves.sort((a, b) => b._o - a._o);
}

function quiesce(E, s, alpha, beta, depth) {
  const stand = evalChess(s);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth <= 0 || timeUp()) return alpha;
  const caps = orderChess(s, E.legal(s).filter(m => s.b[m.to] || m.ep || m.promo));
  for (const m of caps) {
    const v = -quiesce(E, E.apply(s, m), -beta, -alpha, depth - 1);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

/* ===================== DAMAS ===================== */
function evalCheckers(s) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = s.b[i]; if (!p) continue;
    const r = i >> 3, c = i & 7, w = p[0] === 'w';
    let v;
    if (p[1] === 'd') v = 320 + (c > 0 && c < 7 && r > 0 && r < 7 ? 10 : 0);
    else {
      const adv = w ? 7 - r : r;              // quanto a pedra avançou
      v = 100 + adv * 4 + (adv >= 5 ? 10 : 0);
      if ((w && r === 7) || (!w && r === 0)) v += 12; // guarda da última fileira
      if (c >= 2 && c <= 5 && r >= 2 && r <= 5) v += 6;  // centro
      if (c === 0 || c === 7) v -= 4;
    }
    score += w ? v : -v;
  }
  return s.turn === 'w' ? score : -score;
}

/* ===================== Busca genérica ===================== */
function search(E, s, depth, alpha, beta, ply, rep) {
  if (timeUp()) return 0;
  const L = E.legal(s);
  if (!L.length) {
    if (E.game === 'chess') return E.inCheck(s, s.turn) ? -100000 + ply : 0;
    return -100000 + ply;
  }
  if (E.game === 'chess' && s.half >= 100) return 0;
  if (E.game === 'checkers' && s.half >= 40) return 0;
  const key = E.posKey(s, L);
  if (ply > 0 && rep.includes(key)) return 0;
  if (depth <= 0) {
    if (E.game === 'chess') return quiesce(E, s, alpha, beta, 6);
    // Damas: continua enquanto houver captura obrigatória
    if (L[0].caps.length && ply < 30) depth = 1;
    else return evalCheckers(s);
  }
  const moves = E.game === 'chess' ? orderChess(s, L) : L.sort((a, b) => b.caps.length - a.caps.length || (b.promo ? 1 : 0) - (a.promo ? 1 : 0));
  rep.push(key);
  let best = -Infinity;
  for (const m of moves) {
    const v = -search(E, E.apply(s, m), depth - 1, -beta, -alpha, ply + 1, rep);
    if (stop) break;
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  rep.pop();
  return best;
}

function think(E, moves, level, maxTime) {
  const cfg = { ...(LEVELS[level] || LEVELS[3]) };
  if (maxTime) cfg.time = Math.max(80, Math.min(cfg.time, maxTime));
  const hist = E.play(moves);
  const cur = hist[hist.length - 1], s = cur.s;
  const rep = hist.slice(0, -1).map(h => h.key);
  let L = cur.legal.slice();
  if (L.length === 1) return L[0];
  deadline = Date.now() + cfg.time; nodes = 0; stop = false;

  // Pontuação de cada lance na raiz, refinada a cada profundidade
  let scored = L.map(m => ({ m, v: 0 }));
  const margin = cfg.noise * 2;
  for (let d = 1; d <= cfg.depth; d++) {
    const next = [];
    let alpha = -Infinity;
    for (const it of scored) {
      // Janela alargada pelo ruído: lances perto do melhor recebem nota exata
      const floor = alpha - margin;
      let v = -search(E, E.apply(s, it.m), d - 1, -Infinity, -floor, 1, rep.slice());
      if (stop) break;
      if (v <= floor) v = floor - 1; // só sabemos que é pior que o limite
      next.push({ m: it.m, v });
      if (v > alpha) alpha = v;
    }
    if (stop && next.length < scored.length) {
      // Profundidade incompleta: aproveita só se achou algo melhor que o melhor anterior
      if (next.length && next[0].m === scored[0].m) scored[0].v = next[0].v;
      break;
    }
    scored = next.sort((a, b) => b.v - a.v);
    if (Math.abs(scored[0].v) > 90000) break; // mate/vitória encontrada
  }

  // Ruído: níveis baixos às vezes escolhem lances piores
  if (cfg.noise) {
    const noisy = scored.map(x => ({ m: x.m, v: x.v + (Math.random() * 2 - 1) * cfg.noise }));
    noisy.sort((a, b) => b.v - a.v);
    return noisy[0].m;
  }
  return scored[0].m;
}

// Análise para a revisão: avaliação da posição (do ponto de vista de quem joga) e o melhor lance, sem ruído
function analyse(E, moves, maxTime) {
  const hist = E.play(moves), cur = hist[hist.length - 1], s = cur.s, L = cur.legal;
  if (!L.length) return { v: E.game === 'chess' && !E.inCheck(s, s.turn) ? 0 : -100000, best: null };
  const rep = hist.slice(0, -1).map(h => h.key);
  let scored = L.map(m => ({ m, v: 0 }));
  nodes = 0; stop = false;
  for (let d = 1; d <= 12; d++) {
    deadline = d === 1 ? Infinity : Date.now() + Math.max(0, maxTime - (Date.now() - analyse.t0));
    const next = [];
    let alpha = -Infinity;
    for (const it of scored) {
      let v = -search(E, E.apply(s, it.m), d - 1, -Infinity, -alpha, 1, rep.slice());
      if (stop) break;
      if (v <= alpha) v = alpha - 1;
      next.push({ m: it.m, v });
      if (v > alpha) alpha = v;
    }
    if (stop) break;
    scored = next.sort((a, b) => b.v - a.v);
    if (Math.abs(scored[0].v) > 90000) break;
  }
  return { v: scored[0].v, best: scored[0].m };
}

onmessage = e => {
  const { game, moves, level, id, maxTime } = e.data;
  const E = game === 'checkers' ? Checkers : Chess;
  if (e.data.type === 'eval') {
    analyse.t0 = Date.now();
    const r = analyse(E, moves, maxTime || 400);
    return postMessage({ id, v: r.v, best: r.best ? E.strip(r.best) : null });
  }
  const started = Date.now();
  const m = think(E, moves, level, maxTime);
  // Pequena pausa mínima para parecer natural
  const wait = Math.max(0, 350 - (Date.now() - started));
  setTimeout(() => postMessage({ id, move: E.strip(m) }), wait);
};

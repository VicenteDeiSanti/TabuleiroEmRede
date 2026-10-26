// Motor de damas brasileiras (8x8, regras da CBD), compartilhado entre servidor e navegador.
// Peças: 'wm'/'bm' = pedra, 'wd'/'bd' = dama. Índice 0 = a8, 63 = h1 (mesmo do xadrez).
// Regras: brancas começam; pedra anda 1 casa para frente e captura para frente e para trás;
// captura obrigatória; lei da maioria (deve capturar o maior número de peças);
// dama anda e captura à distância; peças capturadas só saem no fim do lance
// (não se pode saltar a mesma peça duas vezes); pedra só é promovida se terminar o lance na última fileira.
(function (root) {
  const FILES = 'abcdefgh';
  const R = i => i >> 3, C = i => i & 7, idx = (r, c) => r * 8 + c;
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sqName = i => FILES[C(i)] + (8 - R(i));
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const dark = i => (R(i) + C(i)) % 2 === 1;

  function initial() {
    const b = Array(64).fill(null);
    for (let i = 0; i < 64; i++) {
      if (!dark(i)) continue;
      if (R(i) <= 2) b[i] = 'bm';
      else if (R(i) >= 5) b[i] = 'wm';
    }
    return { b, turn: 'w', half: 0, endc: 0, full: 1 };
  }

  // Sequências de captura a partir de `from` (DFS). Retorna lista de {path, caps}.
  function captures(b, from, piece) {
    const me = piece[0], king = piece[1] === 'd';
    const out = [];
    const dfs = (sq, path, caps) => {
      let found = false;
      const r = R(sq), c = C(sq);
      for (const [dr, dc] of DIAG) {
        if (king) {
          let rr = r + dr, cc = c + dc;
          while (on(rr, cc) && (b[idx(rr, cc)] === null || idx(rr, cc) === from)) { rr += dr; cc += dc; }
          if (!on(rr, cc)) continue;
          const mid = idx(rr, cc), p = b[mid];
          if (!p || p[0] === me || caps.includes(mid)) continue;
          rr += dr; cc += dc;
          while (on(rr, cc) && (b[idx(rr, cc)] === null || idx(rr, cc) === from)) {
            const land = idx(rr, cc);
            found = true;
            dfs(land, path.concat(land), caps.concat(mid));
            rr += dr; cc += dc;
          }
        } else {
          const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
          if (!on(r2, c2)) continue;
          const mid = idx(r1, c1), land = idx(r2, c2), p = b[mid];
          if (!p || p[0] === me || caps.includes(mid)) continue;
          if (b[land] !== null && land !== from) continue;
          found = true;
          dfs(land, path.concat(land), caps.concat(mid));
        }
      }
      if (!found && caps.length) out.push({ path, caps });
    };
    dfs(from, [], []);
    return out;
  }

  function legal(s) {
    const b = s.b, me = s.turn;
    let caps = [], simple = [];
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p[0] !== me) continue;
      for (const seq of captures(b, i, p)) caps.push({ from: i, to: seq.path[seq.path.length - 1], path: seq.path, caps: seq.caps });
    }
    if (caps.length) {
      const max = Math.max(...caps.map(m => m.caps.length));
      const seen = new Set(), out = [];
      for (const m of caps) {
        if (m.caps.length !== max) continue;
        const key = m.from + ':' + m.to + ':' + m.caps.slice().sort((a, b) => a - b).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(m);
      }
      return out.map(m => withPromo(b, m));
    }
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || p[0] !== me) continue;
      const r = R(i), c = C(i);
      if (p[1] === 'd') {
        for (const [dr, dc] of DIAG) {
          let rr = r + dr, cc = c + dc;
          while (on(rr, cc) && b[idx(rr, cc)] === null) {
            simple.push({ from: i, to: idx(rr, cc), path: [idx(rr, cc)], caps: [] });
            rr += dr; cc += dc;
          }
        }
      } else {
        const dr = me === 'w' ? -1 : 1;
        for (const dc of [-1, 1]) {
          const rr = r + dr, cc = c + dc;
          if (on(rr, cc) && b[idx(rr, cc)] === null) simple.push({ from: i, to: idx(rr, cc), path: [idx(rr, cc)], caps: [] });
        }
      }
    }
    return simple.map(m => withPromo(b, m));
  }

  function withPromo(b, m) {
    const p = b[m.from];
    m.promo = p[1] === 'm' && R(m.to) === (p[0] === 'w' ? 0 : 7);
    return m;
  }

  function countPieces(b) {
    const n = { wm: 0, wd: 0, bm: 0, bd: 0 };
    for (const p of b) if (p) n[p]++;
    return n;
  }

  // Limite de lances em finais de "dama sozinha contra poucas peças com dama" (regra da CBD).
  function endgameLimit(b) {
    const n = countPieces(b);
    for (const [a, o] of [['w', 'b'], ['b', 'w']]) {
      if (n[a + 'd'] === 1 && n[a + 'm'] === 0) {
        const other = n[o + 'm'] + n[o + 'd'];
        if (n[o + 'd'] >= 1 && other >= 2 && other <= 3) return other === 2 ? 5 : 12; // lances de cada lado
      }
    }
    return 0;
  }

  function apply(s, m) {
    const b = s.b.slice(), p = b[m.from];
    for (const c of m.caps) b[c] = null;
    b[m.from] = null;
    b[m.to] = m.promo ? p[0] + 'd' : p;
    const reset = m.caps.length > 0 || p[1] === 'm';
    const lim = endgameLimit(b);
    return {
      b, turn: s.turn === 'w' ? 'b' : 'w',
      half: reset ? 0 : s.half + 1,
      endc: lim ? (s.endc && !m.caps.length ? s.endc + 1 : 1) : 0,
      endLim: lim,
      full: s.full + (s.turn === 'b' ? 1 : 0)
    };
  }

  const posKey = s => s.b.map(x => x || '..').join('') + s.turn;

  function toSan(s, m) {
    if (!m.caps.length) return sqName(m.from) + '-' + sqName(m.to);
    return [m.from].concat(m.path).map(sqName).join('x');
  }

  const match = (m, mv) => m.from === mv.from && Array.isArray(mv.path) && m.path.length === mv.path.length && m.path.every((x, i) => x === mv.path[i]);
  const strip = m => ({ from: m.from, path: m.path.slice() });

  function play(moves) {
    const s0 = initial(), L0 = legal(s0);
    const hist = [{ s: s0, legal: L0, key: posKey(s0), san: null, move: null }];
    for (const mv of moves || []) {
      const c = hist[hist.length - 1];
      const m = c.legal.find(x => match(x, mv));
      if (!m) break;
      const san = toSan(c.s, m);
      const s = apply(c.s, m), L = legal(s);
      hist.push({ s, legal: L, key: posKey(s), san, move: m });
    }
    return hist;
  }

  function status(hist, end) {
    const { s, legal: L, key } = hist[hist.length - 1];
    const other = s.turn === 'w' ? 'b' : 'w';
    if (end) return { over: true, winner: end.winner, reason: end.reason };
    if (!L.length) {
      const n = countPieces(s.b);
      return { over: true, winner: other, reason: n[s.turn + 'm'] + n[s.turn + 'd'] ? 'blocked' : 'nopieces' };
    }
    if (s.half >= 40) return { over: true, winner: null, reason: 'twenty' };
    if (s.endLim && s.endc >= s.endLim * 2) return { over: true, winner: null, reason: 'endgame' };
    if (hist.filter(h => h.key === key).length >= 3) return { over: true, winner: null, reason: 'repetition' };
    return { over: false, check: false };
  }

  // Em damas, qualquer peça restante pode, em tese, vencer.
  const cannotWin = (b, color) => !b.some(p => p && p[0] === color);

  const api = { game: 'checkers', FILES, R, C, sqName, initial, legal, apply, play, status, toSan, match, strip, cannotWin, countPieces, posKey, captures };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Checkers = api;
})(typeof window !== 'undefined' ? window : globalThis);

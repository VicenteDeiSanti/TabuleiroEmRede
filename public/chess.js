// Motor de xadrez compartilhado entre servidor (Node) e navegador.
(function (root) {
  const FILES = 'abcdefgh';
  const R = i => i >> 3, C = i => i & 7, idx = (r, c) => r * 8 + c;
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const sqName = i => FILES[C(i)] + (8 - R(i));
  const DIRS = {
    n: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]],
    k: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]],
    b: [[-1,-1],[-1,1],[1,-1],[1,1]],
    r: [[-1,0],[1,0],[0,-1],[0,1]]
  };
  DIRS.q = DIRS.b.concat(DIRS.r);

  function initial() {
    const b = Array(64).fill(null), back = 'rnbqkbnr';
    for (let c = 0; c < 8; c++) {
      b[c] = 'b' + back[c]; b[8 + c] = 'bp';
      b[48 + c] = 'wp'; b[56 + c] = 'w' + back[c];
    }
    return { b, turn: 'w', cr: { wK: 1, wQ: 1, bK: 1, bQ: 1 }, ep: -1, half: 0, full: 1 };
  }

  function attacked(b, sq, by) {
    const r = R(sq), c = C(sq);
    const pr = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) if (on(pr, c + dc) && b[idx(pr, c + dc)] === by + 'p') return true;
    for (const [dr, dc] of DIRS.n) { const rr = r + dr, cc = c + dc; if (on(rr, cc) && b[idx(rr, cc)] === by + 'n') return true; }
    for (const [dr, dc] of DIRS.k) { const rr = r + dr, cc = c + dc; if (on(rr, cc) && b[idx(rr, cc)] === by + 'k') return true; }
    for (const [t, dirs] of [['b', DIRS.b], ['r', DIRS.r]]) {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const p = b[idx(rr, cc)];
          if (p) { if (p === by + t || p === by + 'q') return true; break; }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }
  const kingSq = (b, color) => b.indexOf(color + 'k');
  const inCheck = (s, color) => attacked(s.b, kingSq(s.b, color), color === 'w' ? 'b' : 'w');

  function pseudo(s, from) {
    const b = s.b, p = b[from], me = p[0], op = me === 'w' ? 'b' : 'w', t = p[1];
    const r = R(from), c = C(from), out = [];
    const add = (to, extra) => out.push(Object.assign({ from, to }, extra));
    if (t === 'p') {
      const d = me === 'w' ? -1 : 1, start = me === 'w' ? 6 : 1, last = me === 'w' ? 0 : 7, r1 = r + d;
      const push = (to, extra = {}) => {
        if (R(to) === last) for (const pr of 'qrbn') add(to, { ...extra, promo: pr });
        else add(to, extra);
      };
      if (on(r1, c) && !b[idx(r1, c)]) {
        push(idx(r1, c));
        if (r === start && !b[idx(r + 2 * d, c)]) add(idx(r + 2 * d, c), { dbl: true });
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc; if (!on(r1, cc)) continue;
        const to = idx(r1, cc);
        if (b[to] && b[to][0] === op) push(to);
        else if (to === s.ep) add(to, { ep: true });
      }
    } else if (t === 'n' || t === 'k') {
      for (const [dr, dc] of DIRS[t]) {
        const rr = r + dr, cc = c + dc; if (!on(rr, cc)) continue;
        const to = idx(rr, cc);
        if (!b[to] || b[to][0] === op) add(to);
      }
      if (t === 'k') {
        const home = me === 'w' ? 60 : 4;
        if (from === home && !attacked(b, home, op)) {
          if (s.cr[me + 'K'] && !b[home + 1] && !b[home + 2] && b[home + 3] === me + 'r'
              && !attacked(b, home + 1, op) && !attacked(b, home + 2, op)) add(home + 2, { castle: 'K' });
          if (s.cr[me + 'Q'] && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === me + 'r'
              && !attacked(b, home - 1, op) && !attacked(b, home - 2, op)) add(home - 2, { castle: 'Q' });
        }
      }
    } else {
      for (const [dr, dc] of DIRS[t]) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const to = idx(rr, cc);
          if (!b[to]) add(to);
          else { if (b[to][0] === op) add(to); break; }
          rr += dr; cc += dc;
        }
      }
    }
    return out;
  }

  function apply(s, m) {
    const b = s.b.slice(), p = b[m.from], me = p[0], cr = { ...s.cr };
    let cap = b[m.to];
    if (m.ep) { const capSq = m.to + (me === 'w' ? 8 : -8); cap = b[capSq]; b[capSq] = null; }
    b[m.to] = m.promo ? me + m.promo : p;
    b[m.from] = null;
    if (m.castle) {
      const home = me === 'w' ? 60 : 4;
      if (m.castle === 'K') { b[home + 1] = b[home + 3]; b[home + 3] = null; }
      else { b[home - 1] = b[home - 4]; b[home - 4] = null; }
    }
    if (p[1] === 'k') { cr[me + 'K'] = 0; cr[me + 'Q'] = 0; }
    for (const sq of [m.from, m.to]) {
      if (sq === 63) cr.wK = 0; if (sq === 56) cr.wQ = 0;
      if (sq === 7) cr.bK = 0; if (sq === 0) cr.bQ = 0;
    }
    return {
      b, turn: me === 'w' ? 'b' : 'w', cr,
      ep: m.dbl ? (m.from + m.to) / 2 : -1,
      half: (p[1] === 'p' || cap) ? 0 : s.half + 1,
      full: s.full + (me === 'b' ? 1 : 0)
    };
  }

  function legal(s) {
    const all = [];
    for (let i = 0; i < 64; i++) {
      const p = s.b[i];
      if (!p || p[0] !== s.turn) continue;
      for (const m of pseudo(s, i)) if (!inCheck(apply(s, m), s.turn)) all.push(m);
    }
    return all;
  }

  function posKey(s, L) {
    const epOk = s.ep >= 0 && L.some(m => m.ep);
    return s.b.map(x => x || '..').join('') + s.turn + s.cr.wK + s.cr.wQ + s.cr.bK + s.cr.bQ + (epOk ? s.ep : '-');
  }

  function insufficient(b) {
    const pcs = [];
    b.forEach((p, i) => { if (p && p[1] !== 'k') pcs.push([p, i]); });
    if (!pcs.length) return true;
    if (pcs.length === 1 && 'bn'.includes(pcs[0][0][1])) return true;
    if (pcs.every(([p]) => p[1] === 'b')) {
      const col = pcs.map(([, i]) => (R(i) + C(i)) % 2);
      return col.every(x => x === col[0]);
    }
    return false;
  }

  function toSan(s, m, L) {
    L = L || legal(s);
    const p = s.b[m.from], t = p[1];
    let str;
    if (m.castle) str = m.castle === 'K' ? 'O-O' : 'O-O-O';
    else {
      const capture = !!s.b[m.to] || m.ep;
      if (t === 'p') {
        str = (capture ? FILES[C(m.from)] + 'x' : '') + sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
      } else {
        str = t.toUpperCase();
        const others = L.filter(o => o.to === m.to && o.from !== m.from && s.b[o.from] === p);
        if (others.length) {
          const sameFile = others.some(o => C(o.from) === C(m.from));
          const sameRank = others.some(o => R(o.from) === R(m.from));
          if (!sameFile) str += FILES[C(m.from)];
          else if (!sameRank) str += 8 - R(m.from);
          else str += sqName(m.from);
        }
        str += (capture ? 'x' : '') + sqName(m.to);
      }
    }
    const n = apply(s, m);
    if (inCheck(n, n.turn)) str += legal(n).length ? '+' : '#';
    return str;
  }

  // Reproduz uma lista de lances {from,to,promo}. Para no primeiro lance ilegal.
  function play(moves, start) {
    const s0 = start || initial(), L0 = legal(s0);
    const hist = [{ s: s0, legal: L0, key: posKey(s0, L0), san: null, move: null }];
    for (const mv of moves || []) {
      const c = hist[hist.length - 1];
      const m = c.legal.find(x => match(x, mv));
      if (!m) break;
      const san = toSan(c.s, m, c.legal);
      const s = apply(c.s, m), L = legal(s);
      hist.push({ s, legal: L, key: posKey(s, L), san, move: m });
    }
    return hist;
  }

  // Só rei, ou rei + uma peça menor: não consegue dar mate.
  function cannotMate(b, color) {
    const pcs = b.filter(p => p && p[0] === color && p[1] !== 'k');
    return !pcs.length || (pcs.length === 1 && 'bn'.includes(pcs[0][1]));
  }

  // Resultado da partida. end = fim decidido fora do tabuleiro ({winner, reason}) ou null.
  function status(hist, end) {
    const { s, legal: L, key } = hist[hist.length - 1];
    const chk = inCheck(s, s.turn), other = s.turn === 'w' ? 'b' : 'w';
    if (end) return { over: true, winner: end.winner, reason: end.reason, check: chk };
    if (!L.length) return chk ? { over: true, winner: other, reason: 'mate', check: true } : { over: true, winner: null, reason: 'stalemate' };
    if (s.half >= 100) return { over: true, winner: null, reason: 'fifty' };
    if (hist.filter(h => h.key === key).length >= 3) return { over: true, winner: null, reason: 'repetition' };
    if (insufficient(s.b)) return { over: true, winner: null, reason: 'material' };
    return { over: false, check: chk };
  }

  const match = (m, mv) => m.from === mv.from && m.to === mv.to && (m.promo || null) === (mv.promo || null);
  const strip = m => ({ from: m.from, to: m.to, promo: m.promo || null });

  // FEN da posição (usado no PGN e pelo bot)
  function fen(s) {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let e = 0;
      for (let c = 0; c < 8; c++) {
        const p = s.b[r * 8 + c];
        if (!p) { e++; continue; }
        if (e) { out += e; e = 0; }
        out += p[0] === 'w' ? p[1].toUpperCase() : p[1];
      }
      if (e) out += e;
      if (r < 7) out += '/';
    }
    const cr = (s.cr.wK ? 'K' : '') + (s.cr.wQ ? 'Q' : '') + (s.cr.bK ? 'k' : '') + (s.cr.bQ ? 'q' : '');
    return `${out} ${s.turn} ${cr || '-'} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half} ${s.full}`;
  }

  // Carrega uma posição FEN
  function fromFen(f) {
    const [pos, turn, cr, ep, half, full] = String(f).trim().split(/\s+/);
    const b = Array(64).fill(null);
    let i = 0;
    for (const ch of pos) {
      if (ch === '/') continue;
      if (/\d/.test(ch)) { i += +ch; continue; }
      b[i++] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toLowerCase();
    }
    const c = cr || '-';
    const epSq = ep && ep !== '-' ? (8 - +ep[1]) * 8 + FILES.indexOf(ep[0]) : -1;
    return { b, turn: turn === 'b' ? 'b' : 'w', cr: { wK: +c.includes('K'), wQ: +c.includes('Q'), bK: +c.includes('k'), bQ: +c.includes('q') }, ep: epSq, half: +half || 0, full: +full || 1 };
  }
  // Encontra o lance legal correspondente a uma notação SAN (ex.: "Nf3", "exd5", "O-O", "e8=Q+")
  const normSan = t => String(t).replace(/[+#!?]/g, '').replace(/0/g, 'O');
  function sanToMove(s, san, L) {
    L = L || legal(s);
    const want = normSan(san);
    return L.find(m => normSan(toSan(s, m, L)) === want) || null;
  }

  const api = { game: 'chess', fromFen, sanToMove, normSan, FILES, R, C, sqName, initial, legal, apply, inCheck, kingSq, toSan, play, status,
    cannotMate, cannotWin: cannotMate, match, strip, fen, pseudo, attacked, posKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chess = api;
})(typeof window !== 'undefined' ? window : globalThis);

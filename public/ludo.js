// Ludo — 2 a 4 jogadores. Regras compartilhadas entre servidor (decide tudo e sorteia o dado) e navegador (só desenha).
// Regras: tire 6 para sair da base; 6 dá outra jogada (três 6 seguidos perdem a vez); cair numa peça
// adversária fora das casas seguras a manda de volta para a base e dá outra jogada; chegar ao centro
// também dá outra jogada; para chegar ao centro é preciso o número exato. Vence quem levar as 4 peças.
(function (root) {
  const TRACK = 52, LAST = 50, FINISH = 56, LOG_MAX = 80;
  // Cores (a escolha de cada jogador). A ordem define o lado do tabuleiro e a casa de saída.
  const PAWNS = [
    { icon: '🔴', name: 'Vermelho', color: '#e03131' }, { icon: '🟢', name: 'Verde', color: '#2f9e44' },
    { icon: '🟡', name: 'Amarelo', color: '#f0b400' }, { icon: '🔵', name: 'Azul', color: '#1c7ed6' }
  ];
  const START = c => c * 13;                       // casa de saída de cada cor no percurso
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
  // r: -1 = base · 0..50 = percurso · 51..55 = reta final da cor · 56 = chegou
  const abs = (c, r) => (START(c) + r) % TRACK;

  const defaultRng = n => Math.floor(Math.random() * n);
  function log(s, text) {
    s.log.push({ t: text, ts: Date.now() });
    if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  }
  // players: [{pid, name, pawn (índice da cor = lado do tabuleiro), ink (cor RGB escolhida, opcional)}]
  function create(players) {
    return {
      players: players.map(p => {
        const c = p.pawn % 4;
        return { pid: p.pid, name: p.name, c, color: p.ink || PAWNS[c].color, icon: PAWNS[c].icon, pieces: [-1, -1, -1, -1], out: false };
      }),
      turn: 0, phase: 'roll', dice: null, sixes: 0, moves: [], winner: null, rollN: 0, roller: null, last: null, log: []
    };
  }
  const active = s => s.players.map((p, i) => (p.out ? -1 : i)).filter(i => i >= 0);
  const done = p => p.pieces.every(r => r === FINISH);

  function legalMoves(s, seat, d) {
    const p = s.players[seat], out = [];
    p.pieces.forEach((r, k) => {
      if (r === FINISH) return;
      if (r === -1) { if (d === 6) out.push({ piece: k, from: -1, to: 0 }); return; }
      if (r + d <= FINISH) out.push({ piece: k, from: r, to: r + d });
    });
    return out;
  }
  function nextTurn(s) {
    const n = s.players.length;
    let t = s.turn;
    do t = (t + 1) % n; while (s.players[t].out);
    s.turn = t; s.phase = 'roll'; s.sixes = 0; s.moves = [];
  }
  function finish(s, winner) {
    s.phase = 'over'; s.winner = winner; s.moves = [];
    log(s, `${s.players[winner].name} venceu a partida! 🏆`);
  }

  function roll(s, seat, rng) {
    const p = s.players[seat], d = rng(6) + 1;
    s.dice = d; s.rollN++; s.roller = seat; s.last = null;
    if (d === 6 && ++s.sixes === 3) {
      log(s, `${p.name} tirou o terceiro 6 seguido e perdeu a vez.`);
      return nextTurn(s);
    }
    const moves = legalMoves(s, seat, d);
    if (!moves.length) {
      log(s, `${p.name} tirou ${d} e não tem jogada.`);
      return d === 6 ? (s.phase = 'roll') : nextTurn(s);
    }
    log(s, `${p.name} tirou ${d}.`);
    s.moves = moves; s.phase = 'move';
    // Só uma jogada possível (ou todas levam a mesma peça para o mesmo lugar): joga sozinho
    if (new Set(moves.map(m => p.pieces[m.piece] + ':' + m.to)).size === 1) move(s, seat, moves[0].piece);
  }
  function move(s, seat, k) {
    const p = s.players[seat], m = s.moves.find(x => x.piece === k);
    if (!m) return { error: 'Essa peça não pode andar.' };
    p.pieces[k] = m.to;
    s.last = { seat, piece: k, from: m.from, to: m.to, captured: [] };
    let again = s.dice === 6;
    if (m.from === -1) log(s, `${p.name} colocou uma peça em jogo.`);
    if (m.to <= LAST) {
      const a = abs(p.c, m.to);
      if (!SAFE.has(a)) s.players.forEach((o, j) => {
        if (j === seat || o.out) return;
        o.pieces.forEach((r, q) => {
          if (r >= 0 && r <= LAST && abs(o.c, r) === a) {
            o.pieces[q] = -1; again = true;
            s.last.captured.push({ seat: j, piece: q, from: r });
            log(s, `${p.name} capturou uma peça de ${o.name}! 💥`);
          }
        });
      });
    } else if (m.to === FINISH) {
      again = true;
      log(s, `${p.name} levou uma peça até o centro! (${p.pieces.filter(r => r === FINISH).length}/4)`);
      if (done(p)) { finish(s, seat); return { ok: true }; }
    }
    s.moves = [];
    if (again) s.phase = 'roll';
    else nextTurn(s);
    return { ok: true };
  }
  // Sai da partida (desistência ou desconexão): as peças somem do tabuleiro
  function bankrupt(s, seat) {
    const p = s.players[seat];
    if (p.out || s.phase === 'over') return;
    p.out = true; p.pieces = [-1, -1, -1, -1];
    log(s, `${p.name} saiu da partida.`);
    const left = active(s);
    if (left.length === 1) return finish(s, left[0]);
    if (s.turn === seat) nextTurn(s);
  }

  function act(s, seat, a, rng = defaultRng) {
    if (s.phase === 'over') return { error: 'A partida terminou.' };
    const p = s.players[seat];
    if (!p || p.out) return { error: 'Você não está mais na partida.' };
    if (a.type === 'bankrupt') { bankrupt(s, seat); return { ok: true }; }
    if (s.turn !== seat) return { error: 'Não é a sua vez.' };
    if (a.type === 'roll') {
      if (s.phase !== 'roll') return { error: 'Escolha uma peça para mover.' };
      roll(s, seat, rng); return { ok: true };
    }
    if (a.type === 'move') {
      if (s.phase !== 'move') return { error: 'Jogue o dado primeiro.' };
      return move(s, seat, Number(a.piece));
    }
    return { error: 'Ação desconhecida.' };
  }

  const api = { PAWNS, TRACK, LAST, FINISH, SAFE, START, abs, create, act, bankrupt, legalMoves, active, log };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ludo = api;
})(typeof window !== 'undefined' ? window : globalThis);

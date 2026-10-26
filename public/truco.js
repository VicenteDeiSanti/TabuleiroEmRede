// Truco Paulista — 2 jogadores (1×1) ou 4 (duplas 2×2). Regras compartilhadas entre servidor e navegador.
// Baralho de 40 cartas (sem 8, 9, 10). A "vira" define a manilha: a carta seguinte na ordem
// 4 5 6 7 Q J K A 2 3 (depois do 3 volta ao 4). Força das manilhas pelo naipe: ♣ zap > ♥ copas > ♠ espadilha > ♦ pica-fumo.
// Mão vale 1; truco 3, seis 6, nove 9, doze 12. Melhor de 3 vazas. Jogo até 12 pontos.
(function (root) {
  const RANKS = '4567QJKA23', SUITS = 'dshc';   // ordem crescente de força (naipe só importa na manilha)
  const SUIT_ICON = { d: '♦', s: '♠', h: '♥', c: '♣' };
  const MAN_NAME = { c: 'Zap', h: 'Copas', s: 'Espadilha', d: 'Pica-fumo' };
  const RAISES = [1, 3, 6, 9, 12];
  const RAISE_NAME = { 3: 'TRUCO', 6: 'SEIS', 9: 'NOVE', 12: 'DOZE' };
  const GOAL = 12, LOG_MAX = 80;
  // Lugares na mesa (escolhidos antes de começar). Lugares pares = dupla A, ímpares = dupla B.
  const PAWNS = [
    { icon: '🅰', name: 'Dupla A · lugar 1', color: '#1c7ed6' }, { icon: '🅱', name: 'Dupla B · lugar 1', color: '#e03131' },
    { icon: '🅰', name: 'Dupla A · lugar 2', color: '#1c7ed6' }, { icon: '🅱', name: 'Dupla B · lugar 2', color: '#e03131' }
  ];
  const TEAM_NAME = ['Dupla A', 'Dupla B'];

  const defaultRng = n => Math.floor(Math.random() * n);
  const rankOf = c => c[0], suitOf = c => c[1];
  const manilhaOf = vira => RANKS[(RANKS.indexOf(rankOf(vira)) + 1) % RANKS.length];
  function power(card, man) {
    if (!card) return -1;                                   // carta coberta não vale nada
    return rankOf(card) === man ? 100 + SUITS.indexOf(suitOf(card)) : RANKS.indexOf(rankOf(card));
  }
  const cardName = c => (c ? rankOf(c) + SUIT_ICON[suitOf(c)] : 'carta coberta');
  function log(s, text) {
    s.log.push({ t: text, ts: Date.now() });
    if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  }
  const teamOf = (s, seat) => s.players[seat].team;
  const next = (s, seat) => (seat + 1) % s.players.length;

  // players: [{pid, name, pawn}] — a ordem da mesa segue o lugar escolhido (pawn)
  function create(players, opts, rng = defaultRng) {
    const ps = players.slice().sort((a, b) => a.pawn - b.pawn);
    const s = {
      players: ps.map(p => ({ pid: p.pid, name: p.name, team: p.pawn % 2, color: PAWNS[p.pawn % 2].color, icon: PAWNS[p.pawn % 2].icon, hand: [], out: false })),
      score: [0, 0], dealer: ps.length - 1, handN: 0, phase: 'play', winner: null, last: null, log: [], seq: 0
    };
    deal(s, rng);
    return s;
  }
  function deal(s, rng) {
    const deck = [];
    for (const r of RANKS) for (const su of SUITS) deck.push(r + su);
    for (let i = deck.length - 1; i > 0; i--) { const j = rng(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    s.dealer = next(s, s.dealer);
    s.handN++;
    for (const p of s.players) p.hand = deck.splice(0, 3);
    s.vira = deck.pop();
    s.manilha = manilhaOf(s.vira);
    s.value = 1; s.raiser = null; s.pending = null; s.noRaise = false;
    s.tricks = [];                            // vazas terminadas: {plays, team (-1 = empate), seat}
    s.plays = [];                             // cartas na mesa da vaza atual: {seat, card, covered}
    s.lead = next(s, s.dealer);               // quem começa ("mão")
    s.turn = s.lead;
    s.phase = 'play';
    log(s, `Nova mão (${s.handN}). Vira: ${cardName(s.vira)} — manilha é ${s.manilha}.`);
    // Mão de onze: quem tem 11 decide se joga (valendo 3) ou corre (o outro ganha 1)
    const eleven = [0, 1].filter(t => s.score[t] === GOAL - 1);
    if (eleven.length === 2) { s.noRaise = true; log(s, 'Mão de ferro: as duas duplas têm 11. Vale 1, sem truco.'); }
    else if (eleven.length === 1) {
      s.phase = 'eleven'; s.elevenTeam = eleven[0]; s.noRaise = true;
      log(s, `Mão de onze para ${teamLabel(s, eleven[0])}: jogar (vale 3) ou correr?`);
    }
  }
  const teamLabel = (s, t) => s.players.filter(p => p.team === t).map(p => p.name).join(' e ');

  function endHand(s, team, why) {
    const pts = s.value;
    s.score[team] += pts;
    s.last = { n: ++s.seq, team, pts, why, tricks: s.tricks.concat(s.plays.length ? [{ plays: s.plays, team: null }] : []), vira: s.vira, score: s.score.slice() };
    log(s, `${teamLabel(s, team)} ${why} e ${pts === 1 ? 'marcou 1 ponto' : `marcou ${pts} pontos`}. Placar ${s.score[0]} × ${s.score[1]}.`);
    if (s.score[team] >= GOAL) return finish(s, team);
    return 'deal';
  }
  function finish(s, team) {
    s.phase = 'over'; s.winner = team; s.pending = null;
    log(s, `🏆 ${teamLabel(s, team)} venceu o jogo por ${s.score[0]} × ${s.score[1]}!`);
  }
  // Quem ganhou a mão olhando as vazas (team = -1 é empate). null = continua.
  function handWinner(s) {
    const r = s.tricks.map(t => t.team), [a, b, c] = r;
    if (r.length === 2) {
      if (a !== -1 && a === b) return a;
      if (a === -1 && b !== -1) return b;
      if (a !== -1 && b === -1) return a;
      return null;
    }
    if (r.length === 3) {
      // Só se chega aqui com 1×1 nas duas primeiras ou com as duas empatadas
      if (c !== -1) return c;
      return a !== -1 ? a : s.players[s.lead].team;   // terceira empatou: vale a primeira; tudo empatado: ganha a dupla da mão
    }
    return null;
  }
  function closeTrick(s) {
    let best = -2, winners = [];
    for (const p of s.plays) {
      const v = p.covered ? -1 : power(p.card, s.manilha);
      if (v > best) { best = v; winners = [p]; } else if (v === best) winners.push(p);
    }
    const teams = new Set(winners.map(w => teamOf(s, w.seat)));
    const team = teams.size > 1 ? -1 : [...teams][0];
    const seat = team === -1 ? s.plays[0].seat : winners[0].seat;
    s.tricks.push({ plays: s.plays, team, seat });
    log(s, team === -1 ? `Vaza ${s.tricks.length} empatou (cangou)!` : `${s.players[seat].name} fez a vaza ${s.tricks.length}.`);
    s.plays = [];
    const w = handWinner(s);
    if (w !== null) return endHand(s, w, 'ganhou a mão');
    s.turn = seat;
  }

  function act(s, seat, a, rng = defaultRng) {
    if (s.phase === 'over') return { error: 'O jogo terminou.' };
    const p = s.players[seat];
    if (!p || p.out) return { error: 'Você não está no jogo.' };
    const my = p.team, other = 1 - my;
    let r;
    switch (a.type) {
      case 'bankrupt':
        p.out = true;
        log(s, `${p.name} abandonou o jogo.`);
        finish(s, other);
        return { ok: true };
      case 'eleven': {
        if (s.phase !== 'eleven' || s.elevenTeam !== my) return { error: 'Não é hora de decidir a mão de onze.' };
        if (a.play) { s.value = 3; s.phase = 'play'; log(s, `${p.name} topou jogar a mão de onze (vale 3).`); }
        else { s.value = 1; r = endHand(s, other, `ganhou porque ${teamLabel(s, my)} correu da mão de onze`); }
        break;
      }
      case 'play': {
        if (s.phase !== 'play') return { error: s.phase === 'raise' ? 'Responda o pedido de truco primeiro.' : 'Não é hora de jogar.' };
        if (s.turn !== seat) return { error: 'Não é a sua vez.' };
        const i = Number(a.card);
        if (!(i >= 0 && i < p.hand.length)) return { error: 'Carta inválida.' };
        const covered = !!a.covered;
        if (covered && !s.tricks.length) return { error: 'Só dá para jogar coberta depois da primeira vaza.' };
        const card = p.hand.splice(i, 1)[0];
        s.plays.push({ seat, card, covered });
        log(s, `${p.name} jogou ${covered ? 'uma carta coberta' : cardName(card)}.`);
        if (s.plays.length === s.players.length) r = closeTrick(s);
        else s.turn = next(s, seat);
        break;
      }
      case 'raise': {
        // Pedir truco (na sua vez) ou aumentar (respondendo a um pedido)
        if (s.noRaise) return { error: 'Nesta mão não vale truco.' };
        const cur = s.pending ? s.pending.to : s.value;
        if (cur >= GOAL) return { error: 'Já está valendo doze.' };
        if (s.phase === 'play') {
          if (s.turn !== seat) return { error: 'Só dá para pedir truco na sua vez.' };
          if (s.raiser === my) return { error: 'Sua dupla já pediu; agora só os outros podem aumentar.' };
        } else if (s.phase === 'raise') {
          if (s.pending.team === my) return { error: 'Espere a resposta.' };
          s.value = s.pending.to; s.raiser = s.pending.team;   // aumentar já é aceitar o anterior
        } else return { error: 'Não é hora de pedir truco.' };
        const to = RAISES[RAISES.indexOf(cur) + 1];
        s.pending = { team: my, seat, to, n: ++s.seq };
        s.phase = 'raise';
        log(s, `${p.name} pediu ${RAISE_NAME[to]}! 📣`);
        break;
      }
      case 'accept':
        if (s.phase !== 'raise' || s.pending.team === my) return { error: 'Não há pedido para você responder.' };
        s.value = s.pending.to; s.raiser = s.pending.team; s.pending = null; s.phase = 'play';
        log(s, `${p.name} aceitou! Vale ${s.value}.`);
        break;
      case 'run':
        if (s.phase !== 'raise' || s.pending.team === my) return { error: 'Não há pedido para você responder.' };
        log(s, `${p.name} correu.`);
        r = endHand(s, s.pending.team, `ganhou porque ${teamLabel(s, my)} correu`);
        s.pending = null;
        break;
      default: return { error: 'Ação desconhecida.' };
    }
    if (r === 'deal') deal(s, rng);
    return { ok: true };
  }
  function bankrupt(s, seat) { act(s, seat, { type: 'bankrupt' }); }

  // O que cada jogador pode ver: só a própria mão; cartas cobertas ficam escondidas
  function view(s, seat) {
    const hide = list => list.map(p => (p.covered ? { ...p, card: null } : p));
    return {
      ...s,
      players: s.players.map((p, i) => ({ ...p, hand: i === seat ? p.hand : p.hand.map(() => null), cards: p.hand.length })),
      plays: hide(s.plays),
      tricks: s.tricks.map(t => ({ ...t, plays: hide(t.plays) })),
      last: s.last ? { ...s.last, tricks: s.last.tricks.map(t => ({ ...t, plays: hide(t.plays) })) } : null
    };
  }

  const api = { RANKS, SUITS, SUIT_ICON, MAN_NAME, RAISE_NAME, GOAL, PAWNS, TEAM_NAME, power, cardName, manilhaOf, create, act, bankrupt, view, log };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Truco = api;
})(typeof window !== 'undefined' ? window : globalThis);

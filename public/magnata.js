// Magnata — jogo de compra e venda de imóveis (estilo Monopoly) para 2 a 4 jogadores.
// Regras compartilhadas entre servidor (Node, que decide tudo e sorteia os dados) e navegador (que só desenha).
(function (root) {
  // Valores no estilo do Banco Imobiliário moderno: tudo ×10 em relação à tabela base abaixo
  const SCALE = 10;
  const START_MONEY = 25000, GO_BONUS = 2000, JAIL = 10, JAIL_FINE = 500, LOG_MAX = 80;
  const STATION_RENT = 25 * SCALE;           // com 1 estação; dobra a cada estação a mais
  const UTIL_MULT = [4 * SCALE, 10 * SCALE]; // × os dados, com 1 ou com as 2 companhias

  // Grupos de cor: [nome, cor, custo da casa]
  const GROUPS = {
    marrom: ['Marrom', '#8a5a3b', 50], ceu: ['Azul-claro', '#8ecae6', 50], rosa: ['Rosa', '#c8508f', 100], laranja: ['Laranja', '#ee8a2b', 100],
    vermelho: ['Vermelho', '#d63c32', 150], amarelo: ['Amarelo', '#e8c22a', 150], verde: ['Verde', '#2f9a55', 200], azul: ['Azul', '#2c55b8', 200]
  };
  // t: tipo · p: preço · r: aluguel [sem casa, 1, 2, 3, 4 casas, hotel]
  const P = (name, g, p, r) => ({ t: 'prop', name, g, p, r });
  const BOARD = [
    { t: 'go', name: 'Início' },
    P('Av. Sete de Setembro', 'marrom', 60, [2, 10, 30, 90, 160, 250]),
    { t: 'cofre', name: 'Cofre' },
    P('Rua da Praia', 'marrom', 60, [4, 20, 60, 180, 320, 450]),
    { t: 'tax', name: 'Imposto de Renda', amount: 200 },
    { t: 'station', name: 'Rodoviária', p: 200 },
    P('Pelourinho', 'ceu', 100, [6, 30, 90, 270, 400, 550]),
    { t: 'sorte', name: 'Sorte' },
    P('Largo do Machado', 'ceu', 100, [6, 30, 90, 270, 400, 550]),
    P('Rua XV de Novembro', 'ceu', 120, [8, 40, 100, 300, 450, 600]),
    { t: 'jail', name: 'Prisão' },
    P('Av. Afonso Pena', 'rosa', 140, [10, 50, 150, 450, 625, 750]),
    { t: 'utility', name: 'Companhia de Luz', p: 150 },
    P('Praça da Liberdade', 'rosa', 140, [10, 50, 150, 450, 625, 750]),
    P('Savassi', 'rosa', 160, [12, 60, 180, 500, 700, 900]),
    { t: 'station', name: 'Estação Ferroviária', p: 200 },
    P('Recife Antigo', 'laranja', 180, [14, 70, 200, 550, 750, 950]),
    { t: 'cofre', name: 'Cofre' },
    P('Olinda', 'laranja', 180, [14, 70, 200, 550, 750, 950]),
    P('Boa Viagem', 'laranja', 200, [16, 80, 220, 600, 800, 1000]),
    { t: 'parking', name: 'Estacionamento' },
    P('Praia de Iracema', 'vermelho', 220, [18, 90, 250, 700, 875, 1050]),
    { t: 'sorte', name: 'Sorte' },
    P('Av. Beira-Mar', 'vermelho', 220, [18, 90, 250, 700, 875, 1050]),
    P('Praia do Futuro', 'vermelho', 240, [20, 100, 300, 750, 925, 1100]),
    { t: 'station', name: 'Porto', p: 200 },
    P('Copacabana', 'amarelo', 260, [22, 110, 330, 800, 975, 1150]),
    P('Ipanema', 'amarelo', 260, [22, 110, 330, 800, 975, 1150]),
    { t: 'utility', name: 'Companhia de Água', p: 150 },
    P('Barra da Tijuca', 'amarelo', 280, [24, 120, 360, 850, 1025, 1200]),
    { t: 'gotojail', name: 'Vá para a prisão' },
    P('Av. Paulista', 'verde', 300, [26, 130, 390, 900, 1100, 1275]),
    P('Jardins', 'verde', 300, [26, 130, 390, 900, 1100, 1275]),
    { t: 'cofre', name: 'Cofre' },
    P('Morumbi', 'verde', 320, [28, 150, 450, 1000, 1200, 1400]),
    { t: 'station', name: 'Aeroporto', p: 200 },
    { t: 'sorte', name: 'Sorte' },
    P('Jurerê', 'azul', 350, [35, 175, 500, 1100, 1300, 1500]),
    { t: 'tax', name: 'Taxa de Luxo', amount: 100 },
    P('Leblon', 'azul', 400, [50, 200, 600, 1400, 1700, 2000])
  ];
  const BUYABLE = new Set(['prop', 'station', 'utility']);
  // Peões que os jogadores escolhem antes de começar (cada um com sua cor)
  const PAWNS = [
    { icon: '🚗', name: 'Carro', color: '#e03131' }, { icon: '🎩', name: 'Cartola', color: '#3b5bdb' },
    { icon: '🐶', name: 'Cachorro', color: '#f08c00' }, { icon: '🚢', name: 'Navio', color: '#1098ad' },
    { icon: '🦖', name: 'Dino', color: '#2f9e44' }, { icon: '🐱', name: 'Gato', color: '#d6336c' },
    { icon: '🚀', name: 'Foguete', color: '#7048e8' }, { icon: '👑', name: 'Coroa', color: '#a5711a' }
  ];
  const groupOf = g => BOARD.map((s, i) => (s.g === g ? i : -1)).filter(i => i >= 0);
  const STATIONS = BOARD.map((s, i) => (s.t === 'station' ? i : -1)).filter(i => i >= 0);
  const UTILITIES = BOARD.map((s, i) => (s.t === 'utility' ? i : -1)).filter(i => i >= 0);

  // Cartas. k: tipo do efeito
  const CARDS = {
    sorte: [
      { text: 'Avance até o Início e receba R$ 200.', k: 'goto', to: 0 },
      { text: 'Avance até a Praia do Futuro.', k: 'goto', to: 24 },
      { text: 'Avance até a Av. Afonso Pena.', k: 'goto', to: 11 },
      { text: 'Avance até a estação mais próxima.', k: 'station' },
      { text: 'O banco paga dividendos de R$ 50.', k: 'money', v: 50 },
      { text: 'Saia livre da prisão. Guarde esta carta.', k: 'jailcard' },
      { text: 'Volte 3 casas.', k: 'back', v: 3 },
      { text: 'Vá direto para a prisão, sem passar pelo Início.', k: 'jail' },
      { text: 'Reformas gerais: pague R$ 25 por casa e R$ 100 por hotel.', k: 'repairs', house: 25, hotel: 100 },
      { text: 'Multa por excesso de velocidade: pague R$ 15.', k: 'money', v: -15 },
      { text: 'Faça uma viagem saindo da Rodoviária.', k: 'goto', to: 5 },
      { text: 'Avance até o Leblon.', k: 'goto', to: 39 },
      { text: 'Você virou síndico do prédio: pague R$ 50 a cada jogador.', k: 'each', v: -50 },
      { text: 'Seu investimento rendeu: receba R$ 150.', k: 'money', v: 150 },
      { text: 'Você ganhou um concurso de palavras cruzadas: receba R$ 100.', k: 'money', v: 100 }
    ],
    cofre: [
      { text: 'Avance até o Início e receba R$ 200.', k: 'goto', to: 0 },
      { text: 'Erro do banco a seu favor: receba R$ 200.', k: 'money', v: 200 },
      { text: 'Consulta médica: pague R$ 50.', k: 'money', v: -50 },
      { text: 'Venda de ações: receba R$ 50.', k: 'money', v: 50 },
      { text: 'Saia livre da prisão. Guarde esta carta.', k: 'jailcard' },
      { text: 'Vá direto para a prisão, sem passar pelo Início.', k: 'jail' },
      { text: 'Fundo de férias: receba R$ 100.', k: 'money', v: 100 },
      { text: 'Restituição do imposto de renda: receba R$ 20.', k: 'money', v: 20 },
      { text: 'É seu aniversário: receba R$ 10 de cada jogador.', k: 'each', v: 10 },
      { text: 'Seguro de vida: receba R$ 100.', k: 'money', v: 100 },
      { text: 'Conta do hospital: pague R$ 100.', k: 'money', v: -100 },
      { text: 'Mensalidade da escola: pague R$ 50.', k: 'money', v: -50 },
      { text: 'Serviço de consultoria: receba R$ 25.', k: 'money', v: 25 },
      { text: 'Reparos na rua: pague R$ 40 por casa e R$ 115 por hotel.', k: 'repairs', house: 40, hotel: 115 },
      { text: 'Segundo lugar num concurso de beleza: receba R$ 10.', k: 'money', v: 10 },
      { text: 'Herança: receba R$ 100.', k: 'money', v: 100 }
    ]
  };
  const DECK_NAME = { sorte: 'Sorte', cofre: 'Cofre' };

  // Aplica a escala: preços, aluguéis, impostos, casas e cartas (inclusive os valores escritos no texto)
  const fmt = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  for (const sp of BOARD) {
    if (sp.p) sp.p *= SCALE;
    if (sp.r) sp.r = sp.r.map(v => v * SCALE);
    if (sp.amount) sp.amount *= SCALE;
  }
  for (const g of Object.values(GROUPS)) g[2] *= SCALE;
  for (const deck of Object.values(CARDS)) for (const c of deck) {
    for (const k of ['v', 'house', 'hotel']) if (typeof c[k] === 'number') c[k] *= SCALE;
    c.text = c.text.replace(/R\$ (\d+)/g, (_, n) => fmt(Number(n) * SCALE));
  }

  const defaultRng = n => Math.floor(Math.random() * n);
  function shuffle(n, rng) {
    const a = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) { const j = rng(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ==================== Estado ==================== */
  // players: [{pid, name, color}] na ordem das vagas
  function create(players, opts = {}, rng = defaultRng) {
    return {
      players: players.map(p => ({ pid: p.pid, name: p.name, color: p.color, icon: p.icon || null, money: START_MONEY, pos: 0, jail: false, jailTurns: 0, jailCards: [], out: false })),
      owner: {}, houses: {}, mortgaged: {},
      turn: 0, phase: 'roll', dice: null, doubles: 0, again: false, pendingBuy: null,
      debts: [], trade: null, card: null, round: 1, maxRounds: opts.maxRounds || 0, winner: null, endReason: null,
      deck: { sorte: shuffle(CARDS.sorte.length, rng), cofre: shuffle(CARDS.cofre.length, rng) },
      log: [], seq: 0
    };
  }
  function log(s, text) {
    s.log.push({ t: text, ts: Date.now() });
    if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
  }
  const money = v => 'R$ ' + Math.round(v).toLocaleString('pt-BR');
  const active = s => s.players.map((p, i) => (p.out ? -1 : i)).filter(i => i >= 0);
  const owned = (s, seat) => Object.keys(s.owner).map(Number).filter(i => s.owner[i] === seat);
  const hasGroup = (s, seat, g) => groupOf(g).every(i => s.owner[i] === seat);
  const groupHouses = (s, g) => groupOf(g).map(i => s.houses[i] || 0);

  function rent(s, idx, diceTotal) {
    const sp = BOARD[idx], o = s.owner[idx];
    if (o === undefined || s.mortgaged[idx] || s.players[o].out) return 0;
    if (sp.t === 'station') return STATION_RENT * Math.pow(2, STATIONS.filter(i => s.owner[i] === o).length - 1);
    if (sp.t === 'utility') return UTIL_MULT[UTILITIES.every(i => s.owner[i] === o) ? 1 : 0] * (diceTotal || 7);
    const n = s.houses[idx] || 0;
    if (n) return sp.r[n];
    return hasGroup(s, o, sp.g) ? sp.r[0] * 2 : sp.r[0];
  }
  const unmortgageCost = idx => Math.ceil(BOARD[idx].p / 2 * 1.1);
  function worth(s, seat) {
    const p = s.players[seat];
    let v = p.money;
    for (const i of owned(s, seat)) {
      v += s.mortgaged[i] ? BOARD[i].p / 2 : BOARD[i].p;
      if (s.houses[i]) v += s.houses[i] * GROUPS[BOARD[i].g][2];
    }
    return v;
  }
  // Quanto o jogador conseguiria levantar vendendo casas e hipotecando tudo
  function liquidity(s, seat) {
    let v = s.players[seat].money;
    for (const i of owned(s, seat)) {
      if (s.houses[i]) v += s.houses[i] * GROUPS[BOARD[i].g][2] / 2;
      if (!s.mortgaged[i]) v += BOARD[i].p / 2;
    }
    return v;
  }

  /* ==================== Dinheiro e dívidas ==================== */
  // to: vaga do credor ou null (banco)
  function charge(s, from, to, amount, why) {
    if (amount <= 0) return;
    const p = s.players[from];
    if (p.money >= amount && !s.debts.some(d => d.from === from)) {
      p.money -= amount;
      if (to !== null) s.players[to].money += amount;
    } else {
      s.debts.push({ from, to, amount, why });
      log(s, `${p.name} precisa pagar ${money(amount)} (${why}) e não tem dinheiro em caixa.`);
    }
  }
  function bankrupt(s, seat, to) {
    const p = s.players[seat];
    if (p.out) return;
    // Casas voltam ao banco pela metade do valor
    let cash = p.money;
    for (const i of owned(s, seat)) if (s.houses[i]) { cash += s.houses[i] * GROUPS[BOARD[i].g][2] / 2; delete s.houses[i]; }
    p.money = 0; p.out = true; p.jail = false;
    if (to !== null && to !== undefined && !s.players[to].out) {
      s.players[to].money += cash;
      for (const i of owned(s, seat)) s.owner[i] = to;
      s.players[to].jailCards.push(...p.jailCards);
      log(s, `${p.name} faliu. Tudo o que tinha ficou com ${s.players[to].name}.`);
    } else {
      for (const i of owned(s, seat)) { delete s.owner[i]; delete s.mortgaged[i]; }
      for (const d of p.jailCards) s.deck[d].push(CARDS[d].findIndex(c => c.k === 'jailcard'));
      log(s, `${p.name} faliu. As propriedades voltaram ao banco.`);
    }
    p.jailCards = [];
    s.debts = s.debts.filter(d => d.from !== seat);
    for (const d of s.debts) if (d.to === seat) d.to = null;
    if (s.trade && (s.trade.from === seat || s.trade.to === seat)) s.trade = null;
    const left = active(s);
    if (left.length <= 1) return finishGame(s, left[0], 'last');
    if (s.turn === seat) { s.pendingBuy = null; s.again = false; nextTurn(s); }
    else settle(s);
  }
  function finishGame(s, winner, reason) {
    s.phase = 'over'; s.winner = winner ?? null; s.endReason = reason; s.trade = null; s.debts = []; s.pendingBuy = null;
    log(s, reason === 'rounds' ? `Fim das ${s.maxRounds} rodadas. ${s.players[winner].name} venceu com o maior patrimônio!`
      : winner !== undefined && winner !== null ? `${s.players[winner].name} venceu a partida!` : 'Partida encerrada.');
  }

  /* ==================== Movimento ==================== */
  function moveTo(s, seat, dest, passGo, diceTotal) {
    const p = s.players[seat];
    if (passGo && dest < p.pos) { p.money += GO_BONUS; log(s, `${p.name} passou pelo Início e recebeu ${money(GO_BONUS)}.`); }
    p.pos = dest;
    land(s, seat, diceTotal);
  }
  function toJail(s, seat) {
    const p = s.players[seat];
    p.pos = JAIL; p.jail = true; p.jailTurns = 0;
    s.again = false; s.doubles = 0;
    log(s, `${p.name} foi para a prisão.`);
  }
  function land(s, seat, diceTotal) {
    const p = s.players[seat], sp = BOARD[p.pos], idx = p.pos;
    if (BUYABLE.has(sp.t)) {
      const o = s.owner[idx];
      if (o === undefined) s.pendingBuy = idx;
      else if (o !== seat) {
        const v = rent(s, idx, diceTotal);
        if (v) { log(s, `${p.name} pagou ${money(v)} de aluguel a ${s.players[o].name} (${sp.name}).`); charge(s, seat, o, v, `aluguel de ${sp.name}`); }
        else if (s.mortgaged[idx]) log(s, `${sp.name} está hipotecada: sem aluguel.`);
      }
    } else if (sp.t === 'tax') { log(s, `${p.name} pagou ${money(sp.amount)} de ${sp.name}.`); charge(s, seat, null, sp.amount, sp.name); }
    else if (sp.t === 'gotojail') toJail(s, seat);
    else if (sp.t === 'sorte' || sp.t === 'cofre') drawCard(s, seat, sp.t, diceTotal);
  }
  function drawCard(s, seat, deck, diceTotal) {
    const p = s.players[seat];
    const ci = s.deck[deck].shift(), c = CARDS[deck][ci];
    s.card = { deck, text: c.text, seat, n: ++s.seq };
    log(s, `${p.name} tirou ${DECK_NAME[deck]}: ${c.text}`);
    if (c.k === 'jailcard') { p.jailCards.push(deck); return; }
    s.deck[deck].push(ci);
    if (c.k === 'goto') moveTo(s, seat, c.to, true, diceTotal);
    else if (c.k === 'station') moveTo(s, seat, STATIONS.find(i => i > p.pos) ?? STATIONS[0], true, diceTotal);
    else if (c.k === 'back') { p.pos = (p.pos + 40 - c.v) % 40; land(s, seat, diceTotal); }
    else if (c.k === 'jail') toJail(s, seat);
    else if (c.k === 'money') { if (c.v > 0) p.money += c.v; else charge(s, seat, null, -c.v, 'carta'); }
    else if (c.k === 'repairs') {
      let v = 0;
      for (const i of owned(s, seat)) { const n = s.houses[i] || 0; v += n === 5 ? c.hotel : n * c.house; }
      if (v) charge(s, seat, null, v, 'reformas');
    } else if (c.k === 'each') {
      for (const o of active(s)) if (o !== seat) {
        if (c.v < 0) charge(s, seat, o, -c.v, 'carta');
        else charge(s, o, seat, c.v, 'carta');
      }
    }
  }

  /* ==================== Turno ==================== */
  function settle(s) {
    if (s.phase === 'over') return;
    if (s.debts.length) s.phase = 'debt';
    else if (s.pendingBuy !== null) s.phase = 'buy';
    else s.phase = s.again && !s.players[s.turn].jail ? 'roll' : 'end';
  }
  function nextTurn(s) {
    const n = s.players.length;
    let t = s.turn, wrapped = false;
    do { t = (t + 1) % n; if (t === 0) wrapped = true; } while (s.players[t].out);
    if (wrapped) {
      s.round++;
      if (s.maxRounds && s.round > s.maxRounds) {
        const best = active(s).sort((a, b) => worth(s, b) - worth(s, a))[0];
        s.round = s.maxRounds;
        return finishGame(s, best, 'rounds');
      }
    }
    s.turn = t; s.phase = 'roll'; s.dice = null; s.doubles = 0; s.again = false; s.pendingBuy = null;
  }

  function roll(s, seat, rng) {
    const p = s.players[seat];
    const a = rng(6) + 1, b = rng(6) + 1, total = a + b, dbl = a === b;
    s.dice = [a, b]; s.again = false;
    s.rollN = (s.rollN || 0) + 1; s.roller = seat;   // para o navegador animar os dados e o peão
    if (p.jail) {
      if (dbl) {
        p.jail = false; p.jailTurns = 0;
        log(s, `${p.name} tirou ${a} e ${b}: dupla! Saiu da prisão.`);
      } else if (++p.jailTurns >= 3) {
        p.jail = false; p.jailTurns = 0;
        log(s, `${p.name} tirou ${a} e ${b} e, na 3ª tentativa, pagou ${money(JAIL_FINE)} para sair da prisão.`);
        charge(s, seat, null, JAIL_FINE, 'fiança');
      } else {
        log(s, `${p.name} tirou ${a} e ${b} e continua preso (${p.jailTurns}ª tentativa).`);
        return settle(s);
      }
      moveTo(s, seat, (p.pos + total) % 40, true, total);
      return settle(s);
    }
    if (dbl && ++s.doubles === 3) {
      log(s, `${p.name} tirou a 3ª dupla seguida e foi preso por excesso de velocidade.`);
      toJail(s, seat);
      return settle(s);
    }
    s.again = dbl;
    log(s, `${p.name} tirou ${a} e ${b}${dbl ? ' (dupla, joga de novo)' : ''}.`);
    moveTo(s, seat, (p.pos + total) % 40, true, total);
    settle(s);
  }

  /* ==================== Ações ==================== */
  const err = e => ({ error: e });
  // a: {type, ...}. Retorna {ok:true} ou {error}
  function act(s, seat, a, rng = defaultRng) {
    if (s.phase === 'over') return err('A partida terminou.');
    const p = s.players[seat];
    if (!p || p.out) return err('Você não está mais na partida.');
    const mine = s.turn === seat;
    const idx = Number(a.idx), sp = BOARD[idx];
    switch (a.type) {
      case 'roll':
        if (!mine || s.phase !== 'roll') return err('Não é hora de jogar os dados.');
        roll(s, seat, rng); break;
      case 'payJail':
        if (!mine || s.phase !== 'roll' || !p.jail) return err('Você não está preso.');
        if (p.money < JAIL_FINE) return err('Dinheiro insuficiente para a fiança.');
        p.money -= JAIL_FINE; p.jail = false; p.jailTurns = 0;
        log(s, `${p.name} pagou ${money(JAIL_FINE)} de fiança e saiu da prisão.`); break;
      case 'useCard': {
        if (!mine || s.phase !== 'roll' || !p.jail || !p.jailCards.length) return err('Você não tem carta de saída da prisão.');
        const d = p.jailCards.shift();
        s.deck[d].push(CARDS[d].findIndex(c => c.k === 'jailcard'));
        p.jail = false; p.jailTurns = 0;
        log(s, `${p.name} usou a carta e saiu da prisão.`); break;
      }
      case 'buy': {
        if (!mine || s.phase !== 'buy') return err('Não há propriedade para comprar.');
        const i = s.pendingBuy, price = BOARD[i].p;
        if (p.money < price) return err('Dinheiro insuficiente. Hipoteque ou venda algo, ou recuse a compra.');
        p.money -= price; s.owner[i] = seat; s.pendingBuy = null;
        log(s, `${p.name} comprou ${BOARD[i].name} por ${money(price)}.`);
        settle(s); break;
      }
      case 'skip':
        if (!mine || s.phase !== 'buy') return err('Não há propriedade para recusar.');
        log(s, `${p.name} não comprou ${BOARD[s.pendingBuy].name}.`);
        s.pendingBuy = null; settle(s); break;
      case 'end':
        if (!mine || s.phase !== 'end') return err('Ainda não dá para passar a vez.');
        nextTurn(s); break;
      case 'pay': {
        const d = s.debts[0];
        if (!d || d.from !== seat) return err('Você não tem dívida para pagar agora.');
        if (p.money < d.amount) return err(`Faltam ${money(d.amount - p.money)}. Venda casas ou hipoteque propriedades.`);
        p.money -= d.amount;
        if (d.to !== null) s.players[d.to].money += d.amount;
        s.debts.shift();
        log(s, `${p.name} pagou a dívida de ${money(d.amount)}.`);
        settle(s); break;
      }
      case 'bankrupt': {
        const d = s.debts.find(x => x.from === seat);
        bankrupt(s, seat, d ? d.to : null); break;
      }
      case 'build': {
        if (!sp || sp.t !== 'prop' || s.owner[idx] !== seat) return err('Essa propriedade não é sua.');
        if (!hasGroup(s, seat, sp.g)) return err('Você precisa ter todas as propriedades da cor para construir.');
        if (groupOf(sp.g).some(i => s.mortgaged[i])) return err('Há propriedade hipotecada nesse grupo.');
        const n = s.houses[idx] || 0;
        if (n >= 5) return err('Já tem hotel.');
        if (n > Math.min(...groupHouses(s, sp.g))) return err('Construa por igual: primeiro nas outras propriedades da cor.');
        const cost = GROUPS[sp.g][2];
        if (p.money < cost) return err('Dinheiro insuficiente.');
        p.money -= cost; s.houses[idx] = n + 1;
        log(s, `${p.name} construiu ${n + 1 === 5 ? 'um hotel' : 'uma casa'} em ${sp.name}.`); break;
      }
      case 'sell': {
        if (!sp || s.owner[idx] !== seat || !s.houses[idx]) return err('Não há construção para vender.');
        if (s.houses[idx] < Math.max(...groupHouses(s, sp.g))) return err('Venda por igual: primeiro nas propriedades com mais casas.');
        const back = GROUPS[sp.g][2] / 2;
        p.money += back;
        if (--s.houses[idx] === 0) delete s.houses[idx];
        log(s, `${p.name} vendeu uma construção em ${sp.name} por ${money(back)}.`);
        break;
      }
      case 'mortgage': {
        if (!sp || s.owner[idx] !== seat || s.mortgaged[idx]) return err('Não dá para hipotecar.');
        if (sp.g && groupHouses(s, sp.g).some(n => n)) return err('Venda as construções da cor antes de hipotecar.');
        s.mortgaged[idx] = true; p.money += sp.p / 2;
        log(s, `${p.name} hipotecou ${sp.name} e recebeu ${money(sp.p / 2)}.`); break;
      }
      case 'unmortgage': {
        if (!sp || s.owner[idx] !== seat || !s.mortgaged[idx]) return err('Essa propriedade não está hipotecada.');
        const cost = unmortgageCost(idx);
        if (p.money < cost) return err(`Custa ${money(cost)} para tirar a hipoteca.`);
        p.money -= cost; delete s.mortgaged[idx];
        log(s, `${p.name} pagou ${money(cost)} e tirou a hipoteca de ${sp.name}.`); break;
      }
      case 'trade': return proposeTrade(s, seat, a);
      case 'tradeCancel':
        if (!s.trade || s.trade.from !== seat) return err('Não há proposta sua.');
        s.trade = null; break;
      case 'tradeDecline':
        if (!s.trade || s.trade.to !== seat) return err('Não há proposta para você.');
        log(s, `${p.name} recusou a troca de ${s.players[s.trade.from].name}.`);
        s.trade = null; break;
      case 'tradeAccept': return acceptTrade(s, seat);
      default: return err('Ação desconhecida.');
    }
    return { ok: true };
  }

  /* ==================== Trocas ==================== */
  function tradeProblem(s, from, to, give, get) {
    if (!s.players[to] || s.players[to].out || to === from) return 'Escolha outro jogador.';
    for (const [side, who, list, cash] of [['oferta', from, give.props, give.money], ['pedido', to, get.props, get.money]]) {
      if (!Number.isInteger(cash) || cash < 0) return 'Valor inválido.';
      if (cash > s.players[who].money) return `${s.players[who].name} não tem esse dinheiro.`;
      for (const i of list) {
        if (s.owner[i] !== who) return `Uma propriedade do ${side} não pertence mais a ${s.players[who].name}.`;
        if (BOARD[i].g && groupHouses(s, BOARD[i].g).some(n => n)) return `${BOARD[i].name} tem construções na cor: venda antes de trocar.`;
      }
    }
    if (!give.props.length && !get.props.length) return 'A troca precisa ter pelo menos uma propriedade.';
    return null;
  }
  const cleanList = v => (Array.isArray(v) ? [...new Set(v.map(Number).filter(i => BOARD[i] && BUYABLE.has(BOARD[i].t)))].slice(0, 28) : []);
  function proposeTrade(s, seat, a) {
    if (s.trade) return err('Já existe uma proposta de troca em andamento.');
    const to = Number(a.to);
    const give = { money: Math.round(Number(a.give && a.give.money) || 0), props: cleanList(a.give && a.give.props) };
    const get = { money: Math.round(Number(a.get && a.get.money) || 0), props: cleanList(a.get && a.get.props) };
    const pb = tradeProblem(s, seat, to, give, get);
    if (pb) return err(pb);
    s.trade = { from: seat, to, give, get, n: ++s.seq };
    log(s, `${s.players[seat].name} propôs uma troca a ${s.players[to].name}.`);
    return { ok: true };
  }
  function acceptTrade(s, seat) {
    const t = s.trade;
    if (!t || t.to !== seat) return err('Não há proposta para você.');
    const pb = tradeProblem(s, t.from, t.to, t.give, t.get);
    if (pb) { s.trade = null; return err('A troca não vale mais: ' + pb); }
    const A = s.players[t.from], B = s.players[t.to];
    A.money += t.get.money - t.give.money; B.money += t.give.money - t.get.money;
    for (const i of t.give.props) s.owner[i] = t.to;
    for (const i of t.get.props) s.owner[i] = t.from;
    const desc = (x) => [...x.props.map(i => BOARD[i].name), x.money ? money(x.money) : null].filter(Boolean).join(', ') || 'nada';
    log(s, `Troca feita: ${A.name} deu ${desc(t.give)} e recebeu ${desc(t.get)} de ${B.name}.`);
    s.trade = null;
    return { ok: true };
  }

  const api = {
    BOARD, GROUPS, CARDS, BUYABLE, PAWNS, START_MONEY, GO_BONUS, JAIL_FINE, STATION_RENT, UTIL_MULT, groupOf, create, act, bankrupt, finishGame, rent, worth,
    liquidity, owned, hasGroup, unmortgageCost, money, active, log
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Magnata = api;
})(typeof window !== 'undefined' ? window : globalThis);

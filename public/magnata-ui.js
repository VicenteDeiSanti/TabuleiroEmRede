// Tabuleiro em Rede — mesa de Magnata no navegador (o servidor decide tudo; aqui só desenha e envia ações)
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast, modal, go, avatar } = T;
  const { BOARD, GROUPS, money } = Magnata;
  const ROUNDS = [[0, 'Até sobrar um'], [20, '20 rodadas'], [30, '30 rodadas'], [50, '50 rodadas']];
  // Ícone de cada casa especial do tabuleiro
  const CELL_ICON = { 0: '🏁', 2: '💰', 4: '💸', 5: '🚌', 7: '❓', 10: '🚔', 12: '💡', 15: '🚆', 17: '💰', 20: '🅿️', 22: '❓', 25: '⚓', 28: '🚰', 30: '👮', 33: '💰', 35: '✈️', 36: '❓', 38: '💎' };

  // Casa i -> [linha, coluna] na grade 11×11 (Início no canto inferior direito, sentido horário)
  function cellPos(i) {
    if (i <= 10) return [11, 11 - i];
    if (i <= 20) return [11 - (i - 10), 1];
    if (i <= 30) return [1, 1 + (i - 20)];
    return [1 + (i - 30), 11];
  }
  const sideOf = i => (i % 10 === 0 ? 'corner' : i < 10 ? 'bottom' : i < 20 ? 'left' : i < 30 ? 'top' : 'right');

  /* ==================== Lobby: lista de mesas e criação ==================== */
  function lobbySection(list, me) {
    const rows = list.map(r => {
      const pill = r.over ? h('span.pill', 'Encerrada') : r.started ? h('span.pill.live', `Rodada ${r.round}`) : h('span.pill.wait', `${r.players.length}/${r.maxSeats} jogadores`);
      const btn = r.over ? 'Ver' : r.mine ? 'Abrir' : r.started ? 'Assistir' : 'Entrar';
      return h('div.room-row' + (r.mine ? '.mine' : ''),
        h('span.gicon', { title: 'Magnata' }, '◆︎'),
        h('div', { style: { minWidth: 0 } }, h('div.rname', r.name),
          h('div.meta', h('span', `${r.maxRounds ? r.maxRounds + ' rodadas' : 'até sobrar um'}${r.private ? ' · privada' : ''}`),
            h('span', r.players.map(p => p.name).join(', ')))),
        pill,
        h('button.btn' + (!r.mine && !r.started ? '.primary' : ''), { type: 'button', onclick: () => go({ magnata: r.id }) }, btn));
    });
    return h('section.mag-lobby',
      h('div.list-head', h('h2', 'Magnata ', h('small.muted', '2 a 8 jogadores')),
        h('button.btn.small.primary', { type: 'button', onclick: createDialog }, 'Nova mesa')),
      h('div.rooms', rows.length ? rows : h('div.empty', 'Nenhuma mesa de Magnata. Crie uma e chame até 7 amigos: compre imóveis, construa casas e cobre aluguel!')));
  }
  function createDialog() {
    let rounds = 0;
    modal((box, close) => {
      const name = h('input', { maxlength: 40, placeholder: 'Ex.: Magnata da turma' });
      const priv = h('input', { type: 'checkbox' });
      const seg = h('div.seg', ROUNDS.map(([v, l]) => h('button', { type: 'button', class: v === rounds ? 'on' : null, onclick: e => {
        rounds = v; [...seg.children].forEach(b => b.classList.toggle('on', b === e.currentTarget));
      } }, l)));
      const submit = async () => {
        try { const r = await api('/magnata', { name: name.value, private: priv.checked, maxRounds: rounds }); close(); go({ magnata: r.id }); }
        catch (e) { errToast(e); }
      };
      box.append(h('h2', 'Nova mesa de Magnata'),
        h('p.muted', `Cada jogador começa com ${money(Magnata.START_MONEY)} e recebe ${money(Magnata.GO_BONUS)} ao passar pelo Início. Compre propriedades, junte as cores, construa casas e hotéis e leve os outros à falência.`),
        h('label.field', 'Nome da mesa (opcional)', name),
        h('div', h('p.section-title', 'Duração'), seg,
          h('p.muted', { style: { fontSize: '13px', margin: '6px 0 0' } }, 'Com limite de rodadas, vence quem tiver o maior patrimônio no fim.')),
        h('label.switch', h('span.lbl', 'Mesa privada', h('small', 'Não aparece na lista, só pelo link')), priv, h('span.tg')),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: submit }, 'Criar mesa')));
    });
  }

  /* ==================== Mesa ==================== */
  const HOP_MS = 160, ROLL_MS = 750;
  // Posições dos peões quando há vários na mesma casa (em "raios" do tamanho do peão)
  const OFFS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1.4], [0, 1.4], [-1.4, 0], [1.4, 0]];
  const pawnIcon = p => p.icon || (p.name || '?').trim()[0].toUpperCase();
  const tokEl = (p, cls = '') => h('span.ptok' + cls, { style: { '--c': p.color }, title: p.name }, h('span.em', pawnIcon(p)));
  const dieEl = v => h('span.die', { dataset: { v } }, Array.from({ length: v }, () => h('i')));

  const G = {
    id: null, d: null, es: null, active: false, lastCard: 0, lastTrade: 0, myTurnNotified: false,
    shown: null, target: null, tokEls: [], timers: [], busyUntil: 0, lastRoll: 0, rollingUntil: 0,
    get s() { return this.d && this.d.state; },
    get me() { return this.d && this.d.you !== null && this.d.you >= 0 ? this.d.you : null; },
    get busy() { return Date.now() < this.busyUntil; },

    async open(id) {
      if (this.id !== id) { this.close(); this.id = id; this.d = null; }
      this.active = true;
      const root = $('#v-magnata');
      if (!this.d) { this.built = false; root.replaceChildren(h('p.muted', 'Abrindo a mesa…')); }
      try {
        const d = await api('/magnata/' + id);
        if (this.id !== id) return;
        if (d.game && d.game !== 'magnata') return go({ [d.game]: id }, true);
        this.update(d);
        this.connect(id);
      } catch (e) { errToast(e); go({}, true); }
    },
    close() {
      this.active = false;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      if (this.es) { this.es.close(); this.es = null; }
      clearInterval(this.tick); this.tick = null;
      this.clearTimers();
      if (this.ro) { this.ro.disconnect(); this.ro = null; }
      this.id = null; this.d = null; this.shown = null; this.built = false;
    },
    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; this.busyUntil = 0; this.rollingUntil = 0; },
    later(ms, fn) { this.timers.push(setTimeout(() => { if (this.active) fn(); }, Math.max(0, ms))); },
    connect(id) {
      if (this.es) this.es.close();
      const es = new EventSource(`/api/magnata/${id}/events?token=${encodeURIComponent(T.token())}`);
      this.es = es;
      es.onmessage = e => { if (this.es === es) this.update(JSON.parse(e.data)); };
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED) return;
        setTimeout(async () => {
          if (this.es !== es || !this.active) return;
          try { await api('/magnata/' + id); this.connect(id); }
          catch (err) { toast('A mesa foi encerrada.'); go({}, true); }
        }, 3000);
      };
      clearInterval(this.tick);
      // Atualiza o contador de desconexão de quem está travando a partida
      this.tick = setInterval(() => { if (this.s && this.s.waitingAwayMs) { this.s.waitingAwayMs += 1000; this.renderActions(); } }, 1000);
    },
    async act(a) {
      try { await api(`/magnata/${this.id}/act`, a); }
      catch (e) { errToast(e); }
    },

    /* ---------- Estado e animações ---------- */
    update(d) {
      const prev = this.s;
      this.d = d;
      const s = d.state;
      const fresh = !s || !prev || !this.shown || this.shown.length !== s.players.length || (prev.phase === 'over' && s.phase !== 'over');
      if (!s) { this.shown = null; this.target = null; }
      else if (fresh) {
        this.clearTimers();
        this.shown = s.players.map(p => p.pos); this.target = this.shown.slice();
        this.lastRoll = s.rollN || 0; this.lastCard = s.card ? s.card.n : 0;
        this.resetTokens();
        if (prev && prev.phase === 'over') Sound.play('start');
      } else this.animate(prev, s);
      if (s) {
        if (s.trade && s.trade.to === this.me && s.trade.n !== this.lastTrade) { Sound.play('notify'); toast(`${s.players[s.trade.from].name} propôs uma troca para você.`); }
        this.lastTrade = s.trade ? s.trade.n : 0;
        const mine = this.needsMe();
        if (mine && !this.myTurnNotified && prev) this.later(this.busyUntil - Date.now(), () => Sound.play('notify'));
        this.myTurnNotified = mine;
        if (prev && prev.phase !== 'over' && s.phase === 'over') this.later(this.busyUntil - Date.now(), () => Sound.play(s.winner === this.me ? 'win' : 'start'));
      }
      document.title = (this.needsMe() ? '● ' : '') + d.name + ' · Magnata';
      this.render();
    },
    // Compara o estado anterior com o novo e agenda: dados rolando, peão pulando casa por casa, dinheiro voando
    animate(prev, s) {
      const now = Date.now();
      let t = Math.max(now, this.busyUntil);
      const rolled = (s.rollN || 0) !== this.lastRoll;
      this.lastRoll = s.rollN || 0;
      if (rolled) {
        const start = t;
        this.later(start - now, () => { Sound.play('dice'); this.rollingUntil = start + ROLL_MS; this.renderCenter(); });
        t += ROLL_MS;
        this.later(t - now, () => { this.rollingUntil = 0; this.renderCenter(); });
      }
      s.players.forEach((p, i) => {
        if (p.out || this.target[i] === p.pos) { this.target[i] = p.pos; return; }
        const from = this.target[i];
        this.target[i] = p.pos;
        let steps = 0;
        const wasJailed = prev.players[i] && prev.players[i].jail;
        if (rolled && i === s.roller && s.dice && !(p.jail && !wasJailed)) steps = s.dice[0] + s.dice[1];
        for (let k = 1; k <= steps; k++) {
          const pos = (from + k) % 40;
          this.later(t - now + k * HOP_MS, () => { this.shown[i] = pos; this.layoutTokens(); this.hop(i); Sound.play('hop'); });
        }
        t += steps * HOP_MS;
        if ((from + steps) % 40 !== p.pos) {
          t += steps ? 350 : 0;
          this.later(t - now, () => { this.shown[i] = p.pos; this.layoutTokens(true); if (p.jail) Sound.play('jail'); });
          t += 450;
        }
      });
      // Carta tirada
      if (s.card && s.card.n !== this.lastCard) {
        this.lastCard = s.card.n;
        this.later(t - now, () => Sound.play('card'));
      }
      // Dinheiro que entrou ou saiu de cada um
      const deltas = s.players.map((p, i) => p.money - (prev.players[i] ? prev.players[i].money : p.money));
      const bought = Object.keys(s.owner).some(k => prev.owner[k] === undefined);
      if (deltas.some(x => x)) {
        this.later(t - now + 60, () => {
          deltas.forEach((v, i) => { if (v) this.pop(i, (v > 0 ? '+' : '−') + money(Math.abs(v)), v > 0 ? 'up' : 'down'); });
          Sound.play(bought ? 'buy' : deltas.some((v, i) => v > 0 && i === this.me) ? 'coin' : deltas.some(v => v < 0) ? 'pay' : 'coin');
        });
      }
      this.busyUntil = t;
      if (t > now) this.later(t - now + 20, () => this.render());
    },
    needsMe() {
      const s = this.s;
      if (!s || this.me === null || s.phase === 'over') return false;
      if (s.phase === 'debt') return s.debts[0].from === this.me;
      return s.turn === this.me || (s.trade && s.trade.to === this.me);
    },

    /* ---------- Peões ---------- */
    resetTokens() {
      for (const el of this.tokEls) if (el) el.remove();
      this.tokEls = [];
    },
    layoutTokens(slide) {
      const s = this.s;
      if (!this.tokLayer) return;
      if (!s || !this.shown) { this.resetTokens(); return; }
      const W = this.boardEl.clientWidth, size = Math.max(16, W * 0.042);
      const byCell = {};
      s.players.forEach((p, i) => { if (!p.out) (byCell[this.shown[i]] = byCell[this.shown[i]] || []).push(i); });
      s.players.forEach((p, i) => {
        let el = this.tokEls[i];
        if (!el) { el = tokEl(p); this.tokLayer.append(el); this.tokEls[i] = el; }
        el.hidden = p.out;
        if (p.out) return;
        const cell = this.cells[this.shown[i]], group = byCell[this.shown[i]], k = group.indexOf(i);
        const [ox, oy] = group.length > 1 ? OFFS[k % 8] : [0, 0], r = size * (group.length > 4 ? 0.36 : 0.42);
        el.classList.toggle('slide', !!slide);
        el.style.left = (cell.offsetLeft + cell.offsetWidth / 2 + ox * r) + 'px';
        el.style.top = (cell.offsetTop + cell.offsetHeight * (cell.classList.contains('corner') ? 0.62 : 0.7) + oy * r) + 'px';
        el.style.width = el.style.height = el.style.fontSize = (group.length > 4 ? size * 0.8 : size) + 'px';
        el.classList.toggle('cur', i === s.turn && s.phase !== 'over');
      });
    },
    hop(i) {
      const el = this.tokEls[i];
      if (!el) return;
      el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
    },
    pop(i, text, cls) {
      const el = this.tokEls[i];
      if (!el || el.hidden) return;
      const b = h('div.mpop.' + cls, text);
      b.style.left = el.style.left; b.style.top = el.style.top;
      this.tokLayer.append(b);
      setTimeout(() => b.remove(), 1800);
    },

    /* ---------- Desenho ---------- */
    render() {
      const root = $('#v-magnata'), d = this.d;
      if (!this.built || !root.contains(this.boardEl)) this.build(root);
      $('#mTitle').textContent = d.name;
      $('#mTags').replaceChildren(...[
        h('span.pill', d.maxRounds ? `${d.maxRounds} rodadas` : 'Até sobrar um'),
        this.s && this.s.phase !== 'over' ? h('span.pill.live', `Rodada ${this.s.round}${this.s.maxRounds ? '/' + this.s.maxRounds : ''}`) : null,
        d.private ? h('span.pill', 'Privada') : null,
        d.spectators ? h('span.pill', `👀 ${d.spectators} assistindo`) : null,
        h('span.msize', { title: 'Tamanho do tabuleiro' }, [['grande', 'Grande'], ['enorme', 'Enorme'], ['gigante', 'Gigante']].map(([v, l]) =>
          h('button', { type: 'button', class: this.size() === v ? 'on' : null, onclick: () => this.setSize(v) }, l))),
        document.fullscreenEnabled ? h('button.btn.small', { type: 'button', onclick: () => this.toggleFull() }, document.fullscreenElement ? '✕ Sair da tela cheia' : '⛶ Tela cheia') : null].filter(Boolean));
      this.renderBoard();
      this.renderCenter();
      this.renderActions();
      this.renderPlayers();
      this.renderMine();
      this.renderLog();
      this.renderChat();
    },
    // Tamanho do tabuleiro (fica salvo neste navegador)
    size() { return T.store.get('tr-mag-size', 'enorme'); },
    setSize(v) {
      T.store.set('tr-mag-size', v);
      this.applySize();
      this.render();
      if (v !== 'grande') $('#v-magnata').scrollIntoView({ block: 'start' });
    },
    applySize() {
      const root = $('#v-magnata');
      for (const c of ['size-grande', 'size-enorme', 'size-gigante']) root.classList.toggle(c, c === 'size-' + this.size());
    },
    toggleFull() {
      const p = document.fullscreenElement ? document.exitFullscreen() : $('#v-magnata').requestFullscreen();
      Promise.resolve(p).catch(() => {}).finally(() => setTimeout(() => this.active && this.d && this.render(), 120));
    },
    build(root) {
      this.built = true;
      this.applySize();
      if (this.size() !== 'grande') setTimeout(() => root.scrollIntoView({ block: 'start' }), 50);
      this.boardEl = h('div.mboard');
      this.cells = BOARD.map((sp, i) => {
        const [r, c] = cellPos(i);
        const cell = h('button.mcell.' + sideOf(i), { type: 'button', style: { gridRow: r, gridColumn: c }, dataset: { i }, onclick: () => this.propModal(i), 'aria-label': sp.name },
          sp.g ? h('span.band', { style: { background: GROUPS[sp.g][1] } }) : null,
          CELL_ICON[i] ? h('span.ticon', CELL_ICON[i]) : null,
          h('span.nm', sp.name),
          sp.p ? h('span.pr', money(sp.p)) : sp.amount ? h('span.pr', money(sp.amount)) : null);
        this.boardEl.append(cell);
        return cell;
      });
      this.center = h('div.mcenter');
      this.tokLayer = h('div.mtoklayer');
      this.tokEls = [];
      this.boardEl.append(this.center, this.tokLayer);
      root.replaceChildren(h('div.mgame',
        h('div.mboard-col', this.boardEl),
        h('aside.side',
          h('div.game-head', h('h1#mTitle', ''), h('div.tags#mTags')),
          h('div#mActions'),
          h('div#mPlayers.mhud'),
          h('div#mMine'),
          h('div.card.mlog', h('p.section-title', 'Acontecimentos'), h('div#mLog')),
          h('div.chat#mChat',
            h('div.chat-log#mChatLog', { 'aria-live': 'polite' }),
            h('form#mChatForm', { autocomplete: 'off', onsubmit: e => this.sendChat(e) },
              h('input#mChatInput', { maxlength: 300, placeholder: 'Mensagem' }), h('button.btn.small', { type: 'submit' }, 'Enviar'))))));
      if (this.ro) this.ro.disconnect();
      this.ro = new ResizeObserver(() => this.layoutTokens());
      this.ro.observe(this.boardEl);
    },
    renderBoard() {
      const s = this.s;
      this.cells.forEach((cell, i) => {
        const o = s ? s.owner[i] : undefined;
        cell.classList.toggle('owned', o !== undefined);
        cell.classList.toggle('mort', !!(s && s.mortgaged[i]));
        cell.style.setProperty('--own', o !== undefined ? s.players[o].color : 'transparent');
        // Selo com o peão do dono
        let badge = cell.querySelector('.obadge');
        if (o !== undefined) {
          if (!badge) { badge = h('span.obadge'); cell.append(badge); }
          badge.style.setProperty('--c', s.players[o].color);
          badge.textContent = pawnIcon(s.players[o]);
          badge.title = 'Dono: ' + s.players[o].name;
        } else if (badge) badge.remove();
        const n = s ? s.houses[i] || 0 : 0;
        let hs = cell.querySelector('.houses');
        if (n) {
          if (!hs) { hs = h('span.houses'); cell.append(hs); }
          hs.replaceChildren(...(n === 5 ? [h('i.hotel', '🏨')] : Array.from({ length: n }, () => h('i', '🏠'))));
        } else if (hs) hs.remove();
      });
      this.layoutTokens();
    },

    // Centro do tabuleiro: é o "controle" do jogo (vez, dados, botões grandes, cartas)
    renderCenter() {
      const s = this.s, d = this.d, me = this.me, kids = [];
      const big = (label, fn, cls = '', disabled) => h('button.gbtn' + cls, { type: 'button', onclick: fn, disabled: disabled || null }, label);
      if (!s) {
        kids.push(h('div.mlogo', 'MAGNATA'), h('div.gsub', `${d.seats.length} de ${d.maxSeats} jogadores`));
        kids.push(h('div.lineup', d.seats.map(p => { const pw = Magnata.PAWNS[p.pawn] || {}; return h('div.lu', tokEl({ ...p, icon: pw.icon, color: pw.color }, '.big'), h('span', p.name)); })));
        if (!d.joined && d.seats.length < d.maxSeats) kids.push(big('🪑 SENTAR À MESA', () => api(`/magnata/${d.id}/join`, {}).catch(errToast), '.go'));
        else if (d.creator === T.me().id) kids.push(big('▶ COMEÇAR', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.go', d.seats.length < 2));
        else kids.push(h('div.gwait', 'Esperando o anfitrião começar…'));
        return this.center.replaceChildren(...kids);
      }
      if (s.phase === 'over' && !this.busy) {
        const rank = s.players.map((p, i) => ({ p, i, w: Magnata.worth(s, i) })).sort((a, b) => (b.i === s.winner) - (a.i === s.winner) || (a.p.out - b.p.out) || b.w - a.w);
        kids.push(h('div.trophy', '🏆'), s.winner !== null ? h('div.gwin', tokEl(s.players[s.winner], '.big'), h('b', s.players[s.winner].name), h('span', 'VENCEU!')) : h('div.gwin', h('b', 'Fim de jogo')),
          h('ol.grank', rank.slice(0, 8).map(r => h('li', tokEl(r.p, '.sm'), h('span', r.p.name), h('b', r.p.out ? 'faliu' : money(r.w))))));
        if (d.creator === T.me().id) kids.push(big('↻ JOGAR DE NOVO', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.go'));
        return this.center.replaceChildren(...kids);
      }
      const cur = s.players[s.turn];
      kids.push(h('div.gturn' + (s.turn === me ? '.mine' : ''), tokEl(cur, '.big'), h('div', h('small', s.turn === me ? 'SUA VEZ' : 'VEZ DE'), h('b', cur.name))));
      const rolling = Date.now() < this.rollingUntil;
      if (s.dice || rolling) kids.push(h('div.dice' + (rolling ? '.rolling' : ''), (rolling ? [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] : s.dice).map(dieEl)));
      if (rolling) this.later(110, () => { if (Date.now() < this.rollingUntil) this.renderCenter(); });
      if (this.busy) return this.center.replaceChildren(...kids);
      if (s.card && s.log.slice(-5).some(l => l.t.includes(s.card.text))) kids.push(h('div.mcard.' + s.card.deck, { dataset: { n: s.card.n } }, h('b', s.card.deck === 'sorte' ? '❓ SORTE' : '💰 COFRE'), s.card.text));
      const P = s.players;
      if (me !== null && s.phase === 'debt' && s.debts[0].from === me) {
        const debt = s.debts[0], lack = debt.amount - P[me].money;
        kids.push(h('div.gpanel.bad', h('b', `Você deve ${money(debt.amount)}`), h('span', lack > 0 ? `Faltam ${money(lack)}: venda casas ou hipoteque (toque nas suas casas).` : debt.why),
          h('div.grow', big('💸 PAGAR', () => this.act({ type: 'pay' }), '.go', lack > 0), big('☠ FALÊNCIA', () => this.confirmBankrupt(true), '.red'))));
      } else if (me !== null && s.turn === me && s.phase === 'roll') {
        if (P[me].jail) kids.push(h('div.gpanel', h('b', '🚔 Você está preso'), h('span', `Tire uma dupla (tentativa ${P[me].jailTurns + 1} de 3)`),
          h('div.grow', big('🎲 TENTAR DUPLA', () => this.act({ type: 'roll' }), '.go'), big(`PAGAR ${money(Magnata.JAIL_FINE)}`, () => this.act({ type: 'payJail' }), '', P[me].money < Magnata.JAIL_FINE),
            P[me].jailCards.length ? big('🎟 USAR CARTA', () => this.act({ type: 'useCard' })) : null)));
        else kids.push(big(s.dice ? '🎲 DUPLA! JOGAR DE NOVO' : '🎲 JOGAR DADOS', () => this.act({ type: 'roll' }), '.go.pulse'));
      } else if (me !== null && s.turn === me && s.phase === 'buy') {
        const i = s.pendingBuy, sp = BOARD[i];
        kids.push(h('div.gbuy', sp.g ? h('div.gb-band', { style: { background: GROUPS[sp.g][1] } }, GROUPS[sp.g][0]) : h('div.gb-band', CELL_ICON[i] || ''),
          h('b', sp.name), h('span', `Aluguel a partir de ${money(sp.t === 'prop' ? sp.r[0] : sp.t === 'station' ? Magnata.STATION_RENT : Magnata.UTIL_MULT[0] * 2)}`),
          h('div.gprice', money(sp.p)),
          h('div.grow', big('🛒 COMPRAR', () => this.act({ type: 'buy' }), '.go', P[me].money < sp.p), big('PASSAR', () => this.act({ type: 'skip' })))));
      } else if (me !== null && s.turn === me && s.phase === 'end') {
        kids.push(big('✔ PASSAR A VEZ', () => this.act({ type: 'end' }), '.go'), h('div.gwait', 'Antes, se quiser: construa, hipoteque ou proponha trocas.'));
      } else {
        const w = s.phase === 'debt' ? P[s.debts[0].from] : cur;
        kids.push(h('div.gwait', `Aguardando ${w.name}`, h('span.dots', h('i', '.'), h('i', '.'), h('i', '.'))));
      }
      const last = s.log[s.log.length - 1];
      if (last) kids.push(h('div.gticker', last.t));
      this.center.replaceChildren(...kids);
    },

    renderActions() {
      const box = $('#mActions'), d = this.d, s = this.s, me = this.me;
      if (!box) return;
      const btn = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      const out = [];
      if (!s) {
        // Antes de começar: escolher o peão
        out.push(h('div.status', d.seats.length < 2 ? `Esperando mais jogadores (mínimo 2, máximo ${d.maxSeats}).` : d.creator === T.me().id ? 'Quando todos estiverem na mesa, comece a partida.' : 'Esperando quem criou a mesa começar.'));
        if (d.joined) {
          const mine = (d.seats.find(p => p.id === T.me().id) || {}).pawn;
          const taken = {};
          for (const p of d.seats) taken[p.pawn] = p;
          out.push(h('div.card.pawnpick', h('p.section-title', 'Escolha seu peão'),
            h('div.pawngrid', Magnata.PAWNS.map((pw, i) => {
              const by = taken[i], isMine = i === mine;
              return h('button.pawnbtn' + (isMine ? '.on' : ''), { type: 'button', style: { '--c': pw.color }, disabled: (by && !isMine) || null, title: by ? by.name : pw.name,
                onclick: () => api(`/magnata/${d.id}/pawn`, { pawn: i }).catch(errToast) },
                h('span.em', pw.icon), h('small', by && !isMine ? by.name : pw.name));
            }))));
        }
        const row = h('div.controls');
        if (!d.joined && d.seats.length < d.maxSeats) row.append(btn('Sentar à mesa', () => api(`/magnata/${d.id}/join`, {}).catch(errToast), '.primary'));
        if (d.joined) row.append(btn('Sair da mesa', async () => { try { await api(`/magnata/${d.id}/leave`, {}); go({}); } catch (e) { errToast(e); } }));
        if (d.creator === T.me().id) { const b = btn('Começar partida', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.primary'); b.disabled = d.seats.length < 2; row.append(b); }
        out.push(row, this.shareBox());
        return box.replaceChildren(...out);
      }
      if (s.phase === 'over') {
        out.push(h('div.status.mover', s.winner !== null ? `🏆 ${s.players[s.winner].name} venceu${s.endReason === 'rounds' ? ' com o maior patrimônio' : ''}!` : 'Partida encerrada.'));
        const row = h('div.controls');
        if (d.creator === T.me().id) row.append(btn('Jogar de novo', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.primary'));
        row.append(btn('Voltar ao lobby', () => go({})));
        out.push(row);
        return box.replaceChildren(...out);
      }
      const P = s.players;
      // Os botões principais ficam no centro do tabuleiro; aqui vão as ações extras
      if (me === null) out.push(h('div.status', d.joined ? 'Você saiu da partida. Continue assistindo!' : `👀 Você está assistindo. Vez de ${P[s.turn].name}.`));
      if (me !== null && s.waitingAwayMs) {
        const w = s.phase === 'debt' ? s.debts[0].from : s.turn, left = Math.ceil((d.awayLimit - s.waitingAwayMs) / 1000);
        if (w !== me) out.push(h('div.offer', `${P[w].name} está desconectado.`, left > 0 ? h('span.muted', ` Em ${left} s você pode tirá-lo da partida.`)
          : btn('Tirar da partida', () => this.act({ type: 'kick' }), '.small.danger')));
      }
      if (s.trade) out.push(this.tradeBox(s.trade));
      if (me !== null) out.push(h('div.controls', btn('🤝 Propor troca', () => this.tradeModal(), '.small'), btn('🏳 Desistir', () => this.confirmBankrupt(false), '.small.danger')));
      box.replaceChildren(...out);
    },
    shareBox() {
      const url = location.origin + '/?magnata=' + this.d.id;
      return h('div.share', h('span.muted', 'Convide pelo link: '), h('code', url),
        h('button.btn.small', { type: 'button', onclick: () => navigator.clipboard.writeText(url).then(() => toast('Link copiado.'), () => toast(url)) }, 'Copiar'));
    },
    tradeBox(t) {
      const s = this.s, P = s.players;
      const list = x => [...x.props.map(i => h('span.mchip', { style: { '--c': BOARD[i].g ? GROUPS[BOARD[i].g][1] : 'var(--muted)' } }, BOARD[i].name)), x.money ? h('span.mchip.cash', money(x.money)) : null].filter(Boolean);
      const box = h('div.card.mtrade',
        h('p.section-title', '🤝 Troca: ', pawnIcon(P[t.from]), ` ${P[t.from].name} → `, pawnIcon(P[t.to]), ` ${P[t.to].name}`),
        h('div.mtrade-cols',
          h('div', h('small.muted', `${P[t.from].name} dá`), h('div.mchips', list(t.give).length ? list(t.give) : h('span.muted', 'nada'))),
          h('div', h('small.muted', `${P[t.from].name} pede`), h('div.mchips', list(t.get).length ? list(t.get) : h('span.muted', 'nada')))));
      const row = h('div.controls');
      if (t.to === this.me) row.append(h('button.btn.primary', { type: 'button', onclick: () => this.act({ type: 'tradeAccept' }) }, 'Aceitar troca'), h('button.btn', { type: 'button', onclick: () => this.act({ type: 'tradeDecline' }) }, 'Recusar'));
      else if (t.from === this.me) row.append(h('button.btn', { type: 'button', onclick: () => this.act({ type: 'tradeCancel' }) }, 'Cancelar proposta'));
      else row.append(h('span.muted', 'Aguardando resposta.'));
      box.append(row);
      return box;
    },
    confirmBankrupt(debt) {
      modal((box, close) => box.append(
        h('h2', debt ? 'Declarar falência?' : 'Desistir da partida?'),
        h('p.muted', debt ? 'Você sai da partida e o credor fica com o que você tem.' : 'Você sai da partida e suas propriedades voltam ao banco.'),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'),
          h('button.btn.primary', { type: 'button', onclick: () => { close(); this.act({ type: 'bankrupt' }); } }, debt ? 'Declarar falência' : 'Desistir'))));
    },

    // Placar dos jogadores, estilo HUD de videogame
    renderPlayers() {
      const s = this.s, d = this.d, box = $('#mPlayers');
      if (!s) {
        box.replaceChildren(...d.seats.map(p => {
          const pw = Magnata.PAWNS[p.pawn] || {};
          return h('div.hud-p', tokEl({ ...p, icon: pw.icon, color: pw.color }, '.big' + (p.online ? '.on' : '')),
            h('div.info', h('div.nm', h('span.link', { onclick: () => go({ v: 'perfil', id: p.id }) }, p.name), p.id === d.creator ? h('span.hb', '⭐ anfitrião') : null), h('small', pw.name || '')));
        }), ...Array.from({ length: d.maxSeats - d.seats.length }, () => h('div.hud-p.empty', h('span.ptok.big.ghost', h('span.em', '?')), h('div.info', h('small', 'Lugar vago')))));
        return;
      }
      const online = new Set(d.seats.filter(p => p.online).map(p => p.id));
      const alive = Magnata.active(s), leader = alive.length > 1 ? alive.reduce((a, b) => (Magnata.worth(s, b) > Magnata.worth(s, a) ? b : a)) : null;
      const groups = Object.keys(GROUPS);
      box.replaceChildren(...s.players.map((p, i) => {
        const own = new Set(Magnata.owned(s, i).map(k => BOARD[k].g).filter(Boolean));
        const houses = Magnata.owned(s, i).reduce((n, k) => n + (s.houses[k] || 0), 0);
        return h('div.hud-p' + (i === s.turn && s.phase !== 'over' ? '.cur' : '') + (p.out ? '.out' : '') + (i === s.winner ? '.win' : '') + (i === this.me ? '.me' : ''), { onclick: () => this.playerModal(i) },
          tokEl(p, '.big' + (online.has(p.pid) ? '.on' : '')),
          h('div.info',
            h('div.nm', p.name, i === this.me ? h('span.hb.you', 'VOCÊ') : null, i === leader && s.phase !== 'over' ? h('span.hb', '👑') : null,
              p.jail ? h('span.hb', '🚔 preso') : null, p.out ? h('span.hb', '☠ faliu') : null),
            h('div.gsq', groups.map(g => h('i' + (own.has(g) ? (Magnata.hasGroup(s, i, g) ? '.full' : '.some') : ''), { style: { '--g': GROUPS[g][1] }, title: GROUPS[g][0] }))),
            houses ? h('small', `🏠 ${houses}`) : null),
          h('div.cash', h('b', money(p.money)), h('small', `patrimônio ${money(Magnata.worth(s, i))}`)));
      }));
    },
    renderMine() {
      const s = this.s, me = this.me, box = $('#mMine');
      if (!s || me === null) return box.replaceChildren();
      const props = Magnata.owned(s, me).sort((a, b) => a - b);
      if (!props.length) return box.replaceChildren();
      box.replaceChildren(h('div.card', h('p.section-title', 'Suas propriedades'),
        h('div.mchips', props.map(i => h('button.mchip' + (s.mortgaged[i] ? '.mort' : ''), { type: 'button', style: { '--c': BOARD[i].g ? GROUPS[BOARD[i].g][1] : 'var(--muted)' }, onclick: () => this.propModal(i) },
          CELL_ICON[i] ? CELL_ICON[i] + ' ' : '', BOARD[i].name, s.houses[i] ? h('b', s.houses[i] === 5 ? ' 🏨' : ' ' + '🏠'.repeat(s.houses[i])) : null))),
        h('p.muted.small', { style: { margin: '8px 0 0' } }, 'Toque numa propriedade para construir, vender ou hipotecar.')));
    },
    renderLog() {
      const s = this.s, box = $('#mLog');
      box.replaceChildren(...(s ? s.log.slice(-40).reverse().map(l => h('div.mlogline', l.t)) : [h('p.muted', 'A partida ainda não começou.')]));
    },
    renderChat() {
      const log = $('#mChatLog'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      log.replaceChildren(...this.d.chat.map(m => m.n ? h('div.msg', h('b', m.n + ': '), m.t) : h('div.msg.sys', m.t)));
      if (atEnd || !this.chatScrolled) { log.scrollTop = log.scrollHeight; this.chatScrolled = true; }
    },
    async sendChat(e) {
      e.preventDefault();
      const inp = $('#mChatInput'), text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      try { await api(`/magnata/${this.id}/chat`, { text }); } catch (err) { errToast(err); inp.value = text; }
    },

    /* ---------- Janelas ---------- */
    propModal(i) {
      const sp = BOARD[i], s = this.s, me = this.me;
      modal((box, close) => {
        const o = s ? s.owner[i] : undefined, n = s ? s.houses[i] || 0 : 0;
        box.append(sp.g ? h('div.mprop-band', { style: { background: GROUPS[sp.g][1] } }, GROUPS[sp.g][0]) : null, h('h2', sp.name));
        if (sp.t === 'prop') {
          const labels = ['Aluguel', 'Com 1 casa', 'Com 2 casas', 'Com 3 casas', 'Com 4 casas', 'Com hotel'];
          box.append(h('table.mrent', h('tbody',
            ...sp.r.map((v, k) => h('tr' + (s && o !== undefined && k === n && !(k === 0 && Magnata.hasGroup(s, o, sp.g)) ? '.on' : ''), h('td', labels[k]), h('td.num', money(v)))),
            h('tr', h('td', 'Com a cor completa (sem casas)'), h('td.num', money(sp.r[0] * 2))))),
          h('p.muted.small', `Preço ${money(sp.p)} · casa ${money(GROUPS[sp.g][2])} (hotel = 5ª) · hipoteca ${money(sp.p / 2)}`));
        } else if (sp.t === 'station') box.append(h('p', `Aluguel: ${[1, 2, 4, 8].map((k, n) => `${money(Magnata.STATION_RENT * k)} com ${n + 1}`).join(', ')} estações.`), h('p.muted.small', `Preço ${money(sp.p)} · hipoteca ${money(sp.p / 2)}`));
        else if (sp.t === 'utility') box.append(h('p', `Aluguel: ${Magnata.UTIL_MULT[0]} × o valor dos dados com 1 companhia, ${Magnata.UTIL_MULT[1]} × com as duas.`), h('p.muted.small', `Preço ${money(sp.p)} · hipoteca ${money(sp.p / 2)}`));
        else box.append(h('p.muted', {
          go: `Ao passar ou parar aqui, receba ${money(Magnata.GO_BONUS)}.`, jail: 'Só visitando, ou preso. Para sair: dupla nos dados, fiança de R$ 50 ou carta.',
          parking: 'Descanse: nada acontece aqui.', gotojail: 'Vá direto para a prisão, sem passar pelo Início.', tax: `Pague ${money(sp.amount || 0)} ao banco.`,
          sorte: 'Tire uma carta de Sorte.', cofre: 'Tire uma carta do Cofre.'
        }[sp.t] || ''));
        if (s && Magnata.BUYABLE.has(sp.t)) {
          box.append(h('p', o === undefined ? h('span.muted', 'Sem dono.') : [h('b', 'Dono: '), s.players[o].name,
            n ? ` · ${n === 5 ? 'hotel' : n + (n === 1 ? ' casa' : ' casas')}` : '', s.mortgaged[i] ? ' · hipotecada' : '',
            !s.mortgaged[i] ? ` · aluguel agora ${money(Magnata.rent(s, i, 7))}${sp.t === 'utility' ? ' (com 7 nos dados)' : ''}` : '']));
          if (o === me && me !== null && s.phase !== 'over') {
            const row = h('div.controls');
            const a = (label, type) => h('button.btn.small', { type: 'button', onclick: async () => { await this.act({ type, idx: i }); close(); } }, label);
            if (sp.t === 'prop' && !s.mortgaged[i]) {
              if (n < 5) row.append(a(n === 4 ? `Construir hotel (${money(GROUPS[sp.g][2])})` : `Construir casa (${money(GROUPS[sp.g][2])})`, 'build'));
              if (n) row.append(a(`Vender ${n === 5 ? 'hotel' : 'casa'} (+${money(GROUPS[sp.g][2] / 2)})`, 'sell'));
            }
            if (!s.mortgaged[i] && !n) row.append(a(`Hipotecar (+${money(sp.p / 2)})`, 'mortgage'));
            if (s.mortgaged[i]) row.append(a(`Tirar hipoteca (${money(Magnata.unmortgageCost(i))})`, 'unmortgage'));
            box.append(row);
          }
        }
        box.append(h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Fechar')));
      });
    },
    playerModal(i) {
      const s = this.s, p = s.players[i], props = Magnata.owned(s, i).sort((a, b) => a - b);
      modal((box, close) => box.append(
        h('h2', p.name),
        h('p.muted', `Dinheiro ${money(p.money)} · patrimônio ${money(Magnata.worth(s, i))}${p.jailCards.length ? ` · ${p.jailCards.length} carta(s) de saída da prisão` : ''}`),
        props.length ? h('div.mchips', props.map(k => h('button.mchip' + (s.mortgaged[k] ? '.mort' : ''), { type: 'button', style: { '--c': BOARD[k].g ? GROUPS[BOARD[k].g][1] : 'var(--muted)' }, onclick: () => this.propModal(k) },
          BOARD[k].name, s.houses[k] ? h('b', s.houses[k] === 5 ? ' ★' : ' ' + '⌂'.repeat(s.houses[k])) : null))) : h('p.muted', 'Nenhuma propriedade.'),
        h('div.row', this.me !== null && i !== this.me && !p.out && s.phase !== 'over' ? h('button.btn', { type: 'button', onclick: () => { close(); this.tradeModal(i); } }, 'Propor troca') : null,
          h('button.btn', { type: 'button', onclick: close }, 'Fechar'))));
    },
    tradeModal(target) {
      const s = this.s, me = this.me;
      if (s.trade) return toast('Já existe uma proposta de troca em andamento.', { err: true });
      const others = Magnata.active(s).filter(i => i !== me);
      if (!others.length) return;
      let to = others.includes(target) ? target : others[0];
      const tradable = seat => Magnata.owned(s, seat).filter(i => !BOARD[i].g || !Magnata.groupOf(BOARD[i].g).some(k => s.houses[k])).sort((a, b) => a - b);
      const giveSet = new Set(), getSet = new Set();
      modal((box, close) => {
        const giveMoney = h('input', { type: 'number', min: 0, max: s.players[me].money, step: 100, value: 0 });
        const getMoney = h('input', { type: 'number', min: 0, step: 100, value: 0 });
        const colGive = h('div.mtrade-pick'), colGet = h('div.mtrade-pick');
        const pick = (set, list, el) => el.replaceChildren(...(list.length ? list.map(i => {
          const b = h('button.mchip' + (s.mortgaged[i] ? '.mort' : ''), { type: 'button', style: { '--c': BOARD[i].g ? GROUPS[BOARD[i].g][1] : 'var(--muted)' }, onclick: () => { set.has(i) ? set.delete(i) : set.add(i); b.classList.toggle('on', set.has(i)); } }, BOARD[i].name);
          b.classList.toggle('on', set.has(i));
          return b;
        }) : [h('span.muted.small', 'Nada para trocar (propriedades com casas na cor não podem ser trocadas).')]));
        const seg = h('div.seg');
        const paint = () => {
          seg.replaceChildren(...others.map(i => h('button', { type: 'button', class: i === to ? 'on' : null, onclick: () => { to = i; getSet.clear(); paint(); } }, s.players[i].name)));
          pick(giveSet, tradable(me), colGive);
          pick(getSet, tradable(to), colGet);
          getMoney.max = s.players[to].money;
        };
        paint();
        const send = async () => {
          try {
            await api(`/magnata/${this.id}/act`, { type: 'trade', to, give: { money: Math.max(0, Math.round(+giveMoney.value || 0)), props: [...giveSet] }, get: { money: Math.max(0, Math.round(+getMoney.value || 0)), props: [...getSet] } });
            close(); toast('Proposta enviada.');
          } catch (e) { errToast(e); }
        };
        box.append(h('h2', 'Propor troca'), h('p.section-title', 'Com quem'), seg,
          h('div.mtrade-cols',
            h('div', h('p.section-title', 'Você dá'), colGive, h('label.field', 'Dinheiro (R$)', giveMoney)),
            h('div', h('p.section-title', 'Você pede'), colGet, h('label.field', 'Dinheiro (R$)', getMoney))),
          h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: send }, 'Enviar proposta')));
      });
      $('#modalBox').classList.add('wide');
    }
  };

  // Entrar/sair da tela cheia (inclusive pelo Esc) reposiciona os peões e troca o rótulo do botão
  document.addEventListener('fullscreenchange', () => { if (G.active && G.d) G.render(); });

  return { Magnata: { open: id => G.open(id), close: () => G.close(), lobbySection } };
});

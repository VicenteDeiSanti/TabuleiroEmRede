// Tabuleiro em Rede — mesa de Truco no navegador (o servidor decide tudo e só manda as suas cartas).
// Usa as rotas de mesa do Magnata (/api/magnata/...), com game = 'truco'.
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast, modal, go } = T;
  const { SUIT_ICON, MAN_NAME, RAISE_NAME, GOAL, PAWNS, power } = Truco;
  const RED = new Set(['h', 'd']);
  const POS = { 2: ['bottom', 'top'], 4: ['bottom', 'right', 'top', 'left'] };

  // Carta desenhada (null = verso)
  function cardEl(c, opts = {}) {
    if (!c) return h('div.tcard.back' + (opts.cls || ''));
    const r = c[0], s = c[1], ic = SUIT_ICON[s] + '︎';   // ︎: naipe como texto, não emoji
    return h('div.tcard' + (RED.has(s) ? '.red' : '') + (opts.man ? '.man' : '') + (opts.cls || ''), { title: opts.title || null },
      h('span.tc-r', r, h('small', ic)), h('span.tc-s', ic), h('span.tc-r.rot', r, h('small', ic)),
      opts.man ? h('span.tc-man', '★ ' + MAN_NAME[s]) : null);
  }

  /* ==================== Lobby ==================== */
  function lobbySection(list) {
    const rows = list.map(r => h('div.room-row' + (r.mine ? '.mine' : ''),
      h('span.gicon', { title: 'Truco' }, '🃏'),
      h('div', { style: { minWidth: 0 } }, h('div.rname', r.name), h('div.meta', h('span', r.players.map(p => p.name).join(', ') || '—'), r.private ? h('span', '· privada') : null)),
      r.over ? h('span.pill', 'Encerrada') : r.started ? h('span.pill.live', 'Jogando') : h('span.pill.wait', `${r.players.length}/4 · 2 ou 4`),
      h('button.btn' + (!r.mine && !r.started ? '.primary' : ''), { type: 'button', onclick: () => go({ truco: r.id }) }, r.over ? 'Ver' : r.mine ? 'Abrir' : r.started ? 'Assistir' : 'Entrar')));
    return h('section.mag-lobby',
      h('div.list-head', h('h2', 'Truco ', h('small.muted', '1×1 ou duplas')), h('button.btn.small.primary', { type: 'button', onclick: createDialog }, 'Nova mesa')),
      h('div.rooms', rows.length ? rows : h('div.empty', 'Nenhuma mesa de Truco. Crie uma e chame a galera: 2 para mano a mano ou 4 para duplas!')));
  }
  function createDialog() {
    modal((box, close) => {
      const name = h('input', { maxlength: 40, placeholder: 'Ex.: Truco do intervalo' });
      const priv = h('input', { type: 'checkbox' });
      const submit = async () => {
        try { const r = await api('/magnata', { game: 'truco', name: name.value, private: priv.checked }); close(); go({ truco: r.id }); }
        catch (e) { errToast(e); }
      };
      box.append(h('h2', 'Nova mesa de Truco'),
        h('p.muted', 'Truco paulista com vira e manilha. Jogue mano a mano (2) ou em duplas (4). Quem fizer 12 pontos primeiro vence.'),
        h('label.field', 'Nome da mesa (opcional)', name),
        h('label.switch', h('span.lbl', 'Mesa privada', h('small', 'Só entra quem tiver o link; depois de começar, todos podem assistir')), priv, h('span.tg')),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: submit }, 'Criar mesa')));
    });
  }

  /* ==================== Mesa ==================== */
  const G = {
    id: null, d: null, es: null, active: false, seen: new Set(), lastPending: 0, lastHand: 0, covered: false, timers: [], notified: false,
    get s() { return this.d && this.d.state; },
    get me() { return this.d && this.d.you !== null && this.d.you >= 0 ? this.d.you : null; },
    get view() { return this.me === null ? 0 : this.me; },   // de onde a mesa é vista (espectador vê do lugar 1)
    myTeam() { return this.s && this.me !== null ? this.s.players[this.me].team : 0; },

    async open(id) {
      if (this.id !== id) { this.close(); this.id = id; this.d = null; }
      this.active = true;
      const root = $('#v-truco');
      if (!this.d) { this.built = false; root.replaceChildren(h('p.muted', 'Abrindo a mesa…')); }
      try {
        const d = await api('/magnata/' + id);
        if (this.id !== id) return;
        if (d.game !== 'truco') return go({ [d.game || 'magnata']: id }, true);
        this.update(d);
        this.connect(id);
      } catch (e) { errToast(e); go({ v: 'jogar', jogo: 'truco' }, true); }
    },
    close() {
      this.active = false;
      if (this.es) { this.es.close(); this.es = null; }
      clearInterval(this.tick); this.tick = null;
      this.timers.forEach(clearTimeout); this.timers = [];
      this.id = null; this.d = null; this.built = false; this.seen = new Set();
    },
    later(ms, fn) { this.timers.push(setTimeout(() => { if (this.active) fn(); }, ms)); },
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
          catch (err) { toast('A mesa foi encerrada.'); go({ v: 'jogar', jogo: 'truco' }, true); }
        }, 3000);
      };
      clearInterval(this.tick);
      this.tick = setInterval(() => { if (this.s && this.s.waitingAwayMs) { this.s.waitingAwayMs += 1000; this.renderActions(); } }, 1000);
    },
    async act(a) {
      try { await api(`/magnata/${this.id}/act`, a); }
      catch (e) { errToast(e); }
    },

    update(d) {
      const prev = this.s;
      this.d = d;
      const s = d.state;
      if (s && prev) {
        // Grito de truco, resultado da mão e fim de jogo
        if (s.pending && s.pending.n !== this.lastPending) {
          const p = s.players[s.pending.seat];
          this.shout(RAISE_NAME[s.pending.to] + '!', p.name, p.team === this.myTeam() || this.me === null ? 'mine' : 'theirs');
          Sound.play('truco');
        } else if (prev.phase === 'raise' && s.phase === 'play' && !s.pending && prev.handN === s.handN) {
          this.shout('CAI DENTRO!', `Vale ${s.value}`, 'ok'); Sound.play('start');
        }
        if (s.last && s.last.n !== this.lastHand) this.handResult(s.last, s);
        if (prev.plays.length < s.plays.length || prev.handN !== s.handN || prev.tricks.length !== s.tricks.length) Sound.play('card');
        if (prev.phase !== 'over' && s.phase === 'over') Sound.play(s.winner === this.myTeam() && this.me !== null ? 'win' : 'lose');
      }
      if (s) { this.lastPending = s.pending ? s.pending.n : 0; this.lastHand = s.last ? s.last.n : 0; }
      const mine = !!(s && this.needsMe());
      if (mine && !this.notified && prev) Sound.play('notify');
      this.notified = mine;
      document.title = (mine ? '● ' : '') + d.name + ' · Truco';
      this.render();
    },
    needsMe() {
      const s = this.s, me = this.me;
      if (!s || me === null || s.phase === 'over') return false;
      const t = s.players[me].team;
      if (s.phase === 'raise') return s.pending.team !== t;
      if (s.phase === 'eleven') return s.elevenTeam === t;
      return s.turn === me;
    },
    shout(text, who, cls) {
      const el = h('div.tshout.' + cls, h('b', text), who ? h('span', who) : null);
      this.table && this.table.append(el);
      setTimeout(() => el.remove(), 1700);
    },
    handResult(last, s) {
      const mine = this.me !== null && last.team === this.myTeam();
      const label = this.me === null ? Truco.TEAM_NAME[last.team] : mine ? 'NÓS' : 'ELES';
      this.later(700, () => {
        const el = h('div.tresult' + (this.me === null ? '' : mine ? '.win' : '.lose'), h('b', `${label} +${last.pts}`), h('span', last.why));
        this.table && this.table.append(el);
        Sound.play(mine ? 'coin' : 'pay');
        setTimeout(() => el.remove(), 2600);
      });
    },

    /* ---------- Desenho ---------- */
    render() {
      const root = $('#v-truco'), d = this.d;
      if (!this.built || !root.contains(this.table)) this.build(root);
      $('#tTitle').textContent = d.name;
      $('#tTags').replaceChildren(...[h('span.pill', '🃏 Truco paulista'), d.private ? h('span.pill', 'Privada') : null, d.spectators ? h('span.pill', `👀 ${d.spectators} assistindo`) : null].filter(Boolean));
      this.renderTable();
      this.renderHand();
      this.renderActions();
      this.renderPlayers();
      $('#tLog').replaceChildren(...(this.s ? this.s.log.slice(-40).reverse().map(l => h('div.mlogline', l.t)) : [h('p.muted', 'O jogo ainda não começou.')]));
      const log = $('#tChatLog'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      log.replaceChildren(...d.chat.map(m => m.n ? h('div.msg', h('b', m.n + ': '), m.t) : h('div.msg.sys', m.t)));
      if (atEnd || !this.chatScrolled) { log.scrollTop = log.scrollHeight; this.chatScrolled = true; }
    },
    build(root) {
      this.built = true;
      this.table = h('div.ttable');
      this.handEl = h('div.thand');
      root.replaceChildren(h('div.mgame.tgame',
        h('div.tcol', this.table, this.handEl),
        h('aside.side',
          h('div.game-head', h('h1#tTitle', ''), h('div.tags#tTags')),
          h('div#tActions'),
          h('div#tPlayers.mhud'),
          h('div.card.mlog', h('p.section-title', 'Acontecimentos'), h('div#tLog.mlogbox')),
          h('div.chat',
            h('div.chat-log#tChatLog', { 'aria-live': 'polite' }),
            h('div.quick', ['Truco!', 'Tô sem nada', 'Tenho manilha 😏', 'Vai que é tua!', 'Corre!', 'Boa, parceiro!'].map(t => h('button', { type: 'button', onclick: () => this.sendChat(t) }, t))),
            h('form', { autocomplete: 'off', onsubmit: e => { e.preventDefault(); const i = $('#tChatInput'); this.sendChat(i.value); i.value = ''; } },
              h('input#tChatInput', { maxlength: 300, placeholder: 'Mensagem' }), h('button.btn.small', { type: 'submit' }, 'Enviar'))))));
    },
    async sendChat(text) {
      text = (text || '').trim();
      if (!text) return;
      try { await api(`/magnata/${this.id}/chat`, { text }); } catch (err) { errToast(err); }
    },

    renderTable() {
      const s = this.s, d = this.d, kids = [];
      if (!s) {
        kids.push(h('div.tcenter', h('div.tlogo', 'TRUCO'), h('div.tsub', `${d.seats.length} na mesa · joga com 2 ou 4`),
          d.creator === T.me().id ? h('button.gbtn.go', { type: 'button', disabled: ![2, 4].includes(d.seats.length) || null, onclick: () => api(`/magnata/${d.id}/start`, {}).catch(errToast) }, '▶ COMEÇAR')
            : !d.joined && d.seats.length < 4 ? h('button.gbtn.go', { type: 'button', onclick: () => api(`/magnata/${d.id}/join`, {}).catch(errToast) }, '🪑 SENTAR')
              : h('div.tsub', 'Esperando o anfitrião começar…')));
        return this.table.replaceChildren(...kids, ...[...this.table.querySelectorAll('.tshout, .tresult')]);
      }
      const n = s.players.length, pos = POS[n] || POS[4], my = this.myTeam();
      // Placar
      const us = this.me === null ? 0 : my, them = 1 - us;
      kids.push(h('div.tscore',
        h('div.ts-team', { style: { '--c': PAWNS[us].color } }, h('small', this.me === null ? 'DUPLA A' : 'NÓS'), h('b', s.score[us])),
        h('div.ts-mid', h('span', `até ${GOAL}`), h('div.ts-val', s.pending ? `${RAISE_NAME[s.pending.to]}?` : `vale ${s.value}`)),
        h('div.ts-team', { style: { '--c': PAWNS[them].color } }, h('small', this.me === null ? 'DUPLA B' : 'ELES'), h('b', s.score[them]))));
      // Vazas da mão atual
      kids.push(h('div.ttricks', [0, 1, 2].map(i => {
        const t = s.tricks[i];
        return h('i' + (!t ? '' : t.team === -1 ? '.tie' : t.team === us ? '.win' : '.lose'), { title: !t ? `Vaza ${i + 1}` : t.team === -1 ? 'Empate' : t.team === us ? 'Ganhou' : 'Perdeu' });
      })));
      // Jogadores em volta da mesa
      s.players.forEach((p, i) => {
        const rel = (i - this.view + n) % n, side = pos[rel];
        const active = s.phase === 'play' && s.turn === i;
        kids.push(h('div.tseat.' + side + (active ? '.turn' : '') + (p.out ? '.out' : ''), { style: { '--c': p.color } },
          h('div.tname', h('span.tdot'), p.name, i === s.lead ? h('span.tbadge', 'MÃO') : null, i === this.me ? h('span.tbadge.you', 'VOCÊ') : null),
          rel === 0 && this.me !== null ? null : h('div.tbacks', Array.from({ length: p.cards }, () => cardEl(null, { cls: '.mini' })))));
      });
      // Vira e baralho
      kids.push(h('div.tdeck', h('div.tstack', cardEl(null), cardEl(null)), h('div.tvira', cardEl(s.vira), h('small', `VIRA · manilha ${s.manilha}`))));
      // Cartas na mesa (vaza atual)
      const played = s.plays.length ? s.plays : [];
      kids.push(h('div.tplays', played.map(pl => {
        const rel = (pl.seat - this.view + n) % n, key = `${s.handN}-${s.tricks.length}-${pl.seat}`;
        const fresh = !this.seen.has(key); this.seen.add(key);
        return h('div.tplay.' + pos[rel] + (fresh ? '.fly' : ''), cardEl(pl.covered ? null : pl.card, { man: pl.card && pl.card[0] === s.manilha }));
      })));
      // Painéis no centro: pedido de truco, mão de onze, fim de jogo
      const panel = this.centerPanel();
      if (panel) kids.push(panel);
      this.table.replaceChildren(...kids, ...[...this.table.querySelectorAll('.tshout, .tresult')]);
      this.table.dataset.n = n;
    },
    centerPanel() {
      const s = this.s, d = this.d, me = this.me, my = this.myTeam();
      const btn = (label, fn, cls = '') => h('button.gbtn' + cls, { type: 'button', onclick: fn }, label);
      if (s.phase === 'over') {
        const won = me !== null && s.winner === my;
        return h('div.tpanel.big', h('div.trophy', won || me === null ? '🏆' : '😵'),
          h('b', me === null ? `${Truco.TEAM_NAME[s.winner]} venceu!` : won ? 'VOCÊS VENCERAM!' : 'VOCÊS PERDERAM'),
          h('span', `${s.score[0]} × ${s.score[1]}`),
          d.creator === T.me().id ? btn('↻ JOGAR DE NOVO', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.go') : null);
      }
      if (s.phase === 'raise') {
        const p = s.players[s.pending.seat];
        if (me !== null && s.pending.team !== my) {
          const nextUp = s.pending.to < GOAL ? RAISE_NAME[[3, 6, 9, 12][[3, 6, 9, 12].indexOf(s.pending.to) + 1]] : null;
          return h('div.tpanel.alert', h('b.shake', `${p.name} pediu ${RAISE_NAME[s.pending.to]}!`), h('span', `Aceitar vale ${s.pending.to}. Correr dá ${s.value} para eles.`),
            h('div.grow', btn('✔ ACEITAR', () => this.act({ type: 'accept' }), '.go'), btn('🏃 CORRER', () => this.act({ type: 'run' })),
              nextUp ? btn(`🔥 ${nextUp}!`, () => this.act({ type: 'raise' }), '.red') : null));
        }
        return h('div.tpanel', h('b', `${p.name} pediu ${RAISE_NAME[s.pending.to]}!`), h('span', 'Esperando a resposta', h('span.dots', h('i', '.'), h('i', '.'), h('i', '.'))));
      }
      if (s.phase === 'eleven') {
        if (me !== null && s.elevenTeam === my) return h('div.tpanel.alert', h('b', 'MÃO DE ONZE!'), h('span', 'Olhe suas cartas: jogar vale 3 pontos; correr dá 1 ponto para eles.'),
          h('div.grow', btn('🃏 JOGAR', () => this.act({ type: 'eleven', play: true }), '.go'), btn('🏃 CORRER', () => this.act({ type: 'eleven', play: false }))));
        return h('div.tpanel', h('b', 'Mão de onze'), h('span', 'Eles estão decidindo se jogam', h('span.dots', h('i', '.'), h('i', '.'), h('i', '.'))));
      }
      return null;
    },
    // Sua mão + botões de truco e carta coberta
    renderHand() {
      const s = this.s, me = this.me, box = this.handEl;
      if (!s || me === null || s.phase === 'over') return box.replaceChildren();
      const p = s.players[me], myTurn = s.phase === 'play' && s.turn === me;
      const canCover = s.tricks.length > 0;
      if (!canCover) this.covered = false;
      const cards = p.hand.map((c, i) => {
        const el = cardEl(c, { man: c[0] === s.manilha, cls: '.big' + (myTurn ? '.playable' : '') });
        el.style.setProperty('--i', i - (p.hand.length - 1) / 2);
        el.onclick = () => { if (myTurn) this.act({ type: 'play', card: i, covered: this.covered }); };
        return el;
      });
      // Pedir truco: na sua vez, se a sua dupla não foi a última a pedir
      const nextVal = [1, 3, 6, 9, 12][[1, 3, 6, 9, 12].indexOf(s.value) + 1];
      const canRaise = myTurn && !s.noRaise && s.raiser !== p.team && nextVal;
      box.replaceChildren(
        h('div.th-cards' + (this.covered ? '.covering' : ''), cards),
        h('div.th-btns',
          canRaise ? h('button.gbtn.red.truco' + (myTurn ? '.pulse' : ''), { type: 'button', onclick: () => this.act({ type: 'raise' }) }, `${RAISE_NAME[nextVal]}!`) : null,
          canCover && myTurn ? h('button.gbtn' + (this.covered ? '.go' : ''), { type: 'button', onclick: () => { this.covered = !this.covered; this.renderHand(); } }, this.covered ? '🂠 COBERTA: SIM' : '🂠 Jogar coberta') : null,
          h('div.th-msg', myTurn ? (this.covered ? 'Toque na carta para jogá-la virada' : '👆 Sua vez: toque numa carta') : s.phase === 'play' ? `Vez de ${s.players[s.turn].name}` : '')));
    },
    renderActions() {
      const box = $('#tActions'), d = this.d, s = this.s, me = this.me;
      if (!box) return;
      const btn = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      const out = [];
      if (!s) {
        out.push(h('div.status', ![2, 4].includes(d.seats.length) ? 'Truco é com 2 (mano a mano) ou 4 jogadores (duplas).' : d.creator === T.me().id ? 'Tudo pronto! Comece quando quiser.' : 'Esperando quem criou a mesa começar.'));
        if (d.joined) {
          const mineP = (d.seats.find(p => p.id === T.me().id) || {}).pawn, taken = {};
          for (const p of d.seats) taken[p.pawn] = p;
          out.push(h('div.card.pawnpick', h('p.section-title', 'Escolha seu lugar (parceiros ficam de frente)'),
            h('div.pawngrid', PAWNS.map((pw, i) => {
              const by = taken[i], isMine = i === mineP;
              return h('button.pawnbtn' + (isMine ? '.on' : ''), { type: 'button', style: { '--c': pw.color }, disabled: (by && !isMine) || null,
                onclick: () => api(`/magnata/${d.id}/pawn`, { pawn: i }).catch(errToast) }, h('span.em', i % 2 ? 'B' : 'A'), h('small', by ? by.name : pw.name));
            }))));
        }
        const row = h('div.controls');
        if (!d.joined && d.seats.length < 4) row.append(btn('Sentar à mesa', () => api(`/magnata/${d.id}/join`, {}).catch(errToast), '.primary'));
        if (d.joined) row.append(btn('Sair da mesa', async () => { try { await api(`/magnata/${d.id}/leave`, {}); go({ v: 'jogar', jogo: 'truco' }); } catch (e) { errToast(e); } }));
        const url = location.origin + '/?truco=' + d.id;
        out.push(row, h('div.share', h('span.muted', 'Convide pelo link: '), h('code', url),
          h('button.btn.small', { type: 'button', onclick: () => navigator.clipboard.writeText(url).then(() => toast('Link copiado.'), () => toast(url)) }, 'Copiar')));
        return box.replaceChildren(...out);
      }
      if (s.phase === 'over') return box.replaceChildren(h('div.controls', btn('Voltar', () => go({ v: 'jogar', jogo: 'truco' }))));
      if (me === null) out.push(h('div.status', '👀 Você está assistindo (as cartas dos jogadores ficam escondidas).'));
      if (me !== null && s.waitingAwayMs) {
        const left = Math.ceil((d.awayLimit - s.waitingAwayMs) / 1000);
        out.push(h('div.offer', 'Um jogador está desconectado.', left > 0 ? h('span.muted', ` Em ${left} s dá para encerrar o jogo.`) : btn('Encerrar (W.O.)', () => this.act({ type: 'kick' }), '.small.danger')));
      }
      if (me !== null) out.push(h('div.controls', btn('🏳 Abandonar', () => modal((b, close) => b.append(h('h2', 'Abandonar o jogo?'), h('p.muted', 'Sua dupla perde a partida.'),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: () => { close(); this.act({ type: 'bankrupt' }); } }, 'Abandonar')))), '.small.danger')));
      box.replaceChildren(...out);
    },
    renderPlayers() {
      const s = this.s, d = this.d, box = $('#tPlayers');
      const online = new Set(d.seats.filter(p => p.online).map(p => p.id));
      if (!s) {
        box.replaceChildren(...d.seats.map(p => h('div.hud-p', h('span.lc-dot.big' + (p.online ? '.on' : ''), { style: { '--c': PAWNS[p.pawn].color } }, p.pawn % 2 ? 'B' : 'A'),
          h('div.info', h('div.nm', p.name, p.id === d.creator ? h('span.hb', '⭐ anfitrião') : null), h('small', PAWNS[p.pawn].name)))));
        return;
      }
      box.replaceChildren(...s.players.map((p, i) => h('div.hud-p' + (s.phase === 'play' && s.turn === i ? '.cur' : '') + (i === this.me ? '.me' : '') + (s.winner === p.team ? '.win' : ''),
        h('span.lc-dot.big' + (online.has(p.pid) ? '.on' : ''), { style: { '--c': p.color } }, p.team ? 'B' : 'A'),
        h('div.info', h('div.nm', p.name, i === this.me ? h('span.hb.you', 'VOCÊ') : null), h('small', Truco.TEAM_NAME[p.team])),
        h('div.cash', h('b', s.score[p.team]), h('small', 'pontos')))));
    }
  };

  return { Truco: { open: id => G.open(id), close: () => G.close(), lobbySection } };
});

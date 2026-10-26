// Tabuleiro em Rede — mesa de Ludo no navegador (o servidor decide tudo; aqui só desenha e envia ações).
// Usa as mesmas rotas de mesa do Magnata (/api/magnata/...), com game = 'ludo'.
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast, modal, go } = T;
  const { PAWNS, START, FINISH, LAST, SAFE } = Ludo;
  const HOP_MS = 150, ROLL_MS = 650;

  /* ==================== Geometria do tabuleiro (grade 15×15) ==================== */
  // Percurso de 52 casas no sentido horário, começando na saída do vermelho
  const PATH = [];
  for (let c = 1; c <= 5; c++) PATH.push([6, c]);
  for (let r = 5; r >= 0; r--) PATH.push([r, 6]);
  PATH.push([0, 7]);
  for (let r = 0; r <= 5; r++) PATH.push([r, 8]);
  for (let c = 9; c <= 14; c++) PATH.push([6, c]);
  PATH.push([7, 14]);
  for (let c = 14; c >= 9; c--) PATH.push([8, c]);
  for (let r = 9; r <= 14; r++) PATH.push([r, 8]);
  PATH.push([14, 7]);
  for (let r = 14; r >= 9; r--) PATH.push([r, 6]);
  for (let c = 5; c >= 0; c--) PATH.push([8, c]);
  PATH.push([7, 0], [6, 0]);
  const BASE = [[0, 0], [0, 9], [9, 9], [9, 0]];                 // canto de cada base (6×6)
  const SPOTS = [[2, 2], [2, 4], [4, 2], [4, 4]];                 // lugares das 4 peças dentro da base
  const HOMECOL = [k => [7, k], k => [k, 7], k => [7, 14 - k], k => [14 - k, 7]]; // reta final (k = 1..5)
  const CENTER = [[7.5, 6.35], [6.35, 7.5], [7.5, 8.65], [8.65, 7.5]];          // onde ficam as peças que chegaram
  // Centro (linha, coluna) da peça k da cor c na posição r
  function spot(c, r, k) {
    if (r === -1) { const [br, bc] = BASE[c], [sr, sc] = SPOTS[k]; return [br + sr, bc + sc]; }
    if (r === FINISH) { const [y, x] = CENTER[c]; return [y + (k % 2 ? 0.28 : -0.28) * (c % 2 ? 1 : 0), x + (k % 2 ? 0.28 : -0.28) * (c % 2 ? 0 : 1)]; }
    const [y, x] = r <= LAST ? PATH[Ludo.abs(c, r)] : HOMECOL[c](r - LAST);
    return [y + 0.5, x + 0.5];
  }
  const pathOf = (from, to) => (from === -1 ? [0] : Array.from({ length: to - from }, (_, i) => from + i + 1));

  /* ==================== Lobby ==================== */
  function lobbySection(list) {
    const rows = list.map(r => {
      const pill = r.over ? h('span.pill', 'Encerrada') : r.started ? h('span.pill.live', 'Jogando') : h('span.pill.wait', `${r.players.length}/${r.maxSeats} jogadores`);
      return h('div.room-row' + (r.mine ? '.mine' : ''),
        h('span.gicon', { title: 'Ludo' }, '🎲'),
        h('div', { style: { minWidth: 0 } }, h('div.rname', r.name), h('div.meta', h('span', r.players.map(p => p.name).join(', ') || '—'), r.private ? h('span', '· privada') : null)),
        pill,
        h('button.btn' + (!r.mine && !r.started ? '.primary' : ''), { type: 'button', onclick: () => go({ ludo: r.id }) }, r.over ? 'Ver' : r.mine ? 'Abrir' : r.started ? 'Assistir' : 'Entrar'));
    });
    return h('section.mag-lobby',
      h('div.list-head', h('h2', 'Ludo ', h('small.muted', '2 a 4 jogadores')), h('button.btn.small.primary', { type: 'button', onclick: createDialog }, 'Nova mesa')),
      h('div.rooms', rows.length ? rows : h('div.empty', 'Nenhuma mesa de Ludo. Crie uma e chame até 3 amigos!')));
  }
  function createDialog() {
    modal((box, close) => {
      const name = h('input', { maxlength: 40, placeholder: 'Ex.: Ludo da turma' });
      const priv = h('input', { type: 'checkbox' });
      const submit = async () => {
        try { const r = await api('/magnata', { game: 'ludo', name: name.value, private: priv.checked }); close(); go({ ludo: r.id }); }
        catch (e) { errToast(e); }
      };
      box.append(h('h2', 'Nova mesa de Ludo'),
        h('p.muted', 'Tire 6 para sair da base, dê a volta no tabuleiro e leve as 4 peças ao centro. Cair em cima de um adversário o manda de volta para a base!'),
        h('label.field', 'Nome da mesa (opcional)', name),
        h('label.switch', h('span.lbl', 'Mesa privada', h('small', 'Só entra quem tiver o link; depois de começar, todos podem assistir')), priv, h('span.tg')),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: submit }, 'Criar mesa')));
    });
  }

  /* ==================== Mesa ==================== */
  const dieEl = v => h('span.die', { dataset: { v } }, Array.from({ length: v }, () => h('i')));
  const G = {
    id: null, d: null, es: null, active: false, shown: null, tokEls: {}, timers: [], busyUntil: 0, rollingUntil: 0, lastRoll: 0, notified: false,
    get s() { return this.d && this.d.state; },
    get me() { return this.d && this.d.you !== null && this.d.you >= 0 ? this.d.you : null; },
    get busy() { return Date.now() < this.busyUntil; },

    async open(id) {
      if (this.id !== id) { this.close(); this.id = id; this.d = null; }
      this.active = true;
      const root = $('#v-ludo');
      if (!this.d) { this.built = false; root.replaceChildren(h('p.muted', 'Abrindo a mesa…')); }
      try {
        const d = await api('/magnata/' + id);
        if (this.id !== id) return;
        if (d.game !== 'ludo') return go({ [d.game || 'magnata']: id }, true);
        this.update(d);
        this.connect(id);
      } catch (e) { errToast(e); go({ v: 'jogar', jogo: 'ludo' }, true); }
    },
    close() {
      this.active = false;
      if (this.es) { this.es.close(); this.es = null; }
      clearInterval(this.tick); this.tick = null;
      this.clearTimers();
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
          catch (err) { toast('A mesa foi encerrada.'); go({ v: 'jogar', jogo: 'ludo' }, true); }
        }, 3000);
      };
      clearInterval(this.tick);
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
      if (!s) this.shown = null;
      else if (!prev || !this.shown || this.shown.length !== s.players.length || (prev.phase === 'over' && s.phase !== 'over')) {
        this.clearTimers();
        this.shown = s.players.map(p => p.pieces.slice());
        this.lastRoll = s.rollN;
        this.resetTokens();
      } else this.animate(prev, s);
      if (s) {
        const mine = this.me !== null && s.phase !== 'over' && s.turn === this.me;
        if (mine && !this.notified && prev) this.later(this.busyUntil - Date.now(), () => Sound.play('notify'));
        this.notified = mine;
        if (prev && prev.phase !== 'over' && s.phase === 'over') this.later(this.busyUntil - Date.now(), () => Sound.play(s.winner === this.me ? 'win' : 'start'));
      }
      document.title = (this.s && this.me !== null && this.s.turn === this.me && this.s.phase !== 'over' ? '● ' : '') + d.name + ' · Ludo';
      this.render();
    },
    animate(prev, s) {
      const now = Date.now();
      let t = Math.max(now, this.busyUntil);
      if (s.rollN !== this.lastRoll) {
        this.lastRoll = s.rollN;
        const start = t;
        this.later(start - now, () => { Sound.play('dice'); this.rollingUntil = start + ROLL_MS; this.renderControl(); });
        t += ROLL_MS;
        this.later(t - now, () => { this.rollingUntil = 0; this.renderControl(); });
      }
      // Peças que andaram (para a frente: pulando casa por casa)
      const back = [];
      s.players.forEach((p, i) => p.pieces.forEach((r, k) => {
        const from = this.shown[i][k];
        if (from === r) return;
        if (r === -1) { back.push([i, k]); return; }
        if (r < from) { this.later(t - now, () => { this.shown[i][k] = r; this.layoutTokens(); }); return; }
        const steps = pathOf(from, r);
        steps.forEach((pos, n) => this.later(t - now + (n + 1) * HOP_MS, () => { this.shown[i][k] = pos; this.layoutTokens(); this.hop(i, k); Sound.play('hop'); }));
        t += steps.length * HOP_MS;
        if (r === FINISH) this.later(t - now + 50, () => Sound.play('coin'));
      }));
      // Capturadas voltam para a base depois que a peça chega
      if (back.length) {
        t += 200;
        this.later(t - now, () => { for (const [i, k] of back) this.shown[i][k] = -1; this.layoutTokens(true); Sound.play('capture'); });
        t += 500;
      }
      // Quem saiu da partida some do tabuleiro
      s.players.forEach((p, i) => { if (p.out) this.shown[i] = p.pieces.slice(); });
      this.busyUntil = t;
      if (t > now) this.later(t - now + 20, () => this.render());
    },

    /* ---------- Peças ---------- */
    resetTokens() {
      for (const el of Object.values(this.tokEls)) el.remove();
      this.tokEls = {};
    },
    layoutTokens(slide) {
      const s = this.s;
      if (!this.tokLayer) return;
      if (!s || !this.shown) return this.resetTokens();
      const can = !this.busy && s.phase === 'move' && s.turn === this.me ? new Set(s.moves.map(m => m.piece)) : new Set();
      // Peças na mesma casa ficam lado a lado
      const groups = {};
      s.players.forEach((p, i) => p.out || this.shown[i].forEach((r, k) => {
        if (r === -1 || r === FINISH) return;
        const key = spot(p.c, r, k).join(',');
        (groups[key] = groups[key] || []).push(i + ':' + k);
      }));
      s.players.forEach((p, i) => this.shown[i].forEach((r, k) => {
        const id = i + ':' + k;
        let el = this.tokEls[id];
        if (!el) {
          el = h('button.lpiece', { type: 'button', style: { '--c': p.color }, title: p.name, onclick: () => this.pick(i, k) }, h('i'));
          this.tokLayer.append(el); this.tokEls[id] = el;
        }
        el.hidden = p.out;
        if (p.out) return;
        let [y, x] = spot(p.c, r, k);
        const g = groups[[y, x].join(',')];
        if (g && g.length > 1) { const n = g.indexOf(id), ang = (n / g.length) * Math.PI * 2; y += Math.sin(ang) * 0.22; x += Math.cos(ang) * 0.22; }
        el.style.top = (y / 15 * 100) + '%';
        el.style.left = (x / 15 * 100) + '%';
        el.classList.toggle('slide', !!slide);
        el.classList.toggle('small', !!(g && g.length > 1) || r === FINISH);
        el.classList.toggle('can', i === this.me && can.has(k));
        el.classList.toggle('done', r === FINISH);
        el.style.zIndex = i === s.turn ? 3 : 2;
      }));
    },
    hop(i, k) {
      const el = this.tokEls[i + ':' + k];
      if (!el) return;
      el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
    },
    pick(i, k) {
      const s = this.s;
      if (!s || i !== this.me || s.turn !== this.me || s.phase !== 'move' || this.busy) return;
      if (!s.moves.some(m => m.piece === k)) return toast('Essa peça não pode andar com esse número.', { err: true });
      this.act({ type: 'move', piece: k });
    },

    /* ---------- Desenho ---------- */
    render() {
      const root = $('#v-ludo'), d = this.d;
      if (!this.built || !root.contains(this.boardEl)) this.build(root);
      $('#lTitle').textContent = d.name;
      $('#lTags').replaceChildren(...[h('span.pill', '🎲 Ludo'), d.private ? h('span.pill', 'Privada') : null, d.spectators ? h('span.pill', `👀 ${d.spectators} assistindo`) : null].filter(Boolean));
      this.renderBoard();
      this.layoutTokens();
      this.renderControl();
      this.renderActions();
      this.renderPlayers();
      this.renderLog();
      this.renderChat();
    },
    build(root) {
      this.built = true;
      const b = h('div.lboard');
      // Bases
      BASE.forEach(([r, c], i) => b.append(h('div.lbase', { style: { gridRow: `${r + 1} / span 6`, gridColumn: `${c + 1} / span 6`, '--c': PAWNS[i].color } },
        h('div.lbase-in', SPOTS.map(() => h('span'))))));
      // Percurso
      this.pathEls = PATH.map(([r, c], i) => {
        const startOf = [0, 1, 2, 3].find(k => START(k) === i);
        const el = h('div.lcell' + (startOf !== undefined ? '.start' : SAFE.has(i) ? '.safe' : ''), { style: { gridRow: r + 1, gridColumn: c + 1, '--c': startOf !== undefined ? PAWNS[startOf].color : null } },
          startOf !== undefined ? '★' : SAFE.has(i) ? '☆' : null);
        b.append(el);
        return el;
      });
      // Retas finais
      for (let c = 0; c < 4; c++) for (let k = 1; k <= 5; k++) {
        const [r, col] = HOMECOL[c](k);
        b.append(h('div.lcell.home', { style: { gridRow: r + 1, gridColumn: col + 1, '--c': PAWNS[c].color } }));
      }
      // Centro
      b.append(h('div.lcenter', { style: { gridRow: '7 / span 3', gridColumn: '7 / span 3' } }));
      this.tokLayer = h('div.ltoklayer');
      this.tokEls = {};
      b.append(this.tokLayer);
      this.boardEl = b;
      this.control = h('div.lcontrol');
      root.replaceChildren(h('div.mgame.lgame',
        h('div.lboard-col', b, this.control),
        h('aside.side',
          h('div.game-head', h('h1#lTitle', ''), h('div.tags#lTags')),
          h('div#lActions'),
          h('div#lPlayers.mhud'),
          h('div.card.mlog', h('p.section-title', 'Acontecimentos'), h('div#lLog.mlogbox')),
          h('div.chat',
            h('div.chat-log#lChatLog', { 'aria-live': 'polite' }),
            h('form', { autocomplete: 'off', onsubmit: e => this.sendChat(e) },
              h('input#lChatInput', { maxlength: 300, placeholder: 'Mensagem' }), h('button.btn.small', { type: 'submit' }, 'Enviar'))))));
    },
    renderBoard() {
      // Destaca as bases de quem está jogando
      const s = this.s, used = new Set(s ? s.players.filter(p => !p.out).map(p => p.c) : this.d.seats.map(p => p.pawn));
      this.boardEl.querySelectorAll('.lbase').forEach((el, i) => el.classList.toggle('off', !used.has(i)));
    },
    // Barra embaixo do tabuleiro: vez, dado e botão grande
    renderControl() {
      const s = this.s, d = this.d, me = this.me, kids = [];
      const big = (label, fn, cls = '', dis) => h('button.gbtn' + cls, { type: 'button', onclick: fn, disabled: dis || null }, label);
      if (!s) {
        kids.push(h('div.lc-msg', `${d.seats.length} de ${d.maxSeats} jogadores na mesa`));
        if (!d.joined && d.seats.length < d.maxSeats) kids.push(big('🪑 SENTAR À MESA', () => api(`/magnata/${d.id}/join`, {}).catch(errToast), '.go'));
        else if (d.creator === T.me().id) kids.push(big('▶ COMEÇAR', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.go', d.seats.length < 2));
        else kids.push(h('div.lc-msg', 'Esperando o anfitrião começar…'));
        return this.control.replaceChildren(...kids);
      }
      if (s.phase === 'over' && !this.busy) {
        const w = s.players[s.winner];
        kids.push(h('div.lc-turn', h('span.lc-dot', { style: { '--c': w.color } }, '🏆'), h('div', h('small', 'VENCEDOR'), h('b', w.name))));
        if (d.creator === T.me().id) kids.push(big('↻ JOGAR DE NOVO', () => api(`/magnata/${d.id}/start`, {}).catch(errToast), '.go'));
        return this.control.replaceChildren(...kids);
      }
      const cur = s.players[s.turn], mine = s.turn === me;
      kids.push(h('div.lc-turn' + (mine ? '.mine' : ''), { style: { '--c': cur.color } }, h('span.lc-dot', { style: { '--c': cur.color } }),
        h('div', h('small', mine ? 'SUA VEZ' : 'VEZ DE'), h('b', cur.name))));
      const rolling = Date.now() < this.rollingUntil;
      if (s.dice || rolling) kids.push(h('div.dice' + (rolling ? '.rolling' : ''), dieEl(rolling ? 1 + Math.floor(Math.random() * 6) : s.dice)));
      if (rolling) this.later(100, () => { if (Date.now() < this.rollingUntil) this.renderControl(); });
      if (!this.busy) {
        if (mine && s.phase === 'roll') kids.push(big(s.dice === 6 || (s.last && (s.last.captured.length || s.last.to === FINISH)) ? '🎲 JOGAR DE NOVO' : '🎲 JOGAR DADO', () => this.act({ type: 'roll' }), '.go.pulse'));
        else if (mine && s.phase === 'move') kids.push(h('div.lc-msg.hint', '👆 Toque numa peça que está pulando'));
        else kids.push(h('div.lc-msg', `Aguardando ${cur.name}`, h('span.dots', h('i', '.'), h('i', '.'), h('i', '.'))));
      }
      this.control.replaceChildren(...kids);
      this.layoutTokens();
    },
    renderActions() {
      const box = $('#lActions'), d = this.d, s = this.s, me = this.me;
      if (!box) return;
      const btn = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      const out = [];
      if (!s) {
        out.push(h('div.status', d.seats.length < 2 ? 'Esperando mais jogadores (mínimo 2, máximo 4).' : d.creator === T.me().id ? 'Quando todos estiverem na mesa, comece a partida.' : 'Esperando quem criou a mesa começar.'));
        if (d.joined) {
          const mineC = (d.seats.find(p => p.id === T.me().id) || {}).pawn, taken = {};
          for (const p of d.seats) taken[p.pawn] = p;
          out.push(h('div.card.pawnpick', h('p.section-title', 'Escolha sua cor'),
            h('div.pawngrid', PAWNS.map((pw, i) => {
              const by = taken[i], isMine = i === mineC;
              return h('button.pawnbtn' + (isMine ? '.on' : ''), { type: 'button', style: { '--c': pw.color }, disabled: (by && !isMine) || null,
                onclick: () => api(`/magnata/${d.id}/pawn`, { pawn: i }).catch(errToast) }, h('span.em', ''), h('small', by && !isMine ? by.name : pw.name));
            }))));
        }
        const row = h('div.controls');
        if (!d.joined && d.seats.length < d.maxSeats) row.append(btn('Sentar à mesa', () => api(`/magnata/${d.id}/join`, {}).catch(errToast), '.primary'));
        if (d.joined) row.append(btn('Sair da mesa', async () => { try { await api(`/magnata/${d.id}/leave`, {}); go({ v: 'jogar', jogo: 'ludo' }); } catch (e) { errToast(e); } }));
        const url = location.origin + '/?ludo=' + d.id;
        out.push(row, h('div.share', h('span.muted', 'Convide pelo link: '), h('code', url),
          h('button.btn.small', { type: 'button', onclick: () => navigator.clipboard.writeText(url).then(() => toast('Link copiado.'), () => toast(url)) }, 'Copiar')));
        return box.replaceChildren(...out);
      }
      if (s.phase === 'over') {
        out.push(h('div.status.mover', `🏆 ${s.players[s.winner].name} venceu!`), h('div.controls', btn('Voltar', () => go({ v: 'jogar', jogo: 'ludo' }))));
        return box.replaceChildren(...out);
      }
      if (me === null) out.push(h('div.status', d.joined ? 'Você saiu da partida. Continue assistindo!' : `👀 Você está assistindo.`));
      if (me !== null && s.waitingAwayMs && s.turn !== me) {
        const left = Math.ceil((d.awayLimit - s.waitingAwayMs) / 1000);
        out.push(h('div.offer', `${s.players[s.turn].name} está desconectado.`, left > 0 ? h('span.muted', ` Em ${left} s você pode tirá-lo da partida.`)
          : btn('Tirar da partida', () => this.act({ type: 'kick' }), '.small.danger')));
      }
      if (me !== null) out.push(h('div.controls', btn('🏳 Desistir', () => modal((b, close) => b.append(h('h2', 'Desistir da partida?'), h('p.muted', 'Suas peças saem do tabuleiro.'),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'), h('button.btn.primary', { type: 'button', onclick: () => { close(); this.act({ type: 'bankrupt' }); } }, 'Desistir')))), '.small.danger')));
      box.replaceChildren(...out);
    },
    renderPlayers() {
      const s = this.s, d = this.d, box = $('#lPlayers');
      if (!s) {
        box.replaceChildren(...d.seats.map(p => h('div.hud-p', h('span.lc-dot.big' + (p.online ? '.on' : ''), { style: { '--c': (PAWNS[p.pawn] || {}).color } }),
          h('div.info', h('div.nm', p.name, p.id === d.creator ? h('span.hb', '⭐ anfitrião') : null), h('small', (PAWNS[p.pawn] || {}).name || '')))),
          ...Array.from({ length: d.maxSeats - d.seats.length }, () => h('div.hud-p.empty', h('span.lc-dot.big.ghost'), h('div.info', h('small', 'Lugar vago')))));
        return;
      }
      const online = new Set(d.seats.filter(p => p.online).map(p => p.id));
      box.replaceChildren(...s.players.map((p, i) => {
        const home = p.pieces.filter(r => r === FINISH).length, base = p.pieces.filter(r => r === -1).length;
        return h('div.hud-p' + (i === s.turn && s.phase !== 'over' ? '.cur' : '') + (p.out ? '.out' : '') + (i === s.winner ? '.win' : '') + (i === this.me ? '.me' : ''),
          h('span.lc-dot.big' + (online.has(p.pid) ? '.on' : ''), { style: { '--c': p.color } }),
          h('div.info', h('div.nm', p.name, i === this.me ? h('span.hb.you', 'VOCÊ') : null, p.out ? h('span.hb', 'saiu') : null),
            h('div.lprog', p.pieces.map(r => h('i' + (r === FINISH ? '.home' : r === -1 ? '.base' : ''), { style: { '--c': p.color } }))),
            h('small', `${home}/4 no centro · ${base} na base`)));
      }));
    },
    renderLog() {
      const s = this.s;
      $('#lLog').replaceChildren(...(s ? s.log.slice(-40).reverse().map(l => h('div.mlogline', l.t)) : [h('p.muted', 'A partida ainda não começou.')]));
    },
    renderChat() {
      const log = $('#lChatLog'), atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      log.replaceChildren(...this.d.chat.map(m => m.n ? h('div.msg', h('b', m.n + ': '), m.t) : h('div.msg.sys', m.t)));
      if (atEnd || !this.chatScrolled) { log.scrollTop = log.scrollHeight; this.chatScrolled = true; }
    },
    async sendChat(e) {
      e.preventDefault();
      const inp = $('#lChatInput'), text = inp.value.trim();
      if (!text) return;
      inp.value = '';
      try { await api(`/magnata/${this.id}/chat`, { text }); } catch (err) { errToast(err); inp.value = text; }
    }
  };

  return { Ludo: { open: id => G.open(id), close: () => G.close(), lobbySection } };
});

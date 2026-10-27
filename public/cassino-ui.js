// Tabuleiro em Rede — Cassino com fichas de mentira (F$). O servidor sorteia tudo; aqui só desenha.
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast } = T;
  const fmt = v => 'F$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fx = m => Number(m).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '×';
  const play = n => { try { Sound.play(n); } catch (e) { /* sem som */ } };
  const GAMES = [
    { id: 'crash', name: 'Crash', icon: '🚀', desc: 'Retire antes de explodir' },
    { id: 'mines', name: 'Mines', icon: '💣', desc: 'Ache os diamantes' },
    { id: 'double', name: 'Double', icon: '🎡', desc: 'Vermelho, preto ou branco' },
    { id: 'dice', name: 'Dice', icon: '🎲', desc: 'Acima ou abaixo' },
    { id: 'limbo', name: 'Limbo', icon: '🎯', desc: 'Escolha o multiplicador' },
    { id: 'plinko', name: 'Plinko', icon: '🔻', desc: 'Solte a bolinha' }
  ];
  const GAME_NAME = Object.fromEntries(GAMES.map(g => [g.id, g.name]));
  // Ordem das casas na roleta do Double (vermelho 1–7, preto 8–14, branco 0)
  const DOUBLE_ORDER = [0, 11, 5, 10, 6, 9, 7, 8, 1, 14, 2, 13, 3, 12, 4];
  const dColor = n => (n === 0 ? 'white' : n <= 7 ? 'red' : 'black');

  const C = {
    active: false, tab: 'crash', w: null, top: [], pTable: null, es: null, raf: 0, cs: null, offset: 0, busy: false,
    amount: Number(T.store.get('cas-amount', 10)) || 10,

    async show(q) {
      this.active = true;
      const t = q.get('jogo');
      if (GAMES.some(g => g.id === t)) this.tab = t;
      document.title = 'Cassino · Tabuleiro em Rede';
      const root = $('#v-cassino');
      if (!this.root || !root.contains(this.root)) this.build(root);
      try {
        const d = await api('/cassino');
        this.w = d.wallet; this.top = d.top; this.pTable = d.plinko;
      } catch (e) { return errToast(e); }
      this.renderAll();
      this.connectCrash();
    },
    leave() {
      if (!this.active) return;
      this.active = false;
      if (this.es) { this.es.close(); this.es = null; }
      cancelAnimationFrame(this.raf); this.raf = 0;
    },
    setTab(id) {
      this.tab = id;
      history.replaceState(null, '', '/?v=cassino&jogo=' + id);   // sem passar pela rota: não volta ao topo nem recarrega
      this.renderAll();
    },

    build(root) {
      this.root = h('div.cas');
      this.head = h('div.cas-head');
      this.tabsEl = h('div.cas-tabs');
      this.panel = h('div.cas-panel.card');
      this.stage = h('div.cas-stage');
      this.histEl = h('div.card.cas-hist');
      this.topEl = h('div.card.cas-top');
      this.root.append(this.head, this.tabsEl, h('div.cas-main', this.panel, this.stage), h('div.cas-foot', this.histEl, this.topEl),
        h('p.cas-note.muted', '🎭 Fichas de mentira, só por diversão: não existe depósito nem saque, e nada aqui vale dinheiro de verdade.'));
      root.replaceChildren(this.root);
    },
    renderAll() {
      this.renderHead();
      this.tabsEl.replaceChildren(...GAMES.map(g => h('button.cas-tab' + (g.id === this.tab ? '.on' : ''), { type: 'button', onclick: () => this.setTab(g.id) },
        h('span.ct-i', g.icon), h('span', h('b', g.name), h('small', g.desc)))));
      this.renderGame();
      this.renderHist();
      this.renderTop();
    },
    renderHead() {
      const w = this.w;
      if (!w) return;
      const profit = w.won - w.wagered;
      this.head.replaceChildren(
        h('div', h('h1', '🎰 Cassino'), h('p.muted', 'Aposte fichas de mentira (F$) em Crash, Mines e nos clássicos.')),
        h('div.cas-wallet',
          h('div.cw-bal', h('small', 'SALDO'), h('b', fmt(this.shownBal ?? w.bal))),
          h('div.cw-stats', h('span', `${w.bets} apostas`), h('span' + (profit >= 0 ? '.pos' : '.neg'), `${profit >= 0 ? '+' : ''}${fmt(profit)}`), w.best ? h('span', `maior: ${fx(w.best)}`) : null),
          w.bonusIn !== null ? h('button.btn.primary.small', { type: 'button', disabled: w.bonusIn > 0 || null, onclick: () => this.bonus() },
            w.bonusIn > 0 ? `Bônus em ${Math.ceil(w.bonusIn / 60000)} min` : '🎁 Pegar F$ 1.000') : null));
    },
    async bonus() {
      try { const r = await api('/cassino/bonus', {}); this.setWallet(r.wallet); toast('Você ganhou F$ 1.000 de bônus!'); play('coin'); }
      catch (e) { errToast(e); }
    },
    setWallet(w) {
      this.w = w; this.shownBal = null;
      this.renderHead(); this.renderHist();
    },
    renderHist() {
      const w = this.w;
      if (!w) return;
      this.histEl.replaceChildren(h('p.section-title', 'Suas últimas apostas'),
        w.hist.length ? h('div.ch-list', w.hist.map(x => h('div.ch-row' + (x.p > 0 ? '.win' : x.p < 0 ? '.lose' : ''),
          h('span.ch-g', GAME_NAME[x.g] || x.g), h('span.muted', x.r || ''), h('span', fmt(x.a)), h('span.ch-m', fx(x.m)),
          h('b', (x.p > 0 ? '+' : '') + fmt(x.p))))) : h('p.muted', 'Nenhuma aposta ainda.'));
    },
    renderTop() {
      this.topEl.replaceChildren(h('p.section-title', 'Mais ricos (de mentira)'),
        h('div.ct-list', this.top.map((p, i) => h('div.ct-row' + (p.id === T.me().id ? '.me' : ''), h('b', `${i + 1}º`), T.avatar(p, 'sm'), h('span', p.name), h('span.ct-bal', fmt(p.bal))))));
    },

    /* ---------- Painel de aposta (comum) ---------- */
    amountField(disabled) {
      const inp = h('input.cas-amt', { type: 'number', min: 1, step: 1, value: this.amount, disabled: disabled || null,
        oninput: e => { this.amount = Number(e.target.value) || 0; T.store.set('cas-amount', this.amount); } });
      const set = v => { this.amount = Math.max(1, Math.round(v * 100) / 100); inp.value = this.amount; T.store.set('cas-amount', this.amount); };
      return h('label.field', 'Valor da aposta',
        h('div.cas-amtrow', h('span.cas-cur', 'F$'), inp,
          h('button.btn.small', { type: 'button', disabled: disabled || null, onclick: () => set(this.amount / 2) }, '½'),
          h('button.btn.small', { type: 'button', disabled: disabled || null, onclick: () => set(this.amount * 2) }, '2×'),
          h('button.btn.small', { type: 'button', disabled: disabled || null, onclick: () => set(Math.floor((this.w ? this.w.bal : 0) * 100) / 100) }, 'Máx')));
    },
    renderGame() {
      cancelAnimationFrame(this.raf); this.raf = 0;
      this.stage.className = 'cas-stage ' + this.tab;
      this[this.tab]();
    },
    async bet(path, body) {
      if (this.busy) return null;
      this.busy = true;
      try { return await api('/cassino/' + path, { amount: this.amount, ...body }); }
      catch (e) { errToast(e); return null; }
      finally { this.busy = false; }
    },
    result(win, text) {
      play(win ? 'coin' : 'pay');
      const el = h('div.cas-pop' + (win ? '.win' : '.lose'), text);
      this.stage.append(el);
      setTimeout(() => el.remove(), 1600);
    },

    /* ==================== Crash ==================== */
    connectCrash() {
      if (this.es) return;
      const es = new EventSource(`/api/cassino/crash/events?token=${encodeURIComponent(T.token())}`);
      this.es = es;
      es.onmessage = e => {
        if (this.es !== es) return;
        const prev = this.cs, d = JSON.parse(e.data);
        this.offset = d.serverTime - Date.now();
        this.cs = d;
        const mine = d.bets.find(b => b.id === T.me().id), pm = prev && prev.bets.find(b => b.id === T.me().id);
        if (prev && prev.phase === 'run' && d.phase === 'crashed') {
          play('lose');
          if (mine && mine.cashed === null) this.refresh();
        }
        if (mine && mine.cashed !== null && pm && pm.cashed === null) { play('coin'); this.refresh(); }
        if (this.tab === 'crash') this.renderCrashSide();
      };
      es.onerror = () => { if (es.readyState === EventSource.CLOSED) { this.es = null; setTimeout(() => this.active && this.connectCrash(), 3000); } };
    },
    async refresh() {
      try { const d = await api('/cassino'); this.top = d.top; this.setWallet(d.wallet); this.renderTop(); } catch (e) { /* tenta de novo depois */ }
    },
    crashMult(now) {
      const c = this.cs;
      if (!c || c.phase === 'bet') return 1;
      if (c.phase === 'crashed') return c.point;
      return Math.floor(Math.exp(c.rate * Math.max(0, now + this.offset - c.start)) * 100) / 100;
    },
    crash() {
      this.cvs = h('canvas.crash-cvs');
      this.cBig = h('div.crash-big');
      this.cHist = h('div.crash-hist');
      this.cBets = h('div.crash-bets');
      this.stage.replaceChildren(this.cHist, h('div.crash-box', this.cvs, this.cBig), this.cBets);
      this.autoVal = this.autoVal ?? T.store.get('cas-auto', '');
      this.renderCrashSide();
      const loop = () => { this.drawCrash(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    },
    renderCrashSide() {
      const c = this.cs;
      if (!c) return this.panel.replaceChildren(h('p.muted', 'Conectando…'));
      const mine = c.bets.find(b => b.id === T.me().id);
      const auto = h('input', { type: 'number', min: 1.01, step: 0.01, placeholder: 'ex.: 2,00', value: this.autoVal || '',
        disabled: !!mine || null, oninput: e => { this.autoVal = e.target.value; T.store.set('cas-auto', this.autoVal); } });
      let action;
      if (c.phase === 'bet') action = mine
        ? h('button.btn.block.cas-go.wait', { type: 'button', onclick: () => api('/cassino/crash/cancel', {}).then(r => this.setWallet(r.wallet)).catch(errToast) }, `Apostado ${fmt(mine.amount)} · cancelar`)
        : h('button.btn.block.cas-go', { type: 'button', onclick: async () => {
          const r = await this.bet('crash/bet', { auto: this.autoVal ? Number(String(this.autoVal).replace(',', '.')) : null });
          if (r) { this.setWallet(r.wallet); play('buy'); }
        } }, 'Apostar');
      else if (c.phase === 'run' && mine && mine.cashed === null) {
        this.cashBtn = h('button.btn.block.cas-go.cash', { type: 'button', onclick: () => api('/cassino/crash/cashout', {}).then(r => this.setWallet(r.wallet)).catch(errToast) }, 'Retirar');
        action = this.cashBtn;
      } else action = h('button.btn.block.cas-go', { type: 'button', disabled: true }, mine && mine.cashed !== null ? `Retirou em ${fx(mine.cashed)} ✔` : 'Aguarde a próxima rodada');
      if (!(c.phase === 'run' && mine && mine.cashed === null)) this.cashBtn = null;
      this.panel.replaceChildren(h('h2', '🚀 Crash'),
        h('p.muted', 'O multiplicador sobe até explodir. Retire antes para levar aposta × multiplicador. Todos jogam a mesma rodada.'),
        this.amountField(!!mine), h('label.field', 'Retirada automática (opcional)', auto), action);
      this.cHist.replaceChildren(...c.hist.map(x => h('span' + (x >= 10 ? '.hi' : x >= 2 ? '.mid' : '.lo'), fx(x))));
      this.cBets.replaceChildren(h('div.cb-head', h('b', `${c.bets.length} ${c.bets.length === 1 ? 'aposta' : 'apostas'}`), h('span.muted', `rodada #${c.round + 1}`)),
        ...c.bets.map(b => h('div.cb-row' + (b.cashed !== null ? '.win' : c.phase === 'crashed' ? '.lose' : ''), T.avatar(b, 'sm'), h('span', b.name),
          h('span.muted', b.auto ? `auto ${fx(b.auto)}` : ''), h('span', fmt(b.amount)), h('b', b.cashed !== null ? `${fx(b.cashed)} · +${fmt(b.amount * b.cashed)}` : c.phase === 'crashed' ? '💥' : '…'))));
    },
    drawCrash() {
      const c = this.cs, cv = this.cvs;
      if (!c || !cv || !cv.isConnected) return;
      const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, now = Date.now();
      g.clearRect(0, 0, W, H);
      const m = this.crashMult(now);
      if (c.phase === 'bet') {
        const left = Math.max(0, (c.betEnds - (now + this.offset)) / 1000);
        this.cBig.className = 'crash-big wait';
        this.cBig.replaceChildren(h('small', 'PRÓXIMA RODADA EM'), h('b', left.toFixed(1) + 's'), h('div.crash-bar', h('i', { style: { width: (left / 7 * 100) + '%' } })));
        return;
      }
      // Curva: tempo no eixo x, multiplicador no y
      const t = c.phase === 'crashed' ? Math.log(c.point) / c.rate : Math.max(0, now + this.offset - c.start);
      const tMax = Math.max(8000, t * 1.15), mMax = Math.max(2, m * 1.2), pad = 30 * dpr;
      const X = ms => pad + (ms / tMax) * (W - pad * 2), Y = v => H - pad - ((v - 1) / (mMax - 1)) * (H - pad * 2);
      g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = dpr; g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `${11 * dpr}px system-ui`;
      for (let k = 0; k <= 4; k++) { const v = 1 + (mMax - 1) * k / 4, y = Y(v); g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); g.fillText(v.toFixed(1) + '×', 4 * dpr, y - 3 * dpr); }
      const crashed = c.phase === 'crashed', col = crashed ? '#ff6b6b' : '#ffd43b';
      g.beginPath(); g.moveTo(X(0), Y(1));
      for (let s = 0; s <= 60; s++) { const ms = t * s / 60; g.lineTo(X(ms), Y(Math.exp(c.rate * ms))); }
      g.lineWidth = 4 * dpr; g.strokeStyle = col; g.stroke();
      g.lineTo(X(t), Y(1)); g.closePath();
      const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, crashed ? 'rgba(255,107,107,.35)' : 'rgba(255,212,59,.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fill();
      g.font = `${26 * dpr}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      g.fillText(crashed ? '💥' : '🚀', X(t) - 13 * dpr, Y(Math.min(m, mMax)) + 9 * dpr);
      this.cBig.className = 'crash-big' + (crashed ? ' boom' : '');
      const mine = c.bets.find(b => b.id === T.me().id);
      this.cBig.replaceChildren(h('b', fx(m)), crashed ? h('small', 'EXPLODIU!') : mine && mine.cashed === null ? h('small', `vale ${fmt(mine.amount * m)}`) : null);
      if (this.cashBtn && mine) this.cashBtn.textContent = `Retirar ${fmt(mine.amount * m)}`;
    },

    /* ==================== Mines ==================== */
    mines() {
      const g = this.w.mines || this.minesDone || null, live = g && !g.over;
      this.mineCount = this.mineCount || T.store.get('cas-mines', 3);
      const sel = h('select', { disabled: live || null, onchange: e => { this.mineCount = Number(e.target.value); T.store.set('cas-mines', this.mineCount); } },
        Array.from({ length: 24 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === this.mineCount || null }, `${i + 1} ${i ? 'minas' : 'mina'}`)));
      const btn = live
        ? h('button.btn.block.cas-go.cash', { type: 'button', disabled: !g.revealed.length || null, onclick: () => this.minesCash() }, g.revealed.length ? `Retirar ${fmt(g.bet * g.mult)}` : 'Abra uma casa')
        : h('button.btn.block.cas-go', { type: 'button', onclick: () => this.minesStart() }, 'Começar');
      this.panel.replaceChildren(h('h2', '💣 Mines'), h('p.muted', 'Abra casas sem achar mina. Cada diamante aumenta o multiplicador; retire quando quiser.'),
        this.amountField(live), h('label.field', 'Minas', sel),
        live ? h('div.cas-info', h('span', 'Agora ', h('b', fx(g.mult))), g.next ? h('span', 'Próxima ', h('b', fx(g.next))) : null) : null, btn);
      const grid = h('div.mines-grid', Array.from({ length: 25 }, (_, i) => {
        const open = g && g.revealed.includes(i), mine = g && g.mines && g.mines.includes(i);
        const cls = open ? '.gem' : g && g.over && mine ? (g.hit === i ? '.boom' : '.bomb') : g && g.over ? '.dim' : '';
        return h('button.mcell' + cls, { type: 'button', disabled: !live || open || null, onclick: () => this.minesReveal(i) },
          open ? '💎' : g && g.over && mine ? '💣' : g && g.over ? '💎' : '');
      }));
      this.stage.replaceChildren(grid);
    },
    async minesStart() {
      const r = await this.bet('mines/start', { mines: this.mineCount });
      if (!r) return;
      this.minesDone = null; this.setWallet(r.wallet); play('buy'); this.mines();
    },
    async minesReveal(i) {
      if (this.busy) return;
      this.busy = true;
      try {
        const r = await api('/cassino/mines/reveal', { cell: i });
        this.minesDone = r.game.over ? r.game : null;
        this.setWallet(r.wallet);
        this.mines();
        if (r.boom) this.result(false, '💥 BOOM!');
        else if (r.cashed) this.result(true, `+${fmt(r.game.bet * r.cashed)}`);
        else play('hop');
      } catch (e) { errToast(e); }
      finally { this.busy = false; }
    },
    async minesCash() {
      try {
        const r = await api('/cassino/mines/cashout', {});
        this.minesDone = r.game; this.setWallet(r.wallet); this.mines();
        this.result(true, `${fx(r.cashed)} · +${fmt(r.game.bet * r.cashed)}`);
      } catch (e) { errToast(e); }
    },

    /* ==================== Double ==================== */
    double() {
      const pick = this.dPick || 'red';
      const opt = (c, label, pay) => h('button.dpick.' + c + (pick === c ? '.on' : ''), { type: 'button', onclick: () => { this.dPick = c; this.double(); } }, h('b', label), h('small', pay));
      this.panel.replaceChildren(h('h2', '🎡 Double'), h('p.muted', 'Aposte numa cor. Vermelho e preto pagam 2×; o branco paga 14×.'),
        this.amountField(), h('div.dpicks', opt('red', 'Vermelho', '2×'), opt('white', 'Branco', '14×'), opt('black', 'Preto', '2×')),
        h('button.btn.block.cas-go', { type: 'button', onclick: () => this.doubleSpin() }, 'Girar'));
      if (!this.dTrack || !this.stage.contains(this.dTrack)) {
        this.dTrack = h('div.dtrack', Array.from({ length: 8 }, () => DOUBLE_ORDER.map(n => h('div.dtile.' + dColor(n), n === 0 ? '✦' : n))));
        this.dLast = this.dLast || [];
        this.dHist = h('div.dhist');
        this.stage.replaceChildren(h('div.dwrap', this.dTrack, h('div.dneedle')), this.dHist);
        this.dTrack.style.transform = 'translateX(0)';
      }
      this.dHist.replaceChildren(...this.dLast.map(n => h('span.dtile.sm.' + dColor(n), n === 0 ? '✦' : n)));
    },
    async doubleSpin() {
      if (this.spinning) return;
      const r = await this.bet('double', { color: this.dPick || 'red' });
      if (!r) return;
      this.spinning = true;
      this.shownBal = this.w.bal - this.amount; this.renderHead();   // mostra só o débito até a roleta parar
      const tile = this.dTrack.firstChild.getBoundingClientRect().width + 6, wrap = this.dTrack.parentNode.getBoundingClientRect().width;
      const idx = 5 * 15 + DOUBLE_ORDER.indexOf(r.n), jitter = (Math.random() - 0.5) * tile * 0.6;
      this.dTrack.style.transition = 'none';
      this.dTrack.style.transform = `translateX(${-(15 * tile) + wrap / 2 - tile / 2}px)`;
      void this.dTrack.offsetWidth;
      this.dTrack.style.transition = 'transform 4s cubic-bezier(.12,.75,.15,1)';
      this.dTrack.style.transform = `translateX(${-(idx * tile) + wrap / 2 - tile / 2 + jitter}px)`;
      play('dice');
      setTimeout(() => {
        this.spinning = false;
        this.dLast = [r.n, ...(this.dLast || [])].slice(0, 15);
        this.setWallet(r.wallet);
        if (this.tab === 'double') this.double();
        this.result(r.win, r.win ? `+${fmt(this.amount * (r.color === 'white' ? 14 : 2))}` : { red: 'Deu vermelho', black: 'Deu preto', white: 'Deu branco!' }[r.color]);
      }, 4100);
    },

    /* ==================== Dice ==================== */
    dice() {
      this.dTarget = this.dTarget || 50;
      const over = !!this.dOver, chance = over ? 100 - this.dTarget : this.dTarget, mult = 99 / chance;
      const slider = h('input.dice-range', { type: 'range', min: 2, max: 98, step: 1, value: this.dTarget, oninput: e => { this.dTarget = Number(e.target.value); this.dice(); } });
      this.panel.replaceChildren(h('h2', '🎲 Dice'), h('p.muted', 'Sorteia um número de 0 a 100. Acerte se ele cai acima ou abaixo do alvo.'),
        this.amountField(),
        h('div.seg', h('button' + (!over ? '.on' : ''), { type: 'button', onclick: () => { this.dOver = false; this.dice(); } }, 'Abaixo de'), h('button' + (over ? '.on' : ''), { type: 'button', onclick: () => { this.dOver = true; this.dice(); } }, 'Acima de')),
        h('div.cas-info', h('span', 'Alvo ', h('b', this.dTarget)), h('span', 'Chance ', h('b', chance + '%')), h('span', 'Paga ', h('b', fx(mult)))),
        h('button.btn.block.cas-go', { type: 'button', onclick: () => this.diceRoll() }, 'Rolar'));
      const bar = h('div.dice-bar' + (over ? '.over' : ''), { style: { '--t': this.dTarget + '%' } }, slider,
        this.dRoll !== undefined ? h('div.dice-mark' + (this.dWin ? '.win' : '.lose'), { style: { left: this.dRoll + '%' } }, this.dRoll.toFixed(2)) : null);
      this.stage.replaceChildren(h('div.dice-big' + (this.dRoll === undefined ? '' : this.dWin ? '.win' : '.lose'), this.dRoll === undefined ? '—' : this.dRoll.toFixed(2)), bar,
        h('div.dice-scale', [0, 25, 50, 75, 100].map(n => h('span', n))));
    },
    async diceRoll() {
      const r = await this.bet('dice', { target: this.dTarget, over: !!this.dOver });
      if (!r) return;
      this.dRoll = r.roll; this.dWin = r.win;
      this.setWallet(r.wallet); this.dice();
      this.result(r.win, r.win ? `+${fmt(this.amount * r.mult)}` : 'Não foi');
    },

    /* ==================== Limbo ==================== */
    limbo() {
      this.lTarget = this.lTarget || 2;
      const inp = h('input', { type: 'number', min: 1.01, max: 1000, step: 0.01, value: this.lTarget, oninput: e => { this.lTarget = Number(e.target.value) || 1.01; this.lChance.textContent = (99 / Math.max(1.01, this.lTarget)).toFixed(2) + '%'; } });
      this.lChance = h('b', (99 / Math.max(1.01, this.lTarget)).toFixed(2) + '%');
      this.panel.replaceChildren(h('h2', '🎯 Limbo'), h('p.muted', 'Escolha um multiplicador. Se o sorteado for maior ou igual, você ganha aposta × alvo.'),
        this.amountField(), h('label.field', 'Multiplicador alvo', inp), h('div.cas-info', h('span', 'Chance ', this.lChance)),
        h('button.btn.block.cas-go', { type: 'button', onclick: () => this.limboGo() }, 'Jogar'));
      this.lBig = this.lBig && this.stage.contains(this.lBig) ? this.lBig : h('div.limbo-big', '1,00×');
      this.stage.replaceChildren(this.lBig, h('div.limbo-target', 'alvo ', h('b', fx(this.lTarget))));
    },
    async limboGo() {
      const r = await this.bet('limbo', { target: this.lTarget });
      if (!r) return;
      const el = this.lBig, t0 = performance.now(), dur = 600, end = r.result;
      el.className = 'limbo-big';
      const step = now => {
        const k = Math.min(1, (now - t0) / dur), v = 1 + (end - 1) * (1 - Math.pow(1 - k, 3));
        el.textContent = fx(Math.floor(v * 100) / 100);
        if (k < 1) requestAnimationFrame(step);
        else { el.className = 'limbo-big ' + (r.win ? 'win' : 'lose'); this.setWallet(r.wallet); this.result(r.win, r.win ? `+${fmt(this.amount * this.lTarget)}` : 'Não chegou'); }
      };
      requestAnimationFrame(step);
    },

    /* ==================== Plinko ==================== */
    plinko() {
      this.pRows = this.pRows || 12; this.pRisk = this.pRisk || 'mid';
      const seg = (vals, cur, set, label) => h('div.seg', vals.map(([v, l]) => h('button' + (cur === v ? '.on' : ''), { type: 'button', onclick: () => { set(v); this.balls = []; this.plinko(); } }, l)));
      this.panel.replaceChildren(h('h2', '🔻 Plinko'), h('p.muted', 'A bolinha quica nos pinos e cai num multiplicador. As pontas pagam mais.'),
        this.amountField(),
        h('p.section-title', 'Risco'), seg([['low', 'Baixo'], ['mid', 'Médio'], ['high', 'Alto']], this.pRisk, v => (this.pRisk = v)),
        h('p.section-title', 'Linhas'), seg([[8, '8'], [12, '12'], [16, '16']], this.pRows, v => (this.pRows = v)),
        h('button.btn.block.cas-go', { type: 'button', onclick: () => this.plinkoDrop() }, 'Soltar bolinha'));
      const mults = this.pTable[this.pRows][this.pRisk];
      this.pcvs = h('canvas.plinko-cvs');
      this.pSlots = h('div.plinko-slots', mults.map((m, i) => {
        const edge = Math.abs(i - (mults.length - 1) / 2) / ((mults.length - 1) / 2);
        return h('span', { style: { '--k': edge } }, m >= 100 ? m : String(m).replace('.', ','));
      }));
      this.stage.replaceChildren(h('div.plinko-box', this.pcvs, this.pSlots));
      this.balls = this.balls || [];
      const loop = () => { this.drawPlinko(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop);
    },
    async plinkoDrop() {
      if (this.busy) return;
      this.busy = true;
      let r;
      try { r = await api('/cassino/plinko', { amount: this.amount, rows: this.pRows, risk: this.pRisk }); }
      catch (e) { errToast(e); } finally { this.busy = false; }
      if (!r) return;
      this.shownBal = (this.shownBal ?? this.w.bal) - this.amount; this.renderHead();
      this.balls.push({ path: r.path, t0: performance.now(), r, amount: this.amount, done: false, rows: this.pRows });
    },
    drawPlinko() {
      const cv = this.pcvs;
      if (!cv || !cv.isConnected) return;
      const rect = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(rect.width * dpr)) { cv.width = Math.round(rect.width * dpr); cv.height = Math.round(rect.height * dpr); }
      const g = cv.getContext('2d'), W = cv.width, H = cv.height, rows = this.pRows;
      const gap = Math.min(W / (rows + 2), H / (rows + 1.6)), top = gap * 0.8;
      // Linha r tem r + 3 pinos; depois de i quiques a bolinha está em X(i, pos)
      const pegY = r => top + r * gap, X = (i, pos) => W / 2 + (pos - i / 2) * gap;
      g.clearRect(0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,.75)';
      for (let r = 0; r < rows; r++) for (let k = 0; k <= r + 2; k++) {
        g.beginPath(); g.arc(W / 2 + (k - (r + 2) / 2) * gap, pegY(r), Math.max(2, gap * 0.09), 0, Math.PI * 2); g.fill();
      }
      // Fileira de multiplicadores logo abaixo do último pino
      this.pSlots.style.left = ((W / 2 - (rows + 1) * gap / 2) / dpr) + 'px';
      this.pSlots.style.width = ((rows + 1) * gap / dpr) + 'px';
      this.pSlots.style.top = ((pegY(rows - 1) + gap * 0.45) / dpr) + 'px';
      const STEP = 140, now = performance.now(), Yb = i => (i >= rows ? pegY(rows - 1) + gap * 0.6 : pegY(i) - gap * 0.4);
      for (const b of this.balls) {
        if (b.rows !== rows) continue;
        const t = (now - b.t0) / STEP, i = Math.min(rows, Math.floor(t)), f = i >= rows ? 0 : t - i;
        let pos = 0; for (let k = 0; k < i; k++) pos += b.path[k];
        const x0 = X(i, pos), y0 = Yb(i), x1 = i < rows ? X(i + 1, pos + b.path[i]) : x0, y1 = i < rows ? Yb(i + 1) : y0;
        const x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f * f - Math.sin(f * Math.PI) * gap * 0.15;
        g.fillStyle = '#ff6b9a'; g.beginPath(); g.arc(x, y, gap * 0.2, 0, Math.PI * 2); g.fill();
        if (i >= rows && !b.done) {
          b.done = true;
          const el = this.pSlots.children[b.r.slot];
          if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
          // O servidor já pagou tudo: mostra o saldo mais recente menos o que ainda está caindo
          const last = this.balls[this.balls.length - 1].r.wallet;
          const falling = this.balls.filter(x => !x.done).reduce((s_, x) => s_ + x.amount * x.r.mult, 0);
          this.setWallet(last);
          if (falling) { this.shownBal = last.bal - falling; this.renderHead(); }
          play(b.r.mult >= 1 ? 'coin' : 'hop');
        }
      }
      this.balls = this.balls.filter(b => !b.done || now - b.t0 < (rows + 3) * STEP);
    }
  };

  return { Cassino: { show: q => C.show(q), leave: () => C.leave() } };
});

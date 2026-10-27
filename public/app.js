// Tabuleiro em Rede — aplicativo do navegador
(() => {
  'use strict';

  /* ==================== Utilidades ==================== */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // h('div.cls#id', {attrs}, ...filhos) — cria elementos sem innerHTML para dados do usuário
  function h(sel, attrs, ...kids) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement(m[1] || 'div');
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
    }
    if (attrs !== undefined && (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') {
        // Variáveis CSS (--x) só funcionam com setProperty
        for (const [p, x] of Object.entries(v)) if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x;
      }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
    return el;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const ENG = { chess: Chess, checkers: Checkers };
  const GAME_NAME = { chess: 'Xadrez', checkers: 'Damas' };
  const GAME_ICON = { chess: '♞︎', checkers: '⛂︎' };
  const side = c => (c === 'w' ? 'brancas' : 'pretas');
  const cap1 = s => s[0].toUpperCase() + s.slice(1);
  const tcLabel = tc => (tc ? tc.replace('+', ' + ') : 'Sem relógio');
  const tcKind = tc => {
    if (!tc) return 'Livre';
    const [m, i] = tc.split('+').map(Number), est = m * 60 + i * 40;
    return est < 180 ? 'Bullet' : est < 480 ? 'Blitz' : est < 1500 ? 'Rápida' : 'Clássica';
  };
  const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const fmtDateTime = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ratingTxt = p => (p && p.rating != null ? p.rating + (p.prov ? '?' : '') : '');
  function avatar(p, cls = '', online = false) {
    const el = h('span.avatar' + (cls ? '.' + cls : ''), { style: { background: (p && p.color) || '#5b655e' } },
      p && p.bot ? '⚙︎' : ((p && p.name) || '?').trim()[0] || '?');
    if (online) el.append(h('span.dot'));
    return el;
  }

  const REASON = {
    mate: 'Xeque-mate', resign: 'Desistência', stalemate: 'Afogamento', fifty: 'Regra dos 50 lances',
    repetition: 'Repetição tripla', material: 'Material insuficiente', time: 'Tempo esgotado',
    'timeout-draw': 'Tempo esgotado, sem material para vencer', agreement: 'Acordo mútuo', aborted: 'Partida abortada',
    abandon: 'Abandono', 'abandon-draw': 'Adversário saiu', blocked: 'Sem lances possíveis', nopieces: 'Todas as peças capturadas',
    twenty: 'Regra dos 20 lances de damas', endgame: 'Final sem progresso'
  };

  /* ==================== Avisos e modais ==================== */
  function toast(msg, opts = {}) {
    const el = h('div.toast' + (opts.err ? '.err' : ''), h('span', { style: { flex: 1 } }, msg), ...(opts.actions || []).map(a =>
      h('button.btn' + (a.primary ? '.primary' : ''), { type: 'button', onclick: () => { a.fn(); el.remove(); } }, a.label)));
    $('#toasts').append(el);
    setTimeout(() => el.remove(), opts.ms || (opts.actions ? 20000 : 3800));
    return el;
  }
  const errToast = e => toast(e.message || String(e), { err: true });
  function modal(build) {
    const box = $('#modalBox');
    box.innerHTML = '';
    box.className = 'modal-box';
    const close = () => { $('#modal').hidden = true; box.innerHTML = ''; };
    build(box, close);
    $('#modal').hidden = false;
    const f = box.querySelector('input, textarea, button.primary, button');
    if (f) f.focus();
    return close;
  }
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });

  /* ==================== API ==================== */
  let token = store.get('tr-token', null);
  let me = null;
  async function api(path, body, method) {
    const opts = { method: method || (body === undefined ? 'GET' : 'POST'), headers: {} };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, opts); }
    catch (e) { throw new Error('Sem conexão com o servidor. Verifique se ele está rodando.'); }
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/register')) { logoutLocal(); throw new Error(json.error || 'Entre novamente.'); }
    if (!res.ok) throw new Error(json.error || 'Erro no servidor.');
    return json;
  }

  /* ==================== Configurações ==================== */
  const DEFAULTS = {
    theme: 'auto', board: 'verde', pieces: 'cburnett', coords: true, legal: true, lastMove: true,
    animation: 'normal', sound: true, volume: 0.6, premove: true, autoQueen: false,
    confirmResign: true, notify: true, chat: true, arrows: true, flash: true
  };
  let S = { ...DEFAULTS, ...store.get('tr-settings', {}) };
  const ANIM = { off: 0, fast: 90, normal: 180, slow: 320 };
  const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
  function applySettings() {
    const root = document.documentElement;
    const dark = S.theme === 'dark' || (S.theme === 'auto' && darkMq.matches);
    root.classList.toggle('dark', dark);
    for (const c of [...root.classList]) if (c.startsWith('board-theme-')) root.classList.remove(c);
    if (S.board !== 'verde') root.classList.add('board-theme-' + S.board);
    root.style.setProperty('--anim', ANIM[S.animation] + 'ms');
    Sound.enabled = S.sound; Sound.volume = S.volume;
    if (G.board) G.board.setOptions({ pieceSet: S.pieces, coords: S.coords, arrows: S.arrows });
    if (G.active) G.render();
  }
  darkMq.addEventListener('change', applySettings);
  let saveSettingsTimer = null;
  function setSetting(k, v) {
    S[k] = v;
    store.set('tr-settings', S);
    applySettings();
    clearTimeout(saveSettingsTimer);
    saveSettingsTimer = setTimeout(() => api('/me', { settings: S }).catch(() => {}), 400);
  }

  /* ==================== Sessão ==================== */
  let loginMode = 'login';
  function setLoginMode(m) {
    loginMode = m;
    $$('#loginMode button').forEach(b => b.classList.toggle('on', b.dataset.v === m));
    $('#loginSubmit').textContent = m === 'login' ? 'Entrar' : 'Criar perfil';
    $('#loginPass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
    $('#loginPass').placeholder = m === 'login' ? '' : 'Mínimo de 6 caracteres';
    $('#loginError').textContent = '';
  }
  $$('#loginMode button').forEach(b => b.addEventListener('click', () => setLoginMode(b.dataset.v)));
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginError').textContent = '';
    try {
      const r = await api(loginMode === 'login' ? '/login' : '/register', { name: $('#loginName').value, password: $('#loginPass').value });
      token = r.token; store.set('tr-token', token);
      onLogin(r.me);
    } catch (err) { $('#loginError').textContent = err.message; }
  });
  async function showLogin() {
    $('#shell').hidden = true; $('#login').hidden = false;
    document.title = 'Tabuleiro em Rede';
    try {
      const known = await api('/known');
      $('#knownWrap').hidden = !known.length;
      $('#known').replaceChildren(...known.map(p => h('button', { type: 'button', onclick: () => { setLoginMode('login'); $('#loginName').value = p.name; $('#loginPass').focus(); } }, avatar(p, 'sm'), p.name)));
      if (!known.length) setLoginMode('register');
    } catch (e) { $('#loginError').textContent = e.message; }
  }
  function onLogin(profile) {
    me = profile;
    S = { ...DEFAULTS, ...profile.settings };
    store.set('tr-settings', S);
    applySettings();
    $('#login').hidden = true; $('#shell').hidden = false;
    renderUserchip();
    startPolling();
    route();
  }
  function logoutLocal() {
    token = null; me = null; store.del('tr-token');
    stopPolling(); G.close(); X.Magnata.close(); X.Ludo.close(); X.Truco.close(); X.Cassino.leave(); X.Sugestoes.leave(); X.Admin.leave();
    showLogin();
  }
  async function logout() {
    try { await api('/logout', {}); } catch (e) {}
    logoutLocal();
  }
  function renderUserchip() {
    $('#userchip').replaceChildren(avatar(me, 'sm'), h('span.nm', me.name));
    $('#navAdmin').hidden = !me.admin;
  }
  $('#userchip').addEventListener('click', () => go({ v: 'perfil', id: me.id }));
  $('#brand').addEventListener('click', () => go({}));
  $$('#nav a').forEach(a => a.addEventListener('click', () => go(a.dataset.v === 'perfil' ? { v: 'perfil', id: me.id } : a.dataset.v === 'inicio' ? {} : { v: a.dataset.v })));

  /* ==================== Navegação ==================== */
  const X = {};   // módulos de outros arquivos (magnata-ui.js, admin.js), preenchidos no início
  function go(params, replace) {
    const q = new URLSearchParams(params).toString();
    const url = q ? '/?' + q : '/';
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    route();
  }
  window.addEventListener('popstate', () => route());
  function showView(id, navKey) {
    $$('main.view').forEach(v => (v.hidden = v.id !== id));
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.v === navKey));
    window.scrollTo(0, 0);
  }
  function route() {
    if (!me) return;
    const q = new URLSearchParams(location.search);
    const isGame = q.has('sala') || q.has('partida') || q.has('bot') || q.has('assistir');
    if (!isGame) G.close();
    if (q.get('v') !== 'aprender') Learn.leave();
    if (q.get('v') !== 'assistir') Watch.leave();
    if (!q.has('magnata')) X.Magnata.close();
    if (!q.has('ludo')) X.Ludo.close();
    if (!q.has('truco')) X.Truco.close();
    if (q.get('v') !== 'admin') X.Admin.leave();
    if (q.get('v') !== 'cassino') X.Cassino.leave();
    if (q.get('v') !== 'sugestoes') X.Sugestoes.leave();
    if (q.has('magnata')) { showView('v-magnata', null); X.Magnata.open(q.get('magnata')); }
    else if (q.has('ludo')) { showView('v-ludo', null); X.Ludo.open(q.get('ludo')); }
    else if (q.has('truco')) { showView('v-truco', null); X.Truco.open(q.get('truco')); }
    else if (q.get('v') === 'sugestoes') { showView('v-sugestoes', 'sugestoes'); X.Sugestoes.show(); }
    else if (q.get('v') === 'cassino') { showView('v-cassino', 'cassino'); X.Cassino.show(q); }
    else if (q.get('v') === 'admin') { showView('v-admin', 'admin'); X.Admin.show(q); }
    else if (q.has('assistir')) { showView('v-game', null); G.open('watch', q.get('assistir')); }
    else if (q.get('v') === 'assistir') { showView('v-assistir', 'assistir'); Watch.show(); }
    else if (q.has('sala')) { showView('v-game', null); G.open('room', q.get('sala')); }
    else if (q.has('partida')) { showView('v-game', null); G.open('review', q.get('partida')); }
    else if (q.has('bot')) { showView('v-game', null); G.open('bot'); }
    else if (q.get('v') === 'aprender') { showView('v-aprender', 'aprender'); Learn.show(q); }
    else if (q.get('v') === 'ranking') { showView('v-ranking', 'ranking'); Ranking.show(); }
    else if (q.get('v') === 'perfil') { showView('v-perfil', q.get('id') === me.id ? 'perfil' : null); Profile.show(q.get('id') || me.id); }
    else if (q.get('v') === 'config') { showView('v-config', 'config'); Settings.show(); }
    else if (q.get('v') === 'jogar') { showView('v-jogar', 'jogar'); document.title = 'Jogar · Tabuleiro em Rede'; Lobby.setGame(q.get('jogo')); Lobby.render(); }
    else { showView('v-inicio', 'inicio'); document.title = 'Tabuleiro em Rede'; Home.render(); }
  }

  /* ==================== Atualização periódica (lobby, convites, presença) ==================== */
  let pollTimer = null, lobbyData = null;
  const seenInvites = new Set();
  function startPolling() { stopPolling(); poll(); pollTimer = setInterval(poll, 2500); }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  async function poll() {
    if (!me) return;
    const inGame = !$('#v-game').hidden;
    if (inGame && G.mode === 'room' && Date.now() - (poll.last || 0) < 7000) return;
    poll.last = Date.now();
    try {
      lobbyData = await api('/lobby');
      me = lobbyData.me;
      renderUserchip();
      renderAnnounce(lobbyData.announce);
      if (!$('#v-jogar').hidden) Lobby.render();
      if (!$('#v-inicio').hidden) Home.render();
      for (const r of lobbyData.rooms) {
        if (r.invite !== me.id || r.mine || seenInvites.has(r.id)) continue;
        seenInvites.add(r.id);
        const from = r.players.w || r.players.b;
        Sound.play('notify');
        if ($('#v-jogar').hidden && $('#v-inicio').hidden) toast(`${from ? from.name : 'Alguém'} desafiou você: ${GAME_NAME[r.game]}, ${tcLabel(r.tc)}`, {
          actions: [{ label: 'Aceitar', primary: true, fn: () => go({ sala: r.id }) }, { label: 'Recusar', fn: () => api(`/rooms/${r.id}/decline`, {}).catch(() => {}) }]
        });
      }
    } catch (e) { /* tenta de novo no próximo ciclo */ }
  }
  // Aviso do administrador: faixa no topo até a pessoa fechar (volta se o aviso mudar)
  function renderAnnounce(a) {
    const bar = $('#announce');
    if (!a || store.get('tr-announce-closed', 0) === a.ts) { bar.hidden = true; return; }
    if (bar.dataset.ts !== String(a.ts)) {
      bar.dataset.ts = a.ts;
      bar.replaceChildren(h('span.glyph', '📣︎'), h('span.txt', a.text), h('span.muted', `— ${a.by}`),
        h('button.btn.ghost.small', { type: 'button', 'aria-label': 'Fechar aviso', onclick: () => { store.set('tr-announce-closed', a.ts); bar.hidden = true; } }, '✕'));
      Sound.play('notify');
    }
    bar.hidden = false;
  }

  /* ==================== Tela inicial: escolha do jogo ==================== */
  // Para adicionar um jogo novo: coloque aqui (ready: false mostra "Em breve")
  const GAMES = [
    { id: 'chess', name: 'Xadrez', icon: '♞︎', players: '2 jogadores', desc: 'O clássico. Partidas com relógio, ranking, contra o computador e trilha para aprender.', ready: true, color: '#3d8a55' },
    { id: 'checkers', name: 'Damas', icon: '⛂︎', players: '2 jogadores', desc: 'Regras brasileiras: captura obrigatória, lei da maioria e dama que anda longe.', ready: true, color: '#b8751a' },
    { id: 'magnata', name: 'Magnata', icon: '🎩', players: '2 a 8 jogadores', desc: 'Compre imóveis, construa casas e hotéis e leve todo mundo à falência. Estilo Banco Imobiliário.', ready: true, color: '#c92a2a' },
    { id: 'ludo', name: 'Ludo', icon: '🎲', players: '2 a 4 jogadores', desc: 'Tire 6 para sair, dê a volta no tabuleiro e capture os adversários no caminho.', ready: true, color: '#1971c2' },
    { id: 'truco', name: 'Truco', icon: '🃏', players: '2 ou 4 jogadores', desc: 'Truco paulista com vira e manilha, mano a mano ou em duplas. TRUCO, ladrão!', ready: true, color: '#0b7285' },
    { id: 'cassino', name: 'Cassino', icon: '🎰', players: 'Fichas de mentira', desc: 'Crash ao vivo com a galera, Mines, Double, Dice, Limbo e Plinko. Só diversão: nada vale dinheiro.', ready: true, color: '#9c36b5', go: { v: 'cassino' } },
    { id: 'reversi', name: 'Reversi', icon: '⚫', players: '2 jogadores', desc: 'Cerque as peças do adversário e vire-as para a sua cor.', ready: false, color: '#495057' },
    { id: 'trilha', name: 'Trilha', icon: '⭕', players: '2 jogadores', desc: 'Forme linhas de três para tirar as peças do outro.', ready: false, color: '#7048e8' },
    { id: 'velha', name: 'Lig 4', icon: '🔴', players: '2 jogadores', desc: 'Alinhe quatro fichas antes do adversário.', ready: false, color: '#e8590c' }
  ];
  const Home = {
    render() {
      if (!me) return;
      const d = lobbyData, box = $('#v-inicio');
      const live = {}, open = {};
      if (d) {
        for (const r of d.rooms) {
          if (!r.over && r.players.w && r.players.b) live[r.game] = (live[r.game] || 0) + 1;
          else if (!r.over && !r.invite) open[r.game] = (open[r.game] || 0) + 1;
        }
        for (const b of d.bots || []) live[b.game] = (live[b.game] || 0) + 1;
        for (const m of d.magnata || []) { const k = m.game || 'magnata'; if (m.started && !m.over) live[k] = (live[k] || 0) + 1; else if (!m.started) open[k] = (open[k] || 0) + 1; }
      }
      // Partidas suas em andamento e desafios recebidos
      const mine = d ? [
        ...d.rooms.filter(r => r.mine && !r.over).map(r => ({ icon: GAME_ICON[r.game], name: r.name, sub: GAME_NAME[r.game], go: { sala: r.id } })),
        ...(d.magnata || []).filter(m => m.mine && !m.over).map(m => m.game === 'ludo'
          ? { icon: '🎲', name: m.name, sub: m.started ? 'Ludo · jogando' : 'Ludo · esperando', go: { ludo: m.id } }
          : m.game === 'truco' ? { icon: '🃏', name: m.name, sub: m.started ? 'Truco · jogando' : 'Truco · esperando', go: { truco: m.id } }
          : { icon: '🎩', name: m.name, sub: m.started ? `Magnata · rodada ${m.round}` : 'Magnata · esperando', go: { magnata: m.id } })
      ] : [];
      const inv = d ? d.rooms.filter(r => r.invite === me.id && !r.mine) : [];
      box.replaceChildren(...[
        h('div.home-hero', h('div', h('h1', `Olá, ${me.name}!`), h('p.muted', 'Escolha um jogo para começar.')),
          d ? h('div.home-stats', h('span', h('b', d.online.length), ' online'), h('span', h('b', Object.values(live).reduce((a, b) => a + b, 0)), ' partidas ao vivo')) : null),
        inv.length ? h('div.invites', inv.map(r => {
          const from = r.players.w || r.players.b;
          return h('div.invite', avatar(from), h('div.txt', h('strong', `${from ? from.name : 'Alguém'} desafiou você`), h('div.muted', `${GAME_NAME[r.game]} · ${tcLabel(r.tc)}`)),
            h('button.btn', { type: 'button', onclick: () => api(`/rooms/${r.id}/decline`, {}).then(poll).catch(errToast) }, 'Recusar'),
            h('button.btn.primary', { type: 'button', onclick: () => go({ sala: r.id }) }, 'Aceitar'));
        })) : null,
        mine.length ? h('div.home-continue', h('p.section-title', 'Continuar jogando'), h('div.hc-list', mine.map(m =>
          h('button.hc', { type: 'button', onclick: () => go(m.go) }, h('span.hc-icon', m.icon), h('span', h('b', m.name), h('small.muted', m.sub)), h('span.hc-go', '▶'))))) : null,
        h('div.game-grid', GAMES.map(g => h('button.game-card' + (g.ready ? '' : '.soon'), {
          type: 'button', style: { '--gc': g.color }, disabled: !g.ready || null, onclick: () => go(g.go || { v: 'jogar', jogo: g.id })
        },
          h('div.gc-art', h('span', g.icon)),
          h('div.gc-body',
            h('div.gc-top', h('h2', g.name), g.ready ? (live[g.id] ? h('span.pill.live', `● ${live[g.id]} ao vivo`) : null) : h('span.pill', 'Em breve')),
            h('p', g.desc),
            h('div.gc-foot', h('span.muted', '👥 ' + g.players), g.ready && open[g.id] ? h('span.muted', `${open[g.id]} esperando jogador`) : null,
              g.ready ? h('span.gc-play', 'Jogar ▶') : null))))),
        h('div.home-links',
          h('button.btn', { type: 'button', onclick: () => go({ v: 'assistir' }) }, '👀 Assistir partidas'),
          h('button.btn', { type: 'button', onclick: () => go({ v: 'aprender' }) }, '📚 Aprender xadrez'),
          h('button.btn', { type: 'button', onclick: () => go({ v: 'ranking' }) }, '🏆 Ranking'),
          h('button.btn', { type: 'button', onclick: () => go({ v: 'sugestoes' }) }, '💡 Sugerir um jogo'))].filter(Boolean));
    }
  };

  /* ==================== Lobby ==================== */
  const TC_OPTIONS = ['1+0', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '10+5', '15+10', '30+0', 'none', 'custom'];
  const Lobby = {
    form: { game: 'chess', tc: '10+0', min: 10, inc: 0, color: 'r', rated: true, priv: false, level: 3, ...store.get('tr-form', {}) },
    filter: 'all',
    saveForm() { store.set('tr-form', this.form); },
    tcValue() {
      const f = this.form;
      if (f.tc === 'custom') return `${Math.max(0.5, Math.min(180, Number(f.min) || 10))}+${Math.max(0, Math.min(60, Math.round(Number(f.inc) || 0)))}`;
      return f.tc;
    },
    init() {
      const f = this.form;
      $('#fTc').replaceChildren(...TC_OPTIONS.map(v => h('button', { type: 'button', dataset: { v }, onclick: () => { f.tc = v; this.saveForm(); this.paintForm(); } },
        v === 'none' ? h('b', '∞') : v === 'custom' ? h('b', '…') : h('b', v),
        h('small', v === 'none' ? 'Livre' : v === 'custom' ? 'Outro' : tcKind(v)))));
      $('#fLevel').replaceChildren(...[1, 2, 3, 4, 5, 6].map(n => h('button', { type: 'button', dataset: { v: n }, onclick: () => { f.level = n; this.saveForm(); this.paintForm(); } }, n)));
      $$('#fGame button').forEach(b => b.addEventListener('click', () => { f.game = b.dataset.v; this.saveForm(); this.paintForm(); }));
      $$('#fColor button').forEach(b => b.addEventListener('click', () => { f.color = b.dataset.v; this.saveForm(); this.paintForm(); }));
      $('#fRated').addEventListener('change', e => { f.rated = e.target.checked; this.saveForm(); });
      $('#fPrivate').addEventListener('change', e => { f.priv = e.target.checked; this.saveForm(); });
      $('#fMin').addEventListener('input', e => { f.min = e.target.value; this.saveForm(); });
      $('#fInc').addEventListener('input', e => { f.inc = e.target.value; this.saveForm(); });
      $$('#roomFilter button').forEach(b => b.addEventListener('click', () => { this.filter = b.dataset.v; this.render(); }));
      $('#createRoom').addEventListener('click', () => this.create());
      $('#playBot').addEventListener('click', () => Bot.start({ game: f.game, level: f.level, color: f.color, tc: this.tcValue() }));
      this.paintForm();
    },
    paintForm() {
      const f = this.form;
      $$('#fGame button').forEach(b => b.classList.toggle('on', b.dataset.v === f.game));
      $$('#fColor button').forEach(b => b.classList.toggle('on', b.dataset.v === f.color));
      $$('#fTc button').forEach(b => b.classList.toggle('on', b.dataset.v === f.tc));
      $$('#fLevel button').forEach(b => b.classList.toggle('on', +b.dataset.v === f.level));
      $('#fCustom').hidden = f.tc !== 'custom';
      $('#fMin').value = f.min; $('#fInc').value = f.inc;
      $('#fRated').checked = f.rated; $('#fPrivate').checked = f.priv;
    },
    async create(invite) {
      const f = this.form;
      try {
        const r = await api('/rooms', { game: f.game, tc: this.tcValue(), color: f.color, rated: f.rated, private: f.priv, name: $('#fName').value, invite });
        $('#fName').value = '';
        go({ sala: r.id });
      } catch (e) { errToast(e); }
    },
    challenge(p) {
      const f = this.form;
      modal((box, close) => {
        box.append(
          h('h2', `Desafiar ${p.name}`),
          h('p.muted', `${GAME_NAME[f.game]} · ${tcLabel(this.tcValue())} · ${f.color === 'r' ? 'cor sorteada' : 'você de ' + side(f.color)} · ${f.rated ? 'vale ranking' : 'amistosa'}`),
          h('p.muted', { style: { fontSize: '13px' } }, 'As opções vêm do painel "Nova partida". Mude lá se quiser outra configuração.'),
          h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'),
            h('button.btn.primary', { type: 'button', onclick: () => { close(); this.create(p.id); } }, 'Enviar desafio')));
      });
    },
    // Lobby de um jogo só (vindo da tela inicial) ou de todos
    setGame(j) {
      this.game = ['chess', 'checkers', 'magnata', 'ludo', 'truco'].includes(j) ? j : null;
      if (this.game === 'ludo' || this.game === 'truco') return;
      if (this.game && this.game !== 'magnata') {
        if (!this.ready) { this.init(); this.ready = true; }
        this.form.game = this.game; this.filter = this.game; this.saveForm(); this.paintForm();
      } else if (!this.game) this.filter = 'all';
    },
    render() {
      if (!me) return;
      if (!this.ready) { this.init(); this.ready = true; }
      const g = this.game, info = g ? GAMES.find(x => x.id === g) : null;
      $('#lobbyHead').replaceChildren(h('button.btn.ghost.small', { type: 'button', onclick: () => go({}) }, '← Todos os jogos'),
        h('h1', info ? [h('span.lh-icon', info.icon), ' ', info.name] : 'Todas as salas'));
      $('#v-jogar').classList.toggle('only-mag', g === 'magnata' || g === 'ludo' || g === 'truco');
      $('#v-jogar').classList.toggle('only-truco', g === 'truco');
      $('#v-jogar').classList.toggle('only-ludo', g === 'ludo');
      $('#v-jogar').classList.toggle('only-magnata', g === 'magnata');
      $('#v-jogar').classList.toggle('no-mag', g === 'chess' || g === 'checkers');
      const d = lobbyData;
      if (!d) { $('#rooms').replaceChildren(h('div.empty', 'Carregando salas…')); return; }
      // Convites recebidos
      const inv = d.rooms.filter(r => r.invite === me.id && !r.mine);
      $('#invites').replaceChildren(...inv.map(r => {
        const from = r.players.w || r.players.b;
        return h('div.invite', avatar(from),
          h('div.txt', h('strong', `${from ? from.name : 'Alguém'} desafiou você`), h('div.muted', `${GAME_NAME[r.game]} · ${tcLabel(r.tc)} · ${r.rated ? 'vale ranking' : 'amistosa'}`)),
          h('button.btn', { type: 'button', onclick: () => api(`/rooms/${r.id}/decline`, {}).then(poll).catch(errToast) }, 'Recusar'),
          h('button.btn.primary', { type: 'button', onclick: () => go({ sala: r.id }) }, 'Aceitar'));
      }));
      $$('#roomFilter button').forEach(b => b.classList.toggle('on', b.dataset.v === this.filter));
      const rooms = d.rooms.filter(r => (this.filter === 'all' || r.game === this.filter) && !(r.invite === me.id && !r.mine));
      const groups = [
        ['Suas salas', rooms.filter(r => r.mine && !r.over)],
        ['Aguardando adversário', rooms.filter(r => !r.mine && !r.over && (!r.players.w || !r.players.b) && !r.invite)],
        ['Em andamento', rooms.filter(r => !r.mine && !r.over && r.players.w && r.players.b)],
        ['Contra o computador, ao vivo', (d.bots || []).filter(g => this.filter === 'all' || g.game === this.filter)],
        ['Encerradas recentemente', rooms.filter(r => r.over).slice(0, 6)]
      ].filter(g => g[1].length);
      const box = $('#rooms');
      if (!groups.length) box.replaceChildren(h('div.empty', 'Nenhuma sala aberta. Crie uma no painel ao lado ou desafie alguém online.'));
      else box.replaceChildren(...groups.flatMap(([title, list]) => [h('div.subhead', title), ...list.map(r => (r.kind === 'bot' ? this.botRow(r) : this.row(r)))]));
      $('#magRooms').replaceChildren(X.Magnata.lobbySection((d.magnata || []).filter(m => !m.game || m.game === 'magnata'), me));
      $('#trucoRooms').replaceChildren(X.Truco.lobbySection((d.magnata || []).filter(m => m.game === 'truco')));
      $('#ludoRooms').replaceChildren(X.Ludo.lobbySection((d.magnata || []).filter(m => m.game === 'ludo')));
      // Online
      const others = d.online.filter(p => p.id !== me.id);
      $('#online').replaceChildren(...(others.length ? others.map(p => h('div.online-row',
        avatar(p, 'sm', true), h('span.nm.link', { onclick: () => go({ v: 'perfil', id: p.id }) }, p.name),
        h('span.rt', `♞︎ ${p.chess} · ⛂︎ ${p.checkers}`),
        p.playing ? h('span.pill.live', 'jogando') : null, h('button.btn.small', { type: 'button', onclick: () => this.challenge(p) }, 'Desafiar')))
        : [h('p.muted', { style: { margin: 0 } }, 'Ninguém mais online agora. Peça para o outro jogador abrir o endereço do servidor.')]));
    },
    botRow(g) {
      return h('div.room-row',
        h('span.gicon', { title: GAME_NAME[g.game] }, GAME_ICON[g.game]),
        h('div', { style: { minWidth: 0 } }, h('div.rname', `${g.player ? g.player.name : 'Alguém'} × Computador nível ${g.level}`),
          h('div.meta', h('span', `${GAME_NAME[g.game]} · ${tcLabel(g.tc)}${g.spectators ? ` · ${g.spectators} assistindo` : ''}`))),
        h('span.pill.live', `Lance ${Math.floor(g.plies / 2) + 1}`),
        h('button.btn', { type: 'button', onclick: () => go({ assistir: g.id }) }, 'Assistir'));
    },
    row(r) {
      const pl = c => r.players[c] ? `${r.players[c].name} (${ratingTxt(r.players[c])})` : 'vago';
      const full = r.players.w && r.players.b;
      let pill, btn;
      if (r.over) { pill = h('span.pill', 'Encerrada'); btn = 'Ver'; }
      else if (!full) { pill = h('span.pill.wait', r.invite ? 'Desafio enviado' : 'Aguardando'); btn = r.mine ? 'Abrir' : 'Entrar'; }
      else { pill = h('span.pill.live', `Lance ${Math.floor(r.plies / 2) + 1}`); btn = r.mine ? 'Voltar à partida' : 'Assistir'; }
      return h('div.room-row' + (r.mine ? '.mine' : ''),
        h('span.gicon', { title: GAME_NAME[r.game] }, GAME_ICON[r.game]),
        h('div', { style: { minWidth: 0 } }, h('div.rname', r.name),
          h('div.meta', h('span', `${tcLabel(r.tc)} · ${r.rated ? 'ranqueada' : 'amistosa'}${r.private ? ' · privada' : ''}`), h('span', `○ ${pl('w')}  ● ${pl('b')}`))),
        pill,
        h('button.btn' + (!r.mine && !full && !r.over ? '.primary' : ''), { type: 'button', onclick: () => go({ sala: r.id }) }, btn));
    }
  };

  /* ==================== Ranking ==================== */
  const Ranking = {
    game: 'chess',
    init() {
      $$('#rankGame button').forEach(b => b.addEventListener('click', () => { this.game = b.dataset.v; this.show(); }));
      this.ready = true;
    },
    async show() {
      if (!this.ready) this.init();
      document.title = 'Ranking · Tabuleiro em Rede';
      $$('#rankGame button').forEach(b => b.classList.toggle('on', b.dataset.v === this.game));
      const t = $('#rankTable');
      try {
        const list = await api('/ranking?game=' + this.game);
        if (!list.length) { t.replaceChildren(h('tbody', h('tr', h('td.empty', 'Ninguém jogou partidas ranqueadas de ' + GAME_NAME[this.game].toLowerCase() + ' ainda.')))); return; }
        t.replaceChildren(
          h('thead', h('tr', h('th', '#'), h('th', 'Jogador'), h('th.num', 'Pontos'), h('th.num', 'Recorde'), h('th.num', 'Partidas'), h('th.num', 'V / E / D'), h('th', 'Aproveitamento'))),
          h('tbody', ...list.map((p, i) => {
            const pct = p.games ? Math.round(((p.w + p.d / 2) / p.games) * 100) : 0;
            return h('tr' + (p.id === me.id ? '.me' : ''),
              h('td.pos' + (i < 3 ? '.top' : ''), i + 1),
              h('td', h('span.who.link', { onclick: () => go({ v: 'perfil', id: p.id }) }, avatar(p, 'sm', p.online), p.name)),
              h('td.num.rating-big', p.r + (p.prov ? '?' : '')),
              h('td.num.mono', p.peak), h('td.num.mono', p.games),
              h('td.num.mono', `${p.w} / ${p.d} / ${p.l}`),
              h('td', h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                h('div.wdl', h('i.w', { style: { width: (p.w / p.games) * 100 + '%' } }), h('i.d', { style: { width: (p.d / p.games) * 100 + '%' } }), h('i.l', { style: { width: (p.l / p.games) * 100 + '%' } })),
                h('span.mono.muted', pct + '%'))));
          })));
      } catch (e) { errToast(e); }
    }
  };

  /* ==================== Assistir: partidas ao vivo e de todo mundo ==================== */
  // Tabuleirinho só para mostrar a posição (sem interação)
  function miniBoard(game, moves) {
    const E = ENG[game], s = E.play(moves).slice(-1)[0].s;
    const el = h('div.mini' + (game === 'checkers' ? '.ck' : ''));
    for (let i = 0; i < 64; i++) {
      const p = s.b[i], dark = ((i >> 3) + (i & 7)) % 2 === 1;
      const sq = h('span' + (dark ? '.dk' : ''));
      if (p && game === 'chess') sq.append(h('img', { src: `pieces/${p}.svg`, alt: '', draggable: 'false' }));
      else if (p) sq.append(h('i.' + p[0] + (p[1] === 'd' ? '.dama' : '')));
      el.append(sq);
    }
    return el;
  }
  const resultTxt = w => (w === 'w' ? '1–0' : w === 'b' ? '0–1' : '½–½');
  const Watch = {
    filter: 'all', search: '', timer: null, hist: null,
    show() {
      document.title = 'Assistir · Tabuleiro em Rede';
      const root = $('#v-assistir');
      if (!this.built) {
        this.built = true;
        root.replaceChildren(
          h('div.rank-head', h('div', h('h1', 'Assistir'), h('p.muted', 'Todas as partidas são públicas: assista ao vivo, inclusive contra o computador, ou reveja qualquer partida terminada.'))),
          h('div.list-head', h('h2', 'Ao vivo agora'), h('span.muted.small#liveCount', '')),
          h('div#liveGrid.live-grid', h('div.empty', 'Carregando…')),
          h('div.list-head', { style: { marginTop: '28px' } }, h('h2', 'Partidas terminadas'),
            h('div.chips#histFilter', [['all', 'Todas'], ['chess', 'Xadrez'], ['checkers', 'Damas'], ['bot', 'Contra o computador']].map(([v, l]) =>
              h('button', { type: 'button', dataset: { v }, onclick: () => { this.filter = v; this.renderHist(); } }, l)))),
          h('input#histSearch', { placeholder: 'Buscar jogador', style: { maxWidth: '320px', marginBottom: '12px' }, oninput: e => { this.search = e.target.value; this.renderHist(); } }),
          h('div#histTable'));
      }
      this.loadLive(); this.loadHist();
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (!document.hidden && !$('#v-assistir').hidden) this.loadLive(); }, 4000);
    },
    leave() { clearInterval(this.timer); this.timer = null; },
    async loadLive() {
      try {
        const d = await api('/live');
        const items = [
          ...d.rooms.map(r => ({ key: 'r' + r.id, game: r.game, moves: r.moves, title: `${r.players.w ? r.players.w.name : '?'} × ${r.players.b ? r.players.b.name : '?'}`,
            meta: `${GAME_NAME[r.game]} · ${tcLabel(r.tc)} · ${r.rated ? 'ranqueada' : 'amistosa'}`, plies: r.plies, spectators: r.spectators, mine: r.mine, open: () => go({ sala: r.id }) })),
          ...d.bots.map(g => ({ key: 'b' + g.id, game: g.game, moves: g.moves, over: g.over,
            title: g.color === 'w' ? `${g.player ? g.player.name : '?'} × Computador ${g.level}` : `Computador ${g.level} × ${g.player ? g.player.name : '?'}`,
            meta: `${GAME_NAME[g.game]} · contra o computador · ${tcLabel(g.tc)}`, plies: g.plies, spectators: g.spectators, mine: g.player && g.player.id === me.id,
            open: () => go(g.player && g.player.id === me.id && !g.over ? { bot: 1 } : { assistir: g.id }) })),
          ...d.magnata.map(m => ({ key: 'm' + m.id, game: m.game || 'magnata', title: m.name, meta: `${{ ludo: 'Ludo', truco: 'Truco' }[m.game] || 'Magnata'} · ${m.players.map(p => p.name).join(', ')}`,
            round: m.round, spectators: m.spectators, mine: m.mine, open: () => go({ [m.game || 'magnata']: m.id }) }))
        ];
        $('#liveCount').textContent = items.length ? `${items.length} partida${items.length === 1 ? '' : 's'}` : '';
        $('#liveGrid').replaceChildren(...(items.length ? items.map(it => h('button.live-card' + (it.mine ? '.mine' : ''), { type: 'button', onclick: it.open },
          it.game === 'truco' ? h('div.mini.mag.truco', h('span', '🃏'), h('b', 'Truco')) : it.game === 'ludo' ? h('div.mini.mag.ludo', h('span', '🎲'), h('b', 'Ludo')) : it.game === 'magnata' ? h('div.mini.mag', h('span', '🎩'), h('b', `Rodada ${it.round}`)) : miniBoard(it.game, it.moves),
          h('div.lc-info', h('strong', it.title), h('span.muted.small', it.meta),
            h('span.small', it.over ? h('span.pill', 'Terminou') : h('span.pill.live', '● ao vivo'),
              it.plies !== undefined ? ` lance ${Math.floor(it.plies / 2) + 1}` : '', it.spectators ? ` · ${it.spectators} assistindo` : ''))))
          : [h('div.empty', 'Ninguém está jogando agora. Que tal começar uma partida?')]));
      } catch (e) { /* tenta de novo no próximo ciclo */ }
    },
    async loadHist() {
      try { this.hist = await api('/games'); this.renderHist(); }
      catch (e) { $('#histTable').replaceChildren(h('p.error', e.message)); }
    },
    renderHist() {
      $$('#histFilter button').forEach(b => b.classList.toggle('on', b.dataset.v === this.filter));
      if (!this.hist) return;
      const q = this.search.trim().toLowerCase();
      const list = this.hist.filter(g => (this.filter === 'all' || (this.filter === 'bot' ? g.vsBot : g.game === this.filter && !g.vsBot))
        && (!q || g.white.name.toLowerCase().includes(q) || g.black.name.toLowerCase().includes(q)));
      const who = p => (p.id ? h('span.who.link', { onclick: e => { e.stopPropagation(); go({ v: 'perfil', id: p.id }); } }, avatar(p, 'sm'), p.name, p.rating ? h('span.muted.mono', ` ${p.rating}`) : '')
        : h('span.who', avatar({ ...p, bot: true }, 'sm'), p.name));
      $('#histTable').replaceChildren(h('div.table-wrap', h('table',
        h('thead', h('tr', h('th', 'Data'), h('th', 'Jogo'), h('th', 'Brancas'), h('th', 'Pretas'), h('th', 'Resultado'), h('th', 'Motivo'), h('th.num', 'Lances'), h('th', ''))),
        h('tbody', list.length ? list.map(g => h('tr.click', { onclick: () => go({ partida: g.id }) },
          h('td.muted', fmtDateTime(g.ended)),
          h('td', h('span.glyph', GAME_ICON[g.game]), ' ', tcLabel(g.tc), g.rated ? '' : h('span.muted', ' · amistosa')),
          h('td', who(g.white)), h('td', who(g.black)),
          h('td.mono', h('b', resultTxt(g.winner))), h('td.muted', REASON[g.reason] || g.reason),
          h('td.num.mono', Math.ceil(g.plies / 2)),
          h('td', h('button.btn.small', { type: 'button' }, 'Revisar'))))
          : h('tr', h('td.empty', { colspan: 8 }, 'Nenhuma partida encontrada.'))))));
    }
  };

  /* ==================== Perfil ==================== */
  function sparkline(points) {
    const W = 300, H = 64, ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.classList.add('spark');
    const pts = [[0, 1200], ...points.map((p, i) => [i + 1, p[1]])];
    if (pts.length < 2) return svg;
    const ys = pts.map(p => p[1]), lo = Math.min(...ys) - 10, hi = Math.max(...ys) + 10;
    const X = i => (i / (pts.length - 1)) * (W - 6) + 3, Y = v => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    svg.innerHTML = `<line class="grid" x1="0" x2="${W}" y1="${Y(1200)}" y2="${Y(1200)}" stroke-dasharray="3 4"/>` +
      `<path class="area" d="${d}L${X(pts.length - 1)},${H}L${X(0)},${H}Z"/><path class="ln" d="${d}"/>` +
      `<circle class="end" cx="${X(pts.length - 1)}" cy="${Y(pts[pts.length - 1][1])}" r="3.5"/>`;
    return svg;
  }
  function resultFor(g, pid) {
    const color = g.white.id === pid ? 'w' : g.black.id === pid ? 'b' : null;
    if (!g.winner) return { cls: 'draw', txt: 'Empate', color };
    if (!color) return { cls: 'draw', txt: g.winner === 'w' ? 'Brancas' : 'Pretas', color };
    return g.winner === color ? { cls: 'win', txt: 'Vitória', color } : { cls: 'loss', txt: 'Derrota', color };
  }
  function gamesTable(games, pid) {
    if (!games.length) return h('div.table-wrap', h('div.empty', 'Nenhuma partida terminada ainda.'));
    return h('div.table-wrap', h('table',
      h('thead', h('tr', h('th', 'Data'), h('th', 'Jogo'), h('th', 'Adversário'), h('th', 'Resultado'), h('th', 'Motivo'), h('th.num', 'Pontos'), h('th.num', 'Lances'), h('th', ''))),
      h('tbody', ...games.map(g => {
        const r = resultFor(g, pid), op = r.color === 'w' ? g.black : g.white, mine = r.color === 'w' ? g.white : g.black;
        return h('tr',
          h('td.muted', fmtDateTime(g.ended)),
          h('td', h('span.glyph', GAME_ICON[g.game]), ' ', tcLabel(g.tc), g.rated ? '' : h('span.muted', ' · amistosa')),
          h('td', op.id ? h('span.who.link', { onclick: () => go({ v: 'perfil', id: op.id }) }, avatar(op, 'sm'), op.name, op.rating ? h('span.muted.mono', ` ${op.rating}`) : '')
            : h('span.who', avatar({ ...op, bot: true }, 'sm'), op.name)),
          h('td', h('span.pill.' + r.cls, r.txt)),
          h('td.muted', REASON[g.reason] || g.reason),
          h('td.num.mono', mine && mine.diff != null ? h('span', { style: { color: mine.diff >= 0 ? 'var(--ok)' : 'var(--bad)' } }, (mine.diff >= 0 ? '+' : '') + mine.diff) : '—'),
          h('td.num.mono', Math.ceil(g.plies / 2)),
          h('td', h('button.btn.small', { type: 'button', onclick: () => go({ partida: g.id }) }, 'Rever')));
      }))));
  }
  const Profile = {
    async show(id) {
      const box = $('#v-perfil');
      box.replaceChildren(h('p.muted', 'Carregando perfil…'));
      try {
        const p = await api('/profiles/' + encodeURIComponent(id));
        document.title = p.name + ' · Tabuleiro em Rede';
        const mine = p.id === me.id;
        const card = game => {
          const r = p.ratings[game];
          const pct = r.games ? Math.round(((r.w + r.d / 2) / r.games) * 100) : 0;
          return h('div.card.stat-card',
            h('div.top', h('span.gname', h('span.glyph', GAME_ICON[game]), GAME_NAME[game]), h('span.muted', `recorde ${r.peak}`)),
            h('div.rt', r.r, h('small', r.prov ? ' provisório' : ' pontos')),
            sparkline(p.hist[game] || []),
            h('div.stat-nums', h('div', h('b', r.games), h('span', 'partidas')), h('div', h('b', { style: { color: 'var(--ok)' } }, r.w), h('span', 'vitórias')),
              h('div', h('b', r.d), h('span', 'empates')), h('div', h('b', { style: { color: 'var(--bad)' } }, r.l), h('span', 'derrotas'))),
            r.games ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('div.wdl', { style: { width: '100%' } },
              h('i.w', { style: { width: (r.w / r.games) * 100 + '%' } }), h('i.d', { style: { width: (r.d / r.games) * 100 + '%' } }), h('i.l', { style: { width: (r.l / r.games) * 100 + '%' } })),
              h('span.mono.muted', pct + '%')) : null);
        };
        box.replaceChildren(...[
          h('div.profile-head', avatar(p, 'lg', p.online),
            h('div.info', h('h1', p.name), p.bio ? h('div', p.bio) : null,
              h('div.muted', `Membro desde ${fmtDate(p.created)} · ${p.online ? 'online agora' : 'offline'}`)),
            mine ? h('button.btn', { type: 'button', onclick: () => go({ v: 'config' }) }, 'Editar perfil')
              : h('button.btn.primary', { type: 'button', onclick: () => { go({ v: 'jogar' }); setTimeout(() => Lobby.challenge(p), 50); } }, 'Desafiar')),
          p.h2h && (p.h2h.w + p.h2h.d + p.h2h.l) ? h('div.h2h', h('span.muted', 'Seu confronto com ' + p.name + ':'),
            h('b', { style: { color: 'var(--ok)' } }, p.h2h.w), h('span', 'vitórias'), h('b', p.h2h.d), h('span', 'empates'), h('b', { style: { color: 'var(--bad)' } }, p.h2h.l), h('span', 'derrotas')) : null,
          h('div.stat-cards', card('chess'), card('checkers')),
          p.learn ? h('div.h2h', h('span.muted', 'Aprendizado:'), h('b', p.learn.lessons), h('span', `de ${Learn.total()} lições concluídas`), h('b', p.learn.openings), h('span', 'aberturas treinadas'),
            mine ? h('button.btn.small', { type: 'button', onclick: () => go({ v: 'aprender' }) }, 'Ir para a trilha') : null) : null,
          p.magnata && p.magnata.games ? h('div.h2h', h('span.muted', 'Magnata:'), h('b', p.magnata.games), h('span', 'partidas'),
            h('b', { style: { color: 'var(--ok)' } }, p.magnata.w), h('span', p.magnata.w === 1 ? 'vitória' : 'vitórias')) : null,
          p.truco && p.truco.games ? h('div.h2h', h('span.muted', 'Truco:'), h('b', p.truco.games), h('span', 'jogos'),
            h('b', { style: { color: 'var(--ok)' } }, p.truco.w), h('span', p.truco.w === 1 ? 'vitória' : 'vitórias')) : null,
          p.ludo && p.ludo.games ? h('div.h2h', h('span.muted', 'Ludo:'), h('b', p.ludo.games), h('span', 'partidas'),
            h('b', { style: { color: 'var(--ok)' } }, p.ludo.w), h('span', p.ludo.w === 1 ? 'vitória' : 'vitórias')) : null,
          h('p.section-title', 'Partidas recentes'),
          gamesTable(p.games, p.id)].filter(Boolean));
      } catch (e) { box.replaceChildren(h('p.error', e.message)); }
    }
  };

  /* ==================== Configurações ==================== */
  const AVATAR_COLORS = ['#c3801f', '#3d8a55', '#2f62b0', '#a8456b', '#7a5bb5', '#c2412d', '#2a8f8f', '#5b655e'];
  const BOARDS = [['verde', 'Verde'], ['madeira', 'Madeira'], ['azul', 'Azul'], ['cinza', 'Cinza'], ['roxo', 'Roxo'], ['coral', 'Coral']];
  const Settings = {
    show() {
      document.title = 'Configurações · Tabuleiro em Rede';
      const box = $('#v-config');
      const sw = (key, title, sub) => {
        const input = h('input', { type: 'checkbox', id: 'set-' + key });
        input.checked = !!S[key];
        input.addEventListener('change', () => setSetting(key, input.checked));
        return h('label.switch', h('span.lbl', title, sub ? h('small', sub) : null), input, h('span.tg'));
      };
      const seg = (key, opts) => h('div.seg', ...opts.map(([v, label]) => h('button' + (S[key] === v ? '.on' : ''), {
        type: 'button', onclick: e => { setSetting(key, v); $$('button', e.target.parentNode).forEach(b => b.classList.toggle('on', b === e.target)); }
      }, label)));

      // Perfil
      let color = me.color;
      const nameIn = h('input#setName', { maxlength: 20, value: me.name });
      const bioIn = h('input#setBio', { maxlength: 120, value: me.bio || '', placeholder: 'Ex.: Fã da Siciliana' });
      const swatches = h('div.swatches', ...AVATAR_COLORS.map(c => h('button.swatch' + (c === color ? '.on' : ''), {
        type: 'button', 'aria-label': 'Cor ' + c, style: { background: c }, onclick: e => { color = c; $$('.swatch', swatches).forEach(b => b.classList.toggle('on', b === e.target)); }
      })));
      const profErr = h('p.error');
      const profileCard = h('section.card', h('h2', 'Perfil'),
        h('label.field', 'Nome', nameIn), h('label.field', 'Frase do perfil', bioIn),
        h('div', h('p.section-title', 'Cor do avatar'), swatches), profErr,
        h('button.btn.primary', { type: 'button', onclick: async () => {
          profErr.textContent = '';
          try { me = { ...me, ...(await api('/me', { name: nameIn.value, bio: bioIn.value, color })) }; renderUserchip(); toast('Perfil salvo.'); }
          catch (e) { profErr.textContent = e.message; }
        } }, 'Salvar perfil'));

      // Aparência
      const boards = h('div.board-opts', ...BOARDS.map(([v, label]) => h('button.board-opt.board-theme-' + v + (S.board === v ? '.on' : ''), {
        type: 'button', onclick: e => { setSetting('board', v); $$('.board-opt', boards).forEach(b => b.classList.toggle('on', b === e.currentTarget)); }
      }, h('div.mini', ...Array(8).fill(0).map(() => h('i'))), label)));
      const look = h('section.card', h('h2', 'Aparência'),
        h('div', h('p.section-title', 'Tema'), seg('theme', [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']])),
        h('div', h('p.section-title', 'Tabuleiro'), boards),
        h('div', h('p.section-title', 'Peças de xadrez'), seg('pieces', [['cburnett', 'Desenhadas'], ['unicode', 'Clássicas (fonte)']])),
        h('div', h('p.section-title', 'Animação das peças'), seg('animation', [['off', 'Nenhuma'], ['fast', 'Rápida'], ['normal', 'Normal'], ['slow', 'Lenta']])),
        sw('coords', 'Coordenadas no tabuleiro'), sw('lastMove', 'Destacar último lance'));

      // Jogo
      const play = h('section.card', h('h2', 'Partida'),
        sw('legal', 'Mostrar lances possíveis', 'Pontos nas casas de destino e peças obrigadas a capturar nas damas'),
        sw('premove', 'Pré-lance no xadrez', 'Agende o lance durante a vez do adversário'),
        sw('autoQueen', 'Promover sempre para dama', 'Pula a janela de escolha da peça'),
        sw('confirmResign', 'Confirmar antes de desistir'),
        sw('arrows', 'Setas e círculos', 'Botão direito do mouse; Shift = vermelho, Alt = azul'),
        sw('chat', 'Mostrar chat nas partidas'));

      // Som e avisos
      const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volume, id: 'setVolume' });
      vol.addEventListener('input', () => setSetting('volume', Number(vol.value)));
      const sound = h('section.card', h('h2', 'Som e avisos'),
        sw('sound', 'Sons do jogo'),
        h('div.range', h('span.muted', 'Volume'), vol, h('button.btn.small', { type: 'button', onclick: () => { Sound.unlock(); setTimeout(() => Sound.play('move'), 30); setTimeout(() => Sound.play('capture'), 400); } }, 'Testar')),
        sw('flash', 'Piscar o título da aba quando for sua vez'),
        sw('notify', 'Som quando alguém desafiar você ou entrar na sala'));

      // Segurança
      const oldP = h('input', { type: 'password', autocomplete: 'current-password', id: 'setOld' }), newP = h('input', { type: 'password', autocomplete: 'new-password', id: 'setNew' });
      const passErr = h('p.error');
      const sec = h('section.card', h('h2', 'Conta'),
        h('label.field', 'Senha atual', oldP), h('label.field', 'Nova senha', newP), passErr,
        h('div.actions-row',
          h('button.btn', { type: 'button', onclick: async () => {
            passErr.textContent = '';
            try { await api('/me/password', { old: oldP.value, new: newP.value }); oldP.value = newP.value = ''; toast('Senha alterada.'); }
            catch (e) { passErr.textContent = e.message; }
          } }, 'Alterar senha'),
          h('button.btn.danger', { type: 'button', onclick: logout }, 'Sair do perfil')));

      box.replaceChildren(h('div.rank-head', h('div', h('h1', { style: { font: '400 36px var(--display)' } }, 'Configurações'),
        h('p.muted', 'Salvas no seu perfil: valem em qualquer máquina em que você entrar.'))),
        h('div.settings', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } }, profileCard, look),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '20px' } }, play, sound, sec)));
    }
  };

  /* ==================== Partida ==================== */
  const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const PIECE_NAME = { k: 'rei', q: 'dama', r: 'torre', b: 'bispo', n: 'cavalo', p: 'peão' };

  const G = {
    active: false, mode: null, data: null, hist: null, E: Chess, board: null,
    ply: null, selected: null, cpath: [], premove: null, preSel: null, flipped: null,
    es: null, sending: false, clockBase: null, chatCount: -1, resultShown: null, lastSoundPly: null,
    resignArmed: false, lowWarned: false, titleTimer: null,

    ensureBoard() {
      if (this.board) return;
      this.board = new Board($('#board'), {
        pick: sq => this.pick(sq), tap: sq => this.tap(sq), drop: (a, b) => this.drop(a, b),
        right: () => { if (this.premove || this.preSel != null || this.selected != null) { this.clearSel(); this.render(); } }
      });
      this.board.setOptions({ pieceSet: S.pieces, coords: S.coords, arrows: S.arrows });
      $('#navFirst').onclick = () => this.setPly(0);
      $('#navPrev').onclick = () => this.step(-1);
      $('#navNext').onclick = () => this.step(1);
      $('#navLast').onclick = () => this.setPly(null);
      $('#navFlip').onclick = () => this.flip();
      $('#chatForm').addEventListener('submit', e => { e.preventDefault(); this.sendChat($('#chatInput').value); });
      $('#chatQuick').replaceChildren(...['Boa sorte!', 'Bom jogo!', 'Boa jogada!', 'Obrigado!', 'Ops…', 'Revanche?'].map(t =>
        h('button', { type: 'button', onclick: () => this.sendChat(t) }, t)));
      $('#promoCancel').onclick = () => { this.closePromo(); this.render(); };
      $('#promo').addEventListener('click', e => { if (e.target.id === 'promo') { this.closePromo(); this.render(); } });
      document.addEventListener('keydown', e => {
        if (!this.active || e.target.closest('input, textarea, select')) return;
        if (e.key === 'ArrowLeft') { this.step(-1); e.preventDefault(); }
        else if (e.key === 'ArrowRight') { this.step(1); e.preventDefault(); }
        else if (e.key === 'Home') { this.setPly(0); e.preventDefault(); }
        else if (e.key === 'End') { this.setPly(null); e.preventDefault(); }
        else if (e.key === 'f' || e.key === 'F') this.flip();
        else if (e.key === 'Escape') { this.closePromo(); this.clearSel(); this.render(); }
      });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.stopFlash(); });
      setInterval(() => this.tick(), 100);
    },

    open(mode, arg) {
      this.ensureBoard();
      const key = mode + ':' + (arg || '');
      if (this.active && this.key === key) return;
      this.close();
      this.active = true; this.mode = mode; this.key = key;
      this.ply = null; this.flipped = null; this.resultShown = null; this.lastSoundPly = null; this.chatCount = -1;
      this.data = null;
      $('#gTitle').textContent = 'Carregando…';
      $('#gStatus').replaceChildren(); $('#gControls').replaceChildren(); $('#gOffers').replaceChildren();
      $('#gMoves').replaceChildren(); $('#gShare').replaceChildren(); $('#chatLog').replaceChildren(); $('#result').hidden = true;
      $('#pTop').replaceChildren(); $('#pBottom').replaceChildren();
      $('#gAnalysis').replaceChildren();
      if (mode === 'room') this.openRoom(arg);
      else if (mode === 'review') this.openReview(arg);
      else if (mode === 'watch') this.openWatch(arg);
      else if (mode === 'bot') Bot.resume();
    },

    close() {
      if (this.es) this.es.close();
      this.stopAutoplay(); Review.stop();
      this.es = null; this.active = false; this.key = null; this.data = null;
      this.closePromo(); this.clearSel(); this.stopFlash();
      Bot.detach();
    },

    async openRoom(id) {
      try {
        const j = await api(`/rooms/${id}/join`, {});
        if (!this.active || this.key !== 'room:' + id) return;
        if (j.color) this.flipped = j.color === 'b';
        if (j.color && !this.joinedSound) Sound.play('start');
      } catch (e) { errToast(e); go({}, true); return; }
      this.connect(id);
    },
    connect(id) {
      const es = new EventSource(`/api/rooms/${id}/events?token=${encodeURIComponent(token)}`);
      this.es = es;
      es.onmessage = e => { if (this.es === es) this.update(JSON.parse(e.data)); };
      es.onerror = () => {
        if (this.es !== es) return;
        this.setConn(false);
        // Conexão recusada pelo servidor (ex.: limite atingido): tenta de novo em 5 s
        if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (this.es === es && this.active) this.connect(id); }, 5000);
      };
      es.onopen = () => { if (this.es === es) this.setConn(true); };
    },
    setConn(ok) { this.connLost = !ok; if (this.data) this.renderStatus(); },

    // Assistir uma partida contra o computador que outra pessoa está jogando
    async openWatch(id) {
      const key = 'watch:' + id;
      try {
        const d = await api('/bot/live/' + encodeURIComponent(id));
        if (!this.active || this.key !== key) return;
        this.flipped = !!(d.players.b && !d.players.b.bot);
        this.update(d);
      } catch (e) { errToast(e); go({ v: 'assistir' }, true); return; }
      const es = new EventSource(`/api/bot/live/${id}/events?token=${encodeURIComponent(token)}`);
      this.es = es;
      es.onmessage = e => { if (this.es === es) this.update(JSON.parse(e.data)); };
      es.onerror = () => {
        if (this.es !== es || es.readyState !== EventSource.CLOSED) return;
        this.es = null;
        if (this.active && this.key === key) toast('A transmissão desta partida terminou.');
      };
    },

    /* ---------- Reprodução automática (revisão) ---------- */
    autoplay: null,
    toggleAutoplay() {
      if (this.autoplay) return this.stopAutoplay();
      const n = this.hist.length - 1;
      if (this.ply === null || this.ply >= n) this.ply = 0;
      this.autoplay = setInterval(() => {
        const last = this.hist.length - 1;
        if (!this.active || this.ply === null || this.ply >= last) return this.stopAutoplay();
        this.step(1);
      }, 1100);
      this.render();
    },
    stopAutoplay() {
      if (!this.autoplay) return;
      clearInterval(this.autoplay); this.autoplay = null;
      if (this.active && this.data) this.renderControls();
    },

    async openReview(id) {
      try {
        const g = await api('/games/' + encodeURIComponent(id));
        if (!this.active) return;
        const E = ENG[g.game];
        const you = g.white.id === me.id ? 'w' : g.black.id === me.id ? 'b' : null;
        const pl = p => ({ ...p, bot: p.id ? null : true, online: false });
        this.update({
          review: g, name: `${g.white.name} × ${g.black.name}`, game: g.game, tc: g.tc, rated: g.rated,
          players: { w: pl(g.white), b: pl(g.black) }, moves: g.moves,
          status: E.status(E.play(g.moves), { winner: g.winner, reason: g.reason }),
          end: { winner: g.winner, reason: g.reason, gameId: g.id, diff: g.rated ? { w: g.white.diff, b: g.black.diff } : null },
          offers: {}, chat: [], you, clock: null
        });
        this.ply = this.hist.length - 1; this.resultShown = 'skip';
        this.render();
      } catch (e) { errToast(e); go({}, true); }
    },

    /* ---------- Estado ---------- */
    update(d) {
      const prev = this.data;
      const E = ENG[d.game];
      this.E = E;
      if (this.flipped === null) this.flipped = d.you === 'b';
      if (prev && prev.you && d.you && prev.you !== d.you) this.flipped = d.you === 'b'; // revanche troca as cores
      const prevMoves = prev ? prev.moves.length : null;
      const newGame = prev && prev.gameNo !== undefined && d.gameNo !== prev.gameNo;
      this.data = d;
      this.hist = E.play(d.moves);
      this.clockBase = d.clock ? { ...d.clock, at: performance.now() } : null;
      if (d.players) for (const c of ['w', 'b']) { const p = d.players[c]; if (p && p.awayMs) p.awayAt = performance.now() - p.awayMs; }
      if (newGame) { this.resultShown = null; this.lowWarned = false; this.ply = null; Sound.play('start'); }
      // Lance novo: som, aviso de vez e pré-lance
      const n = this.hist.length - 1;
      if (this.ply !== null && this.ply > n) this.ply = null;
      if (prevMoves !== null && n !== prevMoves) {
        this.selected = null; this.cpath = [];
        if (this.lastSoundPly !== n) this.moveSound(n);
        if (n < prevMoves) { this.premove = null; this.preSel = null; }
      }
      // Entrada do adversário
      if (prev && prev.players && d.players && !this.data.review) {
        for (const c of ['w', 'b']) if (!prev.players[c] && d.players[c] && c !== d.you && S.notify) Sound.play('notify');
      }
      if (d.status.over && prev && !prev.status.over) this.endSound();
      if (prev && d.chat && prev.chat && d.chat.length > prev.chat.length) {
        const last = d.chat[d.chat.length - 1];
        if (last.pid !== me.id && last.n) Sound.play('chat');
      }
      const myTurn = this.isMyTurn();
      if (myTurn && document.hidden && S.flash && prevMoves !== null && n !== prevMoves) this.startFlash();
      if (!this.tryPremove()) this.render();
    },

    isLive() { return this.ply === null; },
    cur() { return this.hist[this.hist.length - 1]; },
    seated() { const d = this.data; return d && d.players && d.players.w && d.players.b; },
    inProgress() { const d = this.data; return d && !d.review && this.seated() && !d.status.over; },
    isMyTurn() { const d = this.data; return !!(d && d.you && this.inProgress() && this.cur().s.turn === d.you); },
    canMove() { return this.isMyTurn() && this.isLive() && !this.sending && !this.promoOpen; },
    canPremove() {
      const d = this.data;
      return S.premove && d && d.game === 'chess' && d.you && this.inProgress() && this.isLive() && this.cur().s.turn !== d.you;
    },
    orientation() { return this.flipped ? 'b' : 'w'; },
    flip() { this.flipped = !this.flipped; this.render(); },
    clearSel() { this.selected = null; this.cpath = []; this.premove = null; this.preSel = null; },
    setPly(p) {
      if (!this.data) return;
      const n = this.hist.length - 1;
      this.ply = p === null || p >= n ? (this.data.review ? n : null) : Math.max(0, p);
      if (this.data.review && this.ply === null) this.ply = n;
      this.selected = null; this.cpath = [];
      this.render();
      if (this.ply !== null && this.ply > 0) this.moveSound(this.ply, true);
    },
    step(d) {
      if (!this.data) return;
      const n = this.hist.length - 1, cur = this.ply === null ? n : this.ply;
      this.setPly(Math.max(0, Math.min(n, cur + d)));
    },

    /* ---------- Sons e aviso na aba ---------- */
    moveSound(ply, quiet) {
      this.lastSoundPly = ply;
      const hh = this.hist[ply], prev = this.hist[ply - 1];
      if (!hh || !prev || !hh.move) return;
      const count = b => b.filter(Boolean).length;
      const captured = count(hh.s.b) < count(prev.s.b);
      if (this.E === Chess && Chess.inCheck(hh.s, hh.s.turn) && !quiet) Sound.play('check');
      else Sound.play(captured ? 'capture' : 'move');
    },
    endSound() {
      const d = this.data;
      if (!d.status.winner) Sound.play('draw');
      else if (!d.you) Sound.play('win');
      else Sound.play(d.status.winner === d.you ? 'win' : 'lose');
    },
    startFlash() {
      if (this.titleTimer) return;
      let on = false;
      this.titleTimer = setInterval(() => { on = !on; document.title = on ? '● Sua vez!' : this.title || 'Tabuleiro em Rede'; }, 900);
    },
    stopFlash() { clearInterval(this.titleTimer); this.titleTimer = null; if (this.title) document.title = this.title; },

    /* ---------- Entrada de lances ---------- */
    legalFrom(sq) { return this.cur().legal.filter(m => m.from === sq); },
    pick(sq) {
      const s = this.cur().s, p = s.b[sq], you = this.data && this.data.you;
      if (this.canMove()) {
        if (!p || p[0] !== you) return false;
        if (!this.legalFrom(sq).length) {
          if (this.E === Checkers && this.cur().legal.length && this.cur().legal[0].caps.length) toast('A captura é obrigatória: jogue com uma das peças destacadas.');
          this.selected = null; this.cpath = []; this.render();
          return false;
        }
        if (this.selected !== sq) { this.selected = sq; this.cpath = []; this.render(); }
        return true;
      }
      if (this.canPremove()) {
        if (!p || p[0] !== you) return false;
        this.preSel = sq; this.premove = null; this.render();
        return true;
      }
      return false;
    },
    tap(sq) {
      if (this.canMove() && this.selected !== null) {
        if (sq === this.selected) { this.selected = null; this.cpath = []; return this.render(); }
        if (this.tryMove(this.selected, sq)) return;
        const p = this.cur().s.b[sq];
        if (p && p[0] === this.data.you && this.legalFrom(sq).length) { this.selected = sq; this.cpath = []; return this.render(); }
        this.selected = null; this.cpath = [];
        return this.render();
      }
      if (this.canPremove() && this.preSel !== null) {
        if (sq !== this.preSel && Premove.targets(this.cur().s, this.preSel).includes(sq)) this.premove = [this.preSel, sq];
        this.preSel = null;
        return this.render();
      }
      if (this.premove) { this.premove = null; this.render(); }
      else if (this.selected !== null) { this.selected = null; this.render(); }
    },
    drop(from, to) {
      if (to === null) return this.render();
      if (this.canMove()) { if (!this.tryMove(from, to)) { if (this.selected === null) this.selected = from; this.render(); } return; }
      if (this.canPremove()) {
        if (Premove.targets(this.cur().s, from).includes(to)) this.premove = [from, to];
        this.preSel = null;
      }
      this.render();
    },
    tryMove(from, to) {
      const L = this.legalFrom(from);
      if (this.E === Chess) {
        const c = L.filter(m => m.to === to);
        if (!c.length) return false;
        if (c.length > 1) { if (S.autoQueen) this.commit(c.find(m => m.promo === 'q')); else this.openPromo(c); }
        else this.commit(c[0]);
        return true;
      }
      // Damas: caminho construído casa a casa, ou destino final direto quando não há ambiguidade
      const pre = L.filter(m => this.cpath.every((x, i) => m.path[i] === x));
      const finals = pre.filter(m => m.to === to);
      if (finals.length === 1) { this.commit(finals[0]); return true; }
      const steps = pre.filter(m => m.path[this.cpath.length] === to);
      if (!steps.length) return false;
      this.cpath = this.cpath.concat(to);
      if (steps.length === 1 && steps[0].path.length === this.cpath.length) this.commit(steps[0]);
      else this.render();
      return true;
    },
    targets() {
      const st = this.cur(), b = st.s.b;
      if (this.selected === null || !S.legal) return [];
      const L = this.legalFrom(this.selected);
      if (this.E === Chess) {
        const seen = new Map();
        for (const m of L) seen.set(m.to, { sq: m.to, cap: !!b[m.to] || !!m.ep });
        return [...seen.values()];
      }
      const pre = L.filter(m => this.cpath.every((x, i) => m.path[i] === x));
      const out = new Map();
      for (const m of pre) {
        const next = m.path[this.cpath.length];
        if (next !== undefined && !out.has(next)) out.set(next, { sq: next, cap: m.caps.length > 0, step: m.path.length > this.cpath.length + 1 });
        if (!out.has(m.to) || out.get(m.to).step) out.set(m.to, { sq: m.to, cap: m.caps.length > 0 });
      }
      return [...out.values()];
    },
    commit(m) {
      if (!m) return;
      this.selected = null; this.cpath = [];
      const E = this.E, strip = E.strip(m), ply = this.data.moves.length;
      // Mostra o lance imediatamente; o servidor confirma
      this.data.moves = this.data.moves.concat(strip);
      this.hist = E.play(this.data.moves);
      this.data.status = E.status(this.hist, null);
      if (this.clockBase && this.clockBase.running) {
        const c = this.clockBase.running;
        this.clockBase[c] = this.clockLeft(c); this.clockBase.at = performance.now(); this.clockBase.running = null;
      }
      this.moveSound(this.hist.length - 1);
      this.render();
      if (this.mode === 'bot') return Bot.played(strip);
      this.sending = true;
      api(`/rooms/${this.data.id}/move`, { ply, move: strip })
        .catch(e => { errToast(e); return api(`/rooms/${this.data.id}`).then(d => this.update(d)); })
        .catch(() => {})
        .finally(() => { this.sending = false; });
    },
    tryPremove() {
      if (!this.premove || !this.canMove()) return false;
      const [from, to] = this.premove;
      this.premove = null;
      const m = this.cur().legal.find(x => x.from === from && x.to === to && (!x.promo || x.promo === 'q'));
      if (!m) return false;
      this.render();
      setTimeout(() => this.commit(m), 0);
      return true;
    },

    openPromo(cands) {
      this.promoOpen = cands;
      const you = this.data.you;
      $('#promoOpts').replaceChildren(...['q', 'r', 'b', 'n'].map(t => {
        const pc = h('div.pc.' + (S.pieces === 'unicode' ? 'uni' : 'cb') + '.' + you + t, S.pieces === 'unicode' ? h('span', { html: { q: '&#9819;', r: '&#9820;', b: '&#9821;', n: '&#9822;' }[t] + '&#xFE0E;' }) : null);
        return h('button', { type: 'button', 'aria-label': PIECE_NAME[t], onclick: () => { const m = cands.find(x => x.promo === t); this.closePromo(); this.commit(m); } }, pc);
      }));
      $('#promo').hidden = false;
      $('#promoOpts button').focus();
    },
    closePromo() { this.promoOpen = null; $('#promo').hidden = true; },

    /* ---------- Ações ---------- */
    async act(path, body = {}) {
      if (this.mode === 'bot') return Bot.action(path, body);
      try { await api(`/rooms/${this.data.id}/${path}`, body); }
      catch (e) { errToast(e); }
    },
    resign() {
      if (S.confirmResign && !this.resignArmed) {
        this.resignArmed = true; this.renderControls();
        setTimeout(() => { this.resignArmed = false; if (this.active) this.renderControls(); }, 4000);
        return;
      }
      this.resignArmed = false;
      this.act('resign');
    },
    sendChat(text) {
      text = (text || '').trim();
      if (!text || !this.data || this.mode !== 'room') return;
      $('#chatInput').value = '';
      api(`/rooms/${this.data.id}/chat`, { text }).catch(e => { errToast(e); $('#chatInput').value = text; });
    },
    async leave() {
      try { await api(`/rooms/${this.data.id}/leave`, {}); go({}); } catch (e) { errToast(e); }
    },

    /* ---------- Relógio ---------- */
    clockLeft(c) {
      const b = this.clockBase;
      if (!b) return null;
      let ms = b[c];
      if (b.running === c && !this.data.status.over) ms -= performance.now() - b.at;
      return Math.max(0, ms);
    },
    fmt(ms) {
      if (ms < 10000) return (Math.floor(ms / 100) / 10).toFixed(1);
      const s = Math.ceil(ms / 1000), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
      return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
    },
    tick() {
      if (!this.active || !this.data) return;
      if (this.mode === 'bot') Bot.tick();
      if (this.clockBase) {
        for (const c of ['w', 'b']) {
          const el = document.querySelector(`.clock[data-c="${c}"]`);
          if (!el) continue;
          const ms = this.clockLeft(c), run = !this.data.status.over && this.clockBase.running === c;
          el.textContent = this.fmt(ms);
          el.classList.toggle('run', run && ms >= 20000);
          el.classList.toggle('low', run && ms < 20000);
          el.classList.toggle('flag', ms === 0);
          if (run && c === this.data.you && ms < 10000 && !this.lowWarned) { this.lowWarned = true; Sound.play('low'); }
        }
      }
      // Contador de desconexão do adversário
      const d = this.data, op = d.you === 'w' ? 'b' : 'w', p = d.players && d.players[op];
      if (d.you && p && p.awayAt && this.inProgress()) {
        const secs = Math.floor((performance.now() - p.awayAt) / 1000);
        const el = document.querySelector('.away[data-c="' + op + '"]');
        if (el) el.textContent = `desconectado há ${secs}s`;
        const ready = secs >= 30;
        if (ready !== this.claimReady) { this.claimReady = ready; this.renderOffers(); }
      }
    },

    /* ---------- Desenho ---------- */
    render() {
      const d = this.data;
      if (!this.active || !d) return;
      const E = this.E, live = this.isLive(), n = this.hist.length - 1;
      const view = this.hist[live ? n : this.ply];
      this.board.setOptions({ orientation: this.orientation(), game: d.game, pieceSet: S.pieces, coords: S.coords, arrows: S.arrows });
      const s = view.s;
      const must = S.legal && E === Checkers && live && this.canMove() && this.selected === null && this.cur().legal.length && this.cur().legal[0].caps.length
        ? [...new Set(this.cur().legal.map(m => m.from))] : [];
      this.board.render({
        b: s.b,
        lastMove: S.lastMove && view.move ? (E === Checkers ? [view.move.from, ...view.move.path] : [view.move.from, view.move.to]) : [],
        check: E === Chess && Chess.inCheck(s, s.turn) ? Chess.kingSq(s.b, s.turn) : null,
        selected: live ? this.selected : null,
        targets: live && this.canMove() ? this.targets() : [],
        path: this.cpath,
        premove: live ? this.premove : null,
        preSel: live ? this.preSel : null,
        must
      });
      this.renderHead(); this.renderPlayers(view); this.renderStatus(); this.renderOffers(); this.renderControls();
      this.renderMoves(); this.renderChat(); this.renderShare(); this.renderResult();
      Review.render();
      this.tick();
    },

    renderHead() {
      const d = this.data;
      this.title = (d.review ? 'Replay: ' : '') + (d.name || GAME_NAME[d.game]) + ' · Tabuleiro em Rede';
      if (!this.titleTimer) document.title = this.title;
      $('#gTitle').textContent = d.name || GAME_NAME[d.game];
      const tags = [
        h('span.pill', h('span.glyph', GAME_ICON[d.game]), ' ', GAME_NAME[d.game]),
        h('span.pill', `${tcLabel(d.tc)}${d.tc ? ' · ' + tcKind(d.tc) : ''}`),
        h('span.pill', d.level ? `Computador nível ${d.level}` : d.rated ? 'Ranqueada' : 'Amistosa')
      ];
      if (d.botLive && !d.status.over) tags.push(h('span.pill.live', '● ao vivo'));
      if (d.gameNo > 1) tags.push(h('span.pill', `Partida ${d.gameNo}`));
      if (d.spectators) tags.push(h('span.pill', `${d.spectators} assistindo`));
      if (d.review) tags.push(h('span.pill', fmtDateTime(d.review.ended)));
      $('#gTags').replaceChildren(...tags);
    },

    renderPlayers(view) {
      const d = this.data, bottom = this.orientation(), top = bottom === 'w' ? 'b' : 'w';
      this.renderBar($('#pTop'), top, view);
      this.renderBar($('#pBottom'), bottom, view);
    },
    renderBar(el, c, view) {
      const d = this.data, p = d.players && d.players[c], s = view.s;
      const active = this.inProgress() && this.cur().s.turn === c;
      el.className = 'pbar' + (active ? ' active' : '');
      const kids = [h('span.turnmark')];
      if (!p) {
        kids.push(h('span.avatar', { style: { background: 'var(--surface-2)', color: 'var(--muted)' } }, '?'),
          h('div.pinfo', h('div.pname', h('span.n.muted', 'Aguardando adversário')), h('div.psub', side(c))));
        el.replaceChildren(...kids);
        return;
      }
      const diff = d.end && d.end.diff && d.end.diff[c] != null ? d.end.diff[c] : null;
      const name = p.id ? h('span.n.link', { onclick: () => go({ v: 'perfil', id: p.id }) }, p.name) : h('span.n', p.name);
      const sub = [];
      if (p.id && p.online === false && !d.review) sub.push(h('span.away', { dataset: { c } }, 'desconectado'));
      sub.push(this.material(s, c));
      kids.push(avatar(p, '', p.online && !d.review),
        h('div.pinfo',
          h('div.pname', name, h('span.prt', ratingTxt(p)), diff !== null ? h('span.prt.diff.' + (diff >= 0 ? 'up' : 'down'), (diff >= 0 ? '+' : '') + diff) : null,
            c === d.you && !d.review ? h('span.muted', { style: { fontWeight: 400, fontSize: '13px' } }, '(você)') : null),
          h('div.psub', ...sub)));
      if (d.clock) kids.push(h('span.clock', { dataset: { c } }));
      el.replaceChildren(...kids);
    },
    material(s, c) {
      const b = s.b, opp = c === 'w' ? 'b' : 'w';
      if (this.E === Checkers) {
        const n = Checkers.countPieces(b), mine = n[c + 'm'] + n[c + 'd'];
        return h('span.ckc', h('i.' + c), `${mine} peça${mine === 1 ? '' : 's'}${n[c + 'd'] ? ` · ${n[c + 'd']} dama${n[c + 'd'] > 1 ? 's' : ''}` : ''}`);
      }
      const cnt = col => { const o = { p: 0, n: 0, b: 0, r: 0, q: 0 }; for (const p of b) if (p && p[0] === col && p[1] !== 'k') o[p[1]]++; return o; };
      const mine = cnt(c), theirs = cnt(opp);
      const box = h('span.mat');
      for (const t of ['q', 'r', 'b', 'n', 'p']) {
        const k = Math.max(0, START[t] - theirs[t]);
        for (let i = 0; i < k; i++) box.append(S.pieces === 'unicode' ? h('span.g', { html: { q: '&#9819;', r: '&#9820;', b: '&#9821;', n: '&#9822;', p: '&#9823;' }[t] + '&#xFE0E;' }) : h('img', { src: `pieces/${opp}${t}.svg`, alt: '' }));
      }
      const score = o => Object.entries(o).reduce((a, [t, n]) => a + VAL[t] * n, 0);
      const adv = score(mine) - score(theirs);
      if (adv > 0) box.append(h('span.adv', '+' + adv));
      return box;
    },

    statusInfo() {
      const d = this.data, st = d.status, s = this.cur().s;
      if (this.connLost) return { cls: 'alert', title: 'Conexão perdida', detail: 'Tentando reconectar ao servidor…' };
      if (st.over) {
        const r = REASON[st.reason] || st.reason;
        if (!st.winner) return { cls: 'over', title: st.reason === 'aborted' ? 'Partida abortada' : 'Empate', detail: r };
        const wn = d.players[st.winner] ? d.players[st.winner].name : cap1(side(st.winner));
        if (d.you && !d.review) return { cls: 'over', title: st.winner === d.you ? 'Você venceu!' : 'Você perdeu', detail: r };
        return { cls: 'over', title: `${cap1(side(st.winner))} vencem`, detail: `${wn} · ${r}` };
      }
      if (!this.seated()) return { cls: '', title: 'Aguardando adversário', detail: d.invite ? 'Desafio enviado. Assim que a pessoa aceitar, a partida começa.' : 'Mande o link desta sala ou espere alguém entrar pela lista.' };
      const chk = this.E === Chess && Chess.inCheck(s, s.turn);
      const mustCap = this.E === Checkers && this.cur().legal.length && this.cur().legal[0].caps.length;
      if (this.isMyTurn()) {
        let detail = `Lance ${s.full}`;
        if (mustCap) { const k = this.cur().legal[0].caps.length; detail = `Captura obrigatória: ${k} peça${k > 1 ? 's' : ''}`; }
        if (d.moves.length < 2 && d.clock) detail += ' · o relógio começa depois do 1º lance de cada lado';
        return { cls: chk ? 'alert' : 'mine', title: chk ? 'Xeque! Sua vez' : 'Sua vez', detail };
      }
      let detail;
      if (!d.you) detail = 'Você está assistindo.';
      else if (this.mode === 'bot') detail = 'O computador está pensando…';
      else if (this.premove) detail = `Pré-lance: ${Chess.sqName(this.premove[0])} → ${Chess.sqName(this.premove[1])}. Botão direito cancela.`;
      else detail = S.premove && d.game === 'chess' ? 'Vez do adversário. Você pode agendar um pré-lance.' : 'Vez do adversário.';
      return { cls: chk ? 'alert' : '', title: (chk ? 'Xeque! ' : '') + `Vez das ${side(s.turn)}`, detail };
    },
    renderStatus() {
      const i = this.statusInfo();
      const el = $('#gStatus');
      el.className = 'status ' + i.cls;
      el.replaceChildren(h('strong', i.title), h('span', i.detail));
    },

    renderOffers() {
      const d = this.data, box = $('#gOffers');
      if (!d || d.review || !d.you) return box.replaceChildren();
      const op = d.you === 'w' ? 'b' : 'w', o = d.offers || {}, opName = d.players[op] ? d.players[op].name : 'O adversário';
      const items = [];
      const offer = (txt, kind) => h('div.offer', h('strong', txt), h('div.row',
        h('button.btn', { type: 'button', onclick: () => this.act('offer', { kind, decline: true }) }, 'Recusar'),
        h('button.btn.primary', { type: 'button', onclick: () => this.act('offer', { kind }) }, 'Aceitar')));
      if (this.inProgress()) {
        if (o.draw === op) items.push(offer(`${opName} propõe empate.`, 'draw'));
        if (o.takeback === op) items.push(offer(`${opName} pede para voltar o lance.`, 'takeback'));
        const p = d.players[op];
        if (this.mode === 'room' && p && p.awayAt && (performance.now() - p.awayAt) >= 30000)
          items.push(h('div.offer', h('strong', `${opName} saiu da partida.`), h('span.muted', 'Você pode esperar, encerrar com vitória ou com empate.'),
            h('div.row', h('button.btn', { type: 'button', onclick: () => this.act('claim', { draw: true }) }, 'Empate'),
              h('button.btn.primary', { type: 'button', onclick: () => this.act('claim') }, 'Reivindicar vitória'))));
      }
      box.replaceChildren(...items);
    },

    renderControls() {
      const d = this.data, box = $('#gControls');
      const b = (label, fn, cls = '', attrs = {}) => h('button.btn' + cls, { type: 'button', onclick: fn, ...attrs }, label);
      const items = [];
      if (d.review) {
        items.push(b(this.autoplay ? '❚❚ Pausar' : '▶ Reproduzir', () => this.toggleAutoplay(), this.autoplay ? '' : '.primary'),
          b('Exportar', () => this.exportGame()), b('Voltar', () => history.length > 1 ? history.back() : go({})));
      } else if (!d.you) {
        if (!this.seated() && !d.status.over && this.mode === 'room') items.push(b('Entrar como jogador', () => this.act('join').then(() => this.openRoomRefresh()), '.primary'));
        if (d.owner === me.id && !d.status.over) items.push(b('Continuar jogando', () => go({ bot: 1 }), '.primary'));
        if (d.end && d.end.gameId) items.push(b('Rever partida', () => go({ partida: d.end.gameId }), '.primary'));
        items.push(b('Mais partidas', () => go({ v: 'assistir' })), b('Lobby', () => go({})));
      } else if (!this.seated()) {
        items.push(b('Sair da sala', () => this.leave(), '.danger'));
      } else if (this.inProgress()) {
        const o = d.offers || {}, early = d.moves.length < 2;
        if (o.draw === d.you) items.push(b('Empate proposto · cancelar', () => this.act('offer', { kind: 'draw', cancel: true })));
        else items.push(b('½ Propor empate', () => this.act('offer', { kind: 'draw' }), '', { disabled: early || null }));
        if (o.takeback === d.you) items.push(b('Pedido enviado · cancelar', () => this.act('offer', { kind: 'takeback', cancel: true })));
        else items.push(b('↶ Voltar lance', () => this.act('offer', { kind: 'takeback' }), '', { disabled: !d.moves.length || null }));
        if (early) items.push(b('✕ Abortar', () => this.act('abort'), '.danger'));
        else items.push(b(this.resignArmed ? 'Confirmar desistência' : '⚑ Desistir', () => this.resign(), '.danger'));
        if (d.clock && this.mode === 'room') items.push(b('+15 s', () => this.act('addtime'), '', { title: 'Dar 15 segundos ao adversário' }));
        if (this.mode === 'bot') items.push(b('✨ Dica', () => Bot.hint(), '', { disabled: !this.isMyTurn() || null }));
      } else {
        items.push(...this.endButtons(false));
      }
      box.replaceChildren(...items);
    },
    endButtons(inCard) {
      const d = this.data, items = [];
      const b = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      if (!d.you || d.review) return items;
      const op = d.you === 'w' ? 'b' : 'w', o = d.offers || {};
      if (this.mode === 'bot') items.push(b('Revanche', () => Bot.rematch(), '.primary'));
      else if (this.seated()) {
        if (o.rematch === op) items.push(b('Aceitar revanche', () => this.act('offer', { kind: 'rematch' }), '.primary'), b('Recusar', () => this.act('offer', { kind: 'rematch', decline: true })));
        else if (o.rematch === d.you) items.push(b('Revanche proposta · cancelar', () => this.act('offer', { kind: 'rematch', cancel: true })));
        else items.push(b('Revanche', () => this.act('offer', { kind: 'rematch' }), '.primary'));
      }
      if (d.end && d.end.gameId) items.push(b('Rever partida', () => go({ partida: d.end.gameId })));
      if (!inCard) {
        items.push(b('Exportar', () => this.exportGame()));
        if (this.mode === 'room') items.push(b('Sair da sala', () => this.leave()));
      }
      items.push(b('Lobby', () => go({})));
      return items;
    },
    openRoomRefresh() { const id = this.data.id; this.key = null; this.open('room', id); },

    renderResult() {
      const d = this.data, box = $('#result');
      const show = d.status.over && this.isLive() && !d.review && this.resultShown !== (d.gameNo || 1) + ':' + d.moves.length;
      if (!show) { box.hidden = true; return; }
      const st = d.status, i = this.statusInfo();
      const card = h('div.result-card', h('h2', i.title), h('div.muted', REASON[st.reason] || st.reason));
      if (d.end && d.end.diff && d.you) {
        const df = d.end.diff[d.you], before = d.end.diff.before ? d.end.diff.before[d.you] : null;
        if (df != null) card.append(h('div.rs', before != null ? `${before} → ${before + df} ` : '', h('span', { style: { color: df >= 0 ? 'var(--ok)' : 'var(--bad)' } }, `(${df >= 0 ? '+' : ''}${df})`)));
      }
      if (d.series && d.you && (d.series.w + d.series.b) > 0 && this.mode === 'room') {
        const op = d.you === 'w' ? 'b' : 'w';
        card.append(h('div.series', `Placar na sala: você ${d.series[d.you]} × ${d.series[op]} ${d.players[op] ? d.players[op].name : ''}`));
      }
      card.append(h('div.row', ...this.endButtons(true), h('button.btn.ghost', { type: 'button', onclick: () => { this.resultShown = (d.gameNo || 1) + ':' + d.moves.length; box.hidden = true; } }, 'Fechar')));
      box.replaceChildren(card);
      box.hidden = false;
    },

    renderMoves() {
      const d = this.data, box = $('#gMoves'), n = this.hist.length - 1;
      const cur = this.ply === null ? n : this.ply;
      const sans = this.hist.slice(1).map(x => x.san);
      if (!sans.length) box.replaceChildren(h('div.moves-empty', { style: { gridColumn: '1 / -1' } }, d.game === 'checkers' ? 'Nenhum lance ainda. As brancas começam.' : 'Nenhum lance ainda. As brancas começam.'));
      else {
        const kids = [];
        for (let i = 0; i < sans.length; i += 2) {
          kids.push(h('span.n', (i / 2 + 1) + '.'));
          for (const j of [i, i + 1]) {
            if (j >= sans.length) { kids.push(h('span')); continue; }
            kids.push(h('span.m' + (cur === j + 1 ? '.cur' : ''), { onclick: () => this.setPly(j + 1) }, sans[j], Review.mark(j)));
          }
        }
        if (d.status.over) kids.push(h('span.res', this.resultString() + ' · ' + (REASON[d.status.reason] || '')));
        box.replaceChildren(...kids);
        const el = box.querySelector('.cur');
        if (el) { const top = el.offsetTop - box.clientHeight / 2; box.scrollTop = top; }
        else box.scrollTop = box.scrollHeight;
      }
      $('#navFirst').disabled = $('#navPrev').disabled = cur === 0;
      $('#navNext').disabled = $('#navLast').disabled = cur === n;
      $('#gViewing').replaceChildren(...(!d.review && this.ply !== null ? [h('div.viewing', `Vendo o lance ${Math.ceil(this.ply / 2)}${this.ply % 2 ? '' : '…'}`, h('button', { type: 'button', onclick: () => this.setPly(null) }, 'Voltar ao atual'))] : []));
    },
    resultString() {
      const st = this.data.status;
      if (this.data.game === 'checkers') return !st.winner ? '1-1' : st.winner === 'w' ? '2-0' : '0-2';
      return !st.winner ? '½-½' : st.winner === 'w' ? '1-0' : '0-1';
    },

    renderChat() {
      const d = this.data, wrap = $('#gChat');
      wrap.hidden = !S.chat || this.mode !== 'room';
      if (wrap.hidden) return;
      const log = $('#chatLog'), msgs = d.chat || [];
      if (msgs.length === this.chatCount) return;
      const near = log.scrollHeight - log.scrollTop - log.clientHeight < 50;
      this.chatCount = msgs.length;
      log.replaceChildren(...(msgs.length ? msgs.map(m => {
        if (!m.n) return h('div.msg.sys', m.t);
        return h('div.msg', h('span.who.' + (m.c || 's'), { onclick: () => m.pid && go({ v: 'perfil', id: m.pid }) }, m.n + (m.c ? '' : ' (espectador)')), m.t);
      }) : [h('p.none', 'Nenhuma mensagem ainda.')]));
      if (near || this.chatCount <= 3) log.scrollTop = log.scrollHeight;
    },

    renderShare() {
      const d = this.data, box = $('#gShare');
      if (this.mode !== 'room' || this.seated() && !d.private) return box.replaceChildren();
      const url = location.origin + '/?sala=' + d.id;
      const input = h('input', { value: url, readonly: true, id: 'shareUrl', onfocus: e => e.target.select() });
      box.replaceChildren(h('p.section-title', 'Link da sala'), h('div.share', input,
        h('button.btn.small', { type: 'button', onclick: () => {
          const ok = () => toast('Link copiado.');
          if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(ok, () => { input.select(); document.execCommand('copy'); ok(); });
          else { input.select(); document.execCommand('copy'); ok(); }
        } }, 'Copiar')));
    },

    /* ---------- Exportar PGN / PDN ---------- */
    exportText() {
      const d = this.data, E = this.E, sans = this.hist.slice(1).map(x => x.san);
      const date = new Date(d.review ? d.review.ended : Date.now());
      const ymd = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
      const res = d.status.over ? this.resultString().replace('½-½', '1/2-1/2') : '*';
      const tc = d.tc ? (() => { const [m, i] = d.tc.split('+').map(Number); return `${Math.round(m * 60)}+${i}`; })() : '-';
      const P = c => d.players[c] || { name: '?' };
      const head = [
        ['Event', d.name || (GAME_NAME[d.game] + ' em rede')], ['Site', 'Tabuleiro em Rede (rede local)'], ['Date', ymd],
        ['White', P('w').name], ['Black', P('b').name], ['Result', res]
      ];
      if (d.game === 'checkers') head.unshift(['GameType', '26']);
      if (P('w').rating) head.push(['WhiteElo', P('w').rating]);
      if (P('b').rating) head.push(['BlackElo', P('b').rating]);
      head.push(['TimeControl', tc]);
      if (d.status.over) head.push(['Termination', REASON[d.status.reason] || d.status.reason]);
      let body = '';
      sans.forEach((s, i) => { body += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s + ' '; });
      body += res;
      const lines = []; let line = '';
      for (const w of body.split(' ')) { if ((line + ' ' + w).length > 78) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w; }
      lines.push(line);
      return head.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n' + lines.join('\n') + '\n';
    },
    exportGame() {
      const text = this.exportText(), ext = this.data.game === 'checkers' ? 'pdn' : 'pgn';
      modal((box, close) => {
        const ta = h('textarea', { rows: 12, readonly: true, id: 'exportText' }); ta.value = text;
        box.append(h('h2', `Exportar ${ext.toUpperCase()}`),
          h('p.muted', ext === 'pgn' ? 'Cole no lichess.org/paste ou no chess.com para analisar.' : 'Formato PDN, aceito por programas de damas.'),
          ta,
          h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Fechar'),
            h('button.btn', { type: 'button', onclick: () => {
              const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: `partida-${Date.now()}.${ext}` });
              document.body.append(a); a.click(); a.remove();
            } }, 'Baixar arquivo'),
            h('button.btn.primary', { type: 'button', onclick: () => { ta.select(); document.execCommand('copy'); toast('Copiado.'); } }, 'Copiar')));
      });
    }
  };

  /* ==================== Pré-lance (alcance geométrico, como no lichess) ==================== */
  const Premove = {
    targets(s, from) {
      const p = s.b[from];
      if (!p) return [];
      const color = p[0], t = p[1], r = from >> 3, c = from & 7, out = [];
      const add = (rr, cc) => { if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) out.push(rr * 8 + cc); };
      const STEP = { n: [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]], k: [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]] };
      const RAYS = { b: [[-1,-1],[-1,1],[1,-1],[1,1]], r: [[-1,0],[1,0],[0,-1],[0,1]] };
      RAYS.q = RAYS.b.concat(RAYS.r);
      if (t === 'p') {
        const d = color === 'w' ? -1 : 1;
        add(r + d, c); add(r + d, c - 1); add(r + d, c + 1);
        if (r === (color === 'w' ? 6 : 1)) add(r + 2 * d, c);
      } else if (STEP[t]) {
        for (const [dr, dc] of STEP[t]) add(r + dr, c + dc);
        const home = color === 'w' ? 60 : 4;
        if (t === 'k' && from === home) { if (s.cr[color + 'K']) out.push(home + 2); if (s.cr[color + 'Q']) out.push(home - 2); }
      } else for (const [dr, dc] of RAYS[t]) for (let k = 1; k < 8; k++) add(r + dr * k, c + dc * k);
      return out.filter(x => x !== from && !(s.b[x] && s.b[x][0] === color && t !== 'k'));
    }
  };

  /* ==================== Revisão: análise com o computador ==================== */
  // Avalia cada posição da partida com o mesmo motor do bot (num Worker separado) e marca os lances ruins
  const MARKS = { '??': ['Capivarada', 'blunder'], '?': ['Erro', 'mistake'], '?!': ['Imprecisão', 'inacc'] };
  const evClamp = v => Math.max(-2000, Math.min(2000, v));
  const evCap = v => Math.max(-1000, Math.min(1000, v));
  function fmtEval(v, game) {
    if (Math.abs(v) >= 1900) return v > 0 ? 'Brancas ganham' : 'Pretas ganham';
    const x = (v / 100).toFixed(1).replace('.', ',');
    return (v > 0 ? '+' : '') + x + (game === 'checkers' ? ' pedras' : '');
  }
  const Review = {
    cache: {}, worker: null, pending: {}, seq: 0, job: null,
    get a() { const d = G.data; return d && d.review ? this.cache[d.review.id] || null : null; },
    stop() { if (this.job) { this.job.cancel = true; this.job = null; } },
    ask(game, moves, maxTime) {
      if (!this.worker) {
        this.worker = new Worker('bot.js');
        this.worker.onmessage = e => { const cb = this.pending[e.data.id]; delete this.pending[e.data.id]; if (cb) cb(e.data); };
      }
      return new Promise(resolve => {
        const id = 'an' + (++this.seq);
        this.pending[id] = resolve;
        this.worker.postMessage({ type: 'eval', id, game, moves, maxTime });
      });
    },
    async run() {
      const d = G.data;
      if (!d || !d.review || this.job) return;
      const g = d.review, n = g.moves.length;
      const job = this.job = { id: g.id, done: 0, total: n + 1 };
      const a = { evals: [], best: [] };
      const time = n > 120 ? 200 : n > 60 ? 300 : 450;
      this.render();
      for (let i = 0; i <= n; i++) {
        const r = await this.ask(g.game, g.moves.slice(0, i), time);
        if (job.cancel) return;
        a.evals[i] = evClamp(i % 2 === 0 ? r.v : -r.v);   // sempre do ponto de vista das brancas
        a.best[i] = r.best;
        job.done = i + 1;
        if (G.data && G.data.review && G.data.review.id === g.id) this.renderPanel();
      }
      this.classify(a, g);
      this.cache[g.id] = a; this.job = null;
      if (G.active && G.data && G.data.review && G.data.review.id === g.id) G.render();
    },
    classify(a, g) {
      a.marks = []; a.loss = { w: [], b: [] }; a.count = { w: { '??': 0, '?': 0, '?!': 0 }, b: { '??': 0, '?': 0, '?!': 0 } };
      for (let j = 0; j < g.moves.length; j++) {
        const c = j % 2 === 0 ? 'w' : 'b', sg = c === 'w' ? 1 : -1;
        const before = evCap(sg * a.evals[j]), after = evCap(sg * a.evals[j + 1]);
        const same = a.best[j] && JSON.stringify(a.best[j]) === JSON.stringify(g.moves[j]);
        const loss = same ? 0 : Math.max(0, before - after);
        a.loss[c].push(Math.min(loss, 1000));
        // Continuar ganhando com folga não é erro
        const mk = after >= 400 ? null : loss >= 300 ? '??' : loss >= 130 ? '?' : loss >= 60 ? '?!' : null;
        a.marks[j] = mk;
        if (mk) a.count[c][mk]++;
      }
      const acc = l => { if (!l.length) return null; const avg = l.reduce((x, y) => x + y, 0) / l.length; return Math.max(0, Math.min(100, Math.round(103.17 * Math.exp(-0.04354 * avg / 2) - 3.17))); };
      a.acc = { w: acc(a.loss.w), b: acc(a.loss.b) };
    },
    mark(j) {
      const a = this.a;
      if (!a || !a.marks || !a.marks[j]) return null;
      return h('span.mk.' + MARKS[a.marks[j]][1], a.marks[j]);
    },
    bestSan(g, j) {
      const a = this.a, E = ENG[g.game];
      if (!a || !a.best[j]) return null;
      const hist = E.play(g.moves.slice(0, j).concat([a.best[j]]));
      return hist.length === j + 2 ? hist[j + 1].san : null;
    },
    render() {
      const d = G.data;
      if (!d || !d.review) { $('#gAnalysis').replaceChildren(); return; }
      this.renderPanel();
      // Seta verde com o melhor lance quando o lance visto foi ruim
      const a = this.a, p = G.ply === null ? G.hist.length - 1 : G.ply;
      if (!a || !G.board) return;
      const m = p > 0 && a.marks[p - 1] ? a.best[p - 1] : null;
      G.board.shapes = m ? [{ from: m.from, to: m.to !== undefined ? m.to : m.path[m.path.length - 1], color: 'g' }] : [];
      G.board.drawShapes();
    },
    renderPanel() {
      const d = G.data, box = $('#gAnalysis');
      if (!d || !d.review) return box.replaceChildren();
      const g = d.review, a = this.a, job = this.job && this.job.id === g.id ? this.job : null;
      if (!a && !job) {
        return box.replaceChildren(h('div.card.analysis',
          h('div', h('strong', 'Análise do computador'), h('div.muted.small', 'Avalia cada lance, marca imprecisões (?!), erros (?) e capivaradas (??) e mostra qual era o melhor lance.')),
          h('button.btn.primary', { type: 'button', onclick: () => this.run(), disabled: g.moves.length < 2 || null }, '🔍︎ Analisar partida'),
          h('div.muted.small', '?! imprecisão · ? erro · ?? capivarada')));
      }
      if (!a) {
        const pct = Math.round((job.done / job.total) * 100);
        return box.replaceChildren(h('div.card.analysis',
          h('div', h('strong', `Analisando… ${pct}%`), h('div.muted.small', `Posição ${job.done} de ${job.total}. Pode navegar pelos lances enquanto isso.`)),
          h('div.bar', h('i', { style: { width: pct + '%' } })),
          h('button.btn.small', { type: 'button', onclick: () => { this.stop(); this.renderPanel(); } }, 'Cancelar')));
      }
      const n = g.moves.length, p = G.ply === null ? n : G.ply;
      const side = (c, p) => h('div.an-side',
        h('span.who', avatar(p, 'sm'), p.name),
        h('span.acc', a.acc[c] === null ? '—' : a.acc[c] + '%', h('small', ' precisão')),
        h('span.an-counts', ...['?!', '?', '??'].map(k => h('span.an-count.' + MARKS[k][1], { title: `${a.count[c][k]} × ${MARKS[k][0].toLowerCase()}` }, h('b', a.count[c][k]), k))));
      let info;
      if (p === 0) info = h('div.muted.small', 'Posição inicial. Use ← → ou clique no gráfico para navegar.');
      else {
        const j = p - 1, mk = a.marks[j], san = G.hist[p].san, best = mk ? this.bestSan(g, j) : null;
        info = h('div.an-info',
          h('div', h('b', `${Math.ceil(p / 2)}${p % 2 ? '.' : '…'} ${san}`), mk ? h('span.mk.' + MARKS[mk][1], ' ' + mk + ' ' + MARKS[mk][0]) : null),
          best ? h('div', 'Melhor era ', h('b', best), h('span.muted', ' (seta verde)')) : null);
      }
      box.replaceChildren(h('div.card.analysis',
        h('div.an-head', h('strong', 'Análise do computador'), h('span.an-eval', fmtEval(a.evals[p], g.game))),
        this.graph(a, n, p),
        info,
        side('w', g.white), side('b', g.black)));
    },
    graph(a, n, p) {
      const W = 300, H = 64, x = i => (n ? (i / n) * W : 0), y = v => H / 2 - (evCap(v) / 1000) * (H / 2 - 2);
      const pts = a.evals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      const dots = a.marks.map((m, j) => (m === '??' || m === '?' ? `<circle cx="${x(j + 1).toFixed(1)}" cy="${y(a.evals[j + 1]).toFixed(1)}" r="2.6" class="g-${MARKS[m][1]}"/>` : '')).join('');
      const svg = h('div.an-graph', {
        title: 'Vantagem ao longo da partida (clique para ir ao lance)',
        html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><rect class="g-bg" width="${W}" height="${H}"/>` +
          `<polygon class="g-area" points="0,${H} ${pts} ${W},${H}"/><line class="g-mid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/>` +
          `<polyline class="g-line" points="${pts}"/>${dots}<line class="g-cur" x1="${x(p)}" x2="${x(p)}" y1="0" y2="${H}"/></svg>`,
        onclick: e => { const r = e.currentTarget.getBoundingClientRect(); G.setPly(Math.round(((e.clientX - r.left) / r.width) * n)); }
      });
      return svg;
    }
  };

  /* ==================== Contra o computador (roda no navegador) ==================== */
  const Bot = {
    st: null, worker: null, reqId: 0, attached: false,
    ensureWorker() {
      if (this.worker) return;
      this.worker = new Worker('bot.js');
      this.worker.onmessage = e => {
        const { id, move } = e.data;
        if (id === 'hint:' + this.reqId) return this.showHint(move);
        if (id !== this.reqId || !this.attached || !this.st) return;
        this.applyMove(move);
      };
      this.worker.onerror = () => toast('O computador travou. Recarregue a página.', { err: true });
    },
    start(cfg) {
      const color = cfg.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : cfg.color;
      const tc = cfg.tc && cfg.tc !== 'none' ? cfg.tc : null;
      const base = tc ? Math.round(Number(tc.split('+')[0]) * 60000) : 0;
      this.st = { game: cfg.game, level: cfg.level, color, tc, moves: (cfg.moves || []).slice(), end: null, gameNo: (cfg.gameNo || 0) + 1,
        clock: tc ? { w: base, b: base, inc: Number(tc.split('+')[1]) * 1000, turnStart: null } : null };
      this.save();
      this.publish();
      if (G.active && G.mode === 'bot') { this.reqId++; G.update(this.data()); this.maybeThink(); }
      else go({ bot: 1 });
    },
    // Manda o estado para o servidor, para outras pessoas poderem assistir ao vivo
    publish() {
      clearTimeout(this.pubTimer);
      this.pubTimer = setTimeout(() => {
        const st = this.st;
        if (!st) return;
        const k = st.clock;
        api('/bot/live', {
          id: st.liveId, game: st.game, level: st.level, color: st.color, tc: st.tc, moves: st.moves, end: st.end,
          clock: k ? { w: this.left('w'), b: this.left('b'), running: k.turnStart && !st.end ? this.turn() : null } : null
        }).then(r => { if (r.id && this.st === st && st.liveId !== r.id) { st.liveId = r.id; this.save(); } }).catch(() => {});
      }, 120);
    },
    resume() {
      this.st = store.get('tr-bot', null);
      if (!this.st) { go({}, true); return; }
      this.ensureWorker();
      this.attached = true;
      Sound.play('start');
      G.update(this.data());
      if (!this.st.end) this.publish();
      this.maybeThink();
    },
    detach() { this.attached = false; this.reqId++; },
    save() { store.set('tr-bot', this.st); },
    E() { return ENG[this.st.game]; },
    botColor() { return this.st.color === 'w' ? 'b' : 'w'; },
    turn() { return this.st.moves.length % 2 === 0 ? 'w' : 'b'; },
    left(c) {
      const k = this.st.clock;
      if (!k) return 0;
      let ms = k[c];
      if (k.turnStart && this.turn() === c && !this.st.end) ms -= Date.now() - k.turnStart;
      return Math.max(0, ms);
    },
    status() {
      const E = this.E();
      return E.status(E.play(this.st.moves), this.st.end);
    },
    data() {
      const st = this.st, botName = `Computador nível ${st.level}`;
      const mine = { id: me.id, name: me.name, color: me.color, rating: null, online: true };
      const bot = { id: null, name: botName, color: '#5b655e', bot: st.level, online: true };
      const k = st.clock;
      return {
        id: 'bot', name: `${GAME_NAME[st.game]} contra o computador`, game: st.game, tc: st.tc, level: st.level, rated: false,
        gameNo: st.gameNo, players: { [st.color]: mine, [this.botColor()]: bot }, moves: st.moves.slice(),
        status: this.status(), end: st.end, offers: {}, chat: [], you: st.color,
        clock: k ? { w: this.left('w'), b: this.left('b'), running: k.turnStart && !st.end ? this.turn() : null } : null
      };
    },
    applyMove(strip) {
      const st = this.st, E = this.E(), hist = E.play(st.moves), cur = hist[hist.length - 1];
      if (st.end || E.status(hist, null).over) return;
      const m = cur.legal.find(x => E.match(x, strip));
      if (!m) return;
      const mover = this.turn(), k = st.clock, now = Date.now();
      if (k && k.turnStart) k[mover] = this.left(mover) + k.inc;
      st.moves.push(E.strip(m));
      if (k) k.turnStart = st.moves.length >= 2 ? now : null;
      const s2 = E.status(E.play(st.moves), null);
      if (s2.over) this.finish({ winner: s2.winner, reason: s2.reason }, true);
      this.save();
      this.publish();
      G.update(this.data());
      this.maybeThink();
    },
    played(strip) { this.applyMove(strip); },
    maybeThink() {
      const st = this.st;
      if (!this.attached || st.end || this.status().over || this.turn() !== this.botColor()) return;
      this.ensureWorker();
      const id = ++this.reqId;
      const maxTime = st.clock && st.clock.turnStart ? Math.floor(this.left(this.botColor()) / 25) : 0;
      this.worker.postMessage({ id, game: st.game, moves: st.moves, level: st.level, maxTime });
    },
    tick() {
      const st = this.st;
      if (!st || st.end || !st.clock || !st.clock.turnStart) return;
      const c = this.turn();
      if (this.left(c) > 0) return;
      st.clock[c] = 0;
      const E = this.E(), b = E.play(st.moves).slice(-1)[0].s.b, w = c === 'w' ? 'b' : 'w';
      this.finish(E.cannotWin(b, w) ? { winner: null, reason: 'timeout-draw' } : { winner: w, reason: 'time' });
    },
    finish(end, silentUpdate) {
      const st = this.st;
      if (st.end) return;
      if (st.clock && st.clock.turnStart) { const c = this.turn(); st.clock[c] = this.left(c); st.clock.turnStart = null; }
      st.end = { ...end };
      this.reqId++;
      this.save();
      if (end.reason !== 'aborted' && st.moves.length >= 2) {
        api('/games/bot', { game: st.game, moves: st.moves, level: st.level, color: st.color, tc: st.tc, winner: end.winner, reason: end.reason })
          .then(r => { if (r.id && this.st === st) { st.end.gameId = r.id; this.save(); this.publish(); if (this.attached) G.update(this.data()); } })
          .catch(() => {});
      }
      this.publish();
      if (!silentUpdate && this.attached) G.update(this.data());
    },
    material(color) {
      const b = this.E().play(this.st.moves).slice(-1)[0].s.b;
      let v = 0;
      for (const p of b) {
        if (!p) continue;
        const val = this.st.game === 'chess' ? ({ p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 })[p[1]] : p[1] === 'd' ? 3 : 1;
        v += p[0] === color ? val : -val;
      }
      return v;
    },
    action(path, body) {
      const st = this.st, bot = this.botColor();
      if (st.end) return;
      if (path === 'resign') return this.finish(st.moves.length < 2 ? { winner: null, reason: 'aborted' } : { winner: bot, reason: 'resign' });
      if (path === 'abort') return this.finish({ winner: null, reason: 'aborted' });
      if (path === 'offer' && body.kind === 'draw' && !body.cancel) {
        const v = this.material(bot);
        if (v < 0 || (st.moves.length > 80 && v <= 0)) { toast('O computador aceitou o empate.'); return this.finish({ winner: null, reason: 'agreement' }); }
        return toast('O computador recusou o empate.');
      }
      if (path === 'offer' && body.kind === 'takeback') {
        if (!st.moves.length) return;
        this.reqId++;
        const n = this.turn() === st.color ? 2 : 1;
        st.moves.splice(Math.max(0, st.moves.length - n));
        if (st.color === 'b' && !st.moves.length) { /* o computador vai jogar de novo */ }
        if (st.clock) st.clock.turnStart = st.moves.length >= 2 ? Date.now() : null;
        this.save();
        this.publish();
        G.update(this.data());
        this.maybeThink();
      }
    },
    rematch() {
      const st = this.st;
      this.start({ game: st.game, level: st.level, color: st.color === 'w' ? 'b' : 'w', tc: st.tc, gameNo: st.gameNo });
    },
    hint() {
      const st = this.st;
      if (!G.isMyTurn()) return;
      this.ensureWorker();
      this.worker.postMessage({ id: 'hint:' + this.reqId, game: st.game, moves: st.moves, level: 5 });
      toast('Calculando uma sugestão…', { ms: 1500 });
    },
    showHint(m) {
      if (!G.board || !G.isMyTurn()) return;
      G.board.shapes = [{ from: m.from, to: m.to !== undefined ? m.to : m.path[m.path.length - 1], color: 'b' }];
      G.board.drawShapes();
    }
  };


  /* ==================== Aprender: trilha, lições e biblioteca de aberturas ==================== */
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const LEVEL_NAME = { 1: 'Iniciante', 2: 'Intermediário', 3: 'Avançado' };
  const LEVEL_CLS = { Iniciante: 'lvl-1', 'Intermediário': 'lvl-2', 'Avançado': 'lvl-3' };
  const Learn = {
    boardEl: null, board: null, pb: null, token: 0,
    tab: 'trilha', libFilter: { q: '', group: 'all', side: 'all', level: 0 },

    lessons() { return window.LESSON_MODULES.flatMap(m => m.lessons.map(l => ({ ...l, module: m }))); },
    total() { return this.lessons().length; },
    prog() { return (me && me.learn) || { lessons: {}, openings: {} }; },
    nextLesson() { const done = this.prog().lessons; return this.lessons().find(l => !done[l.id]) || null; },
    async record(body) {
      try { me.learn = await api('/me/learn', body); } catch (e) { errToast(e); }
    },
    leave() { this.token++; if (this.pb) this.pb.interactive = false; },

    show(q) {
      this.token++;
      if (q.has('licao')) return this.showLesson(q.get('licao'));
      if (q.has('abertura')) return this.showOpening(q.get('abertura'));
      if (q.get('aba') === 'aberturas') return this.showLibrary();
      return this.showTrail();
    },
    tabs(active) {
      const seg = h('div.seg.learn-tabs',
        h('button' + (active === 'trilha' ? '.on' : ''), { type: 'button', onclick: () => go({ v: 'aprender' }) }, 'Trilha'),
        h('button' + (active === 'aberturas' ? '.on' : ''), { type: 'button', onclick: () => go({ v: 'aprender', aba: 'aberturas' }) }, 'Aberturas'));
      return seg;
    },

    /* ---------- Roadmap ---------- */
    showTrail() {
      document.title = 'Aprender · Tabuleiro em Rede';
      const box = $('#v-aprender'), done = this.prog().lessons, all = this.lessons();
      const n = all.filter(l => done[l.id]).length, next = this.nextLesson();
      let idx = 0;
      box.replaceChildren(
        h('div.learn-head', h('div', h('h1', 'Trilha de xadrez'), h('p.muted', { style: { margin: '4px 0 0' } }, 'Do primeiro lance ao meio-jogo: siga os módulos em ordem ou pule para o que quiser.')), this.tabs('trilha')),
        h('div.trail-top',
          h('div.card', h('div.big', `${n} `, h('small', `de ${all.length} lições concluídas`)),
            h('div.progress', h('i', { style: { width: (n / all.length) * 100 + '%' } })),
            h('div.actions-row', next ? h('button.btn.primary', { type: 'button', onclick: () => go({ v: 'aprender', licao: next.id }) }, n ? `Continuar: ${next.title}` : 'Começar a trilha')
              : h('span', { style: { fontWeight: 600, color: 'var(--ok)' } }, 'Trilha completa! Continue com a biblioteca de aberturas.'),
              h('button.btn', { type: 'button', onclick: () => go({ v: 'aprender', aba: 'aberturas' }) }, 'Biblioteca de aberturas')))),
        h('div.modules', ...window.LESSON_MODULES.map((m, mi) => {
          const k = m.lessons.filter(l => done[l.id]).length;
          return h('section.card.module',
            h('div.module-head',
              h('div.row', h('span.pill.' + LEVEL_CLS[m.level], m.level), h('span.mono.muted', `${k}/${m.lessons.length}`)),
              h('h2', `${mi + 1}. ${m.title}`), h('p', m.desc),
              h('div.progress', h('i', { style: { width: (k / m.lessons.length) * 100 + '%' } }))),
            h('div.road', ...m.lessons.map(l => {
              idx++;
              const cls = done[l.id] ? '.done' : next && next.id === l.id ? '.next' : '';
              return h('div.stop' + cls, { role: 'button', tabindex: 0, onclick: () => go({ v: 'aprender', licao: l.id }), onkeydown: e => { if (e.key === 'Enter') go({ v: 'aprender', licao: l.id }); } },
                h('span.node', done[l.id] ? '✓' : idx),
                h('div.stop-body', h('span.stop-title', l.title), h('span.stop-desc', l.desc + (l.ex.length ? ` · ${l.ex.length} exercício${l.ex.length > 1 ? 's' : ''}` : ''))));
            })));
        })));
    },

    /* ---------- Tabuleiro de estudo ---------- */
    ensureBoard() {
      if (this.board) return;
      this.boardEl = h('div');
      this.pb = { s: Chess.fromFen(START_FEN), selected: null, interactive: false, orientation: 'w', lastMove: null, marks: {}, onMove: null, onSquare: null };
      const pb = this.pb;
      const legalFrom = sq => Chess.legal(pb.s).filter(m => m.from === sq);
      const tryMove = (from, to) => {
        const c = legalFrom(from).filter(m => m.to === to);
        if (!c.length) return false;
        const pref = pb.promo || 'q';
        const m = c.find(x => x.promo === pref) || c.find(x => x.promo === 'q') || c[0];
        pb.selected = null;
        pb.onMove && pb.onMove(m);
        return true;
      };
      this.board = new Board(this.boardEl, {
        pick: sq => {
          if (!pb.interactive || pb.onSquare) return false;
          const p = pb.s.b[sq];
          if (!p || p[0] !== pb.s.turn || !legalFrom(sq).length) return false;
          if (pb.selected !== sq) { pb.selected = sq; this.renderBoard(); }
          return true;
        },
        tap: sq => {
          if (pb.onSquare) return pb.onSquare(sq);
          if (!pb.interactive) return;
          if (pb.selected !== null && sq !== pb.selected && tryMove(pb.selected, sq)) return;
          const p = pb.s.b[sq];
          pb.selected = p && p[0] === pb.s.turn && pb.selected !== sq && legalFrom(sq).length ? sq : null;
          this.renderBoard();
        },
        drop: (from, to) => { if (to === null || !pb.interactive || !tryMove(from, to)) this.renderBoard(); },
        right: () => { pb.selected = null; this.renderBoard(); }
      });
    },
    renderBoard(animate = true) {
      const pb = this.pb, s = pb.s;
      this.board.setOptions({ orientation: pb.orientation, game: 'chess', pieceSet: S.pieces, coords: S.coords, arrows: S.arrows });
      this.board.render({
        b: s.b,
        lastMove: S.lastMove && pb.lastMove ? [pb.lastMove.from, pb.lastMove.to] : [],
        check: Chess.inCheck(s, s.turn) ? Chess.kingSq(s.b, s.turn) : null,
        selected: pb.selected,
        targets: pb.selected !== null && S.legal ? Chess.legal(s).filter(m => m.from === pb.selected).map(m => ({ sq: m.to, cap: !!s.b[m.to] || !!m.ep })) : [],
        marks: pb.marks
      }, animate);
    },
    setPos(s, lastMove, animate) {
      const pb = this.pb;
      pb.s = s; pb.lastMove = lastMove || null; pb.selected = null; pb.marks = {};
      this.renderBoard(animate);
    },
    arrow(from, to) { this.board.shapes = [{ from, to, color: 'b' }]; this.board.drawShapes(); },
    sound(s, m, next) {
      if (Chess.inCheck(next, next.turn)) Sound.play('check');
      else Sound.play(s.b[m.to] || m.ep ? 'capture' : 'move');
    },
    layout(sideKids) {
      this.ensureBoard();
      const box = $('#v-aprender');
      const col = h('div.board-col', h('div.board-wrap', this.boardEl));
      box.replaceChildren(h('div.game', col, h('aside.lesson-side', ...sideKids)));
      this.board.layout();
    },

    /* ---------- Lição ---------- */
    showLesson(id) {
      this.ensureBoard();
      const all = this.lessons(), i = all.findIndex(l => l.id === id);
      if (i < 0) return go({ v: 'aprender' }, true);
      const les = all[i];
      document.title = les.title + ' · Aprender';
      this.les = les; this.exIdx = 0; this.solved = les.ex.map(() => false);
      this.feedbackEl = h('div.feedback');
      this.exBox = h('div.exercise');
      this.layout([
        h('div.crumbs', h('a', { onclick: () => go({ v: 'aprender' }) }, 'Trilha'), '›', h('span', les.module.title), '›', h('span', `Lição ${i + 1} de ${all.length}`)),
        h('h1', les.title),
        h('div.lesson-text', ...les.text.map(t => h('p', t))),
        this.exBox
      ]);
      if (!les.ex.length) {
        this.setPos(Chess.fromFen(START_FEN), null, false);
        this.pb.interactive = false;
        this.exBox.replaceChildren(h('div.prompt', 'Esta lição não tem exercícios.'),
          h('div.ex-actions', h('button.btn.primary', { type: 'button', onclick: () => this.finishLesson() }, 'Marcar como concluída')));
        return;
      }
      this.startExercise();
    },
    exStart(ex) {
      let s = Chess.fromFen(ex.fen || START_FEN), last = null;
      if (ex.moves) for (const t of ex.moves.split(/\s+/)) { const m = Chess.sanToMove(s, t); last = m; s = Chess.apply(s, m); }
      return { s, last };
    },
    startExercise() {
      const tk = ++this.token, les = this.les, ex = les.ex[this.exIdx], pb = this.pb;
      const { s, last } = this.exStart(ex);
      this.ex = ex; this.step = 0; this.fails = 0; this.base = s; this.board.clearShapes();
      pb.orientation = ex.t === 'square' ? 'w' : s.turn;
      pb.onSquare = null; pb.onMove = null; pb.interactive = false; pb.promo = null;
      this.setPos(s, last, false);
      const fb = this.feedbackEl;
      fb.className = 'feedback info'; fb.textContent = '';
      const say = (t, cls) => { fb.className = 'feedback ' + cls; fb.textContent = t; };
      const revert = (ms = 750) => setTimeout(() => { if (tk === this.token) { this.setPos(this.cur, this.curLast); pb.interactive = true; } }, ms);
      this.cur = s; this.curLast = last;
      const success = msg => {
        pb.interactive = false;
        this.solved[this.exIdx] = true;
        say(msg || 'Correto!', 'ok');
        Sound.play('win');
        this.renderExBox();
      };
      const wrong = msg => {
        this.fails++;
        say(msg + (this.fails >= 2 ? ' Use a dica se precisar.' : ''), 'bad');
        Sound.play('illegal');
      };

      if (ex.t === 'square') {
        pb.onSquare = sq => {
          const name = Chess.sqName(sq);
          if (this.solved[this.exIdx]) return;
          if (name === ex.sq) { pb.marks = { [sq]: 'good' }; this.renderBoard(); success(`Isso: ${name}.`); }
          else { pb.marks = { [sq]: 'wrong' }; this.renderBoard(); wrong(`Essa é a casa ${name}.`); setTimeout(() => { if (tk === this.token) { pb.marks = {}; this.renderBoard(); } }, 700); }
        };
      } else if (ex.t === 'demo') {
        this.demoStep = 0;
      } else {
        pb.interactive = true;
        if (ex.sol && ex.sol.some(t => /=([RBN])/.test(t))) pb.promo = ex.sol.find(t => /=([RBN])/.test(t)).match(/=([RBN])/)[1].toLowerCase();
        pb.onMove = m => {
          const cur = this.cur, san = Chess.toSan(cur, m), next = Chess.apply(cur, m);
          this.sound(cur, m, next);
          this.setPos(next, m);
          pb.interactive = false;
          this.board.clearShapes();
          if (ex.t === 'move') {
            if (ex.sol.some(t => Chess.normSan(t) === Chess.normSan(san))) { this.cur = next; this.curLast = m; return success(`Correto: ${san}.`); }
            wrong(`${san} não é a resposta. Tente de novo.`); return revert();
          }
          if (ex.t === 'mate') {
            const none = !Chess.legal(next).length, chk = Chess.inCheck(next, next.turn);
            if (none && chk) { this.cur = next; this.curLast = m; return success(`Xeque-mate! ${san}`); }
            wrong(none ? `${san} afoga o rei: seria empate!` : chk ? `${san} é xeque, mas o rei escapa.` : `${san} não é xeque-mate.`);
            return revert();
          }
          if (ex.t === 'line') {
            const want = ex.line[this.step];
            if (Chess.normSan(want) !== Chess.normSan(san)) { wrong(`${san} não é o lance da sequência.`); return revert(); }
            this.cur = next; this.curLast = m; this.step++; this.fails = 0;
            if (this.step >= ex.line.length) return success(`Perfeito! ${san}`);
            say(`${san}. Boa! O adversário responde…`, 'info');
            setTimeout(() => {
              if (tk !== this.token) return;
              const r = Chess.sanToMove(this.cur, ex.line[this.step]), n2 = Chess.apply(this.cur, r);
              this.sound(this.cur, r, n2);
              this.cur = n2; this.curLast = r; this.step++;
              this.setPos(n2, r);
              if (this.step >= ex.line.length) return success('Sequência completa!');
              say(`O adversário jogou ${ex.line[this.step - 1]}. Sua vez.`, 'info');
              pb.interactive = true;
            }, 650);
          }
        };
      }
      this.renderExBox();
    },
    hint() {
      const ex = this.ex, s = this.cur;
      let m = null;
      if (ex.t === 'square') { this.pb.marks = { [((8 - +ex.sq[1]) * 8 + 'abcdefgh'.indexOf(ex.sq[0]))]: 'good' }; this.renderBoard(); return; }
      if (ex.t === 'move') m = Chess.sanToMove(s, ex.sol[0]);
      else if (ex.t === 'line') m = Chess.sanToMove(s, ex.line[this.step]);
      else if (ex.t === 'mate') m = Chess.legal(s).find(x => { const n = Chess.apply(s, x); return Chess.inCheck(n, n.turn) && !Chess.legal(n).length; });
      if (m) this.arrow(m.from, m.to);
    },
    demoGo(d) {
      const ex = this.ex;
      const n = Math.max(0, Math.min(ex.line.length, this.demoStep + d));
      let s = this.base, last = null;
      for (let i = 0; i < n; i++) { const m = Chess.sanToMove(s, ex.line[i]); if (i === n - 1) this.sound(s, m, Chess.apply(s, m)); last = m; s = Chess.apply(s, m); }
      this.demoStep = n;
      this.setPos(s, last);
      if (n === ex.line.length && !this.solved[this.exIdx]) { this.solved[this.exIdx] = true; this.feedbackEl.className = 'feedback ok'; this.feedbackEl.textContent = 'Fim da demonstração.'; }
      else if (n < ex.line.length) { this.feedbackEl.className = 'feedback info'; this.feedbackEl.textContent = n ? `Lance ${n} de ${ex.line.length}: ${ex.line[n - 1]}` : 'Use ▶ para avançar.'; }
      this.renderExBox();
    },
    renderExBox() {
      const les = this.les, ex = this.ex, i = this.exIdx, n = les.ex.length, solved = this.solved[i];
      const b = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      const actions = [];
      if (ex.t === 'demo') actions.push(b('◀', () => this.demoGo(-1)), b('▶ Avançar', () => this.demoGo(1), '.primary'));
      else if (!solved) actions.push(b('Dica', () => this.hint()), b('Recomeçar', () => this.startExercise()));
      else actions.push(b('Repetir', () => this.startExercise()));
      const allDone = this.solved.every(Boolean);
      if (i < n - 1) actions.push(b('Próximo exercício →', () => { this.exIdx++; this.startExercise(); }, solved ? '.primary' : ''));
      const kids = [
        h('div.ex-head', h('span.section-title', { style: { margin: 0 } }, `Exercício ${i + 1} de ${n}`),
          h('div.dots', ...les.ex.map((_, k) => h('i' + (this.solved[k] ? '.ok' : k === i ? '.cur' : ''), { title: `Exercício ${k + 1}`, style: { cursor: 'pointer' }, onclick: () => { this.exIdx = k; this.startExercise(); } })))),
        h('div.prompt', ex.prompt),
        this.feedbackEl,
        h('div.ex-actions', ...actions)
      ];
      this.exBox.replaceChildren(...kids);
      if (allDone) this.finishLesson();
    },
    finishLesson() {
      const les = this.les, all = this.lessons(), i = all.findIndex(l => l.id === les.id), next = all[i + 1];
      if (!this.prog().lessons[les.id]) this.record({ lesson: les.id });
      const banner = h('div.done-banner', h('h2', 'Lição concluída!'),
        h('div', next ? `Próxima: ${next.title}` : 'Você terminou a trilha inteira. Parabéns!'),
        h('div.ex-actions', next ? h('button.btn', { type: 'button', onclick: () => go({ v: 'aprender', licao: next.id }) }, 'Próxima lição →') : null,
          h('button.btn', { type: 'button', onclick: () => go({ v: 'aprender' }) }, 'Ver a trilha')));
      const old = this.exBox.parentNode && this.exBox.parentNode.querySelector('.done-banner');
      if (old) old.remove();
      this.exBox.after(banner);
    },

    /* ---------- Biblioteca ---------- */
    lineSans(o) { return o.moves.split(/\s+/); },
    preview(o, n = 10) {
      return this.lineSans(o).slice(0, n).map((t, i) => (i % 2 === 0 ? `${i / 2 + 1}.` : '') + t).join(' ') + (this.lineSans(o).length > n ? ' …' : '');
    },
    showLibrary() {
      document.title = 'Aberturas · Aprender';
      const f = this.libFilter, box = $('#v-aprender'), trained = this.prog().openings;
      const search = h('input#libSearch', { placeholder: 'Buscar por nome, ECO ou lances', value: f.q });
      search.addEventListener('input', () => { f.q = search.value; this.renderLibList(); });
      const chips = (key, opts) => h('div.chips', ...opts.map(([v, label]) => h('button' + (f[key] === v ? '.on' : ''), {
        type: 'button', onclick: e => { f[key] = v; $$('button', e.target.parentNode).forEach(x => x.classList.toggle('on', x === e.target)); this.renderLibList(); }
      }, label)));
      this.libList = h('div');
      box.replaceChildren(
        h('div.learn-head', h('div', h('h1', 'Biblioteca de aberturas'),
          h('p.muted', { style: { margin: '4px 0 0' } }, `${window.OPENINGS.length} aberturas e variantes. Abra uma para ver os lances e as ideias, treinar a linha ou jogar a partir dela contra o computador.`)), this.tabs('aberturas')),
        h('div.lib-tools', search,
          chips('group', [['all', 'Todas'], ...window.OPENING_GROUPS.map(g => [g.id, g.name])]),
          chips('side', [['all', 'Ambas as cores'], ['w', 'Brancas'], ['b', 'Pretas']]),
          chips('level', [[0, 'Todos os níveis'], [1, 'Iniciante'], [2, 'Intermediário'], [3, 'Avançado']])),
        this.libList);
      this.renderLibList();
    },
    renderLibList() {
      const f = this.libFilter, trained = this.prog().openings, q = f.q.trim().toLowerCase();
      const norm = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const match = o => (f.group === 'all' || o.group === f.group) && (f.side === 'all' || o.side === f.side) && (!f.level || o.level === f.level)
        && (!q || norm(o.name).includes(norm(q)) || o.eco.toLowerCase().includes(q) || o.moves.toLowerCase().includes(q));
      const row = (o, isVar) => h('div.op-row' + (isVar ? '.var' : ''), { role: 'button', tabindex: 0, onclick: () => go({ v: 'aprender', abertura: o.id }), onkeydown: e => { if (e.key === 'Enter') go({ v: 'aprender', abertura: o.id }); } },
        h('span.op-eco', o.eco),
        h('div', { style: { minWidth: 0 } }, h('div.op-name', o.name), h('div.op-moves', this.preview(o))),
        h('div.op-tags', trained[o.id] ? h('span.trained', `✓ ${trained[o.id]}×`) : null,
          h('span.pill.lvl-' + o.level, LEVEL_NAME[o.level]), h('span.pill', o.side === 'w' ? 'Brancas' : 'Pretas')));
      const groups = window.OPENING_GROUPS.map(g => {
        const mains = window.OPENINGS.filter(o => o.group === g.id && !o.parent);
        const rows = [];
        const addTree = (o, depth) => {
          const kids = window.OPENINGS.filter(x => x.parent === o.id);
          const show = match(o), kidRows = [];
          for (const k of kids) {
            const sub = window.OPENINGS.filter(x => x.parent === k.id);
            if (match(k)) kidRows.push(row(k, true));
            for (const s2 of sub) if (match(s2)) kidRows.push(row(s2, true));
          }
          if (show || kidRows.length) rows.push(row(o, false), ...kidRows);
        };
        mains.forEach(o => addTree(o, 0));
        return rows.length ? h('section.lib-group', h('h2', g.name, h('small', g.sub)), h('div.op-list', ...rows)) : null;
      }).filter(Boolean);
      this.libList.replaceChildren(...(groups.length ? groups : [h('div.empty', 'Nenhuma abertura encontrada com esses filtros.')]));
    },

    /* ---------- Abertura ---------- */
    showOpening(id) {
      this.ensureBoard();
      const o = window.OPENINGS.find(x => x.id === id);
      if (!o) return go({ v: 'aprender', aba: 'aberturas' }, true);
      document.title = o.name + ' · Aberturas';
      this.op = o; this.opPly = null; this.training = null;
      // Converte a linha em lances do motor
      let s = Chess.fromFen(START_FEN);
      this.opStates = [{ s, m: null, san: null }];
      for (const t of this.lineSans(o)) { const m = Chess.sanToMove(s, t); const n = Chess.apply(s, m); this.opStates.push({ s: n, m, san: Chess.toSan(s, m) }); s = n; }
      this.opPly = this.opStates.length - 1;
      this.pb.orientation = o.side;
      const parent = o.parent && window.OPENINGS.find(x => x.id === o.parent);
      const kids = window.OPENINGS.filter(x => x.parent === o.id);
      const group = window.OPENING_GROUPS.find(g => g.id === o.group);
      this.opMoves = h('div.moves');
      this.opStatus = h('div.feedback');
      this.opControls = h('div.controls');
      const nav = h('div.nav-btns',
        h('button', { type: 'button', 'aria-label': 'Início', onclick: () => this.opGo(0) }, '⏮︎'),
        h('button', { type: 'button', 'aria-label': 'Anterior', onclick: () => this.opGo(this.opPly - 1) }, '◀︎'),
        h('button', { type: 'button', 'aria-label': 'Próximo', onclick: () => this.opGo(this.opPly + 1) }, '▶︎'),
        h('button', { type: 'button', 'aria-label': 'Final', onclick: () => this.opGo(this.opStates.length - 1) }, '⏭︎'),
        h('button', { type: 'button', 'aria-label': 'Girar', onclick: () => { this.pb.orientation = this.pb.orientation === 'w' ? 'b' : 'w'; this.renderBoard(false); } }, '⇅︎'));
      this.layout([
        h('div.crumbs', h('a', { onclick: () => go({ v: 'aprender', aba: 'aberturas' }) }, 'Aberturas'), '›', h('span', group.name),
          parent ? ['›', h('a', { onclick: () => go({ v: 'aprender', abertura: parent.id }) }, parent.name)] : null),
        h('h1', o.name),
        h('div.tags', h('span.pill.mono', o.eco), h('span.pill.lvl-' + o.level, LEVEL_NAME[o.level]), h('span.pill', `Repertório das ${o.side === 'w' ? 'brancas' : 'pretas'}`),
          this.prog().openings[o.id] ? h('span.pill.live', `treinada ${this.prog().openings[o.id]}×`) : null),
        this.opControls, this.opStatus,
        h('div.moves-box', nav, this.opMoves),
        h('div', h('p.section-title', 'Ideias'), h('ul.ideas', ...o.ideas.map(t => h('li', t)))),
        o.trap ? h('div.trap', h('strong', 'Cuidado: '), o.trap) : null,
        kids.length ? h('div', h('p.section-title', 'Variantes'), h('div.variants', ...kids.map(k => h('button', { type: 'button', onclick: () => go({ v: 'aprender', abertura: k.id }) }, k.name)))) : null
      ]);
      this.pb.interactive = false; this.pb.onSquare = null;
      this.renderOpControls();
      this.opGo(this.opPly, false);
    },
    opGo(p, animate = true) {
      if (this.training) return;
      p = Math.max(0, Math.min(this.opStates.length - 1, p));
      const changed = p !== this.opPly;
      this.opPly = p;
      const st = this.opStates[p];
      if (changed && st.m) this.sound(this.opStates[p - 1].s, st.m, st.s);
      this.board.clearShapes();
      this.setPos(st.s, st.m, animate);
      this.renderOpMoves();
    },
    renderOpMoves(upto) {
      const n = upto === undefined ? this.opStates.length - 1 : upto, kids = [];
      for (let i = 1; i <= n; i += 2) {
        kids.push(h('span.n', `${(i + 1) / 2}.`));
        for (const j of [i, i + 1]) {
          if (j > n) { kids.push(h('span')); continue; }
          kids.push(h('span.m' + (this.opPly === j ? '.cur' : ''), { onclick: () => this.opGo(j) }, this.opStates[j].san));
        }
      }
      this.opMoves.replaceChildren(...kids);
    },
    renderOpControls() {
      const o = this.op, b = (label, fn, cls = '') => h('button.btn' + cls, { type: 'button', onclick: fn }, label);
      if (this.training) {
        this.opControls.replaceChildren(b('Recomeçar treino', () => this.train(this.training.color)), b('Parar treino', () => this.stopTrain()));
        return;
      }
      const other = o.side === 'w' ? 'b' : 'w';
      this.opControls.replaceChildren(
        b(`Treinar (${o.side === 'w' ? 'brancas' : 'pretas'})`, () => this.train(o.side), '.primary'),
        b(`Treinar com as ${other === 'w' ? 'brancas' : 'pretas'}`, () => this.train(other)),
        b('Jogar daqui contra o computador', () => {
          const moves = this.opStates.slice(1, this.opPly + 1).map(x => Chess.strip(x.m));
          Bot.start({ game: 'chess', level: Lobby.form.level, color: this.pb.orientation, tc: null, moves });
        }),
        b('Copiar PGN', () => {
          const sans = this.opStates.slice(1).map(x => x.san);
          let pgn = `[Event "${o.name}"]\n[ECO "${o.eco}"]\n[Result "*"]\n\n`;
          sans.forEach((t, i) => { pgn += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + t + ' '; });
          pgn += '*\n';
          const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = pgn; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
          toast('PGN copiado.');
        }));
    },
    train(color) {
      const tk = ++this.token, pb = this.pb, total = this.opStates.length - 1;
      this.training = { color, ply: 0, errors: 0, fails: 0 };
      pb.orientation = color;
      this.board.clearShapes();
      this.setPos(this.opStates[0].s, null, false);
      this.renderOpMoves(0);
      this.renderOpControls();
      const say = (t, cls) => { this.opStatus.className = 'feedback ' + cls; this.opStatus.textContent = t; };
      const T = this.training;
      const advance = () => {
        if (tk !== this.token) return;
        if (T.ply >= total) {
          pb.interactive = false;
          say(T.errors ? `Linha completa, com ${T.errors} erro${T.errors > 1 ? 's' : ''}. Treine de novo para fixar.` : 'Linha completa sem erros!', 'ok');
          Sound.play('win');
          this.record({ opening: this.op.id });
          return;
        }
        const st = this.opStates[T.ply + 1];
        if (st.s.turn !== color) { // depois deste lance é a vez do adversário: então este lance é meu
          pb.interactive = true;
          say(`Sua vez: lance ${Math.floor(T.ply / 2) + 1}${T.ply % 2 ? '…' : '.'}`, 'info');
        } else {
          pb.interactive = false;
          setTimeout(() => {
            if (tk !== this.token) return;
            const prev = this.opStates[T.ply].s;
            this.sound(prev, st.m, st.s);
            T.ply++;
            this.setPos(st.s, st.m);
            this.opPly = T.ply; this.renderOpMoves(T.ply);
            advance();
          }, T.ply === 0 ? 300 : 550);
        }
      };
      pb.onMove = m => {
        const prev = this.opStates[T.ply].s, want = this.opStates[T.ply + 1];
        const next = Chess.apply(prev, m);
        this.sound(prev, m, next);
        this.board.clearShapes();
        if (want && want.m.from === m.from && want.m.to === m.to && (want.m.promo || null) === (m.promo || null)) {
          T.ply++; T.fails = 0;
          this.setPos(want.s, want.m);
          this.opPly = T.ply; this.renderOpMoves(T.ply);
          advance();
        } else {
          T.errors++; T.fails++;
          pb.interactive = false;
          this.setPos(next, m);
          say(T.fails >= 2 ? `Na linha, o lance é ${want.san}. A seta mostra.` : `${Chess.toSan(prev, m)} não é o lance desta linha. Tente de novo.`, 'bad');
          Sound.play('illegal');
          setTimeout(() => {
            if (tk !== this.token) return;
            this.setPos(prev, this.opStates[T.ply].m);
            if (T.fails >= 2) this.arrow(want.m.from, want.m.to);
            pb.interactive = true;
          }, 750);
        }
      };
      advance();
    },
    stopTrain() {
      this.token++;
      this.training = null; this.pb.interactive = false; this.pb.onMove = null;
      this.opStatus.textContent = '';
      this.renderOpControls();
      this.opGo(this.opStates.length - 1, false);
      this.pb.orientation = this.op.side; this.renderBoard(false);
    }
  };
  document.addEventListener('keydown', e => {
    if ($('#v-aprender').hidden || e.target.closest('input, textarea, select')) return;
    if (Learn.op && new URLSearchParams(location.search).has('abertura') && !Learn.training) {
      if (e.key === 'ArrowLeft') { Learn.opGo(Learn.opPly - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { Learn.opGo(Learn.opPly + 1); e.preventDefault(); }
    } else if (Learn.ex && Learn.ex.t === 'demo' && new URLSearchParams(location.search).has('licao')) {
      if (e.key === 'ArrowLeft') Learn.demoGo(-1);
      if (e.key === 'ArrowRight') Learn.demoGo(1);
    }
  });

  /* ==================== Início ==================== */
  const shared = { $, $$, h, api, toast, errToast, modal, go, avatar, fmtDate, fmtDateTime, store, poll, me: () => me, token: () => token };
  for (const make of window.TR_MODULES || []) Object.assign(X, make(shared));
  applySettings();
  if (token) api('/me').then(onLogin).catch(() => { if (!me) showLogin(); });
  else showLogin();
})();

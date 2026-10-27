// Tabuleiro em Rede — sugestões de jogos (sugerir, votar, comentar; admin muda status e responde)
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast, modal, avatar, fmtDate, fmtDateTime } = T;
  const STATUS = {
    nova: { label: 'Nova', color: '#868e96', icon: '🆕' },
    analise: { label: 'Em análise', color: '#1c7ed6', icon: '🔍' },
    planejado: { label: 'Planejado', color: '#7048e8', icon: '🗓' },
    fazendo: { label: 'Em desenvolvimento', color: '#f08c00', icon: '🛠' },
    feito: { label: 'Feito', color: '#2f9e44', icon: '✅' },
    recusado: { label: 'Recusado', color: '#c92a2a', icon: '✖' }
  };
  const CAT = { tabuleiro: '♟ Tabuleiro', cartas: '🃏 Cartas', dados: '🎲 Dados', grupo: '🎉 Festa / em grupo', cassino: '🎰 Cassino', raciocinio: '🧩 Raciocínio', outro: '✨ Outro' };
  const SORTS = { votes: 'Mais votadas', new: 'Mais recentes', talk: 'Mais comentadas', updated: 'Atualizadas agora' };
  const norm = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = t => norm(t).split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const pill = (s, small) => h('span.sg-status' + (small ? '.sm' : ''), { style: { '--c': STATUS[s].color } }, STATUS[s].icon + ' ' + STATUS[s].label);

  const P = {
    active: false, list: [], admin: false, left: null, filter: 'all', sort: T.store.get('sg-sort', 'votes'), q: '', onlyMine: false,
    open: new Set(), replying: null, editing: null, timer: null,

    async show() {
      this.active = true;
      document.title = 'Sugestões · Tabuleiro em Rede';
      const root = $('#v-sugestoes');
      if (!this.root || !root.contains(this.root)) this.build(root);
      await this.load();
      clearInterval(this.timer);
      // Atualiza sozinho, mas não enquanto a pessoa está escrevendo
      this.timer = setInterval(() => { if (!this.root.contains(document.activeElement) || document.activeElement === document.body) this.load(); }, 30000);
    },
    leave() { this.active = false; clearInterval(this.timer); this.timer = null; },
    async load() {
      try {
        const d = await api('/sugestoes');
        this.list = d.list; this.admin = d.admin; this.left = d.left;
        this.render();
      } catch (e) { errToast(e); }
    },
    put(item) {
      const i = this.list.findIndex(s => s.id === item.id);
      if (i >= 0) this.list[i] = item; else this.list.unshift(item);
      this.render();
    },

    build(root) {
      this.head = h('div.sg-head');
      this.tools = h('div.sg-tools');
      this.listEl = h('div.sg-list');
      this.side = h('aside.sg-side');
      this.root = h('div.sg', this.head, h('div.sg-grid', h('div.sg-main', this.tools, this.listEl), this.side));
      root.replaceChildren(this.root);
      this.buildForm();
    },
    render() {
      if (!this.active) return;
      this.renderHead();
      this.renderTools();
      this.renderList();
      this.renderSide();
    },
    count(st) { return this.list.filter(s => s.status === st).length; },
    renderHead() {
      const pending = this.count('nova');
      this.head.replaceChildren(
        h('div', h('h1', '💡 Sugestões de jogos'), h('p.muted', 'Que jogo você quer ver aqui? Sugira, vote nas ideias dos outros e acompanhe o que está sendo feito.')),
        h('div.sg-stats',
          h('div', h('b', this.list.length), h('small', 'sugestões')),
          h('div', h('b', this.count('planejado') + this.count('fazendo')), h('small', 'a caminho')),
          h('div', h('b', this.count('feito')), h('small', 'já feitas')),
          this.admin && pending ? h('button.sg-pending', { type: 'button', onclick: () => { this.filter = 'nova'; this.sort = 'votes'; this.render(); } }, h('b', pending), h('small', pending === 1 ? 'nova para analisar' : 'novas para analisar')) : null));
    },
    renderTools() {
      const chip = (v, label, n) => h('button' + (this.filter === v ? '.on' : ''), { type: 'button', onclick: () => { this.filter = v; this.render(); } }, label, n !== undefined ? h('span.sg-n', n) : null);
      if (!this.search) {
        this.search = h('input.sg-search', { type: 'search', placeholder: '🔎 Buscar sugestões…', oninput: e => { this.q = e.target.value; this.renderList(); } });
      }
      this.tools.replaceChildren(
        h('div.sg-row', this.search,
          h('select', { onchange: e => { this.sort = e.target.value; T.store.set('sg-sort', this.sort); this.renderList(); } },
            Object.entries(SORTS).map(([k, l]) => h('option', { value: k, selected: k === this.sort || null }, l))),
          h('label.sg-mine', h('input', { type: 'checkbox', checked: this.onlyMine || null, onchange: e => { this.onlyMine = e.target.checked; this.renderList(); } }), 'Só as minhas')),
        h('div.chips.sg-chips', chip('all', 'Todas', this.list.length), chip('open', 'Abertas', this.list.filter(s => !['feito', 'recusado'].includes(s.status)).length),
          ...Object.keys(STATUS).map(k => chip(k, STATUS[k].label, this.count(k)))));
    },
    visible() {
      const ws = words(this.q);
      let l = this.list.filter(s => (this.filter === 'all' ? true : this.filter === 'open' ? !['feito', 'recusado'].includes(s.status) : s.status === this.filter)
        && (!this.onlyMine || s.mine) && (!ws.length || ws.every(w => norm(s.title + ' ' + s.desc + ' ' + s.author.name).includes(w))));
      const by = { votes: (a, b) => b.votes - a.votes || b.created - a.created, new: (a, b) => b.created - a.created,
        talk: (a, b) => b.comments.length - a.comments.length || b.votes - a.votes, updated: (a, b) => b.updated - a.updated };
      return l.sort(by[this.sort] || by.votes);
    },
    renderList() {
      const l = this.visible();
      this.listEl.replaceChildren(...(l.length ? l.map(s => this.card(s)) : [h('div.empty', this.list.length ? 'Nenhuma sugestão com esses filtros.' : 'Ainda não há sugestões. Seja o primeiro! 👉')]));
    },
    async act(path, body) {
      try { const r = await api('/sugestoes/' + path, body || {}); if (r.item) this.put(r.item); return r; }
      catch (e) { errToast(e); return null; }
    },
    card(s) {
      const open = this.open.has(s.id), long = s.desc.length > 220;
      const kids = [
        h('button.sg-vote' + (s.voted ? '.on' : ''), { type: 'button', title: s.voted ? 'Tirar meu voto' : 'Quero esse jogo!', onclick: () => this.act(s.id + '/vote') }, h('span', '▲'), h('b', s.votes)),
        h('div.sg-body',
          h('div.sg-top', h('h3', s.title), pill(s.status)),
          h('div.sg-tags', h('span.pill', CAT[s.category] || CAT.outro), s.players ? h('span.pill', '👥 ' + s.players) : null),
          this.editing === s.id ? this.editForm(s) : h('p.sg-desc' + (long && !open ? '.clip' : ''), s.desc),
          long && this.editing !== s.id ? h('button.sg-link', { type: 'button', onclick: () => this.toggle(s.id) }, open ? 'Mostrar menos' : 'Ler tudo') : null,
          s.reply ? h('div.sg-reply', h('div.sg-reply-h', avatar(s.replyBy, 'sm'), h('b', s.replyBy.name), h('span.sg-adm', 'ADMIN'), h('small.muted', fmtDate(s.replyAt))), h('p', s.reply)) : null,
          this.admin ? this.adminBar(s) : null,
          h('div.sg-meta',
            avatar(s.author, 'sm'), h('span', s.author.name), h('span.muted', '· ' + fmtDate(s.created)),
            h('button.sg-link', { type: 'button', onclick: () => this.toggle(s.id) }, `💬 ${s.comments.length} ${s.comments.length === 1 ? 'comentário' : 'comentários'}`),
            h('span', { style: { flex: 1 } }),
            s.canEdit && this.editing !== s.id ? h('button.sg-link', { type: 'button', onclick: () => { this.editing = s.id; this.renderList(); } }, 'Editar') : null,
            s.canDelete ? h('button.sg-link.danger', { type: 'button', onclick: () => this.remove(s) }, 'Apagar') : null),
          open ? this.comments(s) : null)
      ];
      return h('article.card.sg-card.st-' + s.status + (s.mine ? '.mine' : ''), { id: 'sg-' + s.id, style: { '--c': STATUS[s.status].color } }, kids);
    },
    toggle(id) { if (this.open.has(id)) this.open.delete(id); else this.open.add(id); this.renderList(); },
    remove(s) {
      modal((b, close) => b.append(h('h2', 'Apagar sugestão?'), h('p.muted', `"${s.title}" e os comentários serão apagados.`),
        h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Cancelar'),
          h('button.btn.primary', { type: 'button', onclick: async () => {
            close();
            try { await api(`/sugestoes/${s.id}/delete`, {}); this.list = this.list.filter(x => x.id !== s.id); this.render(); toast('Sugestão apagada.'); }
            catch (e) { errToast(e); }
          } }, 'Apagar'))));
    },
    comments(s) {
      const inp = h('input', { maxlength: 400, placeholder: 'Escreva um comentário…' });
      return h('div.sg-comments',
        ...s.comments.map(c => h('div.sg-c' + (c.admin ? '.adm' : ''), avatar(c.by, 'sm'),
          h('div', h('div.sg-c-h', h('b', c.by.name), c.admin ? h('span.sg-adm', 'ADMIN') : null, h('small.muted', fmtDateTime(c.ts)),
            c.by.id === T.me().id || this.admin ? h('button.sg-link.danger', { type: 'button', onclick: () => this.act(s.id + '/comment/delete', { comment: c.id }) }, 'apagar') : null),
            h('p', c.t)))),
        h('form.sg-c-form', { onsubmit: async e => { e.preventDefault(); if (await this.act(s.id + '/comment', { text: inp.value })) this.open.add(s.id); } },
          inp, h('button.btn.small', { type: 'submit' }, 'Enviar')));
    },
    adminBar(s) {
      const bar = h('div.sg-admin',
        h('span.sg-adm', 'ADMIN'),
        h('div.sg-st', Object.keys(STATUS).map(k => h('button' + (s.status === k ? '.on' : ''), { type: 'button', style: { '--c': STATUS[k].color }, title: STATUS[k].label,
          onclick: () => s.status !== k && this.act(s.id + '/admin', { status: k }) }, STATUS[k].icon + ' ' + STATUS[k].label))),
        h('button.sg-link', { type: 'button', onclick: () => { this.replying = this.replying === s.id ? null : s.id; this.renderList(); } }, s.reply ? '✏️ Editar resposta' : '💬 Responder'));
      if (this.replying !== s.id) return bar;
      const ta = h('textarea', { rows: 3, maxlength: 1000, placeholder: 'Resposta oficial (aparece em destaque na sugestão)' });
      ta.value = s.reply || '';
      return h('div', bar, h('div.sg-replyform', ta, h('div.row',
        s.reply ? h('button.btn.small', { type: 'button', onclick: async () => { if (await this.act(s.id + '/admin', { reply: '' })) this.replying = null, this.renderList(); } }, 'Remover resposta') : null,
        h('button.btn.small', { type: 'button', onclick: () => { this.replying = null; this.renderList(); } }, 'Cancelar'),
        h('button.btn.small.primary', { type: 'button', onclick: async () => { this.replying = null; await this.act(s.id + '/admin', { reply: ta.value }); } }, 'Publicar resposta'))));
    },
    editForm(s) {
      const f = this.fields(s);
      return h('form.sg-edit', { onsubmit: async e => { e.preventDefault(); if (await this.act(s.id + '/edit', f.values())) { this.editing = null; this.renderList(); } } },
        f.el, h('div.row', h('button.btn.small', { type: 'button', onclick: () => { this.editing = null; this.renderList(); } }, 'Cancelar'), h('button.btn.small.primary', { type: 'submit' }, 'Salvar')));
    },
    // Campos do formulário (novo ou edição)
    fields(s = {}, onTitle) {
      const title = h('input', { maxlength: 60, required: true, placeholder: 'Ex.: Batalha Naval', value: s.title || '', oninput: onTitle });
      const cat = h('select', Object.entries(CAT).map(([k, l]) => h('option', { value: k, selected: k === (s.category || 'tabuleiro') || null }, l)));
      const players = h('input', { maxlength: 20, placeholder: 'Ex.: 2 a 4', value: s.players || '' });
      const desc = h('textarea', { rows: 5, maxlength: 1500, required: true, placeholder: 'Como se joga? O que tem de legal? Tem algum jogo parecido?' });
      desc.value = s.desc || '';
      const cnt = h('small.muted.sg-cnt', `${desc.value.length}/1500`);
      desc.addEventListener('input', () => { cnt.textContent = `${desc.value.length}/1500`; });
      return {
        el: h('div.sg-fields', h('label.field', 'Nome do jogo', title), h('div.sg-two', h('label.field', 'Tipo', cat), h('label.field', 'Jogadores', players)),
          h('label.field', 'Descrição', desc, cnt)),
        values: () => ({ title: title.value, category: cat.value, players: players.value, desc: desc.value }),
        title, reset: () => { title.value = ''; players.value = ''; desc.value = ''; cnt.textContent = '0/1500'; }
      };
    },
    buildForm() {
      this.similar = h('div.sg-similar');
      const f = this.form = this.fields({}, () => this.renderSimilar());
      this.formLeft = h('small.muted');
      this.formEl = h('form.card.sg-form', { onsubmit: async e => {
        e.preventDefault();
        try {
          const r = await api('/sugestoes', f.values());
          f.reset(); this.renderSimilar();
          if (this.left !== null) this.left--;
          this.filter = 'all'; this.sort = 'new'; this.put(r.item);
          toast('Valeu pela sugestão! 💡');
          const el = $('#sg-' + r.item.id); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); }
        } catch (err) {
          errToast(err);
          if (err.message.includes('Já existe')) this.renderSimilar();
        }
      } }, h('h2', '✍️ Sugerir um jogo'), f.el, this.similar, h('button.btn.primary.block', { type: 'submit' }, 'Enviar sugestão'), this.formLeft);
    },
    // Enquanto digita o nome, mostra sugestões parecidas para votar em vez de repetir
    renderSimilar() {
      const ws = words(this.form.title.value);
      const hits = ws.length ? this.list.filter(s => { const t = words(s.title + ' ' + s.desc); return ws.some(w => t.some(x => x.startsWith(w) || w.startsWith(x))); })
        .sort((a, b) => b.votes - a.votes).slice(0, 4) : [];
      this.similar.replaceChildren(...(hits.length ? [h('p.section-title', 'Parecidas — talvez já tenham sugerido:'),
        ...hits.map(s => h('div.sg-sim', h('span', h('b', s.title), ' ', pill(s.status, true)),
          h('button.btn.small' + (s.voted ? '' : '.primary'), { type: 'button', onclick: () => this.act(s.id + '/vote').then(() => this.renderSimilar()) }, s.voted ? `✔ ${s.votes}` : `▲ Votar (${s.votes})`)))] : []));
    },
    renderSide() {
      if (!this.side.contains(this.formEl)) this.side.replaceChildren(this.formEl, h('div.card.sg-road'));
      this.formLeft.textContent = this.left === null ? '' : this.left > 0 ? `Você pode mandar mais ${this.left} hoje.` : 'Limite de hoje atingido — mas você ainda pode votar e comentar!';
      const road = this.list.filter(s => ['fazendo', 'planejado', 'feito'].includes(s.status))
        .sort((a, b) => ['fazendo', 'planejado', 'feito'].indexOf(a.status) - ['fazendo', 'planejado', 'feito'].indexOf(b.status) || b.updated - a.updated).slice(0, 8);
      this.side.querySelector('.sg-road').replaceChildren(h('h2', '🗺 Vindo aí'),
        road.length ? h('div.sg-roadlist', road.map(s => h('button.sg-ri', { type: 'button', onclick: () => { this.filter = 'all'; this.q = ''; this.search.value = ''; this.open.add(s.id); this.render(); const el = $('#sg-' + s.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
          pill(s.status, true), h('span', s.title), h('small.muted', `▲ ${s.votes}`)))) : h('p.muted', 'Quando uma sugestão for aprovada, ela aparece aqui.'));
    }
  };

  return { Sugestoes: { show: () => P.show(), leave: () => P.leave() } };
});

// Tabuleiro em Rede — painel do administrador
(window.TR_MODULES = window.TR_MODULES || []).push(T => {
  'use strict';
  const { $, h, api, toast, errToast, modal, go, avatar, fmtDateTime } = T;
  const TABS = [['geral', 'Visão geral'], ['perfis', 'Perfis'], ['salas', 'Salas'], ['seguranca', 'Segurança']];
  const GAME = { chess: 'Xadrez', checkers: 'Damas', magnata: 'Magnata', ludo: 'Ludo', truco: 'Truco' };
  const LOG_KIND = {
    LOGIN_FALHOU: 'Senha errada', LOGIN_BANIDO: 'Perfil suspenso tentou entrar', BLOQUEIO: 'IP bloqueado', LIMITE: 'Excesso de requisições',
    CADASTRO: 'Novo perfil', CADASTRO_LIMITE: 'Limite de cadastros', SENHA_ALTERADA: 'Senha alterada', ORIGEM_RECUSADA: 'Outro site recusado',
    TEMPO_REAL_LIMITE: 'Conexões ao vivo demais', CORPO_GRANDE: 'Requisição grande demais', ERRO: 'Erro no servidor', ADMIN: 'Ação de administrador'
  };
  const bytes = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  function duration(ms) {
    const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), hh = Math.floor((m % 1440) / 60);
    return d ? `${d} d ${hh} h` : hh ? `${hh} h ${m % 60} min` : `${m} min`;
  }
  const ago = ts => {
    if (!ts) return '—';
    const s = (Date.now() - ts) / 1000;
    return s < 60 ? 'agora' : s < 3600 ? `há ${Math.floor(s / 60)} min` : s < 86400 ? `há ${Math.floor(s / 3600)} h` : fmtDateTime(ts);
  };

  const A = {
    tab: 'geral', filter: '', logFilter: 'all', timer: null,
    show(q) {
      if (!T.me().admin) { toast('Só administradores podem abrir o painel.', { err: true }); return go({}, true); }
      this.tab = TABS.some(t => t[0] === q.get('aba')) ? q.get('aba') : 'geral';
      document.title = 'Administração · Tabuleiro em Rede';
      const root = $('#v-admin');
      root.replaceChildren(
        h('div.rank-head', h('div', h('h1', 'Administração'), h('p.muted', 'Perfis, salas e segurança do servidor. Só administradores veem esta página.')),
          h('div.seg.admin-tabs', TABS.map(([v, l]) => h('button', { type: 'button', class: v === this.tab ? 'on' : null, onclick: () => go({ v: 'admin', aba: v }, true) }, l)))),
        h('div#adminBody', h('p.muted', 'Carregando…')));
      this.load();
      clearInterval(this.timer);
      this.timer = setInterval(() => { if (!document.hidden && !$('#v-admin').hidden && $('#modal').hidden) this.load(true); }, 10000);
    },
    leave() { clearInterval(this.timer); this.timer = null; },
    async load(quiet) {
      try {
        const body = $('#adminBody');
        if (this.tab === 'geral') this.overview(body, await api('/admin/overview'));
        else if (this.tab === 'perfis') this.profiles(body, await api('/admin/profiles'));
        else if (this.tab === 'salas') this.rooms(body, await api('/admin/rooms'));
        else this.security(body, await api('/admin/overview'));
      } catch (e) { if (!quiet) errToast(e); }
    },

    /* ---------- Visão geral ---------- */
    overview(body, o) {
      const tile = (label, value, sub) => h('div.card.atile', h('span.muted', label), h('b', value), sub ? h('small.muted', sub) : null);
      const text = h('textarea', { maxlength: 200, rows: 2, placeholder: 'Ex.: Torneio de xadrez às 15h! Servidor reinicia às 18h.' });
      text.value = o.announce ? o.announce.text : '';
      body.replaceChildren(
        h('div.atiles',
          tile('Perfis', o.profiles, o.banned ? `${o.banned} suspenso(s)` : null),
          tile('Online agora', o.online),
          tile('Salas de xadrez/damas', o.rooms, `${o.playing} em andamento`),
          tile('Mesas de Magnata', o.magnata, `${o.magnataPlaying} em andamento`),
          tile('Partidas no histórico', o.games, `${o.gamesToday} nas últimas 24 h`),
          tile('Sessões abertas', o.sessions, `${o.streams} conexões ao vivo`),
          tile('Servidor ligado há', duration(o.uptime), `Node ${o.node}`),
          tile('Memória / banco', bytes(o.memory), `banco ${bytes(o.dbSize)}`)),
        h('div.card', { style: { marginTop: '18px', display: 'grid', gap: '10px' } },
          h('h2', 'Aviso para todos'),
          h('p.muted', { style: { margin: 0 } }, 'Aparece numa faixa no topo para todo mundo que estiver usando o site.'),
          o.announce ? h('p', { style: { margin: 0 } }, h('b', 'No ar: '), o.announce.text, h('span.muted', ` — ${o.announce.by}, ${ago(o.announce.ts)}`)) : null,
          text,
          h('div.controls',
            h('button.btn.primary', { type: 'button', onclick: async () => { try { await api('/admin/announce', { text: text.value }); toast(text.value.trim() ? 'Aviso publicado.' : 'Aviso removido.'); T.poll(); this.load(); } catch (e) { errToast(e); } } }, 'Publicar aviso'),
            o.announce ? h('button.btn', { type: 'button', onclick: async () => { try { await api('/admin/announce', { text: '' }); toast('Aviso removido.'); T.poll(); this.load(); } catch (e) { errToast(e); } } }, 'Remover aviso') : null)),
        h('p.muted', { style: { fontSize: '13px', marginTop: '14px' } },
          'Dica: administradores também podem ser definidos pelo nome em "administradores" no arquivo seguranca.json (reinicie o servidor depois de editar).'));
    },

    /* ---------- Perfis ---------- */
    profiles(body, list) {
      const search = h('input', { placeholder: 'Buscar por nome', value: this.filter, oninput: e => { this.filter = e.target.value; paint(); } });
      const table = h('table');
      const paint = () => {
        const f = this.filter.trim().toLowerCase();
        const rows = list.filter(p => !f || p.name.toLowerCase().includes(f));
        table.replaceChildren(
          h('thead', h('tr', h('th', 'Perfil'), h('th', 'Visto'), h('th.num', 'Xadrez'), h('th.num', 'Damas'), h('th.num', 'Partidas'), h('th.num', 'Magnata (V/P)'), h('th.num', 'Sessões'), h('th', ''))),
          h('tbody', rows.length ? rows.map(p => h('tr' + (p.id === T.me().id ? '.me' : ''),
            h('td', h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
              h('span.who.link', { onclick: () => go({ v: 'perfil', id: p.id }) }, avatar(p, 'sm', p.online), p.name),
              p.admin ? h('span.pill.wait', 'admin') : null, p.banned ? h('span.pill.bad', 'suspenso') : null),
              h('div.muted.small', `desde ${T.fmtDate(p.created)}`)),
            h('td.small', p.online ? h('span', { style: { color: 'var(--ok)' } }, 'online') : ago(p.lastSeen)),
            h('td.num.mono', p.chess), h('td.num.mono', p.checkers), h('td.num.mono', p.games),
            h('td.num.mono', `${p.magnata.w}/${p.magnata.games}`), h('td.num.mono', p.sessions),
            h('td', h('button.btn.small', { type: 'button', onclick: () => this.profileMenu(p) }, 'Gerenciar'))))
            : h('tr', h('td.empty', { colspan: 8 }, 'Nenhum perfil encontrado.'))));
      };
      paint();
      const typing = !!(document.activeElement && document.activeElement.closest('.admin-bar'));
      body.replaceChildren(h('div.admin-bar', search, h('span.muted', `${list.length} perfis`)), h('div.table-wrap', table));
      if (typing) search.focus();
    },
    profileMenu(p) {
      const self = p.id === T.me().id;
      const run = async (action, confirmText) => {
        if (confirmText && !(await this.confirm(confirmText))) return;
        try {
          const r = await api('/admin/profiles/' + p.id, { action });
          if (r.password) modal((box, close) => box.append(h('h2', 'Nova senha'), h('p', `A senha temporária de ${p.name} é:`),
            h('p', h('code.big', r.password)), h('p.muted', 'Passe para a pessoa e peça para ela trocar em Configurações. Ela foi desconectada das outras máquinas.'),
            h('div.row', h('button.btn.primary', { type: 'button', onclick: close }, 'Pronto'))));
          else toast(r.msg);
          this.load();
        } catch (e) { errToast(e); }
      };
      modal((box, close) => {
        const b = (label, fn, cls = '', disabled = false) => h('button.btn' + cls, { type: 'button', disabled, onclick: () => { close(); fn(); } }, label);
        box.append(h('div.profile-head', avatar(p, '', p.online), h('div.info', h('h2', p.name), h('div.muted', `${p.online ? 'online' : 'visto ' + ago(p.lastSeen)} · ${p.sessions} sessão(ões)`))),
          h('div.admin-actions',
            p.admin ? b('Tirar administrador', () => run('unadmin', `Tirar o acesso de administrador de ${p.name}?`), '', self || p.adminByConfig)
              : b('Tornar administrador', () => run('admin', `${p.name} vai poder suspender e apagar perfis e fechar salas. Continuar?`)),
            p.banned ? b('Reativar perfil', () => run('unban')) : b('Suspender perfil', () => run('ban', `${p.name} será desconectado e não poderá entrar até ser reativado.`), '.danger', self),
            b('Desconectar de todas as máquinas', () => run('logout')),
            b('Gerar senha temporária', () => run('resetpass', `Criar uma senha nova para ${p.name}? A senha atual deixa de funcionar.`)),
            b('Apagar perfil', () => run('delete', `Apagar ${p.name} para sempre? As salas em que está jogando serão fechadas. O histórico de partidas fica.`), '.danger', self)),
          p.adminByConfig ? h('p.muted.small', 'Administrador pelo seguranca.json.') : null,
          h('div.row', h('button.btn', { type: 'button', onclick: close }, 'Fechar')));
      });
    },
    confirm(text) {
      return new Promise(resolve => modal((box, close) => box.append(h('h2', 'Confirmar'), h('p', text),
        h('div.row', h('button.btn', { type: 'button', onclick: () => { close(); resolve(false); } }, 'Cancelar'),
          h('button.btn.primary', { type: 'button', onclick: () => { close(); resolve(true); } }, 'Confirmar')))));
    },

    /* ---------- Salas ---------- */
    rooms(body, list) {
      body.replaceChildren(h('div.table-wrap', h('table',
        h('thead', h('tr', h('th', 'Jogo'), h('th', 'Sala'), h('th', 'Jogadores'), h('th', 'Situação'), h('th.num', 'Assistindo'), h('th', 'Atualizada'), h('th', ''))),
        h('tbody', list.length ? list.map(r => h('tr',
          h('td', GAME[r.game] || r.game),
          h('td', r.name, r.private ? h('span.pill', { style: { marginLeft: '6px' } }, 'privada') : null),
          h('td.small', r.players.map(n => n || 'vago').join(' × ')),
          h('td.small', r.status, r.kind === 'room' && r.plies ? h('span.muted', ` · ${r.plies} lances`) : r.round ? h('span.muted', ` · rodada ${r.round}`) : null),
          h('td.num.mono', r.watching), h('td.small', ago(r.updated)),
          h('td', h('div.controls', { style: { flexWrap: 'nowrap' } },
            h('button.btn.small', { type: 'button', onclick: () => go(r.kind === 'magnata' ? ({ [r.game || 'magnata']: r.id }) : { sala: r.id }) }, 'Abrir'),
            h('button.btn.small.danger', { type: 'button', onclick: async () => {
              if (!(await this.confirm(`Fechar "${r.name}"? ${r.status === 'Em andamento' ? 'A partida em andamento será anulada.' : ''}`))) return;
              try { await api(`/admin/rooms/${r.id}/close`, { kind: r.kind }); toast('Sala fechada.'); this.load(); } catch (e) { errToast(e); }
            } }, 'Fechar')))))
          : h('tr', h('td.empty', { colspan: 7 }, 'Nenhuma sala aberta.'))))));
    },

    /* ---------- Segurança ---------- */
    security(body, o) {
      const kinds = [...new Set(o.log.map(l => l.kind))];
      const logRows = o.log.filter(l => this.logFilter === 'all' || l.kind === this.logFilter);
      const c = o.config;
      body.replaceChildren(
        h('div.admin-grid',
          h('div.card', h('h2', 'IPs bloqueados agora'),
            o.bans.length ? h('div', o.bans.map(b => h('div.online-row', h('code', b.ip), h('span.muted', `mais ${Math.ceil(b.secs / 60)} min`),
              h('button.btn.small', { type: 'button', onclick: async () => { try { await api('/admin/unblock', { ip: b.ip }); toast('IP desbloqueado.'); this.load(); } catch (e) { errToast(e); } } }, 'Desbloquear'))))
              : h('p.muted', 'Nenhum IP bloqueado por excesso de requisições.')),
          h('div.card', h('h2', 'Configuração'),
            h('p', c.permitirIPs.length ? `Só aceita: ${c.permitirIPs.join(', ')}` : c.somenteRedeLocal ? 'Aceita só máquinas da rede local.' : 'Aceita qualquer IP.'),
            c.bloquearIPs.length ? h('p', `Sempre bloqueados: ${c.bloquearIPs.join(', ')}`) : null,
            h('p.muted.small', 'Para mudar, edite seguranca.json e reinicie o servidor.'))),
        h('div.list-head', { style: { marginTop: '18px' } }, h('h2', 'Registro de eventos'),
          h('div.chips', [['all', 'Todos'], ...kinds.map(k => [k, LOG_KIND[k] || k])].map(([v, l]) =>
            h('button', { type: 'button', class: this.logFilter === v ? 'on' : null, onclick: () => { this.logFilter = v; this.security(body, o); } }, l)))),
        h('div.table-wrap', h('table',
          h('thead', h('tr', h('th', 'Quando'), h('th', 'Evento'), h('th', 'IP'), h('th', 'Detalhe'))),
          h('tbody', logRows.length ? logRows.map(l => h('tr',
            h('td.small.mono', fmtDateTime(Date.parse(l.ts))), h('td.small', LOG_KIND[l.kind] || l.kind), h('td.small.mono', l.ip), h('td.small', l.detail)))
            : h('tr', h('td.empty', { colspan: 4 }, 'Nada registrado.'))))));
    }
  };

  return { Admin: { show: q => A.show(q), leave: () => A.leave() } };
});

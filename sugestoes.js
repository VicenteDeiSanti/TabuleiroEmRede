// Sugestões de jogos: qualquer perfil sugere, vota e comenta; administradores mudam o status e respondem.
const STATUS = ['nova', 'analise', 'planejado', 'fazendo', 'feito', 'recusado'];
const CATEGORIES = ['tabuleiro', 'cartas', 'dados', 'grupo', 'cassino', 'raciocinio', 'outro'];
const PER_DAY = 5, COMMENTS_MAX = 200;

function install({ route, send, db, save, isAdmin, clean, rid }) {
  db.suggestions = db.suggestions || {};
  const S = db.suggestions;
  const who = pid => { const p = db.profiles[pid]; return p ? { id: p.id, name: p.name, color: p.color } : { id: pid, name: 'Perfil removido', color: '#5b655e' }; };
  const pub = (s, me) => ({
    id: s.id, title: s.title, desc: s.desc, category: s.category, players: s.players, status: s.status,
    author: who(s.author), created: s.created, updated: s.updated, votes: s.votes.length, voted: s.votes.includes(me.id),
    reply: s.reply || null, replyBy: s.replyBy ? who(s.replyBy) : null, replyAt: s.replyAt || null,
    comments: s.comments.map(c => ({ id: c.id, by: who(c.pid), t: c.t, ts: c.ts, admin: !!c.admin })),
    mine: s.author === me.id, canEdit: s.author === me.id && s.status === 'nova', canDelete: isAdmin(me) || (s.author === me.id && s.status === 'nova')
  });
  const get = (res, id) => { const s = S[id]; if (!s) send(res, 404, { error: 'Sugestão não encontrada.' }); return s; };
  // Valida e limpa os campos do formulário
  function fields(b) {
    const title = clean(b.title, 60), desc = String(b.desc ?? '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, 1500);
    if (title.length < 3) return { error: 'Dê um nome ao jogo (pelo menos 3 letras).' };
    if (desc.length < 10) return { error: 'Explique um pouco como é o jogo (pelo menos 10 letras).' };
    return { title, desc, category: CATEGORIES.includes(b.category) ? b.category : 'outro', players: clean(b.players, 20) };
  }

  route('GET', '/api/sugestoes', async (req, res, ctx) => {
    const list = Object.values(S).map(s => pub(s, ctx.me));
    const today = Object.values(S).filter(s => s.author === ctx.me.id && Date.now() - s.created < 86400e3).length;
    send(res, 200, { list, admin: isAdmin(ctx.me), left: isAdmin(ctx.me) ? null : Math.max(0, PER_DAY - today), status: STATUS, categories: CATEGORIES });
  });
  route('POST', '/api/sugestoes', async (req, res, ctx) => {
    const f = fields(ctx.body);
    if (f.error) return send(res, 400, f);
    const mine = Object.values(S).filter(s => s.author === ctx.me.id && Date.now() - s.created < 86400e3).length;
    if (!isAdmin(ctx.me) && mine >= PER_DAY) return send(res, 429, { error: `Você já mandou ${PER_DAY} sugestões hoje. Volte amanhã!` });
    const norm = t => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const dup = Object.values(S).find(s => s.status !== 'recusado' && norm(s.title) === norm(f.title));
    if (dup) return send(res, 409, { error: `Já existe uma sugestão "${dup.title}". Vote nela em vez de repetir!`, dup: dup.id });
    const id = rid(6), now = Date.now();
    S[id] = { id, ...f, author: ctx.me.id, created: now, updated: now, status: 'nova', votes: [ctx.me.id], comments: [] };
    save();
    send(res, 200, { item: pub(S[id], ctx.me) });
  });
  route('POST', '/api/sugestoes/:id/edit', async (req, res, ctx) => {
    const s = get(res, ctx.params.id); if (!s) return;
    if (!(s.author === ctx.me.id && s.status === 'nova') && !isAdmin(ctx.me)) return send(res, 403, { error: 'Só dá para editar enquanto a sugestão é nova.' });
    const f = fields(ctx.body);
    if (f.error) return send(res, 400, f);
    Object.assign(s, f, { updated: Date.now() });
    save();
    send(res, 200, { item: pub(s, ctx.me) });
  });
  route('POST', '/api/sugestoes/:id/vote', async (req, res, ctx) => {
    const s = get(res, ctx.params.id); if (!s) return;
    const i = s.votes.indexOf(ctx.me.id);
    if (i >= 0) s.votes.splice(i, 1); else s.votes.push(ctx.me.id);
    save();
    send(res, 200, { item: pub(s, ctx.me) });
  });
  route('POST', '/api/sugestoes/:id/comment', async (req, res, ctx) => {
    const s = get(res, ctx.params.id); if (!s) return;
    const t = clean(ctx.body.text, 400);
    if (!t) return send(res, 400, { error: 'Escreva alguma coisa.' });
    if (s.comments.length >= COMMENTS_MAX) return send(res, 409, { error: 'Essa sugestão já tem comentários demais.' });
    s.comments.push({ id: rid(4), pid: ctx.me.id, t, ts: Date.now(), admin: isAdmin(ctx.me) });
    save();
    send(res, 200, { item: pub(s, ctx.me) });
  });
  route('POST', '/api/sugestoes/:id/comment/delete', async (req, res, ctx) => {
    const s = get(res, ctx.params.id); if (!s) return;
    const c = s.comments.find(x => x.id === ctx.body.comment);
    if (!c) return send(res, 404, { error: 'Comentário não encontrado.' });
    if (c.pid !== ctx.me.id && !isAdmin(ctx.me)) return send(res, 403, { error: 'Você só pode apagar os seus comentários.' });
    s.comments = s.comments.filter(x => x !== c);
    save();
    send(res, 200, { item: pub(s, ctx.me) });
  });
  // Administrador: muda o status e/ou responde
  route('POST', '/api/sugestoes/:id/admin', async (req, res, ctx) => {
    if (!isAdmin(ctx.me)) return send(res, 403, { error: 'Só administradores podem fazer isso.' });
    const s = get(res, ctx.params.id); if (!s) return;
    const b = ctx.body;
    if (b.status !== undefined) {
      if (!STATUS.includes(b.status)) return send(res, 400, { error: 'Status inválido.' });
      s.status = b.status;
    }
    if (b.reply !== undefined) {
      const r = String(b.reply || '').replace(/\r/g, '').trim().slice(0, 1000);
      s.reply = r || null; s.replyBy = r ? ctx.me.id : null; s.replyAt = r ? Date.now() : null;
    }
    s.updated = Date.now();
    save();
    send(res, 200, { item: pub(s, ctx.me) });
  });
  route('POST', '/api/sugestoes/:id/delete', async (req, res, ctx) => {
    const s = get(res, ctx.params.id); if (!s) return;
    if (!isAdmin(ctx.me) && !(s.author === ctx.me.id && s.status === 'nova')) return send(res, 403, { error: 'Você não pode apagar essa sugestão.' });
    delete S[s.id];
    save();
    send(res, 200, { ok: true });
  });
}

module.exports = { install, STATUS, CATEGORIES };

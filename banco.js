// Banco de dados SQLite embutido no Node (node:sqlite). Um único arquivo: dados/tabuleiro.db
// Abra com o programa gratuito "DB Browser for SQLite" para ver ou consultar os dados.
const fs = require('fs');
const path = require('path');

// Esconde o aviso "SQLite is an experimental feature" do Node
const emit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (String(w && w.message || w).includes('SQLite')) return;
  return emit.call(process, w, ...rest);
};

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) {
  console.error(`\nEste servidor usa o banco SQLite que vem dentro do Node, disponível a partir do Node 22.13.`);
  console.error(`Sua versão: ${process.version}. Baixe a versão LTS em https://nodejs.org e rode de novo.\n`);
  process.exit(1);
}

const J = v => JSON.stringify(v ?? null);
const P = (t, def) => { try { return t == null ? def : JSON.parse(t); } catch (e) { return def; } };

function open(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'tabuleiro.db');
  const sql = new DatabaseSync(file);
  sql.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS perfis (
      id            TEXT PRIMARY KEY,
      nome          TEXT NOT NULL UNIQUE COLLATE NOCASE,
      senha_hash    TEXT NOT NULL,
      senha_sal     TEXT NOT NULL,
      cor           TEXT,
      bio           TEXT,
      criado_em     INTEGER NOT NULL,
      rating_xadrez INTEGER,
      rating_damas  INTEGER,
      configuracoes TEXT,   -- JSON
      ratings       TEXT,   -- JSON (pontos, recorde, V/E/D e histórico de cada jogo)
      aprendizado   TEXT    -- JSON (lições concluídas e aberturas treinadas)
    );
    CREATE TABLE IF NOT EXISTS sessoes (
      token     TEXT PRIMARY KEY,
      perfil_id TEXT NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
      criada_em INTEGER NOT NULL,
      usada_em  INTEGER
    );
    CREATE INDEX IF NOT EXISTS sessoes_perfil ON sessoes(perfil_id);
    CREATE TABLE IF NOT EXISTS salas (
      id            TEXT PRIMARY KEY,
      nome          TEXT,
      jogo          TEXT,
      atualizada_em INTEGER,
      dados         TEXT    -- JSON com o estado completo da sala
    );
    CREATE TABLE IF NOT EXISTS partidas (
      id           TEXT PRIMARY KEY,
      jogo         TEXT NOT NULL,
      brancas_id   TEXT,
      brancas_nome TEXT,
      pretas_id    TEXT,
      pretas_nome  TEXT,
      vencedor     TEXT,    -- 'w', 'b' ou NULL (empate)
      motivo       TEXT,
      ranqueada    INTEGER,
      tempo        TEXT,
      lances_qtd   INTEGER,
      terminou_em  INTEGER,
      dados        TEXT     -- JSON com a partida completa (lances etc.)
    );
    CREATE INDEX IF NOT EXISTS partidas_brancas ON partidas(brancas_id);
    CREATE INDEX IF NOT EXISTS partidas_pretas ON partidas(pretas_id);
    CREATE TABLE IF NOT EXISTS salas_magnata (
      id            TEXT PRIMARY KEY,
      nome          TEXT,
      atualizada_em INTEGER,
      dados         TEXT    -- JSON com o estado completo da mesa de Magnata
    );
    CREATE TABLE IF NOT EXISTS sugestoes (
      id            TEXT PRIMARY KEY,
      titulo        TEXT,
      autor_id      TEXT,
      status        TEXT,
      votos         INTEGER,
      criada_em     INTEGER,
      atualizada_em INTEGER,
      dados         TEXT    -- JSON com a sugestão completa (descrição, votos, comentários, resposta)
    );
  `);
  // Colunas novas em bancos criados por versões anteriores
  const cols = new Set(sql.prepare('PRAGMA table_info(perfis)').all().map(c => c.name));
  if (!cols.has('admin')) sql.exec('ALTER TABLE perfis ADD COLUMN admin INTEGER DEFAULT 0');
  if (!cols.has('banido')) sql.exec('ALTER TABLE perfis ADD COLUMN banido INTEGER DEFAULT 0');

  const q = {
    perfisAll: sql.prepare('SELECT * FROM perfis'),
    perfilUpsert: sql.prepare(`INSERT INTO perfis (id, nome, senha_hash, senha_sal, cor, bio, criado_em, rating_xadrez, rating_damas, configuracoes, ratings, aprendizado, admin, banido)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, senha_hash=excluded.senha_hash, senha_sal=excluded.senha_sal, cor=excluded.cor, bio=excluded.bio,
        rating_xadrez=excluded.rating_xadrez, rating_damas=excluded.rating_damas, configuracoes=excluded.configuracoes, ratings=excluded.ratings, aprendizado=excluded.aprendizado,
        admin=excluded.admin, banido=excluded.banido`),
    sessoesAll: sql.prepare('SELECT * FROM sessoes'),
    sessaoUpsert: sql.prepare('INSERT INTO sessoes (token, perfil_id, criada_em, usada_em) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET usada_em=excluded.usada_em'),
    salasAll: sql.prepare('SELECT dados FROM salas'),
    salaUpsert: sql.prepare('INSERT INTO salas (id, nome, jogo, atualizada_em, dados) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, atualizada_em=excluded.atualizada_em, dados=excluded.dados'),
    magnataAll: sql.prepare('SELECT dados FROM salas_magnata'),
    magnataUpsert: sql.prepare('INSERT INTO salas_magnata (id, nome, atualizada_em, dados) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET nome=excluded.nome, atualizada_em=excluded.atualizada_em, dados=excluded.dados'),
    sugestoesAll: sql.prepare('SELECT dados FROM sugestoes'),
    sugestaoUpsert: sql.prepare(`INSERT INTO sugestoes (id, titulo, autor_id, status, votos, criada_em, atualizada_em, dados) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET titulo=excluded.titulo, status=excluded.status, votos=excluded.votos, atualizada_em=excluded.atualizada_em, dados=excluded.dados`),
    partidasAll: sql.prepare('SELECT dados FROM partidas ORDER BY terminou_em'),
    partidaInsert: sql.prepare(`INSERT OR IGNORE INTO partidas (id, jogo, brancas_id, brancas_nome, pretas_id, pretas_nome, vencedor, motivo, ranqueada, tempo, lances_qtd, terminou_em, dados)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  };

  function tx(fn) {
    sql.exec('BEGIN');
    try { fn(); sql.exec('COMMIT'); }
    catch (e) { sql.exec('ROLLBACK'); console.error('Erro ao gravar no banco:', e.message); }
  }
  // Remove do banco as linhas que não existem mais na memória
  function prune(table, col, keep) {
    const rows = sql.prepare(`SELECT ${col} AS k FROM ${table}`).all();
    const del = sql.prepare(`DELETE FROM ${table} WHERE ${col} = ?`);
    for (const r of rows) if (!keep.has(r.k)) del.run(r.k);
  }

  /* ---------- Leitura ---------- */
  function loadAll() {
    const profiles = {}, sessions = {}, rooms = {};
    for (const r of q.perfisAll.all()) {
      profiles[r.id] = {
        id: r.id, name: r.nome, pass: r.senha_hash, salt: r.senha_sal, color: r.cor, bio: r.bio || '', created: r.criado_em,
        settings: P(r.configuracoes, {}), ratings: P(r.ratings, null), learn: P(r.aprendizado, undefined),
        admin: !!r.admin, banned: !!r.banido
      };
    }
    for (const r of q.sessoesAll.all()) sessions[r.token] = { pid: r.perfil_id, created: r.criada_em, used: r.usada_em || r.criada_em };
    for (const r of q.salasAll.all()) { const s = P(r.dados, null); if (s && s.id) rooms[s.id] = s; }
    const magnata = {};
    for (const r of q.magnataAll.all()) { const s = P(r.dados, null); if (s && s.id) magnata[s.id] = s; }
    const games = q.partidasAll.all().map(r => P(r.dados, null)).filter(Boolean);
    const suggestions = {};
    for (const r of q.sugestoesAll.all()) { const s = P(r.dados, null); if (s && s.id) suggestions[s.id] = s; }
    return { profiles, sessions, rooms, games, magnata, suggestions };
  }

  /* ---------- Gravação ---------- */
  function saveProfiles(profiles) {
    tx(() => {
      for (const p of Object.values(profiles)) {
        q.perfilUpsert.run(p.id, p.name, p.pass, p.salt, p.color || null, p.bio || '', p.created,
          p.ratings ? Math.round(p.ratings.chess.r) : null, p.ratings ? Math.round(p.ratings.checkers.r) : null,
          J(p.settings), J(p.ratings), J(p.learn || null), p.admin ? 1 : 0, p.banned ? 1 : 0);
      }
      prune('perfis', 'id', new Set(Object.keys(profiles)));
    });
  }
  function saveSessions(sessions) {
    tx(() => {
      for (const [t, s] of Object.entries(sessions)) q.sessaoUpsert.run(t, s.pid, s.created, s.used || s.created);
      prune('sessoes', 'token', new Set(Object.keys(sessions)));
    });
  }
  function saveRooms(rooms) {
    tx(() => {
      for (const r of Object.values(rooms)) q.salaUpsert.run(r.id, r.name || '', r.game || '', r.updated || Date.now(), J(r));
      prune('salas', 'id', new Set(Object.keys(rooms)));
    });
  }
  function saveMagnata(rooms) {
    tx(() => {
      for (const r of Object.values(rooms)) q.magnataUpsert.run(r.id, r.name || '', r.updated || Date.now(), J(r));
      prune('salas_magnata', 'id', new Set(Object.keys(rooms)));
    });
  }
  function saveSuggestions(list) {
    tx(() => {
      for (const s of Object.values(list)) q.sugestaoUpsert.run(s.id, s.title, s.author, s.status, s.votes.length, s.created, s.updated || s.created, J(s));
      prune('sugestoes', 'id', new Set(Object.keys(list)));
    });
  }
  function saveGames(games) {
    tx(() => {
      for (const g of games) {
        q.partidaInsert.run(g.id, g.game, g.white && g.white.id || null, g.white && g.white.name || null, g.black && g.black.id || null, g.black && g.black.name || null,
          g.winner || null, g.reason || null, g.rated ? 1 : 0, g.tc || null, g.plies || 0, g.ended || Date.now(), J(g));
      }
    });
  }

  /* ---------- Migração dos arquivos JSON da versão anterior ---------- */
  function migrateJson() {
    const count = sql.prepare('SELECT COUNT(*) AS n FROM perfis').get().n;
    const files = { profiles: 'perfis.json', sessions: 'sessoes.json', rooms: 'salas.json', games: 'partidas.json' };
    const found = Object.values(files).filter(f => fs.existsSync(path.join(dir, f)));
    if (count || !found.length) return 0;
    const read = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return def; } };
    const data = { profiles: read(files.profiles, {}), sessions: read(files.sessions, {}), rooms: read(files.rooms, {}), games: read(files.games, []) };
    for (const [t, s] of Object.entries(data.sessions)) if (!data.profiles[s.pid]) delete data.sessions[t];
    saveProfiles(data.profiles); saveSessions(data.sessions); saveRooms(data.rooms); saveGames(data.games);
    for (const f of found) fs.renameSync(path.join(dir, f), path.join(dir, f + '.migrado'));
    return Object.keys(data.profiles).length;
  }

  return { file, sql, loadAll, saveProfiles, saveSessions, saveRooms, saveMagnata, saveSuggestions, saveGames, migrateJson, close: () => sql.close() };
}

module.exports = { open };

// Componente de tabuleiro (xadrez e damas) + sons sintetizados.
// O tabuleiro só desenha e captura gestos; quem decide o que é legal é o controlador.
(function () {
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const VS = '︎';
  const FILES = 'abcdefgh';

  class Board {
    /**
     * ctrl: { pick(sq) -> bool, tap(sq), drop(from, to), right() }
     */
    constructor(root, ctrl) {
      this.root = root;
      this.ctrl = ctrl;
      this.orientation = 'w';
      this.game = 'chess';
      this.pieceSet = 'cburnett';
      this.coords = true;
      this.arrowsOn = true;
      this.state = { b: Array(64).fill(null) };
      this.els = new Map();          // casa -> elemento da peça
      this.shapes = [];              // {from, to, color} (to === from: círculo)
      this.drag = null;

      root.classList.add('board');
      root.innerHTML = '<div class="b-sqs"></div><div class="b-pcs"></div><svg class="b-arrows" viewBox="0 0 8 8" aria-hidden="true"></svg>';
      this.sqLayer = root.querySelector('.b-sqs');
      this.pcLayer = root.querySelector('.b-pcs');
      this.svg = root.querySelector('.b-arrows');
      this.squares = [];
      for (let v = 0; v < 64; v++) {
        const d = document.createElement('div');
        d.className = 'b-sq';
        this.sqLayer.append(d);
        this.squares.push(d);
      }
      this.svg.innerHTML = `<defs>${['g', 'r', 'b', 'y'].map(c => `<marker id="ah-${c}-${Board.uid}" class="ah-${c}" orient="auto" markerWidth="4" markerHeight="4" refX="2.05" refY="2"><path d="M0,0 V4 L3,2 Z"/></marker>`).join('')}</defs><g class="shapes"></g>`;
      this.uid = Board.uid++;
      this.layout();

      root.addEventListener('pointerdown', e => this.down(e));
      root.addEventListener('pointermove', e => this.move(e));
      root.addEventListener('pointerup', e => this.up(e));
      root.addEventListener('pointercancel', () => this.cancelDrag());
      root.addEventListener('contextmenu', e => e.preventDefault());
    }

    /* ---------- Geometria ---------- */
    view(sq) { return this.orientation === 'w' ? sq : 63 - sq; } // casa -> posição visual
    sqAt(clientX, clientY) {
      const r = this.root.getBoundingClientRect();
      const x = Math.floor(((clientX - r.left) / r.width) * 8), y = Math.floor(((clientY - r.top) / r.height) * 8);
      if (x < 0 || x > 7 || y < 0 || y > 7) return null;
      const v = y * 8 + x;
      return this.orientation === 'w' ? v : 63 - v;
    }
    xy(sq) { const v = this.view(sq); return [v & 7, v >> 3]; }
    place(el, sq) { const [x, y] = this.xy(sq); el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; }

    layout() {
      for (let v = 0; v < 64; v++) {
        const sq = this.orientation === 'w' ? v : 63 - v;
        const d = this.squares[v];
        d.dataset.sq = sq;
        d.className = 'b-sq ' + (((sq >> 3) + (sq & 7)) % 2 ? 'dk' : 'lt');
        d.innerHTML = '';
        if (this.coords) {
          if ((v & 7) === 0) d.insertAdjacentHTML('beforeend', `<span class="co rk">${8 - (sq >> 3)}</span>`);
          if ((v >> 3) === 7) d.insertAdjacentHTML('beforeend', `<span class="co fl">${FILES[sq & 7]}</span>`);
        }
      }
      for (const [sq, el] of this.els) this.place(el, sq);
      this.drawShapes();
    }

    setOptions({ orientation, game, pieceSet, coords, arrows }) {
      let relayout = false, repaint = false;
      if (orientation && orientation !== this.orientation) { this.orientation = orientation; relayout = true; }
      if (game && game !== this.game) { this.game = game; repaint = true; this.shapes = []; }
      if (pieceSet && pieceSet !== this.pieceSet) { this.pieceSet = pieceSet; repaint = true; }
      if (coords !== undefined && coords !== this.coords) { this.coords = coords; relayout = true; }
      if (arrows !== undefined) { this.arrowsOn = arrows; if (!arrows) this.clearShapes(); }
      this.root.dataset.game = this.game;
      if (repaint) { for (const el of this.els.values()) el.remove(); this.els.clear(); this.render(this.state, false); }
      if (relayout) this.layout();
    }

    /* ---------- Peças ---------- */
    pieceHtml(p) {
      if (this.game === 'checkers') return '<i></i>';
      if (this.pieceSet === 'unicode') return `<span>${GLYPH[p[1]]}${VS}</span>`;
      return '';
    }
    makePiece(p, sq) {
      const el = document.createElement('div');
      el.className = `pc ${this.game === 'checkers' ? 'ck' : this.pieceSet === 'unicode' ? 'uni' : 'cb'} ${p}`;
      el.dataset.p = p;
      el.innerHTML = this.pieceHtml(p);
      el.style.transition = 'none';
      this.place(el, sq);
      this.pcLayer.append(el);
      el.offsetWidth; // aplica a posição antes de reativar a transição
      el.style.transition = '';
      return el;
    }

    /**
     * state: { b, lastMove:[from,to], check, selected, targets:[{sq,cap,step}], premove:[from,to],
     *          preSel, must:[sq], hover }
     */
    render(state, animate = true) {
      this.state = state;
      const b = state.b;
      // 1) Reaproveita peças que não mudaram
      const keep = new Map(), loose = [];
      for (const [sq, el] of this.els) {
        if (b[sq] === el.dataset.p) keep.set(sq, el); else loose.push({ sq, el });
      }
      const need = [];
      for (let sq = 0; sq < 64; sq++) if (b[sq] && !keep.has(sq)) need.push(sq);
      // 2) Move peças do mesmo tipo (a mais próxima) para as casas novas
      const next = new Map(keep);
      const dist = (a, c) => Math.abs((a >> 3) - (c >> 3)) + Math.abs((a & 7) - (c & 7));
      const pending = [];
      for (const sq of need) {
        let bi = -1, bd = 99;
        loose.forEach((o, i) => { if (o && o.el.dataset.p === b[sq] && dist(o.sq, sq) < bd) { bd = dist(o.sq, sq); bi = i; } });
        if (bi >= 0) {
          const o = loose[bi]; loose[bi] = null;
          if (!animate || (this.dropped && this.dropped === o.el)) o.el.style.transition = 'none';
          this.place(o.el, sq);
          next.set(sq, o.el);
          if (o.el.style.transition === 'none') { o.el.offsetWidth; o.el.style.transition = ''; }
        } else pending.push(sq);
      }
      // 3) Peças novas (promoção) e removidas (capturas)
      for (const sq of pending) next.set(sq, this.makePiece(b[sq], sq));
      for (const o of loose) {
        if (!o) continue;
        if (animate) { o.el.classList.add('gone'); setTimeout(() => o.el.remove(), 260); }
        else o.el.remove();
      }
      this.els = next;
      this.dropped = null;

      // Destaques nas casas
      const t = new Map((state.targets || []).map(x => [x.sq, x]));
      const lm = state.lastMove || [], pm = state.premove || [], must = new Set(state.must || []);
      for (const d of this.squares) {
        const sq = +d.dataset.sq, tg = t.get(sq);
        d.classList.toggle('last', lm.includes(sq));
        d.classList.toggle('sel', state.selected === sq);
        d.classList.toggle('chk', state.check === sq);
        d.classList.toggle('tgt', !!tg);
        d.classList.toggle('cap', !!tg && !!tg.cap);
        d.classList.toggle('step', !!tg && !!tg.step);
        d.classList.toggle('pre', pm.includes(sq));
        d.classList.toggle('presel', state.preSel === sq);
        d.classList.toggle('must', must.has(sq));
        d.classList.toggle('path', (state.path || []).includes(sq));
        const mk = (state.marks || {})[sq];
        d.classList.toggle('good', mk === 'good');
        d.classList.toggle('wrong', mk === 'wrong');
      }
      for (const [sq, el] of this.els) el.classList.toggle('lifted', state.selected === sq || state.preSel === sq);
    }

    /* ---------- Gestos ---------- */
    down(e) {
      if (e.button === 2) {
        this.rightStart = this.sqAt(e.clientX, e.clientY);
        this.ctrl.right && this.ctrl.right();
        return;
      }
      if (e.button !== 0) return;
      Sound.unlock();
      this.clearShapes();
      const sq = this.sqAt(e.clientX, e.clientY);
      if (sq === null) return;
      const st = this.state;
      const isTarget = (st.targets || []).some(x => x.sq === sq);
      if (isTarget && st.selected !== sq) { this.ctrl.tap(sq); return; }
      const wasSel = st.selected === sq || st.preSel === sq;
      if (this.ctrl.pick(sq)) {
        const el = this.els.get(sq);
        if (!el) return;
        this.drag = { from: sq, el, x: e.clientX, y: e.clientY, moved: false, wasSel };
        this.root.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else this.ctrl.tap(sq);
    }

    move(e) {
      const d = this.drag;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      const r = this.root.getBoundingClientRect(), size = r.width / 8;
      d.el.classList.add('dragging');
      d.el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
      const over = this.sqAt(e.clientX, e.clientY);
      if (over !== d.over) {
        if (d.overEl) d.overEl.classList.remove('hover');
        d.over = over;
        d.overEl = over === null ? null : this.squares[this.view(over)];
        if (d.overEl) d.overEl.classList.add('hover');
      }
    }

    up(e) {
      if (e.button === 2) {
        const sq = this.sqAt(e.clientX, e.clientY);
        if (this.arrowsOn && this.rightStart != null && sq != null) {
          const color = e.shiftKey && e.altKey ? 'y' : e.shiftKey ? 'r' : e.altKey || e.ctrlKey ? 'b' : 'g';
          this.toggleShape(this.rightStart, sq, color);
        }
        this.rightStart = null;
        return;
      }
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      d.el.classList.remove('dragging');
      if (d.overEl) d.overEl.classList.remove('hover');
      if (d.moved) {
        const to = this.sqAt(e.clientX, e.clientY);
        this.dropped = d.el;
        d.el.style.transition = 'none';
        this.place(d.el, d.from);
        if (to !== null && to !== d.from) {
          // A peça "pousa" já na casa de destino; render() corrige se o lance não valer
          this.place(d.el, to);
          this.ctrl.drop(d.from, to);
        } else this.ctrl.drop(d.from, null);
        requestAnimationFrame(() => { d.el.style.transition = ''; });
        if (this.els.get(d.from) === d.el && this.state.b[d.from]) this.place(d.el, d.from);
      } else if (d.wasSel) this.ctrl.tap(d.from); // segundo clique na mesma peça: desmarca
    }

    cancelDrag() {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      d.el.classList.remove('dragging');
      this.place(d.el, d.from);
    }

    /* ---------- Setas e círculos ---------- */
    toggleShape(from, to, color) {
      const i = this.shapes.findIndex(s => s.from === from && s.to === to);
      if (i >= 0 && this.shapes[i].color === color) this.shapes.splice(i, 1);
      else if (i >= 0) this.shapes[i].color = color;
      else this.shapes.push({ from, to, color });
      this.drawShapes();
    }
    clearShapes() { if (this.shapes.length) { this.shapes = []; this.drawShapes(); } }
    drawShapes() {
      const g = this.svg.querySelector('.shapes');
      if (!g) return;
      const c = sq => { const [x, y] = this.xy(sq); return [x + 0.5, y + 0.5]; };
      g.innerHTML = this.shapes.map(s => {
        const [x1, y1] = c(s.from);
        if (s.from === s.to) return `<circle class="sh-${s.color}" cx="${x1}" cy="${y1}" r="0.44" />`;
        let [x2, y2] = c(s.to);
        const len = Math.hypot(x2 - x1, y2 - y1), k = (len - 0.3) / len;
        x2 = x1 + (x2 - x1) * k; y2 = y1 + (y2 - y1) * k;
        return `<line class="sh-${s.color}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#ah-${s.color}-${this.uid})" />`;
      }).join('');
    }
  }
  Board.uid = 0;

  /* ==================== Sons (Web Audio, sem arquivos) ==================== */
  const Sound = {
    ctx: null, enabled: true, volume: 0.6,
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone(freq, start, dur, type = 'sine', gain = 0.3) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain * this.volume, start + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(c.destination);
      o.start(start); o.stop(start + dur + 0.02);
    },
    noise(start, dur, freq, gain) {
      const c = this.ctx, len = Math.ceil(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
      g.gain.value = gain * this.volume;
      src.connect(f).connect(g).connect(c.destination);
      src.start(start);
    },
    play(name) {
      if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime + 0.01;
      switch (name) {
        case 'move': this.noise(t, 0.07, 2200, 0.9); this.tone(190, t, 0.07, 'sine', 0.35); break;
        case 'capture': this.noise(t, 0.13, 1100, 1.2); this.tone(120, t, 0.12, 'triangle', 0.45); break;
        case 'check': this.tone(880, t, 0.12, 'square', 0.08); this.tone(660, t + 0.11, 0.16, 'square', 0.08); break;
        case 'start': [523, 659, 784].forEach((f, i) => this.tone(f, t + i * 0.08, 0.22, 'triangle', 0.2)); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.1, 0.35, 'triangle', 0.22)); break;
        case 'lose': [440, 370, 294].forEach((f, i) => this.tone(f, t + i * 0.14, 0.35, 'triangle', 0.2)); break;
        case 'draw': [587, 587].forEach((f, i) => this.tone(f, t + i * 0.16, 0.25, 'triangle', 0.2)); break;
        case 'low': this.tone(1320, t, 0.05, 'square', 0.06); break;
        case 'chat': this.tone(1046, t, 0.08, 'sine', 0.12); this.tone(1318, t + 0.06, 0.09, 'sine', 0.1); break;
        case 'notify': this.tone(659, t, 0.15, 'sine', 0.2); this.tone(988, t + 0.13, 0.22, 'sine', 0.2); break;
        case 'illegal': this.tone(180, t, 0.12, 'sawtooth', 0.06); break;
        case 'truco': this.noise(t, 0.25, 600, 1.4); [196, 262, 330, 392].forEach((f, i) => this.tone(f, t + 0.05 + i * 0.07, 0.35, 'sawtooth', 0.09)); this.tone(523, t + 0.35, 0.45, 'square', 0.1); break;
        // Magnata
        case 'dice': for (let i = 0; i < 7; i++) this.noise(t + i * 0.075 + Math.random() * 0.02, 0.05, 1800 + Math.random() * 1500, 0.8); break;
        case 'hop': this.tone(520, t, 0.06, 'square', 0.05); this.tone(780, t + 0.03, 0.05, 'square', 0.04); break;
        case 'coin': this.tone(988, t, 0.08, 'square', 0.07); this.tone(1319, t + 0.07, 0.22, 'square', 0.07); break;
        case 'pay': this.tone(440, t, 0.09, 'triangle', 0.18); this.tone(330, t + 0.08, 0.16, 'triangle', 0.18); break;
        case 'buy': [659, 784, 988, 1319].forEach((f, i) => this.tone(f, t + i * 0.06, 0.12, 'square', 0.06)); break;
        case 'jail': [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * 0.12, 0.2, 'sawtooth', 0.06)); break;
        case 'card': this.noise(t, 0.12, 3200, 0.6); this.tone(880, t + 0.1, 0.12, 'sine', 0.12); break;
      }
    }
  };
  ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => Sound.unlock(), { capture: true, passive: true }));

  window.Board = Board;
  window.Sound = Sound;
})();

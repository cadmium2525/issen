// =====================================================================
//  入力：タッチ / マウス（Pointer Events）とキーボード
//  ・通常時：フィールドのどこでも「触れた位置が中心」の仮想スティック
//  ・斬ボタン：押すと時間停止（斬撃モード）
//  ・斬撃モード中：フィールドをなぞる → 離して発動
//    （ボタンを押したまま引っぱっても描ける）
//  移動と斬撃ルート描画を同時に要求しない設計
// =====================================================================
import { CFG } from './config.js';

export class Input {
  constructor(canvas, slashBtn, game) {
    this.canvas = canvas;
    this.btn = slashBtn;
    this.game = game;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false };
    this.drawId = null;
    this.btnId = null;
    this.btnStart = null;
    this.ignore = new Set();
    this.keys = new Set();

    canvas.addEventListener('pointerdown', (e) => this._down(e), { passive: false });
    slashBtn.addEventListener('pointerdown', (e) => this._btnDown(e), { passive: false });
    window.addEventListener('pointermove', (e) => this._move(e), { passive: false });
    window.addEventListener('pointerup', (e) => this._up(e));
    window.addEventListener('pointercancel', (e) => this._up(e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    slashBtn.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => this._key(e, true));
    window.addEventListener('keyup', (e) => this._key(e, false));
    window.addEventListener('blur', () => this.reset());
  }

  reset() {
    this.stick.id = null;
    this.stick.active = false;
    this.drawId = null;
    this.btnId = null;
    this.ignore.clear();
    this.keys.clear();
  }

  _down(e) {
    e.preventDefault();
    const g = this.game;
    g.audio.unlock();
    if (!g.acceptsInput()) return;
    if (g.slash.phase === 'aim') {
      if (this.drawId === null) {
        const w = g.toWorld(e.clientX, e.clientY);
        if (g.drawStart(w.x, w.y, 'abs')) {
          this.drawId = e.pointerId;
          this._capture(this.canvas, e.pointerId);
        }
      }
      return;
    }
    if (g.isSlashBusy()) return;
    if (this.stick.id === null) {
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY, active: true };
      this._capture(this.canvas, e.pointerId);
    }
  }

  _btnDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const g = this.game;
    g.audio.unlock();
    if (!g.acceptsInput()) return;
    const before = g.slash.phase;
    g.toggleSlash();
    if (before !== 'aim' && g.slash.phase === 'aim') {
      this.btnId = e.pointerId;
      this.btnStart = { x: e.clientX, y: e.clientY };
      this._capture(this.btn, e.pointerId);
    }
  }

  _move(e) {
    const id = e.pointerId;
    if (this.ignore.has(id)) return;
    const g = this.game;
    if (id === this.drawId) {
      e.preventDefault();
      const w = g.toWorld(e.clientX, e.clientY);
      g.drawMove(w.x, w.y);
      return;
    }
    if (id === this.stick.id) {
      e.preventDefault();
      const s = this.stick;
      s.x = e.clientX;
      s.y = e.clientY;
      // 指が半径の外に出たら中心ごと引きずる（フローティングスティック）
      const dx = s.x - s.ox, dy = s.y - s.oy;
      const m = Math.hypot(dx, dy);
      const R = CFG.STICK_RADIUS_PX;
      if (m > R) {
        s.ox = s.x - (dx / m) * R;
        s.oy = s.y - (dy / m) * R;
      }
      return;
    }
    // ボタンを押したまま引っぱった → 相対モードでルートを描く
    if (id === this.btnId && this.drawId === null && g.slash.phase === 'aim') {
      const d = Math.hypot(e.clientX - this.btnStart.x, e.clientY - this.btnStart.y);
      if (d > 14) {
        const w0 = g.toWorld(this.btnStart.x, this.btnStart.y);
        if (g.drawStart(w0.x, w0.y, 'rel')) {
          this.drawId = id;
          const w = g.toWorld(e.clientX, e.clientY);
          g.drawMove(w.x, w.y);
        }
      }
    }
  }

  _up(e) {
    const id = e.pointerId;
    if (this.ignore.delete(id)) {
      if (id === this.btnId) this.btnId = null;
      return;
    }
    if (id === this.drawId) {
      this.drawId = null;
      this.game.drawEnd();
    }
    if (id === this.stick.id) {
      this.stick.id = null;
      this.stick.active = false;
    }
    if (id === this.btnId) this.btnId = null;
  }

  _capture(el, id) {
    try {
      el.setPointerCapture(id);
    } catch {
      /* noop */
    }
  }

  // 斬撃モードに入ったら移動を止める（指が離れるまでその指は無視）
  cancelMove() {
    if (this.stick.id !== null) {
      this.ignore.add(this.stick.id);
      this.stick.id = null;
      this.stick.active = false;
    }
  }

  // 時間切れで自動発動したときなど、描画中の指を切り離す
  releaseDraw() {
    if (this.drawId !== null) {
      this.ignore.add(this.drawId);
      this.drawId = null;
    }
  }

  _key(e, down) {
    const k = e.code;
    const g = this.game;
    if (down) {
      if ((k === 'Space' || k === 'KeyK' || k === 'KeyJ' || k === 'ShiftLeft' || k === 'ShiftRight') && !e.repeat) {
        if (g.acceptsInput()) {
          e.preventDefault();
          g.audio.unlock();
          g.toggleSlash();
        }
        return;
      }
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
  }

  getMove() {
    let x = 0, y = 0;
    const s = this.stick;
    if (s.active) {
      const R = CFG.STICK_RADIUS_PX;
      let dx = (s.x - s.ox) / R, dy = (s.y - s.oy) / R;
      const m = Math.hypot(dx, dy);
      if (m < CFG.STICK_DEADZONE) {
        dx = 0;
        dy = 0;
      } else if (m > 1) {
        dx /= m;
        dy /= m;
      }
      x = dx;
      y = dy;
    }
    const K = this.keys;
    let kx = 0, ky = 0;
    if (K.has('ArrowLeft') || K.has('KeyA')) kx -= 1;
    if (K.has('ArrowRight') || K.has('KeyD')) kx += 1;
    if (K.has('ArrowUp') || K.has('KeyW')) ky -= 1;
    if (K.has('ArrowDown') || K.has('KeyS')) ky += 1;
    if (kx || ky) {
      const m = Math.hypot(kx, ky);
      x = kx / m;
      y = ky / m;
    }
    return { x, y };
  }
}

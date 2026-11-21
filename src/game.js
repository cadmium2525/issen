// =====================================================================
//  ゲーム本体：状態管理・更新・斬撃・連鎖・スポーン・描画
//
//  コアループ：
//    敵を避ける → 群れと特殊敵の位置を読む → ゲージ満タンで時間停止
//    → ルートを描く → 斬撃（細い軌跡 → 閃光 → 連鎖爆破）→ ゲージ回復
// =====================================================================
import { CFG, ENEMY, PHASES, OPENING, OPENING_END, TIERS, RANKS, TIPS, LABELS, chainMultiplier } from './config.js';
import { TAU, clamp, lerp, rand, randInt, pick, weighted, easeInCubic, easeOutQuad, angleLerp, fmt, segDist, segOut } from './utils.js';
import { Enemy, EnemyGrid, updateEnemies, drawEnemies, drawEnemyGlows, getSprite } from './enemies.js';
import { Effects, glowSprite, FONT_NUM, FONT_JP } from './effects.js';
import { Route, buildCum, pointAt, routeHits } from './slash.js';

const AIMING = new Set(['aim', 'dash', 'hold']);

function phaseAt(t) {
  for (let i = 0; i < PHASES.length - 1; i++) {
    const a = PHASES[i], b = PHASES[i + 1];
    if (t < b.t) {
      const k = (t - a.t) / (b.t - a.t);
      const o = {};
      for (const key of Object.keys(a)) o[key] = lerp(a[key], b[key], k);
      return o;
    }
  }
  return PHASES[PHASES.length - 1];
}

function tierColor(n) {
  let c = '#ffffff';
  for (const t of TIERS) if (n >= t.n) c = t.color;
  return n >= 100 ? `hsl(${(performance.now() / 4) % 360},100%,72%)` : c;
}

export class Game {
  constructor({ canvas, ui, audio, store }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ui = ui;
    this.audio = audio;
    this.store = store;
    this.fx = new Effects();
    this.grid = new EnemyGrid();
    this.input = null;
    this.W = CFG.WORLD_W;
    this.H = 800;
    this.scale = 1;
    this.dpr = 1;
    this.cssW = 450;
    this.cssH = 800;
    this.rect = { left: 0, top: 0 };
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.hudBottom = 64;
    this.realTime = 0;
    this.fxTime = 0;
    this.paused = false;
    this.mode = 'demo';
    this.bgScroll = 0;
    this.motes = Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.8, 2), v: rand(5, 16), a: rand(0.06, 0.22) }));
    this.bounds = { x0: 10, y0: 10, x1: 440, y1: 790 };
    this.debug = null;
    this._resetWorld();
  }

  // ------------------------------------------------------------------
  //  画面サイズ
  // ------------------------------------------------------------------
  resize(cssW, cssH, dpr, safe) {
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    if (safe) this.safe = safe;
    this.scale = cssW / CFG.WORLD_W;
    this.W = CFG.WORLD_W;
    this.H = cssH / this.scale;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    this.rect = this.canvas.getBoundingClientRect();
    this.bounds = { x0: 10, y0: 10, x1: this.W - 10, y1: this.H - 10 };
    this.hudBottom = (this.safe.top + 74) / this.scale;
    this.comboY = this.hudBottom + 78;
    this.grid.resize(this.W, this.H);
    this._buildLayers();
    const p = this.player;
    p.x = clamp(p.x, p.r + 4, this.W - p.r - 4);
    p.y = clamp(p.y, p.r + 4, this.H - p.r - 4);
  }

  toWorld(cx, cy) {
    return { x: (cx - this.rect.left) / this.scale, y: (cy - this.rect.top) / this.scale };
  }

  _buildLayers() {
    const W = this.W, H = this.H;
    const bw = 180, bh = Math.max(1, Math.round((180 * H) / W));
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = bw;
      c.height = bh;
      return c;
    };
    // 背景
    const bg = mk();
    let g = bg.getContext('2d');
    let gr = g.createLinearGradient(0, 0, 0, bh);
    gr.addColorStop(0, '#0f0c2a');
    gr.addColorStop(0.5, '#080718');
    gr.addColorStop(1, '#03030a');
    g.fillStyle = gr;
    g.fillRect(0, 0, bw, bh);
    gr = g.createRadialGradient(bw * 0.5, bh * 0.36, 0, bw * 0.5, bh * 0.36, bw * 0.95);
    gr.addColorStop(0, 'rgba(80,46,160,0.32)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, bw, bh);
    this.bgLayer = bg;
    // 周辺減光
    const v = mk();
    g = v.getContext('2d');
    gr = g.createRadialGradient(bw / 2, bh / 2, bh * 0.22, bw / 2, bh / 2, bh * 0.62);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.62)');
    g.fillStyle = gr;
    g.fillRect(0, 0, bw, bh);
    this.vignette = v;
    // 被弾時の赤い縁
    const hv = mk();
    g = hv.getContext('2d');
    gr = g.createRadialGradient(bw / 2, bh / 2, bh * 0.2, bw / 2, bh / 2, bh * 0.6);
    gr.addColorStop(0, 'rgba(255,20,60,0)');
    gr.addColorStop(1, 'rgba(255,20,60,0.6)');
    g.fillStyle = gr;
    g.fillRect(0, 0, bw, bh);
    this.hurtLayer = hv;
  }

  // ------------------------------------------------------------------
  //  状態遷移
  // ------------------------------------------------------------------
  _resetWorld() {
    this.enemies = [];
    this.pending = [];
    this.queue = [];
    this.finale = [];
    this.labels = [];
    this.vortices = [];
    this.fx.clear();
    this.player = {
      x: this.W / 2, y: (this.H || 800) * 0.56, vx: 0, vy: 0, angle: -Math.PI / 2,
      r: CFG.PLAYER_R, hp: CFG.MAX_HP, invuln: 0, blink: 0, trail: [], visible: true, moved: 0,
    };
    this.slash = { phase: 'idle' };
    this.slashBlend = 0;
    this.recoverT = 99;
    this.hitstop = 0;
    this.gauge = 1;
    this.gaugeWasFull = true;
    this.time = 0;
    this.score = 0;
    this.scoreShown = 0;
    this.kills = 0;
    this.maxChain = 0;
    this.slashCount = 0;
    this.act = null;
    this.comboView = null;
    this.scriptIdx = 0;
    this.spawnTimer = 0;
    this.demoSpawn = 0.1;
    this.demoTarget = null;
    this.demoRetarget = 0;
    this.level = 1;
    this.lastTick = 99;
    this.hurtA = 0;
    this.endReason = null;
    this.endWait = 0;
    this.endStage = 0;
    this.stats = { firstSlash: null };
  }

  startDemo() {
    this.mode = 'demo';
    this.paused = false;
    this._resetWorld();
    this.gauge = 0.3;
    this.gaugeWasFull = false;
    this.audio.sfxMuted = true;
    this.audio.timeStopOut();
    this.audio.startMusic(0);
    this.audio.setMusicLevel(0);
  }

  startRun() {
    this.mode = 'play';
    this.paused = false;
    this._resetWorld();
    this.gauge = 1;
    this.gaugeWasFull = true;
    this.audio.sfxMuted = false;
    this.audio.timeStopOut();
    this.audio.startMusic(1);
    this.audio.setMusicLevel(1);
    this.audio.restartBar();
    this.input?.reset();
    this.ui.onRunStart();
    this.ui.setHP(this.player.hp, false);
    if (!this.store.data.tut.move) this.ui.showHint('move');
    this.fx.text('START', this.W / 2, this.H * 0.4, { size: 52, color: '#6ff3ff', life: 0.8, vy: -16 });
  }

  toTitle() {
    this.ui.hidePause();
    this.ui.hideHUD();
    this.startDemo();
    this.audio.resume();
    this.ui.showTitle();
  }

  setPaused(v) {
    if (v === this.paused) return;
    if (v && this.mode !== 'play') return;
    this.paused = v;
    this.input?.reset();
    if (v) {
      this.audio.suspend();
      this.ui.showPause();
    } else {
      this.audio.resume();
      this.ui.hidePause();
    }
  }

  acceptsInput() {
    return this.mode === 'play' && !this.paused && this.player.hp > 0;
  }

  isSlashBusy() {
    return this.slash.phase === 'dash' || this.slash.phase === 'hold';
  }

  // ------------------------------------------------------------------
  //  斬撃：入力
  // ------------------------------------------------------------------
  toggleSlash() {
    const s = this.slash;
    if (s.phase === 'aim') {
      if (!s.route) this._exitSlash(); // 何も描いていなければ再タップで解除
      return;
    }
    if (s.phase !== 'idle') return;
    if (this.gauge < 1) {
      this.ui.nudgeSlash();
      return;
    }
    this._enterSlash();
  }

  _enterSlash() {
    this.slash = { phase: 'aim', t: 0, route: null, hits: [], hitSet: null, demo: null };
    this.input?.cancelMove();
    this.audio.timeStopIn();
    const p = this.player;
    p.vx = 0;
    p.vy = 0;
    this.fx.ring(p.x, p.y, 10, 120, 0.4, '#6ff3ff', 3, true);
    if (this.mode === 'play') this.ui.hideHint('slash');
  }

  _exitSlash() {
    this.slash = { phase: 'idle' };
    this.audio.timeStopOut();
    this.input?.releaseDraw();
  }

  drawStart(wx, wy, mode) {
    const s = this.slash;
    if (s.phase !== 'aim' || s.route) return false;
    s.route = new Route(this.bounds);
    s.route.begin(this.player.x, this.player.y, wx, wy, mode);
    this._refreshHits();
    if (this.mode === 'play' && !this.store.data.tut.slash) {
      this.store.data.tut.slash = true;
      this.ui.hideHint('slash');
    }
    return true;
  }

  drawMove(wx, wy) {
    const s = this.slash;
    if (s.phase !== 'aim' || !s.route) return;
    s.route.move(wx, wy);
    this._refreshHits();
  }

  drawEnd() {
    const s = this.slash;
    if (s.phase !== 'aim' || !s.route) return;
    if (s.route.length >= CFG.SLASH_MIN_LEN) this._fire();
    else {
      s.route = null; // 短すぎる：描き直し
      s.hits = [];
      s.hitSet = null;
    }
  }

  _refreshHits() {
    const s = this.slash;
    const prev = s.hits ? s.hits.length : 0;
    s.hits = routeHits(s.route.points(), this.enemies, CFG.SLASH_BLADE_R);
    s.hitSet = new Set(s.hits.map((h) => h.e));
    if (s.hits.length !== prev && s.hits.length > 0) this.audio.aimTick(s.hits.length);
  }

  // ------------------------------------------------------------------
  //  斬撃：発動 → ダッシュ → 溜め → 閃光
  // ------------------------------------------------------------------
  _fire() {
    const pts = this.slash.route.points();
    const cum = buildCum(pts);
    const len = cum[cum.length - 1];
    const hits = routeHits(pts, this.enemies, CFG.SLASH_BLADE_R);
    this.input?.releaseDraw();
    this.slash = {
      phase: 'dash', t: 0, pts, cum, len, hits, hitIdx: 0, cutCount: 0,
      dur: 0.05 + len / 6500, last: { x: pts[0].x, y: pts[0].y },
    };
    this.gauge = 0;
    this.gaugeWasFull = false;
    this.act = { combo: 0, events: 0, gaugeBonus: 0, score: 0, lastKill: this.fxTime, finished: false, tierIdx: 0 };
    this.slashCount++;
    if (this.mode === 'play' && this.stats.firstSlash === null) this.stats.firstSlash = this.time;
    this.audio.release();
    this._vibe(12);
  }

  _updateSlash(dt) {
    const s = this.slash;
    const p = this.player;
    if (s.phase === 'aim') {
      s.t += dt;
      if (s.demo) this._demoDraw(dt);
      if (s.phase === 'aim' && s.t >= CFG.SLASH_THINK_TIME) {
        if (s.route && s.route.length >= CFG.SLASH_MIN_LEN) this._fire();
        else this._exitSlash();
      }
    } else if (s.phase === 'dash') {
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const pos = s.len * easeOutQuad(k);
      const pt = pointAt(s.pts, s.cum, pos);
      for (let i = 1; i <= 3; i++) {
        this.fx.ghost(lerp(s.last.x, pt.x, i / 3), lerp(s.last.y, pt.y, i / 3), pt.ang);
      }
      s.last = { x: pt.x, y: pt.y };
      p.x = pt.x;
      p.y = pt.y;
      p.angle = pt.ang;
      this._pushTrail();
      while (s.hitIdx < s.hits.length && s.hits[s.hitIdx].s <= pos + 6) {
        const h = s.hits[s.hitIdx++];
        const e = h.e;
        if (e.alive && e.state === 'alive') {
          e.state = 'cut';
          e.cutAngle = h.ang;
          e.cutOrder = s.cutCount++;
          this.fx.sparks(e.x, e.y, 5, '#ffffff', 220, 460, h.ang, 0.7, 1.6);
          this.audio.cutMark(s.cutCount);
        }
      }
      if (k >= 1) {
        s.phase = 'hold';
        s.t = 0;
      }
    } else if (s.phase === 'hold') {
      s.t += dt;
      if (s.t >= CFG.SLASH_HOLD) this._flash();
    }
  }

  _flash() {
    const s = this.slash;
    const cut = this.enemies.filter((e) => e.alive && e.state === 'cut').sort((a, b) => a.cutOrder - b.cutOrder);
    const n = cut.length;
    this.fx.slashTrail(s.pts);
    this.fx.flash(n ? 0.55 : 0.28);
    this.fx.shake(0.26 + Math.min(n, 15) * 0.025);
    this.fx.punch(0.03 + Math.min(n, 10) * 0.003);
    this.hitstop = n ? CFG.HITSTOP : 0.04;
    this.audio.flash(n);
    this.audio.timeStopOut();
    this._vibe(n ? 30 : 10);
    if (n >= 3 && this.mode !== 'demo') this.fx.stamp('斬');
    const step = n > 1 ? Math.min(0.024, 0.32 / n) : 0;
    cut.forEach((e, i) => this._schedule(e, 0.012 + i * step, 'slash', 0, null));
    const end = s.pts[s.pts.length - 1];
    this.fx.flare(end.x, end.y, 100, '#6ff3ff', 0.28, 1.4);
    this.fx.ring(end.x, end.y, 6, 70, 0.32, '#bff9ff', 3);
    this.slash = { phase: 'idle' };
    this.recoverT = 0;
    this.player.invuln = Math.max(this.player.invuln, 0.6);
  }

  _timeScale() {
    if (AIMING.has(this.slash.phase)) return CFG.SLASH_TIME_SCALE;
    if (this.mode === 'ending' || this.mode === 'over') return 0.25;
    if (this.recoverT < CFG.RECOVER_TIME) return lerp(0.12, 1, easeInCubic(this.recoverT / CFG.RECOVER_TIME));
    return 1;
  }

  // ------------------------------------------------------------------
  //  メインループ
  // ------------------------------------------------------------------
  frame(dt) {
    this.realTime += dt;
    if (this.paused) {
      this.render();
      return;
    }
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      this.fx.updateReal(dt);
      this.render();
      return;
    }
    this._updateSlash(dt);
    this.recoverT += dt;
    const aiming = AIMING.has(this.slash.phase);
    const ts = this._timeScale();
    this._updateWorld(dt * ts, dt);
    if (!aiming) this._updateChains(dt);
    this.fx.update(dt, aiming ? ts : Math.max(ts, 0.6));
    this.hurtA = Math.max(0, this.hurtA - dt * 1.8);
    this._updateLabels(dt);
    const target = aiming ? 1 : 0;
    this.slashBlend += (target - this.slashBlend) * Math.min(1, dt * (target ? 16 : 7));
    this._updateEnding(dt);
    this._updateTutorial();
    this._updateHUD(dt);
    this.render();
  }

  _updateWorld(gdt, dt) {
    const p = this.player;
    if (this.mode === 'play') {
      this.time += gdt;
      if (this.time >= 30 && this.level < 2) {
        this.level = 2;
        this.audio.setMusicLevel(2);
      }
      if (this.time >= CFG.RUN_TIME - 20 && this.level < 3) {
        this.level = 3;
        this.audio.setMusicLevel(3);
        this.audio.rush();
        this.fx.text('RUSH!!', this.W / 2, this.H * 0.4, { size: 66, color: '#ff5f7e', life: 1.4, vy: 0, sub: 'ラスト20秒', tag: 'tier', replace: 'tier' });
        this.fx.shake(0.3);
      }
      const left = CFG.RUN_TIME - this.time;
      if (left <= 5 && left > 0) {
        const sec = Math.ceil(left);
        if (sec !== this.lastTick) {
          this.lastTick = sec;
          this.audio.countdown(sec === 1);
        }
      }
      if (left <= 0) {
        this.time = CFG.RUN_TIME;
        this._timeUp();
      }
    }
    this.bgScroll += gdt * (16 + this.level * 12);

    if ((this.mode === 'play' || this.mode === 'demo') && !AIMING.has(this.slash.phase)) this._movePlayer(gdt, dt);
    p.invuln = Math.max(0, p.invuln - gdt);
    p.blink = Math.max(0, p.blink - gdt);
    if (!AIMING.has(this.slash.phase)) this._pushTrail();

    // ゲージ：時間経過で回復
    if ((this.mode === 'play' || this.mode === 'demo') && this.slash.phase === 'idle') {
      const rate = this.mode === 'demo' ? 1 / 3 : 1 / CFG.GAUGE_REFILL_TIME;
      this.gauge = Math.min(1, this.gauge + gdt * rate);
    }
    if (this.gauge >= 1 && !this.gaugeWasFull) {
      this.gaugeWasFull = true;
      if (this.mode === 'play') {
        this.audio.gaugeReady();
        this.fx.ring(p.x, p.y, 14, 54, 0.45, '#6ff3ff', 2.5);
        this.ui.pulseSlash();
      }
    }

    if (this.mode === 'play') this._updateSpawner(gdt);
    else if (this.mode === 'demo') this._updateDemo(gdt);
    this._updatePending(gdt);
    updateEnemies(this.enemies, gdt, p.x, p.y, this.realTime, this.grid);

    // 被弾判定
    if (this.mode === 'play' && p.invuln <= 0 && this.slash.phase === 'idle' && p.hp > 0) {
      for (const e of this.enemies) {
        if (!e.alive || !e.harmful) continue;
        const rr = p.r + e.r * 0.72;
        const dx = e.x - p.x, dy = e.y - p.y;
        if (dx * dx + dy * dy < rr * rr) {
          this._damage();
          break;
        }
      }
    }
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
  }

  _updateLabels(dt) {
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const L = this.labels[i];
      const e = L.e;
      L.vis = e.alive && e.x > 10 && e.x < this.W - 10 && e.y > this.hudBottom && e.y < this.H - 10;
      if (L.vis) L.t += dt;
      if (!e.alive || L.t > 3.6) this.labels.splice(i, 1);
    }
  }

  _pushTrail() {
    const p = this.player;
    p.trail.unshift({ x: p.x, y: p.y });
    if (p.trail.length > 14) p.trail.length = 14;
  }

  _movePlayer(dt, realDt) {
    if (dt <= 0) return;
    const p = this.player;
    const mv = this.mode === 'demo' ? this._demoMove(realDt) : this.input ? this.input.getMove() : { x: 0, y: 0 };
    const tx = mv.x * CFG.PLAYER_SPEED, ty = mv.y * CFG.PLAYER_SPEED;
    const k = Math.min(1, dt * 18);
    p.vx += (tx - p.vx) * k;
    p.vy += (ty - p.vy) * k;
    p.x = clamp(p.x + p.vx * dt, p.r + 4, this.W - p.r - 4);
    p.y = clamp(p.y + p.vy * dt, p.r + 4, this.H - p.r - 4);
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 20) p.angle = angleLerp(p.angle, Math.atan2(p.vy, p.vx), Math.min(1, dt * 14));
    if (this.mode === 'play' && sp > 60) {
      p.moved += dt;
      if (p.moved > 0.5 && !this.store.data.tut.move) {
        this.store.data.tut.move = true;
        this.ui.hideHint('move');
      }
    }
  }

  _damage() {
    const p = this.player;
    p.hp -= 1;
    p.invuln = CFG.INVULN_TIME;
    p.blink = CFG.INVULN_TIME;
    this.hurtA = 1;
    this.fx.shake(0.65);
    this.fx.flash(0.25, '#ff2050');
    this.fx.sparks(p.x, p.y, 18, '#ff4d6d', 150, 420, null, TAU, 2.2);
    this.fx.ring(p.x, p.y, 10, 130, 0.35, '#ff4d6d', 5);
    this.hitstop = 0.11;
    this.audio.hurt();
    this._vibe(110);
    // 周囲の敵をはじき飛ばして立て直す時間を作る
    for (const e of this.enemies) {
      if (!e.alive || e.state !== 'alive') continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 130) {
        const f = (1 - d / 130) * 420 + 140;
        e.vx = (dx / d) * f;
        e.vy = (dy / d) * f;
        e.stun = 0.5;
      }
    }
    this.ui.setHP(p.hp, true);
    if (p.hp <= 0) this._die();
  }

  _die() {
    const p = this.player;
    this.mode = 'ending';
    this.endReason = 'dead';
    this.endWait = 0;
    this.endStage = 0;
    if (this.slash.phase === 'aim') this._exitSlash();
    p.visible = false;
    this.fx.sparks(p.x, p.y, 40, '#bff9ff', 200, 700, null, TAU, 2.5);
    this.fx.flare(p.x, p.y, 240, '#6ff3ff', 0.55, 1.4);
    this.fx.ring(p.x, p.y, 10, 220, 0.6, '#ffffff', 6);
    this.fx.shake(1);
    this.audio.dead();
    this.audio.setMusicLevel(0);
    this.pending.length = 0;
    this.fx.text('DEFEATED', this.W / 2, this.H * 0.42, { size: 54, color: '#ff5f7e', life: 2.2, vy: 0, tag: 'tier', replace: 'tier' });
  }

  _timeUp() {
    this.mode = 'ending';
    this.endReason = 'timeup';
    this.endWait = 0;
    this.endStage = 0;
    const s = this.slash;
    if (s.phase === 'aim') {
      if (s.route && s.route.length >= CFG.SLASH_MIN_LEN) this._fire();
      else this._exitSlash();
    }
    this.pending.length = 0;
    this.audio.finish();
    this.audio.setMusicLevel(0);
    this._vibe(60);
    this.fx.text('FINISH!', this.W / 2, this.H * 0.42, { size: 64, color: '#ffe36b', life: 1.9, vy: 0, tag: 'tier', replace: 'tier' });
  }

  _updateEnding(dt) {
    if (this.mode !== 'ending') return;
    const busy = this.queue.length > 0 || this.vortices.length > 0 || this.isSlashBusy();
    if (busy) {
      this.endWait = 0;
      return;
    }
    this.endWait += dt;
    if (this.endStage === 0 && this.endWait > 0.45) {
      this.endStage = 1;
      if (this.endReason === 'timeup') {
        // 残った敵は演出だけで一掃（得点なし）
        const p = this.player;
        const rest = this.enemies.filter((e) => e.alive);
        rest.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
        const step = rest.length ? Math.min(0.03, 0.9 / rest.length) : 0;
        rest.forEach((e, i) => this.finale.push({ e, t: i * step }));
      }
    }
    for (let i = this.finale.length - 1; i >= 0; i--) {
      const f = this.finale[i];
      f.t -= dt;
      if (f.t <= 0) {
        this._pop(f.e);
        this.finale.splice(i, 1);
      }
    }
    if (this.endStage === 1 && this.endWait > (this.endReason === 'timeup' ? 1.8 : 1.4)) {
      this.endStage = 2;
      this._showResult();
    }
  }

  _pop(e) {
    if (!e.alive) return;
    e.alive = false;
    const c = ENEMY[e.kind].color;
    this.fx.shards(e.x, e.y, 5, c);
    this.fx.flare(e.x, e.y, e.r * 4, c, 0.25, 1.4);
    this.fx.sparks(e.x, e.y, 4, c, 100, 280);
    this.audio.pop();
  }

  _showResult() {
    const d = this.store.data;
    const prevBest = d.best;
    const isNew = this.score > d.best;
    if (isNew) d.best = this.score;
    const newChain = this.maxChain > d.bestChain;
    if (newChain) d.bestChain = this.maxChain;
    d.plays += 1;
    this.store.save();
    const rank = RANKS.find((r) => this.score >= r.min) || RANKS[RANKS.length - 1];
    const next = TIERS.find((t) => t.n > this.maxChain);
    this.mode = 'over';
    this.ui.showResult({
      score: this.score,
      isNew,
      prevBest,
      best: d.best,
      maxChain: this.maxChain,
      newChain,
      bestChain: d.bestChain,
      kills: this.kills,
      reason: this.endReason,
      rank,
      goal: next ? next.n : null,
      tip: pick(TIPS),
      firstSlash: this.stats.firstSlash,
      slashes: this.slashCount,
    });
  }

  // ------------------------------------------------------------------
  //  連鎖
  // ------------------------------------------------------------------
  _schedule(e, delay, cause, gen, from, act = this.act) {
    if (!act || !e.alive || e.state === 'doomed') return false;
    if (cause !== 'slash' && act.events >= CFG.MAX_CHAIN_EVENTS) return false;
    e.state = 'doomed';
    act.events++;
    this.queue.push({ t: this.fxTime + delay, e, cause, gen, act, from: from ? { x: from.x, y: from.y } : null });
    return true;
  }

  _updateChains(dt) {
    this.fxTime += dt;
    if (this.queue.length) {
      const due = [];
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].t <= this.fxTime) {
          due.push(this.queue[i]);
          this.queue[i] = this.queue[this.queue.length - 1];
          this.queue.pop();
        }
      }
      due.sort((a, b) => a.t - b.t);
      for (const ev of due) this._kill(ev);
    }
    this._updateVortices(dt);
    const act = this.act;
    if (act && !act.finished && this.queue.length === 0 && this.vortices.length === 0 && this.fxTime - act.lastKill > 0.35) {
      act.finished = true;
      if (act.combo >= 2 && this.mode !== 'demo') {
        this.fx.text('+' + fmt(act.score), this.W / 2, this.comboY + 64, { size: 26, color: '#ffe36b', life: 1.1, vy: -16, tag: 'gain', replace: 'gain', pop: 1 });
      }
    }
    const c = this.comboView;
    if (c) {
      c.t += dt;
      c.punch *= Math.exp(-dt * 10);
      if (c.t > 1.6) this.comboView = null;
    }
  }

  _kill(ev) {
    const e = ev.e;
    if (!e.alive) return;
    e.alive = false;
    e.state = 'dead';
    const act = ev.act;
    const T = ENEMY[e.kind];
    act.combo++;
    act.lastKill = this.fxTime;
    const scoring = this.mode === 'play' || this.mode === 'ending';
    if (scoring) {
      const pts = Math.round(T.score * chainMultiplier(act.combo));
      this.score += pts;
      act.score += pts;
      this.kills++;
      if (act.combo > this.maxChain) this.maxChain = act.combo;
      // 連鎖でゲージ追加回復（1回の斬撃につき上限あり）
      if (act.gaugeBonus < CFG.GAUGE_BONUS_CAP && this.slash.phase === 'idle' && this.mode === 'play') {
        const add = Math.min(CFG.GAUGE_PER_KILL, CFG.GAUGE_BONUS_CAP - act.gaugeBonus);
        act.gaugeBonus += add;
        this.gauge = Math.min(1, this.gauge + add);
      }
    }

    // 撃破演出
    if (ev.cause === 'slash') {
      this.fx.cutPieces(getSprite(e.kind), e.x, e.y, e.angle, e.cutAngle);
      this.fx.sparks(e.x, e.y, 6, '#ffffff', 240, 560, e.cutAngle, 0.5, 1.8);
      this.fx.sparks(e.x, e.y, 5, T.color, 120, 300, null, TAU, 2);
    } else {
      this.fx.shards(e.x, e.y, 6, T.color);
      this.fx.sparks(e.x, e.y, 6, T.color, 140, 360, null, TAU, 2);
      if (ev.from) this.fx.bolt(ev.from.x, ev.from.y, e.x, e.y);
    }
    this.fx.flare(e.x, e.y, e.r * 4.2, T.color, 0.2, 1.4);
    this.audio.blip(act.combo, (e.x / this.W) * 2 - 1);

    if (this.mode !== 'demo') {
      if (act.combo >= 2) {
        const c = this.comboView;
        this.comboView = { n: act.combo, t: 0, punch: 1, mult: chainMultiplier(act.combo), wob: c ? c.wob : 0 };
      }
      while (act.tierIdx < TIERS.length && act.combo >= TIERS[act.tierIdx].n) {
        const tier = TIERS[act.tierIdx++];
        this.fx.text(tier.label, this.W / 2, this.H * 0.36, {
          size: tier.jp ? 60 : 46, color: tier.color, life: 1.2, vy: -12, jp: tier.jp, tag: 'tier', replace: 'tier',
        });
        this.audio.tier(act.tierIdx);
        this.fx.flash(0.12, tier.color);
        this.fx.shake(0.15);
        this._vibe(25);
      }
    }

    // 死亡時効果（各敵1度だけ・世代数に上限）
    if (ev.gen < CFG.MAX_CHAIN_GEN) {
      if (e.kind === 'bomb') this._explode(e, ev);
      else if (e.kind === 'thunder') this._lightning(e, ev);
      else if (e.kind === 'splitter') this._split(e, ev);
      else if (e.kind === 'vortex') this._startVortex(e, ev);
    }
  }

  // 分裂型：十字4方向へ破片が飛び、通り道の敵を貫く
  _split(e, ev) {
    const x = e.x, y = e.y, L = CFG.SPLIT_RANGE, col = ENEMY.splitter.color;
    this.audio.split((x / this.W) * 2 - 1);
    this.fx.flare(x, y, 70, col, 0.2, 1.5);
    for (let k = 0; k < CFG.SPLIT_SHARDS; k++) {
      const a = e.angle + (k * TAU) / CFG.SPLIT_SHARDS;
      const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
      this.fx.beam(x, y, ex, ey, col, L / CFG.SPLIT_SPEED);
      const hits = [];
      for (const o of this.enemies) {
        if (!o.alive || o.state !== 'alive') continue;
        const d = segDist(x, y, ex, ey, o.x, o.y);
        if (d <= o.r + 8) hits.push({ o, s: segOut.t * L });
      }
      hits.sort((p, q) => p.s - q.s);
      for (const h of hits) this._schedule(h.o, 0.02 + h.s / CFG.SPLIT_SPEED, 'split', ev.gen + 1, null, ev.act);
    }
  }

  // 吸引型：周囲の敵を中心へ吸い寄せ、最後に中心で圧縮爆発
  _startVortex(e, ev) {
    this.vortices.push({ x: e.x, y: e.y, t: 0, gen: ev.gen, act: ev.act });
    this.audio.vortex((e.x / this.W) * 2 - 1);
    this.fx.flare(e.x, e.y, 90, ENEMY.vortex.color, 0.3, 1.2);
  }

  _updateVortices(dt) {
    for (let i = this.vortices.length - 1; i >= 0; i--) {
      const v = this.vortices[i];
      v.t += dt;
      const R = CFG.VORTEX_RADIUS;
      for (const o of this.enemies) {
        if (!o.alive || o.state !== 'alive') continue;
        const dx = v.x - o.x, dy = v.y - o.y;
        const d = Math.hypot(dx, dy);
        if (d > R || d < 1) continue;
        const pull = Math.min(d - 6, (520 * (1 - d / R) + 160) * dt);
        o.x += (dx / d) * pull;
        o.y += (dy / d) * pull;
        o.vx = 0;
        o.vy = 0;
        o.stun = Math.max(o.stun, 0.35);
      }
      if (Math.random() < dt * 40) {
        const a = Math.random() * TAU, r = R * (0.5 + Math.random() * 0.5);
        this.fx.sparks(v.x + Math.cos(a) * r, v.y + Math.sin(a) * r, 1, ENEMY.vortex.color, 260, 420, a + Math.PI + 0.5, 0.2, 1.6);
      }
      if (v.t >= CFG.VORTEX_TIME) {
        this.vortices.splice(i, 1);
        const C = CFG.VORTEX_CORE;
        this.fx.flare(v.x, v.y, C * 3, ENEMY.vortex.color, 0.3, 1.3);
        this.fx.flare(v.x, v.y, C * 1.4, '#ffffff', 0.12, 1.5);
        this.fx.ring(v.x, v.y, 8, C * 1.3, 0.25, '#e3c2ff', 6);
        this.fx.sparks(v.x, v.y, 18, '#e3c2ff', 220, 560, null, TAU, 2.4);
        this.fx.shake(0.18);
        this.audio.explode((v.x / this.W) * 2 - 1);
        this._vibe(20);
        for (const o of this.enemies) {
          if (!o.alive || o.state !== 'alive') continue;
          const d = Math.hypot(o.x - v.x, o.y - v.y);
          if (d - o.r <= C) this._schedule(o, 0.02 + (d / C) * 0.06, 'vortex', v.gen + 1, null, v.act);
        }
      }
    }
  }

  _explode(e, ev) {
    const R = CFG.BOMB_RADIUS;
    const x = e.x, y = e.y;
    this.fx.explosion(x, y, R);
    this.fx.shake(0.16);
    this.fx.flash(0.05, '#ffb347');
    this.audio.explode((x / this.W) * 2 - 1);
    this._vibe(18);
    for (const o of this.enemies) {
      if (!o.alive || o.state !== 'alive') continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d - o.r <= R) this._schedule(o, 0.04 + (d / R) * 0.1, 'bomb', ev.gen + 1, null, ev.act);
    }
  }

  _lightning(e, ev) {
    let cx = e.x, cy = e.y, delay = 0, hops = 0;
    const R2 = CFG.THUNDER_RANGE * CFG.THUNDER_RANGE;
    this.audio.zap((cx / this.W) * 2 - 1);
    this.fx.flare(cx, cy, 80, '#7fe9ff', 0.2, 1.5);
    for (let j = 0; j < CFG.THUNDER_JUMPS; j++) {
      let best = null, bd = R2;
      for (const o of this.enemies) {
        if (!o.alive || o.state !== 'alive') continue;
        const d2 = (o.x - cx) ** 2 + (o.y - cy) ** 2;
        if (d2 < bd) {
          bd = d2;
          best = o;
        }
      }
      if (!best) break;
      delay += 0.07;
      if (!this._schedule(best, delay, 'thunder', ev.gen + 1, { x: cx, y: cy }, ev.act)) break;
      cx = best.x;
      cy = best.y;
      hops++;
    }
    if (!hops) this.fx.sparks(e.x, e.y, 10, '#7fe9ff', 100, 300, null, TAU, 1.5);
  }

  // ------------------------------------------------------------------
  //  スポーン
  // ------------------------------------------------------------------
  _updateSpawner(dt) {
    const t = this.time;
    while (this.scriptIdx < OPENING.length && OPENING[this.scriptIdx].t <= t) {
      this._queueGroup(OPENING[this.scriptIdx], phaseAt(t), true); // 固定出現は上限を超えても必ず出す
      this.scriptIdx++;
    }
    if (t >= OPENING_END) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const P = phaseAt(t);
        this.spawnTimer = P.interval * rand(0.85, 1.15);
        const formation = weighted([
          ['clump', 0.42], ['line', 0.16], ['v', 0.14], ['snake', 0.12], ['ring', t > 22 ? 0.12 : 0],
        ]);
        this._queueGroup({ formation, n: randInt(Math.round(P.min), Math.round(P.max)) }, P);
      }
    }
  }

  _aliveCount() {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  _queueGroup(spec, P, scripted = false) {
    let planned = this._aliveCount();
    for (const g of this.pending) planned += g.members.length;
    const cap = scripted ? CFG.MAX_ENEMIES : Math.min(CFG.MAX_ENEMIES, Math.round(P.cap ?? CFG.MAX_ENEMIES));
    const n = Math.min(spec.n, cap - planned);
    if (n < 3) return;
    const count = (given, rate) => given ?? Math.max(0, Math.round(n * (rate || 0) + rand(-0.45, 0.45)));
    let left = n;
    const take = (c) => {
      const v = Math.min(c, left);
      left -= v;
      return v;
    };
    const bombs = take(count(spec.bombs, P.bomb));
    const vortexes = take(count(spec.vortexes, P.vortex));
    const thunders = take(count(spec.thunders, P.thunder));
    const splitters = take(count(spec.splitters, P.splitter));

    const f = this._formation(spec.formation, spec.side, n);
    // 中心寄り：吸引型 → 爆弾型（1つおき）／外周寄り：雷撃型／分裂型は残りから均等に
    const order = f.pos.map((_, i) => i).sort((a, b) => f.d[a] - f.d[b]);
    const kinds = new Array(n).fill('normal');
    const place = (kind, num, pickIdx) => {
      let placed = 0;
      for (let k = 0; placed < num && k < n * 3; k++) {
        const idx = pickIdx(k);
        if (kinds[idx] === 'normal') {
          kinds[idx] = kind;
          placed++;
        }
      }
    };
    place('vortex', vortexes, (k) => order[k % n]);
    place('bomb', bombs, (k) => order[(k * 2 + 1) % n]);
    place('thunder', thunders, (k) => order[n - 1 - (k % n)]);
    place('splitter', splitters, (k) => order[(k * 3 + Math.floor(n / 3)) % n]);
    const members = f.pos.map((q, i) => ({ kind: kinds[i], x: q.x, y: q.y }));
    const tele = f.ring ? 1.0 : 0.8;
    this.pending.push({ t: tele, max: tele, members, warn: f.warn, speed: P.speed ?? 1, ring: !!f.ring, hasBomb: bombs > 0 });
    if (f.ring && this.mode === 'play') this.audio.warn();
  }

  _formation(type, side, n) {
    const W = this.W, H = this.H, M = 40;
    const pos = [];
    if (type === 'ring') {
      const p = this.player;
      const cx = clamp(p.x, 120, W - 120), cy = clamp(p.y, 220, H - 220);
      const R = Math.min(W, H) * 0.47;
      const off = rand(0, TAU);
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * TAU;
        pos.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
      }
      return {
        pos,
        d: pos.map((_, i) => (i * 0.618) % 1),
        warn: pos.map((q) => ({ x: q.x, y: q.y, type: 'spot' })),
        ring: true,
      };
    }
    side = side || weighted([['top', 0.3], ['bottom', 0.18], ['left', 0.26], ['right', 0.26]]);
    let ex, ey, fx, fy;
    if (side === 'top') { ex = rand(80, W - 80); ey = -M; fx = 0; fy = 1; }
    else if (side === 'bottom') { ex = rand(80, W - 80); ey = H + M; fx = 0; fy = -1; }
    else if (side === 'left') { ex = -M; ey = rand(H * 0.18, H * 0.82); fx = 1; fy = 0; }
    else { ex = W + M; ey = rand(H * 0.18, H * 0.82); fx = -1; fy = 0; }
    const lx = -fy, ly = fx;
    const local = [];
    if (type === 'clump') {
      const rad = 14 * Math.sqrt(n) + 6;
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = rad * Math.sqrt((i + 0.5) / n);
        local.push([Math.cos(a) * rr, Math.sin(a) * rr - rad]);
      }
    } else if (type === 'line') {
      for (let i = 0; i < n; i++) local.push([(i - (n - 1) / 2) * 30, -rand(0, 8)]);
    } else if (type === 'v') {
      for (let i = 0; i < n; i++) {
        const k = i - (n - 1) / 2;
        local.push([k * 27, -Math.abs(k) * 24]);
      }
    } else {
      for (let i = 0; i < n; i++) local.push([Math.sin(i * 0.8) * 22, -i * 27]);
    }
    let mx = 0, my = 0;
    for (const [a, b] of local) {
      mx += a / n;
      my += b / n;
    }
    for (const [a, b] of local) pos.push({ x: ex + lx * a + fx * b, y: ey + ly * a + fy * b });
    const wx = clamp(ex + fx * (M + 18), 18, W - 18);
    const wy = side === 'top' ? this.hudBottom + 14 : clamp(ey + fy * (M + 18), 18, H - 18);
    return {
      pos,
      d: local.map(([a, b]) => Math.hypot(a - mx, b - my)),
      warn: [{ x: wx, y: wy, ang: Math.atan2(fy, fx), type: 'edge' }],
      ring: false,
    };
  }

  _updatePending(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const g = this.pending[i];
      g.t -= dt;
      if (g.t > 0) continue;
      this.pending.splice(i, 1);
      for (const m of g.members) {
        if (this._aliveCount() >= CFG.MAX_ENEMIES) break;
        const e = new Enemy(m.kind, m.x, m.y, g.speed);
        e.spawnT = g.ring ? 0 : 0.4;
        this.enemies.push(e);
        // 特殊敵の初登場：頭上に説明ラベルを出す
        if (this.mode === 'play' && m.kind !== 'normal') {
          const tut = this.store.data.tut;
          if (!tut[m.kind]) {
            tut[m.kind] = true;
            this.labels.push({ e, kind: m.kind, t: 0, vis: false });
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  //  タイトル背景のデモ（自動で斬撃を見せる）
  // ------------------------------------------------------------------
  _updateDemo(dt) {
    this.demoSpawn -= dt;
    if (this.demoSpawn <= 0) {
      this.demoSpawn = rand(0.9, 1.5);
      this._queueGroup(
        { formation: weighted([['clump', 0.6], ['line', 0.2], ['v', 0.2]]), n: randInt(5, 8), bombs: randInt(1, 2), thunders: randInt(0, 1), splitters: Math.random() < 0.4 ? 1 : 0, vortexes: Math.random() < 0.25 ? 1 : 0 },
        { cap: 36, speed: 0.9, bomb: 0, thunder: 0 },
      );
    }
    if (this.slash.phase === 'idle' && this.gauge >= 1 && this.recoverT > 1.0) {
      let near = 0;
      const p = this.player;
      for (const e of this.enemies) {
        if (e.alive && e.state === 'alive' && e.spawnT > 0.4 && Math.hypot(e.x - p.x, e.y - p.y) < 330) near++;
      }
      if (near >= 10) this._demoSlash();
    }
  }

  _demoMove(dt) {
    const p = this.player;
    this.demoRetarget -= dt;
    const t = this.demoTarget;
    if (!t || this.demoRetarget <= 0 || Math.hypot(t.x - p.x, t.y - p.y) < 24) {
      this.demoTarget = { x: rand(90, this.W - 90), y: rand(this.H * 0.4, this.H * 0.72) };
      this.demoRetarget = rand(1.5, 3);
    }
    let vx = this.demoTarget.x - p.x, vy = this.demoTarget.y - p.y;
    let m = Math.hypot(vx, vy) || 1;
    vx /= m;
    vy /= m;
    for (const e of this.enemies) {
      if (!e.alive || e.state !== 'alive') continue;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 90 && d > 0) {
        const w = ((90 - d) / 90) * 2;
        vx += (dx / d) * w;
        vy += (dy / d) * w;
      }
    }
    m = Math.hypot(vx, vy) || 1;
    return { x: (vx / m) * 0.6, y: (vy / m) * 0.6 };
  }

  _demoSlash() {
    const p = this.player;
    const chosen = new Set();
    const way = [];
    let cx = p.x, cy = p.y, budget = CFG.SLASH_MAX_LEN * 0.9;
    for (let k = 0; k < 3; k++) {
      let best = null, bs = 0;
      for (const e of this.enemies) {
        if (!e.alive || e.state !== 'alive' || chosen.has(e) || e.spawnT < 0.4) continue;
        if (e.x < 24 || e.x > this.W - 24 || e.y < 24 || e.y > this.H - 24) continue;
        const d = Math.hypot(e.x - cx, e.y - cy);
        if (d > budget || d < 30) continue;
        let dens = 0;
        for (const o of this.enemies) if (o.alive && Math.hypot(o.x - e.x, o.y - e.y) < 85) dens++;
        const sc = (dens + ({ bomb: 4, thunder: 2.5, splitter: 3, vortex: 3.5 }[e.kind] || 0)) / (1 + d / 220);
        if (sc > bs) {
          bs = sc;
          best = e;
        }
      }
      if (!best) break;
      chosen.add(best);
      way.push({ x: best.x, y: best.y });
      budget -= Math.hypot(best.x - cx, best.y - cy);
      cx = best.x;
      cy = best.y;
    }
    if (!way.length) return;
    const path = [];
    let px = p.x, py = p.y;
    for (const w of way) {
      const L = Math.hypot(w.x - px, w.y - py);
      const n = Math.max(2, Math.ceil(L / 10));
      for (let i = 1; i <= n; i++) path.push({ x: px + ((w.x - px) * i) / n, y: py + ((w.y - py) * i) / n });
      px = w.x;
      py = w.y;
    }
    this._enterSlash();
    this.slash.route = new Route(this.bounds);
    this.slash.route.begin(p.x, p.y, p.x, p.y, 'abs');
    this.slash.demo = { path, i: 0, t: 0 };
  }

  _demoDraw(dt) {
    const s = this.slash;
    const d = s.demo;
    d.t += dt;
    const target = Math.min(d.path.length, Math.floor((d.t / 0.55) * d.path.length));
    let moved = false;
    while (d.i < target) {
      const q = d.path[d.i++];
      s.route.move(q.x, q.y);
      moved = true;
    }
    if (moved) this._refreshHits();
    if (d.t > 0.8) this._fire();
  }

  // ------------------------------------------------------------------
  //  チュートリアル・HUD
  // ------------------------------------------------------------------
  _updateTutorial() {
    if (this.mode !== 'play') return;
    const tut = this.store.data.tut;
    if (tut.slash || this.gauge < 1 || this.slash.phase !== 'idle' || this.time < 1.4) return;
    // 敵が近づいてきたら「斬ボタン」を案内
    const p = this.player;
    if (this.enemies.some((e) => e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 270)) this.ui.showHint('slash');
  }

  _updateHUD(dt) {
    if (this.mode !== 'play' && this.mode !== 'ending') return;
    this.scoreShown += (this.score - this.scoreShown) * Math.min(1, dt * 12);
    if (Math.abs(this.score - this.scoreShown) < 1) this.scoreShown = this.score;
    const s = this.slash;
    this.ui.updateHUD({
      time: Math.max(0, CFG.RUN_TIME - this.time),
      score: this.scoreShown,
      maxChain: this.maxChain,
      gauge: this.gauge,
      phase: s.phase,
      aimLeft: s.phase === 'aim' ? Math.max(0, 1 - s.t / CFG.SLASH_THINK_TIME) : 0,
    });
  }

  _vibe(ms) {
    if (!this.store.data.vibe || this.mode === 'demo' || !navigator.vibrate) return;
    const now = performance.now();
    if (now - (this._lastVibe || 0) < 70) return;
    this._lastVibe = now;
    try {
      navigator.vibrate(ms);
    } catch {
      /* noop */
    }
  }

  // ------------------------------------------------------------------
  //  描画
  // ------------------------------------------------------------------
  render() {
    const ctx = this.ctx, W = this.W, H = this.H;
    const k = this.dpr * this.scale;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bgLayer, 0, 0, W, H);
    this._drawGrid(ctx);

    const fx = this.fx;
    const z = 1 + fx.zoom;
    ctx.save();
    ctx.translate(W / 2 + fx.shakeX, H / 2 + fx.shakeY);
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2);

    fx.drawDecals(ctx);
    this._drawWarnings(ctx);
    drawEnemies(ctx, this.enemies, this.realTime);
    fx.drawPieces(ctx);
    ctx.globalCompositeOperation = 'lighter';
    fx.drawGhosts(ctx, (c, x, y, a, al) => this._drawPlayerShape(c, x, y, a, al, true));
    drawEnemyGlows(ctx, this.enemies, this.realTime);
    fx.drawAdditive(ctx);
    this._drawVortices(ctx);
    this._drawDashLine(ctx);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    this._drawPlayer(ctx);
    this._drawLabels(ctx);
    if (this.slashBlend > 0.01) this._drawSlashOverlay(ctx);
    ctx.restore();

    // 画面座標
    this._drawCombo(ctx);
    fx.drawTexts(ctx, W, H);
    this._drawJoystick(ctx);
    if (this.slashBlend > 0.01) this._drawAimHud(ctx);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vignette, 0, 0, W, H);
    if (this.hurtA > 0.01) {
      ctx.globalAlpha = this.hurtA;
      ctx.drawImage(this.hurtLayer, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (fx.flashA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, fx.flashA);
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }

  _drawGrid(ctx) {
    const W = this.W, H = this.H, s = 45;
    const oy = this.bgScroll % s;
    ctx.strokeStyle = 'rgba(110,140,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (W / 2) % s; x <= W; x += s) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = oy - s; y <= H; y += s) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#a9bbff';
    for (const m of this.motes) {
      const y = (m.y * H + this.bgScroll * m.v * 0.1) % (H + 10);
      ctx.globalAlpha = m.a;
      ctx.fillRect(m.x * W, y - 5, m.s, m.s);
    }
    ctx.globalAlpha = 1;
  }

  _drawWarnings(ctx) {
    const t = this.realTime;
    for (const g of this.pending) {
      const blink = 0.55 + 0.45 * Math.sin(t * 22);
      const col = g.hasBomb ? '#ffa424' : '#ff3b6b';
      for (const w of g.warn) {
        if (w.type === 'edge') {
          ctx.save();
          ctx.translate(w.x, w.y);
          ctx.rotate(w.ang);
          ctx.globalAlpha = blink;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let k = 0; k < 2; k++) {
            const o = k * 9 - 4;
            ctx.beginPath();
            ctx.moveTo(o - 5, -9);
            ctx.lineTo(o + 4, 0);
            ctx.lineTo(o - 5, 9);
            ctx.stroke();
          }
          ctx.restore();
        } else {
          const k = 1 - g.t / g.max;
          ctx.globalAlpha = blink * 0.85;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(w.x, w.y, 18 - k * 8, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawPlayerShape(ctx, x, y, ang, alpha, ghost) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-2, 7.5);
    ctx.lineTo(-11, 0);
    ctx.lineTo(-2, -7.5);
    ctx.closePath();
    if (ghost) {
      ctx.fillStyle = '#3fd8ff';
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#6ff3ff';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(10, 0);
      ctx.strokeStyle = '#1aa6c9';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPlayer(ctx) {
    const p = this.player;
    if (!p.visible) return;
    const tr = p.trail;
    ctx.globalCompositeOperation = 'lighter';
    if (tr.length > 2) {
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const k = 1 - i / tr.length;
        ctx.strokeStyle = `rgba(111,243,255,${0.5 * k})`;
        ctx.lineWidth = 7 * k + 1;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
    }
    const ready = this.gauge >= 1 && this.mode === 'play';
    const gs = 64 + (ready ? 12 + Math.sin(this.realTime * 8) * 8 : 0);
    ctx.globalAlpha = ready ? 0.8 : 0.5;
    ctx.drawImage(glowSprite('#3fd8ff', false), p.x - gs / 2, p.y - gs / 2, gs, gs);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const blink = p.blink > 0 && Math.floor(this.realTime * 18) % 2 === 0;
    this._drawPlayerShape(ctx, p.x, p.y, p.angle, blink ? 0.3 : 1, false);
  }

  _drawLabels(ctx) {
    for (const L of this.labels) {
      if (!L.vis) continue;
      const e = L.e;
      const info = LABELS[L.kind];
      const a = Math.min(1, L.t / 0.2) * Math.min(1, (3.6 - L.t) / 0.4);
      ctx.font = `900 13px ${FONT_JP}`;
      const w1 = ctx.measureText(info.title).width;
      ctx.font = `700 11px ${FONT_JP}`;
      const w2 = ctx.measureText(info.sub).width;
      const w = Math.max(w1, w2) + 20, h = 40;
      const x = clamp(e.x, w / 2 + 6, this.W - w / 2 - 6);
      const above = e.y - e.r - 30 - h > this.hudBottom;
      const y = above ? e.y - e.r - 26 - h : e.y + e.r + 26;
      const bob = Math.sin(this.realTime * 6) * 2;
      ctx.globalAlpha = a;
      ctx.strokeStyle = info.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, above ? y + h + bob : y + bob);
      ctx.lineTo(e.x, above ? e.y - e.r - 4 : e.y + e.r + 4);
      ctx.stroke();
      ctx.fillStyle = 'rgba(6,8,22,0.9)';
      ctx.beginPath();
      const rx = x - w / 2, ry = y + bob, rr = 8;
      ctx.moveTo(rx + rr, ry);
      ctx.arcTo(rx + w, ry, rx + w, ry + h, rr);
      ctx.arcTo(rx + w, ry + h, rx, ry + h, rr);
      ctx.arcTo(rx, ry + h, rx, ry, rr);
      ctx.arcTo(rx, ry, rx + w, ry, rr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 13px ${FONT_JP}`;
      ctx.fillStyle = info.color;
      ctx.fillText(info.title, x, ry + 13);
      ctx.font = `700 11px ${FONT_JP}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(info.sub, x, ry + 28);
    }
    ctx.globalAlpha = 1;
  }

  _drawVortices(ctx) {
    if (!this.vortices.length) return;
    const glow = glowSprite(ENEMY.vortex.color, false);
    ctx.lineCap = 'round';
    for (const v of this.vortices) {
      const k = Math.min(1, v.t / CFG.VORTEX_TIME);
      const R = CFG.VORTEX_RADIUS * (1 - 0.55 * k);
      ctx.globalAlpha = 0.5 + 0.4 * k;
      ctx.drawImage(glow, v.x - R * 0.7, v.y - R * 0.7, R * 1.4, R * 1.4);
      ctx.strokeStyle = '#c77dff';
      for (let arm = 0; arm < 4; arm++) {
        ctx.globalAlpha = 0.75;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const a = arm * (TAU / 4) - this.realTime * 9 + t * 3.2;
          const rr = R * (1 - t * 0.9);
          const x = v.x + Math.cos(a) * rr, y = v.y + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.35 * (1 - k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(v.x, v.y, R, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  _drawDashLine(ctx) {
    const s = this.slash;
    if (s.phase !== 'dash' && s.phase !== 'hold') return;
    const prog = s.phase === 'hold' ? s.len : s.len * easeOutQuad(Math.min(1, s.t / s.dur));
    const pts = [s.pts[0]];
    for (let i = 1; i < s.pts.length; i++) {
      if (s.cum[i] <= prog) pts.push(s.pts[i]);
      else {
        const q = pointAt(s.pts, s.cum, prog);
        pts.push(q);
        break;
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    };
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#6ff3ff';
    ctx.lineWidth = 6;
    path();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.4;
    path();
  }

  _drawSlashOverlay(ctx) {
    const b = this.slashBlend;
    const W = this.W, H = this.H;
    const s = this.slash;
    const p = this.player;
    ctx.fillStyle = `rgba(2,4,14,${0.62 * b})`;
    ctx.fillRect(-60, -60, W + 120, H + 120);

    // 特殊敵とルート上の敵を強調して描き直す
    const hitSet = s.hitSet;
    ctx.globalAlpha = b;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const isHit = hitSet && hitSet.has(e);
      if (!isHit && e.kind === 'normal' && e.state === 'alive') continue;
      const spr = getSprite(e.kind, isHit || e.state !== 'alive');
      const sz = spr.size * (isHit ? 1.12 : 1);
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);
      ctx.drawImage(spr.canvas, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    // ルート上の特殊敵：連鎖の届く範囲を表示
    if (hitSet && s.phase === 'aim') {
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 1.5;
      for (const e of hitSet) {
        if (e.kind === 'normal') continue;
        ctx.beginPath();
        if (e.kind === 'splitter') {
          // 破片の飛ぶ十字方向
          ctx.strokeStyle = 'rgba(157,255,92,0.7)';
          for (let k = 0; k < CFG.SPLIT_SHARDS; k++) {
            const a = e.angle + (k * TAU) / CFG.SPLIT_SHARDS;
            ctx.moveTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
            ctx.lineTo(e.x + Math.cos(a) * CFG.SPLIT_RANGE, e.y + Math.sin(a) * CFG.SPLIT_RANGE);
          }
        } else if (e.kind === 'vortex') {
          ctx.strokeStyle = 'rgba(199,125,255,0.65)';
          ctx.arc(e.x, e.y, CFG.VORTEX_RADIUS, 0, TAU);
        } else {
          ctx.strokeStyle = e.kind === 'bomb' ? 'rgba(255,164,36,0.75)' : 'rgba(67,217,255,0.45)';
          ctx.arc(e.x, e.y, e.kind === 'bomb' ? CFG.BOMB_RADIUS : CFG.THUNDER_RANGE, 0, TAU);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // ターゲットマーク
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      const pulse = 1 + Math.sin(this.realTime * 14) * 0.08;
      for (const e of hitSet) {
        const r = (e.r + 7) * pulse;
        ctx.beginPath();
        for (let q = 0; q < 4; q++) {
          const a = q * (Math.PI / 2) + Math.PI / 4;
          ctx.moveTo(e.x + Math.cos(a - 0.35) * r, e.y + Math.sin(a - 0.35) * r);
          ctx.arc(e.x, e.y, r, a - 0.35, a + 0.35);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    this._drawPlayer(ctx);
    if (s.phase === 'aim' && s.route) this._drawRoute(ctx, s.route, s.hits ? s.hits.length : 0);
    if (s.phase === 'aim') {
      const left = Math.max(0, 1 - s.t / CFG.SLASH_THINK_TIME);
      ctx.globalAlpha = 0.25 * b;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 30, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = b;
      ctx.strokeStyle = left < 0.34 ? '#ff5f7e' : '#ffffff';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  _drawRoute(ctx, r, nHits) {
    const pts = r.points();
    const t = this.realTime;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    };
    ctx.globalCompositeOperation = 'lighter';
    path();
    ctx.strokeStyle = 'rgba(111,243,255,0.14)';
    ctx.lineWidth = CFG.SLASH_BLADE_R * 2;
    ctx.stroke();
    path();
    ctx.strokeStyle = 'rgba(111,243,255,0.5)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([12, 9]);
    ctx.lineDashOffset = -t * 90;
    path();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);

    // 曲がり角
    for (let i = 1; i < r.anchors.length; i++) {
      const a = r.anchors[i];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y - 7);
      ctx.lineTo(a.x + 7, a.y);
      ctx.lineTo(a.x, a.y + 7);
      ctx.lineTo(a.x - 7, a.y);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#6ff3ff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 先端：残り長さのリング・残り曲がり角・撃破予定数
    const tip = pts[pts.length - 1];
    const remain = Math.max(0, 1 - r.length / CFG.SLASH_MAX_LEN);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 14, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = r.clamped ? '#ff5f7e' : '#6ff3ff';
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 14, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.02, remain));
    ctx.stroke();
    const left = CFG.SLASH_MAX_CORNERS - r.corners;
    for (let i = 0; i < CFG.SLASH_MAX_CORNERS; i++) {
      const x = tip.x + 22 + i * 11, y = tip.y - 18;
      ctx.beginPath();
      ctx.moveTo(x, y - 4.5);
      ctx.lineTo(x + 4.5, y);
      ctx.lineTo(x, y + 4.5);
      ctx.lineTo(x - 4.5, y);
      ctx.closePath();
      if (i < left) {
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
    if (nHits > 0) {
      ctx.font = `italic 900 20px ${FONT_NUM}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(4,4,14,0.9)';
      const tx = tip.x + 18, ty = tip.y + 6;
      ctx.strokeText('×' + nHits, tx, ty);
      ctx.fillStyle = '#ffffff';
      ctx.fillText('×' + nHits, tx, ty);
    }
  }

  _drawAimHud(ctx) {
    const b = this.slashBlend;
    const W = this.W, H = this.H;
    const s = this.slash;
    ctx.globalAlpha = b;
    // 四隅のブラケット
    const m = 12, L = 30;
    const top = this.hudBottom + 2, bot = H - this.safe.bottom / this.scale - m;
    ctx.strokeStyle = '#6ff3ff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(m, top + L); ctx.lineTo(m, top); ctx.lineTo(m + L, top);
    ctx.moveTo(W - m - L, top); ctx.lineTo(W - m, top); ctx.lineTo(W - m, top + L);
    ctx.moveTo(m, bot - L); ctx.lineTo(m, bot); ctx.lineTo(m + L, bot);
    ctx.moveTo(W - m - L, bot); ctx.lineTo(W - m, bot); ctx.lineTo(W - m, bot - L);
    ctx.stroke();
    if (this.mode === 'play' && s.phase === 'aim') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `italic 900 15px ${FONT_NUM}`;
      ctx.fillStyle = '#6ff3ff';
      ctx.fillText('— TIME STOP —', W / 2, top + 14);
      const y = H - (this.safe.bottom + 150) / this.scale;
      const msg = s.route ? '指を離して斬る！' : '指でなぞって斬撃ルートを描く';
      ctx.font = `800 17px ${FONT_JP}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(2,4,14,0.9)';
      ctx.strokeText(msg, W / 2, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(msg, W / 2, y);
      if (!s.route) {
        ctx.font = `700 12px ${FONT_JP}`;
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText('曲がり角は2回まで ・ 斬ボタンを再タップで解除', W / 2, y + 22);
      }
    }
    ctx.globalAlpha = 1;
  }

  _drawCombo(ctx) {
    const c = this.comboView;
    if (!c) return;
    const a = c.t < 1.2 ? 1 : Math.max(0, 1 - (c.t - 1.2) / 0.4);
    const color = tierColor(c.n);
    const sc = 1 + c.punch * 0.35;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(this.W / 2 + (Math.random() - 0.5) * c.punch * 4, this.comboY);
    ctx.scale(sc, sc);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.font = `italic 900 68px ${FONT_NUM}`;
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(4,4,14,0.9)';
    ctx.strokeText(String(c.n), 0, 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = color;
    ctx.fillText(String(c.n), 0, 0);
    ctx.shadowBlur = 0;
    ctx.font = `italic 900 17px ${FONT_NUM}`;
    ctx.lineWidth = 5;
    ctx.strokeText('CHAIN', 0, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('CHAIN', 0, 22);
    ctx.font = `italic 900 15px ${FONT_NUM}`;
    const mt = '×' + c.mult.toFixed(1);
    ctx.strokeText(mt, 0, 42);
    ctx.fillStyle = '#ffe36b';
    ctx.fillText(mt, 0, 42);
    ctx.restore();
  }

  _drawJoystick(ctx) {
    const st = this.input && this.input.stick;
    if (!st || !st.active || this.mode !== 'play') return;
    const ox = (st.ox - this.rect.left) / this.scale, oy = (st.oy - this.rect.top) / this.scale;
    let kx = (st.x - this.rect.left) / this.scale - ox, ky = (st.y - this.rect.top) / this.scale - oy;
    const R = CFG.STICK_RADIUS_PX / this.scale;
    const m = Math.hypot(kx, ky);
    if (m > R) {
      kx = (kx / m) * R;
      ky = (ky / m) * R;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(ox, oy, R, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(111,243,255,0.32)';
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(ox + kx, oy + ky, 20, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
}

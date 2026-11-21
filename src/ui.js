// =====================================================================
//  DOM UI：タイトル・HUD・斬ボタン・ヒント・リザルト・ポーズ
//  （ゲーム画面そのものは Canvas、メニューとHUDは HTML/CSS）
// =====================================================================
import { getSprite } from './enemies.js';
import { fmt, easeOutCubic } from './utils.js';

const $ = (id) => document.getElementById(id);

function drawSpriteInto(cv, kind, size) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(size * dpr);
  cv.height = Math.round(size * dpr);
  cv.style.width = size + 'px';
  cv.style.height = size + 'px';
  const g = cv.getContext('2d');
  const spr = getSprite(kind);
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  if (kind === 'normal') g.rotate(-Math.PI / 2);
  const sz = size * 1.25;
  g.drawImage(spr.canvas, -sz / 2, -sz / 2, sz, sz);
}

export class UI {
  constructor(store, audio) {
    this.store = store;
    this.audio = audio;
    this.el = {
      app: $('app'),
      hud: $('hud'),
      timeBlock: $('hud-time-block'),
      time: $('hud-time'),
      score: $('hud-score'),
      maxchain: $('hud-maxchain'),
      hp: $('hud-hp'),
      slash: $('btn-slash'),
      slashState: $('slash-state'),
      title: $('screen-title'),
      result: $('screen-result'),
      pause: $('screen-pause'),
      rotate: $('rotate'),
      hintMove: $('hint-move'),
      hintSlash: $('hint-slash'),
      mute: $('btn-mute'),
    };
    this._c = {};
    this._countRaf = 0;
    document.querySelectorAll('canvas[data-kind]').forEach((cv) => drawSpriteInto(cv, cv.dataset.kind, 34));
    this.syncSettings();
    this.syncBest();
  }

  bind(h) {
    this.h = h;
    $('btn-start').addEventListener('click', () => h.start());
    $('btn-retry').addEventListener('click', () => {
      if (this.retryArmed()) h.retry();
    });
    $('btn-title').addEventListener('click', () => h.title());
    $('btn-pause').addEventListener('click', () => h.pause());
    $('btn-resume').addEventListener('click', () => h.resume());
    $('btn-quit').addEventListener('click', () => h.quit());
    this.el.mute.addEventListener('click', () => this._toggle('sound'));
    document.querySelectorAll('[data-setting]').forEach((b) => {
      b.addEventListener('click', () => this._toggle(b.dataset.setting));
    });
  }

  _toggle(key) {
    const d = this.store.data;
    d[key] = !d[key];
    this.store.save();
    if (key === 'sound') this.audio.setSound(d.sound);
    if (key === 'vibe' && d.vibe && navigator.vibrate) {
      try { navigator.vibrate(20); } catch { /* noop */ }
    }
    this.syncSettings();
    this.audio.ui();
  }

  syncSettings() {
    const d = this.store.data;
    document.querySelectorAll('[data-setting]').forEach((b) => {
      const on = !!d[b.dataset.setting];
      b.classList.toggle('off', !on);
      b.querySelector('b').textContent = on ? 'ON' : 'OFF';
    });
    this.el.mute.classList.toggle('off', !d.sound);
  }

  syncBest() {
    const d = this.store.data;
    $('title-best').textContent = fmt(d.best);
    $('title-chain').textContent = d.bestChain;
  }

  // ---------------- 画面 ----------------
  showTitle() {
    this.syncBest();
    this.el.result.classList.add('hidden');
    this.el.title.classList.remove('hidden');
    this._restartAnim(this.el.title);
  }

  isTitle() {
    return !this.el.title.classList.contains('hidden');
  }
  isResult() {
    return !this.el.result.classList.contains('hidden');
  }

  onRunStart() {
    cancelAnimationFrame(this._countRaf);
    this.el.title.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.pause.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.hideHint('move');
    this.hideHint('slash');
    this._c = {};
    this.el.app.classList.remove('slashing');
  }

  hideHUD() {
    this.el.hud.classList.add('hidden');
    this.el.app.classList.remove('slashing');
  }

  showPause() {
    this.el.pause.classList.remove('hidden');
  }
  hidePause() {
    this.el.pause.classList.add('hidden');
  }

  setRotate(on) {
    this.el.rotate.classList.toggle('hidden', !on);
  }

  _restartAnim(el) {
    el.classList.remove('anim');
    void el.offsetWidth;
    el.classList.add('anim');
  }

  // ---------------- HUD ----------------
  updateHUD(s) {
    const c = this._c, el = this.el;
    const tStr = s.time > 10 ? String(Math.ceil(s.time)) : s.time.toFixed(1);
    if (tStr !== c.t) {
      el.time.textContent = tStr;
      c.t = tStr;
    }
    const warn = s.time <= 10;
    if (warn !== c.warn) {
      el.timeBlock.classList.toggle('warn', warn);
      c.warn = warn;
    }
    const sc = fmt(s.score);
    if (sc !== c.score) {
      el.score.textContent = sc;
      c.score = sc;
    }
    if (s.maxChain !== c.mc) {
      el.maxchain.textContent = s.maxChain;
      c.mc = s.maxChain;
    }
    const state = s.phase === 'aim' ? 'aim' : s.phase !== 'idle' ? 'busy' : s.gauge >= 1 ? 'ready' : 'charge';
    if (state !== c.state) {
      el.slash.dataset.state = state;
      el.app.classList.toggle('slashing', state === 'aim' || state === 'busy');
      c.state = state;
      c.label = null;
    }
    const label = state === 'ready' ? 'READY' : state === 'aim' ? 'AIM' : state === 'busy' ? '' : Math.floor(s.gauge * 100) + '%';
    if (label !== c.label) {
      el.slashState.textContent = label;
      c.label = label;
    }
    const g = Math.round((state === 'aim' ? s.aimLeft : s.gauge) * 100) / 100;
    if (g !== c.g) {
      el.slash.style.setProperty('--g', g);
      c.g = g;
    }
  }

  setHP(hp, animate) {
    const pips = this.el.hp.children;
    for (let i = 0; i < pips.length; i++) {
      const lost = i >= hp;
      pips[i].classList.toggle('lost', lost);
      if (animate && i === hp) {
        pips[i].classList.remove('break');
        void pips[i].offsetWidth;
        pips[i].classList.add('break');
      }
    }
  }

  nudgeSlash() {
    const b = this.el.slash;
    b.classList.remove('nudge');
    void b.offsetWidth;
    b.classList.add('nudge');
  }

  pulseSlash() {
    const b = this.el.slash;
    b.classList.remove('pop');
    void b.offsetWidth;
    b.classList.add('pop');
  }

  showHint(name) {
    const el = name === 'move' ? this.el.hintMove : this.el.hintSlash;
    el.classList.add('show');
  }
  hideHint(name) {
    const el = name === 'move' ? this.el.hintMove : this.el.hintSlash;
    el.classList.remove('show');
  }

  // ---------------- リザルト ----------------
  showResult(d) {
    this.el.hud.classList.add('hidden');
    this.el.app.classList.remove('slashing');
    this.hideHint('move');
    this.hideHint('slash');
    const r = this.el.result;
    r.classList.remove('hidden');
    r.classList.toggle('defeated', d.reason === 'dead');
    this._restartAnim(r);

    $('res-reason').textContent = d.reason === 'dead' ? 'DEFEATED' : 'TIME UP';
    const rank = $('res-rank');
    rank.textContent = d.rank.rank;
    rank.style.setProperty('--rank', d.rank.color);
    $('res-chain').textContent = d.maxChain;
    $('res-chain').parentElement.classList.toggle('new', d.newChain);
    $('res-kills').textContent = d.kills;
    $('res-best').textContent = fmt(d.best);
    $('res-goal').textContent = d.goal ? `次の目標：${d.goal} 連鎖` : '百連鎖達成！ あとは自己ベスト更新だ';
    $('res-tip').textContent = 'TIP  ' + d.tip;
    const nb = $('res-newbest');
    nb.classList.add('hidden');
    const dbg = $('res-debug');
    if (dbg && new URLSearchParams(location.search).has('debug')) {
      dbg.classList.remove('hidden');
      dbg.textContent = `初回斬撃 ${d.firstSlash === null ? '—' : d.firstSlash.toFixed(1) + 's'} / 斬撃 ${d.slashes}回`;
    }

    // スコアのカウントアップ
    const scoreEl = $('res-score');
    const target = d.score;
    const dur = Math.min(1.2, 0.4 + target / 30000);
    const t0 = performance.now();
    cancelAnimationFrame(this._countRaf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 1000 / dur);
      scoreEl.textContent = fmt(target * easeOutCubic(k));
      if (k < 1) {
        this.audio.scoreTick();
        this._countRaf = requestAnimationFrame(step);
      } else if (d.isNew && target > 0) {
        nb.classList.remove('hidden');
        this.audio.record();
      }
    };
    this._countRaf = requestAnimationFrame(step);

    // 連打による誤タップ防止のため、少しだけ遅らせて再挑戦ボタンを有効化
    const retry = $('btn-retry');
    retry.classList.remove('armed');
    clearTimeout(this._armTimer);
    this._armTimer = setTimeout(() => retry.classList.add('armed'), 550);
  }

  retryArmed() {
    return $('btn-retry').classList.contains('armed');
  }
}

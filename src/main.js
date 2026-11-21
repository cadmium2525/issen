// =====================================================================
//  CHAIN SLASH — 起動・レイアウト・メインループ
// =====================================================================
import { CFG } from './config.js';
import { store } from './storage.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Input } from './input.js';

const app = document.getElementById('app');
const canvas = document.getElementById('game');
const probe = document.getElementById('safe-probe');
const debugEl = document.getElementById('debug');

const audio = new AudioEngine(store);
const ui = new UI(store, audio);
const game = new Game({ canvas, ui, audio, store });
const input = new Input(canvas, document.getElementById('btn-slash'), game);
game.input = input;

const DEBUG = new URLSearchParams(location.search).has('debug');
const coarse = window.matchMedia('(pointer: coarse)').matches;
let dpr = Math.min(window.devicePixelRatio || 1, CFG.DPR_MAX);

// ---------------------------------------------------------------
//  レイアウト：縦9:16を基本に、縦長の端末ではそのまま全画面
// ---------------------------------------------------------------
function readSafe() {
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

function layout() {
  // body の大きさ基準（通常は画面全体。埋め込み先で余白がある場合も収まる）
  const vw = document.body.clientWidth || window.innerWidth;
  const vh = document.body.clientHeight || window.innerHeight;
  const landscapeMobile = coarse && vw > vh;
  ui.setRotate(landscapeMobile);
  if (landscapeMobile && game.mode === 'play') game.setPaused(true);
  const w = Math.min(vw, Math.round((vh * 9) / 16));
  app.style.width = w + 'px';
  app.style.height = vh + 'px';
  game.resize(w, vh, dpr, readSafe());
  input.reset(); // 画面回転・リサイズ時は入力状態を初期化
}

let layoutQueued = false;
function queueLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    layout();
  });
}
window.addEventListener('resize', queueLayout);
window.addEventListener('orientationchange', () => setTimeout(layout, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', queueLayout);

// ---------------------------------------------------------------
//  スクロール・拡大の抑止（スマホでの誤操作防止）
// ---------------------------------------------------------------
document.addEventListener('touchmove', (e) => {
  if (!e.target.closest || !e.target.closest('.screen')) e.preventDefault();
}, { passive: false });
for (const el of [canvas, document.getElementById('btn-slash')]) {
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// 最初のユーザー操作でオーディオを有効化（iOS対策）
const unlock = () => audio.unlock();
for (const ev of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(ev, unlock, { passive: true });

// ---------------------------------------------------------------
//  画面遷移
// ---------------------------------------------------------------
const actions = {
  start() {
    audio.unlock();
    game.startRun();
  },
  retry() {
    audio.unlock();
    game.startRun();
  },
  title() {
    game.toTitle();
  },
  pause() {
    game.setPaused(true);
  },
  resume() {
    audio.unlock();
    game.setPaused(false);
  },
  quit() {
    game.toTitle();
  },
};
ui.bind(actions);

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.mode === 'play') game.setPaused(!game.paused);
    return;
  }
  if (e.code === 'Enter' || e.code === 'Space') {
    if (ui.isTitle()) {
      e.preventDefault();
      actions.start();
    } else if (ui.isResult() && ui.retryArmed()) {
      e.preventDefault();
      actions.retry();
    } else if (game.paused) {
      e.preventDefault();
      actions.resume();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (game.mode === 'play') game.setPaused(true);
    audio.suspend();
  } else if (!game.paused) {
    audio.resume();
  }
});

// ---------------------------------------------------------------
//  メインループ（重い端末では内部解像度を自動で下げる）
// ---------------------------------------------------------------
let last = performance.now();
let ema = 1 / 60;
let slowT = 0;
let dbgT = 0;
let frames = 0;

function loop(now) {
  const raw = Math.max(0, (now - last) / 1000);
  last = now;
  const dt = Math.min(raw, 1 / 30);
  game.frame(dt);

  ema = ema * 0.94 + Math.min(raw, 0.1) * 0.06;
  if (game.mode === 'play' && !game.paused && ema > 1 / 45 && dpr > 1) {
    slowT += raw;
    if (slowT > 2) {
      dpr = Math.max(1, dpr - 0.25);
      game.resize(game.cssW, game.cssH, dpr);
      slowT = 0;
    }
  } else slowT = 0;

  if (DEBUG) {
    frames++;
    dbgT += raw;
    if (dbgT >= 0.5) {
      debugEl.textContent = `FPS ${Math.round(frames / dbgT)} | DPR ${dpr} | 敵 ${game.enemies.length} | 粒子 ${game.fx.parts.length} | 連鎖待ち ${game.queue.length}`;
      frames = 0;
      dbgT = 0;
    }
  }
  requestAnimationFrame(loop);
}

if (DEBUG) debugEl.classList.remove('hidden');
layout();
game.startDemo();
ui.showTitle();
requestAnimationFrame(loop);

// テスト・調整用にコンソールから参照できるようにする
window.__chainSlash = { game, audio, store, CFG };

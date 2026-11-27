// =====================================================================
//  サウンド：Web Audio API でSEとBGMをすべてコード生成（素材ファイル不要）
//  ・最初のユーザー操作で AudioContext を開始（iOS対策）
//  ・時間停止中はBGMにローパスをかけて「こもらせる」
//  ・連鎖ごとに音程が上がるブリップ音で連鎖の気持ちよさを強調
// =====================================================================
import { clamp } from './utils.js';

const BPM = 132;
const STEP = 60 / BPM / 4; // 16分音符
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Am - F - G - E
const CHORDS = [
  { bass: 33, pad: [57, 60, 64], arp: [69, 72, 76, 81] },
  { bass: 29, pad: [53, 57, 60], arp: [65, 69, 72, 77] },
  { bass: 31, pad: [55, 59, 62], arp: [67, 71, 74, 79] },
  { bass: 28, pad: [52, 56, 59], arp: [64, 68, 71, 76] },
];
const ARP = [0, 1, 2, 3, 2, 1, 0, 1, 0, 1, 2, 3, 2, 3, 1, 2];
const PENTA = [0, 3, 5, 7, 10];

export class AudioEngine {
  constructor(store) {
    this.store = store;
    this.ctx = null;
    this.on = !!store.data.sound;
    this.sfxMuted = false; // デモ（タイトル背景）中は効果音を鳴らさない
    this.level = 0;
    this.wantMusic = null;
    this.seq = null;
    this._last = Object.create(null);
    this._unlocked = false;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        try { this.ctx = new AC(); } catch { return; }
      }
      this._build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (!this._unlocked) {
      this._unlocked = true;
      try {
        const b = this.ctx.createBuffer(1, 1, 22050);
        const s = this.ctx.createBufferSource();
        s.buffer = b;
        s.connect(this.ctx.destination);
        s.start(0);
      } catch { /* noop */ }
      if (this.wantMusic !== null) this.startMusic(this.wantMusic);
    }
  }

  _build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.on ? 0.9 : 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(c.destination);

    this.sfx = c.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);

    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000;
    this.musicFilter.Q.value = 0.8;
    this.music = c.createGain();
    this.music.gain.value = 0.32;
    this.music.connect(this.musicFilter);
    this.musicFilter.connect(this.master);

    // ブリップ用のディレイ
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 1;
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.17;
    const fb = c.createGain();
    fb.gain.value = 0.32;
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.delaySend.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.sfx);

    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setSound(on) {
    this.on = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.02);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.ctx && this._unlocked && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // ---------------- 低レベル ----------------
  _gate(name, gap = 0) {
    if (!this.ready || !this.on || this.sfxMuted) return false;
    const t = this.ctx.currentTime;
    const last = this._last[name];
    if (gap && last !== undefined && t - last < gap) return false;
    this._last[name] = t;
    return true;
  }

  _out(pan) {
    if (pan == null || !this.ctx.createStereoPanner) return this.sfx;
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1) * 0.6;
    p.connect(this.sfx);
    setTimeout(() => { try { p.disconnect(); } catch { /* noop */ } }, 2500);
    return p;
  }

  _tone(type, f0, f1, t, dur, peak, out, attack = 0.004, detune = 0) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    o.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.03);
    return o;
  }

  _noise(t, dur, peak, out, ftype, f0, f1, q = 1, attack = 0.002) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = ftype;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + attack + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    s.connect(f);
    f.connect(g);
    g.connect(out);
    s.start(t, Math.random() * 0.8);
    s.stop(t + attack + dur + 0.03);
  }

  // ---------------- 効果音 ----------------
  ui() {
    if (!this._gate('ui', 0.04)) return;
    const t = this.ctx.currentTime;
    this._tone('triangle', 880, 1320, t, 0.06, 0.12, this.sfx);
  }

  gaugeReady() {
    if (!this._gate('ready', 0.3)) return;
    const t = this.ctx.currentTime;
    this._tone('triangle', 1318.5, 1318.5, t, 0.12, 0.12, this.sfx);
    this._tone('triangle', 1760, 1760, t + 0.07, 0.22, 0.12, this.sfx);
    this._tone('sine', 3520, 3500, t + 0.07, 0.4, 0.03, this.sfx);
  }

  timeStopIn() {
    if (!this._gate('tsin', 0.1)) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 900, 70, t, 0.4, 0.28, this.sfx);
    this._noise(t, 0.45, 0.18, this.sfx, 'bandpass', 3500, 250, 1.2, 0.02);
    this._tone('sine', 55, 40, t, 0.6, 0.35, this.sfx, 0.01);
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(380, t, 0.05);
    this.music.gain.setTargetAtTime(0.22, t, 0.05);
  }

  timeStopOut() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(18000, t, 0.12);
    this.music.gain.setTargetAtTime(0.32, t, 0.1);
  }

  aimTick(n) {
    if (!this._gate('aimtick', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone('square', 1400 + Math.min(n, 20) * 70, 0, t, 0.025, 0.035, this.sfx, 0.001);
  }

  release() {
    if (!this._gate('release', 0.05)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.18, 0.9, this.sfx, 'bandpass', 700, 8000, 0.6, 0.004);
    this._tone('sawtooth', 220, 1600, t, 0.1, 0.08, this.sfx);
    this._tone('sine', 1200, 3400, t, 0.14, 0.12, this.sfx, 0.003);
  }

  cutMark(i) {
    if (!this._gate('cut', 0.012)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.03, 0.35, this.sfx, 'highpass', 5000, 5000, 0.7);
    this._tone('sine', 2600 + i * 90, 2400, t, 0.05, 0.12, this.sfx, 0.001);
  }

  flash(n) {
    if (!this._gate('flash', 0.05)) return;
    const t = this.ctx.currentTime;
    const big = Math.min(1, 0.55 + n * 0.05);
    this._noise(t, 0.42, 0.6 * big, this.sfx, 'lowpass', 9000, 280, 0.7, 0.002);
    this._tone('sine', 170, 34, t, 0.5, 0.85 * big, this.sfx);
    this._tone('triangle', 95, 40, t, 0.32, 0.3 * big, this.sfx);
    [2637, 3520, 4699].forEach((f, i) => this._tone('sine', f, f * 0.996, t + 0.004 * i, 0.9 + i * 0.25, 0.045, this.sfx, 0.002));
  }

  explode(pan) {
    if (!this._gate('explode', 0.045)) return;
    const t = this.ctx.currentTime;
    const o = this._out(pan);
    this._noise(t, 0.55, 0.5, o, 'lowpass', 2400, 110, 0.9, 0.003);
    this._tone('sine', 120, 32, t, 0.38, 0.55, o);
  }

  zap(pan) {
    if (!this._gate('zap', 0.035)) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = this._out(pan);
    const o = c.createOscillator();
    o.type = 'square';
    for (let i = 0; i < 10; i++) o.frequency.setValueAtTime(300 + Math.random() * 1800, t + i * 0.013);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    o.connect(hp);
    hp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.17);
    this._noise(t, 0.09, 0.3, out, 'bandpass', 6000, 3000, 1.5);
  }

  // 分裂型：鋭い金属音が四方へ散る
  split(pan) {
    if (!this._gate('split', 0.04)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    this._noise(t, 0.12, 0.3, out, 'highpass', 3000, 9000, 0.8, 0.002);
    this._tone('square', 1800, 600, t, 0.12, 0.07, out, 0.002);
    this._tone('triangle', 2400, 900, t + 0.02, 0.1, 0.06, out, 0.002);
  }

  // 吸引型：吸い込むうなり（上昇スウィープ）
  vortex(pan) {
    if (!this._gate('vortex', 0.08)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    this._tone('sawtooth', 70, 420, t, 0.42, 0.1, out, 0.05);
    this._tone('sine', 110, 660, t, 0.42, 0.18, out, 0.05);
    this._noise(t, 0.42, 0.22, out, 'bandpass', 300, 3000, 2, 0.08);
  }

  // かすり：鋭い「チッ」。続けてかすると音程が上がる
  graze(streak, pan) {
    if (!this._gate('graze', 0.03)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    const f = 1800 * Math.pow(2, Math.min(streak - 1, 12) / 12);
    this._noise(t, 0.035, 0.28, out, 'highpass', 6000, 9000, 0.8, 0.001);
    this._tone('sine', f, f * 1.25, t, 0.07, 0.07, out, 0.001);
  }

  // 一掃：重い一撃＋きらびやかな上昇和音
  perfect() {
    if (!this._gate('perfect', 0.5)) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 150, 32, t, 0.7, 0.8, this.sfx, 0.004);
    this._noise(t, 0.6, 0.35, this.sfx, 'lowpass', 6000, 300, 0.7, 0.003);
    [69, 73, 76, 81, 85, 88].forEach((m, i) => {
      this._tone('sawtooth', mtof(m), mtof(m), t + 0.05 + i * 0.05, 0.5, 0.045, this.sfx, 0.005, i % 2 ? 6 : -6);
      this._tone('sine', mtof(m + 12), mtof(m + 12), t + 0.05 + i * 0.05, 0.7, 0.05, this.delaySend, 0.004);
    });
    this._noise(t + 0.1, 0.9, 0.08, this.sfx, 'highpass', 9000, 12000, 0.5, 0.05);
  }

  // 連鎖の得点がスコアに入る瞬間：低音の一撃＋上昇アルペジオ（大きいほど豪華）
  bank(combo) {
    if (!this._gate('bank', 0.12)) return;
    const t = this.ctx.currentTime;
    const big = Math.min(1, 0.35 + combo / 80);
    this._tone('sine', 90, 45, t, 0.35, 0.55 * big, this.sfx, 0.004);
    this._noise(t, 0.12, 0.18 * big, this.sfx, 'highpass', 6000, 9000, 0.7, 0.002);
    const steps = combo >= 50 ? [0, 4, 7, 12, 16] : combo >= 20 ? [0, 4, 7, 12] : [0, 7];
    steps.forEach((s, i) => {
      const f = mtof(76 + s);
      this._tone('triangle', f, f, t + i * 0.045, 0.22, 0.11, this.sfx, 0.003);
      this._tone('sine', f * 2, f * 2, t + i * 0.045, 0.25, 0.04, this.delaySend, 0.003);
    });
  }

  // 連鎖数に応じて音程が上がる
  blip(combo, pan) {
    if (!this._gate('blip', 0.014)) return;
    let i = Math.max(0, combo - 1);
    if (i >= 15) i = 5 + ((i - 5) % 10);
    const semis = PENTA[i % 5] + 12 * Math.floor(i / 5);
    const f = mtof(64 + semis);
    const t = this.ctx.currentTime;
    const out = this._out(pan);
    this._tone('triangle', f, f, t, 0.14, 0.3, out, 0.002);
    this._tone('sine', f * 2, f * 2, t, 0.09, 0.12, out, 0.002);
    this._tone('sine', f * 2, f * 2, t, 0.1, 0.08, this.delaySend, 0.002);
  }

  tier(level) {
    if (!this._gate('tier', 0.1)) return;
    const t = this.ctx.currentTime;
    const base = 69 + Math.min(level, 5) * 2;
    [0, 4, 7, 12].forEach((s, i) => {
      this._tone('sawtooth', mtof(base + s), mtof(base + s), t + i * 0.035, 0.35, 0.05, this.sfx, 0.005, i % 2 ? 7 : -7);
      this._tone('sine', mtof(base + s + 12), mtof(base + s + 12), t + i * 0.035, 0.5, 0.04, this.delaySend, 0.005);
    });
    this._noise(t, 0.5, 0.08, this.sfx, 'highpass', 8000, 12000, 0.5, 0.02);
  }

  hurt() {
    if (!this._gate('hurt', 0.1)) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 200, 50, t, 0.32, 0.32, this.sfx);
    this._tone('square', 90, 40, t, 0.25, 0.18, this.sfx);
    this._noise(t, 0.2, 0.3, this.sfx, 'lowpass', 1800, 200, 1);
  }

  dead() {
    if (!this._gate('dead', 0.2)) return;
    const t = this.ctx.currentTime;
    this._noise(t, 1.2, 0.6, this.sfx, 'lowpass', 4000, 80, 0.8);
    this._tone('sine', 140, 28, t, 1.1, 0.8, this.sfx);
    this._tone('sawtooth', 440, 55, t, 0.9, 0.08, this.sfx);
  }

  countdown(last) {
    if (!this._gate('count', 0.3)) return;
    const t = this.ctx.currentTime;
    this._tone('square', last ? 1760 : 1046.5, 0, t, 0.06, 0.05, this.sfx, 0.001);
  }

  finish() {
    if (!this._gate('finish', 0.5)) return;
    const t = this.ctx.currentTime;
    [220, 329.6, 440 * 1.004, 659.3].forEach((f, i) => this._tone('sine', f, f, t, 1.6 - i * 0.2, 0.12, this.sfx, 0.004));
    this._noise(t, 0.6, 0.3, this.sfx, 'bandpass', 3000, 600, 0.8);
  }

  pop() {
    if (!this._gate('pop', 0.03)) return;
    const t = this.ctx.currentTime;
    this._tone('sine', 700 + Math.random() * 500, 200, t, 0.08, 0.06, this.sfx, 0.002);
  }

  warn() {
    if (!this._gate('warn', 0.4)) return;
    const t = this.ctx.currentTime;
    this._tone('square', 660, 660, t, 0.07, 0.04, this.sfx, 0.002);
    this._tone('square', 660, 660, t + 0.12, 0.07, 0.04, this.sfx, 0.002);
  }

  rush() {
    if (!this._gate('rush', 1)) return;
    const t = this.ctx.currentTime;
    this._tone('sawtooth', 110, 440, t, 0.7, 0.12, this.sfx, 0.02);
    this._tone('sawtooth', 112, 445, t, 0.7, 0.12, this.sfx, 0.02);
    this._noise(t, 0.8, 0.2, this.sfx, 'bandpass', 400, 6000, 1, 0.1);
  }

  scoreTick() {
    if (!this._gate('stick', 0.045)) return;
    const t = this.ctx.currentTime;
    this._tone('square', 2200, 0, t, 0.018, 0.03, this.sfx, 0.001);
  }

  record() {
    if (!this._gate('record', 0.5)) return;
    const t = this.ctx.currentTime;
    [81, 85, 88, 93].forEach((m, i) => {
      this._tone('triangle', mtof(m), mtof(m), t + i * 0.08, 0.35, 0.12, this.sfx, 0.003);
      this._tone('sine', mtof(m + 12), mtof(m + 12), t + i * 0.08, 0.4, 0.04, this.delaySend, 0.003);
    });
  }

  // ---------------- BGM ----------------
  startMusic(level) {
    this.level = level;
    if (!this.ctx || !this._unlocked) {
      this.wantMusic = level;
      return;
    }
    this.wantMusic = level;
    if (!this.seq) {
      this.step = 0;
      this.nextT = this.ctx.currentTime + 0.08;
      this.seq = setInterval(() => this._sched(), 25);
    }
  }

  setMusicLevel(level) {
    this.level = level;
    this.wantMusic = level;
  }

  restartBar() {
    if (this.ctx) {
      this.step = 0;
      this.nextT = this.ctx.currentTime + 0.06;
    }
  }

  _sched() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (this.nextT < now - 0.2) this.nextT = now + 0.05;
    while (this.nextT < now + 0.12) {
      this._playStep(this.step, this.nextT);
      this.nextT += STEP;
      this.step = (this.step + 1) % 64;
    }
  }

  _playStep(s, t) {
    const L = this.level;
    const ch = CHORDS[(s >> 4) & 3];
    const i = s & 15;
    if (L <= 0) {
      if (i === 0) this._pad(ch.pad, t, STEP * 16, 0.045);
      if (i % 2 === 0) this._pluck(mtof(ch.arp[ARP[i]]), t, 0.03);
      if (i === 0 || i === 10) this._kick(t, 0.3);
      return;
    }
    if (i % 4 === 0) this._kick(t, 0.75);
    if (L >= 3 && i === 14) this._kick(t, 0.55);
    if (i % 2 === 0) this._bass(mtof(i % 8 === 4 ? ch.bass + 12 : ch.bass), t, 1);
    if (L >= 3 && i % 2 === 1) this._bass(mtof(ch.bass + 12), t, 0.45);
    if (L >= 3) this._hat(t, i % 2 === 0 ? 0.09 : 0.05);
    else if (L >= 2) this._hat(t, i % 4 === 2 ? 0.1 : 0.04);
    else if (i % 4 === 2) this._hat(t, 0.09);
    if (L >= 2 && (i === 4 || i === 12)) this._snare(t);
    if (L >= 2) this._pluck(mtof(ch.arp[ARP[i]]), t, L >= 3 ? 0.045 : 0.032);
    if (i === 0) this._pad(ch.pad, t, STEP * 16, L >= 2 ? 0.022 : 0.03);
  }

  _kick(t, v) {
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.32);
  }

  _snare(t) {
    this._noise(t, 0.16, 0.32, this.music, 'bandpass', 1900, 1500, 0.8, 0.001);
    this._tone('triangle', 220, 140, t, 0.08, 0.16, this.music, 0.001);
  }

  _hat(t, v) {
    this._noise(t, 0.035, v, this.music, 'highpass', 7500, 7500, 0.7, 0.001);
  }

  _bass(f, t, v) {
    const c = this.ctx;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.frequency.value = f;
    o2.frequency.value = f;
    o2.detune.value = -8;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 5;
    lp.frequency.setValueAtTime(1500, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o1.connect(lp);
    o2.connect(lp);
    lp.connect(g);
    g.connect(this.music);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 0.22);
    o2.stop(t + 0.22);
  }

  _pluck(f, t, v) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    o.connect(lp);
    lp.connect(g);
    g.connect(this.music);
    o.start(t);
    o.stop(t + 0.13);
  }

  _pad(notes, t, dur, v) {
    const c = this.ctx;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.35);
    g.gain.setValueAtTime(v, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(this.music);
    for (const m of notes) {
      for (const dt of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = dt;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
    }
  }
}

// =====================================================================
//  敵：種類ごとのスプライト生成・移動（追跡＋分離）・描画
//  色だけに頼らず形でも識別できるようにする
//    通常型 = 矢じり / 爆弾型 = トゲ付きの球 / 雷撃型 = 稲妻マークの六角形
// =====================================================================
import { ENEMY } from './config.js';
import { TAU, rand, clamp, easeOutBack } from './utils.js';
import { glowSprite } from './effects.js';

const RES = 3; // スプライトの内部解像度倍率
const cache = { normal: [null, null], bomb: [null, null], thunder: [null, null], splitter: [null, null], vortex: [null, null] };

function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function pathNormal(g, r) {
  g.beginPath();
  g.moveTo(r * 1.35, 0);
  g.lineTo(-r * 0.95, r * 0.98);
  g.lineTo(-r * 0.42, 0);
  g.lineTo(-r * 0.95, -r * 0.98);
  g.closePath();
}

function pathHex(g, r) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * TAU;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

function paint(g, kind, r, hl) {
  const edge = hl ? '#ffffff' : null;
  g.lineJoin = 'round';
  if (kind === 'normal') {
    g.save();
    g.shadowColor = hl ? '#ffffff' : '#ff1f55';
    g.shadowBlur = hl ? 14 : 11;
    const gr = g.createLinearGradient(-r, 0, r * 1.35, 0);
    gr.addColorStop(0, '#5c0a22');
    gr.addColorStop(0.55, '#ff2d63');
    gr.addColorStop(1, '#ffc2d2');
    pathNormal(g, r);
    g.fillStyle = gr;
    g.fill();
    g.restore();
    pathNormal(g, r);
    g.lineWidth = hl ? 2.6 : 1.4;
    g.strokeStyle = edge || '#ffb0c4';
    g.stroke();
    g.beginPath();
    g.arc(r * 0.28, 0, r * 0.2, 0, TAU);
    g.fillStyle = '#fff';
    g.fill();
  } else if (kind === 'bomb') {
    g.save();
    g.shadowColor = hl ? '#ffffff' : '#ff8a00';
    g.shadowBlur = hl ? 16 : 13;
    g.fillStyle = hl ? '#fff4d8' : '#ffcf6e';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.beginPath();
      g.moveTo(Math.cos(a - 0.24) * r * 0.78, Math.sin(a - 0.24) * r * 0.78);
      g.lineTo(Math.cos(a) * r * 1.2, Math.sin(a) * r * 1.2);
      g.lineTo(Math.cos(a + 0.24) * r * 0.78, Math.sin(a + 0.24) * r * 0.78);
      g.closePath();
      g.fill();
    }
    const gr = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r * 0.9);
    gr.addColorStop(0, '#ffe7a3');
    gr.addColorStop(0.45, '#ff9a1f');
    gr.addColorStop(1, '#8a3000');
    g.beginPath();
    g.arc(0, 0, r * 0.86, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(0, 0, r * 0.86, 0, TAU);
    g.lineWidth = hl ? 2.6 : 1.4;
    g.strokeStyle = edge || '#ffd89a';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.47, 0, TAU);
    g.lineWidth = 2.2;
    g.strokeStyle = 'rgba(60,18,0,0.85)';
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.24, 0, TAU);
    g.fillStyle = '#fff6d6';
    g.fill();
  } else if (kind === 'splitter') {
    // 分裂型：十字に割れる手裏剣形（4枚の刃の間にすき間）
    g.save();
    g.shadowColor = hl ? '#ffffff' : '#6dff2a';
    g.shadowBlur = hl ? 16 : 13;
    const gr = g.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.1);
    gr.addColorStop(0, '#f2ffd6');
    gr.addColorStop(0.5, '#9dff5c');
    gr.addColorStop(1, '#2f7a12');
    g.fillStyle = gr;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      g.beginPath();
      g.moveTo(r * 0.22, -r * 0.16);
      g.lineTo(r * 1.15, 0);
      g.lineTo(r * 0.22, r * 0.16);
      g.lineTo(r * 0.12, r * 0.55);
      g.lineTo(r * 0.55, r * 0.12);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.restore();
    g.strokeStyle = edge || '#e2ffc4';
    g.lineWidth = hl ? 2.2 : 1.2;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.rotate((i * Math.PI) / 2);
      g.beginPath();
      g.moveTo(r * 0.22, -r * 0.16);
      g.lineTo(r * 1.15, 0);
      g.lineTo(r * 0.22, r * 0.16);
      g.stroke();
      g.restore();
    }
    g.beginPath();
    g.arc(0, 0, r * 0.26, 0, TAU);
    g.fillStyle = '#16350a';
    g.fill();
    g.beginPath();
    g.arc(0, 0, r * 0.13, 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
  } else if (kind === 'vortex') {
    // 吸引型：渦巻きの腕を持つ球
    g.save();
    g.shadowColor = hl ? '#ffffff' : '#a64dff';
    g.shadowBlur = hl ? 18 : 15;
    const gr = g.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.25, '#e3c2ff');
    gr.addColorStop(0.6, '#8a3df0');
    gr.addColorStop(1, '#2a0b5c');
    g.beginPath();
    g.arc(0, 0, r * 0.92, 0, TAU);
    g.fillStyle = gr;
    g.fill();
    g.restore();
    g.beginPath();
    g.arc(0, 0, r * 0.92, 0, TAU);
    g.lineWidth = hl ? 2.6 : 1.4;
    g.strokeStyle = edge || '#e9d4ff';
    g.stroke();
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(30,6,70,0.85)';
    g.lineWidth = 2.2;
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * TAU) / 3);
      g.beginPath();
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const a = t * 2.4;
        const rr = r * (0.2 + 0.68 * t);
        const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
    }
  } else {
    g.save();
    g.shadowColor = hl ? '#ffffff' : '#22c8ff';
    g.shadowBlur = hl ? 16 : 13;
    const gr = g.createLinearGradient(0, -r, 0, r);
    gr.addColorStop(0, '#46e3ff');
    gr.addColorStop(1, '#0b3a80');
    pathHex(g, r);
    g.fillStyle = gr;
    g.fill();
    g.restore();
    pathHex(g, r);
    g.lineWidth = hl ? 2.6 : 1.5;
    g.strokeStyle = edge || '#b4f4ff';
    g.stroke();
    g.beginPath();
    g.moveTo(r * 0.2, -r * 0.7);
    g.lineTo(-r * 0.38, r * 0.1);
    g.lineTo(-r * 0.02, r * 0.1);
    g.lineTo(-r * 0.22, r * 0.7);
    g.lineTo(r * 0.4, -r * 0.12);
    g.lineTo(r * 0.05, -r * 0.12);
    g.closePath();
    g.fillStyle = '#fffbd0';
    g.fill();
  }
}

// 種類ごとのスプライト（hl = 斬撃対象などの強調版）
export function getSprite(kind, hl = false) {
  const slot = cache[kind];
  const i = hl ? 1 : 0;
  let s = slot[i];
  if (s) return s;
  const r = ENEMY[kind].r;
  const size = r * 2 + 30;
  const c = mkCanvas(Math.ceil(size * RES), Math.ceil(size * RES));
  const g = c.getContext('2d');
  g.scale(RES, RES);
  g.translate(size / 2, size / 2);
  paint(g, kind, r, hl);
  s = { canvas: c, size };
  slot[i] = s;
  return s;
}

let nextId = 1;
export class Enemy {
  constructor(kind, x, y, speedMul = 1) {
    const T = ENEMY[kind];
    this.id = nextId++;
    this.kind = kind;
    this.r = T.r;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.speed = T.speed * speedMul * rand(0.9, 1.12);
    this.angle = rand(0, TAU);
    this.alive = true;
    this.state = 'alive'; // alive | cut（斬られて閃光待ち） | doomed（連鎖で撃破予定）
    this.spawnT = 0;
    this.stun = 0;
    this.phase = rand(0, TAU);
    this.cutAngle = 0;
    this.cutOrder = 0;
  }
  get harmful() {
    return this.state === 'alive' && this.spawnT > 0.35;
  }
}

// 空間分割グリッド（近傍探索の負荷を抑える）
export class EnemyGrid {
  constructor() {
    this.cell = 40;
    this.pad = 240;
    this.cols = 1;
    this.rows = 1;
    this.cells = [[]];
  }
  resize(W, H) {
    this.cols = Math.ceil((W + this.pad * 2) / this.cell);
    this.rows = Math.ceil((H + this.pad * 2) / this.cell);
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }
  _cx(x) {
    return clamp(Math.floor((x + this.pad) / this.cell), 0, this.cols - 1);
  }
  _cy(y) {
    return clamp(Math.floor((y + this.pad) / this.cell), 0, this.rows - 1);
  }
  build(list) {
    for (const c of this.cells) c.length = 0;
    for (const e of list) {
      if (!e.alive) continue;
      this.cells[this._cy(e.y) * this.cols + this._cx(e.x)].push(e);
    }
  }
  near(x, y, r, out) {
    out.length = 0;
    const x0 = this._cx(x - r), x1 = this._cx(x + r);
    const y0 = this._cy(y - r), y1 = this._cy(y + r);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) out.push(cell[i]);
      }
    }
    return out;
  }
}

const tmp = [];
export function updateEnemies(list, dt, px, py, time, grid) {
  if (dt <= 0) return;
  grid.build(list);
  for (const e of list) {
    if (!e.alive) continue;
    e.spawnT += dt;
    if (e.state !== 'alive') continue;

    if (e.stun > 0) {
      e.stun -= dt;
      const f = Math.exp(-4 * dt);
      e.vx *= f;
      e.vy *= f;
    } else {
      const dx = px - e.x, dy = py - e.y;
      const d = Math.hypot(dx, dy) || 1;
      let ux = dx / d, uy = dy / d;
      if (e.kind === 'thunder') {
        // 雷撃型は左右に揺れながら接近
        const w = Math.sin(time * 2.4 + e.phase) * 0.6;
        const nx = ux - uy * w, ny = uy + ux * w;
        const m = Math.hypot(nx, ny) || 1;
        ux = nx / m;
        uy = ny / m;
      }
      const sp = e.speed * (e.spawnT < 0.4 ? 0.35 : 1);
      const k = Math.min(1, dt * 3.2);
      e.vx += (ux * sp - e.vx) * k;
      e.vy += (uy * sp - e.vy) * k;
    }

    // 分離（重なり防止）
    let sx = 0, sy = 0;
    const near = grid.near(e.x, e.y, 30, tmp);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === e) continue;
      const dx = e.x - o.x, dy = e.y - o.y;
      const min = (e.r + o.r) * 1.06;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const push = (min - d) / min;
        sx += (dx / d) * push;
        sy += (dy / d) * push;
      }
    }
    e.x += (e.vx + sx * 95) * dt;
    e.y += (e.vy + sy * 95) * dt;

    if (e.kind === 'normal') {
      if (e.vx * e.vx + e.vy * e.vy > 4) e.angle = Math.atan2(e.vy, e.vx);
    } else if (e.kind === 'bomb') e.angle += dt * 1.1;
    else if (e.kind === 'splitter') e.angle += dt * 0.9;
    else if (e.kind === 'vortex') e.angle -= dt * 3.2;
    else e.angle = Math.sin(time * 1.6 + e.phase) * 0.22;
  }
}

export function drawEnemies(ctx, list, time) {
  for (const e of list) {
    if (!e.alive) continue;
    const spr = getSprite(e.kind, e.state !== 'alive');
    let sc = 1;
    if (e.spawnT < 0.4) sc = Math.max(0.05, easeOutBack(e.spawnT / 0.4));
    if (e.kind === 'bomb') sc *= 1 + Math.sin(time * 9 + e.phase) * 0.045;
    if (e.state === 'doomed') sc *= 1.15;
    const s = spr.size * sc;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    ctx.drawImage(spr.canvas, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
}

// 加算合成のレイヤー：爆弾のコア発光・斬られた敵の切れ目
export function drawEnemyGlows(ctx, list, time) {
  const gb = glowSprite('#ffb030');
  for (const e of list) {
    if (!e.alive) continue;
    if (e.kind === 'bomb' && e.spawnT > 0.3) {
      const a = 0.35 + 0.25 * Math.sin(time * 9 + e.phase);
      const s = e.r * 2.6;
      ctx.globalAlpha = a;
      ctx.drawImage(gb, e.x - s / 2, e.y - s / 2, s, s);
    }
    if (e.state === 'cut') {
      const L = e.r * 1.7;
      const c = Math.cos(e.cutAngle) * L, sn = Math.sin(e.cutAngle) * L;
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(e.x - c, e.y - sn);
      ctx.lineTo(e.x + c, e.y + sn);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

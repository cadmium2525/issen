// =====================================================================
//  演出：パーティクル・衝撃波・電撃・斬撃の軌跡・残像・分断片・文字
//  画面揺れ・フラッシュ・ズームパンチもここで管理する
// =====================================================================
import { CFG } from './config.js';
import { TAU, rand, clamp, easeOutBack, easeOutCubic } from './utils.js';

export const FONT_NUM = '"Avenir Next","Arial Black","Segoe UI Black",Roboto,"Helvetica Neue",Arial,sans-serif';
export const FONT_JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",Meiryo,sans-serif';

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// 放射グラデーションの発光スプライト（加算合成で使う）
const glowCache = new Map();
export function glowSprite(hex, core = true) {
  const key = hex + (core ? '' : ':soft');
  let c = glowCache.get(key);
  if (c) return c;
  const s = 128;
  c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const [r, gg, b] = hexToRgb(hex);
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  if (core) {
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.14, `rgba(${r},${gg},${b},0.95)`);
  } else {
    grad.addColorStop(0, `rgba(${r},${gg},${b},0.8)`);
  }
  grad.addColorStop(0.42, `rgba(${r},${gg},${b},0.3)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowCache.set(key, c);
  return c;
}

// 爆発の焦げ跡
let scorch = null;
function scorchSprite() {
  if (scorch) return scorch;
  const s = 96;
  scorch = document.createElement('canvas');
  scorch.width = scorch.height = s;
  const g = scorch.getContext('2d');
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.34)');
  grad.addColorStop(0.6, 'rgba(40,10,0,0.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return scorch;
}

function jagged(x1, y1, x2, y2, amp) {
  const pts = [{ x: x1, y: y1 }];
  const dx = x2 - x1, dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const n = Math.max(3, Math.min(10, Math.round(L / 22)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const o = rand(-amp, amp) * Math.sin(t * Math.PI);
    pts.push({ x: x1 + dx * t + nx * o, y: y1 + dy * t + ny * o });
  }
  pts.push({ x: x2, y: y2 });
  return pts;
}

function strokePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

export class Effects {
  constructor() {
    this.parts = [];
    this.pool = [];
    this.clear();
  }

  clear() {
    for (const p of this.parts) this.pool.push(p);
    this.parts.length = 0;
    this.rings = [];
    this.bolts = [];
    this.beams = [];
    this.trails = [];
    this.ghosts = [];
    this.pieces = [];
    this.texts = [];
    this.decals = [];
    this.stamps = [];
    this.trauma = 0;
    this.flashA = 0;
    this.flashColor = '#ffffff';
    this.zoom = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  // ---------------- 生成 ----------------
  _add(kind, x, y, vx, vy, life, size, color, drag = 3) {
    if (this.parts.length >= CFG.MAX_PARTICLES) return null;
    const p = this.pool.pop() || {};
    p.kind = kind; p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.life = life; p.max = life; p.size = size; p.color = color; p.drag = drag;
    p.rot = rand(0, TAU); p.vr = rand(-12, 12); p.grow = 1;
    this.parts.push(p);
    return p;
  }

  sparks(x, y, n, color, smin, smax, dir = null, spread = TAU, width = 2, life = [0.16, 0.38]) {
    for (let i = 0; i < n; i++) {
      const a = dir === null ? rand(0, TAU) : dir + rand(-spread / 2, spread / 2);
      const s = rand(smin, smax);
      this._add('spark', x, y, Math.cos(a) * s, Math.sin(a) * s, rand(life[0], life[1]), width * rand(0.7, 1.2), color, 4.5);
    }
  }

  embers(x, y, n, color, smin, smax, size = 6) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(smin, smax);
      this._add('ember', x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.35, 0.8), size * rand(0.6, 1.3), color, 2.2);
    }
  }

  shards(x, y, n, color, smin = 90, smax = 260) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(smin, smax);
      this._add('shard', x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), rand(3, 6.5), color, 3);
    }
  }

  flare(x, y, size, color, life = 0.22, grow = 1.5) {
    const p = this._add('flare', x, y, 0, 0, life, size, color, 0);
    if (p) p.grow = grow;
  }

  // real = true のリングは時間停止中も実時間で広がる
  ring(x, y, r0, r1, life, color, width = 4, real = false) {
    this.rings.push({ x, y, r0, r1, life, max: life, color, width, real });
  }

  decal(x, y, r) {
    if (this.decals.length > 40) this.decals.shift();
    this.decals.push({ x, y, r, life: 2.4, max: 2.4 });
  }

  explosion(x, y, R) {
    this.flare(x, y, R * 2.1, '#ff9a2e', 0.32, 1.25);
    this.flare(x, y, R * 0.9, '#fff1c2', 0.13, 1.6);
    this.ring(x, y, R * 0.2, R * 1.04, 0.22, '#ffd27a', 7);
    this.ring(x, y, R * 0.1, R * 0.72, 0.34, '#ff5a1f', 3);
    this.sparks(x, y, 16, '#ffd36b', 260, 620, null, TAU, 2.6);
    this.sparks(x, y, 8, '#ff6a2a', 120, 320, null, TAU, 3);
    this.embers(x, y, 7, '#ff8f3a', 30, 130, 9);
    this.decal(x, y, R * 0.55);
  }

  bolt(x1, y1, x2, y2, color = '#7fe9ff') {
    this.bolts.push({ x1, y1, x2, y2, life: 0.26, max: 0.26, color, pts: jagged(x1, y1, x2, y2, 14), refresh: 0.04 });
    this.flare(x2, y2, 46, color, 0.18, 1.4);
    this.sparks(x2, y2, 7, '#c9f7ff', 140, 360, null, TAU, 1.6);
  }

  // 分裂型の破片：始点から終点へ伸びる光線
  beam(x1, y1, x2, y2, color, grow = 0.2) {
    this.beams.push({ x1, y1, x2, y2, color, grow, t: 0, life: grow + 0.22 });
  }

  slashTrail(pts) {
    this.trails.push({ pts: pts.map((p) => ({ x: p.x, y: p.y })), life: 0.45, max: 0.45 });
  }

  ghost(x, y, ang) {
    if (this.ghosts.length > 60) this.ghosts.shift();
    this.ghosts.push({ x, y, ang, life: 0.24, max: 0.24 });
  }

  // 斬られた敵を2つに分断して飛ばす
  cutPieces(spr, x, y, ang, cutAng) {
    if (this.pieces.length > 90) this.pieces.splice(0, 2);
    for (const side of [-1, 1]) {
      const nx = -Math.sin(cutAng) * side, ny = Math.cos(cutAng) * side;
      const sp = rand(80, 150), fw = rand(-20, 70);
      this.pieces.push({
        spr, x, y, ang, cutAng, side,
        vx: nx * sp + Math.cos(cutAng) * fw,
        vy: ny * sp + Math.sin(cutAng) * fw,
        rot: 0, va: side * rand(2, 6),
        life: 0.6, max: 0.6,
      });
    }
  }

  // 画面座標の文字（コンボ称号・バナー・得点）
  text(str, x, y, o = {}) {
    if (o.replace) this.texts = this.texts.filter((t) => t.tag !== o.replace);
    this.texts.push({
      str, x, y,
      size: o.size || 32, color: o.color || '#ffffff',
      life: o.life || 1.0, max: o.life || 1.0,
      vy: o.vy ?? -20, jp: !!o.jp, tag: o.tag || null,
      pop: o.pop ?? 1, sub: o.sub || null,
    });
  }

  stamp(str) {
    this.stamps.length = 0;
    this.stamps.push({ str, life: 0.55, max: 0.55 });
  }

  shake(a) {
    this.trauma = Math.min(1, this.trauma + a);
  }
  flash(a, color = '#ffffff') {
    if (a >= this.flashA) {
      this.flashA = a;
      this.flashColor = color;
    }
  }
  punch(z) {
    this.zoom = Math.max(this.zoom, z);
  }

  // ---------------- 更新 ----------------
  // 実時間で減衰するもの（ヒットストップ中も動かす）
  updateReal(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.flashA = Math.max(0, this.flashA - dt * 3.2);
    this.zoom *= Math.exp(-dt * 9);
    const s = this.trauma * this.trauma * 16;
    this.shakeX = rand(-1, 1) * s;
    this.shakeY = rand(-1, 1) * s;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.stamps.length - 1; i >= 0; i--) {
      this.stamps[i].life -= dt;
      if (this.stamps[i].life <= 0) this.stamps.splice(i, 1);
    }
  }

  // ゲーム内時間（スロー演出の影響を受ける）で動くもの
  update(dt, k) {
    this.updateReal(dt);
    const d = dt * k;
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= d;
      if (p.life <= 0) {
        this.pool.push(p);
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      const f = Math.exp(-p.drag * d);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.rot += p.vr * d;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= r.real ? dt : d;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.life -= d;
      b.refresh -= d;
      if (b.refresh <= 0) {
        b.refresh = 0.04;
        b.pts = jagged(b.x1, b.y1, b.x2, b.y2, 14);
      }
      if (b.life <= 0) this.bolts.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.t += d;
      if (b.t >= b.life) this.beams.splice(i, 1);
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].life -= dt; // 斬撃の閃光は実時間で消える
      if (this.trails[i].life <= 0) this.trails.splice(i, 1);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.life -= d;
      const f = Math.exp(-2.2 * d);
      p.vx *= f;
      p.vy *= f;
      p.x += p.vx * d;
      p.y += p.vy * d;
      p.rot += p.va * d;
      if (p.life <= 0) this.pieces.splice(i, 1);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= d;
      if (this.decals[i].life <= 0) this.decals.splice(i, 1);
    }
  }

  // ---------------- 描画 ----------------
  drawDecals(ctx) {
    if (!this.decals.length) return;
    const spr = scorchSprite();
    for (const d of this.decals) {
      ctx.globalAlpha = d.life / d.max;
      ctx.drawImage(spr, d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    }
    ctx.globalAlpha = 1;
  }

  drawPieces(ctx) {
    for (const p of this.pieces) {
      const a = clamp(p.life / p.max, 0, 1);
      const s = p.spr.size;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.cutAng + p.rot);
      ctx.beginPath();
      ctx.rect(-s, p.side > 0 ? 0 : -s, s * 2, s);
      ctx.clip();
      ctx.rotate(p.ang - p.cutAng);
      ctx.drawImage(p.spr.canvas, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
    // 破片（通常合成）
    for (const p of this.parts) {
      if (p.kind !== 'shard') continue;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      const c = Math.cos(p.rot) * p.size, s = Math.sin(p.rot) * p.size;
      ctx.beginPath();
      ctx.moveTo(p.x + c, p.y + s);
      ctx.lineTo(p.x - s * 0.6 - c * 0.5, p.y + c * 0.6 - s * 0.5);
      ctx.lineTo(p.x + s * 0.6 - c * 0.5, p.y - c * 0.6 - s * 0.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawGhosts(ctx, drawFn) {
    for (const g of this.ghosts) drawFn(ctx, g.x, g.y, g.ang, (g.life / g.max) * 0.55);
  }

  // 加算合成レイヤー（呼び出し側で globalCompositeOperation = 'lighter' にしておく）
  drawAdditive(ctx) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 斬撃の閃光
    for (const t of this.trails) {
      const a = t.life / t.max;
      const e = easeOutCubic(a);
      ctx.globalAlpha = 0.22 * e;
      ctx.strokeStyle = '#6ff3ff';
      ctx.lineWidth = 34 * e + 4;
      strokePath(ctx, t.pts);
      ctx.globalAlpha = 0.55 * e;
      ctx.lineWidth = 12 * e + 2;
      strokePath(ctx, t.pts);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4 * e + 1;
      strokePath(ctx, t.pts);
    }

    // 衝撃波リング
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * easeOutCubic(t);
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, TAU);
      ctx.stroke();
    }

    // パーティクル
    for (const p of this.parts) {
      const a = clamp(p.life / p.max, 0, 1);
      if (p.kind === 'spark') {
        ctx.globalAlpha = a;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        const k = 0.035;
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * k, p.y - p.vy * k);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      } else if (p.kind === 'ember') {
        ctx.globalAlpha = a;
        const s = p.size;
        ctx.drawImage(glowSprite(p.color, false), p.x - s, p.y - s, s * 2, s * 2);
      } else if (p.kind === 'flare') {
        const t = 1 - a;
        const s = p.size * (1 + (p.grow - 1) * easeOutCubic(t));
        ctx.globalAlpha = a * a;
        ctx.drawImage(glowSprite(p.color), p.x - s / 2, p.y - s / 2, s, s);
      }
    }

    // 分裂型の破片
    for (const b of this.beams) {
      const g = Math.min(1, b.t / b.grow);
      const fade = b.t < b.grow ? 1 : 1 - (b.t - b.grow) / (b.life - b.grow);
      const hx = b.x1 + (b.x2 - b.x1) * g, hy = b.y1 + (b.y2 - b.y1) * g;
      const tail = Math.max(0, g - 0.45);
      const tx = b.x1 + (b.x2 - b.x1) * tail, ty = b.y1 + (b.y2 - b.y1) * tail;
      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (b.t < b.grow) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(glowSprite(b.color), hx - 14, hy - 14, 28, 28);
      }
    }

    // 電撃
    for (const b of this.bolts) {
      const a = b.life / b.max;
      const flick = 0.6 + Math.random() * 0.4;
      ctx.globalAlpha = 0.3 * a * flick;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 10;
      strokePath(ctx, b.pts);
      ctx.globalAlpha = 0.9 * a * flick;
      ctx.lineWidth = 3.2;
      strokePath(ctx, b.pts);
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3;
      strokePath(ctx, b.pts);
    }
    ctx.globalAlpha = 1;
  }

  // 画面座標の文字類
  drawTexts(ctx, W, H) {
    for (const s of this.stamps) {
      const t = 1 - s.life / s.max;
      const sc = 1.25 - 0.25 * easeOutCubic(Math.min(1, t * 3));
      ctx.save();
      ctx.globalAlpha = 0.1 * (1 - t);
      ctx.translate(W / 2, H * 0.46);
      ctx.scale(sc, sc);
      ctx.font = `900 300px ${FONT_JP}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(s.str, 0, 0);
      ctx.restore();
    }
    for (const t of this.texts) {
      const age = t.max - t.life;
      const inT = Math.min(1, age / 0.18);
      const sc = t.pop ? 0.4 + 0.6 * easeOutBack(inT) : 1;
      const a = Math.min(1, t.life / 0.3) * Math.min(1, age / 0.06);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(t.x, t.y);
      ctx.scale(sc, sc);
      ctx.font = `${t.jp ? '' : 'italic '}900 ${t.size}px ${t.jp ? FONT_JP : FONT_NUM}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, t.size * 0.14);
      ctx.strokeStyle = 'rgba(4,4,14,0.85)';
      ctx.strokeText(t.str, 0, 0);
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 18;
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, 0, 0);
      if (t.sub) {
        ctx.shadowBlur = 0;
        ctx.font = `800 ${Math.round(t.size * 0.36)}px ${FONT_JP}`;
        ctx.lineWidth = 4;
        ctx.strokeText(t.sub, 0, t.size * 0.72);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(t.sub, 0, t.size * 0.72);
      }
      ctx.restore();
    }
  }
}

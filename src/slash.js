// =====================================================================
//  斬撃ルート：指の軌跡を「曲がり角2回までの折れ線」に変換する
//  ・自機を起点に、指先までを1本の線でつなぐ
//  ・軌跡が直線から一定以上ずれた点を曲がり角として確定
//  ・総延長は上限でクランプ
// =====================================================================
import { CFG } from './config.js';
import { clamp, segDist, segOut } from './utils.js';

export class Route {
  constructor(bounds) {
    this.bounds = bounds;
    this.anchors = [];
    this.raw = [];
    this.tip = { x: 0, y: 0 };
    this.length = 0;
    this.used = 0;
    this.clamped = false;
  }

  // mode: 'abs' = 指の位置そのまま / 'rel' = ボタンからのドラッグ量を拡大して自機から伸ばす
  begin(ox, oy, fx, fy, mode) {
    this.mode = mode;
    this.origin = { x: ox, y: oy };
    this.fStart = { x: fx, y: fy };
    this.anchors = [{ x: ox, y: oy }];
    this.raw = [];
    this.used = 0;
    const p = this._map(fx, fy);
    if (mode === 'abs' && Math.hypot(p.x - ox, p.y - oy) > CFG.SLASH_START_SNAP) this.raw.push(p);
    this._setTip(p);
  }

  _map(fx, fy) {
    let x = fx, y = fy;
    if (this.mode === 'rel') {
      x = this.origin.x + (fx - this.fStart.x) * CFG.SLASH_REL_GAIN;
      y = this.origin.y + (fy - this.fStart.y) * CFG.SLASH_REL_GAIN;
    }
    const b = this.bounds;
    return { x: clamp(x, b.x0, b.x1), y: clamp(y, b.y0, b.y1) };
  }

  move(fx, fy) {
    const p = this._map(fx, fy);
    const last = this.raw[this.raw.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) this.raw.push(p);
    this._detectCorners(p);
    this._setTip(p);
  }

  get corners() {
    return this.anchors.length - 1;
  }

  _detectCorners(p) {
    for (let guard = 0; guard < 3 && this.corners < CFG.SLASH_MAX_CORNERS; guard++) {
      const A = this.anchors[this.anchors.length - 1];
      let best = -1, bestD = 0;
      for (let i = 0; i < this.raw.length; i++) {
        const q = this.raw[i];
        if (Math.hypot(q.x - A.x, q.y - A.y) < CFG.SLASH_MIN_SEG) continue;
        if (Math.hypot(q.x - p.x, q.y - p.y) < CFG.SLASH_MIN_SEG * 0.6) continue;
        const d = segDist(A.x, A.y, p.x, p.y, q.x, q.y);
        if (d > bestD) { bestD = d; best = i; }
      }
      if (best < 0 || bestD < CFG.SLASH_CORNER_DEV) break;
      const C = this.raw[best];
      const segLen = Math.hypot(C.x - A.x, C.y - A.y);
      if (this.used + segLen > CFG.SLASH_MAX_LEN - CFG.SLASH_MIN_SEG) break; // もう長さが残っていない
      this.anchors.push({ x: C.x, y: C.y });
      this.used += segLen;
      this.raw = this.raw.slice(best + 1);
    }
  }

  _setTip(p) {
    const A = this.anchors[this.anchors.length - 1];
    const dx = p.x - A.x, dy = p.y - A.y;
    const d = Math.hypot(dx, dy);
    const remain = Math.max(0, CFG.SLASH_MAX_LEN - this.used);
    this.clamped = d > remain;
    if (this.clamped && d > 0) this.tip = { x: A.x + (dx / d) * remain, y: A.y + (dy / d) * remain };
    else this.tip = { x: p.x, y: p.y };
    this.length = this.used + Math.min(d, remain);
  }

  points() {
    return [...this.anchors, { x: this.tip.x, y: this.tip.y }];
  }
}

// 折れ線の累積長
export function buildCum(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  return cum;
}

// 折れ線上の位置 s（始点からの距離）にある点と進行方向
export function pointAt(pts, cum, s) {
  for (let i = 1; i < pts.length; i++) {
    if (s <= cum[i] || i === pts.length - 1) {
      const L = cum[i] - cum[i - 1] || 1;
      const t = clamp((s - cum[i - 1]) / L, 0, 1);
      const a = pts[i - 1], b = pts[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }
  }
  return { x: pts[0].x, y: pts[0].y, ang: 0 };
}

// ルートに触れる敵を、ルート上の通過順に返す
export function routeHits(pts, enemies, bladeR) {
  const out = [];
  for (const e of enemies) {
    if (!e.alive || e.state !== 'alive') continue;
    let best = Infinity, bestS = 0, bestSeg = 0, acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const d = segDist(a.x, a.y, b.x, b.y, e.x, e.y);
      if (d < best) { best = d; bestS = acc + segOut.t * L; bestSeg = i; }
      acc += L;
    }
    if (best <= e.r + bladeR) {
      const a = pts[bestSeg], b = pts[bestSeg + 1];
      out.push({ e, s: bestS, ang: Math.atan2(b.y - a.y, b.x - a.x) });
    }
  }
  out.sort((p, q) => p.s - q.s);
  return out;
}

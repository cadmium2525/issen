// 汎用の数学ヘルパー
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

export function angleLerp(a, b, t) {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * t;
}

// 線分ABと点Pの最短距離。射影位置(0..1)は segOut.t に入る（GC削減のため使い回し）
export const segOut = { t: 0 };
export function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  segOut.t = t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return Math.sqrt(qx * qx + qy * qy);
}

// 重み付き抽選 [[value, weight], ...]
export function weighted(list) {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let r = Math.random() * sum;
  for (const [v, w] of list) {
    r -= w;
    if (r <= 0) return v;
  }
  return list[list.length - 1][0];
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');

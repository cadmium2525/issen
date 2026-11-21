// localStorage：自己ベスト・設定を端末内に保存（使えない環境でも動くよう全て try/catch）
const KEY = 'chain-slash/v1';

const DEFAULTS = {
  best: 0,
  bestChain: 0,
  plays: 0,
  sound: true,
  vibe: true,
  tut: { move: false, slash: false, bomb: false, thunder: false },
};

function load() {
  const base = JSON.parse(JSON.stringify(DEFAULTS));
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw);
    return { ...base, ...d, tut: { ...base.tut, ...(d.tut || {}) } };
  } catch {
    return base;
  }
}

export const store = {
  data: load(),
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* 保存できない環境（プライベートモード等）は無視 */
    }
  },
};

// =====================================================================
//  CHAIN SLASH — 調整用パラメータ
//  企画書「12 最初に決める数値」をここに集約。プレイテストで調整する。
// =====================================================================

export const CFG = {
  WORLD_W: 450,            // 論理座標の横幅（縦は画面比率から決まる）
  RUN_TIME: 60,            // 1ラン（秒）
  MAX_HP: 3,               // 3回被弾でゲームオーバー
  INVULN_TIME: 1.4,        // 被弾直後の無敵時間

  PLAYER_R: 11,
  PLAYER_SPEED: 240,
  STICK_RADIUS_PX: 56,     // 仮想スティック半径（CSS px）
  STICK_DEADZONE: 0.12,

  // --- 斬撃 ---
  SLASH_THINK_TIME: 3.0,   // 斬撃思考時間（実時間・最大3秒）
  SLASH_TIME_SCALE: 0.035, // 斬撃モード中の時間の流れ（ほぼ停止）
  SLASH_MAX_LEN: 640,      // ルートの総延長上限
  SLASH_MAX_CORNERS: 2,    // 曲がり角の上限
  SLASH_CORNER_DEV: 20,    // 指の軌跡がこれ以上ずれたら曲がり角を確定
  SLASH_MIN_SEG: 26,       // 1区間の最短長
  SLASH_MIN_LEN: 28,       // これより短いルートは発動しない
  SLASH_BLADE_R: 13,       // 刃の当たり幅
  SLASH_REL_GAIN: 2.0,     // ボタンから直接ドラッグしたときの拡大率
  SLASH_START_SNAP: 64,    // 自機の近くから描き始めたら自機起点とみなす距離
  SLASH_HOLD: 0.13,        // ダッシュ後〜閃光までの「溜め」
  HITSTOP: 0.09,           // 閃光時のヒットストップ（60〜100ms）
  RECOVER_TIME: 0.65,      // 閃光後にスローから通常速度へ戻る時間

  // --- ゲージ ---
  GAUGE_REFILL_TIME: 8,    // 約8秒で自然回復
  GAUGE_PER_KILL: 0.02,    // 連鎖1体あたりの追加回復
  GAUGE_BONUS_CAP: 0.5,    // 1回の斬撃で得られる追加回復の上限（無限連射防止）

  // --- 敵・連鎖 ---
  MAX_ENEMIES: 120,        // 同時敵数の上限（通常時は出現テーブルの cap、RUSH中のみ最大120）
  MAX_CHAIN_EVENTS: 200,   // 1発動あたりの連鎖処理上限
  MAX_CHAIN_GEN: 40,       // 連鎖世代数の上限
  BOMB_RADIUS: 90,         // 爆弾型の爆風半径
  THUNDER_RANGE: 180,      // 雷撃型の伝播距離
  THUNDER_JUMPS: 4,        // 雷撃型の伝播回数

  // --- 描画 ---
  MAX_PARTICLES: 700,
  DPR_MAX: 2,              // Canvas内部解像度の上限
};

// 敵の種類（MVP：3種）
export const ENEMY = {
  normal:  { r: 11, speed: 68, score: 10, color: '#ff3b6b', name: '通常型' },
  bomb:    { r: 14, speed: 50, score: 20, color: '#ffa424', name: '爆弾型' },
  thunder: { r: 13, speed: 60, score: 20, color: '#43d9ff', name: '雷撃型' },
};

// 連鎖倍率：1 + min(連鎖数 ÷ 10, 4)
export const chainMultiplier = (combo) => 1 + Math.min(combo / 10, 4);

// 時間ごとの出現テーブル（間は線形補間。40秒＝残り20秒でラッシュに切り替え）
export const PHASES = [
  { t: 0,     interval: 2.4,  min: 5, max: 7,  bomb: 0.12, thunder: 0.0,  speed: 1.0,  cap: 26 },
  { t: 10,    interval: 2.0,  min: 6, max: 9,  bomb: 0.15, thunder: 0.10, speed: 1.08, cap: 40 },
  { t: 30,    interval: 1.55, min: 7, max: 11, bomb: 0.17, thunder: 0.12, speed: 1.22, cap: 60 },
  { t: 39.99, interval: 1.4,  min: 7, max: 11, bomb: 0.18, thunder: 0.13, speed: 1.27, cap: 64 },
  { t: 40,    interval: 0.6,  min: 11, max: 16, bomb: 0.19, thunder: 0.14, speed: 1.3,  cap: 120 },
  { t: 60,    interval: 0.5,  min: 12, max: 16, bomb: 0.19, thunder: 0.14, speed: 1.5,  cap: 120 },
  { t: 999,   interval: 0.5,  min: 12, max: 16, bomb: 0.19, thunder: 0.14, speed: 1.55, cap: 120 },
];

// 序盤の固定出現（0〜10秒：操作を即理解させる）
export const OPENING = [
  { t: 0.3, formation: 'clump', side: 'top',    n: 7, bombs: 0, thunders: 0 },
  { t: 2.4, formation: 'clump', side: 'left',   n: 8, bombs: 1, thunders: 0 }, // 最初の爆弾型
  { t: 4.8, formation: 'line',  side: 'bottom', n: 6, bombs: 1, thunders: 0 },
  { t: 7.2, formation: 'clump', side: 'right',  n: 9, bombs: 2, thunders: 0 },
  { t: 9.6, formation: 'clump', side: 'top',    n: 9, bombs: 1, thunders: 2 }, // 最初の雷撃型
  // RUSH開始：3方向から大群を一気に投入し、百連鎖を狙える密度を作る
  { t: 40.0, formation: 'clump', side: 'top',   n: 18, bombs: 4, thunders: 2 },
  { t: 40.4, formation: 'clump', side: 'left',  n: 16, bombs: 3, thunders: 2 },
  { t: 40.8, formation: 'clump', side: 'right', n: 16, bombs: 3, thunders: 2 },
];
export const OPENING_END = 10.5;

// 特殊敵の初登場時に敵の頭上へ出す説明ラベル
export const LABELS = {
  bomb:    { title: '爆弾型', sub: '倒すと周囲を爆破！',       color: '#ffa424' },
  thunder: { title: '雷撃型', sub: '倒すと近くへ電撃が連鎖！', color: '#43d9ff' },
};

// 連鎖数の節目で出る称号
export const TIERS = [
  { n: 10,  label: 'NICE!',      color: '#9ff7ff' },
  { n: 20,  label: 'GREAT!',     color: '#7dffb0' },
  { n: 35,  label: 'EXCELLENT!', color: '#ffe36b' },
  { n: 50,  label: 'AMAZING!!',  color: '#ffae42' },
  { n: 75,  label: 'UNREAL!!',   color: '#ff5fa2' },
  { n: 100, label: '百 連 鎖',    color: '#ffffff', jp: true },
];

// リザルトのランク（スコア下限）
export const RANKS = [
  { min: 30000, rank: 'SS', color: '#ffffff' },
  { min: 23000, rank: 'S',  color: '#ffe36b' },
  { min: 16000, rank: 'A',  color: '#ff9f43' },
  { min: 9000,  rank: 'B',  color: '#6ff3ff' },
  { min: 3500,  rank: 'C',  color: '#a5b4ff' },
  { min: 0,     rank: 'D',  color: '#8a8fa8' },
];

export const TIPS = [
  '爆弾型をルートの最初に入れると、爆風が群れごと巻き込む。',
  '雷撃型は離れた群れ同士をつなぐ“橋”になる。',
  '敵が密集するほど一太刀の価値は上がる。ギリギリまで引きつけろ。',
  '大連鎖でゲージが追加回復。つなぐほど次の斬撃が早く撃てる。',
  '曲がり角は2回まで。最初の一手で群れの中心を狙え。',
  '斬撃のダッシュ中は無敵。囲まれたら斬り抜けろ。',
  '連鎖10ごとに得点倍率アップ（最大×5）。',
  '斬ボタンを押したまま引っぱっても斬撃ルートを描ける。',
];

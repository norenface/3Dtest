// マスターデータ（種族・精髄・モンスター・階層・古文書）
// ゲームバランスに関わる数値はここにまとめ、ゲームロジックには書かない。
// アプリ化（Capacitor / Electron）を見越して、JSON を fetch せず JS モジュールとして読み込む。

export const GAME_TITLE = '精髄の迷宮';
export const GAME_SUBTITLE = 'ESSENCE LABYRINTH';

// ------------------------------------------------------------------ 種族
// base: 初期ステータス / growth: レベルアップ時の成長率（Step 3 以降で使用）
export const RACES = {
  barbarian: {
    id: 'barbarian',
    name: 'バーバリアン',
    description: '筋力と耐久に優れた蛮族。魔法の素養はほとんどない。',
    base: { STR: 14, VIT: 13, AGI: 8, INT: 4, MAG: 3, MND: 7 },
    growth: { STR: 1.6, VIT: 1.5, AGI: 0.9, INT: 0.3, MAG: 0.2, MND: 0.7 },
    soulCapacity: 5, // 魂の器（精髄を吸収できる容量）
    passives: ['pain_resistance', 'heavy_build'],
    color: { skin: 0xc68a5e, cloth: 0x6b4a2e, hair: 0x3a2618, weapon: 0x9aa0a6 },
  },
};

// ------------------------------------------------------------------ 派生ステータスの計算式
// ステータスから HP などを求める係数。調整はここで行う。
export const FORMULA = {
  hpBase: 50, hpPerVIT: 6,
  staminaBase: 60, staminaPerVIT: 2, staminaPerAGI: 2,
  attackPerSTR: 1.6,
  moveSpeedBase: 4.0, moveSpeedPerAGI: 0.08,  // m/s
  dashMultiplier: 1.6,
  dashStaminaPerSec: 25,
  attackStamina: 14,
  attackCooldown: 0.45,                       // 秒
  attackRange: 2.4,                           // m
  attackArcDeg: 110,
  staminaRegenPerSec: 20,
  staminaRegenDelay: 0.7,
  flinchTime: 0.35,
  invulnTime: 0.5,
  hitStop: 0.06,
};

// ------------------------------------------------------------------ パッシブ効果
// 種族固有・精髄由来の常時効果。効果の数値もここで管理する。
export const PASSIVES = {
  pain_resistance: { name: '痛覚耐性', description: '被弾時の怯み時間が半分になる。', flinchMultiplier: 0.5 },
  heavy_build: { name: '重量級の体躯', description: '近接攻撃のダメージ +10%。', meleeDamageMultiplier: 1.1 },
  scavenger: { name: '漁り屋', description: '倒した敵の魔石が 1 個増える。', extraStones: 1 },
  swift_feet: { name: '俊足', description: '移動速度 +12%。', moveSpeedMultiplier: 1.12 },
  stone_skin: { name: '岩の皮膚', description: '受けるダメージ -15%。', damageTakenMultiplier: 0.85 },
};

// ------------------------------------------------------------------ アクティブスキル（発動は Step 2 で実装）
export const ACTIVE_SKILLS = {
  quick_stab: { name: '急所突き', description: '素早い突きで大ダメージを与える。', cooldown: 6 },
  feral_howl: { name: '獣の咆哮', description: '周囲の敵を短時間ひるませる。', cooldown: 14 },
  rock_guard: { name: '岩の構え', description: '数秒間、受けるダメージを大きく減らす。', cooldown: 18 },
};

// ------------------------------------------------------------------ 精髄
// rank: 1〜9（数値が小さいほど高ランク） / cost: 魂の器の消費容量
export const ESSENCES = {
  essence_goblin: {
    id: 'essence_goblin',
    name: 'ゴブリンの精髄',
    rank: 9,
    cost: 1,
    statBonus: { AGI: 2, STR: 1 },
    passiveSkill: 'scavenger',
    activeSkill: 'quick_stab',
    color: 0x7ad35a,
  },
  essence_wolf: {
    id: 'essence_wolf',
    name: 'ダイアウルフの精髄',
    rank: 8,
    cost: 2,
    statBonus: { AGI: 4 },
    passiveSkill: 'swift_feet',
    activeSkill: 'feral_howl',
    color: 0x7fb6ff,
  },
  essence_golem: {
    id: 'essence_golem',
    name: 'ストーンゴーレムの精髄',
    rank: 7,
    cost: 3,
    statBonus: { VIT: 5, STR: 2 },
    passiveSkill: 'stone_skin',
    activeSkill: 'rock_guard',
    color: 0xffb347,
  },
};

// ------------------------------------------------------------------ モンスター
// model: game の models.js で使う見た目の種類 / drops: 精髄のドロップ率
export const MONSTERS = {
  goblin: {
    id: 'goblin', name: 'ゴブリン', model: 'goblin',
    hp: 30, attack: 7, defense: 0, speed: 3.0,
    aggroRange: 11, attackRange: 1.6, windup: 0.45, attackCooldown: 1.2,
    radius: 0.45, knockbackResist: 0,
    stones: 1,
    drops: [{ essence: 'essence_goblin', chance: 0.55 }],
  },
  wolf: {
    id: 'wolf', name: 'ダイアウルフ', model: 'wolf',
    hp: 40, attack: 9, defense: 1, speed: 5.0,
    aggroRange: 14, attackRange: 1.9, windup: 0.35, attackCooldown: 1.0,
    radius: 0.55, knockbackResist: 0.2,
    stones: 2,
    drops: [{ essence: 'essence_wolf', chance: 0.45 }],
  },
  golem: {
    id: 'golem', name: 'ストーンゴーレム', model: 'golem',
    hp: 95, attack: 16, defense: 5, speed: 1.7,
    aggroRange: 9, attackRange: 2.2, windup: 0.9, attackCooldown: 2.0,
    radius: 0.85, knockbackResist: 0.8,
    stones: 4,
    drops: [{ essence: 'essence_golem', chance: 0.6 }],
  },
};

// ------------------------------------------------------------------ 階層
// map: 1 文字 = 4m 四方のマス
//   # 壁 / . 床 / S 開始地点 / E 帰還の石碑（出口） / P 柱のある床
//   g ゴブリン / w ダイアウルフ / G ストーンゴーレム（の出現地点。足元は床）
export const TILE_SIZE = 4.0;
export const WALL_HEIGHT = 3.5;

export const FLOORS = [
  {
    id: 1,
    name: '第1層 薄暗い回廊',
    timeLimit: 300, // 秒
    warnAt: 60,     // 残りこの秒数で警告
    timeUpPenalty: { stoneLossRate: 0.5 }, // 時間切れで持ち帰りの魔石が半分になる
    map: [
      '###############',
      '#S..#.....#...#',
      '#...#..g..#.w.#',
      '#.......P.....#',
      '###.#.....#...#',
      '#...###.###.###',
      '#.g...#.#.....#',
      '#..P..#.#..G..#',
      '#.....#...P...#',
      '###.#######.###',
      '#.w...#.....w.#',
      '#.....g..P...E#',
      '###############',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    lighting: { ambient: 0x5a6888, ambientIntensity: 2.6, fog: 0x07080c, torchColor: 0xffa860 },
  },
];

// ------------------------------------------------------------------ 古文書（ゲーム内攻略メモ。閲覧・購入は Step 2 で実装）
export const LORE = [
  { id: 'lore_capacity', title: '魂の器について', price: 30,
    text: '器の容量には限りがある。安い精髄で器を埋めてしまった者は、深層で嘆くことになる。' },
  { id: 'lore_golem', title: '石の巨人', price: 50,
    text: '第1層の奥に棲む石の巨人は動きが鈍い。大振りの後の隙を狙え。その精髄は肉体を岩のように変える。' },
  { id: 'lore_time', title: '崩れる回廊', price: 40,
    text: '回廊は時が満ちると崩れはじめる。帰還の石碑の場所を先に確かめておくことだ。' },
];

// ------------------------------------------------------------------ 初期セーブデータ
export const NEW_GAME = {
  race: 'barbarian',
  stones: 0,          // 魔石（Step 2 で換金）
  absorbed: [],       // 吸収済みの精髄 ID
  runs: 0,
  clears: 0,
};

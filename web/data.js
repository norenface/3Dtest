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

// ------------------------------------------------------------------ アクティブスキル
// type: melee（前方への強攻撃） / stun（周囲の敵を動けなくする） / guard（被ダメージ軽減の強化）
export const MAX_SKILL_SLOTS = 4;
export const ACTIVE_SKILLS = {
  quick_stab: {
    name: '急所突き', short: '突き', description: '前方へ鋭く突き、通常攻撃の 2.4 倍のダメージを与える。',
    type: 'melee', cooldown: 6, staminaCost: 10, damageMultiplier: 2.4, range: 3.2, arcDeg: 40, color: 0x7ad35a,
  },
  feral_howl: {
    name: '獣の咆哮', short: '咆哮', description: '周囲 7m の敵を 2.5 秒間ひるませ、攻撃を中断させる。',
    type: 'stun', cooldown: 14, staminaCost: 15, radius: 7, stunTime: 2.5, color: 0x7fb6ff,
  },
  rock_guard: {
    name: '岩の構え', short: '岩', description: '6 秒間、受けるダメージを 65% 減らす。',
    type: 'guard', cooldown: 18, staminaCost: 0, duration: 6, damageTakenMultiplier: 0.35, color: 0xffb347,
  },
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

// ------------------------------------------------------------------ 時間（迷宮の開閉・階層閉鎖のサイクル）
// 地上ゲートは cycleDays 日ごとに開く。開放日（各周期の 1 日目）の 0:00〜gateOpenHours 時だけ入場できる。
// 階層 N の閉鎖日 = closeDayBase + closeDayStep × (N − 1)。閉鎖日を迎えると、その階層にいる者は都市へ送還される。
export const TIME = {
  cycleDays: 30,          // 地上ゲートの周期（CYCLE_DAYS。35 などに変更可）
  gateOpenHours: 6,       // 開放日の入場フェイズ（GATE_OPEN_DURATION）：0:00〜6:00
  entryHour: 3,           // 入場した時刻（入場フェイズ中）
  secondsPerDay: 300,     // ゲーム内の 1 日が実時間で何秒か（5 分）
  closeDayBase: 7,        // 第 1 層の閉鎖日
  closeDayStep: 4,        // 1 層深くなるごとに閉鎖が何日遅いか
  campDays: 1,            // 野営 1 回で進む日数
  campHeal: 0.3,          // 野営で回復する HP の割合
  respawnPerDay: 2,       // 日付が変わるたびに湧く魔物の数（プレイヤーから離れた出現地点に）
  warnHours: 24,          // 閉鎖まで残りこの時間で警告表示
};

// ------------------------------------------------------------------ 階層
// map: 1 文字 = 4m 四方のマス
//   # 壁 / . 床 / P 柱のある床
//   S 上から降りてきたときの到着地点（第 1 層では都市からの入口）
//   N 下層への門の候補地点 / U 上層への門の候補地点 / R 次元の亀裂の候補地点 / B 亀裂から元の階層へ戻る門
//   g ゴブリン / w ダイアウルフ / G ストーンゴーレム（の出現地点。足元は床）
// depth: 階層番号 N（閉鎖日の計算に使う） / closeDay: 指定すると閉鎖日を個別に上書き
// nextPortalSpawnRate / prevPortalSpawnRate / riftPortalSpawnRate: 各候補地点に門が現れる確率
//   （下層への門は、確率で 1 つも出なかった場合でも 1 つは必ず出す）
// monsterScale: 魔物の強さ・魔石の倍率
// isSpecialRift: 特殊な亀裂。timeMode が 'stopped'（中では時間が止まる）か 'surface'（地上と同じ時間が流れる）
export const TILE_SIZE = 4.0;
export const WALL_HEIGHT = 3.5;

export const FLOORS = [
  {
    id: 1, depth: 1,
    name: '第1層 薄暗い回廊',
    nextPortalSpawnRate: 0.6, prevPortalSpawnRate: 0, riftPortalSpawnRate: 0,
    map: [
      '###############',
      '#S..#.....#..N#',
      '#...#..g..#.w.#',
      '#.......P.....#',
      '###.#.....#...#',
      '#...###.###.###',
      '#.g...#.#.....#',
      '#..P..#.#..G..#',
      '#.....#...P...#',
      '###.#######.###',
      '#Nw...#.....w.#',
      '#.....g..P...N#',
      '###############',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    monsterScale: { hp: 1, attack: 1, stones: 1 },
    lighting: { ambient: 0x5a6888, ambientIntensity: 2.6, fog: 0x07080c, torchColor: 0xffa860 },
  },
  {
    id: 2, depth: 2,
    name: '第2層 苔むす石窟',
    nextPortalSpawnRate: 0.5, prevPortalSpawnRate: 0.7, riftPortalSpawnRate: 0.35,
    map: [
      '###############',
      '#S.....#..w...#',
      '#.U....#......#',
      '#...P..#..P..N#',
      '##.#####.###.##',
      '#..g...#...g..#',
      '#......R......#',
      '#..w...#...G..#',
      '##.###.#.####.#',
      '#....#...#....#',
      '#.N..#.w.#.U.N#',
      '#....G...#..g.#',
      '###############',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    monsterScale: { hp: 1.45, attack: 1.35, stones: 1.5 },
    lighting: { ambient: 0x4f7a5c, ambientIntensity: 2.4, fog: 0x060a07, torchColor: 0xc8ff9a },
  },
  {
    id: 3, depth: 3,
    name: '第3層 灼熱の坑道',
    nextPortalSpawnRate: 0.5, prevPortalSpawnRate: 0.6, riftPortalSpawnRate: 0,
    map: [
      '#################',
      '#S..#.....w.....#',
      '#.U.#.###.###.N.#',
      '#...#.#G....#...#',
      '##.##.#.###.#.###',
      '#.....#.#.g.#...#',
      '#.w.P...#...P.w.#',
      '#.....#.#.G.#...#',
      '###.###.###.#.###',
      '#N....g.....#..U#',
      '#.G.....P...g..N#',
      '#################',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    monsterScale: { hp: 2.0, attack: 1.7, stones: 2.2 },
    lighting: { ambient: 0x8a5a48, ambientIntensity: 2.4, fog: 0x0c0605, torchColor: 0xff7a3a },
  },
  {
    id: 4, depth: 4,
    name: '第4層 深淵の回廊',
    nextPortalSpawnRate: 0, prevPortalSpawnRate: 0.6, riftPortalSpawnRate: 0,
    map: [
      '#################',
      '#S....#.....#..U#',
      '#.U...#..G..#...#',
      '#..P..#.....#.w.#',
      '##.####.P.###.###',
      '#.....w...g.....#',
      '#.G..#######..G.#',
      '#....#.....#....#',
      '##.###..w..###.##',
      '#....g..P..g....#',
      '#..w.........G..#',
      '#################',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    monsterScale: { hp: 2.7, attack: 2.1, stones: 3.0 },
    lighting: { ambient: 0x5a4f88, ambientIntensity: 2.2, fog: 0x07060c, torchColor: 0xb08cff },
  },
  {
    // 特殊な亀裂（隠しエリア）：第 2 層にまれに現れる。中では時間が止まり、閉鎖もしない
    id: 101, depth: 2,
    name: '次元の亀裂',
    isSpecialRift: true,
    timeMode: 'stopped',
    nextPortalSpawnRate: 0, prevPortalSpawnRate: 0, riftPortalSpawnRate: 0,
    map: [
      '###########',
      '#B...#...G#',
      '#....#....#',
      '#.w..P..w.#',
      '#.........#',
      '#.G.....G.#',
      '###########',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    monsterScale: { hp: 2.2, attack: 1.8, stones: 3.0, dropBonus: 0.35 },
    lighting: { ambient: 0x7a3a6a, ambientIntensity: 2.4, fog: 0x0c040a, torchColor: 0xff5ad8 },
  },
];
export const RIFT_FLOOR_ID = 101;

// ------------------------------------------------------------------ 古文書（ゲーム内攻略メモ）
// price: 購入価格（ゴールド） / unlock: 条件を満たすと無料で読める（kills: 指定モンスターの累計撃破数）
export const LORE = [
  { id: 'lore_capacity', title: '魂の器について', price: 30,
    text: '器の容量には限りがある。安い精髄で器を埋めてしまった者は、深層で嘆くことになる。' +
          '吸収した精髄は二度と魂から離れない。ただ一つ、忘却の霊薬を除いては。' },
  { id: 'lore_time', title: '閉ざされる迷宮', price: 40,
    text: '迷宮の門は三十日に一度、開放日の夜明け前の数刻だけ開く。' +
          '中に入った者は、いる層が閉ざされる日まで帰れない。第1層は七日目、その下は四日ずつ遅れて閉ざされる。' +
          '閉ざされた層にいた者は、拾ったものを抱えたまま地上へ吐き出される。' },
  { id: 'lore_descend', title: '下層への逃げ込み', price: 70, unlock: { deepest: 2 },
    text: '第1層が閉ざされる直前に下層へ降りれば、さらに四日、迷宮に留まれる。稼ぎたい者の常套手段だ。' +
          'ただし一度降りた者は、上の層が閉ざされた後には戻れない。早く帰りたければ、閉鎖の前に上層への門を探して戻ることだ。' },
  { id: 'lore_rift', title: '次元の亀裂', price: 150, unlock: { deepest: 3 },
    text: '第2層には、まれに空間の裂け目が口を開ける。裂け目の中では時が止まり、層の閉鎖も届かない。' +
          '強い魔物がひしめくが、落とす精髄も多い。入口の門から元の層へ戻れる。' },
  { id: 'lore_goblin', title: '小鬼の精髄', price: 60, unlock: { kills: 'goblin', count: 5 },
    text: '小鬼の精髄は器をほとんど使わない。器用さが増し、獲物から多くの魔石を剥ぎ取れるようになる。' +
          '急所突きは、ひるんだ相手にこそ真価を発揮する。' },
  { id: 'lore_wolf', title: '灰色の狼', price: 80, unlock: { kills: 'wolf', count: 3 },
    text: '狼は飛びかかる直前に頭を低く下げる。その瞬間に横へ跳べ。' +
          '狼の精髄は脚を軽くし、咆哮で群れを怯ませる力を与える。' },
  { id: 'lore_golem', title: '石の巨人', price: 120, unlock: { kills: 'golem', count: 1 },
    text: '第1層の奥に棲む石の巨人は動きが鈍い。腕を振り上げたら、すぐに間合いの外へ。大振りの後が好機だ。' +
          'その精髄は肉体を岩のように変えるが、器を大きく占める。吸収する前に、器の残りをよく考えよ。' },
];

// ------------------------------------------------------------------ 拠点（換金・商店）
export const HUB = {
  name: '冒険者の宿場',
  stonePrice: 10,                 // 魔石 1 個の買取価格（ゴールド）
  potion: { name: '回復薬', description: '最大 HP の 50% を回復する。迷宮で R キー／回復ボタン。', price: 30, heal: 0.5, max: 3, cooldown: 1.0 },
  oblivion: { name: '忘却の霊薬', description: '吸収した精髄を 1 つ魂から取り除く。とても貴重。', price: 400 },
  // 装備：level 0 が初期装備。購入すると次の段階へ強化される
  weapons: [
    { name: '鉄の大剣', price: 0, attackBonus: 0 },
    { name: '鋼の大剣', price: 120, attackBonus: 6 },
    { name: '業物の大剣', price: 320, attackBonus: 14 },
  ],
  armors: [
    { name: '粗末な毛皮', price: 0, hpBonus: 0, damageTakenMultiplier: 1 },
    { name: '革の鎧', price: 100, hpBonus: 20, damageTakenMultiplier: 0.92 },
    { name: '鎖帷子', price: 280, hpBonus: 45, damageTakenMultiplier: 0.85 },
  ],
};

// ------------------------------------------------------------------ 初期セーブデータ
export const NEW_GAME = {
  race: 'barbarian',
  stones: 0,          // 魔石（拠点で換金する）
  gold: 0,
  absorbed: [],       // 吸収済みの精髄 ID
  skillSlots: [],     // セットしたスキル ID（最大 MAX_SKILL_SLOTS）
  potions: 1,
  oblivion: 0,        // 忘却の霊薬の所持数
  weaponLevel: 0,
  armorLevel: 0,
  lore: [],           // 読めるようになった古文書 ID
  kills: {},          // モンスター ID ごとの累計撃破数
  cycle: 1,           // 地上ゲートの何周期目か
  day: 1,             // 周期の何日目か（1 = 開放日）
  deepest: 1,         // 到達した最も深い階層
  runInProgress: false, // 探索中か（探索中にアプリが終了した場合、次の起動で続きから再開する）
  runs: 0,
  clears: 0,
};

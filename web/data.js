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
    name: '刃狼の精髄',
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
// grade: 魔物の等級（9 がいちばん弱く 1 がいちばん強い）。HP・攻撃力の基準になり、倒すと必ずこの等級の魔石を 1 個落とす
//   （古い固定マップの階層では、階層の gradeUp だけ等級が上がる）
// model: 体の型（humanoid 二足 / beast 四足 / golem 大型 / spirit 霊体 / worm 地を這う / tree 樹木）。look で色や装備を作り分ける
// drops: 精髄のドロップ率。精髄はまず落ちないレア（通常の魔物は 0.1〜1%）。亀裂の主（ボス）は BOSS.essenceChance で落とす
// ranged: 遠距離攻撃（弓・魔法）。physImmune: 通常攻撃が効かない霊体（精髄スキルなら効く）。lunge: 攻撃の瞬間に飛びかかる
// 固有名詞は一般的なファンタジーの名前にしている（原作にしかない名前は使わない）
export const GRADE_BASE = { 9: [30, 7], 8: [70, 12], 7: [150, 20], 6: [300, 32], 5: [560, 48], 4: [950, 66], 3: [1500, 90], 2: [2400, 125], 1: [4000, 170] };
function mon(id, name, grade, model, look, o = {}) {
  const [hp, atk] = GRADE_BASE[grade];
  return {
    id, name, grade, model, look,
    hp: Math.round(hp * (o.hp ?? 1)), attack: Math.round(atk * (o.atk ?? 1)), defense: o.defense ?? 0,
    speed: o.speed ?? 3.0, aggroRange: o.aggro ?? 11, attackRange: o.range ?? 1.6, windup: o.windup ?? 0.45,
    attackCooldown: o.cd ?? 1.2, radius: o.radius ?? 0.45, knockbackResist: o.kb ?? 0,
    ranged: o.ranged ?? null, lunge: !!o.lunge, physImmune: !!o.physImmune, human: !!o.human,
    drops: o.essence ? [{ essence: o.essence, chance: o.chance }] : [],
  };
}
// よく使う見た目
const GOBLIN = { skin: 0x6aa84f, cloth: 0x5b4636 };
const GNOME = { skin: 0xd9a77a, cloth: 0x5a6a3a, head: 'gnome', weapon: 'pick', size: 0.85 };
const GHOUL = { skin: 0x8c948a, cloth: 0x3f3a36, head: 'goblin', weapon: 'claw', hunch: 0.35, eye: 0xff5a4a };
const SKELETON = { skin: 0xe6e0cc, cloth: 0xd8d2be, head: 'skull', build: 0.8, eye: 0x7ff0ff };
const ORC = { skin: 0x6f7f3c, cloth: 0x4a3a2a, head: 'orc', weapon: 'club', size: 1.45, build: 1.15, eye: 0xff8a3a };
const ABYSS = { eye: 0xd06bff };   // 深淵の個体：暗い紫色で目が光る
const BOW = { ranged: { speed: 16, color: 0xd8c08a }, range: 9, windup: 0.8, cd: 2.0, aggro: 14 };
const MAGIC = { ranged: { speed: 11, color: 0xb07cff }, range: 9, windup: 1.0, cd: 2.4, aggro: 14 };

export const MONSTERS = {
  // ---- 第1層（基本は 9 等級・3〜4 体の群れ）
  goblin: mon('goblin', 'ゴブリン', 9, 'humanoid', GOBLIN, { essence: 'essence_goblin', chance: 0.01 }),
  wolf: mon('wolf', '刃狼', 9, 'beast', { fur: 0x8a909a, dark: 0x4a4f58, blade: 0xdfe6ee }, { hp: 1.3, atk: 1.25, defense: 1, speed: 5, aggro: 14, range: 1.9, windup: 0.35, cd: 1.0, radius: 0.55, kb: 0.2, lunge: true, essence: 'essence_wolf', chance: 0.005 }),
  gnome: mon('gnome', 'ノーム', 9, 'humanoid', GNOME, { hp: 1.1, speed: 2.6, defense: 1 }),
  ghoul: mon('ghoul', 'グール', 9, 'humanoid', GHOUL, { hp: 1.2, atk: 1.1, speed: 2.8 }),
  // 深淵の個体（特殊な条件で第1層に現れる 5 等級）
  abyss_goblin: mon('abyss_goblin', '深淵ゴブリン', 5, 'humanoid', { ...GOBLIN, ...ABYSS, skin: 0x3a2a4a, cloth: 0x1a1020, size: 1.15 }, { speed: 3.6 }),
  abyss_ghoul: mon('abyss_ghoul', '深淵グール', 5, 'humanoid', { ...GHOUL, ...ABYSS, skin: 0x40304a, size: 1.15 }, { speed: 3.4 }),
  abyss_gnome: mon('abyss_gnome', '深淵ノーム', 5, 'humanoid', { ...GNOME, ...ABYSS, skin: 0x5a3a6a, hat: 0x2a1030, size: 1.0 }, { speed: 3.0 }),
  abyss_wolf: mon('abyss_wolf', '深淵刃狼', 5, 'beast', { fur: 0x2a2236, dark: 0x16101e, blade: 0xb07cff, eye: 0xd06bff, size: 1.2 }, { speed: 5.6, aggro: 16, range: 2.1, windup: 0.35, cd: 0.9, radius: 0.65, kb: 0.5, lunge: true }),

  // ---- 第2層 獣の巣窟（東）
  giant_wolf: mon('giant_wolf', '巨大刃狼', 9, 'beast', { fur: 0x7a808a, dark: 0x40454e, blade: 0xdfe6ee, size: 1.4 }, { hp: 1.8, atk: 1.4, speed: 4.6, range: 2.3, windup: 0.4, cd: 1.1, radius: 0.75, kb: 0.4, lunge: true }),
  blood_wolf: mon('blood_wolf', '血刃狼', 9, 'beast', { fur: 0x7a3030, dark: 0x401818, blade: 0xff8a8a, eye: 0xff5a4a }, { hp: 1.4, atk: 1.5, speed: 5.4, range: 1.9, windup: 0.3, cd: 0.9, radius: 0.55, kb: 0.2, lunge: true }),
  wall_mole: mon('wall_mole', '壁モグラ', 9, 'beast', { fur: 0x6a5040, dark: 0x3a2a20, size: 0.7, tall: 0.5, long: 1.2, tail: false, fangs: true }, { speed: 3.4, radius: 0.45 }),
  mole_queen: mon('mole_queen', '壁モグラの女王', 9, 'beast', { fur: 0x8a6a50, dark: 0x4a3426, size: 1.2, tall: 0.55, long: 1.3, tail: false, fangs: true }, { hp: 2.2, atk: 1.3, speed: 2.6, radius: 0.75, kb: 0.5 }),
  moon_bear: mon('moon_bear', '月輪岩熊', 9, 'beast', { fur: 0x2a2a30, dark: 0x1a1a1e, size: 1.5, long: 0.85, tall: 1.1 }, { hp: 2.6, atk: 1.6, speed: 2.8, range: 2.4, windup: 0.6, cd: 1.5, radius: 0.9, kb: 0.7 }),
  horned_boar: mon('horned_boar', '角猪', 9, 'beast', { fur: 0x6a4a30, dark: 0x3a2818, size: 1.2, tall: 0.8, horns: 0xe8e0c8, tail: false }, { hp: 1.8, atk: 1.4, speed: 4.2, range: 2.0, windup: 0.5, radius: 0.7, kb: 0.6, lunge: true }),
  saber_tiger: mon('saber_tiger', 'サーベルタイガー', 8, 'beast', { fur: 0xc08a3a, dark: 0x5a3a18, size: 1.3, fangs: true }, { speed: 5.2, range: 2.2, windup: 0.35, cd: 1.0, radius: 0.75, kb: 0.4, lunge: true }),
  werewolf: mon('werewolf', 'ウェアウルフ', 8, 'humanoid', { skin: 0x5a5048, cloth: 0x3a3028, head: 'wolf', weapon: 'claw', size: 1.35, build: 1.1, eye: 0xffd24a }, { speed: 4.2, range: 1.9, windup: 0.4, cd: 1.0, radius: 0.6, kb: 0.4 }),

  // ---- 第2層 亡者の地（南）
  elder_ghoul: mon('elder_ghoul', 'エルダーグール', 9, 'humanoid', { ...GHOUL, skin: 0x6c7468, size: 1.15 }, { hp: 1.6, atk: 1.3, speed: 2.8 }),
  skeleton_warrior: mon('skeleton_warrior', 'スケルトン戦士', 9, 'humanoid', { ...SKELETON, weapon: 'sword', shield: 0x6a5a40 }, { hp: 1.1, defense: 2 }),
  skeleton_archer: mon('skeleton_archer', 'スケルトン弓兵', 9, 'humanoid', { ...SKELETON, weapon: 'bow' }, { hp: 0.9, ...BOW }),
  skeleton_mage: mon('skeleton_mage', 'スケルトンメイジ', 9, 'humanoid', { ...SKELETON, weapon: 'staff', cloth: 0x3a2a5a }, { hp: 0.8, ...MAGIC }),
  banshee: mon('banshee', 'バンシー', 9, 'spirit', { color: 0xb8c8e8, glow: 0xd8f0ff, style: 'cloak' }, { hp: 0.9, ...MAGIC, ranged: { speed: 10, color: 0xd8f0ff } }),
  death_fiend: mon('death_fiend', 'デスフィーンド', 8, 'humanoid', { skin: 0x3a3438, cloth: 0x1a1418, head: 'skull', weapon: 'claw', hunch: 0.2, eye: 0xff3a3a, size: 1.2 }, { speed: 3.8 }),
  chimera_wolf: mon('chimera_wolf', 'キメラウルフ', 8, 'beast', { fur: 0x6a5a7a, dark: 0x3a2a40, horns: 0x9a8a6a, size: 1.25, eye: 0x9aff6a }, { speed: 4.8, range: 2.0, windup: 0.35, radius: 0.65, kb: 0.3, lunge: true }),
  ghoul_lord: mon('ghoul_lord', 'グールロード', 8, 'humanoid', { ...GHOUL, skin: 0x5a6058, cloth: 0x2a1a2a, size: 1.35, eye: 0xff2a2a }, { hp: 1.3, speed: 3.0, radius: 0.55, kb: 0.4 }),
  dullahan: mon('dullahan', 'デュラハン', 7, 'humanoid', { skin: 0x2a2a30, cloth: 0x1a1a20, armor: 0x3a3a46, head: 'none', weapon: 'sword', size: 1.3, eye: 0x7ff0ff }, { speed: 3.4, range: 2.0, radius: 0.6, kb: 0.6, defense: 4 }),
  death_knight: mon('death_knight', 'デスナイト', 6, 'humanoid', { skin: 0x1a1a20, cloth: 0x101014, armor: 0x2a2a36, head: 'helm', weapon: 'sword', shield: 0x2a2a36, size: 1.4, eye: 0xff3a3a }, { speed: 3.2, range: 2.1, radius: 0.65, kb: 0.8, defense: 6 }),

  // ---- 第2層 岩の砂漠（西）
  fallen_gnome: mon('fallen_gnome', '堕落したノーム', 9, 'humanoid', { ...GNOME, skin: 0x8a6a5a, hat: 0x3a2a3a, eye: 0xff6a3a }, { hp: 1.2, atk: 1.2, speed: 2.8 }),
  kobold: mon('kobold', 'コボルド', 9, 'humanoid', { skin: 0x8a6a4a, cloth: 0x4a3a2a, head: 'wolf', weapon: 'club', size: 0.9 }, { speed: 3.2 }),
  kobold_shield: mon('kobold_shield', 'コボルド盾兵', 9, 'humanoid', { skin: 0x7a5a3a, cloth: 0x4a3a2a, head: 'wolf', weapon: 'club', shield: 0x8a7a5a, size: 0.95 }, { hp: 1.4, defense: 3, speed: 2.6 }),
  kobold_spear: mon('kobold_spear', 'コボルド槍兵', 9, 'humanoid', { skin: 0x9a7a5a, cloth: 0x5a4a3a, head: 'wolf', weapon: 'spear', size: 0.95 }, { range: 2.4, windup: 0.55 }),
  golem: mon('golem', 'ストーンゴーレム', 8, 'golem', {}, { hp: 1.4, atk: 1.35, defense: 5, speed: 1.7, aggro: 9, range: 2.2, windup: 0.9, cd: 2.0, radius: 0.85, kb: 0.8, essence: 'essence_golem', chance: 0.002 }),
  stone_soldier: mon('stone_soldier', '巨石兵', 8, 'golem', { stone: 0x9a8a6a, dark: 0x6a5a40, glow: 0x7ff0ff, size: 0.85 }, { hp: 1.2, defense: 4, speed: 2.2, range: 2.0, windup: 0.7, cd: 1.6, radius: 0.75, kb: 0.7 }),
  sandman: mon('sandman', 'サンドマン', 8, 'golem', { stone: 0xd8b878, dark: 0xb89858, glow: 0xffe08a, size: 0.8 }, { speed: 2.8, range: 1.9, windup: 0.6, radius: 0.7, kb: 0.5 }),
  sandworm: mon('sandworm', 'サンドワーム', 8, 'worm', {}, { hp: 1.3, speed: 3.6, range: 2.2, windup: 0.6, cd: 1.6, radius: 0.7, kb: 0.8 }),
  death_worm: mon('death_worm', 'デスワーム', 5, 'worm', { skin: 0x6a3a5a, dark: 0x3a1a30, mouth: 0x2a0a1a, size: 1.8, segs: 8 }, { speed: 4.0, aggro: 16, range: 3.2, windup: 0.7, cd: 1.8, radius: 1.2, kb: 1 }),

  // ---- 第2層 ゴブリンの森（北）
  goblin_sword: mon('goblin_sword', 'ゴブリン剣士', 9, 'humanoid', { ...GOBLIN, cloth: 0x4a4a5a, weapon: 'sword' }, { hp: 1.2, atk: 1.2 }),
  goblin_archer: mon('goblin_archer', 'ゴブリン弓兵', 9, 'humanoid', { ...GOBLIN, cloth: 0x3a5a3a, weapon: 'bow' }, { hp: 0.9, ...BOW }),
  hobgoblin: mon('hobgoblin', 'ホブゴブリン', 7, 'humanoid', { skin: 0x5a8a3a, cloth: 0x4a3a2a, weapon: 'club', size: 1.5, build: 1.2, eye: 0xff8a3a }, { speed: 3.2, range: 2.0, radius: 0.65, kb: 0.6 }),

  // ---- 第3層 魔女の森
  fairy: mon('fairy', 'フェアリー', 9, 'spirit', { color: 0xbfffd8, glow: 0x9affc8, style: 'fairy', size: 0.8 }, { hp: 0.7, speed: 4.4, ...MAGIC, ranged: { speed: 12, color: 0x9affc8 } }),
  wraith: mon('wraith', 'レイス', 9, 'spirit', { color: 0x6a7a9a, glow: 0x9ad8ff, style: 'cloak' }, { speed: 3.2, physImmune: true }),
  witch_lamp: mon('witch_lamp', 'ウィッチズランプ', 9, 'spirit', { style: 'lamp', glow: 0x9aff6a }, { hp: 0.8, speed: 2.4, ...MAGIC, ranged: { speed: 10, color: 0x9aff6a } }),
  woodman: mon('woodman', 'ウッドマン', 9, 'golem', { stone: 0x6a4a30, dark: 0x4a3420, glow: 0x9aff6a, size: 0.75 }, { hp: 1.5, speed: 2.2, range: 2.0, windup: 0.7, radius: 0.65, kb: 0.6 }),
  snake_tree: mon('snake_tree', '蛇樹', 8, 'tree', { bark: 0x4a3a2a, leaf: 0x2f5a2a, eye: 0x9aff3a }, { speed: 1.4, range: 2.6, windup: 0.6, radius: 0.7, kb: 1 }),
  root_eater: mon('root_eater', '根喰い', 8, 'beast', { fur: 0x5a4a3a, dark: 0x3a2a1a, tall: 0.6, long: 1.4, tail: false, fangs: true, eye: 0xffd24a }, { speed: 3.6, radius: 0.6, kb: 0.4 }),
  mutant_spirit: mon('mutant_spirit', '突然変異した下級精霊', 8, 'spirit', { style: 'wisp', color: 0xff9ad8, glow: 0xffd0f0 }, { speed: 3.8, ...MAGIC, ranged: { speed: 12, color: 0xff9ad8 } }),
  homunculus: mon('homunculus', 'ホムンクルス', 8, 'humanoid', { skin: 0xe8d0c8, cloth: 0xc8b0a8, head: 'skull', weapon: 'claw', eye: 0xff3a6a }, { speed: 3.6 }),
  owlbear: mon('owlbear', 'アウルベア', 8, 'beast', { fur: 0x7a6040, dark: 0x4a3a28, size: 1.45, long: 0.9, eye: 0xffb030, horns: 0xc8a060 }, { hp: 1.5, atk: 1.3, speed: 3.2, range: 2.3, windup: 0.55, radius: 0.85, kb: 0.7 }),
  dryad: mon('dryad', 'ドライアド', 8, 'humanoid', { skin: 0x8ac87a, cloth: 0x3a6a2a, head: 'hood', weapon: 'staff', magic: 0x9aff6a, eye: 0xffffff }, { ...MAGIC, ranged: { speed: 11, color: 0x9aff6a } }),
  half_troll: mon('half_troll', 'ハーフトロール', 7, 'humanoid', { skin: 0x6a7a5a, cloth: 0x4a3a2a, head: 'orc', weapon: 'club', size: 1.8, build: 1.3 }, { hp: 1.3, speed: 2.8, range: 2.4, windup: 0.6, radius: 0.8, kb: 0.8 }),
  cannibal_tree: mon('cannibal_tree', '人喰い樹', 7, 'tree', { bark: 0x3a2a20, leaf: 0x2a3a20, eye: 0xff3a2a, size: 1.4 }, { hp: 1.6, atk: 1.4, speed: 3.0, aggro: 22, range: 3.0, windup: 0.6, radius: 1.0, kb: 1 }),

  // ---- 第3層 オークの群落地
  orc_warrior: mon('orc_warrior', 'オーク戦士', 8, 'humanoid', ORC, { speed: 3.2, range: 2.0, radius: 0.6, kb: 0.4 }),
  orc_archer: mon('orc_archer', 'オーク弓兵', 8, 'humanoid', { ...ORC, weapon: 'bow', size: 1.35 }, { hp: 0.9, ...BOW }),
  orc_shaman: mon('orc_shaman', 'オーク呪術師', 8, 'humanoid', { ...ORC, weapon: 'staff', cloth: 0x5a2a4a, size: 1.35, magic: 0xff6a3a }, { hp: 0.9, ...MAGIC, ranged: { speed: 11, color: 0xff6a3a } }),
  orc_great: mon('orc_great', 'オーク大戦士', 7, 'humanoid', { ...ORC, armor: 0x5a4a3a, weapon: 'sword', size: 1.6 }, { speed: 3.0, range: 2.2, radius: 0.7, kb: 0.6, defense: 3 }),
  orc_hero: mon('orc_hero', 'オークヒーロー', 5, 'humanoid', { ...ORC, armor: 0x8a6a2a, weapon: 'sword', shield: 0x8a6a2a, size: 1.8, eye: 0xffd24a }, { speed: 3.4, range: 2.4, radius: 0.8, kb: 0.9, defense: 5 }),
  orc_lord: mon('orc_lord', 'オークロード', 2, 'humanoid', { ...ORC, skin: 0x4a5a2a, armor: 0x3a2a2a, weapon: 'sword', size: 2.2, build: 1.3, eye: 0xff2a2a }, { speed: 3.6, aggro: 18, range: 2.8, radius: 1.0, kb: 1, defense: 8 }),

  // ---- 略奪者（迷宮に入った冒険者を襲う人間。精髄も魔石も落とさない。RAIDERS を参照）
  raider_sword: mon('raider_sword', '略奪者（剣士）', 7, 'humanoid', { skin: 0xd8b090, cloth: 0x4a3a2a, armor: 0x5a4a38, head: 'hood', weapon: 'sword', eye: 0xffffff, build: 0.95 },
    { hp: 0.85, atk: 0.95, speed: 3.8, aggro: 16, range: 1.9, windup: 0.35, cd: 0.9, kb: 0.3, human: true }),
  raider_archer: mon('raider_archer', '略奪者（弓使い）', 7, 'humanoid', { skin: 0xc89870, cloth: 0x3a4a2a, head: 'hood', weapon: 'bow', eye: 0xffffff, build: 0.9 },
    { hp: 0.7, atk: 0.8, speed: 3.8, kb: 0.2, human: true, ...BOW, aggro: 18, range: 10 }),
  raider_dwarf: mon('raider_dwarf', 'ドワーフの略奪者', 7, 'humanoid', { skin: 0xc8906a, cloth: 0x5a3a2a, armor: 0x6a6a72, head: 'helm', weapon: 'club', weaponColor: 0x8a8a92, size: 0.85, build: 1.35, beard: 0x8a5a3a },
    { hp: 1.1, atk: 1.1, speed: 3.0, aggro: 14, range: 1.8, windup: 0.5, cd: 1.2, kb: 0.6, defense: 3, human: true }),
  raider_boss: mon('raider_boss', '略奪者の頭目', 6, 'humanoid', { skin: 0xd0a080, cloth: 0x2a1a1a, armor: 0x3a3a46, head: 'helm', weapon: 'sword', shield: 0x5a3a2a, size: 1.1, eye: 0xff6a3a },
    { hp: 0.9, atk: 0.9, speed: 3.6, aggro: 18, range: 2.0, windup: 0.4, cd: 1.0, kb: 0.6, defense: 4, human: true }),

  // ---- 第3層 石像の遺跡
  nameless_statue: mon('nameless_statue', '無名の石像', 7, 'golem', { stone: 0xa8a8a0, dark: 0x7a7a72, glow: null, headless: true }, { hp: 1.2, defense: 6, speed: 1.8, aggro: 8, range: 2.2, windup: 0.8, cd: 1.8, radius: 0.8, kb: 0.9 }),
};

// 亀裂の主（次元の亀裂にいるボス）。マップの X の場所に bossMonster が現れる。
// 通常の個体より強く大きく、魔石を多く落とし、essenceChance の確率で精髄を落とす
// ------------------------------------------------------------------ 敵の強さと戦い方
// hpMul / atkMul：すべての敵の HP・攻撃力の倍率
// windupJitter：攻撃の溜め時間のばらつき（±割合。タイミングを読みにくくする）
// trackDuringWindup：溜めの間も、この速さの割合で詰め寄ってくる（下がりながら振るだけでは逃げ切れない）
// engage / strikeStep / strikeReach：少し離れた所から溜め、攻撃の瞬間に踏み込んで斬る
// knockback / breakKnockback：普通に斬られたとき／体勢が崩れたときに押される強さ
// poise：体勢（最大 HP × ratio と、flat + 等級ごとに perGrade の大きいほう。大型は 1.6 倍）。削り切ると攻撃を中断してよろける。regen：毎秒の回復（最大値に対する割合）
// backpedal：プレイヤーが後ろへ下がるときの速さの倍率
export const ENEMY = {
  hpMul: 1.7, atkMul: 1.6,
  windupJitter: 0.35,
  trackDuringWindup: 0.6,
  engage: 1.3,              // 間合いのこれだけ外側から溜めを始め、攻撃の瞬間に踏み込んで斬る
  strikeStep: 7.5, strikeReach: 0.45,   // 踏み込みの速さ（m/s）。攻撃中（0.22 秒）に間合い + strikeReach まで来たら当たる
  knockback: 2.0, breakKnockback: 7,
  chaseSpeed: 1.2,          // 戦闘中（追いかけているとき）の速さの倍率
  poise: { ratio: 0.3, flat: 30, perGrade: 12, regen: 0.3, breakStagger: 0.8 },
  backpedal: 0.6,
};
// 戦い方（体の型・武器で決まる。等級が上がるほど回避・連撃が増える）
//  dodge：プレイヤーが斬りかかったとき、横・後ろへ跳んでかわす確率
//  combo：連撃の最大回数（溜めの短い追撃）
//  guard：盾で正面からの攻撃を防ぐ（ダメージ guard 倍・体勢が崩れない）。横や背後、攻撃の直後は防げない
//  charge：中距離から溜めて突進してくる
//  hitRun：攻撃したあと距離を取ってから、また攻めてくる
//  strafe：攻撃の合間に、プレイヤーの周りを回り込みながら隙をうかがう
//  kite：遠距離攻撃の敵は、近寄られると下がって間合いを取る
//  superArmor：攻撃の溜めを斬られても止まらない（大型）
export const AI_STYLES = {
  fighter: { dodge: 0.18, combo: 1, strafe: true },                       // 剣・棍棒を持つ人型
  shield: { dodge: 0.05, combo: 1, strafe: true, guard: 0.25 },           // 盾持ち
  archer: { dodge: 0.25, kite: true, strafe: true },                     // 弓・魔法
  beast: { dodge: 0.12, combo: 1, charge: true, hitRun: true, strafe: true },
  heavy: { superArmor: true, combo: 1 },                                  // ゴーレム・樹木など大型
  spirit: { dodge: 0.3, hitRun: true, strafe: true },
  worm: { charge: true, superArmor: true },
};
export function aiStyle(def) {
  const L = def.look ?? {};
  let base;
  if (def.ranged) base = AI_STYLES.archer;
  else if (def.model === 'beast') base = AI_STYLES.beast;
  else if (def.model === 'golem' || def.model === 'tree') base = AI_STYLES.heavy;
  else if (def.model === 'spirit') base = AI_STYLES.spirit;
  else if (def.model === 'worm') base = AI_STYLES.worm;
  else if (L.shield) base = AI_STYLES.shield;
  else base = AI_STYLES.fighter;
  const up = Math.max(0, 9 - (def.grade ?? 9));          // 等級が高いほど上手くなる
  return { ...base, dodge: Math.min(0.55, (base.dodge ?? 0) * (1 + up * 0.18) + (def.human ? 0.08 : 0)),
    combo: (base.combo ?? 0) + (up >= 3 ? 1 : 0) + (up >= 6 ? 1 : 0), superArmor: !!base.superArmor || def.knockbackResist >= 0.9 };
}

export const BOSS = { title: '亀裂の主', hp: 3.0, attack: 1.3, size: 1.4, gradeUp: 2, essenceChance: 0.33 };

// 魔石の等級（9 等級がいちばん下、1 等級がいちばん上）。price: 買取価格（ゴールド） / color: 見た目の色
export const STONE_GRADES = {
  9: { price: 10, color: 0x55c8ff },
  8: { price: 25, color: 0x5fe8b0 },
  7: { price: 60, color: 0x9be86a },
  6: { price: 140, color: 0xe8e15a },
  5: { price: 320, color: 0xffb347 },
  4: { price: 700, color: 0xff7a5a },
  3: { price: 1500, color: 0xff5aa8 },
  2: { price: 3200, color: 0xc77dff },
  1: { price: 7000, color: 0xffffff },
};

// ------------------------------------------------------------------ 時間（迷宮の開閉・階層閉鎖のサイクル）
// 地上ゲートは cycleDays 日ごとに開く。開放日（各周期の 1 日目）の 0:00〜gateOpenHours 時だけ入場できる。
// 地上から突入した瞬間を 0 時間とし、各階層の closeHours（第1層 168・第2層 240・第3層 360）に達すると、その階層にいる者は都市へ送還される。
export const TIME = {
  cycleDays: 30,          // 地上ゲートの周期（CYCLE_DAYS。35 などに変更可）
  gateOpenHours: 6,       // 開放日の入場フェイズ（GATE_OPEN_DURATION）：0:00〜6:00
  entryHour: 3,           // （テスト用の既定値。実際の入場時刻は都市で過ごした時間で決まる）
  // 開放日は都市でも時間が流れる（迷宮と同じ速さ）。閉門まで lateEntryHours 時間を切ってから入ると「閉門間際の入場」になり、
  // lateDarkChance の確率で第1層の暗黒地帯に降り立ってしまう（ふだんは暗黒地帯以外のランダムな場所に降り立つ）
  lateEntryHours: 1,
  lateDarkChance: 0.5,
  secondsPerDay: 300,     // ゲーム内の 1 日が実時間で何秒か（5 分）
  // closeHours を書いていない階層の閉鎖時間（深さ N から。第4層以降の仮の値）
  fallbackCloseHours: depth => (7 + 4 * (depth - 1)) * 24,
  campDays: 1,            // 野営 1 回で進む日数
  campHeal: 0.3,          // 野営で回復する HP の割合
  respawnPerDay: 2,       // 日付が変わるたびに湧く魔物の数（プレイヤーから離れた出現地点に）
  warnHours: 24,          // 閉鎖まで残りこの時間で警告表示
};

// ------------------------------------------------------------------ 階層
// 第1〜3層は突入ごとに地形が変わる（generator：mapgen.js の関数名。探索ごとの種から作るので、同じ探索中は同じ地形）。
// 第4層・次元の亀裂・試験用の階層は固定のマップ（map）。
// map / generator の文字：
//   # 壁 / . 床 / P 柱・木・岩・残骸（theme で見た目が変わる）/ C ライトクリスタル / K 安全地帯 / M 記念碑
//   S 到着地点 / N 下層への門 / U 上層への門 / R 次元の亀裂の候補地点 / B 亀裂から元の階層へ戻る門 / T 石碑 / ^ 罠
//   1〜4 第1層の東西南北の門（gates）/ m 魔物の群れ（種類は regions の地域ごと）
//   g w G X … 固定マップの魔物（monsterTable。X は亀裂の主）
// closeHours: 突入（0 時間）からこの時間で閉鎖され、その階層にいる生存者は地上へ送還される
// next / prev: 下層・上層への門の行き先（prev が 'via' なら、来たエリアへ戻る）
// regions: 地域ごとの設定 { name: 表示名, monsters: [[魔物 id, 重み, 'rare'?], ...], group: [最少, 最多], safe: 魔物が入れない }
//   sizes: [[[最少, 最多], 割合], ...] を書くと、出現地点ごとに群れの大きさをこの割合で選ぶ（集団・複数・単体を混ぜる）
// theme: 見た目（'crystal' 水晶の洞窟 / 'canyon' 峡谷 / 'dead' 亡者の地 / 'desert' 砂漠 / 'forest' 森 / 'pilgrim' 巡礼者の道 / 既定は石の回廊）
// lighting.mode: 'crystal'（クリスタルの周りだけ明るい）/ 'night'（夜。空に星明かり。sight が見通し m、moon が月明かりの強さ）/ 既定は松明
// isSpecialRift: 特殊な亀裂。timeMode が 'stopped'（中では時間が止まる）か 'surface'（地上と同じ時間が流れる）
export const TILE_SIZE = 4.0;
export const WALL_HEIGHT = 3.5;

export const FLOOR = { F1: 1, BEAST: 21, DEAD: 22, DESERT: 23, FOREST: 24, F3: 3, F4: 4 };
export const FLOORS = [
  {
    id: 1, depth: 1,
    name: '第1層 水晶の洞窟',
    closeHours: 168,
    generator: 'crystalCave', theme: 'crystal',
    randomStart: true,
    // 東西南北の腕の先の門。それぞれ第2層の別のエリアへつながる
    gates: {
      1: { target: 24, label: '北の門' },
      2: { target: 21, label: '東の門' },
      3: { target: 22, label: '南の門' },
      4: { target: 23, label: '西の門' },
    },
    // 地域ごとの出現法則
    //   pack: 群れで行動し、1 頭が気づくと群れ全体で襲ってくる。標的を囲い込むように回り込む
    //   roam: 単体で広く徘徊する（m） / link: 戦闘の気配を察すると、近くの同種が集まり、さらに別個体が次々と湧いて加わる
    //   assist: 戦闘が始まると、周囲（m）の魔物が種類を問わず巻き込まれて加わる（乱戦になりやすい）
    regions: {
      north: { name: '北部', monsters: [['goblin', 1]], group: [1, 2] },   // 単体か数匹。1 匹ずつおびき寄せやすい（初心者向けの狩場）
      east: { name: '東部', monsters: [['wolf', 1]], group: [3, 5], pack: true },   // 基本は群れ。囲い込んでくる（1層で最も危険）
      south: { name: '南部', monsters: [['ghoul', 1]], group: [1, 1], roam: 10, link: { radius: 18, reinforce: 3, interval: 6 } },
      west: { name: '西部', monsters: [['gnome', 1]], group: [1, 1], roam: 10, link: { radius: 18, reinforce: 3, interval: 6 } },
      center: { name: '中心部', monsters: [['goblin', 1], ['wolf', 1], ['ghoul', 1], ['gnome', 1]], group: [1, 2], assist: 10 },
      safe: { name: '記念碑の空洞（安全地帯）', monsters: [], safe: true },
      // 外周の暗黒地帯：数は少ないが、どの種類も単体でうろついている。暗くて近づくまで見えない
      dark: { name: '暗黒地帯', monsters: [['goblin', 1], ['wolf', 1], ['ghoul', 1], ['gnome', 1]], group: [1, 1], roam: 8 },
    },
    // 特殊な条件：深淵の侵食（まれに、5 等級の深淵の個体が各地に現れる）
    abyss: { chance: 0.03, monsters: { north: 'abyss_goblin', east: 'abyss_wolf', south: 'abyss_ghoul', west: 'abyss_gnome' } },
    lighting: { mode: 'crystal', ambient: 0x4a6aa8, ambientIntensity: 0.55, fog: 0x01030a, torchColor: 0xffa860,
      crystalColor: 0x7fd4ff, darkFog: 2.2, litFog: 44 },   // darkFog：松明なしの暗黒地帯での見通し（m）
  },
  // ---- 第2層：第1層で通った門の方角ごとに 4 つの独立したエリア（エリア間は行き来できない）
  {
    id: 21, depth: 2, area: '東',
    name: '第2層 獣の巣窟',
    description: '分岐が極めて多い複雑な峡谷。迷いやすい。',
    closeHours: 240,
    generator: 'canyon', theme: 'canyon',
    next: 3, prev: 1, riftPortalSpawnRate: 0.35,
    regions: {
      main: { name: '峡谷', sizes: [[[8, 12], 0.25], [[2, 4], 0.4], [[1, 1], 0.35]], monsters: [['giant_wolf', 2], ['blood_wolf', 2], ['wall_mole', 3], ['mole_queen', 0.5], ['moon_bear', 1], ['horned_boar', 2], ['saber_tiger', 1], ['werewolf', 1]] },
    },
    lighting: { mode: 'night', ambient: 0xa8b4d8, ambientIntensity: 2.6, fog: 0x1a2236, sight: 45, moon: 1.4, stars: true, torchColor: 0xffa860 },
  },
  {
    id: 22, depth: 2, area: '南',
    name: '第2層 亡者の地',
    description: 'ぬかるむ黒い大地と石造建築の残骸。罠はなく、ひたすら北へ進めば第3層への門がある。',
    closeHours: 240,
    generator: 'deadland', theme: 'dead',
    next: 3, prev: 1, riftPortalSpawnRate: 0.35,
    regions: {
      main: { name: '黒い湿原', sizes: [[[8, 12], 0.25], [[2, 4], 0.4], [[1, 1], 0.35]], monsters: [['ghoul', 3], ['elder_ghoul', 2], ['skeleton_warrior', 2], ['skeleton_archer', 1.5], ['skeleton_mage', 1], ['banshee', 1],
        ['death_fiend', 1], ['chimera_wolf', 1], ['ghoul_lord', 0.7], ['dullahan', 0.06, 'rare'], ['death_knight', 0.02, 'rare']] },
    },
    banshee: true,   // ときどきバンシーの泣き声が響く
    lighting: { mode: 'night', ambient: 0xb0b8cc, ambientIntensity: 3.4, fog: 0x262b36, sight: 38, moon: 1.7, stars: true, torchColor: 0xffa860 },
  },
  {
    id: 23, depth: 2, area: '西',
    name: '第2層 岩の砂漠',
    description: '足元の砂と熱い空気。松明に照らされた石造りの残骸が広がる。',
    closeHours: 240,
    generator: 'desert', theme: 'desert',
    next: 3, prev: 1, riftPortalSpawnRate: 0.35,
    regions: {
      main: { name: '砂漠', sizes: [[[8, 12], 0.25], [[2, 4], 0.4], [[1, 1], 0.35]], monsters: [['gnome', 3], ['fallen_gnome', 2], ['kobold', 2], ['kobold_shield', 1.5], ['kobold_spear', 1.5],
        ['golem', 0.8], ['stone_soldier', 0.8], ['sandman', 1], ['sandworm', 0.8], ['death_worm', 0.008, 'rare']] },
    },
    lighting: { mode: 'night', ambient: 0xd8bc90, ambientIntensity: 2.6, fog: 0x2a2218, sight: 50, moon: 1.4, stars: true, torches: true, torchColor: 0xffa860 },
  },
  {
    id: 24, depth: 2, area: '北',
    name: '第2層 ゴブリンの森',
    description: '星明かりで比較的明るい森。無数の罠。第3層への門は 8 つの石碑のどれか 1 つ（開くと残りはただの石塊になる）。',
    closeHours: 240,
    generator: 'forest', theme: 'forest',
    next: 3, prev: 1, riftPortalSpawnRate: 0.35,
    steles: true,
    trap: { damage: 0.15 },   // 罠を踏むと最大 HP の 15% のダメージ
    regions: {
      main: { name: '森', sizes: [[[8, 12], 0.25], [[2, 4], 0.4], [[1, 1], 0.35]], monsters: [['goblin', 4], ['goblin_sword', 2], ['goblin_archer', 2]] },
      outer: { name: '森の外周部', sizes: [[[8, 12], 0.25], [[2, 4], 0.4], [[1, 1], 0.35]], monsters: [['goblin', 4], ['goblin_sword', 2], ['goblin_archer', 2], ['hobgoblin', 1.2]] },
    },
    lighting: { mode: 'night', ambient: 0xb0c4e8, ambientIntensity: 3.0, fog: 0x1a2438, sight: 50, moon: 1.5, stars: true, torchColor: 0xffa860 },
  },
  // ---- 第3層：巡礼者の道（第2層のどのエリアから来ても合流する広い 1 つの階層）
  {
    id: 3, depth: 3,
    name: '第3層 巡礼者の道',
    closeHours: 360,
    generator: 'pilgrimRoad', theme: 'pilgrim',
    next: 4, prev: 'via',
    regions: {
      witch: { name: '魔女の森', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['fairy', 2], ['wraith', 2], ['witch_lamp', 2], ['woodman', 2], ['snake_tree', 1], ['root_eater', 1],
        ['mutant_spirit', 1], ['homunculus', 1], ['owlbear', 1], ['dryad', 1], ['half_troll', 0.5]], witchEye: true },
      hill: { name: '鋼岩の丘', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['owlbear', 1], ['woodman', 1], ['root_eater', 1], ['homunculus', 1]], silverOrbs: true },
      orc: { name: 'オークの群落地', sizes: [[[6, 10], 0.4], [[3, 5], 0.4], [[1, 1], 0.2]], monsters: [['orc_warrior', 4], ['orc_archer', 2], ['orc_shaman', 1.5], ['orc_great', 1]], orcTrigger: true },
      swamp: { name: '緑尾の湿地', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['root_eater', 2], ['snake_tree', 1], ['homunculus', 1], ['owlbear', 0.5]], slow: 0.7 },
      statue: { name: '石像の遺跡', sizes: [[[2, 3], 0.5], [[1, 1], 0.5]], monsters: [['nameless_statue', 1]] },
      road_w: { name: '巡礼者の街道', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['homunculus', 1], ['root_eater', 1], ['owlbear', 0.5]] },
      plain_nw: { name: '霧の平原', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['wraith', 1], ['fairy', 1], ['mutant_spirit', 1]] },
      battle_ne: { name: '古戦場', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['orc_warrior', 1], ['homunculus', 1], ['half_troll', 0.4]] },
      valley_se: { name: '枯れ谷', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['root_eater', 2], ['owlbear', 1]] },
      grass_sw: { name: '風の草原', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['fairy', 1], ['root_eater', 1]] },
      gate_n: { name: '北の巡礼門', sizes: [[[4, 7], 0.25], [[2, 3], 0.4], [[1, 1], 0.35]], monsters: [['woodman', 1], ['owlbear', 1], ['wraith', 1]] },
    },
    lighting: { mode: 'night', ambient: 0xc0cae8, ambientIntensity: 3.4, fog: 0x242e48, sight: 62, moon: 1.9, stars: true, torchColor: 0xffa860 },
  },
  {
    // 第4層（仮）：詳しい設定はこれから。上層への門は第3層へ
    id: 4, depth: 4,
    name: '第4層 天空の塔（仮）',
    next: null, prev: 3,
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
    gradeUp: 3,
    monsterScale: { hp: 2.7, attack: 2.1 },
    lighting: { ambient: 0x5a4f88, ambientIntensity: 2.2, fog: 0x07060c, torchColor: 0xb08cff },
  },
  {
    // 試験用の階層（ゲームの中からは行けない。自動テストで戦闘を確かめるのに使う）
    id: 99, depth: 2, test: true,
    name: '試練の間',
    next: null, prev: null,
    nextPortalSpawnRate: 0, prevPortalSpawnRate: 0, riftPortalSpawnRate: 0,
    map: [
      '###############',
      '#S.....#..w...#',
      '#......#......#',
      '#...P..#..P...#',
      '##.#####.###.##',
      '#..g...#...g..#',
      '#.............#',
      '#..w...#...G..#',
      '##.###.#.####.#',
      '#....#...#....#',
      '#....#.w.#....#',
      '#....G...#..g.#',
      '###############',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem' },
    gradeUp: 1,
    monsterScale: { hp: 1.45, attack: 1.35 },
    lighting: { ambient: 0x4f7a5c, ambientIntensity: 2.4, fog: 0x060a07, torchColor: 0xc8ff9a },
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
      '#B...#...g#',
      '#....#....#',
      '#.w..P..w.#',
      '#.........#',
      '#.G..X..G.#',
      '###########',
    ],
    monsterTable: { g: 'goblin', w: 'wolf', G: 'golem', X: 'golem' },
    bossMonster: 'X',      // X の場所の魔物は「亀裂の主」（BOSS）
    gradeUp: 2,
    monsterScale: { hp: 2.2, attack: 1.8 },
    lighting: { ambient: 0x7a3a6a, ambientIntensity: 2.4, fog: 0x0c040a, torchColor: 0xff5ad8 },
  },
];
export const RIFT_FLOOR_ID = 101;

// ------------------------------------------------------------------ レベルと功績
// 功績を上げると経験値が入り、次のレベルに必要な量（expToNext）だけたまるとレベルが上がる。
// レベルが上がると、種族の成長率（RACES[].growth）× (レベル − 1) だけステータスが伸びる
export const LEVEL = { expToNext: lv => lv + 2, max: 50 };
export const FEAT_LOG = 30;
// 功績：exp は手に入る経験値。text の {name} などは game.js で置き換える
export const FEATS = {
  // once: true の功績は一生に 1 回だけ（save.featsDone に記録）
  firstKill: { exp: 1, text: '初めて{name}を倒した' },                       // 魔物の種類ごとに 1 回
  firstDescend: { exp: 1, text: '第{cycle}周期で最初に第{depth}層へ進んだ' },  // 周期ごと・深さ（3 層以降）ごとに 1 回
  newDepth: { exp: 1, text: '初めて第{depth}層に到達した' },                  // 生涯で深さごとに 1 回
  firstRift: { exp: 1, text: '初めて次元の亀裂に入った', once: true },
  survive: { exp: 1, text: '第{depth}層の閉鎖まで生き延びて帰還した', once: true },  // 第2層より深い所から閉鎖で帰還（一生に 1 回）
  abyss: { exp: 1, text: '深淵の魔物（{name}）を倒した', once: true },
  boss: { exp: 2, text: '{name}を倒した', once: true },                       // 亀裂の主
  orcHero: { exp: 3, text: 'オークヒーローを倒した', once: true },
  orcLord: { exp: 5, text: '災厄・オークロードを倒した', once: true },
};

// ------------------------------------------------------------------ 素材（魔物が落とす。拠点で売る・工房で使う）
export const MATERIALS = {
  crude_trinket: { name: '粗末な装身具', price: 6 },
  rusty_blade: { name: '錆びた刃物', price: 8 },
  beast_hide: { name: '獣の毛皮', price: 8 },
  beast_fang: { name: '獣の牙', price: 10 },
  animal_fat: { name: '獣脂', price: 5 },
  fine_hide: { name: '上質な毛皮', price: 28 },
  great_fang: { name: '大牙', price: 70 },
  bone_shard: { name: '骨片', price: 6 },
  cursed_cloth: { name: '呪われた布切れ', price: 24 },
  glow_moss: { name: '光苔', price: 9 },
  ore_chunk: { name: '鉱石のかけら', price: 12 },
  stone_core: { name: '石の核', price: 32 },
  sand_crystal: { name: '砂の結晶', price: 26 },
  shell_plate: { name: '甲殻', price: 36 },
  spirit_dust: { name: '霊の粉', price: 16 },
  spirit_shard: { name: '霊のかけら', price: 40 },
  tree_sap: { name: '樹液', price: 14 },
  hard_bark: { name: '硬い樹皮', price: 12 },
  orc_trophy: { name: 'オークの戦利品', price: 42 },
  raider_blade: { name: '略奪者の剣', price: 60 },
  raider_armor: { name: '略奪者の革鎧', price: 50 },
  veteran_blade: { name: '歴戦の鋼剣', price: 240, rare: 1 },        // 6〜5 等級の略奪者が落とす
  veteran_mail: { name: '歴戦の鎖帷子', price: 210, rare: 1 },
  master_blade: { name: '名工の魔剣', price: 900, rare: 2 },         // 4〜3 等級の略奪者が落とす
  master_armor: { name: '名工の重鎧', price: 780, rare: 2 },
  jeweled_ring: { name: '宝石の指輪', price: 320, rare: 1 },         // 略奪者が冒険者から奪い集めた宝飾品（売る）
  gold_emblem: { name: '黄金の紋章', price: 650, rare: 2 },
  ancient_orb: { name: '古代の宝珠', price: 1400, rare: 2 },
};
// 魔物ごとの素材の種類（ないものは体の型から決める）
const MAT_KIND = {
  goblin: 'goblin', goblin_sword: 'goblin', goblin_archer: 'goblin', hobgoblin: 'goblin', abyss_goblin: 'goblin', kobold: 'gnome', kobold_shield: 'gnome', kobold_spear: 'gnome',
  gnome: 'gnome', fallen_gnome: 'gnome', abyss_gnome: 'gnome',
  ghoul: 'undead', elder_ghoul: 'undead', ghoul_lord: 'undead', abyss_ghoul: 'undead', skeleton_warrior: 'undead', skeleton_archer: 'undead', skeleton_mage: 'undead',
  death_fiend: 'undead', dullahan: 'undead', death_knight: 'undead', homunculus: 'undead',
  sandman: 'sand', sandworm: 'worm', death_worm: 'worm', woodman: 'wood', snake_tree: 'wood', cannibal_tree: 'wood', dryad: 'wood',
  orc_warrior: 'orc', orc_archer: 'orc', orc_shaman: 'orc', orc_great: 'orc', orc_hero: 'orc', orc_lord: 'orc', half_troll: 'orc', werewolf: 'beast',
};
const MAT_BY_KIND = {
  goblin: [['crude_trinket', 0.3], ['rusty_blade', 0.15]],
  gnome: [['ore_chunk', 0.25], ['glow_moss', 0.25]],
  undead: [['bone_shard', 0.3], ['cursed_cloth', 0.08, 8]],
  beast: [['beast_hide', 0.3], ['beast_fang', 0.18], ['animal_fat', 0.3], ['fine_hide', 0.12, 8], ['great_fang', 0.1, 7]],
  stone: [['stone_core', 0.2], ['ore_chunk', 0.25]],
  sand: [['sand_crystal', 0.25], ['stone_core', 0.1]],
  worm: [['shell_plate', 0.25], ['sand_crystal', 0.15]],
  spirit: [['spirit_dust', 0.3], ['spirit_shard', 0.1, 8]],
  wood: [['tree_sap', 0.3], ['hard_bark', 0.25]],
  orc: [['orc_trophy', 0.2], ['rusty_blade', 0.2], ['animal_fat', 0.15]],
};
const KIND_BY_MODEL = { beast: 'beast', golem: 'stone', spirit: 'spirit', worm: 'worm', tree: 'wood', humanoid: 'goblin' };
// その魔物が落とす素材の表 [[素材 ID, 確率], ...]（等級の条件 [, , 最低等級] を満たすものだけ）
export function materialTable(def) {
  if (def.human) return [];   // 略奪者は RAIDERS.drops
  const kind = MAT_KIND[def.id] ?? KIND_BY_MODEL[def.model] ?? 'goblin';
  return MAT_BY_KIND[kind].filter(([, , g]) => g === undefined || def.grade <= g).map(([id, ch]) => [id, ch]);
}
// アイテムの落とし物（どの魔物も、この確率で落とす。持てる数を超えるときは拾えない）
export const ITEM_DROPS = [['potion', 0.04], ['torch', 0.04]];

// ------------------------------------------------------------------ 工房（素材から作る）
// makes: 作れる物（potion 回復薬 / torch 松明 / hone 武器を研ぐ / patch 防具を補強）、needs: 必要な素材、max: 何回まで（強化）
export const RECIPES = [
  { id: 'potion', name: '回復薬', makes: 'potion', needs: { glow_moss: 2 }, desc: '光苔をすりつぶして回復薬を作る。' },
  { id: 'torch', name: '松明', makes: 'torch', needs: { animal_fat: 2 }, desc: '獣脂を布に染み込ませて松明を作る。' },
  { id: 'potion2', name: '回復薬（樹液）', makes: 'potion', needs: { tree_sap: 2 }, desc: '樹液を煮詰めて回復薬を作る。' },
  { id: 'hone', name: '武器を研ぐ', makes: 'hone', stat: 'attack', needs: { ore_chunk: 3, rusty_blade: 2 }, max: 5, bonus: 2, desc: '攻撃力 +2（5 回まで）。' },
  { id: 'patch', name: '防具を補強する', makes: 'patch', stat: 'hp', needs: { beast_hide: 3, bone_shard: 2 }, max: 5, bonus: 6, desc: '最大 HP +6（5 回まで）。' },
  { id: 'hone2', name: '武器を研ぐ（略奪者の剣を使う）', makes: 'hone', needs: { raider_blade: 1, ore_chunk: 1 }, max: 5, desc: '略奪者の剣を溶かして刃を鍛える。攻撃力 +2（研ぐ回数に数える）。' },
  // 上の等級の略奪者の装備から作る強化（研ぐ・補強とは別に数える）。stat: attack（攻撃力）/ hp（最大 HP）
  { id: 'forge', name: '鋼剣で鍛え直す', makes: 'forge', stat: 'attack', needs: { veteran_blade: 1, ore_chunk: 2 }, max: 3, bonus: 6, desc: '歴戦の鋼剣を打ち直して武器に重ねる。攻撃力 +6（3 回まで）。' },
  { id: 'plate', name: '鎖帷子を仕込む', makes: 'plate', stat: 'hp', needs: { veteran_mail: 1, beast_hide: 2 }, max: 3, bonus: 18, desc: '歴戦の鎖帷子を防具の下に仕込む。最大 HP +18（3 回まで）。' },
  { id: 'masterwork', name: '魔剣の刃を移す', makes: 'masterwork', stat: 'attack', needs: { master_blade: 1 }, max: 2, bonus: 15, desc: '名工の魔剣の刃を自分の武器に移す。攻撃力 +15（2 回まで）。' },
  { id: 'masterguard', name: '重鎧の板金を張る', makes: 'masterguard', stat: 'hp', needs: { master_armor: 1 }, max: 2, bonus: 40, desc: '名工の重鎧の板金を防具に張る。最大 HP +40（2 回まで）。' },
  { id: 'patch2', name: '防具を補強する（略奪者の革鎧を使う）', makes: 'patch', needs: { raider_armor: 1, beast_hide: 1 }, max: 5, desc: '略奪者の革鎧を当て布にする。最大 HP +6（補強の回数に数える）。' },
];

// デバッグ用の機能（メニューに「デバッグ」の欄を出す：松明を常に灯す・無敵・魔物を全滅・時間を進める・各階層へワープ）。
// 配布するときは menu: false にする
export const DEBUG = { menu: true };

// ------------------------------------------------------------------ 略奪者
// 迷宮に入った冒険者を襲う人間たち（8〜3 等級）。出現率は低いが、浅い層では魔物以上の脅威になる。
//  ・階層に入ったとき、深さごとの確率（chance）でパーティ（party 人。3 人以上なら頭目つき）が潜んでいる
//  ・獲物を探して階層を歩き回り、一度見つけたらどこまでも追ってくる。魔物と違って安全地帯にも入ってくる
//  ・倒すと装備（売れる・工房で使える）・回復薬・松明・魔石の袋を落とす。上の等級ほど良い物（高く売れる装備や宝飾品）。精髄と魔石は落とさない
export const RAIDERS = {
  byDepth: { 1: { chance: 0.25, party: [1, 2] }, 2: { chance: 0.35, party: [2, 3] }, 3: { chance: 0.2, party: [2, 4] } },
  members: [['raider_sword', 4], ['raider_archer', 2], ['raider_dwarf', 1]],
  leader: 'raider_boss',
  // 等級帯（tier）ごとの落とし物と見た目。上の等級ほど強そうで、良い物を落とす
  //  drops: [[ID, 確率], ...]（同じ ID を複数書くと複数個落とすことがある）。ID は素材・potion・torch・bag（魔石の袋）
  //  bag.count: 魔石の袋に入っている魔石の数 / look: 見た目に重ねる設定 / size: 大きさの倍率
  tiers: [
    { grades: [8, 7], label: '',
      drops: [['raider_blade', 0.45], ['raider_armor', 0.3], ['potion', 0.3], ['torch', 0.25], ['bag', 0.35]],
      bag: { count: [2, 5] }, size: 1, look: {} },
    { grades: [6, 5], label: '手練れ',
      drops: [['veteran_blade', 0.45], ['veteran_mail', 0.35], ['raider_blade', 0.3], ['potion', 0.55], ['potion', 0.3], ['torch', 0.35], ['jeweled_ring', 0.15], ['bag', 0.6]],
      bag: { count: [4, 8] }, size: 1.1,
      look: { armor: 0x8a909a, head: 'helm', pauldron: 0xa8b0bc, belt: 0x4a3a2a, weaponColor: 0xe8eef8, eye: 0xffd040, plume: 0x9a2a2a } },
    { grades: [4, 3], label: '歴戦',
      drops: [['master_blade', 0.5], ['master_armor', 0.4], ['veteran_blade', 0.4], ['veteran_mail', 0.3], ['potion', 0.75], ['potion', 0.5], ['torch', 0.4], ['jeweled_ring', 0.35], ['gold_emblem', 0.25], ['ancient_orb', 0.08], ['bag', 0.9]],
      bag: { count: [6, 12] }, size: 1.2,
      look: { armor: 0x2a2a34, cloth: 0x1a1a22, head: 'helm', pauldron: 0xc8a040, spikes: 0xe0d0a0, belt: 0xc8a040, cape: 0x6a1020, horns: 0xe0d6c0,
        weaponColor: 0x30303a, weaponGlow: 0xff4020, eye: 0xff3010, aura: 0xff5020, shield: 0x2a2a34, shieldMetal: true, shieldBoss: 0xc8a040 } },
  ],
  bag: { grades: [2, 2, 1] },   // 魔石の袋の中身：略奪者の等級 + この数の等級の魔石（9 等級より下にはならない）
  // 略奪者の等級（8〜3 等級）。パーティごとに深さの重み表から 1 つ選ぶ（頭目はそれより 1 つ上。3 等級が上限）。
  // 浅い層ほど低い等級がとても出やすく、高い等級ほど出にくい。1 層の 4・3 等級は 1000 回に 1 回ほど
  gradeWeights: {
    1: { 8: 70, 7: 24, 6: 5, 5: 0.9, 4: 0.09, 3: 0.01 },
    2: { 8: 40, 7: 35, 6: 17, 5: 6, 4: 1.8, 3: 0.2 },
    3: { 8: 18, 7: 30, 6: 28, 5: 16, 4: 6.5, 3: 1.5 },
    deep: { 8: 6, 7: 16, 6: 28, 5: 27, 4: 16, 3: 7 },
  },
  defensePerGrade: 2,   // 等級が 1 つ上がるごとに防御 +2（ステータスは魔物と同じ等級の基準で伸びる）
};
// 略奪者をその等級の強さにした定義を返す（HP・攻撃は GRADE_BASE の比で伸び縮みする）
export function raiderDefAt(id, grade) {
  const b = MONSTERS[id];
  const [h0, a0] = GRADE_BASE[b.grade], [h1, a1] = GRADE_BASE[grade];
  const t = raiderTier(grade);
  const look = { ...b.look, ...t.look, size: (b.look.size ?? 1) * t.size };
  if (b.look.weapon === 'bow') { delete look.shield; delete look.shieldBoss; if (look.head === 'helm' && !t.look.horns) look.head = 'hood'; }   // 弓使いは盾を持たない
  if (b.look.head === 'helm' && b.look.weapon === 'club') look.weaponColor = t.look.weaponColor ?? b.look.weaponColor;
  return { ...b, grade, look, tier: RAIDERS.tiers.indexOf(t), name: `${t.label ? t.label + 'の' : ''}${b.name}［${grade}等級］`,
    hp: Math.round(b.hp * h1 / h0), attack: Math.round(b.attack * a1 / a0),
    defense: Math.max(0, b.defense + (b.grade - grade) * RAIDERS.defensePerGrade) };
}
export function raiderTier(grade) {
  return RAIDERS.tiers.find(t => t.grades.includes(grade)) ?? RAIDERS.tiers[0];
}
export function rollRaiderGrade(depth) {
  const W = RAIDERS.gradeWeights[depth] ?? RAIDERS.gradeWeights.deep;
  const list = Object.entries(W), tot = list.reduce((s, [, w]) => s + w, 0);
  let x = Math.random() * tot;
  for (const [g, w] of list) if ((x -= w) <= 0) return +g;
  return 8;
}

// ------------------------------------------------------------------ 第3層のギミック
// 魔女の目：魔女の森に滞在した時間（hoursPerStack ごと）と、森で倒した魔物（perKill）で蓄積する（最大 max 段階）。
// 最大になると、同じ場所（idleRadius m 以内）に idleSeconds 秒（実時間）留まっただけで強敵が強制的に現れる
export const WITCH_EYE = { max: 10, hoursPerStack: 4, perKill: 1, idleSeconds: 180, idleRadius: 3, monster: 'cannibal_tree' };
// オークの群落地：エリア内のオークの討伐数で、段階的にボスが現れる
export const ORC_TRIGGER = { heroKills: 30, hero: 'orc_hero', lordKills: 80, lord: 'orc_lord' };

// ------------------------------------------------------------------ 古文書（ゲーム内攻略メモ）
// price: 購入価格（ゴールド） / unlock: 条件を満たすと無料で読める（kills: 指定モンスターの累計撃破数）
export const LORE = [
  { id: 'lore_capacity', title: '魂の器について', price: 30,
    text: '器の容量には限りがある。安い精髄で器を埋めてしまった者は、深層で嘆くことになる。' +
          '吸収した精髄は二度と魂から離れない。ただ一つ、忘却の霊薬を除いては。' },
  { id: 'lore_time', title: '閉ざされる迷宮', price: 40,
    text: '迷宮の門は三十日に一度、開放日の夜明け前の数刻だけ開く。' +
          '突入した瞬間から刻が数えられ、第1層は百六十八時間、第2層は二百四十時間、第3層は三百六十時間で閉ざされる。' +
          '閉ざされた層にいた者は、拾ったものを抱えたまま地上へ吐き出される。' },
  { id: 'lore_descend', title: '下層への逃げ込み', price: 70, unlock: { deepest: 2 },
    text: '第1層が閉ざされる直前に下層へ降りれば、その層の閉鎖まで迷宮に留まれる。稼ぎたい者の常套手段だ。' +
          'ただし一度降りた者は、上の層が閉ざされた後には戻れない。早く帰りたければ、閉鎖の前に上層への門を探して戻ることだ。' },
  { id: 'lore_gates', title: '水晶の洞窟の四つの門', price: 50,
    text: '第1層は十字の形をした水晶の洞窟で、東西南北の腕の先にそれぞれ第2層への門がある。' +
          '東は刃狼、西はノーム、南はグール、北はゴブリンの縄張り。中心の空洞、古い記念碑の周りには魔物が近寄らない。' +
          'どの門を通ったかで、たどり着く第2層の地がまったく違う。東は獣の巣窟、南は亡者の地、西は岩の砂漠、北はゴブリンの森だ。' },
  { id: 'lore_second', title: '第2層の四つの地', price: 90, unlock: { deepest: 2 },
    text: '獣の巣窟は分岐だらけの峡谷で、迷えば何日も抜け出せない。亡者の地は暗く泥深いが罠はなく、ひたすら北へ進めば第3層への門に着く。' +
          '岩の砂漠には稀に、砂の下から死の大蚯蚓が現れる。ゴブリンの森は第3層に最も近いが罠だらけで、' +
          '八つの石碑のうち本物は一つだけ。本物が開けば、残りはただの石塊になる。' },
  { id: 'lore_third', title: '巡礼者の道', price: 120, unlock: { deepest: 3 },
    text: '第3層はどの道から来ても一つに合流する広い土地で、中心の尖塔が第4層への入口だ。尖塔を囲む魔女の森では、' +
          '長く留まるほど、殺すほど「魔女の目」が積もる。目が満ちた者が同じ場所に留まれば、人喰い樹が来る。' +
          '森の霊体には刃が通らない。精髄の力で打て。オークの群落地では、オークを狩り続けるとオークヒーローが、さらにその先には災厄が現れる。' },
  { id: 'lore_rift', title: '次元の亀裂', price: 150, unlock: { deepest: 3 },
    text: '第2層には、まれに空間の裂け目が口を開ける。裂け目の中では時が止まり、層の閉鎖も届かない。' +
          '強い魔物がひしめき、奥には亀裂の主が待つ。主はめったに出ない精髄を三度に一度は落とすという。入口の門から元の層へ戻れる。' },
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
  // 魔石の買取価格は STONE_GRADES（等級ごと）
  potion: { name: '回復薬', description: '最大 HP の 50% を回復する。迷宮で R キー／回復ボタン。', price: 30, heal: 0.5, max: 3, cooldown: 1.0 },
  // 松明：暗黒地帯に入ると自動で灯り、自分の近く（sight m）だけ見えるようになる。暗黒地帯の中にいる間だけ燃え、1 本で burnHours 時間（ゲーム内）もつ。
  // 持っていないと、暗黒地帯ではほとんど何も見えない（lighting.darkFog）
  torch: { name: '松明', description: '暗黒地帯に入ると自動で灯り、自分の近くだけ見えるようになる。1 本で暗黒地帯の中を 12 時間（ゲーム内）照らす。', price: 40, max: 5, burnHours: 12, sight: 9, light: 16, lightRange: 11 },
  oblivion: { name: '忘却の霊薬', description: '吸収した精髄を 1 つ魂から取り除く。とても貴重。', price: 400,
    inShop: false },   // いまは手に入らない（入手方法は今後追加）
  // 迷宮から地上へ戻る手段は「階層の閉鎖」「力尽きる（出発前に戻る）」と、この巻物のような特殊な効果だけ
  returnScroll: { name: '帰還の巻物', description: '迷宮の中で読むと、その場から地上へ帰還できる（魔石は持ち帰れる）。近くに魔物がいると読めない。', price: 250, max: 1,
    inShop: false },   // いまは商店で売っていない（入手方法は今後追加）
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
  stones: {},         // 魔石（等級ごとの個数 { 9: 3, 8: 1 }。拠点で換金する）
  gold: 0,
  absorbed: [],       // 吸収済みの精髄 ID
  skillSlots: [],     // セットしたスキル ID（最大 MAX_SKILL_SLOTS）
  potions: 1,
  oblivion: 0,        // 忘却の霊薬の所持数
  returnScrolls: 0,   // 帰還の巻物の所持数
  torches: 0,         // 松明の所持数
  weaponLevel: 0,
  armorLevel: 0,
  lore: [],           // 読めるようになった古文書 ID
  kills: {},          // モンスター ID ごとの累計撃破数
  cycle: 1,           // 地上ゲートの何周期目か
  day: 1,             // 周期の何日目か（1 = 開放日）
  deepest: 1,         // 到達した最も深い階層
  hour: 0,           // 開放日の都市の時刻（0:00〜。開放日だけ時間が流れる）
  runInProgress: false, // 探索中か（探索中にアプリが終了した場合、次の起動で続きから再開する）
  runs: 0,
  clears: 0,
  level: 1,           // レベル（功績で経験値がたまると上がる）
  exp: 0,             // 次のレベルまでにたまっている経験値
  featsDone: {},      // 一生に 1 回だけの功績のうち、もう得たもの { kind: true }
  feats: [],          // 手に入れた功績の記録（新しい順、最大 FEAT_LOG 件）
  cycleDescent: {},   // その周期に、どの深さまで最初に進んだか { cycle: 周期, depths: [3, 4] }
  riftVisited: false, // 次元の亀裂に入ったことがあるか
  mats: {},           // 素材 { 素材 ID: 個数 }
  hone: 0,            // 工房で武器を研いだ回数
  patch: 0,           // 工房で防具を補強した回数
  forge: 0, plate: 0, masterwork: 0, masterguard: 0,   // 上の等級の略奪者の装備を使った強化の回数
};

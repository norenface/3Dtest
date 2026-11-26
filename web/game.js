// 精髄の迷宮
// 3D ダンジョン（一人称視点）・移動と攻撃・敵 3 種・精髄のドロップと吸収・精髄スキル・回復薬・拠点・
// 迷宮の開閉と階層閉鎖のサイクル（time.js の TimeManager）・階層間の門・次元の亀裂。
// ゲームバランスの数値はすべて data.js から読む。入力は input.js、保存は storage.js 経由。
import * as THREE from 'three';
import * as D from './data.js';
import { Input } from './input.js';
import * as Store from './storage.js';
import { normalizeStones, addStone, mergeStones, stoneCount, stoneValue, bestGrade, stoneText, stoneGradeFor } from './stones.js';
import { openHub, hubClockChanged } from './hub.js';
import { makeViewmodel, makeMonster, makeEssenceOrb, makeMagicStone, makePortal, flatMat } from './models.js';
import { GENERATORS } from './mapgen.js';
import { texture, texturedMat, repeatSideUV, roughBox, setBumpEnabled, registerBump } from './textures.js';
import { decorate, buildSkyDome, buildSpire } from './decor.js';
import { TimeManager, floorConfig, closeHoursOf, closeLabel, checkFloorClosure, formatRemaining, isGateOpen, isLateEntry, formatClock } from './time.js';

const $ = sel => document.querySelector(sel);
const STAT_KEYS = ['STR', 'VIT', 'AGI', 'INT', 'MAG', 'MND'];
const STAT_NAMES = { STR: '筋力', VIT: '耐久', AGI: '敏捷', INT: '知力', MAG: '魔力', MND: '精神' };
const T = D.TILE_SIZE;
const F = D.FORMULA;

// ====================================================================== 設定・保存データ
const isTouchDevice = matchMedia('(pointer: coarse)').matches;
const settings = Store.loadSettings({ quality: isTouchDevice ? 'low' : 'high' });
let save = Store.loadGame();

// ====================================================================== 描画の準備
const canvas = $('#view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality === 'high', powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
camera.rotation.order = 'YXZ';   // 一人称視点：左右(yaw) → 上下(pitch)

// 一人称の腕と武器は別のシーンに置き、ワールドの後に重ねて描く（壁にめり込んで見えないようにする）
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
vmScene.add(new THREE.HemisphereLight(0x9aa6c8, 0x2a2018, 1.6));
const vmLight = new THREE.PointLight(0xffc27a, 3, 4, 1.2);
vmLight.position.set(-0.4, 0.3, 0.3);
vmScene.add(vmLight);

function applyQuality() {
  const high = settings.quality === 'high';
  renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 2) : 1);
  renderer.shadowMap.enabled = high;
  if (world.torch) world.torch.castShadow = high;
  setBumpEnabled(high);   // 質感の凹凸は「高」だけ
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = vmCamera.aspect = w / h;
  // 縦長の画面では視野を広げる
  camera.fov = vmCamera.fov = w < h ? 85 : 70;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
}
addEventListener('resize', resize);

const input = new Input($('#app'));

// ====================================================================== ステータス計算
const recipeBonus = id => D.RECIPES.find(r => r.id === id)?.bonus ?? 0;

// ====================================================================== 功績・経験値・レベル
// 功績を上げると経験値が入り、たまるとレベルが上がる（D.FEATS / D.LEVEL）
function gainFeat(kind, vars = {}) {
  try { gainFeatInner(kind, vars); } catch (e) { reportError(e); }
}
// 以前のセーブ（featsDone がない）でも、記録に残っていれば得たことにする
function featInLog(f) {
  const re = new RegExp('^' + f.text.split(/\{\w+\}/).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+') + '$');
  return (save.feats ?? []).some(x => re.test(x.text));
}
function gainFeatInner(kind, vars) {
  const f = D.FEATS[kind];
  if (!f) return;
  if (f.once) {
    save.featsDone ??= {};
    if (save.featsDone[kind] || featInLog(f)) { save.featsDone[kind] = true; return; }
    save.featsDone[kind] = true;
  }
  const text = f.text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  save.exp = (save.exp ?? 0) + f.exp;
  save.feats = [{ text, exp: f.exp, cycle: save.cycle, day: world.time.day }, ...(save.feats ?? [])].slice(0, D.FEAT_LOG);
  if (world.run) world.run.expGained = (world.run.expGained ?? 0) + f.exp;
  log(`功績：${text}（経験値 +${f.exp}）`);
  const p = player.pos.clone(); p.y = 2.4;
  popup(p, `功績 +${f.exp}`, 'gain');
  // レベルアップ
  let up = false;
  while ((save.level ?? 1) < D.LEVEL.max && save.exp >= D.LEVEL.expToNext(save.level ?? 1)) {
    save.exp -= D.LEVEL.expToNext(save.level ?? 1);
    save.level = (save.level ?? 1) + 1;
    up = true;
  }
  if (up) {
    refreshStats(true);
    player.hp = player.st.maxHp;
    burst(new THREE.Vector3(player.pos.x, 1.2, player.pos.z), 0xffe08a, 50, 3, 5);
    const q = player.pos.clone(); q.y = 2.0;
    popup(q, `レベル ${save.level}！`, 'crit');
    log(`レベルが上がった！ Lv ${save.level}（ステータスが伸び、HP が全回復した）`);
  }
}

function computeStats() {
  const race = D.RACES[save.race];
  const stats = { ...race.base };
  // レベル：種族の成長率 × (レベル − 1) だけ伸びる
  const lv = save.level ?? 1;
  for (const [k, g] of Object.entries(race.growth ?? {})) stats[k] += Math.floor(g * (lv - 1));
  const passives = [...race.passives];
  let used = 0;
  for (const id of save.absorbed) {
    const e = D.ESSENCES[id];
    if (!e) continue;
    for (const [k, v] of Object.entries(e.statBonus)) stats[k] += v;
    if (e.passiveSkill) passives.push(e.passiveSkill);
    used += e.cost;
  }
  const mult = (key, field) => passives.reduce((m, p) => m * (D.PASSIVES[p]?.[field] ?? 1), 1);
  const extra = (field) => passives.reduce((s, p) => s + (D.PASSIVES[p]?.[field] ?? 0), 0);
  const weapon = D.HUB.weapons[save.weaponLevel] ?? D.HUB.weapons[0];
  const armor = D.HUB.armors[save.armorLevel] ?? D.HUB.armors[0];
  return {
    race, stats, passives, weapon, armor,
    capacity: race.soulCapacity, used,
    maxHp: Math.round(F.hpBase + stats.VIT * F.hpPerVIT + armor.hpBonus + (save.patch ?? 0) * recipeBonus('patch')),
    maxStamina: Math.round(F.staminaBase + stats.VIT * F.staminaPerVIT + stats.AGI * F.staminaPerAGI),
    attack: stats.STR * F.attackPerSTR + weapon.attackBonus + (save.hone ?? 0) * recipeBonus('hone'),
    level: lv,
    moveSpeed: (F.moveSpeedBase + stats.AGI * F.moveSpeedPerAGI) * mult('', 'moveSpeedMultiplier'),
    meleeMultiplier: mult('', 'meleeDamageMultiplier'),
    damageTakenMultiplier: mult('', 'damageTakenMultiplier') * armor.damageTakenMultiplier,
    flinchMultiplier: mult('', 'flinchMultiplier'),
    extraStones: extra('extraStones'),
  };
}

// ====================================================================== ワールド
const world = {
  floor: null, grid: [], rows: 0, cols: 0,
  root: null, wallMesh: null, pillars: [], pillarGrid: new Map(), torch: null, exit: null,
  regions: null,             // マスごとの地域（生成マップ）
  traps: new Map(), steles: [], projectiles: [], loot: [],
  monsters: [], orbs: [], stones: [],
  time: new TimeManager(),   // ゲーム内の日時（迷宮の中で進む）
  portals: [],               // この階層の門
  riftReturn: null,          // 亀裂に入る前にいた階層 ID
  spawnCells: [],            // 魔物の出現地点（湧きに使う）
  run: null,      // この探索の記録
  state: 'title', // title | playing | absorb | menu | result
  hitStop: 0,
  clock: 0,
};

function cellAt(x, z) {
  const c = Math.round(x / T), r = Math.round(z / T);
  if (r < 0 || r >= world.rows || c < 0 || c >= world.cols) return '#';
  return world.grid[r][c];
}
const isWallCell = (r, c) => r < 0 || r >= world.rows || c < 0 || c >= world.cols || world.grid[r][c] === '#';
const cellCenter = (r, c) => new THREE.Vector3(c * T, 0, r * T);

// 決まった種から作る乱数（毎回同じ見た目にする）
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// arrive: 'start'（上から降りてきた／都市から入った）/ 'fromBelow'（下層から戻った）/ 'fromRift'（亀裂から戻った）
// ====================================================================== ライトクリスタル（迷宮の明かり）
// lighting.mode === 'crystal' の階層では、松明の代わりにクリスタルの周りだけが明るい。
// 光源を数十個置くとスマホでは重いので、床・壁・天井の明るさはマスごとに前もって計算し（glowMap）、自己発光で表す。
// 動く物（魔物・武器）を照らすため、プレイヤーに近いクリスタル 4 つにだけ本物の光源を置く。
const CRYSTAL_REACH = 3;     // クリスタルの光が届くマス数（壁の向こうには届かない）
const CRYSTAL_VIEW = 5;      // 見通しの計算で使うマス数（これより離れた所は暗黒地帯）
// 明るさはマスごとの値を入れたテクスチャ（glowMap）から読む（水晶の迷宮では、歩ける床が明るい青・壁は暗い紺）。壁の面は「面が向いている側の床のマス」の明るさになるので、
// 暗黒地帯に面した壁は暗く、明るい通路に面した壁は明るい。床・天井は隣のマスとなめらかにつながる
function glowMat(color, emissive, intensity, glowMap, texKind = null) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, roughness: 0.9, metalness: 0 });
  if (texKind) { const t = texture(texKind); m.map = t.map; m.bumpMap = t.bump; m.bumpScale = 1.2; registerBump(m); }
  const grid = new THREE.Vector2(world.cols, world.rows);
  m.onBeforeCompile = sh => {
    sh.uniforms.uGlowMap = { value: glowMap };
    sh.uniforms.uGrid = { value: grid };
    sh.uniforms.uTile = { value: T };
    sh.vertexShader = 'varying vec3 vGlowPos;\nvarying vec3 vGlowN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  mat4 glowM = modelMatrix;
  #ifdef USE_INSTANCING
    glowM = modelMatrix * instanceMatrix;
  #endif
  vGlowPos = (glowM * vec4(transformed, 1.0)).xyz;
  vGlowN = normalize(mat3(glowM) * objectNormal);`);
    sh.fragmentShader = 'uniform sampler2D uGlowMap;\nuniform vec2 uGrid;\nuniform float uTile;\nvarying vec3 vGlowPos;\nvarying vec3 vGlowN;\n' +
      sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', `vec2 glowP = vGlowPos.xz + vGlowN.xz * (uTile * 0.5 - 0.02);
  float glowV = texture2D(uGlowMap, (glowP / uTile + 0.5) / uGrid).r;
  vec3 totalEmissiveRadiance = emissive * glowV;`);
  };
  m.customProgramCacheKey = () => 'crystal-glow';
  return m;
}
function makeGlowMap(field) {
  const data = new Uint8Array(world.rows * world.cols * 4);
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    const i = (r * world.cols + c) * 4;
    data[i] = Math.round(Math.min(1, field[r][c]) * 255);
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, world.cols, world.rows, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(cv);
  return glowTex;
}
// 歩けるマスをたどって、クリスタルからの距離で明るさを決める（0〜1）
function crystalField(crystals, reach) {
  const f = Array.from({ length: world.rows }, () => new Float32Array(world.cols));
  for (const [cr, cc] of crystals) {
    const dist = new Map([[cr * 1000 + cc, 0]]);
    const queue = [[cr, cc]];
    while (queue.length) {
      const [r, c] = queue.shift();
      const d = dist.get(r * 1000 + c);
      f[r][c] = Math.max(f[r][c], 1 - d / (reach + 0.6));
      if (d >= reach) continue;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, k = nr * 1000 + nc;
        if (isWallCell(nr, nc) || dist.has(k)) continue;
        dist.set(k, d + 1);
        queue.push([nr, nc]);
      }
    }
  }
  return f;
}
// プレイヤーのいる場所の見通し（0 = 暗黒地帯、1 = 明るい）
function visibilityAt(pos) {
  if (!world.vis) return 1;
  const r = Math.round(pos.z / T), c = Math.round(pos.x / T);
  return world.vis[r]?.[c] ?? 0;
}

function buildCrystals(root, crystals, rnd, L) {
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const shardMat = new THREE.MeshBasicMaterial({ color: L.crystalColor });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, crystals.length * 4);
  const tmp = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const glowPos = [];
  world.crystalPoints = [];
  let n = 0;
  for (const [r, c] of crystals) {
    const p = cellCenter(r, c);
    const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dr, dc]) => isWallCell(r + dr, c + dc));
    const kind = rnd();
    let base, dir;
    if (kind < 0.35 && walls.length) {
      // 壁に付いている
      const [dr, dc] = walls[Math.floor(rnd() * walls.length)];
      base = new THREE.Vector3(p.x + dc * (T / 2 - 0.05), 1.4 + rnd() * 1.0, p.z + dr * (T / 2 - 0.05));
      dir = new THREE.Vector3(-dc, 0.35, -dr).normalize();
    } else if (kind < 0.65) {
      // 天井から下がっている
      base = new THREE.Vector3(p.x + (rnd() - 0.5) * 2, D.WALL_HEIGHT - 0.05, p.z + (rnd() - 0.5) * 2);
      dir = new THREE.Vector3(0, -1, 0);
    } else {
      // 床から生えている
      base = new THREE.Vector3(p.x + (rnd() - 0.5) * 2, 0, p.z + (rnd() - 0.5) * 2);
      dir = up.clone();
    }
    for (let k = 0; k < 4; k++) {
      const len = 0.5 + rnd() * 0.7 * (k === 0 ? 1.6 : 1);
      const d = dir.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.9)).normalize();
      tmp.quaternion.setFromUnitVectors(up, d);
      tmp.scale.set(0.28 + rnd() * 0.12, len * 2, 0.28 + rnd() * 0.12);
      tmp.position.copy(base).addScaledVector(d, len * 0.5).add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3));
      tmp.updateMatrix();
      shards.setMatrixAt(n++, tmp.matrix);
    }
    const center = base.clone().addScaledVector(dir, 0.5);
    glowPos.push(center.x, center.y, center.z);
    world.crystalPoints.push(center);
  }
  root.add(shards);
  // ほのかな光のにじみ
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  const halo = new THREE.Points(pg, new THREE.PointsMaterial({
    size: 3.4, map: glowTexture(), color: L.crystalColor, transparent: true, opacity: 0.75,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  root.add(halo);
  // 本物の光源（プレイヤーに近いクリスタルへ移し替えて使う）
  world.torchLights = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(L.crystalColor, 0, 12, 1.6);
    root.add(l);
    world.torchLights.push({ light: l, base: 10, flame: null });
  }
  world.crystalLightTimer = 0;
}

// プレイヤーに近いクリスタル 4 つに光源を置く
function updateCrystalLights(dt) {
  if (!world.crystalPoints?.length) return;
  world.crystalLightTimer -= dt;
  if (world.crystalLightTimer > 0) return;
  world.crystalLightTimer = 0.3;
  const near = world.crystalPoints
    .map(p => [p, (p.x - player.pos.x) ** 2 + (p.z - player.pos.z) ** 2])
    .sort((a, b) => a[1] - b[1]).slice(0, world.torchLights.length);
  world.torchLights.forEach((t, i) => {
    const p = near[i];
    if (!p || p[1] > 24 * 24) { t.light.visible = false; return; }
    t.light.visible = true;
    t.light.position.copy(p[0]);
  });
}

// 降り立つ場所を選ぶ（randomStart の階層）。ふだんはクリスタルの明かりが届く場所のどこか。
// 閉門間際の入場（late）では lateDarkChance の確率で暗黒地帯になる。魔物の出現地点と門のそばは避ける
function chooseLanding(floorDef, late) {
  const avoid = [];
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    const ch = world.grid[r][c];
    if (floorDef.monsterTable?.[ch] || 'mNURB1234'.includes(ch)) avoid.push([r, c]);
  }
  const lit = [], dark = [];
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (isWallCell(r, c) || avoid.some(([ar, ac]) => Math.abs(ar - r) + Math.abs(ac - c) < 4)) continue;
    if (!world.vis) { lit.push([r, c]); continue; }
    if (world.vis[r][c] < 0.05) dark.push([r, c]);
    else if (world.glow[r][c] >= 0.3) lit.push([r, c]);
  }
  const toDark = late && dark.length > 0 && Math.random() < D.TIME.lateDarkChance;
  const pool = toDark ? dark : lit;
  const cell = pool[Math.floor(Math.random() * pool.length)];
  // 開けている方を向く
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dr, dc]) => !isWallCell(cell[0] + dr, cell[1] + dc));
  const [dr, dc] = dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : [-1, 0];
  return { cell, dark: toDark, yaw: Math.atan2(-dc, -dr) };
}

// 階層のマップ：generator の階層は探索ごとの種から作る（同じ探索中は同じ地形）。固定マップの階層は map をそのまま使う
function floorLayout(floorDef) {
  if (floorDef.generator) {
    const seed = (((world.run?.seed ?? 1) * 2654435761) ^ (floorDef.id * 7919)) >>> 0;
    return GENERATORS[floorDef.generator](seed);
  }
  return { map: floorDef.map, regions: null, arrivals: {}, prevCells: {} };
}

// 見た目のテーマ（床・壁の色、壁の高さ、柱などの小物）
const THEMES = {
  // tex: 床・壁・天井の模様（textures.js） / rough: 壁のでこぼこの大きさ（m）/ texBoost: 模様で暗くなるぶんの色の補正
  stone: { floor: 0x57534c, wall: 0x4a4740, cap: 0x77705f, prop: 'pillar', tex: { floor: 'flagstone', wall: 'bricks', ceil: 'rock' } },
  crystal: { floor: 0x2a4f8c, wall: 0x0e1528, cap: 0x0c1426, prop: 'pillar', rough: 0.35, tex: { floor: 'rock', wall: 'crystalRock', ceil: 'crystalRock' } },
  canyon: { floor: 0x5a4636, wall: 0x7a5440, cap: 0x8a6448, prop: 'boulder', wallH: 9, rough: 0.6, tex: { floor: 'dirt', wall: 'strata' } },
  dead: { floor: 0x5a544c, wall: 0x6a6864, cap: 0x7a7874, prop: 'ruin', wallH: 3, tex: { floor: 'mud', wall: 'bricks' }, floorRough: 0.6 },
  desert: { floor: 0xb89660, wall: 0x9a7650, cap: 0xa88458, prop: 'ruin', wallH: 4.5, rough: 0.45, tex: { floor: 'sand', wall: 'rock' } },
  forest: { floor: 0x2c4628, wall: 0x4a5a3a, cap: 0x56663f, prop: 'tree', wallH: 4, rough: 0.4, tex: { floor: 'grass', wall: 'rock' } },
  pilgrim: { floor: 0x46562e, wall: 0x6a6a60, cap: 0x7a7a6e, prop: 'tree', wallH: 4, rough: 0.4, texBoost: 1.5, tex: { floor: 'grass', wall: 'rock' } },
};
// 第3層はフィールドごとに床の色を変えて、どこにいるかわかるようにする
const FIELD_FLOOR = { witch: 0x2c4a30, hill: 0x67675c, orc: 0x5a4a30, swamp: 0x365444, statue: 0x6a665a, road_w: 0x6a5e44,
  plain_nw: 0x4a5a48, battle_ne: 0x4a3e34, valley_se: 0x6a5a3e, grass_sw: 0x50682e, gate_n: 0x5a5a50 };

const pillarKey = (r, c) => r * 1000 + c;
function addPillar(x, z, r) {
  const k = pillarKey(Math.round(z / T), Math.round(x / T));
  if (!world.pillarGrid.has(k)) world.pillarGrid.set(k, []);
  const p = { x, z, r };
  world.pillarGrid.get(k).push(p);
  world.pillars.push(p);
  return p;
}
function removePillar(p) {
  for (const list of world.pillarGrid.values()) { const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); }
  const i = world.pillars.indexOf(p); if (i >= 0) world.pillars.splice(i, 1);
}

// いる場所の地域（regions のキー）と、その設定
function regionKeyAt(pos) {
  const r = Math.round(pos.z / T), c = Math.round(pos.x / T);
  return world.regions?.[r]?.[c] ?? null;
}
function regionAt(pos) {
  const k = regionKeyAt(pos);
  return k ? world.floor.regions?.[k] ?? null : null;
}
const isSafeCell = (r, c) => { const k = world.regions?.[r]?.[c]; return !!(k && world.floor.regions?.[k]?.safe); };

// 地域の魔物の表から 1 体選ぶ（重みつき。'rare' はまれにしか出ない）
function pickSpecies(region, rnd = Math.random) {
  const list = region.monsters;
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = rnd() * total;
  for (const [id, w] of list) { x -= w; if (x <= 0) return id; }
  return list[0][0];
}

// 群れを出す（中心のまわりの歩けるマスに散らす）
function spawnGroup(region, r, c, count) {
  const cells = [];
  const key0 = world.regions?.[r]?.[c] ?? null;
  for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
    const rr = r + dr, cc = c + dc;
    // 同じ地域のマスだけ（壁の向こうの別の地域に湧かないように）
    if (!isWallCell(rr, cc) && !'PTM'.includes(world.grid[rr][cc]) && !isSafeCell(rr, cc) && (world.regions?.[rr]?.[cc] ?? null) === key0) cells.push([rr, cc]);
  }
  const out = [];
  const groupId = ++world.groupSeq;
  const regionKey = world.regions?.[r]?.[c] ?? null;
  for (let i = 0; i < count; i++) {
    const [rr, cc] = cells[Math.floor(Math.random() * cells.length)] ?? [r, c];
    const p = cellCenter(rr, cc).add(new THREE.Vector3((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 2.4));
    const id = pickSpecies(region);
    const m = spawnMonster(id, p);
    m.home.copy(cellCenter(r, c));
    m.groupId = groupId; m.regionKey = regionKey; m.packIndex = i; m.packSize = count;
    if (D.MONSTERS[id].grade <= 6 && region.monsters.find(e => e[0] === id)?.[2] === 'rare') log(`強大な気配……${D.MONSTERS[id].name}がどこかに現れた。`);
    out.push(m);
  }
  return out;
}

function buildFloor(floorDef, arrive = 'start', restore = null) {
  if (world.root) scene.remove(world.root);
  const root = new THREE.Group();
  world.root = root;
  scene.add(root);
  world.floor = floorDef;
  const layout = floorLayout(floorDef);
  world.layout = layout;
  world.grid = layout.map.map(row => row.split(''));
  world.regions = layout.regions;
  world.rows = world.grid.length;
  world.cols = world.grid[0].length;
  world.pillars = [];
  world.pillarGrid = new Map();
  world.monsters = [];
  world.orbs = [];
  world.stones = [];
  world.loot = [];
  world.portals = [];
  world.spawnCells = [];
  world.traps = new Map();
  world.steles = [];
  world.projectiles = [];
  world.fieldKey = null;
  world.groupSeq = 0;
  world.raiderWarned = false;
  world.reinforce = {};
  for (const el of document.querySelectorAll('.ebar')) el.remove();
  const rnd = seeded(floorDef.id * 7919 + (floorDef.generator ? (world.run?.seed ?? 1) : 0));
  const L = floorDef.lighting;
  const theme = THEMES[floorDef.theme] ?? THEMES.stone;
  const crystalMode = L.mode === 'crystal';
  const night = L.mode === 'night';          // 夜のように暗く、空（高い天井）に星明かり
  const wallH = theme.wallH ?? D.WALL_HEIGHT;
  world.wallH = wallH;

  scene.background = new THREE.Color(L.fog);
  scene.fog = new THREE.Fog(L.fog, night ? L.sight * 0.25 : 14, crystalMode ? L.litFog : night ? L.sight : 42);
  root.add(new THREE.HemisphereLight(L.ambient, night ? 0x2a2a30 : 0x10100c, L.ambientIntensity));
  if (night && L.moon) {
    // 月明かり：開けた土地をうっすら照らす（影は落とさない）
    const moon = new THREE.DirectionalLight(0xc8d4ff, L.moon);
    moon.position.set(world.cols * T * 0.3, 80, world.rows * T * 0.2);
    moon.target.position.set(world.cols * T / 2, 0, world.rows * T / 2);
    root.add(moon, moon.target);
  }
  world.vis = null;
  world.glow = null;
  world.crystalPoints = null;
  world.inDark = false;

  // マスを分類する
  const floorCells = [], wallCells = [];
  let start = null;
  const portalCells = { N: [], U: [], R: [], B: [] };
  const gateCells = [], markers = [], steleCells = [], propCells = [];
  let monument = null;
  for (let r = 0; r < world.rows; r++) {
    for (let c = 0; c < world.cols; c++) {
      const ch = world.grid[r][c];
      if (ch === '#') {
        // 床に接している壁だけ作る
        const touches = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .some(([dr, dc]) => !isWallCell(r + dr, c + dc));
        if (touches) wallCells.push([r, c]);
        continue;
      }
      floorCells.push([r, c]);
      if (ch === 'S') start = [r, c];
      if (portalCells[ch]) portalCells[ch].push([r, c]);
      if (floorDef.gates?.[ch]) gateCells.push([r, c, ch]);
      if (ch === 'm') markers.push([r, c]);
      if (ch === 'T') steleCells.push([r, c]);
      if (ch === 'P') propCells.push([r, c]);
      if (ch === 'M') monument = [r, c];
      if (ch === '^') world.traps.set(pillarKey(r, c), { r, c, revealed: false, cooldown: 0, model: null });
      if (floorDef.monsterTable?.[ch]) world.spawnCells.push({ r, c, id: floorDef.monsterTable[ch] });
    }
  }
  let crystals = [], glowMap = null;
  if (crystalMode) {
    crystals = floorCells.filter(([r, c]) => world.grid[r][c] === 'C');
    world.glow = crystalField(crystals, CRYSTAL_REACH);
    world.vis = crystalField(crystals, CRYSTAL_VIEW);
    // 暗黒地帯（外周）には光が届かない
    if (layout.dark) for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
      if (layout.dark[r][c]) { world.glow[r][c] = 0; world.vis[r][c] = 0; }
    }
    glowMap = makeGlowMap(world.glow);
  }
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  // 床（インスタンス描画）
  // 質感：テーマごとの床・壁・天井の模様（textures.js）。色はインスタンスの色で付ける
  const tx = theme.tex;
  const floorGeo = new THREE.BoxGeometry(T, 0.2, T);
  const floorMat = crystalMode ? glowMat(0x2a4f8c, 0x4a96ee, 0.85, glowMap, tx.floor) : texturedMat(tx.floor, { roughness: theme.floorRough ?? 0.95 });
  const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, floorCells.length);
  floorCells.forEach(([r, c], i) => {
    // 模様の繰り返しが目立たないよう、マスごとに 90° 単位で回す
    tmp.position.set(c * T, -0.1, r * T); tmp.rotation.set(0, Math.floor(rnd() * 4) * Math.PI / 2, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
    floorMesh.setMatrixAt(i, tmp.matrix);
    if (crystalMode) { const v = 0.9 + rnd() * 0.2; floorMesh.setColorAt(i, col.setRGB(v, v, v)); return; }
    const base = FIELD_FLOOR[world.regions?.[r]?.[c]] ?? theme.floor;
    col.set(base).multiplyScalar((0.9 + rnd() * 0.25) * (theme.texBoost ?? 1.25));
    floorMesh.setColorAt(i, col);
  });
  tmp.rotation.set(0, 0, 0);
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  // 壁（インスタンス描画）。洞窟や崖は面をでこぼこにする。高い壁でも模様が伸びないよう縦に繰り返す
  const wallGeo = theme.rough ? roughBox(T, wallH, T, theme.rough, floorDef.id) : new THREE.BoxGeometry(T, wallH, T);
  repeatSideUV(wallGeo, 1, Math.max(1, wallH / T));
  const wallMat = crystalMode ? glowMat(0x0e1528, 0x1c3460, 0.45, glowMap, tx.wall) : texturedMat(tx.wall, { roughness: 0.92, flat: !!theme.rough });
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, wallCells.length);
  wallCells.forEach(([r, c], i) => {
    const hy = 1 + (rnd() - 0.5) * (night ? 0.5 : 0.08);
    tmp.position.set(c * T, wallH * hy / 2, r * T); tmp.scale.set(1, hy, 1);
    tmp.rotation.set(0, theme.rough ? Math.floor(rnd() * 4) * Math.PI / 2 : 0, 0);
    tmp.updateMatrix();
    wallMesh.setMatrixAt(i, tmp.matrix);
    if (crystalMode) { const v = 0.85 + rnd() * 0.3; wallMesh.setColorAt(i, col.setRGB(v, v * 0.96, v * 0.9)); return; }
    col.set(theme.wall).multiplyScalar((0.8 + rnd() * 0.4) * (theme.texBoost ?? 1.25));
    wallMesh.setColorAt(i, col);
  });
  tmp.scale.set(1, 1, 1); tmp.rotation.set(0, 0, 0);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  root.add(wallMesh);
  world.wallMesh = wallMesh;

  if (!night) {
    // 天井（一人称視点では見上げると見える）
    const ceilMat = crystalMode ? glowMat(0x13213e, 0x2a5aa0, 0.45, glowMap, tx.ceil ?? tx.wall) : texturedMat(tx.ceil ?? 'rock', { roughness: 1 });
    const ceil = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.3, T), ceilMat, floorCells.length);
    floorCells.forEach(([r, c], i) => {
      tmp.position.set(c * T, wallH + 0.15, r * T); tmp.rotation.set(0, Math.floor(rnd() * 4) * Math.PI / 2, 0); tmp.updateMatrix();
      ceil.setMatrixAt(i, tmp.matrix);
      const v = crystalMode ? 0.9 + rnd() * 0.2 : 0.2 + rnd() * 0.05;
      ceil.setColorAt(i, col.setRGB(v, v * 0.97, v * 0.93));
    });
    tmp.rotation.set(0, 0, 0);
    ceil.receiveShadow = true;
    root.add(ceil);
    if (!crystalMode) {
      // 天井の梁（4m ごと）
      const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.35, 0.35), texturedMat('bark'), floorCells.length);
      floorCells.forEach(([r, c], i) => {
        tmp.position.set(c * T, wallH - 0.15, r * T - T / 2); tmp.updateMatrix(); beams.setMatrixAt(i, tmp.matrix);
        beams.setColorAt(i, col.set(0x5a4430));
      });
      root.add(beams);
    }
  } else {
    // 夜空：地平線から天頂へのグラデーションと星
    const cx = world.cols * T / 2, cz = world.rows * T / 2;
    buildSkyDome(root, L.fog, L.zenith ?? 0x0c1638, { x: cx, z: cz }, Math.max(world.cols, world.rows) * T * 0.9 + 60);
    if (L.stars) buildStarSky(root, rnd);
  }

  // 壁の上端の縁取り（輪郭をわかりやすくする）
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(T + 0.1, 0.15, T + 0.1), flatMat(theme.cap), wallCells.length);
  wallCells.forEach(([r, c], i) => {
    tmp.position.set(c * T, wallH + 0.07, r * T); tmp.updateMatrix(); capMesh.setMatrixAt(i, tmp.matrix);
  });
  root.add(capMesh);

  // 柱・木・岩・残骸（P）。数が多いのでインスタンス描画にする
  buildProps(root, propCells, theme, rnd, wallH);
  // 飾り（鍾乳石・草むら・霧・水たまり・漂う光など。テーマごと）
  world.decorAnims = [];
  decorate(root, { theme: floorDef.theme, floorCells, wallCells, grid: world.grid, regions: world.regions, dark: layout.dark, glow: world.glow,
    rnd, wallH, cellCenter, isWallCell, T, anims: world.decorAnims });
  // 第3層の中心の尖塔
  world.spire = null;
  if (floorDef.theme === 'pilgrim') world.spire = buildSpire(root, cellCenter(Math.floor(world.rows / 2), Math.floor(world.cols / 2)));
  // 瓦礫（石の回廊だけ）
  if (floorDef.theme === undefined) {
    for (const [r, c] of floorCells) {
      if (world.grid[r][c] !== '.' || rnd() >= 0.18) continue;
      const p = cellCenter(r, c);
      for (let k = 0; k < 3; k++) {
        const s = 0.15 + rnd() * 0.3;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flatMat(0x4c4842));
        rock.position.set(p.x + (rnd() - 0.5) * 3, s * 0.6, p.z + (rnd() - 0.5) * 3);
        rock.rotation.set(rnd() * 3, rnd() * 3, 0);
        root.add(rock);
      }
    }
  }
  // 記念碑（第1層の中心。周りは安全地帯）
  if (monument) {
    const p = cellCenter(...monument);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.5, 8), flatMat(0x6a7488)); base.position.set(p.x, 0.25, p.z); root.add(base);
    const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 3.2, 4), flatMat(0x8a94a8)); obelisk.position.set(p.x, 2.1, p.z); obelisk.rotation.y = Math.PI / 4; obelisk.castShadow = true; root.add(obelisk);
    const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshBasicMaterial({ color: 0xbfe8ff })); rune.position.set(p.x, 4.0, p.z); root.add(rune);
    world.monumentRune = rune;
    addPillar(p.x, p.z, 1.4);
  }
  // 石碑（ゴブリンの森）：どれか 1 つが第3層への門になる（探索ごとに決まる）
  if (steleCells.length) {
    const flags = runFlags(floorDef.id);
    const trueIndex = Math.floor(seeded((world.run?.seed ?? 1) * 13 + floorDef.id)() * steleCells.length);
    steleCells.forEach(([r, c], i) => {
      const p = cellCenter(r, c);
      const st = { r, c, pos: p, isTrue: i === trueIndex, state: flags.steleOpened === undefined ? 'sleep' : (i === flags.steleOpened ? 'open' : 'rubble') };
      world.steles.push(st);
      if (st.state === 'open') { addPortal('next', [r, c], floorDef.next); return; }
      st.model = makeStele(st.state === 'rubble');
      st.model.position.set(p.x, 0, p.z);
      root.add(st.model);
      st.pillar = addPillar(p.x, p.z, 0.8);
    });
  }

  // 明かり：クリスタル（第1層）／松明（固定マップ・砂漠の残骸）
  if (crystalMode) buildCrystals(root, crystals, rnd, L);
  else world.torchLights = buildTorches(root, wallCells, propCells, rnd, L, night, wallH);

  // 門
  const pick = (cells, rate, atLeastOne) => {
    const chosen = cells.filter(() => Math.random() < rate);
    if (atLeastOne && !chosen.length && cells.length && rate > 0) chosen.push(cells[Math.floor(Math.random() * cells.length)]);
    return chosen;
  };
  if (restore) {
    for (const p of restore.portals) addPortal(p.kind, p.cell, p.target, p.rot);
  } else {
    // 第1層の東西南北の門
    for (const [r, c, ch] of gateCells) addPortal('next', [r, c], floorDef.gates[ch].target, null, floorDef.gates[ch].label);
    if (floorDef.generator) {
      // 生成マップ：N と U はそのまま門になる（第3層の上層への門は、来たエリアへ戻る 1 つだけ）
      if (floorDef.next) for (const cell of portalCells.N) addPortal('next', cell, floorDef.next);
      if (floorDef.prev === 'via') {
        const via = world.run?.via ?? 22;
        if (layout.prevCells[via]) addPortal('prev', layout.prevCells[via], via);
      } else if (floorDef.prev) for (const cell of portalCells.U) addPortal('prev', cell, floorDef.prev);
    } else {
      if (floorDef.next) for (const cell of pick(portalCells.N, floorDef.nextPortalSpawnRate, true)) addPortal('next', cell, floorDef.next);
      if (floorDef.prev) for (const cell of pick(portalCells.U, floorDef.prevPortalSpawnRate, false)) addPortal('prev', cell, floorDef.prev);
    }
    // 亀裂から戻ってきたときは、亀裂の門を必ず置く（そこから出てくる）
    const riftCells = arrive === 'fromRift' ? portalCells.R.slice(0, 1) : pick(portalCells.R, floorDef.riftPortalSpawnRate ?? 0, false);
    for (const cell of riftCells) addPortal('rift', cell, D.RIFT_FLOOR_ID);
    for (const cell of portalCells.B) addPortal('back', cell, world.riftReturn ?? 1);
  }

  // プレイヤーの到着位置
  let sp = cellCenter(...(start ?? portalCells.B[0] ?? floorCells[0]));
  const near = kind => world.portals.find(p => p.kind === kind);
  const beside = p => {
    // 門の向きに合わせて、くぐってきた側に出る
    const a = p.model.group.rotation.y;
    for (const s of [1, -1]) {
      const q = p.pos.clone().add(new THREE.Vector3(Math.sin(a) * 2 * s, 0, Math.cos(a) * 2 * s));
      if (cellAt(q.x, q.z) !== '#') return q;
    }
    return p.pos.clone().add(new THREE.Vector3(0, 0, 1.8));
  };
  if (arrive === 'fromBelow') {
    // 下の層から戻ってきた：その層へ続く門のそば
    const p = world.portals.find(p => p.kind === 'next' && p.target === world.arriveFrom) ?? near('next');
    if (p) sp = beside(p);
  }
  if (arrive === 'fromAbove' && layout.arrivals[world.arriveFrom]) sp = cellCenter(...layout.arrivals[world.arriveFrom]);
  if (arrive === 'fromRift' && near('rift')) sp = beside(near('rift'));
  if (floorDef.isSpecialRift && near('back')) sp = beside(near('back'));
  player.pos.copy(sp);
  player.facing = Math.PI;  // +Z 方向（ダンジョンの奥）を向く
  world.landedInDark = false;
  if (arrive === 'start' && floorDef.randomStart && !restore) {
    const land = chooseLanding(floorDef, world.entryLate);
    sp = cellCenter(...land.cell);
    player.pos.copy(sp);
    player.facing = land.yaw;
    world.landedInDark = land.dark;
  }
  if (arrive === 'fromAbove' || (arrive === 'start' && floorDef.generator && !floorDef.randomStart)) {
    // 階層の中心のほうを向く。すぐそばに上層への門があれば、門に背を向ける
    const cx = world.cols * T / 2, cz = world.rows * T / 2;
    player.facing = Math.atan2(-(cx - player.pos.x), -(cz - player.pos.z));
    player.facing = openestDirection(player.pos);
  }
  if (restore) { player.pos.set(restore.player.x, 0, restore.player.z); player.facing = restore.player.yaw; }
  collide(player.pos, 0.45);
  camState.yaw = player.facing;
  camState.pitch = -0.08;

  // プレイヤーの松明（影を落とす唯一の光源）
  // 水晶の洞窟では手元を照らす程度（暗黒地帯では先が見えない）
  world.torchBase = crystalMode ? 4 : night ? 13 : 14;
  world.torchRange = crystalMode ? 8 : 18;
  const torch = new THREE.PointLight(0xffc27a, world.torchBase, world.torchRange, 1.5);
  torch.castShadow = settings.quality === 'high';
  torch.shadow.mapSize.set(512, 512);
  torch.shadow.bias = -0.002;
  root.add(torch);
  world.torch = torch;

  // モンスター
  if (restore) {
    for (const m of restore.monsters) {
      const mon = spawnMonster(m.id, new THREE.Vector3(m.x, 0, m.z), !!m.boss);
      mon.home.set(m.hx, 0, m.hz);
      mon.hp = Math.min(mon.maxHp, m.hp);
      mon.regionKey = m.rk ?? null; mon.groupId = m.gid ?? 0; mon.packIndex = m.pi ?? 0; mon.packSize = m.ps ?? 1;
      world.groupSeq = Math.max(world.groupSeq, mon.groupId);
    }
    for (const o of restore.orbs) placeOrb(o.id, o.x, o.z);
    for (const [x, z, grade] of restore.stones) placeStone(x, z, grade ?? 9);
    for (const [x, z, kind, id, payload] of restore.loot ?? []) placeLoot(x, z, kind, id, payload);
  } else {
    for (const sc of world.spawnCells) spawnMonster(sc.id, cellCenter(sc.r, sc.c), world.grid[sc.r][sc.c] === floorDef.bossMonster);
    // 群れ（地域ごとの魔物の表から）
    for (const [r, c] of markers) {
      const region = floorDef.regions[world.regions[r][c]];
      if (!region?.monsters?.length) continue;
      // sizes があれば、集団・複数・単体を割合で選ぶ
      let [lo, hi] = region.group ?? [1, 1];
      if (region.sizes) {
        let x = Math.random() * region.sizes.reduce((s, [, w]) => s + w, 0);
        for (const [range, w] of region.sizes) { x -= w; if (x <= 0) { [lo, hi] = range; break; } }
      }
      spawnGroup(region, r, c, lo + Math.floor(Math.random() * (hi - lo + 1)));
    }
    // 深淵の侵食（第1層の特殊な条件）
    if (floorDef.abyss && arrive === 'start' && Math.random() < (world.forceAbyss ? 1 : floorDef.abyss.chance)) {
      for (const [reg, id] of Object.entries(floorDef.abyss.monsters)) {
        const cand = markers.filter(([r, c]) => world.regions[r][c] === reg);
        const [r, c] = cand[Math.floor(Math.random() * cand.length)] ?? markers[0];
        spawnMonster(id, cellCenter(r, c));
      }
      world.abyssEvent = true;
    } else world.abyssEvent = false;
  }
  // 略奪者：深さごとの確率で、パーティが潜んでいる（亀裂・試験用の階層にはいない）
  if (!restore && !floorDef.isSpecialRift && !floorDef.test) {
    const R = D.RAIDERS.byDepth[floorDef.depth];
    // （自動テストで window.__testNoRaiders を立てたときは出さない）
    if (R && !window.__testNoRaiders && (world.forceRaiders || Math.random() < R.chance)) spawnRaiders(R.party, 28);
  }
  // 落とし物（素材・回復薬・松明・魔石の袋）や精髄・魔石を、見えない所に 1 つずつ置いて描画の準備を先に済ませる
  // （スマホでは初めて画面に出る物の準備に時間がかかり、倒した瞬間に一瞬固まることがあるため）
  warmUpDrops(root);
  // 日付が変わったときの出現地点（群れの場所）
  for (const [r, c] of markers) world.spawnCells.push({ r, c, region: world.regions[r][c] });
}

// いちばん先まで見通せる向き（到着したとき、壁や門ではなく開けた方を向く）
function openestDirection(pos) {
  let best = 0, bestLen = -1;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, dx = -Math.sin(a), dz = -Math.cos(a);
    let len = 0;
    while (len < 40 && cellAt(pos.x + dx * len, pos.z + dz * len) !== '#' && !'PTUN'.includes(cellAt(pos.x + dx * len, pos.z + dz * len)) || len < 1) len += 0.5;
    if (len > bestLen) { bestLen = len; best = a; }
  }
  return best;
}

// 夜空（高い天井に天の川のように散らばる光）
function buildStarSky(root, rnd) {
  const n = 900, pos = [];
  const cx = world.cols * T / 2, cz = world.rows * T / 2, R = Math.max(world.cols, world.rows) * T;
  for (let i = 0; i < n; i++) {
    // 帯状に多く集める（天の川）
    const band = rnd() < 0.6;
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * R;
    let x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (band) { const t = (rnd() - 0.5) * 2 * R; x = cx + t; z = cz + t * 0.4 + (rnd() - 0.5) * R * 0.25; }
    pos.push(x, 40 + rnd() * 12, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.9 }));
  root.add(stars);
}

// 柱・木・岩・残骸（P のマス）
function buildProps(root, cells, theme, rnd, wallH) {
  if (!cells.length) return;
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const kindAt = (r, c) => {
    if (theme.prop !== 'tree') return theme.prop;
    const reg = world.regions?.[r]?.[c];
    if (reg === 'statue') return 'ruin';
    if (reg === 'hill' || reg === 'valley_se' || reg === 'battle_ne') return rnd() < 0.6 ? 'boulder' : 'tree';
    return 'tree';
  };
  const groups = { pillar: [], boulder: [], ruin: [], tree: [] };
  for (const [r, c] of cells) groups[kindAt(r, c)].push([r, c]);
  const inst = (geo, mat, list, place) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((cell, i) => { place(cell, tmp, i); tmp.updateMatrix(); m.setMatrixAt(i, tmp.matrix); if (m.instanceColor || cell.color) m.setColorAt(i, cell.color ?? col.set(0xffffff)); });
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  };
  // 柱
  inst(new THREE.CylinderGeometry(0.55, 0.65, wallH, 8), texturedMat('bricks'), groups.pillar.map(cell => Object.assign(cell, { color: new THREE.Color(0x8a867e) })), ([r, c], o) => {
    const p = cellCenter(r, c); o.position.set(p.x, wallH / 2, p.z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); addPillar(p.x, p.z, 0.75); });
  // 岩
  inst(new THREE.DodecahedronGeometry(1.2, 1), texturedMat('rock', { flat: true }), groups.boulder.map(cell => Object.assign(cell, { color: new THREE.Color(theme.wall).multiplyScalar(1.0 + rnd() * 0.5) })), ([r, c], o) => {
    const p = cellCenter(r, c); const s = 0.8 + rnd() * 0.6;
    o.position.set(p.x + (rnd() - 0.5), s * 0.7, p.z + (rnd() - 0.5)); o.rotation.set(rnd() * 3, rnd() * 3, 0); o.scale.set(s, s * 0.9, s); addPillar(o.position.x, o.position.z, 1.1 * s); });
  // 残骸（折れた柱）
  inst(new THREE.BoxGeometry(1.1, 1, 1.1), texturedMat('bricks'), groups.ruin.map(cell => Object.assign(cell, { color: new THREE.Color(theme.cap).multiplyScalar(1.0 + rnd() * 0.4) })), ([r, c], o) => {
    const p = cellCenter(r, c); const h = 1 + rnd() * 2.5;
    o.position.set(p.x, h / 2, p.z); o.rotation.set((rnd() - 0.5) * 0.25, rnd() * 3, (rnd() - 0.5) * 0.25); o.scale.set(1, h, 1); addPillar(p.x, p.z, 0.8); });
  // 木：幹と葉
  const trees = groups.tree.map(([r, c]) => {
    const p = cellCenter(r, c);
    const witch = world.regions?.[r]?.[c] === 'witch';
    return { x: p.x + (rnd() - 0.5) * 1.5, z: p.z + (rnd() - 0.5) * 1.5, h: (witch ? 6 : 4) + rnd() * 3, s: 0.8 + rnd() * 0.6,
      color: new THREE.Color(witch ? 0x1a3a26 : floorDefLeaf()).multiplyScalar(0.75 + rnd() * 0.5) };
  });
  function floorDefLeaf() { return world.floor.theme === 'forest' ? 0x2f5a2a : 0x3f6a32; }
  inst(new THREE.CylinderGeometry(0.25, 0.4, 1, 6), texturedMat('bark'), trees.map(t => ({ ...t, color: new THREE.Color(0x6a4a34) })), (t, o) => {
    o.position.set(t.x, t.h / 2, t.z); o.rotation.set(0, 0, 0); o.scale.set(t.s, t.h, t.s); addPillar(t.x, t.z, 0.45 * t.s + 0.1); });
  inst(new THREE.ConeGeometry(1.6, 3.2, 7), flatMat(0xffffff), trees, (t, o) => {
    o.position.set(t.x, t.h + 0.6, t.z); o.rotation.set(0, rnd() * 3, 0); o.scale.set(t.s, t.s, t.s); });
}

// 松明：壁に付いた松明（固定マップ）や、砂漠の残骸の松明。光る松明は 4 つまで（残りは見た目だけ）
function buildTorches(root, wallCells, propCells, rnd, L, night, wallH) {
  const candidates = [];
  if (!night) {
    for (const [r, c] of wallCells) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isWallCell(r + dr, c + dc)) candidates.push({ x: c * T + dc * (T / 2 + 0.08), z: r * T + dr * (T / 2 + 0.08), y: 2.1 });
    }
  } else if (L.torches) {
    for (const [r, c] of propCells) { const p = cellCenter(r, c); candidates.push({ x: p.x + 0.7, z: p.z + 0.7, y: 1.6, stand: true }); }
  }
  if (!candidates.length) return [];
  const count = Math.min(night ? 40 : 14, candidates.length);
  const lit = [];
  const holderGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12), flameGeo = new THREE.ConeGeometry(0.12, 0.32, 5);
  const flameMat = new THREE.MeshBasicMaterial({ color: L.torchColor });
  const used = new Set();
  for (let i = 0; i < count; i++) {
    const k = Math.floor(rnd() * candidates.length);
    if (used.has(k)) continue;
    used.add(k);
    const t = candidates[k];
    const holder = new THREE.Mesh(t.stand ? new THREE.CylinderGeometry(0.05, 0.07, 1.6, 5) : holderGeo, flatMat(0x3a2a1a));
    holder.position.set(t.x, t.stand ? 0.8 : t.y, t.z); root.add(holder);
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(t.x, t.y + (t.stand ? 0.1 : 0.4), t.z); root.add(flame);
    if (lit.length < 4) lit.push({ x: t.x, z: t.z, y: t.y + 0.5, flame });
  }
  return lit.map(t => {
    const l = new THREE.PointLight(L.torchColor, 14, 13, 1.8);
    l.position.set(t.x, t.y, t.z);
    root.add(l);
    return { light: l, base: 14, flame: t.flame };
  });
}

// 石碑（ゴブリンの森）。rubble ならただの石塊
function makeStele(rubble) {
  const g = new THREE.Group();
  if (rubble) {
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + i * 0.1, 0), flatMat(0x6a6a62)); b.position.set((i - 1) * 0.5, 0.3, (i % 2) * 0.3); g.add(b); }
    return g;
  }
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.6, 0.5), flatMat(0x7a7a72)); slab.position.y = 1.3; slab.castShadow = true; g.add(slab);
  const rune = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x9a9aff, emissive: 0x5a5aff, emissiveIntensity: 0.6 }));
  rune.position.set(0, 1.5, -0.27); g.add(rune);
  rune.name = 'rune';
  return g;
}

// 探索中の階層ごとの記録（石碑・魔女の目・オークの討伐数など）
function runFlags(floorId) {
  if (!world.run) return {};
  world.run.flags ??= {};
  return (world.run.flags[floorId] ??= {});
}

function addPortal(kind, [r, c], target, rot = null, label = null) {
  // 上層への門は、上の層がすでに閉鎖されていたら閉ざされている（突入からの経過時間で判定）
  const closed = kind === 'prev' && checkFloorClosure(world.time.elapsed, target);
  const model = makePortal(kind, closed);
  const pos = cellCenter(r, c);
  model.group.position.copy(pos);
  // 門は通路の向きに合わせる（南北に開いていれば南北を向く。行き止まりの切れ込みでは開いた側を向く）
  const openNS = !isWallCell(r - 1, c) || !isWallCell(r + 1, c), openEW = !isWallCell(r, c - 1) || !isWallCell(r, c + 1);
  const auto = openNS && !openEW ? 0 : openEW && !openNS ? Math.PI / 2 : (Math.random() < 0.5 ? 0 : Math.PI / 2);
  model.group.rotation.y = rot ?? auto;
  world.root.add(model.group);
  world.portals.push({ kind, pos, model, target, closed, cell: [r, c], label });
  // 門の柱にぶつかるようにする（くぐる中央は通れる）
  const ax = Math.cos(model.group.rotation.y), az = -Math.sin(model.group.rotation.y);
  for (const s of [-1, 1]) addPillar(pos.x + ax * 1.1 * s, pos.z + az * 1.1 * s, 0.3);
}

// ====================================================================== プレイヤー
const player = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), facing: 0,
  hp: 1, stamina: 1, attackTimer: 0, attackCooldown: 0, hitDone: false,
  flinch: 0, invuln: 0, staminaDelay: 0, walkPhase: 0, dead: false,
  attackKind: 'normal',        // normal（通常攻撃） / skill（急所突きなどの近接スキル）
  attackSkill: null,
  skillCooldowns: {},          // スキル ID → 残り秒数
  guardTimer: 0, guardMultiplier: 1,
  potionCooldown: 0,
  viewmodel: makeViewmodel(D.RACES.barbarian.color),
  st: null,
};

function refreshStats(keepRatio = true) {
  const before = player.st;
  player.st = computeStats();
  if (keepRatio && before) {
    player.hp = Math.min(player.st.maxHp, player.hp * player.st.maxHp / before.maxHp);
    player.stamina = Math.min(player.st.maxStamina, player.stamina * player.st.maxStamina / before.maxStamina);
  } else {
    player.hp = player.st.maxHp;
    player.stamina = player.st.maxStamina;
  }
}

// ====================================================================== モンスター
// boss: 亀裂の主（D.BOSS の倍率で強く・大きくなり、精髄を BOSS.essenceChance の確率で落とす）
function spawnMonster(id, pos, boss = false, grade = null) {
  const B = D.BOSS;
  const base = grade ? D.raiderDefAt(id, grade) : D.MONSTERS[id];
  const def = boss ? { ...base, name: `${B.title}（${base.name}）`, radius: base.radius * B.size, attackRange: base.attackRange * B.size,
    knockbackResist: Math.max(base.knockbackResist, 0.9) } : base;
  const s0 = world.floor.monsterScale ?? { hp: 1, attack: 1 };
  const scale = boss ? { hp: s0.hp * B.hp, attack: s0.attack * B.attack } : s0;
  const model = makeMonster(def.model, def.look);
  if (boss) model.group.scale.setScalar(B.size);
  // 被弾時に個体ごと光らせるため、マテリアルを複製する
  const mats = [];
  model.group.traverse(o => {
    // 光らせる演出は emissive を持つマテリアルだけ（MeshBasicMaterial の光る部品は対象外）
    if (o.isMesh) { o.material = o.material.clone(); if (o.material.emissive) mats.push(o.material); o.castShadow = true; }
  });
  model.group.position.copy(pos);
  world.root.add(model.group);
  const bar = document.createElement('div');
  bar.className = 'ebar hidden';
  bar.innerHTML = '<i></i>';
  $('#enemy-bars').appendChild(bar);
  const m = {
    def, model, mats, bar,
    pos: pos.clone(), home: pos.clone(), vel: new THREE.Vector3(), facing: Math.random() * Math.PI * 2,
    hp: Math.round(def.hp * scale.hp), maxHp: Math.round(def.hp * scale.hp),
    attack: Math.round(def.attack * scale.attack),
    stoneGrade: stoneGradeFor(id, world.floor, boss),   // 落とす魔石の等級（強いほど高い）
    boss,
    state: 'idle', timer: 0, cooldown: 0, flash: 0, anim: Math.random() * 10, stun: 0,
    path: null, pathTimer: 0, aggro: false, wanderTarget: null, deadTimer: 0,
  };
  world.monsters.push(m);
  return m;
}

// ====================================================================== 当たり判定（マス目の壁と柱）
function collide(pos, radius) {
  const r0 = Math.round(pos.z / T), c0 = Math.round(pos.x / T);
  for (let iter = 0; iter < 2; iter++) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = r0 + dr, c = c0 + dc;
        if (!isWallCell(r, c)) continue;
        const minX = c * T - T / 2, maxX = c * T + T / 2, minZ = r * T - T / 2, maxZ = r * T + T / 2;
        const cx = Math.max(minX, Math.min(pos.x, maxX)), cz = Math.max(minZ, Math.min(pos.z, maxZ));
        const dx = pos.x - cx, dz = pos.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x += dx / d * (radius - d); pos.z += dz / d * (radius - d);
          } else {
            // 壁の中に入り込んだときは一番近い面へ押し出す
            const pens = [[pos.x - minX + radius, -1, 0], [maxX - pos.x + radius, 1, 0], [pos.z - minZ + radius, 0, -1], [maxZ - pos.z + radius, 0, 1]];
            pens.sort((a, b) => a[0] - b[0]);
            pos.x += pens[0][1] * pens[0][0]; pos.z += pens[0][2] * pens[0][0];
          }
        }
      }
    }
    // 柱・木・岩（近くのマスのものだけ調べる）
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const list = world.pillarGrid.get(pillarKey(r0 + dr, c0 + dc));
      if (!list) continue;
      for (const p of list) {
        const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz), min = p.r + radius;
        if (d < min && d > 1e-6) { pos.x += dx / d * (min - d); pos.z += dz / d * (min - d); }
      }
    }
  }
}

// 2 点間に壁がないか（0.5m 刻みで調べる）
function lineOfSight(a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.ceil(dist / 0.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (cellAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) === '#') return false;
  }
  return true;
}

// マス目の幅優先探索で、目標へ向かう次のマスの中心を返す
// allowSafe：安全地帯も通る（略奪者）。maxDist：どこまで探すか（マス。略奪者は階層の端から端まで探す）
function nextStepToward(from, to, allowSafe = false, maxDist = 30) {
  const sr = Math.round(from.z / T), sc = Math.round(from.x / T);
  const tr = Math.round(to.z / T), tc = Math.round(to.x / T);
  if (sr === tr && sc === tc) return to.clone();
  const key = (r, c) => r * world.cols + c;
  const prev = new Map([[key(sr, sc), -1]]);
  const queue = [[sr, sc]];
  for (let qi = 0; qi < queue.length; qi++) {
    const [r, c] = queue[qi];
    if (r === tr && c === tc) break;
    if (Math.abs(r - sr) + Math.abs(c - sc) > maxDist) continue;   // 遠すぎる所までは探さない
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      // 魔物は壁・木などの障害物・安全地帯を通れない
      if (isWallCell(nr, nc) || 'PTM'.includes(world.grid[nr][nc]) || (!allowSafe && isSafeCell(nr, nc)) || prev.has(key(nr, nc))) continue;
      prev.set(key(nr, nc), key(r, c));
      queue.push([nr, nc]);
    }
  }
  let k = key(tr, tc);
  if (!prev.has(k)) return null;
  while (prev.get(k) !== key(sr, sc) && prev.get(k) !== -1) k = prev.get(k);
  return cellCenter(Math.floor(k / world.cols), k % world.cols);
}

// ====================================================================== 演出（粒子・ダメージ表示・ヒットストップ）
const MAX_PARTICLES = 500;
const particles = {
  pos: new Float32Array(MAX_PARTICLES * 3), col: new Float32Array(MAX_PARTICLES * 3),
  vel: new Float32Array(MAX_PARTICLES * 3), life: new Float32Array(MAX_PARTICLES), grav: new Float32Array(MAX_PARTICLES).fill(9), next: 0,
};
const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(particles.pos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(particles.col, 3));
const pMesh = new THREE.Points(pGeo, new THREE.PointsMaterial({
  size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
pMesh.frustumCulled = false;
scene.add(pMesh);
for (let i = 0; i < MAX_PARTICLES; i++) particles.pos[i * 3 + 1] = -999;

function burst(pos, color, count = 16, speed = 4, up = 2) {
  const c = new THREE.Color(color);
  for (let n = 0; n < count; n++) {
    const i = particles.next; particles.next = (particles.next + 1) % MAX_PARTICLES;
    particles.pos.set([pos.x, pos.y, pos.z], i * 3);
    const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
    particles.vel.set([Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s], i * 3);
    particles.col.set([c.r, c.g, c.b], i * 3);
    particles.life[i] = 0.5 + Math.random() * 0.4;
    particles.grav[i] = 9;
  }
}

// 1 粒だけ出す（重力なしで漂う光など）
function spawnParticle(pos, color, vel, life = 2) {
  const c = new THREE.Color(color);
  const i = particles.next; particles.next = (particles.next + 1) % MAX_PARTICLES;
  particles.pos.set([pos.x, pos.y, pos.z], i * 3);
  particles.vel.set([vel.x, vel.y, vel.z], i * 3);
  particles.col.set([c.r, c.g, c.b], i * 3);
  particles.life[i] = life;
  particles.grav[i] = 0;
}

function updateParticles(dt) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particles.life[i] <= 0) continue;
    particles.life[i] -= dt;
    const k = i * 3;
    particles.vel[k + 1] -= particles.grav[i] * dt;
    particles.pos[k] += particles.vel[k] * dt;
    particles.pos[k + 1] = Math.max(0.05, particles.pos[k + 1] + particles.vel[k + 1] * dt);
    particles.pos[k + 2] += particles.vel[k + 2] * dt;
    const fade = particles.grav[i] ? Math.max(0, particles.life[i] / 0.9) : 1;
    particles.col[k] *= 0.97 + 0.03 * fade; particles.col[k + 1] *= 0.97 + 0.03 * fade; particles.col[k + 2] *= 0.97 + 0.03 * fade;
    if (particles.life[i] <= 0) particles.pos[k + 1] = -999;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
}

const popups = [];
function popup(pos, text, cls = '') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.textContent = text;
  $('#popups').appendChild(el);
  popups.push({ el, pos: pos.clone(), t: 0 });
}

const screenPos = new THREE.Vector3();
function toScreen(p, out) {
  screenPos.copy(p).project(camera);
  out.x = (screenPos.x * 0.5 + 0.5) * innerWidth;
  out.y = (-screenPos.y * 0.5 + 0.5) * innerHeight;
  out.visible = screenPos.z < 1;
  return out;
}

function updatePopups(dt) {
  const s = {};
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.t += dt;
    p.pos.y += dt * 1.4;
    toScreen(p.pos, s);
    p.el.style.left = s.x + 'px';
    p.el.style.top = s.y + 'px';
    p.el.style.opacity = String(Math.max(0, 1 - p.t / 0.9));
    if (p.t > 0.9 || !s.visible) { p.el.remove(); popups.splice(i, 1); }
  }
}

function log(text) {
  const el = document.createElement('div');
  el.textContent = text;
  const box = $('#log');
  box.appendChild(el);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => el.remove(), 5000);
}

function damageFlash() {
  const el = $('#damage-flash');
  el.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
}

// ====================================================================== 戦闘
function playerAttack() {
  if (player.attackCooldown > 0 || player.flinch > 0 || player.attackTimer > 0) return;
  if (player.stamina < F.attackStamina) { log('スタミナが足りない'); return; }
  player.stamina -= F.attackStamina;
  player.staminaDelay = F.staminaRegenDelay;
  player.attackTimer = 0.32;
  player.attackCooldown = F.attackCooldown;
  player.hitDone = false;
  player.attackKind = 'normal';
  player.attackSkill = null;
}

function resolvePlayerHit() {
  const fx = -Math.sin(player.facing), fz = -Math.cos(player.facing);
  const sk = player.attackKind === 'skill' ? player.attackSkill : null;
  const range = sk ? sk.range : F.attackRange;
  const cosArc = Math.cos(THREE.MathUtils.degToRad((sk ? sk.arcDeg : F.attackArcDeg) / 2));
  const skillMult = sk ? sk.damageMultiplier : 1;
  let hits = 0;
  for (const m of world.monsters) {
    if (m.state === 'dead') continue;
    const dx = m.pos.x - player.pos.x, dz = m.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > range + m.def.radius) continue;
    if (d > 0.3 && (dx * fx + dz * fz) / d < cosArc) continue;
    const crit = Math.random() < 0.08;
    let dmg = player.st.attack * player.st.meleeMultiplier * skillMult * (0.9 + Math.random() * 0.2) * (crit ? 1.6 : 1);
    dmg = Math.max(1, Math.round(dmg - m.def.defense));
    hitMonster(m, dmg, crit, dx / (d || 1), dz / (d || 1));
    hits++;
  }
  if (hits) world.hitStop = F.hitStop;
}

// 精髄スキルの発動（スロット番号 0〜3）
function useSkill(slot) {
  const id = save.skillSlots[slot];
  if (!id || player.dead || player.flinch > 0) return;
  const sk = D.ACTIVE_SKILLS[id];
  const cd = player.skillCooldowns[id] || 0;
  if (cd > 0) { log(`${sk.name}はまだ使えない（あと ${Math.ceil(cd)} 秒）`); return; }
  if (player.stamina < sk.staminaCost) { log('スタミナが足りない'); return; }
  if (sk.type === 'melee' && player.attackTimer > 0) return;
  player.stamina -= sk.staminaCost;
  player.staminaDelay = F.staminaRegenDelay;
  player.skillCooldowns[id] = sk.cooldown;
  world.run.skillsUsed++;
  const head = new THREE.Vector3(player.pos.x, 1.4, player.pos.z);
  if (sk.type === 'melee') {
    player.attackTimer = 0.32;
    player.attackCooldown = F.attackCooldown;
    player.hitDone = false;
    player.attackKind = 'skill';
    player.attackSkill = sk;
    const fx = -Math.sin(player.facing), fz = -Math.cos(player.facing);
    burst(new THREE.Vector3(player.pos.x + fx * 1.5, 1.3, player.pos.z + fz * 1.5), sk.color, 18, 2, 1);
  } else if (sk.type === 'stun') {
    let n = 0;
    for (const m of world.monsters) {
      if (m.state === 'dead') continue;
      if (Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z) > sk.radius) continue;
      m.stun = sk.stunTime;
      m.aggro = true;
      if (m.state === 'windup' || m.state === 'strike') { m.state = 'chase'; m.timer = 0; }
      const p = m.pos.clone(); p.y = 2.2 + m.def.radius;
      popup(p, 'ひるんだ！', 'gain');
      n++;
    }
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2;
      burst(new THREE.Vector3(player.pos.x + Math.cos(a) * 1.2, 1.2, player.pos.z + Math.sin(a) * 1.2), sk.color, 2, 6, 0.5);
    }
    camState.shake = 0.2;
    log(`${sk.name}！ ${n} 体の敵がひるんだ。`);
  } else if (sk.type === 'guard') {
    player.guardTimer = sk.duration;
    player.guardMultiplier = sk.damageTakenMultiplier;
    burst(head, sk.color, 30, 2, 3);
    log(`${sk.name}：${sk.duration} 秒間、受けるダメージが大きく減る。`);
  }
}

function usePotion() {
  const P = D.HUB.potion;
  if (player.dead || player.potionCooldown > 0) return;
  if (save.potions <= 0) { log(`${P.name}を持っていない`); return; }
  if (player.hp >= player.st.maxHp) { log('HP は減っていない'); return; }
  save.potions--;
  world.run.potionsUsed++;
  player.potionCooldown = P.cooldown;
  const heal = Math.round(player.st.maxHp * P.heal);
  player.hp = Math.min(player.st.maxHp, player.hp + heal);
  const p = player.pos.clone(); p.y = 1.8;
  popup(p, `+${heal}`, 'heal');
  burst(new THREE.Vector3(player.pos.x, 1.0, player.pos.z), 0x7dff9a, 24, 2, 3);
  log(`${P.name}を飲んだ（残り ${save.potions}）`);
}

function hitMonster(m, dmg, crit, nx, nz) {
  // 霊体には通常攻撃が効かない（精髄スキルなら効く）
  if (m.def.physImmune && player.attackKind !== 'skill') {
    m.aggro = true;
    const p = m.pos.clone(); p.y = 1.4 + m.def.radius;
    popup(p, '効かない', '');
    burst(new THREE.Vector3(m.pos.x, 1.0, m.pos.z), 0x9ad8ff, 8, 2, 1);
    return;
  }
  m.hp -= dmg;
  m.flash = 0.12;
  if (!m.aggro) { m.aggro = true; onAggro(m); }
  const kb = 6 * (1 - m.def.knockbackResist);
  m.vel.x += nx * kb; m.vel.z += nz * kb;
  if (m.state === 'windup' && m.def.knockbackResist < 0.5) { m.state = 'recover'; m.timer = 0.4; } // 小型の敵は攻撃を中断される
  const p = m.pos.clone(); p.y = 1.4 + m.def.radius;
  popup(p, String(dmg), crit ? 'crit' : '');
  burst(new THREE.Vector3(m.pos.x, 1.0, m.pos.z), crit ? 0xffd84a : 0xffffff, crit ? 22 : 12, 4, 2);
  world.run.damageDealt += dmg;
  if (m.hp <= 0) killMonster(m);
}

function killMonster(m) {
  m.state = 'dead';
  m.deadTimer = 0;
  m.bar.remove();
  world.run.kills++;
  save.kills[m.def.id] = (save.kills[m.def.id] || 0) + 1;
  onFieldKill(m);
  // 功績
  if (save.kills[m.def.id] === 1 && !m.def.human) gainFeat('firstKill', { name: D.MONSTERS[m.def.id].name });
  if (m.boss) gainFeat('boss', { name: m.def.name });
  if (m.def.id.startsWith('abyss_')) gainFeat('abyss', { name: m.def.name });
  if (m.def.id === 'orc_hero') gainFeat('orcHero');
  if (m.def.id === 'orc_lord') gainFeat('orcLord');
  // 素材とアイテム（確率で落とす）
  for (const [id, ch] of D.materialTable(D.MONSTERS[m.def.id])) if (Math.random() < ch * (m.boss ? 3 : 1) || world.forceLoot) placeLoot(m.pos.x + (Math.random() - 0.5) * 1.4, m.pos.z + (Math.random() - 0.5) * 1.4, 'mat', id);
  for (const [item, ch] of D.ITEM_DROPS) if (Math.random() < ch || world.forceLoot) placeLoot(m.pos.x + (Math.random() - 0.5) * 1.4, m.pos.z + (Math.random() - 0.5) * 1.4, 'item', item);
  burst(new THREE.Vector3(m.pos.x, 0.8, m.pos.z), 0xbfe8ff, 40, 5, 3);
  // 略奪者（人間）：魔石・精髄は落とさない。奪った物を返し、装備やアイテムを落とす
  if (m.def.human) { raiderDrops(m); return; }
  // 魔石：必ず 1 個（パッシブ「漁り屋」で個数が増える）。等級は魔物の強さで決まる
  const count = 1 + player.st.extraStones;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    placeStone(m.pos.x + Math.cos(a) * 0.6, m.pos.z + Math.sin(a) * 0.6, m.stoneGrade);
  }
  // 精髄
  // 精髄はまれにしか落ちない（亀裂の主は BOSS.essenceChance）
  for (const drop of m.def.drops) {
    const chance = m.boss ? D.BOSS.essenceChance : drop.chance;
    if (Math.random() < chance || world.forceDrops) dropEssence(drop.essence, m.pos);
  }
}

function placeStone(x, z, grade = 9) {
  const s = makeMagicStone(D.STONE_GRADES[grade].color, 1 + (9 - grade) * 0.08);
  s.group.position.set(x, 0, z);
  world.root.add(s.group);
  world.stones.push({ model: s, pos: s.group.position, t: Math.random() * 5, grade });
}

function warmUpDrops(root) {
  const keep = world.loot.length;
  const g = new THREE.Group();
  g.position.set(0, -40, 0);   // 床の下（見えない）
  root.add(g);
  const add = o => { o.position.set(0, 0, 0); g.add(o); };
  placeLoot(0, 0, 'mat', 'beast_hide'); placeLoot(0, 0, 'item', 'potion'); placeLoot(0, 0, 'item', 'torch'); placeLoot(0, 0, 'bag', 'bag', {});
  for (const l of world.loot.splice(keep)) add(l.group);
  add(makeEssenceOrb(0xffffff).group);
  add(makeMagicStone(0x55c8ff, 1).group);
  try { renderer.compile(scene, camera); } catch (e) { /* 準備できなくても遊べる */ }
}

// 落とし物（素材の袋・回復薬・松明）。近づくと自動で拾う
const LOOT_LOOK = { mat: 0xb08a5a, potion: 0xe04a4a, torch: 0xffa040 };
function placeLoot(x, z, kind, id, payload = null) {
  const g = new THREE.Group();
  const color = kind === 'mat' ? LOOT_LOOK.mat : LOOT_LOOK[id] ?? 0xffffff;
  let body;
  if (kind === 'mat') { body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17, 0), flatMat(color)); body.scale.set(1, 0.8, 1); }
  else if (kind === 'bag') { body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 7, 5), flatMat(0x7a5a3a)); body.scale.set(1, 0.85, 1);
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 5), new THREE.MeshStandardMaterial({ color: 0x55c8ff, emissive: 0x2a6aa0 })); tie.position.y = 0.2; body.add(tie); }
  else if (id === 'potion') { body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.3, 6), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 })); }
  else { body = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 5), flatMat(0x6a4a2a)); const f = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 5), new THREE.MeshBasicMaterial({ color })); f.position.y = 0.28; body.add(f); }
  body.position.y = 0.25;
  g.add(body);
  g.position.set(x, 0, z);
  world.root.add(g);
  world.loot.push({ group: g, body, pos: g.position, kind, id, payload, t: Math.random() * 5 });
}
function pickLoot(l) {
  if (l.kind === 'bag') {
    mergeStones(world.run.stones, l.payload ?? {});
    return `魔石の袋（${stoneText(l.payload ?? {})}）`;
  }
  if (l.kind === 'mat') {
    world.run.mats[l.id] = (world.run.mats[l.id] || 0) + 1;
    return D.MATERIALS[l.id].name;
  }
  const H = D.HUB[l.id];
  const key = l.id === 'potion' ? 'potions' : 'torches';
  if (save[key] >= H.max) return null;   // もう持てない
  save[key]++;
  return H.name;
}

function placeOrb(id, x, z) {
  const orb = makeEssenceOrb(D.ESSENCES[id].color);
  orb.group.position.set(x, 0, z);
  world.root.add(orb.group);
  world.orbs.push({ id, model: orb, pos: orb.group.position, t: 0 });
}

function dropEssence(id, pos) {
  const e = D.ESSENCES[id];
  placeOrb(id, pos.x, pos.z);
  burst(new THREE.Vector3(pos.x, 1.0, pos.z), e.color, 30, 3, 4);
  log(`${e.name}が現れた！`);
}

function hurtPlayer(dmg, fromX, fromZ) {
  if (player.invuln > 0 || player.dead || world.debugGod) return;   // debugGod：デバッグの無敵
  const guard = player.guardTimer > 0 ? player.guardMultiplier : 1;
  dmg = Math.max(1, Math.round(dmg * player.st.damageTakenMultiplier * guard));
  if (guard < 1) burst(new THREE.Vector3(player.pos.x, 1.2, player.pos.z), 0xffb347, 12, 3, 1);
  player.hp -= dmg;
  player.invuln = F.invulnTime;
  player.flinch = F.flinchTime * player.st.flinchMultiplier;
  player.attackTimer = 0;
  const dx = player.pos.x - fromX, dz = player.pos.z - fromZ, d = Math.hypot(dx, dz) || 1;
  player.vel.x += dx / d * 5; player.vel.z += dz / d * 5;
  const p = player.pos.clone(); p.y = 2.2;
  popup(p, String(dmg), 'hurt');
  burst(new THREE.Vector3(player.pos.x, 1.2, player.pos.z), 0xff8a7a, 10, 3, 2);
  damageFlash();
  camState.shake = 0.35;
  world.run.damageTaken += dmg;
  if (player.hp <= 0) {
    player.hp = 0;
    player.dead = true;
    setTimeout(() => endRun('dead'), 900);
  }
}

// ====================================================================== 更新
// 一人称カメラ：yaw（左右）・pitch（上下）・歩行の揺れ・被弾の揺れ
const camState = { yaw: 0, pitch: 0, bob: 0, shake: 0, eye: 1.65 };

function updatePlayer(dt) {
  const st = player.st;
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.flinch = Math.max(0, player.flinch - dt);
  const look = input.takeLook();
  camState.yaw += look.yaw;
  camState.pitch = THREE.MathUtils.clamp(camState.pitch + look.pitch, -1.2, 1.2);
  player.facing = camState.yaw;   // 一人称なので体の向き = 視線の向き

  player.guardTimer = Math.max(0, player.guardTimer - dt);
  player.potionCooldown = Math.max(0, player.potionCooldown - dt);
  for (const id in player.skillCooldowns) player.skillCooldowns[id] = Math.max(0, player.skillCooldowns[id] - dt);
  if (input.consume('attack') && !player.dead) playerAttack();
  for (let i = 0; i < D.MAX_SKILL_SLOTS; i++) if (input.consume('skill' + i)) useSkill(i);
  if (input.consume('potion')) usePotion();

  // 移動（カメラの向き基準）
  let mx = input.move.x, my = input.move.y;
  if (player.dead || player.flinch > 0) { mx = 0; my = 0; }
  const moving = Math.hypot(mx, my) > 0.1;
  let speed = st.moveSpeed * Math.min(1, Math.hypot(mx, my)) * (regionAt(player.pos)?.slow ?? 1);   // 湿地では足を取られる
  let dashing = false;
  if (moving && input.dash && player.stamina > 1) {
    speed *= F.dashMultiplier;
    player.stamina -= F.dashStaminaPerSec * dt;
    player.staminaDelay = F.staminaRegenDelay;
    dashing = true;
  }
  if (player.attackTimer > 0) speed *= 0.35;
  if (moving) {
    const sin = Math.sin(camState.yaw), cos = Math.cos(camState.yaw);
    // 前 = カメラが向いている方向（-Z をカメラの yaw で回したもの）
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    const dx = fx * my + rx * mx, dz = fz * my + rz * mx;
    const len = Math.hypot(dx, dz);
    player.pos.x += dx / len * speed * dt;
    player.pos.z += dz / len * speed * dt;
    player.walkPhase += dt * speed * 1.9;
  }
  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  player.vel.multiplyScalar(Math.max(0, 1 - dt * 8));
  collide(player.pos, 0.45);

  // スタミナ回復
  player.staminaDelay = Math.max(0, player.staminaDelay - dt);
  if (player.staminaDelay <= 0) player.stamina = Math.min(st.maxStamina, player.stamina + F.staminaRegenPerSec * dt);
  player.stamina = Math.max(0, player.stamina);

  // 攻撃の判定（振り下ろしの途中で 1 回）
  if (player.attackTimer > 0) {
    player.attackTimer -= dt;
    if (!player.hitDone && player.attackTimer < 0.18) { player.hitDone = true; resolvePlayerHit(); }
  }

  // 一人称の腕と大剣
  const vm = player.viewmodel, V = vm.parts;
  const bobX = moving ? Math.cos(player.walkPhase) * 0.025 : 0;
  const bobY = moving ? -Math.abs(Math.sin(player.walkPhase)) * 0.03 : Math.sin(world.clock * 1.6) * 0.006;
  vm.group.position.set(0.42 + bobX, -0.42 + bobY, -0.62);
  if (player.attackTimer > 0 && player.attackKind === 'skill') {
    // 急所突き：引いてから前へ突き出す
    const t = 1 - player.attackTimer / 0.32;
    const k = t < 0.35 ? -t / 0.35 : Math.min(1, (t - 0.35) / 0.25);
    V.swing.rotation.set(-1.0 * Math.min(1, t * 3), 0, 0.15);
    V.swing.position.set(-0.18 * Math.min(1, t * 3), 0.1, -0.55 * k);
  } else if (player.attackTimer > 0) {
    const t = 1 - player.attackTimer / 0.32;          // 0 → 1
    if (t < 0.3) {                                     // 振りかぶる（右上へ）
      const k = t / 0.3;
      V.swing.rotation.set(0.5 * k, 0, -0.5 * k);
      V.swing.position.set(0.08 * k, 0.12 * k, 0.05 * k);
    } else {                                           // 振り下ろす（左下へ斜めに）
      const k = Math.min(1, (t - 0.3) / 0.45);
      V.swing.rotation.set(0.5 - 1.9 * k, 0.5 * k, -0.5 + 1.6 * k);
      V.swing.position.set(0.08 - 0.42 * k, 0.12 - 0.2 * k, 0.05 - 0.15 * k);
    }
  } else {
    V.swing.rotation.x += (0 - V.swing.rotation.x) * Math.min(1, dt * 12);
    V.swing.rotation.y += (0 - V.swing.rotation.y) * Math.min(1, dt * 12);
    V.swing.rotation.z += (0 - V.swing.rotation.z) * Math.min(1, dt * 12);
    V.swing.position.multiplyScalar(Math.max(0, 1 - dt * 12));
  }
  vm.group.visible = !player.dead;
  camState.bob = moving ? Math.abs(Math.sin(player.walkPhase)) * (dashing ? 0.07 : 0.045) : 0;

  // 松明は左手に持っている想定（目の少し左下）
  const lx = Math.cos(camState.yaw), lz = -Math.sin(camState.yaw);
  world.torch.position.set(player.pos.x - lx * 0.4, 1.9, player.pos.z - lz * 0.4);
  // 暗黒地帯では、松明（アイテム）を灯しているときだけ手元が明るい
  const H = D.HUB.torch;
  const base = world.inDark ? (torchLit() ? H.light : 0) : world.torchBase;
  world.torch.distance = world.inDark && torchLit() ? H.lightRange : world.torchRange;
  world.torch.intensity = base ? base + Math.sin(world.clock * 13) * 1.0 + Math.sin(world.clock * 7.3) * 0.8 : 0;
  vmLight.intensity = 3 + Math.sin(world.clock * 13) * 0.3;
}

function updateMonsters(dt) {
  for (const m of world.monsters) {
    const def = m.def;
    m.anim += dt;
    m.flash = Math.max(0, m.flash - dt);
    if (m.state === 'dead') {
      m.deadTimer += dt;
      const g = m.model.group;
      g.rotation.z = Math.min(Math.PI / 2, m.deadTimer * 5);
      g.scale.setScalar(Math.max(0.01, 1 - Math.max(0, m.deadTimer - 0.4) * 2.5));
      if (m.deadTimer > 0.8 && g.parent) g.parent.remove(g);
      continue;
    }
    const toP = new THREE.Vector3(player.pos.x - m.pos.x, 0, player.pos.z - m.pos.z);
    const dist = toP.length();
    // 遠くの魔物は動かさない（広い階層でも重くならないように）
    const far = dist > 60 && !m.aggro && !def.human;   // 略奪者は遠くにいても獲物を探して動く
    m.model.group.visible = dist < Math.min(75, (scene.fog?.far ?? 60) + 10);   // 霧の向こうは描かない
    if (far) continue;
    const playerSafe = isSafeCell(Math.round(player.pos.z / T), Math.round(player.pos.x / T));
    // 略奪者（人間）は安全地帯にも入ってくるし、一度見つけたらどこまでも追ってくる
    const sees = (!playerSafe || def.human) && dist < def.aggroRange && lineOfSight(m.pos, player.pos);
    if (sees && !m.aggro) { m.aggro = true; onAggro(m); if (def.human) raiderSpotted(m); }
    if (m.aggro && !def.human && (dist > def.aggroRange * 1.8 || playerSafe)) m.aggro = false;   // 安全地帯には追ってこない
    const prevX = m.pos.x, prevZ = m.pos.z;
    m.cooldown = Math.max(0, m.cooldown - dt);

    let moveDir = null, speedMul = 1;
    if (player.dead) m.aggro = false;
    if (m.stun > 0) {
      // ひるみ中：その場で動けない
      m.stun -= dt;
      m.pos.x += m.vel.x * dt; m.pos.z += m.vel.z * dt;
      m.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
      collide(m.pos, def.radius);
      animateMonster(m, 0);
      m.model.parts.body.rotation.z = Math.sin(m.anim * 18) * 0.12;
      if (Math.random() < dt * 6) burst(new THREE.Vector3(m.pos.x, 1.6 + def.radius, m.pos.z), 0xfff27a, 2, 1, 1);
      continue;
    }
    m.model.parts.body.rotation.z = 0;
    switch (m.state) {
      case 'idle':
      case 'chase':
        if (def.human && !m.aggro) {
          // 獲物を探して、プレイヤーのいるほうへ少しずつ歩いていく（経路をたどる）
          m.state = 'idle';
          m.pathTimer -= dt;
          if (m.pathTimer <= 0 || !m.path) { m.path = nextStepToward(m.pos, player.pos, true, 999); m.pathTimer = 1.0; }
          const tgt = m.path ?? player.pos;
          const w = new THREE.Vector3(tgt.x - m.pos.x, 0, tgt.z - m.pos.z);
          if (w.length() > 0.3) { moveDir = w.normalize(); speedMul = 0.45; m.facing = turnToward(m.facing, Math.atan2(-w.x, -w.z), dt * 4); }
          break;
        }
        if (m.aggro) {
          m.state = 'chase';
          // 群れの魔物は、割り当てられた位置（標的の周り）に回り込んでから攻撃する（最大 3 秒）
          const flank = flankPoint(m);
          m.flankTime = (m.flankTime ?? 0) + dt;
          const flanking = flank && m.flankTime < 3 && Math.hypot(flank.x - m.pos.x, flank.z - m.pos.z) > 1.0;
          if (flanking) {
            moveDir = new THREE.Vector3(flank.x - m.pos.x, 0, flank.z - m.pos.z).normalize();
            m.facing = turnToward(m.facing, Math.atan2(-toP.x, -toP.z), dt * 8);
            break;
          }
          if (dist < def.attackRange && m.cooldown <= 0 && (!def.ranged || sees)) {
            m.state = 'windup'; m.timer = def.windup;
            break;
          }
          // 遠距離攻撃の魔物は、間合いの内側では近づかない
          if (dist > def.attackRange * (def.ranged ? 0.75 : 0.8)) {
            if (sees) moveDir = toP.clone().normalize();
            else {
              m.pathTimer -= dt;
              if (m.pathTimer <= 0 || !m.path) { m.path = nextStepToward(m.pos, player.pos, def.human, def.human ? 999 : 30); m.pathTimer = 0.5; }
              if (m.path) moveDir = new THREE.Vector3(m.path.x - m.pos.x, 0, m.path.z - m.pos.z).normalize();
              else if (def.human) moveDir = toP.clone().normalize();
            }
          }
          m.facing = turnToward(m.facing, Math.atan2(-toP.x, -toP.z), dt * 8);
        } else {
          m.state = 'idle';
          // うろうろする
          if (!m.wanderTarget || m.pos.distanceTo(m.wanderTarget) < 0.5 || Math.random() < dt * 0.2) {
            // 徘徊する魔物（roam）は広く歩き回る
            const roam = world.floor.regions?.[m.regionKey]?.roam ?? 3;
            const a = Math.random() * Math.PI * 2, r = Math.random() * roam;
            m.wanderTarget = new THREE.Vector3(m.home.x + Math.cos(a) * r, 0, m.home.z + Math.sin(a) * r);
            // 壁の中や、自分の地域の外（暗黒地帯の魔物なら迷路の中など）へは行かない
            if (cellAt(m.wanderTarget.x, m.wanderTarget.z) === '#' || (m.regionKey && regionKeyAt(m.wanderTarget) !== m.regionKey)) m.wanderTarget.copy(m.home);
          }
          const w = new THREE.Vector3(m.wanderTarget.x - m.pos.x, 0, m.wanderTarget.z - m.pos.z);
          if (w.length() > 0.3) { moveDir = w.normalize(); speedMul = 0.3; m.facing = turnToward(m.facing, Math.atan2(-w.x, -w.z), dt * 4); }
        }
        break;
      case 'windup':
        m.timer -= dt;
        m.facing = turnToward(m.facing, Math.atan2(-toP.x, -toP.z), dt * 3);
        if (m.timer <= 0) {
          m.state = 'strike'; m.timer = 0.22;
          if (def.lunge) { m.vel.x += -Math.sin(m.facing) * 9; m.vel.z += -Math.cos(m.facing) * 9; } // 飛びかかる
          if (def.ranged) fireProjectile(m);
          else if (dist < def.attackRange + 0.6) {
            const fx = -Math.sin(m.facing), fz = -Math.cos(m.facing);
            if (dist < 0.5 || (toP.x * fx + toP.z * fz) / dist > 0.3) hurtPlayer(m.attack, m.pos.x, m.pos.z);
          }
        }
        break;
      case 'strike':
        m.timer -= dt;
        if (m.timer <= 0) { m.state = 'recover'; m.timer = 0.3; m.cooldown = def.attackCooldown; }
        break;
      case 'recover':
        m.timer -= dt;
        if (m.timer <= 0) m.state = 'chase';
        break;
    }

    if (moveDir) {
      m.pos.x += moveDir.x * def.speed * speedMul * dt;
      m.pos.z += moveDir.z * def.speed * speedMul * dt;
    }
    m.pos.x += m.vel.x * dt; m.pos.z += m.vel.z * dt;
    m.vel.multiplyScalar(Math.max(0, 1 - dt * 7));
    // 敵同士・プレイヤーと重ならないようにする
    for (const o of world.monsters) {
      if (o === m || o.state === 'dead') continue;
      const dx = m.pos.x - o.pos.x, dz = m.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = def.radius + o.def.radius;
      if (d < min && d > 1e-4) { m.pos.x += dx / d * (min - d) * 0.5; m.pos.z += dz / d * (min - d) * 0.5; }
    }
    const pd = Math.hypot(m.pos.x - player.pos.x, m.pos.z - player.pos.z), pmin = def.radius + 0.45;
    if (pd < pmin && pd > 1e-4) { m.pos.x += (m.pos.x - player.pos.x) / pd * (pmin - pd); m.pos.z += (m.pos.z - player.pos.z) / pd * (pmin - pd); }
    collide(m.pos, def.radius);
    // 魔物は安全地帯に入れない
    if (!def.human && isSafeCell(Math.round(m.pos.z / T), Math.round(m.pos.x / T))) { m.pos.x = prevX; m.pos.z = prevZ; }

    animateMonster(m, moveDir ? def.speed * speedMul : 0);
  }
}

// ====================================================================== 出現法則（群れ・リンク・巻き込み）
// 魔物が戦闘に気づいたとき（onAggro）。地域の設定に応じて、ほかの魔物を呼び込む
function alertMonster(o) {
  if (o.state === 'dead' || o.aggro) return;
  o.aggro = true;
  o.flankTime = 0;   // 呼ばれた側からは、さらに呼び込まない（連鎖が階層中に広がらないように）
}
function onAggro(m) {
  m.flankTime = 0;
  const reg = world.floor.regions?.[m.regionKey];
  if (!reg) return;
  if (reg.pack) for (const o of world.monsters) if (o.groupId === m.groupId) alertMonster(o);
  if (reg.assist) for (const o of world.monsters) if (o !== m && o.pos.distanceTo(m.pos) < reg.assist) alertMonster(o);
  if (reg.link) {
    for (const o of world.monsters) if (o.def.id === m.def.id && o.pos.distanceTo(m.pos) < reg.link.radius) alertMonster(o);
    // 近くにリスポーンしていた別個体が、次々と集まってくる
    if (!world.reinforce[m.regionKey]) {
      world.reinforce[m.regionKey] = { id: m.def.id, left: reg.link.reinforce, timer: reg.link.interval, interval: reg.link.interval, idle: 0 };
      log(`物音を聞きつけて、${m.def.name}が集まってくる……！`);
    }
  }
}
function updateReinforcements(dt) {
  for (const [key, rf] of Object.entries(world.reinforce ?? {})) {
    if (rf.left <= 0) continue;
    // 戦闘が終わって（追ってくる魔物がいなくなって）しばらくしたら止まる
    const fighting = world.monsters.some(o => o.state !== 'dead' && o.aggro);
    rf.idle = fighting ? 0 : rf.idle + dt;
    if (rf.idle > 8) { delete world.reinforce[key]; continue; }
    rf.timer -= dt;
    if (rf.timer > 0) continue;
    rf.timer = rf.interval;
    // プレイヤーから 10〜18m 離れた、見えない所に湧く
    const pr = Math.round(player.pos.z / T), pc = Math.round(player.pos.x / T);
    const cands = [];
    for (let r = pr - 5; r <= pr + 5; r++) for (let c = pc - 5; c <= pc + 5; c++) {
      if (isWallCell(r, c) || 'PTM'.includes(world.grid[r][c]) || isSafeCell(r, c) || world.layout.dark?.[r]?.[c]) continue;
      const p = cellCenter(r, c), d = p.distanceTo(player.pos);
      if (d >= 10 && d <= 18 && !lineOfSight(p, player.pos)) cands.push(p);
    }
    if (!cands.length) continue;
    const m = spawnMonster(rf.id, cands[Math.floor(Math.random() * cands.length)]);
    m.regionKey = key; m.aggro = true;
    rf.left--;
  }
}
// 群れの魔物は、標的を囲むように散って回り込む（離れているあいだだけ）
function flankPoint(m) {
  if (!world.floor.regions?.[m.regionKey]?.pack || m.packSize < 2) return null;
  const a = m.packIndex / m.packSize * Math.PI * 2;
  const rad = m.def.attackRange * 0.8;
  const p = new THREE.Vector3(player.pos.x + Math.cos(a) * rad, 0, player.pos.z + Math.sin(a) * rad);
  return cellAt(p.x, p.z) === '#' ? null : p;
}

// 遠距離攻撃（矢・魔法の弾）。まっすぐ飛び、プレイヤーに当たるか壁に当たると消える（よければ当たらない）
function fireProjectile(m) {
  const R = m.def.ranged;
  const from = new THREE.Vector3(m.pos.x, 1.3 * (m.def.look?.size ?? 1), m.pos.z);
  const to = new THREE.Vector3(player.pos.x, 1.3, player.pos.z);
  const dir = to.sub(from).normalize();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: R.color }));
  mesh.position.copy(from);
  world.root.add(mesh);
  world.projectiles.push({ mesh, vel: dir.multiplyScalar(R.speed), damage: m.attack, from: m, life: 3 });
}
function updateProjectiles(dt) {
  for (let i = world.projectiles.length - 1; i >= 0; i--) {
    const pr = world.projectiles[i];
    pr.life -= dt;
    pr.mesh.position.addScaledVector(pr.vel, dt);
    const p = pr.mesh.position;
    let hit = false;
    if (Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 0.6 && p.y < 2.2) { hurtPlayer(pr.damage, pr.from.pos.x, pr.from.pos.z); hit = true; }
    if (hit || pr.life <= 0 || cellAt(p.x, p.z) === '#') {
      burst(p.clone(), pr.mesh.material.color.getHex(), 6, 2, 1);
      pr.mesh.parent?.remove(pr.mesh);
      world.projectiles.splice(i, 1);
    }
  }
}

function turnToward(cur, target, k) {
  let diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + diff * Math.min(1, k);
}

function animateMonster(m, speed) {
  const g = m.model.group, P = m.model.parts;
  g.position.set(m.pos.x, 0, m.pos.z);
  g.rotation.y = m.facing;
  const phase = m.anim * (4 + speed * 2);
  const sw = speed > 0.1 ? Math.sin(phase) * 0.7 : 0;
  if (P.kind === 'float') {
    // 霊体：ふわふわ浮く。予備動作で腕を振り上げる
    P.body.position.y = 0.25 + Math.sin(m.anim * 2.2) * 0.12;
    const up = m.state === 'windup' ? -2.2 * Math.min(1, (1 - m.timer / m.def.windup) * 1.5) : m.state === 'strike' ? 0.6 : Math.sin(m.anim * 3) * 0.2;
    P.armL.rotation.x = up; P.armR.rotation.x = up;
  } else if (P.kind === 'worm') {
    // 地を這う：体節が波打つ。予備動作で頭を持ち上げる
    P.segs.forEach((sg, i) => { sg.position.x = Math.sin(m.anim * 5 - i * 0.9) * 0.15 * (speed > 0.1 ? 1.5 : 0.5); });
    P.body.rotation.x = m.state === 'windup' ? -0.5 * Math.min(1, (1 - m.timer / m.def.windup) * 1.5) : m.state === 'strike' ? 0.2 : 0;
  } else if (P.kind === 'tree') {
    // 樹木：枝を振る
    const t = m.state === 'windup' ? Math.min(1, (1 - m.timer / m.def.windup) * 1.5) : 0;
    P.armL.rotation.x = m.state === 'windup' ? -1.8 * t : m.state === 'strike' ? 0.8 : Math.sin(m.anim * 1.5) * 0.15;
    P.armR.rotation.x = P.armL.rotation.x;
    P.body.rotation.z = Math.sin(m.anim * (speed > 0.1 ? 6 : 1)) * 0.05;
  } else if (P.kind === 'quad') {
    P.legs.forEach((l, i) => { l.rotation.x = (i === 0 || i === 3 ? sw : -sw); });
    P.tail.rotation.y = Math.sin(m.anim * 6) * 0.4;
    P.head.rotation.x = m.state === 'windup' ? 0.35 : (m.state === 'strike' ? -0.3 : 0);
    P.body.position.y = m.state === 'windup' ? -0.12 : 0;
  } else {
    P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
    P.armL.rotation.x = -sw * 0.6;
    if (m.state === 'windup') {
      const t = 1 - m.timer / m.def.windup;
      P.armR.rotation.x = -2.6 * Math.min(1, t * 1.5);
      if (P.twoArm) P.armL.rotation.x = -2.6 * Math.min(1, t * 1.5);
      P.body.rotation.x = 0.15 * t;
    } else if (m.state === 'strike') {
      P.armR.rotation.x = 0.8;
      if (P.twoArm) P.armL.rotation.x = 0.8;
      P.body.rotation.x = -0.15;
    } else {
      P.armR.rotation.x += (sw * 0.6 - P.armR.rotation.x) * 0.2;
      P.body.rotation.x *= 0.8;
    }
    P.body.position.y = speed > 0.1 ? Math.abs(Math.sin(phase)) * 0.05 : Math.sin(m.anim * 2) * 0.02;
  }
  // 被弾で白く光る／攻撃の予備動作で赤く光る
  const windupGlow = m.state === 'windup' ? 0.35 + 0.35 * Math.sin(m.anim * 30) : 0;
  for (const mat of m.mats) {
    if (!mat.userData.baseEmissive) mat.userData.baseEmissive = mat.emissive.clone();
    if (m.flash > 0) mat.emissive.setRGB(1, 1, 1);
    else if (m.stun > 0) mat.emissive.setRGB(0.35, 0.3, 0.05);
    else if (windupGlow > 0) mat.emissive.setRGB(windupGlow, 0.05, 0.02);
    else mat.emissive.copy(mat.userData.baseEmissive);
  }
}

function updatePickups(dt) {
  // 魔石：近づくと吸い寄せられて自動で拾う
  for (let i = world.stones.length - 1; i >= 0; i--) {
    const s = world.stones[i];
    s.t += dt;
    const g = s.model.group;
    g.rotation.y += dt * 2;
    s.model.parts.gem.position.y = 0.3 + Math.sin(s.t * 3) * 0.06;
    const d = Math.hypot(player.pos.x - s.pos.x, player.pos.z - s.pos.z);
    if (d < 3 && !player.dead) {
      s.pos.x += (player.pos.x - s.pos.x) * Math.min(1, dt * 6);
      s.pos.z += (player.pos.z - s.pos.z) * Math.min(1, dt * 6);
    }
    if (d < 0.7) {
      g.parent?.remove(g);
      world.stones.splice(i, 1);
      addStone(world.run.stones, s.grade);
      const p = player.pos.clone(); p.y = 2;
      popup(p, `+${s.grade}等級魔石`, 'gain');
    }
  }
  // 素材・アイテム：近づくと拾う（持てない物はその場に残る）
  for (let i = world.loot.length - 1; i >= 0; i--) {
    const l = world.loot[i];
    l.t += dt;
    l.body.rotation.y += dt * 1.5;
    l.body.position.y = 0.25 + Math.sin(l.t * 3) * 0.05;
    const d = Math.hypot(player.pos.x - l.pos.x, player.pos.z - l.pos.z);
    // 近づくと吸い寄せられる（持てない物は寄ってこない）
    const canTake = l.kind === 'mat' || l.kind === 'bag' || save[l.id === 'potion' ? 'potions' : 'torches'] < D.HUB[l.id].max;
    if (d < 3 && canTake && !player.dead) {
      l.pos.x += (player.pos.x - l.pos.x) * Math.min(1, dt * 6);
      l.pos.z += (player.pos.z - l.pos.z) * Math.min(1, dt * 6);
    }
    if (d < 0.8 && canTake && !player.dead && world.state === 'playing') {
      const name = pickLoot(l);
      if (!name) continue;
      l.group.parent?.remove(l.group);
      world.loot.splice(i, 1);
      const p = player.pos.clone(); p.y = 2.1;
      popup(p, `+${name}`, 'gain');
    }
  }
  // 精髄オーブ：浮かんで回る
  for (const o of world.orbs) {
    o.t += dt;
    o.model.parts.core.position.y = 1.0 + Math.sin(o.t * 2.5) * 0.12;
    o.model.parts.shell.position.y = o.model.parts.core.position.y;
    o.model.parts.core.rotation.y += dt * 1.5;
    o.model.parts.shell.rotation.x += dt * 0.7;
    o.model.parts.glow.material.opacity = 0.25 + Math.sin(o.t * 4) * 0.1;
  }
  // 門の渦
  for (const p of world.portals) {
    const sw = p.model.parts.swirl;
    if (!sw) continue;
    sw.children[0].rotation.z += dt * 1.2;
    sw.children[1].rotation.z -= dt * 2.0;
    sw.children[0].material.opacity = 0.45 + Math.sin(world.clock * 3) * 0.15;
  }
  for (const t of world.torchLights) {
    if (!t.flame) { t.light.intensity = t.base + Math.sin(world.clock * 1.7 + t.light.position.x) * 1.2; continue; }   // クリスタルはゆっくり明滅
    t.light.intensity = t.base + Math.sin(world.clock * 11 + t.light.position.x) * 2 + Math.sin(world.clock * 17.3) * 1.2;
    t.flame.scale.y = 1 + Math.sin(world.clock * 15 + t.light.position.z) * 0.15;
  }
}

// 調べられる対象（精髄オーブ・門）
function portalLabel(p) {
  const target = floorConfig(p.target);
  const where = p.label ? `${p.label}：` : '';
  if (p.kind === 'next') return `${where}下層への門をくぐる（${target.name}／閉鎖 ${closeLabel(target)}）`;
  if (p.kind === 'prev') return p.closed ? `上層への門 — ${target.name}はすでに閉ざされている` : `上層への門をくぐる（${target.name}／閉鎖 ${closeLabel(target)}）`;
  if (p.kind === 'rift') return '空間の裂け目に入る（次元の亀裂）';
  return `裂け目から出る（${target.name}へ戻る）`;
}
function nearestInteractable() {
  let best = null, bestD = Infinity;
  for (const o of world.orbs) {
    const d = Math.hypot(player.pos.x - o.pos.x, player.pos.z - o.pos.z);
    if (d < 1.8 && d < bestD) { best = { type: 'orb', orb: o, label: D.ESSENCES[o.id].name + 'を調べる' }; bestD = d; }
  }
  for (const p of world.portals) {
    const d = Math.hypot(player.pos.x - p.pos.x, player.pos.z - p.pos.z);
    if (d < 2.2 && d < bestD) { best = { type: 'portal', portal: p, label: portalLabel(p) }; bestD = d; }
  }
  for (const st of world.steles) {
    if (st.state !== 'sleep') continue;
    const d = Math.hypot(player.pos.x - st.pos.x, player.pos.z - st.pos.z);
    if (d < 2.4 && d < bestD) { best = { type: 'stele', stele: st, label: '石碑に触れる' }; bestD = d; }
  }
  return best;
}

// ====================================================================== 階層の移動・時間
function usePortal(p) {
  if (p.closed) { log(`${floorConfig(p.target).name}はすでに閉ざされている。この層の閉鎖を待つしかない。`); return; }
  const from = world.floor;
  let arrive = 'start';
  if (p.kind === 'next') arrive = 'fromAbove';
  if (p.kind === 'prev') arrive = 'fromBelow';
  if (p.kind === 'rift') world.riftReturn = from.id;
  if (p.kind === 'back') { arrive = 'fromRift'; }
  // 第2層のどのエリアを通ったか（第3層の到着地点と、戻る門の行き先）
  if (p.kind === 'next' && from.depth === 2 && !from.isSpecialRift) world.run.via = from.id;
  world.arriveFrom = from.id;
  const target = floorConfig(p.target);
  fadeTransition(() => {
    buildFloor(target, arrive);
    if (p.kind === 'back') world.riftReturn = null;
    // 功績：初めて到達した階層・その周期で最初に下の層へ進む（3 層以降）・初めての亀裂
    if (p.kind === 'next' && !target.isSpecialRift) {
      if (target.depth > save.deepest) gainFeat('newDepth', { depth: target.depth });
      if (save.cycleDescent?.cycle !== save.cycle) save.cycleDescent = { cycle: save.cycle, depths: [] };
      if (target.depth >= 3 && !save.cycleDescent.depths.includes(target.depth)) {
        save.cycleDescent.depths.push(target.depth);
        gainFeat('firstDescend', { cycle: save.cycle, depth: target.depth });
      }
    }
    if (target.isSpecialRift && !save.riftVisited) { save.riftVisited = true; gainFeat('firstRift'); }
    if (!target.isSpecialRift && target.depth > save.deepest) { save.deepest = target.depth; }
    world.run.deepest = Math.max(world.run.deepest, target.isSpecialRift ? world.run.deepest : target.depth);
    if (target.isSpecialRift) world.run.rift = true;
    autosave();
    $('#floor-name').textContent = target.name;
    applyQuality();
    if (target.isSpecialRift) log(`${target.name}に入った。ここでは時間が止まっている。`);
    else log(`${target.name}に着いた。この層は突入から ${closeLabel(target)}で閉ざされる。`);
    if (target.description) log(target.description);
    // 閉鎖済みの層に入ってしまうことはない（上層への門は閉ざされる）が、念のため判定する
    if (checkFloorClosure(world.time.elapsed, target.id)) endRun('closure');
  });
}

function fadeTransition(fn) {
  const el = $('#fade');
  world.state = 'transition';
  input.clear();
  el.classList.add('on');
  setTimeout(() => {
    try { fn(); } catch (e) { reportError(e); }
    finally {
      // 途中でエラーが起きても、暗転したまま止まらないようにする
      if (world.state === 'transition') world.state = 'playing';
      setTimeout(() => el.classList.remove('on'), 60);
    }
  }, 350);
}

// ====================================================================== 略奪者
// プレイヤーから minDist m 以上離れた所にパーティを出す。3 人以上なら頭目がつく
// grade：パーティの等級（省略すると深さの重み表 D.RAIDERS.gradeWeights から選ぶ）。頭目は 1 つ上（3 等級が上限）
function spawnRaiders([lo, hi], minDist = 28, grade = null) {
  const n = lo + Math.floor(Math.random() * (hi - lo + 1));
  const g = grade ?? D.rollRaiderGrade(world.floor.depth ?? 1);
  const cells = [];
  for (let r = 0; r < world.rows; r++) for (let c = 0; c < world.cols; c++) {
    if (isWallCell(r, c) || '.mC^K'.indexOf(world.grid[r][c]) < 0) continue;
    if (cellCenter(r, c).distanceTo(player.pos) >= minDist) cells.push([r, c]);
  }
  if (!cells.length) return [];
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  const center = cellCenter(r, c);
  const out = [];
  for (let i = 0; i < n; i++) {
    let id;
    if (n >= 3 && i === 0) id = D.RAIDERS.leader;
    else { const list = D.RAIDERS.members, tot = list.reduce((s, [, w]) => s + w, 0); let x = Math.random() * tot; id = list.find(([, w]) => (x -= w) <= 0)?.[0] ?? list[0][0]; }
    const p = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2.5, 0, (Math.random() - 0.5) * 2.5));
    collide(p, 0.45);
    const m = spawnMonster(id, p, false, id === D.RAIDERS.leader ? Math.max(3, g - 1) : g);
    out.push(m);
  }
  world.raidersHere = true;
  log('どこかで冒険者の悲鳴が聞こえた……。この層には略奪者がいるかもしれない。');
  return out;
}
function raiderSpotted(m) {
  if (world.raiderWarned) return;
  world.raiderWarned = true;
  log(`${m.def.name}に見つかった！ 襲ってくるぞ。`);
}
// 倒したとき：装備・アイテム・魔石の袋を確率で落とす（精髄と魔石そのものは落とさない）
function raiderDrops(m) {
  const at = () => [m.pos.x + (Math.random() - 0.5) * 1.6, m.pos.z + (Math.random() - 0.5) * 1.6];
  const bag = {};
  for (const [id, ch] of D.RAIDERS.drops) {
    if (!(Math.random() < ch || world.forceLoot)) continue;
    if (id === 'bag') { const B = D.RAIDERS.bag; const n = B.count[0] + Math.floor(Math.random() * (B.count[1] - B.count[0] + 1)); for (let i = 0; i < n; i++) addStone(bag, Math.min(9, m.def.grade + B.grades[Math.floor(Math.random() * B.grades.length)])); }
    else if (D.MATERIALS[id]) placeLoot(...at(), 'mat', id);
    else placeLoot(...at(), 'item', id);
  }
  if (stoneCount(bag)) placeLoot(...at(), 'bag', 'bag', bag);
}

// ====================================================================== 階層・フィールドのギミック
// 石碑（ゴブリンの森）：本物の石碑に触れると第3層への門が開き、残りの 7 つはただの石塊になる
function touchStele(st) {
  if (st.state !== 'sleep') return;
  if (!st.isTrue) {
    log('古びた石碑だ。触れても何も起きない。……ほかの石碑を探そう。');
    st.touched = true;
    const rune = st.model.getObjectByName('rune');
    if (rune) rune.material = new THREE.MeshStandardMaterial({ color: 0x4a4a52 });
    return;
  }
  const flags = runFlags(world.floor.id);
  flags.steleOpened = world.steles.indexOf(st);
  for (const o of world.steles) {
    if (o === st) continue;
    o.state = 'rubble';
    o.model.parent?.remove(o.model);
    o.model = makeStele(true);
    o.model.position.set(o.pos.x, 0, o.pos.z);
    world.root.add(o.model);
  }
  st.state = 'open';
  st.model.parent?.remove(st.model);
  removePillar(st.pillar);
  addPortal('next', [st.r, st.c], world.floor.next);
  burst(new THREE.Vector3(st.pos.x, 1.5, st.pos.z), 0xb07cff, 60, 4, 4);
  log('石碑が光り、第3層への門が開いた！ ほかの石碑はただの石塊になった。');
  autosave();
}

// 罠（ゴブリンの森）：見えない罠を踏むとダメージ。踏んだ罠は見えるようになる
function updateTraps(dt) {
  if (!world.traps.size || player.dead) return;
  for (const t of world.traps.values()) t.cooldown = Math.max(0, t.cooldown - dt);
  const t = world.traps.get(pillarKey(Math.round(player.pos.z / T), Math.round(player.pos.x / T)));
  if (!t || t.cooldown > 0) return;
  const p = cellCenter(t.r, t.c);
  if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 1.4) return;
  t.cooldown = 3;
  if (!t.revealed) {
    t.revealed = true;
    t.model = new THREE.Group();
    for (let i = 0; i < 9; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), flatMat(0x8a8a90)); sp.position.set(p.x + (i % 3 - 1) * 0.45, 0.25, p.z + (Math.floor(i / 3) - 1) * 0.45); t.model.add(sp); }
    world.root.add(t.model);
  }
  const dmg = Math.round(player.st.maxHp * (world.floor.trap?.damage ?? 0.15));
  player.invuln = 0;
  hurtPlayer(dmg, p.x, p.z);
  log(`罠だ！ 地面から棘が突き出た（${dmg} ダメージ）`);
}

// フィールドごとのギミック（第2層の亡者の地・第3層）
function updateField(dt) {
  const key = regionKeyAt(player.pos);
  const reg = key ? world.floor.regions?.[key] : null;
  // フィールドに入ったときに名前を出す
  if (key && key !== world.fieldKey) {
    if (world.fieldKey !== null && reg?.name && world.floor.id === D.FLOOR.F3) log(`${reg.name}に入った。`);
    world.fieldKey = key;
  }
  const flags = runFlags(world.floor.id);
  // 亡者の地：バンシーの泣き声
  if (world.floor.banshee && Math.random() < dt / 25) log('どこかでバンシーのすすり泣く声が響いている……');
  // 鋼岩の丘：魔物が最も多くなる 3 日目、地面から銀色の光の球が空へ舞う
  if (reg?.silverOrbs && world.time.elapsed >= 48 && world.time.elapsed < 72) {
    if (!flags.silverSeen) { flags.silverSeen = true; log('地面から銀色の光の球がいくつも空へ舞い上がっていく……。'); }
    if (Math.random() < dt * 6) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 14;
      spawnParticle(new THREE.Vector3(player.pos.x + Math.cos(a) * d, 0.2, player.pos.z + Math.sin(a) * d), 0xe8f0ff, new THREE.Vector3(0, 3 + Math.random() * 2, 0), 4);
    }
  }
  // 魔女の森：魔女の目が蓄積する
  if (reg?.witchEye) {
    const W = D.WITCH_EYE;
    flags.witchHours = (flags.witchHours ?? 0) + dt / D.TIME.secondsPerDay * 24;
    while (flags.witchHours >= W.hoursPerStack) { flags.witchHours -= W.hoursPerStack; addWitchEye(1); }
    if ((flags.witchEye ?? 0) >= W.max) {
      // 同じ場所に留まり続けると強敵が現れる
      if (!world.idleAnchor || world.idleAnchor.distanceTo(player.pos) > W.idleRadius) { world.idleAnchor = player.pos.clone(); world.idleTime = 0; }
      world.idleTime += dt;
      if (world.idleTime >= W.idleSeconds) {
        world.idleTime = 0;
        const a = Math.random() * Math.PI * 2;
        const p = player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
        collide(p, 1);
        const m = spawnMonster(W.monster, p);
        m.aggro = true;
        log(`魔女の目に見つかった……！ ${D.MONSTERS[W.monster].name}が現れた！`);
      }
    }
  } else world.idleAnchor = null;
}
function addWitchEye(n) {
  const flags = runFlags(D.FLOOR.F3);
  const before = flags.witchEye ?? 0;
  flags.witchEye = Math.min(D.WITCH_EYE.max, before + n);
  if (flags.witchEye !== before) {
    if (flags.witchEye >= D.WITCH_EYE.max) log('魔女の目が最大になった。同じ場所に留まると、何かが来る……。');
    else if (before === 0) log('どこからか見られている気がする……（魔女の目）');
  }
}
// 魔物を倒したときのフィールドのギミック（killMonster から呼ぶ）
function onFieldKill(m) {
  if (world.floor.id !== D.FLOOR.F3) return;
  const key = regionKeyAt(m.pos);
  const reg = key ? world.floor.regions[key] : null;
  const flags = runFlags(world.floor.id);
  if (reg?.witchEye) addWitchEye(D.WITCH_EYE.perKill);
  // オークの群落地：オークの討伐数で、オークヒーロー → オークロードが現れる
  if (reg?.orcTrigger && m.def.id.startsWith('orc_')) {
    const O = D.ORC_TRIGGER;
    flags.orcKills = (flags.orcKills ?? 0) + 1;
    if (m.def.id === O.hero) flags.heroDown = true;
    const spawnBoss = (id, text) => {
      const a = Math.random() * Math.PI * 2;
      const p = player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 10));
      collide(p, 1.2);
      const b = spawnMonster(id, p);
      b.aggro = true;
      log(text);
    };
    if (flags.orcKills >= O.heroKills && !flags.heroSpawned) { flags.heroSpawned = true; spawnBoss(O.hero, '群落地にどよめきが走る……オークヒーローが現れた！'); }
    if (flags.orcKills >= O.lordKills && flags.heroDown && !flags.lordSpawned) { flags.lordSpawned = true; spawnBoss(O.lord, '大地が震える。災厄――オークロードが姿を現した！'); }
  }
}

// 日付が変わったとき：プレイヤーから離れた出現地点に魔物が湧く
function onNewDay() {
  log(`${world.time.day} 日目になった。`);
  setTimeout(autosave, 0);
  const alive = world.monsters.filter(m => m.state !== 'dead');
  const cands = world.spawnCells.filter(sc => {
    const p = cellCenter(sc.r, sc.c);
    if (p.distanceTo(player.pos) < 14 || lineOfSight(p, player.pos)) return false;
    return !alive.some(m => m.pos.distanceTo(p) < 3);
  });
  for (let i = 0; i < D.TIME.respawnPerDay && cands.length; i++) {
    const sc = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
    if (sc.id) spawnMonster(sc.id, cellCenter(sc.r, sc.c));
    else {
      // 群れの場所：その地域の魔物が小さな群れで湧く
      const region = world.floor.regions?.[sc.region];
      if (region?.monsters?.length) spawnGroup(region, sc.r, sc.c, Math.max(1, Math.floor((region.group?.[0] ?? 2) / 2)));
    }
  }
}

function enemiesNearby() {
  return world.monsters.some(m => m.state !== 'dead' && (m.aggro || m.pos.distanceTo(player.pos) < 10));
}

// 野営：周りに敵がいなければ時間を進め、少し回復する
function camp() {
  if (enemiesNearby()) { log('近くに魔物がいて、野営できない。'); return; }
  if (!world.time.flows(world.floor)) { log('ここでは時間が止まっている。'); return; }
  const r = world.time.advanceDays(D.TIME.campDays, world.floor);
  player.hp = Math.min(player.st.maxHp, player.hp + player.st.maxHp * D.TIME.campHeal);
  player.stamina = player.st.maxStamina;
  closeModal();
  log(`野営して休んだ。${world.time.label()}`);
  if (r.dayChanged) onNewDay();
  if (r.closed) endRun('closure');
  else autosave();
}

// 松明（アイテム）。暗黒地帯で灯っているかを返す
function updateTorchItem(dt, dark) {
  const run = world.run;
  if (!run || world.state !== 'playing' || !dark) return false;
  if (world.debugTorch) return true;   // デバッグ：松明を減らさずに灯し続ける
  const H = D.HUB.torch;
  run.torchLeft ??= 0;
  if (run.torchLeft <= 0 && save.torches > 0) {
    save.torches--;
    run.torchLeft = H.burnHours;
    log(`${H.name}に火をつけた（残り ${save.torches} 本）。自分の近くだけ見える。`);
  }
  if (run.torchLeft <= 0) return false;
  run.torchLeft -= dt / D.TIME.secondsPerDay * 24;
  if (run.torchLeft <= 0) { run.torchLeft = 0; log(save.torches > 0 ? `${H.name}が燃え尽きた。` : `${H.name}が燃え尽きた。もう松明がない……。`); }
  return run.torchLeft > 0;
}
function torchLit() { return !!(world.inDark && (world.debugTorch || (world.run?.torchLeft ?? 0) > 0)); }

function updateCamera(dt) {
  // 水晶の迷宮：いる場所の明るさで見通しが変わる（暗黒地帯では数 m 先しか見えない）
  if (world.vis && scene.fog) {
    const L = world.floor.lighting;
    const v = visibilityAt(player.pos);
    const dark = v < 0.05;
    if (world.state === 'playing' && dark !== world.inDark) {
      world.inDark = dark;
      if (dark) log(save.torches > 0 || (world.run?.torchLeft ?? 0) > 0 ? '暗黒地帯に入った。' : '暗黒地帯に入った。松明がなく、ほとんど何も見えない……。');
    }
    // 松明：暗黒地帯にいる間だけ灯り、燃え尽きたら次の 1 本に火をつける
    const lit = updateTorchItem(dt, dark);
    const darkFog = lit ? D.HUB.torch.sight : L.darkFog;
    const far = darkFog + (L.litFog - darkFog) * Math.min(1, v * 1.8);
    scene.fog.far += (far - scene.fog.far) * Math.min(1, dt * 2.5);
    scene.fog.near = scene.fog.far * 0.2;
  }
  updateCrystalLights(dt);
  // 飾りの動き（漂う光・霧）と尖塔の光
  for (const f of world.decorAnims ?? []) f(dt, world.clock);
  if (world.spire) world.spire.beacon.rotation.y += dt * 0.8;
  // 力尽きたら視点が床に崩れ落ちる
  const targetEye = player.dead ? 0.35 : camState.eye;
  camState.eyeNow = camState.eyeNow ?? targetEye;
  camState.eyeNow += (targetEye - camState.eyeNow) * Math.min(1, dt * (player.dead ? 3 : 12));
  camState.shake = Math.max(0, camState.shake - dt);
  const sh = camState.shake * 0.25;
  camera.position.set(
    player.pos.x + (Math.random() - 0.5) * sh,
    camState.eyeNow + camState.bob + (Math.random() - 0.5) * sh,
    player.pos.z + (Math.random() - 0.5) * sh);
  camera.rotation.set(camState.pitch, camState.yaw, player.dead ? 0.5 : 0);
}

// ====================================================================== HUD
// スキルバー（PC は画面下中央、スマホはボタン）。スロットの中身が変わったときだけ作り直す
let skillBarKey = '';
function updateSkillBar() {
  const key = save.skillSlots.join(',') + '|' + document.body.classList.contains('touch');
  if (key !== skillBarKey) {
    skillBarKey = key;
    $('#skillbar').innerHTML = Array.from({ length: D.MAX_SKILL_SLOTS }, (_, i) => {
      const sk = D.ACTIVE_SKILLS[save.skillSlots[i]];
      return `<div class="skill ${sk ? '' : 'empty'}" style="${sk ? `--c:#${sk.color.toString(16).padStart(6, '0')}` : ''}">
        <span class="key">${i + 1}</span><span class="name">${sk ? sk.name : ''}</span><i class="cd"></i></div>`;
    }).join('') + `<div class="skill potion"><span class="key">R</span><span class="name">回復薬</span><b class="count"></b><i class="cd"></i></div>`;
    for (let i = 0; i < D.MAX_SKILL_SLOTS; i++) {
      const b = $('#btn-skill-' + i), sk = D.ACTIVE_SKILLS[save.skillSlots[i]];
      b.classList.toggle('hidden', !sk);
      if (sk) { b.querySelector('span').textContent = sk.short; b.style.setProperty('--c', '#' + sk.color.toString(16).padStart(6, '0')); }
    }
  }
  const items = $('#skillbar').children;
  for (let i = 0; i < D.MAX_SKILL_SLOTS; i++) {
    const id = save.skillSlots[i];
    if (!id) continue;
    const sk = D.ACTIVE_SKILLS[id], cd = player.skillCooldowns[id] || 0;
    const frac = cd / sk.cooldown;
    items[i].querySelector('.cd').style.height = (frac * 100) + '%';
    items[i].classList.toggle('ready', cd <= 0 && player.stamina >= sk.staminaCost);
    const b = $('#btn-skill-' + i);
    b.querySelector('.cd').style.height = (frac * 100) + '%';
    b.classList.toggle('ready', cd <= 0);
  }
  const potion = items[D.MAX_SKILL_SLOTS];
  potion.querySelector('.count').textContent = '×' + save.potions;
  potion.classList.toggle('empty', save.potions <= 0);
  $('#btn-potion').querySelector('span').textContent = `回復 ${save.potions}`;
  $('#btn-potion').classList.toggle('empty', save.potions <= 0);
  $('#guard-indicator').classList.toggle('hidden', player.guardTimer <= 0);
  if (player.guardTimer > 0) $('#guard-indicator').textContent = `岩の構え ${player.guardTimer.toFixed(1)}秒`;
}

function updateHUD() {
  const st = player.st;
  updateSkillBar();
  $('#hp-bar i').style.width = (player.hp / st.maxHp * 100) + '%';
  $('#hp-text').textContent = `${Math.ceil(player.hp)} / ${st.maxHp}`;
  $('#lv-text').textContent = `Lv ${save.level ?? 1}（経験値 ${save.exp ?? 0}/${D.LEVEL.expToNext(save.level ?? 1)}）`;
  $('#st-bar i').style.width = (player.stamina / st.maxStamina * 100) + '%';
  $('#st-text').textContent = `${Math.floor(player.stamina)} / ${st.maxStamina}`;
  const left = world.time.hoursUntilClose(world.floor);
  $('#timer').textContent = world.time.label();
  const ci = $('#close-info');
  ci.textContent = left === null ? (world.floor.isSpecialRift ? '時間が止まっている' : '') : `この層の閉鎖まで ${formatRemaining(left)}`;
  ci.classList.toggle('warn', left !== null && left <= D.TIME.warnHours);
  // いる地域・フィールドと、魔女の目
  const reg = regionAt(player.pos);
  const eye = runFlags(world.floor.id).witchEye ?? 0;
  const eyeHTML = world.floor.id === D.FLOOR.F3 && eye > 0 ? ` ／ <span class="eye ${eye >= D.WITCH_EYE.max ? 'max' : ''}">魔女の目 ${eye}/${D.WITCH_EYE.max}</span>` : '';
  const fi = $('#field-info');
  const torchInfo = world.inDark ? (world.debugTorch ? ' ／ 松明（デバッグで常に灯っている）' : torchLit() ? ` ／ 松明 残り ${Math.ceil(world.run.torchLeft)} 時間（予備 ${save.torches} 本）` : ' ／ 松明なし') : '';
  const html = (world.inDark ? '<span class="eye">暗黒地帯</span>' + torchInfo : (reg?.name ?? '')) + eyeHTML;
  if (fi.innerHTML !== html) fi.innerHTML = html;
  const nStones = stoneCount(world.run.stones);
  $('#stones').textContent = nStones ? `${nStones}（最高 ${bestGrade(world.run.stones)}等級）` : '0';
  $('#capacity-text').textContent = `${st.used} / ${st.capacity}`;
  const pips = $('#capacity-pips');
  if (pips.children.length !== st.capacity) pips.innerHTML = '<i></i>'.repeat(st.capacity);
  [...pips.children].forEach((p, i) => p.classList.toggle('on', i < st.used));

  const it = nearestInteractable();
  const prompt = $('#prompt');
  if (it && world.state === 'playing' && !player.dead) {
    prompt.innerHTML = `<kbd>F</kbd>${it.label}`;
    prompt.classList.remove('hidden');
  } else prompt.classList.add('hidden');
  $('#btn-interact').style.opacity = it ? '1' : '0.35';

  // 敵の HP バー（ダメージを受けた敵だけ）
  const s = {};
  for (const m of world.monsters) {
    if (m.state === 'dead') continue;
    if (m.hp < m.maxHp) {
      toScreen(new THREE.Vector3(m.pos.x, 1.9 + m.def.radius * 1.2, m.pos.z), s);
      m.bar.classList.toggle('hidden', !s.visible);
      m.bar.style.left = s.x + 'px'; m.bar.style.top = s.y + 'px';
      m.bar.firstChild.style.width = (m.hp / m.maxHp * 100) + '%';
    }
  }
}

// ====================================================================== 画面
function show(id) {
  for (const s of ['#title-screen', '#absorb-screen', '#menu-screen', '#result-screen', '#hub-screen', '#loading']) $(s).classList.add('hidden');
  if (id) $(id).classList.remove('hidden');
}

function statusSummaryHTML() {
  const st = computeStats();
  const names = save.absorbed.map(id => `<span class="tag">${D.ESSENCES[id].name}</span>`).join('') || '<span class="muted">なし</span>';
  return `
    <div class="stats">${STAT_KEYS.map(k => `<div>${STAT_NAMES[k]}<b>${st.stats[k]}</b></div>`).join('')}</div>
    <div class="kv"><span>最大HP / スタミナ</span><span>${st.maxHp} / ${st.maxStamina}</span></div>
    <div class="kv"><span>魂の器</span><span>${st.used} / ${st.capacity}</span></div>
    <div class="kv"><span>パッシブ</span><span>${st.passives.map(p => D.PASSIVES[p].name).join('・')}</span></div>
    <div class="absorbed-list muted">吸収した精髄：${names}</div>`;
}

function showTitle() {
  world.state = 'title';
  $('#hud').classList.add('hidden');
  input.enabled = false;
  $('#game-title').textContent = D.GAME_TITLE;
  $('#game-subtitle').textContent = D.GAME_SUBTITLE;
  const race = D.RACES[save.race];
  $('#title-status').innerHTML = `
    ${world.bootNote ? `<div class="warn-text" style="margin-bottom:8px">${world.bootNote}</div>` : ''}
    <div class="kv"><span>暦</span><span>第${save.cycle}周期 Day ${save.day}${save.day === 1 ? ' ' + formatClock(save.hour) : ''}（地上ゲート${isGateOpen(save.day, save.hour) ? '開放中' : '閉鎖中'}）</span></div>
    <div class="kv"><span>種族</span><span>${race.name}</span></div>
    <div class="kv"><span>ゴールド / 魔石</span><span>${save.gold} G / ${stoneCount(save.stones)} 個</span></div>
    <div class="kv"><span>探索回数 / 帰還成功</span><span>${save.runs} / ${save.clears}</span></div>
    ${statusSummaryHTML()}`;
  $('#btn-start').textContent = world.pendingResume ? '続きから（探索を再開）' : 'はじめる（拠点へ）';
  $('#btn-quality').textContent = `画質：${settings.quality === 'high' ? '高（PC 向け）' : '低（スマホ向け）'}`;
  show('#title-screen');
}

function showHub(message = '') {
  world.state = 'hub';
  releasePointer();
  $('#hud').classList.add('hidden');
  input.enabled = false;
  input.clear();
  openHub({
    getSave: () => save,
    computeStats,
    onDepart: () => { startRun(0); input.lockPointer(); },
    onTitle: showTitle,
  }, message);
  show('#hub-screen');
}

// 探索を始める・再開するときの共通の準備
function prepareRun() {
  for (const el of document.querySelectorAll('.ebar, .popup')) el.remove();
  popups.length = 0;
  player.dead = false;
  player.vel.set(0, 0, 0);
  player.attackTimer = player.attackCooldown = player.flinch = player.invuln = 0;
  player.guardTimer = player.potionCooldown = 0;
  player.skillCooldowns = {};
  player.attackKind = 'normal';
  skillBarKey = '';
  camState.eyeNow = camState.eye;
  camState.shake = 0;
  refreshStats(false);
}

function enterPlaying(floorDef) {
  $('#floor-name').textContent = floorDef.name;
  $('#log').innerHTML = '';
  $('#hud').classList.remove('hidden');
  show(null);
  input.clear();
  input.enabled = true;
  world.state = 'playing';
  applyQuality();
}

function startRun() {
  const floorDef = floorConfig(1);
  // 迷宮に入る直前の状態を残す（力尽きたらここに戻る）
  Store.savePreRun({ ...save, runInProgress: false });
  world.run = { floor: floorDef.id, stones: {}, mats: {}, expGained: 0, kills: 0, absorbed: [], damageDealt: 0, damageTaken: 0, skillsUsed: 0, potionsUsed: 0,
    deepest: 1, rift: false, startDay: save.day, startedAt: performance.now(),
    seed: Math.floor(Math.random() * 2 ** 31) + 1,   // 地形の種（突入ごとに地形が変わる）
    via: null,                                        // 通った第2層のエリア
    flags: {} };
  // 都市で過ごした時刻に入場する。閉門間際なら暗黒地帯に降り立つおそれがある
  world.time.start(save.day, save.hour);
  world.entryLate = isLateEntry(save.hour);
  world.riftReturn = null;
  save.runInProgress = true;
  world.pendingResume = null;
  world.bootNote = '';
  prepareRun();
  buildFloor(floorDef, 'start');
  enterPlaying(floorDef);
  world.entryLate = false;
  log(`${floorDef.name}に降り立った。この層は突入から ${closeLabel(floorDef)}で閉ざされ、そのとき地上へ送還される。`);
  if (world.abyssEvent) log('深淵の気配がする……。強大な深淵の魔物が、この層のどこかにいる。');
  if (world.landedInDark) log('閉門間際に飛び込んだせいで、暗黒地帯に降り立ってしまった……');
  autosave();
}

// ====================================================================== オートセーブ
// 探索中は数秒ごと・階層の移動・精髄の吸収・日付の変化・メニュー・アプリが裏に回ったときに保存する。
// 拠点では操作のたびに保存している（hub.js）
const AUTOSAVE_INTERVAL = 5;   // 秒（実時間）
function runSnapshot() {
  const { startedAt, ...run } = world.run;
  return {
    v: 1,
    floorId: world.floor.id,
    riftReturn: world.riftReturn,
    hours: world.time.hours,
    startHours: world.time.startHours,
    arriveFrom: world.arriveFrom ?? null,
    run,
    player: { x: player.pos.x, z: player.pos.z, yaw: camState.yaw, hp: player.hp, stamina: player.stamina, cooldowns: player.skillCooldowns },
    portals: world.portals.map(p => ({ kind: p.kind, cell: p.cell, target: p.target, rot: p.model.group.rotation.y })),
    monsters: world.monsters.filter(m => m.state !== 'dead')
      .map(m => ({ id: m.def.id, x: m.pos.x, z: m.pos.z, hx: m.home.x, hz: m.home.z, hp: m.hp, boss: m.boss, rk: m.regionKey ?? null, gid: m.groupId ?? 0, pi: m.packIndex ?? 0, ps: m.packSize ?? 1 })),
    orbs: world.orbs.map(o => ({ id: o.id, x: o.pos.x, z: o.pos.z })),
    stones: world.stones.map(st => [st.pos.x, st.pos.z, st.grade]),
    loot: world.loot.map(l => [l.pos.x, l.pos.z, l.kind, l.id, l.payload]),
  };
}
function autosave() {
  world.autosaveTimer = 0;
  if (!save.runInProgress || !world.run || player.dead || world.state === 'result') return;
  Store.saveGame(save);
  Store.saveRunState(runSnapshot());
}
document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
addEventListener('pagehide', () => autosave());

// 前回の続きから再開する
function resumeRun(rs) {
  const floorDef = floorConfig(rs.floorId);
  world.run = { ...rs.run, stones: normalizeStones(rs.run.stones), startedAt: performance.now() };
  world.riftReturn = rs.riftReturn;
  world.time.start(1, 0);
  world.time.hours = rs.hours;
  world.time.startHours = rs.startHours ?? 0;
  world.arriveFrom = rs.arriveFrom ?? null;
  world.pendingResume = null;
  world.bootNote = '';
  prepareRun();
  buildFloor(floorDef, 'start', rs);
  player.hp = Math.max(1, Math.min(player.st.maxHp, rs.player.hp));
  player.stamina = Math.min(player.st.maxStamina, rs.player.stamina);
  player.skillCooldowns = { ...rs.player.cooldowns };
  enterPlaying(floorDef);
  log(`前回の続きから再開した（${floorDef.name}・${world.time.label()}）。`);
}

function openAbsorb(orb) {
  world.state = 'absorb';
  releasePointer();
  input.enabled = false;
  input.clear();
  const e = D.ESSENCES[orb.id];
  const st = player.st;
  const owned = save.absorbed.includes(orb.id);
  const free = st.capacity - st.used;
  const fits = e.cost <= free;
  const color = '#' + new THREE.Color(e.color).getHexString();
  const passive = D.PASSIVES[e.passiveSkill];
  const active = D.ACTIVE_SKILLS[e.activeSkill];
  let reason = '';
  if (owned) reason = 'この精髄はすでに吸収している。同じ精髄は重ねて吸収できない。';
  else if (!fits) reason = `魂の器の空きが足りない（必要 ${e.cost} / 空き ${free}）。`;
  $('#absorb-card').innerHTML = `
    <div class="essence-head">
      <div class="orb-icon" style="color:${color}"></div>
      <div><h2 style="margin:0">${e.name}</h2><div class="muted">${e.rank}等級 ／ 消費容量 ${e.cost}</div></div>
    </div>
    <div class="kv" style="margin-top:12px"><span>魂の器</span><span>${st.used} / ${st.capacity}（吸収後 ${st.used + (owned ? 0 : e.cost)}）</span></div>
    <div class="kv"><span>能力補正</span><span>${Object.entries(e.statBonus).map(([k, v]) => `${STAT_NAMES[k]} <span style="color:var(--st)">+${v}</span>`).join('　')}</span></div>
    <div class="kv"><span>パッシブ：${passive.name}</span><span class="muted">${passive.description}</span></div>
    <div class="kv"><span>スキル：${active.name}</span><span class="muted">${active.description}（再使用 ${active.cooldown} 秒）</span></div>
    <div class="warn-text">${reason ? reason + 'この精髄は飲めない。' : '飲むと精髄を吸収する。一度吸収した精髄は、原則として取り除けない。'}</div>
    <div class="btns row">
      <button class="btn primary" id="btn-absorb" ${owned || !fits ? 'disabled' : ''}>飲む（吸収する）</button>
      <button class="btn" id="btn-leave">立ち去る</button>
    </div>`;
  show('#absorb-screen');
  $('#btn-absorb').onclick = () => {
    save.absorbed.push(orb.id);
    if (e.activeSkill && !save.skillSlots.includes(e.activeSkill) && save.skillSlots.length < D.MAX_SKILL_SLOTS) {
      save.skillSlots.push(e.activeSkill);
    }
    Store.saveGame(save);
    world.run.absorbed.push(orb.id);
    refreshStats(true);
    removeOrb(orb);
    autosave();
    burst(new THREE.Vector3(player.pos.x, 1.2, player.pos.z), e.color, 60, 3, 5);
    log(`${e.name}を飲み、吸収した！`);
    closeModal();
  };
  // 精髄は飲む（吸収する）か、立ち去る（その場に残す）しかできない
  $('#btn-leave').onclick = closeModal;
}

function removeOrb(orb) {
  orb.model.group.parent?.remove(orb.model.group);
  world.orbs.splice(world.orbs.indexOf(orb), 1);
}

function closeModal() {
  show(null);
  world.state = 'playing';
  input.clear();
  input.enabled = true;
  input.lockPointer();
}

function openMenu() {
  autosave();
  world.state = 'menu';
  releasePointer();
  input.enabled = false;
  input.clear();
  $('#menu-card').innerHTML = `
    <h2>一時停止 <span class="muted" style="font-size:14px">${world.time.label()} ／ ${world.floor.name}</span></h2>
    ${statusSummaryHTML()}
    <div class="btns">
      <button class="btn primary" id="btn-resume">探索に戻る</button>
      <button class="btn" id="btn-camp" ${enemiesNearby() || !world.time.flows(world.floor) ? 'disabled' : ''}>野営して時間を進める（${D.TIME.campDays} 日・HP 回復）${enemiesNearby() ? ' — 近くに魔物がいる' : ''}</button>
      <button class="btn" id="btn-menu-quality">画質：${settings.quality === 'high' ? '高' : '低'}（切り替え）</button>
      <button class="btn" id="btn-return" ${save.returnScrolls > 0 && !enemiesNearby() ? '' : 'disabled'}>${D.HUB.returnScroll.name}を読んで地上へ帰還する（所持 ${save.returnScrolls}）${save.returnScrolls > 0 && enemiesNearby() ? ' — 近くに魔物がいる' : ''}</button>
    </div>
    <div class="muted" style="margin-top:8px;font-size:13px">迷宮から出られるのは、この層が閉ざされたとき・力尽きたとき（出発前に戻る）・帰還の巻物などの特殊な効果を受けたときだけ。</div>
    ${D.DEBUG.menu ? debugMenuHTML() : ''}`;
  show('#menu-screen');
  if (D.DEBUG.menu) bindDebugMenu();
  $('#btn-resume').onclick = closeModal;
  $('#btn-camp').onclick = camp;
  $('#btn-menu-quality').onclick = () => { toggleQuality(); openMenu(); };
  $('#btn-return').onclick = () => useReturnScroll();
}

// ====================================================================== デバッグ用の機能（data.js の DEBUG.menu で表示を切り替える）
const DEBUG_WARPS = [[1, '第1層'], [21, '第2層 獣の巣窟'], [22, '第2層 亡者の地'], [23, '第2層 岩の砂漠'], [24, '第2層 ゴブリンの森'],
  [3, '第3層'], [4, '第4層'], [D.RIFT_FLOOR_ID, '次元の亀裂']];
function debugMenuHTML() {
  return `
    <details class="debug" data-test="debug" ${world.debugOpen ? 'open' : ''}>
      <summary>デバッグ（開発用）</summary>
      <div class="btns row">
        <button class="btn small" id="dbg-torch">松明：${world.debugTorch ? 'ON' : 'OFF'}</button>
        <button class="btn small" id="dbg-god">無敵：${world.debugGod ? 'ON' : 'OFF'}</button>
        <button class="btn small" id="dbg-kill">周りの魔物を全滅</button>
        <button class="btn small" id="dbg-day">時間を 1 日進める</button>
        <button class="btn small" id="dbg-heal">HP・スタミナ全回復</button>
        <button class="btn small" id="dbg-raiders">略奪者を呼ぶ</button>
      </div>
      <div class="muted" style="margin:6px 0 2px">ワープ</div>
      <div class="btns row">${DEBUG_WARPS.map(([id, name]) => `<button class="btn small" data-warp="${id}">${name}</button>`).join('')}</div>
    </details>`;
}
function bindDebugMenu() {
  const det = $('#menu-card details.debug');
  det.ontoggle = () => { world.debugOpen = det.open; };
  $('#dbg-torch').onclick = () => { world.debugTorch = !world.debugTorch; openMenu(); };
  $('#dbg-god').onclick = () => { world.debugGod = !world.debugGod; openMenu(); };
  $('#dbg-kill').onclick = () => {
    let n = 0;
    for (const m of world.monsters) if (m.state !== 'dead' && m.pos.distanceTo(player.pos) < 40) { killMonster(m); n++; }
    log(`（デバッグ）周りの魔物 ${n} 体を倒した`);
    openMenu();
  };
  $('#dbg-day').onclick = () => {
    world.time.hours += 24;
    log(`（デバッグ）時間を 1 日進めた：${world.time.label()}`);
    closeModal();
  };
  $('#dbg-heal').onclick = () => { player.hp = player.st.maxHp; player.stamina = player.st.maxStamina; openMenu(); };
  $('#dbg-raiders').onclick = () => { const ms = spawnRaiders([3, 3], 14); log(`（デバッグ）略奪者 ${ms.length} 人を呼んだ`); closeModal(); };
  document.querySelectorAll('#menu-card [data-warp]').forEach(b => b.onclick = () => debugWarp(Number(b.dataset.warp)));
}
// 指定した階層へワープする（第3層は通った第2層のエリアの方角から着く。なければ亡者の地から来た扱い）
function debugWarp(id) {
  const target = floorConfig(id);
  const from = world.floor;
  closeModal();
  let arrive = 'fromAbove';
  if (id === 1) arrive = 'start';
  if (target.isSpecialRift) world.riftReturn = from.isSpecialRift ? (world.riftReturn ?? 22) : from.id;
  if (id === D.FLOOR.F3) { world.run.via ??= from.depth === 2 && !from.isSpecialRift ? from.id : 22; world.arriveFrom = world.run.via; }
  else world.arriveFrom = from.id;
  fadeTransition(() => {
    buildFloor(target, arrive);
    if (!target.isSpecialRift && target.depth > save.deepest) save.deepest = target.depth;
    if (!target.isSpecialRift) world.run.deepest = Math.max(world.run.deepest, target.depth);
    $('#floor-name').textContent = target.name;
    applyQuality();
    autosave();
    log(`（デバッグ）${target.name}へワープした`);
    if (checkFloorClosure(world.time.elapsed, target.id)) log('この層はすでに閉鎖時間を過ぎている（すぐに送還される）');
  });
}

// 特殊な効果で地上へ帰還する。帰還の魔法などを追加するときも returnToSurface(名前) を呼ぶ
function returnToSurface(source) {
  if (world.state === 'result' || player.dead) return;
  closeModal();
  fadeTransition(() => endRun('return', source));
}

function useReturnScroll() {
  if (save.returnScrolls <= 0) return;
  if (enemiesNearby()) { log('近くに魔物がいて、巻物を読めない。'); return; }
  save.returnScrolls--;
  returnToSurface(D.HUB.returnScroll.name);
}

function toggleQuality() {
  settings.quality = settings.quality === 'high' ? 'low' : 'high';
  Store.saveSettings(settings);
  applyQuality();
}

// reason: 'closure'（階層の閉鎖で送還） / 'dead'（力尽きた：出発前に戻る） / 'return'（帰還の巻物・魔法などの特殊な効果。source に名前）
function endRun(reason, source = '') {
  if (world.state === 'result') return;
  world.state = 'result';
  releasePointer();
  input.enabled = false;
  input.clear();
  const run = world.run;
  const floorDef = world.floor;
  let kept = run.stones;
  let title = '', cls = 'ok', note = '';
  if (reason === 'closure') {
    title = '帰還（階層の閉鎖）';
    note = `${world.time.day} 日目（突入から ${Math.floor(world.time.elapsed)} 時間）、${floorDef.name}が閉ざされ、地上へ送還された。持ち帰った魔石をすべて手に入れた。`;
    save.clears++;
    if (floorDef.depth >= 2 && !floorDef.isSpecialRift) gainFeat('survive', { depth: floorDef.depth });
  }
  if (reason === 'dead') {
    // 迷宮に入る直前に戻る（所持品・装備・精髄・ステータス・日付も出発前の状態）
    const pre = Store.loadPreRun();
    const runs = save.runs;
    if (pre) save = { ...pre, runs };
    kept = {}; title = '力尽きた'; cls = 'ng';
    note = pre ? `迷宮に入る直前（第${save.cycle}周期 Day ${save.day}）に戻った。所持品・装備・精髄・ステータスは出発前の状態になった。`
      : 'この探索で得た魔石はすべて失われた。';
  }
  if (reason === 'return') {
    title = `帰還（${source}）`;
    note = `${world.time.day} 日目、${source}の力で地上へ戻った。持ち帰った魔石をすべて手に入れた。`;
    save.clears++;
  }
  save.stones = mergeStones({ ...save.stones }, kept);
  // 素材も持ち帰る（力尽きたときは出発前に戻るので、その探索の素材は失われる）
  const keptMats = reason === 'dead' ? {} : run.mats ?? {};
  save.mats = { ...(save.mats ?? {}) };
  for (const [id, n] of Object.entries(keptMats)) save.mats[id] = (save.mats[id] || 0) + n;
  save.runs++;
  // 都市の日付を、迷宮を出た日に合わせる（地上ゲートは次の開放日まで閉じている）。力尽きたときは出発前の日付のまま
  if (reason !== 'dead') {
    const before = save.day;
    save.day = Math.min(D.TIME.cycleDays, Math.max(save.day, world.time.day));
    // 開放日のうちに戻ってきたら、都市の時刻も進める
    save.hour = save.day === 1 ? Math.max(before === 1 ? save.hour : 0, world.time.hours % 24) : 0;
  }
  save.runInProgress = false;
  Store.saveGame(save);
  Store.clearRun();
  $('#result-card').innerHTML = `
    <div class="result-title ${cls}">${title}</div>
    <div class="muted" style="text-align:center">${note}</div>
    <div class="kv" style="margin-top:12px"><span>最後にいた階層 / 到達した最深層</span><span>${floorDef.name} / 第${run.deepest}層${run.rift ? '（亀裂にも入った）' : ''}</span></div>
    <div class="kv"><span>迷宮にいた期間</span><span>Day ${run.startDay} → Day ${world.time.day}</span></div>
    <div class="kv"><span>倒した敵</span><span>${run.kills}</span></div>
    <div class="kv"><span>持ち帰った魔石</span><span>${stoneText(kept)}${stoneCount(kept) ? `（${stoneValue(kept)} G 相当）` : ''}</span></div>
    <div class="kv"><span>持ち帰った素材</span><span>${Object.entries(keptMats).map(([id, n]) => `${D.MATERIALS[id].name}×${n}`).join('・') || 'なし'}</span></div>
    <div class="kv"><span>レベル / 経験値</span><span>Lv ${save.level ?? 1}（${reason === 'dead' ? 'この探索の経験値は失われた' : `この探索で +${run.expGained ?? 0}`}）</span></div>
    <div class="kv"><span>吸収した精髄</span><span>${run.absorbed.map(id => D.ESSENCES[id].name).join('・') || 'なし'}${reason === 'dead' && run.absorbed.length ? '（出発前に戻ったため失われた）' : ''}</span></div>
    <div class="kv"><span>使ったスキル / 回復薬</span><span>${run.skillsUsed} 回 / ${run.potionsUsed} 個</span></div>
    <div class="btns row">
      <button class="btn primary" id="btn-to-hub">拠点へ戻る</button>
    </div>`;
  show('#result-screen');
  $('#btn-to-hub').onclick = () => showHub(`${title}。${stoneCount(kept) ? `魔石を持ち帰った（${stoneText(kept)}）。` : ''}${reason === 'dead' ? '地上ゲートはまだ開いている。' : ''}`);
}

document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && world.state === 'playing' && !player.dead) openMenu();
});
// 結果・メニュー画面ではマウスの固定を外す
function releasePointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

// ====================================================================== メインループ
let last = performance.now();
function frame(now) {
  // 次のフレームを先に予約する（途中でエラーが起きても、ゲームが止まったままにならないように）
  requestAnimationFrame(frame);
  // 重い端末でフレームが遅れても、ゲームの速さが落ちすぎないよう 0.1 秒まで受け付ける
  const rawDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  try {
    step(rawDt);
  } catch (e) { reportError(e); }
  try {
    renderer.autoClear = true;
    renderer.render(scene, camera);
    if (world.state === 'playing' && player.viewmodel.group.visible) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(vmScene, vmCamera);
    }
  } catch (e) { reportError(e); }
}

// エラーを画面に小さく出す（同じエラーは 1 回だけ。ゲームは続ける）
const reportedErrors = new Set();
function reportError(e) {
  const msg = (e?.message ?? String(e)) + ' @ ' + ((e?.stack ?? '').split('\n')[1] ?? '').trim();
  if (reportedErrors.has(msg)) return;
  reportedErrors.add(msg);
  console.error(e);
  let box = document.getElementById('error-box');
  if (!box) { box = document.createElement('div'); box.id = 'error-box'; document.body.appendChild(box); }
  box.textContent = 'エラーが起きました（ゲームは続きます）：' + msg;
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, 8000);
}
addEventListener('error', e => reportError(e.error ?? e.message));
addEventListener('unhandledrejection', e => reportError(e.reason));

// 開放日は都市でも時間が流れる（迷宮と同じ速さ）。入場フェイズが過ぎるとゲートが閉じる
function updateCityClock(dt) {
  const T = D.TIME;
  if (save.day !== 1 || save.hour >= T.gateOpenHours) return;
  const before = save.hour;
  save.hour = Math.min(T.gateOpenHours, save.hour + dt / T.secondsPerDay * 24);
  world.citySaveTimer = (world.citySaveTimer ?? 0) + dt;
  const closed = save.hour >= T.gateOpenHours;
  const late = isLateEntry(save.hour) && !isLateEntry(before);
  if (closed || late || world.citySaveTimer > 5) { world.citySaveTimer = 0; Store.saveGame(save); }
  if (closed) hubClockChanged(true, '地上ゲートが閉じた。次の開放日まで待つしかない。');
  else if (late) hubClockChanged(true, 'まもなく地上ゲートが閉じる。いま飛び込むと、暗黒地帯に降り立ってしまうかもしれない。');
  else if (Math.floor(before * 60) !== Math.floor(save.hour * 60)) hubClockChanged(false);
}

function step(dt) {
  input.update(dt);
  if (world.state === 'title') {
    // タイトルの背景：ダンジョンの入口をゆっくり見回す
    world.clock += dt;
    camState.yaw += dt * 0.12;
    camState.pitch = -0.05;
    updatePickups(dt);
    updateCamera(dt);
    return;
  }
  if (world.state === 'hub') updateCityClock(dt);
  if (world.state !== 'playing' && world.state !== 'result') { updateParticles(dt); updatePopups(dt); updatePickups(dt); return; }
  if (world.state === 'playing' && input.consume('menu')) { openMenu(); return; }
  if (world.hitStop > 0) { world.hitStop -= dt; updatePopups(dt); return; } // ヒットストップ中は時間を止める
  world.clock += dt;
  if (world.state === 'playing') {
    const t = world.time.tick(dt, world.floor);
    if (t.dayChanged) onNewDay();
    if (t.closed && !player.dead) { endRun('closure'); return; }
    updatePlayer(dt);
    world.autosaveTimer = (world.autosaveTimer ?? 0) + dt;
    if (world.autosaveTimer > AUTOSAVE_INTERVAL) autosave();
    if (input.consume('interact') && !player.dead) {
      const it = nearestInteractable();
      if (it?.type === 'orb') openAbsorb(it.orb);
      else if (it?.type === 'portal') usePortal(it.portal);
      else if (it?.type === 'stele') touchStele(it.stele);
    }
    updateTraps(dt);
    updateField(dt);
  }
  updateMonsters(dt);
  updateProjectiles(dt);
  if (world.state === 'playing') updateReinforcements(dt);
  updatePickups(dt);
  updateParticles(dt);
  updatePopups(dt);
  updateCamera(dt);
  if (world.state === 'playing') updateHUD();
}

// ====================================================================== Android の戻るボタン
input.onBack = () => {
  switch (world.state) {
    case 'playing': if (!player.dead) openMenu(); break;
    case 'menu':
    case 'absorb': closeModal(); break;
    case 'result': showHub(); break;
    case 'hub': showTitle(); break;
    case 'title': input.exitApp(); break;
  }
};

// ====================================================================== タイトル画面のボタン
$('#btn-start').onclick = () => {
  if (world.pendingResume) { resumeRun(world.pendingResume); input.lockPointer(); }
  else showHub();
};
$('#btn-quality').onclick = () => { toggleQuality(); showTitle(); };
$('#btn-reset').onclick = () => {
  if (confirm('セーブデータ（吸収した精髄・魔石・記録）をすべて消去します。よろしいですか？')) {
    save = Store.resetGame();
    world.pendingResume = null;
    world.bootNote = '';
    showTitle();
  }
};

// 起動
resize();
player.st = computeStats();
// 前回、探索中にアプリが終了していたら、オートセーブした所から続ける
if (save.runInProgress) {
  const rs = Store.loadRunState();
  if (rs?.v === 1 && D.FLOORS.some(f => f.id === rs.floorId)) {
    world.pendingResume = rs;
    world.bootNote = `探索の途中です（${floorConfig(rs.floorId).name}）。「続きから」で再開できます。`;
  } else {
    // 探索中の記録が読めないときは、迷宮に入る直前に戻す
    const pre = Store.loadPreRun();
    save = pre ? { ...pre, runInProgress: false } : { ...save, runInProgress: false };
    Store.saveGame(save);
    Store.clearRun();
  }
}
world.time.start(save.day, 0);
buildFloor(floorConfig(1));  // タイトルの背景として第 1 層を表示する
vmScene.add(player.viewmodel.group);
applyQuality();
showTitle();
requestAnimationFrame(frame);

// 動作確認・自動テスト用
window.game = {
  THREE, world, player, input, D,
  get save() { return save; },
  get state() { return world.state; },
  startRun, endRun, openMenu, closeModal,
  teleport(x, z) { player.pos.set(x, 0, z); },
  face(x, z) { camState.yaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z)); camState.pitch = -0.1; },
  get cam() { return camState; },
  tile(r, c) { return cellCenter(r, c); },
  get time() { return world.time; },
  setHours(h) { world.time.hours = h; },
  setCityHour(h) { save.hour = h; },
  setElapsed(h) { world.time.hours = world.time.startHours + h; },   // 突入からの経過時間を設定する
  closeHours() { return closeHoursOf(world.floor); },
  fogFar() { return scene.fog?.far; },
  torchLight() { return { intensity: world.torch.intensity, range: world.torch.distance }; },
  get landing() { return { dark: world.landedInDark, vis: visibilityAt(player.pos), glow: world.glow?.[Math.round(player.pos.z / T)]?.[Math.round(player.pos.x / T)] }; },
  portals() { return world.portals; },
  rebuild(id, arrive = 'start') { buildFloor(floorConfig(id), arrive); },
  usePortal,
  camp,
  autosave,
  useReturnScroll,
  debugWarp,
  get runState() { return Store.loadRunState(); },
  get preRun() { return Store.loadPreRun(); },
  forceDrops(on = true) { world.forceDrops = on; },
  forceLoot(on = true) { world.forceLoot = on; },
  gainFeat,
  kill(m) { if (m.state !== 'dead') killMonster(m); },
  spawn(id, x, z, boss = false) { return spawnMonster(id, new THREE.Vector3(x, 0, z), boss); },
  regionKeyAt, regionAt, isSafeCell, touchStele, spawnRaiders,
  // 歩いてたどった距離（マス）。迷路では直線距離より正確
  pathDist(from, to) {
    const sr = Math.round(from.z / T), sc = Math.round(from.x / T), tr = Math.round(to.z / T), tc = Math.round(to.x / T);
    const seen = new Map([[sr * 1000 + sc, 0]]), q = [[sr, sc]];
    for (let i = 0; i < q.length; i++) { const [r, c] = q[i]; const d = seen.get(r * 1000 + c); if (r === tr && c === tc) return d;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc, k = nr * 1000 + nc; if (isWallCell(nr, nc) || seen.has(k)) continue; seen.set(k, d + 1); q.push([nr, nc]); } }
    return Infinity;
  },
  aggro(m) { if (!m.aggro) { m.aggro = true; onAggro(m); } },
  stoneCount, stoneValue,
  attack() { input.pressed.add('attack'); },
  interact() { input.pressed.add('interact'); },
  stats() { return computeStats(); },
};

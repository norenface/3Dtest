// 精髄の迷宮
// 3D ダンジョン（一人称視点）・移動と攻撃・敵 3 種・精髄のドロップと吸収・精髄スキル・回復薬・拠点・
// 迷宮の開閉と階層閉鎖のサイクル（time.js の TimeManager）・階層間の門・次元の亀裂。
// ゲームバランスの数値はすべて data.js から読む。入力は input.js、保存は storage.js 経由。
import * as THREE from 'three';
import * as D from './data.js';
import { Input } from './input.js';
import * as Store from './storage.js';
import { openHub } from './hub.js';
import { makeViewmodel, makeMonster, makeEssenceOrb, makeMagicStone, makePortal, flatMat } from './models.js';
import { TimeManager, floorConfig, closeDayOf, checkFloorClosure, formatRemaining } from './time.js';

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
function computeStats() {
  const race = D.RACES[save.race];
  const stats = { ...race.base };
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
    maxHp: Math.round(F.hpBase + stats.VIT * F.hpPerVIT + armor.hpBonus),
    maxStamina: Math.round(F.staminaBase + stats.VIT * F.staminaPerVIT + stats.AGI * F.staminaPerAGI),
    attack: stats.STR * F.attackPerSTR + weapon.attackBonus,
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
  root: null, wallMesh: null, pillars: [], torch: null, exit: null,
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
function glowMat(color, emissive, intensity, glowMap) {
  const m = new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, flatShading: true, roughness: 0.9, metalness: 0 });
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

// restore: オートセーブから再開するときの状態（門・魔物・落ちている物・プレイヤーの位置をそのまま戻す）
function buildFloor(floorDef, arrive = 'start', restore = null) {
  if (world.root) scene.remove(world.root);
  const root = new THREE.Group();
  world.root = root;
  scene.add(root);
  world.floor = floorDef;
  world.grid = floorDef.map.map(row => row.split(''));
  world.rows = world.grid.length;
  world.cols = world.grid[0].length;
  world.pillars = [];
  world.monsters = [];
  world.orbs = [];
  world.stones = [];
  world.portals = [];
  world.spawnCells = [];
  for (const el of document.querySelectorAll('.ebar')) el.remove();
  const rnd = seeded(floorDef.id * 7919);
  const L = floorDef.lighting;

  const crystalMode = L.mode === 'crystal';
  scene.background = new THREE.Color(L.fog);
  scene.fog = new THREE.Fog(L.fog, 14, crystalMode ? L.litFog : 42);
  root.add(new THREE.HemisphereLight(L.ambient, 0x10100c, L.ambientIntensity));
  world.vis = null;
  world.crystalPoints = null;
  world.inDark = false;

  // 床（インスタンス描画）
  const floorCells = [], wallCells = [];
  let start = null;
  const portalCells = { N: [], U: [], R: [], B: [] };
  for (let r = 0; r < world.rows; r++) {
    for (let c = 0; c < world.cols; c++) {
      const ch = world.grid[r][c];
      if (ch === '#') {
        // 床に接している壁だけ作る
        const touches = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
          .some(([dr, dc]) => !isWallCell(r + dr, c + dc));
        if (touches) wallCells.push([r, c]);
      } else {
        floorCells.push([r, c]);
        if (ch === 'S') start = [r, c];
        if (portalCells[ch]) portalCells[ch].push([r, c]);
        if (floorDef.monsterTable[ch]) world.spawnCells.push({ r, c, id: floorDef.monsterTable[ch] });
      }
    }
  }
  let crystals = [], glowMap = null;
  if (crystalMode) {
    crystals = floorCells.filter(([r, c]) => world.grid[r][c] === 'C');
    glowMap = makeGlowMap(crystalField(crystals, CRYSTAL_REACH));
    world.vis = crystalField(crystals, CRYSTAL_VIEW);
  }
  const tmp = new THREE.Object3D();
  const col = new THREE.Color();
  const floorMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.2, T), crystalMode ? glowMat(0x2a4f8c, 0x4a96ee, 0.85, glowMap) : flatMat(0xffffff, { roughness: 0.95 }), floorCells.length);
  floorCells.forEach(([r, c], i) => {
    tmp.position.set(c * T, -0.1, r * T); tmp.rotation.set(0, 0, 0); tmp.scale.set(1, 1, 1); tmp.updateMatrix();
    floorMesh.setMatrixAt(i, tmp.matrix);
    const v = crystalMode ? 0.9 + rnd() * 0.2 : 0.34 + rnd() * 0.08;
    floorMesh.setColorAt(i, col.setRGB(v * 1.02, v, v * 0.92));
  });
  floorMesh.receiveShadow = true;
  root.add(floorMesh);

  // 床の継ぎ目（石畳っぽく見せる細い溝）
  const seamMat = flatMat(crystalMode ? 0x1d3d70 : 0x1c1b1a);
  const seamGeoX = new THREE.BoxGeometry(T, 0.02, 0.06), seamGeoZ = new THREE.BoxGeometry(0.06, 0.02, T);
  const seams = new THREE.InstancedMesh(seamGeoX, seamMat, floorCells.length * 2);
  const seamsZ = new THREE.InstancedMesh(seamGeoZ, seamMat, floorCells.length * 2);
  floorCells.forEach(([r, c], i) => {
    for (let k = 0; k < 2; k++) {
      tmp.position.set(c * T, 0.005, r * T - T / 2 + (k + 0.5) * T / 2); tmp.updateMatrix(); seams.setMatrixAt(i * 2 + k, tmp.matrix);
      tmp.position.set(c * T - T / 2 + (k + 0.5) * T / 2, 0.005, r * T); tmp.updateMatrix(); seamsZ.setMatrixAt(i * 2 + k, tmp.matrix);
    }
  });
  root.add(seams, seamsZ);

  // 壁（インスタンス描画。少しずつ色と高さを変えて石積みらしく）
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(T, D.WALL_HEIGHT, T), crystalMode ? glowMat(0x0e1528, 0x1c3460, 0.45, glowMap) : flatMat(0xffffff, { roughness: 0.9 }), wallCells.length);
  wallCells.forEach(([r, c], i) => {
    const hy = 1 + (rnd() - 0.5) * 0.08;
    tmp.position.set(c * T, D.WALL_HEIGHT * hy / 2, r * T); tmp.scale.set(1, hy, 1); tmp.updateMatrix();
    wallMesh.setMatrixAt(i, tmp.matrix);
    const v = crystalMode ? 0.85 + rnd() * 0.3 : 0.28 + rnd() * 0.07;
    wallMesh.setColorAt(i, col.setRGB(v, v * 0.96, v * 0.9));
  });
  tmp.scale.set(1, 1, 1);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  root.add(wallMesh);
  world.wallMesh = wallMesh;

  // 天井（一人称視点では見上げると見える）
  const ceil = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.3, T), crystalMode ? glowMat(0x13213e, 0x2a5aa0, 0.45, glowMap) : flatMat(0xffffff, { roughness: 1 }), floorCells.length);
  floorCells.forEach(([r, c], i) => {
    tmp.position.set(c * T, D.WALL_HEIGHT + 0.15, r * T); tmp.updateMatrix();
    ceil.setMatrixAt(i, tmp.matrix);
    const v = crystalMode ? 0.9 + rnd() * 0.2 : 0.16 + rnd() * 0.04;
    ceil.setColorAt(i, col.setRGB(v, v * 0.97, v * 0.93));
  });
  ceil.receiveShadow = true;
  root.add(ceil);
  // 天井の梁（4m ごと）
  const beams = new THREE.InstancedMesh(new THREE.BoxGeometry(T, 0.35, 0.35), flatMat(0x3a2c20), floorCells.length);
  floorCells.forEach(([r, c], i) => {
    tmp.position.set(c * T, D.WALL_HEIGHT - 0.15, r * T - T / 2); tmp.updateMatrix(); beams.setMatrixAt(i, tmp.matrix);
  });
  if (!crystalMode) root.add(beams);   // 水晶の迷宮には木の梁はない

  // 壁の上端の縁取り（輪郭をわかりやすくする）
  const capMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(T + 0.1, 0.15, T + 0.1), flatMat(crystalMode ? 0x0c1426 : 0x77705f), wallCells.length);
  wallCells.forEach(([r, c], i) => {
    tmp.position.set(c * T, D.WALL_HEIGHT + 0.07, r * T); tmp.updateMatrix(); capMesh.setMatrixAt(i, tmp.matrix);
  });
  root.add(capMesh);

  // 柱・瓦礫
  for (const [r, c] of floorCells) {
    const ch = world.grid[r][c];
    const p = cellCenter(r, c);
    if (ch === 'P') {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, D.WALL_HEIGHT, 8), flatMat(0x5a5650));
      pillar.position.set(p.x, D.WALL_HEIGHT / 2, p.z);
      pillar.castShadow = pillar.receiveShadow = true;
      root.add(pillar);
      for (const y of [0.15, D.WALL_HEIGHT - 0.15]) {
        const ring = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), flatMat(0x46433e));
        ring.position.set(p.x, y, p.z); root.add(ring);
      }
      world.pillars.push({ x: p.x, z: p.z, r: 0.75 });
    } else if (!crystalMode && rnd() < 0.18 && ch === '.') {
      for (let k = 0; k < 3; k++) {
        const s = 0.15 + rnd() * 0.3;
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flatMat(0x4c4842));
        rock.position.set(p.x + (rnd() - 0.5) * 3, s * 0.6, p.z + (rnd() - 0.5) * 3);
        rock.rotation.set(rnd() * 3, rnd() * 3, 0);
        root.add(rock);
      }
    }
  }

  // 松明（光源は数を固定する：見た目だけの松明と、光る松明を分ける）。水晶の迷宮では松明の代わりにライトクリスタル
  if (crystalMode) buildCrystals(root, crystals, rnd, L);
  const torchCandidates = [];
  if (!crystalMode) {
  for (const [r, c] of wallCells) {
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!isWallCell(r + dr, c + dc)) torchCandidates.push([r, c, dr, dc]);
    }
  }
  const torchCount = Math.min(14, torchCandidates.length);
  const lit = [];
  for (let i = 0; i < torchCount; i++) {
    const [r, c, dr, dc] = torchCandidates[Math.floor(rnd() * torchCandidates.length)];
    const x = c * T + dc * (T / 2 + 0.08), z = r * T + dr * (T / 2 + 0.08);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), flatMat(0x3a2a1a));
    holder.position.set(x, 2.1, z); root.add(holder);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.32, 5),
      new THREE.MeshBasicMaterial({ color: L.torchColor }));
    flame.position.set(x, 2.5, z); root.add(flame);
    if (lit.length < 4) lit.push({ x, z, flame });
  }
  world.torchLights = lit.map(t => {
    const l = new THREE.PointLight(L.torchColor, 14, 13, 1.8);
    l.position.set(t.x, 2.6, t.z);
    root.add(l);
    return { light: l, base: 14, flame: t.flame };
  });
  }

  // 門（候補地点ごとに出現率で決める）
  const depthFloor = d => D.FLOORS.find(f => !f.isSpecialRift && f.depth === d);
  const pick = (cells, rate, atLeastOne) => {
    const chosen = cells.filter(() => Math.random() < rate);
    if (atLeastOne && !chosen.length && cells.length && rate > 0) chosen.push(cells[Math.floor(Math.random() * cells.length)]);
    return chosen;
  };
  const next = floorDef.isSpecialRift ? null : depthFloor(floorDef.depth + 1);
  const prev = floorDef.isSpecialRift ? null : depthFloor(floorDef.depth - 1);
  if (restore) {
    for (const p of restore.portals) addPortal(p.kind, p.cell, p.target, p.rot);
  } else {
    if (next) for (const cell of pick(portalCells.N, floorDef.nextPortalSpawnRate, true)) addPortal('next', cell, next.id);
    if (prev) for (const cell of pick(portalCells.U, floorDef.prevPortalSpawnRate, false)) addPortal('prev', cell, prev.id);
    // 亀裂から戻ってきたときは、亀裂の門を必ず置く（そこから出てくる）
    const riftCells = arrive === 'fromRift' ? portalCells.R.slice(0, 1) : pick(portalCells.R, floorDef.riftPortalSpawnRate, false);
    for (const cell of riftCells) addPortal('rift', cell, D.RIFT_FLOOR_ID);
    for (const cell of portalCells.B) addPortal('back', cell, world.riftReturn ?? 1);
  }

  // プレイヤーの到着位置
  let sp = cellCenter(...start ?? portalCells.B[0]);
  const near = kind => world.portals.find(p => p.kind === kind);
  if (arrive === 'fromBelow' && near('next')) sp = near('next').pos.clone().add(new THREE.Vector3(0, 0, 1.8));
  if (arrive === 'fromRift' && near('rift')) sp = near('rift').pos.clone().add(new THREE.Vector3(0, 0, 1.8));
  if (floorDef.isSpecialRift && near('back')) sp = near('back').pos.clone().add(new THREE.Vector3(0, 0, 1.8));
  player.pos.copy(sp);
  player.facing = Math.PI;  // +Z 方向（ダンジョンの奥）を向く
  if (arrive === 'start' && floorDef.startFacing === 'north') player.facing = 0;   // -Z（マップの上＝北）
  if (restore) { player.pos.set(restore.player.x, 0, restore.player.z); player.facing = restore.player.yaw; }
  collide(player.pos, 0.45);
  camState.yaw = player.facing;
  camState.pitch = -0.08;

  // プレイヤーの松明（影を落とす唯一の光源）
  // 水晶の迷宮では手元を照らす程度（暗黒地帯では先が見えない）
  world.torchBase = crystalMode ? 4 : 14;
  const torch = new THREE.PointLight(0xffc27a, world.torchBase, crystalMode ? 8 : 18, 1.5);
  torch.castShadow = settings.quality === 'high';
  torch.shadow.mapSize.set(512, 512);
  torch.shadow.bias = -0.002;
  root.add(torch);
  world.torch = torch;

  // モンスター
  if (restore) {
    for (const m of restore.monsters) {
      const mon = spawnMonster(m.id, new THREE.Vector3(m.x, 0, m.z));
      mon.home.set(m.hx, 0, m.hz);
      mon.hp = Math.min(mon.maxHp, m.hp);
    }
    for (const o of restore.orbs) placeOrb(o.id, o.x, o.z);
    for (const [x, z] of restore.stones) placeStone(x, z);
  } else {
    for (const [r, c] of floorCells) {
      const id = floorDef.monsterTable[world.grid[r][c]];
      if (id) spawnMonster(id, cellCenter(r, c));
    }
  }
}

function addPortal(kind, [r, c], target, rot = null) {
  // 上層への門は、上の層がすでに閉鎖されていたら閉ざされている
  const closed = kind === 'prev' && checkFloorClosure(world.time.day, target);
  const model = makePortal(kind, closed);
  const pos = cellCenter(r, c);
  model.group.position.copy(pos);
  // 門は通路の向きに合わせる（南北に開いていれば南北を向く。行き止まりの切れ込みでは開いた側を向く）
  const openNS = !isWallCell(r - 1, c) || !isWallCell(r + 1, c), openEW = !isWallCell(r, c - 1) || !isWallCell(r, c + 1);
  const auto = openNS && !openEW ? 0 : openEW && !openNS ? Math.PI / 2 : (Math.random() < 0.5 ? 0 : Math.PI / 2);
  model.group.rotation.y = rot ?? auto;
  world.root.add(model.group);
  world.portals.push({ kind, pos, model, target, closed, cell: [r, c] });
  // 門の柱にぶつかるようにする（くぐる中央は通れる）
  const ax = Math.cos(model.group.rotation.y), az = -Math.sin(model.group.rotation.y);
  for (const s of [-1, 1]) world.pillars.push({ x: pos.x + ax * 1.1 * s, z: pos.z + az * 1.1 * s, r: 0.3 });
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
function spawnMonster(id, pos) {
  const def = D.MONSTERS[id];
  const scale = world.floor.monsterScale ?? { hp: 1, attack: 1, stones: 1 };
  const model = makeMonster(def.model);
  // 被弾時に個体ごと光らせるため、マテリアルを複製する
  const mats = [];
  model.group.traverse(o => {
    if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); o.castShadow = true; }
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
    attack: Math.round(def.attack * scale.attack), stones: Math.round(def.stones * scale.stones), dropBonus: scale.dropBonus ?? 0,
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
    for (const p of world.pillars) {
      const dx = pos.x - p.x, dz = pos.z - p.z, d = Math.hypot(dx, dz), min = p.r + radius;
      if (d < min && d > 1e-6) { pos.x += dx / d * (min - d); pos.z += dz / d * (min - d); }
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
function nextStepToward(from, to) {
  const sr = Math.round(from.z / T), sc = Math.round(from.x / T);
  const tr = Math.round(to.z / T), tc = Math.round(to.x / T);
  if (sr === tr && sc === tc) return to.clone();
  const key = (r, c) => r * world.cols + c;
  const prev = new Map([[key(sr, sc), -1]]);
  const queue = [[sr, sc]];
  while (queue.length) {
    const [r, c] = queue.shift();
    if (r === tr && c === tc) break;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (isWallCell(nr, nc) || prev.has(key(nr, nc))) continue;
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
  vel: new Float32Array(MAX_PARTICLES * 3), life: new Float32Array(MAX_PARTICLES), next: 0,
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
  }
}

function updateParticles(dt) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particles.life[i] <= 0) continue;
    particles.life[i] -= dt;
    const k = i * 3;
    particles.vel[k + 1] -= 9 * dt;
    particles.pos[k] += particles.vel[k] * dt;
    particles.pos[k + 1] = Math.max(0.05, particles.pos[k + 1] + particles.vel[k + 1] * dt);
    particles.pos[k + 2] += particles.vel[k + 2] * dt;
    const fade = Math.max(0, particles.life[i] / 0.9);
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
  m.hp -= dmg;
  m.flash = 0.12;
  m.aggro = true;
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
  burst(new THREE.Vector3(m.pos.x, 0.8, m.pos.z), 0xbfe8ff, 40, 5, 3);
  // 魔石
  const count = m.stones + player.st.extraStones;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    placeStone(m.pos.x + Math.cos(a) * 0.6, m.pos.z + Math.sin(a) * 0.6);
  }
  // 精髄
  for (const drop of m.def.drops) {
    if (Math.random() < drop.chance + m.dropBonus || world.forceDrops) dropEssence(drop.essence, m.pos);
  }
}

function placeStone(x, z) {
  const s = makeMagicStone();
  s.group.position.set(x, 0, z);
  world.root.add(s.group);
  world.stones.push({ model: s, pos: s.group.position, t: Math.random() * 5 });
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
  if (player.invuln > 0 || player.dead) return;
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
  let speed = st.moveSpeed * Math.min(1, Math.hypot(mx, my));
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
  world.torch.intensity = world.torchBase + Math.sin(world.clock * 13) * 1.0 + Math.sin(world.clock * 7.3) * 0.8;
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
    const sees = dist < def.aggroRange && lineOfSight(m.pos, player.pos);
    if (sees) m.aggro = true;
    if (m.aggro && dist > def.aggroRange * 1.8) m.aggro = false;
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
        if (m.aggro) {
          m.state = 'chase';
          if (dist < def.attackRange && m.cooldown <= 0) {
            m.state = 'windup'; m.timer = def.windup;
            break;
          }
          if (dist > def.attackRange * 0.8) {
            if (sees) moveDir = toP.clone().normalize();
            else {
              m.pathTimer -= dt;
              if (m.pathTimer <= 0 || !m.path) { m.path = nextStepToward(m.pos, player.pos); m.pathTimer = 0.5; }
              if (m.path) moveDir = new THREE.Vector3(m.path.x - m.pos.x, 0, m.path.z - m.pos.z).normalize();
            }
          }
          m.facing = turnToward(m.facing, Math.atan2(-toP.x, -toP.z), dt * 8);
        } else {
          m.state = 'idle';
          // うろうろする
          if (!m.wanderTarget || m.pos.distanceTo(m.wanderTarget) < 0.5 || Math.random() < dt * 0.2) {
            const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
            m.wanderTarget = new THREE.Vector3(m.home.x + Math.cos(a) * r, 0, m.home.z + Math.sin(a) * r);
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
          if (def.model === 'wolf') { m.vel.x += -Math.sin(m.facing) * 9; m.vel.z += -Math.cos(m.facing) * 9; } // 飛びかかる
          if (dist < def.attackRange + 0.6) {
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

    animateMonster(m, moveDir ? def.speed * speedMul : 0);
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
  if (m.def.model === 'wolf') {
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
      if (m.def.model === 'golem') P.armL.rotation.x = -2.6 * Math.min(1, t * 1.5);
      P.body.rotation.x = 0.15 * t;
    } else if (m.state === 'strike') {
      P.armR.rotation.x = 0.8;
      if (m.def.model === 'golem') P.armL.rotation.x = 0.8;
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
      world.run.stones++;
      const p = player.pos.clone(); p.y = 2;
      popup(p, '+1 魔石', 'gain');
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
  if (p.kind === 'next') return `下層への門をくぐる（${target.name}／閉鎖 ${closeDayOf(target)}日目）`;
  if (p.kind === 'prev') return p.closed ? `上層への門 — ${target.name}はすでに閉ざされている` : `上層への門をくぐる（${target.name}／閉鎖 ${closeDayOf(target)}日目）`;
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
  return best;
}

// ====================================================================== 階層の移動・時間
function usePortal(p) {
  if (p.closed) { log(`${floorConfig(p.target).name}はすでに閉ざされている。この層の閉鎖を待つしかない。`); return; }
  const from = world.floor;
  let arrive = 'start';
  if (p.kind === 'prev') arrive = 'fromBelow';
  if (p.kind === 'rift') world.riftReturn = from.id;
  if (p.kind === 'back') { arrive = 'fromRift'; }
  const target = floorConfig(p.target);
  fadeTransition(() => {
    buildFloor(target, arrive);
    if (p.kind === 'back') world.riftReturn = null;
    if (!target.isSpecialRift && target.depth > save.deepest) { save.deepest = target.depth; }
    world.run.deepest = Math.max(world.run.deepest, target.isSpecialRift ? world.run.deepest : target.depth);
    if (target.isSpecialRift) world.run.rift = true;
    autosave();
    $('#floor-name').textContent = target.name;
    applyQuality();
    if (target.isSpecialRift) log(`${target.name}に入った。ここでは時間が止まっている。`);
    else log(`${target.name}に着いた。この層は ${closeDayOf(target)} 日目に閉ざされる。`);
    // 閉鎖済みの層に入ってしまうことはない（上層への門は閉ざされる）が、念のため判定する
    if (checkFloorClosure(world.time.day, target.id)) endRun('closure');
  });
}

function fadeTransition(fn) {
  const el = $('#fade');
  world.state = 'transition';
  input.clear();
  el.classList.add('on');
  setTimeout(() => {
    fn();
    if (world.state === 'transition') world.state = 'playing';
    setTimeout(() => el.classList.remove('on'), 60);
  }, 350);
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
    spawnMonster(sc.id, cellCenter(sc.r, sc.c));
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

function updateCamera(dt) {
  // 水晶の迷宮：いる場所の明るさで見通しが変わる（暗黒地帯では数 m 先しか見えない）
  if (world.vis && scene.fog) {
    const L = world.floor.lighting;
    const v = visibilityAt(player.pos);
    const far = L.darkFog + (L.litFog - L.darkFog) * Math.min(1, v * 1.8);
    scene.fog.far += (far - scene.fog.far) * Math.min(1, dt * 2.5);
    scene.fog.near = scene.fog.far * 0.2;
    const dark = v < 0.05;
    if (world.state === 'playing' && dark !== world.inDark) {
      world.inDark = dark;
      if (dark) log('暗黒地帯に入った。先が見通せない。');
    }
  }
  updateCrystalLights(dt);
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
  $('#st-bar i').style.width = (player.stamina / st.maxStamina * 100) + '%';
  $('#st-text').textContent = `${Math.floor(player.stamina)} / ${st.maxStamina}`;
  const left = world.time.hoursUntilClose(world.floor);
  $('#timer').textContent = world.time.label();
  const ci = $('#close-info');
  ci.textContent = left === null ? (world.floor.isSpecialRift ? '時間が止まっている' : '') : `この層の閉鎖まで ${formatRemaining(left)}`;
  ci.classList.toggle('warn', left !== null && left <= D.TIME.warnHours);
  $('#stones').textContent = world.run.stones;
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
    <div class="kv"><span>暦</span><span>第${save.cycle}周期 Day ${save.day}（地上ゲート${save.day === 1 ? '開放中' : '閉鎖中'}）</span></div>
    <div class="kv"><span>種族</span><span>${race.name}</span></div>
    <div class="kv"><span>ゴールド / 魔石</span><span>${save.gold} G / ${save.stones} 個</span></div>
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
  world.run = { floor: floorDef.id, stones: 0, kills: 0, absorbed: [], damageDealt: 0, damageTaken: 0, skillsUsed: 0, potionsUsed: 0,
    deepest: 1, rift: false, startDay: save.day, startedAt: performance.now() };
  // 開放日の入場フェイズに入場する
  world.time.start(save.day, D.TIME.entryHour);
  world.riftReturn = null;
  save.runInProgress = true;
  world.pendingResume = null;
  world.bootNote = '';
  prepareRun();
  buildFloor(floorDef, 'start');
  enterPlaying(floorDef);
  log(`${floorDef.name}に降り立った。この層は ${closeDayOf(floorDef)} 日目に閉ざされ、そのとき地上へ送還される。`);
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
    run,
    player: { x: player.pos.x, z: player.pos.z, yaw: camState.yaw, hp: player.hp, stamina: player.stamina, cooldowns: player.skillCooldowns },
    portals: world.portals.map(p => ({ kind: p.kind, cell: p.cell, target: p.target, rot: p.model.group.rotation.y })),
    monsters: world.monsters.filter(m => m.state !== 'dead')
      .map(m => ({ id: m.def.id, x: m.pos.x, z: m.pos.z, hx: m.home.x, hz: m.home.z, hp: m.hp })),
    orbs: world.orbs.map(o => ({ id: o.id, x: o.pos.x, z: o.pos.z })),
    stones: world.stones.map(st => [st.pos.x, st.pos.z]),
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
  world.run = { ...rs.run, startedAt: performance.now() };
  world.riftReturn = rs.riftReturn;
  world.time.start(1, 0);
  world.time.hours = rs.hours;
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
    <div class="warn-text">${reason || '一度吸収した精髄は、原則として取り除けない。'}</div>
    <div class="btns row">
      <button class="btn primary" id="btn-absorb" ${owned || !fits ? 'disabled' : ''}>吸収する</button>
      <button class="btn" id="btn-crush">砕いて魔石にする</button>
      <button class="btn" id="btn-leave">そのままにする</button>
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
    log(`${e.name}を吸収した！`);
    closeModal();
  };
  $('#btn-crush').onclick = () => {
    const n = 2 + e.cost;
    world.run.stones += n;
    removeOrb(orb);
    burst(new THREE.Vector3(orb.pos.x, 1.0, orb.pos.z), 0x55c8ff, 30, 3, 3);
    log(`${e.name}を砕いた。魔石 +${n}`);
    closeModal();
  };
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
    <div class="muted" style="margin-top:8px;font-size:13px">迷宮から出られるのは、この層が閉ざされたとき・力尽きたとき（出発前に戻る）・帰還の巻物などの特殊な効果を受けたときだけ。</div>`;
  show('#menu-screen');
  $('#btn-resume').onclick = closeModal;
  $('#btn-camp').onclick = camp;
  $('#btn-menu-quality').onclick = () => { toggleQuality(); openMenu(); };
  $('#btn-return').onclick = () => useReturnScroll();
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
    note = `${world.time.day} 日目、${floorDef.name}が閉ざされ、地上へ送還された。持ち帰った魔石をすべて手に入れた。`;
    save.clears++;
  }
  if (reason === 'dead') {
    // 迷宮に入る直前に戻る（所持品・装備・精髄・ステータス・日付も出発前の状態）
    const pre = Store.loadPreRun();
    const runs = save.runs;
    if (pre) save = { ...pre, runs };
    kept = 0; title = '力尽きた'; cls = 'ng';
    note = pre ? `迷宮に入る直前（第${save.cycle}周期 Day ${save.day}）に戻った。所持品・装備・精髄・ステータスは出発前の状態になった。`
      : 'この探索で得た魔石はすべて失われた。';
  }
  if (reason === 'return') {
    title = `帰還（${source}）`;
    note = `${world.time.day} 日目、${source}の力で地上へ戻った。持ち帰った魔石をすべて手に入れた。`;
    save.clears++;
  }
  save.stones += kept;
  save.runs++;
  // 都市の日付を、迷宮を出た日に合わせる（地上ゲートは次の開放日まで閉じている）。力尽きたときは出発前の日付のまま
  if (reason !== 'dead') save.day = Math.min(D.TIME.cycleDays, Math.max(save.day, world.time.day));
  save.runInProgress = false;
  Store.saveGame(save);
  Store.clearRun();
  $('#result-card').innerHTML = `
    <div class="result-title ${cls}">${title}</div>
    <div class="muted" style="text-align:center">${note}</div>
    <div class="kv" style="margin-top:12px"><span>最後にいた階層 / 到達した最深層</span><span>${floorDef.name} / 第${run.deepest}層${run.rift ? '（亀裂にも入った）' : ''}</span></div>
    <div class="kv"><span>迷宮にいた期間</span><span>Day ${run.startDay} → Day ${world.time.day}</span></div>
    <div class="kv"><span>倒した敵</span><span>${run.kills}</span></div>
    <div class="kv"><span>持ち帰った魔石</span><span>${kept}（所持 ${save.stones}）</span></div>
    <div class="kv"><span>吸収した精髄</span><span>${run.absorbed.map(id => D.ESSENCES[id].name).join('・') || 'なし'}${reason === 'dead' && run.absorbed.length ? '（出発前に戻ったため失われた）' : ''}</span></div>
    <div class="kv"><span>使ったスキル / 回復薬</span><span>${run.skillsUsed} 回 / ${run.potionsUsed} 個</span></div>
    <div class="btns row">
      <button class="btn primary" id="btn-to-hub">拠点へ戻る</button>
    </div>`;
  show('#result-screen');
  $('#btn-to-hub').onclick = () => showHub(`${title}。${kept > 0 ? `魔石 ${kept} 個を持ち帰った。` : ''}${reason === 'dead' ? '地上ゲートはまだ開いている。' : ''}`);
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
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  step(rawDt);
  renderer.autoClear = true;
  renderer.render(scene, camera);
  if (world.state === 'playing' && player.viewmodel.group.visible) {
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(vmScene, vmCamera);
  }
  requestAnimationFrame(frame);
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
    }
  }
  updateMonsters(dt);
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
  portals() { return world.portals; },
  rebuild(id, arrive = 'start') { buildFloor(floorConfig(id), arrive); },
  usePortal,
  camp,
  autosave,
  useReturnScroll,
  get runState() { return Store.loadRunState(); },
  get preRun() { return Store.loadPreRun(); },
  forceDrops(on = true) { world.forceDrops = on; },
  attack() { input.pressed.add('attack'); },
  interact() { input.pressed.add('interact'); },
  stats() { return computeStats(); },
};

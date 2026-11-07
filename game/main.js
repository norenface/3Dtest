// ひかり通り商店街 ウォークスルー
// assets/models/manifest.json を読み、区画モジュール (glb) を X 方向に並べて商店街を組み立てる。
// 通りはループする：最後の区画の先は最初の区画につながっていて、突き当たりは存在しない。
// （並びを前後に複製して描画し、プレイヤーが端を越えたら反対側へ移すことで継ぎ目なく見せる）
//
// URL パラメータ:
//   ?sections=ABC            … ループさせる区画の並び（省略時は manifest.defaultLayout）
//   ?layout=A,B,C            … 同上（カンマ区切り）
//   ?exit=locked / ?exit=open … 最初から出口がつながった状態で始める（確認用）
//   ?quality=low             … 軽量モード（影の解像度を下げ、GTAO を切る。GPU が弱い PC 向け）
//   ?ao=0                    … アンビエントオクルージョン（GTAO）だけを切る
//   ?nolock                  … ポインタロックなし（自動テスト用）
//
// ゲームロジックからは window.game.setExitState('open') などで出口を切り替える。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const ASSET_BASE = '../assets/models/';
const ENV_HDR = '../assets/env/sky_2k.hdr';
const params = new URLSearchParams(location.search);
const LOW = params.get('quality') === 'low';

// ------------------------------------------------------------------ 描画の準備
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.has('nolock') });
renderer.setPixelRatio(LOW ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.15;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HAZE = new THREE.Color(0xb9cde0);
scene.background = HAZE;
scene.fog = new THREE.Fog(HAZE, 70, 260);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 600);
camera.rotation.order = 'YXZ';

// 太陽（影を落とす平行光源）。向きは HDRI の一番明るい点に合わせる
const sun = new THREE.DirectionalLight(0xffe4bf, 3.3);  // 少し暖かい午後の日差し
sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 2048 : 4096, LOW ? 2048 : 4096);
sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.04;
sun.shadow.radius = 2;
const SUN_OFFSET = new THREE.Vector3(-30, 55, 22);
scene.add(sun, sun.target);

// HDRI（Poly Haven, CC0）を空と環境光・映り込みに使う
async function loadEnvironment() {
  const hdr = await new RGBELoader().loadAsync(ENV_HDR);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const { data, width, height } = hdr.image;
  const half = hdr.type === THREE.HalfFloatType;
  const get = i => half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
  const set = (i, v) => { data[i] = half ? THREE.DataUtils.toHalfFloat(v) : v; };

  // 一番明るい画素 = 太陽の方向
  let best = 0, bi = 0;
  for (let i = 0; i < width * height; i++) {
    const lum = get(i * 4) + get(i * 4 + 1) + get(i * 4 + 2);
    if (lum > best) { best = lum; bi = i; }
  }
  const u = (bi % width) / width, v = Math.floor(bi / width) / height;
  const phi = (u - 0.5) * Math.PI * 2, theta = v * Math.PI;  // 経度・天頂角
  const dir = new THREE.Vector3(Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  if (dir.y < 0.35) dir.y = 0.35;  // 低すぎる太陽だと通りが真っ暗になるので少し持ち上げる
  SUN_OFFSET.copy(dir.normalize().multiplyScalar(80));

  // 太陽は DirectionalLight で表現するので、HDRI からは取り除く（頭打ちにする）。
  // 残すと環境光に太陽が二重に入り、日陰の壁までぼやけた灰色の映り込みで塗りつぶされる
  const CAP = 4.0;
  for (let i = 0; i < width * height; i++) {
    const r = get(i * 4), g = get(i * 4 + 1), b = get(i * 4 + 2);
    const m = Math.max(r, g, b);
    if (m > CAP) { const k = CAP / m; set(i * 4, r * k); set(i * 4 + 1, g * k); set(i * 4 + 2, b * k); }
  }
  hdr.needsUpdate = true;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 1.0;
  scene.background = hdr;
  scene.backgroundIntensity = 1.0;
  pmrem.dispose();
}

// ポストプロセス：GTAO（物の接地感・隅の暗がり）
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const useAO = params.get('ao') !== '0' && !LOW;
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.0, scale: 1.2, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 0.85;
gtao.enabled = useAO;
composer.addPass(gtao);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ 商店街の組み立て
const world = {
  colliders: [],      // {min: Vector3, max: Vector3}
  interactables: [],  // manifest の interactables（ワールド座標に変換済み）
  segments: [],       // {key, label, color, x0, x1}
  length: 0,          // ループ 1 周の長さ
  exitState: 'loop',  // 'loop' | 'locked' | 'open'
  escaped: false,
};

function parseLayout(manifest) {
  let keys = manifest.defaultLayout;
  if (params.get('layout')) keys = params.get('layout').split(',');
  else if (params.get('sections')) keys = params.get('sections').split('');
  // ループに入れられるのは区画 (kind: section) だけ
  keys = keys.map(s => s.trim().toUpperCase()).filter(k => manifest.modules[k]?.kind === 'section');
  return keys.length ? keys : manifest.defaultLayout;
}

const VIEW_DISTANCE = 220;  // ループの複製で埋める前後の距離 (m)
const streetGroup = new THREE.Group();
scene.add(streetGroup);
const store = { manifest: null, layout: null, scenes: {} };

async function loadStreet() {
  const manifest = await (await fetch(ASSET_BASE + 'manifest.json')).json();
  const layout = parseLayout(manifest);
  const keys = [...new Set([...layout, manifest.exitModule, manifest.exitLockedModule])];
  const loader = new GLTFLoader();
  const loaded = await Promise.all(keys.map(k => loader.loadAsync(ASSET_BASE + manifest.modules[k].file)));
  keys.forEach((k, i) => {
    const s = loaded[i].scene;
    s.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    store.scenes[k] = s;
  });
  Object.assign(store, { manifest, layout });
}

// 現在の exitState に合わせて通りを組み直す。
//   loop   … 最後の区画の先は最初の区画（前後とも無限に続く）
//   locked … 最後の区画の先に施錠された出口がある（後ろ方向は今まで通りループ）
//   open   … 最後の区画の先の出口が開いていて、外へ出られる
function arrangeStreet() {
  const { manifest, layout, scenes } = store;
  streetGroup.clear();
  world.colliders.length = 0;
  world.interactables.length = 0;
  world.segments.length = 0;

  const place = (key, ox, withLogic) => {
    const mod = manifest.modules[key];
    const root = scenes[key].clone();
    root.position.x = ox;
    streetGroup.add(root);
    if (!withLogic) return;
    for (const c of mod.colliders) {
      world.colliders.push({
        min: new THREE.Vector3(c[0] + ox, c[1], c[2]),
        max: new THREE.Vector3(c[3] + ox, c[4], c[5]),
      });
    }
    for (const it of mod.interactables) {
      world.interactables.push({ ...it, module: key, pos: new THREE.Vector3(it.pos[0] + ox, it.pos[1], it.pos[2]) });
    }
  };

  // 1 周分の並び
  let x = 0;
  const placed = layout.map(key => {
    const mod = manifest.modules[key];
    world.segments.push({ key, label: mod.label, x0: x, x1: x + mod.length, color: new THREE.Color(...mod.color) });
    const p = { key, x0: x };
    x += mod.length;
    return p;
  });
  const L = world.length = x;

  // 前後に複製して並べる。当たり判定と調べる対象は前後 1 周分あれば足りる
  const copies = Math.ceil(VIEW_DISTANCE / L);
  const lastCopy = world.exitState === 'loop' ? copies : 0;  // 出口ありなら最後の区画の先は複製しない
  for (let k = -copies; k <= lastCopy; k++) {
    for (const p of placed) place(p.key, p.x0 + k * L, Math.abs(k) <= 1);
  }
  if (world.exitState !== 'loop') {
    const key = world.exitState === 'open' ? manifest.exitModule : manifest.exitLockedModule;
    const mod = manifest.modules[key];
    place(key, L, true);
    world.segments.push({ key, label: mod.label, x0: L, x1: L + mod.length, color: new THREE.Color(...mod.color), exit: true });
  }
}

// ゲームロジックから呼ぶ：出口の状態を切り替える
function setExitState(state) {
  if (!['loop', 'locked', 'open'].includes(state) || state === world.exitState) return;
  world.exitState = state;
  arrangeStreet();
  wrapX(player.pos);
  resolveCollisions(player.pos);
  lastSegment = null;
  dispatchEvent(new CustomEvent('shotengai:exitstate', { detail: state }));
}

// ループ：プレイヤーの X 座標を [0, 1 周) に折り返す。
// 出口があるときは前方向（最後の区画の先）には折り返さない
function wrapX(p) {
  const L = world.length;
  if (world.exitState === 'loop') p.x = ((p.x % L) + L) % L;
  else if (p.x < 0) p.x = ((p.x % L) + L) % L;
}

function checkEscape() {
  if (world.escaped || world.exitState !== 'open') return;
  const ex = store.manifest.modules[store.manifest.exitModule];
  if (player.pos.x > world.length + ex.escapeLineX) {
    world.escaped = true;
    messageEl.textContent = '商店街から脱出した！';
    messageEl.style.display = 'block';
    messageTimer = 6;
    dispatchEvent(new Event('shotengai:escaped'));
  }
}

// ------------------------------------------------------------------ プレイヤー
const player = {
  pos: new THREE.Vector3(),
  yaw: -Math.PI / 2,   // -π/2 = +X 方向（商店街の奥）を向く
  pitch: 0,
  radius: 0.35,
  eye: 1.6,
};
const keys = new Set();
let active = params.has('nolock');

addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.code === 'KeyE') interact();
});
addEventListener('keyup', e => keys.delete(e.code));

const overlay = document.getElementById('overlay');
overlay.addEventListener('click', () => {
  if (params.has('nolock')) { overlay.style.display = 'none'; active = true; return; }
  renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  active = document.pointerLockElement === renderer.domElement;
  overlay.style.display = active ? 'none' : 'flex';
  if (!active) keys.clear();
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== renderer.domElement) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -1.4, 1.4);
});

function resolveCollisions(p) {
  const r = player.radius;
  for (let iter = 0; iter < 3; iter++) {
    for (const c of world.colliders) {
      if (c.max.y < 0.3 || c.min.y > 1.8) continue;  // 足元・頭上のものは無視
      const cx = THREE.MathUtils.clamp(p.x, c.min.x, c.max.x);
      const cz = THREE.MathUtils.clamp(p.z, c.min.z, c.max.z);
      const dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x += dx / d * (r - d);
        p.z += dz / d * (r - d);
      } else {
        // 中心が箱の中に入った場合は一番近い面へ押し出す
        const pen = [
          [p.x - c.min.x + r, -1, 0], [c.max.x - p.x + r, 1, 0],
          [p.z - c.min.z + r, 0, -1], [c.max.z - p.z + r, 0, 1],
        ].sort((a, b) => a[0] - b[0])[0];
        p.x += pen[1] * pen[0];
        p.z += pen[2] * pen[0];
      }
    }
  }
}

const tmp = new THREE.Vector3();
function updatePlayer(dt) {
  if (!active) return;
  const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 6.0 : 3.2;
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('KeyA')) s -= 1;
  if (keys.has('ArrowLeft')) player.yaw += 2.0 * dt;
  if (keys.has('ArrowRight')) player.yaw -= 2.0 * dt;
  if (f || s) {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    tmp.set(fx * f + -fz * s, 0, fz * f + fx * s).normalize().multiplyScalar(speed * dt);
    player.pos.add(tmp);
    resolveCollisions(player.pos);
    wrapX(player.pos);
    checkEscape();
  }
}

// ------------------------------------------------------------------ 調べる
const promptEl = document.getElementById('prompt');
const messageEl = document.getElementById('message');
let focused = null;
let messageTimer = 0;

const TYPE_TEXT = {
  shop: it => `「${it.name}」の入口だ。店内はまだ作られていない。`,
  shutter: it => `シャッターが下りている。「テナント募集」の貼り紙がある。`,
  gate: () => '出口ゲートには頑丈な南京錠が掛かっている。鍵が必要だ。',
  vending: () => '自動販売機だ。小銭があれば何か買えそうだ。',
  postbox: () => '郵便ポストだ。取り出し口には鍵が掛かっている。',
  notice: it => `${it.name}だ。お知らせの紙が何枚か貼ってある。`,
  exit: () => 'ゲートが開いている。この先は商店街の外だ。',
  pole: it => `電柱に「${it.ad}」の古い広告が貼られている。`,
  arch: () => '「ひかり通り商店街」のアーチだ。電球がいくつか切れている。',
};

function findFocus() {
  const look = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  let best = null, bestScore = Infinity;
  for (const it of world.interactables) {
    tmp.set(it.pos.x - player.pos.x, 0, it.pos.z - player.pos.z);
    const d = tmp.length();
    if (d > 2.2) continue;
    const dot = d > 1e-4 ? tmp.dot(look) / d : 1;
    if (dot < 0.3) continue;
    const score = d - dot;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

function interact() {
  if (!active || !focused) return;
  const fn = TYPE_TEXT[focused.type];
  messageEl.textContent = fn ? fn(focused) : focused.name;
  messageEl.style.display = 'block';
  messageTimer = 4;
  dispatchEvent(new CustomEvent('shotengai:interact', { detail: focused }));
}

// ------------------------------------------------------------------ HUD・ミニマップ
const sectionEl = document.getElementById('hud-section');
const mini = document.getElementById('minimap');
const mctx = mini.getContext('2d');
let lastSegment = null;

function currentSegment() {
  return world.segments.find(s => player.pos.x >= s.x0 && player.pos.x < s.x1) || world.segments.at(-1);
}

function drawHUD() {
  const seg = currentSegment();
  if (seg !== lastSegment) {
    sectionEl.textContent = seg.label;
    sectionEl.style.borderLeftColor = '#' + seg.color.getHexString();
    lastSegment = seg;
  }
  const W = mini.width, H = mini.height, pad = 10;
  const sx = (W - pad * 2) / world.segments.at(-1).x1;
  const halfW = 14.5;
  const sy = (H - pad * 2) / (halfW * 2);
  mctx.clearRect(0, 0, W, H);
  for (const s of world.segments) {
    mctx.fillStyle = '#' + s.color.getHexString();
    mctx.globalAlpha = 0.8;
    mctx.fillRect(pad + s.x0 * sx, pad, (s.x1 - s.x0) * sx - 1, (halfW - 4.5) * sy);
    mctx.fillRect(pad + s.x0 * sx, H - pad - (halfW - 4.5) * sy, (s.x1 - s.x0) * sx - 1, (halfW - 4.5) * sy);
    mctx.globalAlpha = 1;
    const tag = s.exit ? '出' : s.key;
    mctx.fillStyle = '#fff';
    mctx.font = 'bold 11px sans-serif';
    mctx.textAlign = 'center';
    mctx.fillText(tag, pad + (s.x0 + s.x1) / 2 * sx, H / 2 + 4);
  }
  const px = pad + player.pos.x * sx, py = H / 2 + player.pos.z * sy;
  mctx.fillStyle = '#ff3b30';
  mctx.beginPath(); mctx.arc(px, py, 4, 0, Math.PI * 2); mctx.fill();
  mctx.strokeStyle = '#ff3b30'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.moveTo(px, py);
  mctx.lineTo(px - Math.sin(player.yaw) * 10, py - Math.cos(player.yaw) * 10); mctx.stroke();
}

// ------------------------------------------------------------------ メインループ
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updatePlayer(dt);
  camera.position.set(player.pos.x, player.eye, player.pos.z);
  camera.rotation.set(player.pitch, player.yaw, 0);
  sun.target.position.set(player.pos.x, 0, player.pos.z);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  focused = findFocus();
  if (focused && active) {
    promptEl.innerHTML = `<b>E</b>${focused.name}を調べる`;
    promptEl.style.display = 'block';
  } else {
    promptEl.style.display = 'none';
  }
  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) messageEl.style.display = 'none';
  }
  drawHUD();
  composer.render();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ 起動
await Promise.all([loadStreet(), loadEnvironment()]);
const { manifest, layout } = store;
if (['locked', 'open'].includes(params.get('exit'))) world.exitState = params.get('exit');
arrangeStreet();
player.pos.set(world.segments[0].x0 + 2.5, 0, 0);
player.radius = manifest.player.radius;
player.eye = manifest.player.eyeHeight;
document.getElementById('loading').remove();
if (params.has('nolock')) overlay.style.display = 'none';
frame();

// デバッグ・自動テスト・今後のゲームロジック用
window.game = {
  THREE, scene, camera, player, world, manifest, layout,
  setPose(x, z, yawDeg = -90, pitchDeg = 0) {
    player.pos.set(x, 0, z);
    wrapX(player.pos);
    player.yaw = THREE.MathUtils.degToRad(yawDeg);
    player.pitch = THREE.MathUtils.degToRad(pitchDeg);
  },
  walk(dx, dz) { player.pos.x += dx; player.pos.z += dz; resolveCollisions(player.pos); wrapX(player.pos); checkEscape(); },
  // 出口の切り替え：'loop'（ループ） / 'locked'（G の先に施錠された出口） / 'open'（出口が開く）
  setExitState,
  get exitState() { return world.exitState; },
  get escaped() { return world.escaped; },
  interact,
  get focused() { return focused; },
};
window.dispatchEvent(new Event('shotengai:ready'));

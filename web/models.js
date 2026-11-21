// キャラクター・モンスター・アイテムの見た目（Three.js の基本形状を組み合わせたローポリモデル）。
// どれも足元が原点 (y=0)、正面が -Z（three.js のカメラと同じ向き）。
// 手足などはアニメーションできるように別の Object3D に分けて parts に入れて返す。
import * as THREE from 'three';

const matCache = new Map();
export function flatMat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0, ...opts }));
  }
  return matCache.get(key);
}

function box(w, h, d, color, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), flatMat(color, opts));
  m.castShadow = true;
  return m;
}

function cyl(rTop, rBottom, h, color, seg = 7, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), flatMat(color, opts));
  m.castShadow = true;
  return m;
}

// 関節：pivot を置いて、その子に部品をぶら下げる（pivot の回転で手足を振る）
function joint(parent, x, y, z) {
  const p = new THREE.Object3D();
  p.position.set(x, y, z);
  parent.add(p);
  return p;
}

// ------------------------------------------------------------------ プレイヤー（バーバリアン）
export function makeBarbarian(colors) {
  const g = new THREE.Group();
  const body = new THREE.Object3D();
  g.add(body);
  const hipY = 0.95;
  // 脚
  const legL = joint(body, -0.2, hipY, 0), legR = joint(body, 0.2, hipY, 0);
  for (const leg of [legL, legR]) {
    const l = box(0.26, 0.9, 0.28, colors.cloth); l.position.y = -0.45; leg.add(l);
    const boot = box(0.3, 0.18, 0.38, 0x3b2a1c); boot.position.set(0, -0.86, -0.04); leg.add(boot);
  }
  // 胴体（上半身は少し大きめ）
  const torso = box(0.78, 0.8, 0.46, colors.skin); torso.position.y = hipY + 0.42; body.add(torso);
  const belt = box(0.82, 0.16, 0.5, 0x4a3320); belt.position.y = hipY + 0.06; body.add(belt);
  const fur = box(0.9, 0.22, 0.56, 0x8c7a5a); fur.position.y = hipY + 0.8; body.add(fur);
  // 頭
  const head = joint(body, 0, hipY + 0.92, 0);
  const face = box(0.4, 0.42, 0.4, colors.skin); face.position.y = 0.2; head.add(face);
  const hair = box(0.46, 0.18, 0.46, colors.hair); hair.position.y = 0.45; head.add(hair);
  const beard = box(0.36, 0.18, 0.12, colors.hair); beard.position.set(0, 0.04, -0.2); head.add(beard);
  for (const s of [-1, 1]) {
    const eye = box(0.06, 0.05, 0.02, 0x1a1a1a); eye.position.set(s * 0.09, 0.25, -0.205); head.add(eye);
  }
  // 腕
  const armL = joint(body, -0.5, hipY + 0.75, 0), armR = joint(body, 0.5, hipY + 0.75, 0);
  for (const arm of [armL, armR]) {
    const a = box(0.22, 0.75, 0.24, colors.skin); a.position.y = -0.36; arm.add(a);
    const bracer = box(0.26, 0.2, 0.28, 0x4a3320); bracer.position.y = -0.6; arm.add(bracer);
  }
  // 大剣（右手）
  const weapon = joint(armR, 0, -0.72, 0);
  const grip = cyl(0.04, 0.04, 0.35, 0x4a3320); grip.rotation.x = Math.PI / 2; grip.position.z = -0.05; weapon.add(grip);
  const guard = box(0.4, 0.08, 0.08, 0x6d6d6d, { metalness: 0.6, roughness: 0.4 }); guard.position.z = -0.24; weapon.add(guard);
  const blade = box(0.14, 0.04, 1.3, colors.weapon, { metalness: 0.7, roughness: 0.35 }); blade.position.z = -0.92; weapon.add(blade);
  weapon.rotation.x = -0.2;
  return { group: g, parts: { body, legL, legR, armL, armR, head, weapon } };
}

// ------------------------------------------------------------------ ゴブリン
function makeGoblin() {
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const skin = 0x6aa84f, cloth = 0x5b4636;
  const legL = joint(body, -0.13, 0.5, 0), legR = joint(body, 0.13, 0.5, 0);
  for (const leg of [legL, legR]) { const l = box(0.16, 0.5, 0.18, skin); l.position.y = -0.25; leg.add(l); }
  const torso = box(0.5, 0.5, 0.36, cloth); torso.position.y = 0.75; body.add(torso);
  const head = joint(body, 0, 1.0, 0);
  const face = box(0.46, 0.4, 0.4, skin); face.position.y = 0.18; head.add(face);
  const nose = box(0.1, 0.12, 0.16, 0x5a9440); nose.position.set(0, 0.14, -0.26); head.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 4), flatMat(skin));
    ear.rotation.z = s * -1.3; ear.position.set(s * 0.32, 0.26, 0); head.add(ear);
    const eye = box(0.08, 0.06, 0.02, 0xffe066, { emissive: 0x665500 }); eye.position.set(s * 0.11, 0.24, -0.205); head.add(eye);
  }
  const armL = joint(body, -0.32, 0.95, 0), armR = joint(body, 0.32, 0.95, 0);
  for (const arm of [armL, armR]) { const a = box(0.13, 0.5, 0.14, skin); a.position.y = -0.24; arm.add(a); }
  const weapon = joint(armR, 0, -0.48, 0);
  const club = cyl(0.07, 0.04, 0.7, 0x7a5230); club.rotation.x = Math.PI / 2; club.position.z = -0.3; weapon.add(club);
  return { group: g, parts: { body, legL, legR, armL, armR, head, weapon } };
}

// ------------------------------------------------------------------ ダイアウルフ
function makeWolf() {
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const fur = 0x5d6470, dark = 0x3b4049;
  const torso = box(0.55, 0.5, 1.2, fur); torso.position.set(0, 0.75, 0.05); body.add(torso);
  const chest = box(0.6, 0.6, 0.45, fur); chest.position.set(0, 0.8, -0.45); body.add(chest);
  const head = joint(body, 0, 0.95, -0.7);
  const skull = box(0.42, 0.38, 0.42, fur); skull.position.z = -0.12; head.add(skull);
  const snout = box(0.24, 0.2, 0.34, dark); snout.position.set(0, -0.06, -0.45); head.add(snout);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), flatMat(dark)); ear.position.set(s * 0.13, 0.27, -0.05); head.add(ear);
    const eye = box(0.07, 0.05, 0.02, 0x9fd7ff, { emissive: 0x2a6a99 }); eye.position.set(s * 0.12, 0.06, -0.335); head.add(eye);
  }
  const legs = [];
  for (const [x, z] of [[-0.2, -0.45], [0.2, -0.45], [-0.2, 0.5], [0.2, 0.5]]) {
    const leg = joint(body, x, 0.6, z);
    const l = box(0.14, 0.6, 0.16, dark); l.position.y = -0.3; leg.add(l);
    legs.push(leg);
  }
  const tail = joint(body, 0, 0.9, 0.65);
  const t = box(0.12, 0.12, 0.6, fur); t.position.z = 0.28; tail.add(t);
  tail.rotation.x = 0.5;
  return { group: g, parts: { body, head, legs, tail, legL: legs[0], legR: legs[1], armL: legs[2], armR: legs[3] } };
}

// ------------------------------------------------------------------ ストーンゴーレム
function makeGolem() {
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const stone = 0x8a8377, dark = 0x5e584f;
  const legL = joint(body, -0.4, 1.0, 0), legR = joint(body, 0.4, 1.0, 0);
  for (const leg of [legL, legR]) { const l = box(0.5, 1.0, 0.55, dark); l.position.y = -0.5; leg.add(l); }
  const torso = box(1.4, 1.1, 0.9, stone); torso.position.y = 1.6; body.add(torso);
  const crack = box(0.5, 0.08, 0.02, 0xffa040, { emissive: 0xff7a00, emissiveIntensity: 1.2 }); crack.position.set(0.1, 1.7, -0.46); body.add(crack);
  const head = joint(body, 0, 2.2, -0.1);
  const h = box(0.6, 0.5, 0.55, stone); h.position.y = 0.2; head.add(h);
  for (const s of [-1, 1]) {
    const eye = box(0.12, 0.07, 0.02, 0xffb347, { emissive: 0xff8800, emissiveIntensity: 1.5 }); eye.position.set(s * 0.14, 0.25, -0.285); head.add(eye);
  }
  const armL = joint(body, -0.9, 2.0, 0), armR = joint(body, 0.9, 2.0, 0);
  for (const arm of [armL, armR]) {
    const a = box(0.45, 1.2, 0.5, stone); a.position.y = -0.55; arm.add(a);
    const fist = box(0.6, 0.5, 0.6, dark); fist.position.y = -1.25; arm.add(fist);
  }
  return { group: g, parts: { body, legL, legR, armL, armR, head } };
}

export function makeMonster(model) {
  if (model === 'goblin') return makeGoblin();
  if (model === 'wolf') return makeWolf();
  if (model === 'golem') return makeGolem();
  throw new Error('unknown model ' + model);
}

// ------------------------------------------------------------------ アイテム
export function makeEssenceOrb(color) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, flatShading: true, roughness: 0.3 }));
  core.position.y = 1.0;
  g.add(core);
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }));
  shell.position.y = 1.0;
  g.add(shell);
  // 光源は増やさない（光源の数が変わると全マテリアルの再コンパイルで画面が止まるため）。
  // 足元に光の輪を置いて「光っている」ように見せる
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.9, 20),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.03;
  g.add(glow);
  return { group: g, parts: { core, shell, glow } };
}

export function makeMagicStone() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0),
    new THREE.MeshStandardMaterial({ color: 0x55c8ff, emissive: 0x1a6aa0, emissiveIntensity: 1.2, flatShading: true }));
  m.position.y = 0.3;
  g.add(m);
  return { group: g, parts: { gem: m } };
}

export function makeExitStone() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.3, 10), flatMat(0x4a4f5a));
  base.position.y = 0.15; base.receiveShadow = true; g.add(base);
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.4, 0.4), flatMat(0x6c7380));
  pillar.position.y = 1.5; pillar.castShadow = true; g.add(pillar);
  const rune = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.2, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x7ff0ff, emissive: 0x3ad8ff, emissiveIntensity: 2 }));
  rune.position.set(0, 1.6, -0.21); g.add(rune);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 32),
    new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.8 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.33; g.add(ring);
  const light = new THREE.PointLight(0x5ae0ff, 10, 10, 1.6);
  light.position.y = 2.2; g.add(light);
  return { group: g, parts: { ring, rune, light } };
}

// ------------------------------------------------------------------ 一人称視点の腕と武器（ビューモデル）
// カメラ空間に置く（原点 = 目、-Z が前）。swing を回すと振り下ろしになる。
export function makeViewmodel(colors) {
  const root = new THREE.Group();
  const swing = new THREE.Object3D();   // 攻撃で回す
  root.add(swing);
  // 右腕（画面右下から前へ伸びる）
  const arm = box(0.11, 0.11, 0.5, colors.skin);
  arm.position.set(0, 0, 0.1);
  swing.add(arm);
  const bracer = box(0.14, 0.14, 0.16, 0x4a3320);
  bracer.position.set(0, 0, -0.1);
  swing.add(bracer);
  const fist = box(0.12, 0.12, 0.12, colors.skin);
  fist.position.set(0, 0, -0.22);
  swing.add(fist);
  // 大剣（拳から上前方へ）
  const sword = new THREE.Object3D();
  sword.position.set(0, 0.02, -0.22);
  sword.rotation.x = 0.9;          // 刃先を斜め上・前に向ける
  swing.add(sword);
  const grip = cyl(0.035, 0.035, 0.32, 0x4a3320);
  sword.add(grip);
  const guard = box(0.36, 0.06, 0.08, 0x6d6d6d, { metalness: 0.6, roughness: 0.4 });
  guard.position.y = 0.18;
  sword.add(guard);
  // 環境マップがないので金属度は低めにして、明るい鋼色に見せる
  const blade = box(0.1, 0.95, 0.03, 0xc9d1d9, { metalness: 0.25, roughness: 0.35 });
  blade.position.y = 0.66;
  sword.add(blade);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), flatMat(0xc9d1d9, { metalness: 0.25, roughness: 0.35 }));
  tip.position.y = 1.22;
  tip.rotation.y = Math.PI / 4;
  tip.scale.z = 0.3;
  sword.add(tip);
  root.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return { group: root, parts: { swing, sword } };
}

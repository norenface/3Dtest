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
// 魔物の見た目は「体の型」ごとに 1 つの関数で作り、look（色・大きさ・装備など）で作り分ける。
// parts.kind：'biped'（二足）/ 'quad'（四足）/ 'float'（浮遊する霊体）/ 'worm'（地を這う）/ 'tree'（樹木）。アニメーションの種類を決める

// ------------------------------------------------------------------ 二足（ゴブリン・ノーム・グール・スケルトン・オークなど）
// look: skin, cloth, eye, size（全体の倍率）, build（横幅の倍率）, head（'goblin' | 'gnome' | 'skull' | 'orc' | 'hood' | 'none' | 'wolf' | 'helm'）,
//       weapon（'club' | 'sword' | 'bow' | 'staff' | 'pick' | 'claw' | 'shield' | 'spear' | 'none'）, hunch（前かがみ）, beard, armor（鎧の色）
function makeHumanoid(look = {}) {
  const L = { skin: 0x6aa84f, cloth: 0x5b4636, eye: 0xffe066, size: 1, build: 1, head: 'goblin', weapon: 'club', hunch: 0, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const W = L.build;
  const legL = joint(body, -0.13 * W, 0.5, 0), legR = joint(body, 0.13 * W, 0.5, 0);
  for (const leg of [legL, legR]) { const l = box(0.16 * W, 0.5, 0.18, L.armor ?? L.skin); l.position.y = -0.25; leg.add(l); }
  const torso = box(0.5 * W, 0.5, 0.36 * W, L.armor ?? L.cloth); torso.position.y = 0.75; body.add(torso);
  body.rotation.x = L.hunch;
  const head = joint(body, 0, 1.0, 0);
  const eyeMat = { emissive: L.eye, emissiveIntensity: 0.8 };
  const eyes = (y, z, gap = 0.11) => { for (const s of [-1, 1]) { const e = box(0.08, 0.06, 0.02, L.eye, eyeMat); e.position.set(s * gap, y, z); head.add(e); } };
  if (L.head === 'goblin' || L.head === 'orc') {
    const face = box(0.46 * (L.head === 'orc' ? 1.15 : 1), 0.4, 0.4, L.skin); face.position.y = 0.18; head.add(face);
    const nose = box(0.1, 0.12, 0.16, L.skin); nose.position.set(0, 0.14, -0.26); head.add(nose);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, L.head === 'orc' ? 0.2 : 0.34, 4), flatMat(L.skin));
      ear.rotation.z = s * -1.3; ear.position.set(s * 0.32, 0.26, 0); head.add(ear);
      if (L.head === 'orc') { const tusk = box(0.05, 0.12, 0.05, 0xf2ead0); tusk.position.set(s * 0.12, 0.04, -0.23); head.add(tusk); }
    }
    eyes(0.24, -0.205);
  } else if (L.head === 'gnome') {
    const face = box(0.38, 0.34, 0.36, L.skin); face.position.y = 0.16; head.add(face);
    const beard = box(0.34, 0.26, 0.12, L.beard ?? 0xd8d0c0); beard.position.set(0, 0.02, -0.2); head.add(beard);
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.5, 6), flatMat(L.hat ?? 0xa83a2a)); hat.position.y = 0.55; head.add(hat);
    eyes(0.22, -0.185, 0.09);
  } else if (L.head === 'skull') {
    const sk = box(0.36, 0.38, 0.38, L.skin); sk.position.y = 0.18; head.add(sk);
    const jaw = box(0.28, 0.1, 0.3, L.skin); jaw.position.set(0, -0.04, -0.04); head.add(jaw);
    eyes(0.22, -0.195, 0.09);
  } else if (L.head === 'wolf') {
    const sk = box(0.4, 0.38, 0.4, L.skin); sk.position.y = 0.2; head.add(sk);
    const snout = box(0.22, 0.18, 0.3, L.cloth); snout.position.set(0, 0.12, -0.32); head.add(snout);
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), flatMat(L.skin)); ear.position.set(s * 0.13, 0.48, 0); head.add(ear); }
    eyes(0.28, -0.205);
  } else if (L.head === 'hood' || L.head === 'helm') {
    const hood = box(0.46, 0.46, 0.44, L.head === 'helm' ? (L.armor ?? 0x6a6f78) : L.cloth); hood.position.y = 0.2; head.add(hood);
    const shade = box(0.34, 0.24, 0.02, 0x0a0a0a); shade.position.set(0, 0.18, -0.225); head.add(shade);
    eyes(0.2, -0.235, 0.08);
  } // 'none'：頭がない（首なしの騎士など）
  const armL = joint(body, -0.32 * W, 0.95, 0), armR = joint(body, 0.32 * W, 0.95, 0);
  for (const arm of [armL, armR]) { const a = box(0.13 * W, 0.5, 0.14 * W, L.armor ?? L.skin); a.position.y = -0.24; arm.add(a); }
  const weapon = joint(armR, 0, -0.48, 0);
  const wcol = L.weaponColor ?? 0x7a5230;
  if (L.weapon === 'club') { const w = cyl(0.07, 0.04, 0.7, wcol); w.rotation.x = Math.PI / 2; w.position.z = -0.3; weapon.add(w); }
  if (L.weapon === 'sword' || L.weapon === 'spear') {
    const len = L.weapon === 'spear' ? 1.3 : 0.8;
    const w = box(0.06, 0.04, len, L.weaponColor ?? 0xc8ccd4, { metalness: 0.5, roughness: 0.4 }); w.position.z = -len / 2; weapon.add(w);
  }
  if (L.weapon === 'pick') { const h = cyl(0.03, 0.03, 0.6, 0x7a5230); h.rotation.x = Math.PI / 2; h.position.z = -0.3; weapon.add(h);
    const t = box(0.4, 0.06, 0.06, 0x9aa0a8); t.position.z = -0.58; weapon.add(t); }
  if (L.weapon === 'bow') { const b = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.025, 4, 10, Math.PI), flatMat(wcol)); b.rotation.y = Math.PI / 2; weapon.add(b); }
  if (L.weapon === 'staff') { const st = cyl(0.03, 0.03, 1.2, wcol); st.position.y = 0.1; weapon.add(st);
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), new THREE.MeshBasicMaterial({ color: L.magic ?? 0x9b6bff })); orb.position.y = 0.72; weapon.add(orb); }
  if (L.weapon === 'claw') { for (const s of [-1, 0, 1]) { const c = box(0.03, 0.03, 0.2, 0xe8e2d0); c.position.set(s * 0.05, -0.02, -0.12); weapon.add(c); } }
  if (L.shield) { const sh = box(0.08, 0.6, 0.5, L.shield, L.shieldMetal ? { metalness: 0.6, roughness: 0.35 } : undefined); sh.position.set(-0.08, -0.4, -0.1); armL.add(sh);
    if (L.shieldBoss) { const b = box(0.04, 0.16, 0.16, L.shieldBoss, { metalness: 0.8, roughness: 0.3 }); b.position.set(-0.13, -0.4, -0.1); armL.add(b); } }
  // ---- 強い個体の装飾（略奪者の等級など）
  if (L.weaponGlow) weapon.traverse(o => { if (o.isMesh && o.material.emissive) { o.material = o.material.clone(); o.material.emissive.setHex(L.weaponGlow); o.material.emissiveIntensity = 0.9; } });
  if (L.pauldron) for (const [arm, sx] of [[armL, -1], [armR, 1]]) {   // 肩当て
    const pd = box(0.24 * W, 0.12, 0.26 * W, L.pauldron, { metalness: 0.6, roughness: 0.35 }); pd.position.set(sx * 0.03, 0.04, 0); pd.rotation.z = sx * 0.25; arm.add(pd);
    if (L.spikes) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 4), flatMat(L.spikes, { metalness: 0.7, roughness: 0.3 })); sp.position.set(sx * 0.08, 0.16, 0); arm.add(sp); }
  }
  if (L.belt) { const bt = box(0.52 * W, 0.08, 0.38 * W, L.belt, { metalness: 0.5, roughness: 0.4 }); bt.position.y = 0.53; body.add(bt); }
  if (L.cape) { const cp = box(0.5 * W, 0.85, 0.04, L.cape); cp.position.set(0, 0.62, 0.21 * W); cp.rotation.x = 0.12; body.add(cp); }
  if (L.horns && (L.head === 'helm' || L.head === 'hood')) for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.3, 5), flatMat(L.horns)); h.position.set(sx * 0.22, 0.42, 0); h.rotation.z = -sx * 0.6; head.add(h);
  }
  if (L.plume) { const pl = box(0.06, 0.16, 0.4, L.plume); pl.position.set(0, 0.5, 0.02); head.add(pl); }
  if (L.aura) {   // 足もとの光の輪
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 24), new THREE.MeshBasicMaterial({ color: L.aura, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; ring.name = 'aura'; g.add(ring);
  }
  g.scale.setScalar(L.size);
  return { group: g, parts: { kind: 'biped', body, legL, legR, armL, armR, head, weapon } };
}

// ------------------------------------------------------------------ 四足（刃狼・熊・虎・モグラなど）
// look: fur, dark, eye, size, long（胴の長さ）, tall（脚の長さ）, blade（背の刃の色）, horns, fangs, tail（false で尾なし）
function makeBeast(look = {}) {
  const L = { fur: 0x5d6470, dark: 0x3b4049, eye: 0x9fd7ff, size: 1, long: 1, tall: 1, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const legH = 0.6 * L.tall, y0 = legH + 0.15;
  const torso = box(0.55, 0.5, 1.2 * L.long, L.fur); torso.position.set(0, y0, 0.05); body.add(torso);
  const chest = box(0.6, 0.6, 0.45, L.fur); chest.position.set(0, y0 + 0.05, -0.45 * L.long); body.add(chest);
  if (L.blade) for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 3), flatMat(L.blade, { metalness: 0.6, roughness: 0.3 }));
    b.position.set(0, y0 + 0.38, -0.35 * L.long + i * 0.28 * L.long); b.rotation.x = -0.4; body.add(b);
  }
  const head = joint(body, 0, y0 + 0.2, -0.7 * L.long);
  const skull = box(0.42, 0.38, 0.42, L.fur); skull.position.z = -0.12; head.add(skull);
  const snout = box(0.24, 0.2, 0.34, L.dark); snout.position.set(0, -0.06, -0.45); head.add(snout);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 4), flatMat(L.dark)); ear.position.set(s * 0.13, 0.27, -0.05); head.add(ear);
    const eye = box(0.07, 0.05, 0.02, L.eye, { emissive: L.eye, emissiveIntensity: 0.6 }); eye.position.set(s * 0.12, 0.06, -0.335); head.add(eye);
    if (L.horns) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.4, 5), flatMat(L.horns)); h.position.set(s * 0.18, 0.25, -0.25); h.rotation.x = -0.7; head.add(h); }
    if (L.fangs) { const f = box(0.04, 0.22, 0.04, 0xf2ead0); f.position.set(s * 0.08, -0.22, -0.55); head.add(f); }
  }
  const legs = [];
  for (const [x, z] of [[-0.2, -0.45], [0.2, -0.45], [-0.2, 0.5], [0.2, 0.5]]) {
    const leg = joint(body, x, legH, z * L.long);
    const l = box(0.14, legH, 0.16, L.dark); l.position.y = -legH / 2; leg.add(l);
    legs.push(leg);
  }
  const tail = joint(body, 0, y0 + 0.15, 0.65 * L.long);
  if (L.tail !== false) { const t = box(0.12, 0.12, 0.6, L.fur); t.position.z = 0.28; tail.add(t); }
  tail.rotation.x = 0.5;
  g.scale.setScalar(L.size);
  return { group: g, parts: { kind: 'quad', body, head, legs, tail, legL: legs[0], legR: legs[1], armL: legs[2], armR: legs[3] } };
}

// ------------------------------------------------------------------ 大型の人型（ゴーレム・石像・巨石兵・サンドマン・ウッドマン）
// look: stone, dark, glow（目と亀裂の色）, size
function makeGolem(look = {}) {
  const L = { stone: 0x8a8377, dark: 0x5e584f, glow: 0xffa040, size: 1, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const legL = joint(body, -0.4, 1.0, 0), legR = joint(body, 0.4, 1.0, 0);
  for (const leg of [legL, legR]) { const l = box(0.5, 1.0, 0.55, L.dark); l.position.y = -0.5; leg.add(l); }
  const torso = box(1.4, 1.1, 0.9, L.stone); torso.position.y = 1.6; body.add(torso);
  if (L.glow) { const crack = box(0.5, 0.08, 0.02, L.glow, { emissive: L.glow, emissiveIntensity: 1.2 }); crack.position.set(0.1, 1.7, -0.46); body.add(crack); }
  const head = joint(body, 0, 2.2, -0.1);
  if (!L.headless) {
    const h = box(0.6, 0.5, 0.55, L.stone); h.position.y = 0.2; head.add(h);
    for (const s of [-1, 1]) {
      const eye = box(0.12, 0.07, 0.02, L.glow ?? 0x222222, L.glow ? { emissive: L.glow, emissiveIntensity: 1.5 } : {}); eye.position.set(s * 0.14, 0.25, -0.285); head.add(eye);
    }
  } else head.rotation.z = 0.9;   // 首の折れた石像
  const armL = joint(body, -0.9, 2.0, 0), armR = joint(body, 0.9, 2.0, 0);
  for (const arm of [armL, armR]) {
    const a = box(0.45, 1.2, 0.5, L.stone); a.position.y = -0.55; arm.add(a);
    const fist = box(0.6, 0.5, 0.6, L.dark); fist.position.y = -1.25; arm.add(fist);
  }
  g.scale.setScalar(L.size);
  return { group: g, parts: { kind: 'biped', twoArm: true, body, legL, legR, armL, armR, head } };
}

// ------------------------------------------------------------------ 浮遊する霊体（レイス・バンシー・フェアリー・ランプ・精霊）
// look: color, glow, size, style（'cloak' | 'fairy' | 'lamp' | 'wisp'）, opacity
function makeSpirit(look = {}) {
  const L = { color: 0x9aa8c8, glow: 0xbfe8ff, size: 1, style: 'cloak', opacity: 0.75, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const mat = new THREE.MeshStandardMaterial({ color: L.color, emissive: L.glow, emissiveIntensity: 0.35, transparent: true, opacity: L.opacity, flatShading: true });
  const head = joint(body, 0, 1.55, 0);
  const armL = joint(body, -0.35, 1.25, 0), armR = joint(body, 0.35, 1.25, 0);
  if (L.style === 'cloak') {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 7, 1, true), mat); robe.position.y = 0.85; body.add(robe);
    const hood = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat); head.add(hood);
    for (const s of [-1, 1]) { const e = box(0.06, 0.04, 0.02, L.glow, { emissive: L.glow, emissiveIntensity: 1.5 }); e.position.set(s * 0.08, 0, -0.22); head.add(e); }
    for (const arm of [armL, armR]) { const a = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.55, 5), mat); a.rotation.x = Math.PI; a.position.y = -0.25; arm.add(a); }
  } else if (L.style === 'fairy') {
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color: L.glow })); core.position.y = 1.3; body.add(core);
    for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshBasicMaterial({ color: L.color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
      w.position.set(s * 0.22, 1.35, 0.05); w.rotation.y = s * 0.5; (s < 0 ? armL : armR).add(w); w.position.set(s * 0.1, 0.1, 0.05); }
  } else if (L.style === 'lamp') {
    const cage = box(0.32, 0.42, 0.32, 0x3a3328); cage.position.y = 1.2; body.add(cage);
    const flame = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), new THREE.MeshBasicMaterial({ color: L.glow })); flame.position.y = 1.2; body.add(flame);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 4, 8, Math.PI), flatMat(0x3a3328)); handle.position.y = 1.45; body.add(handle);
  } else { // wisp
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), mat); core.position.y = 1.3; body.add(core);
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), new THREE.MeshBasicMaterial({ color: L.glow })); inner.position.y = 1.3; body.add(inner);
  }
  g.scale.setScalar(L.size);
  return { group: g, parts: { kind: 'float', body, head, armL, armR, legL: joint(body, 0, 0, 0), legR: joint(body, 0, 0, 0) } };
}

// ------------------------------------------------------------------ 地を這う（サンドワーム・デスワーム）
function makeWorm(look = {}) {
  const L = { skin: 0xc9a46a, dark: 0x8a6a3a, mouth: 0x5a1a1a, size: 1, segs: 6, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const segs = [];
  for (let i = 0; i < L.segs; i++) {
    const r = 0.45 - i * 0.035;
    const sgm = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), flatMat(i % 2 ? L.dark : L.skin));
    sgm.castShadow = true;
    sgm.position.set(0, r, i * 0.55); body.add(sgm); segs.push(sgm);
  }
  const head = joint(body, 0, 0.5, -0.3);
  const mouth = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.3, 8), flatMat(L.mouth)); mouth.rotation.x = Math.PI / 2; head.add(mouth);
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 3), flatMat(0xf2ead0)); const a = i / 6 * Math.PI * 2;
    t.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.15); t.rotation.x = -Math.PI / 2; head.add(t); }
  g.scale.setScalar(L.size);
  const dummy = () => joint(body, 0, 0, 0);
  return { group: g, parts: { kind: 'worm', body, head, segs, legL: dummy(), legR: dummy(), armL: dummy(), armR: dummy() } };
}

// ------------------------------------------------------------------ 樹木（蛇樹・人喰い樹・ドライアドの樹）
function makeTree(look = {}) {
  const L = { bark: 0x5a4030, leaf: 0x3f6a32, eye: 0xffd24a, size: 1, ...look };
  const g = new THREE.Group();
  const body = new THREE.Object3D(); g.add(body);
  const trunk = cyl(0.35, 0.5, 2.2, L.bark, 7); trunk.position.y = 1.1; body.add(trunk);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 0), flatMat(L.leaf)); crown.position.y = 2.6; crown.castShadow = true; body.add(crown);
  const head = joint(body, 0, 1.6, -0.3);
  for (const s of [-1, 1]) { const e = box(0.12, 0.08, 0.02, L.eye, { emissive: L.eye, emissiveIntensity: 1.2 }); e.position.set(s * 0.13, 0, -0.06); head.add(e); }
  const mouth = box(0.3, 0.08, 0.02, 0x1a0a05); mouth.position.set(0, -0.25, -0.06); head.add(mouth);
  const armL = joint(body, -0.4, 1.8, 0), armR = joint(body, 0.4, 1.8, 0);
  for (const [arm, s] of [[armL, -1], [armR, 1]]) { const a = cyl(0.08, 0.12, 1.2, L.bark, 5); a.position.set(s * 0.3, -0.4, 0); a.rotation.z = s * 0.7; arm.add(a); }
  const legL = joint(body, 0, 0, 0), legR = joint(body, 0, 0, 0);
  g.scale.setScalar(L.size);
  return { group: g, parts: { kind: 'tree', twoArm: true, body, head, armL, armR, legL, legR } };
}

const FAMILIES = { humanoid: makeHumanoid, beast: makeBeast, golem: makeGolem, spirit: makeSpirit, worm: makeWorm, tree: makeTree };
// 以前の名前（goblin / wolf）も使えるようにしておく
FAMILIES.goblin = makeHumanoid;
FAMILIES.wolf = makeBeast;

export function makeMonster(model, look) {
  const f = FAMILIES[model];
  if (!f) throw new Error('unknown model ' + model);
  return f(look);
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

// color: 魔石の等級の色。等級が高いほど少し大きい（size）
export function makeMagicStone(color = 0x55c8ff, size = 1) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 * size, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, flatShading: true }));
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

// ------------------------------------------------------------------ 階層を移動する門（ポータル）
// kind: next（下層へ）/ prev（上層へ）/ rift（次元の亀裂へ）/ back（亀裂から元の層へ）
// closed: 閉ざされた門（光らず、渦の代わりに格子がはまっている）
const PORTAL_COLORS = { next: 0xb07cff, prev: 0x7ff0ff, rift: 0xff4fd2, back: 0xffd27a };
export function makePortal(kind, closed = false) {
  const color = PORTAL_COLORS[kind];
  const g = new THREE.Group();
  const stone = closed ? 0x3a3c42 : 0x55596a;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.25, 10), flatMat(0x3c3f48));
  base.position.y = 0.12; base.receiveShadow = true; g.add(base);
  // 門の枠（2 本の柱と上の梁）
  for (const s of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.8, 0.45), flatMat(stone));
    pillar.position.set(s * 1.1, 1.5, 0); pillar.castShadow = true; g.add(pillar);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 0.5), flatMat(stone));
  lintel.position.y = 3.0; lintel.castShadow = true; g.add(lintel);
  // 矢印のしるし（下層は下向き、上層は上向き）
  if (kind === 'next' || kind === 'prev') {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.32, 4),
      new THREE.MeshBasicMaterial({ color: closed ? 0x555555 : color }));
    arrow.position.set(0, 3.0, -0.27);
    arrow.rotation.z = kind === 'next' ? Math.PI : 0;
    g.add(arrow);
  }
  let swirl = null, light = null;
  if (closed) {
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.6, 0.06), flatMat(0x2a2a2e, { metalness: 0.5 }));
      bar.position.set(i * 0.28, 1.55, 0); g.add(bar);
    }
  } else {
    // 渦（加算合成の円盤を 2 枚、両面から見える）。霧の影響を受けないので、暗い所からでも光って見える（目印になる）
    swirl = new THREE.Group();
    for (const [r, o] of [[0.95, 0.55], [0.6, 0.8]]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      swirl.add(disc);
    }
    swirl.position.y = 1.55;
    swirl.scale.y = 1.35;
    g.add(swirl);
    light = new THREE.PointLight(color, 8, 9, 1.6);
    light.position.set(0, 1.8, 0);
    g.add(light);
  }
  return { group: g, parts: { swirl, light } };
}

// 階層の飾り（テーマごとの小物・空・漂う光）。どれもインスタンス描画でまとめて描き、スマホでも重くならないようにする。
// 当たり判定はない（通り抜けられる小物だけ。ぶつかる岩・木・柱は game.js の buildProps）。
import * as THREE from 'three';
import { flatMat } from './models.js';

// ---------------------------------------------------------------- 共通
function inst(root, geo, mat, items, place, opts = {}) {
  if (!items.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, items.length);
  const o = new THREE.Object3D(), col = new THREE.Color();
  items.forEach((it, i) => {
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1);
    place(it, o, i);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (it.color !== undefined) m.setColorAt(i, col.set(it.color));
  });
  m.receiveShadow = !!opts.receive;
  m.castShadow = !!opts.cast;
  root.add(m);
  return m;
}
const pick = (rnd, a) => a[Math.floor(rnd() * a.length)];
const shade = (hex, rnd, k = 0.3) => new THREE.Color(hex).multiplyScalar(1 - k / 2 + rnd() * k).getHex();

// 草の葉（透明な部分を切り抜く板。十字に組む）
let grassTex = null;
function grassTexture() {
  if (grassTex) return grassTex;
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = 6 + Math.random() * 52, h = 28 + Math.random() * 34, lean = (Math.random() - 0.5) * 18;
    g.lineWidth = 2 + Math.random() * 2;
    g.beginPath(); g.moveTo(x, 64); g.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h); g.stroke();
  }
  grassTex = new THREE.CanvasTexture(cv);
  return grassTex;
}
function tuftGeometry() {
  const a = new THREE.PlaneGeometry(1.1, 0.7); a.translate(0, 0.35, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const merge = (gs) => {
    const pos = [], uv = [], idx = []; let off = 0;
    for (const g2 of gs) {
      pos.push(...g2.attributes.position.array); uv.push(...g2.attributes.uv.array);
      idx.push(...[...g2.index.array].map(v => v + off)); off += g2.attributes.position.count;
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
  };
  merge([a, b]);
  return geo;
}

// 漂う光の粒（ほこり・蛍・霊の光）。動きは update で付ける
function floaters(root, ctx, cells, count, color, size, opts = {}) {
  if (!cells.length) return;
  const { rnd, cellCenter, T } = ctx;
  const n = Math.min(count, cells.length * 3);
  const pos = new Float32Array(n * 3), base = new Float32Array(n * 3), phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = cellCenter(...pick(rnd, cells));
    base[i * 3] = p.x + (rnd() - 0.5) * T; base[i * 3 + 1] = (opts.yMin ?? 0.4) + rnd() * (opts.yRange ?? 2.5); base[i * 3 + 2] = p.z + (rnd() - 0.5) * T;
    phase[i] = rnd() * 10;
  }
  pos.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: opts.opacity ?? 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, map: dotTexture() });
  const pts = new THREE.Points(geo, mat);
  root.add(pts);
  const amp = opts.amp ?? 0.4, speed = opts.speed ?? 0.6;
  ctx.anims.push((dt, t) => {
    for (let i = 0; i < n; i++) {
      const ph = phase[i];
      pos[i * 3] = base[i * 3] + Math.sin(t * speed + ph) * amp;
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * speed * 0.7 + ph * 2) * amp * 0.5;
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * speed * 0.9 + ph) * amp;
    }
    geo.attributes.position.needsUpdate = true;
    if (opts.blink) mat.opacity = 0.5 + Math.sin(t * 2.3) * 0.3;
  });
}
let dotTex = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(cv);
  return dotTex;
}

// ---------------------------------------------------------------- 夜空（地平線から天頂へのグラデーション）
export function buildSkyDome(root, horizon, zenith, center, radius) {
  const geo = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const cols = [], pos = geo.attributes.position, h = new THREE.Color(horizon), z = new THREE.Color(zenith), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const t = Math.pow(Math.max(0, pos.getY(i) / radius), 0.6); c.copy(h).lerp(z, t); cols.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.position.set(center.x, -2, center.z);
  dome.renderOrder = -1;
  root.add(dome);
}

// ---------------------------------------------------------------- テーマごとの飾り
// ctx: { theme, floorCells, wallCells, grid, regions, dark, glow, rnd, wallH, cellCenter, isWallCell, T, anims }
export function decorate(root, ctx) {
  const f = DECOR[ctx.theme];
  if (f) f(root, ctx);
}

const openCells = ctx => ctx.floorCells.filter(([r, c]) => '.C^m'.includes(ctx.grid[r][c]));
const nextToWall = (ctx, r, c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => ctx.isWallCell(r + dr, c + dc));
const jitter = (ctx, [r, c], k = 0.8) => { const p = ctx.cellCenter(r, c); p.x += (ctx.rnd() - 0.5) * ctx.T * k; p.z += (ctx.rnd() - 0.5) * ctx.T * k; return p; };

// 小石
function pebbles(root, ctx, cells, count, color) {
  const { rnd } = ctx;
  const items = []; for (let i = 0; i < count && cells.length; i++) items.push({ p: jitter(ctx, pick(rnd, cells), 0.9), s: 0.08 + rnd() * 0.22, color: shade(color, rnd) });
  inst(root, new THREE.DodecahedronGeometry(1, 0), flatMat(0xffffff), items, (it, o) => {
    o.position.set(it.p.x, it.s * 0.4, it.p.z); o.rotation.set(rnd() * 3, rnd() * 3, 0); o.scale.set(it.s, it.s * 0.7, it.s);
  }, { receive: true });
}
// 草むら
function grass(root, ctx, cells, count, color) {
  const { rnd } = ctx;
  const items = []; for (let i = 0; i < count && cells.length; i++) items.push({ p: jitter(ctx, pick(rnd, cells), 0.95), s: 0.6 + rnd() * 0.8, color: shade(color, rnd, 0.4) });
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: grassTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  inst(root, tuftGeometry(), mat, items, (it, o) => { o.position.set(it.p.x, 0, it.p.z); o.rotation.y = rnd() * 3; o.scale.setScalar(it.s); });
}
// 枯れ木（幹と枝）
function deadTrees(root, ctx, cells, count, color) {
  const { rnd } = ctx;
  const items = []; for (let i = 0; i < count && cells.length; i++) items.push({ p: jitter(ctx, pick(rnd, cells), 0.6), h: 2.2 + rnd() * 2.5, color: shade(color, rnd) });
  inst(root, new THREE.CylinderGeometry(0.08, 0.2, 1, 5), flatMat(0xffffff), items, (it, o) => { o.position.set(it.p.x, it.h / 2, it.p.z); o.rotation.z = (rnd() - 0.5) * 0.2; o.scale.set(1, it.h, 1); }, { cast: true });
  const br = []; for (const it of items) for (let k = 0; k < 3; k++) br.push({ ...it, y: it.h * (0.5 + rnd() * 0.45), a: rnd() * 6.28, l: 0.6 + rnd() * 0.9 });
  inst(root, new THREE.CylinderGeometry(0.03, 0.07, 1, 4), flatMat(0xffffff), br, (b, o) => {
    o.position.set(b.p.x + Math.cos(b.a) * b.l * 0.35, b.y, b.p.z + Math.sin(b.a) * b.l * 0.35); o.rotation.set(Math.sin(b.a) * 0.9, 0, -Math.cos(b.a) * 0.9); o.scale.set(1, b.l, 1); });
}
// キノコ（ほのかに光る）
function mushrooms(root, ctx, cells, count, color) {
  const { rnd } = ctx;
  const items = []; for (let i = 0; i < count && cells.length; i++) items.push({ p: jitter(ctx, pick(rnd, cells), 0.9), s: 0.12 + rnd() * 0.2 });
  inst(root, new THREE.CylinderGeometry(0.25, 0.3, 1, 5), flatMat(0xd8ccb0), items, (it, o) => { o.position.set(it.p.x, it.s * 0.5, it.p.z); o.scale.set(it.s, it.s, it.s); });
  inst(root, new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7, roughness: 0.6 }), items,
    (it, o) => { o.position.set(it.p.x, it.s, it.p.z); o.scale.set(it.s * 1.1, it.s * 0.7, it.s * 1.1); });
}
// 地面すれすれの霧（ゆっくり流れる半透明の板）
function mist(root, ctx, cells, count, color, opacity = 0.18) {
  const { rnd } = ctx;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const mat = new THREE.MeshBasicMaterial({ color, map: new THREE.CanvasTexture(cv), transparent: true, opacity, depthWrite: false });
  const items = []; for (let i = 0; i < count && cells.length; i++) items.push({ p: jitter(ctx, pick(rnd, cells), 1), s: 4 + rnd() * 5, ph: rnd() * 6 });
  const m = inst(root, new THREE.PlaneGeometry(1, 1), mat, items, (it, o) => { o.position.set(it.p.x, 0.35 + rnd() * 0.3, it.p.z); o.rotation.x = -Math.PI / 2; o.scale.set(it.s, it.s, 1); });
  if (!m) return;
  const o = new THREE.Object3D();
  ctx.anims.push((dt, t) => {
    items.forEach((it, i) => {
      o.position.set(it.p.x + Math.sin(t * 0.15 + it.ph) * 1.5, 0.4, it.p.z + Math.cos(t * 0.12 + it.ph) * 1.5);
      o.rotation.set(-Math.PI / 2, 0, t * 0.05 + it.ph); o.scale.set(it.s, it.s, 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  });
}

const DECOR = {
  // 第1層 水晶の洞窟：天井から垂れる鍾乳石、床から伸びる石筍、小石、光の届く所に漂う光の粒
  crystal(root, ctx) {
    const { rnd, floorCells, wallH } = ctx;
    const lit = floorCells.filter(([r, c]) => (ctx.glow?.[r]?.[c] ?? 0) > 0.2);
    const dark = floorCells.filter(([r, c]) => ctx.dark?.[r]?.[c]);
    const st = [];
    for (const cell of floorCells) if (rnd() < 0.45) for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) st.push({ p: jitter(ctx, cell, 0.9), l: 0.4 + rnd() * 1.1, color: shade(0x1c2a44, rnd) });
    inst(root, new THREE.ConeGeometry(0.22, 1, 5), flatMat(0xffffff), st, (it, o) => { o.position.set(it.p.x, wallH - it.l / 2, it.p.z); o.rotation.x = Math.PI; o.scale.set(1, it.l, 1); });
    const sg = floorCells.filter(([r, c]) => nextToWall(ctx, r, c) && rnd() < 0.35).map(cell => ({ p: jitter(ctx, cell, 0.9), l: 0.3 + rnd() * 0.8, color: shade(0x22324e, rnd) }));
    inst(root, new THREE.ConeGeometry(0.25, 1, 5), flatMat(0xffffff), sg, (it, o) => { o.position.set(it.p.x, it.l / 2, it.p.z); o.scale.set(1, it.l, 1); });
    pebbles(root, ctx, openCells(ctx), Math.floor(floorCells.length * 0.8), 0x2a3a5a);
    floaters(root, ctx, lit, 260, 0x9fe0ff, 0.09, { amp: 0.6, speed: 0.35 });
    floaters(root, ctx, dark, 50, 0x6a7aa8, 0.06, { amp: 0.4, speed: 0.2, opacity: 0.4 });
  },
  // 峡谷：小石と枯れ草
  canyon(root, ctx) {
    const open = openCells(ctx);
    pebbles(root, ctx, open, Math.floor(open.length * 0.6), 0x6a4a36);
    grass(root, ctx, open.filter(() => ctx.rnd() < 0.25), Math.floor(open.length * 0.2), 0x8a7a4a);
    floaters(root, ctx, open, 120, 0xffd8a0, 0.06, { opacity: 0.35 });
  },
  // 亡者の地：枯れ木、水たまり、地面を流れる霧、亡霊の光
  dead(root, ctx) {
    const { rnd } = ctx;
    const open = openCells(ctx);
    deadTrees(root, ctx, open, Math.floor(open.length * 0.05), 0x2a2420);
    const pud = open.filter(() => rnd() < 0.12).map(cell => ({ p: jitter(ctx, cell, 0.5), s: 0.8 + rnd() * 1.4 }));
    inst(root, new THREE.CircleGeometry(1, 10), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.6 }), pud,
      (it, o) => { o.position.set(it.p.x, 0.012, it.p.z); o.rotation.x = -Math.PI / 2; o.scale.set(it.s, it.s * (0.6 + rnd() * 0.4), 1); });
    pebbles(root, ctx, open, Math.floor(open.length * 0.3), 0x3a3834);
    mist(root, ctx, open, Math.floor(open.length * 0.05), 0xb8c4d8, 0.16);
    floaters(root, ctx, open, 60, 0x9ad8ff, 0.12, { amp: 1.2, speed: 0.3, blink: true });
  },
  // 岩の砂漠：小石、枯れ草、白骨
  desert(root, ctx) {
    const { rnd } = ctx;
    const open = openCells(ctx);
    pebbles(root, ctx, open, Math.floor(open.length * 0.4), 0x9a7a52);
    grass(root, ctx, open, Math.floor(open.length * 0.08), 0x9a8a50);
    const bones = open.filter(() => rnd() < 0.03).map(cell => ({ p: jitter(ctx, cell, 0.8) }));
    inst(root, new THREE.CylinderGeometry(0.04, 0.04, 0.8, 4), flatMat(0xe8dcc0), bones, (it, o) => { o.position.set(it.p.x, 0.05, it.p.z); o.rotation.set(Math.PI / 2, 0, rnd() * 3); });
    floaters(root, ctx, open, 150, 0xffe0a0, 0.05, { opacity: 0.3, amp: 1.5, speed: 0.5 });
  },
  // ゴブリンの森：草むら、茂み、光るキノコ、蛍
  forest(root, ctx) {
    const { rnd } = ctx;
    const open = openCells(ctx);
    grass(root, ctx, open, Math.floor(open.length * 0.9), 0x4a7a3a);
    const bush = open.filter(() => rnd() < 0.08).map(cell => ({ p: jitter(ctx, cell, 0.8), s: 0.4 + rnd() * 0.5, color: shade(0x2f5a2a, rnd) }));
    inst(root, new THREE.IcosahedronGeometry(1, 0), flatMat(0xffffff), bush, (it, o) => { o.position.set(it.p.x, it.s * 0.6, it.p.z); o.scale.set(it.s * 1.3, it.s, it.s * 1.3); });
    mushrooms(root, ctx, open, Math.floor(open.length * 0.06), 0x6affc8);
    floaters(root, ctx, open, 220, 0xd8ff7a, 0.1, { amp: 1.2, speed: 0.5, blink: true });
  },
  // 巡礼者の道：フィールドごとに違う飾り
  pilgrim(root, ctx) {
    const { rnd } = ctx;
    const open = openCells(ctx);
    const field = k => open.filter(([r, c]) => ctx.regions?.[r]?.[c] === k);
    const grassy = open.filter(([r, c]) => ['road_w', 'plain_nw', 'grass_sw', 'gate_n', 'battle_ne', 'orc'].includes(ctx.regions?.[r]?.[c]));
    grass(root, ctx, grassy, Math.floor(grassy.length * 0.6), 0x6a8a3a);
    // 魔女の森：光るキノコと紫の霊火
    const witch = field('witch');
    mushrooms(root, ctx, witch, Math.floor(witch.length * 0.15), 0xc07aff);
    floaters(root, ctx, witch, 160, 0xc89aff, 0.14, { amp: 1.4, speed: 0.4, blink: true });
    mist(root, ctx, witch, Math.floor(witch.length * 0.04), 0x9a7ac8, 0.12);
    // 緑尾の湿地：水面と葦
    const swamp = field('swamp');
    const water = swamp.filter(() => rnd() < 0.35).map(cell => ({ p: ctx.cellCenter(...cell) }));
    inst(root, new THREE.PlaneGeometry(ctx.T, ctx.T), new THREE.MeshStandardMaterial({ color: 0x1a3a34, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.85 }), water,
      (it, o) => { o.position.set(it.p.x, 0.02, it.p.z); o.rotation.x = -Math.PI / 2; });
    grass(root, ctx, swamp, Math.floor(swamp.length * 0.8), 0x5a7a4a);
    mist(root, ctx, swamp, Math.floor(swamp.length * 0.05), 0xa8c8b8, 0.14);
    // 鋼岩の丘・枯れ谷：小石
    pebbles(root, ctx, [...field('hill'), ...field('valley_se')], Math.floor((field('hill').length + field('valley_se').length) * 0.5), 0x7a7a70);
    deadTrees(root, ctx, field('valley_se'), Math.floor(field('valley_se').length * 0.03), 0x4a3a2a);
    // オークの群落地：天幕と杭の柵
    const orc = field('orc');
    const tents = orc.filter(() => rnd() < 0.025).map(cell => ({ p: jitter(ctx, cell, 0.4), s: 1.6 + rnd() * 1.2, color: shade(0x7a5a3a, rnd) }));
    inst(root, new THREE.ConeGeometry(1.3, 2.2, 6), flatMat(0xffffff), tents, (it, o) => { o.position.set(it.p.x, it.s * 1.1 / 1.0 * 0.5 + 0.6, it.p.z); o.scale.setScalar(it.s * 0.7); }, { cast: true });
    const stakes = orc.filter(() => rnd() < 0.06).flatMap(cell => [0, 1, 2].map(k => ({ p: jitter(ctx, cell, 0.9) })));
    inst(root, new THREE.ConeGeometry(0.12, 1.6, 4), flatMat(0x5a4028), stakes, (it, o) => { o.position.set(it.p.x, 0.8, it.p.z); o.rotation.z = (rnd() - 0.5) * 0.3; });
    // 古戦場：折れた剣と盾
    const battle = field('battle_ne');
    const swords = battle.filter(() => rnd() < 0.06).map(cell => ({ p: jitter(ctx, cell, 0.8) }));
    inst(root, new THREE.BoxGeometry(0.06, 1.1, 0.14), flatMat(0x8a8a90, { metalness: 0.5, roughness: 0.5 }), swords, (it, o) => { o.position.set(it.p.x, 0.45, it.p.z); o.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5); });
    // 霧の平原：霧
    mist(root, ctx, field('plain_nw'), Math.floor(field('plain_nw').length * 0.06), 0xc8d0e0, 0.2);
  },
};

// 第3層の中心の尖塔（第4層への入口）。遠くからでも見える目印
export function buildSpire(root, center) {
  const g = new THREE.Group();
  // 霧の影響を受けない（遠くからでも夜空に影絵のように見える目印）
  const stone = new THREE.MeshStandardMaterial({ color: 0x3a3f58, roughness: 0.9, flatShading: true, fog: false });
  let y = 0;
  const tiers = [[3.2, 3.6, 10], [2.6, 3.0, 12], [2.0, 2.5, 12], [1.4, 1.9, 12], [0.8, 1.3, 10]];
  for (const [rt, rb, h] of tiers) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 8), stone);
    t.position.y = y + h / 2; t.castShadow = true; g.add(t); y += h;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(rt + 0.15, rt + 0.15, 0.4, 8), new THREE.MeshBasicMaterial({ color: 0x9ad8ff, fog: false }));
    band.position.y = y - 0.3; g.add(band);
  }
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.8, 8, 8), stone); tip.position.y = y + 4; g.add(tip);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, fog: false }));
  beacon.position.y = y + 9.5; g.add(beacon);
  g.position.set(center.x, 0, center.z);
  root.add(g);
  return { group: g, beacon };
}

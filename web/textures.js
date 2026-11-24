// 床・壁・天井の質感テクスチャを、起動時にプログラムで描く（画像ファイルを使わないのでオフラインでも軽い）。
// どれも継ぎ目なく繰り返せる（タイル状に並べても境目が出ない）。
// 色は付けず明るさの模様（グレースケール）だけを描き、色は床や壁ごとの色（インスタンスの色・マテリアルの色）で付ける。
// 同じ模様を凹凸（bumpMap）にも使う。
import * as THREE from 'three';

const SIZE = 256;
const cache = new Map();

// 繰り返せる値ノイズ（格子の周期 period でつながる）
function makeNoise(seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const table = new Float32Array(4096);
  for (let i = 0; i < table.length; i++) table[i] = rnd();
  const lattice = (x, y, p) => table[(((x % p) + p) % p) * 61 + (((y % p) + p) % p) * 7 & 4095];
  const smooth = t => t * t * (3 - 2 * t);
  const value = (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
    const a = lattice(xi, yi, p), b = lattice(xi + 1, yi, p), c = lattice(xi, yi + 1, p), d = lattice(xi + 1, yi + 1, p);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  // u, v は 0〜1。base は最も粗い格子の数
  const fbm = (u, v, base = 4, oct = 5) => {
    let sum = 0, amp = 0.5, norm = 0, p = base;
    for (let o = 0; o < oct; o++) { sum += value(u * p, v * p, p) * amp; norm += amp; amp *= 0.5; p *= 2; }
    return sum / norm;
  };
  return { fbm, rnd };
}

// 模様の関数 (u, v, noise) → 明るさ 0〜1
const PATTERNS = {
  // ごつごつした岩肌
  rock: (u, v, n) => 0.55 + 0.45 * n.fbm(u, v, 4, 6) - Math.max(0, 0.06 - Math.abs(n.fbm(u + 0.3, v, 3, 4) - 0.5)) * 6,
  // 水晶の洞窟の岩（細い筋が入る）
  crystalRock: (u, v, n) => {
    const base = 0.55 + 0.4 * n.fbm(u, v, 4, 6);
    const vein = Math.max(0, 0.03 - Math.abs(n.fbm(u, v + 0.5, 3, 5) - 0.5)) * 14;
    return base + vein;
  },
  // 石畳（不ぞろいな四角い石）
  flagstone: (u, v, n) => {
    const cells = 3, cx = u * cells, cy = v * cells + (Math.floor(u * cells) % 2) * 0.5;
    const fx = cx - Math.floor(cx), fy = cy - Math.floor(cy);
    const edge = Math.min(fx, 1 - fx, fy, 1 - fy);
    const id = n.fbm(Math.floor(cx) / cells, Math.floor(cy) / cells, 8, 1);
    return (edge < 0.04 ? 0.35 : 0.72 + id * 0.2) + (n.fbm(u, v, 8, 4) - 0.5) * 0.25;
  },
  // 石積み（レンガ）
  bricks: (u, v, n) => {
    const rows = 6, cols = 3, row = Math.floor(v * rows);
    const x = u * cols + (row % 2) * 0.5, fx = x - Math.floor(x), fy = v * rows - row;
    const mortar = Math.min(fx, 1 - fx) * 2.2 < 0.06 || Math.min(fy, 1 - fy) < 0.06;
    const id = n.fbm(Math.floor(x) / cols, row / rows, 8, 1);
    return (mortar ? 0.38 : 0.68 + id * 0.25) + (n.fbm(u, v, 8, 4) - 0.5) * 0.22;
  },
  // 地層（峡谷の崖）
  strata: (u, v, n) => {
    const band = Math.sin((v * 9 + n.fbm(u, v, 2, 3) * 2.2) * Math.PI * 2) * 0.5 + 0.5;
    return 0.55 + band * 0.25 + (n.fbm(u, v, 6, 5) - 0.5) * 0.35;
  },
  // 砂（風紋）
  sand: (u, v, n) => 0.78 + Math.sin((v * 14 + n.fbm(u, v, 3, 3) * 3) * Math.PI * 2) * 0.06 + (n.fbm(u, v, 16, 3) - 0.5) * 0.18,
  // 泥（水たまりは暗い）
  mud: (u, v, n) => { const h = n.fbm(u, v, 3, 5); return h < 0.42 ? 0.45 + h * 0.3 : 0.62 + (h - 0.42) * 0.8; },
  // 草地
  grass: (u, v, n) => 0.62 + n.fbm(u, v, 6, 4) * 0.3 + (n.fbm(u * 1.0, v, 64, 2) - 0.5) * 0.35,
  // 土
  dirt: (u, v, n) => 0.6 + n.fbm(u, v, 5, 5) * 0.32 + (n.fbm(u, v, 32, 2) > 0.72 ? 0.18 : 0),
  // 木の皮
  bark: (u, v, n) => 0.55 + n.fbm(u * 0.25, v, 16, 4) * 0.45,
};

// 質感テクスチャ（色の模様と、凹凸用の同じ模様）を返す
export function texture(kind, seed = 7) {
  const key = kind + ':' + seed;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise(seed * 977 + kind.length * 131);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d');
  const img = g.createImageData(SIZE, SIZE);
  const f = PATTERNS[kind];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const val = Math.max(0, Math.min(1, f(x / SIZE, y / SIZE, n)));
    const i = (y * SIZE + x) * 4, c = Math.round(val * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = c; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;   // 異方性フィルタはスマホ・ソフトウェア描画で重いので使わない
  const bump = new THREE.CanvasTexture(cv);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  const out = { map: tex, bump };
  cache.set(key, out);
  return out;
}

// 凹凸（bumpMap）は画質「高」のときだけ使う（スマホ向けの「低」では切って軽くする）
let bumpOn = true;
const bumpMats = new Set();
export function setBumpEnabled(on) {
  bumpOn = on;
  for (const m of bumpMats) { m.bumpMap = on ? m.userData.bump : null; m.needsUpdate = true; }
}
export function registerBump(m) {
  m.userData.bump = m.bumpMap;
  bumpMats.add(m);
  if (!bumpOn) m.bumpMap = null;
  return m;
}

// 質感つきのマテリアル（色はインスタンスの色で付ける）
const matCache = new Map();
export function texturedMat(kind, opts = {}) {
  const key = kind + JSON.stringify(opts);
  if (matCache.has(key)) return matCache.get(key);
  const t = texture(kind);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: t.map, bumpMap: t.bump, bumpScale: opts.bump ?? 1.2,
    roughness: opts.roughness ?? 0.92, metalness: 0, flatShading: opts.flat ?? false });
  registerBump(m);
  matCache.set(key, m);
  return m;
}

// 箱の側面の UV を、高さに合わせて縦に繰り返す（背の高い壁で模様が縦に伸びないように）
export function repeatSideUV(geo, repeatX, repeatY) {
  const uv = geo.attributes.uv, nrm = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    if (Math.abs(nrm.getY(i)) > 0.5) continue;   // 上面・底面はそのまま
    uv.setXY(i, uv.getX(i) * repeatX, uv.getY(i) * repeatY);
  }
  uv.needsUpdate = true;
  return geo;
}

// でこぼこした壁の箱（側面の内側の頂点だけを面の向きに押し引きする。辺の頂点は動かさないので隙間はできない）
export function roughBox(w, h, d, amp, seed = 3) {
  const segY = Math.max(2, Math.round(h / 1.2));
  const geo = new THREE.BoxGeometry(w, h, d, 4, segY, 4);
  const n = makeNoise(seed);
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const eps = 1e-3;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    if (Math.abs(ny) > 0.5) continue;
    const onEdge = Math.abs(Math.abs(y) - h / 2) < eps || (Math.abs(nx) > 0.5 ? Math.abs(Math.abs(z) - d / 2) < eps : Math.abs(Math.abs(x) - w / 2) < eps);
    if (onEdge) continue;
    const t = n.fbm(((x + z) / (w + d) + 1) % 1, (y / h + 0.5) % 1, 3, 3) - 0.5;
    pos.setXYZ(i, x + nx * t * amp * 2, y, z + nz * t * amp * 2);
  }
  pos.needsUpdate = true;
  return geo;
}

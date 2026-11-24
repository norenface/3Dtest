// 階層のマップを作る（突入ごとに変わる地形）。同じ種（seed）からは必ず同じマップができるので、
// オートセーブからの再開や、同じ探索中に階層を行き来したときも同じ地形になる。
//
// どの関数も次の形を返す：
//   map      … 文字列の配列（1 文字 = 4m 四方のマス）
//              # 壁 / . 床 / P 柱・木・岩（見た目は階層のテーマで変わる）/ C ライトクリスタル / K 安全地帯の床 / M 記念碑（安全地帯の中心）
//              S 到着地点 / U 上層への門 / N 下層への門 / R 次元の亀裂の候補地点 / T 石碑（ゴブリンの森）/ ^ 罠（見えない）
//              1〜4 第1層の東西南北の門 / m 魔物の群れの出現地点（種類は regions で決まる）
//   regions  … マスごとの地域の名前（2 次元配列。魔物の種類・ギミック・地名の表示に使う）
//   arrivals … 別の階層から来たときの到着地点 { 来た階層の id: [行, 列] }（第3層）
//   prevCells… 上層への門の場所 { 戻る先の階層の id: [行, 列] }（第3層）

export function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function makeGrid(rows, cols, ch = '#') {
  return Array.from({ length: rows }, () => Array(cols).fill(ch));
}
function toRows(g) { return g.map(r => r.join('')); }
function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const walkable = ch => ch !== '#' && ch !== 'P' && ch !== 'T' && ch !== 'M';

// 歩けるマスがすべてつながっているか（つながっていない所は壁で埋める）
function keepConnected(g, from) {
  const rows = g.length, cols = g[0].length;
  const seen = makeGrid(rows, cols, false);
  const stack = [from];
  seen[from[0]][from[1]] = true;
  while (stack.length) {
    const [r, c] = stack.pop();
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || seen[nr][nc] || !walkable(g[nr][nc])) continue;
      seen[nr][nc] = true;
      stack.push([nr, nc]);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!seen[r][c] && walkable(g[r][c])) g[r][c] = '#';
}

// 歩けるマスをたどった距離
function distances(g, from) {
  const rows = g.length, cols = g[0].length;
  const d = makeGrid(rows, cols, -1);
  const q = [from]; d[from[0]][from[1]] = 0;
  for (let i = 0; i < q.length; i++) {
    const [r, c] = q[i];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols || d[nr][nc] >= 0 || !walkable(g[nr][nc])) continue;
      d[nr][nc] = d[r][c] + 1;
      q.push([nr, nc]);
    }
  }
  return d;
}

// 穴掘り法の迷路（nodeOk(r, c) が true のマスを節点に、2 マスおきに掘る）。loops の割合で壁を抜いて回り道を作る
function carveMaze(g, start, nodeOk, rnd, loops = 0.08, straight = 0) {
  const seen = new Set([start.join()]);
  const stack = [start];
  g[start[0]][start[1]] = '.';
  let lastDir = null;
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    let nbrs = DIRS.map(([dr, dc]) => [r + dr * 2, c + dc * 2, r + dr, c + dc, dr, dc])
      .filter(([nr, nc]) => nodeOk(nr, nc) && !seen.has(nr + ',' + nc));
    if (!nbrs.length) { stack.pop(); lastDir = null; continue; }
    // straight が小さいほど曲がりやすい（急カーブの多い洞窟）
    const same = lastDir && nbrs.find(n => n[4] === lastDir[0] && n[5] === lastDir[1]);
    const pick = same && rnd() < straight ? same : nbrs[Math.floor(rnd() * nbrs.length)];
    const [nr, nc, mr, mc, dr, dc] = pick;
    g[mr][mc] = '.'; g[nr][nc] = '.';
    seen.add(nr + ',' + nc);
    stack.push([nr, nc]);
    lastDir = [dr, dc];
  }
  // 回り道
  for (let r = 1; r < g.length - 1; r++) for (let c = 1; c < g[0].length - 1; c++) {
    if (g[r][c] !== '#') continue;
    const h = nodeOk(r, c - 1) && nodeOk(r, c + 1) && g[r][c - 1] !== '#' && g[r][c + 1] !== '#';
    const v = nodeOk(r - 1, c) && nodeOk(r + 1, c) && g[r - 1][c] !== '#' && g[r + 1][c] !== '#';
    if ((h || v) && rnd() < loops) g[r][c] = '.';
  }
}

// 床のマスのうち、条件に合うものを互いに minGap 以上離して count 個選ぶ
function scatter(g, rnd, count, minGap, ok) {
  const cells = [];
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g[0].length; c++) if (g[r][c] === '.' && ok(r, c)) cells.push([r, c]);
  shuffle(cells, rnd);
  const out = [];
  for (const p of cells) {
    if (out.length >= count) break;
    if (out.every(q => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= minGap)) out.push(p);
  }
  return out;
}

// ====================================================================== 第1層：水晶の洞窟
// 十字形の洞窟。外周の 1 マス幅の回廊はすべて暗黒地帯（dark。クリスタルの光が届かない）。内側は急カーブの多い迷路。
// 中央の空洞と記念碑の周りは安全地帯（魔物が入ってこない）。東西南北の腕の先に第2層への門（1 北 / 2 東 / 3 南 / 4 西）
export function crystalCave(seed) {
  const rnd = seededRandom(seed);
  const W = 35, H = 47, CR = 24, CC = 17;
  const inMask = (r, c) => (r >= 2 && r <= 44 && c >= 9 && c <= 25) || (r >= 16 && r <= 30 && c >= 1 && c <= 33);
  const g = makeGrid(H, W);
  const ring = new Set(), inner = new Set();
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!inMask(r, c)) continue;
    const edge = [-1, 0, 1].some(dr => [-1, 0, 1].some(dc => !inMask(r + dr, c + dc)));
    (edge ? ring : inner).add(r + ',' + c);
    if (edge) g[r][c] = '.';
  }
  const isInner = (r, c) => inner.has(r + ',' + c);
  // 迷路（行が偶数・列が奇数のマスが節点）。迷路と外周（暗黒地帯）のあいだには必ず 1 マスの壁が残る
  const node = (r, c) => isInner(r, c) && r % 2 === 0 && c % 2 === 1;
  carveMaze(g, [CR, CC], node, rnd, 0.1, 0.15);
  // 暗黒地帯への入口：通路の突き当たりの壁を抜く。北・東・南・西の腕にそれぞれ 2 か所だけ
  const entrances = [];
  const armOf = (r, c) => r < 16 ? 'north' : r > 30 ? 'south' : c < 9 ? 'west' : c > 25 ? 'east' : null;
  const cands = { north: [], east: [], south: [], west: [] };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!node(r, c)) continue;
    for (const [dr, dc] of DIRS) {
      const mr = r + dr, mc = c + dc, fr = r + dr * 2, fc = c + dc * 2;
      const arm = armOf(r, c);
      if (arm && isInner(mr, mc) && g[mr][mc] === '#' && ring.has(fr + ',' + fc)) cands[arm].push([mr, mc]);
    }
  }
  for (const list of Object.values(cands)) {
    shuffle(list, rnd);
    const chosen = [];
    for (const p of list) {
      if (chosen.length >= 2) break;
      if (chosen.every(q => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= 8)) chosen.push(p);
    }
    for (const [r, c] of chosen) { g[r][c] = '.'; entrances.push([r, c]); }
  }
  // 中央の空洞（安全地帯）と記念碑
  for (let r = CR - 2; r <= CR + 2; r++) for (let c = CC - 2; c <= CC + 2; c++) g[r][c] = 'K';
  g[CR][CC] = 'M';
  // 東西南北の門（十字の腕の先の切れ込み）
  const gates = { 1: [1, 17], 2: [CR, 34], 3: [45, 17], 4: [CR, 0] };
  for (const [k, [r, c]] of Object.entries(gates)) g[r][c] = k;
  keepConnected(g, [CR, CC - 2]);

  // 地域：北・東・南・西の腕と中心部
  const regions = makeGrid(H, W, null);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (g[r][c] === '#') continue;
    let reg = 'center';
    if (r < 16) reg = 'north'; else if (r > 30) reg = 'south'; else if (c < 9) reg = 'west'; else if (c > 25) reg = 'east';
    if (g[r][c] === 'K' || g[r][c] === 'M') reg = 'safe';
    regions[r][c] = reg;
  }

  // ライトクリスタル（迷路の中だけ。外周＝暗黒地帯には置かない）
  const crystalCells = scatter(g, rnd, 999, 4, (r, c) => isInner(r, c));
  for (const [r, c] of crystalCells) g[r][c] = 'C';
  for (const [r, c] of [[CR - 2, CC - 2], [CR - 2, CC + 2], [CR + 2, CC - 2], [CR + 2, CC + 2]]) g[r][c] = 'C';

  // 魔物の出現地点（安全地帯と門のそばは避ける）。数と間隔は地域ごと：
  //   北（ゴブリン）は 1〜2 体ずつ多めの地点に散らばる / 東（刃狼）は群れの地点が少数 /
  //   南（グール）・西（ノーム）は単体で徘徊する地点 / 中心部は種類の違う魔物が狭い範囲に密集する
  const far = (r, c) => Math.abs(r - CR) + Math.abs(c - CC) >= 6 && Object.values(gates).every(([gr, gc]) => Math.abs(gr - r) + Math.abs(gc - c) >= 4);
  const SPAWNS = { north: [5, 5], east: [2, 8], south: [5, 5], west: [5, 5], center: [6, 3] };   // [地点の数, 地点どうしの最小距離]
  for (const [reg, [n, gap]] of Object.entries(SPAWNS)) {
    for (const [r, c] of scatter(g, rnd, n, gap, (r, c) => regions[r][c] === reg && isInner(r, c) && far(r, c))) g[r][c] = 'm';
  }
  // 外周の回廊と門の切れ込みはすべて暗黒地帯（クリスタルの光が届かない）
  const dark = makeGrid(H, W, false);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (ring.has(r + ',' + c) && g[r][c] !== '#') dark[r][c] = true;
  for (const [r, c] of Object.values(gates)) dark[r][c] = true;
  return { map: toRows(g), regions, dark, entrances, arrivals: {}, prevCells: {} };
}

// ====================================================================== 第2層の 4 つのエリア
// 共通：到着地点 S、その隣に上層（第1層）への門 U、遠くに第3層への門 N（ゴブリンの森は石碑 T）、亀裂の候補 R、魔物の群れ m

// 獣の巣窟：分岐が極めて多い峡谷（迷いやすい）
export function canyon(seed) {
  const rnd = seededRandom(seed);
  const N = 51;
  const g = makeGrid(N, N);
  const node = (r, c) => r > 0 && c > 0 && r < N - 1 && c < N - 1 && r % 2 === 1 && c % 2 === 1;
  carveMaze(g, [N - 2, 1], node, rnd, 0.06, 0.35);
  // ところどころの広場（群れのいる場所）
  const clear = [];
  for (let i = 0; i < 9; i++) {
    const r = 5 + Math.floor(rnd() * (N - 10)), c = 5 + Math.floor(rnd() * (N - 10));
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) g[r + dr][c + dc] = '.';
    clear.push([r, c]);
  }
  return finishArea(g, rnd, [N - 2, 1], { nextFar: true, groups: 7, clear, rifts: 2 });
}

// 亡者の地：ぬかるむ黒い大地と石造りの残骸。罠はなく、ひたすら北へ進めば第3層への門がある
export function deadland(seed) {
  const rnd = seededRandom(seed);
  const Wd = 25, Ht = 75;
  const g = makeGrid(Ht, Wd, '.');
  for (let r = 0; r < Ht; r++) { g[r][0] = '#'; g[r][Wd - 1] = '#'; }
  for (let c = 0; c < Wd; c++) { g[0][c] = '#'; g[Ht - 1][c] = '#'; }
  // 石造建築の残骸（壁のかけらと柱）
  for (let i = 0; i < 60; i++) {
    const r = 3 + Math.floor(rnd() * (Ht - 8)), c = 2 + Math.floor(rnd() * (Wd - 4));
    if (Math.abs(c - Wd / 2) < 2) continue;   // 北へまっすぐ進める道を残す
    if (rnd() < 0.5) g[r][c] = 'P';
    else { const len = 2 + Math.floor(rnd() * 3), horiz = rnd() < 0.5;
      for (let k = 0; k < len; k++) { const rr = r + (horiz ? 0 : k), cc = c + (horiz ? k : 0); if (rr < Ht - 1 && cc < Wd - 1 && Math.abs(cc - Wd / 2) >= 2) g[rr][cc] = '#'; } }
  }
  const S = [Ht - 3, Math.floor(Wd / 2)];
  g[1][Math.floor(Wd / 2)] = 'N';
  return finishArea(g, rnd, S, { groups: 7, rifts: 2 });
}

// 岩の砂漠：砂と熱い空気、松明に照らされた石造りの残骸
export function desert(seed) {
  const rnd = seededRandom(seed);
  const N = 57;
  const g = makeGrid(N, N, '.');
  for (let i = 0; i < N; i++) { g[0][i] = g[N - 1][i] = g[i][0] = g[i][N - 1] = '#'; }
  // 岩山（かたまり）
  for (let i = 0; i < 26; i++) {
    const r = 3 + Math.floor(rnd() * (N - 6)), c = 3 + Math.floor(rnd() * (N - 6)), rad = 1 + Math.floor(rnd() * 2.5);
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++)
      if (dr * dr + dc * dc <= rad * rad + 0.5 && r + dr > 0 && c + dc > 0 && r + dr < N - 1 && c + dc < N - 1) g[r + dr][c + dc] = '#';
  }
  // 石造りの残骸（柱）
  for (let i = 0; i < 70; i++) { const r = 2 + Math.floor(rnd() * (N - 4)), c = 2 + Math.floor(rnd() * (N - 4)); if (g[r][c] === '.') g[r][c] = 'P'; }
  const S = [Math.floor(N / 2), N - 3];   // 第1層の西の門から来るので、東の端に着く
  g[S[0]][S[1]] = '.'; g[S[0]][S[1] - 1] = '.'; g[S[0] - 1][S[1]] = '.';
  return finishArea(g, rnd, S, { nextFar: true, groups: 7, rifts: 2 });
}

// ゴブリンの森：星明かりで比較的明るい森。無数の罠。第3層への門は 8 つの石碑のどれか 1 つ（開くと残りはただの石塊になる）
export function forest(seed) {
  const rnd = seededRandom(seed);
  const N = 57;
  const g = makeGrid(N, N, '.');
  for (let i = 0; i < N; i++) { g[0][i] = g[N - 1][i] = g[i][0] = g[i][N - 1] = '#'; }
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) if (rnd() < 0.2) g[r][c] = 'P';   // 木
  const S = [N - 3, Math.floor(N / 2)];   // 第1層の北の門から来るので、南の端に着く
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) g[S[0] + dr][S[1] + dc] = '.';
  const res = finishArea(g, rnd, S, { groups: 7, groupGap: 8, rifts: 2, noNext: true });
  const G = res.map.map(r => r.split(''));
  // 石碑 8 つ（到着地点から遠く、互いに離す）
  for (const [r, c] of scatter(G, rnd, 8, 12, (r, c) => Math.abs(r - S[0]) + Math.abs(c - S[1]) > 18 && G[r - 1][c] !== '#')) G[r][c] = 'T';
  keepConnected(G, S);
  // 罠（見えない）。到着地点の近くには置かない
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++)
    if (G[r][c] === '.' && rnd() < 0.035 && Math.abs(r - S[0]) + Math.abs(c - S[1]) > 5) G[r][c] = '^';
  // 外周部（ホブゴブリンが出る）
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (res.regions[r][c] && Math.min(r, c, N - 1 - r, N - 1 - c) <= 6) res.regions[r][c] = 'outer';
  res.map = toRows(G);
  return res;
}

// 第2層のエリアの仕上げ：つながり・到着地点・上層への門・下層への門・亀裂・群れ
function finishArea(g, rnd, S, opt) {
  const rows = g.length, cols = g[0].length;
  g[S[0]][S[1]] = 'S';
  // 上層への門は到着地点の隣
  for (const [dr, dc] of DIRS) { const r = S[0] + dr, c = S[1] + dc; if (g[r]?.[c] === '.') { g[r][c] = 'U'; break; } }
  keepConnected(g, S);
  const d = distances(g, S);
  if (opt.nextFar && !opt.noNext) {
    // いちばん遠い所に下層への門
    let best = null, bd = -1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] === '.' && d[r][c] > bd) { bd = d[r][c]; best = [r, c]; }
    g[best[0]][best[1]] = 'N';
  }
  const regions = makeGrid(rows, cols, null);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] !== '#') regions[r][c] = 'main';
  // 亀裂の候補（到着地点から離れた所）
  for (const [r, c] of scatter(g, rnd, opt.rifts ?? 0, 10, (r, c) => d[r][c] > 20)) g[r][c] = 'R';
  // 魔物の群れ
  const prefer = opt.clear ? opt.clear.filter(([r, c]) => d[r][c] > 10) : [];
  const groups = [...prefer.slice(0, opt.groups)];
  for (const p of scatter(g, rnd, opt.groups, opt.groupGap ?? 7, (r, c) => d[r][c] > 12)) {
    if (groups.length >= opt.groups) break;
    if (groups.every(q => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) >= 5)) groups.push(p);
  }
  for (const [r, c] of groups) if (g[r][c] === '.') g[r][c] = 'm';
  return { map: toRows(g), regions, arrivals: {}, prevCells: {} };
}

// ====================================================================== 第3層：巡礼者の道
// 10 以上のフィールドからなる広い 1 つの階層。中心の尖塔（第4層への門）を魔女の森が囲み、その外側にフィールドが並ぶ。
// 第2層のどのエリアから来ても合流し、到着地点だけが来たエリアの方角で変わる（東 21・南 22・西 23・北 24）
export const PILGRIM_FIELDS = {
  witch: '魔女の森', hill: '鋼岩の丘', orc: 'オークの群落地', swamp: '緑尾の湿地', statue: '石像の遺跡',
  road_w: '巡礼者の街道', plain_nw: '霧の平原', battle_ne: '古戦場', valley_se: '枯れ谷', grass_sw: '風の草原', gate_n: '北の巡礼門',
};
export function pilgrimRoad(seed) {
  const rnd = seededRandom(seed);
  const N = 81, C = 40;
  const g = makeGrid(N, N, '.');
  for (let i = 0; i < N; i++) { g[0][i] = g[N - 1][i] = g[i][0] = g[i][N - 1] = '#'; }
  const regions = makeGrid(N, N, null);
  // フィールドの割り当て：中心から 13 マス以内は魔女の森。その外は方角で分ける
  const sector = (r, c) => {
    const dr = r - C, dc = c - C;
    if (Math.hypot(dr, dc) <= 13) return 'witch';
    const a = (Math.atan2(dr, dc) * 180 / Math.PI + 360) % 360;   // 0 = 東、90 = 南、180 = 西、270 = 北
    if (a < 22.5 || a >= 337.5) return 'orc';
    if (a < 67.5) return 'valley_se';
    if (a < 112.5) return 'swamp';
    if (a < 157.5) return 'statue';
    if (a < 202.5) return 'road_w';
    if (a < 247.5) return 'plain_nw';
    if (a < 292.5) return Math.hypot(dr, dc) > 30 ? 'gate_n' : 'hill';
    return 'battle_ne';
  };
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) regions[r][c] = sector(r, c);
  // 南西の端は風の草原（湿地と石像の遺跡のあいだ）
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) if (r > 58 && c < 22) regions[r][c] = 'grass_sw';
  // 地形：フィールドごとに木・岩・残骸を置く
  const density = { witch: 0.22, hill: 0.05, orc: 0.04, swamp: 0.08, statue: 0.07, road_w: 0.03, plain_nw: 0.04, battle_ne: 0.06, valley_se: 0.06, grass_sw: 0.03, gate_n: 0.04 };
  for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
    const reg = regions[r][c];
    if (rnd() < density[reg]) g[r][c] = 'P';
  }
  // 岩山・崖（丘と谷）
  for (let i = 0; i < 40; i++) {
    const r = 3 + Math.floor(rnd() * (N - 6)), c = 3 + Math.floor(rnd() * (N - 6));
    if (regions[r][c] === 'witch' || Math.hypot(r - C, c - C) < 16) continue;
    const rad = 1 + Math.floor(rnd() * 2);
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) if (g[r + dr]?.[c + dc] === '.' || g[r + dr]?.[c + dc] === 'P') g[r + dr][c + dc] = '#';
  }
  // 中心へ向かう 4 本の道（障害物を取り除く）
  for (let k = 1; k < N - 1; k++) for (const [r, c] of [[C, k], [k, C]]) for (const o of [-1, 0, 1]) {
    const rr = r === C ? C + o : r, cc = c === C ? C + o : c;
    if (g[rr][cc] !== '#' || Math.abs(rr - C) + Math.abs(cc - C) > 3) g[rr][cc] = '.';
  }
  // 中心の尖塔の広場と第4層への門
  for (let r = C - 2; r <= C + 2; r++) for (let c = C - 2; c <= C + 2; c++) g[r][c] = '.';
  for (const [r, c] of [[C - 1, C - 1], [C - 1, C + 1], [C + 1, C - 1], [C + 1, C + 1]]) g[r][c] = '#';   // 尖塔の土台
  g[C][C] = 'N';
  // 到着地点と、来たエリアへ戻る門
  const arrivals = { 21: [C, N - 4], 22: [N - 4, C], 23: [C, 3], 24: [3, C] };
  const prevCells = { 21: [C + 2, N - 3], 22: [N - 3, C + 2], 23: [C + 2, 2], 24: [2, C + 2] };
  for (const [r, c] of [...Object.values(arrivals), ...Object.values(prevCells)]) {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (g[r + dr]?.[c + dc] && r + dr > 0 && c + dc > 0 && r + dr < N - 1 && c + dc < N - 1) g[r + dr][c + dc] = '.';
  }
  keepConnected(g, arrivals[22]);
  // 魔物の群れ：フィールドごと（オークの群落地は特に多い）
  const counts = { witch: 6, hill: 2, orc: 6, swamp: 2, statue: 2, road_w: 2, plain_nw: 2, battle_ne: 2, valley_se: 2, grass_sw: 1, gate_n: 1 };
  const nearArrival = (r, c) => Object.values(arrivals).some(([ar, ac]) => Math.abs(ar - r) + Math.abs(ac - c) < 10);
  for (const [reg, n] of Object.entries(counts)) {
    for (const [r, c] of scatter(g, rnd, n, 6, (r, c) => regions[r][c] === reg && !nearArrival(r, c) && Math.abs(r - C) + Math.abs(c - C) > 4)) g[r][c] = 'm';
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (g[r][c] === '#') regions[r][c] = null;
  return { map: toRows(g), regions, arrivals, prevCells };
}

export const GENERATORS = { crystalCave, canyon, deadland, desert, forest, pilgrimRoad };

"""第1層のマップを作る（結果を web/data.js の FLOORS[0].map に貼り付ける）。

  * 十字形の階層。外周の 1 マス幅の回廊は「暗黒地帯」（ライトクリスタルがなく、先が見えない）
  * 内側は迷路（ところどころ回り道ができるよう、少しだけ壁を抜く）
  * 中央に明るい広場（到着地点 S。クリスタルの群れ）
  * 最も北の外周の切れ込みに下層への門（N）
  * C はライトクリスタルのあるマス（床・壁・天井のどこかに付く。通り抜けられる）
  * g / w は魔物の出現地点

python3 tools/gen_floor1.py            # マップを表示
python3 tools/gen_floor1.py --seed 7   # 別の配置
"""
import random
import sys

W, H = 35, 47
CENTER = (24, 17)        # 中央広場の中心（行, 列）
NOTCH = (1, 17)          # 下層への門


def in_mask(r, c):
    vertical = 2 <= r <= 44 and 9 <= c <= 25
    horizontal = 16 <= r <= 30 and 1 <= c <= 33
    return vertical or horizontal


def main(seed=11):
    rnd = random.Random(seed)
    g = [['#'] * W for _ in range(H)]
    mask = {(r, c) for r in range(H) for c in range(W) if in_mask(r, c)}
    ring = {(r, c) for (r, c) in mask
            if any((r + dr, c + dc) not in mask for dr in (-1, 0, 1) for dc in (-1, 0, 1))}
    inner = mask - ring
    for r, c in ring:
        g[r][c] = '.'

    # 迷路（行が偶数・列が奇数のマスを節点にした穴掘り法。外周とのあいだには 1 マスの壁が残る）
    nodes = [(r, c) for (r, c) in inner if r % 2 == 0 and c % 2 == 1]
    node_set = set(nodes)
    seen = set()
    start = CENTER
    stack = [start]
    seen.add(start)
    g[start[0]][start[1]] = '.'
    while stack:
        r, c = stack[-1]
        nbrs = [(r + dr, c + dc, r + dr // 2, c + dc // 2) for dr, dc in ((-2, 0), (2, 0), (0, -2), (0, 2))]
        nbrs = [n for n in nbrs if (n[0], n[1]) in node_set and (n[0], n[1]) not in seen and (n[2], n[3]) in inner]
        if not nbrs:
            stack.pop()
            continue
        nr, nc, mr, mc = rnd.choice(nbrs)
        g[mr][mc] = '.'
        g[nr][nc] = '.'
        seen.add((nr, nc))
        stack.append((nr, nc))

    # 回り道：壁を少し抜く
    for (r, c) in inner:
        if g[r][c] != '#':
            continue
        horiz = (r, c - 1) in node_set and (r, c + 1) in node_set
        vert = (r - 1, c) in node_set and (r + 1, c) in node_set
        if (horiz or vert) and rnd.random() < 0.09:
            g[r][c] = '.'

    # 迷路と外周（暗黒地帯）をところどころつなぐ
    for (r, c) in inner:
        if (r, c) not in node_set:
            continue
        # 外周との間に 1 マスだけ壁があるとき、その壁を掘る
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            mid = (r + dr, c + dc)
            far = (r + 2 * dr, c + 2 * dc)
            if mid in inner and g[mid[0]][mid[1]] == '#' and far in ring and rnd.random() < 0.22:
                g[mid[0]][mid[1]] = '.'

    # 中央広場
    cr, cc = CENTER
    for r in range(cr - 2, cr + 3):
        for c in range(cc - 2, cc + 3):
            g[r][c] = '.'
    g[cr][cc] = 'S'

    # 門：最も北の外周の切れ込み
    g[NOTCH[0]][NOTCH[1]] = 'N'

    # 歩けるマス（外周も）がすべてつながっているか確認
    floor = {(r, c) for r in range(H) for c in range(W) if g[r][c] != '#'}
    stack, reach = [CENTER], {CENTER}
    while stack:
        r, c = stack.pop()
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            n = (r + dr, c + dc)
            if n in floor and n not in reach:
                reach.add(n)
                stack.append(n)
    assert reach == floor, f'つながっていないマスがある: {len(floor - reach)}'

    # ライトクリスタル：迷路の床に、互いに 3 マス以上離して置く（外周＝暗黒地帯には置かない）
    maze_floor = [p for p in floor if p in inner]
    rnd.shuffle(maze_floor)
    crystals = [(cr - 2, cc - 2), (cr - 2, cc + 2), (cr + 2, cc - 2), (cr + 2, cc + 2)]
    for p in maze_floor:
        if abs(p[0] - cr) <= 2 and abs(p[1] - cc) <= 2:
            continue
        if all(max(abs(p[0] - q[0]), abs(p[1] - q[1])) >= 3 for q in crystals):
            crystals.append(p)
    for r, c in crystals:
        g[r][c] = 'C'

    # 魔物：広場から離れた場所に。暗黒地帯にも少し
    def far_from_center(p, d):
        return abs(p[0] - cr) + abs(p[1] - cc) >= d
    cands = [p for p in maze_floor if g[p[0]][p[1]] == '.' and far_from_center(p, 7)]
    rnd.shuffle(cands)
    placed = []
    for kind, n in (('g', 12), ('w', 6)):
        for p in cands:
            if n == 0:
                break
            if g[p[0]][p[1]] != '.' or any(abs(p[0] - q[0]) + abs(p[1] - q[1]) < 5 for q in placed):
                continue
            g[p[0]][p[1]] = kind
            placed.append(p)
            n -= 1
    ring_cands = [p for p in ring if g[p[0]][p[1]] == '.' and far_from_center(p, 10)]
    rnd.shuffle(ring_cands)
    for p in ring_cands[:3]:
        g[p[0]][p[1]] = 'w'

    return [''.join(row) for row in g]


if __name__ == '__main__':
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 11
    rows = main(seed)
    for row in rows:
        print(f"      '{row}',")

"""Blender (bpy) でゲーム用の 3D モデルを組み立て、glTF に書き出すための部品集。

Blender の GUI を使わず、Python から形・マテリアルを作って書き出す。
使い方の例は example_build.py を参照。

座標系:
  * Blender は Z-up。glTF に書き出すと Y-up に変換される（gx = bx, gy = bz, gz = -by）
  * to_gltf() / Builder.colliders_gltf() でゲーム側（three.js など）の座標に変換できる
  * Builder の UV はメートル単位（1 m = UV 1.0）。pbr_mat はテクスチャの実寸で割って繰り返す
"""
import json
import math
import os

import bpy  # bmesh より先に読み込む必要がある
import bmesh
from mathutils import Matrix, Vector

IDENT = Matrix.Identity(4)


# =====================================================================
# 変換
# =====================================================================
def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def Ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def to_gltf(v):
    """Blender (Z-up) 座標 → glTF (Y-up) 座標。"""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def catenary(a, b, sag, n=14):
    """2 点間のたるんだ線（電線・ロープなど）の点列。"""
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


# =====================================================================
# マテリアル
# =====================================================================
_MATS = {}
_IMAGES = {}


def _image(path):
    if path not in _IMAGES:
        _IMAGES[path] = bpy.data.images.load(path)
    return _IMAGES[path]


def mat(name, color=(0.8, 0.8, 0.8), rough=0.75, metal=0.0, image=None,
        emission=None, strength=1.0, double=False, emit_image=False):
    """単色、または画像 1 枚のマテリアル（同じ名前なら使い回す）。

    image      … ベースカラーの画像パス（看板など）
    emit_image … 画像を発光にも使う（内照式の看板・窓の明かりなど）
    double     … 両面表示（旗・布など薄いもの）
    """
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = _image(image)
        tex.location = (-400, 200)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if emit_image:
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = strength
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission[:3], 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.use_backface_culling = not double
    _MATS[name] = m
    return m


def _occlusion_group():
    """glTF 書き出しで occlusionTexture を出すためのノードグループ。"""
    name = "glTF Material Output"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    g.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    g.nodes.new("NodeGroupInput")
    return g


def pbr_mat(name, paths, size_m, metal=None):
    """写真ベースの PBR マテリアル（カラー・法線・ARM＝AO/粗さ/金属）。

    paths  … {"diff": ..., "nor_gl": ..., "arm": ...}（fetch_textures.texture_paths の戻り値）
    size_m … テクスチャ 1 枚が表す実寸 (m)。UV はメートル単位なので、これで割って繰り返す
    metal  … 金属度を固定値にする（None なら ARM の B チャンネルを使う）
    """
    if name in _MATS:
        return _MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    uv = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (1 / size_m, 1 / size_m, 1)
    nt.links.new(uv.outputs["UV"], mapping.inputs["Vector"])

    def tex(path, non_color):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = _image(path)
        if non_color:
            n.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mapping.outputs["Vector"], n.inputs["Vector"])
        return n

    diff = tex(paths["diff"], False)
    nt.links.new(diff.outputs["Color"], bsdf.inputs["Base Color"])
    nor = tex(paths["nor_gl"], True)
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nor.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    arm = tex(paths["arm"], True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(arm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    if metal is None:
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = metal
    occ = nt.nodes.new("ShaderNodeGroup")
    occ.node_tree = _occlusion_group()
    nt.links.new(sep.outputs["Red"], occ.inputs["Occlusion"])
    m.use_backface_culling = True
    _MATS[name] = m
    return m


# =====================================================================
# メッシュビルダー
# =====================================================================
class Builder:
    """1 つのオブジェクト（モジュール）分のジオメトリを 1 つの bmesh に積み上げる。

    形を足すたびにオブジェクトを作らないので速く、書き出しも 1 メッシュにまとまる。
    当たり判定の箱 (collider) と「調べる」対象 (interact) も一緒に記録できる。
    """

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []
        self.colliders = []      # Blender 座標の (min, max)
        self.interactables = []  # dict（座標は glTF 座標）

    def mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def quad(self, pts, uvs, m, M=IDENT, smooth=False):
        vs = [self.bm.verts.new(M @ Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(m)
        f.smooth = smooth
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    def tri(self, pts, m, M=IDENT):
        vs = [self.bm.verts.new(M @ Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(m)
        for loop, uv in zip(f.loops, [(0, 0), (1, 0), (0.5, 1)]):
            loop[self.uv].uv = uv

    def box(self, mn, mx, m, M=IDENT, uv_scale=1.0, overrides=None, skip=(), collide=False):
        """軸平行ボックス（ローカル座標 mn〜mx）を M で変換して追加。

        overrides: {"-Y": material} … その面だけ別マテリアル＋0〜1 の UV（看板の文字面など）
        skip: 生成しない面（"+X" "-X" "+Y" "-Y" "+Z" "-Z"）
        """
        x0, y0, z0 = mn
        x1, y1, z1 = mx
        s = 1.0 / uv_scale
        faces = {
            "+X": ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], lambda p: (p[1] * s, p[2] * s)),
            "-X": ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], lambda p: (-p[1] * s, p[2] * s)),
            "+Y": ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], lambda p: (-p[0] * s, p[2] * s)),
            "-Y": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], lambda p: (p[0] * s, p[2] * s)),
            "+Z": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], lambda p: (p[0] * s, p[1] * s)),
            "-Z": ([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], lambda p: (p[0] * s, -p[1] * s)),
        }
        unit = [(0, 0), (1, 0), (1, 1), (0, 1)]
        overrides = overrides or {}
        for key, (pts, uvf) in faces.items():
            if key in skip:
                continue
            if key in overrides:
                self.quad(pts, unit, overrides[key], M)
            else:
                self.quad(pts, [uvf(p) for p in pts], m, M)
        if collide:
            self.collider(mn, mx, M)

    def cylinder(self, cx, cy, z0, z1, r, m, M=IDENT, n=12, smooth=True, collide=False):
        """Z 軸方向の円柱。横向きにするときは M に回転を入れる。"""
        M2 = M @ T(cx, cy, 0)
        ring0 = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        circ = 2 * math.pi * r
        for i in range(n):
            a, b = ring0[i], ring0[(i + 1) % n]
            u0, u1 = circ * i / n, circ * (i + 1) / n
            self.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)],
                      [(u0, z0), (u1, z0), (u1, z1), (u0, z1)], m, M2, smooth=smooth)
        top = [self.bm.verts.new(M2 @ Vector((p[0], p[1], z1))) for p in ring0]
        f = self.bm.faces.new(top)
        f.material_index = self.mi(m)
        for loop, p in zip(f.loops, ring0):
            loop[self.uv].uv = (p[0], p[1])
        bot = [self.bm.verts.new(M2 @ Vector((p[0], p[1], z0))) for p in reversed(ring0)]
        f = self.bm.faces.new(bot)
        f.material_index = self.mi(m)
        if collide:
            self.collider((cx - r, cy - r, z0), (cx + r, cy + r, z1), M)

    def ring(self, R, r_in, t, m, M=IDENT, n=16):
        """車輪などのリング。ローカル Z 軸まわり、厚み 2t。"""
        def p(rad, a, z):
            return (rad * math.cos(a), rad * math.sin(a), z)
        uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            self.quad([p(R, a0, -t), p(R, a1, -t), p(R, a1, t), p(R, a0, t)], uv, m, M, smooth=True)
            self.quad([p(r_in, a1, -t), p(r_in, a0, -t), p(r_in, a0, t), p(r_in, a1, t)], uv, m, M, smooth=True)
            self.quad([p(r_in, a0, t), p(R, a0, t), p(R, a1, t), p(r_in, a1, t)], uv, m, M)
            self.quad([p(r_in, a1, -t), p(R, a1, -t), p(R, a0, -t), p(r_in, a0, -t)], uv, m, M)

    def tube(self, points, r, m, M=IDENT):
        """折れ線に沿った細い四角柱（電線・ロープ・パイプなど）。catenary() と組み合わせる。"""
        pts = [Vector(p) for p in points]
        for a, b in zip(pts, pts[1:]):
            d = b - a
            if d.length < 1e-6:
                continue
            d.normalize()
            u = d.cross(Vector((0, 0, 1)))
            if u.length < 1e-3:
                u = Vector((1, 0, 0))
            u.normalize()
            v = d.cross(u).normalized()
            ring = [u * r, v * r, -u * r, -v * r]
            for i in range(4):
                o0, o1 = ring[i], ring[(i + 1) % 4]
                self.quad([a + o0, b + o0, b + o1, a + o1], [(0, 0), (1, 0), (1, 1), (0, 1)], m, M)

    def blob(self, cx, cy, cz, r, m, M=IDENT, sx=1.0, sy=1.0, sz=1.0, subdivisions=2):
        """植栽などの丸い塊（icosphere）。"""
        mtx = M @ T(cx, cy, cz) @ Matrix.Diagonal((sx, sy, sz, 1.0))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=r, matrix=mtx, calc_uvs=False)
        idx = self.mi(m)
        for f in {f for v in res["verts"] for f in v.link_faces}:
            f.material_index = idx
            f.smooth = True

    # ------------------------------------------------------------ ゲーム用の情報
    def collider(self, mn, mx, M=IDENT):
        """当たり判定の箱（M で変換した後の軸平行バウンディングボックス）を記録する。"""
        corners = [M @ Vector((x, y, z)) for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
        self.colliders.append(([min(c[i] for c in corners) for i in range(3)],
                               [max(c[i] for c in corners) for i in range(3)]))

    def colliders_gltf(self):
        """当たり判定を glTF 座標の [minX, minY, minZ, maxX, maxY, maxZ] のリストで返す。"""
        return [to_gltf(lo)[:2] + [round(-hi[1], 3)] + to_gltf(hi)[:2] + [round(-lo[1], 3)]
                for lo, hi in self.colliders]

    def interact(self, kind, ident, name, pos, facing, **extra):
        """「調べる」対象を記録する（pos / facing は Blender 座標で渡す）。"""
        d = {"id": ident, "type": kind, "name": name, "pos": to_gltf(pos), "facing": to_gltf(facing)}
        d.update(extra)
        self.interactables.append(d)

    def transform_all(self, M):
        """組み上げた後で、ジオメトリ・当たり判定・調べる対象をまとめて M で変換する。"""
        bmesh.ops.transform(self.bm, matrix=M, verts=list(self.bm.verts))
        if M.determinant() < 0:
            bmesh.ops.reverse_faces(self.bm, faces=list(self.bm.faces))
        old, self.colliders = self.colliders, []
        for lo, hi in old:
            self.collider(lo, hi, M)
        R = M.to_3x3()
        for it in self.interactables:
            p = Vector((it["pos"][0], -it["pos"][2], it["pos"][1]))
            f = Vector((it["facing"][0], -it["facing"][2], it["facing"][1]))
            it["pos"] = to_gltf(M @ p)
            it["facing"] = to_gltf((R @ f).normalized())

    def finish(self, collection=None):
        """bmesh をメッシュオブジェクトにしてシーンに置く。"""
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        (collection or bpy.context.scene.collection).objects.link(obj)
        return obj


# =====================================================================
# シーンと書き出し
# =====================================================================
def reset_scene():
    """空のシーンから始める。"""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _MATS.clear()
    _IMAGES.clear()


def export_gltf(obj, path, texture_dir="textures"):
    """選んだオブジェクトを .gltf + .bin で書き出す。

    テクスチャは texture_dir（.gltf からの相対パス）に置かれ、同じフォルダに書き出す
    モデル同士で共有される（何度も同じ画像を埋め込まない）。
    """
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLTF_SEPARATE",
        export_texture_dir=texture_dir,
        export_keep_originals=False,
        export_jpeg_quality=88,
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
    )


def compress_png_textures(model_dir, texture_dir="textures"):
    """Blender が PNG で書き出したテクスチャを JPEG にして軽くする（透過を使わない前提）。"""
    from PIL import Image
    tex_dir = os.path.join(model_dir, texture_dir)
    renamed = {}
    for fn in os.listdir(tex_dir):
        if fn.endswith(".png"):
            src = os.path.join(tex_dir, fn)
            dst = fn[:-4] + ".jpg"
            Image.open(src).convert("RGB").save(os.path.join(tex_dir, dst), quality=90 if "_arm_" in fn else 85)
            os.remove(src)
            renamed[f"{texture_dir}/{fn}"] = f"{texture_dir}/{dst}"
    for fn in os.listdir(model_dir):
        if not fn.endswith(".gltf"):
            continue
        path = os.path.join(model_dir, fn)
        with open(path, encoding="utf-8") as f:
            g = json.load(f)
        for img in g.get("images", []):
            if img.get("uri") in renamed:
                img["uri"] = renamed[img["uri"]]
                img["mimeType"] = "image/jpeg"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(g, f, ensure_ascii=False, separators=(",", ":"))


def save_blend(path):
    """Blender で開ける編集用ファイルを保存する（テクスチャ同梱）。"""
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=True)

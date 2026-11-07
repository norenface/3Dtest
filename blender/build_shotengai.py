"""ひかり通り商店街を Blender (bpy) で生成し、区画ごとに glTF で書き出す。

使い方:
    python3 blender/build_shotengai.py

出力:
    assets/models/<MODULE>.glb      … A〜G の各区画と、出口 (exit.glb / exit_locked.glb)
    assets/models/manifest.json     … 長さ・当たり判定・店舗/調べられる場所の情報
    assets/textures/*.png           … 生成したテクスチャ
    blender/shotengai.blend         … 全区画を並べた編集用ファイル（テクスチャ同梱）

各区画は x=0 から始まり +X 方向に length だけ伸びる。
通りはループし、最後の区画の先は最初の区画につながる（突き当たりは存在しない）。
ゲーム側は区画を好きな順番・個数で X 方向に並べ、その並びを繰り返すだけで通りを組める。
条件を満たしたら、最後の区画の先に出口モジュール (EXIT) をつなげてループを解く。
"""
import json
import math
import os
import random
import sys
import zlib

import bpy  # bmesh より先に読み込む必要がある
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import fetch_textures as PH  # noqa: E402
import street_data as SD  # noqa: E402
from textures import TextureFactory  # noqa: E402

ROOT = os.path.dirname(HERE)
MODEL_DIR = os.path.join(ROOT, "assets", "models")
TEX_DIR = os.path.join(ROOT, "assets", "textures")
BLEND_PATH = os.path.join(HERE, "shotengai.blend")

HW = SD.STREET_HALF_WIDTH
D = SD.BUILDING_DEPTH
GF = SD.GROUND_FLOOR_H
UF = SD.UPPER_FLOOR_H
L = SD.SECTION_LENGTH

IDENT = Matrix.Identity(4)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def Ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def to_gltf(v):
    """Blender (Z-up) 座標 → glTF (Y-up) 座標。"""
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


# =====================================================================
# マテリアル
# =====================================================================
TEX = None
_MATS = {}
_IMAGES = {}


def _image(path):
    if path not in _IMAGES:
        img = bpy.data.images.load(path)
        _IMAGES[path] = img
    return _IMAGES[path]


def mat(name, color=(0.8, 0.8, 0.8), rough=0.75, metal=0.0, image=None,
        emission=None, strength=1.0, double=False, emit_image=False):
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


def pbr_mat(name, key, metal=None, rough_mult=1.0, tint=None):
    """Poly Haven のテクスチャ（カラー・法線・ARM）を使った PBR マテリアル。

    ジオメトリの UV はメートル単位なので、テクスチャの実寸で割って繰り返す。
    """
    if name in _MATS:
        return _MATS[name]
    asset, res = PH.TEXTURES[key]
    paths, _ = PH.texture_paths(asset, res)
    size_m = PH.info(asset)["dimensions"][0] / 1000.0
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


def wall_mat(i):
    return pbr_mat(f"wall_{i}", f"wall_{i}", metal=0.0)


def base_materials():
    t = TEX
    return {
        "paving": pbr_mat("paving", "paving", metal=0.0),
        "paving_center": pbr_mat("paving_center", "paving_center", metal=0.0),
        "gutter": pbr_mat("gutter", "gutter"),
        "concrete": pbr_mat("concrete", "concrete", metal=0.0),
        "asphalt": pbr_mat("asphalt", "asphalt", metal=0.0),
        "white_line": mat("white_line", (0.92, 0.92, 0.9), rough=0.8),
        "cornice": mat("cornice", (0.55, 0.55, 0.55), rough=0.7),
        "band": mat("band", (0.30, 0.30, 0.32), rough=0.6),
        "frame_dark": mat("frame_dark", (0.12, 0.12, 0.13), rough=0.4, metal=0.6),
        "alu": mat("alu", (0.72, 0.73, 0.75), rough=0.35, metal=0.8),
        "glass": mat("glass", (0.16, 0.21, 0.26), rough=0.06, metal=0.15),
        "glass_curtain": mat("glass_curtain", (0.55, 0.52, 0.46), rough=0.35,
                             emission=(0.8, 0.75, 0.6), strength=0.04),
        # ショーウィンドウは斜めから見ると空の下半分（何もない）を映して壁のように見えるので、映り込みを弱める
        "shop_glass": [mat(f"shop_glass_{i}", image=t[f"interior_{i}"], rough=0.6,
                           emit_image=True, strength=0.12) for i in range(3)],
        "door_glass": mat("door_glass", (0.30, 0.34, 0.36), rough=0.45, metal=0.0),
        "plinth": mat("plinth", (0.28, 0.27, 0.26), rough=0.7),
        "shutter": pbr_mat("shutter", "shutter"),
        "shutter_case": mat("shutter_case", (0.55, 0.56, 0.58), rough=0.5, metal=0.5),
        "fascia_old": mat("fascia_old", (0.70, 0.68, 0.62), rough=0.9),
        "tenant": mat("tenant", image=t["tenant_wanted"], rough=0.9),
        "metal_dark": mat("metal_dark", (0.16, 0.17, 0.18), rough=0.45, metal=0.7),
        "metal_grey": mat("metal_grey", (0.45, 0.46, 0.48), rough=0.4, metal=0.7),
        "lamp_light": mat("lamp_light", (1, 0.95, 0.85), emission=(1.0, 0.93, 0.8), strength=3.0),
        "wood": pbr_mat("wood", "wood", metal=0.0),
        "wood_light": pbr_mat("wood_light", "wood_light", metal=0.0),
        "plant": mat("plant", (0.20, 0.42, 0.18), rough=0.9),
        "plant_dark": mat("plant_dark", (0.12, 0.30, 0.12), rough=0.9),
        "soil": mat("soil", (0.25, 0.18, 0.12), rough=1.0),
        "trunk": mat("trunk", (0.33, 0.24, 0.17), rough=0.9),
        "red": mat("post_red", (0.78, 0.08, 0.08), rough=0.4),
        "bin_blue": mat("bin_blue", (0.15, 0.35, 0.65), rough=0.5),
        "bin_green": mat("bin_green", (0.20, 0.50, 0.30), rough=0.5),
        "rubber": mat("rubber", (0.05, 0.05, 0.05), rough=0.9),
        "brass": mat("brass", (0.80, 0.62, 0.25), rough=0.3, metal=1.0),
        "gate_blue": mat("gate_blue", (0.12, 0.25, 0.45), rough=0.5, metal=0.3),
        "bike_red": mat("bike_red", (0.70, 0.12, 0.10), rough=0.4, metal=0.5),
        "bike_blue": mat("bike_blue", (0.15, 0.30, 0.60), rough=0.4, metal=0.5),
        "crate": mat("crate", (0.60, 0.45, 0.28), rough=0.9),
        "black": mat("black", (0.03, 0.03, 0.03), rough=0.6),
        "ac_body": mat("ac_body", (0.82, 0.82, 0.80), rough=0.5),
        "pole_concrete": mat("pole_concrete", (0.62, 0.61, 0.58), rough=0.85),
        "tiger": mat("tiger", image=t["tiger"], rough=0.7),
        "wire": mat("wire", (0.05, 0.05, 0.05), rough=0.6),
        "insulator": mat("insulator", (0.85, 0.85, 0.82), rough=0.3),
        "transformer": mat("transformer", (0.55, 0.58, 0.58), rough=0.5, metal=0.3),
        "bulb": mat("bulb", (1.0, 0.9, 0.6), emission=(1.0, 0.85, 0.5), strength=4.0),
        "arch_red": mat("arch_red", (0.45, 0.07, 0.07), rough=0.55),
        "pot": mat("pot", (0.55, 0.30, 0.18), rough=0.8),
        "crate_yellow": mat("crate_yellow", (0.90, 0.70, 0.10), rough=0.6),
        "crate_red": mat("crate_red", (0.75, 0.12, 0.10), rough=0.6),
        "cardboard": mat("cardboard", (0.62, 0.48, 0.30), rough=0.9),
        "nobori_pole": mat("nobori_pole", (0.85, 0.85, 0.85), rough=0.4, metal=0.5),
        "pennants": [mat(f"pennant_{i}", c, rough=0.8, double=True) for i, c in enumerate(
            [(0.85, 0.12, 0.12), (0.95, 0.80, 0.10), (0.10, 0.35, 0.75), (0.15, 0.60, 0.25), (0.95, 0.95, 0.92)])],
        "ac_front": mat("ac_front", image=t["ac_front"], rough=0.5),
        "pipe": mat("pipe", (0.78, 0.77, 0.74), rough=0.45),
    }


GOODS_COLORS = {
    "青果": [(0.85, 0.15, 0.10), (0.95, 0.60, 0.10), (0.30, 0.65, 0.20), (0.90, 0.85, 0.20)],
    "花": [(0.95, 0.40, 0.60), (0.95, 0.90, 0.30), (0.70, 0.30, 0.80), (0.95, 0.95, 0.95)],
    "鮮魚": [(0.75, 0.80, 0.85), (0.85, 0.40, 0.35), (0.95, 0.95, 0.98), (0.50, 0.60, 0.70)],
    "酒": [(0.15, 0.40, 0.20), (0.50, 0.25, 0.10), (0.85, 0.85, 0.80), (0.10, 0.10, 0.30)],
    "default": [(0.60, 0.50, 0.40), (0.40, 0.40, 0.45), (0.70, 0.60, 0.30), (0.30, 0.40, 0.35)],
}


# =====================================================================
# メッシュビルダー
# =====================================================================
class Builder:
    """1 モジュール分のジオメトリを 1 つの bmesh に積み上げる。"""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []
        self.colliders = []      # Blender 座標の (min, max)
        self.interactables = []  # dict

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

    def box(self, mn, mx, m, M=IDENT, uv_scale=1.0, overrides=None,
            skip=(), collide=False):
        """軸平行ボックス（ローカル座標）を M で変換して追加。

        overrides: {"-Y": material} … その面だけ別マテリアル＋0〜1 の UV
        skip: 生成しない面
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

    def collider(self, mn, mx, M=IDENT):
        corners = [M @ Vector((x, y, z)) for x in (mn[0], mx[0])
                   for y in (mn[1], mx[1]) for z in (mn[2], mx[2])]
        lo = [min(c[i] for c in corners) for i in range(3)]
        hi = [max(c[i] for c in corners) for i in range(3)]
        self.colliders.append((lo, hi))

    def cylinder(self, cx, cy, z0, z1, r, m, M=IDENT, n=12, smooth=True, collide=False):
        M2 = M @ T(cx, cy, 0)
        ring0 = [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        circ = 2 * math.pi * r
        for i in range(n):
            a, b = ring0[i], ring0[(i + 1) % n]
            u0, u1 = circ * i / n, circ * (i + 1) / n
            self.quad([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)],
                      [(u0, z0), (u1, z0), (u1, z1), (u0, z1)], m, M2, smooth=smooth)
        # 上下のふた
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
        """車輪などのリング。ローカル Z 軸まわり、厚み t。"""
        def p(rad, a, z):
            return (rad * math.cos(a), rad * math.sin(a), z)
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            uv = [(0, 0), (1, 0), (1, 1), (0, 1)]
            self.quad([p(R, a0, -t), p(R, a1, -t), p(R, a1, t), p(R, a0, t)], uv, m, M, smooth=True)
            self.quad([p(r_in, a1, -t), p(r_in, a0, -t), p(r_in, a0, t), p(r_in, a1, t)], uv, m, M, smooth=True)
            self.quad([p(r_in, a0, t), p(R, a0, t), p(R, a1, t), p(r_in, a1, t)], uv, m, M)
            self.quad([p(r_in, a1, -t), p(R, a1, -t), p(R, a0, -t), p(r_in, a0, -t)], uv, m, M)

    def tri(self, pts, m, M=IDENT):
        vs = [self.bm.verts.new(M @ Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        f.material_index = self.mi(m)
        for loop, uv in zip(f.loops, [(0, 0), (1, 0), (0.5, 1)]):
            loop[self.uv].uv = uv

    def tube(self, points, r, m, M=IDENT):
        """折れ線に沿った細い四角柱（電線など）。"""
        pts = [Vector(p) for p in points]
        for a, b in zip(pts, pts[1:]):
            d = (b - a)
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

    def blob(self, cx, cy, cz, r, m, M=IDENT, sx=1.0, sy=1.0, sz=1.0):
        """植栽などの丸い塊（icosphere）。"""
        mtx = M @ T(cx, cy, cz) @ Matrix.Diagonal((sx, sy, sz, 1.0))
        res = bmesh.ops.create_icosphere(self.bm, subdivisions=2, radius=r, matrix=mtx, calc_uvs=False)
        faces = {f for v in res["verts"] for f in v.link_faces}
        idx = self.mi(m)
        for f in faces:
            f.material_index = idx
            f.smooth = True

    def interact(self, kind, ident, name, pos, facing, **extra):
        d = {"id": ident, "type": kind, "name": name, "pos": pos, "facing": facing}
        d.update(extra)
        self.interactables.append(d)

    def transform_all(self, M):
        """組み上げた後でジオメトリ・当たり判定・調べる対象をまとめて M で変換する。"""
        bmesh.ops.transform(self.bm, matrix=M, verts=list(self.bm.verts))
        if M.determinant() < 0:
            bmesh.ops.reverse_faces(self.bm, faces=list(self.bm.faces))
        old = self.colliders
        self.colliders = []
        for lo, hi in old:
            self.collider(lo, hi, M)
        R = M.to_3x3()
        for it in self.interactables:
            # pos / facing は glTF 座標なので Blender 座標に戻して変換する
            p = Vector((it["pos"][0], -it["pos"][2], it["pos"][1]))
            f = Vector((it["facing"][0], -it["facing"][2], it["facing"][1]))
            it["pos"] = to_gltf(M @ p)
            it["facing"] = to_gltf((R @ f).normalized())

    def finish(self, collection):
        mesh = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for m in self.mats:
            mesh.materials.append(m)
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        return obj


# =====================================================================
# 建物・店舗
# =====================================================================
def add_window(b, M, cx, z0, ww, wh, glass, mats):
    """ローカル正面 (-Y 向き) に窓を 1 つ付ける。"""
    b.box((cx - ww / 2 - 0.08, -0.04, z0 - 0.08), (cx + ww / 2 + 0.08, 0, z0 + wh + 0.08), mats["alu"], M)
    b.box((cx - ww / 2, -0.06, z0), (cx + ww / 2, -0.02, z0 + wh), glass, M)
    b.box((cx - ww / 2 - 0.12, -0.15, z0 - 0.14), (cx + ww / 2 + 0.12, 0, z0 - 0.08), mats["cornice"], M)


def add_ac_unit(b, M, cx, z0, mats):
    """壁に付いたエアコン室外機（ローカル正面 -Y）。"""
    b.box((cx - 0.36, -0.34, z0), (cx + 0.36, -0.06, z0 + 0.52), mats["ac_body"], M,
          overrides={"-Y": mats["ac_front"]})
    for xx in (cx - 0.3, cx + 0.3):
        b.box((xx - 0.015, -0.36, z0 - 0.05), (xx + 0.015, 0, z0), mats["metal_grey"], M)
    b.cylinder(cx + 0.28, -0.04, z0 + 0.1, z0 + 0.9, 0.025, mats["ac_body"], M, n=6)


def _pick(lst, key, salt=""):
    return lst[zlib.crc32((key + salt).encode()) % len(lst)]


def add_vertical_sign(b, M, x, z0, depth, height, sign_mat, bg_mat, mats, thick=0.18):
    """壁から突き出した袖看板（両面）。x は看板の中心。"""
    b.box((x - thick / 2, -0.15 - depth, z0), (x + thick / 2, -0.15, z0 + height), bg_mat, M,
          overrides={"+X": sign_mat, "-X": sign_mat})
    for zz in (z0 + 0.15, z0 + height - 0.25):
        b.box((x - 0.04, -0.15, zz), (x + 0.04, 0, zz + 0.07), mats["metal_dark"], M)


def add_nobori(b, M, x, y, key, text, mats):
    """のぼり旗。旗は通りを歩く人に見えるよう X 方向に面を向ける。"""
    top, body = text
    bg, fg = _pick([((0.85, 0.15, 0.12), (1, 1, 1)), ((0.95, 0.80, 0.10), (0.6, 0.05, 0.05)),
                    ((0.10, 0.30, 0.65), (1, 1, 1)), ((0.15, 0.50, 0.25), (1, 1, 1)),
                    ((0.98, 0.97, 0.92), (0.75, 0.10, 0.10))], key)
    fm = mat("nobori_" + key, image=TEX_F.nobori(key, body, bg, fg, top), rough=0.85, double=True)
    b.cylinder(x, y, 0, 2.75, 0.018, mats["nobori_pole"], M, n=6)
    b.cylinder(x, y, 0, 0.12, 0.13, mats["concrete"], M, n=10)
    b.box((x - 0.01, y - 0.5, 2.62), (x + 0.01, y, 2.64), mats["nobori_pole"], M)
    b.box((x - 0.006, y - 0.48, 0.95), (x + 0.006, y - 0.02, 2.6), fm, M, overrides={"+X": fm, "-X": fm})
    b.collider((x - 0.15, y - 0.15, 0), (x + 0.15, y + 0.15, 2.7), M)


def add_stand_sign(b, M, x, y, key, kind, mats):
    title, lines = SD.STAND_SIGNS.get(kind, SD.STAND_SIGNS["default"])
    bg, fg = _pick([((0.12, 0.12, 0.12), (1, 1, 1)), ((0.15, 0.25, 0.15), (1, 1, 0.9)),
                    ((0.95, 0.93, 0.85), (0.5, 0.1, 0.1))], key)
    sm = mat("stand_" + key, image=TEX_F.stand_sign(key, title, lines, bg, fg), rough=0.7)
    # A 型（両面）：X 方向に面を向けた細い箱
    b.box((x - 0.12, y - 0.22, 0.05), (x + 0.12, y + 0.22, 0.85), mats["wood"], M,
          overrides={"+X": sm, "-X": sm})
    b.collider((x - 0.18, y - 0.26, 0), (x + 0.18, y + 0.26, 0.9), M)


def build_shop(b, M, w, shop, rng, key, mats, depth=D, floors=None, wall=None, avoid=()):
    """店舗 1 軒。ローカル座標では x=0..w、正面が y=0 で -Y 側を向き、建物は +Y 側へ伸びる。

    shop = (店名 or None, 業種, 看板色, 文字色, 店先陳列)
    戻り値: 店舗情報 dict
    """
    name, kind, bg, fg, display = shop
    is_open = name is not None
    if floors is None:
        floors = rng.choice([2, 2, 3, 3, 4])
    H = GF + UF * (floors - 1) + 0.5
    if wall is None:
        wall = wall_mat(rng.randrange(len(SD.WALL_COLORS)))
    c = w / 2

    # 本体
    b.box((0, 0, 0), (w, depth, H), wall, M)
    b.collider((0, -0.25, 0), (w, depth, H), M)
    # 屋上の縁・階の帯
    b.box((-0.02, -0.15, H - 0.25), (w + 0.02, 0, H + 0.05), mats["cornice"], M)
    b.box((0, -0.08, GF - 0.1), (w, 0, GF + 0.05), mats["band"], M)

    # 上階の窓
    n_win = max(1, int(w / 2.6))
    sp = w / n_win
    ww = min(1.5, sp - 0.9)
    for f in range(1, floors):
        z0 = GF + (f - 1) * UF + 0.85
        for i in range(n_win):
            g = mats["glass_curtain"] if rng.random() < 0.3 else mats["glass"]
            add_window(b, M, sp * (i + 0.5), z0, ww, 1.4, g, mats)

    # 生活感のある設備（エアコン室外機・雨どい）。既存の乱数列を変えないよう別の乱数を使う
    drng = random.Random(zlib.crc32(key.encode()))
    info_tenant = None
    gap = sp - ww - 0.16
    for f in range(1, floors):
        z0 = GF + (f - 1) * UF + 0.85
        for i in range(n_win):
            if gap < 0.8 or drng.random() > 0.35:
                continue
            cx = sp * (i + 1) if i < n_win - 1 else min(w - 0.45, sp * (i + 0.5) + ww / 2 + 0.5)
            if cx + 0.36 > w - 0.05 or cx > w - 1.0 or cx < 1.0:
                continue
            add_ac_unit(b, M, cx, z0 + 0.05, mats)
    if drng.random() < 0.6:
        px = 0.12 if drng.random() < 0.5 else w - 0.12
        b.cylinder(px, -0.1, 0.05, H - 0.15, 0.045, mats["pipe"], M, n=8)
        b.box((px - 0.07, -0.2, H - 0.3), (px + 0.07, 0, H - 0.12), mats["pipe"], M)
        for zz in range(1, int(H / 1.5)):
            b.box((px - 0.06, -0.1, zz * 1.5), (px + 0.06, 0, zz * 1.5 + 0.03), mats["metal_grey"], M)

    # 屋上の設備（室外機・給水タンク）
    if rng.random() < 0.6:
        rx = rng.uniform(0.8, max(0.9, w - 2.0))
        ry = rng.uniform(2.0, depth - 2.0) if depth > 4.5 else depth / 2
        if rng.random() < 0.5:
            b.box((rx, ry, H), (rx + 1.0, ry + 0.5, H + 0.75), mats["shutter_case"], M)
        else:
            b.cylinder(rx + 0.6, ry, H, H + 1.6, 0.6, mats["metal_grey"], M)

    info = {"name": name or "空き店舗", "kind": kind, "open": is_open, "width": w}

    b.box((0, -0.1, 0), (w, 0, 0.25), mats["plinth"], M)
    if is_open:
        sign_key = key
        serif = kind in SD.SERIF_KINDS
        sub = _pick(SD.FASCIA_SUB, key, "sub") if drng.random() < 0.6 else None
        sign_mat = mat("sign_" + key, image=TEX_F.fascia_sign(key, name, bg, fg, w - 0.2, serif=serif, sub=sub,
                                                              age=drng.uniform(0.35, 0.8)), rough=0.6)
        bg_mat = mat("signbg_" + key, bg, rough=0.6)
        # ショーウィンドウ
        b.box((0.15, -0.06, 0.25), (w - 0.15, 0, 2.7), mats["frame_dark"], M)
        b.box((0.3, -0.09, 0.3), (w - 0.3, -0.06, 2.6), rng.choice(mats["shop_glass"]), M, uv_scale=3.0)
        x = 0.3 + 1.5
        while x < w - 0.4:
            if abs(x - c) > 0.75:
                b.box((x - 0.03, -0.11, 0.3), (x + 0.03, -0.09, 2.6), mats["frame_dark"], M)
            x += 1.5
        # 入口ドア
        b.box((c - 0.6, -0.13, 0.0), (c + 0.6, -0.09, 2.45), mats["frame_dark"], M)
        b.box((c - 0.5, -0.14, 0.1), (c + 0.5, -0.13, 2.35), mats["door_glass"], M)
        b.box((c + 0.28, -0.2, 0.95), (c + 0.33, -0.14, 1.35), mats["alu"], M)
        # 正面看板
        b.box((0.1, -0.3, 2.75), (w - 0.1, 0, 3.45), bg_mat, M, overrides={"-Y": sign_mat})
        # テント
        if rng.random() < 0.5:
            aw = mat("awning_" + key, image=TEX_F.awning(key, bg), rough=0.8, double=True)
            Ma = M @ T(0, 0, 2.7) @ Rx(15)
            b.box((0.2, -1.3, -0.03), (w - 0.2, 0, 0), aw, Ma, uv_scale=2.0)
            b.box((0.2, -1.33, -0.28), (w - 0.2, -1.3, 0), aw, Ma, uv_scale=2.0)
        # 店先の陳列台
        if display:
            cols = GOODS_COLORS.get(kind, GOODS_COLORS["default"])
            for xa, xb in ((0.4, c - 0.9), (c + 0.9, w - 0.4)):
                if xb - xa < 1.0:
                    continue
                b.box((xa, -1.1, 0), (xb, -0.2, 0.75), mats["wood"], M, collide=True)
                gx = xa + 0.05
                while gx + 0.3 < xb:
                    for gy in (-1.0, -0.62):
                        ci = rng.randrange(len(cols))
                        gm = mat(f"goods_{kind}_{ci}", cols[ci], rough=0.6)
                        b.box((gx, gy, 0.75), (gx + 0.3, gy + 0.32, 0.75 + rng.uniform(0.1, 0.22)), gm, M)
                    gx += 0.36
        # 袖看板（ほぼ全店。大きさはいろいろ、一部は内照式）
        rng.random()  # 既存の乱数列を保つための空読み
        if floors >= 2 and drng.random() < 0.9:
            vdepth = drng.uniform(0.6, 1.0)
            vheight = min(drng.uniform(1.6, 2.8), H - GF - 0.6)
            vs = mat("vsign_" + key, image=TEX_F.vertical_sign(key, name.split(" ")[-1], bg, fg, vdepth, vheight,
                                                               serif=serif, age=drng.uniform(0.3, 0.8)),
                     rough=0.6, emit_image=drng.random() < 0.35, strength=0.5)
            add_vertical_sign(b, M, w - 0.35, GF + 0.15, vdepth, vheight, vs, bg_mat, mats)
        # のぼり旗
        texts = SD.NOBORI.get(kind, SD.NOBORI["default"])
        for i, nx in enumerate((1.05, w - 1.05)):
            if abs(nx - c) < 1.2 or drng.random() < 0.3 or _near(M, nx, -1.45, avoid):
                continue
            add_nobori(b, M, nx, -1.45, f"{key}-{i}", texts[(i + zlib.crc32(key.encode())) % len(texts)], mats)
        # 置き看板・鉢植え・ケース
        sx = c + 1.1 if drng.random() < 0.5 else c - 1.1
        sy = -1.7 if display else -0.75
        if drng.random() < 0.55 and 0.4 < sx < w - 0.4 and not _near(M, sx, sy, avoid):
            add_stand_sign(b, M, sx, sy, key, kind, mats)
        if not display:
            for px in (c - 0.95, c + 0.95):
                if drng.random() < 0.4 and abs(px - sx) > 0.5 and not _near(M, px, -0.3, avoid):
                    b.cylinder(px, -0.3, 0, 0.32, 0.17, mats["pot"], M, n=10, collide=True)
                    b.blob(px, -0.3, 0.55, 0.28, mats["plant"] if drng.random() < 0.5 else mats["plant_dark"], M, sz=1.2)
        if kind in ("酒", "居酒屋", "中華", "ラーメン") and not _near(M, w - 0.5, -0.4, avoid):
            cm = mats["crate_yellow"] if kind == "酒" else mats["crate_red"]
            for k in range(drng.randint(2, 4)):
                z = k * 0.3
                b.box((w - 0.75, -0.62, z), (w - 0.3, -0.25, z + 0.29), cm, M)
            b.collider((w - 0.8, -0.65, 0), (w - 0.25, -0.2, 1.2), M)
        info["sign_texture"] = "sign_" + sign_key + ".png"
    else:
        # 空き店舗：シャッター
        b.box((0.15, -0.08, 0.0), (w - 0.15, 0, 2.75), mats["shutter"], M)
        b.box((0.1, -0.25, 2.75), (w - 0.1, 0, 3.1), mats["shutter_case"], M)
        b.box((0.1, -0.2, 3.1), (w - 0.1, 0, 3.5), mats["fascia_old"], M)
        b.box((c - 0.3, -0.09, 1.1), (c + 0.3, -0.081, 1.95), mats["shutter"], M,
              overrides={"-Y": mats["tenant"]})
        if drng.random() < 0.6 and not _near(M, 0.8, -0.4, avoid):
            for k, (dx, dz) in enumerate(((0, 0), (0.5, 0), (0.2, 0.4))):
                b.box((0.5 + dx, -0.6, dz), (0.95 + dx, -0.2, dz + 0.38), mats["cardboard"], M)
            b.collider((0.45, -0.65, 0), (1.5, -0.15, 0.8), M)

    # 上の階のテナント（袖看板と壁面看板）
    if floors >= 2 and drng.random() < 0.7:
        tname, tbg, tfg = _pick(SD.UPPER_TENANTS, key, "tenant")
        fl = f"{drng.randint(2, floors)}F"
        tdepth = drng.uniform(0.55, 0.8)
        z0 = GF + 0.25 if not is_open else GF + 0.9
        theight = min(drng.uniform(2.0, 3.4), H - z0 - 0.3)
        if theight > 1.2:
            tv = mat("vsign_t_" + key, image=TEX_F.vertical_sign("t_" + key, tname.split(" ")[-1], tbg, tfg, tdepth,
                                                                theight, top=fl, age=drng.uniform(0.4, 0.9)),
                     rough=0.6, emit_image=drng.random() < 0.4, strength=0.45)
            add_vertical_sign(b, M, 0.35, z0, tdepth, theight, tv, mat(f"tbg_{key}", tbg, rough=0.6), mats, thick=0.15)
        if drng.random() < 0.6 and w > 4.5:
            pm = mat("tenant_" + key, image=TEX_F.tenant_panel(key, fl, tname, tbg, tfg, w - 1.4), rough=0.6)
            b.box((0.8, -0.06, GF + 0.12), (w - 0.6, -0.01, GF + 0.68), mat(f"tbg_{key}", tbg, rough=0.6), M,
                  overrides={"-Y": pm})
        info_tenant = tname
    else:
        info_tenant = None

    door = M @ Vector((c, -0.7, 0))
    face = (M.to_3x3() @ Vector((0, -1, 0))).normalized()
    if info_tenant:
        info["upperTenant"] = info_tenant
    info["door"] = to_gltf(door)
    info["facing"] = to_gltf(face)
    info["floors"] = floors
    return info


def _near(M, lx, ly, avoid, r=0.75):
    """店舗ローカル座標 (lx, ly) が、避けたい場所（街灯・電柱など。区画座標）に近いか。"""
    p = M @ Vector((lx, ly, 0))
    return any((p.x - ax) ** 2 + (p.y - ay) ** 2 < r * r for ax, ay in avoid)


def side_matrix(side, x0, w):
    """店舗ローカル座標 → 区画座標。north: y=+HW に正面、south: y=-HW に正面。"""
    if side == "north":
        return T(x0, HW, 0)
    return T(x0 + w, -HW, 0) @ Rz(180)


# =====================================================================
# 通りの設備
# =====================================================================
def build_paving(b, x0, x1, mats):
    b.box((x0, -HW, -0.2), (x1, HW, 0), mats["paving"], skip=("-Z",))
    b.box((x0, -0.9, -0.2), (x1, 0.9, 0.004), mats["paving_center"], skip=("-Z",))
    for s in (1, -1):
        y0, y1 = sorted((s * HW, s * (HW - 0.22)))
        b.box((x0, y0, -0.2), (x1, y1, 0.003), mats["gutter"], skip=("-Z",))


def build_lamp(b, x, side, banner_mat, mats):
    ys = side * 3.95
    d = -side  # 通りの中心方向
    b.cylinder(x, ys, 0, 0.4, 0.14, mats["metal_dark"], collide=False)
    b.cylinder(x, ys, 0, 5.45, 0.07, mats["metal_dark"])
    b.collider((x - 0.18, ys - 0.18, 0), (x + 0.18, ys + 0.18, 5.4))

    def yr(a, bb):
        return sorted((ys + d * a, ys + d * bb))
    y0, y1 = yr(0, 0.9)
    b.box((x - 0.04, y0, 5.3), (x + 0.04, y1, 5.38), mats["metal_dark"])
    y0, y1 = yr(0.7, 1.2)
    b.box((x - 0.26, y0, 5.2), (x + 0.26, y1, 5.42), mats["metal_dark"])
    y0, y1 = yr(0.75, 1.15)
    b.box((x - 0.21, y0, 5.17), (x + 0.21, y1, 5.2), mats["lamp_light"])
    # フラッグ
    for zz in (2.92, 4.36):
        y0, y1 = yr(0, 0.66)
        b.box((x - 0.02, y0, zz), (x + 0.02, y1, zz + 0.04), mats["metal_dark"])
    y0, y1 = yr(0.08, 0.63)
    b.box((x - 0.012, y0, 2.95), (x + 0.012, y1, 4.36), banner_mat,
          overrides={"+X": banner_mat, "-X": banner_mat})


# =====================================================================
# 電柱・電線・アーチ・万国旗
# =====================================================================
POLE_Y = HW - 0.35          # 電柱は北側の建物の際に立てる
POLE_H = 10.6
# 電線の高さと、電柱からの通り側への張り出し
WIRE_LINES = [  # (z, 張り出し, 半径, たるみ)
    (9.45, 0.30, 0.011, 0.35), (9.45, 0.85, 0.011, 0.35), (9.45, 1.40, 0.011, 0.35),
    (8.60, 0.30, 0.011, 0.40), (8.60, 0.85, 0.011, 0.40), (8.60, 1.40, 0.011, 0.40),
    (6.30, 0.25, 0.028, 0.55), (5.90, 0.35, 0.018, 0.60),
]


def catenary(a, b, sag, n=14):
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


def wire_anchor(x, line):
    z, off, _, _ = line
    return (x, POLE_Y - off, z)


def build_pole(b, x, mats, ad=None, transformer=False, ident=None):
    """コンクリート電柱（腕金・がいし・トラ柄・電柱広告・変圧器つき）。"""
    y = POLE_Y
    n = 12
    # 先細りの柱（2 段の円柱で近似）
    b.cylinder(x, y, 0, POLE_H * 0.5, 0.17, mats["pole_concrete"], n=n)
    b.cylinder(x, y, POLE_H * 0.5, POLE_H, 0.13, mats["pole_concrete"], n=n)
    b.cylinder(x, y, 0, 1.8, 0.185, mats["tiger"], n=n, smooth=False)
    b.collider((x - 0.22, y - 0.22, 0), (x + 0.22, y + 0.22, POLE_H))
    # 腕金とがいし
    for z in (9.35, 8.5):
        b.box((x - 0.05, y - 1.6, z - 0.04), (x + 0.05, y + 0.1, z + 0.04), mats["metal_grey"])
        for off in (0.30, 0.85, 1.40):
            b.cylinder(x, y - off, z + 0.04, z + 0.12, 0.035, mats["insulator"], n=8)
    # 通信線の支持金具・足場ボルト
    for z in (6.3, 5.9):
        b.box((x - 0.03, y - 0.4, z - 0.03), (x + 0.03, y, z + 0.03), mats["metal_dark"])
    for i in range(10):
        z = 2.4 + i * 0.45
        sgn = 1 if i % 2 else -1
        b.box((x + sgn * 0.13, y - 0.02, z), (x + sgn * 0.32, y + 0.02, z + 0.03), mats["metal_dark"])
    if transformer:
        b.cylinder(x, y - 0.45, 7.0, 8.0, 0.28, mats["transformer"], n=12)
        b.cylinder(x, y - 0.45, 8.0, 8.06, 0.30, mats["transformer"], n=12)
        b.box((x - 0.05, y - 0.2, 7.3), (x + 0.05, y, 7.4), mats["metal_grey"])
    if ad:
        aname, asub, abg, afg = ad
        key = f"{ident}"
        am = mat("polead_" + key, image=TEX_F.pole_ad(key, aname, asub, abg, afg), rough=0.7)
        # 通りを歩く人に見えるよう、柱の通り側に X 方向へ面を向けて付ける
        b.box((x - 0.012, y - 0.52, 2.0), (x + 0.012, y - 0.19, 3.4), mat(f"padbg_{key}", abg, rough=0.7),
              overrides={"+X": am, "-X": am})
        for z in (2.1, 3.25):
            b.box((x - 0.02, y - 0.22, z), (x + 0.02, y - 0.1, z + 0.04), mats["metal_grey"])
        b.interact("pole", ident, f"電柱の広告（{aname}）", to_gltf((x, y - 1.3, 0)), to_gltf((0, -1, 0)), ad=aname)


def build_wires(b, x0, x1, mats):
    for line in WIRE_LINES:
        _, _, r, sag = line
        b.tube(catenary(wire_anchor(x0, line), wire_anchor(x1, line), sag), r, mats["wire"])


def build_service_drops(b, x, rng, mats):
    """電柱から通りを横切って建物へ引き込む線。"""
    for _ in range(rng.randint(2, 3)):
        side = -1 if rng.random() < 0.75 else 1
        ex = x + rng.uniform(1.5, 4.5)
        ez = rng.uniform(5.2, 6.4)
        end = (ex, side * (HW - 0.02), ez)
        start = (x, POLE_Y - 0.3, rng.choice([6.3, 5.9]))
        b.tube(catenary(start, end, rng.uniform(0.25, 0.6), n=10), 0.012, mats["wire"])
        b.box((ex - 0.04, end[1] - side * 0.06, ez - 0.04), (ex + 0.04, end[1], ez + 0.04), mats["insulator"])


def build_bunting(b, x, rng, mats):
    """通りを横切る万国旗（三角の小旗）。"""
    pts = catenary((x, HW - 0.05, 5.1), (x, -HW + 0.05, 5.1), 0.55, n=24)
    b.tube(pts, 0.006, mats["wire"])
    cols = mats["pennants"]
    k = rng.randrange(len(cols))
    for a, c in zip(pts, pts[1:]):
        k = (k + 1) % len(cols)
        m = cols[k]
        top0, top1 = a, c
        tip = (a + c) / 2 - Vector((0, 0, 0.28))
        b.tri([top0, top1, tip], m)
        b.tri([top1, top0, tip], m)


def build_arch(b, x, mats):
    """商店街の入口アーチ（電球つき）。"""
    sign = mat("arch_sign", image=TEX_F.arch_sign(SD.STREET_NAME, SD.STREET_NAME_EN), rough=0.6,
               emit_image=True, strength=0.25)
    for s in (1, -1):
        b.cylinder(x, s * 4.15, 0, 7.7, 0.2, mats["arch_red"], n=14, collide=True)
        b.cylinder(x, s * 4.15, 0, 0.5, 0.3, mats["concrete"], n=14)
        b.cylinder(x, s * 4.15, 7.7, 7.9, 0.28, mats["brass"], n=14)
    b.box((x - 0.2, -4.45, 6.35), (x + 0.2, 4.45, 7.55), mats["arch_red"], overrides={"-X": sign, "+X": sign})
    b.box((x - 0.12, -1.3, 7.55), (x + 0.12, 1.3, 8.05), mats["arch_red"])
    b.cylinder(0, 0, -0.13, 0.13, 0.42, mats["brass"], M=T(x, 0, 8.25) @ Ry(90), n=20)
    # 電球（上下の縁、両面）
    for sx in (x - 0.215, x + 0.215):
        for z in (6.4, 7.5):
            yy = -4.3
            while yy <= 4.31:
                b.box((sx - 0.025, yy - 0.025, z - 0.025), (sx + 0.025, yy + 0.025, z + 0.025), mats["bulb"])
                yy += 0.36
    b.interact("arch", "A-arch", "商店街のアーチ", to_gltf((x + 1.0, 0, 0)), to_gltf((-1, 0, 0)))


def pole_positions(letter):
    """区画の始端 (x=0) と、北側の店の境目のうち真ん中に近い 1 か所。街灯から離す。"""
    xs, x = [], 0.0
    for w in SD.SECTION_LOTS[letter]["north"]:
        x += w
        if 0 < x < L and abs(x - 4) >= 2 and abs(x - 16) >= 2:
            xs.append(x)
    mid = min(xs, key=lambda v: abs(v - 12)) if xs else 12.0
    return [0.0, mid]


def wall_y(side, off0, off1):
    """建物正面から off0〜off1 [m] 通り側に出た範囲の y 区間。"""
    return sorted((side * (HW - off0), side * (HW - off1)))


def prop_vending(b, x, side, key, color, mats, ident):
    y0, y1 = wall_y(side, 0.02, 0.8)
    front = "-Y" if side > 0 else "+Y"
    vm = mat("vending_" + key, image=TEX_F.vending_front(key, color), rough=0.4)
    body = mat("vbody_" + key, color, rough=0.4)
    b.box((x - 0.5, y0, 0), (x + 0.5, y1, 1.83), body, overrides={front: vm}, collide=True)
    p = (x, side * (HW - 1.4), 0)
    b.interact("vending", ident, "自動販売機", to_gltf(p), to_gltf((0, -side, 0)))


def prop_bench(b, x, side, mats):
    yc = side * (HW - 1.05)
    b.box((x - 0.8, yc - 0.22, 0.42), (x + 0.8, yc + 0.22, 0.48), mats["wood_light"])
    for lx in (x - 0.65, x + 0.65):
        b.box((lx - 0.04, yc - 0.2, 0), (lx + 0.04, yc + 0.2, 0.42), mats["metal_dark"])
    b.collider((x - 0.8, yc - 0.25, 0), (x + 0.8, yc + 0.25, 0.5))


def prop_planter(b, x, side, mats, rng):
    yc = side * (HW - 0.55)
    b.box((x - 0.65, yc - 0.3, 0), (x + 0.65, yc + 0.3, 0.5), mats["concrete"], collide=True)
    b.box((x - 0.6, yc - 0.25, 0.5), (x + 0.6, yc + 0.25, 0.52), mats["soil"])
    for dx in (-0.4, 0, 0.4):
        b.blob(x + dx, yc, 0.7, 0.32, mats["plant"] if rng.random() < 0.6 else mats["plant_dark"],
               sz=0.8)


def prop_bins(b, x, side, mats):
    yc = side * (HW - 0.45)
    b.cylinder(x - 0.3, yc, 0, 0.95, 0.25, mats["bin_blue"], collide=True)
    b.cylinder(x + 0.3, yc, 0, 0.95, 0.25, mats["bin_green"], collide=True)


def prop_bikes(b, x, side, mats, rng):
    # 駐輪ラック
    y0, y1 = wall_y(side, 0.2, 1.9)
    b.box((x - 0.9, y0, 0), (x + 0.9, y1, 0.05), mats["metal_grey"])
    for i, bx in enumerate((x - 0.45, x + 0.45)):
        if rng.random() < 0.25:
            continue
        fm = mats["bike_red"] if (i + rng.randrange(2)) % 2 else mats["bike_blue"]
        for wy in (side * (HW - 0.55), side * (HW - 1.55)):
            Mw = T(bx, wy, 0.33) @ Ry(90)
            b.ring(0.33, 0.28, 0.022, mats["rubber"], Mw)
            b.cylinder(0, 0, -0.03, 0.03, 0.05, mats["metal_grey"], M=Mw, n=8)
        ya, yb = sorted((side * (HW - 0.55), side * (HW - 1.55)))
        b.box((bx - 0.02, ya, 0.5), (bx + 0.02, yb, 0.55), fm)
        b.box((bx - 0.02, ya + 0.3, 0.33), (bx + 0.02, yb - 0.3, 0.38), fm)
        b.box((bx - 0.1, ya + 0.35, 0.85), (bx + 0.1, ya + 0.6, 0.9), mats["black"])
        b.box((bx - 0.3, yb - 0.25, 0.95), (bx + 0.3, yb - 0.2, 0.98), mats["metal_dark"])
    b.collider((x - 0.9, y0, 0), (x + 0.9, y1, 1.0))


def prop_post_box(b, x, side, mats, ident):
    yc = side * (HW - 0.5)
    b.box((x - 0.15, yc - 0.15, 0), (x + 0.15, yc + 0.15, 0.6), mats["red"])
    b.box((x - 0.25, yc - 0.22, 0.6), (x + 0.25, yc + 0.22, 1.35), mats["red"], collide=True)
    sy0, sy1 = sorted((yc - side * 0.22, yc - side * 0.24))
    b.box((x - 0.15, sy0, 1.12), (x + 0.15, sy1, 1.16), mats["black"])
    b.interact("postbox", ident, "郵便ポスト", to_gltf((x, side * (HW - 1.3), 0)), to_gltf((0, -side, 0)))


def prop_notice(b, x, side, letter, theme, mats, ident):
    nm = mat("notice_" + letter, image=TEX_F.notice_board(letter, theme["color"], theme["label"]), rough=0.9)
    yc = side * (HW - 0.3)
    front = "-Y" if side > 0 else "+Y"
    for px in (x - 0.75, x + 0.75):
        b.box((px - 0.04, yc - 0.04, 0), (px + 0.04, yc + 0.04, 2.0), mats["metal_dark"])
    b.box((x - 0.8, yc - 0.05, 0.9), (x + 0.8, yc + 0.05, 1.9), mats["wood"], overrides={front: nm},
          collide=True)
    b.interact("notice", ident, f"{letter}区の掲示板", to_gltf((x, side * (HW - 1.2), 0)),
               to_gltf((0, -side, 0)))


def center_tree(b, x, mats, rng):
    b.cylinder(x, 0, 0, 0.45, 1.4, mats["concrete"], n=20, collide=True)
    b.cylinder(x, 0, 0.45, 0.5, 1.42, mats["wood_light"], n=20)
    b.cylinder(x, 0, 0.5, 0.55, 0.9, mats["soil"], n=16)
    b.cylinder(x, 0, 0.5, 3.6, 0.17, mats["trunk"], n=10)
    for i in range(6):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.3, 1.0)
        b.blob(x + math.cos(a) * rr, math.sin(a) * rr, rng.uniform(3.6, 4.8), rng.uniform(0.9, 1.3),
               mats["plant"] if i % 2 else mats["plant_dark"])


def floor_marker(b, x, letter, theme, mats):
    fm = mat("floor_" + letter, image=TEX_F.floor_marker(letter, theme["color"]), rough=0.8)
    x0, x1, y0, y1 = x, x + 1.6, -0.8, 0.8
    z = 0.012
    # 進行方向 (+X) に向かって読めるように UV を回す
    b.quad([(x0, y1, z), (x0, y0, z), (x1, y0, z), (x1, y1, z)], [(0, 0), (1, 0), (1, 1), (0, 1)], fm)


# =====================================================================
# モジュール
# =====================================================================
def build_section(letter, mats, collection):
    rng = random.Random(1000 + ord(letter))
    theme = SD.SECTION_THEMES[letter]
    feat = SD.SECTION_FEATURES[letter]
    b = Builder("Section_" + letter)
    build_paving(b, 0, L, mats)
    floor_marker(b, 0.5, letter, theme, mats)

    lamps = [(4.0, 1), (16.0, 1), (10.0, -1), (22.0, -1)]
    poles = pole_positions(letter)
    avoid = [(lx, s * 3.95) for lx, s in lamps] + [(px, POLE_Y) for px in poles]

    shops = []
    boundaries = {"north": [], "south": []}
    for side in ("north", "south"):
        x0 = 0.0
        lots = SD.SECTION_LOTS[letter][side]
        for li, w in enumerate(lots):
            shop = SD.SHOPS[letter][side][li]
            ident = f"{letter}-{side[0].upper()}{li + 1}"
            M = side_matrix(side, x0, w)
            info = build_shop(b, M, w, shop, rng, ident, mats, avoid=avoid)
            info.update({"id": ident, "side": side})
            shops.append(info)
            b.interact("shop" if info["open"] else "shutter", ident, info["name"],
                       info["door"], info["facing"], open=info["open"])
            x0 += w
            if 0 < x0 < L:
                boundaries[side].append(x0)
        assert abs(x0 - L) < 1e-6, (letter, side, x0)

    # 街灯とフラッグ
    banner = mat("banner_" + letter, image=TEX_F.banner(letter, theme["color"], theme["label"]),
                 rough=0.8, double=True)
    for lx, s in lamps:
        build_lamp(b, lx, s, banner, mats)

    # 電柱と電線（区画の終わりの線は次の区画の x=0 の電柱につながる）
    li = "ABCDEFG".index(letter)
    for i, px in enumerate(poles):
        build_pole(b, px, mats, ad=SD.POLE_ADS[(li * 2 + i) % len(SD.POLE_ADS)], transformer=(i == 1),
                   ident=f"{letter}-pole-{i}")
        build_service_drops(b, px, rng, mats)
    for xa, xb in zip(poles, poles[1:] + [L]):
        build_wires(b, xa, xb, mats)
    # 万国旗とアーチ
    for bx in (6.5, 18.5):
        build_bunting(b, bx, rng, mats)
    if letter == "A":
        build_arch(b, 1.6, mats)

    # 店の境目に小物を置く
    specials = []
    if feat["notice_board"]:
        specials.append("notice")
    if feat["post_box"]:
        specials.append("post")
    pool = ["vending", "bench", "planter", "bins", "bikes", "planter", "bench", None]
    for side_name, s in (("north", 1), ("south", -1)):
        for bx in boundaries[side_name]:
            if any(abs(bx - lx) < 1.7 and ls == s for lx, ls in lamps):
                continue
            if s == 1 and any(abs(bx - px) < 1.2 for px in poles):
                continue
            kind = specials.pop(0) if specials else rng.choice(pool)
            ident = f"{letter}-{side_name[0].upper()}-{kind}-{int(bx)}"
            if kind == "vending":
                prop_vending(b, bx, s, ident, rng.choice([(0.85, 0.1, 0.1), (0.1, 0.3, 0.7), (0.95, 0.95, 0.95)]),
                             mats, ident)
            elif kind == "bench":
                prop_bench(b, bx, s, mats)
            elif kind == "planter":
                prop_planter(b, bx, s, mats, rng)
            elif kind == "bins":
                prop_bins(b, bx, s, mats)
            elif kind == "bikes":
                prop_bikes(b, bx, s, mats, rng)
            elif kind == "post":
                prop_post_box(b, bx, s, mats, ident)
            elif kind == "notice":
                prop_notice(b, bx, s, letter, theme, mats, ident)

    if feat["center_tree"]:
        center_tree(b, 12.0, mats, rng)
    # マンホール
    for mx in (rng.uniform(5, 9), rng.uniform(15, 20)):
        b.cylinder(mx, rng.uniform(-2.8, 2.8), 0, 0.015, 0.32, mats["metal_dark"], n=16, smooth=False)

    obj = b.finish(collection)
    return obj, {
        "file": f"section_{letter}.glb",
        "kind": "section",
        "letter": letter,
        "label": theme["label"],
        "color": [round(c, 3) for c in theme["color"]],
        "length": L,
        "shops": shops,
    }, b


EXIT_LENGTH = 4.0
EXIT_LINE = 3.0  # 出口モジュール内で、この X を越えたら商店街の外に出た扱い


def build_exit(mats, collection, opened):
    """出口ゲート。最後の区画の先 (+X 側) につなげて使う。x=0 が商店街側、x>4 が外の道路。

    opened=True  … ゲートが開いていて外へ出られる（EXIT）
    opened=False … 南京錠で施錠されている（EXIT_LOCKED）
    いったん「x<0 が外」の向きで組み立て、最後に 180° 回して +X 側を外にする。
    """
    rng = random.Random(42)
    b = Builder("Exit" if opened else "ExitLocked")
    length = EXIT_LENGTH
    build_paving(b, 0, length, mats)
    # 両脇の角の建物。外側に向いた店構え
    for s, nm in ((1, ("ホットマート", "コンビニ", (0.1, 0.55, 0.35), (1, 1, 1), False)),
                  (-1, (None, "空き店舗", None, None, False))):
        if s > 0:
            M = T(0, HW + D, 0) @ Rz(-90)
        else:
            M = T(0, -HW, 0) @ Rz(-90)
        build_shop(b, M, D, nm, rng, f"EXIT-{'N' if s > 0 else 'S'}", mats, depth=length, floors=3)
    # 門柱と看板
    sign = mat("gate_sign", image=TEX_F.gate_sign(SD.STREET_NAME, SD.STREET_NAME_EN), rough=0.6)
    for s in (1, -1):
        b.box((1.75, s * 4.2 - 0.25, 0), (2.25, s * 4.2 + 0.25, 6.6), mats["gate_blue"], collide=True)
    b.box((1.7, -4.7, 5.6), (2.3, 4.7, 6.7), mats["gate_blue"], overrides={"-X": sign, "+X": sign})
    fx = 2.0
    if opened:
        # 蛇腹ゲートを両脇にたたんだ状態
        for s in (1, -1):
            y0, y1 = sorted((s * 3.35, s * 3.95))
            for zz in (0.06, 1.1, 2.15):
                b.box((fx - 0.05, y0, zz), (fx + 0.05, y1, zz + 0.07), mats["metal_dark"])
            y = y0 + 0.02
            while y <= y1:
                b.box((fx - 0.018, y - 0.018, 0), (fx + 0.018, y + 0.018, 2.25), mats["metal_dark"])
                y += 0.05
            b.collider((fx - 0.15, y0, 0), (fx + 0.15, y1, 2.3))
        exit_mat = mat("exit_sign", image=TEX_F.exit_sign(), rough=0.6, emit_image=True, strength=0.4)
        for s in (1, -1):
            b.box((2.26, s * 4.2 - 0.22, 2.2), (2.29, s * 4.2 + 0.22, 2.75), mats["white_line"],
                  overrides={"+X": exit_mat})
        b.interact("exit", "EXIT-gate", "出口ゲート", to_gltf((fx + 0.8, 0, 0)), to_gltf((-1, 0, 0)))
    else:
        # 施錠されたスライドゲート
        for zz in (0.06, 1.1, 2.15):
            b.box((fx - 0.05, -3.95, zz), (fx + 0.05, 3.95, zz + 0.07), mats["metal_dark"])
        y = -3.9
        while y <= 3.9:
            b.box((fx - 0.018, y - 0.018, 0), (fx + 0.018, y + 0.018, 2.25), mats["metal_dark"])
            y += 0.14
        b.box((fx - 0.06, -0.06, 0), (fx + 0.06, 0.06, 2.3), mats["metal_dark"])
        b.collider((fx - 0.15, -HW, 0), (fx + 0.15, HW, 3.5))
        # 南京錠と鎖
        b.box((fx + 0.07, -0.12, 1.0), (fx + 0.14, 0.12, 1.25), mats["brass"])
        b.box((fx + 0.06, -0.25, 1.17), (fx + 0.08, 0.25, 1.2), mats["metal_grey"])
        notice = mat("gate_notice", image=TEX_F.gate_notice(), rough=0.8)
        b.box((fx + 0.06, 1.0, 1.25), (fx + 0.08, 1.8, 1.77), mats["white_line"], overrides={"+X": notice})
        b.interact("gate", "EXIT-lock", "出口ゲートの南京錠", to_gltf((fx + 0.8, 0, 0)), to_gltf((-1, 0, 0)))

    # 外の道路と向かいの建物
    b.box((-14, -30, -0.3), (0, 30, -0.03), mats["asphalt"], skip=("-Z",))
    b.box((-0.4, -30, -0.3), (0, 30, 0.0), mats["concrete"], skip=("-Z",))
    for yy in range(-28, 30, 4):
        b.box((-7.1, yy, -0.03), (-6.9, yy + 2, -0.02), mats["white_line"])
    for yy in (-3.5, -2.5, -1.5, -0.5, 0.5, 1.5, 2.5):
        b.box((-13, yy, -0.03), (-1, yy + 0.5, -0.02), mats["white_line"])
    outside = [
        ("ホットマート", "コンビニ", (0.1, 0.55, 0.35), (1, 1, 1), False),
        ("ひかり信用金庫", "銀行", (0.15, 0.25, 0.5), (1, 1, 1), False),
        (None, "空き店舗", None, None, False),
        ("ファミリー歯科", "歯科", (0.9, 0.9, 0.95), (0.2, 0.4, 0.6), False),
    ]
    y0 = -24.0
    for i, shp in enumerate(outside):
        M = T(-14, y0, 0) @ Rz(90)
        build_shop(b, M, 12, shp, rng, f"OUT-{i}", mats, depth=8)
        y0 += 12
    # 外の道路の両端に見えない壁（道路からはみ出さないように）
    for s in (1, -1):
        y0, y1 = sorted((s * 24.0, s * 24.5))
        b.collider((-14, y0, 0), (0, y1, 5.0))

    # 商店街側 (x=0) が最後の区画につながるよう 180° 回す
    b.transform_all(T(length, 0, 0) @ Rz(180))
    # 最後の区画から来る電線を受ける電柱（回転後の座標で追加）
    build_pole(b, 0.0, mats)
    obj = b.finish(collection)
    key = "EXIT" if opened else "EXIT_LOCKED"
    return obj, {
        "file": "exit.glb" if opened else "exit_locked.glb",
        "kind": "exit",
        "opened": opened,
        "length": length,
        "label": "出口" if opened else "出口（施錠中）",
        "color": [0.2, 0.75, 0.45] if opened else [0.55, 0.55, 0.55],
        "inLoop": False,
        "escapeLineX": EXIT_LINE if opened else None,
        "note": "条件を満たしたときに最後の区画の先 (+X) につなげる。通常はループに含めない",
        "shops": [],
    }, b


# =====================================================================
# 書き出し
# =====================================================================
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export_gltf(obj, path):
    """.gltf + .bin で書き出す。テクスチャは assets/models/textures/ に共有で置く。"""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLTF_SEPARATE",
        export_texture_dir="textures",
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


def compress_arm_textures():
    """Blender が PNG で書き出したテクスチャ（ARM マップ・看板など）を JPEG にして軽くする。"""
    from PIL import Image
    tex_dir = os.path.join(MODEL_DIR, "textures")
    renamed = {}
    for fn in os.listdir(tex_dir):
        # 透過を使うテクスチャは無いので、PNG はすべて JPEG にする（看板の汚れ加工は PNG だと重い）
        if fn.endswith(".png"):
            src = os.path.join(tex_dir, fn)
            dst = fn[:-4] + ".jpg"
            Image.open(src).convert("RGB").save(os.path.join(tex_dir, dst), quality=90 if "_arm_" in fn else 85)
            os.remove(src)
            renamed["textures/" + fn] = "textures/" + dst
    for fn in os.listdir(MODEL_DIR):
        if not fn.endswith(".gltf"):
            continue
        path = os.path.join(MODEL_DIR, fn)
        with open(path, encoding="utf-8") as f:
            g = json.load(f)
        for img in g.get("images", []):
            if img.get("uri") in renamed:
                img["uri"] = renamed[img["uri"]]
                img["mimeType"] = "image/jpeg"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(g, f, ensure_ascii=False, separators=(",", ":"))


def setup_preview_scene(total_length):
    scn = bpy.context.scene
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.70, 0.90, 1)
    bg.inputs["Strength"].default_value = 0.9
    scn.world = world
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 3.5
    sun_data.angle = math.radians(2)
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scn.collection.objects.link(sun)
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = 24
    cam = bpy.data.objects.new("Camera", cam_data)
    cam.location = (5.0, -2.2, 1.65)
    cam.rotation_euler = (math.radians(88), 0, math.radians(-82))
    scn.collection.objects.link(cam)
    scn.camera = cam
    scn.unit_settings.system = "METRIC"


def main():
    global TEX, TEX_F
    reset_scene()
    os.makedirs(MODEL_DIR, exist_ok=True)
    if PH.missing():
        print("Poly Haven のテクスチャを取得します…")
        PH.main()
    TEX_F = TextureFactory(TEX_DIR)
    TEX = {
        **{f"interior_{i}": TEX_F.shop_interior(i) for i in range(3)},
        "tenant_wanted": TEX_F.tenant_wanted(),
        "ac_front": TEX_F.ac_front(),
        "tiger": TEX_F.tiger_stripe(),
    }
    mats = base_materials()

    manifest = {
        "name": SD.STREET_NAME,
        "units": "meters",
        "coordinateSystem": (
            "glTF Y-up。通りは +X 方向に伸び、各モジュールの原点はその始端（x=0）。"
            "z<0 が北側、z>0 が南側（Blender の +Y が glTF の -Z）。"
        ),
        "streetHalfWidth": HW,
        "buildingDepth": D,
        "sectionLength": L,
        # 通りはループする：最後の区画の先は最初の区画につながる（突き当たりは存在しない）
        "loop": True,
        "defaultLayout": list(SD.SECTION_ORDER),
        # 条件を満たすと、最後の区画の先がこの出口モジュールにつながる
        "exitModule": "EXIT",
        "exitLockedModule": "EXIT_LOCKED",
        "player": {"radius": 0.35, "eyeHeight": 1.6},
        "modules": {},
    }

    built = []
    for key, fn in [(l, (lambda l: lambda c: build_section(l, mats, c))(l)) for l in SD.SECTION_ORDER] + \
                   [("EXIT", lambda c: build_exit(mats, c, True)),
                    ("EXIT_LOCKED", lambda c: build_exit(mats, c, False))]:
        coll = bpy.data.collections.new(key)
        bpy.context.scene.collection.children.link(coll)
        obj, info, b = fn(coll)
        # [minX, minY, minZ, maxX, maxY, maxZ]（glTF 座標）
        info["colliders"] = [to_gltf(lo)[:2] + [round(-hi[1], 3)] + to_gltf(hi)[:2] + [round(-lo[1], 3)]
                             for lo, hi in b.colliders]
        info["interactables"] = b.interactables
        manifest["modules"][key] = info
        info["file"] = info["file"].replace(".glb", ".gltf")
        export_gltf(obj, os.path.join(MODEL_DIR, info["file"]))
        built.append((key, obj, info))
        print(f"built {key}: {len(obj.data.polygons)} faces, {len(info['colliders'])} colliders")

    compress_arm_textures()
    # 空と環境光の HDRI をビューア用にコピー
    import shutil
    env_dir = os.path.join(ROOT, "assets", "env")
    os.makedirs(env_dir, exist_ok=True)
    shutil.copyfile(PH.hdri_path(), os.path.join(env_dir, "sky_2k.hdr"))
    with open(os.path.join(MODEL_DIR, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    # .blend には A〜G を一列に並べ、G の先に「出口が開いた状態」をつなげる。
    # 施錠版は通りから離れた場所に単独で置く
    x = 0.0
    for key, obj, info in built:
        if key == "EXIT_LOCKED":
            obj.location = (0.0, -60.0, 0.0)
            continue
        obj.location.x = x
        if info["kind"] == "section":
            x += info["length"]
    setup_preview_scene(x)
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH, compress=True)
    print("loop length:", x)


TEX_F = None

if __name__ == "__main__":
    main()

"""bpy_kit の使い方の例：小さな舞台を作って glTF に書き出す。

    python3 blender/example_build.py

出力:
    assets/models/example.gltf (+ .bin, textures/)  … ゲームで読み込むモデル
    assets/models/example.json                      … 当たり判定と「調べる」対象
    blender/example.blend                           … Blender で開ける編集用ファイル（git 管理外）

新しいゲームでは、このファイルをコピーして中身を書き換えていく想定。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy_kit as K  # noqa: E402  (bpy を読み込む)
import fetch_textures as PH  # noqa: E402
import text_textures as TT  # noqa: E402

ROOT = os.path.dirname(HERE)
MODEL_DIR = os.path.join(ROOT, "assets", "models")
TEX_DIR = os.path.join(ROOT, "assets", "textures")   # 自分で作ったテクスチャの置き場


def main():
    K.reset_scene()

    # ---- マテリアル（Poly Haven の写真素材は初回だけダウンロードされる）
    floor = K.pbr_mat("floor", *PH.ensure_texture("concrete_wall_007", "1k"), metal=0.0)
    brick = K.pbr_mat("brick", *PH.ensure_texture("red_brick_03", "1k"), metal=0.0)
    wood = K.pbr_mat("wood", *PH.ensure_texture("wood_table_worn", "1k"), metal=0.0)
    dark = K.mat("dark_metal", (0.15, 0.15, 0.16), rough=0.4, metal=0.7)
    lamp = K.mat("lamp", (1, 0.95, 0.85), emission=(1, 0.9, 0.7), strength=3.0)
    sign_img = TT.sign(os.path.join(TEX_DIR, "sample_sign.png"), "サンプル商会", (0.1, 0.25, 0.45), (1, 1, 1),
                       width_m=3.0, height_m=0.6, serif=True, age=0.6)
    sign = K.mat("sample_sign", image=sign_img, rough=0.6)

    # ---- 形を組む（Blender 座標：Z が上、単位 m）
    b = K.Builder("Example")
    b.box((-5, -5, -0.2), (5, 5, 0), floor, skip=("-Z",))                     # 床 10m 四方
    b.box((-5, 4.5, 0), (5, 5, 4), brick, collide=True)                       # 奥の壁
    b.box((-1.5, 4.3, 2.6), (1.5, 4.5, 3.2), dark, overrides={"-Y": sign})    # 壁の看板（-Y 面に文字）
    b.box((-3.5, 1, 0), (-2.7, 1.8, 0.8), wood, collide=True)                 # 木箱
    b.interact("crate", "crate-1", "木箱", (-3.1, 0.6, 0), (0, -1, 0))
    for x in (-4.5, 4.5):                                                     # 柱 2 本と、たるんだ電線
        b.cylinder(x, 3.8, 0, 5.5, 0.12, dark, collide=True)
        b.box((x - 0.15, 3.6, 5.2), (x + 0.15, 3.9, 5.35), lamp)
    b.tube(K.catenary((-4.5, 3.8, 5.4), (4.5, 3.8, 5.4), sag=0.6), 0.012, dark)
    obj = b.finish()

    # ---- 書き出し
    K.export_gltf(obj, os.path.join(MODEL_DIR, "example.gltf"))
    K.compress_png_textures(MODEL_DIR)
    with open(os.path.join(MODEL_DIR, "example.json"), "w", encoding="utf-8") as f:
        json.dump({"colliders": b.colliders_gltf(), "interactables": b.interactables}, f, ensure_ascii=False, indent=1)
    K.save_blend(os.path.join(HERE, "example.blend"))
    print("ok:", os.path.join(MODEL_DIR, "example.gltf"), f"{len(b.colliders)} colliders")


if __name__ == "__main__":
    main()

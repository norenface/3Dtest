"""Poly Haven (CC0) から PBR テクスチャと HDRI をダウンロードする。

使い方:
    python3 blender/fetch_textures.py

ダウンロード先は blender/cache/polyhaven/（git 管理外）。
build_shotengai.py は足りないものがあれば自動でこのスクリプトを呼ぶ。
必要なホスト: api.polyhaven.com, dl.polyhaven.org
"""
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "polyhaven")
UA = {"User-Agent": "hikari-shotengai-builder"}

# 用途: (Poly Haven ID, 解像度)
TEXTURES = {
    "paving": ("concrete_pavers", "2k"),                # 通りの舗装（使い込まれたインターロッキング）
    "paving_center": ("brick_pavement_02", "2k"),       # 通り中央のくすんだレンガ
    "asphalt": ("asphalt_02", "1k"),                    # 外の道路
    "concrete": ("concrete_wall_007", "1k"),            # プランター・縁石など
    "shutter": ("painted_metal_shutter", "1k"),         # シャッター
    "wood": ("wood_table_worn", "1k"),                  # 陳列台
    "wood_light": ("fine_grained_wood", "1k"),          # ベンチ
    "gutter": ("metal_plate", "1k"),                    # 側溝のふた
    # 外壁（street_data.WALL_COLORS の順番に対応）
    "wall_0": ("beige_wall_001", "1k"),
    "wall_1": ("plaster_grey_04", "1k"),
    "wall_2": ("red_brick_03", "1k"),
    "wall_3": ("painted_plaster_wall", "1k"),
    "wall_4": ("exterior_wall_cladding_03", "1k"),
    "wall_5": ("rectangular_facade_tiles_02", "1k"),
    "wall_6": ("concrete_tile_facade", "1k"),
    "wall_7": ("white_plaster_02", "1k"),
}
HDRI = ("kloofendal_48d_partly_cloudy_puresky", "2k")
MAPS = {"diff": "Diffuse", "nor_gl": "nor_gl", "arm": "arm"}


def _get_json(url):
    return json.loads(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read())


def _download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def texture_paths(asset, res):
    d = os.path.join(CACHE, asset)
    return {m: os.path.join(d, f"{asset}_{m}_{res}.jpg") for m in MAPS}, os.path.join(d, "info.json")


def hdri_path():
    asset, res = HDRI
    return os.path.join(CACHE, "hdri", f"{asset}_{res}.hdr")


def missing():
    out = []
    for asset, res in TEXTURES.values():
        paths, info = texture_paths(asset, res)
        if not os.path.exists(info) or not all(os.path.exists(p) for p in paths.values()):
            out.append(asset)
    if not os.path.exists(hdri_path()):
        out.append(HDRI[0])
    return out


def fetch_texture(asset, res):
    paths, info_path = texture_paths(asset, res)
    os.makedirs(os.path.dirname(info_path), exist_ok=True)
    files = _get_json(f"https://api.polyhaven.com/files/{asset}")
    for m, key in MAPS.items():
        _download(files[key][res]["jpg"]["url"], paths[m])
    if not os.path.exists(info_path):
        info = _get_json(f"https://api.polyhaven.com/info/{asset}")
        keep = {k: info.get(k) for k in ("name", "dimensions", "authors")}
        keep["license"] = "CC0"
        keep["url"] = f"https://polyhaven.com/a/{asset}"
        with open(info_path, "w") as f:
            json.dump(keep, f, ensure_ascii=False, indent=1)
    return asset


def fetch_hdri():
    asset, res = HDRI
    path = hdri_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    files = _get_json(f"https://api.polyhaven.com/files/{asset}")
    _download(files["hdri"][res]["hdr"]["url"], path)
    return asset


def info(asset):
    with open(os.path.join(CACHE, asset, "info.json")) as f:
        return json.load(f)


def main():
    jobs = list(TEXTURES.values())
    with ThreadPoolExecutor(6) as ex:
        futs = [ex.submit(fetch_texture, a, r) for a, r in jobs] + [ex.submit(fetch_hdri)]
        for f in futs:
            print("ok", f.result())
    left = missing()
    if left:
        print("missing:", left)
        sys.exit(1)


if __name__ == "__main__":
    main()

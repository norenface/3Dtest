"""Poly Haven (CC0) から PBR テクスチャと HDRI をダウンロードする。

コマンドラインから:
    python3 blender/fetch_textures.py brick_wall_001            # 1k のテクスチャ
    python3 blender/fetch_textures.py brick_wall_001 2k
    python3 blender/fetch_textures.py --hdri kloofendal_48d_partly_cloudy_puresky 2k

Python から:
    import fetch_textures as PH
    paths, size_m = PH.ensure_texture("brick_wall_001", "1k")   # 無ければ取得
    hdr = PH.ensure_hdri("kloofendal_48d_partly_cloudy_puresky", "2k")

素材は https://polyhaven.com で探せる（ID は URL の最後の部分）。
ダウンロード先は blender/cache/polyhaven/（git 管理外）。
必要なホスト: api.polyhaven.com, dl.polyhaven.org
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "polyhaven")
UA = {"User-Agent": "bpy-game-kit"}   # 標準の Python の User-Agent は Poly Haven に拒否される
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


def texture_paths(asset, res="1k"):
    """{"diff", "nor_gl", "arm"} の各ファイルパスと info.json のパス。"""
    d = os.path.join(CACHE, asset)
    return {m: os.path.join(d, f"{asset}_{m}_{res}.jpg") for m in MAPS}, os.path.join(d, "info.json")


def info(asset):
    """素材の情報（名前・実寸 dimensions [mm]・作者・URL）。"""
    with open(os.path.join(CACHE, asset, "info.json")) as f:
        return json.load(f)


def fetch_texture(asset, res="1k"):
    paths, info_path = texture_paths(asset, res)
    os.makedirs(os.path.dirname(info_path), exist_ok=True)
    files = _get_json(f"https://api.polyhaven.com/files/{asset}")
    for m, key in MAPS.items():
        _download(files[key][res]["jpg"]["url"], paths[m])
    if not os.path.exists(info_path):
        i = _get_json(f"https://api.polyhaven.com/info/{asset}")
        keep = {k: i.get(k) for k in ("name", "dimensions", "authors")}
        keep["license"] = "CC0"
        keep["url"] = f"https://polyhaven.com/a/{asset}"
        with open(info_path, "w") as f:
            json.dump(keep, f, ensure_ascii=False, indent=1)
    return paths


def ensure_texture(asset, res="1k"):
    """無ければ取得して、(パスの dict, テクスチャ 1 枚の実寸 m) を返す。pbr_mat にそのまま渡せる。"""
    paths, info_path = texture_paths(asset, res)
    if not os.path.exists(info_path) or not all(os.path.exists(p) for p in paths.values()):
        fetch_texture(asset, res)
    dims = info(asset).get("dimensions") or [1000, 1000]
    return paths, dims[0] / 1000.0


def hdri_path(asset, res="2k"):
    return os.path.join(CACHE, "hdri", f"{asset}_{res}.hdr")


def ensure_hdri(asset, res="2k"):
    path = hdri_path(asset, res)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        files = _get_json(f"https://api.polyhaven.com/files/{asset}")
        _download(files["hdri"][res]["hdr"]["url"], path)
    return path


def main(argv):
    if not argv:
        print(__doc__)
        return
    if argv[0] == "--hdri":
        print(ensure_hdri(argv[1], argv[2] if len(argv) > 2 else "2k"))
    else:
        paths, size = ensure_texture(argv[0], argv[1] if len(argv) > 1 else "1k")
        print(f"ok ({size} m 四方):", *paths.values(), sep="\n  ")


if __name__ == "__main__":
    main(sys.argv[1:])

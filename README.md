# 3Dtest

Blender (Python / `bpy`) で 3D ゲーム用のモデルを組み立てて glTF に書き出すための土台です。
Blender の GUI は使わず、Python スクリプトで形・マテリアルを作ります。

## 構成

```
vendor/three/       … Three.js r170（同梱。CDN 不要）と一部のアドオン
blender/
  bpy_kit.py         … 形を組む部品（箱・円柱・リング・チューブ・球）、マテリアル（単色・画像・写真素材の PBR）、
                        当たり判定と「調べる」対象の記録、glTF への書き出し、テクスチャの JPEG 化
  fetch_textures.py  … Poly Haven（CC0）から PBR テクスチャと HDRI を取得
  text_textures.py   … 日本語の看板・貼り紙などのテクスチャ作成（OS ごとのフォント自動検出、古び加工）
  example_build.py   … 使い方の例（床・レンガの壁・木箱・看板・柱と電線を作って書き出す）
  cache/             … ダウンロードした素材（git 管理外）
assets/
  models/            … 書き出したモデル（.gltf + .bin、テクスチャは models/textures/ で共有）
  textures/          … 自分で作ったテクスチャ
```

## 使い方

```bash
python3 blender/example_build.py
# → assets/models/example.gltf / example.json、blender/example.blend
```

新しいゲームでは `example_build.py` をコピーして書き換えていきます。

```python
import bpy_kit as K, fetch_textures as PH, text_textures as TT

K.reset_scene()
brick = K.pbr_mat("brick", *PH.ensure_texture("red_brick_03", "1k"), metal=0.0)  # 写真素材（実寸で繰り返す）
b = K.Builder("Stage")
b.box((-5, 4.5, 0), (5, 5, 4), brick, collide=True)   # Blender 座標（Z が上、単位 m）
obj = b.finish()
K.export_gltf(obj, "assets/models/stage.gltf")
```

* 写真素材は https://polyhaven.com で探せます（ID は URL の最後の部分）。
  `python3 blender/fetch_textures.py <ID> [1k|2k]` で単体でも取得できます。すべて CC0 です。
* `b.collider(...)` / `collide=True` で当たり判定の箱、`b.interact(...)` で「調べる」対象を記録し、
  `b.colliders_gltf()` でゲーム側（glTF / three.js の Y-up 座標）の形にして書き出せます。
* 看板の文字は `TT.sign(...)`、古び加工は `TT.weather(...)`。

## 環境

Claude Code のクラウド環境「3Dtest」で動く前提です。環境側に次の設定があります。

* セットアップスクリプト：`fonts-noto-cjk`（日本語フォント）と `bpy==5.2.3`、`pillow` をインストール
* ネットワーク：`api.polyhaven.com` と `dl.polyhaven.org` への接続を許可

手元の PC で動かす場合は Python 3.13 が必要です（bpy 5.2.3 は Python 3.13 専用）。

```bash
python3.13 -m venv .venv && source .venv/bin/activate   # Windows は .venv\Scripts\activate
pip install bpy==5.2.3 pillow
```

日本語フォントは OS の標準フォントを自動で探します（macOS: ヒラギノ、Windows: 游ゴシック／メイリオ・游明朝）。
見つからないときは環境変数 `KIT_FONT_BOLD` / `KIT_FONT_REG` / `KIT_FONT_SERIF` でフォントファイルを指定します。

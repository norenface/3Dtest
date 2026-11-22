"""Android アプリのアイコンと起動画面（スプラッシュ）を作る。

    python3 tools/make_android_assets.py

android/app/src/main/res/ の mipmap-*（アイコン）と drawable*（スプラッシュ）の PNG を上書きする。
`npx cap add android` で Android プロジェクトを作り直したときは、もう一度実行する。
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")
sys.path.insert(0, os.path.join(ROOT, "blender"))

BG = (7, 8, 12)
ORB = (127, 240, 255)
GOLD = (232, 196, 106)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}


def orb(size, scale=1.0):
    """光る精髄オーブ（金の輪つき）を透明背景に描く。scale は画像に対するオーブの大きさ。"""
    S = size * 4  # 大きく描いて縮小し、なめらかにする
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    c = S / 2
    r = S * 0.26 * scale
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([c - r * 1.7, c - r * 1.7, c + r * 1.7, c + r * 1.7], fill=ORB + (140,))
    glow = glow.filter(ImageFilter.GaussianBlur(r * 0.45))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    # 金の輪
    w = max(2, int(r * 0.12))
    d.ellipse([c - r * 1.38, c - r * 1.38, c + r * 1.38, c + r * 1.38], outline=GOLD + (255,), width=w)
    # オーブ本体（中心ほど明るく）
    for i in range(24, 0, -1):
        k = i / 24
        col = tuple(int(ORB[j] * (0.35 + 0.65 * (1 - k)) + 255 * (1 - k) ** 3 * 0.6) for j in range(3))
        d.ellipse([c - r * k, c - r * k, c + r * k, c + r * k], fill=tuple(min(255, v) for v in col) + (255,))
    # ハイライト
    d.ellipse([c - r * 0.55, c - r * 0.62, c - r * 0.1, c - r * 0.25], fill=(255, 255, 255, 170))
    return img.resize((size, size), Image.LANCZOS)


def background(w, h):
    img = Image.new("RGBA", (w, h), BG + (255,))
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse([w * 0.1, h * 0.1, w * 0.9, h * 0.9], fill=(30, 40, 64, 255))
    shade = shade.filter(ImageFilter.GaussianBlur(min(w, h) * 0.18))
    img.alpha_composite(shade)
    return img


def save(img, *parts):
    path = os.path.join(RES, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.convert("RGBA").save(path)
    return path


def icons():
    for name, k in DENSITIES.items():
        n = int(48 * k)
        sq = background(n, n)
        sq.alpha_composite(orb(n, 1.0))
        save(sq, f"mipmap-{name}", "ic_launcher.png")
        mask = Image.new("L", (n, n), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, n - 1, n - 1], fill=255)
        rnd = Image.new("RGBA", (n, n), (0, 0, 0, 0))
        rnd.paste(sq, (0, 0), mask)
        save(rnd, f"mipmap-{name}", "ic_launcher_round.png")
        # アダプティブアイコンの前景（108dp。中央 66% が見える範囲）
        f = int(108 * k)
        save(orb(f, 0.66), f"mipmap-{name}", "ic_launcher_foreground.png")
    with open(os.path.join(RES, "values", "ic_launcher_background.xml"), "w") as fp:
        fp.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                 '    <color name="ic_launcher_background">#07080C</color>\n</resources>\n')


def splash_image(w, h):
    img = background(w, h)
    # 光のぼかしが画像の端で切れないよう、余白を大きく取って描く
    s = int(min(w, h) * 0.8)
    o = orb(s, 0.5)
    x, y = w // 2 - s // 2, int(h * 0.4) - s // 2
    img.alpha_composite(o.crop((max(0, -x), max(0, -y), s, s)), (max(0, x), max(0, y)))
    try:
        from text_textures import FONT_SERIF
        font = ImageFont.truetype(FONT_SERIF, int(min(w, h) * 0.09), index=0)
        small = ImageFont.truetype(FONT_SERIF, int(min(w, h) * 0.03), index=0)
    except Exception:
        font = small = ImageFont.load_default()
    d = ImageDraw.Draw(img)
    for text, f, y, col in (("精髄の迷宮", font, 0.72, GOLD), ("ESSENCE LABYRINTH", small, 0.85, (162, 155, 140))):
        l, t, r, b = d.textbbox((0, 0), text, font=f)
        d.text(((w - (r - l)) / 2 - l, h * y - t), text, font=f, fill=col)
    return img


def splashes():
    for root, _dirs, files in os.walk(RES):
        for fn in files:
            if fn == "splash.png" and os.path.basename(root).startswith("drawable"):
                path = os.path.join(root, fn)
                w, h = Image.open(path).size
                splash_image(w, h).convert("RGB").save(path)


if __name__ == "__main__":
    icons()
    splashes()
    print("ok:", RES)

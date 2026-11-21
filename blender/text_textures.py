"""日本語の文字が入ったテクスチャ（看板・貼り紙・ラベルなど）を Pillow で作る部品集。

* 日本語フォントを OS ごとに自動で探す（Linux: Noto CJK / macOS: ヒラギノ / Windows: 游ゴシック・メイリオ・游明朝）
  環境変数 KIT_FONT_BOLD / KIT_FONT_REG / KIT_FONT_SERIF で直接指定もできる
* 文字を枠に収める・中央に置く
* weather() で汚れ・日焼け・雨だれを付けて古びさせる
"""
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

_FONT_CANDIDATES = {
    "BOLD": [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",          # Linux (fonts-noto-cjk)
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",               # macOS
        "C:/Windows/Fonts/YuGothB.ttc",                                  # Windows
        "C:/Windows/Fonts/meiryob.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
    ],
    "REG": [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
        "C:/Windows/Fonts/YuGothM.ttc",
        "C:/Windows/Fonts/meiryo.ttc",
        "C:/Windows/Fonts/msgothic.ttc",
    ],
    "SERIF": [  # 明朝体。無ければゴシックで代用
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc",
        "C:/Windows/Fonts/yumindb.ttf",
        "C:/Windows/Fonts/YuMincho.ttc",
        "C:/Windows/Fonts/msmincho.ttc",
    ],
}


def _find_font(kind, fallback=None):
    env = os.environ.get("KIT_FONT_" + kind)
    for path in ([env] if env else []) + _FONT_CANDIDATES[kind]:
        if path and os.path.exists(path):
            return path
    if fallback:
        return fallback
    raise FileNotFoundError(
        f"日本語フォント ({kind}) が見つかりません。Linux なら fonts-noto-cjk を入れるか、"
        f"環境変数 KIT_FONT_{kind} にフォントファイルのパスを指定してください。")


FONT_BOLD = _find_font("BOLD")
FONT_REG = _find_font("REG", fallback=FONT_BOLD)
FONT_SERIF = _find_font("SERIF", fallback=FONT_BOLD)


def font(size, bold=True, serif=False):
    path = FONT_SERIF if serif else (FONT_BOLD if bold else FONT_REG)
    return ImageFont.truetype(path, size, index=0)  # ttc の最初のフェイス（Noto CJK では JP）


def rgb(c):
    """0〜1 の色 → 0〜255 のタプル。"""
    return tuple(int(max(0, min(1, v)) * 255) for v in c[:3])


def fit_font(draw, text, max_w, max_h, bold=True, serif=False):
    """text が max_w x max_h に収まる最大のフォント。"""
    size = int(max_h)
    while size > 8:
        f = font(size, bold, serif)
        l, t, r, b = draw.textbbox((0, 0), text, font=f)
        if r - l <= max_w and b - t <= max_h:
            return f
        size -= 2
    return font(8, bold, serif)


def center_text(draw, box, text, f, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=f)
    draw.text((x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t)) / 2 - t), text, font=f, fill=fill)


def vertical_text(draw, box, text, fill, serif=False):
    """縦書き（1 文字ずつ縦に並べる）。"""
    x0, y0, x1, y1 = box
    chars = [c for c in text if c != " "] or [" "]
    cell = (y1 - y0) / len(chars)
    f = font(int(min((x1 - x0) * 0.75, cell * 0.9)), serif=serif)
    for i, c in enumerate(chars):
        center_text(draw, (x0, y0 + i * cell, x1, y0 + (i + 1) * cell), c, f, fill)


def weather(img, seed, amount=0.5):
    """古びさせる：日焼け（黄ばみ・退色）、汚れ、雨だれの筋、縁のくすみ、ざらつき。amount は 0〜1。"""
    rng = random.Random(seed)
    img = img.convert("RGB")
    W, H = img.size
    img = Image.blend(img, img.convert("L").convert("RGB"), 0.12 * amount + 0.05)
    img = Image.blend(img, Image.new("RGB", (W, H), (226, 208, 160)), 0.10 * amount)
    dirt = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(dirt)
    for _ in range(int(6 * amount) + 2):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(0.05, 0.25) * max(W, H)
        dd.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=int(rng.uniform(50, 120) * amount))
    for _ in range(int(14 * amount)):
        x, y0 = rng.uniform(0, W), rng.uniform(0, H * 0.4)
        dd.line([(x, y0), (x + rng.uniform(-2, 2), y0 + rng.uniform(0.2, 0.9) * H)],
                fill=int(rng.uniform(70, 150) * amount), width=rng.randint(2, 5))
    dirt = dirt.filter(ImageFilter.GaussianBlur(max(2, min(W, H) // 30)))
    edge = Image.new("L", (W, H), int(150 * amount))
    m = max(4, min(W, H) // 8)
    ImageDraw.Draw(edge).rectangle([m, m, W - m, H - m], fill=0)
    edge = edge.filter(ImageFilter.GaussianBlur(m))
    img = Image.composite(Image.new("RGB", (W, H), (62, 50, 34)), img, ImageChops.lighter(dirt, edge))
    px = img.load()
    for _ in range(W * H // 12):
        x, y = rng.randrange(W), rng.randrange(H)
        r, g, b = px[x, y]
        k = rng.randint(-18, 18)
        px[x, y] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
    return img


def sign(path, text, bg, fg, width_m, height_m, serif=False, age=0.0, px_per_m=256):
    """横長の看板（枠つき）を作って保存し、パスを返す。width_m x height_m はゲーム内の実寸。"""
    H = max(64, int(height_m * px_per_m))
    W = int(min(2048, max(64, H * width_m / height_m)))
    img = Image.new("RGB", (W, H), rgb(bg))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 4, W - 5, H - 5], outline=rgb(fg), width=max(2, H // 40))
    center_text(d, (0, 0, W, H), text, fit_font(d, text, W * 0.86, H * 0.66, serif=serif), rgb(fg))
    if age > 0:
        img = weather(img, path, age)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path

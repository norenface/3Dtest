"""商店街用テクスチャ (PNG) を Pillow で生成する。

舗装・外壁・シャッターなどの素材は Poly Haven の写真ベースの PBR テクスチャ
(fetch_textures.py) を使う。ここで作るのは看板・貼り紙・フラッグ・店内など、
商店街固有の絵柄だけ。
"""
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# 日本語フォントは OS ごとに場所が違うので、候補を順に探す。
# 環境変数 SHOTENGAI_FONT_BOLD / SHOTENGAI_FONT_REG / SHOTENGAI_FONT_SERIF で直接指定もできる。
_FONT_CANDIDATES = {
    "BOLD": [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",          # Linux (fonts-noto-cjk)
        "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc",               # macOS
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
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
    "SERIF": [  # 明朝体（老舗っぽい看板用）。無ければゴシックで代用
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc",
        "C:/Windows/Fonts/yumindb.ttf",
        "C:/Windows/Fonts/YuMincho.ttc",
        "C:/Windows/Fonts/msmincho.ttc",
    ],
}


def _find_font(kind, fallback=None):
    env = os.environ.get("SHOTENGAI_FONT_" + kind)
    for path in ([env] if env else []) + _FONT_CANDIDATES[kind]:
        if path and os.path.exists(path):
            return path
    if fallback:
        return fallback
    raise FileNotFoundError(
        f"日本語フォント ({kind}) が見つかりません。Linux なら fonts-noto-cjk を入れるか、"
        f"環境変数 SHOTENGAI_FONT_{kind} にフォントファイルのパスを指定してください。")


FONT_BOLD = _find_font("BOLD")
FONT_REG = _find_font("REG", fallback=FONT_BOLD)
FONT_SERIF = _find_font("SERIF", fallback=FONT_BOLD)
FONT_JP_INDEX = 0  # ttc 内の最初のフェイス（Noto CJK では JP）


def _font(size, bold=True, serif=False):
    if serif:
        return ImageFont.truetype(FONT_SERIF, size, index=FONT_JP_INDEX)
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REG, size, index=FONT_JP_INDEX)


def weather(img, seed, amount=0.5):
    """看板を古びさせる：日焼け（黄ばみ・退色）、汚れ、雨だれの筋、縁のくすみ、ざらつき。"""
    rng = random.Random(seed)
    img = img.convert("RGB")
    W, H = img.size
    # 退色・黄ばみ
    gray = img.convert("L").convert("RGB")
    img = Image.blend(img, gray, 0.12 * amount + 0.05)
    img = Image.blend(img, Image.new("RGB", (W, H), (226, 208, 160)), 0.10 * amount)
    # 汚れ（ぼかした楕円）と雨だれ
    dirt = Image.new("L", (W, H), 0)
    dd = ImageDraw.Draw(dirt)
    for _ in range(int(6 * amount) + 2):
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        r = rng.uniform(0.05, 0.25) * max(W, H)
        dd.ellipse([x - r, y - r * 0.6, x + r, y + r * 0.6], fill=int(rng.uniform(50, 120) * amount))
    for _ in range(int(14 * amount)):
        x = rng.uniform(0, W)
        y0 = rng.uniform(0, H * 0.4)
        dd.line([(x, y0), (x + rng.uniform(-2, 2), y0 + rng.uniform(0.2, 0.9) * H)],
                fill=int(rng.uniform(70, 150) * amount), width=rng.randint(2, 5))
    dirt = dirt.filter(ImageFilter.GaussianBlur(max(2, min(W, H) // 30)))
    # 縁のくすみ（外周ほど暗い）
    edge = Image.new("L", (W, H), int(150 * amount))
    m = max(4, min(W, H) // 8)
    ImageDraw.Draw(edge).rectangle([m, m, W - m, H - m], fill=0)
    edge = edge.filter(ImageFilter.GaussianBlur(m))
    mask = ImageChops.lighter(dirt, edge)
    img = Image.composite(Image.new("RGB", (W, H), (62, 50, 34)), img, mask)
    # ざらつき
    px = img.load()
    for _ in range(W * H // 12):
        x, y = rng.randrange(W), rng.randrange(H)
        r, g, b = px[x, y]
        k = rng.randint(-18, 18)
        px[x, y] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
    return img


def _rgb(c):
    return tuple(int(max(0, min(1, v)) * 255) for v in c[:3])


def _fit_font(draw, text, max_w, max_h, bold=True, start=None, serif=False):
    size = start or int(max_h)
    while size > 8:
        f = _font(size, bold, serif)
        l, t, r, b = draw.textbbox((0, 0), text, font=f)
        if r - l <= max_w and b - t <= max_h:
            return f
        size -= 2
    return _font(8, bold)


def _center_text(draw, box, text, font, fill):
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    x = x0 + (x1 - x0 - (r - l)) / 2 - l
    y = y0 + (y1 - y0 - (b - t)) / 2 - t
    draw.text((x, y), text, font=font, fill=fill)


class TextureFactory:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)

    def _save(self, img, name):
        path = os.path.join(self.out_dir, name + ".png")
        img.save(path, optimize=True)
        return path

    # ------------------------------------------------------------ 看板
    def fascia_sign(self, key, text, bg, fg, width_m, height_m=0.7, serif=False, sub=None, age=0.5):
        """店舗正面の横長看板（古びた加工つき）。sub は右下の小さな文字（電話番号など）。"""
        H = 192
        W = int(min(2048, max(256, H * width_m / height_m)))
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        d.rectangle([5, 5, W - 6, H - 6], outline=_rgb(fg), width=4)
        main_h = H * (0.58 if sub else 0.66)
        f = _fit_font(d, text, W * 0.84, main_h, serif=serif)
        _center_text(d, (0, 0, W, H * (0.82 if sub else 1.0)), text, f, _rgb(fg))
        if sub:
            fs = _fit_font(d, sub, W * 0.5, H * 0.14, bold=False)
            _center_text(d, (W * 0.45, H * 0.78, W * 0.95, H * 0.94), sub, fs, _rgb(fg))
        return self._save(weather(img, "f" + key, age), "sign_" + key)

    def vertical_sign(self, key, text, bg, fg, width_m=0.9, height_m=2.0, serif=False, top=None, age=0.5):
        """袖看板（縦書き）。top は上部の小さな文字（「2F」など）。"""
        H = 384
        W = max(96, int(H * width_m / height_m))
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        d.rectangle([3, 3, W - 4, H - 4], outline=_rgb(fg), width=3)
        y0 = 10
        if top:
            d.rectangle([0, 0, W, 54], fill=_rgb(fg))
            _center_text(d, (0, 0, W, 54), top, _fit_font(d, top, W * 0.85, 40), _rgb(bg))
            y0 = 62
        chars = [c for c in text if c not in " ・"][:7] or ["店"]
        cell = (H - y0 - 10) / len(chars)
        size = int(min(W * 0.74, cell * 0.88))
        f = _font(size, serif=serif)
        for i, c in enumerate(chars):
            _center_text(d, (0, y0 + i * cell, W, y0 + (i + 1) * cell), c, f, _rgb(fg))
        return self._save(weather(img, "v" + key, age), "vsign_" + key)

    def tenant_panel(self, key, floor, text, bg, fg, width_m, height_m=0.55, age=0.6):
        """2 階以上のテナントの壁面看板（「2F 整骨院 ひだまり」）。"""
        H = 128
        W = int(min(1536, max(256, H * width_m / height_m)))
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, H, H], fill=_rgb(fg))
        _center_text(d, (0, 0, H, H), floor, _font(64), _rgb(bg))
        f = _fit_font(d, text, W - H - 30, H * 0.62)
        _center_text(d, (H, 0, W, H), text, f, _rgb(fg))
        return self._save(weather(img, "t" + key, age), "tenant_" + key)

    def nobori(self, key, text, bg, fg, top="", age=0.25):
        """のぼり旗（0.45m x 1.6m）。"""
        W, H = 160, 576
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 64], fill=_rgb(fg))
        if top:
            _center_text(d, (0, 0, W, 64), top, _fit_font(d, top, W * 0.86, 40), _rgb(bg))
        d.rectangle([0, H - 26, W, H], fill=_rgb(fg))
        chars = [c for c in text if c != " "][:7]
        cell = (H - 64 - 40) / max(1, len(chars))
        f = _font(int(min(W * 0.7, cell * 0.9)))
        for i, c in enumerate(chars):
            _center_text(d, (0, 70 + i * cell, W, 70 + (i + 1) * cell), c, f, _rgb(fg))
        return self._save(weather(img, "n" + key, age), "nobori_" + key)

    def stand_sign(self, key, title, lines, bg, fg, age=0.35):
        """置き看板（0.45m x 0.8m）。"""
        W, H = 192, 340
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        d.rectangle([6, 6, W - 7, H - 7], outline=_rgb(fg), width=3)
        _center_text(d, (0, 14, W, 70), title, _fit_font(d, title, W * 0.85, 44), _rgb(fg))
        d.line([(20, 78), (W - 20, 78)], fill=_rgb(fg), width=2)
        for i, line in enumerate(lines[:5]):
            f = _fit_font(d, line, W * 0.85, 30, bold=False)
            _center_text(d, (0, 92 + i * 46, W, 132 + i * 46), line, f, _rgb(fg))
        return self._save(weather(img, "s" + key, age), "stand_" + key)

    def pole_ad(self, key, name, sub, bg, fg, age=0.7):
        """電柱広告（0.33m x 1.4m）。"""
        W, H = 112, 480
        img = Image.new("RGB", (W, H), _rgb(bg))
        d = ImageDraw.Draw(img)
        chars = [c for c in name if c != " "][:7]
        cell = (H - 140) / max(1, len(chars))
        f = _font(int(min(W * 0.72, cell * 0.9)), serif=True)
        for i, c in enumerate(chars):
            _center_text(d, (0, 14 + i * cell, W, 14 + (i + 1) * cell), c, f, _rgb(fg))
        d.rectangle([0, H - 120, W, H], fill=_rgb(fg))
        for i, line in enumerate(sub.split(" ")[:3]):
            fs = _fit_font(d, line, W * 0.86, 30)
            _center_text(d, (0, H - 116 + i * 38, W, H - 80 + i * 38), line, fs, _rgb(bg))
        return self._save(weather(img, "p" + key, age), "polead_" + key)

    def tiger_stripe(self):
        """電柱の根元に巻く黄色と黒の縞（トラ柄）。"""
        S = 256
        img = Image.new("RGB", (S, S), (235, 190, 30))
        d = ImageDraw.Draw(img)
        for i in range(-S, 2 * S, 64):
            d.polygon([(i, 0), (i + 32, 0), (i + 32 + S, S), (i + S, S)], fill=(25, 25, 25))
        return self._save(weather(img, "tiger", 0.8), "tiger_stripe")

    def arch_sign(self, name, en):
        """入口のアーチ看板（レトロな赤地に金文字）。4.8m x 0.9m。"""
        W, H = 1600, 300
        img = Image.new("RGB", (W, H), (150, 25, 25))
        d = ImageDraw.Draw(img)
        d.rectangle([10, 10, W - 11, H - 11], outline=(235, 190, 80), width=10)
        d.rectangle([26, 26, W - 27, H - 27], outline=(235, 190, 80), width=3)
        _center_text(d, (0, 20, W, 220), name, _font(170, serif=True), (250, 215, 110))
        _center_text(d, (0, 215, W, 280), en, _font(44), (250, 230, 180))
        return self._save(weather(img, "arch", 0.45), "arch_sign")

    def tenant_wanted(self):
        """空き店舗のシャッターに貼る「テナント募集」の紙。"""
        W, H = 256, 360
        img = Image.new("RGB", (W, H), (245, 243, 235))
        d = ImageDraw.Draw(img)
        d.rectangle([6, 6, W - 7, H - 7], outline=(200, 40, 40), width=4)
        _center_text(d, (0, 20, W, 140), "テナント", _font(56), (200, 30, 30))
        _center_text(d, (0, 120, W, 230), "募集", _font(72), (200, 30, 30))
        _center_text(d, (0, 250, W, 300), "ひかり通り商店街", _font(22, False), (60, 60, 60))
        _center_text(d, (0, 295, W, 340), "振興組合 TEL 000-0000", _font(18, False), (60, 60, 60))
        return self._save(img, "tenant_wanted")

    def awning(self, key, color):
        """ストライプのテント（日よけ）。"""
        W, H = 256, 64
        img = Image.new("RGB", (W, H), (245, 245, 240))
        d = ImageDraw.Draw(img)
        stripe = W // 8
        for i in range(0, 8, 2):
            d.rectangle([i * stripe, 0, (i + 1) * stripe - 1, H], fill=_rgb(color))
        return self._save(img, "awning_" + key)

    # ------------------------------------------------------------ 区画サイン
    def banner(self, letter, color, label):
        """街灯に吊るす商店街のフラッグ。0.55m x 1.4m。商店街名を大きく、区画は上の丸の中に。"""
        W, H = 220, 560
        img = Image.new("RGB", (W, H), _rgb(color))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 120], fill=(250, 247, 238))
        d.ellipse([60, 10, W - 60, 110], fill=_rgb(color))
        _center_text(d, (60, 10, W - 60, 110), letter, _font(76), (255, 255, 255))
        name = "ひかり通り商店街"
        cell = (H - 120 - 40) / len(name)
        f = _font(int(cell * 0.9), serif=True)
        for i, c in enumerate(name):
            _center_text(d, (0, 124 + i * cell, W, 124 + (i + 1) * cell), c, f, (255, 255, 255))
        d.rectangle([0, H - 30, W, H], fill=(250, 247, 238))
        return self._save(weather(img, "b" + letter, 0.3), "banner_" + letter)

    def floor_marker(self, letter, color):
        """区画の入口の床サイン。"""
        S = 512
        img = Image.new("RGB", (S, S), (175, 175, 172))
        d = ImageDraw.Draw(img)
        d.ellipse([16, 16, S - 16, S - 16], fill=_rgb(color))
        d.ellipse([50, 50, S - 50, S - 50], fill=(245, 245, 240))
        _center_text(d, (50, 50, S - 50, S - 80), letter, _font(300), _rgb(color))
        _center_text(d, (0, S - 150, S, S - 70), f"{letter} 区", _font(44), _rgb(color))
        return self._save(img, "floor_" + letter)

    def notice_board(self, letter, color, label):
        """掲示板（お知らせ）。1.6m x 1.0m。"""
        W, H = 640, 400
        img = Image.new("RGB", (W, H), (110, 85, 60))
        d = ImageDraw.Draw(img)
        d.rectangle([14, 14, W - 15, H - 15], fill=(196, 170, 125))
        rng = random.Random(ord(letter))
        _center_text(d, (0, 18, W, 70), f"{label} 掲示板", _font(34), (60, 40, 20))
        papers = [
            ("夏祭り のお知らせ", (250, 240, 200)),
            ("落とし物 預かってます", (230, 245, 250)),
            ("防犯パトロール 実施中", (250, 230, 230)),
            ("夜間は ゲートを閉鎖します", (240, 250, 230)),
        ]
        rng.shuffle(papers)
        for i, (txt, col) in enumerate(papers[:3]):
            x0 = 30 + i * 200
            y0 = 90 + rng.randint(0, 30)
            d.rectangle([x0, y0, x0 + 180, y0 + 260], fill=col, outline=(120, 110, 100))
            lines = txt.split(" ")
            for k, line in enumerate(lines):
                f = _fit_font(d, line, 160, 34)
                _center_text(d, (x0, y0 + 30 + k * 60, x0 + 180, y0 + 80 + k * 60), line, f, (40, 40, 40))
            d.ellipse([x0 + 84, y0 - 6, x0 + 96, y0 + 6], fill=_rgb(color))
        return self._save(img, "notice_" + letter)

    # ------------------------------------------------------------ ゲート
    def gate_sign(self, name, name_en):
        W, H = 2048, 224
        img = Image.new("RGB", (W, H), (30, 60, 110))
        d = ImageDraw.Draw(img)
        d.rectangle([8, 8, W - 9, H - 9], outline=(240, 200, 80), width=6)
        _center_text(d, (0, 10, W, 160), name, _font(130), (255, 255, 255))
        _center_text(d, (0, 160, W, 215), name_en, _font(40), (240, 200, 80))
        return self._save(img, "gate_sign")

    def exit_sign(self):
        """出口の案内板（緑地に白）。"""
        W, H = 320, 400
        img = Image.new("RGB", (W, H), (20, 140, 80))
        d = ImageDraw.Draw(img)
        d.rectangle([8, 8, W - 9, H - 9], outline=(255, 255, 255), width=6)
        _center_text(d, (0, 30, W, 200), "出口", _font(120), (255, 255, 255))
        _center_text(d, (0, 200, W, 280), "EXIT", _font(70), (255, 255, 255))
        _center_text(d, (0, 290, W, 370), "→", _font(70), (255, 255, 255))
        return self._save(img, "exit_sign")

    def gate_notice(self):
        W, H = 400, 260
        img = Image.new("RGB", (W, H), (250, 250, 245))
        d = ImageDraw.Draw(img)
        d.rectangle([0, 0, W, 70], fill=(200, 30, 30))
        _center_text(d, (0, 0, W, 70), "施錠中", _font(50), (255, 255, 255))
        _center_text(d, (0, 80, W, 140), "このゲートは", _font(38), (30, 30, 30))
        _center_text(d, (0, 140, W, 200), "閉鎖されています", _font(38), (30, 30, 30))
        _center_text(d, (0, 205, W, 250), "管理：振興組合事務所", _font(26, False), (80, 80, 80))
        return self._save(img, "gate_notice")

    def shop_interior(self, variant):
        """ショーウィンドウ越しに見える店内（3m x 3m 分、world UV でタイル）。"""
        rng = random.Random(100 + variant)
        S = 512
        walls = [(196, 182, 156), (176, 178, 170), (204, 188, 160)]  # 少し薄暗い昔ながらの店内
        img = Image.new("RGB", (S, S), walls[variant % 3])
        d = ImageDraw.Draw(img)
        px_per_m = S / 3.0
        floor_y = S - int(0.3 * px_per_m)
        d.rectangle([0, floor_y, S, S], fill=(150, 130, 110))
        # 天井の照明
        d.rectangle([0, 0, S, int(0.25 * px_per_m)], fill=(250, 248, 240))
        # 棚
        x = 10
        while x < S - 40:
            w = rng.randint(110, 170)
            for k in range(4):
                sy = floor_y - int((0.35 + k * 0.45) * px_per_m)
                d.rectangle([x, sy, x + w, sy + 5], fill=(120, 95, 70))
                gx = x + 4
                while gx < x + w - 12:
                    gw = rng.randint(8, 18)
                    gh = rng.randint(14, 40)
                    col = (rng.randint(60, 230), rng.randint(60, 230), rng.randint(60, 230))
                    d.rectangle([gx, sy - gh, gx + gw, sy - 1], fill=col)
                    gx += gw + 3
            d.rectangle([x - 3, floor_y - int(1.9 * px_per_m), x, floor_y], fill=(110, 90, 70))
            x += w + rng.randint(30, 70)
        # 手前のカウンター
        cx = rng.randint(40, S - 220)
        d.rectangle([cx, floor_y - int(0.9 * px_per_m), cx + 180, floor_y], fill=(160, 120, 85))
        return self._save(img.filter(ImageFilter.GaussianBlur(1.2)), f"interior_{variant}")

    def ac_front(self):
        """エアコン室外機の正面（ファンの吹き出し口）。0.72m x 0.52m。"""
        W, H = 288, 208
        img = Image.new("RGB", (W, H), (214, 214, 208))
        d = ImageDraw.Draw(img)
        cx, cy, r = 100, 104, 82
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(60, 62, 64))
        for rr in range(r, 8, -9):
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(170, 170, 166), width=2)
        d.line([(cx - r, cy), (cx + r, cy)], fill=(170, 170, 166), width=3)
        d.line([(cx, cy - r), (cx, cy + r)], fill=(170, 170, 166), width=3)
        for y in range(30, H - 30, 8):
            d.line([(205, y), (270, y)], fill=(180, 180, 175), width=3)
        d.rectangle([0, 0, W - 1, H - 1], outline=(170, 170, 165), width=4)
        return self._save(img.filter(ImageFilter.GaussianBlur(0.5)), "ac_front")

    def vending_front(self, key, color):
        """自販機の正面。"""
        W, H = 200, 360
        img = Image.new("RGB", (W, H), _rgb(color))
        d = ImageDraw.Draw(img)
        d.rectangle([14, 20, W - 14, 200], fill=(235, 240, 245))
        rng = random.Random(hash(key) & 0xFFFF)
        for row in range(3):
            for col in range(6):
                x = 22 + col * 27
                y = 30 + row * 58
                cc = (rng.randint(40, 230), rng.randint(40, 230), rng.randint(40, 230))
                d.rounded_rectangle([x, y, x + 18, y + 40], 4, fill=cc)
                d.rectangle([x - 2, y + 44, x + 20, y + 50], fill=(60, 60, 60))
        d.rectangle([W - 60, 220, W - 20, 280], fill=(40, 40, 40))
        d.rectangle([20, 300, W - 20, 340], fill=(30, 30, 30))
        return self._save(img, "vending_" + key)

"""Generate dromadaire ICO files using Pillow (no Cairo dependency).
Draws a stylized dromadaire silhouette optimized for systray readability."""
from PIL import Image, ImageDraw
import os

SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]

# Colors
BG_DARK = (30, 41, 59)        # Slate-800
CAMEL_BODY = (196, 155, 100)   # Warm sand
CAMEL_DARK = (160, 120, 70)    # Darker sand for depth
CAMEL_LIGHT = (220, 180, 130)  # Light sand for hump
SADDLE = (79, 70, 229)         # Indigo-600
GOLD = (255, 215, 0)           # Gold accent
EYE = (30, 41, 59)             # Dark
WHITE = (255, 255, 255)


def draw_dromadaire(size: int) -> Image.Image:
    """Draw a dromadaire icon at the given size.
    Renders at 4x resolution then downscales for clean antialiasing."""
    s = max(size * 4, 512)
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    cx, cy = s // 2, s // 2
    r = s * 0.46

    # Background circle
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG_DARK)

    f = s / 256.0

    # Body ellipse
    body_cx, body_cy = 130 * f, 160 * f
    body_rx, body_ry = 60 * f, 30 * f
    d.ellipse([body_cx - body_rx, body_cy - body_ry, body_cx + body_rx, body_cy + body_ry], fill=CAMEL_BODY)

    # Hump (single dromadaire hump)
    hump_cx, hump_cy = 118 * f, 120 * f
    hump_rx, hump_ry = 28 * f, 26 * f
    d.ellipse([hump_cx - hump_rx, hump_cy - hump_ry, hump_cx + hump_rx, hump_cy + hump_ry], fill=CAMEL_LIGHT)

    # Hump-body blend
    blend_cx, blend_cy = 120 * f, 138 * f
    blend_rx, blend_ry = 33 * f, 20 * f
    d.ellipse([blend_cx - blend_rx, blend_cy - blend_ry, blend_cx + blend_rx, blend_cy + blend_ry], fill=CAMEL_BODY)

    # Neck (polygon)
    neck_points = [
        (82 * f, 142 * f), (76 * f, 110 * f), (64 * f, 78 * f),
        (60 * f, 64 * f), (66 * f, 56 * f), (74 * f, 60 * f),
        (78 * f, 75 * f), (82 * f, 100 * f), (90 * f, 135 * f),
    ]
    d.polygon(neck_points, fill=CAMEL_BODY)

    # Head
    head_cx, head_cy = 60 * f, 55 * f
    head_rx, head_ry = 17 * f, 11 * f
    d.ellipse([head_cx - head_rx, head_cy - head_ry, head_cx + head_rx, head_cy + head_ry], fill=CAMEL_DARK)

    # Muzzle
    muz_cx, muz_cy = 47 * f, 57 * f
    muz_rx, muz_ry = 10 * f, 7 * f
    d.ellipse([muz_cx - muz_rx, muz_cy - muz_ry, muz_cx + muz_rx, muz_cy + muz_ry], fill=CAMEL_BODY)

    # Eye
    eye_r = max(2.5 * f, 1)
    d.ellipse([58*f - eye_r, 49*f - eye_r, 58*f + eye_r, 49*f + eye_r], fill=EYE)
    hl_r = max(1 * f, 0.5)
    d.ellipse([59*f - hl_r, 48*f - hl_r, 59*f + hl_r, 48*f + hl_r], fill=WHITE)

    # Ear
    ear_cx, ear_cy = 70 * f, 44 * f
    ear_rx, ear_ry = 4 * f, 6 * f
    d.ellipse([ear_cx - ear_rx, ear_cy - ear_ry, ear_cx + ear_rx, ear_cy + ear_ry], fill=CAMEL_DARK)

    # Legs
    leg_w, leg_h, leg_r = 9 * f, 38 * f, 3 * f
    for lx, color in [(100*f, CAMEL_BODY), (114*f, CAMEL_DARK), (152*f, CAMEL_BODY), (166*f, CAMEL_DARK)]:
        ly = 178 * f
        d.rounded_rectangle([lx, ly, lx + leg_w, ly + leg_h], radius=leg_r, fill=color)

    # Hooves
    hoof_h, hoof_w = 5 * f, 12 * f
    hoof_color = (107, 66, 38)
    for hx in [98*f, 112*f, 150*f, 164*f]:
        hy = 213 * f
        d.rounded_rectangle([hx, hy, hx + hoof_w, hy + hoof_h], radius=2*f, fill=hoof_color)

    # Saddle/blanket (indigo)
    saddle_points = [
        (102*f, 132*f), (118*f, 120*f), (138*f, 132*f), (152*f, 145*f),
        (152*f, 155*f), (138*f, 160*f), (112*f, 160*f), (98*f, 155*f), (96*f, 148*f),
    ]
    d.polygon(saddle_points, fill=SADDLE + (180,))

    # Gold trim on saddle
    trim_w = max(2 * f, 1)
    d.line([(106*f, 137*f), (118*f, 127*f), (134*f, 137*f)], fill=GOLD, width=int(trim_w))
    d.line([(100*f, 147*f), (125*f, 140*f), (148*f, 147*f)], fill=GOLD, width=int(max(1.5*f, 1)))

    # Tail
    tail_w = max(2.5 * f, 1)
    d.line([(186*f, 150*f), (196*f, 142*f), (200*f, 150*f)], fill=CAMEL_DARK, width=int(tail_w))
    tail_tuft_r = 3.5 * f
    d.ellipse([200*f - tail_tuft_r, 148*f - tail_tuft_r, 200*f + tail_tuft_r, 148*f + tail_tuft_r], fill=(139, 98, 50))

    # Downscale with LANCZOS
    if img.size[0] != size:
        img = img.resize((size, size), Image.LANCZOS)

    return img


def build_ico(ico_path: str, sizes: list[tuple[int, int]]):
    """Build multi-resolution ICO by saving the largest image with sizes param."""
    # Pillow ICO save: provide the largest image, it downscales for each size
    largest = max(s[0] for s in sizes)
    img = draw_dromadaire(largest)
    print(f"  Master image: {img.size}")

    img.save(ico_path, format="ICO", sizes=sizes)

    file_size = os.path.getsize(ico_path)
    print(f"  -> {ico_path} ({file_size:,} bytes)")

    # Verify
    verify = Image.open(ico_path)
    print(f"  Contained sizes: {verify.info.get('sizes', 'unknown')}")


if __name__ == "__main__":
    print("Building tray.ico (systray)...")
    build_ico("tray.ico", SIZES)

    print("\nBuilding app.ico (window icon)...")
    build_ico("app.ico", SIZES)

    print("\nBuilding tray_upgrade.ico...")
    build_ico("tray_upgrade.ico", SIZES)

    # Save preview PNG
    preview = draw_dromadaire(256)
    preview.save("dromadaire_preview.png")
    print(f"\nPreview: dromadaire_preview.png ({os.path.getsize('dromadaire_preview.png'):,} bytes)")
    print("Done!")

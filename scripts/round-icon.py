#!/usr/bin/env python3
"""Round the corners of a square app icon.

Usage:
    round-icon.py SRC DST [MODE] [VALUE] [INSET]

MODE:
  radius   VALUE = corner radius in pixels measured on the SOURCE size
           (e.g. 100 on a 512px master = ~19.5%). A true rounded rectangle.
  squircle VALUE = superellipse exponent (higher = rounder). Apple's
           continuous-corner look sits around 4-5.

  (If MODE is omitted it defaults to `radius 100`.)

INSET  optional fraction of padding around the art (0..0.2); macOS tiles are
       not full-bleed. Default 0.0 keeps your full-bleed art.

The radius is expressed as a fraction of the source dimension, so every
generated icon size keeps the same proportional rounding.
"""
import sys
from PIL import Image, ImageDraw


def rounded_rect_mask(size: int, radius_frac: float, ss: int = 4) -> Image.Image:
    S = size * ss
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    r = max(0, min(S / 2, radius_frac * S))
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    return mask.resize((size, size), Image.LANCZOS)


def squircle_mask(size: int, n: float, ss: int = 4) -> Image.Image:
    S = size * ss
    mask = Image.new("L", (S, S), 0)
    px = mask.load()
    half = S / 2.0
    for y in range(S):
        ny = (y + 0.5 - half) / half
        ay = abs(ny) ** n
        for x in range(S):
            nx = (x + 0.5 - half) / half
            if ay + abs(nx) ** n <= 1.0:
                px[x, y] = 255
    return mask.resize((size, size), Image.LANCZOS)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    mode = sys.argv[3] if len(sys.argv) > 3 else "radius"
    value = float(sys.argv[4]) if len(sys.argv) > 4 else 100.0
    inset = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0

    img = Image.open(src).convert("RGBA")
    size = min(img.size)
    if img.size != (size, size):
        left = (img.width - size) // 2
        top = (img.height - size) // 2
        img = img.crop((left, top, left + size, top + size))

    # convert a pixel radius on the source into a size-independent fraction
    radius_frac = (value / size) if mode == "radius" else 0.0

    def make_mask(s: int) -> Image.Image:
        if mode == "radius":
            return rounded_rect_mask(s, radius_frac)
        return squircle_mask(s, value)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if inset > 0:
        pad = int(round(size * inset))
        inner = size - 2 * pad
        art = img.resize((inner, inner), Image.LANCZOS)
        out.paste(art, (pad, pad), make_mask(inner))
    else:
        out.paste(img, (0, 0), make_mask(size))
    out.save(dst)
    desc = f"radius={value}px ({radius_frac*100:.1f}%)" if mode == "radius" else f"squircle n={value}"
    print(f"wrote {dst} ({size}x{size}) {desc} inset={inset}")


if __name__ == "__main__":
    main()

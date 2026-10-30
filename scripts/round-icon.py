#!/usr/bin/env python3
"""Apply an Apple-style continuous-corner (squircle) mask to a square icon.

Usage:
    round-icon.py SRC DST [N] [INSET]

  N     superellipse exponent — higher = rounder corners. Apple's macOS icon
        shape is approximated well around N=4 (default). Lower looks boxier.
  INSET fraction of padding added around the art (0..0.2). macOS app icons
        are NOT full-bleed — the glyph sits on ~82% of the tile with a margin.
        Default 0.0 keeps your full-bleed art; pass e.g. 0.08 for a margin.

Why a squircle, not a plain rounded-rect: Apple uses a "continuous corner"
superellipse, so a normal rounded rectangle looks subtly wrong next to native
icons. We approximate |x|^n + |y|^n = 1 and supersample for clean edges.
"""
import sys
from PIL import Image

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
    n = float(sys.argv[3]) if len(sys.argv) > 3 else 4.0
    inset = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
    img = Image.open(src).convert("RGBA")
    size = min(img.size)
    if img.size != (size, size):
        left = (img.width - size) // 2
        top = (img.height - size) // 2
        img = img.crop((left, top, left + size, top + size))

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if inset > 0:
        pad = int(round(size * inset))
        inner = size - 2 * pad
        art = img.resize((inner, inner), Image.LANCZOS)
        mask = squircle_mask(inner, n)
        out.paste(art, (pad, pad), mask)
    else:
        mask = squircle_mask(size, n)
        out.paste(img, (0, 0), mask)
    out.save(dst)
    print(f"wrote {dst} ({size}x{size}) squircle n={n} inset={inset}")

if __name__ == "__main__":
    main()

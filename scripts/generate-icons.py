#!/usr/bin/env python3
"""Gera os ícones PNG do plugin sem depender de ImageMagick/Pillow.

O desenho é um quadrado arredondado com o glifo `>_`, renderizado com
supersampling 4x para suavizar as bordas.
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "plugin" / "resources"

THEMES = {
    "light": (0x2D, 0x7F, 0xF9, 0xFF, 0xFF, 0xFF),  # fundo azul, glifo branco
    "dark": (0x6E, 0xA8, 0xFF, 0x0F, 0x1B, 0x2D),  # fundo azul claro, glifo escuro
}

SIZES = {
    "icon.png": 16,
    "icon@1.25x.png": 20,
    "icon@1.5x.png": 24,
    "icon@1.75x.png": 28,
    "icon@2x.png": 32,
}


def chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def write_png(path: Path, width: int, height: int, rows: list[list[int]]) -> None:
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def inside_rounded(x: float, y: float, size: float, radius: float) -> bool:
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2


def distance_to_segment(
    px: float, py: float, ax: float, ay: float, bx: float, by: float
) -> float:
    dx = bx - ax
    dy = by - ay
    length_sq = dx * dx + dy * dy
    if length_sq == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length_sq))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size: int, bg: tuple[int, int, int, int], fg: tuple[int, int, int, int], ss: int = 4):
    n = size * ss
    radius = size * 0.22
    stroke = size * 0.085

    # Glifo `>` e `_`, em coordenadas relativas.
    ax, ay = size * 0.31, size * 0.29
    bx, by = size * 0.55, size * 0.50
    cx, cy = size * 0.31, size * 0.71

    ux1, uy1 = size * 0.61, size * 0.71
    ux2, uy2 = size * 0.80, size * 0.71

    pixels = []
    for py in range(n):
        row = []
        for px in range(n):
            x = (px + 0.5) / ss
            y = (py + 0.5) / ss
            if not inside_rounded(x, y, size, radius):
                row.extend((0, 0, 0, 0))
                continue

            d1 = distance_to_segment(x, y, ax, ay, bx, by)
            d2 = distance_to_segment(x, y, bx, by, cx, cy)
            d3 = distance_to_segment(x, y, ux1, uy1, ux2, uy2)
            if min(d1, d2, d3) <= stroke:
                row.extend(fg)
            else:
                row.extend(bg)
        pixels.append(row)

    # Downsample com alpha pré-multiplicado.
    rows = []
    for y in range(size):
        row = []
        for x in range(size):
            a = 0
            ra = ga = ba = 0
            for dy in range(ss):
                for dx in range(ss):
                    idx = (x * ss + dx) * 4
                    rr, gg, bb, aa = pixels[y * ss + dy][idx : idx + 4]
                    a += aa
                    ra += rr * aa
                    ga += gg * aa
                    ba += bb * aa
            count = ss * ss
            alpha = a // count
            if a > 0:
                row.extend((ra // a, ga // a, ba // a, alpha))
            else:
                row.extend((0, 0, 0, 0))
        rows.append(row)
    return rows


def main() -> None:
    for theme, (r, g, b, fr, fg, fb) in THEMES.items():
        directory = OUT / theme
        directory.mkdir(parents=True, exist_ok=True)
        for name, size in SIZES.items():
            rows = render(size, (r, g, b, 255), (fr, fg, fb, 255))
            write_png(directory / name, size, size, rows)
            print(f"{directory / name} ({size}x{size})")


if __name__ == "__main__":
    main()

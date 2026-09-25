"""Writes the app icons into the repo root. Run from the repo root:

    python3 tools/icon.py

Standard library only. millitap's version of this script uses Pillow; inlay
has no dependencies anywhere, and an icon is a handful of rectangles and
circles, so this carries its own rasteriser and PNG encoder instead.

Shapes are painted at 4x and box-filtered down, which is all the antialiasing
flat shapes need.
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Same ground as millitap's icon, so the two sit together on a home screen.
GROUND = (27, 36, 48)
NUT    = (147, 164, 183)   # --ink-dim
FRET   = (72, 90, 110)
STRING = (120, 136, 154)
PEARL  = (226, 220, 205)   # the inlay: mother-of-pearl, sitting between strings
FOUND  = (127, 203, 143)   # --true: a note found, sitting ON a string

SS = 4  # supersampling factor


class Canvas:
    def __init__(self, size):
        self.s = size
        self.px = bytearray(size * size * 4)  # RGBA, transparent

    def span(self, y, x0, x1, rgb):
        x0 = max(0, x0); x1 = min(self.s, x1)
        if y < 0 or y >= self.s or x1 <= x0:
            return
        i = (y * self.s + x0) * 4
        self.px[i:i + (x1 - x0) * 4] = bytes((*rgb, 255)) * (x1 - x0)

    def rect(self, x0, y0, x1, y1, rgb):
        """Unit coordinates, 0..1."""
        s = self.s
        for y in range(round(y0 * s), round(y1 * s)):
            self.span(y, round(x0 * s), round(x1 * s), rgb)

    def rounded(self, radius, rgb):
        s = self.s; r = radius * s
        for y in range(s):
            cy = y + 0.5
            dy = max(r - cy, cy - (s - r), 0)
            if dy > r:
                continue
            inset = r - (r * r - dy * dy) ** 0.5 if dy else 0
            self.span(y, round(inset), round(s - inset), rgb)

    def circle(self, cx, cy, radius, rgb):
        s = self.s; cx *= s; cy *= s; r = radius * s
        for y in range(int(cy - r), int(cy + r) + 1):
            dy = y + 0.5 - cy
            if abs(dy) > r:
                continue
            half = (r * r - dy * dy) ** 0.5
            self.span(y, round(cx - half), round(cx + half), rgb)

    def downsample(self, f):
        """Box-filter by f. Averages premultiplied colour, so the transparent
        corners of a rounded icon don't darken its edge."""
        s = self.s; n = s // f; out = bytearray(n * n * 4); row = s * 4
        for oy in range(n):
            rows = [self.px[(oy * f + k) * row:(oy * f + k + 1) * row] for k in range(f)]
            # Premultiplied here is plain RGB: every painted pixel is opaque and
            # every unpainted one is (0,0,0,0).
            sums = [list(map(sum, zip(*(r[c + 4 * k::4 * f] for r in rows for k in range(f)))))
                    for c in range(4)]
            for ox in range(n):
                a = sums[3][ox]
                o = (oy * n + ox) * 4
                if a:
                    out[o:o + 4] = bytes((round(sums[0][ox] * 255 / a),
                                          round(sums[1][ox] * 255 / a),
                                          round(sums[2][ox] * 255 / a),
                                          round(a / (f * f))))
        return n, out


def png(size, rgba):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    raw = b"".join(b"\0" + bytes(rgba[y * size * 4:(y + 1) * size * 4]) for y in range(size))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


def make(size, rounded):
    c = Canvas(size * SS)
    if rounded:
        c.rounded(0.22, GROUND)
    else:
        c.rect(0, 0, 1, 1, GROUND)

    # A short run of neck, nut on the left: three frets, four strings.
    top, bottom = 0.27, 0.73
    c.rect(0.155, top, 0.185, bottom, NUT)
    for x in (0.40, 0.62, 0.84):
        c.rect(x - 0.009, top, x + 0.009, bottom, FRET)
    for i, y in enumerate((0.33, 0.44, 0.56, 0.67)):
        h = 0.006 + 0.003 * i          # lower strings are heavier
        c.rect(0.17, y - h, 0.86, y + h, STRING)

    # The inlay sits on the wood between two strings; the note sits on one.
    c.circle(0.51, 0.50, 0.047, PEARL)
    c.circle(0.29, 0.67, 0.068, FOUND)

    return png(*c.downsample(SS))


if __name__ == "__main__":
    (ROOT / "apple-touch-icon.png").write_bytes(make(180, False))  # iOS applies its own mask
    (ROOT / "icon-192.png").write_bytes(make(192, True))
    (ROOT / "icon-512.png").write_bytes(make(512, True))
    print("icons written")

"""The iPhone app's icons from the desktop app's icon (iOS rounds the corners itself, so the tile is square).

    python make_web_icons.py <icon.png> <out dir>
"""
import os
import sys

from PIL import Image

src, out = sys.argv[1:3]
img = Image.open(src).convert("RGBA")
os.makedirs(out, exist_ok=True)
for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
    tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    mark = img.resize((int(size * 0.72), int(size * 0.72)), Image.LANCZOS)
    tile.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    tile.convert("RGB").save(os.path.join(out, name))
print("web icons written")

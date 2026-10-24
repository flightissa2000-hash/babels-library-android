"""Launcher icons (mipmap-*/ic_launcher.png) from the desktop app's icon.

    python make_icons.py <icon.png> <res dir>
"""
import os
import sys

from PIL import Image

src, res = sys.argv[1:3]
img = Image.open(src).convert("RGBA")
for name, size in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
    d = os.path.join(res, f"mipmap-{name}")
    os.makedirs(d, exist_ok=True)
    # a rounded white tile behind the mark, like other launcher icons
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    from PIL import ImageDraw
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, size - 1, size - 1), radius=size // 5, fill=(255, 255, 255, 255))
    mark = img.resize((int(size * 0.74), int(size * 0.74)), Image.LANCZOS)
    tile.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    tile.save(os.path.join(d, "ic_launcher.png"))
print("icons written")

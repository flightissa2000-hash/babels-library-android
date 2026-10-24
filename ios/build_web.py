"""Builds the iPhone / iPad web app (build/web-ios) from the Android app's page (web/) and the iPhone pieces (ios/).

    python ios/build_web.py [desktop static folder]

The app's own scripts are the same files as on Android; ios/bridge.js stands in for the Java bridge and starts them
once the saved state has been read. The result is a plain static site (GitHub Pages serves it)."""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
desk = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BABEL_DESKTOP", r"F:\Inkwell\app\static")
ios = os.path.join(root, "ios")
out = os.path.join(root, "build", "web-ios")
FONTS = re.compile(r"^(fredoka|nunito|ibm-plex-mono|anton|archivo-narrow|permanent-marker|im-fell-english-latin|chakra-petch-latin-700|cormorant-garamond-latin-600|libre-baskerville-latin-400)")

if os.path.exists(out):
    shutil.rmtree(out)
shutil.copytree(os.path.join(root, "web"), out)
# what the page shares with the computer app (the same as the Android build)
shutil.copy(os.path.join(desk, "css", "themes.css"), os.path.join(out, "css", "themes.css"))
shutil.copy(os.path.join(desk, "js", "themes.js"), os.path.join(out, "js", "themes.js"))
os.makedirs(os.path.join(out, "vendor", "fonts"), exist_ok=True)
for f in ("pdf.min.js", "pdf.worker.min.js", "epub.min.js", "jszip.min.js"):
    shutil.copy(os.path.join(desk, "vendor", f), os.path.join(out, "vendor", f))
shutil.copytree(os.path.join(desk, "vendor", "libarchive"), os.path.join(out, "vendor", "libarchive"))   # CBR, CB7 and CBT comics
for f in os.listdir(os.path.join(desk, "vendor", "fonts")):
    if f.endswith(".woff2") and FONTS.match(f):
        shutil.copy(os.path.join(desk, "vendor", "fonts", f), os.path.join(out, "vendor", "fonts", f))

# the iPhone pieces
os.makedirs(os.path.join(out, "ios"), exist_ok=True)
for f in ("net.js", "store.js", "zip.js", "ios.css"):
    shutil.copy(os.path.join(ios, f), os.path.join(out, "ios", f))
shutil.copy(os.path.join(ios, "manifest.webmanifest"), os.path.join(out, "manifest.webmanifest"))
subprocess.run([sys.executable, os.path.join(ios, "make_web_icons.py"), os.path.join(desk, "icon.png"), os.path.join(out, "ios")], check=True)

# index.html: the app's scripts are started by the bridge (after the saved state is read), plus the Home Screen bits
p = os.path.join(out, "index.html")
html = open(p, encoding="utf-8").read()
scripts = re.findall(r'<script src="([^"]+)"></script>\n?', html)
html = re.sub(r'<script src="[^"]+"></script>\n?', "", html)
head = """<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Babel's">
<meta name="theme-color" content="#bfe7ff">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="ios/apple-touch-icon.png">
<link rel="stylesheet" href="ios/ios.css">
"""
html = html.replace("</head>", head + "</head>")
html = html.replace("</body>", '<script src="ios/net.js"></script>\n<script src="ios/store.js"></script>\n<script src="ios/bridge.js"></script>\n</body>')
open(p, "w", encoding="utf-8", newline="\n").write(html)
bridge = open(os.path.join(ios, "bridge.js"), encoding="utf-8").read().replace("__APP_SCRIPTS__", json.dumps(scripts))
open(os.path.join(out, "ios", "bridge.js"), "w", encoding="utf-8", newline="\n").write(bridge)

# the service worker keeps every file of this version for offline use; a new version replaces the old copies
shell, h = ["./"], hashlib.sha256()
for d, _, fs in sorted(os.walk(out)):
    for f in sorted(fs):
        rel = os.path.relpath(os.path.join(d, f), out).replace(os.sep, "/")
        with open(os.path.join(d, f), "rb") as fh:
            h.update(rel.encode() + fh.read())
        shell.append(rel)
sw = open(os.path.join(ios, "sw.js"), encoding="utf-8").read()
sw = sw.replace("__VERSION__", h.hexdigest()[:12]).replace("__SHELL_FILES__", json.dumps(shell))
open(os.path.join(out, "sw.js"), "w", encoding="utf-8", newline="\n").write(sw)
open(os.path.join(out, ".nojekyll"), "w").close()        # (GitHub Pages: serve the files as they are)
print(f"{out} ({len(shell)} files, version {h.hexdigest()[:12]}; scripts: {', '.join(scripts)})")

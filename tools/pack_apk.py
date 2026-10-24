"""Copies aapt2's APK into a fresh zip with classes.dex added, keeping each entry's compression.

    python pack_apk.py base.apk classes.dex out.apk
"""
import sys
import zipfile

src, dex, dst = sys.argv[1:4]
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
    for info in zin.infolist():
        data = zin.read(info)
        out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
        out.compress_type = info.compress_type
        out.external_attr = info.external_attr
        zout.writestr(out, data)
    zout.write(dex, "classes.dex", compress_type=zipfile.ZIP_DEFLATED)

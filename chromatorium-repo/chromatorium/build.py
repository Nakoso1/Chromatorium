#!/usr/bin/env python3
"""単一HTML(dist/Chromatorium.html)をsrc/から再構成する。純粋な連結のみ。"""
import glob, hashlib, os
parts = ["src/00_head.html", "src/01_main.css", "src/02_body.html"]
parts += sorted(glob.glob("src/js/*.js"))
parts += ["src/99_tail.html"]
out = b"".join(open(p, "rb").read() for p in parts)
os.makedirs("dist", exist_ok=True)
open("dist/Chromatorium.html", "wb").write(out)
print("built dist/Chromatorium.html", len(out), "bytes",
      "sha256:", hashlib.sha256(out).hexdigest())

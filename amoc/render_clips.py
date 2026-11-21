#!/usr/bin/env python3
"""
Headless renderer for the AMOC scene (drives index.html in Chromium with SwiftShader
WebGL2 through Playwright; files are served through request routing, no local server).

  --inspect DIR   contact sheets for visual QA
  --clips         Holo Stage clips (720x720, 24 fps, H.264, pure black):
                    amoc_loop.mp4             8 s  seamless loop, Atlantic view, full circulation
                    amoc_loop_turning.mp4     5 s  seamless loop, one 72 deg/s turn
                    amoc_trace.mp4           24 s  the conveyor is traced step by step
                    amoc_slowdown.mp4        20 s  Greenland meltwater weakens the overturning
"""

import argparse
import base64
import io
import math
import mimetypes
import os
import subprocess
import sys

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ORIGIN = "http://amoc.local/"
CHROME_PATHS = [
    os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell"),
    os.path.expanduser("~/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"),
]
FPS, SIZE = 24, 720


def serve(route):
    path = route.request.url[len(ORIGIN):].split("?")[0] or "index.html"
    full = os.path.normpath(os.path.join(HERE, path))
    if not full.startswith(HERE) or not os.path.isfile(full):
        return route.fulfill(status=404, body="not found")
    with open(full, "rb") as f:
        route.fulfill(status=200, body=f.read(),
                      content_type=mimetypes.guess_type(full)[0] or "application/octet-stream")


def frame(page, size, ss, opts):
    url = page.evaluate("o => window.holoRender(o)", {**opts, "width": size * ss, "height": size * ss})
    img = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")
    return img.resize((size, size), Image.Resampling.LANCZOS) if ss != 1 else img


def state(page, kind, t):
    return page.evaluate(f"t => window.amoc.{kind}State(t)", t)


def jobs():
    loop = lambda t: {"viewLat": 22, "viewLon": -34, "flowTime": t, "loopDur": 8.0}
    turn = lambda t: {"viewLat": 24, "viewLon": -34, "flowTime": t, "loopDur": 5.0, "spinDeg": 72.0 * t}
    return {
        "amoc_loop.mp4": (8.0, lambda page, t: loop(t)),
        "amoc_loop_turning.mp4": (5.0, lambda page, t: turn(t)),
        "amoc_trace.mp4": (24.0, lambda page, t: state(page, "story", t)),
        "amoc_slowdown.mp4": (20.0, lambda page, t: state(page, "weaken", t)),
    }


def inspect(page, out_dir, ss):
    os.makedirs(out_dir, exist_ok=True)
    cells = [
        ("loop", {"viewLat": 22, "viewLon": -34, "flowTime": 3}),
        ("turn 120", {"viewLat": 24, "viewLon": -34, "flowTime": 3, "spinDeg": 120}),
        ("turn 220", {"viewLat": 24, "viewLon": -34, "flowTime": 3, "spinDeg": 220}),
    ]
    for t in (2.5, 7, 10, 14, 18.5, 23):
        cells.append((f"trace {t}s", state(page, "story", t)))
    for t in (2, 9, 19):
        cells.append((f"slowdown {t}s", state(page, "weaken", t)))
    size, cols = 480, 4
    rows = math.ceil(len(cells) / cols)
    sheet = Image.new("RGB", (cols * size, rows * size))
    d = ImageDraw.Draw(sheet)
    for k, (label, o) in enumerate(cells):
        x, y = (k % cols) * size, (k // cols) * size
        sheet.paste(frame(page, size, ss, o), (x, y))
        d.text((x + 8, y + 8), label, fill=(255, 220, 160))
    out = os.path.join(out_dir, "amoc_sheet.png")
    sheet.save(out)
    print("wrote", out)
    frame(page, SIZE, ss, cells[0][1]).save(os.path.join(out_dir, "amoc_full.png"))


def encode(frames, out_path):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{SIZE}x{SIZE}",
           "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
           "-crf", "18", "-preset", "slow", "-movflags", "+faststart", out_path]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    assert proc.stdin is not None
    n = 0
    for img in frames:
        proc.stdin.write(img.tobytes())
        n += 1
        if n % 48 == 0:
            print(f"  {os.path.basename(out_path)}: {n} frames", flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise RuntimeError("ffmpeg failed")
    print(f"wrote {out_path} ({os.path.getsize(out_path) / 1024:.0f} KB)", flush=True)


def clips(page, ss, only):
    for name, (dur, make) in jobs().items():
        if only and name not in only:
            continue
        n = int(round(dur * FPS))
        encode((frame(page, SIZE, ss, make(page, k / FPS)) for k in range(n)), os.path.join(HERE, name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", metavar="DIR")
    ap.add_argument("--clips", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--ss", type=int, default=2, help="supersampling factor")
    args = ap.parse_args()
    kw = {"headless": True, "args": ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"]}
    chrome = next((p for p in CHROME_PATHS if os.path.exists(p)), None)
    if chrome:
        kw["executable_path"] = chrome
    with sync_playwright() as p:
        browser = p.chromium.launch(**kw)
        page = browser.new_page(viewport={"width": 800, "height": 800})
        page.on("pageerror", lambda e: print("PAGEERROR:", e, file=sys.stderr))
        page.on("console", lambda m: print("CONSOLE:", m.text, file=sys.stderr) if m.type in ("error", "warning") else None)
        page.route(ORIGIN + "**", serve)
        page.goto(ORIGIN + "index.html?headless", wait_until="load")
        page.wait_for_function("window.holoReady === true", timeout=120000)
        if args.inspect:
            inspect(page, args.inspect, args.ss)
        if args.clips:
            clips(page, args.ss, args.only)
        browser.close()


if __name__ == "__main__":
    main()

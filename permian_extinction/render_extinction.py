#!/usr/bin/env python3
"""
Headless WebGL2 renderer for the Permian-Triassic Boundary (~252 Ma)
Volcanic Greenhouse & Mass Extinction 3D visualization.

Outputs Holo Stage 720x720 24fps H.264 MP4 clips on pure black:
  - pt_extinction_full.mp4           (16.0s, complete 4-phase story, gentle spin)
  - pt_extinction_turning.mp4        (15.0s, complete 4-phase story, exact 72 deg/s = 3 turns)
  - pt_permian_idle_turning.mp4      ( 5.0s, lush Permian equilibrium loop, exact 72 deg/s = 1 turn)
  - pt_aftermath_idle_turning.mp4    ( 5.0s, scorched super-greenhouse loop, exact 72 deg/s = 1 turn)
"""

import argparse
import base64
import http.server
import io
import os
import subprocess
import sys
import threading
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME_PATHS = [
    "/home/davidhofer/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    "/home/davidhofer/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
]


def find_chrome():
    for p in CHROME_PATHS:
        if os.path.exists(p):
            return p
    return None


def start_server(root_dir):
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root_dir, **kwargs)
        def log_message(self, format, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def capture_pil(page, opts, supersample=1.25):
    w_out = opts.get("out_width", 720)
    h_out = opts.get("out_height", 720)
    rw = int(round(w_out * supersample))
    rh = int(round(h_out * supersample))
    ro = dict(opts, width=rw, height=rh)
    url = page.evaluate("""(o) => {
        window.__RENDER_API__.renderFrame(o);
        return window.__RENDER_API__.getDataURL();
    }""", ro)
    raw = base64.b64decode(url.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if rw != w_out or rh != h_out:
        img = img.resize((w_out, h_out), Image.LANCZOS)
    return img


def render_inspect(page, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    holo_cam = {"yaw": 0.0, "pitch": 0.20, "dist": 5.05, "target": [-0.11, 0.02, 0.0]}

    # 6 key moments across the entire Permian-Triassic extinction sequence!
    panels = [
        ("1. Permian Equilibrium",  0.06,  -22.0, 0.9),
        ("2a. Eruption Begins",     0.25,   10.0, 3.8),
        ("2b. Ash Dims Sunlight",   0.35,   35.0, 5.4),
        ("3a. CO2 Blanket Builds",  0.54,   75.0, 8.2),
        ("3b. Heat Rays Trapped",   0.68,  105.0, 10.5),
        ("4. Extinction (+10 C)",   0.92,  -15.0, 14.2),
    ]
    sheet = Image.new("RGB", (600 * 3, 600 * 2), (0, 0, 0))
    draw = ImageDraw.Draw(sheet)
    for idx, (label, prog, deg, ft) in enumerate(panels):
        im = capture_pil(page, {
            "cam": holo_cam, "progress": prog, "globeAngleDeg": deg,
            "flowTime": ft, "bg": "holo", "hideHud": True,
            "out_width": 600, "out_height": 600,
        }, supersample=1.5)
        cx, cy = (idx % 3) * 600, (idx // 3) * 600
        sheet.paste(im, (cx, cy))
        draw.rectangle([cx + 10, cy + 10, cx + 230, cy + 36], fill=(0, 0, 0))
        draw.text((cx + 18, cy + 16), label, fill=(255, 212, 145))
    p1 = os.path.join(out_dir, "pt_phases.png")
    sheet.save(p1)
    print("Saved", p1)

    # Interactive Viewer UI screenshot (1280x720)
    page.set_viewport_size({"width": 1280, "height": 720})
    page.evaluate("""() => {
        window.__RENDER_API__.renderFrame({
            cam: { yaw: 0.0, pitch: 0.20, dist: 4.85, target: [-0.04, 0.02, 0.0] },
            progress: 0.68, globeAngleDeg: -16.0, flowTime: 10.4,
            bg: 'museum', hideHud: false, width: 1280, height: 720
        });
    }""")
    p2 = os.path.join(out_dir, "pt_viewer_ui.png")
    page.screenshot(path=p2)
    print("Saved", p2)


def encode_mp4(frames_iter, out_path, width=720, height=720, fps=24):
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{width}x{height}", "-pix_fmt", "rgb24",
        "-r", str(fps), "-i", "-",
        "-an", "-c:v", "libx264", "-profile:v", "high", "-level", "3.1",
        "-pix_fmt", "yuv420p", "-crf", "17", "-preset", "slow",
        "-movflags", "+faststart",
        out_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    n = 0
    for img in frames_iter:
        proc.stdin.write(img.tobytes())
        n += 1
        if n % 48 == 0:
            print(f"  {os.path.basename(out_path)}: {n} frames...", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", errors="ignore")
    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"ffmpeg failed ({ret}):\n{err}")
    print(f"Encoded {out_path} ({os.path.getsize(out_path) / 1024:.1f} KB)", flush=True)


def render_clips(page, supersample=1.0, only=None):
    fps = 24
    # Framed cleanly inside 720x720 with generous pure-black borders on all 4 edges!
    holo_cam = {"yaw": 0.0, "pitch": 0.20, "dist": 5.05, "target": [-0.11, 0.02, 0.0]}

    # 1) pt_extinction_full.mp4 (16.0s = 384 frames, gentle 22.5 deg/s = 1 full rotation across story!)
    if not only or only == "full":
        def gen_full():
            dur = 16.0
            n = int(dur * fps)
            for i in range(n):
                t = i / fps
                p = i / (n - 1)
                deg = -20.0 + (t / dur) * 360.0
                yield capture_pil(page, {
                    "cam": holo_cam, "progress": p, "globeAngleDeg": deg,
                    "flowTime": t, "bg": "holo", "hideHud": True,
                    "out_width": 720, "out_height": 720,
                }, supersample=supersample)
        encode_mp4(gen_full(), os.path.join(HERE, "pt_extinction_full.mp4"), 720, 720, fps)

    # 2) pt_extinction_turning.mp4 (15.0s = 360 frames, exact 72 deg/s = 3 turns for Holo Stage sync!)
    if not only or only == "turning":
        def gen_turning():
            dur = 15.0
            n = int(dur * fps)
            for i in range(n):
                t = i / fps
                p = i / (n - 1)
                deg = -20.0 + (t / 5.0) * 360.0
                yield capture_pil(page, {
                    "cam": holo_cam, "progress": p, "globeAngleDeg": deg,
                    "flowTime": t, "bg": "holo", "hideHud": True,
                    "out_width": 720, "out_height": 720,
                }, supersample=supersample)
        encode_mp4(gen_turning(), os.path.join(HERE, "pt_extinction_turning.mp4"), 720, 720, fps)

    # 3) pt_permian_idle_turning.mp4 (5.0s = 120 frames, exact 72 deg/s = 1 turn, seamless healthy loop!)
    if not only or only == "permian":
        def gen_permian_idle():
            dur = 5.0
            n = int(dur * fps)
            st = {"erupt": 0.0, "ash": 0.0, "greenhouse": 0.0, "warmth": 0.0, "tempNorm": 0.42}
            for i in range(n):
                t = i / fps
                deg = -20.0 + (t / dur) * 360.0
                yield capture_pil(page, {
                    "cam": holo_cam, "progress": 0.05, "globeAngleDeg": deg,
                    "flowTime": t, "stateOverride": st, "bg": "holo", "hideHud": True,
                    "out_width": 720, "out_height": 720,
                }, supersample=supersample)
        encode_mp4(gen_permian_idle(), os.path.join(HERE, "pt_permian_idle_turning.mp4"), 720, 720, fps)

    # 4) pt_aftermath_idle_turning.mp4 (5.0s = 120 frames, exact 72 deg/s = 1 turn, scorched greenhouse loop!)
    if not only or only == "aftermath":
        def gen_aftermath_idle():
            dur = 5.0
            n = int(dur * fps)
            st = {"erupt": 0.68, "ash": 0.0, "greenhouse": 1.0, "warmth": 1.0, "tempNorm": 0.96}
            for i in range(n):
                t = i / fps
                deg = -20.0 + (t / dur) * 360.0
                yield capture_pil(page, {
                    "cam": holo_cam, "progress": 0.95, "globeAngleDeg": deg,
                    "flowTime": t, "stateOverride": st, "bg": "holo", "hideHud": True,
                    "out_width": 720, "out_height": 720,
                }, supersample=supersample)
        encode_mp4(gen_aftermath_idle(), os.path.join(HERE, "pt_aftermath_idle_turning.mp4"), 720, 720, fps)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", type=str, default="")
    ap.add_argument("--clips", action="store_true")
    ap.add_argument("--only", type=str, default="", help="Render only one clip: full|turning|permian|aftermath")
    ap.add_argument("--ss", type=float, default=1.0)
    args = ap.parse_args()

    os.environ["XDG_CONFIG_HOME"] = "/tmp"
    os.environ["XDG_CACHE_HOME"] = "/tmp"

    httpd, port = start_server(HERE)
    url = f"http://127.0.0.1:{port}/index.html"
    chrome = find_chrome()
    launch_kw = {
        "headless": True,
        "args": ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    }
    if chrome:
        launch_kw["executable_path"] = chrome

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(**launch_kw)
            page = browser.new_page(viewport={"width": 1200, "height": 1200})
            page.on("pageerror", lambda err: print("PAGEERROR:", err, file=sys.stderr))
            page.on("console", lambda msg: print("CONSOLE:", msg.text, file=sys.stderr) if msg.type == "error" else None)
            page.goto(url, wait_until="networkidle")
            if args.inspect:
                render_inspect(page, args.inspect)
            if args.clips:
                render_clips(page, supersample=args.ss, only=args.only or None)
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()

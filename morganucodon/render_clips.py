#!/usr/bin/env python3
"""
Headless WebGL2 renderer for Morganucodon:
  - Drives morganucodon/index.html (which loads morganucodon/morganucodon.glb)
    via Playwright Chromium + SwiftShader WebGL2
  - Supports:
      --inspect   Render multi-angle & jump-phase contact sheets for visual QA
      --clips     Render 4 Holo Stage 720x720 24fps H.264 MP4 clips on pure black:
                    * morganucodon_idle_turning.mp4  (5.0s, 360 deg @ 72 deg/s)
                    * morganucodon_jump_turning.mp4  (5.0s, 360 deg @ 72 deg/s)
                    * morganucodon_idle.mp4          (5.0s, hero 3/4 view)
                    * morganucodon_jump.mp4          (3.0s, hero 3/4 view)
"""

import argparse
import base64
import functools
import http.server
import io
import os
import subprocess
import sys
import threading
import numpy as np
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


def start_static_server(root_dir):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root_dir)
    # Silence request logging
    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root_dir, **kwargs)
        def log_message(self, format, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
    port = httpd.server_address[1]
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd, port


def capture_frame_pil(page, opts, supersample=1.5):
    w_out = opts.get("out_width", 720)
    h_out = opts.get("out_height", 720)
    render_opts = dict(opts)
    rw = int(round(w_out * supersample))
    rh = int(round(h_out * supersample))
    render_opts["width"] = rw
    render_opts["height"] = rh
    data_url = page.evaluate("""(o) => {
        window.__RENDER_API__.renderFrame(o);
        return window.__RENDER_API__.getDataURL();
    }""", render_opts)
    raw = base64.b64decode(data_url.split(",", 1)[1])
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if rw != w_out or rh != h_out:
        img = img.resize((w_out, h_out), Image.LANCZOS)
    return img


def render_inspection_sheets(page, out_dir):
    os.makedirs(out_dir, exist_ok=True)

    # Sheet 1: Multi-angle anatomical inspection (Museum Exhibit lighting)
    views = [
        ("Hero 3/4",    {"cam": "hero",  "clip": "Idle", "time": 0.0, "stage": "museum"}),
        ("Side Profile",{"cam": "side",  "clip": "Idle", "time": 0.0, "stage": "museum"}),
        ("Front",       {"cam": "front", "clip": "Idle", "time": 0.0, "stage": "museum"}),
        ("Head Close",  {"cam": "head",  "clip": "Idle", "time": 0.0, "stage": "museum"}),
        ("Rear 3/4",    {"cam": {"yaw": 2.42, "pitch": 0.24, "dist": 2.40, "target": [0.0, 0.34, -0.34]}, "clip": "Idle", "time": 0.0, "stage": "museum"}),
        ("Holo View",   {"cam": "holo",  "clip": "Idle", "time": 0.0, "stage": "holo_rock"}),
    ]
    sheet1 = Image.new("RGB", (600 * 3, 600 * 2), (10, 10, 12))
    draw1 = ImageDraw.Draw(sheet1)
    for idx, (label, opts) in enumerate(views):
        opts = dict(opts, out_width=600, out_height=600, hideHud=True)
        im = capture_frame_pil(page, opts, supersample=2)
        cx, cy = (idx % 3) * 600, (idx // 3) * 600
        sheet1.paste(im, (cx, cy))
        draw1.rectangle([cx + 10, cy + 10, cx + 170, cy + 36], fill=(0, 0, 0))
        draw1.text((cx + 18, cy + 16), label, fill=(240, 210, 160))
    p1 = os.path.join(out_dir, "inspect_angles.png")
    sheet1.save(p1)
    print("Saved", p1)

    # Sheet 2: Jump biomechanics progression (Side + Hologram framing!)
    jump_times = [
        ("0.00s Rest",      0.00),
        ("0.60s Crouch",    0.60),
        ("0.82s Launch",    0.82),
        ("1.22s Apex",      1.22),
        ("1.52s Descent",   1.52),
        ("1.80s Landing",   1.80),
    ]
    sheet2 = Image.new("RGB", (600 * 3, 600 * 2), (0, 0, 0))
    draw2 = ImageDraw.Draw(sheet2)
    for idx, (label, t) in enumerate(jump_times):
        opts = {
            "cam": {"yaw": 1.38, "pitch": 0.14, "dist": 3.58, "target": [0.0, 0.45, -0.38]},
            "clip": "Jump", "time": t, "stage": "holo_rock",
            "out_width": 600, "out_height": 600, "hideHud": True,
        }
        im = capture_frame_pil(page, opts, supersample=2)
        cx, cy = (idx % 3) * 600, (idx // 3) * 600
        sheet2.paste(im, (cx, cy))
        draw2.rectangle([cx + 10, cy + 10, cx + 170, cy + 36], fill=(0, 0, 0))
        draw2.text((cx + 18, cy + 16), label, fill=(240, 210, 160))
    p2 = os.path.join(out_dir, "inspect_jump.png")
    sheet2.save(p2)
    print("Saved", p2)

    # Sheet 3: Viewer UI screenshot (1280x720)
    page.set_viewport_size({"width": 1280, "height": 720})
    page.evaluate("""() => {
        document.body.classList.remove('hud-hidden');
        window.__RENDER_API__.renderFrame({
            cam: 'hero', clip: 'Jump', time: 1.18, stage: 'museum',
            width: 1280, height: 720, hideHud: false
        });
    }""")
    p3 = os.path.join(out_dir, "inspect_viewer_ui.png")
    page.screenshot(path=p3)
    print("Saved", p3)


def encode_mp4(frames_iter, out_path, width=720, height=720, fps=24):
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "rgb24",
        "-r", str(fps),
        "-i", "-",
        "-an",
        "-c:v", "libx264",
        "-profile:v", "high",
        "-level", "3.1",
        "-pix_fmt", "yuv420p",
        "-crf", "17",
        "-preset", "slow",
        "-movflags", "+faststart",
        out_path,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    count = 0
    for img in frames_iter:
        proc.stdin.write(img.tobytes())
        count += 1
        if count % 24 == 0:
            print(f"  {os.path.basename(out_path)}: {count} frames...", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode("utf-8", errors="ignore")
    ret = proc.wait()
    if ret != 0:
        raise RuntimeError(f"ffmpeg failed ({ret}):\n{err}")
    sz = os.path.getsize(out_path) / 1024
    print(f"Encoded {out_path} ({sz:.1f} KB)")


def render_holo_clips(page, supersample=2):
    fps = 24
    holo_cam = {"yaw": 0.84, "pitch": 0.21, "dist": 3.55, "target": [0.0, 0.44, -0.36]}

    # 1) morganucodon_idle_turning.mp4 (5.0s, 120 frames, 360 deg @ 72 deg/s, seamless!)
    def gen_idle_turning():
        n = 5 * fps
        for i in range(n):
            t = i / fps
            deg = (t / 5.0) * 360.0
            yield capture_frame_pil(page, {
                "cam": holo_cam, "clip": "Idle", "time": t,
                "turntableDeg": deg, "stage": "holo_rock",
                "out_width": 720, "out_height": 720, "hideHud": True,
            }, supersample=supersample)
    encode_mp4(gen_idle_turning(), os.path.join(HERE, "morganucodon_idle_turning.mp4"), 720, 720, fps)

    # 2) morganucodon_jump_turning.mp4 (5.0s, 120 frames, 360 deg @ 72 deg/s)
    #    0.00 - 0.65s: Idle seamlessly crossfading into Jump
    #    0.65 - 3.45s: Full 2.80s Jump arc (rotated through hero side/3/4 angles!)
    #    3.45 - 5.00s: Seamless return to Idle matching t=0 at t=5.0s!
    def gen_jump_turning():
        n = 5 * fps
        j_start = 0.65
        j_dur = 2.80
        j_end = j_start + j_dur
        for i in range(n):
            t = i / fps
            deg = (t / 5.0) * 360.0
            if t < j_start:
                clip, ct, blend, dt_dust = "Idle", t, None, -1.0
                if t > j_start - 0.15:
                    w = (t - (j_start - 0.15)) / 0.15
                    clip, ct = "Jump", 0.0
                    blend = {"name": "Idle", "time": t, "weight": 1.0 - w}
            elif t <= j_end:
                clip, ct, blend, dt_dust = "Jump", t - j_start, None, t - j_start
            else:
                clip, ct, blend, dt_dust = "Idle", t, None, -1.0
                if t < j_end + 0.20:
                    w = (t - j_end) / 0.20
                    blend = {"name": "Jump", "time": j_dur, "weight": 1.0 - w}
            yield capture_frame_pil(page, {
                "cam": holo_cam, "clip": clip, "time": ct, "blend": blend,
                "dustTime": dt_dust, "turntableDeg": deg, "stage": "holo_rock",
                "out_width": 720, "out_height": 720, "hideHud": True,
            }, supersample=supersample)
    encode_mp4(gen_jump_turning(), os.path.join(HERE, "morganucodon_jump_turning.mp4"), 720, 720, fps)

    # 3) morganucodon_idle.mp4 (5.0s stationary hero 3/4 seamless loop)
    def gen_idle_static():
        n = 5 * fps
        for i in range(n):
            t = i / fps
            yield capture_frame_pil(page, {
                "cam": holo_cam, "clip": "Idle", "time": t,
                "turntableDeg": 0.0, "stage": "holo_rock",
                "out_width": 720, "out_height": 720, "hideHud": True,
            }, supersample=supersample)
    encode_mp4(gen_idle_static(), os.path.join(HERE, "morganucodon_idle.mp4"), 720, 720, fps)

    # 4) morganucodon_jump.mp4 (3.0s stationary hero 3/4 jump clip)
    def gen_jump_static():
        n = 3 * fps
        for i in range(n):
            t = i / fps
            jt = min(2.80, max(0.0, t - 0.08))
            yield capture_frame_pil(page, {
                "cam": holo_cam, "clip": "Jump", "time": jt,
                "dustTime": jt, "turntableDeg": 0.0, "stage": "holo_rock",
                "out_width": 720, "out_height": 720, "hideHud": True,
            }, supersample=supersample)
    encode_mp4(gen_jump_static(), os.path.join(HERE, "morganucodon_jump.mp4"), 720, 720, fps)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", type=str, default="", help="Output dir for QA inspection contact sheets")
    ap.add_argument("--clips", action="store_true", help="Render all 4 Holo Stage MP4 clips")
    ap.add_argument("--ss", type=float, default=1.5, help="Supersample factor (default 1.5 -> 1080x1080 downsampled to 720x720)")
    args = ap.parse_args()

    os.environ["XDG_CONFIG_HOME"] = "/tmp"
    os.environ["XDG_CACHE_HOME"] = "/tmp"

    httpd, port = start_static_server(HERE)
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
            page = browser.new_page(viewport={"width": 1440, "height": 1440})
            page.on("pageerror", lambda err: print("PAGEERROR:", err, file=sys.stderr))
            page.on("console", lambda msg: print("CONSOLE:", msg.text, file=sys.stderr) if msg.type == "error" else None)
            page.goto(url, wait_until="networkidle")
            page.evaluate("() => window.__RENDER_API__.ready")

            if args.inspect:
                render_inspection_sheets(page, args.inspect)
            if args.clips:
                render_holo_clips(page, supersample=args.ss)
            browser.close()
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    main()

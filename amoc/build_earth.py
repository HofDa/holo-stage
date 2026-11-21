#!/usr/bin/env python3
"""
Bakes the Earth texture used by the AMOC scene (amoc/earth.png) from Natural Earth
land polygons (world-atlas@2.0.2 land-50m.json, TopoJSON).

  python3 build_earth.py path/to/land-50m.json

earth.png is equirectangular, 2048x1024, lon -180..180 left to right, lat 90..-90 top to bottom:
  R  land mask (anti-aliased)
  G  soft coast field (wide blur of the mask): continental shelf tint offshore, coast glow
  B  narrow coast field (small blur of the mask): crisp coastline line in the shader
"""

import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
W, H = 2048, 1024
SS = 3  # supersampling for the rasterised mask


def decode_arcs(topo):
    tr = topo.get("transform")
    arcs = []
    for arc in topo["arcs"]:
        pts, x, y = [], 0, 0
        for p in arc:
            if tr:
                x += p[0]
                y += p[1]
                pts.append((x * tr["scale"][0] + tr["translate"][0], y * tr["scale"][1] + tr["translate"][1]))
            else:
                pts.append((p[0], p[1]))
        arcs.append(pts)
    return arcs


def ring_coords(ring, arcs):
    out = []
    for idx in ring:
        pts = arcs[idx] if idx >= 0 else arcs[~idx][::-1]
        out.extend(pts[1:] if out else pts)
    return out


def unwrap(ring):
    """Make longitudes continuous; returns (points, total lon drift)."""
    out = [list(ring[0])]
    for lon, lat in ring[1:]:
        prev = out[-1][0]
        while lon - prev > 180:
            lon -= 360
        while lon - prev < -180:
            lon += 360
        out.append([lon, lat])
    return out, out[-1][0] - out[0][0]


def to_px(lon, lat, w, h):
    return ((lon + 180.0) / 360.0 * w, (90.0 - lat) / 180.0 * h)


def draw_ring(draw, ring, fill, w, h):
    pts, drift = unwrap(ring)
    if abs(drift) > 180:  # ring encircles a pole (Antarctica): close it along the pole edge
        pole = -90.0 if np.mean([p[1] for p in pts]) < 0 else 90.0
        pts = pts + [[pts[-1][0], pole], [pts[0][0], pole]]
    for shift in (-360, 0, 360):  # copies so pieces wrapping the dateline land on the canvas
        draw.polygon([to_px(lon + shift, lat, w, h) for lon, lat in pts], fill=fill)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "land-50m.json")
    topo = json.load(open(src))
    arcs = decode_arcs(topo)
    w, h = W * SS, H * SS
    mask = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(mask)
    for geom in topo["objects"]["land"]["geometries"]:
        polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
        for poly in polys:
            draw_ring(d, ring_coords(poly[0], arcs), 255, w, h)
            for hole in poly[1:]:
                draw_ring(d, ring_coords(hole, arcs), 0, w, h)
    mask = mask.resize((W, H), Image.Resampling.LANCZOS)
    wide = mask.filter(ImageFilter.GaussianBlur(10))
    narrow = mask.filter(ImageFilter.GaussianBlur(1.6))
    out = Image.merge("RGB", (mask, wide, narrow))
    path = os.path.join(HERE, "earth.png")
    out.save(path, optimize=True)
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()

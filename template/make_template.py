"""Writes a 2-page A4 PDF for a 4-sided Pepper's ghost hologram pyramid.

Page 1: 1:1 cutting template, all four faces with every edge labelled.
Page 2: dimensioned drawing of one face + side view of the assembled pyramid.

Usage: python3 make_template.py [screen_short_side_mm] [tile_fraction] [hole_fraction]
Defaults: 14" laptop (173 mm short side) with Holo Stage Tile 40 % / Center hole 20 %.
"""
import math, sys

short = float(sys.argv[1]) if len(sys.argv) > 1 else 173.0
tile_f = float(sys.argv[2]) if len(sys.argv) > 2 else 0.40
hole_f = float(sys.argv[3]) if len(sys.argv) > 3 else 0.20

T, HOLE = short * tile_f, short * hole_f
b = HOLE                    # bottom edge (on the screen)
a = HOLE + 2 * T            # top edge
h = T * math.sqrt(2)        # trapezoid height (faces at 45 degrees)
o = (a - b) / 2
side = math.hypot(h, o)
ang_long = math.degrees(math.atan2(h, o))       # interior angle at the long (top) edge
ang_short = 180 - ang_long                      # interior angle at the short (screen) edge
H_ASSEMBLED = T
W, HP = 297.0, 210.0        # A4 landscape (mm)
PT = 72 / 25.4
GAP = 2.0
row_len = 2 * a - o + GAP
if row_len > W - 8 or 2 * h + GAP > HP - 8:
    sys.exit(f"Faces don't fit on A4: need {row_len:.0f} x {2*h+GAP:.0f} mm")

f1 = lambda v: f"{v:.1f}"


class Page:
    def __init__(self):
        self.ops = []

    def P(self, x, y):                       # mm, y from top  ->  PDF points
        return f"{x*PT:.2f} {(HP-y)*PT:.2f}"

    def color(self, g):
        self.ops.append(f"{g} {g} {g} RG {g} g")

    def poly(self, pts, width=0.6, close=True, dash=None):
        d = f"[{dash}] 0 d" if dash else "[] 0 d"
        path = self.P(*pts[0]) + " m " + " ".join(self.P(*q) + " l" for q in pts[1:])
        self.ops.append(f"{width} w {d} {path} {'h ' if close else ''}S")

    def line(self, p, q, width=0.35, dash=None):
        self.poly([p, q], width, close=False, dash=dash)

    def fill(self, pts):
        self.ops.append(self.P(*pts[0]) + " m " + " ".join(self.P(*q) + " l" for q in pts[1:]) + " h f")

    def text(self, x, y, s, size=8.0, angle=0.0, align="center", bold=False):
        """angle in degrees, counter-clockwise on the page; (x, y) is the anchor (baseline)."""
        s = s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        w = len(s) * size * 0.52 / PT
        shift = {"center": w / 2, "left": 0, "right": w}[align]
        c, sn = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        X, Y = x - shift * c, y + shift * sn         # move back along the baseline (y is down in mm)
        font = "/F2" if bold else "/F1"
        self.ops.append(f"BT {font} {size} Tf {c:.4f} {sn:.4f} {-sn:.4f} {c:.4f} {X*PT:.2f} {(HP-Y)*PT:.2f} Tm ({s}) Tj ET")

    def arrow(self, tip, toward, L=2.6, wdt=0.9):
        dx, dy = toward[0] - tip[0], toward[1] - tip[1]
        n = math.hypot(dx, dy); ux, uy = dx / n, dy / n
        bx, by = tip[0] + ux * L, tip[1] + uy * L
        self.fill([tip, (bx - uy * wdt, by + ux * wdt), (bx + uy * wdt, by - ux * wdt)])

    def dim(self, p, q, off, label, size=8.0, ext=True):
        """Dimension line parallel to p->q, shifted by `off` mm (sign picks the side)."""
        dx, dy = q[0] - p[0], q[1] - p[1]
        L = math.hypot(dx, dy)
        nx, ny = -dy / L, dx / L
        s = 1 if off >= 0 else -1
        P2 = (p[0] + nx * off, p[1] + ny * off)
        Q2 = (q[0] + nx * off, q[1] + ny * off)
        if ext and abs(off) > 0.1:
            for base in (p, q):
                self.line((base[0] + nx * s * 1.2, base[1] + ny * s * 1.2),
                          (base[0] + nx * (off + s * 1.8), base[1] + ny * (off + s * 1.8)), 0.25)
        self.line(P2, Q2, 0.3)
        self.arrow(P2, Q2); self.arrow(Q2, P2)
        ang = math.degrees(math.atan2(-dy, dx))
        if ang > 90: ang -= 180
        if ang <= -90: ang += 180
        # put the label on the outer side of the dimension line, upright
        mx, my = (P2[0] + Q2[0]) / 2, (P2[1] + Q2[1]) / 2
        ux, uy = math.sin(math.radians(ang)), math.cos(math.radians(ang))   # "up" direction of the text in mm coords
        ux, uy = -ux, -uy
        self.text(mx + ux * 1.4, my + uy * 1.4, label, size, ang)

    def stream(self):
        return "\n".join(["0 0 0 RG 0 0 0 rg"] + self.ops).encode()


def face_pts(x, y_top, wide_top=True):
    if wide_top:
        return [(x, y_top), (x + a, y_top), (x + a - o, y_top + h), (x + o, y_top + h)]
    return [(x, y_top + h), (x + a, y_top + h), (x + o + b, y_top), (x + o, y_top)]


def edge_label(pg, p, q, centroid, label, inset=3.2, size=7.0):
    """Label written along an edge, just inside the piece."""
    mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    dx, dy = q[0] - p[0], q[1] - p[1]
    L = math.hypot(dx, dy)
    nx, ny = -dy / L, dx / L
    if (centroid[0] - mx) * nx + (centroid[1] - my) * ny < 0:
        nx, ny = -nx, -ny
    ang = math.degrees(math.atan2(-dy, dx))
    if ang > 90: ang -= 180
    if ang <= -90: ang += 180
    # baseline sits further in, so the glyphs stay inside the piece
    up_x, up_y = -math.sin(math.radians(ang)), -math.cos(math.radians(ang))
    k = inset + (size * 0.35 / PT * 2.83 if (up_x * nx + up_y * ny) < 0 else 0)
    pg.text(mx + nx * k, my + ny * k, label, size, ang)


# ------------------------------------------------------------------ page 1: cutting template
p1 = Page()
x0 = (W - row_len) / 2
y0 = (HP - (2 * h + GAP)) / 2
n = 1
for r in range(2):
    yt = y0 + r * (h + GAP)
    for k, wide_top in enumerate((True, False)):
        x = x0 if k == 0 else x0 + a - o + GAP
        pts = face_pts(x, yt, wide_top)
        p1.color(0); p1.poly(pts, 0.6)
        cx = sum(p[0] for p in pts) / 4
        cy = yt + h / 2
        p1.color(0.15)
        p1.text(cx - 12, cy - 10, f"FACE {n}", 12, bold=True)
        p1.text(cx - 12, cy - 4, f"short {f1(b)} edge = screen side", 6.5)
        # every edge labelled with its length
        top_e = (pts[0], pts[1]) if wide_top else (pts[3], pts[2])
        bot_e = (pts[3], pts[2]) if wide_top else (pts[0], pts[1])
        edge_label(p1, *top_e, (cx, cy), f"{f1(a)} mm")
        edge_label(p1, *bot_e, (cx, cy), f"{f1(b)} mm")
        edge_label(p1, pts[1], pts[2], (cx, cy), f"{f1(side)} mm")
        edge_label(p1, pts[3], pts[0], (cx, cy), f"{f1(side)} mm")
        # height dimension through the middle
        p1.color(0.35)
        ty, by = (yt, yt + h)
        hx = cx + 10
        p1.line((hx, ty + 0.4), (hx, by - 0.4), 0.3, dash="1.5 1.5")
        p1.arrow((hx, ty + 0.4), (hx, by)); p1.arrow((hx, by - 0.4), (hx, ty))
        p1.text(hx + 2.5, cy + 1, f"height {f1(h)} mm", 7, align="left")
        p1.color(0.15)
        n += 1

p1.color(0)
x1 = x0 + a - o + GAP
for k, msg in enumerate(["PRINT AT 100 % / ACTUAL SIZE", "(not 'fit to page')", "Cut on the solid lines."]):
    d = 5 + 5 * k
    xl = x1 + o + b + o * d / h
    p1.text((xl + x1 + a) / 2 + 2, y0 + d, msg, 6.5, bold=(k == 0))
sx, sy = x0 + 3, y0 + 2 * h + GAP - 3
p1.line((sx, sy), (sx + 50, sy), 0.8)
for k in range(6):
    p1.line((sx + 10 * k, sy - 2), (sx + 10 * k, sy), 0.5)
p1.text(sx + 25, sy - 4, "scale check: 50 mm", 6)

# ------------------------------------------------------------------ page 2: dimensioned drawing
p2 = Page()
p2.text(12, 14, "Hologram pyramid - dimensions", 15, align="left", bold=True)
p2.text(12, 20.5, f"For a screen with a {f1(short)} mm short side  |  Holo Stage: Tile size {tile_f*100:.0f} %, Center hole {hole_f*100:.0f} %  |  all sizes in mm",
        8, align="left")

# one face, 1:1
fx, fy = 22, 42
F = face_pts(fx, fy, True)
p2.color(0); p2.poly(F, 0.8)
p2.color(0.2)
p2.dim(F[0], F[1], -7, f"top edge {f1(a)}", 9)
p2.dim(F[3], F[2], 7, f"bottom edge {f1(b)}", 9)
p2.text(fx + a / 2, F[3][1] + 13, "(sits on the screen)", 7.5)
# height: vertical dimension left of the face
hx = fx - 8
p2.line((fx - 1.2, fy), (hx - 1.8, fy), 0.25); p2.line((fx + o - 1.2, fy + h), (hx - 1.8, fy + h), 0.25)
p2.line((hx, fy), (hx, fy + h), 0.3); p2.arrow((hx, fy), (hx, fy + h)); p2.arrow((hx, fy + h), (hx, fy))
p2.text(hx - 1.6, fy + h / 2, f"height {f1(h)}", 9, angle=90)
p2.dim(F[1], F[2], -7, f"side {f1(side)}", 9)
p2.text(F[3][0] - 3.5, F[3][1] - 4, f"{ang_short:.1f} deg", 7.5, align="right")
p2.text(F[2][0] + 3.5, F[2][1] - 4, f"{ang_short:.1f} deg", 7.5, align="left")
p2.text(F[0][0] + 9, F[0][1] + 4.5, f"{ang_long:.1f} deg", 7.5, align="left")
p2.text(F[1][0] - 9, F[1][1] + 4.5, f"{ang_long:.1f} deg", 7.5, align="right")
p2.color(0.1)
p2.text(fx + a / 2, fy + h / 2 - 3, "FACE (cut 4x)", 12, bold=True)
p2.text(fx + a / 2, fy + h / 2 + 3, "scale 1:1", 8)

# side view of the assembled pyramid (scale 1:2)
s = 0.5
sx0, sy_screen = 210, 150
cxp = sx0 + 0
lb, rb = (cxp - b / 2 * s, sy_screen), (cxp + b / 2 * s, sy_screen)
lt, rt = (cxp - a / 2 * s, sy_screen - T * s), (cxp + a / 2 * s, sy_screen - T * s)
p2.color(0.55)
p2.line((cxp - 62, sy_screen), (cxp + 62, sy_screen), 1.6)
p2.text(cxp - 62, sy_screen + 4.5, "screen (lying flat)", 7.5, align="left")
p2.color(0)
p2.line(lb, lt, 0.9); p2.line(rb, rt, 0.9)
p2.line(lt, rt, 0.3, dash="1.5 1.5")
p2.color(0.2)
p2.text(cxp, sy_screen - T * s - 30, "SIDE VIEW (assembled, scale 1:2)", 9, bold=True)
p2.dim(lt, rt, -6, f"opening {f1(a)} x {f1(a)}", 8)
p2.dim(lb, rb, 9, f"{f1(b)} x {f1(b)}", 8)
p2.line((lt[0] - 1.2, lt[1]), (lt[0] - 12, lt[1]), 0.25)
vx = lt[0] - 10
p2.line((vx, rt[1]), (vx, rb[1]), 0.3); p2.arrow((vx, rt[1]), (vx, rb[1])); p2.arrow((vx, rb[1]), (vx, rt[1]))
p2.text(vx - 1.6, (rt[1] + rb[1]) / 2, f"height {f1(H_ASSEMBLED)}", 8, angle=90)
p2.text(rb[0] + 7, sy_screen - 2.5, "45 deg", 8, align="left")
p2.text(lb[0] - 7, sy_screen - 2.5, "45 deg", 8, align="right")
# viewer
p2.color(0.45)
p2.text(cxp + 64, sy_screen - T * s / 2 + 1, "viewer", 8, align="left")
p2.line((cxp + 62, sy_screen - T * s / 2), (rt[0] - 8, sy_screen - T * s / 2), 0.3, dash="1 1.5")
p2.arrow((rt[0] - 8, sy_screen - T * s / 2), (cxp + 62, sy_screen - T * s / 2))

# notes
p2.color(0)
notes = [
    "Material: clear PET / acrylic / overhead film, 0.5 - 2 mm (thinner = less double image).",
    "Cut 4 identical faces. Tape the slanted edges together on the outside with clear tape.",
    f"The short {f1(b)} mm edges form the small square opening; it sits on the yellow centre square",
    "  of the Holo Stage alignment guides. Each face sits over one blue tile.",
    "Use in a dark room, screen brightness at maximum, eyes level with the pyramid faces.",
]
for k, t in enumerate(notes):
    p2.text(12, 170 + k * 6.2, t, 8.5, align="left")

# ------------------------------------------------------------------ write PDF
pages = [p1, p2]
objs = {1: b"<< /Type /Catalog /Pages 2 0 R >>",
        3: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        4: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"}
kids = []
nxt = 5
for pg in pages:
    st = pg.stream()
    objs[nxt] = b"<< /Length %d >>\nstream\n" % len(st) + st + b"\nendstream"
    objs[nxt + 1] = (f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W*PT:.2f} {HP*PT:.2f}] /Contents {nxt} 0 R "
                     f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>").encode()
    kids.append(f"{nxt + 1} 0 R")
    nxt += 2
objs[2] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
out = bytearray(b"%PDF-1.4\n")
offs = {}
for i in sorted(objs):
    offs[i] = len(out)
    out += f"{i} 0 obj\n".encode() + objs[i] + b"\nendobj\n"
xref = len(out)
out += f"xref\n0 {nxt}\n0000000000 65535 f \n".encode()
out += b"".join(f"{offs[i]:010d} 00000 n \n".encode() for i in range(1, nxt))
out += f"trailer\n<< /Size {nxt} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
name = "pyramid_template_A4.pdf"
open(name, "wb").write(out)
print(f"{name}: top {a:.1f}  bottom {b:.1f}  height {h:.1f}  sides {side:.1f}  angles {ang_long:.1f}/{ang_short:.1f}")

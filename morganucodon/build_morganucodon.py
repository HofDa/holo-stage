#!/usr/bin/env python3
"""
Procedural 3D asset builder for a naturalistic, rigged, animated Morganucodon
(Late Triassic - Early Jurassic early mammaliaform, ~205 Ma).

Outputs:
  morganucodon/morganucodon.glb

Features:
  - Continuous high-resolution sculpted organic body (snout, orbital sockets,
    eyelids, skull, neck, ribcage, tucked lumbar waist, muscular rump, ringed tail)
  - Separate sculpted anatomical ears, glossy nocturnal eyes, moist rhinarium,
    delicate 3D whiskers, 4 muscular limbs with 5-toed paws & curved claws,
    and subtle volumetric fur-clump tufts along cheeks/nape/spine/flanks/haunches
  - 26-bone hierarchical skeleton with smooth normalized 4-bone skinning
  - Procedural 2048x2048 PBR textures (anisotropic combed agouti fur albedo with
    countershading & baked AO, tangent-space normal map, metallic-roughness map)
  - Two baked keyframe animations with analytical 2-bone ground-contact IK:
      0: "Jump" (2.8s dynamic crouch -> explosive launch -> parabolic leap -> cushioned landing -> settle)
      1: "Idle" (5.0s seamless breathing, inquisitive sniffing, ear flicks, tail sway)
"""

import io
import json
import math
import os
import struct
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_GLB = os.path.join(OUT_DIR, "morganucodon.glb")


# =============================================================================
# Math utilities
# =============================================================================

def clamp(x, a, b):
    return a if x < a else (b if x > b else x)


def smoothstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smootherstep(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def lerp(a, b, t):
    return a + (b - a) * t


def normalize(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else np.array([0.0, 1.0, 0.0], dtype=np.float64)


def euler_xyz_to_quat(rx, ry, rz):
    """Intrinsic/extrinsic XYZ rotation -> glTF quaternion [x, y, z, w].
    Applies Rx, then Ry, then Rz: R = Rz * Ry * Rx."""
    cx, sx = math.cos(rx * 0.5), math.sin(rx * 0.5)
    cy, sy = math.cos(ry * 0.5), math.sin(ry * 0.5)
    cz, sz = math.cos(rz * 0.5), math.sin(rz * 0.5)
    w = cz * cy * cx + sz * sy * sx
    x = cz * cy * sx - sz * sy * cx
    y = cz * sy * cx + sz * cy * sx
    z = sz * cy * cx - cz * sy * sx
    q = np.array([x, y, z, w], dtype=np.float64)
    return q / np.linalg.norm(q)


def quat_mul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ], dtype=np.float64)


def quat_to_mat3(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w),     2 * (x * z + y * w)],
        [2 * (x * y + z * w),     1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w),     2 * (y * z + x * w),     1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)


def quat_from_two_vectors(u, v):
    """Shortest-arc quaternion rotating unit vector u onto unit vector v."""
    u = normalize(u)
    v = normalize(v)
    d = float(np.dot(u, v))
    if d > 0.999999:
        return np.array([0.0, 0.0, 0.0, 1.0], dtype=np.float64)
    if d < -0.999999:
        axis = np.cross(np.array([1.0, 0.0, 0.0]), u)
        if np.linalg.norm(axis) < 1e-4:
            axis = np.cross(np.array([0.0, 1.0, 0.0]), u)
        axis = normalize(axis)
        return np.array([axis[0], axis[1], axis[2], 0.0], dtype=np.float64)
    c = np.cross(u, v)
    s = math.sqrt((1.0 + d) * 2.0)
    invs = 1.0 / s
    q = np.array([c[0] * invs, c[1] * invs, c[2] * invs, s * 0.5], dtype=np.float64)
    return q / np.linalg.norm(q)


def quat_from_mat3(m):
    """Convert 3x3 rotation matrix to glTF quaternion [x, y, z, w]."""
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0.0:
        s = math.sqrt(tr + 1.0) * 2.0
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2.0
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2.0
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2.0
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    q = np.array([x, y, z, w], dtype=np.float64)
    return q / np.linalg.norm(q)


def catmull_rom_eval(pts, t_norm):
    """Evaluate smooth Catmull-Rom spline through list of 3D points for t in [0, 1]."""
    n = len(pts)
    u = clamp(t_norm, 0.0, 1.0) * (n - 1)
    i = min(int(math.floor(u)), n - 2)
    f = u - i
    p0 = pts[max(0, i - 1)]
    p1 = pts[i]
    p2 = pts[i + 1]
    p3 = pts[min(n - 1, i + 2)]
    f2 = f * f
    f3 = f2 * f
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * f
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * f2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * f3
    )


def interp_curve(xs, ys, x):
    """Smooth piecewise Hermite-like (Catmull/linear) interpolation on sorted xs."""
    return float(np.interp(x, xs, ys))


# =============================================================================
# Skeleton Definition (26 Bones, glTF Y-up, +Z forward, +X left)
# =============================================================================

JOINTS = [
    # idx, name, parent, rest world position [x, y, z]
    (0,  "root",        -1, [0.0,    0.255, -0.220]),
    (1,  "spine_mid",    0, [0.0,    0.285, -0.075]),
    (2,  "chest",        1, [0.0,    0.275,  0.075]),
    (3,  "neck",         2, [0.0,    0.305,  0.185]),
    (4,  "head",         3, [0.0,    0.350,  0.285]),
    (5,  "jaw",          4, [0.0,    0.312,  0.350]),
    (6,  "ear_L",        4, [0.068,  0.415,  0.248]),
    (7,  "ear_R",        4, [-0.068, 0.415,  0.248]),
    (8,  "arm_L_upper",  2, [0.088,  0.242,  0.095]),
    (9,  "arm_L_lower",  8, [0.112,  0.155,  0.032]),
    (10, "paw_L",        9, [0.100,  0.038,  0.115]),
    (11, "arm_R_upper",  2, [-0.088, 0.242,  0.095]),
    (12, "arm_R_lower", 11, [-0.112, 0.155,  0.032]),
    (13, "paw_R",       12, [-0.100, 0.038,  0.115]),
    (14, "leg_L_thigh",  0, [0.092,  0.262, -0.275]),
    (15, "leg_L_shin",  14, [0.128,  0.178, -0.165]),
    (16, "foot_L",      15, [0.112,  0.068, -0.315]),
    (17, "leg_R_thigh",  0, [-0.092, 0.262, -0.275]),
    (18, "leg_R_shin",  17, [-0.128, 0.178, -0.165]),
    (19, "foot_R",      18, [-0.112, 0.068, -0.315]),
    (20, "tail_0",       0, [0.0,    0.225, -0.440]),
    (21, "tail_1",      20, [0.0,    0.165, -0.625]),
    (22, "tail_2",      21, [0.0,    0.120, -0.825]),
    (23, "tail_3",      22, [0.0,    0.105, -1.035]),
    (24, "tail_4",      23, [0.0,    0.122, -1.250]),
    (25, "tail_5",      24, [0.0,    0.158, -1.445]),
]

JOINT_BY_NAME = {name: idx for idx, name, _, _ in JOINTS}
JOINT_POS = np.array([pos for _, _, _, pos in JOINTS], dtype=np.float64)
JOINT_PARENT = [p for _, _, p, _ in JOINTS]
JOINT_CHILDREN = [[] for _ in JOINTS]
for _i, _, _p, _ in JOINTS:
    if _p >= 0:
        JOINT_CHILDREN[_p].append(_i)


# =============================================================================
# Mesh Builder Helpers
# =============================================================================

class MeshBuilder:
    def __init__(self):
        self.positions = []
        self.normals = []
        self.uvs = []
        self.joints = []
        self.weights = []
        self.indices = []

    def add_submesh(self, pos, uv, tris, j_idx, j_w, custom_normals=None, flip_check_centers=None):
        """Append a submesh, auto-computing smooth area-weighted vertex normals."""
        pos = np.asarray(pos, dtype=np.float64)
        uv = np.asarray(uv, dtype=np.float64)
        tris = np.asarray(tris, dtype=np.int32)
        j_idx = np.asarray(j_idx, dtype=np.uint8)
        j_w = np.asarray(j_w, dtype=np.float64)

        # Normalize weights
        ws = j_w.sum(axis=1, keepdims=True)
        ws = np.where(ws > 1e-8, ws, 1.0)
        j_w = j_w / ws

        if custom_normals is not None:
            nrm = np.asarray(custom_normals, dtype=np.float64)
        else:
            nrm = np.zeros_like(pos)
            p0 = pos[tris[:, 0]]
            p1 = pos[tris[:, 1]]
            p2 = pos[tris[:, 2]]
            fn = np.cross(p1 - p0, p2 - p0)
            np.add.at(nrm, tris[:, 0], fn)
            np.add.at(nrm, tris[:, 1], fn)
            np.add.at(nrm, tris[:, 2], fn)

            # Optional outward orientation verification
            if flip_check_centers is not None:
                centers = np.asarray(flip_check_centers, dtype=np.float64)
                dots = np.sum(nrm * (pos - centers), axis=1)
                if np.mean(dots) < 0:
                    tris = tris[:, [0, 2, 1]]
                    nrm = -nrm

            lens = np.linalg.norm(nrm, axis=1, keepdims=True)
            nrm = np.where(lens > 1e-12, nrm / np.maximum(lens, 1e-12), np.array([0.0, 1.0, 0.0]))

        base = len(self.positions)
        self.positions.extend(pos.tolist())
        self.normals.extend(nrm.tolist())
        self.uvs.extend(uv.tolist())
        self.joints.extend(j_idx.tolist())
        self.weights.extend(j_w.tolist())
        self.indices.extend((tris + base).reshape(-1).tolist())


def compute_body_spine_weights(z_vals):
    """Smooth overlapping bone weights along the head-neck-torso-tail axis."""
    # Spine bone z-anchors ordered nose -> tail
    anchors = [
        (4,  0.380, 0.14),   # head
        (3,  0.200, 0.095),  # neck
        (2,  0.075, 0.125),  # chest
        (1, -0.075, 0.125),  # spine_mid
        (0, -0.250, 0.145),  # root / pelvis
        (20, -0.440, 0.13),  # tail_0
        (21, -0.625, 0.13),  # tail_1
        (22, -0.825, 0.14),  # tail_2
        (23, -1.035, 0.15),  # tail_3
        (24, -1.250, 0.15),  # tail_4
        (25, -1.460, 0.16),  # tail_5
    ]
    n = len(z_vals)
    j_idx = np.zeros((n, 4), dtype=np.uint8)
    j_w = np.zeros((n, 4), dtype=np.float64)
    for k, z in enumerate(z_vals):
        if z >= 0.285:
            # Rigid cranium & snout on head bone (slight blend near back of skull)
            b_neck = smoothstep(0.32, 0.22, z) * 0.35
            j_idx[k, 0], j_w[k, 0] = 4, 1.0 - b_neck
            if b_neck > 1e-4:
                j_idx[k, 1], j_w[k, 1] = 3, b_neck
            continue
        scores = []
        for bone_i, bz, sig in anchors:
            d = (z - bz) / sig
            w = math.exp(-0.5 * d * d)
            if w > 1e-4:
                scores.append((w, bone_i))
        scores.sort(reverse=True)
        scores = scores[:4]
        tot = sum(w for w, _ in scores)
        for slot, (w, bi) in enumerate(scores):
            j_idx[k, slot] = bi
            j_w[k, slot] = w / tot
    return j_idx, j_w


# =============================================================================
# 1. Unified Sculpted Head-Neck-Torso-Tail Mesh
# =============================================================================

def build_body_mesh(mb: MeshBuilder):
    """
    Build one continuous high-resolution organic mesh from nose tip to tail tip.
    UV region: U in [0.02, 0.98] (0.50 = dorsal spine, 0.02/0.98 = belly seam),
               V in [0.02, 0.64] (0.02 = nose tip, 0.64 = tail tip).
    """
    # Spine centerline samples from nose (+0.575) to tail tip (-1.56)
    # Denser sampling on head, neck, torso, tail root
    z_head = np.linspace(0.575, 0.20, 36, endpoint=False)
    z_torso = np.linspace(0.20, -0.44, 42, endpoint=False)
    z_tail = np.linspace(-0.44, -1.56, 38)
    z_arr = np.concatenate([z_head, z_torso, z_tail])

    # Spine centerline Y curve (z descending from nose to tail -> reverse for np.interp)
    z_ctrl = np.array([-1.56, -1.42, -1.25, -1.03, -0.82, -0.62, -0.44, -0.34, -0.22, -0.08,  0.07,  0.18,  0.26,  0.34,  0.44,  0.53,  0.575])
    y_ctrl = np.array([0.168,  0.145, 0.118, 0.104, 0.118, 0.162, 0.225, 0.262, 0.285, 0.290, 0.276, 0.305, 0.350, 0.354, 0.344, 0.336, 0.342])

    # Half-width Rx along spine (classic sleek scansorial mammal proportions)
    rx_ctrl = np.array([0.005, 0.011, 0.016, 0.021, 0.026, 0.034, 0.052, 0.120, 0.128, 0.106, 0.118, 0.080, 0.095, 0.090, 0.062, 0.038, 0.006])
    # Dorsal height above centerline
    ryt_ctrl = np.array([0.005, 0.011, 0.016, 0.021, 0.026, 0.034, 0.052, 0.126, 0.140, 0.128, 0.118, 0.084, 0.093, 0.082, 0.049, 0.028, 0.006])
    # Ventral depth below centerline
    ryb_ctrl = np.array([0.005, 0.011, 0.016, 0.021, 0.026, 0.033, 0.050, 0.112, 0.112, 0.114, 0.128, 0.080, 0.080, 0.072, 0.049, 0.029, 0.006])

    n_rings = len(z_arr)
    n_seg = 52  # circumferential resolution (includes duplicate seam vertex at j = n_seg)

    # Smooth tangents along centerline
    y_arr = np.interp(z_arr, z_ctrl, y_ctrl)
    # Apply subtle smoothing to centerline y
    kernel = np.array([0.15, 0.2, 0.3, 0.2, 0.15])
    y_pad = np.pad(y_arr, 2, mode='edge')
    y_arr = np.convolve(y_pad, kernel, mode='valid')

    pts_center = np.stack([np.zeros(n_rings), y_arr, z_arr], axis=1)

    # Smooth Rx, Ryt, Ryb
    rx_arr = np.interp(z_arr, z_ctrl, rx_ctrl)
    ryt_arr = np.interp(z_arr, z_ctrl, ryt_ctrl)
    ryb_arr = np.interp(z_arr, z_ctrl, ryb_ctrl)
    for arr in (rx_arr, ryt_arr, ryb_arr):
        pad = np.pad(arr, 2, mode='edge')
        arr[:] = np.convolve(pad, kernel, mode='valid')
    # Preserve sharp tapered nose & tail tips
    rx_arr[0], ryt_arr[0], ryb_arr[0] = 0.0012, 0.0012, 0.0012
    rx_arr[-1], ryt_arr[-1], ryb_arr[-1] = 0.0015, 0.0015, 0.0015

    # Compute cumulative arc length for even UV V-parameterization
    diffs = np.diff(pts_center, axis=0)
    seg_lens = np.linalg.norm(diffs, axis=1)
    arc = np.concatenate([[0.0], np.cumsum(seg_lens)])
    arc_norm = arc / arc[-1]

    # Allocate grid vertices: (n_rings, n_seg + 1)
    verts = []
    uvs = []
    centers = []
    z_vert = []
    # Also store body surface points for later fur-tuft placement
    body_ring_data = []

    # Eye socket centers for sculpting orbital indentations
    eye_L = np.array([0.072, 0.376, 0.365])
    eye_R = np.array([-0.072, 0.376, 0.365])

    for i in range(n_rings):
        c = pts_center[i]
        z = z_arr[i]
        # Tangent pointing nose -> tail (approx -Z)
        if i == 0:
            T = normalize(pts_center[1] - pts_center[0])
        elif i == n_rings - 1:
            T = normalize(pts_center[-1] - pts_center[-2])
        else:
            T = normalize(pts_center[i + 1] - pts_center[i - 1])
        # Keep U aligned with world +Y projected perpendicular to T
        world_up = np.array([0.0, 1.0, 0.0])
        R = normalize(np.cross(T, world_up))  # points +X (creature left)
        U = normalize(np.cross(R, T))         # points +Y (dorsal)

        rx = rx_arr[i]
        ryt = ryt_arr[i]
        ryb = ryb_arr[i]

        # UV V maps head+torso [0.02..0.46] and tail [0.46..0.64] for maximum head/body texel density
        if z >= -0.44:
            v_uv = 0.02 + 0.44 * ((0.575 - z) / (0.575 - (-0.44)))
        else:
            v_uv = 0.46 + 0.18 * ((-0.44 - z) / (-0.44 - (-1.56)))

        ring_pts = []
        for j in range(n_seg + 1):
            # theta: -pi (belly) -> 0 (dorsal) -> +pi (belly), so U=0.50 is exact dorsal spine!
            frac = j / n_seg
            theta = (frac - 0.5) * 2.0 * math.pi  # -pi .. +pi
            ct = math.cos(theta)  # +1 at dorsal, -1 at belly
            st = math.sin(theta)  # +1 at left (+X), -1 at right (-X)

            # Base asymmetric oval (distinct dorsal vs ventral fullness)
            ry = ryt if ct >= 0.0 else ryb

            # Anatomical cross-section sculpting:
            r_scale_x = 1.0
            r_scale_y = 1.0

            # 1) Snout sculpting (z in 0.36 .. 0.56):
            #    Slightly flatter dorsal bridge, fuller whisker pads on sides, slender tucked jaw underneath
            if 0.35 < z < 0.57:
                w_snout = smoothstep(0.35, 0.42, z) * smoothstep(0.57, 0.51, z)
                # Whisker pad cheek puff at lower-lateral angles
                pad = math.exp(-((abs(theta) - 1.85) / 0.52) ** 2)
                r_scale_x += 0.18 * w_snout * pad
                # Slight flat nasal bridge
                bridge = max(0.0, ct) ** 4
                r_scale_y -= 0.07 * w_snout * bridge
                # Subtle mouth crease between upper lip and slender mandible
                if ct < -0.15:
                    jaw_narrow = smoothstep(-0.15, -0.75, ct)
                    r_scale_x -= 0.24 * w_snout * jaw_narrow
                    crease = math.exp(-((abs(theta) - 2.38) / 0.16) ** 2)
                    r_scale_x -= 0.09 * w_snout * crease
                    r_scale_y -= 0.06 * w_snout * crease

            # 2) Cranium dome & zygomatic cheek fullness (z in 0.21 .. 0.37)
            if 0.20 < z < 0.38:
                w_cran = smoothstep(0.20, 0.26, z) * smoothstep(0.38, 0.32, z)
                # Slightly fuller cheekbones below the eyes
                cheek = math.exp(-((abs(theta) - 1.75) / 0.50) ** 2)
                r_scale_x += 0.11 * w_cran * cheek
                # Gentle brow ridges above eyes
                brow = math.exp(-((abs(theta) - 0.65) / 0.32) ** 2)
                r_scale_y += 0.06 * w_cran * brow

            # 3) Ribcage & muscular haunch cross-section (z in -0.40 .. 0.16)
            if -0.42 < z < 0.18:
                w_body = smoothstep(-0.42, -0.34, z) * smoothstep(0.18, 0.10, z)
                # Subtle dorsal spine fullness & slightly flatter ribcage sides
                pear = math.exp(-((abs(theta) - 2.05) / 0.65) ** 2)
                r_scale_x += 0.06 * w_body * pear
                # Haunch / hip muscular flare
                w_hip = math.exp(-((z - (-0.30)) / 0.095) ** 2)
                hip_bulge = math.exp(-((abs(theta) - 1.65) / 0.58) ** 2)
                r_scale_x += 0.13 * w_hip * hip_bulge
                # Shoulder scapular contour
                w_sh = math.exp(-((z - 0.085) / 0.075) ** 2)
                sh_bulge = math.exp(-((abs(theta) - 1.30) / 0.55) ** 2)
                r_scale_x += 0.09 * w_sh * sh_bulge

                # Subtle organic fur-clump relief so silhouette isn't mathematically sterile
                fur_wave = (
                    0.018 * math.sin(z * 42.0 + math.cos(theta * 3.0) * 1.4)
                    + 0.012 * math.cos(theta * 7.0 + z * 28.0)
                ) * w_body * (0.4 + 0.6 * max(0.0, ct + 0.3))
                r_scale_x += fur_wave
                r_scale_y += fur_wave

            # 4) Tail subtle scaly-annulation rings (z < -0.46)
            if z < -0.46:
                w_tail = smoothstep(-0.46, -0.54, z) * smoothstep(-1.55, -1.45, z)
                annul = 0.032 * math.sin(z * 145.0) * w_tail
                r_scale_x += annul
                r_scale_y += annul

            px = st * rx * r_scale_x
            py = ct * ry * r_scale_y
            p = c + px * R + py * U

            # 5) Orbital socket indentation around both eyes (smooth concave depression)
            if 0.31 < z < 0.42:
                for ec in (eye_L, eye_R):
                    d_eye = np.linalg.norm(p - ec)
                    if d_eye < 0.038:
                        # Push inward toward cranium midline inside socket, subtle raised rim outside
                        if d_eye < 0.025:
                            push = 0.013 * math.cos((d_eye / 0.025) * math.pi * 0.5) ** 2
                            inward = normalize(np.array([0.0, 0.355, 0.355]) - p)
                            p = p + inward * push
                        else:
                            # Subtle raised orbital rim / eyelid ridge
                            t_rim = (d_eye - 0.025) / 0.013
                            ridge = 0.0035 * math.sin(t_rim * math.pi)
                            outward = normalize(p - np.array([0.0, 0.355, 0.355]))
                            p = p + outward * ridge

            verts.append(p)
            centers.append(c)
            z_vert.append(z)
            u_uv = 0.02 + 0.96 * frac
            uvs.append([u_uv, v_uv])
            if j < n_seg:
                ring_pts.append((p, c, theta, u_uv, v_uv))

        body_ring_data.append((z, ring_pts))

    # Build quad triangles with outward CCW winding
    # At theta = 0 (top), j increasing -> +R (+X), i increasing -> +T (-Z).
    # (+X) x (-Z) = +Y (outward!). So (v00, v01, v11) and (v00, v11, v10).
    stride = n_seg + 1
    tris = []
    for i in range(n_rings - 1):
        for j in range(n_seg):
            v00 = i * stride + j
            v01 = i * stride + (j + 1)
            v10 = (i + 1) * stride + j
            v11 = (i + 1) * stride + (j + 1)
            tris.append([v00, v01, v11])
            tris.append([v00, v11, v10])

    # Cap nose tip and tail tip
    nose_tip_idx = len(verts)
    verts.append(pts_center[0] + np.array([0.0, 0.0, 0.003]))
    centers.append(pts_center[0])
    z_vert.append(z_arr[0])
    uvs.append([0.50, 0.02])
    for j in range(n_seg):
        tris.append([nose_tip_idx, j + 1, j])

    tail_tip_idx = len(verts)
    verts.append(pts_center[-1] + np.array([0.0, 0.002, -0.006]))
    centers.append(pts_center[-1])
    z_vert.append(z_arr[-1])
    uvs.append([0.50, 0.64])
    last_base = (n_rings - 1) * stride
    for j in range(n_seg):
        tris.append([tail_tip_idx, last_base + j, last_base + j + 1])

    j_idx, j_w = compute_body_spine_weights(z_vert)

    # Lower jaw bone subtle influence on ventral anterior snout
    for k, p in enumerate(verts):
        if p[2] > 0.35 and p[1] < 0.322:
            wj = smoothstep(0.35, 0.40, p[2]) * smoothstep(0.322, 0.305, p[1]) * 0.72
            if wj > 0.02:
                j_idx[k] = [4, 5, 0, 0]
                j_w[k] = [1.0 - wj, wj, 0.0, 0.0]

    mb.add_submesh(verts, uvs, tris, j_idx, j_w, flip_check_centers=centers)
    return body_ring_data


# =============================================================================
# 2. Sculpted Moist Rhinarium (Nose Tip)
# =============================================================================

def build_nose_mesh(mb: MeshBuilder):
    """Fleshy moist rhinarium with subtle nostril indents & philtrum cleft.
    UV region: U in [0.05, 0.17], V in [0.87, 0.97]."""
    center = np.array([0.0, 0.341, 0.562])
    nu, nv = 24, 16
    verts, uvs, centers = [], [], []
    for iv in range(nv + 1):
        phi = (iv / nv) * math.pi  # 0 (front +Z) to pi (back -Z)
        for iu in range(nu + 1):
            th = (iu / nu) * 2.0 * math.pi
            sp, cp = math.sin(phi), math.cos(phi)
            st, ct = math.sin(th), math.cos(th)
            # Slightly wider horizontally, gently flattened top, cleft at bottom-front
            rx = 0.022
            ry = 0.017
            rz = 0.019
            # Nostril indents on front-sides
            nx = sp * st
            ny = sp * ct
            nz = cp
            r_mod = 1.0
            for sgn in (-1.0, 1.0):
                dn = math.sqrt((nx - sgn * 0.52) ** 2 + (ny + 0.06) ** 2 + (nz - 0.78) ** 2)
                if dn < 0.34:
                    r_mod -= 0.22 * math.cos((dn / 0.34) * math.pi * 0.5) ** 2
            # Subtle philtrum cleft
            if ny < -0.1 and nz > 0.2:
                r_mod -= 0.12 * math.exp(-(nx / 0.15) ** 2) * smoothstep(0.2, 0.7, nz)

            p = center + np.array([nx * rx * r_mod, ny * ry * r_mod, nz * rz * r_mod])
            verts.append(p)
            centers.append(center)
            uvs.append([0.05 + 0.12 * (iu / nu), 0.87 + 0.10 * (iv / nv)])

    tris = []
    stride = nu + 1
    for iv in range(nv):
        for iu in range(nu):
            v00 = iv * stride + iu
            v01 = v00 + 1
            v10 = v00 + stride
            v11 = v10 + 1
            tris.append([v00, v10, v11])
            tris.append([v00, v11, v01])

    n = len(verts)
    j_idx = np.zeros((n, 4), dtype=np.uint8)
    j_w = np.zeros((n, 4), dtype=np.float64)
    j_idx[:, 0] = JOINT_BY_NAME["head"]
    j_w[:, 0] = 1.0
    mb.add_submesh(verts, uvs, tris, j_idx, j_w, flip_check_centers=centers)


# =============================================================================
# 3. Nocturnal Glossy Eyes & Sculpted Eyelid Rims
# =============================================================================

def build_eyes_and_lids(mb: MeshBuilder):
    """Build both glossy dark eyes and tight anatomical eyelid rims."""
    head_idx = JOINT_BY_NAME["head"]
    for side in (1.0, -1.0):
        # Eyeball sitting cleanly in orbital socket
        ec = np.array([side * 0.068, 0.376, 0.365])
        # Aim pupil slightly outward & forward (nocturnal mammal gaze)
        gaze = normalize(np.array([side * 0.68, 0.08, 0.72]))
        up_ref = np.array([0.0, 1.0, 0.0])
        right_ax = normalize(np.cross(up_ref, gaze))
        up_ax = normalize(np.cross(gaze, right_ax))

        nu, nv = 24, 16
        r_eye = 0.0235
        verts, uvs, centers = [], [], []
        for iv in range(nv + 1):
            phi = (iv / nv) * math.pi  # 0 = pupil pole along gaze
            for iu in range(nu + 1):
                th = (iu / nu) * 2.0 * math.pi
                d = (
                    math.cos(phi) * gaze
                    + math.sin(phi) * math.cos(th) * right_ax
                    + math.sin(phi) * math.sin(th) * up_ax
                )
                verts.append(ec + d * r_eye)
                centers.append(ec)
                # Eye UV region: U in [0.20, 0.34], V in [0.87, 0.97]
                # Center of iris/pupil at (0.27, 0.92), radial mapping from phi!
                rad_uv = min(1.0, phi / (math.pi * 0.65))
                u = 0.27 + 0.065 * rad_uv * math.cos(th)
                v = 0.92 + 0.048 * rad_uv * math.sin(th)
                uvs.append([u, v])

        tris = []
        stride = nu + 1
        for iv in range(nv):
            for iu in range(nu):
                v00 = iv * stride + iu
                v01 = v00 + 1
                v10 = v00 + stride
                v11 = v10 + 1
                tris.append([v00, v10, v11])
                tris.append([v00, v11, v01])

        n = len(verts)
        j_idx = np.zeros((n, 4), dtype=np.uint8)
        j_w = np.zeros((n, 4), dtype=np.float64)
        j_idx[:, 0] = head_idx
        j_w[:, 0] = 1.0
        mb.add_submesh(verts, uvs, tris, j_idx, j_w, flip_check_centers=centers)

        # Sculpted fleshy eyelid torus hugging the eye opening tightly
        n_maj, n_min = 28, 10
        R_maj = 0.0226
        r_min = 0.0046
        lid_verts, lid_uvs, lid_centers = [], [], []
        for i in range(n_maj + 1):
            a = (i / n_maj) * 2.0 * math.pi
            # Almond-shaped eye opening (slightly wider horizontally)
            ring_dir = math.cos(a) * right_ax * 1.05 + math.sin(a) * up_ax * 0.93
            ring_center = ec + gaze * 0.0042 + ring_dir * R_maj
            rad_out = normalize(ring_dir)
            for j in range(n_min + 1):
                b = (j / n_min) * 2.0 * math.pi
                p = ring_center + (math.cos(b) * rad_out + math.sin(b) * gaze) * r_min
                lid_verts.append(p)
                lid_centers.append(ring_center)
                # Dark umber eyelid UV island: U in [0.06, 0.14], V in [0.87, 0.95] (dark rim)
                lid_uvs.append([0.37 + 0.05 * (i / n_maj), 0.87 + 0.05 * (j / n_min)])

        lid_tris = []
        s2 = n_min + 1
        for i in range(n_maj):
            for j in range(n_min):
                v00 = i * s2 + j
                v01 = v00 + 1
                v10 = v00 + s2
                v11 = v10 + 1
                lid_tris.append([v00, v01, v11])
                lid_tris.append([v00, v11, v10])

        n2 = len(lid_verts)
        ji2 = np.zeros((n2, 4), dtype=np.uint8)
        jw2 = np.zeros((n2, 4), dtype=np.float64)
        ji2[:, 0] = head_idx
        jw2[:, 0] = 1.0
        mb.add_submesh(lid_verts, lid_uvs, lid_tris, ji2, jw2, flip_check_centers=lid_centers)


# =============================================================================
# 4. Sculpted Cupped Ears (Pinnae)
# =============================================================================

def build_ears(mb: MeshBuilder):
    """Build anatomical thin rounded-oval cupped early-mammal ears.
    Outer furred surface maps to U in [0.46, 0.62], V in [0.87, 0.98].
    Inner pinkish-taupe concave surface maps to U in [0.64, 0.80], V in [0.87, 0.98]."""
    head_idx = JOINT_BY_NAME["head"]

    for side, ear_name in ((1.0, "ear_L"), (-1.0, "ear_R")):
        ear_idx = JOINT_BY_NAME[ear_name]
        root = JOINT_POS[ear_idx].copy()

        # Local ear frame:
        #   e_up: up & outward & slightly back
        #   e_fwd: forward & outward (where the concave inner ear faces!)
        #   e_lat: lateral width axis across ear scoop
        e_up = normalize(np.array([side * 0.50, 0.84, -0.18]))
        e_fwd = normalize(np.array([side * 0.56, -0.14, 0.82]))
        e_lat = normalize(np.cross(e_up, e_fwd))
        e_fwd = normalize(np.cross(e_lat, e_up))

        # Construct ear as a thick closed organic leaf/cup via polar grid (inner + outer shells joined at rolled rim)
        n_rad = 14
        n_ang = 26
        # Ear dimensions: modest rounded shrew/tree-shrew pinna
        ear_len = 0.088
        ear_wid = 0.062

        def ear_outline(ang):
            """Rounded oval ear profile centered on root; ang=0 is tip, ang=+-pi is base."""
            # Shift shape so base sits at origin and tip extends along e_up
            u_l = 0.5 * (1.0 + math.cos(ang))  # 0 at base, 1 at tip
            w_l = math.sin(ang) * (0.85 + 0.25 * math.sin(u_l * math.pi))
            return u_l, w_l

        # Parameterize as closed shell: v_ring from 0 (inner center) -> 1 (rim) -> 2 (outer center)
        n_shell = 2 * n_rad
        verts, uvs, centers, j_idx_list, j_w_list = [], [], [], [], []
        for ir in range(n_shell + 1):
            is_inner = ir <= n_rad
            if is_inner:
                rho = ir / n_rad  # 0 (center of concha) .. 1 (rim)
            else:
                rho = (n_shell - ir) / n_rad  # 1 (rim) .. 0 (center of back)

            for ia in range(n_ang + 1):
                ang = (ia / n_ang) * 2.0 * math.pi
                # Radial shape around center of ear (at u_l = 0.48, w_l = 0)
                # Center shifted along e_up
                dir_u = math.cos(ang)  # +1 tip, -1 base
                dir_w = math.sin(ang)  # +-1 sides

                # Slightly wider toward upper-mid ear, narrower near skull base
                u_norm = 0.46 + 0.54 * rho * dir_u
                w_scale = 0.72 + 0.32 * smoothstep(0.0, 0.65, u_norm)
                w_norm = rho * dir_w * w_scale

                # Cupping curvature: inner bowl recedes backward (-e_fwd), rim curls gently forward
                cup = -0.017 * (1.0 - rho * rho)
                # Rim thickness: thicker near base, delicate rolled helix at outer edge
                half_thick = 0.0055 * (1.0 - 0.55 * smoothstep(0.0, 0.9, u_norm))
                # Soft smooth profile across the rim
                if is_inner:
                    # Bulge slightly forward on inner face
                    t_off = half_thick * math.sqrt(max(0.0, 1.0 - rho ** 4))
                    # Subtle inner tragus ridge near lower bowl
                    tragus = 0.004 * math.exp(-((u_norm - 0.25) / 0.16) ** 2 - (w_norm / 0.35) ** 2)
                    fwd_off = cup + t_off + tragus
                else:
                    t_off = -half_thick * math.sqrt(max(0.0, 1.0 - rho ** 4))
                    fwd_off = cup + t_off

                # Slight natural backward sweep at the very tip (clamped non-negative!)
                tip_curl = -0.009 * (max(0.0, u_norm) ** 2.2)

                # Embed base slightly into skull
                p = (
                    root
                    + e_up * (u_norm * ear_len - 0.010)
                    + e_lat * (w_norm * ear_wid * 0.5)
                    + e_fwd * (fwd_off + tip_curl)
                )
                c_ref = (
                    root
                    + e_up * (u_norm * ear_len - 0.010)
                    + e_lat * (w_norm * ear_wid * 0.5)
                    + e_fwd * (cup + tip_curl)
                )
                verts.append(p)
                centers.append(c_ref)

                # UV mapping: inner vs outer ear islands
                u_loc = clamp(0.5 + 0.46 * w_norm, 0.02, 0.98)
                v_loc = clamp(u_norm, 0.02, 0.98)
                if is_inner and rho < 0.92:
                    uvs.append([0.64 + 0.16 * u_loc, 0.87 + 0.11 * v_loc])
                else:
                    uvs.append([0.46 + 0.16 * u_loc, 0.87 + 0.11 * v_loc])

                # Smooth weight blend from head at base -> ear bone along pinna
                w_ear = smoothstep(0.05, 0.38, u_norm)
                j_idx_list.append([ear_idx, head_idx, 0, 0])
                j_w_list.append([w_ear, 1.0 - w_ear, 0.0, 0.0])

        tris = []
        stride = n_ang + 1
        for ir in range(n_shell):
            for ia in range(n_ang):
                v00 = ir * stride + ia
                v01 = v00 + 1
                v10 = v00 + stride
                v11 = v10 + 1
                tris.append([v00, v01, v11])
                tris.append([v00, v11, v10])

        mb.add_submesh(verts, uvs, tris, j_idx_list, j_w_list, flip_check_centers=centers)


# =============================================================================
# 5. Four Muscular Limbs, 5-Toed Paws & Curved Keratin Claws
# =============================================================================

def add_lofted_tube(
    mb: MeshBuilder,
    pts_curve,
    radii_x,
    radii_y,
    uv_u_range,
    uv_v_range,
    bone_segments,
    n_seg=18,
    cap_start=True,
    cap_end=True,
    flatten_bottom_y=None,
):
    """Generic smooth anatomical tube loft along a 3D polyline with bone weights."""
    pts = np.asarray(pts_curve, dtype=np.float64)
    n_rings = len(pts)
    rx_arr = np.asarray(radii_x, dtype=np.float64)
    ry_arr = np.asarray(radii_y, dtype=np.float64)

    # Parallel-transport orthonormal frames to avoid twist artifacts
    tangents = []
    for i in range(n_rings):
        if i == 0:
            t = normalize(pts[1] - pts[0])
        elif i == n_rings - 1:
            t = normalize(pts[-1] - pts[-2])
        else:
            t = normalize(pts[i + 1] - pts[i - 1])
        tangents.append(t)

    # Initial frame
    t0 = tangents[0]
    ref = np.array([0.0, 0.0, 1.0]) if abs(t0[2]) < 0.85 else np.array([1.0, 0.0, 0.0])
    n0 = normalize(np.cross(t0, ref))
    b0 = normalize(np.cross(t0, n0))
    frames = [(n0, b0)]
    for i in range(1, n_rings):
        t_prev, t_cur = tangents[i - 1], tangents[i]
        q = quat_from_two_vectors(t_prev, t_cur)
        R = quat_to_mat3(q)
        n_cur = normalize(R @ frames[-1][0])
        b_cur = normalize(np.cross(t_cur, n_cur))
        frames.append((n_cur, b_cur))

    verts, uvs, centers, j_idx_l, j_w_l = [], [], [], [], []
    u0, u1 = uv_u_range
    v0, v1 = uv_v_range

    for i in range(n_rings):
        frac_s = i / max(1, n_rings - 1)
        c = pts[i]
        ax_n, ax_b = frames[i]
        # Compute bone weights by segment parameter frac_s
        scores = []
        for bone_i, s_center, sig in bone_segments:
            d = (frac_s - s_center) / sig
            w = math.exp(-0.5 * d * d)
            if w > 1e-4:
                scores.append((w, bone_i))
        scores.sort(reverse=True)
        scores = scores[:4]
        tot = sum(w for w, _ in scores)
        ji = [0, 0, 0, 0]
        jw = [0.0, 0.0, 0.0, 0.0]
        for slot, (w, bi) in enumerate(scores):
            ji[slot] = bi
            jw[slot] = w / tot

        for j in range(n_seg + 1):
            frac_a = j / n_seg
            th = frac_a * 2.0 * math.pi
            p = c + (math.cos(th) * rx_arr[i]) * ax_n + (math.sin(th) * ry_arr[i]) * ax_b
            if flatten_bottom_y is not None and p[1] < flatten_bottom_y:
                p = p.copy()
                p[1] = flatten_bottom_y + 0.001
            verts.append(p)
            centers.append(c)
            uvs.append([lerp(u0, u1, frac_a), lerp(v0, v1, frac_s)])
            j_idx_l.append(ji)
            j_w_l.append(jw)

    stride = n_seg + 1
    tris = []
    for i in range(n_rings - 1):
        for j in range(n_seg):
            v00 = i * stride + j
            v01 = v00 + 1
            v10 = v00 + stride
            v11 = v10 + 1
            tris.append([v00, v11, v01])
            tris.append([v00, v10, v11])

    if cap_start:
        ci = len(verts)
        verts.append(pts[0] - tangents[0] * (rx_arr[0] * 0.35))
        centers.append(pts[0])
        uvs.append([0.5 * (u0 + u1), v0])
        j_idx_l.append(j_idx_l[0])
        j_w_l.append(j_w_l[0])
        for j in range(n_seg):
            tris.append([ci, j, j + 1])

    if cap_end:
        ci = len(verts)
        verts.append(pts[-1] + tangents[-1] * (rx_arr[-1] * 0.45))
        centers.append(pts[-1])
        uvs.append([0.5 * (u0 + u1), v1])
        j_idx_l.append(j_idx_l[(n_rings - 1) * stride])
        j_w_l.append(j_w_l[(n_rings - 1) * stride])
        lb = (n_rings - 1) * stride
        for j in range(n_seg):
            tris.append([ci, lb + j + 1, lb + j])

    mb.add_submesh(verts, uvs, tris, j_idx_l, j_w_l, flip_check_centers=centers)


def build_limbs_and_paws(mb: MeshBuilder):
    """Build all four muscular limbs, flattened 5-toed paws, and tiny curved keratin claws."""
    chest_idx = JOINT_BY_NAME["chest"]
    root_idx = JOINT_BY_NAME["root"]

    # ---- FORELIMBS ----
    for side, pfx in ((1.0, "L"), (-1.0, "R")):
        b_up = JOINT_BY_NAME[f"arm_{pfx}_upper"]
        b_lo = JOINT_BY_NAME[f"arm_{pfx}_lower"]
        b_pw = JOINT_BY_NAME[f"paw_{pfx}"]

        p_sh = JOINT_POS[b_up]
        p_el = JOINT_POS[b_lo]
        p_wr = JOINT_POS[b_pw]
        # Flared shoulder root embedded smoothly inside chest
        p_root = p_sh + np.array([-side * 0.038, 0.042, -0.008])
        p_palm = np.array([side * 0.102, 0.014, 0.145])

        ctrl = [
            p_root,
            p_sh,
            lerp(p_sh, p_el, 0.5) + np.array([side * 0.006, 0.004, -0.004]),
            p_el,
            lerp(p_el, p_wr, 0.5) + np.array([side * 0.002, 0.002, 0.004]),
            p_wr,
            p_palm,
        ]
        n_s = 26
        curve = [catmull_rom_eval(ctrl, k / (n_s - 1)) for k in range(n_s)]
        s_t = np.linspace(0.0, 1.0, n_s)
        # Muscular upper arm -> defined elbow -> lean tapered forearm -> flattened paw
        rx_ctrl = np.array([0.056, 0.048, 0.036, 0.025, 0.022, 0.019, 0.026])
        ry_ctrl = np.array([0.064, 0.052, 0.038, 0.027, 0.022, 0.017, 0.014])
        t_ctrl = np.linspace(0.0, 1.0, len(rx_ctrl))
        rx = np.interp(s_t, t_ctrl, rx_ctrl)
        ry = np.interp(s_t, t_ctrl, ry_ctrl)

        # Limb UV band: V in [0.66, 0.83], furred top -> fine paw fur -> pinkish toes at bottom
        u_band = (0.03, 0.23) if side > 0 else (0.26, 0.46)
        add_lofted_tube(
            mb, curve, rx, ry, u_band, (0.66, 0.82),
            bone_segments=[
                (chest_idx, 0.02, 0.11),
                (b_up,      0.26, 0.18),
                (b_lo,      0.66, 0.18),
                (b_pw,      0.96, 0.13),
            ],
            n_seg=18,
            flatten_bottom_y=0.001,
        )

        # 5 delicate splayed fore-digits + curved claws
        toe_specs = [
            # (angle_deg_from_fwd, length, radius, side_offset)
            (-42.0 * side, 0.026, 0.0052, -side * 0.014),  # thumb / inner digit I
            (-18.0 * side, 0.036, 0.0054, -side * 0.007),  # digit II
            (  2.0 * side, 0.040, 0.0056,  0.000),         # digit III (longest)
            ( 20.0 * side, 0.036, 0.0053,  side * 0.008),  # digit IV
            ( 40.0 * side, 0.028, 0.0048,  side * 0.014),  # digit V
        ]
        for ang_deg, tlen, trad, xoff in toe_specs:
            ang = math.radians(ang_deg)
            d_dir = np.array([math.sin(ang), 0.0, math.cos(ang)])
            t0 = p_palm + np.array([xoff, -0.003, 0.006])
            t1 = t0 + d_dir * (tlen * 0.48) + np.array([0.0, 0.002, 0.0])
            t2 = t0 + d_dir * tlen + np.array([0.0, -0.004, 0.0])
            t2[1] = max(0.0055, t2[1])
            t_curve = [catmull_rom_eval([t0, t1, t2], k / 5.0) for k in range(6)]
            t_r = np.linspace(trad * 1.15, trad * 0.68, 6)
            add_lofted_tube(
                mb, t_curve, t_r, t_r * 0.85,
                (0.03, 0.23), (0.81, 0.845),  # pinkish-taupe skin toes
                bone_segments=[(b_pw, 0.5, 1.0)],
                n_seg=10,
                flatten_bottom_y=0.0005,
            )
            # Tiny curved keratin claw touching Y=0
            c0 = t2 - d_dir * 0.002 + np.array([0.0, 0.001, 0.0])
            c1 = t2 + d_dir * 0.008 + np.array([0.0, -0.001, 0.0])
            c2 = t2 + d_dir * 0.015 + np.array([0.0, -0.0052, 0.0])
            c2[1] = max(0.0004, c2[1])
            c_curve = [catmull_rom_eval([c0, c1, c2], k / 4.0) for k in range(5)]
            c_r = np.array([trad * 0.52, trad * 0.42, trad * 0.30, trad * 0.18, 0.0008])
            add_lofted_tube(
                mb, c_curve, c_r * 0.72, c_r,
                (0.83, 0.90), (0.87, 0.95),  # keratin claw UV island
                bone_segments=[(b_pw, 0.5, 1.0)],
                n_seg=8,
            )

    # ---- HINDLIMBS (Longer, muscular, springy jumping legs!) ----
    for side, pfx in ((1.0, "L"), (-1.0, "R")):
        b_th = JOINT_BY_NAME[f"leg_{pfx}_thigh"]
        b_sh = JOINT_BY_NAME[f"leg_{pfx}_shin"]
        b_ft = JOINT_BY_NAME[f"foot_{pfx}"]

        p_hip = JOINT_POS[b_th]
        p_kn = JOINT_POS[b_sh]
        p_an = JOINT_POS[b_ft]
        # Broad flared haunch embedded cleanly into pelvis/rump
        p_root = p_hip + np.array([-side * 0.042, 0.032, -0.015])
        p_sole = np.array([side * 0.108, 0.015, -0.215])

        ctrl = [
            p_root,
            p_hip + np.array([side * 0.008, 0.005, -0.008]),
            lerp(p_hip, p_kn, 0.52) + np.array([side * 0.012, 0.006, 0.008]),
            p_kn,
            lerp(p_kn, p_an, 0.42) + np.array([side * 0.004, 0.006, -0.012]),  # gastrocnemius calf belly
            p_an,
            lerp(p_an, p_sole, 0.50) + np.array([0.0, -0.006, 0.006]),
            p_sole,
        ]
        n_s = 30
        curve = [catmull_rom_eval(ctrl, k / (n_s - 1)) for k in range(n_s)]
        s_t = np.linspace(0.0, 1.0, n_s)
        # Powerful pear-shaped jumping thigh -> knee -> muscular calf -> lean ankle/calcaneus -> elongated foot
        rx_ctrl = np.array([0.072, 0.068, 0.054, 0.036, 0.032, 0.021, 0.022, 0.028])
        ry_ctrl = np.array([0.088, 0.082, 0.064, 0.040, 0.034, 0.024, 0.016, 0.014])
        t_ctrl = np.linspace(0.0, 1.0, len(rx_ctrl))
        rx = np.interp(s_t, t_ctrl, rx_ctrl)
        ry = np.interp(s_t, t_ctrl, ry_ctrl)

        u_band = (0.52, 0.72) if side > 0 else (0.75, 0.96)
        add_lofted_tube(
            mb, curve, rx, ry, u_band, (0.66, 0.82),
            bone_segments=[
                (root_idx, 0.02, 0.12),
                (b_th,     0.25, 0.17),
                (b_sh,     0.58, 0.16),
                (b_ft,     0.90, 0.16),
            ],
            n_seg=20,
            flatten_bottom_y=0.001,
        )

        # 5 longer springy splayed hind digits + curved claws
        toe_specs = [
            (-36.0 * side, 0.034, 0.0056, -side * 0.015),
            (-15.0 * side, 0.048, 0.0058, -side * 0.007),
            (  3.0 * side, 0.054, 0.0060,  0.000),
            ( 19.0 * side, 0.049, 0.0057,  side * 0.008),
            ( 37.0 * side, 0.037, 0.0052,  side * 0.015),
        ]
        for ang_deg, tlen, trad, xoff in toe_specs:
            ang = math.radians(ang_deg)
            d_dir = np.array([math.sin(ang), 0.0, math.cos(ang)])
            t0 = p_sole + np.array([xoff, -0.003, 0.010])
            t1 = t0 + d_dir * (tlen * 0.50) + np.array([0.0, 0.0025, 0.0])
            t2 = t0 + d_dir * tlen + np.array([0.0, -0.0045, 0.0])
            t2[1] = max(0.0058, t2[1])
            t_curve = [catmull_rom_eval([t0, t1, t2], k / 5.0) for k in range(6)]
            t_r = np.linspace(trad * 1.15, trad * 0.68, 6)
            add_lofted_tube(
                mb, t_curve, t_r, t_r * 0.85,
                (0.52, 0.72), (0.81, 0.845),
                bone_segments=[(b_ft, 0.5, 1.0)],
                n_seg=10,
                flatten_bottom_y=0.0005,
            )
            c0 = t2 - d_dir * 0.002 + np.array([0.0, 0.001, 0.0])
            c1 = t2 + d_dir * 0.009 + np.array([0.0, -0.001, 0.0])
            c2 = t2 + d_dir * 0.018 + np.array([0.0, -0.0055, 0.0])
            c2[1] = max(0.0004, c2[1])
            c_curve = [catmull_rom_eval([c0, c1, c2], k / 4.0) for k in range(5)]
            c_r = np.array([trad * 0.54, trad * 0.44, trad * 0.30, trad * 0.18, 0.0009])
            add_lofted_tube(
                mb, c_curve, c_r * 0.72, c_r,
                (0.83, 0.90), (0.87, 0.95),
                bone_segments=[(b_ft, 0.5, 1.0)],
                n_seg=8,
            )


# =============================================================================
# 6. Delicate 3D Whiskers (Mystacial & Superciliary Vibrissae)
# =============================================================================

def build_whiskers(mb: MeshBuilder):
    """Add delicate curving tapered whiskers fanning from the snout & brow."""
    head_idx = JOINT_BY_NAME["head"]
    rng = np.random.RandomState(42)

    for side in (1.0, -1.0):
        # 7 mystacial whiskers per side in two staggered rows
        for row in range(2):
            for col in range(4 if row == 0 else 3):
                z0 = 0.495 - col * 0.022 + row * 0.007
                y0 = 0.335 - row * 0.011 - col * 0.002
                x0 = side * (0.031 + col * 0.0065)
                length = (0.115 + col * 0.022 - row * 0.012) * rng.uniform(0.92, 1.08)
                sweep_back = -0.35 - col * 0.14 + rng.uniform(-0.05, 0.05)
                droop = -0.14 - row * 0.10 + rng.uniform(-0.04, 0.04)

                p0 = np.array([x0, y0, z0])
                p1 = p0 + np.array([side * length * 0.45, length * (0.04 + droop * 0.25), length * sweep_back * 0.35])
                p2 = p0 + np.array([side * length * 0.85, length * droop * 0.72, length * sweep_back * 0.80])
                p3 = p0 + np.array([side * length * 1.05, length * droop * 1.15, length * sweep_back * 1.15])
                curve = [catmull_rom_eval([p0, p1, p2, p3], k / 6.0) for k in range(7)]
                r = np.linspace(0.0018, 0.00045, 7)
                add_lofted_tube(
                    mb, curve, r, r,
                    (0.92, 0.98), (0.87, 0.95),  # silvery-ivory whisker island
                    bone_segments=[(head_idx, 0.5, 1.0)],
                    n_seg=6,
                    cap_start=False,
                    cap_end=True,
                )

        # 2 short superciliary brow whiskers above each eye
        for k in range(2):
            p0 = np.array([side * (0.054 + k * 0.006), 0.402, 0.378 - k * 0.012])
            p1 = p0 + np.array([side * 0.024, 0.022, -0.008])
            p2 = p0 + np.array([side * 0.045, 0.028, -0.024])
            curve = [catmull_rom_eval([p0, p1, p2], j / 4.0) for j in range(5)]
            r = np.linspace(0.0014, 0.0004, 5)
            add_lofted_tube(
                mb, curve, r, r,
                (0.92, 0.98), (0.87, 0.95),
                bone_segments=[(head_idx, 0.5, 1.0)],
                n_seg=5,
                cap_start=False,
                cap_end=True,
            )


# =============================================================================
# 7. Sculpted Volumetric Fur-Tuft Locks (Breaks Silhouette Naturally!)
# =============================================================================

def build_fur_tufts(mb: MeshBuilder, body_ring_data):
    """
    Place ~260 subtle tapered solid fur-clump locks emerging at low grazing angles
    along the nape, spine crest, cheeks, shoulders, flanks, rump, and belly fringe.
    Each tuft inherits exact underlying UV coordinates and smooth body normals so
    there are zero alpha-sorting artifacts in any glTF viewer, while breaking up the
    silhouette with genuine naturalistic fur softness!
    """
    rng = np.random.RandomState(1337)
    verts = []
    norms = []
    uvs = []
    tris = []
    z_list = []

    def add_tuft(base_p, surf_n, flow_dir, side_dir, length, width, thickness, u_uv, v_uv, z_val):
        """Sleek, flat-lying 3D fur-wisp lock hugging the coat silhouette naturally."""
        v0 = len(verts)
        # Sink root cleanly into body so tufts flow smoothly out of the coat
        b = base_p - surf_n * (thickness * 0.65)
        mid = b + flow_dir * (length * 0.52) + surf_n * (thickness * 0.72)
        tip = b + flow_dir * length + surf_n * (thickness * 0.14)

        p_bl = b - side_dir * (width * 0.5)
        p_br = b + side_dir * (width * 0.5)
        p_bt = b + surf_n * (thickness * 0.65)
        p_ml = mid - side_dir * (width * 0.30) - surf_n * (thickness * 0.25)
        p_mr = mid + side_dir * (width * 0.30) - surf_n * (thickness * 0.25)
        p_mt = mid + surf_n * (thickness * 0.18)

        pts = [p_bl, p_br, p_bt, p_ml, p_mr, p_mt, tip]
        # Inherit underlying coat normal strongly so tufts merge seamlessly with zero bright facets
        n_base = normalize(surf_n * 0.92 + flow_dir * 0.08)
        n_left = normalize(surf_n * 0.84 - side_dir * 0.20 + flow_dir * 0.08)
        n_right = normalize(surf_n * 0.84 + side_dir * 0.20 + flow_dir * 0.08)
        n_tip = normalize(surf_n * 0.80 + flow_dir * 0.30)
        n_list = [n_left, n_right, n_base, n_left, n_right, n_base, n_tip]

        v_tip = clamp(v_uv + 0.010, 0.02, 0.64)
        uv_list = [
            [u_uv, v_uv], [u_uv, v_uv], [u_uv, v_uv],
            [u_uv, lerp(v_uv, v_tip, 0.5)], [u_uv, lerp(v_uv, v_tip, 0.5)], [u_uv, lerp(v_uv, v_tip, 0.5)],
            [u_uv, v_tip],
        ]

        verts.extend(pts)
        norms.extend(n_list)
        uvs.extend(uv_list)
        z_list.extend([z_val] * 7)

        local_tris = [
            [0, 2, 5], [0, 5, 3],
            [2, 1, 4], [2, 4, 5],
            [1, 0, 3], [1, 3, 4],
            [3, 5, 6], [5, 4, 6], [4, 3, 6],
        ]
        centroid = np.mean(pts, axis=0)
        for a, bb, c in local_tris:
            pa, pb, pc = pts[a], pts[bb], pts[c]
            fn = np.cross(pb - pa, pc - pa)
            fc = (pa + pb + pc) / 3.0 - centroid
            if np.dot(fn, fc) < 0:
                tris.append([v0 + a, v0 + c, v0 + bb])
            else:
                tris.append([v0 + a, v0 + bb, v0 + c])

    # Walk body rings and seed sleek velvety fur locks along cheek ruffs, nape, back & flanks
    for r_idx, (z, ring_pts) in enumerate(body_ring_data):
        if z > 0.32 or z < -0.48:
            continue
        if r_idx % 2 != 0:
            continue
        n_ring = len(ring_pts)
        for j in range(n_ring):
            p, c, theta, u_uv, v_uv = ring_pts[j]
            is_cheek = (0.16 < z < 0.31) and (1.30 < abs(theta) < 2.35)
            is_dorsal = (-0.44 < z < 0.24) and (abs(theta) < 0.55)
            is_flank = (-0.42 < z < 0.14) and (0.55 <= abs(theta) <= 2.65)

            prob = 0.0
            if is_dorsal:
                prob = 0.30
            elif is_cheek:
                prob = 0.42
            elif is_flank:
                prob = 0.16
            if rng.rand() > prob:
                continue

            surf_n = normalize(p - c)
            back = np.array([0.0, -0.06 if abs(theta) > 1.3 else -0.02, -1.0])
            flow = back - np.dot(back, surf_n) * surf_n
            if np.linalg.norm(flow) < 1e-4:
                continue
            flow = normalize(flow)
            side_d = normalize(np.cross(surf_n, flow))

            scale = 1.0
            if is_cheek:
                scale = 0.68
            elif z < -0.35:
                scale = 0.65
            length = rng.uniform(0.028, 0.048) * scale
            width = rng.uniform(0.011, 0.018) * scale
            thick = rng.uniform(0.0042, 0.0072) * scale

            add_tuft(p, surf_n, flow, side_d, length, width, thick, u_uv, v_uv, z)

    if verts:
        j_idx, j_w = compute_body_spine_weights(z_list)
        mb.add_submesh(verts, uvs, tris, j_idx, j_w, custom_normals=norms)


# =============================================================================
# 8. Procedural High-Resolution PBR Textures (2048x2048 Albedo, Normal, MR)
# =============================================================================

def value_noise_2d(h, w, gh, gw, seed):
    """Fast tiled smooth bilinear value noise on a (h, w) numpy grid."""
    rng = np.random.RandomState(seed)
    grid = rng.rand(gh + 1, gw + 1).astype(np.float32)
    grid[-1, :] = grid[0, :]
    grid[:, -1] = grid[:, 0]
    ys = np.linspace(0, gh, h, endpoint=False).astype(np.float32)
    xs = np.linspace(0, gw, w, endpoint=False).astype(np.float32)
    y0 = np.floor(ys).astype(np.int32)
    x0 = np.floor(xs).astype(np.int32)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3.0 - 2.0 * fy)
    fx = fx * fx * (3.0 - 2.0 * fx)
    g00 = grid[y0[:, None], x0[None, :]]
    g10 = grid[y0[:, None], (x0 + 1)[None, :]]
    g01 = grid[(y0 + 1)[:, None], x0[None, :]]
    g11 = grid[(y0 + 1)[:, None], (x0 + 1)[None, :]]
    top = g00 * (1.0 - fx[None, :]) + g10 * fx[None, :]
    bot = g01 * (1.0 - fx[None, :]) + g11 * fx[None, :]
    return top * (1.0 - fy[:, None]) + bot * fy[:, None]


def generate_pbr_textures(size=2048):
    """
    Generate museum-grade naturalistic PBR maps:
      - albedo_png: 2048x2048 RGB (combed agouti fur, countershading, dorsal band,
                    face mask, subtle mottling, inner ear pink, glossy iris, claws)
      - normal_png: 2048x2048 RGB tangent-space normal map matching fur & tail rings
      - mr_png:     1024x1024 RGB metallic-roughness (G=roughness, B=metallic)
    """
    H = W = size
    u = np.linspace(0.0, 1.0, W, dtype=np.float32)[None, :]  # (1, W)
    v = np.linspace(0.0, 1.0, H, dtype=np.float32)[:, None]  # (H, 1)

    # Anisotropic combed fur noise (stretched vertically along V = head-to-tail hair flow!)
    # Add gentle organic wave warp to U so fur strands follow natural curves
    warp = (value_noise_2d(H, W, 16, 16, 11) - 0.5) * 0.018
    u_w = np.clip(u + warp, 0.0, 1.0)

    # Multi-scale hair strand fields: high frequency across U, stretched along V
    fur_fine = value_noise_2d(H, W, 54, 420, 101)
    fur_med = value_noise_2d(H, W, 28, 220, 102)
    fur_guard = value_noise_2d(H, W, 85, 520, 103)
    fur_clump = value_noise_2d(H, W, 22, 48, 104)
    mottle = value_noise_2d(H, W, 12, 16, 105)

    # Combine into a crisp hair-height & agouti-ticking field
    hair_h = 0.45 * fur_fine + 0.35 * fur_med + 0.20 * fur_clump
    # Agouti ticking: occasional pale-ochre guard hair tips & deep umber undercoat streaks
    tick_bright = np.clip((fur_guard - 0.62) * 2.6, 0.0, 1.0)
    tick_dark = np.clip((0.36 - fur_fine) * 2.4, 0.0, 1.0)

    # ---- Base color canvas (float32 RGB in 0..1) ----
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    height = np.full((H, W), 0.5, dtype=np.float32)
    rough = np.full((H, W), 0.84, dtype=np.float32)

    # =========================================================================
    # REGION 1: BODY & TAIL (v in 0.00 .. 0.65)
    # U=0.50 is dorsal spine; U=0.02 & U=0.98 are ventral belly midline!
    # =========================================================================
    d_dorsal = np.abs(u - 0.50) * 2.0  # 0 at dorsal spine, 1 at belly midline

    # Smooth organic boundary wobble between flank and cream belly
    belly_wobble = (mottle - 0.5) * 0.09 + (fur_clump - 0.5) * 0.06
    d_wob = np.clip(d_dorsal + belly_wobble, 0.0, 1.0)

    # Palette (physically calibrated LINEAR RGB for rich woodland early-mammal pelage!)
    col_dorsal_dark = np.array([0.038, 0.021, 0.012], dtype=np.float32)  # deep espresso-umber spine band
    col_russet      = np.array([0.135, 0.066, 0.031], dtype=np.float32)  # rich chestnut-russet upper flanks
    col_tawny       = np.array([0.235, 0.135, 0.066], dtype=np.float32)  # warm tawny-ochre mid flanks
    col_belly       = np.array([0.480, 0.390, 0.285], dtype=np.float32)  # natural warm cream-oatmeal belly
    col_guard_tip   = np.array([0.360, 0.220, 0.105], dtype=np.float32)  # golden-ochre agouti guard tips
    col_undercoat   = np.array([0.018, 0.010, 0.006], dtype=np.float32)  # deep chocolate undercoat

    # Compute dorsal -> flank -> belly gradient
    t_stripe = np.clip((d_wob - 0.10) / 0.28, 0.0, 1.0)
    t_stripe = t_stripe * t_stripe * (3.0 - 2.0 * t_stripe)
    c_body = col_dorsal_dark * (1.0 - t_stripe[..., None]) + col_russet * t_stripe[..., None]

    t_flank = np.clip((d_wob - 0.36) / 0.26, 0.0, 1.0)
    t_flank = t_flank * t_flank * (3.0 - 2.0 * t_flank)
    c_body = c_body * (1.0 - t_flank[..., None]) + col_tawny * t_flank[..., None]

    t_belly = np.clip((d_wob - 0.62) / 0.19, 0.0, 1.0)
    t_belly = t_belly * t_belly * (3.0 - 2.0 * t_belly)
    c_body = c_body * (1.0 - t_belly[..., None]) + col_belly * t_belly[..., None]

    # Subtle facial markings (v in 0.02..0.16 is head: nose at 0.02, eyes ~0.11, ears ~0.16)
    # Darker espresso nasal bridge & crown, warm buff cheeks & pale cream chin!
    w_muzzle = np.exp(-((v - 0.065) / 0.048) ** 2) * np.exp(-(d_dorsal / 0.34) ** 2)
    c_body = c_body * (1.0 - 0.36 * w_muzzle[..., None])

    # Warm buff-cream cheek highlight beneath eye
    w_cheek = np.exp(-((v - 0.125) / 0.045) ** 2) * np.exp(-((d_dorsal - 0.56) / 0.18) ** 2)
    c_body = c_body * (1.0 - 0.26 * w_cheek[..., None]) + col_belly * (0.26 * w_cheek[..., None])

    # Subtle warm eye-ring accent around eyes
    w_eyering = np.exp(-((v - 0.112) / 0.018) ** 2 - ((d_dorsal - 0.35) / 0.08) ** 2)
    c_body = c_body * (1.0 - 0.32 * w_eyering[..., None]) + col_tawny * (0.32 * w_eyering[..., None])

    # Subtle ambient occlusion under chin/throat, armpits & groin
    ao_throat = np.exp(-((v - 0.185) / 0.045) ** 2) * np.clip((d_dorsal - 0.72) / 0.25, 0.0, 1.0)
    ao_armpit = np.exp(-((v - 0.245) / 0.045) ** 2) * np.exp(-((d_dorsal - 0.62) / 0.16) ** 2)
    ao_groin = np.exp(-((v - 0.385) / 0.05) ** 2) * np.exp(-((d_dorsal - 0.60) / 0.16) ** 2)
    ao_mask = 1.0 - 0.28 * ao_throat - 0.30 * ao_armpit - 0.28 * ao_groin
    c_body *= ao_mask[..., None]

    # Apply directional agouti fur ticking & rich dark/light guard-hair micro-contrast
    fur_vis = 1.0 - 0.55 * t_belly
    c_body = (
        c_body * (0.76 + 0.44 * hair_h[..., None])
        + (col_guard_tip - c_body) * (0.38 * tick_bright * fur_vis)[..., None]
        + (col_undercoat - c_body) * (0.42 * tick_dark * fur_vis)[..., None]
    )

    # Tail zone (v > 0.455): rich dusky umber-brown ringed sparsely-haired tail
    t_tail = np.clip((v - 0.450) / 0.035, 0.0, 1.0)
    t_tail = t_tail * t_tail * (3.0 - 2.0 * t_tail)
    col_tail_top = np.array([0.095, 0.060, 0.042], dtype=np.float32)
    col_tail_bot = np.array([0.215, 0.155, 0.118], dtype=np.float32)
    c_tail = col_tail_top * (1.0 - d_dorsal[..., None] * 0.85) + col_tail_bot * (d_dorsal[..., None] * 0.85)
    tail_rings = 0.5 + 0.5 * np.sin(v * 680.0 + (mottle - 0.5) * 3.0)
    c_tail = c_tail * (0.80 + 0.28 * tail_rings[..., None]) * (0.88 + 0.20 * fur_fine[..., None])

    c_body = c_body * (1.0 - t_tail[..., None]) + c_tail * t_tail[..., None]

    # Write body+tail region
    m_body = (v < 0.655)
    rgb = np.where(m_body[..., None], c_body, rgb)
    body_height = hair_h * (1.0 - t_tail) + (0.55 * tail_rings + 0.45 * fur_fine) * t_tail
    height = np.where(m_body, body_height, height)
    body_rough = (0.88 - 0.12 * hair_h) * (1.0 - t_tail) + (0.68 - 0.08 * tail_rings) * t_tail
    rough = np.where(m_body, body_rough, rough)

    # =========================================================================
    # REGION 2: LIMBS & PAWS (v in 0.655 .. 0.855)
    # =========================================================================
    m_limb = (v >= 0.655) & (v < 0.855)
    v_l = np.clip((v - 0.66) / 0.16, 0.0, 1.0)
    t_skin = np.clip((v - 0.795) / 0.028, 0.0, 1.0)
    t_skin = t_skin * t_skin * (3.0 - 2.0 * t_skin)

    # Rich chestnut-umber upper limb -> warm tawny paw -> muted dusty-rose toes
    col_limb_top = np.array([0.135, 0.072, 0.036], dtype=np.float32)
    col_limb_paw = np.array([0.215, 0.135, 0.082], dtype=np.float32)
    col_toe_skin = np.array([0.330, 0.175, 0.145], dtype=np.float32)

    c_limb = col_limb_top * (1.0 - v_l[..., None]) + col_limb_paw * v_l[..., None]
    c_limb = c_limb * (0.80 + 0.34 * hair_h[..., None]) + (col_guard_tip - c_limb) * (0.24 * tick_bright)[..., None]
    c_toe = col_toe_skin * (0.88 + 0.20 * fur_clump[..., None])
    c_limb = c_limb * (1.0 - t_skin[..., None]) + c_toe * t_skin[..., None]

    rgb = np.where(m_limb[..., None], c_limb, rgb)
    height = np.where(m_limb, hair_h * (1.0 - t_skin) + (0.5 + 0.15 * fur_clump) * t_skin, height)
    rough = np.where(m_limb, 0.84 * (1.0 - t_skin) + 0.58 * t_skin, rough)

    # =========================================================================
    # REGION 3: DETAIL ISLANDS (v >= 0.855)
    # =========================================================================
    m_det = (v >= 0.855)

    # 3a) Wet dark rhinarium / nose pad: U in [0.00, 0.19]
    m_nose = m_det & (u < 0.19)
    nose_grain = value_noise_2d(H, W, 180, 180, 201)
    c_nose = np.array([0.055, 0.032, 0.028], dtype=np.float32) * (0.82 + 0.34 * nose_grain[..., None])
    rgb = np.where(m_nose[..., None], c_nose, rgb)
    height = np.where(m_nose, 0.45 + 0.22 * nose_grain, height)
    rough = np.where(m_nose, 0.16 + 0.05 * nose_grain, rough)

    # 3b) Glossy nocturnal eye: U in [0.19, 0.355], center at (0.27, 0.92)
    m_eye = m_det & (u >= 0.19) & (u < 0.355)
    du = (u - 0.27) / 0.065
    dv = (v - 0.92) / 0.048
    er = np.sqrt(du * du + dv * dv)
    col_pupil = np.array([0.005, 0.004, 0.004], dtype=np.float32)
    col_iris = np.array([0.11, 0.048, 0.018], dtype=np.float32)
    col_limbus = np.array([0.014, 0.009, 0.007], dtype=np.float32)
    iris_fibers = 0.85 + 0.30 * np.sin(np.arctan2(dv, du) * 28.0 + er * 8.0)
    t_ir = np.clip((er - 0.48) / 0.09, 0.0, 1.0)
    t_lb = np.clip((er - 0.78) / 0.10, 0.0, 1.0)
    c_eye = col_pupil * (1.0 - t_ir[..., None]) + (col_iris * iris_fibers[..., None]) * t_ir[..., None]
    c_eye = c_eye * (1.0 - t_lb[..., None]) + col_limbus * t_lb[..., None]
    rgb = np.where(m_eye[..., None], c_eye, rgb)
    height = np.where(m_eye, 0.5, height)
    rough = np.where(m_eye, 0.032, rough)

    # 3c) Dark espresso eyelid rim: U in [0.355, 0.44]
    m_lid = m_det & (u >= 0.355) & (u < 0.44)
    c_lid = np.array([0.038, 0.022, 0.015], dtype=np.float32) * (0.9 + 0.2 * fur_clump[..., None])
    rgb = np.where(m_lid[..., None], c_lid, rgb)
    height = np.where(m_lid, 0.5 + 0.1 * fur_clump, height)
    rough = np.where(m_lid, 0.48, rough)

    # 3d) Outer furred ear: U in [0.44, 0.63]
    m_ear_out = m_det & (u >= 0.44) & (u < 0.63)
    c_ear_out = np.array([0.092, 0.052, 0.032], dtype=np.float32) * (0.82 + 0.30 * hair_h[..., None])
    rgb = np.where(m_ear_out[..., None], c_ear_out, rgb)
    height = np.where(m_ear_out, 0.45 + 0.35 * hair_h, height)
    rough = np.where(m_ear_out, 0.82, rough)

    # 3e) Inner concave ear skin: U in [0.63, 0.815] (natural muted warm rose-taupe)
    m_ear_in = m_det & (u >= 0.63) & (u < 0.815)
    eu = (u - 0.72) / 0.085
    ev = (v - 0.925) / 0.055
    er_in = np.clip(np.sqrt(eu * eu + ev * ev), 0.0, 1.0)
    col_ear_core = np.array([0.36, 0.185, 0.150], dtype=np.float32)
    col_ear_rim = np.array([0.14, 0.078, 0.056], dtype=np.float32)
    c_ear_in = (col_ear_core * (1.0 - er_in[..., None] ** 1.6) + col_ear_rim * (er_in[..., None] ** 1.6))
    c_ear_in *= (0.90 + 0.16 * fur_clump[..., None])
    rgb = np.where(m_ear_in[..., None], c_ear_in, rgb)
    height = np.where(m_ear_in, 0.48 + 0.14 * fur_clump, height)
    rough = np.where(m_ear_in, 0.56, rough)

    # 3f) Keratin claws: U in [0.815, 0.91] (dark horn base -> warm amber tip)
    m_claw = m_det & (u >= 0.815) & (u < 0.91)
    vc = np.clip((v - 0.87) / 0.08, 0.0, 1.0)
    c_claw = (
        np.array([0.075, 0.048, 0.032], dtype=np.float32) * (1.0 - vc[..., None])
        + np.array([0.42, 0.34, 0.24], dtype=np.float32) * vc[..., None]
    )
    rgb = np.where(m_claw[..., None], c_claw, rgb)
    height = np.where(m_claw, 0.5, height)
    rough = np.where(m_claw, 0.26, rough)

    # 3g) Whiskers: U >= 0.91 (natural warm silvery-ivory)
    m_whisk = m_det & (u >= 0.91)
    c_whisk = np.array([0.54, 0.49, 0.43], dtype=np.float32)
    rgb = np.where(m_whisk[..., None], c_whisk, rgb)
    height = np.where(m_whisk, 0.5, height)
    rough = np.where(m_whisk, 0.36, rough)

    # Convert albedo linear colors -> crisp sRGB PNG
    rgb_u8 = np.clip(np.power(np.clip(rgb, 0.0, 1.0), 1.0 / 2.2) * 255.0, 0, 255).astype(np.uint8)
    albedo_img = Image.fromarray(rgb_u8, mode="RGB")

    # Compute crisp tangent-space normal map from heightfield via central differences
    strength = 3.8
    gx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) * strength
    gy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) * strength
    nx = -gx
    ny = -gy
    nz = np.ones_like(height)
    nlen = np.sqrt(nx * nx + ny * ny + nz * nz)
    nx /= nlen
    ny /= nlen
    nz /= nlen
    nrm_rgb = np.stack([(nx * 0.5 + 0.5), (ny * 0.5 + 0.5), (nz * 0.5 + 0.5)], axis=-1)
    normal_img = Image.fromarray(np.clip(nrm_rgb * 255.0, 0, 255).astype(np.uint8), mode="RGB")

    # Metallic-Roughness texture (glTF: G = roughness, B = metallic = 0)
    mr_rgb = np.zeros((H, W, 3), dtype=np.uint8)
    mr_rgb[..., 0] = 255
    mr_rgb[..., 1] = np.clip(rough * 255.0, 0, 255).astype(np.uint8)
    mr_rgb[..., 2] = 0
    mr_img = Image.fromarray(mr_rgb, mode="RGB").resize((1024, 1024), Image.BILINEAR)

    def to_png_bytes(img):
        buf = io.BytesIO()
        img.save(buf, format="PNG", compress_level=5)
        return buf.getvalue()

    return to_png_bytes(albedo_img), to_png_bytes(normal_img), to_png_bytes(mr_img)


# =============================================================================
# 9. Forward Kinematics & Analytical 2-Bone IK Solver for Grounded Animation
# =============================================================================

def eval_fk(root_trans, local_quats):
    """Return global (positions[26,3], rot_mats[26,3,3]) for all joints."""
    n = len(JOINTS)
    g_pos = np.zeros((n, 3), dtype=np.float64)
    g_rot = np.zeros((n, 3, 3), dtype=np.float64)

    for i in range(n):
        p = JOINT_PARENT[i]
        R_loc = quat_to_mat3(local_quats[i])
        if p < 0:
            g_pos[i] = root_trans
            g_rot[i] = R_loc
        else:
            t_loc = JOINT_POS[i] - JOINT_POS[p]
            g_pos[i] = g_pos[p] + g_rot[p] @ t_loc
            g_rot[i] = g_rot[p] @ R_loc
    return g_pos, g_rot


def solve_two_bone_ik_world(p_root, p_mid_rest_dir, p_end_rest_dir, L1, L2, target, pole_dir):
    """
    Analytical 2-bone IK in world space.
    Returns desired world directions (d1_new, d2_new) for upper and lower limb segments.
    """
    to_t = target - p_root
    dist = float(np.linalg.norm(to_t))
    max_reach = (L1 + L2) * 0.996
    min_reach = abs(L1 - L2) + 0.005
    dist = clamp(dist, min_reach, max_reach)
    dir_t = normalize(to_t)

    # Bend plane normal using pole direction
    bend_dir = pole_dir - np.dot(pole_dir, dir_t) * dir_t
    if np.linalg.norm(bend_dir) < 1e-5:
        bend_dir = np.array([0.0, 0.0, 1.0]) - dir_t * dir_t[2]
    bend_dir = normalize(bend_dir)

    # Law of cosines: angle at root between dir_t and segment 1
    cos_a = clamp((L1 * L1 + dist * dist - L2 * L2) / (2.0 * L1 * dist), -1.0, 1.0)
    sin_a = math.sqrt(max(0.0, 1.0 - cos_a * cos_a))

    p_mid_new = p_root + (dir_t * cos_a + bend_dir * sin_a) * L1
    d1_new = normalize(p_mid_new - p_root)
    d2_new = normalize((p_root + dir_t * dist) - p_mid_new)
    return d1_new, d2_new


def apply_limb_ik(root_trans, local_quats, b_upper, b_lower, b_end, target_world, pole_world, keep_paw_flat=True):
    """
    Update local_quats[b_upper], local_quats[b_lower], and optionally local_quats[b_end]
    so joint b_end reaches target_world accurately without ground penetration or sliding!
    """
    g_pos, g_rot = eval_fk(root_trans, local_quats)
    p_parent = JOINT_PARENT[b_upper]
    R_parent = g_rot[p_parent]
    p_root = g_pos[b_upper]

    # Rest local bone vectors
    v1_rest = JOINT_POS[b_lower] - JOINT_POS[b_upper]
    v2_rest = JOINT_POS[b_end] - JOINT_POS[b_lower]
    L1 = float(np.linalg.norm(v1_rest))
    L2 = float(np.linalg.norm(v2_rest))
    u1_rest = v1_rest / L1
    u2_rest = v2_rest / L2

    d1_w, d2_w = solve_two_bone_ik_world(p_root, u1_rest, u2_rest, L1, L2, target_world, pole_world)

    # Desired direction of v1 in parent's local space
    d1_loc = normalize(R_parent.T @ d1_w)
    q_up = quat_from_two_vectors(u1_rest, d1_loc)
    local_quats[b_upper] = q_up

    # Recompute upper limb world rotation
    R_up_w = R_parent @ quat_to_mat3(q_up)
    d2_loc = normalize(R_up_w.T @ d2_w)
    q_lo = quat_from_two_vectors(u2_rest, d2_loc)
    local_quats[b_lower] = q_lo

    if keep_paw_flat:
        # Keep paw/foot world orientation level with ground plane (zero pitch/roll in world!)
        R_lo_w = R_up_w @ quat_to_mat3(q_lo)
        # Preserve world yaw of the body (extract from root), zero pitch & roll
        R_target_paw = np.eye(3, dtype=np.float64)
        R_paw_loc = R_lo_w.T @ R_target_paw
        local_quats[b_end] = quat_from_mat3(R_paw_loc)


def make_pose_dict():
    """Return neutral rest pose: root translation + identity quaternions for all 26 joints."""
    return JOINT_POS[0].copy(), [np.array([0.0, 0.0, 0.0, 1.0], dtype=np.float64) for _ in JOINTS]


# =============================================================================
# 10. Animation Choreography: Naturalistic Jump (2.8s) & Alert Idle (5.0s)
# =============================================================================

def sample_idle_pose(t, dur=5.0):
    """
    Seamless alert nocturnal mammal idle loop (t in [0, dur]):
      - Rhythmic breathing ribcage expansion/bob
      - Inquisitive sniffing head turns & delicate nose twitches
      - Asymmetric alert ear flicks
      - Gentle continuous sinusoidal tail sway
      - All 4 paws planted rock-solid at Y=0 via exact analytical IK!
    """
    p = (t / dur) * 2.0 * math.pi  # periodic phase 0..2pi
    root_t, quats = make_pose_dict()

    # Subtle breathing & weight shift
    breath = math.sin(p * 3.0)
    sway = math.sin(p)
    root_t = root_t + np.array([0.005 * sway, 0.004 * breath, 0.003 * math.sin(p * 2.0)])

    # Spine gentle breathing arch & curiosity sway
    quats[0] = euler_xyz_to_quat(0.015 * breath, 0.025 * sway, 0.012 * sway)
    quats[1] = euler_xyz_to_quat(-0.025 * breath, 0.035 * sway, 0.0)
    quats[2] = euler_xyz_to_quat(-0.020 * breath, 0.040 * math.sin(p - 0.4), 0.0)

    # Neck & head: inquisitive look left -> slight raise -> sniff twitch -> look right -> center
    look_yaw = 0.24 * math.sin(p) + 0.08 * math.sin(p * 2.0 + 0.5)
    sniff_env = max(0.0, math.sin(p * 2.0 - 0.6)) ** 2
    sniff_twitch = 0.055 * math.sin(p * 18.0) * sniff_env
    head_pitch = -0.08 * math.sin(p * 2.0) - 0.05 * math.cos(p) - sniff_twitch

    quats[3] = euler_xyz_to_quat(head_pitch * 0.45, look_yaw * 0.45, 0.04 * math.sin(p + 0.7))
    quats[4] = euler_xyz_to_quat(head_pitch * 0.55, look_yaw * 0.55, 0.07 * math.sin(p * 2.0 + 0.3))
    # Subtle jaw twitch while sniffing
    quats[5] = euler_xyz_to_quat(0.025 * max(0.0, math.sin(p * 18.0)) * sniff_env, 0.0, 0.0)

    # Alert asymmetric ear flicks!
    flick_L = math.exp(-((math.sin(p * 0.5 - 0.7)) / 0.09) ** 2) * 0.28
    flick_R = math.exp(-((math.sin(p * 0.5 - 1.9)) / 0.09) ** 2) * 0.26
    quats[6] = euler_xyz_to_quat(0.06 * math.sin(p * 2.0) + flick_L, 0.08 * math.sin(p) - flick_L * 0.5, -flick_L * 0.6)
    quats[7] = euler_xyz_to_quat(0.06 * math.sin(p * 2.0 + 1.0) + flick_R, -0.08 * math.sin(p) + flick_R * 0.5, flick_R * 0.6)

    # Sinuous smooth traveling wave down the 6 tail segments
    for k in range(6):
        bi = 20 + k
        amp_y = 0.055 + k * 0.026
        amp_x = 0.022 + k * 0.012
        phase_lag = k * 0.55
        quats[bi] = euler_xyz_to_quat(
            amp_x * math.sin(p * 2.0 - phase_lag),
            amp_y * math.sin(p - phase_lag),
            0.0,
        )

    # Lock all 4 paws solidly to rest ground targets via exact 2-bone IK!
    apply_limb_ik(root_t, quats, 8, 9, 10, JOINT_POS[10].copy(), np.array([0.25, 0.15, -1.0]))
    apply_limb_ik(root_t, quats, 11, 12, 13, JOINT_POS[13].copy(), np.array([-0.25, 0.15, -1.0]))
    apply_limb_ik(root_t, quats, 14, 15, 16, JOINT_POS[16].copy(), np.array([0.22, 0.30, 1.0]))
    apply_limb_ik(root_t, quats, 17, 18, 19, JOINT_POS[19].copy(), np.array([-0.22, 0.30, 1.0]))
    return root_t, quats


def sample_jump_pose(t, dur=2.8):
    """
    Naturalistic, biomechanically rich Morganucodon leap (2.80 seconds):
      0.00 - 0.18s: Alert stance -> spots insect / looks up & forward
      0.18 - 0.68s: Deep spring-loaded anticipation crouch (pelvis drops low & back,
                    spine coils, head aims forward-up, paws glued firmly to Y=0 via IK!)
      0.68 - 0.86s: Explosive hind-leg launch & push-off (hind legs whip into full extension,
                    forelimbs lift off first as chest vaults upward!)
      0.86 - 1.62s: True ballistic parabolic mid-air flight (apex +0.58 units clear above ground!
                    Rising stretch -> athletic mid-air crescent apex -> forward-reaching descent;
                    tail streams dynamically behind then sweeps up as counterbalance!)
      1.62 - 1.98s: Cushioned landing (forepaws catch ground first, hind legs follow and compress
                    deeply into elastic absorption; head dips slightly with momentum, tail rebounds)
      1.98 - 2.48s: Energetic recovery & crisp two-step hop-settle back to exact origin
      2.48 - 2.80s: Alert proud settle with quick ear flick returning smoothly to exact rest pose!
    """
    root_rest = JOINT_POS[0].copy()
    root_t, quats = make_pose_dict()

    # ---- Phase times ----
    t_crouch_start = 0.14
    t_crouch_deep  = 0.64
    t_takeoff      = 0.84
    t_land         = 1.60
    t_compress     = 1.82
    t_recover      = 2.38
    t_end          = dur  # 2.80

    # ---- 1. Root Center-of-Mass Trajectory (Y height & Z forward-pounce arc) ----
    if t < t_crouch_start:
        # Subtle alert perk-up before coiling
        u = smootherstep(0.0, t_crouch_start, t)
        dy = 0.008 * math.sin(u * math.pi)
        dz = 0.0
        root_pitch = -0.04 * u
    elif t < t_crouch_deep:
        # Deep coiled anticipation crouch: drop down & shift weight onto haunches
        u = smootherstep(t_crouch_start, t_crouch_deep, t)
        dy = -0.105 * u
        dz = -0.095 * u
        root_pitch = -0.04 + 0.18 * u  # hips drop low, nose aimed upward via spine!
    elif t < t_takeoff:
        # Explosive uncoiling push-off!
        u = smootherstep(t_crouch_deep, t_takeoff, t)
        # Accelerates swiftly upward & forward from crouched position
        dy = lerp(-0.105, 0.115, u ** 1.35)
        dz = lerp(-0.095, -0.015, u)
        root_pitch = lerp(0.14, -0.46, u)  # dramatic upward launch angle!
    elif t < t_land:
        # Ballistic parabolic flight!
        # Match height at t_takeoff (dy=0.115) and t_land (dy=0.055), peak apex = +0.585!
        f = (t - t_takeoff) / (t_land - t_takeoff)  # 0 .. 1
        # Parabola 4*f*(1-f) reaches 1.0 at f=0.5
        base_line = lerp(0.115, 0.055, f)
        dy = base_line + 0.515 * (4.0 * f * (1.0 - f))
        dz = lerp(-0.015, 0.105, smootherstep(0.0, 1.0, f))
        # Pitch rotates smoothly from +28° upward launch -> level at apex -> -24° downward descent
        root_pitch = lerp(-0.46, 0.40, smoothstep(0.05, 0.95, f))
    elif t < t_compress:
        # Elastic landing impact compression!
        u = smootherstep(t_land, t_compress, t)
        dy = lerp(0.055, -0.088, u)
        dz = lerp(0.105, 0.125, u)
        root_pitch = lerp(0.40, 0.10, u)
    elif t < t_recover:
        # Springy rebound + compact step-back to exact origin
        u = smootherstep(t_compress, t_recover, t)
        # Small lively bounce overshoot
        bounce = 0.022 * math.sin(u * math.pi)
        dy = lerp(-0.088, 0.0, u) + bounce
        dz = lerp(0.125, 0.0, u)
        root_pitch = lerp(0.10, -0.02, u)
    else:
        # Smooth calm settle back into exact t=0 rest pose
        u = smootherstep(t_recover, t_end, t)
        dy = 0.005 * math.sin(u * math.pi)
        dz = 0.0
        root_pitch = lerp(-0.02, 0.0, u)

    root_t = root_rest + np.array([0.0, dy, dz])

    # ---- 2. Spine, Chest, Neck, Head & Ears Expression ----
    if t < t_crouch_deep:
        u = smootherstep(t_crouch_start, t_crouch_deep, t)
        sp_mid_rx = -0.32 * u    # tight arched coil!
        chest_rx  = 0.14 * u     # chest stays low toward ground
        neck_rx   = -0.30 * u    # head lifted looking intently at target!
        head_rx   = -0.18 * u
        ear_pin   = 0.10 * u
        jaw_open  = 0.0
    elif t < t_takeoff:
        u = smootherstep(t_crouch_deep, t_takeoff, t)
        sp_mid_rx = lerp(-0.32, 0.18, u)   # spine snaps straight & stretched!
        chest_rx  = lerp(0.14, 0.12, u)
        neck_rx   = lerp(-0.30, 0.08, u)
        head_rx   = lerp(-0.18, 0.14, u)
        ear_pin   = lerp(0.10, 0.36, u)    # ears pin slightly back in wind
        jaw_open  = 0.06 * u
    elif t < t_land:
        f = (t - t_takeoff) / (t_land - t_takeoff)
        # Athletic mid-air stretch -> graceful arch at apex -> reaching for landing!
        apex_arch = math.sin(f * math.pi)
        sp_mid_rx = lerp(0.18, -0.20, smoothstep(0.25, 0.85, f)) + 0.14 * (1.0 - apex_arch)
        chest_rx  = lerp(0.12, -0.14, smoothstep(0.30, 0.90, f))
        # Head stabilizes horizontally in world space so Morganucodon watches where it lands!
        neck_rx   = lerp(0.08, -0.26, smoothstep(0.20, 0.88, f))
        head_rx   = lerp(0.14, -0.18, smoothstep(0.20, 0.90, f))
        ear_pin   = 0.36 - 0.12 * smoothstep(0.55, 1.0, f)
        jaw_open  = 0.08 * math.sin(f * math.pi)
    elif t < t_compress:
        u = smootherstep(t_land, t_compress, t)
        sp_mid_rx = lerp(-0.20, -0.28, u)  # spine flexes absorbing landing!
        chest_rx  = lerp(-0.14, 0.12, u)
        neck_rx   = lerp(-0.26, 0.14, u)   # momentum head nod
        head_rx   = lerp(-0.18, 0.16, u)
        ear_pin   = lerp(0.24, -0.06, u)
        jaw_open  = 0.0
    elif t < t_recover:
        u = smootherstep(t_compress, t_recover, t)
        sp_mid_rx = lerp(-0.28, 0.02, u)
        chest_rx  = lerp(0.12, -0.02, u)
        neck_rx   = lerp(0.14, -0.06, u)
        head_rx   = lerp(0.16, -0.04, u)
        ear_pin   = lerp(-0.06, 0.0, u)
        jaw_open  = 0.0
    else:
        u = smootherstep(t_recover, t_end, t)
        sp_mid_rx = lerp(0.02, 0.0, u)
        chest_rx  = lerp(-0.02, 0.0, u)
        neck_rx   = lerp(-0.06, 0.0, u)
        head_rx   = lerp(-0.04, 0.0, u)
        ear_pin   = 0.0
        jaw_open  = 0.0

    # Proud little head-cock & ear-flick during final settle
    settle_flick = math.exp(-((t - 2.52) / 0.07) ** 2)
    head_yaw = 0.12 * math.sin(smoothstep(2.1, 2.8, t) * math.pi)

    quats[0] = euler_xyz_to_quat(root_pitch, 0.0, 0.0)
    quats[1] = euler_xyz_to_quat(sp_mid_rx, 0.0, 0.0)
    quats[2] = euler_xyz_to_quat(chest_rx, 0.0, 0.0)
    quats[3] = euler_xyz_to_quat(neck_rx, head_yaw * 0.4, 0.0)
    quats[4] = euler_xyz_to_quat(head_rx, head_yaw * 0.6, 0.04 * math.sin(smoothstep(2.1, 2.8, t) * math.pi))
    quats[5] = euler_xyz_to_quat(jaw_open, 0.0, 0.0)
    quats[6] = euler_xyz_to_quat(ear_pin + 0.24 * settle_flick, -0.15 * ear_pin, -0.18 * ear_pin - 0.18 * settle_flick)
    quats[7] = euler_xyz_to_quat(ear_pin + 0.14 * settle_flick,  0.15 * ear_pin,  0.18 * ear_pin + 0.10 * settle_flick)

    # ---- 3. Dynamic Expressive Tail (Graceful Horizontal Counterbalance & Rock-Clearance!) ----
    for k in range(6):
        bi = 20 + k
        lag = k * 0.040
        tl = max(0.0, t - lag)
        if tl < t_crouch_deep:
            # Tail tenses low & curves gently upward at tip like a stalking shrew
            u = smootherstep(t_crouch_start, t_crouch_deep, tl)
            tx = (-0.03 if k < 2 else 0.055) * u
            ty = 0.05 * math.sin(tl * 10.0 - k * 0.5) * u
        elif tl < t_takeoff:
            # Counter-pitch base upward as pelvis tilts up so tail glides cleanly ABOVE the rock!
            u = smootherstep(t_crouch_deep, t_takeoff, tl)
            if k == 0:
                tx = lerp(-0.03, 0.44, u)
            elif k == 1:
                tx = lerp(-0.03, 0.14, u)
            else:
                tx = lerp(0.055, -0.02, u)
            ty = 0.0
        elif tl < t_land:
            # Smoothly release launch counter-pitch -> aerodynamic horizontal S-wave counterbalance!
            f = (tl - t_takeoff) / (t_land - t_takeoff)
            start_tx = 0.44 if k == 0 else (0.14 if k == 1 else -0.02)
            # Gentle aerodynamic counterbalance during descent (never curls steeply vertical)
            end_tx = 0.045 if k < 2 else (0.025 if k < 4 else -0.020)
            tx = lerp(start_tx, end_tx, smootherstep(0.0, 0.85, f))
            ty = 0.045 * math.sin(f * math.pi * 2.0 - k * 0.45)
        elif tl < t_compress:
            # Gentle rebound ripple on landing
            u = smootherstep(t_land, t_compress, tl)
            end_tx = 0.045 if k < 2 else (0.025 if k < 4 else -0.020)
            tx = lerp(end_tx, 0.02 - 0.008 * k, u)
            ty = 0.035 * math.sin(u * math.pi)
        else:
            u = smootherstep(t_compress, t_end, tl)
            tx = lerp(0.02 - 0.008 * k, 0.0, u)
            ty = 0.035 * math.sin(u * math.pi * 2.0 - k * 0.5) * (1.0 - u)
        quats[bi] = euler_xyz_to_quat(tx, ty, 0.0)

    # Guarantee zero tail-rock penetration via exact FK floor clearance check!
    for _iter in range(3):
        gp_t, _ = eval_fk(root_t, quats)
        min_tail_y = float(np.min(gp_t[20:26, 1]))
        if min_tail_y >= 0.045:
            break
        lift = clamp((0.048 - min_tail_y) * 1.45, 0.0, 0.35)
        quats[20] = quat_mul(quats[20], euler_xyz_to_quat(lift * 0.65, 0.0, 0.0))
        quats[21] = quat_mul(quats[21], euler_xyz_to_quat(lift * 0.35, 0.0, 0.0))

    # ---- 4. Limbs: Analytical Ground-Contact IK during Stance/Crouch/Landing, Dynamic Athletic Tuck/Extend in Air! ----
    g_pos, g_rot = eval_fk(root_t, quats)

    # Forelimbs
    for side, b_up, b_lo, b_pw in ((1.0, 8, 9, 10), (-1.0, 11, 12, 13)):
        rest_paw = JOINT_POS[b_pw].copy()
        pole = np.array([side * 0.28, 0.15, -1.0])

        if t < t_crouch_deep:
            # Planted firmly on ground while body crouches & shifts back!
            target = rest_paw.copy()
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, target, pole, keep_paw_flat=True)
        elif t < t_takeoff:
            # Forepaws push off and lift swiftly ahead of hind legs!
            u = smootherstep(t_crouch_deep, t_takeoff, t)
            tucked = g_pos[b_up] + np.array([side * 0.008, -0.105, 0.068])
            target = lerp(rest_paw, tucked, u)
            target[1] = max(rest_paw[1], target[1])
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, target, pole, keep_paw_flat=(u < 0.2))
            if u >= 0.2:
                # Gently curl wrists downward mid-launch
                quats[b_pw] = euler_xyz_to_quat(0.45 * u, 0.0, 0.0)
        elif t < t_land:
            f = (t - t_takeoff) / (t_land - t_takeoff)
            # Early flight: tucked neatly under chest; Late flight (f > 0.45): reach gracefully forward & down for landing!
            tuck_rel = np.array([side * 0.006, -0.102, 0.068])
            reach_rel = np.array([side * 0.010, -0.185, 0.135])
            u_reach = smootherstep(0.38, 0.94, f)
            p_air = g_pos[b_up] + lerp(tuck_rel, reach_rel, u_reach)
            # Blend smoothly to exact landing spot at f -> 1.0
            land_spot = rest_paw + np.array([0.0, 0.0, 0.115])
            u_touch = smootherstep(0.82, 1.0, f)
            target = lerp(p_air, land_spot, u_touch)
            target[1] = max(rest_paw[1], target[1])
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, target, pole, keep_paw_flat=(u_touch > 0.7))
            if u_touch <= 0.7:
                # Expressive wrist curl in flight, opening up to catch landing
                quats[b_pw] = euler_xyz_to_quat(lerp(0.55, -0.18, u_reach), 0.0, 0.0)
        elif t < t_compress + 0.08:
            # Planted firmly at landing spot absorbing impact!
            land_spot = rest_paw + np.array([0.0, 0.0, 0.115])
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, land_spot, pole, keep_paw_flat=True)
        elif t < t_recover:
            # Crisp staggered recovery step back to rest_paw (left steps first, then right!)
            stagger = 0.0 if side > 0 else 0.11
            ts0 = t_compress + 0.08 + stagger
            ts1 = ts0 + 0.28
            u = smootherstep(ts0, ts1, t)
            land_spot = rest_paw + np.array([0.0, 0.0, 0.115])
            target = lerp(land_spot, rest_paw, u)
            target[1] += 0.032 * math.sin(u * math.pi)  # clear crisp foot lift!
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, target, pole, keep_paw_flat=True)
        else:
            apply_limb_ik(root_t, quats, b_up, b_lo, b_pw, rest_paw, pole, keep_paw_flat=True)

    # Hindlimbs (Powerhouse springs!)
    for side, b_th, b_sh, b_ft in ((1.0, 14, 15, 16), (-1.0, 17, 18, 19)):
        rest_ft = JOINT_POS[b_ft].copy()
        pole = np.array([side * 0.22, 0.30, 1.0])

        if t < t_crouch_deep:
            # Planted solidly on ground while haunches coil deep!
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, rest_ft, pole, keep_paw_flat=True)
        elif t < t_takeoff:
            # Explosive spring push-off! Feet stay driving against ground almost until takeoff,
            # extending ankles onto toe tips right as body vaults up!
            u = smootherstep(t_crouch_deep, t_takeoff, t)
            # Push off ground then begin lifting at final 20%
            lift = smootherstep(0.76, 1.0, u) * 0.055
            target = rest_ft + np.array([0.0, lift, -0.025 * u])
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, target, pole, keep_paw_flat=(u < 0.35))
            if u >= 0.35:
                # Dramatic plantar-flexion (pointing toes downward as it springs off!)
                quats[b_ft] = euler_xyz_to_quat(0.75 * smoothstep(0.35, 1.0, u), 0.0, 0.0)
        elif t < t_land:
            f = (t - t_takeoff) / (t_land - t_takeoff)
            # Rising & early apex (f 0..0.52): sleek streamlined trailing extension behind haunches!
            # Late apex -> descent (f 0.52..1.0): hind legs swing gracefully forward under belly to land!
            trail_rel = np.array([side * 0.016, -0.145, -0.245])
            tuck_rel  = np.array([side * 0.022, -0.140,  0.035])
            u_tuck = smootherstep(0.42, 0.90, f)
            p_air = g_pos[b_th] + lerp(trail_rel, tuck_rel, u_tuck)
            land_spot = rest_ft + np.array([0.0, 0.0, 0.115])
            u_touch = smootherstep(0.84, 1.0, f)
            target = lerp(p_air, land_spot, u_touch)
            target[1] = max(rest_ft[1], target[1])
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, target, pole, keep_paw_flat=(u_touch > 0.75))
            if u_touch <= 0.75:
                # Pointed sleek toes trailing backward, then flexing forward for landing
                quats[b_ft] = euler_xyz_to_quat(lerp(0.95, -0.15, u_tuck), 0.0, 0.0)
        elif t < t_compress + 0.10:
            land_spot = rest_ft + np.array([0.0, 0.0, 0.115])
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, land_spot, pole, keep_paw_flat=True)
        elif t < t_recover:
            # Staggered step-back right after opposite forepaw (natural diagonal quadruped rhythm!)
            stagger = 0.08 if side < 0 else 0.18
            ts0 = t_compress + 0.06 + stagger
            ts1 = ts0 + 0.28
            u = smootherstep(ts0, ts1, t)
            land_spot = rest_ft + np.array([0.0, 0.0, 0.115])
            target = lerp(land_spot, rest_ft, u)
            target[1] += 0.030 * math.sin(u * math.pi)
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, target, pole, keep_paw_flat=True)
        else:
            apply_limb_ik(root_t, quats, b_th, b_sh, b_ft, rest_ft, pole, keep_paw_flat=True)

    return root_t, quats


def bake_animation(name, sample_fn, dur, fps=30):
    """Sample pose function across [0, dur] and enforce shortest-path quaternion continuity."""
    n_frames = int(round(dur * fps)) + 1
    times = np.linspace(0.0, dur, n_frames, dtype=np.float32)
    root_trans = np.zeros((n_frames, 3), dtype=np.float32)
    joint_quats = np.zeros((len(JOINTS), n_frames, 4), dtype=np.float32)

    for fi, t in enumerate(times):
        rt, qs = sample_fn(float(t), dur)
        root_trans[fi] = rt.astype(np.float32)
        for ji, q in enumerate(qs):
            q32 = q.astype(np.float32)
            # Enforce shortest-path quaternion sign continuity
            if fi > 0 and float(np.dot(q32, joint_quats[ji, fi - 1])) < 0.0:
                q32 = -q32
            joint_quats[ji, fi] = q32

    return {
        "name": name,
        "times": times,
        "root_trans": root_trans,
        "joint_quats": joint_quats,
    }


# =============================================================================
# 11. glTF 2.0 Binary (.glb) Writer
# =============================================================================

class GLBWriter:
    def __init__(self):
        self.bin = bytearray()
        self.buffer_views = []
        self.accessors = []
        self.images = []
        self.textures = []

    def add_bytes(self, data: bytes, target=None):
        while len(self.bin) % 4 != 0:
            self.bin.append(0)
        offset = len(self.bin)
        self.bin.extend(data)
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target is not None:
            bv["target"] = target
        idx = len(self.buffer_views)
        self.buffer_views.append(bv)
        return idx

    def add_accessor(self, arr: np.ndarray, acc_type: str, comp_type: int, target=None, include_minmax=False):
        raw = np.ascontiguousarray(arr).tobytes()
        bv_idx = self.add_bytes(raw, target=target)
        acc = {
            "bufferView": bv_idx,
            "componentType": comp_type,
            "count": int(arr.shape[0]),
            "type": acc_type,
        }
        if include_minmax:
            if arr.ndim == 1:
                acc["min"] = [float(arr.min())]
                acc["max"] = [float(arr.max())]
            else:
                acc["min"] = [float(x) for x in arr.min(axis=0)]
                acc["max"] = [float(x) for x in arr.max(axis=0)]
        idx = len(self.accessors)
        self.accessors.append(acc)
        return idx

    def add_png_texture(self, png_bytes: bytes, name: str):
        bv_idx = self.add_bytes(png_bytes)
        img_idx = len(self.images)
        self.images.append({"name": name, "bufferView": bv_idx, "mimeType": "image/png"})
        tex_idx = len(self.textures)
        self.textures.append({"source": img_idx, "sampler": 0})
        return tex_idx


def export_glb(mb: MeshBuilder, anims, albedo_png, normal_png, mr_png, out_path):
    w = GLBWriter()

    pos_arr = np.asarray(mb.positions, dtype=np.float32)
    nrm_arr = np.asarray(mb.normals, dtype=np.float32)
    uv_arr  = np.asarray(mb.uvs, dtype=np.float32)
    ji_arr  = np.asarray(mb.joints, dtype=np.uint8)
    jw_arr  = np.asarray(mb.weights, dtype=np.float32)
    idx_arr = np.asarray(mb.indices, dtype=np.uint32)

    acc_pos = w.add_accessor(pos_arr, "VEC3", 5126, target=34962, include_minmax=True)
    acc_nrm = w.add_accessor(nrm_arr, "VEC3", 5126, target=34962)
    acc_uv  = w.add_accessor(uv_arr,  "VEC2", 5126, target=34962)
    acc_ji  = w.add_accessor(ji_arr,  "VEC4", 5121, target=34962)
    acc_jw  = w.add_accessor(jw_arr,  "VEC4", 5126, target=34962)
    acc_idx = w.add_accessor(idx_arr, "SCALAR", 5125, target=34963)

    # Inverse bind matrices: pure inverse translation T(-rest_pos[j]), column-major!
    ibms = np.zeros((len(JOINTS), 16), dtype=np.float32)
    for j in range(len(JOINTS)):
        M = np.eye(4, dtype=np.float32)
        M[0:3, 3] = -JOINT_POS[j].astype(np.float32)
        ibms[j] = M.T.reshape(16)
    acc_ibm = w.add_accessor(ibms, "MAT4", 5126)

    # Textures
    tex_albedo = w.add_png_texture(albedo_png, "morganucodon_albedo")
    tex_normal = w.add_png_texture(normal_png, "morganucodon_normal")
    tex_mr     = w.add_png_texture(mr_png,     "morganucodon_mr")

    # Nodes:
    #   0: SceneRoot (children: [1 (mesh), 2 (joint 0 root)])
    #   1: MorganucodonMesh (mesh: 0, skin: 0)
    #   2..27: Joints 0..25
    joint_node_offset = 2
    nodes = [
        {"name": "Morganucodon", "children": [1, joint_node_offset]},
        {"name": "MorganucodonBody", "mesh": 0, "skin": 0},
    ]
    for j, name, parent, pos in JOINTS:
        if parent < 0:
            t_loc = pos
        else:
            t_loc = (JOINT_POS[j] - JOINT_POS[parent]).tolist()
        node = {
            "name": name,
            "translation": [float(x) for x in t_loc],
            "rotation": [0.0, 0.0, 0.0, 1.0],
        }
        if JOINT_CHILDREN[j]:
            node["children"] = [joint_node_offset + c for c in JOINT_CHILDREN[j]]
        nodes.append(node)

    # Animations
    gltf_anims = []
    for anim in anims:
        acc_t = w.add_accessor(anim["times"], "SCALAR", 5126, include_minmax=True)
        samplers = []
        channels = []

        # Root translation channel
        acc_rt = w.add_accessor(anim["root_trans"], "VEC3", 5126)
        samplers.append({"input": acc_t, "interpolation": "LINEAR", "output": acc_rt})
        channels.append({"sampler": 0, "target": {"node": joint_node_offset + 0, "path": "translation"}})

        # Rotation channels for all animated joints
        for j in range(len(JOINTS)):
            qs = anim["joint_quats"][j]
            # Always write all joints cleanly (small size, guarantees deterministic playback)
            acc_q = w.add_accessor(qs, "VEC4", 5126)
            s_idx = len(samplers)
            samplers.append({"input": acc_t, "interpolation": "LINEAR", "output": acc_q})
            channels.append({"sampler": s_idx, "target": {"node": joint_node_offset + j, "path": "rotation"}})

        gltf_anims.append({
            "name": anim["name"],
            "samplers": samplers,
            "channels": channels,
        })

    # Pad binary buffer to 4 bytes
    while len(w.bin) % 4 != 0:
        w.bin.append(0)

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "Morganucodon Procedural Builder (Holo Stage)",
            "copyright": "Naturalistic scientific reconstruction of Morganucodon (~205 Ma)",
        },
        "scene": 0,
        "scenes": [{"name": "MorganucodonScene", "nodes": [0]}],
        "nodes": nodes,
        "meshes": [
            {
                "name": "MorganucodonMesh",
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": acc_pos,
                            "NORMAL": acc_nrm,
                            "TEXCOORD_0": acc_uv,
                            "JOINTS_0": acc_ji,
                            "WEIGHTS_0": acc_jw,
                        },
                        "indices": acc_idx,
                        "material": 0,
                    }
                ],
            }
        ],
        "skins": [
            {
                "name": "MorganucodonRig",
                "inverseBindMatrices": acc_ibm,
                "skeleton": joint_node_offset,
                "joints": [joint_node_offset + j for j in range(len(JOINTS))],
            }
        ],
        "materials": [
            {
                "name": "MorganucodonFurPBR",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": tex_albedo},
                    "metallicRoughnessTexture": {"index": tex_mr},
                    "metallicFactor": 1.0,
                    "roughnessFactor": 1.0,
                },
                "normalTexture": {"index": tex_normal, "scale": 1.0},
                "doubleSided": False,
            }
        ],
        "samplers": [
            {
                "magFilter": 9729,  # LINEAR
                "minFilter": 9987,  # LINEAR_MIPMAP_LINEAR
                "wrapS": 33071,     # CLAMP_TO_EDGE
                "wrapT": 33071,
            }
        ],
        "images": w.images,
        "textures": w.textures,
        "animations": gltf_anims,
        "accessors": w.accessors,
        "bufferViews": w.buffer_views,
        "buffers": [{"byteLength": len(w.bin)}],
    }

    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_bytes) % 4 != 0:
        json_bytes += b" "

    total_len = 12 + 8 + len(json_bytes) + 8 + len(w.bin)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))  # JSON
        f.write(json_bytes)
        f.write(struct.pack("<II", len(w.bin), 0x004E4942))       # BIN
        f.write(w.bin)

    print(f"Wrote {out_path} ({total_len / 1024:.1f} KB)")
    print(f"  Vertices:  {len(mb.positions):,}")
    print(f"  Triangles: {len(mb.indices) // 3:,}")
    print(f"  Joints:    {len(JOINTS)}")
    print(f"  Bounds:    min={pos_arr.min(axis=0).round(3).tolist()} max={pos_arr.max(axis=0).round(3).tolist()}")
    anim_summary = [(a['name'], f"{float(a['times'][-1]):.2f}s", len(a['times'])) for a in anims]
    print(f"  Anims:     {anim_summary}")


def main():
    print("Sculpting Morganucodon anatomy...")
    mb = MeshBuilder()
    body_rings = build_body_mesh(mb)
    build_nose_mesh(mb)
    build_eyes_and_lids(mb)
    build_ears(mb)
    build_limbs_and_paws(mb)
    build_whiskers(mb)
    build_fur_tufts(mb, body_rings)

    print("Generating 2048x2048 procedural PBR fur/skin/eye textures...")
    albedo_png, normal_png, mr_png = generate_pbr_textures(2048)

    print("Baking Jump & Idle skeletal animations with analytical 2-bone IK...")
    anim_jump = bake_animation("Jump", sample_jump_pose, dur=2.8, fps=30)
    anim_idle = bake_animation("Idle", sample_idle_pose, dur=5.0, fps=24)

    export_glb(mb, [anim_jump, anim_idle], albedo_png, normal_png, mr_png, OUT_GLB)


if __name__ == "__main__":
    main()

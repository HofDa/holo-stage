/* Holo Stage — playable Ocean Currents thermal convection minigame engine.
 * Runs a real 2D Navier-Stokes + Boussinesq thermal buoyancy fluid simulation
 * rendered directly onto all four mirrored Pepper's ghost pyramid tiles.
 */
'use strict';

const CurrentsGame = (() => {
  const NX = 72, NY = 42, SIZE = NX * NY;
  const IX = (x, y) => x + y * NX;
  const N_PARTS = 760;

  const u = new Float32Array(SIZE), v = new Float32Array(SIZE);
  const u0 = new Float32Array(SIZE), v0 = new Float32Array(SIZE);
  const T = new Float32Array(SIZE), T0 = new Float32Array(SIZE);
  const O2 = new Float32Array(SIZE), O20 = new Float32Array(SIZE);
  const div = new Float32Array(SIZE), p = new Float32Array(SIZE);
  const solid = new Uint8Array(SIZE);

  // Shared 420x420 square hologram canvas blitted to each pyramid face
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = 420; srcCanvas.height = 420;
  const sctx = srcCanvas.getContext('2d');

  const fieldCanvas = document.createElement('canvas');
  fieldCanvas.width = NX; fieldCanvas.height = NY;
  const fctx = fieldCanvas.getContext('2d');
  const fimg = fctx.createImageData(NX, NY);

  const STATIONS = [
    { nx: 0.14, ny: 0.85, temp: +1.0, kind: 'vent', labelKey: 'st0' },
    { nx: 0.86, ny: 0.12, temp: -1.0, kind: 'ice',  labelKey: 'st1' },
    { nx: 0.86, ny: 0.85, temp: +1.0, kind: 'vent', labelKey: 'st2' },
    { nx: 0.14, ny: 0.12, temp: -1.0, kind: 'ice',  labelKey: 'st3' },
  ];

  const parts = Array.from({ length: N_PARTS }, () => ({ x: 0.5, y: 0.5, px: 0.5, py: 0.5, life: Math.random() }));
  const bubbles = [];
  const bursts = [];

  const G = {
    level: 0,
    elapsed: 0,
    reefs: [],
    gates: [],
    ammonite: null,
    survive: 0,
    surviveGoal: 20,
    spawnAcc: 0,
    dT: 0,
    deepO2: 50,
    progress: 0,
    won: false,
    colors: ['#ff4b3e', '#2f9bff', '#3ddc6a', '#ffd028'],
  };

  function resetFluid() {
    u.fill(0); v.fill(0); T.fill(0); solid.fill(0);
    for (let y = 0; y < NY; y++) {
      const o = Math.max(0.2, 1.0 - (y / NY) * 0.8);
      for (let x = 0; x < NX; x++) O2[IX(x, y)] = o;
    }
    for (let x = 0; x < NX; x++) solid[IX(x, NY - 1)] = 1;
    for (let y = 0; y < NY; y++) { solid[IX(0, y)] = 1; solid[IX(NX - 1, y)] = 1; }
  }

  function init(level = 0, playerCfg = []) {
    G.level = Math.max(0, Math.min(3, Number(level) || 0));
    G.elapsed = 0; G.survive = 0; G.spawnAcc = 0;
    G.dT = 0; G.deepO2 = 50; G.progress = 0; G.won = false;
    G.reefs = []; G.gates = []; G.ammonite = null;
    bubbles.length = 0; bursts.length = 0;
    G.colors = [0, 1, 2, 3].map(i => playerCfg[i]?.color || COLORS[i]);

    resetFluid();

    for (let x = 1; x < NX - 1; x++) {
      const nx = x / (NX - 1);
      let h = 2 + Math.round(Math.sin(nx * Math.PI * 3 + 0.4));
      if (G.level === 1) {
        const d = Math.abs(nx - 0.5);
        if (d < 0.13) h += Math.round((1 - d / 0.13) ** 1.4 * 17);
      } else if (G.level === 3) {
        const d1 = Math.abs(nx - 0.34), d2 = Math.abs(nx - 0.68);
        if (d1 < 0.08) h += Math.round((1 - d1 / 0.08) * 11);
        if (d2 < 0.08) h += Math.round((1 - d2 / 0.08) * 12);
      }
      for (let y = NY - 1 - h; y < NY; y++) solid[IX(x, y)] = 1;
    }

    if (G.level === 0) {
      G.reefs.push({ x: 0.50, y: 0.85, r: 0.09, fed: 0, goal: 8, o2: 0.5 });
    } else if (G.level === 1) {
      G.reefs.push({ x: 0.28, y: 0.84, r: 0.085, fed: 0, goal: 4, o2: 0.5 });
      G.reefs.push({ x: 0.72, y: 0.84, r: 0.085, fed: 0, goal: 4, o2: 0.5 });
    } else if (G.level === 2) {
      G.reefs.push({ x: 0.28, y: 0.85, r: 0.08, fed: 0, goal: 99, o2: 0.85 });
      G.reefs.push({ x: 0.50, y: 0.85, r: 0.08, fed: 0, goal: 99, o2: 0.88 });
      G.reefs.push({ x: 0.72, y: 0.85, r: 0.08, fed: 0, goal: 99, o2: 0.85 });
      for (let y = 2; y < NY - 3; y++) {
        for (let x = 2; x < NX - 2; x++) {
          const id = IX(x, y);
          if (!solid[id]) { T[id] = ((NX / 2 - x) / (NX / 2)) * 0.45; O2[id] = 0.78; }
        }
      }
    } else {
      G.ammonite = { x: 0.16, y: 0.70, vx: 0, vy: 0, angle: 0, trail: [] };
      G.gates = [
        { x: 0.22, y: 0.30, r: 0.082, hit: false },
        { x: 0.50, y: 0.24, r: 0.082, hit: false },
        { x: 0.82, y: 0.38, r: 0.082, hit: false },
        { x: 0.52, y: 0.72, r: 0.085, hit: false },
      ];
      G.reefs.push({ x: 0.52, y: 0.86, r: 0.08, fed: 0, goal: 1, o2: 0.9 });
    }

    for (const pt of parts) {
      pt.x = 0.04 + Math.random() * 0.92;
      pt.y = 0.05 + Math.random() * 0.84;
      pt.px = pt.x; pt.py = pt.y;
      pt.life = Math.random();
    }
  }

  function injectHeat(nx, ny, radius, targetTemp, strength) {
    const cx = nx * (NX - 1), cy = ny * (NY - 1), r2 = radius * radius;
    const x0 = Math.max(1, Math.floor(cx - radius)), x1 = Math.min(NX - 2, Math.ceil(cx + radius));
    const y0 = Math.max(1, Math.floor(cy - radius)), y1 = Math.min(NY - 2, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const id = IX(x, y);
        if (solid[id]) continue;
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        const w = (1 - d2 / r2) * strength;
        T[id] += (targetTemp - T[id]) * Math.min(1, w);
        v[id] += -targetTemp * w * 1.3;
      }
    }
  }

  function injectO2(nx, ny, radius, amt) {
    const cx = nx * (NX - 1), cy = ny * (NY - 1), r2 = radius * radius;
    for (let y = Math.max(1, Math.floor(cy - radius)); y <= Math.min(NY - 2, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(1, Math.floor(cx - radius)); x <= Math.min(NX - 2, Math.ceil(cx + radius)); x++) {
        const id = IX(x, y);
        if (solid[id]) continue;
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 <= r2) O2[id] = Math.min(1, O2[id] + (1 - d2 / r2) * amt);
      }
    }
  }

  function sample(arr, nx, ny) {
    const gx = Math.max(1, Math.min(NX - 2.001, nx * (NX - 1)));
    const gy = Math.max(1, Math.min(NY - 2.001, ny * (NY - 1)));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const i = IX(x0, y0);
    return (arr[i]*(1-fx) + arr[i+1]*fx)*(1-fy) + (arr[i+NX]*(1-fx) + arr[i+NX+1]*fx)*fy;
  }

  function project() {
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (solid[i]) { div[i] = 0; p[i] = 0; continue; }
        div[i] = -0.5 * (u[i+1] - u[i-1] + v[i+NX] - v[i-NX]);
        p[i] = 0;
      }
    }
    for (let it = 0; it < 12; it++) {
      for (let y = 1; y < NY - 1; y++) {
        for (let x = 1; x < NX - 1; x++) {
          const i = IX(x, y);
          if (solid[i]) continue;
          let s = div[i], c = 0;
          if (!solid[i-1]) { s += p[i-1]; c++; }
          if (!solid[i+1]) { s += p[i+1]; c++; }
          if (!solid[i-NX]) { s += p[i-NX]; c++; }
          if (!solid[i+NX]) { s += p[i+NX]; c++; }
          p[i] = c ? s / c : 0;
        }
      }
    }
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (solid[i]) continue;
        u[i] -= 0.5 * ((solid[i+1] ? p[i] : p[i+1]) - (solid[i-1] ? p[i] : p[i-1]));
        v[i] -= 0.5 * ((solid[i+NX] ? p[i] : p[i+NX]) - (solid[i-NX] ? p[i] : p[i-NX]));
      }
    }
    for (let x = 0; x < NX; x++) { u[IX(x, 0)] = u[IX(x, 1)]; v[IX(x, 0)] = 0; u[IX(x, NY-1)] = 0; v[IX(x, NY-1)] = 0; }
    for (let y = 0; y < NY; y++) { u[IX(0, y)] = 0; v[IX(0, y)] = 0; u[IX(NX-1, y)] = 0; v[IX(NX-1, y)] = 0; }
    for (let i = 0; i < SIZE; i++) if (solid[i]) { u[i] = 0; v[i] = 0; }
  }

  function advect(dst, src, dt, damp) {
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (solid[i]) { dst[i] = 0; continue; }
        const px = Math.max(0.5, Math.min(NX - 1.5, x - dt * u[i]));
        const py = Math.max(0.5, Math.min(NY - 1.5, y - dt * v[i]));
        const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
        const j = IX(x0, y0);
        dst[i] = ((src[j]*(1-fx) + src[j+1]*fx)*(1-fy) + (src[j+NX]*(1-fx) + src[j+NX+1]*fx)*fy) * damp;
      }
    }
  }

  function step(dtSec, activeMask) {
    const dt = Math.min(0.035, Math.max(0.004, dtSec));
    G.elapsed += dt;

    for (let i = 0; i < 4; i++) {
      if (!activeMask[i]) continue;
      const st = STATIONS[i];
      injectHeat(st.nx, st.ny, 5.2, st.temp, 0.42);
      if (st.kind === 'ice') injectO2(st.nx, st.ny + 0.04, 6.0, 0.28);
    }

    let ambientT = 0;
    if (G.level === 2 && !G.won) {
      const wave = Math.sin(G.elapsed * 0.65);
      ambientT = 0.32 + 0.40 * Math.max(0, wave);
      if (wave > 0.25) {
        injectHeat(0.50, 0.88, 6.5, +1.0, 0.22);
        injectHeat(0.35, 0.07, 9.0, +0.8, 0.07);
        injectHeat(0.65, 0.07, 9.0, +0.8, 0.07);
      }
    }

    let tSum = 0, tCnt = 0;
    for (let i = 0; i < SIZE; i++) if (!solid[i]) { tSum += T[i]; tCnt++; }
    const tAvg = tCnt ? tSum / tCnt : 0;
    const fdt = dt * 1.15;
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (solid[i]) continue;
        v[i] -= 23.0 * (T[i] - tAvg) * fdt;
        u[i] = Math.max(-24, Math.min(24, u[i]));
        v[i] = Math.max(-24, Math.min(24, v[i]));
      }
    }
    project();
    u0.set(u); v0.set(v);
    advect(u, u0, fdt, 0.992); advect(v, v0, fdt, 0.992);
    project();

    T0.set(T); advect(T, T0, fdt, 1.0);
    for (let y = 1; y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (!solid[i]) T[i] += (ambientT - T[i]) * 0.005;
      }
    }

    for (let x = 1; x < NX - 1; x++) O2[IX(x, 1)] = Math.min(1, O2[IX(x, 1)] + 0.08);
    O20.set(O2); advect(O2, O20, fdt, 1.0);
    for (let y = Math.floor(NY * 0.58); y < NY - 1; y++) {
      for (let x = 1; x < NX - 1; x++) {
        const i = IX(x, y);
        if (!solid[i]) O2[i] = Math.max(0.03, O2[i] - 0.0025);
      }
    }

    // Metrics
    let minT = 10, maxT = -10, dSum = 0, dCnt = 0;
    const deepY = Math.floor(NY * 0.72);
    for (let y = 2; y < NY - 2; y++) {
      for (let x = 2; x < NX - 2; x++) {
        const i = IX(x, y);
        if (solid[i]) continue;
        if (T[i] < minT) minT = T[i];
        if (T[i] > maxT) maxT = T[i];
        if (y >= deepY) { dSum += O2[i]; dCnt++; }
      }
    }
    G.dT = Math.max(0, (maxT - minT) * 14);
    G.deepO2 = dCnt ? (dSum / dCnt) * 100 : 0;

    // Advect streamlines
    for (const pt of parts) {
      pt.px = pt.x; pt.py = pt.y;
      pt.x += (sample(u, pt.x, pt.y) / NX) * dt * 1.9;
      pt.y += (sample(v, pt.x, pt.y) / NY) * dt * 1.9;
      pt.life += dt * 0.24;
      const gx = Math.floor(pt.x * (NX - 1)), gy = Math.floor(pt.y * (NY - 1));
      if (pt.x <= 0.02 || pt.x >= 0.98 || pt.y <= 0.02 || pt.y >= 0.96 || pt.life > 1 || solid[IX(gx, gy)]) {
        pt.x = 0.04 + Math.random() * 0.92;
        pt.y = 0.05 + Math.random() * 0.84;
        if (solid[IX(Math.floor(pt.x * (NX - 1)), Math.floor(pt.y * (NY - 1)))]) pt.y = 0.14 + Math.random() * 0.28;
        pt.px = pt.x; pt.py = pt.y; pt.life = 0;
      }
    }

    // Spawn & advect O2 bubbles
    G.spawnAcc += dt;
    if (G.spawnAcc > 0.22 && bubbles.length < 40) {
      G.spawnAcc = 0;
      let bx = 0.5, best = -1;
      for (let k = 0; k < 5; k++) {
        const tx = 0.08 + Math.random() * 0.84;
        const sc = sample(v, tx, 0.12) - sample(T, tx, 0.10) * 1.8;
        if (sc > best) { best = sc; bx = tx; }
      }
      if (best > 0.3) bubbles.push({ x: bx, y: 0.06, life: 1.0, r: 4.5 + Math.random() * 2 });
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.x = Math.max(0.03, Math.min(0.97, b.x + (sample(u, b.x, b.y) / NX) * dt * 2.25));
      b.y = Math.max(0.05, Math.min(0.93, b.y + ((sample(v, b.x, b.y) - 0.5) / NY) * dt * 2.25));
      b.life -= dt * 0.05;
      let hit = false;
      for (const rf of G.reefs) {
        if (Math.hypot((b.x - rf.x) * 1.3, b.y - rf.y) < rf.r) {
          rf.o2 = Math.min(1, rf.o2 + 0.18);
          if (!G.won && rf.fed < rf.goal) rf.fed++;
          SFX.play('press');
          bursts.push({ x: b.x, y: b.y, r: 0, life: 1, col: '#3be8a4' });
          hit = true; break;
        }
      }
      if (hit || b.life <= 0) bubbles.splice(i, 1);
    }

    for (const rf of G.reefs) {
      const supply = sample(O2, rf.x, rf.y - 0.06) * (0.4 + Math.min(1.2, Math.hypot(sample(u, rf.x, rf.y - 0.06), sample(v, rf.x, rf.y - 0.06)) * 0.25));
      rf.o2 = Math.max(0, Math.min(1, rf.o2 + (supply - (G.level === 2 ? 0.24 : 0.18)) * dt * 0.42));
    }

    if (G.ammonite && !G.won) {
      const am = G.ammonite;
      am.vx += ((sample(u, am.x, am.y) / NX) * 2.15 - am.vx) * Math.min(1, dt * 4.5);
      am.vy += ((sample(v, am.x, am.y) / NY) * 2.15 - am.vy) * Math.min(1, dt * 4.5);
      const nx = Math.max(0.05, Math.min(0.95, am.x + am.vx * dt));
      const ny = Math.max(0.08, Math.min(0.88, am.y + am.vy * dt));
      if (!solid[IX(Math.floor(nx * (NX - 1)), Math.floor(ny * (NY - 1)))]) { am.x = nx; am.y = ny; }
      else { am.vx *= -0.4; am.vy *= -0.4; }
      if (Math.hypot(am.vx, am.vy) > 0.01) am.angle = Math.atan2(am.vy, am.vx);
      am.trail.push([am.x, am.y]);
      if (am.trail.length > 28) am.trail.shift();
      for (const g of G.gates) {
        if (!g.hit && Math.hypot((am.x - g.x) * 1.3, am.y - g.y) < g.r) {
          g.hit = true; SFX.play('good');
          bursts.push({ x: g.x, y: g.y, r: 0, life: 1, col: '#ffd028' });
        }
      }
    }

    for (let i = bursts.length - 1; i >= 0; i--) {
      bursts[i].life -= dt * 2.2;
      bursts[i].r = (1 - bursts[i].life) * 0.07;
      if (bursts[i].life <= 0) bursts.splice(i, 1);
    }

    // Compute normalized progress & check victory
    if (G.level === 0) {
      G.progress = Math.min(1, G.reefs[0].fed / G.reefs[0].goal);
      if (G.progress >= 1) G.won = true;
    } else if (G.level === 1) {
      const f = G.reefs[0].fed + G.reefs[1].fed, g = G.reefs[0].goal + G.reefs[1].goal;
      G.progress = Math.min(1, f / g);
      if (G.reefs.every(r => r.fed >= r.goal)) G.won = true;
    } else if (G.level === 2) {
      const alive = G.reefs.filter(r => r.o2 > 0.16).length;
      if (alive >= 2) G.survive += dt;
      else G.survive = Math.max(0, G.survive - dt * 0.6);
      G.progress = Math.min(1, G.survive / G.surviveGoal);
      if (G.progress >= 1) G.won = true;
    } else {
      const hits = G.gates.filter(g => g.hit).length;
      G.progress = hits / G.gates.length;
      if (hits >= G.gates.length) G.won = true;
    }

    return G;
  }

  function renderToTiles(playerList, activeMask) {
    const W = 384, H = 228;
    sctx.fillStyle = '#000';
    sctx.fillRect(0, 0, 420, 420);

    // Thermal field bitmap
    const d = fimg.data;
    for (let i = 0; i < SIZE; i++) {
      const o = i * 4;
      if (solid[i]) { d[o] = 0; d[o+1] = 0; d[o+2] = 0; d[o+3] = 0; continue; }
      const t = T[i], o2 = O2[i];
      let r = 0, g = 0, b = 0, a = 0;
      if (t > 0.04) { const k = Math.min(1, t * 1.2); r = 255; g = Math.round(95 + 75*(1-k)); b = 26; a = Math.round(k * 175); }
      else if (t < -0.04) { const k = Math.min(1, -t * 1.2); r = 24; g = Math.round(175 + 75*k); b = 255; a = Math.round(k * 175); }
      if (o2 < 0.20) { const h = (0.20 - o2) / 0.20; r = Math.min(255, r + Math.round(80 * h)); a = Math.max(a, Math.round(70 * h)); }
      d[o] = r; d[o+1] = g; d[o+2] = b; d[o+3] = a;
    }
    fctx.putImageData(fimg, 0, 0);

    sctx.save();
    sctx.translate(18, 96);
    sctx.drawImage(fieldCanvas, 0, 0, W, H);

    // Surface shimmer line
    sctx.beginPath();
    for (let x = 0; x <= 40; x++) {
      const f = x / 40, px = f * W, py = H * 0.04 + Math.sin(f * 12 + G.elapsed * 2.8) * 2.4;
      if (x === 0) sctx.moveTo(px, py); else sctx.lineTo(px, py);
    }
    sctx.strokeStyle = 'rgba(130, 225, 255, 0.72)';
    sctx.lineWidth = 2;
    sctx.stroke();

    // Smooth seafloor ridge contour
    const cw = W / NX, ch = H / NY;
    sctx.beginPath();
    sctx.moveTo(0, H);
    for (let x = 1; x < NX - 1; x++) {
      let topY = NY - 1;
      for (let y = NY - 2; y >= 2; y--) { if (solid[IX(x, y)]) topY = y; else break; }
      sctx.lineTo((x + 0.5) * cw, topY * ch);
    }
    sctx.lineTo(W, H); sctx.closePath();
    sctx.fillStyle = '#141a24'; sctx.fill();
    sctx.strokeStyle = 'rgba(135, 190, 240, 0.45)'; sctx.lineWidth = 1.6; sctx.stroke();

    // Streamlines
    sctx.lineCap = 'round';
    for (const pt of parts) {
      const dx = (pt.x - pt.px) * W, dy = (pt.y - pt.py) * H, len = Math.hypot(dx, dy);
      if (len < 0.25 || len > 28) continue;
      const t = sample(T, pt.x, pt.y);
      const col = t >= 0
        ? `rgba(255,${Math.round(160 - 70 * Math.min(1, t))},${Math.round(140 * (1 - Math.min(1, t)) + 30)},`
        : `rgba(${Math.round(60 + 40 * Math.min(1, -t))},${Math.round(190 + 60 * Math.min(1, -t))},255,`;
      sctx.strokeStyle = `${col}${Math.min(0.95, (0.35 + len * 0.14) * Math.sin(pt.life * Math.PI)).toFixed(2)})`;
      sctx.lineWidth = 1.8;
      sctx.beginPath();
      sctx.moveTo(pt.px * W - dx * 2.5, pt.py * H - dy * 2.5);
      sctx.lineTo(pt.x * W, pt.y * H);
      sctx.stroke();
    }

    // 4 Corner Thermal Stations colored to match the 4 Holo Stage players!
    STATIONS.forEach((st, i) => {
      const sx = st.nx * W, sy = st.ny * H, on = !!activeMask[i], c = G.colors[i];
      if (on) {
        const glw = sctx.createRadialGradient(sx, sy, 2, sx, sy, 34);
        glw.addColorStop(0, st.kind === 'vent' ? 'rgba(255,120,40,0.85)' : 'rgba(65,215,255,0.85)');
        glw.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = glw;
        sctx.beginPath(); sctx.arc(sx, sy, 34, 0, Math.PI * 2); sctx.fill();
      }
      sctx.fillStyle = on ? c : 'rgba(255,255,255,0.22)';
      sctx.strokeStyle = c; sctx.lineWidth = 2.2;
      sctx.beginPath();
      if (st.kind === 'vent') {
        sctx.moveTo(sx - 13, sy + 9); sctx.lineTo(sx - 6, sy - 9); sctx.lineTo(sx + 6, sy - 9); sctx.lineTo(sx + 13, sy + 9);
      } else {
        sctx.moveTo(sx - 15, sy - 3); sctx.lineTo(sx - 5, sy - 10); sctx.lineTo(sx + 6, sy - 8); sctx.lineTo(sx + 15, sy - 2); sctx.lineTo(sx + 9, sy + 8); sctx.lineTo(sx - 9, sy + 7);
      }
      sctx.closePath(); sctx.fill(); sctx.stroke();
    });

    // Reefs
    for (const rf of G.reefs) {
      const rx = rf.x * W, ry = rf.y * H, rad = 18;
      const sway = Math.max(-0.55, Math.min(0.55, sample(u, rf.x, rf.y - 0.06) * 0.09)) + Math.sin(G.elapsed * 2.6) * 0.08;
      const col = rf.o2 > 0.45 ? '#3be8a4' : (rf.o2 > 0.22 ? '#ffb845' : '#ff4646');
      sctx.strokeStyle = col; sctx.lineWidth = 2.2;
      for (let k = -2; k <= 2; k++) {
        const bx = rx + k * 5.5, sh = 14 + (k % 2 === 0 ? 5 : 1);
        sctx.beginPath(); sctx.moveTo(bx, ry + 5); sctx.quadraticCurveTo(bx + sway * sh * 0.5, ry - sh * 0.5, bx + sway * sh * 1.1, ry - sh); sctx.stroke();
      }
      sctx.lineWidth = 2.8; sctx.strokeStyle = 'rgba(255,255,255,0.2)';
      sctx.beginPath(); sctx.arc(rx, ry - 4, rad, 0, Math.PI * 2); sctx.stroke();
      const frac = (G.level === 0 || G.level === 1) ? Math.min(1, rf.fed / rf.goal) : rf.o2;
      sctx.strokeStyle = col;
      sctx.beginPath(); sctx.arc(rx, ry - 4, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); sctx.stroke();
    }

    // Level 4 Gates & Ammonite
    for (const g of G.gates) {
      sctx.strokeStyle = g.hit ? '#3be8a4' : '#ffd028'; sctx.lineWidth = 2.5;
      sctx.setLineDash(g.hit ? [] : [5, 4]);
      sctx.beginPath(); sctx.arc(g.x * W, g.y * H, 16, 0, Math.PI * 2); sctx.stroke();
      sctx.setLineDash([]);
    }
    if (G.ammonite) {
      const am = G.ammonite;
      if (am.trail.length > 2) {
        sctx.beginPath();
        am.trail.forEach(([tx, ty], k) => { if (k === 0) sctx.moveTo(tx * W, ty * H); else sctx.lineTo(tx * W, ty * H); });
        sctx.strokeStyle = 'rgba(255,215,95,0.5)'; sctx.lineWidth = 2.5; sctx.stroke();
      }
      sctx.save(); sctx.translate(am.x * W, am.y * H); sctx.rotate(am.angle);
      sctx.fillStyle = '#f5b95b'; sctx.strokeStyle = '#6c3c12'; sctx.lineWidth = 2;
      sctx.beginPath(); sctx.arc(0, 0, 10, 0, Math.PI * 2); sctx.fill(); sctx.stroke();
      sctx.restore();
    }

    // O2 bubbles & bursts
    for (const b of bubbles) {
      const bx = b.x * W, by = b.y * H;
      sctx.fillStyle = '#7affcf';
      sctx.beginPath(); sctx.arc(bx, by, b.r * 0.72, 0, Math.PI * 2); sctx.fill();
    }
    for (const b of bursts) {
      sctx.strokeStyle = b.col; sctx.globalAlpha = Math.max(0, b.life); sctx.lineWidth = 2.4;
      sctx.beginPath(); sctx.arc(b.x * W, b.y * H, b.r * H, 0, Math.PI * 2); sctx.stroke();
      sctx.globalAlpha = 1;
    }

    sctx.restore();

    // Blit into all 4 Holo Stage pyramid tiles
    for (const pl of playerList) {
      if (!pl.mgCtx) continue;
      pl.mgCtx.clearRect(0, 0, 420, 420);
      pl.mgCtx.drawImage(srcCanvas, 0, 0);
    }
  }

  return { init, step, renderToTiles, STATIONS, state: G };
})();

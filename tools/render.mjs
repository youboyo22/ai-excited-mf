// Renders entry.png for the ai-excited-01 entry "Sunleap".
// Pure Node standard library: every pixel is computed here, deterministically (seeded RNG, no clock).
//   node tools/render.mjs            -> writes ../entry.png (1024x1024 RGB PNG)
//   node tools/render.mjs 3 out.png  -> supersampling factor and output path

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const SS = Math.max(1, Number(process.argv[2] ?? 3) | 0);
const OUT = process.argv[3] ?? fileURLToPath(new URL('../entry.png', import.meta.url));
const RW = SIZE * SS;
const PX = 1 / RW; // one sample in scene units (scene is the unit square, y down)

// ---------------------------------------------------------------- small maths
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = (e0, e1, v) => {
  const k = clamp01((v - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
};
const bump = (v, centre, width) => Math.exp(-(((v - centre) / width) ** 2));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(ix, iy) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

function noise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy), b = lattice(ix + 1, iy);
  const c = lattice(ix, iy + 1), d = lattice(ix + 1, iy + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function fbm(x, y, octaves) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y);
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- the scene
const HORIZON = 0.835;
const SUN = { x: 0.565, y: 0.615, r: 0.245 };

// Whale spine: tail (in the spray) -> snout, a leap that arcs over the sun.
const SPINE_CTRL = [[0.205, 0.705], [0.265, 0.36], [0.5, 0.13], [0.82, 0.235]];
const SEGS = 110;
const spX = new Float64Array(SEGS + 1), spY = new Float64Array(SEGS + 1), spLen = new Float64Array(SEGS + 1);
for (let i = 0; i <= SEGS; i++) {
  const k = i / SEGS, m = 1 - k;
  const [p0, p1, p2, p3] = SPINE_CTRL;
  spX[i] = m * m * m * p0[0] + 3 * m * m * k * p1[0] + 3 * m * k * k * p2[0] + k * k * k * p3[0];
  spY[i] = m * m * m * p0[1] + 3 * m * m * k * p1[1] + 3 * m * k * k * p2[1] + k * k * k * p3[1];
  spLen[i] = i ? spLen[i - 1] + Math.hypot(spX[i] - spX[i - 1], spY[i] - spY[i - 1]) : 0;
}
const SPINE_LEN = spLen[SEGS];

// Half-thickness of the body along the spine (0 = tail stock, 1 = snout).
const GIRTH = [[0, 0.012], [0.1, 0.02], [0.25, 0.043], [0.4, 0.068], [0.55, 0.085], [0.66, 0.09], [0.78, 0.085], [0.9, 0.072], [0.97, 0.054], [1, 0.038]];
const girthLut = new Float64Array(513);
for (let i = 0; i <= 512; i++) {
  const t = i / 512;
  let j = 0;
  while (j < GIRTH.length - 2 && t > GIRTH[j + 1][0]) j++;
  const g0 = GIRTH[Math.max(0, j - 1)], g1 = GIRTH[j], g2 = GIRTH[j + 1], g3 = GIRTH[Math.min(GIRTH.length - 1, j + 2)];
  const k = (t - g1[0]) / (g2[0] - g1[0]);
  const m1 = (g2[1] - g0[1]) / (g2[0] - g0[0] || 1) * (g2[0] - g1[0]);
  const m2 = (g3[1] - g1[1]) / (g3[0] - g1[0] || 1) * (g2[0] - g1[0]);
  const k2 = k * k, k3 = k2 * k;
  girthLut[i] = (2 * k3 - 3 * k2 + 1) * g1[1] + (k3 - 2 * k2 + k) * m1 + (-2 * k3 + 3 * k2) * g2[1] + (k3 - k2) * m2;
}
function girth(t, side) {
  const f = clamp01(t) * 512, i = Math.min(511, f | 0);
  const base = lerp(girthLut[i], girthLut[i + 1], f - i);
  const fade = sstep(1, 0.95, t) * sstep(0, 0.15, t);
  // throat bulges on the belly side, the top of the head stays flatter
  return base * (1 + (side > 0 ? 0.24 : -0.1) * bump(t, 0.76, 0.2) * fade);
}

function spineAt(t) {
  const target = clamp01(t) * SPINE_LEN;
  let i = 0;
  while (i < SEGS - 1 && spLen[i + 1] < target) i++;
  const k = (target - spLen[i]) / (spLen[i + 1] - spLen[i]);
  const tx = spX[i + 1] - spX[i], ty = spY[i + 1] - spY[i], tl = Math.hypot(tx, ty);
  return { x: lerp(spX[i], spX[i + 1], k), y: lerp(spY[i], spY[i + 1], k), tx: tx / tl, ty: ty / tl };
}
// A point on the body: t along the spine, s across it (+1 = belly edge, -1 = back edge).
function bodyPoint(t, s) {
  const c = spineAt(t), r = girth(t, s) * s;
  return { x: c.x - c.ty * r, y: c.y + c.tx * r, tx: c.tx, ty: c.ty };
}

// Closed outlines: corner cutting keeps curves smooth, vertices flagged sharp stay as points.
function outline(points, rounds) {
  let cur = points.map(([u, v, sharp]) => ({ u, v, sharp: !!sharp }));
  for (let r = 0; r < rounds; r++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      if (a.sharp) next.push(a);
      else next.push({ u: lerp(a.u, b.u, 0.25), v: lerp(a.v, b.v, 0.25), sharp: false });
      if (!b.sharp) next.push({ u: lerp(a.u, b.u, 0.75), v: lerp(a.v, b.v, 0.75), sharp: false });
    }
    cur = next;
  }
  return cur;
}
function place(shape, ox, oy, ux, uy) {
  const xs = new Float64Array(shape.length), ys = new Float64Array(shape.length);
  let x0 = 9, y0 = 9, x1 = -9, y1 = -9;
  shape.forEach((p, i) => {
    xs[i] = ox + p.u * ux - p.v * uy;
    ys[i] = oy + p.u * uy + p.v * ux;
    x0 = Math.min(x0, xs[i]); x1 = Math.max(x1, xs[i]);
    y0 = Math.min(y0, ys[i]); y1 = Math.max(y1, ys[i]);
  });
  return { xs, ys, n: shape.length, x0, y0, x1, y1 };
}
function polyDist(poly, x, y) {
  const { xs, ys, n } = poly;
  let best = 1e9, inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ex = xs[j] - xs[i], ey = ys[j] - ys[i];
    const wx = x - xs[i], wy = y - ys[i];
    const k = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
    const qx = wx - ex * k, qy = wy - ey * k;
    const d = qx * qx + qy * qy;
    if (d < best) best = d;
    if ((ys[i] > y) !== (ys[j] > y) && x < xs[i] + ((y - ys[i]) * ex) / ey) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}
// distance to a polygon only matters near it; far away a cheap bound is enough
function polyNear(poly, x, y, pad) {
  if (x < poly.x0 - pad || x > poly.x1 + pad || y < poly.y0 - pad || y > poly.y1 + pad) {
    return Math.max(poly.x0 - x, x - poly.x1, poly.y0 - y, y - poly.y1);
  }
  return polyDist(poly, x, y);
}

// Tail flukes: u runs back along the tail, v across it.
const flukeHalf = [[-0.035, 0.011], [0.0, 0.024], [0.018, 0.062], [0.042, 0.112], [0.082, 0.168, 1], [0.08, 0.125], [0.069, 0.078], [0.066, 0.036]];
const flukeShape = outline(
  [...flukeHalf, [0.05, 0, 1], ...flukeHalf.slice().reverse().map(([u, v, s]) => [u, -v, s])],
  3,
);
const tail = spineAt(0);
const FLUKE = place(flukeShape, tail.x, tail.y, -tail.tx, -tail.ty);

// Pectoral fins: long knobbly paddles, the near one thrown down across the sun, the far one flung up.
function finShape(length, width) {
  const top = [], bottom = [];
  for (let i = 0; i <= 9; i++) {
    const k = i / 9, u = -0.03 + (length + 0.03) * k;
    const taper = Math.pow(1 - k, 0.55) * (0.75 + 0.25 * sstep(0, 0.25, k));
    const sweep = -0.055 * length * Math.sin(k * 2.6);
    top.push([u, sweep + width * taper * (1 + 0.1 * Math.sin(k * 21))]);
    bottom.push([u, sweep - width * 0.55 * taper]);
  }
  top[9][2] = 1;
  return outline([...top, ...bottom.slice(0, 9).reverse()], 3);
}
function finAt(t, s, along, across, length, width) {
  const root = bodyPoint(t, s);
  let dx = root.tx * along - root.ty * across, dy = root.ty * along + root.tx * across;
  const dl = Math.hypot(dx, dy);
  dx /= dl; dy /= dl;
  return { poly: place(finShape(length, width), root.x, root.y, dx, dy), root, dx, dy, length };
}
const NEAR_FIN = finAt(0.655, 0.5, -0.5, 0.86, 0.3, 0.05);
const FAR_FIN = finAt(0.69, -0.6, -0.8, -0.6, 0.18, 0.026);

// Signed distance to the whole whale; also reports where on the body the point sits.
const hit = { t: 0, s: 0, part: 0 };
function whale(x, y) {
  let best = 1e9, bi = 0, bk = 0;
  for (let i = 0; i < SEGS; i++) {
    const ex = spX[i + 1] - spX[i], ey = spY[i + 1] - spY[i];
    const wx = x - spX[i], wy = y - spY[i];
    const k = clamp01((wx * ex + wy * ey) / (ex * ex + ey * ey));
    const qx = wx - ex * k, qy = wy - ey * k;
    const d = qx * qx + qy * qy;
    if (d < best) { best = d; bi = i; bk = k; }
  }
  const ex = spX[bi + 1] - spX[bi], ey = spY[bi + 1] - spY[bi];
  const side = ex * (y - spY[bi]) - ey * (x - spX[bi]) > 0 ? 1 : -1;
  const t = lerp(spLen[bi], spLen[bi + 1], bk) / SPINE_LEN;
  const r = girth(t, side), dist = Math.sqrt(best);
  let d = dist - r;
  hit.t = t; hit.s = (side * dist) / r; hit.part = 0;
  if (d > 0.45) return d;
  const parts = [polyNear(FLUKE, x, y, 0.05), polyNear(NEAR_FIN.poly, x, y, 0.05), polyNear(FAR_FIN.poly, x, y, 0.05)];
  for (let p = 0; p < 3; p++) {
    const o = parts[p];
    if (o < d) hit.part = p + 1;
    const h = clamp01(0.5 + (0.5 * (o - d)) / 0.012); // smooth union so the fins grow out of the body
    d = lerp(o, d, h) - 0.012 * h * (1 - h);
  }
  return d;
}

// ---------------------------------------------------------------- pass 1: whale distance field
const t0 = Date.now();
const field = new Float32Array(RW * RW);
const bodyT = new Float32Array(RW * RW), bodyS = new Float32Array(RW * RW);
const bodyPart = new Uint8Array(RW * RW);
for (let j = 0; j < RW; j++) {
  const y = (j + 0.5) * PX;
  for (let i = 0; i < RW; i++) {
    const idx = j * RW + i;
    field[idx] = whale((i + 0.5) * PX, y);
    bodyT[idx] = hit.t; bodyS[idx] = hit.s; bodyPart[idx] = hit.part;
  }
}

// ---------------------------------------------------------------- pass 2: spray, an additive light buffer
const light = new Float32Array(RW * RW * 3);
function streak(x0, y0, x1, y1, radius, r, g, b) {
  const sig = Math.max(radius * RW, 0.6), pad = sig * 3 + 1;
  const ax = x0 * RW, ay = y0 * RW, bx = x1 * RW, by = y1 * RW;
  const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - pad)), i1 = Math.min(RW - 1, Math.ceil(Math.max(ax, bx) + pad));
  const j0 = Math.max(0, Math.floor(Math.min(ay, by) - pad)), j1 = Math.min(RW - 1, Math.ceil(Math.max(ay, by) + pad));
  const ex = bx - ax, ey = by - ay, el = ex * ex + ey * ey || 1e-9, inv = 1 / (2 * sig * sig);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const wx = i + 0.5 - ax, wy = j + 0.5 - ay;
      const k = clamp01((wx * ex + wy * ey) / el);
      const qx = wx - ex * k, qy = wy - ey * k;
      const w = Math.exp(-(qx * qx + qy * qy) * inv);
      if (w < 0.004) continue;
      const o = (j * RW + i) * 3;
      light[o] += r * w; light[o + 1] += g * w; light[o + 2] += b * w;
    }
  }
}

const rnd = rng(20261117);
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 0.87;
const GRAVITY = 1.0;
const BREACH = { x: 0.175, y: HORIZON + 0.004 };

// The eruption where the whale left the sea: a crown of water thrown up and outward.
for (let n = 0; n < 6500; n++) {
  const lean = 0.12 + gauss() * 0.8;
  const speed = 0.2 + 0.62 * Math.pow(rnd(), 1.1) * Math.exp(-lean * lean * 0.6);
  const vx = Math.sin(lean) * speed, vy = -Math.cos(lean) * speed;
  const age = rnd() * 0.75;
  const x = BREACH.x + gauss() * 0.035 + vx * age;
  const y = BREACH.y + vy * age + 0.5 * GRAVITY * age * age;
  if (y > HORIZON + 0.01) continue;
  // most of it is fine round droplets; a few fast threads of water draw the motion
  const wy = vy + GRAVITY * age, len = rnd() < 0.14 ? 0.03 + 0.04 * rnd() : 0.005;
  const heat = 0.3 + 0.9 * rnd() * rnd();
  streak(x, y, x - vx * len, y - wy * len, 0.0005 + 0.0015 * rnd() ** 3, heat, heat * 0.86, heat * 0.62);
}
// mist at its base
for (let n = 0; n < 150; n++) {
  const x = BREACH.x + gauss() * 0.1, y = HORIZON - Math.abs(gauss()) * 0.085;
  streak(x, y, x + 0.01, y, 0.012 + 0.028 * rnd(), 0.075, 0.056, 0.044);
}

// The twist: the night inside the whale leaks out. Stars stream off its back and hang in its wake.
function sparkle(x, y, size, power) {
  streak(x, y, x, y, size * 0.5, power * 0.75, power * 0.9, power);
  if (size < 0.0022) return;
  const arm = size * 4.5;
  streak(x - arm, y, x + arm, y, size * 0.16, power * 0.5, power * 0.7, power * 0.9);
  streak(x, y - arm, x, y + arm, size * 0.16, power * 0.5, power * 0.7, power * 0.9);
}
for (let n = 0; n < 420; n++) {
  const o = bodyPoint(0.02 + 0.9 * Math.pow(rnd(), 0.8), -1);
  const drift = Math.pow(rnd(), 1.6) * 0.3;
  // left behind along the path of the leap, spreading outward from the back as they age
  const x = o.x - o.tx * drift * 0.75 + o.ty * drift * (0.25 + 0.5 * rnd()) + gauss() * 0.012;
  const y = o.y - o.ty * drift * 0.75 - o.tx * drift * (0.25 + 0.5 * rnd()) + gauss() * 0.012;
  if (y > HORIZON - 0.05 || y < 0.01 || x < 0.01) continue;
  sparkle(x, y, 0.0009 + 0.0026 * rnd() ** 4, (0.5 + 0.7 * rnd()) * (1 - drift / 0.34));
}
// foam rings spreading on the surface
for (let n = 0; n < 120; n++) {
  const x = BREACH.x + gauss() * 0.13, y = HORIZON + 0.004 + Math.abs(gauss()) * 0.03;
  const w = 0.01 + 0.035 * rnd();
  streak(x - w, y, x + w, y, 0.0012, 0.5, 0.42, 0.32);
}

// Water still pouring off the animal, lagging behind its leap and falling.
function shed(origin, count, lagSpeed, maxAge, glow) {
  for (let n = 0; n < count; n++) {
    const o = origin();
    const age = Math.pow(rnd(), 1.4) * maxAge, keep = 0.25 + 0.4 * rnd();
    const lag = lagSpeed * (1 - keep) * age;
    const x = o.x - o.tx * lag + gauss() * 0.004, y = o.y - o.ty * lag + 0.5 * GRAVITY * age * age + gauss() * 0.004;
    if (y > HORIZON) continue;
    const vx = o.tx * lagSpeed * keep, vy = o.ty * lagSpeed * keep + GRAVITY * age;
    const len = rnd() < 0.45 ? 0.04 + 0.06 * rnd() : 0.006, fade = glow * (1 - age / maxAge) * (0.35 + 0.65 * rnd());
    streak(x, y, x - vx * len, y - vy * len, 0.0005 + 0.0012 * rnd() ** 3, fade, fade * 0.84, fade * 0.58);
  }
}
shed(() => { // off the trailing edge of the flukes
  const v = (rnd() * 2 - 1) * 0.16, u = 0.06 + 0.02 * rnd();
  return { x: tail.x - tail.tx * u - tail.ty * v, y: tail.y - tail.ty * u + tail.tx * v, tx: tail.tx, ty: tail.ty };
}, 2600, 0.9, 0.42, 0.8);
shed(() => bodyPoint(0.03 + 0.3 * rnd(), 0.9), 1300, 0.9, 0.4, 0.6); // off the belly
shed(() => bodyPoint(0.04 + 0.3 * rnd(), -0.9), 500, 0.9, 0.35, 0.5); // off the back
shed(() => { // off the near fin
  const k = Math.pow(rnd(), 0.6) * NEAR_FIN.length;
  return { x: NEAR_FIN.root.x + NEAR_FIN.dx * k, y: NEAR_FIN.root.y + NEAR_FIN.dy * k, tx: NEAR_FIN.root.tx, ty: NEAR_FIN.root.ty };
}, 500, 0.8, 0.3, 0.6);
shed(() => { // off the far fin
  const k = Math.pow(rnd(), 0.6) * FAR_FIN.length;
  return { x: FAR_FIN.root.x + FAR_FIN.dx * k, y: FAR_FIN.root.y + FAR_FIN.dy * k, tx: FAR_FIN.root.tx, ty: FAR_FIN.root.ty };
}, 260, 0.8, 0.3, 0.5);

// ---------------------------------------------------------------- pass 3: shade every sample
const col = [0, 0, 0];
function add(k, r, g, b) { col[0] += r * k; col[1] += g * k; col[2] += b * k; }
function blend(k, r, g, b) { col[0] = lerp(col[0], r, k); col[1] = lerp(col[1], g, k); col[2] = lerp(col[2], b, k); }

const SKY = [[0, 0.11, 0.04, 0.3], [0.28, 0.4, 0.07, 0.44], [0.52, 0.86, 0.2, 0.36], [0.72, 1.0, 0.45, 0.2], [0.84, 1.0, 0.66, 0.24]];
function starLayer(x, y, cell, chance, size) {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  let sum = 0;
  for (let cy = gy - 1; cy <= gy + 1; cy++) {
    for (let cx = gx - 1; cx <= gx + 1; cx++) {
      const pick = lattice(cx * 7 + 3, cy * 13 + 5);
      if (pick > chance) continue;
      const sx = (cx + 0.15 + 0.7 * lattice(cx + 91, cy - 17)) * cell, sy = (cy + 0.15 + 0.7 * lattice(cx - 33, cy + 57)) * cell;
      const rad = size * (0.45 + 1.1 * lattice(cx + 5, cy + 211) ** 3);
      const d2 = (x - sx) ** 2 + (y - sy) ** 2;
      sum += Math.exp(-d2 / (rad * rad)) * (0.5 + 0.5 * pick / chance);
    }
  }
  return sum;
}

function shadeSky(x, y) {
  let i = 0;
  while (i < SKY.length - 2 && y > SKY[i + 1][0]) i++;
  const k = sstep(SKY[i][0], SKY[i + 1][0], y);
  col[0] = lerp(SKY[i][1], SKY[i + 1][1], k); col[1] = lerp(SKY[i][2], SKY[i + 1][2], k); col[2] = lerp(SKY[i][3], SKY[i + 1][3], k);
  const dx = x - SUN.x, dy = y - SUN.y, d = Math.hypot(dx, dy), out = Math.max(0, d - SUN.r);
  // faint stars in the dark top of the sky
  add(starLayer(x, y, 0.045, 0.55, 0.0022) * sstep(0.34, 0.02, y) * sstep(0.25, 0.5, d), 0.9, 0.85, 1.0);
  // long streaked clouds catching the light from below
  const cloud = sstep(0.5, 0.78, fbm(x * 2.6 + 3, y * 15, 4)) * sstep(0.6, 0.1, y) * 0.3;
  blend(cloud, 1.0, 0.5, 0.5);
  // the sun's halo and the rays fanning out of it
  add(Math.exp(-out / 0.2) * 0.55, 1.0, 0.5, 0.12);
  const ang = Math.atan2(dy, dx);
  let ray = 0.5 + 0.26 * Math.sin(ang * 9 + 1.3) + 0.16 * Math.sin(ang * 17 + 4.1) + 0.1 * Math.sin(ang * 31 + 0.7);
  ray = Math.pow(clamp01(ray), 2.4) * Math.exp(-out / 0.5) * 0.42;
  add(ray, 1.0, 0.72, 0.34);
  const disc = sstep(SUN.r + PX, SUN.r - PX, d), core = (d / SUN.r) ** 2;
  blend(disc, 1.0, lerp(0.99, 0.8, core), lerp(0.86, 0.34, core));
}

function shadeSea(x, y) {
  const depth = (y - HORIZON) / (1 - HORIZON);
  const k = Math.pow(depth, 0.55);
  col[0] = lerp(0.8, 0.05, k); col[1] = lerp(0.34, 0.035, k); col[2] = lerp(0.27, 0.19, k);
  const row = Math.log(depth + 0.03) * 9, spread = 9 / (0.35 + depth * 1.6);
  const swell = fbm(x * spread, row, 3), chop = noise(x * spread * 2.2 + 40, row * 2.3);
  add((swell - 0.5) * 0.35 * (1 - 0.5 * k), 1.0, 0.5, 0.4);
  // the sun's road of light across the water
  const road = Math.exp(-(((x - SUN.x) / (0.06 + 0.33 * depth)) ** 2));
  add(sstep(0.5, 0.7, chop * 0.6 + swell * 0.4) * road * (1 - 0.35 * depth), 1.0, 0.8, 0.42);
  add(road * Math.exp(-depth / 0.12) * 0.45, 1.0, 0.75, 0.35);
  add(Math.exp(-depth / 0.012) * 0.35, 1.0, 0.8, 0.55); // glare on the horizon line
}

// A small sailing boat under the falling head, for scale.
const BOAT = { x: 0.872, y: HORIZON + 0.017, s: 0.02 };
const HULL = place(outline([[-1.15, -0.28, 1], [1.2, -0.28, 1], [0.8, 0.12], [-0.85, 0.12]], 2), BOAT.x, BOAT.y, BOAT.s, 0);
const SAIL = place(outline([[0.08, -2.2, 1], [0.9, -0.42, 1], [0.08, -0.42, 1]], 0), BOAT.x, BOAT.y, BOAT.s, 0);
const JIB = place(outline([[-0.06, -1.9, 1], [-0.06, -0.42, 1], [-0.75, -0.42, 1]], 0), BOAT.x, BOAT.y, BOAT.s, 0);
function boat(x, y) {
  if (Math.abs(x - BOAT.x) > 0.03 || y < BOAT.y - 0.05 || y > BOAT.y + 0.01) return 1;
  return Math.min(polyDist(HULL, x, y), polyDist(SAIL, x, y), polyDist(JIB, x, y));
}

function shadeWhale(x, y, idx, d, nx, ny) {
  const t = bodyT[idx], s = bodyS[idx], part = bodyPart[idx];
  // the animal is a window of deep night: nebula and stars
  const cloudA = fbm(x * 5 + 2, y * 5 + 7, 4), cloudB = fbm(x * 7 + 31, y * 7 + 13, 4);
  col[0] = 0.02 + 0.05 * cloudA; col[1] = 0.03 + 0.04 * cloudA; col[2] = 0.13 + 0.14 * cloudA;
  add(sstep(0.45, 0.8, cloudB) * 0.5, 0.05, 0.42, 0.55);
  add(sstep(0.5, 0.85, cloudA) * 0.45, 0.5, 0.1, 0.55);
  add(starLayer(x, y, 0.021, 0.7, 0.0021) * 1.1 + starLayer(x + 5, y + 3, 0.055, 0.5, 0.0042), 0.95, 0.95, 1.0);

  // sunlight: the sun is behind and below, so the belly and every sun-facing edge burn gold
  let lx = SUN.x - x, ly = SUN.y - y;
  const ll = Math.hypot(lx, ly);
  lx /= ll; ly /= ll;
  const facing = nx * lx + ny * ly;
  if (part === 0) {
    // pleated throat on the belly side
    const pleats = sstep(0.42, 0.56, t) * sstep(0.995, 0.93, t) * sstep(0.12, 0.3, s);
    const groove = 0.5 + 0.5 * Math.cos(s * 6.2832 * 6.5);
    blend(pleats * 0.5 * groove ** 3, 0.5, 0.26, 0.4);
    // jaw line and eye
    const jaw = 0.1 + 0.9 * Math.pow(clamp01((0.99 - t) / 0.2), 1.6) * 0.38;
    const jawLine = sstep(0.022, 0.006, Math.abs(s - jaw)) * sstep(0.79, 0.83, t) * sstep(1.0, 0.97, t);
    blend(jawLine * 0.75, 1.0, 0.62, 0.3);
    const eye = spineAt(0.815), eyeR = girth(0.815, 1) * 0.6;
    const ed = Math.hypot(x - (eye.x - eye.ty * eyeR), y - (eye.y + eye.tx * eyeR));
    blend(sstep(0.0085, 0.0065, ed), 1.0, 0.86, 0.55);
    blend(sstep(0.005, 0.0038, ed), 0.03, 0.02, 0.08);
  }
  const warm = Math.pow(clamp01(facing * 0.85 + 0.15), 1.3);
  add(warm * Math.exp(d / 0.03) * 1.25, 1.0, 0.5, 0.13);
  add(warm * Math.exp(d / 0.0055) * 0.9, 1.0, 0.86, 0.5);
  // a thin cold rim on the side turned to the sky
  add(Math.pow(clamp01(-facing), 1.5) * Math.exp(d / 0.006) * 0.75, 0.35, 0.75, 1.0);
}

const img = new Float32Array(SIZE * SIZE * 3);
for (let j = 0; j < RW; j++) {
  const y = (j + 0.5) * PX;
  for (let i = 0; i < RW; i++) {
    const x = (i + 0.5) * PX, idx = j * RW + i;
    if (y < HORIZON) shadeSky(x, y); else shadeSea(x, y);
    const b = boat(x, y);
    if (b < 0) blend(1, 0.05, 0.02, 0.09);
    const d = field[idx];
    if (d < 0.03) {
      // soft shadow glow just outside the silhouette keeps the edge crisp against the bright sky
      if (d >= 0) { const sh = 1 - 0.12 * Math.exp(-d / 0.008); col[0] *= sh; col[1] *= sh; col[2] *= sh; }
      else {
        const il = Math.max(1, i - 2), ir = Math.min(RW - 2, i + 2), ju = Math.max(1, j - 2), jd = Math.min(RW - 2, j + 2);
        let nx = field[j * RW + ir] - field[j * RW + il], ny = field[jd * RW + i] - field[ju * RW + i];
        const nl = Math.hypot(nx, ny) || 1;
        shadeWhale(x, y, idx, d, nx / nl, ny / nl);
      }
    }
    // spray is light: screen it over everything
    const o = idx * 3, p = ((j / SS | 0) * SIZE + (i / SS | 0)) * 3;
    for (let c = 0; c < 3; c++) {
      let v = col[c];
      v = v > 0.82 ? 0.82 + 0.18 * Math.tanh((v - 0.82) / 0.18) : v < 0 ? 0 : v;
      img[p + c] += 1 - (1 - v) * Math.exp(-light[o + c] * 1.6);
    }
  }
}

// ---------------------------------------------------------------- PNG
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const buf = Buffer.alloc(12 + data.length);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4, 'latin1');
  data.copy(buf, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  buf.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return buf;
}
const stride = SIZE * 3, toByte = 255 / (SS * SS); // each output pixel is the mean of its SS*SS samples
const rows = Buffer.alloc(SIZE * stride);
for (let i = 0; i < rows.length; i++) rows[i] = Math.round(Math.min(255, Math.max(0, img[i] * toByte)));
const raw = Buffer.alloc(SIZE * (stride + 1));
const trial = Buffer.alloc(stride);
for (let y = 0; y < SIZE; y++) {
  let bestCost = Infinity, bestType = 0;
  for (let type = 0; type < 5; type++) {
    let cost = 0;
    for (let i = 0; i < stride; i++) {
      const a = i >= 3 ? rows[y * stride + i - 3] : 0, b = y ? rows[(y - 1) * stride + i] : 0, c = i >= 3 && y ? rows[(y - 1) * stride + i - 3] : 0;
      let pred = 0;
      if (type === 1) pred = a;
      else if (type === 2) pred = b;
      else if (type === 3) pred = (a + b) >> 1;
      else if (type === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      const v = (rows[y * stride + i] - pred) & 255;
      trial[i] = v;
      cost += v < 128 ? v : 256 - v;
    }
    if (cost < bestCost) { bestCost = cost; bestType = type; raw[y * (stride + 1)] = type; trial.copy(raw, y * (stride + 1) + 1); }
  }
}
const head = Buffer.alloc(13);
head.writeUInt32BE(SIZE, 0); head.writeUInt32BE(SIZE, 4);
head[8] = 8; head[9] = 2;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', head),
  chunk('IDAT', deflateSync(raw, { level: 9, memLevel: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(OUT, png);
console.log(`${OUT}: ${png.length} bytes, ${SIZE}x${SIZE}, ss=${SS}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);

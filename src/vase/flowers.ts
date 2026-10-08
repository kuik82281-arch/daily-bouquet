import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FlowerColor, FlowerKind, StemShape } from './flowerCatalog';

// The modelled flowers for the vase. Everything is built from code: petals are small bent and cupped sheets, set round
// a centre in rings (a rose spirals by the golden angle, a lily curls its six points back, a calla is one rolled
// sheet), and the colour is painted into the vertices, deeper at the base and paler at the tip. Each stem (its stem,
// leaves and head, or a whole branch of blossom) is merged into one geometry, so a bouquet is one draw call a stem,
// all with one material (vertexColors). Coordinates: a head opens towards +Y; a stem is built relative to its base.

export const PALETTE: Record<FlowerColor, string> = {
  red: '#b0122d', pink: '#f2a4b8', white: '#f6f2ea', champagne: '#efd2b0', burgundy: '#64101f',
  coral: '#f2876f', yellow: '#f3c94e', purple: '#7d55a6', blue: '#86a6dd', green: '#8ea69a', brown: '#7a5536',
};
const GREEN = new THREE.Color('#58763d');
const GREEN_DARK = new THREE.Color('#344b25');
const WHITE = new THREE.Color('#ffffff');
const UP = new THREE.Vector3(0, 1, 0);

export type Rand = () => number;
/** A small repeatable random stream, so the same bouquet is always arranged the same way. */
export function seeded(seed: string): Rand {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let s = h >>> 0 || 1;
  return () => {
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    return s / 4294967296;
  };
}

const col = (c: THREE.ColorRepresentation) => new THREE.Color(c);

/** Keep only position / normal / colour, so every part of a stem can be merged into one mesh. */
function paint(geo: THREE.BufferGeometry, color: THREE.Color | ((p: THREE.Vector3) => THREE.Color)): THREE.BufferGeometry {
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const out = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const c = typeof color === 'function' ? color(v.fromBufferAttribute(pos, i)) : color;
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

type Shape = (t: number) => number;
const ROUND: Shape = (t) => Math.max(0.05, Math.sin(Math.PI * t ** 1.35) ** 0.55);
const POINTED: Shape = (t) => Math.max(0.04, Math.sin(Math.PI * t ** 0.7));
const FULL: Shape = (t) => Math.max(0.04, Math.sin(Math.PI * t ** 0.75) ** 0.8);
const STRAP: Shape = (t) => Math.max(0.05, Math.min(1, t * 5) * (t < 0.8 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2))));

type PetalOpts = {
  /** half-width and length */ w: number; l: number;
  /** edges lift towards the inside (+Z) */ cup?: number;
  /** the whole petal leans in (+) or out (-) along its length */ bend?: number;
  /** only the tip curls (lilies roll theirs back) */ curl?: number;
  ruffle?: number; shape?: Shape; seg?: [number, number];
  base: THREE.Color; tip: THREE.Color; edge?: number;
};

/** One petal: a sheet growing up +Y, its inner face towards +Z. */
function petal(o: PetalOpts): THREE.BufferGeometry {
  const [sw, sl] = o.seg ?? [6, 8];
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  const shape = o.shape ?? ROUND;
  for (let j = 0; j <= sl; j++) {
    const t = j / sl;
    const half = o.w * PW * shape(t);
    for (let i = 0; i <= sw; i++) {
      const s = (i / sw) * 2 - 1;
      const z = (o.cup ?? 0) * s * s * half + (o.bend ?? 0) * t * t * o.l + (o.curl ?? 0) * t ** 4 * o.l
        + (o.ruffle ?? 0) * Math.sin(s * 6 + t * 9) * t * o.w * 0.4;
      pos.push(s * half, t * o.l, z);
      c.copy(o.base).lerp(o.tip, t ** 0.7);
      if (o.edge) c.lerp(WHITE, o.edge * Math.abs(s) * t);
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < sl; j++) for (let i = 0; i < sw; i++) {
    const a = j * (sw + 1) + i, b = a + 1, d = a + sw + 2, e = a + sw + 1;
    idx.push(a, b, d, a, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return geo;
}

const M1 = new THREE.Matrix4(), M2 = new THREE.Matrix4(), M3 = new THREE.Matrix4();
/** A part set round the centre: turned to azimuth `az`, leaning out by `tilt`, its foot `r0` from the middle. */
function place(geo: THREE.BufferGeometry, az: number, tilt: number, r0 = 0, y0 = 0, scale = 1) {
  const m = new THREE.Matrix4().makeRotationY(az)
    .multiply(M1.makeTranslation(0, y0, -r0))
    .multiply(M2.makeRotationX(-tilt))
    .multiply(M3.makeScale(scale, scale, scale));
  const out = geo.clone().applyMatrix4(m);
  return out;
}

/** A part pointed along `dir` with its foot at `at` (leaves, florets); its inner face turns upward. */
function aim(geo: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3, scale = 1, twist = 0) {
  const y = dir.clone().normalize();
  let x = new THREE.Vector3().crossVectors(y, UP);
  if (x.lengthSq() < 1e-6) x = new THREE.Vector3(1, 0, 0);
  x.normalize().applyAxisAngle(y, twist);
  const z = new THREE.Vector3().crossVectors(x, y);
  const m = new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(scale, scale, scale)).setPosition(at);
  return geo.clone().applyMatrix4(m);
}

const sphere = (r: number, color: THREE.Color, w = 8, h = 6) => paint(new THREE.SphereGeometry(r, w, h), color);
const rod = (r: number, l: number, color: THREE.Color, seg = 5) => paint(new THREE.CylinderGeometry(r, r, l, seg, 1).translate(0, l / 2, 0), color);
const tube = (curve: THREE.Curve<THREE.Vector3>, r: number, color: THREE.Color, seg = 22) => paint(new THREE.TubeGeometry(curve, seg, r, 5, false), color);

function sepals(n: number, tilt: number, size = 1) {
  const s = petal({ w: 0.024 * size, l: 0.1 * size, shape: POINTED, cup: 0.2, bend: -0.1, base: GREEN_DARK, tip: GREEN, seg: [3, 4] });
  return Array.from({ length: n }, (_, k) => place(s, (k / n) * Math.PI * 2 + 0.3, tilt, 0.03 * size, -0.025));
}

// ---- heads ----------------------------------------------------------------------------------------------------

/** How open she wants the head (圆 < 1 < 扁): petals lean out by this much more, and cup by this much less. */
let OPEN = 1;
/** How plump she wants the petals (胖 > 1 > 瘦): every petal of a head is built this much broader. */
let PW = 1;
const T = (tilt: number) => Math.min(1.75, tilt * OPEN);
const C = (cup: number) => cup / OPEN;

function rose(color: FlowerColor, rand: Rand) {
  const base = col(PALETTE[color]);
  const deep = base.clone().multiplyScalar(color === 'white' || color === 'champagne' ? 0.82 : 0.6);
  const parts: THREE.BufferGeometry[] = [];
  const n = 20;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    // a tight spiral bud in the middle, cupped petals round it, only the last few turning their edges back
    parts.push(place(petal({
      w: 0.07 + 0.09 * f, l: 0.1 + 0.13 * f, cup: C(1.15 - 0.45 * f), bend: 0.32 - 0.42 * f, curl: f > 0.75 ? -0.25 : 0, seg: [7, 8],
      base: deep, tip: f < 0.3 ? base.clone().multiplyScalar(0.86) : base, edge: 0.14,
    }), k * 2.39996 + rand() * 0.3, T(0.04 + 0.78 * f ** 2), 0.008 + 0.055 * f, -0.03 * f));
  }
  parts.push(...sepals(5, 1.95), sphere(0.045, GREEN, 8, 6).scale(1, 1.2, 1).translate(0, -0.05, 0));
  return parts;
}

function peony(color: FlowerColor, rand: Rand) {
  const base = col(PALETTE[color]);
  const deep = base.clone().lerp(col('#c2546e'), color === 'white' ? 0.12 : 0.3);
  const parts: THREE.BufferGeometry[] = [];
  const n = 34;
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1);
    parts.push(place(petal({
      w: 0.1 + 0.1 * f, l: 0.11 + 0.15 * f, cup: C(0.8 - 0.3 * f), bend: 0.3 - 0.4 * f, ruffle: 0.22, seg: [8, 8],
      base: deep, tip: base.clone().lerp(WHITE, 0.12 * f), edge: 0.12,
    }), k * 2.39996 + rand() * 0.4, T(0.15 + 1.0 * f ** 1.4), 0.015 + 0.07 * f, -0.03 * f));
  }
  for (let k = 0; k < 9; k++) parts.push(sphere(0.012, col('#f0c240'), 5, 4).translate(Math.cos(k * 2.4) * 0.03, 0.04, Math.sin(k * 2.4) * 0.03));
  parts.push(...sepals(5, 2.1, 1.2));
  return parts;
}

function tulip(color: FlowerColor) {
  const base = col(PALETTE[color]);
  const foot = base.clone().lerp(col('#6f8a3c'), 0.35);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 6; k++) {
    const outer = k % 2 === 1;
    parts.push(place(petal({ w: 0.11, l: 0.3, cup: C(1.05), bend: 0.14, base: foot, tip: base.clone().lerp(WHITE, 0.08), seg: [6, 9] }),
      (k * Math.PI) / 3, T(outer ? 0.27 : 0.2), outer ? 0.032 : 0.014));
  }
  parts.push(sphere(0.04, GREEN, 8, 6).translate(0, -0.01, 0));
  return parts;
}

/**
 * One lily petal, as in her photo: broad in the middle and narrowing to a soft point, a valley down the midrib with
 * the two halves lifting from it, arcing outward and the tip rolling a little back, the edge faintly wavy; pale
 * green-gold at the throat and along the midrib, white beyond, and small raised spots over the lower half.
 */
function lilyPetal(w: number, l: number, colors: { throat: THREE.Color; body: THREE.Color; spot: THREE.Color }, rand: Rand) {
  const sw = 10, sl = 14;
  const width = (t: number) => w * PW * Math.max(0.05, Math.sin(Math.PI * t ** 0.8) ** 0.5);
  const at = (s: number, t: number) => {
    const half = width(t);
    return new THREE.Vector3(
      s * half,
      t * l,
      C(0.5) * Math.abs(s) ** 1.4 * half - 0.3 * t * t * l - 0.28 * t ** 4 * l + 0.035 * w * Math.sin(s * 5 + t * 7) * t,
    );
  };
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= sl; j++) {
    const t = j / sl;
    for (let i = 0; i <= sw; i++) {
      const s = (i / sw) * 2 - 1, p = at(s, t);
      pos.push(p.x, p.y, p.z);
      c.copy(colors.throat).lerp(colors.body, Math.min(1, t * 3.2)).lerp(colors.throat, 0.45 * (1 - Math.abs(s)) ** 5 * (1 - t));
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < sl; j++) for (let i = 0; i < sw; i++) {
    const a = j * (sw + 1) + i;
    idx.push(a, a + 1, a + sw + 2, a, a + sw + 2, a + sw + 1);
  }
  const sheet = new THREE.BufferGeometry();
  sheet.setIndex(idx);
  sheet.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sheet.computeVertexNormals();
  sheet.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const parts = [sheet];
  const dot = sphere(0.004, colors.spot, 4, 3).scale(1, 1, 0.45);
  for (let k = 0; k < 18; k++) {
    const t = 0.1 + rand() * 0.38, s = (rand() * 2 - 1) * 0.75 * (rand() < 0.5 ? 1 : 0.6);
    const p = at(s, t);
    parts.push(dot.clone().translate(p.x, p.y, p.z + 0.003));
  }
  dot.dispose();
  return mergeGeometries(parts)!;
}

function lily(color: FlowerColor) {
  const rand = seeded(`lily:${color}`);
  const base = col(PALETTE[color]);
  const colors = color === 'white'
    ? { throat: col('#d9e2a8'), body: base, spot: col('#e6dcc0') }
    : { throat: base.clone().lerp(col('#f3e4a0'), 0.4), body: base.clone().lerp(WHITE, 0.15), spot: base.clone().multiplyScalar(0.62) };
  const parts: THREE.BufferGeometry[] = [];
  // six petals in two whorls: the inner three broader and a little more upright, the outer three narrower and lower
  for (let k = 0; k < 6; k++) {
    const outer = k % 2 === 1;
    parts.push(place(lilyPetal(outer ? 0.155 : 0.175, 0.44, colors, rand), (k * Math.PI) / 3 + (rand() - 0.5) * 0.12, T(outer ? 0.7 : 0.6) + (rand() - 0.5) * 0.08, outer ? 0.028 : 0.016, outer ? -0.012 : 0));
  }
  // six long pale filaments bowing outward, each holding a long golden anther across its tip, and the pistil
  const filament = col('#e8ecd2'), anther = col('#b4832a');
  const antherG = sphere(0.011, anther, 8, 5).scale(1, 4, 0.8);
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6 + (rand() - 0.5) * 0.2, lean = 0.32 + rand() * 0.1, len = 0.27 + rand() * 0.05;
    const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
    const end = dir.clone().multiplyScalar(len);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, 0), dir.clone().multiplyScalar(len * 0.55).add(new THREE.Vector3(0, 0.03, 0)), end);
    parts.push(paint(new THREE.TubeGeometry(curve, 8, 0.0032, 4, false), filament));
    const across = new THREE.Vector3().crossVectors(dir, UP).normalize();
    parts.push(aim(antherG, end, across.applyAxisAngle(dir, (rand() - 0.5) * 0.6)));
  }
  antherG.dispose();
  const pistil = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0.01, 0.2, 0.005), new THREE.Vector3(0.02, 0.36, 0.01));
  parts.push(paint(new THREE.TubeGeometry(pistil, 10, 0.005, 5, false), col('#dfe6c0')));
  for (let k = 0; k < 3; k++) parts.push(sphere(0.011, col('#cfd9a6'), 6, 4).translate(0.02 + Math.cos(k * 2.09) * 0.009, 0.365, 0.01 + Math.sin(k * 2.09) * 0.009));
  return parts;
}

function calla(color: FlowerColor) {
  const base = col(PALETTE[color]);
  const throat = col('#86a456');
  const sl = 12, sw = 14;
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j <= sl; j++) {
    const t = j / sl;
    const wrap = Math.PI * (0.97 - 0.5 * t ** 1.3);
    for (let i = 0; i <= sw; i++) {
      const s = (i / sw) * 2 - 1, a = 1 - Math.abs(s);
      const phi = s * wrap;
      const r = 0.025 + 0.085 * t ** 1.4 + 0.025 * t ** 4 * Math.abs(s);
      pos.push(r * Math.sin(phi), t * 0.32 + 0.1 * a * a * t ** 3, -r * Math.cos(phi) + 0.07 * t ** 4 * a);
      c.copy(throat).lerp(base, Math.min(1, t * 2.2));
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < sl; j++) for (let i = 0; i < sw; i++) {
    const a = j * (sw + 1) + i;
    idx.push(a, a + 1, a + sw + 2, a, a + sw + 2, a + sw + 1);
  }
  const spathe = new THREE.BufferGeometry();
  spathe.setIndex(idx);
  spathe.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  spathe.computeVertexNormals();
  spathe.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return [spathe, paint(new THREE.CylinderGeometry(0.011, 0.014, 0.17, 6, 1).translate(0, 0.1, -0.01), col('#efbf30'))];
}

function daisy(rand: Rand) {
  const parts: THREE.BufferGeometry[] = [];
  const p = petal({ w: 0.022, l: 0.14, shape: STRAP, cup: 0.15, bend: -0.04, base: col('#e6e2cf'), tip: WHITE, seg: [3, 6] });
  for (let k = 0; k < 16; k++) parts.push(place(p, (k / 16) * Math.PI * 2 + rand() * 0.06, T(1.42 + rand() * 0.1), 0.035));
  for (let k = 0; k < 12; k++) parts.push(place(p, (k / 12) * Math.PI * 2 + 0.2, T(1.28), 0.03, 0.004, 0.85));
  const eye = col('#e2ae1c'), rim = col('#b57d12');
  parts.push(paint(new THREE.SphereGeometry(0.045, 12, 6).scale(1, 0.5, 1).translate(0, 0.006, 0), (v) => eye.clone().lerp(rim, Math.min(1, Math.hypot(v.x, v.z) / 0.045) ** 3)));
  parts.push(...sepals(8, 1.7, 0.7));
  return parts;
}

function hydrangea(color: FlowerColor, rand: Rand) {
  const base = col(PALETTE[color]);
  const lean = color === 'blue' ? col('#a596d8') : color === 'pink' ? col('#e48fb4') : col('#dfe8cf');
  const parts: THREE.BufferGeometry[] = [];
  const N = 44, R = 0.2;
  for (let i = 0; i < N; i++) {
    const yy = 1 - (i / (N - 1)) * 1.3;
    const rad = Math.sqrt(Math.max(0, 1 - yy * yy));
    const n = new THREE.Vector3(Math.cos(i * 2.39996) * rad, yy, Math.sin(i * 2.39996) * rad).normalize();
    const c = base.clone().lerp(lean, rand() * 0.6).lerp(WHITE, rand() * 0.25).lerp(col('#a9bf92'), rand() < 0.15 ? 0.35 : 0);
    const fp = petal({ w: 0.04, l: 0.06, cup: 0.25, base: c.clone().multiplyScalar(0.85), tip: c, seg: [4, 4] });
    const floret = mergeGeometries([0, 1, 2, 3].map((k) => place(fp, (k * Math.PI) / 2 + 0.4, 1.35, 0.005)).concat(sphere(0.008, col('#f4f0e2'), 5, 4)));
    parts.push(aim(floret, n.clone().multiplyScalar(R).add(new THREE.Vector3(0, R * 0.75, 0)), n, 0.9 + rand() * 0.25, rand() * 6));
  }
  return parts;
}

function fiveFlower(color: FlowerColor) {
  const base = col(PALETTE[color]);
  const heart = col(color === 'white' ? '#e9a7b8' : '#d76c8a');
  const p = petal({ w: 0.03, l: 0.05, cup: 0.35, base: heart.clone().lerp(base, 0.5), tip: base, seg: [4, 4] });
  const parts = [0, 1, 2, 3, 4].map((k) => place(p, (k / 5) * Math.PI * 2, 1.1, 0.004));
  for (let k = 0; k < 6; k++) parts.push(sphere(0.004, col('#f3d36a'), 4, 3).translate(Math.cos(k) * 0.012, 0.018, Math.sin(k) * 0.012));
  parts.push(sphere(0.007, heart, 5, 4));
  return mergeGeometries(parts);
}

function lotus(color: FlowerColor) {
  const foot = col('#f8f1e6');
  const tip = color === 'pink' ? col('#e0718f') : col('#f6f4e8');
  const parts: THREE.BufferGeometry[] = [];
  // three rings of broad pointed petals, the inner ones nearly closed round the pod
  const rings = [
    { n: 5, tilt: 0.24, l: 0.25, w: 0.095, r0: 0.03, cup: 0.85, bend: 0.12 },
    { n: 7, tilt: 0.55, l: 0.29, w: 0.115, r0: 0.045, cup: 0.7, bend: 0.06 },
    { n: 8, tilt: 0.9, l: 0.3, w: 0.125, r0: 0.06, cup: 0.55, bend: -0.02 },
  ];
  rings.forEach((r, ri) => {
    const g = petal({ w: r.w, l: r.l, shape: FULL, cup: C(r.cup), bend: r.bend, base: foot, tip, edge: 0.08, seg: [7, 9] });
    for (let k = 0; k < r.n; k++) parts.push(place(g, (k / r.n) * Math.PI * 2 + ri * 0.4, T(r.tilt), r.r0, -0.01 * ri));
  });
  // the young seed pod, and its ring of stamens
  const pod = col('#d9d26e');
  parts.push(paint(new THREE.CylinderGeometry(0.06, 0.035, 0.07, 14, 1).translate(0, 0.05, 0), pod));
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI * 2, r = k === 6 ? 0 : 0.034;
    parts.push(sphere(0.009, col('#a3ab4c'), 5, 4).translate(Math.cos(a) * r, 0.085, Math.sin(a) * r));
  }
  const stamen = rod(0.0025, 0.06, col('#f2d061'), 3);
  for (let k = 0; k < 22; k++) parts.push(place(stamen, (k / 22) * Math.PI * 2, 0.7, 0.045, 0.02));
  return parts;
}

/** A round lotus leaf, faintly cupped, its edge rising and falling, veins running out from the middle. */
function lotusLeaf(R: number, wave: number, cupK: number, colors: { mid: THREE.Color; edge: THREE.Color; vein: THREE.Color }) {
  const segR = 9, segA = 32;
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= segR; i++) {
    const f = i / segR, r = R * f;
    for (let j = 0; j <= segA; j++) {
      const a = (j / segA) * Math.PI * 2;
      const y = cupK * R * f ** 1.6 + wave * R * Math.sin(5 * a + 1) * f ** 2 + wave * 0.5 * R * Math.sin(11 * a) * f ** 3;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      c.copy(colors.mid).lerp(colors.edge, f ** 1.5).lerp(colors.vein, 0.55 * Math.abs(Math.cos(a * 9)) ** 30 * Math.min(1, f * 3));
      cols.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segR; i++) for (let j = 0; j < segA; j++) {
    const a = i * (segA + 1) + j, b = a + segA + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return geo;
}

function lotusLeafHead() {
  return [lotusLeaf(0.42, 0.06, 0.32, { mid: col('#8fae62'), edge: col('#3f6e33'), vein: col('#9cc072') })];
}

/** 残荷: a dry seed pod gone brown, with two shrivelled petals still hanging on. */
function witheredPod() {
  const parts: THREE.BufferGeometry[] = [];
  const brown = col('#6e4b2e'), dark = col('#33251a');
  parts.push(paint(new THREE.CylinderGeometry(0.075, 0.032, 0.095, 14, 1).translate(0, 0.048, 0), (v) => brown.clone().lerp(col('#a07a50'), Math.max(0, v.y / 0.095) * 0.5)));
  for (let k = 0; k < 9; k++) {
    const a = (k / 8) * Math.PI * 2, r = k === 8 ? 0 : 0.045;
    parts.push(sphere(0.013, dark, 5, 4).scale(1, 0.5, 1).translate(Math.cos(a) * r, 0.095, Math.sin(a) * r));
  }
  const dry = petal({ w: 0.05, l: 0.13, cup: 0.9, curl: -0.6, ruffle: 0.7, base: col('#7d5a3a'), tip: col('#b0916a'), seg: [5, 7] });
  parts.push(place(dry, 0.4, 1.9, 0.05), place(dry, 2.6, 2.2, 0.05, 0, 0.8));
  return parts;
}

const headCache = new Map<string, THREE.BufferGeometry>();
function head(kind: FlowerKind, color: FlowerColor, variant: number, open = 1, plump = 1) {
  const o = Math.round(open * 20) / 20, pw = Math.round(plump * 20) / 20;
  const key = `${kind}:${color}:${variant}:${o}:${pw}`;
  let g = headCache.get(key);
  if (!g) {
    const rand = seeded(`${kind}:${color}:${variant}`);
    OPEN = o; PW = pw;
    const parts = kind === 'rose' ? rose(color, rand) : kind === 'peony' ? peony(color, rand) : kind === 'tulip' ? tulip(color)
      : kind === 'lily' ? lily(color) : kind === 'calla' ? calla(color) : kind === 'daisy' ? daisy(rand)
      : kind === 'lotus' ? lotus(color) : kind === 'lotus-leaf' ? lotusLeafHead() : kind === 'withered-lotus' ? witheredPod() : hydrangea(color, rand);
    OPEN = 1; PW = 1;
    g = mergeGeometries(parts)!;
    headCache.set(key, g);
    if (headCache.size > 160) { const first = headCache.keys().next().value!; headCache.get(first)!.dispose(); headCache.delete(first); }
  }
  return g;
}
const blossomCache = new Map<string, THREE.BufferGeometry>();
const blossomHead = (color: FlowerColor) => {
  let g = blossomCache.get(color);
  if (!g) { g = fiveFlower(color)!; blossomCache.set(color, g); }
  return g;
};

/** How far a head reaches out from its stem, for spacing them in the vase. */
export const HEAD_RADIUS: Record<FlowerKind, number> = {
  rose: 0.24, peony: 0.32, tulip: 0.15, lily: 0.36, calla: 0.13, daisy: 0.17, hydrangea: 0.27,
  blossom: 0.1, 'babys-breath': 0.2, lavender: 0.05, eucalyptus: 0.12, lotus: 0.32, 'lotus-leaf': 0.42, 'withered-lotus': 0.14,
  'pear-blossom': 0.22,
};

// ---- stems ----------------------------------------------------------------------------------------------------

/** A sideways direction at a point of the curve, turned by `a` round it. */
function around(tan: THREE.Vector3, a: number) {
  const n1 = new THREE.Vector3().crossVectors(tan, Math.abs(tan.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
  const n2 = new THREE.Vector3().crossVectors(tan, n1).normalize();
  return n1.multiplyScalar(Math.cos(a)).add(n2.multiplyScalar(Math.sin(a)));
}

/** Leaves on a stem: where along it (leafPos), how big (leafSize) and how broad (leafWidth), as she shaped them. */
function leaves(curve: THREE.Curve<THREE.Vector3>, rand: Rand, n: number, shape: StemShape = {}) {
  const leaf = petal({ w: 0.05 * (shape.leafWidth ?? 1), l: 0.24, shape: POINTED, cup: 0.18, bend: -0.12, base: GREEN_DARK, tip: col('#6f8f4a'), seg: [4, 7] });
  const out: THREE.BufferGeometry[] = [];
  const at = shape.leafPos ?? 0.48;
  for (let i = 0; i < n; i++) {
    const t = Math.min(0.95, Math.max(0.08, at + (rand() - 0.5) * 0.25));
    const p = curve.getPoint(t), tan = curve.getTangent(t);
    const side = around(tan, rand() * Math.PI * 2);
    out.push(aim(leaf, p, side.multiplyScalar(0.85).add(tan.clone().multiplyScalar(0.7)), (0.8 + rand() * 0.4) * (shape.leafSize ?? 1), (rand() - 0.5) * 0.6));
  }
  leaf.dispose();
  return out;
}

function blossomBranch(curve: THREE.Curve<THREE.Vector3>, color: FlowerColor, rand: Rand, size = 1) {
  const bark = col('#4a372e');
  const parts = [tube(curve, 0.016 * size, bark, 28)];
  const flower = blossomHead(color);
  const bud = sphere(0.016 * size, col(PALETTE[color]).lerp(col('#c84f72'), 0.45), 6, 5).scale(1, 1.3, 1);
  const bloomAt = (p: THREE.Vector3, dir: THREE.Vector3) => {
    if (rand() < 0.28) parts.push(aim(bud, p, dir));
    else parts.push(aim(flower, p, dir, (0.9 + rand() * 0.4) * size, rand() * 6));
  };
  for (let k = 0; k < 3; k++) {
    const t = 0.4 + k * 0.2 + rand() * 0.08;
    const p = curve.getPoint(t), tan = curve.getTangent(t);
    const side = around(tan, rand() * Math.PI * 2);
    const len = 0.22 + rand() * 0.2;
    const end = p.clone().add(side.clone().multiplyScalar(len * 0.9)).add(tan.clone().multiplyScalar(len * 0.5));
    const twig = new THREE.QuadraticBezierCurve3(p, p.clone().add(side.clone().multiplyScalar(len * 0.5)), end);
    parts.push(tube(twig, 0.007 * size, bark, 8));
    for (let j = 0; j < 3; j++) {
      const q = twig.getPoint(0.45 + j * 0.27);
      bloomAt(q, around(twig.getTangent(0.5), rand() * 6.28).add(UP.clone().multiplyScalar(0.4)));
    }
  }
  for (let t = 0.32; t <= 1.001; t += 0.085) {
    const p = curve.getPoint(Math.min(1, t)), tan = curve.getTangent(Math.min(1, t));
    const side = around(tan, rand() * Math.PI * 2);
    bloomAt(p.clone().add(side.clone().multiplyScalar(0.018)), side.add(tan.clone().multiplyScalar(0.3)));
  }
  return parts;
}

function babysBreath(curve: THREE.Curve<THREE.Vector3>, color: FlowerColor, rand: Rand) {
  const stem = col('#7c9767');
  const parts = [tube(curve, 0.005, stem, 18)];
  const dotColor = col(PALETTE[color]);
  const dot = sphere(0.013, dotColor, 5, 4);
  for (let k = 0; k < 8; k++) {
    const t = 0.8 + rand() * 0.2;
    const p = curve.getPoint(t), tan = curve.getTangent(t);
    const dir = around(tan, (k / 8) * Math.PI * 2 + rand()).multiplyScalar(0.8).add(tan.clone().multiplyScalar(0.7)).normalize();
    const len = 0.12 + rand() * 0.15;
    const end = p.clone().add(dir.clone().multiplyScalar(len));
    const twig = new THREE.QuadraticBezierCurve3(p, p.clone().add(dir.clone().multiplyScalar(len * 0.5)).add(new THREE.Vector3(0, 0.03, 0)), end);
    parts.push(tube(twig, 0.0028, stem, 6));
    for (let j = 0; j < 7; j++) {
      const off = new THREE.Vector3(rand() - 0.5, rand() - 0.3, rand() - 0.5).multiplyScalar(0.075);
      parts.push(dot.clone().translate(end.x + off.x, end.y + off.y, end.z + off.z));
    }
  }
  return parts;
}

function lavender(curve: THREE.Curve<THREE.Vector3>, rand: Rand) {
  const parts = [tube(curve, 0.006, col('#6f8a62'), 20)];
  const base = col(PALETTE.purple).lerp(col('#8a6fc8'), 0.4);
  const bud = (c: THREE.Color) => sphere(0.024, c, 6, 4).scale(0.8, 1.3, 0.8);
  for (let t = 0.64; t <= 1.001; t += 0.02) {
    const p = curve.getPoint(Math.min(1, t)), tan = curve.getTangent(Math.min(1, t));
    const k = 1 - ((t - 0.64) / 0.36) * 0.5;
    for (let a = 0; a < 6; a++) {
      const side = around(tan, (a / 6) * Math.PI * 2 + t * 20);
      const c = base.clone().lerp(rand() < 0.5 ? col('#4f347e') : col('#b9a6e0'), rand() * 0.5);
      parts.push(aim(bud(c), p.clone().add(side.clone().multiplyScalar(0.018 * k)), side.multiplyScalar(0.6).add(tan), k));
    }
  }
  return parts;
}

function eucalyptus(curve: THREE.Curve<THREE.Vector3>, rand: Rand, shape: StemShape = {}) {
  const parts = [tube(curve, 0.006, col('#7d9488'), 20)];
  const leaf = petal({ w: 0.07 * (shape.leafWidth ?? 1), l: 0.115, cup: 0.12, base: col('#6c8578'), tip: col('#a9bdb3'), seg: [5, 5] });
  let pair = 0;
  for (let t = 0.24; t <= 1.001; t += 0.07, pair++) {
    const p = curve.getPoint(Math.min(1, t)), tan = curve.getTangent(Math.min(1, t));
    const k = 1 - ((t - 0.24) / 0.76) * 0.45;
    for (const side of [0, Math.PI]) {
      const out = around(tan, side + (pair % 2) * (Math.PI / 2) + rand() * 0.3);
      parts.push(aim(leaf, p, out.multiplyScalar(0.85).add(tan.clone().multiplyScalar(0.45)), k * (shape.leafSize ?? 1), (rand() - 0.5) * 0.5));
    }
  }
  return parts;
}

/** A tube that thins from r0 to r1 along its curve (a branch, a twig), with a round cap where it ends. */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, color: THREE.Color, seg = 24, radial = 7) {
  const frames = curve.computeFrenetFrames(seg, false);
  const pos: number[] = [], idx: number[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, p);
    const r = r0 + (r1 - r0) * t ** 0.8;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
    }
  }
  for (let i = 0; i < seg; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return mergeGeometries([paint(geo, color), sphere(r1 * 1.05, color, 6, 4).translate(p.x, p.y, p.z)])!;
}

/**
 * The carved spray on the vase itself (not one of his flowers): a crooked porcelain branch that comes out of the
 * window towards whoever looks, forking into curling twigs with cream blossoms, open and in bud, the way the
 * porcelain sprays in her pictures reach out. `at` is the window's middle, `out` its outward direction.
 */
export function carvedSpray(at: THREE.Vector3, out: THREE.Vector3, branchColor: string, flowerColor: string, inset: (up: number) => number): THREE.BufferGeometry {
  const rand = seeded('carved-spray');
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(up, out).normalize();
  const bark = col(branchColor).multiplyScalar(0.92);
  const cream = col(flowerColor), heart = cream.clone().lerp(col('#e2b9b0'), 0.55), anther = cream.clone().lerp(col('#e8cf9c'), 0.6);
  const P = (o: number, u: number, s: number) => at.clone().addScaledVector(out, o).addScaledVector(up, u).addScaledVector(side, s);
  const parts: THREE.BufferGeometry[] = [];

  const petalG = petal({ w: 0.036, l: 0.062, cup: 0.5, bend: -0.06, curl: -0.08, base: heart, tip: cream, seg: [5, 5] });
  const bloom = () => {
    const ps = [0, 1, 2, 3, 4].map((k) => place(petalG, (k / 5) * Math.PI * 2 + rand() * 0.2, 1.05 + rand() * 0.2, 0.006));
    ps.push(sphere(0.012, heart, 6, 4));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      ps.push(place(rod(0.0028, 0.03, cream, 3), a, 0.5, 0.006));
      ps.push(place(sphere(0.006, anther, 4, 3).translate(0, 0.031, 0), a, 0.5, 0.006));
    }
    return mergeGeometries(ps)!;
  };
  const blooms = [bloom(), bloom(), bloom()];
  const sepal = petal({ w: 0.014, l: 0.03, shape: POINTED, cup: 0.3, base: bark, tip: bark, seg: [3, 3] });
  const budG = mergeGeometries([sphere(0.024, cream, 8, 6).scale(1, 1.25, 1).translate(0, 0.02, 0), ...[0, 1, 2].map((k) => place(sepal, k * 2.1, 0.35, 0.012))])!;
  const flowerAt = (p: THREE.Vector3, dir: THREE.Vector3, size: number) => parts.push(aim(blooms[Math.floor(rand() * 3)], p, dir, size, rand() * 6.28));
  const budAt = (p: THREE.Vector3, dir: THREE.Vector3, size: number) => parts.push(aim(budG, p, dir, size));
  const curve = (pts: THREE.Vector3[]) => new THREE.CatmullRomCurve3(pts, false, 'centripetal');

  // the main branch: from inside the vase, out through the window, then up and back in along the vase's curve
  // (`inset` is how far the skin falls back at a height), always a hand's breadth clear of it
  const main = curve([P(-0.32, -0.12, -0.04), P(0, -0.05, 0), P(0.17, 0.04, 0.05), P(0.26 + inset(0.18), 0.18, 0.06), P(0.28 + inset(0.36), 0.36, 0.12),
    P(0.24 + inset(0.56), 0.56, 0.1), P(0.18 + inset(0.76), 0.76, 0.15)]);
  parts.push(taperTube(main, 0.034, 0.016, bark, 40, 8));
  // twigs: [where on the branch, which way (out, up, side), how long, which way it curls]
  const twigs: [number, [number, number, number], number, number][] = [
    [0.38, [0.7, -0.25, -0.65], 0.32, 1], [0.5, [0.8, 0.35, 0.55], 0.36, -1], [0.62, [0.45, 0.85, -0.3], 0.3, 1],
    [0.74, [0.9, 0.1, -0.3], 0.26, -1], [0.85, [0.3, 0.6, 0.75], 0.28, 1], [0.55, [0.55, -0.6, 0.45], 0.24, -1],
  ];
  for (const [t, [o, u, s], len, curl] of twigs) {
    const p0 = main.getPointAt(t);
    const d = new THREE.Vector3().addScaledVector(out, o).addScaledVector(up, u).addScaledVector(side, s).normalize();
    const bend = new THREE.Vector3().crossVectors(d, out).normalize().multiplyScalar(curl * len * 0.25);
    if (bend.lengthSq() < 1e-6) bend.set(0, curl * len * 0.25, 0);
    const twig = curve([
      p0, p0.clone().addScaledVector(d, len * 0.35).addScaledVector(bend, 0.4), p0.clone().addScaledVector(d, len * 0.7).addScaledVector(bend, 1),
      p0.clone().addScaledVector(d, len).addScaledVector(bend, 0.6).addScaledVector(up, 0.04),
    ]);
    parts.push(taperTube(twig, 0.016, 0.007, bark, 16, 6));
    flowerAt(twig.getPointAt(1), twig.getTangentAt(1).add(out.clone().multiplyScalar(0.7)), 1.5 + rand() * 0.5);
    // a second flower part-way along, and now and then a bud on a thin curling stalk
    flowerAt(twig.getPointAt(0.55), around(twig.getTangentAt(0.55), rand() * 6.28).add(out.clone().multiplyScalar(0.8)), 1.1 + rand() * 0.4);
    if (rand() < 0.75) {
      const sd = around(twig.getTangentAt(0.35), rand() * 6.28).add(out.clone().multiplyScalar(0.4)).add(up.clone().multiplyScalar(0.3)).normalize();
      const q0 = twig.getPointAt(0.35);
      const stalk = curve([q0, q0.clone().addScaledVector(sd, 0.07).addScaledVector(up, 0.03), q0.clone().addScaledVector(sd, 0.13).addScaledVector(bend, 0.5), q0.clone().addScaledVector(sd, 0.17).addScaledVector(up, 0.05)]);
      parts.push(taperTube(stalk, 0.006, 0.004, bark, 10, 5));
      budAt(stalk.getPointAt(1), stalk.getTangentAt(1), 1 + rand() * 0.4);
    }
  }
  flowerAt(main.getPointAt(1), main.getTangentAt(1).add(out.clone().multiplyScalar(0.5)), 2);
  // a few blossoms crowding the window's mouth
  for (const [o, u, s] of [[0.04, 0.08, -0.08], [0.02, -0.1, 0.06], [0.08, 0.02, 0.12]] as const) flowerAt(P(o, u, s), out.clone().add(new THREE.Vector3(s, u, 0)), 1.3);
  const merged = mergeGeometries(parts)!;
  [...parts, ...blooms, budG, petalG, sepal].forEach((g) => g.dispose());
  return merged;
}

/** An obovate petal: a narrow foot widening to its broadest near the tip, then a full round end. */
const OBOVATE: Shape = (t) => Math.max(0.07, Math.sin(Math.PI * Math.min(1, t ** 1.7 * 1.02)) ** 0.42);

/** A pear flower, as in her photo: five broad white petals widening to a rounded, softly wavy tip, cupped a little
 * and just overlapping, faint creamy veins at the foot, a small pale heart and short yellow stamens with amber tips. */
const pearFlowerCache = new Map<number, THREE.BufferGeometry>();
function pearFlower(plump = 1) {
  const pw = Math.round(plump * 20) / 20;
  let g = pearFlowerCache.get(pw);
  if (g) return g;
  PW = pw;
  const p = petal({ w: 0.036, l: 0.058, shape: OBOVATE, cup: 0.22, bend: -0.05, ruffle: 0.12, base: col('#f1ead2'), tip: WHITE, edge: 0.05, seg: [7, 7] });
  PW = 1;
  const parts = [0, 1, 2, 3, 4].map((k) => place(p, (k / 5) * Math.PI * 2 + (k % 2) * 0.05, 1.32 + (k % 2) * 0.06, 0.003, k * 0.0015));
  parts.push(sphere(0.007, col('#e7d79a'), 6, 4));
  const filament = rod(0.0014, 0.016, col('#f2d36a'), 3), anther = sphere(0.0038, col('#d58a2c'), 4, 3).scale(1, 0.7, 1).translate(0, 0.017, 0);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    parts.push(place(filament, a, 0.45, 0.004), place(anther, a, 0.45, 0.004));
  }
  g = mergeGeometries(parts)!;
  pearFlowerCache.set(pw, g);
  return g;
}

/**
 * 梨花枝: a long thin branch that winds as it goes (its line wanders side to side, more towards the tip), forking into
 * winding twigs, with clusters of white pear flowers and a few young leaves at the tips and along the way.
 */
function pearBranch(curve: THREE.Curve<THREE.Vector3>, rand: Rand, shape: StemShape = {}) {
  const bark = col('#4b3a30');
  const leafG = petal({ w: 0.02, l: 0.06, shape: POINTED, cup: 0.25, bend: -0.05, base: col('#7a9a45'), tip: col('#a9c46a'), seg: [3, 4] });
  const wind = (c: THREE.Curve<THREE.Vector3>, amp: number, turns: number, n: number) => {
    const ph = rand() * 6.28, ph2 = rand() * 6.28;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), p = c.getPoint(t), tan = c.getTangent(t);
      const k = amp * Math.min(1, t * 1.6);
      pts.push(p.add(around(tan, ph).multiplyScalar(Math.sin(t * Math.PI * turns + ph2) * k)).add(around(tan, ph + Math.PI / 2).multiplyScalar(Math.cos(t * Math.PI * turns * 0.7) * k * 0.5)));
    }
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  };
  const main = wind(curve, 0.12, 2.6, 13);
  const parts = [taperTube(main, 0.013, 0.005, bark, 48, 6)];
  const cluster = (at: THREE.Vector3, dir: THREE.Vector3, n: number) => {
    for (let k = 0; k < n; k++) {
      const off = around(dir, (k / n) * 6.28 + rand()).multiplyScalar(0.04 + rand() * 0.05).add(dir.clone().multiplyScalar(rand() * 0.05));
      const p = at.clone().add(off);
      parts.push(tube(new THREE.LineCurve3(at, p), 0.0015, col('#8aa05a'), 2));
      parts.push(aim(pearFlower(shape.petalWidth ?? 1), p, off.clone().normalize().add(dir).add(new THREE.Vector3(0, 0.3, 0)), (1.35 + rand() * 0.45) * (shape.headSize ?? 1), rand() * 6.28));
    }
    for (let k = 0; k < 2; k++) parts.push(aim(leafG, at, around(dir, rand() * 6.28).add(dir.clone().multiplyScalar(0.3)), 0.9 + rand() * 0.4));
  };
  for (let k = 0; k < 7; k++) {
    const t = 0.22 + k * 0.105 + rand() * 0.05;
    const p0 = main.getPointAt(t), tan = main.getTangentAt(t);
    const d = around(tan, rand() * 6.28).multiplyScalar(0.8).add(tan.clone().multiplyScalar(0.6)).add(new THREE.Vector3(0, 0.15, 0)).normalize();
    const len = 0.28 + rand() * 0.38;
    const twig = wind(new THREE.LineCurve3(p0, p0.clone().addScaledVector(d, len)), 0.045, 1.8, 7);
    parts.push(taperTube(twig, 0.006, 0.003, bark, 14, 5));
    cluster(twig.getPointAt(1), twig.getTangentAt(1), 8 + Math.floor(rand() * 5));
    if (rand() < 0.75) cluster(twig.getPointAt(0.55), around(twig.getTangentAt(0.55), rand() * 6.28), 4 + Math.floor(rand() * 3));
  }
  for (const t of [0.4, 0.58, 0.78]) cluster(main.getPointAt(t), around(main.getTangentAt(t), rand() * 6.28), 4 + Math.floor(rand() * 4));
  cluster(main.getPointAt(1), main.getTangentAt(1), 11);
  leafG.dispose();
  return parts;
}

/** One stem of `kind`, along `curve` (relative to its foot), merged into a single geometry. */
export function buildStem(kind: FlowerKind, color: FlowerColor, curve: THREE.Curve<THREE.Vector3>, rand: Rand, scale = 1, shape: StemShape = {}): THREE.BufferGeometry {
  let parts: THREE.BufferGeometry[];
  if (kind === 'blossom') parts = blossomBranch(curve, color, rand);
  else if (kind === 'pear-blossom') parts = pearBranch(curve, rand, shape);
  else if (kind === 'babys-breath') parts = babysBreath(curve, color, rand);
  else if (kind === 'lavender') parts = lavender(curve, rand);
  else if (kind === 'eucalyptus') parts = eucalyptus(curve, rand, shape);
  else {
    const lotusKind = kind === 'lotus' || kind === 'lotus-leaf' || kind === 'withered-lotus';
    parts = [tube(curve, (kind === 'calla' || lotusKind ? 0.014 : 0.011) * (shape.stemWidth ?? 1), kind === 'withered-lotus' ? col('#6d5638') : kind === 'calla' ? col('#6e9144') : lotusKind ? col('#5f7f3c') : GREEN)];
    if (!lotusKind && kind !== 'calla' && kind !== 'hydrangea') parts.push(...leaves(curve, rand, kind === 'tulip' ? 2 : 1 + Math.round(rand()), shape));
    if (kind === 'withered-lotus') {
      const t = 0.5 + rand() * 0.15, p = curve.getPoint(t), tan0 = curve.getTangent(t);
      const curled = lotusLeaf(0.2, 0.22, 0.9, { mid: col('#5e4229'), edge: col('#a48058'), vein: col('#c4a47a') });
      parts.push(aim(curled, p, around(tan0, rand() * 6.28).add(new THREE.Vector3(0, -0.3, 0)), 1, rand() * 6.28));
    }
    // heads turn outward (towards whoever looks at the vase) and lift a little, even where the stem bows down
    const end = curve.getPoint(1);
    const out = new THREE.Vector3(end.x, 0, end.z);
    if (out.lengthSq() > 1e-6) out.normalize();
    const tan = kind === 'lotus-leaf' ? curve.getTangent(1).multiplyScalar(0.35).add(UP).add(out.clone().multiplyScalar(0.25)).normalize()
      : kind === 'withered-lotus' ? curve.getTangent(1).multiplyScalar(0.3).add(out.clone().multiplyScalar(0.7)).add(UP.clone().multiplyScalar(-0.9)).normalize()
      : curve.getTangent(1).add(out.clone().multiplyScalar(0.7)).add(UP.clone().multiplyScalar(0.55)).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, tan).multiply(new THREE.Quaternion().setFromAxisAngle(UP, rand() * Math.PI * 2));
    const k = scale * (shape.headSize ?? 1);
    const m = new THREE.Matrix4().compose(end, q, new THREE.Vector3(k, k, k));
    parts.push(head(kind, color, Math.floor(rand() * 2), shape.open ?? 1, shape.petalWidth ?? 1).clone().applyMatrix4(m));
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

// ---- petals that come off ----------------------------------------------------------------------------------------

const shedCache = new Map<string, THREE.BufferGeometry | null>();
/**
 * One petal let go by a flower of this kind: its own shape and colours, at the size of the flower's middle petals (in the
 * flower's own units - the caller scales it as the flower is scaled), centred on itself. Null for what does not shed:
 * leaves (eucalyptus, lotus leaf), the calla's single spathe, the dry withered pod.
 */
export function shedPetal(kind: FlowerKind, color: FlowerColor, plump = 1): THREE.BufferGeometry | null {
  const pw = Math.round(plump * 20) / 20;
  const key = `${kind}:${color}:${pw}`;
  if (shedCache.has(key)) return shedCache.get(key)!;
  const base = col(PALETTE[color]);
  PW = pw;
  let g: THREE.BufferGeometry | null = null;
  switch (kind) {
    case 'rose': g = petal({ w: 0.095, l: 0.14, cup: 0.9, bend: 0.06, curl: -0.1, seg: [7, 8], base: base.clone().multiplyScalar(color === 'white' || color === 'champagne' ? 0.82 : 0.6), tip: base, edge: 0.14 }); break;
    case 'peony': g = petal({ w: 0.13, l: 0.17, cup: 0.6, bend: 0.05, ruffle: 0.22, seg: [8, 8], base: base.clone().lerp(col('#c2546e'), color === 'white' ? 0.12 : 0.3), tip: base.clone().lerp(WHITE, 0.1), edge: 0.12 }); break;
    case 'tulip': g = petal({ w: 0.09, l: 0.25, cup: 1.05, bend: 0.14, seg: [6, 9], base: base.clone().lerp(col('#f3e7c6'), 0.4), tip: base }); break;
    case 'lily': g = petal({ w: 0.12, l: 0.34, shape: POINTED, cup: 0.5, bend: -0.3, curl: -0.28, seg: [8, 12], base: col('#e9edc9').lerp(base, 0.4), tip: base, edge: 0.05 }); break;
    case 'lotus': g = petal({ w: 0.1, l: 0.25, shape: FULL, cup: 0.7, bend: 0.06, seg: [7, 9], base: col('#f8f1e6'), tip: color === 'pink' ? col('#e0718f') : col('#f6f4e8'), edge: 0.08 }); break;
    case 'daisy': g = petal({ w: 0.022, l: 0.14, shape: STRAP, cup: 0.15, bend: -0.04, seg: [3, 6], base: col('#e6e2cf'), tip: WHITE }); break;
    case 'hydrangea': {
      // a whole little floret drops, four petals and its eye
      const fp = petal({ w: 0.04, l: 0.06, cup: 0.25, base: base.clone().multiplyScalar(0.85), tip: base, seg: [4, 4] });
      g = mergeGeometries([0, 1, 2, 3].map((k) => place(fp, (k * Math.PI) / 2 + 0.4, 1.35, 0.005)).concat(sphere(0.008, col('#f4f0e2'), 5, 4)));
      break;
    }
    case 'blossom': g = petal({ w: 0.03, l: 0.05, cup: 0.35, seg: [4, 4], base: col(color === 'white' ? '#e9a7b8' : '#d76c8a').lerp(base, 0.5), tip: base }); break;
    case 'pear-blossom': g = petal({ w: 0.036, l: 0.058, shape: OBOVATE, cup: 0.22, bend: -0.05, ruffle: 0.12, seg: [7, 7], base: col('#f1ead2'), tip: WHITE, edge: 0.05 }); break;
    case 'babys-breath': g = sphere(0.013, base, 5, 4); break;
    case 'lavender': g = sphere(0.024, col(PALETTE.purple).lerp(col('#8a6fc8'), 0.4), 6, 4).scale(0.8, 1.3, 0.8); break;
    default: g = null;
  }
  PW = 1;
  if (g) { g.computeBoundingBox(); const c = g.boundingBox!.getCenter(new THREE.Vector3()); g.translate(-c.x, -c.y, -c.z); }
  shedCache.set(key, g);
  return g;
}

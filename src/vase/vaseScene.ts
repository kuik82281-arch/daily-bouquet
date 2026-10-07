import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { POSE_LIMITS, flowerSpec, type BouquetStem, type FlowerKind, type PosedStem } from './flowerCatalog';
import { HEAD_RADIUS, buildStem, carvedSpray, seeded } from './flowers';
import { DEFAULT_STYLE, WINDOW_SHAPES, type Finish, type Relief, type ReliefType, type VaseShape, type VaseStyle, type VaseWindow, type WindowShape } from './vaseStyle';

// The vase: porcelain in the yuhuchun shape (a flared mouth, a long slender neck, a low round belly, a foot ring),
// turned on a lathe with a real wall (an outer and an inner skin meeting over a rolled lip), shaped, glazed and carved
// the way she sets it (vaseStyle.ts): the belly fuller or slimmer, the glaze colour and finish, crackle or none, and
// relief pieces (plum branches, flowers, loose petals, rings) painted as a height map where she put them, turned into
// a normal map and a colour map, so they catch the light like carving under glaze. A quatrefoil window can be cut
// through the front of the belly (in the shader), with a rim round it and a carved spray reaching out of it; the
// inside is shaded dark, so one can look in. The flowers stand in it, one mesh a stem.

const TAU = Math.PI * 2;
const MOUTH_Y = 3.15;
const NECK_Y = 2.55;
const MAX_WIN = 6;
const HEAD_SCALE = 1.4; // flower heads against the vase: a rose about a quarter of the belly across

/** The outer line of the body (radius, height), foot ring to lip, before she shapes it. */
const BODY: [number, number][] = [
  [0.44, 0.15], [0.57, 0.3], [0.7, 0.52], [0.79, 0.8], [0.815, 1.0], [0.78, 1.25], [0.64, 1.55], [0.42, 1.9],
  [0.26, 2.2], [0.205, 2.45], [0.2, 2.65], [0.24, 2.85], [0.34, 3.0], [0.44, 3.1], [0.47, MOUTH_Y],
];
const bellyWeight = (y: number) => Math.exp(-(((y - 0.95) / 0.6) ** 2));
/** Her shaping: the whole vase taller or shorter, the belly fuller or slimmer and higher or lower, the neck thicker or thinner, the mouth flared more or less. */
function shapedBody(shape: VaseShape): [number, number][] {
  return BODY.map(([r, y]) => {
    const wb = bellyWeight(y), wn = Math.exp(-(((y - 2.5) / 0.35) ** 2)), wm = Math.max(0, Math.min(1, (y - 2.75) / 0.4));
    return [r * (1 + (shape.belly - 1) * wb) * (1 + (shape.neck - 1) * wn) * (1 + (shape.mouth - 1) * wm), (y < MOUTH_Y - 0.3 ? y + shape.bellyY * wb : y) * shape.height];
  });
}

type Profile = { pts: THREE.Vector2[]; inner: boolean[]; v: number[]; rAt: (y: number) => number; vAt: (y: number) => number; dvdy: (y: number) => number };

/** The wall's cross-section, foot to lip to the inside bottom, with each point's texture height. */
function vaseProfile(shape: VaseShape): Profile {
  const body = shapedBody(shape);
  const rLip = body[body.length - 1][0];
  const foot = [[0, 0.035], [0.25, 0.035], [0.4, 0.03], [0.425, 0.004], [0.47, 0], [0.478, 0.05], [0.47, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
  const bodyPts = new THREE.SplineCurve(body.map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(150);
  const lip: THREE.Vector2[] = [];
  for (let i = 1; i < 8; i++) { const a = (i / 8) * Math.PI; lip.push(new THREE.Vector2(rLip - 0.0175 + 0.0175 * Math.cos(a), MOUTH_Y * shape.height + 0.0175 * Math.sin(a))); }
  const innerKeys = body.slice(2).reverse().map(([x, y]) => new THREE.Vector2(Math.max(0.04, x - 0.035), y));
  innerKeys.push(new THREE.Vector2(0.35, 0.24), new THREE.Vector2(0.15, 0.21), new THREE.Vector2(0, 0.2));
  const innerPts = new THREE.SplineCurve(innerKeys).getSpacedPoints(120);

  const outer = [...foot, ...bodyPts, ...lip];
  const pts = [...outer, ...innerPts];
  const inner = pts.map((_, i) => i >= outer.length);
  // texture v: the outer skin spans 0.25..1 by length, the inside carries on above 1 (wraps to the flat strip below 0.25)
  const lengths = (list: THREE.Vector2[]) => { const s = [0]; for (let i = 1; i < list.length; i++) s.push(s[i - 1] + list[i].distanceTo(list[i - 1])); return s; };
  const so = lengths(outer), si = lengths([outer[outer.length - 1], ...innerPts]).slice(1);
  const v = [...so.map((s) => 0.25 + 0.75 * (s / so[so.length - 1])), ...si.map((s) => 1 + 0.25 * (s / si[si.length - 1]))];

  const ys = bodyPts.map((p) => p.y), rs = bodyPts.map((p) => p.x);
  const vs = bodyPts.map((_, i) => v[foot.length + i]);
  const lookup = (arr: number[]) => (y: number) => {
    if (y <= ys[0]) return arr[0];
    for (let i = 1; i < ys.length; i++) if (ys[i] >= y) { const f = (y - ys[i - 1]) / (ys[i] - ys[i - 1] || 1); return arr[i - 1] + (arr[i] - arr[i - 1]) * f; }
    return arr[arr.length - 1];
  };
  const rAt = lookup(rs), vAt = lookup(vs);
  return { pts, inner, v, rAt, vAt, dvdy: (y) => (vAt(y + 0.01) - vAt(y - 0.01)) / 0.02 };
}

const FINISHES: Record<Finish, { roughness: number; clearcoat: number; clearcoatRoughness: number; grain: number }> = {
  gloss: { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03, grain: 0.008 },
  satin: { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.16, grain: 0.022 },
  matte: { roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.38, grain: 0.05 },
};

/**
 * 冰裂纹, the way ice-crackle glaze breaks: long arcing cracks running across the vase, shorter ones branching off
 * them at an angle, and fine ones between, so the glaze falls into shards of every size; the cracks catch the light
 * paler than the glaze. Drawn on a canvas the size of the map: red is crack, green a few pale specks in the glaze.
 */
function crackleLayer(W: number, H: number): Uint8ClampedArray {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const rand = seeded('crackle');
  const bottom = H * 0.78; // the outer skin is the top three quarters of the map
  const pts: { x: number; y: number; a: number }[] = [];
  const crack = (x: number, y: number, a: number, len: number, width: number, alpha: number, bendy: number, keep: boolean) => {
    const path: [number, number][] = [[x, y]];
    let turn = (rand() - 0.5) * bendy;
    for (let s = 0; s < len; s += 5) {
      turn = turn * 0.92 + (rand() - 0.5) * bendy * 0.3;
      a += turn * 0.05 + (rand() - 0.5) * 0.06;
      x += Math.cos(a) * 5; y += Math.sin(a) * 5;
      if (y < 0 || y > bottom) break;
      path.push([x, y]);
      if (keep && rand() < 0.25) pts.push({ x, y, a });
    }
    g.strokeStyle = `rgba(255,0,0,${alpha})`;
    g.lineWidth = width;
    g.lineJoin = 'round';
    for (const off of [-W, 0, W]) {
      g.beginPath();
      path.forEach(([px, py], i) => (i ? g.lineTo(px + off, py) : g.moveTo(px + off, py)));
      g.stroke();
    }
  };
  for (let i = 0; i < 26; i++) crack(rand() * W, rand() * bottom, rand() * Math.PI * 2, 500 + rand() * 1400, 4.2, 1, 1.2, true);
  const parents = pts.slice();
  for (let i = 0; i < 900 && parents.length; i++) {
    const p = parents[Math.floor(rand() * parents.length)];
    crack(p.x, p.y, p.a + (rand() < 0.5 ? 1 : -1) * (1 + rand() * 0.9), 30 + rand() * 170, 3, 0.9, 0.8, true);
  }
  const all = pts.slice();
  for (let i = 0; i < 1600 && all.length; i++) {
    const p = all[Math.floor(rand() * all.length)];
    crack(p.x, p.y, p.a + (rand() < 0.5 ? 1 : -1) * (1.1 + rand() * 0.8), 10 + rand() * 50, 2, 0.65, 0.5, false);
  }
  g.fillStyle = 'rgba(0,255,0,0.9)';
  for (let i = 0; i < 700; i++) { g.beginPath(); g.arc(rand() * W, rand() * bottom, 0.6 + rand() * 1.1, 0, Math.PI * 2); g.fill(); }
  const data = g.getImageData(0, 0, W, H).data;
  cv.width = cv.height = 0;
  return data;
}

/** A soft random wash over the glaze (paler in places, deeper in others), wrapping round the vase: 0..1 at a pixel. */
function washNoise(W: number, H: number) {
  const rand = seeded('wash');
  const octave = (nx: number, ny: number) => {
    const grid = Array.from({ length: (ny + 2) * nx }, () => rand());
    const at = (i: number, j: number) => grid[Math.min(ny + 1, j) * nx + (((i % nx) + nx) % nx)];
    return (u: number, v: number) => {
      const x = u * nx, y = v * ny, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      return (at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy;
    };
  };
  const a = octave(4, 3), b = octave(9, 7);
  return (x: number, y: number) => a(x / W, y / H) * 0.7 + b(x / W, y / H) * 0.3;
}

/** The relief and the glaze: her relief pieces painted as heights on a canvas laid round the outer skin, then turned
 * into a normal map and a colour map (the raised parts in the relief colour on the glaze), with the crackle if she
 * wants it. */
function reliefMap(p: Profile, style: VaseStyle): { normal: THREE.CanvasTexture; color: THREE.CanvasTexture } {
  const W = 1536, H = 1536;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const hg = cv.getContext('2d', { willReadFrequently: true })!;
  hg.fillStyle = '#404040';
  hg.fillRect(0, 0, W, H);
  // each relief piece is drawn alone on a sheet, then laid on the heights at its own strength, and on a mask that
  // says how strongly its colour shows
  const sheet = document.createElement('canvas');
  sheet.width = W; sheet.height = H;
  const g = sheet.getContext('2d')!;
  const maskCv = document.createElement('canvas');
  maskCv.width = W; maskCv.height = H;
  const mg = maskCv.getContext('2d', { willReadFrequently: true })!;
  const row = (y: number) => (1 - p.vAt(y)) * H;
  const Y = (y: number) => y * style.shape.height;
  /** Draw `fn` in the skin's own units (x round, y up) at angle `ang` (0 = the front) and height `y`. */
  const at = (ang: number, y: number, fn: () => void, rot = 0, scale = 1) => {
    const sx = W / (TAU * p.rAt(y)), sy = H * p.dvdy(y);
    const px = ((((ang / TAU) % 1) + 1) % 1) * W;
    for (const off of [-W, 0, W]) {
      if (px + off < -W * 0.4 || px + off > W * 1.4) continue;
      g.setTransform(sx, 0, 0, -sy, px + off, row(y));
      g.rotate(rot);
      g.scale(scale, scale);
      fn();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  };

  const blossom = (r: number) => {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.3;
      const cx = Math.cos(a) * r * 0.55, cy = Math.sin(a) * r * 0.55;
      const grad = g.createRadialGradient(cx * 0.6, cy * 0.6, 0, cx, cy, r * 0.55);
      grad.addColorStop(0, '#d2d2d2'); grad.addColorStop(1, '#787878');
      g.beginPath(); g.arc(cx, cy, r * 0.5, 0, TAU); g.fillStyle = grad; g.fill();
    }
    g.beginPath(); g.arc(0, 0, r * 0.22, 0, TAU); g.fillStyle = '#5a5a5a'; g.fill();
    for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(Math.cos(k * 0.8) * r * 0.32, Math.sin(k * 0.8) * r * 0.32, r * 0.06, 0, TAU); g.fillStyle = '#d8d8d8'; g.fill(); }
  };
  const petal = (w: number, l: number) => {
    g.beginPath(); g.moveTo(0, -l / 2); g.bezierCurveTo(w, -l / 3, w, l / 3, 0, l / 2); g.bezierCurveTo(-w * 0.8, l / 4, -w, -l / 3, 0, -l / 2);
    const grad = g.createRadialGradient(-w * 0.2, 0, 0, 0, 0, l * 0.6);
    grad.addColorStop(0, '#d0d0d0'); grad.addColorStop(1, '#7a7a7a');
    g.fillStyle = grad; g.fill();
  };
  /** A raised ridge along +y from the middle: length l, half-width w; pointed at the tip if `pointed`. */
  const ray = (l: number, w: number, pointed = false) => {
    g.beginPath();
    if (pointed) { g.moveTo(0, 0); g.bezierCurveTo(w * 1.3, l * 0.3, w * 0.9, l * 0.75, 0, l); g.bezierCurveTo(-w * 0.9, l * 0.75, -w * 1.3, l * 0.3, 0, 0); }
    else g.ellipse(0, l / 2, w, l / 2, 0, 0, TAU);
    const grad = g.createLinearGradient(-w, 0, w, 0);
    grad.addColorStop(0, '#7c7c7c'); grad.addColorStop(0.5, '#c8c8c8'); grad.addColorStop(1, '#7c7c7c');
    g.fillStyle = grad; g.fill();
  };
  /** A carved flower head: rings of petals and a raised heart dotted with seeds. */
  const flowerHead = (r: number, n: number, layers: number) => {
    for (let L = 0; L < layers; L++) {
      const len = r * (1 - L * 0.24);
      for (let k = 0; k < n; k++) { g.save(); g.rotate((k + L * 0.5) * TAU / n); ray(len, (len * 2.9) / n * 1.1); g.restore(); }
    }
    const grad = g.createRadialGradient(-r * 0.08, r * 0.08, 0, 0, 0, r * 0.34);
    grad.addColorStop(0, '#d6d6d6'); grad.addColorStop(1, '#8e8e8e');
    g.beginPath(); g.arc(0, 0, r * 0.34, 0, TAU); g.fillStyle = grad; g.fill();
    g.fillStyle = '#868686';
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      const x = (i + (j % 2) * 0.5) * r * 0.085, y = j * r * 0.075;
      if (Math.hypot(x, y) < r * 0.27) { g.beginPath(); g.arc(x, y, r * 0.022, 0, TAU); g.fill(); }
    }
  };
  /** A curling scroll (卷草): a tapering C that curls in on itself, with a tail; `flip` mirrors it. */
  const scroll = (x: number, y: number, s: number, rot: number, flip: number) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(flip * s, s);
    const path = () => {
      g.beginPath(); g.moveTo(1.6, -0.9); g.quadraticCurveTo(1.4, 0, 1, 0);
      for (let t = 0; t <= 1.001; t += 0.05) { const a = t * Math.PI * 1.75, rad = 1 - 0.72 * t; g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); }
    };
    g.lineCap = 'round'; g.lineJoin = 'round';
    path(); g.lineWidth = 0.55; g.strokeStyle = '#7c7c7c'; g.stroke();
    path(); g.lineWidth = 0.26; g.strokeStyle = '#bcbcbc'; g.stroke();
    g.beginPath(); g.arc(Math.cos(Math.PI * 1.75) * 0.28, Math.sin(Math.PI * 1.75) * 0.28, 0.2, 0, TAU); g.fillStyle = '#b4b4b4'; g.fill();
    g.restore();
  };
  /** A round raised frame. */
  const frame = (r: number) => {
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.lineWidth = 0.036; g.strokeStyle = '#7e7e7e'; g.stroke();
    g.beginPath(); g.arc(0, 0, r, 0, TAU); g.lineWidth = 0.016; g.strokeStyle = '#c6c6c6'; g.stroke();
  };
  const draw: Record<ReliefType, (r: Relief) => void> = {
    branch: (r) => {
      const rand = seeded(r.id), flip = r.flip;
      at(r.ang, Y(r.y), () => {
        const pts: [number, number][] = [[0, 0], [0.18 * flip, 0.28], [0.08 * flip, 0.62], [0.32 * flip, 0.9]];
        for (const [w, c] of [[0.04, '#707070'], [0.02, '#a0a0a0']] as const) {
          g.beginPath(); g.moveTo(...pts[0]); g.bezierCurveTo(...pts[1], ...pts[2], ...pts[3]);
          g.lineWidth = w; g.lineCap = 'round'; g.strokeStyle = c; g.stroke();
        }
        const twigs: [number, number, number, number][] = [[0.12 * flip, 0.3, 0.38 * flip, 0.42], [0.1 * flip, 0.58, -0.16 * flip, 0.78], [0.2 * flip, 0.78, 0.42 * flip, 0.7]];
        for (const [x0, y0, x1, y1] of twigs) {
          g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 0.06, x1, y1);
          g.lineWidth = 0.018; g.strokeStyle = '#8c8c8c'; g.stroke();
        }
        const spots: [number, number][] = [[0.38 * flip, 0.42], [-0.16 * flip, 0.78], [0.42 * flip, 0.7], [0.32 * flip, 0.9], [0.2 * flip, 0.36], [0.06 * flip, 0.66], [0.24 * flip, 0.55]];
        for (const [x, yy] of spots) {
          g.save(); g.translate(x + (rand() - 0.5) * 0.03, yy + (rand() - 0.5) * 0.03); g.rotate(rand() * TAU);
          blossom(0.075 + rand() * 0.03);
          g.restore();
        }
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc((0.05 + rand() * 0.3) * flip, 0.2 + rand() * 0.6, 0.02, 0, TAU); g.fillStyle = '#b0b0b0'; g.fill(); }
      }, 0, r.scale);
    },
    sprig: (r) => at(r.ang, Y(r.y), () => { blossom(0.07); g.save(); g.translate(0.04 * r.flip, 0.32); blossom(0.055); g.restore(); }, 0, r.scale),
    flower: (r) => at(r.ang, Y(r.y), () => blossom(0.16), 0, r.scale),
    petals: (r) => {
      const rand = seeded(r.id);
      const spots: [number, number, number][] = [[-0.28, -0.66, 1], [-0.05, -0.42, 0.9], [-0.18, 0.32, 0.8], [0.18, -0.16, 1.1], [0.05, 0.58, 0.75], [0.42, -0.5, 0.85], [-0.36, 0.65, 0.7]];
      at(r.ang, Y(r.y), () => {
        for (const [x, yy, s] of spots) { g.save(); g.translate(x * r.flip, yy); g.rotate(rand() * TAU); petal(0.045 * s, 0.085 * s); g.restore(); }
      }, 0, r.scale);
    },
    'scroll-medal': (r) => at(r.ang, Y(r.y), () => {
      // 卷草团花: a chrysanthemum in the middle, big curling scrolls round it, small ones between
      for (let k = 0; k < 8; k++) scroll(Math.cos(k * TAU / 8) * 0.17, Math.sin(k * TAU / 8) * 0.17, 0.06, k * TAU / 8 + 1.2, k % 2 ? 1 : -1);
      for (let k = 0; k < 8; k++) scroll(Math.cos((k + 0.5) * TAU / 8) * 0.25, Math.sin((k + 0.5) * TAU / 8) * 0.25, 0.035, (k + 0.5) * TAU / 8 + 1.6, k % 2 ? -1 : 1);
      flowerHead(0.115, 16, 2);
    }, 0, r.scale),
    'lace-medal': (r) => at(r.ang, Y(r.y), () => {
      // 镂空团花: a lacy round of small scrolls and leaves round a full chrysanthemum
      for (let k = 0; k < 16; k++) scroll(Math.cos(k * TAU / 16) * 0.22, Math.sin(k * TAU / 16) * 0.22, 0.032, k * TAU / 16 + 1.4, k % 2 ? 1 : -1);
      for (let k = 0; k < 12; k++) { g.save(); g.rotate(k * TAU / 12 + 0.26); g.translate(0, 0.1); ray(0.09, 0.028, true); g.restore(); }
      flowerHead(0.1, 22, 3);
    }, 0, r.scale),
    'frame-medal': (r) => at(r.ang, Y(r.y), () => {
      // 圆框缠枝: a round frame, scrolls paired into four lobes inside it, a flower in the middle
      frame(0.27);
      for (let k = 0; k < 4; k++) {
        const a = k * TAU / 4 + TAU / 8;
        scroll(Math.cos(a - 0.3) * 0.16, Math.sin(a - 0.3) * 0.16, 0.05, a + 2.2, 1);
        scroll(Math.cos(a + 0.3) * 0.16, Math.sin(a + 0.3) * 0.16, 0.05, a + 0.9, -1);
        g.save(); g.rotate(a - TAU / 4); g.translate(0, 0.1); ray(0.13, 0.03, true); g.restore();
      }
      flowerHead(0.075, 14, 1);
    }, 0, r.scale),
    'lotus-medal': (r) => at(r.ang, Y(r.y), () => {
      // 荷塘圆框: a round frame round a lotus in flower, its leaves, a bud and reeds
      frame(0.27);
      g.lineCap = 'round';
      for (const [x0, y0, x1, y1, w] of [[0.02, -0.26, 0.0, 0.06, 0.018], [-0.06, -0.26, -0.12, -0.02, 0.014], [0.08, -0.26, 0.15, 0.1, 0.012], [0.16, -0.25, 0.2, -0.04, 0.008], [0.19, -0.24, 0.22, -0.02, 0.008]] as const) {
        g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo((x0 + x1) / 2 + 0.03, (y0 + y1) / 2, x1, y1);
        g.lineWidth = w; g.strokeStyle = '#8c8c8c'; g.stroke();
      }
      // the flower: pointed petals fanned upward
      g.save(); g.translate(0, 0.07);
      for (let k = -3; k <= 3; k++) { g.save(); g.rotate(k * 0.36); ray(0.13 - Math.abs(k) * 0.012, 0.035, true); g.restore(); }
      g.restore();
      // the leaves: round, veined from the middle
      for (const [x, y, rx, ry, tilt] of [[-0.13, -0.06, 0.095, 0.06, 0.3], [0.1, -0.13, 0.08, 0.05, -0.4]] as const) {
        g.save(); g.translate(x, y); g.rotate(tilt);
        g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, rx); grad.addColorStop(0, '#bdbdbd'); grad.addColorStop(1, '#7e7e7e');
        g.fillStyle = grad; g.fill();
        g.lineWidth = 0.005; g.strokeStyle = '#6e6e6e';
        for (let k = 0; k < 9; k++) { const a = k * TAU / 9; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * rx * 0.9, Math.sin(a) * ry * 0.9); g.stroke(); }
        g.restore();
      }
      g.save(); g.translate(-0.12, 0.08); g.rotate(-0.3); ray(0.07, 0.026, true); g.restore();
    }, 0, r.scale),
    'ruyi-medal': (r) => at(r.ang, Y(r.y), () => {
      // 如意花: four cloud-headed ruyi lobes round a daisy, little points between them
      for (let k = 0; k < 4; k++) {
        g.save(); g.rotate(k * TAU / 4);
        const lobe = () => { g.beginPath(); g.moveTo(-0.06, 0.08); g.bezierCurveTo(-0.2, 0.15, -0.16, 0.3, -0.07, 0.26); g.bezierCurveTo(-0.05, 0.33, 0.05, 0.33, 0.07, 0.26); g.bezierCurveTo(0.16, 0.3, 0.2, 0.15, 0.06, 0.08); g.closePath(); };
        lobe();
        const grad = g.createRadialGradient(0, 0.2, 0, 0, 0.2, 0.14); grad.addColorStop(0, '#c4c4c4'); grad.addColorStop(1, '#848484');
        g.fillStyle = grad; g.fill();
        g.save(); g.translate(0, 0.19); g.scale(0.55, 0.55); g.translate(0, -0.19); lobe(); g.fillStyle = '#5c5c5c'; g.fill(); g.restore();
        g.rotate(TAU / 8); g.translate(0, 0.17); ray(0.08, 0.022, true);
        g.restore();
      }
      flowerHead(0.12, 18, 2);
    }, 0, r.scale),
    ring: (r) => {
      const y = row(Y(r.y)), half = 7 * r.scale;
      const grad = g.createLinearGradient(0, y - half, 0, y + half);
      grad.addColorStop(0, '#404040'); grad.addColorStop(0.5, '#9a9a9a'); grad.addColorStop(1, '#404040');
      g.fillStyle = grad;
      g.fillRect(0, y - half, W, half * 2);
    },
  };
  for (const r of style.reliefs) {
    g.clearRect(0, 0, W, H);
    draw[r.type](r);
    hg.globalAlpha = r.opacity; hg.drawImage(sheet, 0, 0);
    mg.globalAlpha = r.opacity; mg.drawImage(sheet, 0, 0);
  }
  hg.globalAlpha = 1;
  sheet.width = sheet.height = 0;
  const mask = mg.getImageData(0, 0, W, H).data;
  maskCv.width = maskCv.height = 0;

  // heights -> normals (x round the vase, y up it), with a grain that follows the finish, and the crackle cut in
  const src = hg.getImageData(0, 0, W, H).data;
  const crack = style.crackle ? crackleLayer(W, H) : null;
  const wash = style.crackle ? washNoise(W, H) : null;
  const crackAt = (x: number, y: number) => (crack ? crack[(Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)) * 4] / 255 : 0);
  const out = hg.createImageData(W, H);
  const o = out.data;
  const tint = document.createElement('canvas');
  tint.width = W; tint.height = H;
  const tg = tint.getContext('2d')!;
  const tintData = tg.createImageData(W, H);
  const c = tintData.data;
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const gl = rgb(style.glaze), cr = rgb(style.relief);
  const pale = gl.map((v) => v + (255 - v) * 0.4), deep = gl.map((v) => v * 0.82);
  const grain = FINISHES[style.finish].grain;
  const k = 6 / 255;
  const h = (x: number, y: number) => src[(Math.min(H - 1, Math.max(0, y)) * W + ((x + W) % W)) * 4] - (crack ? 40 * crackAt(x, y) : 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = -(h(x + 1, y) - h(x - 1, y)) * k + (Math.random() - 0.5) * grain, ny = (h(x, y + 1) - h(x, y - 1)) * k + (Math.random() - 0.5) * grain;
    const len = Math.hypot(nx, ny, 1);
    const i = (y * W + x) * 4;
    o[i] = (nx / len * 0.5 + 0.5) * 255; o[i + 1] = (ny / len * 0.5 + 0.5) * 255; o[i + 2] = (1 / len * 0.5 + 0.5) * 255; o[i + 3] = 255;
    const f = Math.min(1, Math.max(0, (src[(y * W + x) * 4] - 70) / 40)) * (mask[(y * W + x) * 4 + 3] / 255);
    // the glaze (washed paler and deeper at random under crackle), the relief over it, then the cracks catching the light
    let gr = gl[0], gg = gl[1], gb = gl[2];
    if (wash) { const n = wash(x, y); gr = deep[0] + (pale[0] - deep[0]) * n; gg = deep[1] + (pale[1] - deep[1]) * n; gb = deep[2] + (pale[2] - deep[2]) * n; }
    let r0 = gr + (cr[0] - gr) * f, g0 = gg + (cr[1] - gg) * f, b0 = gb + (cr[2] - gb) * f;
    if (crack) {
      const lit = crack[i] / 255 * 0.6 + crack[i + 1] / 255 * 0.5;
      r0 += (255 - r0) * lit; g0 += (255 - g0) * lit; b0 += (255 - b0) * lit;
    }
    c[i] = r0; c[i + 1] = g0; c[i + 2] = b0; c[i + 3] = 255;
  }
  hg.putImageData(out, 0, 0);
  tg.putImageData(tintData, 0, 0);
  const normal = new THREE.CanvasTexture(cv);
  const color = new THREE.CanvasTexture(tint);
  color.colorSpace = THREE.SRGBColorSpace;
  for (const t of [normal, color]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; }
  return { normal, color };
}

/** Inside a window's shape, in its own unit coordinates (the same test the shader makes). */
function inWindow(x: number, y: number, shape: WindowShape) {
  switch (shape) {
    case 'begonia': return Math.min(Math.hypot(x - 0.5, y), Math.hypot(x + 0.5, y), Math.hypot(x, y - 0.5), Math.hypot(x, y + 0.5)) < 0.5;
    case 'round': return Math.hypot(x, y) < 0.9;
    case 'plum': return Math.hypot(x, y) < 0.58 + 0.34 * Math.abs(Math.cos(2.5 * Math.atan2(x, y))) ** 0.7;
    case 'diamond': return Math.abs(x) * 0.85 + Math.abs(y) < 0.95;
    case 'oval': return x * x + (y / 0.55) ** 2 < 1;
    case 'fan': { const r = Math.hypot(x, y + 0.75), a = Math.atan2(x, y + 0.75); return r > 0.55 && r < 1.45 && Math.abs(a) < 0.85; }
  }
}
const WINDOW_GLSL = `
bool inWin(vec2 p, float shape) {
  if (shape < 0.5) return min(min(length(p - vec2(.5, 0.)), length(p + vec2(.5, 0.))), min(length(p - vec2(0., .5)), length(p + vec2(0., .5)))) < .5;
  if (shape < 1.5) return length(p) < .9;
  if (shape < 2.5) return length(p) < .58 + .34 * pow(abs(cos(2.5 * atan(p.x, p.y))), .7);
  if (shape < 3.5) return abs(p.x) * .85 + abs(p.y) < .95;
  if (shape < 4.5) return p.x * p.x + (p.y / .55) * (p.y / .55) < 1.;
  vec2 c = p + vec2(0., .75);
  return length(c) > .55 && length(c) < 1.45 && abs(atan(c.x, c.y)) < .85;
}`;

/**
 * A window filled in like 玲珑 porcelain: a thin translucent pane in the middle of the wall, in the window's colour,
 * as see-through as she likes. The pane is a patch of the wall round the window; its shader keeps only the shape.
 */
function windowPane(p: Profile, w: VaseWindow, color: string) {
  const n = 28, r0 = p.rAt(w.y), c = Math.cos(w.rot), s = Math.sin(w.rot);
  const pos: number[] = [], unit: number[] = [], idx: number[] = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const ux = (i / n) * 3.2 - 1.6, uy = (j / n) * 3.2 - 1.6;
    const qx = (c * ux - s * uy) * w.size, qy = (s * ux + c * uy) * w.size;
    const y = w.y + qy, r = p.rAt(y) - 0.017, ang = w.ang + qx / r0;
    pos.push(Math.sin(ang) * r, y, Math.cos(ang) * r);
    unit.push(ux, uy);
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i; idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aUnit', new THREE.Float32BufferAttribute(unit, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: w.opacity, roughness: 0.35, clearcoat: 0.6, side: THREE.DoubleSide, depthWrite: false });
  const shape = WINDOW_SHAPES.indexOf(w.shape);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUnit;\nvarying vec2 vUnit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUnit = aUnit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vUnit;\n${WINDOW_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n if (!inWin(vUnit, ${shape.toFixed(1)})) discard;`);
  };
  mat.customProgramCacheKey = () => `vase-pane-${shape}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}

/** Where a window's edge runs, as points on the skin: out from its middle along each direction until it leaves the shape. */
function windowRim(p: Profile, w: VaseWindow) {
  const r0 = p.rAt(w.y), c = Math.cos(w.rot), s = Math.sin(w.rot);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 180; i++) {
    const a = (i / 180) * TAU, dx = Math.sin(a), dy = Math.cos(a);
    let lo = 0, hi = 0.02;
    while (hi < 2 && inWindow(dx * hi, dy * hi, w.shape)) { lo = hi; hi += 0.02; }
    for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (inWindow(dx * m, dy * m, w.shape)) lo = m; else hi = m; }
    const ux = dx * lo * w.size, uy = dy * lo * w.size;
    const qx = c * ux - s * uy, qy = s * ux + c * uy;
    const y = w.y + qy, r = p.rAt(y) - 0.012, ang = w.ang + qx / r0;
    pts.push(new THREE.Vector3(Math.sin(ang) * r, y, Math.cos(ang) * r));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

function shadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)'); grad.addColorStop(0.45, 'rgba(0,0,0,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

/** The whole vase as she has styled it. */
function buildVase(style: VaseStyle) {
  const p = vaseProfile(style.shape);
  const fin = FINISHES[style.finish];
  const geo = new THREE.LatheGeometry(p.pts, 112);
  const n = p.pts.length;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const innerAttr = new Float32Array(uv.count);
  for (let i = 0; i <= 112; i++) for (let j = 0; j < n; j++) {
    uv.setY(i * n + j, p.v[j]);
    innerAttr[i * n + j] = p.inner[j] ? 1 : 0;
  }
  geo.setAttribute('aInner', new THREE.BufferAttribute(innerAttr, 1));
  const { normal: normalMap, color: map } = reliefMap(p, style);
  const mat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff', map, roughness: fin.roughness, clearcoat: fin.clearcoat, clearcoatRoughness: fin.clearcoatRoughness, normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
    clearcoatNormalMap: normalMap, clearcoatNormalScale: new THREE.Vector2(0.45, 0.45), side: THREE.DoubleSide,
  });
  // the windows go to the shader as (angle, height, radius there, size) and (turn, shape)
  const wins = style.windows.map((w) => ({ ...w, y: w.y * style.shape.height }));
  const winA = Array.from({ length: MAX_WIN }, (_, i) => { const w = wins[i]; return w ? new THREE.Vector4(w.ang, w.y, p.rAt(w.y), w.size) : new THREE.Vector4(); });
  const winB = Array.from({ length: MAX_WIN }, (_, i) => { const w = wins[i]; return w ? new THREE.Vector4(w.rot, WINDOW_SHAPES.indexOf(w.shape), 0, 0) : new THREE.Vector4(); });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWinA = { value: winA };
    shader.uniforms.uWinB = { value: winB };
    shader.uniforms.uWinN = { value: Math.min(MAX_WIN, style.windows.length) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aInner;\nvarying float vInner;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInner = aInner;\nvObj = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vInner;\nvarying vec3 vObj;\nuniform vec4 uWinA[${MAX_WIN}];\nuniform vec4 uWinB[${MAX_WIN}];\nuniform int uWinN;\n${WINDOW_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        for (int i = 0; i < ${MAX_WIN}; i++) {
          if (i >= uWinN) break;
          vec4 A = uWinA[i];
          vec4 B = uWinB[i];
          if (dot(vObj.xz, vec2(sin(A.x), cos(A.x))) <= 0.) continue;
          float da = mod(atan(vObj.x, vObj.z) - A.x + PI, 2. * PI) - PI;
          vec2 q = vec2(da * A.z, vObj.y - A.y);
          float c = cos(B.x), s = sin(B.x);
          q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y) / A.w;
          if (inWin(q, B.y)) discard;
        }`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.clearcoat *= 1.0 - vInner;`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= mix(1.0, 0.16, vInner);
        reflectedLight.indirectSpecular *= mix(1.0, 0.1, vInner);
        reflectedLight.directDiffuse *= mix(1.0, 0.3, vInner);
        reflectedLight.directSpecular *= mix(1.0, 0.2, vInner);`);
  };
  mat.customProgramCacheKey = () => 'vase-windows';
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mat));
  const fin2 = { roughness: fin.roughness, clearcoat: fin.clearcoat, clearcoatRoughness: fin.clearcoatRoughness };
  const rimMat = new THREE.MeshPhysicalMaterial({ color: style.glaze, ...fin2 });
  const sprayMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, ...fin2, clearcoat: fin.clearcoat * 0.8, side: THREE.DoubleSide });
  for (const w of wins) {
    group.add(new THREE.Mesh(new THREE.TubeGeometry(windowRim(p, w), 240, 0.026, 8, true), w.color ? new THREE.MeshPhysicalMaterial({ color: w.color, ...fin2 }) : rimMat));
    if (w.opacity > 0) group.add(windowPane(p, w, w.color ?? style.glaze));
    if (!w.spray) continue;
    // a carved spray of blossom reaches out of the window towards whoever looks, like the vase in her picture
    const out = new THREE.Vector3(Math.sin(w.ang), 0, Math.cos(w.ang));
    const at = out.clone().multiplyScalar(p.rAt(w.y)).setY(w.y);
    group.add(new THREE.Mesh(carvedSpray(at, out, w.sprayBranch ?? style.glaze, w.sprayFlower ?? style.relief, (u) => p.rAt(w.y + u) - p.rAt(w.y)), sprayMat));
  }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.002;
  group.add(shadow);
  group.userData.rAt = p.rAt;
  return group;
}

function disposeGroup(group: THREE.Object3D) {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mat) => { const pm = mat as THREE.MeshPhysicalMaterial; pm.map?.dispose(); pm.normalMap?.dispose(); mat.dispose(); });
  });
}

type Placed = { mesh: THREE.Mesh; born: number; phase: number; pose: PosedStem };

/** Where the mouth and the neck are now (they move when she makes the vase taller or shorter). */
const MOUTH = new THREE.Vector3(0, MOUTH_Y, 0);
let NECK = NECK_Y;
/** How far a stem bows below the arc it makes: the long arching branches most, the upright spikes least. */
function droopOf(p: PosedStem) {
  const role = flowerSpec(p.kind).role;
  const k = p.kind === 'withered-lotus' ? 0.4 : p.kind === 'pear-blossom' ? 0.32 : role === 'line' ? 0.05 : 0.2;
  return p.len * k * (p.bend ?? 1) * Math.min(1, Math.sin(Math.max(p.tilt, 0.35)) * 1.8);
}
/** Where a posed stem's head ends up. */
function headOf(p: PosedStem) {
  const droop = droopOf(p);
  const pos = MOUTH.clone().add(new THREE.Vector3(Math.sin(p.tilt) * Math.cos(p.az) * 1.3, Math.cos(p.tilt), Math.sin(p.tilt) * Math.sin(p.az) * 1.3).multiplyScalar(p.len)).add(new THREE.Vector3(0, -droop, 0));
  return { pos, droop };
}

/** A new stem's natural pose for its kind (where she drops one in, or where his go before they are spread out). */
export function defaultPose(kind: FlowerKind, color: PosedStem['color'], rand: () => number, az = rand() * TAU, spread = 1): PosedStem {
  const role = flowerSpec(kind).role;
  const pear = kind === 'pear-blossom';
  const tilt = (pear ? 0.55 + rand() * 0.5 : role === 'line' ? 0.1 + rand() * 0.4 : role === 'focal' ? 0.35 + rand() * 0.55 : 0.55 + rand() * 0.45) * (pear ? 1 : spread);
  const len = pear ? 1.9 + rand() * 0.5 : role === 'line' ? 1.55 + rand() * 0.4 : 0.95 + rand() * (role === 'focal' ? 0.35 : 0.45);
  return { kind, color, az, tilt, len, seed: Math.floor(rand() * 1e9) };
}

/** His bouquet laid out: tall lines first, then the big heads, then the fillers, round the vase by the golden angle
 * (the first towards the front), nudged apart where heads would sit inside one another. */
export function autoPoses(stems: BouquetStem[], seed: string): PosedStem[] {
  const rand = seeded(seed);
  const order = { line: 0, focal: 1, filler: 2 } as const;
  const list = stems.flatMap((s) => Array.from({ length: s.count }, () => s))
    .sort((a, b) => order[flowerSpec(a.kind).role] - order[flowerSpec(b.kind).role]);
  const spread = Math.min(1, Math.max(0.45, Math.sqrt(list.length / 9)));
  const poses = list.map((s, i) => ({ ...defaultPose(s.kind, s.color, rand, Math.PI / 2 + i * 2.39996 + rand() * 0.4, spread), ...s.shape }));
  for (let it = 0; it < 30; it++) for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) {
    const a = poses[i], b = poses[j];
    const min = (HEAD_RADIUS[a.kind] + HEAD_RADIUS[b.kind]) * HEAD_SCALE * 0.85;
    if (headOf(a).pos.distanceTo(headOf(b).pos) >= min) continue;
    const side = Math.sin(b.az - a.az) >= 0 ? 1 : -1;
    a.az -= 0.05 * side; b.az += 0.05 * side;
    a.tilt = Math.max(0.05, a.tilt * 0.98); b.tilt = Math.min(1.2, b.tilt * 1.02 + 0.01);
  }
  return poses;
}

export class VaseScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private controls: OrbitControls;
  private flowerMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, sheen: 0.2, sheenRoughness: 0.55, sheenColor: new THREE.Color('#ffffff') });
  private stems: Placed[] = [];
  private vase: THREE.Group;
  private styleKey = JSON.stringify(DEFAULT_STYLE);
  private height = 1;
  private selectedMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, emissive: new THREE.Color('#8a6a3a'), emissiveIntensity: 0.45 });
  private selected: number | null = null;
  private ray = new THREE.Raycaster();
  /** The little white dot on whatever she has chosen (a flower, a relief, a window), drawn over everything. */
  private marker = new THREE.Group();
  private bouquet = new THREE.Group();
  private clock = new THREE.Clock();
  private frame = 0;
  private resizeObs: ResizeObserver;
  private fit = { y: 1.7, h: 3.6, w: 1.2 };
  private fitNow = { y: 1.7, h: 3.6, w: 1.2 };

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    host.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    const key = new THREE.DirectionalLight('#fff2e2', 2.4);
    key.position.set(-3, 6, 5);
    const rim = new THREE.DirectionalLight('#d9e2ff', 1.3);
    rim.position.set(4, 4, -5);
    const low = new THREE.DirectionalLight('#ffe9e0', 0.35);
    low.position.set(2, 0.5, 4);
    this.scene.add(key, rim, low);

    MOUTH.y = MOUTH_Y; NECK = NECK_Y; // a fresh scene starts at the vase's own height
    this.vase = buildVase(DEFAULT_STYLE);
    this.scene.add(this.vase, this.bouquet);
    // a white dot with a dark ring round it (so it shows on white petals too) and a soft glow, always facing her
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const glow = g.createRadialGradient(32, 32, 8, 32, 32, 32);
    glow.addColorStop(0, 'rgba(255,255,255,0.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 64, 64);
    g.beginPath(); g.arc(32, 32, 11, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    g.lineWidth = 3; g.strokeStyle = '#3a2c20'; g.stroke();
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
    dot.scale.setScalar(0.16);
    dot.renderOrder = 20;
    this.marker.add(dot);
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.minPolarAngle = Math.PI * 0.28;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.target.set(0, 1.7, 0);
    this.camera.position.set(0, 4.6, 9);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.resize();
    this.loop();
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Put his bouquet in the vase (an empty list leaves it empty). `seed` keeps the same bouquet arranged the same. */
  setBouquet(stems: BouquetStem[], seed: string) {
    this.setPoses(autoPoses(stems, seed));
  }

  /** Stand these stems in the vase, each where its pose says, growing in one after another. */
  setPoses(poses: PosedStem[]) {
    for (const s of this.stems) { this.bouquet.remove(s.mesh); s.mesh.geometry.dispose(); }
    this.stems = [];
    this.selected = null;
    this.setMarker(null);
    const now = this.clock.elapsedTime;
    poses.forEach((p, i) => this.stems.push(this.makeStem(p, now + 0.15 + i * 0.09)));
    this.refit();
  }

  /** Add one stem (it grows in); returns its index. */
  addPose(p: PosedStem) {
    this.stems.push(this.makeStem(p, this.clock.elapsedTime));
    this.refit();
    return this.stems.length - 1;
  }

  /** Re-pose one stem in place (no growing in again). */
  updatePose(i: number, p: PosedStem) {
    const old = this.stems[i];
    if (!old) return;
    this.bouquet.remove(old.mesh);
    old.mesh.geometry.dispose();
    const next = this.makeStem(p, -10);
    next.phase = old.phase;
    this.stems[i] = next;
    if (this.selected === i) { next.mesh.material = this.selectedMat; this.setMarker(headOf(p).pos); }
    this.refit();
  }

  removePose(i: number) {
    const old = this.stems[i];
    if (!old) return;
    this.bouquet.remove(old.mesh);
    old.mesh.geometry.dispose();
    this.stems.splice(i, 1);
    this.selected = null;
    this.setMarker(null);
    this.stems.forEach((s) => { s.mesh.material = this.flowerMat; });
    this.refit();
  }

  /** Put the little white dot here (null: hide it). */
  setMarker(at: THREE.Vector3 | null) {
    this.marker.visible = Boolean(at);
    if (at) this.marker.position.copy(at);
  }

  /** Put the dot on the vase's skin at this angle and height (in the vase's own units). */
  markSurface(ang: number, y: number) {
    const rAt = this.vase.userData.rAt as (y: number) => number;
    const yy = y * this.height, r = rAt(yy) + 0.03;
    this.setMarker(new THREE.Vector3(Math.sin(ang) * r, yy, Math.cos(ang) * r));
  }

  /** Light up the stem she is adjusting (null: none), with the dot on its flower. */
  select(i: number | null) {
    this.selected = i;
    this.setMarker(i === null || !this.stems[i] ? null : headOf(this.stems[i].pose).pos);
    this.stems.forEach((s, k) => { s.mesh.material = k === i ? this.selectedMat : this.flowerMat; });
  }

  /** Which stem is under this point of the screen, if any. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObjects(this.stems.map((s) => s.mesh), false)[0];
    return hit ? this.stems.findIndex((s) => s.mesh === hit.object) : null;
  }

  setAutoRotate(on: boolean) { this.controls.autoRotate = on; }

  /** A picture of the vase as it stands now (without the white dot), on the page's dark ground with its warm glow and a
   * small caption, as a PNG to save or share. */
  snapshot(caption: string): Promise<Blob> {
    const markerWas = this.marker.visible;
    this.marker.visible = false;
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement, w = src.width, h = src.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const g = out.getContext('2d')!;
    g.fillStyle = '#050403';
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.55);
    glow.addColorStop(0, 'rgba(92,78,64,0.42)');
    glow.addColorStop(1, 'rgba(92,78,64,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    g.drawImage(src, 0, 0);
    this.marker.visible = markerWas;
    g.fillStyle = 'rgba(236,228,216,0.72)';
    g.font = `italic ${Math.round(h * 0.024)}px Georgia, "Times New Roman", serif`;
    g.textAlign = 'center';
    g.fillText(caption, w / 2, h - h * 0.045);
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
  }

  /** Rebuild the vase as she has styled it (the flowers stay). */
  setStyle(style: VaseStyle) {
    const key = JSON.stringify(style);
    if (key === this.styleKey) return;
    this.styleKey = key;
    this.scene.remove(this.vase);
    disposeGroup(this.vase);
    this.vase = buildVase(style);
    this.scene.add(this.vase);
    if (style.shape.height !== this.height) {
      this.height = style.shape.height;
      MOUTH.y = MOUTH_Y * this.height;
      NECK = NECK_Y * this.height;
      this.stems.forEach((st, i) => this.updatePose(i, st.pose));
      this.refit();
    }
  }

  /** Turn the camera round to look at this side of the vase (0 = the front). */
  /** Which side of the vase the camera is looking at (0 = the front). */
  viewAngle() { return Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z); }

  /** Where on the vase's skin this point of the screen falls: its angle round the vase and its height in the vase's
   * own units (before her height scaling), or null off the vase. */
  pickSurface(clientX: number, clientY: number): { ang: number; y: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const body = this.vase.children[0];
    const hit = body ? this.ray.intersectObject(body, false)[0] : undefined;
    if (!hit) return null;
    return { ang: Math.atan2(hit.point.x, hit.point.z), y: hit.point.y / this.height };
  }

  faceAngle(ang: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const flat = Math.hypot(off.x, off.z);
    off.x = Math.sin(ang) * flat; off.z = Math.cos(ang) * flat;
    this.camera.position.copy(this.controls.target).add(off);
  }

  private makeStem(p: PosedStem, born: number): Placed {
    const rand = seeded(String(p.seed));
    const pose = { ...p, tilt: Math.min(POSE_LIMITS.tilt[1], Math.max(POSE_LIMITS.tilt[0], p.tilt)) };
    const { pos, droop } = headOf(pose);
    const dir = new THREE.Vector3(pos.x, 0, pos.z);
    if (dir.lengthSq() < 1e-6) dir.set(Math.cos(p.az), 0, Math.sin(p.az)); else dir.normalize();
    // stems bow: they rise out of the neck, arc outward, and the head ends a little lower than the arc
    const base = new THREE.Vector3(Math.cos(p.az) * 0.06, NECK, Math.sin(p.az) * 0.06);
    const reach = pos.clone().sub(MOUTH).setY(0);
    const c1 = MOUTH.clone().add(new THREE.Vector3(0, 0.45, 0)).add(dir.clone().multiplyScalar(0.04)).sub(base);
    const c2 = MOUTH.clone().add(reach.clone().multiplyScalar(0.6)).setY(pos.y + droop * 1.3 + 0.05).sub(base);
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(), c1, c2, pos.clone().sub(base));
    const geo = buildStem(p.kind, p.color, curve, rand, HEAD_SCALE * (0.9 + rand() * 0.2), p);
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, this.flowerMat);
    mesh.position.copy(base);
    mesh.scale.setScalar(born < 0 ? 1 : 0.001);
    this.bouquet.add(mesh);
    return { mesh, born, phase: rand() * TAU, pose: p };
  }

  /** Frame the vase and whatever stands in it. */
  private refit() {
    let top = MOUTH.y, wide = 1;
    for (const { mesh } of this.stems) {
      const bb = mesh.geometry.boundingBox!, b = mesh.position;
      top = Math.max(top, b.y + bb.max.y);
      wide = Math.max(wide, Math.abs(b.x + bb.min.x), Math.abs(b.x + bb.max.x), Math.abs(b.z + bb.min.z), Math.abs(b.z + bb.max.z));
    }
    this.fit = this.stems.length ? { y: top / 2 + 0.2, h: top + 0.9, w: wide * 2 + 0.3 } : { y: 1.62 * this.height, h: 3.6 * this.height, w: 2.2 };
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.elapsedTime;
    for (const s of this.stems) {
      const k = s.born < 0 ? 1 : Math.min(1, Math.max(0, (t - s.born) / 1.1));
      s.mesh.scale.setScalar(0.001 + (1 - (1 - k) ** 3) * 0.999);
      s.mesh.rotation.set(Math.sin(t * 0.7 + s.phase) * 0.012, 0, Math.cos(t * 0.6 + s.phase) * 0.012);
    }
    if (this.marker.visible) this.marker.scale.setScalar(1 + Math.sin(t * 4) * 0.15);
    // frame the vase and its flowers (eased when the bouquet changes)
    const e = 1 - Math.exp(-dt * 3);
    this.fitNow.y += (this.fit.y - this.fitNow.y) * e;
    this.fitNow.h += (this.fit.h - this.fitNow.h) * e;
    this.fitNow.w += (this.fit.w - this.fitNow.w) * e;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(this.fitNow.h / 2 / tan, this.fitNow.w / 2 / (tan * this.camera.aspect)) * 1.1 + 0.6;
    this.controls.target.y = this.fitNow.y;
    const off = this.camera.position.clone().sub(this.controls.target);
    off.setLength(dist);
    this.camera.position.copy(this.controls.target).add(off);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        const pm = mat as THREE.MeshPhysicalMaterial;
        pm.map?.dispose(); pm.normalMap?.dispose(); mat.dispose();
      });
    });
    this.flowerMat.dispose();
    this.marker.children.forEach((o) => { const m = (o as THREE.Sprite).material; m.map?.dispose(); m.dispose(); });
    this.selectedMat.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

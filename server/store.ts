// Daily Bouquet - the store behind the vase. Three things are kept in one small JSON file (DATA_DIR/vase.json):
//   - the bouquets an AI arranges for the user, one a day (a second one the same day replaces the first);
//   - the vase the user arranges herself, stem by stem (kept until she changes it);
//   - how the user has shaped the vase (glaze, finish, crackle, shape, windows, reliefs).
// Every call reads the file afresh, so the HTTP server and the MCP server can share it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLOWER_KINDS, FLOWERS, MAX_HER_STEMS, MAX_STEMS, POSE_LIMITS, STEM_LIMITS, flowerSpec,
  type Bouquet, type BouquetStem, type FlowerColor, type FlowerKind, type HerVase, type PosedStem, type StemShape,
} from '../src/vase/flowerCatalog.ts';
import { cleanStyle, type VaseStyle } from '../src/vase/vaseStyle.ts';

type VaseStore = { bouquets: Bouquet[]; mine?: HerVase; style?: VaseStyle };

let dir = path.resolve(process.env.DATA_DIR ?? path.join(import.meta.dirname, '..', 'data'));
/** Point the store somewhere else (tests). */
export function setDataDir(next: string) { dir = next; }
const file = () => path.join(dir, 'vase.json');

function load(): VaseStore {
  try {
    const s = JSON.parse(readFileSync(file(), 'utf8')) as VaseStore;
    return Array.isArray(s?.bouquets) ? s : { bouquets: [] };
  } catch {
    return { bouquets: [] };
  }
}
function save(store: VaseStore) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2));
  renameSync(tmp, file());
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The local day, YYYY-MM-DD. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export class VaseError extends Error {}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };

/** A hand-shaping made safe: only the known knobs, each kept in range. */
export function cleanShape(input: unknown): StemShape | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const s = input as Record<string, unknown>;
  const shape: StemShape = {};
  for (const key of Object.keys(STEM_LIMITS) as (keyof StemShape)[]) {
    if (s[key] != null && Number.isFinite(Number(s[key]))) shape[key] = clamp(s[key], STEM_LIMITS[key][0], STEM_LIMITS[key][1], 1);
  }
  return Object.keys(shape).length ? shape : undefined;
}

/** The AI's choice made safe: known kinds, a colour the kind comes in, 1-7 stems each, at most MAX_STEMS in all. */
export function cleanStems(stems: { kind: string; color?: string; count?: number; shape?: unknown }[]): BouquetStem[] {
  if (!Array.isArray(stems) || !stems.length) throw new VaseError('choose at least one flower');
  const merged = new Map<string, BouquetStem>();
  for (const s of stems) {
    if (!FLOWER_KINDS.includes(s?.kind as FlowerKind)) throw new VaseError(`no such flower: ${s?.kind}`);
    const spec = flowerSpec(s.kind as FlowerKind);
    const color = (s.color && spec.colors.includes(s.color as FlowerColor) ? s.color : spec.colors[0]) as FlowerColor;
    const count = Math.max(1, Math.min(7, Math.round(Number(s.count) || 1)));
    const key = `${spec.kind}:${color}`;
    const prev = merged.get(key);
    const shape = prev?.shape ?? cleanShape(s.shape);
    merged.set(key, { kind: spec.kind, color, count: Math.min(7, (prev?.count ?? 0) + count), ...(shape ? { shape } : {}) });
  }
  const list = [...merged.values()].slice(0, 6);
  if (list.reduce((n, s) => n + s.count, 0) > MAX_STEMS) throw new VaseError(`at most ${MAX_STEMS} stems in a bouquet`);
  return list;
}

/** Put today's bouquet in the vase (replacing one already put in today). */
export function arrangeBouquet(input: { stems: { kind: string; color?: string; count?: number; shape?: unknown }[]; note: string; title?: string }, now = new Date()): Bouquet {
  const note = String(input?.note ?? '').trim().slice(0, 140);
  if (!note) throw new VaseError('write a line to go with the flowers');
  const bouquet: Bouquet = {
    date: dayKey(now),
    stems: cleanStems(input.stems),
    note,
    ...(input.title?.trim() ? { title: input.title.trim().slice(0, 16) } : {}),
    createdAt: now.toISOString(),
  };
  const store = load();
  save({ ...store, bouquets: [bouquet, ...store.bouquets.filter((b) => b.date !== bouquet.date)].slice(0, 400) });
  return bouquet;
}

export const bouquetOn = (date: string) => load().bouquets.find((b) => b.date === date) ?? null;
export const recentBouquets = (limit = 60) => [...load().bouquets].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

/** One stem the user placed, made safe. */
export function cleanPose(s: Partial<PosedStem> & { kind?: string; color?: string }): PosedStem {
  if (!FLOWER_KINDS.includes(s?.kind as FlowerKind)) throw new VaseError(`no such flower: ${s?.kind}`);
  const spec = flowerSpec(s.kind as FlowerKind);
  const az = Number(s.az);
  return {
    kind: spec.kind,
    color: (s.color && spec.colors.includes(s.color as FlowerColor) ? s.color : spec.colors[0]) as FlowerColor,
    az: Number.isFinite(az) ? ((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) : 0,
    tilt: clamp(s.tilt, POSE_LIMITS.tilt[0], POSE_LIMITS.tilt[1], 0.5),
    len: clamp(s.len, POSE_LIMITS.len[0], POSE_LIMITS.len[1], 1.4),
    seed: Math.round(clamp(s.seed, 0, 1e9, 1)),
    ...cleanShape(s),
  };
}

/** Keep the vase the user arranged herself (an empty list empties it). */
export function saveHerVase(stems: unknown, now = new Date()): HerVase {
  if (!Array.isArray(stems)) throw new VaseError('stems must be a list');
  if (stems.length > MAX_HER_STEMS) throw new VaseError(`at most ${MAX_HER_STEMS} stems`);
  const mine: HerVase = { stems: stems.map((s) => cleanPose(s)), updatedAt: now.toISOString() };
  save({ ...load(), mine });
  return mine;
}
export const herVase = () => load().mine ?? null;

/** Keep how the user has shaped the vase. */
export function saveVaseStyle(input: unknown): VaseStyle {
  const style = cleanStyle(input);
  save({ ...load(), style });
  return style;
}
export const vaseStyle = () => load().style ?? null;

// ---- in words, for a model ------------------------------------------------------------------------------------

const EN: Record<FlowerKind, string> = {
  rose: 'rose', peony: 'peony', tulip: 'tulip', lily: 'lily', calla: 'calla lily', daisy: 'daisy', hydrangea: 'hydrangea',
  blossom: 'cherry blossom branch', 'babys-breath': "baby's breath", lavender: 'lavender', eucalyptus: 'eucalyptus',
  lotus: 'lotus', 'lotus-leaf': 'lotus leaf', 'withered-lotus': 'withered lotus', 'pear-blossom': 'pear blossom branch',
};

/** How a bouquet reads: "3 white rose (白玫瑰), 2 baby's breath (满天星)". */
export const describeStems = (stems: BouquetStem[]) =>
  stems.map((s) => `${s.count} ${flowerSpec(s.kind).colors.length > 1 ? `${s.color} ` : ''}${EN[s.kind]} (${flowerSpec(s.kind).name})`).join(', ');

/** Every flower, its colours and what it is like - for a model choosing. */
export const catalogText = () => FLOWERS.map((f) => `${f.kind}: ${EN[f.kind]} / ${f.name} - ${f.hint}; colours ${f.colors.join('/')}`).join('\n');

/** A few lines an agent can put in its context each turn: today's bouquet (or that there is none yet), and whether
 * the user arranged a vase of her own today. */
export function vasePrompt(now = new Date()): string {
  const today = bouquetOn(dayKey(now));
  const mine = herVase();
  const hers = mine?.stems.length && dayKey(new Date(mine.updatedAt)) === dayKey(now)
    ? `\nThe user also arranged a vase of her own today: ${describeStems(countStems(mine.stems))}.` : '';
  return today
    ? `<vase>\nToday's bouquet in the vase is yours: ${describeStems(today.stems)} ("${today.note}"). You may arrange it again.${hers}\n</vase>`
    : `<vase>\nNo flowers in the vase yet today. Once a day you can choose a bouquet for the user and write a line to go with it.${hers}\n</vase>`;
}

const countStems = (stems: PosedStem[]) => {
  const m = new Map<string, BouquetStem>();
  for (const s of stems) { const k = `${s.kind}:${s.color}`; const p = m.get(k); m.set(k, { kind: s.kind, color: s.color, count: (p?.count ?? 0) + 1 }); }
  return [...m.values()];
};

/** The arrange tool's description, shared by the MCP server and the HTTP API docs. */
export const ARRANGE_HELP =
  `Put today's bouquet in the vase for the user. stems: 1-6 kinds, count 1-7 each, at most ${MAX_STEMS} stems in all; ` +
  'color defaults to the kind\'s first colour. note: a line to go with the flowers (required, up to 140 characters); ' +
  'title: optional little name for the bouquet. Arranging again the same day replaces the earlier bouquet. Each kind may ' +
  'also carry a shape (all optional, 1 is natural): bend 0-2.5, headSize 0.5-2, petalWidth 0.6-1.6, open 0.6-1.5 ' +
  '(low = round and closed, high = open and flat), leafSize 0.4-2.2, leafWidth 0.4-2.2, stemWidth 0.5-2.5.';

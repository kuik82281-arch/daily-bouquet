// The flowers the AI can choose from for the vase (server/store.ts checks its choices against this; flowers.ts draws
// them). Pure data, shared by the bridge and the page. Colours are named, the page turns them into petal colours.

export type FlowerKind =
  | 'rose' | 'peony' | 'tulip' | 'lily' | 'calla' | 'daisy' | 'hydrangea' | 'blossom' | 'babys-breath' | 'lavender' | 'eucalyptus'
  | 'lotus' | 'lotus-leaf' | 'withered-lotus' | 'pear-blossom';

export type FlowerColor =
  | 'red' | 'pink' | 'white' | 'champagne' | 'burgundy' | 'coral' | 'yellow' | 'purple' | 'blue' | 'green' | 'brown';

export type FlowerSpec = { kind: FlowerKind; name: string; colors: FlowerColor[]; role: 'focal' | 'filler' | 'line'; hint: string };

export const FLOWERS: FlowerSpec[] = [
  { kind: 'rose', name: '玫瑰', colors: ['red', 'pink', 'white', 'champagne', 'burgundy'], role: 'focal', hint: '层层卷起的花瓣，最经典的一束' },
  { kind: 'peony', name: '芍药', colors: ['pink', 'white', 'coral'], role: 'focal', hint: '大朵、蓬松，开得很满' },
  { kind: 'tulip', name: '郁金香', colors: ['pink', 'red', 'yellow', 'purple', 'white'], role: 'focal', hint: '杯形，干净利落' },
  { kind: 'lily', name: '百合', colors: ['white', 'pink'], role: 'focal', hint: '六瓣向外翻卷，有花蕊' },
  { kind: 'calla', name: '马蹄莲', colors: ['white', 'purple'], role: 'line', hint: '一片卷起的苞，线条修长' },
  { kind: 'daisy', name: '雏菊', colors: ['white'], role: 'focal', hint: '小小的白瓣黄心' },
  { kind: 'hydrangea', name: '绣球', colors: ['blue', 'pink', 'white'], role: 'focal', hint: '一大团小花攒成的球' },
  { kind: 'blossom', name: '樱花枝', colors: ['pink', 'white'], role: 'line', hint: '一枝斜出的小花，像瓶上浮雕的那种' },
  { kind: 'babys-breath', name: '满天星', colors: ['white', 'pink'], role: 'filler', hint: '细碎的小白点，填空用' },
  { kind: 'lavender', name: '薰衣草', colors: ['purple'], role: 'line', hint: '细长的紫色穗子' },
  { kind: 'eucalyptus', name: '尤加利叶', colors: ['green'], role: 'filler', hint: '圆圆的灰绿叶子' },
  { kind: 'lotus', name: '荷花', colors: ['pink', 'white'], role: 'focal', hint: '大朵的荷花，白底粉尖，中间一个嫩莲蓬' },
  { kind: 'lotus-leaf', name: '荷叶', colors: ['green'], role: 'filler', hint: '一张圆圆的大荷叶，边缘微微起伏' },
  { kind: 'pear-blossom', name: '梨花枝', colors: ['white'], role: 'line', hint: '细细的枝条蜿蜒伸展，一簇簇白花带紫红花蕊' },
  { kind: 'withered-lotus', name: '残荷', colors: ['brown'], role: 'line', hint: '低垂的干莲蓬配一片卷起的枯叶，秋天的样子' },
];

export const FLOWER_KINDS = FLOWERS.map((f) => f.kind) as [FlowerKind, ...FlowerKind[]];
export const COLOR_NAMES: Record<FlowerColor, string> = {
  red: '红', pink: '粉', white: '白', champagne: '香槟', burgundy: '酒红', coral: '珊瑚', yellow: '黄', purple: '紫', blue: '蓝', green: '绿', brown: '枯',
};
export const flowerSpec = (kind: FlowerKind) => FLOWERS.find((f) => f.kind === kind)!;

/** One kind of flower in a bouquet: how many stems, in which colour, and (optionally) how they are shaped. */
export type BouquetStem = { kind: FlowerKind; color: FlowerColor; count: number; shape?: StemShape };
/** A day's bouquet: what he put in the vase and what he said with it. */
export type Bouquet = { date: string; stems: BouquetStem[]; note: string; title?: string; createdAt: string };

export const MAX_STEMS = 15;

/** A stem she placed herself: which way it leans (az, radians round the vase), how far (tilt), how long, and a seed
 * so it keeps its shape while she turns it. */
export type PosedStem = { kind: FlowerKind; color: FlowerColor; az: number; tilt: number; len: number; seed: number } & StemShape;
/** How she has shaped one stem by hand (each optional; 1 / the middle is the natural shape): how much it bows, how
 * open or round the head is, how big the flowers are and how plump or slender their petals, how thick the stem, and where its leaves sit, how big and how broad they are. */
export type StemShape = { bend?: number; open?: number; headSize?: number; petalWidth?: number; stemWidth?: number; leafPos?: number; leafSize?: number; leafWidth?: number };
export const STEM_LIMITS: Record<keyof StemShape, [number, number]> = {
  bend: [0, 2.5], open: [0.6, 1.5], headSize: [0.5, 2], petalWidth: [0.6, 1.6], stemWidth: [0.5, 2.5], leafPos: [0.15, 0.9], leafSize: [0.4, 2.2], leafWidth: [0.4, 2.2],
};
/** The vase she arranges herself (one, kept until she changes it). */
export type HerVase = { stems: PosedStem[]; updatedAt: string };
export const MAX_HER_STEMS = 1000;
export const POSE_LIMITS = { tilt: [0, 1.4], len: [0.6, 2.8] } as const;

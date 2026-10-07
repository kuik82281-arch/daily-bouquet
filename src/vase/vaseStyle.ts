// How her vase looks, as she shapes it (捏瓶子): its glaze and relief colours, the finish (gloss, satin, matte) and
// whether the glaze is crackled (冰裂纹), how full or slim the belly is and where it sits, the neck and the flare of
// the mouth, the windows cut through it (any number up to six, each its own shape, place, size and turn, with or
// without a carved spray reaching out), and the relief pieces she has placed round it. Pure data, shared by the bridge
// (server/store.ts keeps it, clamped) and the page (vaseScene.ts builds the vase from it).

export type Finish = 'gloss' | 'satin' | 'matte';
export type ReliefType = 'branch' | 'sprig' | 'flower' | 'petals' | 'ring' | 'scroll-medal' | 'lace-medal' | 'frame-medal' | 'lotus-medal' | 'ruyi-medal';
/** One relief piece: where round the vase (ang, radians, 0 = the front), how high, how big, which way it leans, and
 * how strongly it shows (1 = fully, lower fades it into the glaze). */
export type Relief = { id: string; type: ReliefType; ang: number; y: number; scale: number; flip: 1 | -1; opacity: number };
export type VaseShape = { height: number; belly: number; bellyY: number; neck: number; mouth: number };
export type WindowShape = 'begonia' | 'round' | 'plum' | 'diamond' | 'oval' | 'fan';
/** A window cut through the wall: its shape, where round the vase and how high, how big, how turned, whether a carved
 * spray reaches out of it, the colour of its rim (and of its pane), and how far it is filled in with a translucent pane
 * like 玲珑 porcelain (opacity 0 = an open hole). */
export type VaseWindow = {
  id: string; shape: WindowShape; ang: number; y: number; size: number; rot: number; spray: boolean; color?: string; opacity: number;
  /** the carved spray's flowers and branch, when not the relief colour and the glaze */
  sprayFlower?: string; sprayBranch?: string;
};
export type VaseStyle = {
  glaze: string; relief: string; finish: Finish; crackle: boolean;
  shape: VaseShape; windows: VaseWindow[]; reliefs: Relief[];
};

export const RELIEF_NAMES: Record<ReliefType, string> = {
  branch: '梅枝', sprig: '两朵小花', flower: '一朵大花', petals: '散落花瓣', ring: '弦纹',
  'scroll-medal': '卷草团花', 'lace-medal': '镂空团花', 'frame-medal': '圆框缠枝', 'lotus-medal': '荷塘圆框', 'ruyi-medal': '如意花',
};
export const FINISH_NAMES: Record<Finish, string> = { gloss: '亮面', satin: '光面', matte: '磨砂' };
export const SHAPE_LIMITS: Record<keyof VaseShape, [number, number]> = { height: [0.75, 1.35], belly: [0.7, 1.3], bellyY: [-0.3, 0.3], neck: [0.7, 1.5], mouth: [0.6, 1.5] };
export const RELIEF_LIMITS = { y: [0.15, 2.9], scale: [0.4, 2.2], opacity: [0.1, 1] } as const;
/** Where the ring round the neck sits. */
export const NECK_RING_Y = 2.4;
export const MAX_RELIEFS = 24;
export const WINDOW_NAMES: Record<WindowShape, string> = { begonia: '海棠', round: '圆形', plum: '梅花', diamond: '菱形', oval: '椭圆', fan: '扇面' };
/** The order the shader knows them by. */
export const WINDOW_SHAPES = Object.keys(WINDOW_NAMES) as WindowShape[];
export const WINDOW_LIMITS = { y: [0.45, 2.1], size: [0.18, 0.75], opacity: [0, 0.95] } as const;
export const MAX_WINDOWS = 6;
const DEFAULT_WINDOW: VaseWindow = { id: 'w1', shape: 'begonia', ang: 0, y: 1.22, size: 0.38, rot: 0, spray: true, opacity: 0 };

export const GLAZES: { name: string; color: string }[] = [
  { name: '粉蓝', color: '#b3c3d9' }, { name: '白瓷', color: '#f1eee7' }, { name: '月白', color: '#dfe7ec' }, { name: '天青', color: '#a9c4c4' },
  { name: '青瓷', color: '#b7c9a8' }, { name: '豆青', color: '#c9d3a8' }, { name: '胭脂', color: '#e3b7b4' }, { name: '黛蓝', color: '#41557a' },
  { name: '乌金', color: '#2b2622' },
];
export const RELIEF_COLORS: { name: string; color: string }[] = [
  { name: '奶白', color: '#f4ede3' }, { name: '雪白', color: '#fbfaf6' }, { name: '浅金', color: '#e2c98f' }, { name: '浅粉', color: '#f1d3d3' }, { name: '青灰', color: '#9aa6b2' },
];

export const DEFAULT_STYLE: VaseStyle = {
  glaze: '#b3c3d9', relief: '#f4ede3', finish: 'matte', crackle: false,
  shape: { height: 1, belly: 1, bellyY: 0, neck: 1, mouth: 1 },
  windows: [DEFAULT_WINDOW],
  reliefs: [
    { id: 'b2', type: 'branch', ang: -1.25, y: 0.58, scale: 1, flip: -1, opacity: 1 },
    { id: 'b3', type: 'branch', ang: Math.PI, y: 0.62, scale: 1, flip: 1, opacity: 1 },
    { id: 's1', type: 'sprig', ang: -0.82, y: 0.8, scale: 1, flip: 1, opacity: 1 },
    { id: 'p1', type: 'petals', ang: 1.0, y: 1.3, scale: 1, flip: 1, opacity: 1 },
    { id: 'r1', type: 'ring', ang: 0, y: 2.4, scale: 1, flip: 1, opacity: 1 },
  ],
};

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const TYPES = Object.keys(RELIEF_NAMES) as ReliefType[];
/** An angle in (-π, π]. */
const wrapAngle = (v: unknown) => { const a = Number(v); return Number.isFinite(a) ? ((a % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI : 0; };

/** A style made safe: unknown values fall back to the default, numbers kept in range. */
export function cleanStyle(input: unknown): VaseStyle {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<VaseStyle>;
  const shape = (s.shape && typeof s.shape === 'object' ? s.shape : {}) as Partial<VaseShape>;
  const reliefs = Array.isArray(s.reliefs) ? s.reliefs : DEFAULT_STYLE.reliefs;
  // (an older style had one window, on or off)
  const windows = Array.isArray(s.windows) ? s.windows : (s as { window?: boolean }).window === false ? [] : [DEFAULT_WINDOW];
  return {
    glaze: typeof s.glaze === 'string' && HEX.test(s.glaze) ? s.glaze.toLowerCase() : DEFAULT_STYLE.glaze,
    relief: typeof s.relief === 'string' && HEX.test(s.relief) ? s.relief.toLowerCase() : DEFAULT_STYLE.relief,
    finish: s.finish === 'gloss' || s.finish === 'satin' || s.finish === 'matte' ? s.finish : DEFAULT_STYLE.finish,
    crackle: s.crackle === true,
    shape: {
      height: num(shape.height, SHAPE_LIMITS.height, 1), belly: num(shape.belly, SHAPE_LIMITS.belly, 1), bellyY: num(shape.bellyY, SHAPE_LIMITS.bellyY, 0),
      neck: num(shape.neck, SHAPE_LIMITS.neck, 1), mouth: num(shape.mouth, SHAPE_LIMITS.mouth, 1),
    },
    windows: windows.slice(0, MAX_WINDOWS).filter((w) => w && WINDOW_SHAPES.includes(w.shape)).map((w, i) => ({
      id: typeof w.id === 'string' && /^[\w-]{1,24}$/.test(w.id) ? w.id : `w${i}`,
      shape: w.shape,
      ang: wrapAngle(w.ang),
      y: num(w.y, WINDOW_LIMITS.y, 1.22),
      size: num(w.size, WINDOW_LIMITS.size, 0.38),
      rot: wrapAngle(w.rot),
      spray: w.spray === true,
      ...(typeof w.color === 'string' && HEX.test(w.color) ? { color: w.color.toLowerCase() } : {}),
      ...(typeof w.sprayFlower === 'string' && HEX.test(w.sprayFlower) ? { sprayFlower: w.sprayFlower.toLowerCase() } : {}),
      ...(typeof w.sprayBranch === 'string' && HEX.test(w.sprayBranch) ? { sprayBranch: w.sprayBranch.toLowerCase() } : {}),
      opacity: num(w.opacity, WINDOW_LIMITS.opacity, 0),
    })),
    reliefs: reliefs.slice(0, MAX_RELIEFS).filter((r) => r && TYPES.includes(r.type)).map((r, i) => {
      return {
        id: typeof r.id === 'string' && /^[\w-]{1,24}$/.test(r.id) ? r.id : `r${i}`,
        type: r.type,
        ang: wrapAngle(r.ang),
        y: num(r.y, RELIEF_LIMITS.y, 1),
        scale: num(r.scale, RELIEF_LIMITS.scale, 1),
        flip: r.flip === -1 ? -1 : 1,
        opacity: num(r.opacity, RELIEF_LIMITS.opacity, 1),
      };
    }),
  };
}

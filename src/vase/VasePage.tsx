import { useEffect, useMemo, useRef, useState } from 'react';
import { COLOR_NAMES, FLOWERS, POSE_LIMITS, STEM_LIMITS, flowerSpec, type Bouquet, type BouquetStem, type FlowerKind, type HerVase, type PosedStem, type StemShape } from './flowerCatalog';
import { PALETTE } from './flowers';
import type { VaseScene } from './vaseScene';
import VaseShaper from './VaseShaper';
import { DEFAULT_STYLE, RELIEF_LIMITS, WINDOW_LIMITS, cleanStyle, type VaseStyle } from './vaseStyle';
import './vase.css';

// 花瓶 / A Daily Bouquet: the bouquet the AI put in the porcelain vase (through the API or the MCP tool,
// server/store.ts), turning slowly on black, with what it wrote beside it; the days before are kept to look back on. 我来插 is her own vase: she drops in as many
// of the flowers as she likes, taps one to choose it, and turns, tilts and lengthens it with sliders; she can also bow
// a stem, open or round its head, thicken it, and move, size and broaden its leaves; 插好了 keeps it (it is the user's;
// the AI is not told). A tap on the vase lets a few petals fall; pinch, the wheel or ＋/－ bring it nearer. 捏瓶子 (VaseShaper)
// shapes the vase itself: glaze, finish, crackle, belly / neck / mouth, window and relief pieces, kept with 存下瓶子
// and shown under his flowers too. 花谱 shows every flower at once.
// Classes carry the vs- prefix.

type VaseData = { today: Bouquet | null; history: Bouquet[]; mine?: HerVase | null; style?: VaseStyle | null };

/** Which hand-shaping sliders make sense for a kind. */
const HEADED: FlowerKind[] = ['rose', 'peony', 'tulip', 'lily', 'lotus', 'daisy'];
const LEAFY: FlowerKind[] = ['rose', 'peony', 'tulip', 'lily', 'daisy'];
const PLAIN_STEM = (k: FlowerKind) => !['blossom', 'pear-blossom', 'babys-breath', 'lavender', 'eucalyptus'].includes(k);
const SIZED: FlowerKind[] = [...HEADED, 'hydrangea', 'calla', 'pear-blossom', 'lotus-leaf', 'withered-lotus'];
const PLUMP: FlowerKind[] = [...HEADED, 'pear-blossom'];
const SHAPE_SLIDERS: [keyof StemShape, string, (k: FlowerKind) => boolean][] = [
  ['bend', '弯曲', () => true], ['headSize', '花朵大小', (k) => SIZED.includes(k)], ['petalWidth', '花瓣胖瘦', (k) => PLUMP.includes(k)], ['open', '花瓣圆扁', (k) => HEADED.includes(k)], ['stemWidth', '茎粗细', PLAIN_STEM],
  ['leafPos', '叶子位置', (k) => LEAFY.includes(k)], ['leafSize', '叶子大小', (k) => LEAFY.includes(k) || k === 'eucalyptus'],
  ['leafWidth', '叶子宽窄', (k) => LEAFY.includes(k) || k === 'eucalyptus'],
];
const SHAPE_DEFAULT: Record<keyof StemShape, number> = { bend: 1, open: 1, headSize: 1, petalWidth: 1, stemWidth: 1, leafPos: 0.48, leafSize: 1, leafWidth: 1 };

const dayLabel = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${m}月${d}日`; };
const nameOf = (kind: FlowerKind, color: BouquetStem['color']) => `${flowerSpec(kind).colors.length > 1 ? COLOR_NAMES[color] : ''}${flowerSpec(kind).name}`;
const CATALOG: BouquetStem[] = FLOWERS.map((f) => ({ kind: f.kind, color: f.colors[0], count: 1 }));
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const DEG = 180 / Math.PI;

export default function VasePage({ onBack }: { onBack?: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VaseScene | null>(null);
  const sceneMod = useRef<typeof import('./vaseScene') | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<VaseData | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [catalog, setCatalog] = useState(false);
  const [mode, setMode] = useState<'his' | 'mine' | 'vase'>('his');
  const [style, setStyle] = useState<VaseStyle>(DEFAULT_STYLE);
  const [styleDirty, setStyleDirty] = useState(false);
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleNote, setStyleNote] = useState('');
  const [relief, setRelief] = useState<string | null>(null);
  const styleTimer = useRef(0);
  const [mine, setMine] = useState<PosedStem[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState('');
  // the vase as a picture: on a phone the share sheet offers 存储图像 (to the photo album); elsewhere it downloads
  const saveImage = async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    try {
      const blob = await scene.snapshot('A Daily Bouquet');
      const d = new Date();
      const file = new File([blob], `bouquet-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); setSaved('选「存储图像」就能存进相册'); }
        catch (error) { if ((error as Error).name !== 'AbortError') throw error; return; }
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = file.name;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        setSaved('图片已保存');
      }
    } catch {
      setSaved('没存上，再试一次');
    }
    window.setTimeout(() => setSaved(''), 2600);
  };
  const mineRef = useRef(mine);
  mineRef.current = mine;

  useEffect(() => {
    let alive = true;
    void import('./vaseScene').then((mod) => {
      if (!alive || !hostRef.current) return;
      sceneMod.current = mod;
      sceneRef.current = new mod.VaseScene(hostRef.current);
      setReady(true);
    });
    return () => { alive = false; sceneRef.current?.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/vase').then((r) => (r.ok ? r.json() : null)).then((d: VaseData | null) => { if (alive && d) setData(d); }).catch(() => {});
    void load();
    const timer = window.setInterval(load, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  const shown: Bouquet | null = useMemo(() => {
    if (!data) return null;
    if (picked) return data.history.find((b) => b.date === picked) ?? null;
    return data.today;
  }, [data, picked]);

  useEffect(() => {
    if (!ready || !data || styleDirty) return;
    const kept = cleanStyle(data.style ?? DEFAULT_STYLE);
    setStyle(kept);
    sceneRef.current?.setStyle(kept);
  }, [ready, data, styleDirty]);
  useEffect(() => () => window.clearTimeout(styleTimer.current), []);

  const shape = (next: VaseStyle) => {
    setStyle(next); setStyleDirty(true); setStyleNote('');
    window.clearTimeout(styleTimer.current);
    styleTimer.current = window.setTimeout(() => sceneRef.current?.setStyle(next), 220);
  };
  const pickRelief = (id: string | null) => setRelief(id);
  // the camera turns to the relief she has chosen, and follows it as she moves it round
  // the camera turns to the piece she has just chosen (once: it does not follow it, so she sees it move)
  const styleRef = useRef(style);
  styleRef.current = style;
  useEffect(() => {
    const s = styleRef.current;
    const ang = s.reliefs.find((x) => x.id === relief && x.type !== 'ring')?.ang ?? s.windows.find((w) => w.id === relief)?.ang;
    if (ang !== undefined) sceneRef.current?.faceAngle(ang);
  }, [relief]);
  // the little white dot sits on the relief or window she has chosen, wherever it goes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || mode === 'mine') return;
    const r = mode === 'vase' && !catalog ? style.reliefs.find((x) => x.id === relief) : undefined;
    const w = mode === 'vase' && !catalog ? style.windows.find((x) => x.id === relief) : undefined;
    if (r) scene.markSurface(r.type === 'ring' ? scene.viewAngle() : r.ang, r.y);
    else if (w) scene.markSurface(w.ang, w.y);
    else scene.setMarker(null);
  }, [mode, catalog, relief, style, ready]);
  // with a piece chosen, a tap on the vase puts it there
  useEffect(() => {
    const el = hostRef.current;
    if (!el || mode !== 'vase' || catalog || !relief) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      const tap = start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6;
      start = null;
      if (!tap) return;
      const at = sceneRef.current?.pickSurface(e.clientX, e.clientY);
      if (!at) return;
      const s = styleRef.current;
      const clampY = (y: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, y));
      if (s.reliefs.some((r) => r.id === relief)) shape({ ...s, reliefs: s.reliefs.map((r) => (r.id === relief ? { ...r, ang: r.type === 'ring' ? r.ang : at.ang, y: clampY(at.y, RELIEF_LIMITS.y) } : r)) });
      else if (s.windows.some((w) => w.id === relief)) shape({ ...s, windows: s.windows.map((w) => (w.id === relief ? { ...w, ang: at.ang, y: clampY(at.y, WINDOW_LIMITS.y) } : w)) });
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); };
  }, [mode, catalog, relief]);
  const saveStyle = async () => {
    setStyleSaving(true);
    try {
      const r = await fetch('/api/vase/style', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(style) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? '没存上');
      setData((d) => (d ? { ...d, style: body.style } : d));
      setStyleDirty(false); setStyleNote('存好啦');
    } catch (error) {
      setStyleNote(error instanceof Error ? error.message : '没存上，再试一次');
    } finally { setStyleSaving(false); }
  };
  const resetStyle = () => { shape(cleanStyle(DEFAULT_STYLE)); setRelief(null); };

  // his bouquet (or the herbarium); her own vase is driven by the editor below; shaping the vase keeps whatever stands in it
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    scene.setAutoRotate(catalog || mode === 'his');
    if (catalog) scene.setBouquet(CATALOG, 'catalog');
    else if (mode === 'his') scene.setBouquet(shown?.stems ?? [], shown ? `${shown.date}:${shown.createdAt}` : 'empty');
    else if (mode === 'mine') { scene.setPoses(mineRef.current); setSelected(null); }
  }, [ready, shown, catalog, mode]);

  // her vase as she last kept it (or, if she left it unsaved, as she left it)
  const openMine = () => {
    if (!dirty) { const stems = data?.mine?.stems ?? []; mineRef.current = stems; setMine(stems); }
    setMode('mine'); setSelected(null); setNote('');
  };
  const choose = (i: number | null) => { setSelected(i); sceneRef.current?.select(i); };
  const add = (kind: FlowerKind) => {
    if (!sceneMod.current || !sceneRef.current) return;
    const pose = sceneMod.current.defaultPose(kind, flowerSpec(kind).colors[0], Math.random);
    const i = sceneRef.current.addPose(pose);
    setMine((m) => [...m, pose]); setDirty(true); setNote('');
    choose(i);
  };
  const change = (patch: Partial<PosedStem>) => {
    if (selected === null) return;
    const pose = { ...mine[selected], ...patch };
    sceneRef.current?.updatePose(selected, pose);
    setMine((m) => m.map((p, k) => (k === selected ? pose : p))); setDirty(true); setNote('');
  };
  const remove = () => {
    if (selected === null) return;
    sceneRef.current?.removePose(selected);
    setMine((m) => m.filter((_, k) => k !== selected)); setSelected(null); setDirty(true); setNote('');
  };
  const clear = () => { sceneRef.current?.setPoses([]); mineRef.current = []; setMine([]); setSelected(null); setDirty(true); setNote(''); };
  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch('/api/vase/mine', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stems: mine }) });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(body?.error ?? '没存上');
      setData((d) => (d ? { ...d, mine: body.mine } : d));
      setDirty(false); setNote('插好啦。点一下花瓶，花瓣会落下来。');
    } catch (error) {
      setNote(error instanceof Error ? error.message : '没存上，再试一次');
    } finally { setSaving(false); }
  };

  // a tap (not a drag): on a flower in her own vase it chooses that flower; on the vase itself (his or hers) a few
  // petals let go and drift down to the table
  useEffect(() => {
    const el = hostRef.current;
    if (!el || mode === 'vase' || catalog) return;
    let start: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { start = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      const scene = sceneRef.current;
      if (scene && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) {
        const i = mode === 'mine' ? scene.pick(e.clientX, e.clientY) : null;
        if (i !== null) { setSelected(i); scene.select(i); }
        else if (scene.onVase(e.clientX, e.clientY)) scene.shedPetals();
        else if (mode === 'mine') { setSelected(null); scene.select(null); }
      }
      start = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointerup', up); };
  }, [mode, catalog]);

  // nearer or further: two fingers pinching, the mouse wheel, or the ＋ / － buttons
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const fingers = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const gap = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const down = (e: PointerEvent) => { fingers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (fingers.size === 2) spread = gap(); };
    const move = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size === 2 && spread > 0) { const now = gap(); sceneRef.current?.zoomBy(spread / now); spread = now; }
    };
    const up = (e: PointerEvent) => { fingers.delete(e.pointerId); spread = 0; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); sceneRef.current?.zoomBy(Math.exp(e.deltaY * 0.0015)); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('wheel', wheel);
    };
  }, []);

  const isToday = !picked || picked === todayKey();
  const current = selected !== null ? mine[selected] : null;

  return (
    <div className="vs-page">
      <div className="vs-glow" aria-hidden="true" />
      <div ref={hostRef} className="vs-stage" />
      <div className="vs-zoom" aria-label="远近">
        <button type="button" className="vs-icon" onClick={() => sceneRef.current?.zoomBy(0.8)} aria-label="拉近">＋</button>
        <button type="button" className="vs-icon" onClick={() => sceneRef.current?.zoomBy(1.25)} aria-label="拉远">－</button>
      </div>
      <header className="vs-top">
        {onBack ? (
          <button type="button" className="vs-icon" onClick={onBack} aria-label="返回">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        ) : <span className="vs-icon vs-icon--blank" aria-hidden="true" />}
        <div className="vs-heading">
          <small>{catalog ? 'Herbarium' : mode === 'mine' ? 'My Own Vase' : mode === 'vase' ? 'Shape the Vase' : 'A Daily Bouquet'}</small>
          <b>{catalog ? '花谱' : mode === 'mine' ? '我来插' : mode === 'vase' ? '捏瓶子' : shown ? dayLabel(shown.date) : isToday ? '今天' : dayLabel(picked!)}</b>
        </div>
        <div className="vs-top-right">
          <button type="button" className="vs-icon" onClick={() => void saveImage()} aria-label="把花瓶存成图片" title="存成图片">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z" /><circle cx="12" cy="13.2" r="3.4" /></svg>
          </button>
          <button type="button" className={`vs-pill${catalog ? ' is-on' : ''}`} onClick={() => setCatalog((c) => !c)}>{catalog ? '回到花瓶' : '花谱'}</button>
        </div>
        {saved && <p className="vs-toast" role="status">{saved}</p>}
      </header>

      <section className="vs-card" aria-live="polite">
        {!catalog && (
          <div className="vs-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'his'} className={mode === 'his' ? 'is-on' : ''} onClick={() => { setMode('his'); choose(null); }}>AI 插的</button>
            <button type="button" role="tab" aria-selected={mode === 'mine'} className={mode === 'mine' ? 'is-on' : ''} onClick={() => mode !== 'mine' && openMine()}>我来插</button>
            <button type="button" role="tab" aria-selected={mode === 'vase'} className={mode === 'vase' ? 'is-on' : ''} onClick={() => { setMode('vase'); choose(null); }}>捏瓶子</button>
          </div>
        )}
        {catalog ? (
          <>
            <p className="vs-lead">这些是能挑的花：AI 想送你花的时候从里面挑，你也可以自己插。</p>
            <ul className="vs-catalog">
              {FLOWERS.map((f) => (
                <li key={f.kind}>
                  <b>{f.name}</b>
                  <span className="vs-dots">{f.colors.map((c) => <i key={c} style={{ background: PALETTE[c] }} title={COLOR_NAMES[c]} />)}</span>
                  <small>{f.hint}</small>
                </li>
              ))}
            </ul>
          </>
        ) : mode === 'vase' ? (
          <VaseShaper style={style} onChange={shape} relief={relief} onRelief={pickRelief} viewAngle={() => sceneRef.current?.viewAngle() ?? 0} dirty={styleDirty} saving={styleSaving} note={styleNote} onSave={() => void saveStyle()} onReset={resetStyle} />
        ) : mode === 'mine' ? (
          <>
            <div className="vs-picker" aria-label="放一枝进去">
              {FLOWERS.map((f) => (
                <button type="button" key={f.kind} onClick={() => add(f.kind)}>
                  <i style={{ background: PALETTE[f.colors[0]] }} />{f.name}
                </button>
              ))}
            </div>
            {current ? (
              <div className="vs-editor">
                <div className="vs-ed-head">
                  <b>{nameOf(current.kind, current.color)}</b>
                  {flowerSpec(current.kind).colors.length > 1 && (
                    <span className="vs-dots vs-dots--pick">{flowerSpec(current.kind).colors.map((c) => (
                      <button type="button" key={c} className={c === current.color ? 'is-on' : ''} style={{ background: PALETTE[c] }} aria-label={COLOR_NAMES[c]} onClick={() => change({ color: c })} />
                    ))}</span>
                  )}
                  <button type="button" className="vs-ed-remove" onClick={remove}>拿掉</button>
                </div>
                <label>方向<input type="range" min={0} max={359} value={Math.round(current.az * DEG) % 360} onChange={(e) => change({ az: Number(e.target.value) / DEG })} /></label>
                <label>倾斜<input type="range" min={0} max={Math.round(POSE_LIMITS.tilt[1] * DEG)} value={Math.round(current.tilt * DEG)} onChange={(e) => change({ tilt: Number(e.target.value) / DEG })} /></label>
                <label>长短<input type="range" min={POSE_LIMITS.len[0] * 100} max={POSE_LIMITS.len[1] * 100} value={Math.round(current.len * 100)} onChange={(e) => change({ len: Number(e.target.value) / 100 })} /></label>
                {SHAPE_SLIDERS.filter(([, , fits]) => fits(current.kind)).map(([key, label]) => (
                  <label key={key}>{label}<input type="range" min={STEM_LIMITS[key][0] * 100} max={STEM_LIMITS[key][1] * 100} value={Math.round((current[key] ?? SHAPE_DEFAULT[key]) * 100)}
                    onChange={(e) => change({ [key]: Number(e.target.value) / 100 })} /></label>
                ))}
              </div>
            ) : (
              <p className="vs-hint">{mine.length ? '点瓶里的花选中它，就能转方向、调倾斜和长短；拖动空白处转花瓶。' : '点上面的花，放一枝进瓶里。'}</p>
            )}
            <div className="vs-actions">
              <span>{mine.length} 枝{note && ` · ${note}`}</span>
              <button type="button" onClick={clear} disabled={!mine.length || saving}>清空</button>
              <button type="button" className="vs-save" onClick={() => void save()} disabled={!dirty || saving}>{saving ? '…' : '插好了'}</button>
            </div>
          </>
        ) : shown ? (
          <>
            {shown.title && <p className="vs-title">「{shown.title}」</p>}
            <p className="vs-note">{shown.note}</p>
            <p className="vs-sign">— AI · {dayLabel(shown.date)}</p>
            <p className="vs-stems">{shown.stems.map((s) => (
              <span key={`${s.kind}:${s.color}`}><i style={{ background: PALETTE[s.color] }} />{nameOf(s.kind, s.color)} × {s.count}</span>
            ))}</p>
          </>
        ) : (
          <p className="vs-empty">{data ? (isToday ? '今天的花 AI 还没插。等它找个时候，会插好放在这里。' : '这天没有花。') : '…'}</p>
        )}
        {!catalog && mode === 'his' && data && data.history.length > 0 && (
          <nav className="vs-days" aria-label="以前的花">
            {data.history.map((b) => {
              const active = (shown?.date ?? null) === b.date;
              return (
                <button type="button" key={b.date} className={active ? 'is-on' : ''} onClick={() => setPicked(b.date === todayKey() ? null : b.date)}>
                  <i style={{ background: PALETTE[b.stems[0].color] }} />{dayLabel(b.date)}
                </button>
              );
            })}
          </nav>
        )}
      </section>
    </div>
  );
}

import {
  FINISH_NAMES, GLAZES, MAX_RELIEFS, MAX_WINDOWS, NECK_RING_Y, RELIEF_COLORS, RELIEF_LIMITS, RELIEF_NAMES, SHAPE_LIMITS, WINDOW_LIMITS, WINDOW_NAMES, WINDOW_SHAPES,
  type Finish, type Relief, type ReliefType, type VaseShape, type VaseStyle, type VaseWindow,
} from './vaseStyle';

// 捏瓶子: her own hand on the vase - glaze and relief colours (presets or any colour), the finish (亮面 / 光面 /
// 磨砂) and crackle, the belly / neck / mouth, the windows cut through it (add one of six shapes, choose one to move it
// round and up, size it, turn it, give it a carved spray, or fill it in), and the relief pieces (add one, choose one to
// move it round the vase, up or down, make it bigger or smaller, turn it the other way, or take it off). `relief` is
// whichever window or relief piece she has chosen. Classes carry the vs- prefix.

const DEG = 180 / Math.PI;
const SHAPE_LABELS: [keyof VaseShape, string, number][] = [['height', '瓶子高矮', 100], ['belly', '瓶肚胖瘦', 100], ['bellyY', '瓶肚高低', 100], ['neck', '瓶颈粗细', 100], ['mouth', '瓶口外撇', 100]];

export default function VaseShaper({ style, onChange, relief, onRelief, viewAngle, dirty, saving, note, onSave, onReset }: {
  style: VaseStyle;
  onChange: (style: VaseStyle) => void;
  relief: string | null;
  onRelief: (id: string | null) => void;
  /** the side of the vase she is looking at: new pieces go there */
  viewAngle: () => number;
  dirty: boolean; saving: boolean; note: string;
  onSave: () => void; onReset: () => void;
}) {
  const set = (patch: Partial<VaseStyle>) => onChange({ ...style, ...patch });
  const current = style.reliefs.find((r) => r.id === relief) ?? null;
  const win = style.windows.find((w) => w.id === relief) ?? null;
  const setWin = (patch: Partial<VaseWindow>) => win && set({ windows: style.windows.map((w) => (w.id === win.id ? { ...w, ...patch } : w)) });
  const addWin = (shape: VaseWindow['shape']) => {
    if (style.windows.length >= MAX_WINDOWS) return;
    const w: VaseWindow = { id: `w${Date.now().toString(36)}`, shape, ang: viewAngle(), y: 1.2, size: shape === 'fan' ? 0.3 : 0.36, rot: 0, spray: false, opacity: 0 };
    set({ windows: [...style.windows, w] });
    onRelief(w.id);
  };
  const removeWin = () => { if (win) { set({ windows: style.windows.filter((w) => w.id !== win.id) }); onRelief(null); } };
  const setRelief = (patch: Partial<Relief>) => current && set({ reliefs: style.reliefs.map((r) => (r.id === current.id ? { ...r, ...patch } : r)) });
  const add = (type: ReliefType) => {
    if (style.reliefs.length >= MAX_RELIEFS) return;
    const r: Relief = { id: `r${Date.now().toString(36)}`, type, ang: type === 'ring' ? 0 : viewAngle(), y: type === 'ring' ? 1.7 : 0.9, scale: 1, flip: 1, opacity: 1 };
    set({ reliefs: [...style.reliefs, r] });
    onRelief(r.id);
  };
  // the ring round the neck, on or off
  const neckRing = style.reliefs.find((r) => r.type === 'ring' && Math.abs(r.y - NECK_RING_Y) < 0.15);
  const toggleNeckRing = (on: boolean) => {
    if (!on && neckRing) { set({ reliefs: style.reliefs.filter((r) => r !== neckRing) }); if (relief === neckRing.id) onRelief(null); }
    if (on && !neckRing && style.reliefs.length < MAX_RELIEFS) set({ reliefs: [...style.reliefs, { id: `r${Date.now().toString(36)}`, type: 'ring', ang: 0, y: NECK_RING_Y, scale: 1, flip: 1, opacity: 1 }] });
  };
  const remove = () => { if (current) { set({ reliefs: style.reliefs.filter((r) => r.id !== current.id) }); onRelief(null); } };

  return (
    <div className="vs-shaper">
      <h3>釉色</h3>
      <div className="vs-swatches">
        {GLAZES.map((g) => <button type="button" key={g.color} className={style.glaze === g.color ? 'is-on' : ''} style={{ background: g.color }} title={g.name} aria-label={g.name} onClick={() => set({ glaze: g.color })} />)}
        <label className="vs-swatch-any" title="任意颜色"><input type="color" value={style.glaze} onChange={(e) => set({ glaze: e.target.value })} />自选</label>
      </div>
      <h3>浮雕颜色</h3>
      <div className="vs-swatches">
        {RELIEF_COLORS.map((g) => <button type="button" key={g.color} className={style.relief === g.color ? 'is-on' : ''} style={{ background: g.color }} title={g.name} aria-label={g.name} onClick={() => set({ relief: g.color })} />)}
        <button type="button" className={style.relief === style.glaze ? 'is-on' : ''} style={{ background: style.glaze }} title="和釉同色" aria-label="和釉同色" onClick={() => set({ relief: style.glaze })} />
        <label className="vs-swatch-any" title="任意颜色"><input type="color" value={style.relief} onChange={(e) => set({ relief: e.target.value })} />自选</label>
      </div>
      <h3>质感</h3>
      <div className="vs-seg">
        {(Object.keys(FINISH_NAMES) as Finish[]).map((f) => <button type="button" key={f} className={style.finish === f ? 'is-on' : ''} onClick={() => set({ finish: f })}>{FINISH_NAMES[f]}</button>)}
        <button type="button" className={style.crackle ? 'is-on' : ''} onClick={() => set({ crackle: !style.crackle })}>冰裂纹</button>
      </div>
      <h3>瓶形</h3>
      <div className="vs-sliders">
        {SHAPE_LABELS.map(([key, label, k]) => (
          <label key={key}>{label}<input type="range" min={SHAPE_LIMITS[key][0] * k} max={SHAPE_LIMITS[key][1] * k} value={Math.round(style.shape[key] * k)}
            onChange={(e) => set({ shape: { ...style.shape, [key]: Number(e.target.value) / k } })} /></label>
        ))}
      </div>
      <h3>镂空 <small>选中一个，点瓶身就挪过去</small></h3>
      <div className="vs-chips">
        {style.windows.map((w, i) => (
          <button type="button" key={w.id} className={w.id === relief ? 'is-on' : ''} onClick={() => onRelief(w.id === relief ? null : w.id)}>{WINDOW_NAMES[w.shape]}{style.windows.filter((x) => x.shape === w.shape).length > 1 ? ` ${style.windows.slice(0, i + 1).filter((x) => x.shape === w.shape).length}` : ''}</button>
        ))}
        {!style.windows.length && <small className="vs-none">现在没有镂空</small>}
      </div>
      <div className="vs-chips vs-chips--add">
        {WINDOW_SHAPES.map((s) => <button type="button" key={s} onClick={() => addWin(s)} disabled={style.windows.length >= MAX_WINDOWS}>＋{WINDOW_NAMES[s]}</button>)}
      </div>
      {win && (
        <div className="vs-sliders vs-relief-ed">
          <label>位置<input type="range" min={-180} max={180} value={Math.round(win.ang * DEG)} onChange={(e) => setWin({ ang: Number(e.target.value) / DEG })} /></label>
          <label>高低<input type="range" min={WINDOW_LIMITS.y[0] * 100} max={WINDOW_LIMITS.y[1] * 100} value={Math.round(win.y * 100)} onChange={(e) => setWin({ y: Number(e.target.value) / 100 })} /></label>
          <label>大小<input type="range" min={WINDOW_LIMITS.size[0] * 100} max={WINDOW_LIMITS.size[1] * 100} value={Math.round(win.size * 100)} onChange={(e) => setWin({ size: Number(e.target.value) / 100 })} /></label>
          <label>转向<input type="range" min={-180} max={180} value={Math.round(win.rot * DEG)} onChange={(e) => setWin({ rot: Number(e.target.value) / DEG })} /></label>
          <label>透明度<input type="range" min={Math.round((1 - WINDOW_LIMITS.opacity[1]) * 100)} max={100} value={Math.round((1 - win.opacity) * 100)} onChange={(e) => setWin({ opacity: 1 - Number(e.target.value) / 100 })} /></label>
          <div className="vs-win-color">
            <span>颜色</span>
            <button type="button" className={!win.color ? 'is-on' : ''} style={{ background: style.glaze }} title="和瓶身同色" aria-label="和瓶身同色" onClick={() => setWin({ color: undefined })} />
            {RELIEF_COLORS.map((c) => <button type="button" key={c.color} className={win.color === c.color ? 'is-on' : ''} style={{ background: c.color }} title={c.name} aria-label={c.name} onClick={() => setWin({ color: c.color })} />)}
            <label className="vs-swatch-any" title="任意颜色"><input type="color" value={win.color ?? style.glaze} onChange={(e) => setWin({ color: e.target.value })} />自选</label>
          </div>
          <small className="vs-none">透明度 100 是镂空；往下拉，窗里会填上一层半透明的瓷，像玲珑瓷。颜色也会染到窗边那一圈。</small>
          <div className="vs-win-color">
            <span>雕花花枝</span>
            <button type="button" className={`vs-pick${win.spray ? ' is-on' : ''}`} onClick={() => setWin({ spray: true })}>有</button>
            <button type="button" className={`vs-pick${!win.spray ? ' is-on' : ''}`} onClick={() => setWin({ spray: false })}>去掉</button>
          </div>
          {win.spray && (
            <>
              <div className="vs-win-color">
                <span>花的颜色</span>
                <button type="button" className={!win.sprayFlower ? 'is-on' : ''} style={{ background: style.relief }} title="和浮雕同色" aria-label="和浮雕同色" onClick={() => setWin({ sprayFlower: undefined })} />
                {RELIEF_COLORS.map((c) => <button type="button" key={c.color} className={win.sprayFlower === c.color ? 'is-on' : ''} style={{ background: c.color }} title={c.name} aria-label={`花 ${c.name}`} onClick={() => setWin({ sprayFlower: c.color })} />)}
                <label className="vs-swatch-any" title="任意颜色"><input type="color" value={win.sprayFlower ?? style.relief} onChange={(e) => setWin({ sprayFlower: e.target.value })} />自选</label>
              </div>
              <div className="vs-win-color">
                <span>枝的颜色</span>
                <button type="button" className={!win.sprayBranch ? 'is-on' : ''} style={{ background: style.glaze }} title="和瓶身同色" aria-label="和瓶身同色" onClick={() => setWin({ sprayBranch: undefined })} />
                {[...RELIEF_COLORS, { name: '褐枝', color: '#6b5444' }].map((c) => <button type="button" key={c.color} className={win.sprayBranch === c.color ? 'is-on' : ''} style={{ background: c.color }} title={c.name} aria-label={`枝 ${c.name}`} onClick={() => setWin({ sprayBranch: c.color })} />)}
                <label className="vs-swatch-any" title="任意颜色"><input type="color" value={win.sprayBranch ?? style.glaze} onChange={(e) => setWin({ sprayBranch: e.target.value })} />自选</label>
              </div>
            </>
          )}
          <div className="vs-ed-row"><button type="button" className="vs-danger" onClick={removeWin}>删除这个镂空</button></div>
        </div>
      )}
      <h3>浮雕 <small>选中一个，点瓶身就挪过去；新加的会放在你正看着的那一面</small></h3>
      <label className="vs-check vs-neck"><input type="checkbox" checked={Boolean(neckRing)} onChange={(e) => toggleNeckRing(e.target.checked)} />瓶颈那一圈白线</label>
      <div className="vs-chips">
        {style.reliefs.map((r, i) => (
          <button type="button" key={r.id} className={r.id === relief ? 'is-on' : ''} onClick={() => onRelief(r.id === relief ? null : r.id)}>{RELIEF_NAMES[r.type]}{style.reliefs.filter((x) => x.type === r.type).length > 1 ? ` ${style.reliefs.slice(0, i + 1).filter((x) => x.type === r.type).length}` : ''}</button>
        ))}
      </div>
      <div className="vs-chips vs-chips--add">
        {(Object.keys(RELIEF_NAMES) as ReliefType[]).map((t) => <button type="button" key={t} onClick={() => add(t)} disabled={style.reliefs.length >= MAX_RELIEFS}>＋{RELIEF_NAMES[t]}</button>)}
      </div>
      {current && (
        <div className="vs-sliders vs-relief-ed">
          {current.type !== 'ring' && (
            <label>位置<input type="range" min={-180} max={180} value={Math.round(current.ang * DEG)} onChange={(e) => setRelief({ ang: Number(e.target.value) / DEG })} /></label>
          )}
          <label>高低<input type="range" min={RELIEF_LIMITS.y[0] * 100} max={RELIEF_LIMITS.y[1] * 100} value={Math.round(current.y * 100)} onChange={(e) => setRelief({ y: Number(e.target.value) / 100 })} /></label>
          <label>{current.type === 'ring' ? '粗细' : '大小'}<input type="range" min={RELIEF_LIMITS.scale[0] * 100} max={RELIEF_LIMITS.scale[1] * 100} value={Math.round(current.scale * 100)} onChange={(e) => setRelief({ scale: Number(e.target.value) / 100 })} /></label>
          <label>透明度<input type="range" min={0} max={Math.round((1 - RELIEF_LIMITS.opacity[0]) * 100)} value={Math.round((1 - current.opacity) * 100)} onChange={(e) => setRelief({ opacity: 1 - Number(e.target.value) / 100 })} /></label>
          <div className="vs-ed-row">
            {current.type !== 'ring' && current.type !== 'flower' && <button type="button" onClick={() => setRelief({ flip: current.flip === 1 ? -1 : 1 })}>翻个方向</button>}
            <button type="button" className="vs-danger" onClick={remove}>删除这个浮雕</button>
          </div>
        </div>
      )}
      <div className="vs-actions">
        <span>{note}</span>
        <button type="button" onClick={onReset} disabled={saving}>恢复原样</button>
        <button type="button" className="vs-save" onClick={onSave} disabled={!dirty || saving}>{saving ? '…' : '存下瓶子'}</button>
      </div>
    </div>
  );
}

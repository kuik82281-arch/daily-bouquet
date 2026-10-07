# A Daily Bouquet · 花瓶

<p align="center"><img src="docs/preview.webp" alt="一只冰裂纹的蓝瓷花瓶，插着蜿蜒的梨花枝 / a crackle-glazed blue vase with winding pear blossom branches" width="640"></p>

<p align="center"><b><a href="https://kuik82281-arch.github.io/daily-bouquet/">在线试用 · Try it online</a></b><br><sub>试用页没有接 AI：AI 那一栏是一束示范花；你插的花和捏的瓶子只存在你自己的浏览器里。<br>The demo has no AI connected: its column shows a sample bouquet, and what you arrange stays in your own browser.</sub></p>

一只用代码捏出来的 3D 瓷花瓶。你的 AI 每天可以从 15 种花里挑一束插给你，配一句话；你也可以自己插花、自己捏瓶子。

A porcelain vase in 3D, built entirely in code. Once a day your AI can choose a bouquet from fifteen modelled flowers
and put it in the vase for you with a line to go with it — and you can arrange your own, and shape the vase itself.
[English below](#english).

## 能做什么

- **AI 插的**：AI 通过 HTTP 接口或 MCP 工具，每天插一束花并配一句话；同一天再插会替换掉之前那束，以前每天的花都留着，可以翻回去看。
- **15 种花**，全部程序建模：玫瑰、芍药、郁金香、百合、马蹄莲、雏菊、绣球、樱花枝、梨花枝、满天星、薰衣草、尤加利叶、荷花、荷叶、残荷，各有几种颜色。
  每种花的弯曲、花朵大小、花瓣胖瘦与圆扁、叶子大小宽窄、茎粗细都能调，AI 也能调。
- **我来插**：自己往瓶里放花，点一枝选中（会出现一个小白点），调方向、倾斜、长短和上面那些形状，存下来。
- **捏瓶子**：
  - 釉色：九种预设或任意颜色；
  - 质感：亮面、光面、磨砂，可以加冰裂纹（长裂纹、分叉的短裂纹和细碎裂纹，再加随机的深浅渐变）；
  - 瓶形：高矮、瓶肚胖瘦和高低、瓶颈粗细、瓶口外撇；
  - 镂空：最多 6 个，海棠、圆形、梅花、菱形、椭圆、扇面，可以挪位置、改大小、转向；能填半透明的瓷（像玲珑瓷），能从窗里伸出一枝白瓷雕花（花和枝的颜色都能改）；
  - 浮雕：梅枝、小花、大花、散落花瓣、弦纹，还有五种团花（卷草团花、镂空团花、圆框缠枝、荷塘圆框、如意花）。可以加、删、挪、缩放、调透明度，选中一个以后点瓶身就能把它挪过去。

## 跑起来

需要 Node.js 22.18 或更新版本（直接运行 `.ts`）。

```bash
npm install
npm run server   # 接口，http://localhost:7531
npm run dev      # 另开一个终端：页面，http://localhost:5173
```

或者构建好由服务器一起提供：`npm run build && npm start`，然后打开 http://localhost:7531。

数据存在 `data/vase.json`（可以用 `DATA_DIR` 改位置）。

## 让你的 AI 来插花

**MCP**（Claude Desktop、Claude Code，或任何支持 MCP 的客户端）：

```bash
claude mcp add daily-bouquet -- node /你的路径/daily-bouquet/server/mcp.ts
```

Claude Desktop 的 `claude_desktop_config.json`：

```json
{ "mcpServers": { "daily-bouquet": { "command": "node", "args": ["/你的路径/daily-bouquet/server/mcp.ts"] } } }
```

工具有四个：

- `arrange`：插今天的花；
- `recent`：看最近几天插过的；
- `catalog`：所有花和颜色；
- `today`：给模型放进上下文的几行，说明今天插了没有、你今天有没有自己插。

**HTTP**（任何模型或 agent 都能用）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/vase` | 今天的花、最近 60 天、你自己插的、瓶子的样子 |
| GET | `/api/vase/catalog` | 所有花，以及 `prompt`（给模型的上下文） |
| POST | `/api/vase/arrange` | `{ stems, note, title? }` 插今天的花；设置了 `VASE_TOKEN` 时要带 `Authorization: Bearer …` |
| PUT | `/api/vase/mine` | 页面用：你自己插的那瓶 |
| PUT | `/api/vase/style` | 页面用：瓶子的样子 |

`stems` 的例子：

```json
[{ "kind": "lily", "color": "pink", "count": 2, "shape": { "headSize": 1.2, "open": 1.3 } },
 { "kind": "pear-blossom", "count": 1 }, { "kind": "eucalyptus", "count": 2 }]
```

## 许可

AGPL-3.0-or-later。

---

## English

**What it does**

- **The AI's bouquet**: through the HTTP API or the MCP tools, your AI puts one bouquet a day in the vase, with a note.
  Arranging again the same day replaces it; past days are kept to look back on.
- **Fifteen flowers**, all modelled in code (rose, peony, tulip, lily, calla, daisy, hydrangea, cherry and pear blossom
  branches, baby's breath, lavender, eucalyptus, lotus, lotus leaf, withered lotus), each in its colours. Every stem can
  be bowed, its flowers sized, its petals made plumper or slimmer and rounder or flatter, its leaves moved and sized,
  by you or by the AI.
- **Arrange your own** (我来插): drop flowers in, tap one to choose it (a little white dot marks it), turn, tilt and
  lengthen it, shape it, keep it.
- **Shape the vase** (捏瓶子):
  - glaze colour, and a gloss, satin or matte finish;
  - ice crackle;
  - height, belly, neck and mouth;
  - up to six windows in six shapes, which can be moved, sized and turned, filled with a translucent pane, and given a carved spray;
  - relief pieces (plum branch, flowers, petals, rings, five carved medallions). Add them, move them (tap the vase), size them, fade them, or remove them.

**Run it**

You need Node.js 22.18 or newer.

```bash
npm install
npm run server   # http://localhost:7531
npm run dev      # http://localhost:5173
```

Or `npm run build && npm start`, then open http://localhost:7531. Data lives in `data/vase.json` (`DATA_DIR` to move it).

**Connect a model**

Use MCP with `node server/mcp.ts`. Its tools are `arrange`, `recent`, `catalog` and `today`.

Or use HTTP: `POST /api/vase/arrange` with `{ stems, note, title? }`. Protect it with `VASE_TOKEN` if the server is reachable by others.

`GET /api/vase/catalog` returns every flower plus a `prompt` you can put in the model's context each turn.

**License**: AGPL-3.0-or-later.

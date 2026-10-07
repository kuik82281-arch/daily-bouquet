// Daily Bouquet - the HTTP server: the vase's API, and (after `npm run build`) the page itself.
//
//   GET  /api/vase            -> { today, history, mine, style }      today's bouquet, the last 60 days, her vase, the vase's look
//   GET  /api/vase/:date      -> { bouquet }
//   GET  /api/vase/catalog    -> { flowers, prompt }                  every flower, and today's <vase> lines for a model
//   POST /api/vase/arrange    { stems, note, title? } -> { bouquet }  for a model or an agent (Bearer VASE_TOKEN if set)
//   PUT  /api/vase/mine       { stems }               -> { mine }     the page: the vase she arranged herself
//   PUT  /api/vase/style      VaseStyle               -> { style }    the page: how she shaped the vase
//
// PORT (7531), DATA_DIR (./data) and VASE_TOKEN come from the environment.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { FLOWERS } from '../src/vase/flowerCatalog.ts';
import { ARRANGE_HELP, VaseError, arrangeBouquet, bouquetOn, dayKey, herVase, recentBouquets, saveHerVase, saveVaseStyle, vasePrompt, vaseStyle } from './store.ts';

const PORT = Number(process.env.PORT ?? 7531);
const TOKEN = process.env.VASE_TOKEN ?? '';
const DIST = path.join(import.meta.dirname, '..', 'dist');

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readJson = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { raw += chunk; if (raw.length > 1_000_000) reject(new VaseError('body too large')); });
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : null); } catch { reject(new VaseError('body is not JSON')); } });
  req.on('error', reject);
});

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
function serveStatic(url: URL, res: ServerResponse) {
  let file = path.join(DIST, decodeURIComponent(url.pathname));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!existsSync(file)) { send(res, 404, { error: 'run `npm run build` first, or use `npm run dev` for the page' }); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  if (!p.startsWith('/api/')) return serveStatic(url, res);
  if (req.method === 'GET' && p === '/api/vase') return send(res, 200, { today: bouquetOn(dayKey()), history: recentBouquets(), mine: herVase(), style: vaseStyle() });
  if (req.method === 'GET' && p === '/api/vase/catalog') return send(res, 200, { flowers: FLOWERS, prompt: vasePrompt(), arrange: ARRANGE_HELP });
  const day = p.match(/^\/api\/vase\/(\d{4}-\d{2}-\d{2})$/);
  if (req.method === 'GET' && day) return send(res, 200, { bouquet: bouquetOn(day[1]) });
  if (req.method === 'POST' && p === '/api/vase/arrange') {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { bouquet: arrangeBouquet((await readJson(req)) as Parameters<typeof arrangeBouquet>[0]) });
  }
  if (req.method === 'PUT' && p === '/api/vase/mine') return send(res, 200, { mine: saveHerVase(((await readJson(req)) as { stems?: unknown } | null)?.stems) });
  if (req.method === 'PUT' && p === '/api/vase/style') return send(res, 200, { style: saveVaseStyle(await readJson(req)) });
  send(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    if (error instanceof VaseError) send(res, 400, { error: error.message });
    else { console.error(error); send(res, 500, { error: 'server error' }); }
  });
}).listen(PORT, () => console.log(`Daily Bouquet on http://localhost:${PORT}`));

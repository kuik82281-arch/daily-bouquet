// The online demo (GitHub Pages) has no server: this answers the page's /api/vase calls in the browser instead. The
// AI's column shows a sample bouquet; what the visitor arranges and how they shape the vase are kept in this
// browser's localStorage (nothing leaves the device). Only loaded when built with VITE_DEMO=1.
import type { Bouquet, HerVase } from './vase/flowerCatalog';
import type { VaseStyle } from './vase/vaseStyle';

const KEY = { mine: 'daily-bouquet:mine', style: 'daily-bouquet:style' };
const read = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; } catch { return null; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: kept for this visit only */ } };

const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const sample = (): Bouquet => ({
  date: today(),
  title: '示范 · sample',
  note: '接上 AI 以后，这里会是它每天插给你的花和一句话。Connect your AI, and this is where its bouquet for you will be each day.',
  stems: [
    { kind: 'pear-blossom', color: 'white', count: 2 },
    { kind: 'lily', color: 'pink', count: 2, shape: { headSize: 1.1 } },
    { kind: 'eucalyptus', color: 'green', count: 2 },
  ],
  createdAt: new Date().toISOString(),
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith('/api/vase')) return realFetch(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = () => (typeof init?.body === 'string' ? JSON.parse(init.body) : null);
  if (method === 'GET' && url.pathname === '/api/vase') {
    const b = sample();
    return json({ today: b, history: [b], mine: read<HerVase>(KEY.mine), style: read<VaseStyle>(KEY.style) });
  }
  if (method === 'PUT' && url.pathname === '/api/vase/mine') {
    const mine: HerVase = { stems: body()?.stems ?? [], updatedAt: new Date().toISOString() };
    write(KEY.mine, mine);
    return json({ mine });
  }
  if (method === 'PUT' && url.pathname === '/api/vase/style') {
    const style = body() as VaseStyle;
    write(KEY.style, style);
    return json({ style });
  }
  return json({ error: 'not in the demo' }, 404);
};

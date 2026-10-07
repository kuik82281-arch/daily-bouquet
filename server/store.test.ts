import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { arrangeBouquet, bouquetOn, cleanStems, describeStems, herVase, recentBouquets, saveHerVase, saveVaseStyle, setDataDir, vasePrompt, vaseStyle } from './store.ts';

const fresh = () => { const dir = mkdtempSync(path.join(tmpdir(), 'bouquet-')); setDataDir(dir); return dir; };

test('one bouquet a day: a second one the same day replaces the first, and it is kept on disk', () => {
  const dir = fresh();
  const morning = new Date(2026, 9, 7, 9, 0);
  assert.match(vasePrompt(morning), /No flowers/);
  arrangeBouquet({ stems: [{ kind: 'rose', color: 'white', count: 3 }, { kind: 'babys-breath', count: 2 }], note: 'good morning' }, morning);
  assert.match(vasePrompt(morning), /3 white rose \(白玫瑰\)|3 white rose/);
  arrangeBouquet({ stems: [{ kind: 'tulip', color: 'pink', count: 5 }], note: 'tulips instead', title: 'spring' }, new Date(2026, 9, 7, 20, 0));
  arrangeBouquet({ stems: [{ kind: 'lavender', count: 4 }], note: 'yesterday' }, new Date(2026, 9, 6, 20, 0));
  assert.equal(bouquetOn('2026-10-07')?.title, 'spring');
  assert.deepEqual(recentBouquets().map((b) => b.date), ['2026-10-07', '2026-10-06']);
  assert.ok(readFileSync(path.join(dir, 'vase.json'), 'utf8').includes('tulips instead'));
});

test("the AI's choice is made safe", () => {
  fresh();
  assert.deepEqual(cleanStems([{ kind: 'lavender', color: 'red', count: 2 }]), [{ kind: 'lavender', color: 'purple', count: 2 }]);
  assert.deepEqual(cleanStems([{ kind: 'lily', count: 2, shape: { bend: 9, headSize: 1.4, sparkle: 3 } }]), [{ kind: 'lily', color: 'white', count: 2, shape: { bend: 2.5, headSize: 1.4 } }]);
  assert.throws(() => cleanStems([{ kind: 'cactus' }]), /no such flower/);
  assert.throws(() => cleanStems([{ kind: 'rose', count: 7 }, { kind: 'lily', count: 7 }, { kind: 'daisy', count: 7 }]), /at most/);
  assert.throws(() => arrangeBouquet({ stems: [{ kind: 'rose' }], note: '  ' }), /write a line/);
  assert.equal(describeStems([{ kind: 'eucalyptus', color: 'green', count: 1 }]), '1 eucalyptus (尤加利叶)');
});

test('the user arranges her own vase and shapes the vase; both are kept in range', () => {
  fresh();
  const now = new Date(2026, 9, 8, 10, 0);
  const mine = saveHerVase([{ kind: 'pear-blossom', color: 'red', az: -1, tilt: 9, len: 0.1, seed: 4, headSize: 9 }], now);
  assert.deepEqual(mine.stems[0], { kind: 'pear-blossom', color: 'white', az: Math.PI * 2 - 1, tilt: 1.4, len: 0.6, seed: 4, headSize: 2 });
  assert.equal(herVase()?.stems.length, 1);
  assert.match(vasePrompt(now), /arranged a vase of her own today/);
  const style = saveVaseStyle({ glaze: '#ABCDEF', crackle: true, shape: { belly: 9 } });
  assert.equal(style.glaze, '#abcdef');
  assert.equal(style.shape.belly, 1.3);
  assert.equal(vaseStyle()?.crackle, true);
  assert.throws(() => saveHerVase('x'), /list/);
});

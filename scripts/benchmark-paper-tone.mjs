// The per-frame blend of two papers (an opening or closing book): the frozen JavaScript, this checkout's
// mixPaperTone, and the previous build's (given as a checkout with its src/js and built src/wasm; it asked the
// shelf module). Interleaved rounds, medians, nanoseconds per blend. No renderer.
// Run: npx vite-node scripts/benchmark-paper-tone.mjs PREVIOUS_CHECKOUT   (a directory inside this one)
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';

const previousRoot = process.argv[2];
if (!previousRoot) throw new Error('Usage: npx vite-node scripts/benchmark-paper-tone.mjs PREVIOUS_CHECKOUT');
globalThis.document = { createElement:() => ({ getContext:() => null, style:{} }) };
async function tree(root) {
  const at = file => pathToFileURL(resolve(root, file)).href;
  const shelf = await import(at('src/wasm/shelf/inhouse_read_shelf.js'));
  shelf.initSync({ module:readFileSync(resolve(root, 'src/wasm/shelf/inhouse_read_shelf_bg.wasm')) });
  globalThis.__inhouseRustReady = WebAssembly.instantiate(readFileSync(resolve(root, 'src/wasm/inhouse_read_core.wasm')));
  await (await import(at('src/js/rust-core.js'))).loadRustCore();
  await (await import(at('src/js/rust-shelf.js'))).loadRustShelf();
  return (await import(at('src/js/book-model.js'))).mixPaperTone;
}
const current = await tree('.'), previous = await tree(previousRoot);
const { mixPaperTone:frozen } = await import('../tests/unit/helpers/reference-book-surface-policy.js');
const out = new THREE.Color(), stock = new THREE.Color('#eee'), theme = new THREE.Color('#222');
for (let i = 0; i <= 100; i++) {
  const mix = i / 100, a = frozen(new THREE.Color(), stock, theme, mix).toArray(), b = current(new THREE.Color(), stock, theme, mix).toArray();
  if (a.some((value, n) => !Object.is(value, b[n]))) throw new Error(`blend differs at ${mix}`);
}
const BUILDS = [['frozen', frozen], ['previous', previous], ['current', current]], CALLS = 20000, rounds = 41;
const times = { frozen:[], previous:[], current:[] };
for (let warm = 0; warm < 5; warm++) for (const [, blend] of BUILDS) for (let i = 0; i < CALLS; i++) blend(out, stock, theme, (i % 99 + 1) / 100);
for (let round = 0; round < rounds; round++) for (let k = 0; k < 3; k++) {
  const [label, blend] = BUILDS[(k + round) % 3];
  const start = performance.now();
  for (let i = 0; i < CALLS; i++) blend(out, stock, theme, (i % 99 + 1) / 100);
  times[label].push((performance.now() - start) / CALLS * 1e6);
}
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
console.log(JSON.stringify({ unit:'nanoseconds per blend (mid-fade, both papers present)', rounds, calls:CALLS,
  frozen:Math.round(median(times.frozen)), previous:Math.round(median(times.previous)), current:Math.round(median(times.current)) }));

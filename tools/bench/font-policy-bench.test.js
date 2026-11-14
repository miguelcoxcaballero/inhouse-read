// @vitest-environment node
// Microbench of a family's title wraps: the shelf module's own cache (FontWraps, rust-ui/src/font_policy.rs)
// against the frozen bridge to the numeric core (tests/unit/helpers/reference-font-policy-wasm.js). One round is
// what one family asks during a search: 24 masks (2 cases x 3 alignments x 4 sizes) over 8 wrap keys, so 8 fresh
// wraps and 16 cached ones, then the cache is released. The canvas is a stub whose measureText costs almost
// nothing, which is the worst case for the module (in a browser the measurement dominates).
// Interleaved rounds, medians of this process's CPU time. Not part of the suite. To run it:
//   cp tools/bench/font-policy-bench.test.js tests/unit/zz-font-policy-bench.test.js
//   npx vitest run tests/unit/zz-font-policy-bench.test.js && rm tests/unit/zz-font-policy-bench.test.js
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { needRustShelf } from '../../src/js/rust-shelf.js';
import { createRustFontWrapCache } from './helpers/reference-font-policy-wasm.js';

const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];
const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };

it('a family\'s wraps: shelf module against the frozen bridge', async () => {
  const core = (await WebAssembly.instantiate(readFileSync('src/wasm/inhouse_read_core.wasm'))).instance.exports, shelf = needRustShelf();
  const context = { measureText: text => ({ width: text.length * 7.3 }) };
  let sink = 0;
  const family = (cache, title) => {
    const upper = title.toLocaleUpperCase();
    for (let cased = 0; cased < 2; cased++) for (let align = 0; align < 3; align++) for (let index = 0; index < 4; index++)
      sink += cache.lines(context, cased ? upper : title, 190, cased * 4 + index).length;
    cache.dispose();
  };
  const sides = { bridge: title => family(createRustFontWrapCache(core), title), module: title => { const cache = new shelf.FontWraps(); family(cache, title); cache.free(); } };
  for (const [name, title] of [['warm-up', 'The Left Hand of Darkness'], ['one word', 'Ulysses'], ['five words', 'The Left Hand of Darkness'],
    ['twelve words', 'A very long title that will not fit on one spine line at all'], ['not ASCII', 'Война и мир 東京の本 İstanbul café']]) {
    const time = run => { const start = cpu(); for (let i = 0; i < 2000; i++) run(title); return (cpu() - start) / 2000 * 1000; };
    for (let warm = 0; warm < 3; warm++) { time(sides.bridge); time(sides.module); }
    const bridge = [], module = [];
    for (let round = 0; round < 31; round++) { if (round & 1) { module.push(time(sides.module)); bridge.push(time(sides.bridge)); } else { bridge.push(time(sides.bridge)); module.push(time(sides.module)); } }
    console.log(`${name}: bridge ${median(bridge).toFixed(2)} us, module ${median(module).toFixed(2)} us per family (${((median(module) / median(bridge) - 1) * 100).toFixed(1)} %) ${sink > 0}`);
  }
}, 600000);

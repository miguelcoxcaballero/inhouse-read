// CPU-only comparison against the pre-migration policy. Run after build:rust-ui.
// This measures host interop overhead, not GPU rendering or device battery use.
import { readFileSync } from 'node:fs';
import * as native from '../src/wasm/shelf/inhouse_read_shelf.js';

native.initSync({ module:readFileSync(new URL('../src/wasm/shelf/inhouse_read_shelf_bg.wasm', import.meta.url)) });
const retained = new WeakSet(), counts = new WeakMap();
function original(renderer) {
  const programs = renderer.info.programs;
  let count = counts.get(renderer) || 0;
  for (let i = 0; i < programs.length && count < 160; i++) {
    const program = programs[i];
    if (retained.has(program)) continue;
    retained.add(program); count++; program.usedTimes++;
  }
  counts.set(renderer, count);
}
const host = { unretained:(programs, known) => programs.filter(program => !known.has(program)) };
const rust = renderer => native.gpu_retain_programs(host, renderer);
function measure(fn, renderer) {
  const start = performance.now();
  for (let i = 0; i < 20000; i++) fn(renderer);
  return (performance.now() - start) / 20000 * 1000;
}
const median = values => values.sort((a,b) => a-b)[2];
for (const size of [0, 25, 100, 160]) {
  const renderer = () => ({ info:{ programs:Array.from({ length:size }, () => ({ usedTimes:1 })) } });
  const before = renderer(), after = renderer();
  for (let i = 0; i < 2000; i++) { original(before); rust(after); }
  const previous = [], migrated = [];
  for (let i = 0; i < 5; i++) { previous.push(measure(original, before)); migrated.push(measure(rust, after)); }
  console.log(JSON.stringify({ programs:size, unit:'microseconds/call', original:median(previous), rust:median(migrated) }));
}

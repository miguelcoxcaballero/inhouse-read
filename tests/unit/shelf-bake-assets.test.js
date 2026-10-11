// @vitest-environment node
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { shelfBakeHash } from '../../scripts/shelf-bake-version.mjs';
let root;
const put=(name,value)=>{const file=join(root,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,value);};
beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'inhouse-shelf-hash-'));
  put('src/js/shelf-plants.js',"import './core.js';");
  put('src/js/shelf-lamps.js','export const lamp=1;');
  put('src/js/core.js',"import core from '../wasm/core.wasm?url';");
  put('src/wasm/core.wasm',Buffer.from([0,97,115,109,0,255,254]));
  put('node_modules/three/package.json',JSON.stringify({version:'0.180.0'}));
});
afterEach(()=>{if(root?.startsWith(join(tmpdir(),'inhouse-shelf-hash-')))rmSync(root,{recursive:true,force:true});});
it('follows queried binary imports and distinguishes bytes lost by UTF-8 decoding',()=>{
  const first=shelfBakeHash(root);expect(first).toMatch(/^[0-9a-f]{20}$/);
  expect(shelfBakeHash(root)).toBe(first);
  put('src/wasm/core.wasm',Buffer.from([0,97,115,109,0,254,255]));
  expect(shelfBakeHash(root)).not.toBe(first);
});
it('does not interpret import-looking bytes in an asset as dependencies',()=>{
  put('src/wasm/core.wasm',Buffer.from("from './nonexistent.js'"));
  expect(shelfBakeHash(root)).toMatch(/^[0-9a-f]{20}$/);
});
it('follows transitive JS changes, ignores queries for file lookup and terminates cycles',()=>{
  put('src/js/core.js',"import core from '../wasm/core.wasm?url#asset'; import './shelf-plants.js';");
  const first=shelfBakeHash(root);
  put('src/js/core.js',"import core from '../wasm/core.wasm?url#asset'; import './shelf-plants.js'; export const leaf=2;");
  expect(shelfBakeHash(root)).not.toBe(first);
});
it('still invalidates bakes when Three.js changes',()=>{
  const first=shelfBakeHash(root);put('node_modules/three/package.json',JSON.stringify({version:'0.181.0'}));
  expect(shelfBakeHash(root)).not.toBe(first);
});

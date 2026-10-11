// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { rustBookmarkBuffers, releaseRustBookmarkBuffers } from '../../src/js/bookmark-wasm.js';
import { referenceBookmarkGeometry } from './helpers/reference-bookmark-geometry.js';

let core;
beforeAll(async()=>{
  core=await loadRustCore({bytes:readFileSync(new URL('../../src/wasm/inhouse_read_core.wasm',import.meta.url))});
  expect(core).not.toBeNull();expect(typeof core.bookmark_mesh).toBe('function');
});
afterAll(()=>releaseRustBookmarkBuffers(core));
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function compare(buffers,geometry) {
  for(const [actual,name] of [[buffers.positions,'position'],[buffers.uvs,'uv'],[buffers.normals,'normal']]) {
    expect(Buffer.compare(bytes(actual),bytes(geometry.getAttribute(name).array)),`${name} bytes`).toBe(0);
  }
  expect(Buffer.compare(bytes(buffers.indices),bytes(geometry.index.array)),'topology bytes').toBe(0);
}
const poses=[[0,0],[.05,0],[.050001,0],[.15,0],[.3,0],[.55,0],[.85,0],[1,0],
  [1,.35],[1,.82],[1,1],[.6,.1],[0,.7],[-.2,1.2]];
const fixtures=[
  {width:132,height:200,thickness:40,peek:10,segments:8,seed:0},
  {width:132,height:200,thickness:12,peek:20,segments:32,seed:1},
  {width:264,height:400,thickness:80,peek:16,segments:32,seed:12345},
  {width:90,height:240,thickness:15,peek:0,segments:16,seed:4294967295},
  {width:400,height:240,thickness:120,peek:12,segments:64,seed:27},
  {width:62.125,height:92.375,thickness:8.25,peek:23,segments:32,seed:65520},
  {width:132,height:200,thickness:40,peek:10,segments:4,seed:300},
  {width:132,height:200,thickness:40,peek:10,segments:9,seed:65522}
];
describe('compiled ribbon mesh preserves its original printed and shaded geometry',()=>{
  for(const fixture of fixtures)it(`keeps exact buffers for ${fixture.width}x${fixture.height}, ${fixture.segments} segments, seed ${fixture.seed}`,()=>{
    const {width,height,thickness,peek,segments,seed}=fixture;
    for(const progress of [0,.45,1])for(const [open,withdraw] of poses) {
      const reference=referenceBookmarkGeometry(width,height,thickness,progress,peek,{open,withdraw,segments,seed});
      try {
        const actual=rustBookmarkBuffers(core,width,height,thickness,progress,peek,open,withdraw,segments,seed);
        expect(actual).not.toBeNull();compare(actual,reference);
      } finally {reference.dispose()}
    }
  });
  it('retains scratch arrays and immutable topology across successive frames',()=>{
    const first=rustBookmarkBuffers(core,264,400,80,.45,16,0,0,32,12345);
    const positions=first.positions,uvs=first.uvs,normals=first.normals,indices=first.indices;
    for(const [open,withdraw] of poses) {
      const next=rustBookmarkBuffers(core,264,400,80,.45,16,open,withdraw,32,12345);
      expect(next).toBe(first);expect(next.positions).toBe(positions);expect(next.uvs).toBe(uvs);
      expect(next.normals).toBe(normals);expect(next.indices).toBe(indices);
    }
  });
  it('renews detached wasm views after another kernel grows memory',()=>{
    const previous=rustBookmarkBuffers(core,264,400,80,.45,16,0,0,32,12345),old=previous.positions;
    core.memory.grow(1);
    const next=rustBookmarkBuffers(core,264,400,80,.45,16,.6,.1,32,12345);
    // Vitest's inverted identity matcher may deep-format the detached old
    // typed array before applying `.not`. Compare identity as a boolean.
    expect(Object.is(next.positions,old)).toBe(false);
    expect(old.byteLength).toBe(0);
    expect(next.positions.buffer).toBe(core.memory.buffer);
    const reference=referenceBookmarkGeometry(264,400,80,.45,16,{open:.6,withdraw:.1,segments:32,seed:12345});
    try {compare(next,reference)}finally{reference.dispose()}
  });
  it('uses one bounded scratch arena per segment count and releases it explicitly',()=>{
    const allocations=[],released=[];
    const tracked={...core,
      alloc_f64(length){const pointer=core.alloc_f64(length);allocations.push([pointer,length]);return pointer},
      free_f64(pointer,length){released.push([pointer,length]);core.free_f64(pointer,length)}
    };
    for(const [open,withdraw]of poses)rustBookmarkBuffers(tracked,264,400,80,.45,16,open,withdraw,32,12345);
    expect(allocations).toHaveLength(1);expect(released).toHaveLength(0);
    releaseRustBookmarkBuffers(tracked);releaseRustBookmarkBuffers(tracked);
    expect(released).toEqual(allocations);
  });
  it('leaves unavailable or nonproduction inputs to the original geometry builder',()=>{
    expect(rustBookmarkBuffers(null,132,200,40,.45)).toBeNull();
    expect(rustBookmarkBuffers(core,132,200,40,.45,10,0,0,2048)).toBeNull();
    expect(rustBookmarkBuffers(core,132,200,40,.45,NaN)).toBeNull();
  });
});

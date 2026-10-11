import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadRustCore } from '../../src/js/rust-core.js';
import { bookmarkGeometry, createBookModel } from '../../src/js/book-model.js';
import { referenceBookmarkGeometry } from './helpers/reference-bookmark-geometry.js';

const models=[];
const book={id:'rust-ribbon-pose',title:'A printed cover',author:'An author',format:'EPUB',progressFraction:.45};
const style={color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40};
beforeAll(async()=>{
  const core=await loadRustCore({bytes:readFileSync(resolve(process.cwd(),'src/wasm/inhouse_read_core.wasm'))});
  expect(typeof core?.bookmark_mesh).toBe('function');
});
afterEach(()=>{for(const model of models.splice(0))model.userData.dispose();vi.restoreAllMocks()});
function make() {
  if (!HTMLCanvasElement.prototype.getContext.mock) {
    const context=new Proxy({measureText:text=>({width:String(text).length*16}),createLinearGradient:()=>({addColorStop(){}}),getImageData:(_x,_y,width,height)=>({data:new Uint8ClampedArray(width*height*4)})},{get:(target,key)=>target[key]??(()=>{})});
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
  }
  const model=createBookModel(book,style,132,200,40,null);models.push(model);return model;
}
const bytes=array=>Buffer.from(array.buffer,array.byteOffset,array.byteLength);
function equalGeometry(a,b) {
  for(const name of ['position','normal','uv'])expect(Buffer.compare(bytes(a.attributes[name].array),bytes(b.attributes[name].array)),name).toBe(0);
  expect(Buffer.compare(bytes(a.index.array),bytes(b.index.array))).toBe(0);
}

describe('Rust ribbon integration and one update per displayed pose',()=>{
  it('keeps original geometry bytes and attribute ownership through a full opening and reverse',()=>{
    const geometry=bookmarkGeometry(264,400,80,.45,16,{seed:12345});
    const position=geometry.attributes.position,normal=geometry.attributes.normal,uv=geometry.attributes.uv,index=geometry.index;
    try {
      for(const [open,withdraw]of [[0,0],[.18,0],[.5,0],[1,0],[1,.35],[1,1],[1,.35],[1,0],[.5,0],[0,0]]) {
        const reference=referenceBookmarkGeometry(264,400,80,.45,16,{open,withdraw,seed:12345});
        try {
          expect(bookmarkGeometry(264,400,80,.45,16,{open,withdraw,seed:12345,geometry})).toBe(geometry);
          equalGeometry(geometry,reference);
          expect(geometry.attributes.position).toBe(position);expect(geometry.attributes.normal).toBe(normal);
          expect(geometry.attributes.uv).toBe(uv);expect(geometry.index).toBe(index);
        } finally {reference.dispose()}
      }
    } finally {geometry.dispose()}
  });
  it('combines cover and withdrawal changes into one identical mesh update',()=>{
    const batched=make(),separate=make(),ribbon=batched.getObjectByName('reading-bookmark');
    for(const [open,withdraw]of [[.4,.2],[1,.7],[.7,.3],[0,0]]) {
      const version=ribbon.geometry.attributes.position.version;
      batched.userData.setMotionPose(open,withdraw);
      separate.userData.setCoverOpen(open);separate.userData.setBookmarkWithdraw(withdraw);
      expect(ribbon.geometry.attributes.position.version).toBe(version+1);
      equalGeometry(ribbon.geometry,separate.getObjectByName('reading-bookmark').geometry);
      expect(ribbon.visible).toBe(separate.getObjectByName('reading-bookmark').visible);
    }
    const version=ribbon.geometry.attributes.position.version;
    batched.userData.setMotionPose(0,0);
    expect(ribbon.geometry.attributes.position.version).toBe(version);
  });
});

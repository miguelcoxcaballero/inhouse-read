import {expect,it} from 'vitest';
import {rustShelf as rust} from './helpers/rust-shelf-ready.js';
import {shelfPixelOffset} from './helpers/shelf-pixel-origin.js';

// The stage's pixel origin is asked of the view (RustScene#pixelOffset, rust-ui/src/scene_layout.rs:
// the core's own search, compiled into the shelf module), no longer of the core module through
// the adapter the scene imported until 1.8.1 (tests/unit/helpers/shelf-pixel-origin.js). Same
// offset, signed zeros included, for the numbers a frame hands over.
function random(seed){let s=seed>>>0;return()=>{s=s+0x6d2b79f5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
it('finds the stage\'s pixel origin as the core module did through its adapter',()=>{
 const next=random(4242),pick=list=>list[Math.floor(next()*list.length)];
 const ratios=[1,1.25,1.5,1.75,2,2.25,2.5,2.625,2.75,3,0.5,1/3,2.6666666666666665,0,-1,NaN,Infinity];
 const sizes=[390,391,360.5,412,844,843.5,800,1024,333.3333,7];
 let moved=0,still=0;
 for(const width of sizes){
  const view=new rust.RustScene(width,1200,width,250,false,false,0),wide=new rust.RustScene(600,1200,width,250,true,true,0);
  try{
   for(let trial=0;trial<20000;trial++){
    const top=next()<.2?pick([0,-0,1,-1,12.5,100.25,1e6+.125,-3.75,1e17,NaN,Infinity,-Infinity,Number.MIN_VALUE])
     :(next()-.3)*pick([10,100,1000,20000])+(next()<.5?pick([.125,.0625,.3333333333333333,.6]):0);
    const height=pick(sizes),ratio=pick(ratios),want=shelfPixelOffset(top,width,height,ratio);
    for(const scene of [view,wide]){
     const got=scene.pixelOffset(top,height,ratio);
     if(!Object.is(got,want))throw new Error(`pixelOffset(${top}, ${height}, ${ratio}) at width ${width} = ${got}, expected ${want}`);
    }
    if(want!==0)moved++;else still++;
   }
  }finally{view.free();wide.free();}
 }
 expect(moved).toBeGreaterThan(5000);expect(still).toBeGreaterThan(50000);
});

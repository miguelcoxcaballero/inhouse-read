import { describe, expect, it } from 'vitest';
import { createNativeFramePolicy } from '../../src/js/native-frame-policy.js';
import { getRustCore } from '../../src/js/rust-core.js';

// Original 1.7.306 descriptor contract, retained independently of the packed ABI.
function exact(frame, gl, maxTextureSize) {
  if (!frame || ![frame.width,frame.height,frame.ratio].every(value=>Number.isFinite(value)&&value>0)
    || ![frame.x??0,frame.y??0].every(Number.isFinite)) return false;
  if (frame.physical === true) return [frame.pixelWidth,frame.pixelHeight,gl?.drawingBufferWidth,gl?.drawingBufferHeight]
    .every(value=>Number.isInteger(value)&&value>0)
    && frame.pixelWidth===Math.floor(frame.width*frame.ratio) && frame.pixelHeight===Math.floor(frame.height*frame.ratio)
    && (!Number.isFinite(maxTextureSize) || Math.max(frame.pixelWidth,frame.pixelHeight)<=maxTextureSize);
  return frame.physical===undefined && [frame.width*frame.ratio,frame.height*frame.ratio,(frame.x??0)*frame.ratio,(frame.y??0)*frame.ratio].every(Number.isInteger);
}
function capture(frame, gl, max, canvas) {
  if (!exact(frame, gl, max)) return null;
  const {width,height,ratio,sourceX=0,sourceY=0} = frame, physical=frame.physical===true;
  const w=physical?frame.pixelWidth:width*ratio,h=physical?frame.pixelHeight:height*ratio;
  if (![sourceX,sourceY].every(Number.isInteger) || sourceX<0 || sourceY<0 || sourceX+w>canvas.width || sourceY+h>canvas.height) return null;
  if (physical && (gl.drawingBufferWidth!==canvas.width || gl.drawingBufferHeight!==canvas.height || sourceX+w>gl.drawingBufferWidth || sourceY+h>gl.drawingBufferHeight)) return null;
  return [w,h];
}
describe('Rust resolved framebuffer geometry policy', () => {
  it('matches the existing aligned and physical descriptor contracts across strict JS types and bounds', () => {
    const policy=createNativeFramePolicy(), gl={drawingBufferWidth:780,drawingBufferHeight:1688}, canvas={width:780,height:1688};
    const ordinary={width:390,height:844,ratio:2,x:0,y:0};
    const physical={...ordinary,physical:true,pixelWidth:780,pixelHeight:1688};
    const values=[undefined,null,false,true,'2',0,-0,-1,.25,1,2,390,780,1688,Infinity,-Infinity,NaN];
    for (const base of [ordinary, physical]) for (const field of ['width','height','ratio','x','y','physical','pixelWidth','pixelHeight','sourceX','sourceY']) for (const value of values) {
      const frame={...base,[field]:value};
      expect(policy.exact(frame,gl,4096), `${field}=${String(value)}`).toBe(exact(frame,gl,4096));
      const actual=policy.capture(frame,gl,4096,canvas);
      expect(actual && Array.from(actual), `${field}=${String(value)}`).toEqual(capture(frame,gl,4096,canvas));
    }
    for (const max of values) expect(policy.exact(physical,gl,max)).toBe(exact(physical,gl,max));
    policy.dispose(); policy.dispose(); expect(policy.exact(ordinary,gl,4096)).toBe(false);
  });
  it('matches fractional DPRs and keeps physical dimensions separate from CSS coordinates', () => {
    const policy=createNativeFramePolicy(); let seed=42;
    const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    for (let n=0;n<3000;n++) {
      const width=1+random()*1000,height=1+random()*2000,ratio=[1,1.25,1.5,2,2.625,3][n%6];
      const frame={width,height,ratio,x:random()*100,y:random()*100,physical:true,pixelWidth:Math.floor(width*ratio),pixelHeight:Math.floor(height*ratio)};
      const gl={drawingBufferWidth:frame.pixelWidth,drawingBufferHeight:frame.pixelHeight}, canvas={width:frame.pixelWidth,height:frame.pixelHeight};
      if (n%3===0) frame.sourceX=1;
      expect(policy.exact(frame,gl,4096)).toBe(exact(frame,gl,4096));
      const result=policy.capture(frame,gl,4096,canvas);
      expect(result&&Array.from(result)).toEqual(capture(frame,gl,4096,canvas));
    }
    policy.dispose();
  });
  it('produces exact three-layer uniforms and rejects any invalid layer before presentation', () => {
    const policy=createNativeFramePolicy(), gl={drawingBufferWidth:780,drawingBufferHeight:1688};
    const frame={width:390,height:844,ratio:2,x:0,y:0};
    const layers=[{frame,x:.25,y:20.125,scale:1.5},{frame,x:10,y:20,scale:.25,clip:{left:1,top:2,right:3,bottom:4}},{frame}];
    const first=policy.compose(frame,layers,gl,4096);
    expect(Array.from(first)).toEqual([.25,20.125,585,1266,.25,20.125,585.25,1286.125,10,20,97.5,211,1,2,3,4,0,0,390,844,0,0,390,844]);
    expect(policy.compose(frame,layers,gl,4096)).toBe(first);
    for(const mutation of [{x:NaN},{y:Infinity},{scale:0},{scale:'1'},{clip:{left:0,top:0,right:NaN,bottom:10}}]) {
      expect(policy.compose(frame,[...layers.slice(0,2),{frame,...mutation}],gl,4096)).toBeNull();
    }
    expect(policy.compose(frame,[...layers,{frame}],gl,4096)).toBeNull();
    // Other numeric jobs can grow the core between frames; stale typed-array
    // views must never cause corruption or change the cache's geometry.
    const core=getRustCore(); core.memory.grow(1);
    expect(Array.from(policy.compose(frame,[{frame}],gl,4096))).toEqual([0,0,390,844,0,0,390,844]);
    expect(policy.compose(frame,layers,gl,4096) === first).toBe(false);
    policy.dispose();
  });
});

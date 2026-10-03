import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bookView, sampleBookMotion } from '../../src/js/book-model.js';

// Exercise the real bookView animation and pose sampler. Only the GPU driver
// is replaced: its geometry, materials, ribbon and motion frames stay real.
vi.mock('three', async importOriginal => {
  const THREE = await importOriginal();
  class Renderer {
    constructor() {
      this.domElement = document.createElement('canvas');
      this.shadowMap = {}; this.info = { programs:[] };
      this.capabilities = { getMaxAnisotropy:() => 1 };
      this.size = new THREE.Vector2(); this.ratio = 1;
    }
    getSize(target) { return target.copy(this.size); }
    setSize(width, height) { this.size.set(width, height); }
    getPixelRatio() { return this.ratio; }
    setPixelRatio(value) { this.ratio = value; }
    compile() {}
    render() {}
  }
  class PMREM {
    fromScene() { return { texture:new THREE.Texture() }; }
    dispose() {}
  }
  return { ...THREE, WebGLRenderer:Renderer, PMREMGenerator:PMREM };
});

let view, frames, clock, serial;
beforeEach(() => {
  clock = 1000; serial = 0; frames = new Map();
  vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {});
  vi.stubGlobal('requestAnimationFrame', callback => { const id=++serial;frames.set(id,callback);return id; });
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const context = new Proxy({
    measureText:text => ({ width:String(text).length*16 }),
    createLinearGradient:() => ({ addColorStop() {} }),
    getImageData:(_x,_y,width,height) => ({ data:new Uint8ClampedArray(width*height*4) })
  }, { get:(target,key) => target[key] ?? (() => {}) });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context);
  const host=document.createElement('div');document.body.append(host);
  view=bookView(host,{ id:'clock',title:'Animation clock',author:'Reader',format:'EPUB' },
    { color:'#42604b',shade:'#324c3a',ink:'#ffffff',coverRatio:.66,width:40 },
    { width:132,height:200,thickness:40,viewportWidth:390,viewportHeight:844,centerX:195,centerY:350,
      initialPose:{ x:0,y:0,scale:1,angle:-9,pitch:0,roll:0 } });
  expect(view).not.toBeNull();
});
afterEach(() => {
  view?.dispose();document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();
});
const motionFrames = angle => [{ transform:{ x:0,y:0,scale:1,angle,pitch:0,roll:0 } },
  { transform:{ x:0,y:0,scale:1,angle:0,pitch:0,roll:0 } }];
function deliver(observed, rafTimestamp) {
  expect(frames.size).toBe(1);
  const [id,callback]=frames.entries().next().value;frames.delete(id);
  clock=observed;callback(rafTimestamp);
  return view.getPose();
}

describe('book motion uses the delivered frame clock', () => {
  it('advances on the first delivered frame even when its RAF timestamp predates the gesture', async () => {
    const poses=motionFrames(-9), animation=view.animate(poses,{ duration:240 });
    const first=deliver(1450,900);
    expect(first.angle).toBeCloseTo(sampleBookMotion(poses,48/240).angle);
    expect(first.angle).toBeGreaterThan(-9);
    expect(first.angle).toBeLessThan(0);
    expect(animation.lastFrameTime).toBe(1450);
    const second=deliver(1900,1450);
    expect(second.angle).toBeCloseTo(sampleBookMotion(poses,148/240).angle);
    const third=deliver(2350,1900);
    expect(third.angle).toBe(0);
    expect(frames.size).toBe(0);
    await animation.finished;
  });

  it('keeps the same 48ms first step and 100ms later bound when RAF reports a future time', () => {
    const poses=motionFrames(-9);view.animate(poses,{ duration:1000 });
    expect(deliver(1016,5000).angle).toBeCloseTo(sampleBookMotion(poses,16/1000).angle);
    expect(deliver(2016,6000).angle).toBeCloseTo(sampleBookMotion(poses,116/1000).angle);
    expect(deliver(4016,8000).angle).toBeCloseTo(sampleBookMotion(poses,216/1000).angle);
  });

  it('preserves every ordinary frame pose when observed and RAF clocks match', async () => {
    const poses=motionFrames(-9), animation=view.animate(poses,{ duration:240 });
    for(let elapsed=16;elapsed<=240;elapsed+=16) {
      expect(deliver(1000+elapsed,1000+elapsed).angle).toBeCloseTo(sampleBookMotion(poses,elapsed/240).angle);
    }
    expect(frames.size).toBe(0);await animation.finished;
  });

  it('cancels the previous oscillation and returns monotonically from its actual visible pose', async () => {
    const oscillation=view.animate([{ transform:view.getPose() },
      { transform:{ ...view.getPose(),angle:12 } }],{ duration:2400 });
    deliver(1100,1100);deliver(1550,1100);
    const origin=view.getPose(), poses=[{transform:origin},{transform:{...origin,angle:0}}];
    const returning=view.animate(poses,{duration:240});await oscillation.finished;
    const angles=[origin.angle,deliver(2000,1500).angle,deliver(2450,1950).angle,deliver(2900,2400).angle];
    for(let index=1;index<angles.length;index++) expect(Math.abs(angles[index])).toBeLessThan(Math.abs(angles[index-1]));
    expect(angles.at(-1)).toBe(0);expect(frames.size).toBe(0);await returning.finished;
  });

  it('still completes an immediate pose and cancels a pending frame on disposal', async () => {
    const immediate=view.animate(motionFrames(-9),{duration:0});
    expect(deliver(1001,500).angle).toBe(0);await immediate.finished;
    const pending=view.animate(motionFrames(0),{duration:240});
    expect(frames.size).toBe(1);view.dispose();expect(frames.size).toBe(0);await pending.finished;
  });
});

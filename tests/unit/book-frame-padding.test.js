// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { paddedBookFrameWidth } from '../../src/js/book-frame-padding.js';
import { configureNativeRendererSize } from '../../src/js/native-renderer-size.js';

const frame = { width:384, height:320 };
const previous = { x:390, y:320 };
const physical = { width:780, height:640 };

describe('small empty native book margins', () => {
  it('retains only the small original width at the same height and pixel ratio', () => {
    expect(paddedBookFrameWidth(frame, previous, 2, physical, true)).toBe(390);
    expect(paddedBookFrameWidth(frame, {x:400,y:320}, 2, {width:800,height:640}, true)).toBe(400);
  });
  it.each([
    ['disabled', frame, previous, 2, physical, false],
    ['different height', frame, {x:390,y:321}, 2, {width:780,height:642}, true],
    ['large shrink', frame, {x:401,y:320}, 2, {width:802,height:640}, true],
    ['growth', frame, {x:383,y:320}, 2, {width:766,height:640}, true],
    ['fractional ratio', frame, previous, 1.5, {width:585,height:480}, true],
    ['fractional frame', {width:384.5,height:320}, previous, 2, physical, true],
    ['stale width', frame, previous, 2, {width:781,height:640}, true],
    ['stale height', frame, previous, 2, {width:780,height:641}, true],
    ['uninitialised', frame, {x:0,y:0}, 2, {width:0,height:0}, true],
    ['same width', frame, {x:384,y:320}, 2, {width:768,height:640}, true],
  ])('preserves the original frame for %s', (_name, requested, old, ratio, pixels, allowed) => {
    expect(paddedBookFrameWidth(requested, old, ratio, pixels, allowed)).toBe(requested.width);
  });
});

function productionConfigure() {
  const source = readFileSync('src/js/book-model.js', 'utf8');
  const body = source.match(/function configureFrame\(frame\) \{([\s\S]*?)\n  \}/)[1];
  return new Function('gpu','rendererSize','pixelRatio','directEnabled','compactReturnFrame','camera',
    'paddedBookFrameWidth','configureNativeRendererSize','frame', body);
}
function driver() {
  const gpu = {
    domElement:{width:780,height:640}, size:{x:390,y:320}, ratio:2, writes:[], viewports:[],
    getSize(out) { Object.assign(out, this.size); }, getPixelRatio() { return this.ratio; },
    setSize(width,height) { this.size={x:width,y:height}; this.domElement.width=width*this.ratio;
      this.domElement.height=height*this.ratio; this.writes.push([width,height]); },
    setPixelRatio(value) { this.ratio=value; this.setSize(this.size.x,this.size.y); },
    setDrawingBufferSize(width,height,ratio) { this.ratio=ratio; this.setSize(width,height); },
    setViewport(...values) { this.viewports.push(values); }
  };
  return gpu;
}
describe('production book frame allocation and projection', () => {
  it('omits the native reset while keeping the original cropped viewport', () => {
    const gpu=driver(), requested={...frame,camera:{}}, camera={};
    productionConfigure()(gpu,{},2,true,true,camera,paddedBookFrameWidth,configureNativeRendererSize,requested);
    expect(gpu.writes).toEqual([]); expect(gpu.domElement).toEqual(physical);
    expect(gpu.viewports).toEqual([[0,0,384,320]]); expect(requested.presentationWidth).toBe(390);
  });
  it('restores the next full-width projection even when no resize is necessary', () => {
    const gpu=driver(), camera={}, configure=productionConfigure();
    configure(gpu,{},2,true,true,camera,paddedBookFrameWidth,configureNativeRendererSize,{...frame,camera:{}});
    configure(gpu,{},2,true,true,camera,paddedBookFrameWidth,configureNativeRendererSize,{width:390,height:320,camera});
    expect(gpu.writes).toEqual([]);
    expect(gpu.viewports).toEqual([[0,0,384,320],[0,0,390,320]]);
  });
  it.each(['legacy','full camera','uncompact'])('retains the original allocation in %s', mode => {
    const gpu=driver(), camera={}, requested={...frame,camera:mode==='full camera'?camera:{}};
    productionConfigure()(gpu,{},2,mode!=='legacy',mode!=='uncompact',camera,paddedBookFrameWidth,configureNativeRendererSize,requested);
    expect(gpu.writes).toEqual([[384,320]]); expect(gpu.domElement).toEqual({width:768,height:640});
    expect(gpu.viewports.at(-1)).toEqual([0,0,384,320]); expect(requested.presentationWidth).toBe(384);
  });
});

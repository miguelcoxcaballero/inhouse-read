import {describe,expect,it,vi} from 'vitest';
import {refreshCanvasFontsAfterPaint} from '../../src/js/canvas-font-readiness.js';

describe('font readiness after the first canvas text paint',()=>{
  it('does not subscribe or repaint when the observed post-paint set is loaded',()=>{
    const callback=vi.fn(),read=vi.fn(()=>Promise.resolve());
    refreshCanvasFontsAfterPaint(callback,{status:'loaded',get ready(){return read();}});
    expect(read).not.toHaveBeenCalled();expect(callback).not.toHaveBeenCalled();
  });
  it('waits for the current loading promise and invokes exactly once',async()=>{
    const callback=vi.fn();let finish;const ready=new Promise(resolve=>{finish=resolve;});
    const pending=refreshCanvasFontsAfterPaint(callback,{status:'loading',ready});
    await Promise.resolve();expect(callback).not.toHaveBeenCalled();
    finish();await pending;expect(callback).toHaveBeenCalledOnce();
  });
  it('retains the original promise branch for unknown status',async()=>{
    const callback=vi.fn(),ready=Promise.resolve('loaded');
    await refreshCanvasFontsAfterPaint(callback,{ready});expect(callback).toHaveBeenCalledOnce();
  });
  it('does nothing when the document has no FontFaceSet',()=>{
    const callback=vi.fn();expect(refreshCanvasFontsAfterPaint(callback,null)).toBeUndefined();
    expect(callback).not.toHaveBeenCalled();
  });
  it('uses the replacement readiness promise created by first text measurement',async()=>{
    const callback=vi.fn(),old=Promise.resolve();let finish;
    const next=new Promise(resolve=>{finish=resolve;});
    const fonts={status:'loaded',ready:old};
    // The caller performs real initial text construction before this helper.
    fonts.status='loading';fonts.ready=next;
    const pending=refreshCanvasFontsAfterPaint(callback,fonts);await old;
    expect(callback).not.toHaveBeenCalled();finish();await pending;expect(callback).toHaveBeenCalledOnce();
  });
  it('does not hide a rejection from the original readiness promise',async()=>{
    const failure=new Error('font loading failed'),callback=vi.fn();
    await expect(refreshCanvasFontsAfterPaint(callback,{status:'loading',ready:Promise.reject(failure)})).rejects.toBe(failure);
    expect(callback).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest'
import { hasUntrackedPDFImages, paintPDFTheme } from '../../src/js/readers/pdf-page-theme.js'

function setup() {
  const ctx = Object.fromEntries(['clearRect','save','restore','beginPath','moveTo','lineTo','closePath','clip'].map(name => [name,vi.fn()]))
  const draws = []
  ctx.drawImage = vi.fn((...args) => draws.push({filter:ctx.filter,args}))
  const source = {width:400,height:600}, target = {width:400,height:600,getContext:() => ctx}
  return {ctx,draws,source,target}
}
describe('PDF images keep their original colours', () => {
  it.each(['sepia(.5) brightness(.94)','invert(.89) hue-rotate(180deg)','grayscale(1) invert(1) brightness(.77647)'])('restores colour AND monochrome images after %s', filter => {
    const {ctx,draws,source,target} = setup()
    paintPDFTheme(source,target,filter,new Float32Array([.1,.2,.1,.4,.3,.2]))
    expect(draws.map(draw => draw.filter)).toEqual([filter,'none'])
    expect(draws.every(draw => draw.args[0] === source)).toBe(true)
    expect(ctx.clip).toHaveBeenCalledOnce()
    expect(ctx.save).toHaveBeenCalledOnce(); expect(ctx.restore).toHaveBeenCalledOnce()
  })
  it('clips to a rotated image parallelogram instead of recolouring/restoring its bounding box', () => {
    const {ctx,source,target} = setup()
    paintPDFTheme(source,target,'sepia(.5)',[.2,.2,.1,.3,.3,.3])
    expect(ctx.moveTo).toHaveBeenCalledWith(80,120)
    expect(ctx.lineTo.mock.calls).toEqual([[120,180],[80,239.99999999999997],[40,180]])
  })
  it('keeps overlapping reflected images in the same winding so clipping does not cut holes', () => {
    const {ctx,source,target} = setup()
    paintPDFTheme(source,target,'invert(1)',[.1,.1,.3,.1,.1,.3, .3,.1,.1,.1,.3,.3])
    const winding = i => {
      const [ax,ay]=ctx.moveTo.mock.calls[i], [bx,by]=ctx.lineTo.mock.calls[i*3], [cx,cy]=ctx.lineTo.mock.calls[i*3+2]
      return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)
    }
    expect(winding(0)).toBeGreaterThan(0);expect(winding(1)).toBeGreaterThan(0)
    expect(ctx.clip).toHaveBeenCalledOnce()
  })
  it('does not add a second copy or clipping work for original paper', () => {
    const {ctx,draws,source,target} = setup()
    paintPDFTheme(source,target,'none',[0,0,0,1,1,0])
    expect(draws).toHaveLength(1); expect(ctx.clip).not.toHaveBeenCalled()
  })
  it('does not perform any image pixel readback or scanning', () => {
    const {ctx,source,target} = setup()
    ctx.getImageData = vi.fn(() => {throw new Error('CPU readback')})
    paintPDFTheme(source,target,'invert(1)',[0,0,0,1,1,0])
    expect(ctx.getImageData).not.toHaveBeenCalled()
  })
  it('preserves complex batched/masked image layouts instead of guessing their bounds', () => {
    const ops = {paintInlineImageXObjectGroup:87,paintImageXObjectRepeat:88,paintImageMaskXObject:83}
    expect(hasUntrackedPDFImages({fnArray:[1,87]},ops)).toBe(true)
    expect(hasUntrackedPDFImages({fnArray:[88]},ops)).toBe(true)
    expect(hasUntrackedPDFImages({fnArray:[83]},ops)).toBe(true)
    expect(hasUntrackedPDFImages({fnArray:[1,85]},ops)).toBe(false)
    expect(hasUntrackedPDFImages({fnArray:[undefined]},{})).toBe(false)
  })
})

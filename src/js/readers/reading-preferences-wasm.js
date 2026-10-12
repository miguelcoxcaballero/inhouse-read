import {getRustCore} from '../rust-core.js'

export function rustNearestRate(value) {
  const core=getRustCore()
  return core?.reader_nearest_rate ? core.reader_nearest_rate(value) : undefined
}

export function rustReadingNumbers(input) {
  const core=getRustCore()
  if (!core?.reader_preferences) return null
  let pointer=0
  try {
    const number=key=>input[key]==null||input[key]===''?NaN:Number(input[key])
    const values=[number('fontSize'),number('lineHeight'),number('margin'),number('zoom'),number('rate'),number('brightness'),Number(input.fontWeight),0]
    pointer=core.alloc_f64(8)
    if(!pointer)return null
    new Float64Array(core.memory.buffer,pointer,8).set(values)
    if(core.reader_preferences(pointer)!==1)return null
    return Array.from(new Float64Array(core.memory.buffer,pointer,8))
  } catch {return null}
  finally {if(pointer)core.free_f64(pointer,8)}
}

const themes=['paper','sepia','night','amoled','sage'],fonts=['book','classic','sans','mono']
// Retain decoded strings at the browser boundary. Chapters reuse the same CSS;
// there is no reason to reformat, copy and decode it for each style element.
// Keys include every field used by reader_css; per-core identity prevents a
// cached string from surviving a kernel replacement in tests or recovery.
const styles=new WeakMap()
let decoder
export function rustReadingCSS(p) {
  const core=getRustCore(),theme=themes.indexOf(p.theme),font=fonts.indexOf(p.font)
  if(!core?.reader_css||theme<0||font<0)return null
  let cache=styles.get(core)
  if(!cache){cache=new Map();styles.set(core,cache)}
  const key=[theme,font,p.fontSize,p.fontWeight,p.lineHeight,p.align==='justify'].join('|')
  if(cache.has(key))return cache.get(key)
  let pointer=0
  try {
    // Preferences and an 8 KiB UTF-8 output in one bounded, released arena.
    pointer=core.alloc_f64(1032)
    if(!pointer)return null
    new Float64Array(core.memory.buffer,pointer,8).set([p.fontSize,p.lineHeight,p.margin,p.zoom,p.rate,p.brightness,p.fontWeight,0])
    const count=core.reader_css(pointer,theme,font,Number(p.align==='justify'),pointer+64,8192)
    if(!Number.isInteger(count)||count<1||count>8192)return null
    const css=(decoder??=new TextDecoder()).decode(new Uint8Array(core.memory.buffer,pointer+64,count))
    if(cache.size>=64)cache.delete(cache.keys().next().value)
    cache.set(key,css)
    return css
  } catch {return null}
  finally {if(pointer)core.free_f64(pointer,1032)}
}

import {it,expect} from 'vitest'
import {rustUI} from './helpers/rust-ui-ready.js'
const metadata={wordCount:21600,wordCountComplete:true}
const at=fraction=>({fraction,locator:{kind:'cfi',value:'here'}})
const metrics=(location=at(0),rate=1,s={},active=false,words=metadata)=>rustUI.reader_reading_metrics(s,location,words,rate,active)
it('shows percentage and stable EPUB reference pages without enabling audio',()=>{
 expect(metrics(at(.5))).toEqual({compact:'50 % · 37/72',pagesDescription:'Páginas de referencia 37/72 (300 palabras por página)',time:'1h 00min'})
 expect(metrics(at(1)).compact).toBe('100 % · 72/72')
 expect(metrics(at(1)).time).toBe('0h 00min')
})
it.each([[.5,'4h 00min'],[1,'2h 00min'],[1.5,'1h 20min'],[2,'1h 00min'],[NaN,'2h 00min'],[0,'2h 00min']])('scales the remaining estimate at %s speed', (rate,time)=>expect(metrics(at(0),rate).time).toBe(time))
it('does not invent pages or time when text has not been counted',()=>{
 expect(metrics(at(.5),1,{},false,{})).toMatchObject({compact:'50 % · —/—',time:'—h —min'})
 expect(metrics(at(0),1,{},false,{wordCount:-5,wordCountComplete:true}).time).toBe('—h —min')
})
it('keeps unread text on the final PDF page and in single-page PDFs',()=>{
 const location={fraction:1,locator:{kind:'pdf-page',value:4}}
 expect(metrics(location,1,{reader:{s:{doc:{numPages:4}}}})).toMatchObject({compact:'100 % · 4/4',time:'0h 30min'})
 expect(metrics({fraction:0,locator:{kind:'pdf-page',value:1}},1,{reader:{s:{doc:{numPages:1}}}}).time).toBe('2h 00min')
})
it('uses the audible PDF cursor while browsing a different page',()=>{
 const s={reader:{s:{doc:{numPages:4},speechCursor:{page:2,start:50,source:{text:'x'.repeat(100)}}}}}
 const location={fraction:1,locator:{kind:'pdf-page',value:4}}
 expect(metrics(location,1,s,true).time).toBe('1h 15min')
 expect(metrics(location,2,s,true).time).toBe('0h 38min')
})
it('uses the independent EPUB audio cursor and updates as sentences advance',()=>{
 const current={index:3,offset:50,map:{text:'x'.repeat(100)}}
 const s={reader:{s:{speechCursor:{current,browsing:true,progress:{getProgress:(index,ratio)=>({fraction:.2+ratio*.2})}}}}}
 expect(metrics(at(.9),1,s,true).time).toBe('1h 24min')
 current.offset=100
 expect(metrics(at(.9),1,s,true).time).toBe('1h 12min')
})
it('reports zero for an empty text and caps out-of-range positions',()=>{
 expect(metrics(at(-2)).compact).toBe('0 % · 1/72')
 expect(metrics(at(5)).time).toBe('0h 00min')
 expect(metrics(at(0),1,{},false,{wordCount:0,wordCountComplete:true}).time).toBe('0h 00min')
})

import {beforeAll,beforeEach,it,expect,vi} from 'vitest'
import {readFileSync} from 'node:fs'
import * as ui from '../../src/wasm/ui/inhouse_read_ui.js'
import {batchSpineStyles} from '../../src/js/spine-styles.js'
import {spineStyleFor,layoutShelves,planBookshelf,SPINE_PALETTE} from '../../src/js/bookshelf-layout.js'
const runtime=vi.hoisted(()=>({ui:null,calls:0}));vi.mock('../../src/js/rust-ui.js',()=>({getRustUI:()=>runtime.ui}));
let wasm;const native={...ui,shelf_spine_styles:(...args)=>{runtime.calls++;return ui.shelf_spine_styles(...args)}};
const books=Array.from({length:700},(_,index)=>({id:index%11===0?'😀日本語عنوان '+index:'local:Immune Journey-'+index+':48291',wordCount:index%5===0?undefined:index*655+(index%11)/3,title:'Book '+index,author:'Author',shelfOrder:index}));
beforeAll(()=>{wasm=ui.initSync({module:readFileSync('src/wasm/ui/inhouse_read_ui_bg.wasm')})});beforeEach(()=>{runtime.ui=native;runtime.calls=0});
for(const opts of [{},{minWidth:0,maxWidth:180},{minWidth:2,maxWidth:20,pageThickness:.039,bindingThickness:2.25},{minWidth:0,maxWidth:50,pageThickness:-1},{minHeightRatio:0,maxHeightRatio:1.16}])it('preserves every style and palette identity '+JSON.stringify(opts),()=>{
 const actual=batchSpineStyles(books,opts),expected=books.map(book=>spineStyleFor(book,opts));expect(actual).toEqual(expected);for(let i=0;i<books.length;i++)expect(actual[i].palette).toBe(expected[i].palette);expect(runtime.calls).toBe(1);expect(ui.ui_live_handles()).toBe(0);
});
for(const id of ['A\0B','\ud800','\udc00'])it('preserves UTF-16 fallback '+JSON.stringify(id),()=>{const book={id,wordCount:1000};expect(batchSpineStyles([book])).toEqual([spineStyleFor(book)]);expect(runtime.calls).toBe(0)});
it('preserves fallback for unavailable, incomplete and failed modules',()=>{for(const module of [null,{}, {shelf_spine_styles:()=>{throw Error('Unavailable')}}]){runtime.ui=module;expect(batchSpineStyles(books.slice(0,20))).toEqual(books.slice(0,20).map(book=>spineStyleFor(book)))}});
it('rejects malformed returned indices, incomplete vectors and nonfinite values',()=>{for(const result of [new Float64Array(1),new Float64Array([99,30,.85,0]),new Float64Array([0,30,.85,99]),new Float64Array([0,NaN,.85,0])]){runtime.ui={shelf_spine_styles:()=>result};expect(batchSpineStyles([books[0]])).toEqual([spineStyleFor(books[0])])}});
it('preserves complete shelf plans, references, order, plants and callbacks',()=>{
 const list=books.slice(0,50),options={sort:'none',recentLimit:0,shelfWidth:390,spine:{pageThickness:.046,bindingThickness:2.6,minWidth:6,maxWidth:54},displayWidthFor:(_book,style)=>Math.max(16,style.width),plantWidthFor:variant=>variant==='monstera'?64:58};
 const expected=planBookshelf(list,options),actual=planBookshelf(list,options,batchSpineStyles);expect(actual).toEqual(expected);expect(runtime.calls).toBe(1);const placed=actual.flatMap(section=>section.shelves.flatMap(shelf=>shelf.items.filter(item=>item.kind==='book').map(item=>item.book)));expect(placed).toEqual(list);for(let i=0;i<list.length;i++)expect(placed[i]).toBe(list[i]);
});
it('retains original style evaluation when no prepared array was supplied',()=>{const list=books.slice(0,3).map(book=>({...book}));const options={plantEvery:100,maxTailPlants:0,displayWidthFor:(book,style)=>{list[1].wordCount=80000;return style.width}};const actual=layoutShelves(list,options);expect(actual[0].items.filter(item=>item.kind==='book')[1].style).toEqual(spineStyleFor(list[1]));expect(runtime.calls).toBe(0)});
it('keeps empty and bounded raw packets safe',()=>{
 const config=new Float64Array([0,100,0,1,.04,2,12,4]);expect(batchSpineStyles([])).toEqual([]);expect(batchSpineStyles(null)).toEqual([]);for(const [seeds,pages,cfg] of [['one',new Float64Array(),config],['one',new Float64Array([NaN]),config],['one',new Float64Array([1]),new Float64Array(3)],['x'.repeat(1048577),new Float64Array([1]),config],['one',new Float64Array([1]),new Float64Array([-1,100,0,1,.04,2,12,4])]])expect(ui.shelf_spine_styles(seeds,pages,cfg)).toBeUndefined();
});
it('keeps memory and native handles stable over 200 large batches',()=>{batchSpineStyles(books);const capacity=wasm.memory.buffer.byteLength,before=ui.ui_live_handles();for(let i=0;i<200;i++)batchSpineStyles(books);expect(wasm.memory.buffer.byteLength).toBe(capacity);expect(ui.ui_live_handles()).toBe(before);expect(runtime.calls).toBe(201)});

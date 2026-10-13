import {DEFAULT_SPINE,SPINE_PALETTE,SPINE_TEXTURES,withDefaults,seedFor,spineStyleFor} from './bookshelf-layout.js'
import {printedPageCount} from './book-length.js'
import {getRustUI} from './rust-ui.js'
export function batchSpineStyles(books,options={}){
 const ui=getRustUI();
 if(!Array.isArray(books))return [];
 if(!ui?.shelf_spine_styles||books.length>4096)return books.map(book=>spineStyleFor(book,options));
 const cfg=withDefaults(DEFAULT_SPINE,options),fields=[cfg.minWidth,cfg.maxWidth,cfg.minHeightRatio,cfg.maxHeightRatio,cfg.pageThickness??0,cfg.bindingThickness??0,SPINE_PALETTE.length,SPINE_TEXTURES.length];
 if(!fields.every(value=>typeof value==='number'&&Number.isFinite(value)))return books.map(book=>spineStyleFor(book,options));
 const seeds=books.map(seedFor);
 // Preserve JS UTF-16 hashing. The UTF-8 bindgen boundary replaces lone
 // surrogates, so those inputs and NUL separators retain the original path.
 if(seeds.some(seed=>seed.includes('\0')||!(typeof seed.isWellFormed==='function'?seed.isWellFormed():!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(seed))))return books.map(book=>spineStyleFor(book,options));
 const packet=seeds.join('\0');if(packet.length>1_048_576)return books.map(book=>spineStyleFor(book,options));
 let result;try{result=ui.shelf_spine_styles(packet,new Float64Array(books.map(printedPageCount)),new Float64Array(fields))}catch{}
 if(!result||result.length!==books.length*4)return books.map(book=>spineStyleFor(book,options));
 for(let i=0;i<result.length;i+=4)if(!Number.isInteger(result[i])||!SPINE_PALETTE[result[i]]||!Number.isInteger(result[i+3])||!SPINE_TEXTURES[result[i+3]]||!Number.isFinite(result[i+1])||!Number.isFinite(result[i+2]))return books.map(book=>spineStyleFor(book,options));
 return seeds.map((seed,index)=>{const from=index*4,palette=SPINE_PALETTE[result[from]];return{seed,palette,color:palette.base,shade:palette.shade,ink:palette.ink,width:result[from+1],heightRatio:result[from+2],texture:SPINE_TEXTURES[result[from+3]]}});
}

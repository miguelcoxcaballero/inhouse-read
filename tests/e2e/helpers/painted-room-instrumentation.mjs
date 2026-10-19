// Test-only instrumentation of the real pose immediately before updateMatrix.
// Refuse stale hooks instead of silently comparing empty capture dictionaries.
const identifier='[A-Za-z_$][\\w$]*';
function argumentsAt(source,open){
 const args=[];let start=open+1,depth=0,quote='';
 for(let i=start;i<source.length;i++){
  const ch=source[i];
  if(quote){if(ch==='\\'){i++;continue;}if(ch===quote)quote='';continue;}
  if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
  if(ch==='('||ch==='['||ch==='{'){depth++;continue;}
  if(ch===')'&&!depth){args.push(source.slice(start,i));return args;}
  if(ch===')'||ch===']'||ch==='}'){depth--;continue;}
  if(ch===','&&!depth){args.push(source.slice(start,i));start=i+1;}
 }
 throw Error('Painted room probe: unterminated motion-frame preparation');
}
export function instrumentPaintedRoom(body){
 const native=[...body.matchAll(new RegExp(`(${identifier})\\.localMotionPose=\\[(${identifier})\\.key\\(`,'g'))];
 let entry,width,ppm,rows,at;
 if(native.length){
  if(native.length!==1)throw Error('Painted room probe: ambiguous native pose assignment');
  const match=native[0];[,entry]=match;at=match.index;
  const prepare=`${match[2]}.prepare(`,prepareAt=body.lastIndexOf(prepare,at);
  if(prepareAt<0)throw Error('Painted room probe: missing native motion-frame preparation');
  const args=argumentsAt(body,prepareAt+prepare.length-1);
  if(args.length!==4||args.some(arg=>!arg.trim()))throw Error('Painted room probe: unexpected motion-frame preparation');
  [,rows,width,ppm]=args;
 }else{
  // Keep baseline releases observable while comparisons straddle the migration.
  const legacy=[...body.matchAll(new RegExp(`(${identifier})\\.localMotionPose=\\[${identifier},${identifier}\\.shelf\\|\\|0,\\(${identifier}\\.x\\+(${identifier})\\/2-\\(${identifier}\\.left\\|\\|0\\)\\)\\/(${identifier})`,'g'))];
  if(legacy.length!==1)throw Error('Painted room probe: expected exactly one real scene pose hook');
  const match=legacy[0];[,entry,width,ppm]=match;at=match.index;
  rows=body.slice(Math.max(0,at-180),at).match(new RegExp(`(${identifier})\\[${identifier}\\.shelf\\|\\|0\\]`))?.[1];
  if(!rows)throw Error('Painted room probe: missing legacy room rows');
 }
 const point=`${entry}.pose.updateMatrix()`,pointAt=body.indexOf(point,at);
 if(pointAt<0)throw Error('Painted room probe: missing real pose matrix update');
 return body.slice(0,pointAt)+`(globalThis.__captureRoomPaint(${entry},(${ppm}),(${width}),(${rows})),${point})`+body.slice(pointAt+point.length);
}

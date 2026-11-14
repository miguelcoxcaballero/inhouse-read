// Test-only instrumentation of the real pose immediately before updateMatrix.
// Refuse stale hooks instead of silently comparing empty capture dictionaries.
const identifier='[A-Za-z_$][\\w$]*';
const literal=name=>name.replace(/\$/g,'\\$');
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
 const arena=native.length?[]:[...body.matchAll(new RegExp(`(${identifier})&2&&\\((${identifier})\\.matrix\\.fromArray\\((${identifier}),(${identifier})\\+26\\)`,'g'))];
 let entry,width,ppm,rows,at;
 if(native.length){
  if(native.length!==1)throw Error('Painted room probe: ambiguous native pose assignment');
  const match=native[0];[,entry]=match;at=match.index;
  const prepare=`${match[2]}.prepare(`,prepareAt=body.lastIndexOf(prepare,at);
  if(prepareAt<0)throw Error('Painted room probe: missing native motion-frame preparation');
  const args=argumentsAt(body,prepareAt+prepare.length-1);
  if(args.length!==4||args.some(arg=>!arg.trim()))throw Error('Painted room probe: unexpected motion-frame preparation');
  [,rows,width,ppm]=args;
 }else if(arena.length){
  // The pose and its shared key never leave the entry arena: there is no per-entry pose record to hook. The copy of
  // the natively taken matrix is the one place where the frame's pose is complete, so the probe reads there the
  // entry that owns the pose, its index in the frame and the key the motion frame registered for that index.
  if(arena.length!==1)throw Error('Painted room probe: ambiguous native matrix copy');
  const [,changed,pose,,offset]=arena[0],before=body.slice(0,arena[0].index);
  const last=(pattern,message)=>{const found=[...before.matchAll(pattern)].at(-1);if(!found)throw Error(message);return found;};
  [,entry]=last(new RegExp(`[,; ]${literal(pose)}=(${identifier})\\.pose[,;]`,'g'),'Painted room probe: missing owner of the native pose');
  const [,index]=last(new RegExp(`[,; ]${literal(offset)}=(${identifier})\\*`,'g'),'Painted room probe: missing entry index of the native pose');
  const prepared=[...before.matchAll(new RegExp(`(${identifier})\\.prepare\\(`,'g'))]
   .map(match=>({frame:match[1],args:argumentsAt(body,match.index+match[0].length-1)}))
   .filter(call=>call.args.length===4&&call.args.every(arg=>arg.trim())).at(-1);
  if(!prepared)throw Error('Painted room probe: missing native motion-frame preparation');
  [,rows,width,ppm]=prepared.args;
  const capture=`globalThis.__captureRoomPaint(${entry},(${ppm}),(${width}),(${rows}),${prepared.frame}.key(${index}))`;
  return before+`(${capture},${changed})`+body.slice(arena[0].index+changed.length);
 }else{
  // Keep baseline releases observable while comparisons straddle the migration.
  const legacy=[...body.matchAll(new RegExp(`(${identifier})\\.localMotionPose=\\[${identifier},${identifier}\\.shelf\\|\\|0,\\(${identifier}\\.x\\+(${identifier})\\/2-\\(${identifier}\\.left\\|\\|0\\)\\)\\/(${identifier})`,'g'))];
  if(legacy.length!==1)throw Error('Painted room probe: expected exactly one real scene pose hook');
  const match=legacy[0];[,entry,width,ppm]=match;at=match.index;
  rows=body.slice(Math.max(0,at-180),at).match(new RegExp(`(${identifier})\\[${identifier}\\.shelf\\|\\|0\\]`))?.[1];
  if(!rows)throw Error('Painted room probe: missing legacy room rows');
 }
 const capture=`globalThis.__captureRoomPaint(${entry},(${ppm}),(${width}),(${rows}))`;
 // The matrix is taken natively and copied in only when it changed; the pose it was made from is complete just before
 // that copy, on every frame.
 const copied=new RegExp(`(${identifier})&2&&\\(${identifier}\\.matrix\\.fromArray\\(`,'g');copied.lastIndex=at;
 const copy=copied.exec(body);
 if(copy&&!body.slice(at,copy.index).includes(';'))return body.slice(0,copy.index)+`(${capture},${copy[1]})`+body.slice(copy.index+copy[1].length);
 const point=`${entry}.pose.updateMatrix()`,pointAt=body.indexOf(point,at);
 if(pointAt<0)throw Error('Painted room probe: missing real pose matrix update');
 return body.slice(0,pointAt)+`(${capture},${point})`+body.slice(pointAt+point.length);
}

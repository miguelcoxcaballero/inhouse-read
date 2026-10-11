export const colorMaskPalette = ['#111111','#eeeeee','#a12638','#2f6b4f','#2b4f91',
  '#ccaa48','#816047','#914c9a','#418f98','#db8451'];
export const colorMaskCases = [
  { name:'preview', width:64, height:96, kind:'panels' },
  { name:'gate-size', width:128, height:128, kind:'panels' },
  { name:'shelf', width:171, height:256, kind:'panels' },
  { name:'large-cover', width:341, height:512, kind:'panels' },
  { name:'photographic', width:192, height:288, kind:'noise' },
  { name:'square-gradient', width:512, height:512, kind:'ramp' },
  { name:'alpha-boundaries', width:171, height:256, kind:'alpha' },
];
export const colorMaskBenchCases = [
  ...[3,5,10].flatMap(layers=>[
    {name:`shelf-${layers}`,width:171,height:256,kind:'panels',layers},
    {name:`large-${layers}`,width:341,height:512,kind:'panels',layers},
    {name:`photo-${layers}`,width:512,height:512,kind:'noise',layers},
  ]),
  ...[1,2].map(layers=>({name:`bypass-${layers}`,width:341,height:512,kind:'panels',layers})),
  {name:'small-preview',width:64,height:96,kind:'panels',layers:10},
  {name:'sparse-alpha-3',width:341,height:512,kind:'alpha',layers:3},
  {name:'sparse-alpha-10',width:341,height:512,kind:'alpha',layers:10},
];
const rgb = color => [1,3,5].map(at => parseInt(color.slice(at,at+2),16));
export function makeColorMaskImage({ width, height, kind }) {
  const data=new Uint8ClampedArray(width*height*4), palette=colorMaskPalette.map(rgb);
  let state=0x54a7b8f3;
  const next=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state>>>24;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4,index=Math.min(9,Math.floor(x/width*10));let color;
    if(kind==='noise')color=[next(),next(),next()];
    else if(kind==='ramp')color=[Math.round(x/Math.max(1,width-1)*255),Math.round(y/Math.max(1,height-1)*255),Math.round((x+y)/Math.max(1,width+height-2)*255)];
    else if(kind==='overlap')color=[80,80,80];
    else color=palette[index].map((byte,channel)=>Math.max(0,Math.min(255,byte+((y+channel)%13===0?x%7-3:0))));
    data.set(color,at);data[at+3]=kind==='alpha'?[0,127,128,129,254,255][(x+y)%6]:255;
  }
  return {width,height,data};
}
export function colorMaskSelection(count,{overlap=false}={}) {
  const colors=overlap?['#505050','#515151','#777777']:colorMaskPalette;
  return {layers:colors.slice(0,count).map((color,index)=>({id:`color-${index+1}`,color,
    tolerance:overlap?12:[1,5.4,6,8.75,12][index%5],strength:[0,.01,.42,.75,1][index%5]}))};
}

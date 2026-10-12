export function layout(text,cuts,{rtl=false,vertical=false,spans=[[0,text.length]],empty=false}={}){
 const doc={body:{dir:rtl?'rtl':''},documentElement:{},defaultView:{getComputedStyle:()=>({direction:rtl?'rtl':'ltr',writingMode:vertical?'vertical-rl':'horizontal-tb'})}};
 const rect=offset=>{const page=cuts.filter(c=>c<=offset).length,position=page*100+10;return {left:rtl?10000-position-8:position,right:rtl?10000-position:position+8,top:vertical?position:10,bottom:vertical?position+12:22,width:8,height:12}};
 const calls=[];return {text,spans:spans.map(([start,end])=>({start,end,node:{ownerDocument:doc}})),calls,rangeFor(start,end){this.calls.push([start,end]);return empty?null:{getClientRects:()=>[...[start,...cuts.filter(c=>c>start&&c<end)].map(rect),{width:0,height:12,left:5000,top:0,right:5000}]}}};
}

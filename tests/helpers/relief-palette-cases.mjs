import {makeColorMaskImage} from './color-mask-cases.mjs';
export const reliefPaletteCases = [
  {name:'small-bypass',width:32,height:48,kind:'panels'},
  {name:'gate',width:64,height:64,kind:'panels'},
  {name:'flat-cover',width:192,height:288,kind:'flat'},
  {name:'bicolor-cover',width:192,height:288,kind:'bicolor'},
  {name:'ten-pigments',width:192,height:288,kind:'panels'},
  {name:'photograph',width:192,height:288,kind:'noise'},
  {name:'square-gradient',width:288,height:288,kind:'ramp'},
  {name:'transparent-cover',width:192,height:288,kind:'alpha'},
];
export function makeReliefPaletteImage(input) {
  const image=makeColorMaskImage(input);
  if(input.kind==='flat'||input.kind==='bicolor')for(let i=0;i<image.data.length;i+=4)
    image.data.set(input.kind==='bicolor'&&(i/4)%input.width>=input.width/2?[212,169,60,255]:[35,80,181,255],i);
  return image;
}
export const drainPalette=task=>{let step;do{step=task.next();}while(!step.done);return step.value;};

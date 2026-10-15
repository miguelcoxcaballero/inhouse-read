import {makeReliefPaletteImage,drainPalette} from './relief-palette-cases.mjs';
import {rustReliefPalette} from '../unit/helpers/reference-palette-bridge.js';
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
const same=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error('Relief palette or metadata changed');};
export async function observeReliefPalette({input,original,production,core,hash,stats,pause=async()=>{}}){
  const image=makeReliefPaletteImage(input),before=await hash(image.data);
  const referencePalette=()=>{
    const histogram=drainPalette(original.internals.colorHistogram(image));
    return {...histogram,colors:drainPalette(original.internals.colorCandidates(histogram.bins,histogram.opaque))};
  };
  const candidatePalette=()=>drainPalette(rustReliefPalette(core,image,original.internals.rgbToOklab));
  const expected=referencePalette(),actual=candidatePalette();
  if(!actual)throw new Error('Direct Rust palette fell back');same(actual,expected);
  async function signature(value){return {metadata:{...value,chosen:undefined,candidates:undefined},
    chosen:await Promise.all(value.chosen.map(async item=>({...item,mask:{bytes:item.mask.byteLength,sha256:await hash(item.mask)}})))};}
  const originalFull=drainPalette(original.analyzePixels(image)),callsBefore=stats.jobs;
  const candidateFull=drainPalette(production.analyzePixels(image)),productionJobs=stats.jobs-callsBefore;
  same(await signature(candidateFull),await signature(originalFull));
  // Every size takes the native analysis (the old small-image bypass is gone).
  if(productionJobs!==1)throw new Error('Production routing differed');
  const stages={};
  for(const stage of ['palette','full']){
    const run=rust=>stage==='palette'?(rust?candidatePalette():referencePalette()):drainPalette((rust?production:original).analyzePixels(image));
    const checksum=value=>stage==='palette'?JSON.stringify(value.colors):JSON.stringify(value.chosen.map(item=>[item.color,item.facts,item.mask[0],item.mask.at(-1)]));
    const expectedChecksum=checksum(run(false)),samples={javascript:[],rust:[]},orders=[];
    for(let i=0;i<2;i++)for(const rust of [false,true]){same(checksum(run(rust)),expectedChecksum);await pause();}
    for(let i=0;i<9;i++){
      const order=i%2?['rust','javascript']:['javascript','rust'];orders.push(order);
      for(const kind of order){const at=performance.now(),result=run(kind==='rust');samples[kind].push(performance.now()-at);
        same(checksum(result),expectedChecksum);await pause();}
    }
    stages[stage]={samples,orders,javascriptMedianMs:median(samples.javascript),rustMedianMs:median(samples.rust),
      javascriptP95Ms:percentile(samples.javascript,.95),rustP95Ms:percentile(samples.rust,.95)};
  }
  same(await hash(image.data),before);
  if(stats.liveJobs!==0)throw new Error('Palette job leak');
  return {input,inputSha256:before,binCount:expected.bins.length,colors:expected.colors.map(item=>({color:item.rgb,supported:item.supported})),
    productionJobs,proof:await signature(candidateFull),stages,stats:{...stats},
    methodology:{warmups:2,rounds:9,wholeAnalyzePixels:true,bothUseExistingRustMasks:true,copiesAndCleanupIncluded:true}};
}

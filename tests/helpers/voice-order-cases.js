export const collator=(a,b,spanish)=>spanish?a.localeCompare(b,'es'):a.localeCompare(b)
export function makeCases(){
 let seed=217;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
 const bases=['es','en','fr','de','it','pt','ca','nl','ar','uk','hu','gl','ja','eu','vi','hi','bg','sr','xx']
 const regions=['ES','US','GB','MX','AR','CL','FR','BR','PT','','BE','419']
 const names=['Álex','alex','Zoé','Zoe','Óscar','Núria','Jeroen','Åse','2','10','中国','😀','\ud800','\udc00','Ipek','İpek','ıpek','A\u0301lex','']
 const cases=[]
 for(let i=0;i<1600;i++){
  const voices=[];for(let j=0,n=i%65;j<n;j++){
   const base=bases[Math.floor(random()*bases.length)],region=regions[Math.floor(random()*regions.length)]
   voices.push({id:'piper:'+names[Math.floor(random()*names.length)]+j%9,name:names[Math.floor(random()*names.length)],base,region,lang:base+(region?'-'+region:''),neural:random()>.05,recommended:random()>.7,tier:random()>.8?'high':'medium'})
  }
  if(i%7===0)voices.push(null,undefined);if(i%11===0&&voices[0])voices.push(voices[0])
  const book=[...bases,'es-MX','pt_BR','eng-US','nld-NL','',null,false][i%27],device=[...bases,'en-US','es-ES','pt-PT',''][i%23]
  cases.push([voices,book,device])
 }
 return cases
}

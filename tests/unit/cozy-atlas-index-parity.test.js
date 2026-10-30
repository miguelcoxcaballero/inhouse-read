// The atlas index moved from cozy-sounds.js to rust-ui cozy_atlas.rs: every group, take, field
// identity and order must match the frozen JavaScript original for valid, broken and odd indexes.
import {expect,it} from 'vitest'
import {indexShelfSoundAtlas} from '../../src/js/cozy-sounds.js'
import {indexShelfSoundAtlas as frozen} from './helpers/reference-cozy-sounds.js'
const shape=map=>[...map].map(([group,takes])=>[group,takes.map(take=>Object.entries(take))])
const same=(index,samples)=>{
 const expected=frozen(index,samples),actual=indexShelfSoundAtlas(index,samples)
 expect(actual).toBeInstanceOf(Map)
 expect(shape(actual)).toEqual(shape(expected))
 for(const [group,takes] of expected)takes.forEach((take,i)=>{for(const key of ['offset','length','rate'])expect(Object.is(actual.get(group)[i][key],take[key])).toBe(true)})
}
it('groups the same takes as the frozen index for valid, broken and odd clips',()=>{
 for(const index of [null,undefined,0,'atlas',[],{},()=>{},[{offset:0,length:4}],
  {a_t0:{offset:0,length:2},b_t1:{offset:1,length:5},c:{offset:'0',length:2}},
  {x_t:{offset:0,length:2},_t12:{offset:0,length:2},'a_t1_t2':{offset:0,length:3},'a_t1':{offset:2,length:2},'z_t٣':{offset:0,length:2}},
  {r_t0:{offset:0,length:2,rate:7999},r_t1:{offset:0,length:2,rate:8000},r_t2:{offset:0,length:2,rate:96000},r_t3:{offset:0,length:2,rate:96001},
   r_t4:{offset:0,length:2,rate:'24000'},r_t5:{offset:0,length:2,rate:null},r_t6:{offset:0,length:2,rate:NaN},r_t7:{offset:0,length:2,rate:{}}},
  {n_t0:null,n_t1:5,n_t2:'clip',n_t3:{offset:-0,length:2},n_t4:{offset:1.5,length:2},n_t5:{offset:0,length:1},n_t6:{offset:Infinity,length:2},
   n_t7:{offset:3,length:2},n_t8:{offset:2,length:2},constructor:{offset:0,length:2},__proto__:{offset:0,length:2}}])
  for(const samples of [0,4,5,1e9,NaN])same(index,samples)
 let seed=91;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
 for(let trial=0;trial<300;trial++){
  const index={}
  for(let i=0;i<next()%30;i++)index[`${['book','pot','lamp'][next()%3]}_${['wood','glass'][next()%2]}${next()%4?`_t${next()%9}`:''}`+(next()%7?'':'_x')]={offset:next()%200-10,length:next()%60,...(next()%3?{rate:[8000,24000,44100,96000,100000][next()%5]}:{})}
  same(index,next()%400)
 }
})

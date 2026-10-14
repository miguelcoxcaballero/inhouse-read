// Mono Float32 speed-up adaptation of Sonic (Copyright 2010 Bill Cox,
// Apache-2.0; public/licenses/sonic-Apache-2.0.txt). The model generates a
// complete normal-speed sentence, then PICOLA shortens periods without
// changing pitch. Playback completion still uses the resulting sample clock.
// Frozen from f5abb75: the JavaScript tempo (Sonic/PICOLA adaptation) before the Rust core became the only one.

export const synthesisRate = rate => Math.min(1, Math.max(.5, Number(rate) || 1))

// Exact cold/older-core fallback, also the independent reference for the WASM
// tests. O(utterance), fixed search window, bounded scratch, no audio objects.
export function speechTempoJS(pcm, sampleRate, speed, positions = []) {
  if (speed === 1 || !pcm.length) return {pcm, positions:[...positions]}
  const min = Math.floor(sampleRate/400), max = Math.floor(sampleRate/65), required = max*2
  const skip = Math.max(1,Math.floor(sampleRate/4000)), down = new Float64Array(Math.floor(required/skip))
  const output = new Float32Array(pcm.length), mapped = [...positions]
  let pos=0,written=0,mark=0,previous=0,previousDiff=0
  function periodIn(samples,offset,min,max) {
    let best=min,low=Infinity,high=0
    for(let p=min;p<=max;p++) {
      let diff=0
      for(let i=0;i<p;i++)diff+=Math.abs(samples[offset+i]-samples[offset+i+p])
      diff/=p
      if(diff<low){low=diff;best=p}
      high=Math.max(high,diff)
    }
    return [best,low,high]
  }
  while(pos<pcm.length) {
    const start=pos,dest=written,error=written-pos/speed
    if(pos+required>pcm.length || (speed<2 && error<0)) {
      const copy=pos+required>pcm.length ? pcm.length-pos : Math.max(1,Math.min(pcm.length-pos,Math.floor(1-error*speed/(speed-1))))
      output.set(pcm.subarray(pos,pos+copy),written);pos+=copy;written+=copy
    } else {
      for(let i=0;i<down.length;i++){let sum=0;for(let j=0;j<skip;j++)sum+=pcm[pos+i*skip+j];down[i]=sum/skip}
      const [coarse]=periodIn(down,0,Math.floor(min/skip),Math.floor(max/skip)),center=coarse*skip
      const [period,low,high]=periodIn(pcm,pos,Math.max(min,center-4*skip),Math.min(max,center+4*skip))
      const p=low!==0 && previous>0 && high<=low*3 && low*2>previousDiff*3 ? previous : period
      previous=period;previousDiff=low
      const n=speed>=2?Math.floor(p/(speed-1)):p
      for(let i=0;i<n;i++)output[written+i]=(pcm[pos+i]*(n-i)+pcm[pos+p+i]*i)/n
      pos+=p+n;written+=n
    }
    while(mark<mapped.length && mapped[mark]<pos) {
      mapped[mark]=Math.round(dest+(mapped[mark]-start)*(written-dest)/(pos-start));mark++
    }
  }
  return {pcm:output.slice(0,written),positions:mapped.map(n=>Math.min(written-1,n))}
}

/** Transform marks along with their waveform; do not divide timestamps again. */
export function speedUpSpeech(pcm,sampleRate,rate,marks=[]) {
  const speed=Math.max(1,Math.min(3,Number(rate)||1))
  if(speed===1 || !pcm.length)return {pcm,marks}
  if(!(pcm instanceof Float32Array) || pcm.length>4194304 || !Number.isInteger(sampleRate)
    || sampleRate<8000 || sampleRate>96000 || pcm.some(n=>!Number.isFinite(n)))throw new Error('Invalid speech tempo input')
  const sorted=marks.filter(m=>Number.isInteger(m.sample)&&m.sample>=0&&m.sample<pcm.length).sort((a,b)=>a.sample-b.sample)
  if(sorted.length>128)throw new Error('Too many speech boundaries')
  const positions=sorted.map(m=>m.sample)
  const result=speechTempoJS(pcm,sampleRate,speed,positions)
  return {pcm:result.pcm,marks:sorted.map((m,i)=>({...m,sample:result.positions[i]}))}
}

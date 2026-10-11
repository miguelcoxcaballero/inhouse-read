export const pcmCases = [
  { name:'empty', count:0 }, { name:'one', count:1 }, { name:'odd short', count:93 },
  { name:'below cutoff', count:4095 }, { name:'at cutoff', count:4096 },
  { name:'digital silence', count:48000, kind:'silence' },
  { name:'quiet noise', count:44100, amplitude:.00001 },
  { name:'NVCC speech', count:66150, amplitude:.033, model:'no_NO-nvcc-medium' },
  { name:'NVCC sparse click', count:66150, kind:'click', model:'no_NO-nvcc-medium' },
  { name:'NVCC loud speech', count:132300, amplitude:.3, model:'no_NO-nvcc-medium' },
  { name:'Piper 5 seconds', count:110250, rate:22050 },
  { name:'Supertonic 12 seconds', count:288000, rate:24000 },
  { name:'long fragment', count:1440000, rate:48000 },
  { name:'unity gain', count:96000, kind:'unity' },
  { name:'subnormals', count:4097, kind:'subnormal' },
  { name:'fractional rate', count:88201, rate:11025.125 },
];
export function makePCM(input) {
  const out = new Float32Array(input.count), amp = input.amplitude ?? .3;
  let seed = 97;
  for (let i = 0; i < out.length; i++) {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    out[i] = i < out.length * .12 || i > out.length * .86 ? (i%2 ? -0 : 0)
      : ((seed/4294967296)-.5)*amp;
  }
  if (input.kind==='silence') out.fill(0);
  if (input.kind==='click') { out.fill(0); out[out.length>>1]=.033; }
  if (input.kind==='unity') { out.fill(.9); out[0]=-.9; }
  if (input.kind==='subnormal') for(let i=0;i<out.length;i++)out[i]=i%2 ? -1e-43 : 1e-43;
  return out;
}

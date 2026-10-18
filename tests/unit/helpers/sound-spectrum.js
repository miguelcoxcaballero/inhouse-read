// Independent radix-2 FFT used to check the delivered PCM's actual bandwidth.
export function trebleFraction(bin,clip){
 const n=4096;let all=0,high=0;
 for(let start=0;start<clip.length;start+=n/2){
 const re=new Float64Array(n),im=new Float64Array(n);
 for(let i=0;i<n&&i+start<clip.length;i++)re[i]=bin.readInt16LE((clip.offset+start+i)*2)/32768*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
 for(let size=2;size<=n;size*=2){const half=size/2;
  for(let base=0;base<n;base+=size)for(let j=0;j<half;j++){
   const angle=-2*Math.PI*j/size,c=Math.cos(angle),s=Math.sin(angle),a=base+j,b=a+half;
   const r=c*re[b]-s*im[b],v=s*re[b]+c*im[b];re[b]=re[a]-r;im[b]=im[a]-v;re[a]+=r;im[a]+=v;
  }
 }
 for(let k=1;k<=n/2;k++){const power=re[k]**2+im[k]**2;all+=power;if(k*clip.rate/n>=8000)high+=power;}
 }
 return high/all;
}

// Frozen interpolation/storage math from shelf-plants.js in 1.7.146.
export function plantPreview(width,height,lattice) {
 const columns=Math.ceil(width/8)+1,rows=Math.ceil(height/8)+1;
 const pigment=new Uint8Array(width*height*4),data=new Uint8Array(pigment.length);
 const mixed=[0,0,0,0,0],clamp=value=>Math.min(1,Math.max(0,value));
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=Math.min(columns-2,Math.floor(x/8)),j=Math.min(rows-2,Math.floor(y/8));
  const fx=Math.min(1,(x-i*8)/8),fy=Math.min(1,(y-j*8)/8);
  const a=(j*columns+i)*5,b=a+5,c=a+columns*5,d=c+5;
  for(let k=0;k<5;k++){
   const top=lattice[a+k]+(lattice[b+k]-lattice[a+k])*fx,bottom=lattice[c+k]+(lattice[d+k]-lattice[c+k])*fx;
   mixed[k]=top+(bottom-top)*fy;
  }
  const p=(y*width+x)*4;
  for(let c=0;c<3;c++)pigment[p+c]=Math.round(255*clamp(mixed[c]));
  data[p]=Math.round(255*clamp(mixed[3]));data[p+1]=Math.round(255*clamp(mixed[4]));pigment[p+3]=data[p+3]=255;
 }
 return {pigment,data};
}

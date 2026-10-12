// Frozen loops used before the combined Rust preparation.
export function referencePrepare(raw,width,height,includeEdges=true){
 const gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++){const at=i*4;gray[i]=Math.round(raw[at]*.299+raw[at+1]*.587+raw[at+2]*.114);}
 let near=null;
 if(includeEdges){
 const edges=new Float32Array(gray.length);
 for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const at=y*width+x;edges[at]=Math.min(255,Math.abs(gray[at+1]-gray[at-1])+Math.abs(gray[at+width]-gray[at-width]));}
 near=new Float32Array(edges.length);near.fill(NaN,0,width);near.fill(NaN,Math.max(width,edges.length-width));
 for(let at=width;at<edges.length-width;at++)near[at]=Math.max(edges[at],edges[at-1],edges[at+1],edges[at-width],edges[at+width]);
 }
 let edge=0,variance=0,sum=0,sumSquared=0,count=0;
 for(let y=1;y<height-1;y+=2)for(let x=1;x<width-1;x+=2){const at=y*width+x;edge+=Math.abs(gray[at+1]-gray[at-1])+Math.abs(gray[at+width]-gray[at-width]);sum+=gray[at];sumSquared+=gray[at]*gray[at];count++;}
 if(count)variance=sumSquared/count-(sum/count)**2;
 return {gray,near,busy:edge/Math.max(1,count)>44||variance>5200};
}

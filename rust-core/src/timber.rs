//! Exact cabinet joinery: bevel faces, cut corners, rounded shelf lips and grain.
const VERTICES:usize=132;
const SECTION:[[f64;2];12]=[[6.0,0.0],[9.0,0.0],[10.25,-0.3],[11.1,-1.0],[11.55,-2.0],[11.7,-3.2],
 [11.7,-12.2],[11.5,-13.35],[10.9,-14.3],[9.9,-14.85],[8.8,-15.0],[6.0,-15.0]];
struct Builder<'a>{output:&'a mut [f32],at:usize,grain:usize,offset:[f64;2],tone:[f64;3]}
impl Builder<'_>{
 fn triangle(&mut self,a:[f64;3],mut b:[f64;3],mut c:[f64;3],preferred:[f64;3]){
  let ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];let ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  let mut normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  let length=(normal[0]*normal[0]+normal[1]*normal[1]+normal[2]*normal[2]).sqrt();let inverse=1.0/if length==0.0{1.0}else{length};
  for value in &mut normal{*value*=inverse;}
  if normal[0]*preferred[0]+normal[1]*preferred[1]+normal[2]*preferred[2]<0.0{
   std::mem::swap(&mut b,&mut c);for value in &mut normal{*value= -*value;}
  }
  let dominant=if normal[0].abs()>normal[1].abs(){if normal[0].abs()>normal[2].abs(){0}else{2}}
   else if normal[1].abs()>normal[2].abs(){1}else{2};
  let end=dominant==self.grain;let first=if end{(self.grain+1)%3}else{self.grain};
  let second=(0..3).find(|&axis|axis!=first&&axis!=dominant).unwrap();let shade=if end{0.6}else{1.0};
  for point in [a,b,c]{
   let vertex=self.at;self.at+=1;
   for axis in 0..3{
    self.output[vertex*3+axis]=point[axis] as f32;
    self.output[VERTICES*3+vertex*3+axis]=normal[axis] as f32;
    self.output[VERTICES*8+vertex*3+axis]=(self.tone[axis]*shade) as f32;
   }
   self.output[VERTICES*6+vertex*2]=(point[first]/160.0+self.offset[0]) as f32;
   self.output[VERTICES*6+vertex*2+1]=(point[second]/160.0+self.offset[1]) as f32;
  }
 }
 fn quad(&mut self,p:[[f64;3];4],outward:[f64;3]){self.triangle(p[0],p[1],p[2],outward);self.triangle(p[0],p[2],p[3],outward);}
}
/// # Safety
/// Params: width,height,depth,bevel,grainAxis,UVoffset(2),tone(3).
/// Lip mode appends 30 cap indices from the existing contour triangulator.
/// Output: 132 vertices' positions, normals, UVs and colors (1452 f32).
#[no_mangle]
pub unsafe extern "C" fn timber_mesh(params:*const f64,kind:u32,output:*mut f32)->u32{
 if kind>1{return 0;}
 let params=std::slice::from_raw_parts(params,if kind==0{10}else{40});
 if params.iter().any(|v|!v.is_finite())||params[0]<=0.0||params[1]<=0.0||params[2]<=0.0
  ||params[4]<0.0||params[4]>2.0||params[4].fract()!=0.0{return 0;}
 if kind==1&&params[10..].iter().any(|&v|v<0.0||v>=12.0||v.fract()!=0.0){return 0;}
 let output=std::slice::from_raw_parts_mut(output,VERTICES*11);
 let mut b=Builder{output,at:0,grain:params[4] as usize,offset:[params[5],params[6]],tone:[params[7],params[8],params[9]]};
 if kind==0{
  let half=[params[0]/2.0,params[1]/2.0,params[2]/2.0];
  let radius=0.01f64.max(params[3].min(half[0]*0.45).min(half[1]*0.45).min(half[2]*0.45));
  let core=half.map(|value|value-radius);
  for axis in 0..3{
   let other:Vec<_>=(0..3).filter(|&i|i!=axis).collect();let (a,c)=(other[0],other[1]);
   for sign in [-1.0,1.0]{
    let mut outward=[0.0;3];outward[axis]=sign;
    let points=[[-1.0,-1.0],[1.0,-1.0],[1.0,1.0],[-1.0,1.0]].map(|[sa,sb]|{
     let mut p=[0.0;3];p[axis]=half[axis]*sign;p[a]=core[a]*sa;p[c]=core[c]*sb;p
    });b.quad(points,outward);
   }
  }
  for (a,c) in [(0,1),(0,2),(1,2)]{
   let along=(0..3).find(|&i|i!=a&&i!=c).unwrap();
   for sa in [-1.0,1.0]{for sb in [-1.0,1.0]{
    let mut outward=[0.0;3];outward[a]=sa;outward[c]=sb;
    let points=[(false,-1.0),(true,-1.0),(true,1.0),(false,1.0)].map(|(edge,end)|{
     let mut p=[0.0;3];p[a]=sa*if edge{core[a]}else{half[a]};p[c]=sb*if edge{half[c]}else{core[c]};p[along]=end*core[along];p
    });b.quad(points,outward);
   }}
  }
  for sx in [-1.0,1.0]{for sy in [-1.0,1.0]{for sz in [-1.0,1.0]{
   let signs=[sx,sy,sz];let points:[[f64;3];3]=std::array::from_fn(|full|std::array::from_fn(|axis|signs[axis]*if axis==full{half[axis]}else{core[axis]}));
   b.triangle(points[0],points[1],points[2],signs);
  }}}
 }else{
  for side in [-1.0,1.0]{for cap in params[10..].chunks_exact(3){
   let points:Vec<_>=cap.iter().map(|&index|{let [z,y]=SECTION[index as usize];[side*params[0]/2.0,y,z]}).collect();
   b.triangle(points[0],points[1],points[2],[side,0.0,0.0]);
  }}
  for index in 0..SECTION.len(){
   let [z,y]=SECTION[index];let [nz,ny]=SECTION[(index+1)%SECTION.len()];
   b.quad([[-params[0]/2.0,y,z],[params[0]/2.0,y,z],[params[0]/2.0,ny,nz],[-params[0]/2.0,ny,nz]],[0.0,nz-z,y-ny]);
  }
 }
 if b.at==VERTICES{VERTICES as u32}else{0}
}

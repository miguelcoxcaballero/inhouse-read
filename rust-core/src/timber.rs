//! Exact cabinet joinery: bevel faces, cut corners, rounded shelf lips and grain.
//! Every operation follows the original JavaScript builder's order, including the
//! JavaScript `Math.min/max` and `normalize` conventions, so the output is total.
use crate::jsmath::{jmax,jmin,normalize};
pub const VERTICES:usize=132;
pub const FLOATS:usize=VERTICES*11;
const SECTION:[[f64;2];12]=[[6.0,0.0],[9.0,0.0],[10.25,-0.3],[11.1,-1.0],[11.55,-2.0],[11.7,-3.2],
 [11.7,-12.2],[11.5,-13.35],[10.9,-14.3],[9.9,-14.85],[8.8,-15.0],[6.0,-15.0]];
struct Builder<'a>{output:&'a mut [f32],at:usize,grain:usize,offset:[f64;2],tone:[f64;3]}
impl Builder<'_>{
 fn triangle(&mut self,a:[f64;3],mut b:[f64;3],mut c:[f64;3],preferred:[f64;3]){
  let ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];let ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
  let mut normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  normal=normalize(normal);
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
/// A 3D board with real bevels: six broad faces, twelve bevel faces and eight cut corners.
/// `out` receives 132 vertices' positions, normals, UVs and colours (1452 f32).
pub fn chamfered(width:f64,height:f64,depth:f64,bevel:f64,grain:usize,offset:[f64;2],tone:[f64;3],out:&mut [f32]){
 let mut b=Builder{output:out,at:0,grain,offset,tone};
 let half=[width/2.0,height/2.0,depth/2.0];
 let radius=jmax(0.01,jmin(jmin(jmin(bevel,half[0]*0.45),half[1]*0.45),half[2]*0.45));
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
 debug_assert_eq!(b.at,VERTICES);
}
/// The triangulation of the lip's 12-point contour by three's `ShapeUtils.triangulateShape`
/// (earcut): the contour is a constant, so is its result (a unit test compares it with three).
pub const LIP_CAPS:[[usize;3];10]=[[1,0,11],[11,10,9],[9,8,7],[7,6,5],[5,4,3],[3,2,1],[1,11,9],[9,7,5],[5,3,1],[1,9,5]];
/// A solid-wood edge band: flat front, softly rounded top and bottom arrises.
pub fn lip(width:f64,offset:[f64;2],tone:[f64;3],out:&mut [f32]){
 let mut b=Builder{output:out,at:0,grain:0,offset,tone};
 for side in [-1.0,1.0]{for cap in LIP_CAPS{
  let points:Vec<_>=cap.iter().map(|&index|{let [z,y]=SECTION[index];[side*width/2.0,y,z]}).collect();
  b.triangle(points[0],points[1],points[2],[side,0.0,0.0]);
 }}
 for index in 0..SECTION.len(){
  let [z,y]=SECTION[index];let [nz,ny]=SECTION[(index+1)%SECTION.len()];
  b.quad([[-width/2.0,y,z],[width/2.0,y,z],[width/2.0,ny,nz],[-width/2.0,ny,nz]],[0.0,nz-z,y-ny]);
 }
 debug_assert_eq!(b.at,VERTICES);
}

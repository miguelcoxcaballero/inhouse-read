//! The shelf wastebasket's numbers: the book's flight into its mouth, the powder-coat texture and
//! the leaned shading normals. Three objects (geometry, materials, the Vector3 handed back to the
//! scene) stay in JavaScript; every value computed here follows the original arithmetic exactly,
//! with the host's `Math.sin` and the same operation order.
use wasm_bindgen::prelude::*;
use crate::host::{jmax,jmin,num};

fn unit(value:f64)->f64{jmin(1.0,jmax(0.0,if value.is_nan()||value==0.0{0.0}else{value}))}
fn smooth(value:f64)->f64{value*value*(3.0-2.0*value)}

/// `[x, y, z, scale, turn, fall]`: the book travels above the open rim, then falls into the actual
/// hollow body. All positions use the cabinet's world axes and shared camera. `progress` is
/// coerced like the original's `Number(progress) || 0`.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn sample_trash_drop(start_x:f64,start_y:f64,start_z:f64,mouth_x:f64,mouth_y:f64,mouth_z:f64,progress:&JsValue,height:f64,scale:f64,end_scale:f64)->Vec<f64>{
 let t=unit(num(progress));let travel=unit(t/0.68);let amount=smooth(travel);
 let arc=jmin(100.0,jmax(28.0,(start_y-mouth_y).abs()*0.16+height*0.2));
 let fall=smooth(unit((t-0.68)/0.32));
 let swing=js_sys::Math::sin(travel*std::f64::consts::PI);
 let x=start_x+(mouth_x-start_x)*amount;
 let y=start_y+(mouth_y-start_y)*amount;
 let z=start_z+(mouth_z-start_z)*amount;
 // Make room for the cover before its broad face turns towards the camera, so a book dragged
 // into a narrow right gutter is not cut by the edge of the shared canvas while it rotates.
 vec![x,y+(swing*arc-fall*height*end_scale*1.75),z+swing*36.0,
  scale+(end_scale-scale)*smooth(unit(t/0.48)),smooth(unit(t/0.76)),fall]
}

/// Fine orange-peel texture of a powder coat, 64 x 64 RGBA: R relief, G roughness. A tiny
/// deterministic field, generated once per bin; no downloads or idle work.
#[wasm_bindgen]
pub fn powder_coat()->Vec<u8>{
 const SIZE:usize=64;
 let lattice=|x:i32,y:i32|->f64{
  let mut h=((x&15)+1).wrapping_mul(0x27d4eb2d)^((y&15)+1).wrapping_mul(0x165667b1);
  h=(h^((h as u32)>>15) as i32).wrapping_mul(0x85ebca6b_u32 as i32);
  f64::from((h^((h as u32)>>13) as i32) as u32)/4294967296.0
 };
 let mut bytes=vec![0u8;SIZE*SIZE*4];
 for y in 0..SIZE{for x in 0..SIZE{
  let (u,v)=(x as f64/4.0,y as f64/4.0);
  let (xi,yi)=(u.floor(),v.floor());
  let (fx,fy)=(smooth(u-xi),smooth(v-yi));
  let (xi,yi)=(xi as i32,yi as i32);
  let (a,b,c,d)=(lattice(xi,yi),lattice(xi+1,yi),lattice(xi,yi+1),lattice(xi+1,yi+1));
  let peel=a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
  let at=(y*SIZE+x)*4;
  // Both channels stay positive and within a byte, where Rust's round equals Math.round.
  bytes[at]=(255.0*(0.35+peel*0.3)).round() as u8;
  bytes[at+1]=(255.0*(0.82+peel*0.18)).round() as u8;
  bytes[at+3]=255;
 }}
 bytes
}

/// A true vertical wall mirrors only the dark floor under the shelf camera: leaning the shading
/// normals of vertices `from..=to` of every profile ring slightly upwards lets the window and key
/// light sweep a soft vertical sheen across it. Each normal is `normalize(n + (0, amount, 0))` as
/// three computes it (a multiplication by 1 / length), stored back as a float. Indices past the
/// array are skipped, as writes past a typed array are.
#[wasm_bindgen]
pub fn lean_normals(normals:&mut [f32],segments:u32,rows:u32,from:u32,to:u32,amount:f64){
 for i in 0..=u64::from(segments){for j in u64::from(from)..=u64::from(to){
  let at=(i*u64::from(rows)+j)*3;
  if at+2>=normals.len() as u64{continue;}
  let at=at as usize;
  let (x,y,z)=(f64::from(normals[at]),f64::from(normals[at+1])+amount,f64::from(normals[at+2]));
  let length=(x*x+y*y+z*z).sqrt();
  let inverse=1.0/if length!=0.0&&!length.is_nan(){length}else{1.0};
  normals[at]=(x*inverse) as f32;normals[at+1]=(y*inverse) as f32;normals[at+2]=(z*inverse) as f32;
 }}
}

/// `clamp(value)` of the original: `Math.min(1, Math.max(0, Number(value) || 0))`.
fn coerced_unit(value:&JsValue)->f64{unit(num(value))}

/// `[radius, height, mouth]`: the bin's size as `createShelfTrash` coerces it (`Math.max(12, Number(radius) || 44)`,
/// `Math.max(30, Number(height) || 140)`) and the height of the mouth a book falls into, above the rim.
#[wasm_bindgen]
pub fn trash_size(radius:&JsValue,height:&JsValue)->Vec<f64>{
 let or=|value:f64,fallback:f64|if value.is_nan()||value==0.0{fallback}else{value};
 let radius=jmax(12.0,or(num(radius),44.0));let height=jmax(30.0,or(num(height),140.0));
 vec![radius,height,height+radius*0.30]
}

/// `[openness, lid rotation x]` of `setState({ openness })`: the lid swings about its back axle.
#[wasm_bindgen]
pub fn trash_lid_open(openness:&JsValue)->Vec<f64>{
 let open=coerced_unit(openness);
 vec![open,-open*std::f64::consts::PI*0.49]
}

/// The lid's rotation about z while a `bounce` settles: a damped wobble. `bounce` is coerced twice, as the
/// original read it twice.
#[wasm_bindgen]
pub fn trash_lid_wobble(bounce:&JsValue)->f64{
 let wobble=js_sys::Math::sin(coerced_unit(bounce)*std::f64::consts::PI*3.0)*0.045;
 wobble*(1.0-coerced_unit(bounce))
}

/// Lathe UVs follow the profile's arc length (`Vector2#distanceTo` between consecutive points), so the coat
/// texture is not stretched along long straight walls.
fn arc_length_uv(geo:&mut crate::three_geo::Geo,points:&[[f64;2]]){
 let mut lengths=vec![0.0f64];
 for j in 1..points.len(){let (dx,dy)=(points[j][0]-points[j-1][0],points[j][1]-points[j-1][1]);lengths.push(lengths[j-1]+(dx*dx+dy*dy).sqrt());}
 let last=lengths[lengths.len()-1];let total=if last!=0.0&&!last.is_nan(){last}else{1.0};
 for i in 0..geo.uv.len()/2{geo.uv[i*2+1]=(lengths[i%points.len()]/total) as f32;}
}
fn scaled_profile(radius:f64,shape:&[[f64;2]])->Vec<[f64;2]>{shape.iter().map(|&[x,y]|[radius*x,y]).collect()}
fn colours(count:usize,mut shade:impl FnMut(usize)->[f64;3])->Vec<f32>{
 let mut out=Vec::with_capacity(count*3);
 for i in 0..count{let [r,g,b]=shade(i);out.extend([r as f32,g as f32,b as f32]);}
 out
}

/// The whole powder-coated steel pedal bin as one packet (see `shelf_models`): rolled rim, removable inner
/// bucket, moulded base with a brushed-steel pedal and a domed stainless lid on a rear hinge, every part built
/// as `createShelfTrash` built it from three's generators. `radius` and `height` are already coerced.
#[wasm_bindgen]
pub fn trash_model(radius:f64,height:f64)->Vec<u8>{
 use crate::shelf_models::*;use crate::three_geo;use crate::three_math::color;use crate::three_shape;
 use std::f64::consts::PI;
 let segments=36usize;
 let (coat,bucket)=(color(0x3f6752),color(0x3a3d3b));
 let (base,collar)=(9.5,height-6.5);
 // x factors of the radius, absolute y. The body flares gently from its foot to the steel collar, rolls over
 // and becomes the bucket inside.
 let shell=[[0.93,base-1.5],[0.935,base+2.0],[0.975,height*0.55],[0.994,collar-2.0],[0.998,collar+1.0],
  [0.999,height-0.3],[0.976,height],[0.957,height-1.5],[0.952,height-3.2],[0.94,height-3.6],
  [0.932,height-7.0],[0.9,height*0.45],[0.868,base+1.5],[0.84,base],[0.0,base]];
 let outer=6usize;let profile=scaled_profile(radius,&shell);
 let mut wall=three_geo::lathe(&profile,segments);arc_length_uv(&mut wall,&profile);
 wall.color=colours((segments+1)*shell.len(),|i|{
  let j=i%shell.len();
  // Occlusion under the collar and above the black base gives the drum its ends.
  let k=if j<outer{if j<2{0.62}else if j==3{0.9}else if j==4{0.7}else{1.0}}else{
   let depth=unit((height-shell[j][1])/(height-base));
   1.0-0.82*js_sys::Math::pow(depth,0.6)
  };
  let tone=if j<outer{coat}else{bucket};[tone[0]*k,tone[1]*k,tone[2]*k]
 });
 lean_normals(&mut wall.normal,segments as u32,shell.len() as u32,1,(outer-2) as u32,0.38);
 let well=three_geo::cylinder(radius*0.845,radius*0.845,1.0,24,1,false,0.0,PI*2.0);
 // A raised moulded foot, a touch wider than the body it carries.
 let foot=three_geo::lathe(&scaled_profile(radius,&[[0.0,0.0],[0.975,0.0],[1.0,0.5],[1.012,2.2],[1.01,8.6],[0.99,10.8],[0.94,11.6]]),segments);
 // Broad brushed pedal on a short arm, turned a little towards the shelf's camera.
 let (pw,pd)=(radius*0.3,radius*0.27);
 let mut shape=three_shape::Path::new();
 shape.move_to([-pw*0.8,0.0]);shape.line_to([-pw*0.94,pd*0.7]);
 shape.quadratic_to([-pw,pd],[-pw*0.76,pd]);shape.line_to([pw*0.76,pd]);
 shape.quadratic_to([pw,pd],[pw*0.94,pd*0.7]);shape.line_to([pw*0.8,0.0]);shape.line_to([-pw*0.8,0.0]);
 let (mut pedal,pedal_groups)=three_shape::extrude_beveled(&shape.points(4),2.6,0.8,0.8,2);
 three_geo::rotate_x(&mut pedal,PI/2.0);
 // At rest the tread tips up, which also shows its lit top to the camera.
 let turn=0.48;
 // Polished collar: a steel band with a rolled bead that the lid closes on.
 let collar_profile=scaled_profile(radius,&[[1.004,collar-0.6],[1.014,collar],[1.016,height-2.2],[1.024,height-1.2],[1.022,height-0.2],[1.0,height+0.4],[0.975,height+0.2]]);
 let mut rim=three_geo::lathe(&collar_profile,segments);
 lean_normals(&mut rim.normal,segments as u32,collar_profile.len() as u32,0,3,0.5);
 // Domed lid: a black gasket at the foot of its skirt, a bright rolled edge, then the dome.
 let lid_shape=[[0.99,-2.3],[1.03,-2.6],[1.044,-1.9],[1.046,-0.7],[1.047,-0.6],[1.046,0.6],
  [1.036,1.4],[1.0,2.0],[0.86,3.5],[0.64,5.6],[0.36,7.1],[0.0,7.7]];
 let lid_profile=scaled_profile(radius,&lid_shape);
 let mut lid=three_geo::lathe(&lid_profile,segments);arc_length_uv(&mut lid,&lid_profile);
 lid.color=colours(lid.count(),|i|{let j=i%lid_shape.len();color(if j<4{0x141515}else if j==6||j==7{0xf2f3f3}else{0xcdd0d1})});
 lean_normals(&mut lid.normal,segments as u32,lid_shape.len() as u32,4,5,0.5);
 // Underneath, a moulded grey liner shaded darker towards the skirt, which hides it when the lid is closed.
 let liner_shape=[[0.0,1.6],[0.62,1.05],[0.9,0.3],[0.99,-2.3]];let tones=[0x72777a,0x676c6f,0x4f5356,0x303334];
 let mut liner=three_geo::lathe(&scaled_profile(radius,&liner_shape),segments);
 liner.color=colours(liner.count(),|i|color(tones[i%liner_shape.len()]));
 let hinge=three_geo::capsule(2.3,radius*0.34,2.0,8.0,1.0);
 // The bucket's carry handle lies folded against the inside of the rim.
 let handle=three_geo::torus_arc(radius*0.905,0.55,4,24,PI*0.9);
 let lid_top=[0.0,0.0,radius*0.91];
 let nodes=vec![
  Node::mesh("Open metal body","LatheGeometry","coating",wall,LATHE_COLOURED),
  Node::mesh("Dark interior base","CylinderGeometry","interior",well,PLAIN).grouped(cylinder_groups(radius*0.845,radius*0.845,24,1,false)).at([0.0,base+0.4,0.0]),
  Node::mesh("Rubber foot","LatheGeometry","plastic",foot,LATHE),
  Node::mesh("Pedal","ExtrudeGeometry","steel",pedal,EXTRUDED).grouped(pedal_groups.to_vec())
   .at([js_sys::Math::sin(turn)*radius*0.95,6.4,js_sys::Math::cos(turn)*radius*0.95]).turned([-0.3,turn,0.0],"YXZ"),
  Node::mesh("Rolled metal lip","LatheGeometry","steel",rim,LATHE),
  Node::group("Hinged wastebasket lid").at([0.0,height+2.4,-radius*0.91]),
  Node::mesh("Solid lid","LatheGeometry","lidSteel",lid,LATHE_COLOURED).inside(5).at(lid_top),
  Node::mesh("Lid liner","LatheGeometry","liner",liner,LATHE_COLOURED).inside(5).at(lid_top),
  Node::mesh("Lid axle","CapsuleGeometry","plastic",hinge,PLAIN).turned([0.0,0.0,PI/2.0],"XYZ").at([0.0,height+1.6,-radius*1.02]),
  Node::mesh("Bucket handle","TorusGeometry","plastic",handle,PLAIN).turned([PI/2.0,0.0,PI*0.05],"XYZ").at([0.0,height-5.2,0.0]),
 ];
 packet(&nodes,TRASH_MATERIALS,&[])
}

/// The bin's materials by role, in the order they are made; `"peel"` stands for the powder-coat texture. Vertex colours
/// carry the coat, the grey bucket and its interior shadow, so one shell and one material cover all three. A satin
/// clearcoat mirrors the room's window as a soft vertical streak, which makes a small cylinder read as round. The
/// brushed stainless lid's vertex colours darken its liner and the black gasket ring against the steel collar.
const TRASH_MATERIALS:&str=concat!("[",
 r##"{"role":"coating","class":"MeshPhysicalMaterial","options":{"color":"#ffffff","vertexColors":true,"metalness":0.12,"roughness":0.46,"roughnessMap":"peel","bumpMap":"peel","bumpScale":0.16,"clearcoat":0.6,"clearcoatRoughness":0.2}},"##,
 r##"{"role":"interior","class":"MeshStandardMaterial","options":{"color":"#151716","roughness":0.8}},"##,
 r##"{"role":"steel","class":"MeshPhysicalMaterial","options":{"color":"#dfe2e3","metalness":1,"roughness":0.2,"clearcoat":0.3,"clearcoatRoughness":0.12}},"##,
 r##"{"role":"plastic","class":"MeshStandardMaterial","options":{"color":"#1b1d1c","roughness":0.5}},"##,
 r##"{"role":"lidSteel","class":"MeshPhysicalMaterial","options":{"color":"#ffffff","vertexColors":true,"metalness":1,"roughness":0.27,"clearcoat":0.35,"clearcoatRoughness":0.14}},"##,
 r##"{"role":"liner","class":"MeshStandardMaterial","options":{"color":"#ffffff","vertexColors":true,"roughness":0.62}}"##,
 "]");

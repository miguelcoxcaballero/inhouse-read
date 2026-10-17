// Renders every cozy sound of rust-ui/src/cozy_synth.rs to 16-bit mono WAV files for listening and measuring.
// rustc -O --edition 2021 tools/sfx/render.rs -o /tmp/sfx-render && /tmp/sfx-render <out dir>
#[path = "../../rust-ui/src/cozy_synth.rs"]
mod cozy_synth;
use std::{env, fs, io::Write};
fn wav(path:&str,pcm:&[f32]){
 let rate=cozy_synth::RATE as u32;let bytes=(pcm.len()*2) as u32;
 let mut f=fs::File::create(path).unwrap();
 f.write_all(b"RIFF").unwrap();f.write_all(&(36+bytes).to_le_bytes()).unwrap();f.write_all(b"WAVEfmt ").unwrap();
 f.write_all(&16u32.to_le_bytes()).unwrap();f.write_all(&1u16.to_le_bytes()).unwrap();f.write_all(&1u16.to_le_bytes()).unwrap();
 f.write_all(&rate.to_le_bytes()).unwrap();f.write_all(&(rate*2).to_le_bytes()).unwrap();f.write_all(&2u16.to_le_bytes()).unwrap();f.write_all(&16u16.to_le_bytes()).unwrap();
 f.write_all(b"data").unwrap();f.write_all(&bytes.to_le_bytes()).unwrap();
 for s in pcm{f.write_all(&((s.clamp(-1.0,1.0)*32767.0) as i16).to_le_bytes()).unwrap();}
}
fn main(){
 let dir=env::args().nth(1).unwrap_or_else(||"sfx-out".into());fs::create_dir_all(&dir).unwrap();
 let mats=["paper","wood","metal","glass","ceramic","linen"];let lamps=["mittled","tarnaby","tripod"];let pots=["glazed","terracotta","zinc"];
 let mut list:Vec<(String,u32,u32,u32,u32)>=Vec::new();
 for (k,name) in [(0,"book-pickup"),(1,"book-cover-open"),(2,"switch-generic"),(14,"leaves-brush"),(15,"bin-drop")]{list.push((name.into(),k,0,1,1));}
 for (m,n) in mats.iter().enumerate(){for (l,ln) in [(0,"soft"),(1,"medium"),(2,"hard")]{list.push((format!("impact-{n}-{ln}"),3,m as u32,1,l));}}
 for (m,n) in ["wood","metal"].iter().enumerate(){list.push((format!("book-slide-{n}"),4,m as u32,1,1));}
 for (m,n) in mats.iter().enumerate(){list.push((format!("book-setdown-{n}"),5,m as u32,1,1));list.push((format!("book-return-{n}"),16,m as u32,1,1));}
 for (m,n) in lamps.iter().enumerate(){let m=m as u32;
  list.push((format!("lamp-{n}-on"),6,m,1,1));list.push((format!("lamp-{n}-off"),7,m,1,1));list.push((format!("lamp-{n}-move"),8,m,1,1));
  list.push((format!("lamp-{n}-setdown"),9,m,1,1));list.push((format!("lamp-{n}-fall"),10,m,1,1));}
 for (m,n) in pots.iter().enumerate(){let m=m as u32;
  list.push((format!("plant-{n}-move"),11,m,1,1));list.push((format!("plant-{n}-setdown"),12,m,1,1));list.push((format!("plant-{n}-fall"),13,m,1,1));}
 for (name,k,m,v,l) in &list{let pcm=cozy_synth::render(*k,*m,*v,*l);assert!(!pcm.is_empty(),"{name}");wav(&format!("{dir}/{name}.wav"),&pcm);}
 println!("{} sounds",list.len());
}

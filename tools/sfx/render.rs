// Renders every cozy sound of rust-ui/src/cozy_synth.rs to 16-bit mono WAV files for listening and measuring.
// rustc -O --edition 2021 tools/sfx/render.rs -o /tmp/sfx-render && /tmp/sfx-render <out dir>
#[path = "../../rust-ui/src/cozy_synth.rs"]
#[allow(dead_code)]
mod cozy_synth;
use std::{env, fs, io::Write, time::Instant};
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
 let mats=["paper","wood","metal","glass","ceramic","linen"];let lamps=["mittled","tripod","tarnaby"];
 let pots=["muskot","muskotblomma","akerbar","gradvis","muskot-small"];
 let mut list:Vec<(String,u32,u32,u32,u32)>=Vec::new();
 for (k,name) in [(0,"book-pickup"),(1,"book-cover-open"),(2,"switch-generic"),(14,"leaves-brush"),(15,"bin-drop"),(17,"book-pull-out"),(18,"book-slide-back"),
  (19,"book-cover-close"),(20,"pages-flutter"),(21,"bookmark-ribbon"),(25,"leaves-settle"),(26,"soil-crumble"),(28,"bin-lid"),(29,"shelf-creak")]{list.push((name.into(),k,0,1,1));}
 for (m,n) in ["tap","back","toggle"].iter().enumerate(){list.push((format!("ui-{n}"),30,m as u32,1,1));}
 for (m,n) in mats.iter().enumerate(){for (l,ln) in [(0,"soft"),(1,"medium"),(2,"hard")]{list.push((format!("impact-{n}-{ln}"),3,m as u32,1,l));}}
 for (m,n) in ["wood","metal"].iter().enumerate(){list.push((format!("book-slide-{n}"),4,m as u32,1,1));}
 for (m,n) in mats.iter().enumerate(){list.push((format!("book-setdown-{n}"),5,m as u32,1,1));list.push((format!("book-return-{n}"),16,m as u32,1,1));}
 for (m,n) in lamps.iter().enumerate(){let m=m as u32;
  for (k,s) in [(6,"on"),(7,"off"),(8,"move"),(9,"setdown"),(10,"fall"),(22,"jiggle"),(23,"bloom"),(24,"hits-book")]{list.push((format!("lamp-{n}-{s}"),k,m,1,1));}}
 for (m,n) in pots.iter().enumerate(){let m=m as u32;
  for (k,s) in [(11,"move"),(12,"setdown"),(13,"fall"),(27,"clink")]{list.push((format!("plant-{n}-{s}"),k,m,1,1));}}
 for (name,k,m,v,l) in &list{let pcm=cozy_synth::render(*k,*m,*v,*l);assert!(!pcm.is_empty(),"{name}");wav(&format!("{dir}/{name}.wav"),&pcm);}
 // Cost: every (kind, material, level) once, and every variant of each.
 let started=Instant::now();let mut samples=0;let mut largest=0;
 for (_,k,m,_,l) in &list{for v in 0..3{let pcm=cozy_synth::render(*k,*m,v,*l);samples+=pcm.len();largest=largest.max(pcm.len());}}
 let all=started.elapsed();
 println!("{} sounds; all three variants: {:.1} ms, {} samples, largest {} samples ({} KB as f32)",list.len(),all.as_secs_f64()*1000.0,samples,largest,largest*4/1024);
}

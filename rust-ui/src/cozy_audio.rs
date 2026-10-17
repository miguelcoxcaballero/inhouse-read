//! The shelf's sound events. Each event is (kind, material, level); the kinds and materials are listed in
//! cozy_synth. The host plays a recorded clip from the sound atlas when `cozy_clip` names one it holds, and
//! otherwise the deterministic synthesised fallback from `cozy_sound`. No oscillator, audio thread or loop runs
//! here: both are short PCM buffers the host caches, and it sleeps its AudioContext between sounds.
use crate::cozy_synth;

/// Lamp identity used by the lamp kinds: 0 MITTLED, 1 tripod, 2 TÄRNABY (the lantern, also the default).
pub fn lamp_index(id:&str)->u32{match id{"mittled"=>0,"tripod"=>1,_=>2}}
/// Pot identity used by the plant kinds: 0 MUSKOT, 1 MUSKOTBLOMMA, 2 ÅKERBÄR, 3 GRADVIS, 4 the compact MUSKOT.
pub fn pot_index(id:&str)->u32{match id{"muskotblomma"=>1,"akerbar"=>2,"gradvis"=>3,"muskot9"=>4,_=>0}}
/// Volume of an event as the strength the host passes: soft below 0.33, medium below 0.66, otherwise hard.
pub fn level_of(strength:f64)->u32{if !(strength>=0.33){0}else if strength<0.66{1}else{2}}

const MATERIALS:[&str;6]=["paper","wood","metal","glass","ceramic","linen"];
const LAMPS:[&str;3]=["mittled","tripod","tarnaby"];
const POTS:[&str;5]=["muskot","muskotblomma","akerbar","gradvis","muskot"];
/// What each lamp's base and each pot is made of, as a material of kind 3.
const LAMP_BASE:[usize;3]=[2,1,2];
const POT_MATERIAL:[usize;5]=[4,4,2,4,4];
/// The atlas' generic lamp and pot families.
const LAMP_FAMILY:[&str;3]=["plastic","wood","metal"];
const POT_FAMILY:[&str;5]=["glazed","terracotta","zinc","glazed","glazed"];

/// The atlas clip groups for an event, most specific first, comma separated. A group is a clip name without its
/// take suffix (`book_set_wood` holds `book_set_wood_t0`, `book_set_wood_t1`…). The host plays a random take of
/// the first group its atlas holds; an empty string (or no group present) means the synthesised sound.
pub fn clip_groups(kind:u32,material:u32,level:u32)->String{
 let level=level.min(2);let m=material as usize;
 let surface=MATERIALS.get(m).copied().unwrap_or("wood");
 let lamp=LAMPS.get(m).copied().unwrap_or("tarnaby");let pot=POTS.get(m).copied().unwrap_or("muskot");
 let (lamp_family,pot_family)=(LAMP_FAMILY[m.min(2)],POT_FAMILY[m.min(4)]);
 let impact=|name:&str|format!("impact_{name}_L{level},impact_{name}_L1");
 match kind{
  0=>"book_pickup".into(),
  1=>"book_cover_open".into(),
  2=>"switch_plastic".into(),
  3=>if m<6{impact(surface)}else{String::new()},
  4=>if m==1{"book_slide_metal,scrape_owl,scrape".into()}else{"book_slide_wood,scrape".into()},
  5=>match m{0|1|5=>format!("book_set_{surface},book_set"),_=>format!("book_set_{surface},{}",impact(surface))},
  6=>format!("lamp_{lamp}_switch_on,{}",if m==2{"switch_metal_click,switch_light_on"}else{"switch_light_on"}),
  7=>format!("lamp_{lamp}_switch_off,{}",if m==2{"switch_metal_click,switch_light_off"}else{"switch_light_off"}),
  8=>format!("lamp_{lamp}_move,lamp_move_{lamp_family},scrape"),
  9=>format!("lamp_{lamp}_set,lamp_setdown_{lamp_family},{}",impact(MATERIALS[LAMP_BASE[m.min(2)]])),
  10=>format!("lamp_{lamp}_fall,{}",if m==1{"lamp_fall_wood"}else{"lamp_fall_metal"}),
  11=>format!("pot_{pot}_move,pot_move_{pot_family},scrape"),
  12=>format!("pot_{pot}_set,pot_setdown_{pot_family},{}",if m==2{"metal_pot".into()}else{impact(MATERIALS[POT_MATERIAL[m.min(4)]])}),
  13=>format!("pot_{pot}_fall,pot_fall"),
  14=>"leaves_brush,leaves_rustle".into(),
  15=>"bin_drop,paper_crumple".into(),
  16=>"book_return,book_set".into(),
  17=>"book_pull,book_pickup".into(),
  18=>"book_slide_back,scrape".into(),
  19=>"book_cover_close".into(),
  20=>"book_flip,book_pageturn".into(),
  21=>"bookmark_ribbon".into(),
  22=>format!("lamp_{lamp}_jiggle{}",if m==2{",switch_metal_latch"}else{""}),
  23=>format!("lamp_{lamp}_glow"),
  24=>format!("lamp_{lamp}_knock,impact_paper_L{level}"),
  25=>"leaves_settle,leaves_rustle".into(),
  26=>"soil_crumble".into(),
  27=>format!("pot_{pot}_clink,{}",if m==2{"metal_pot".into()}else{impact("ceramic")}),
  28=>"bin_lid".into(),
  29=>"creak".into(),
  30=>match m{2=>"ui_toggle,switch_plastic".into(),_=>"ui_tap,switch_plastic".into()},
  31=>"zoom_in".into(),
  32=>"zoom_out".into(),
  33=>"view_iso".into(),
  34=>"view_front".into(),
  _=>String::new(),
 }
}

/// The synthesised fallback at 24 kHz: (kind, material, variant 0..2, level 0..2). Unknown events are empty.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn cozy_sound(kind:u32,material:u32,variant:u32,level:u32)->Vec<f32>{cozy_synth::render(kind,material,variant%3,level.min(2))}
/// The atlas clip groups for an event (see `clip_groups`).
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn cozy_clip(kind:u32,material:u32,level:u32)->String{clip_groups(kind,material,level)}
/// The level (0 soft, 1 medium, 2 hard) of an event played with `strength`.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn cozy_level(strength:f64)->u32{level_of(strength)}

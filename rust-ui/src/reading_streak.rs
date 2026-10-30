//! Reading streak (racha de lectura), ported from reading-streak.js and reading-streak-core.js: the day
//! records and their merge, the header counter, the reading timer, the calendar panel, the celebration and
//! the home-screen widget payloads. A day counts once GOAL seconds were read in it; the streak is the run of
//! consecutive complete days up to today or, while today is still open, up to yesterday. Seconds are kept
//! per local day (YYYY-MM-DD); two devices merge by taking each day's maximum, so the merge is idempotent.
//!
//! JavaScript keeps only the callbacks of the app: Web Audio, the vibration motor and the widget's canvas are
//! driven from here. Local days are computed with the proleptic Gregorian calendar for ordinary keys
//! (the same answer `new Date(y, m - 1, d, 12)` gives for every date that has a local noon) and with the
//! engine's own `Date` for anything else, so odd keys keep the original's normalisation.
#![allow(dead_code)]
#[path="bookshelf/util.rs"]
#[allow(unused_imports)]
mod util;
use std::{cell::{Cell,RefCell},cmp::Ordering,collections::HashMap,rc::Rc};
use wasm_bindgen::{prelude::*,JsCast};
use js_sys::{Array,Object};
use util::{R,s,f,b,undef,obj,put,get,read,method,method_opt,call,num,truthy,absent,global,qs,qsa,closest,
 create,append,remove,set_attr,get_attr,cls_add,cls_remove,cls_has,style_get,style_set,
 dataset,focus,focus_plain,prevent_default,after,cancel,frame,Timer,run,settle,string_value,join_strings};

pub const GOAL:f64=300.0;
const KEEP_DAYS:f64=420.0;
const DAY_LIMIT:f64=86400.0;
const IDLE_MS:f64=180_000.0;
const SAVE_EVERY_MS:f64=5_000.0;
const STREAK_KEY:&str="inhouse-read-streak";
const LOCAL_KEY:&str="inhouse-read-streak-device";
const BOOK_KEY:&str="inhouse-read-widget-book";
const WEEKDAYS:[&str;7]=["L","M","X","J","V","S","D"];
const MONTHS:[&str;12]=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
/// Day numbers further than this from 1970 go through the engine's `Date` (its range ends at ±1e8 days).
const SAFE_DAYS:i64=99_000_000;

// ---------------------------------------------------------------- numbers and text as the engine prints them
/// `String(value)` for a number.
fn ntext(value:f64)->String{
 if value==0.0{return "0".into();}
 if value.fract()==0.0&&value.abs()<1e15{return format!("{}",value as i64);}
 crate::host::number_string(value)
}
/// `String(value).padStart(2, '0')`.
fn pad2(value:f64)->String{let text=ntext(value);if text.len()<2{format!("0{text}")}else{text}}
/// `value || 0` for a number.
fn or0(value:f64)->f64{if value.is_nan()||value==0.0{0.0}else{value}}
/// `Math.round`.
fn jround(value:f64)->f64{
 if !value.is_finite()||value.abs()>=4_503_599_627_370_496.0{return value;}
 let floor=value.floor();
 let rounded=if value-floor>=0.5{floor+1.0}else{floor};
 if rounded==0.0&&(value<0.0||(value==0.0&&value.is_sign_negative())){-0.0}else{rounded}
}
fn jmax(a:f64,b:f64)->f64{crate::host::jmax(a,b)}
fn jmin(a:f64,b:f64)->f64{crate::host::jmin(a,b)}
/// JavaScript string order (UTF-16 code units).
fn cmp16(a:&str,b:&str)->Ordering{if a.is_ascii()&&b.is_ascii(){a.cmp(b)}else{a.encode_utf16().cmp(b.encode_utf16())}}
/// `/^\d{4}-\d{2}-\d{2}$/.test(key)`.
fn day_ok(key:&str)->bool{
 let bytes=key.as_bytes();
 bytes.len()==10&&bytes.iter().enumerate().all(|(index,c)|if index==4||index==7{*c==b'-'}else{c.is_ascii_digit()})
}
/// `JSON.stringify` of a string.
fn json_str(out:&mut String,text:&str){
 out.push('"');
 for c in text.chars(){match c{
  '"'=>out.push_str("\\\""),'\\'=>out.push_str("\\\\"),'\u{8}'=>out.push_str("\\b"),'\u{c}'=>out.push_str("\\f"),
  '\n'=>out.push_str("\\n"),'\r'=>out.push_str("\\r"),'\t'=>out.push_str("\\t"),
  c if (c as u32)<0x20=>out.push_str(&format!("\\u{:04x}",c as u32)),
  c=>out.push(c),
 }}
 out.push('"');
}
/// `JSON.stringify` of a number.
fn json_num(out:&mut String,value:f64){if value.is_finite(){out.push_str(&ntext(value))}else{out.push_str("null")}}

// ---------------------------------------------------------------- local days
fn civil_days(y:i64,m:i64,d:i64)->i64{
 let y=if m<=2{y-1}else{y};
 let era=if y>=0{y}else{y-399}/400;
 let yoe=y-era*400;
 let mp=(m+9)%12;
 let doy=(153*mp+2)/5+d-1;
 let doe=yoe*365+yoe/4-yoe/100+doy;
 era*146097+doe-719468
}
fn civil_date(z:i64)->(i64,i64,i64){
 let z=z+719468;
 let era=if z>=0{z}else{z-146096}/146097;
 let doe=z-era*146097;
 let yoe=(doe-doe/1460+doe/36524-doe/146096)/365;
 let doy=doe-(365*yoe+yoe/4-yoe/100);
 let mp=(5*doy+2)/153;
 let d=doy-(153*mp+2)/5+1;
 let m=if mp<10{mp+3}else{mp-9};
 (if m<=2{yoe+era*400+1}else{yoe+era*400},m,d)
}
/// The day of `new Date(y, mi, d, 12)` for integral arguments (MakeDay with the two-digit-year rule).
fn make_day(y:f64,mi:f64,d:f64)->Option<i64>{
 if !(y.is_finite()&&mi.is_finite()&&d.is_finite())||y.fract()!=0.0||mi.fract()!=0.0||d.fract()!=0.0{return None;}
 if y.abs()>1e9||mi.abs()>1e10||d.abs()>1e10{return None;}
 let mut y=y as i64;if (0..=99).contains(&y){y+=1900;}
 let mi=mi as i64;
 let z=civil_days(y+mi.div_euclid(12),mi.rem_euclid(12)+1,1)+(d as i64)-1;
 if z.abs()>SAFE_DAYS{None}else{Some(z)}
}
fn day_text(z:i64)->String{let (y,m,d)=civil_date(z);format!("{y}-{m:02}-{d:02}")}
/// `Number(part)` of a decimal part, `None` where the engine has to answer.
fn part_number(part:Option<&str>)->Option<f64>{
 let part=part?;
 if part.is_empty(){return Some(0.0);}
 if part.len()<=15&&part.bytes().all(|c|c.is_ascii_digit()){part.parse::<f64>().ok()}else{None}
}
/// The day `parseDay(key)` lands on, computed without the engine.
fn key_day(key:&str)->Option<i64>{
 let mut parts=key.split('-');
 let y=part_number(parts.next())?;let m=part_number(parts.next())?;let d=part_number(parts.next())?;
 make_day(y,m-1.0,d)
}
/// `parseDay(key)` with the engine's `Date`: `new Date(year, month - 1, day, 12)` of `key.split('-').map(Number)`.
fn js_parse_day(key:&str)->R<JsValue>{
 let parts:Vec<&str>=key.split('-').collect();
 let n=|index:usize|parts.get(index).map(|part|num(&s(part))).unwrap_or(f64::NAN);
 crate::host::construct("Date",&[&f(n(0)),&f(n(1)-1.0),&f(n(2)),&f(12.0)])
}
/// `dayKey(date)` of the original.
fn js_day_key(date:&JsValue)->R<String>{
 let year=num(&method(date,"getFullYear",&[])?);
 let month=num(&method(date,"getMonth",&[])?);
 let day=num(&method(date,"getDate",&[])?);
 Ok(format!("{}-{}-{}",ntext(year),pad2(month+1.0),pad2(day)))
}
/// `addDays(key, delta)`.
fn add_days(key:&str,delta:f64)->String{
 if delta.fract()==0.0&&delta.abs()<1e7{
  if let Some(z)=key_day(key){let target=z+delta as i64;if target.abs()<=SAFE_DAYS{return day_text(target);}}
 }
 (||->R<String>{
  let date=js_parse_day(key)?;
  let day=num(&method(&date,"getDate",&[])?);
  method(&date,"setDate",&[&f(day+delta)])?;
  js_day_key(&date)
 })().unwrap_or_else(|_|"NaN-NaN-NaN".into())
}
/// `parseDay(key).getDay()`.
fn week_day(key:&str)->f64{
 if let Some(z)=key_day(key){return (z+4).rem_euclid(7) as f64;}
 js_parse_day(key).and_then(|date|method(&date,"getDay",&[])).map(|day|num(&day)).unwrap_or(f64::NAN)
}
/// `dayKey(new Date(time))`.
fn day_at(time:f64)->R<String>{js_day_key(&crate::host::construct("Date",&[&f(time)])?)}
/// Year and month of `new Date(`${key}T12:00:00`)`.
fn noon_month(key:&str)->R<(f64,f64)>{
 if day_ok(key){
  let y:i64=key[0..4].parse().unwrap_or(0);let m:i64=key[5..7].parse().unwrap_or(0);let d:i64=key[8..10].parse().unwrap_or(0);
  if y>=1&&(1..=12).contains(&m)&&d>=1{
   let next=if m==12{civil_days(y+1,1,1)}else{civil_days(y,m+1,1)};
   if d<=next-civil_days(y,m,1){return Ok((y as f64,(m-1) as f64));}
  }
 }
 let date=crate::host::construct("Date",&[&s(&format!("{key}T12:00:00"))])?;
 Ok((num(&method(&date,"getFullYear",&[])?),num(&method(&date,"getMonth",&[])?)))
}
/// `new Date(year, month, 1)` normalised back to its year and month.
fn month_after(year:f64,month:f64)->R<(f64,f64)>{
 if year.is_finite()&&month.is_finite()&&year.fract()==0.0&&month.fract()==0.0&&year.abs()<1e6&&month.abs()<1e7{
  let (y,mi)=(year as i64,month as i64);
  let y=if (0..=99).contains(&y){y+1900}else{y};
  return Ok(((y+mi.div_euclid(12)) as f64,mi.rem_euclid(12) as f64));
 }
 let date=crate::host::construct("Date",&[&f(year),&f(month),&f(1.0)])?;
 Ok((num(&method(&date,"getFullYear",&[])?),num(&method(&date,"getMonth",&[])?)))
}

// ---------------------------------------------------------------- the records
#[derive(Clone,PartialEq,Default,Debug)]
pub struct Streak{days:Vec<(String,f64)>,best:f64,celebrated:String}
#[derive(Clone,Copy,Default)]
struct Info{current:f64,done_today:bool,at_risk:bool,seconds:f64,remaining:f64,best:f64,total:f64}

impl Streak{
 fn index(&self)->HashMap<&str,f64>{self.days.iter().map(|(key,value)|(key.as_str(),*value)).collect()}
 fn get(&self,key:&str)->f64{self.days.iter().find(|(known,_)|known==key).map(|(_,value)|*value).unwrap_or(0.0)}
 fn set(&mut self,key:&str,value:f64){
  match self.days.iter_mut().find(|(known,_)|known==key){Some(entry)=>entry.1=value,None=>self.days.push((key.to_string(),value))}
 }
 /// `normalizeStreak` of a state that is already made of numbers and strings.
 fn normalized(&self)->Streak{
  let mut state=Streak::default();
  for (key,seconds) in &self.days{let amount=seconds.floor();if day_ok(key)&&amount>0.0{state.days.push((key.clone(),jmin(amount,DAY_LIMIT)));}}
  let best=self.best.floor();if best>0.0{state.best=best;}
  if day_ok(&self.celebrated){state.celebrated=self.celebrated.clone();}
  state
 }
 fn json(&self)->String{
  let mut out=String::with_capacity(32+self.days.len()*20);
  out.push_str("{\"v\":1,\"days\":{");
  for (index,(key,seconds)) in self.days.iter().enumerate(){if index>0{out.push(',');}json_str(&mut out,key);out.push(':');json_num(&mut out,*seconds);}
  out.push_str("},\"best\":");json_num(&mut out,self.best);
  out.push_str(",\"celebrated\":");json_str(&mut out,&self.celebrated);out.push('}');
  out
 }
}
fn complete(index:&HashMap<&str,f64>,key:&str)->bool{or0(index.get(key).copied().unwrap_or(0.0))>=GOAL}
fn complete_keys(state:&Streak)->Vec<String>{
 let mut keys:Vec<String>=state.days.iter().filter(|(_,seconds)|or0(*seconds)>=GOAL).map(|(key,_)|key.clone()).collect();
 keys.sort_by(|a,b|cmp16(a,b));keys
}
fn longest_run(state:&Streak)->f64{
 let (mut best,mut run,mut previous)=(0.0,0.0,String::new());
 for key in complete_keys(state){
  run=if !previous.is_empty()&&add_days(&previous,1.0)==key{run+1.0}else{1.0};
  best=jmax(best,run);previous=key;
 }
 best
}
fn merge(states:&[Streak])->Streak{
 let mut merged=Streak::default();
 let mut at:HashMap<String,usize>=HashMap::new();
 for raw in states{
  let state=raw.normalized();
  for (key,seconds) in &state.days{
   match at.get(key){
    Some(&index)=>{let current=merged.days[index].1;merged.days[index].1=jmax(or0(current),*seconds);}
    None=>{at.insert(key.clone(),merged.days.len());merged.days.push((key.clone(),jmax(0.0,*seconds)));}
   }
  }
  merged.best=jmax(merged.best,state.best);
  if cmp16(&state.celebrated,&merged.celebrated)==Ordering::Greater{merged.celebrated=state.celebrated.clone();}
 }
 merged.best=jmax(merged.best,longest_run(&merged));
 merged
}
fn prune(state:&Streak,today:&str)->Streak{
 let limit=add_days(today,-KEEP_DAYS);
 let best=jmax(state.best,longest_run(state));
 let days=state.days.iter().filter(|(key,_)|cmp16(key,&limit)!=Ordering::Less).cloned().collect();
 Streak{days,best,celebrated:state.celebrated.clone()}
}
fn synced_json(state:&Streak)->String{
 let synced=Streak{days:state.days.iter().filter(|(_,seconds)|*seconds>=GOAL).map(|(key,_)|(key.clone(),GOAL)).collect(),best:state.best,celebrated:state.celebrated.clone()};
 synced.json()
}
fn info(state:&Streak,today:&str)->Info{
 let index=state.index();
 let done_today=complete(&index,today);
 let mut cursor=if done_today{today.to_string()}else{add_days(today,-1.0)};
 let mut current=0.0;
 while complete(&index,&cursor){current+=1.0;cursor=add_days(&cursor,-1.0);}
 let seconds=jmin(or0(index.get(today).copied().unwrap_or(0.0)),GOAL);
 let total=state.days.iter().filter(|(_,value)|or0(*value)>=GOAL).count() as f64;
 Info{current,done_today,at_risk:!done_today&&current>0.0,seconds,remaining:GOAL-seconds,best:jmax(jmax(state.best,longest_run(state)),current),total}
}
fn add_reading(state:&Streak,seconds:f64,today:&str)->(Streak,bool){
 let before=or0(state.get(today));
 let after=jmin(before+seconds,DAY_LIMIT);
 let mut next=state.clone();next.set(today,after);
 let reached=before<GOAL&&after>=GOAL;
 if reached{next.best=jmax(next.best,info(&next,today).current);}
 (next,reached)
}
struct WeekDay{key:String,done:bool,today:bool,future:bool}
fn week_days(state:&Streak,today:&str)->Vec<WeekDay>{
 let index=state.index();
 let monday=add_days(today,-((week_day(today)+6.0)%7.0));
 (0..7).map(|offset|{
  let key=add_days(&monday,offset as f64);
  WeekDay{done:complete(&index,&key),today:key==today,future:cmp16(&key,today)==Ordering::Greater,key}
 }).collect()
}
struct Cell7{key:String,day:f64,done:bool,today:bool,future:bool,join_prev:bool,join_next:bool}
fn month_grid(state:&Streak,year:f64,month:f64,today:&str)->R<Vec<Option<Cell7>>>{
 let (lead,length)=match(make_day(year,month,1.0),make_day(year,month+1.0,0.0)){
  (Some(first),Some(last))=>(((first+4).rem_euclid(7)+6)%7,civil_date(last).2),
  _=>{
   let first=crate::host::construct("Date",&[&f(year),&f(month),&f(1.0),&f(12.0)])?;
   let end=crate::host::construct("Date",&[&f(year),&f(month+1.0),&f(0.0)])?;
   let lead=(num(&method(&first,"getDay",&[])?)+6.0)%7.0;
   let length=num(&method(&end,"getDate",&[])?);
   if !lead.is_finite()||!length.is_finite(){
    let mut cells=Vec::new();let mut i=0.0;while i<lead{cells.push(None);i+=1.0;}
    return Ok(cells);
   }
   (lead as i64,length as i64)
  }
 };
 let index=state.index();
 let mut cells:Vec<Option<Cell7>>=(0..lead).map(|_|None).collect();
 for day in 1..=length{
  let key=format!("{}-{}-{}",ntext(year),pad2(month+1.0),pad2(day as f64));
  let done=complete(&index,&key);
  cells.push(Some(Cell7{
   day:day as f64,done,today:key==today,future:cmp16(&key,today)==Ordering::Greater,
   join_prev:done&&complete(&index,&add_days(&key,-1.0)),join_next:done&&complete(&index,&add_days(&key,1.0)),key,
  }));
 }
 Ok(cells)
}
fn format_clock(seconds:f64)->String{
 let value=jmax(0.0,jround(seconds));
 format!("{}:{}",ntext((value/60.0).floor()),pad2(value%60.0))
}
fn day_word(count:f64)->&'static str{if count==1.0{"día"}else{"días"}}

// ---------------------------------------------------------------- conversions for the module's JavaScript API
fn entries(days:&JsValue)->R<Array>{Ok(method(&get(&global(),"Object"),"entries",&[days])?.unchecked_into())}
/// `normalizeStreak(value)`, reading the value as the original did.
fn normalize_value(value:&JsValue)->R<Streak>{
 let mut state=Streak::default();
 if !truthy(value)||!value.is_object(){return Ok(state);}
 let days=read(value,"days")?;
 if truthy(&days)&&days.is_object(){
  for entry in entries(&days)?.iter(){
   let key=crate::host::get_at(&entry,0).as_string().unwrap_or_default();
   let amount=num(&crate::host::get_at(&entry,1)).floor();
   if day_ok(&key)&&amount>0.0{state.days.push((key,jmin(amount,DAY_LIMIT)));}
  }
 }
 let best=num(&read(value,"best")?).floor();
 if best>0.0{state.best=best;}
 let celebrated=read(value,"celebrated")?;
 if let Some(text)=celebrated.as_string(){if day_ok(&text){state.celebrated=text;}}
 Ok(state)
}
/// A state as the app makes it (numbers for days and best): read without normalising.
fn state_value(value:&JsValue)->R<Streak>{
 let mut state=Streak::default();
 for entry in entries(&read(value,"days")?)?.iter(){
  state.days.push((crate::host::get_at(&entry,0).as_string().unwrap_or_default(),num(&crate::host::get_at(&entry,1))));
 }
 state.best=num(&read(value,"best")?);
 state.celebrated=read(value,"celebrated")?.as_string().unwrap_or_default();
 Ok(state)
}
fn days_object(state:&Streak)->JsValue{
 let days=Object::new();
 for (key,seconds) in &state.days{let _=js_sys::Reflect::set(&days,&s(key),&f(*seconds));}
 days.into()
}
fn state_object(state:&Streak)->JsValue{
 obj(&[("v",&f(1.0)),("days",&days_object(state)),("best",&f(state.best)),("celebrated",&s(&state.celebrated))])
}
fn info_object(info:&Info)->JsValue{
 obj(&[("current",&f(info.current)),("doneToday",&b(info.done_today)),("atRisk",&b(info.at_risk)),("seconds",&f(info.seconds)),
  ("remaining",&f(info.remaining)),("best",&f(info.best)),("total",&f(info.total))])
}
fn parse_text(text:&JsValue)->Streak{
 (||->R<Streak>{let parsed=method(&get(&global(),"JSON"),"parse",&[text])?;normalize_value(&parsed)})().unwrap_or_default()
}

#[wasm_bindgen]
pub fn streak_day_key(date:JsValue)->R<String>{js_day_key(&date)}
#[wasm_bindgen]
pub fn streak_parse_day(key:&str)->R<JsValue>{js_parse_day(key)}
#[wasm_bindgen]
pub fn streak_add_days(key:&str,delta:f64)->String{add_days(key,delta)}
#[wasm_bindgen]
pub fn streak_normalize(value:JsValue)->R<JsValue>{Ok(state_object(&normalize_value(&value)?))}
#[wasm_bindgen]
pub fn streak_parse(text:JsValue)->JsValue{state_object(&parse_text(&text))}
#[wasm_bindgen]
pub fn streak_merge(states:Vec<JsValue>)->R<JsValue>{
 let parsed:Vec<Streak>=states.iter().map(normalize_value).collect::<R<_>>()?;
 Ok(state_object(&merge(&parsed)))
}
/// The `days` and `best` that `pruneStreak` spreads over the state.
#[wasm_bindgen]
pub fn streak_prune(state:JsValue,today:&str)->R<JsValue>{
 let pruned=prune(&state_value(&state)?,today);
 Ok(obj(&[("days",&days_object(&pruned)),("best",&f(pruned.best))]))
}
/// The days of `syncedStreak`: only complete ones, at GOAL seconds.
#[wasm_bindgen]
pub fn streak_synced_days(state:JsValue)->R<JsValue>{
 let state=state_value(&state)?;
 let days=Object::new();
 for (key,seconds) in &state.days{if *seconds>=GOAL{let _=js_sys::Reflect::set(&days,&s(key),&f(GOAL));}}
 Ok(days.into())
}
#[wasm_bindgen]
pub fn streak_is_complete(state:JsValue,key:&str)->R<bool>{Ok(or0(state_value(&state)?.get(key))>=GOAL)}
#[wasm_bindgen]
pub fn streak_info(state:JsValue,today:&str)->R<JsValue>{Ok(info_object(&info(&state_value(&state)?,today)))}
/// `[after, reached, best]` of `addReading`: the new seconds of today, whether the goal was just reached and
/// the best streak the reached state records.
#[wasm_bindgen]
pub fn streak_add_reading(state:JsValue,seconds:f64,today:&str)->R<Vec<f64>>{
 let (next,reached)=add_reading(&state_value(&state)?,seconds,today);
 Ok(vec![next.get(today),if reached{1.0}else{0.0},next.best])
}
#[wasm_bindgen]
pub fn streak_week_days(state:JsValue,today:&str)->R<JsValue>{
 let list=Array::new();
 for day in week_days(&state_value(&state)?,today){
  list.push(&obj(&[("key",&s(&day.key)),("done",&b(day.done)),("today",&b(day.today)),("future",&b(day.future))]));
 }
 Ok(list.into())
}
#[wasm_bindgen]
pub fn streak_month_grid(state:JsValue,year:f64,month:f64,today:&str)->R<JsValue>{
 let list=Array::new();
 for cell in month_grid(&state_value(&state)?,year,month,today)?{
  match cell{
   None=>{list.push(&JsValue::NULL);}
   Some(cell)=>{list.push(&obj(&[("key",&s(&cell.key)),("day",&f(cell.day)),("done",&b(cell.done)),("today",&b(cell.today)),
    ("future",&b(cell.future)),("joinPrev",&b(cell.join_prev)),("joinNext",&b(cell.join_next))]));}
  }
 }
 Ok(list.into())
}
#[wasm_bindgen]
pub fn streak_format_clock(seconds:f64)->String{format_clock(seconds)}
#[wasm_bindgen]
pub fn streak_day_word(count:JsValue)->String{day_word(count.as_f64().unwrap_or(f64::NAN)).into()}

// ---------------------------------------------------------------- markup
thread_local!{static FLAME_SERIAL:Cell<u32>=const{Cell::new(0)};}
/// The flame: orange outside, yellow core and a shine. Grey while today is still to be read.
pub fn flame_svg(class_name:&str)->String{
 let id=FLAME_SERIAL.with(|serial|{serial.set(serial.get()+1);serial.get()});
 let id=format!("ihr-flame-{id}");
 format!(r##"<svg class="streak-flame {class_name}" viewBox="0 0 64 76" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="{id}-o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--flame-top)"/><stop offset="1" stop-color="var(--flame-bottom)"/></linearGradient>
    <linearGradient id="{id}-i" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--flame-core-top)"/><stop offset="1" stop-color="var(--flame-core-bottom)"/></linearGradient>
  </defs>
  <path class="streak-flame-outer" fill="url(#{id}-o)" d="M34 4C36 14 44 20 50 28c6 8 9 15 9 23 0 13-12 23-27 23S5 64 5 51c0-9 4-16 9-22 1.5-1.5 3.5-.7 3.8 1.2.6 3.8 2.2 6.8 4.7 8.8-.5-12 3.5-24 9.5-34 .6-1.1 1.7-1.4 2-1Z"/>
  <path class="streak-flame-inner" fill="url(#{id}-i)" d="M33 38c2.5 7 11 12 11 21 0 7.5-5.5 13-12 13s-12-5.5-12-12c0-6 3.5-10 6.5-13 .8-.7 1.9-.2 2 .8.3 2.2 1.1 3.8 2.3 4.8-.2-5.6.7-10.1 1.6-14.4.1-.5.5-.6.6-.2Z"/>
  <path class="streak-flame-shine" d="M45 31.5c3.2 3.4 6 7.8 7 12.5" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3.4" stroke-linecap="round"/>
</svg>"##)
}
#[wasm_bindgen]
pub fn streak_flame_svg(class_name:&str)->String{flame_svg(class_name)}
const CHECK:&str=r#"<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5.5 12.5l4.2 4.2 8.8-9.4" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>"#;
const CLOSE:&str=r#"<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>"#;
fn chevron(d:&str)->String{format!(r#"<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="{d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>"#)}

fn panel_markup()->String{
 let weekdays:String=WEEKDAYS.iter().map(|day|format!("<span>{day}</span>")).collect();
 format!(r#"<div class="streak-panel-scrim" data-streak-close></div>
<section class="streak-panel" role="dialog" aria-modal="true" aria-labelledby="streak-panel-title">
  <button class="streak-panel-close" type="button" data-streak-close aria-label="Cerrar racha">{CLOSE}</button>
  <header class="streak-panel-hero">
    <div class="streak-panel-flame">{}{}</div>
    <div><h2 id="streak-panel-title"><span data-streak-count>0</span> <span data-streak-unit>días</span> de racha</h2><p data-streak-status></p></div>
  </header>
  <div class="streak-today" data-streak-today>
    <div class="streak-today-bar"><span></span></div>
    <p><strong data-streak-clock>0:00</strong> de {} leídos hoy</p>
  </div>
  <div class="streak-stats">
    <div><strong data-streak-best>0</strong><span>Racha más larga</span></div>
    <div><strong data-streak-total>0</strong><span>Días leídos</span></div>
  </div>
  <button type="button" class="streak-widget-cta" data-streak-widget hidden>
    <span class="streak-widget-art" aria-hidden="true"><span class="streak-widget-art-flame">{}</span><span class="streak-widget-art-lines"><i></i><i></i></span><span class="streak-widget-art-dots"><i></i><i></i><i></i><i></i><i class="is-today"></i></span></span>
    <span class="streak-widget-copy"><strong data-streak-widget-title>Añade la racha a tu pantalla de inicio</strong><small data-streak-widget-text>Un widget con tu llama y los días de esta semana.</small></span>
  </button>
  <div class="streak-calendar">
    <div class="streak-calendar-head">
      <button type="button" class="streak-month-nav" data-streak-month="-1" aria-label="Mes anterior">{}</button>
      <h3 data-streak-month-label></h3>
      <button type="button" class="streak-month-nav" data-streak-month="1" aria-label="Mes siguiente">{}</button>
    </div>
    <div class="streak-calendar-weekdays" aria-hidden="true">{weekdays}</div>
    <div class="streak-calendar-grid" role="grid" data-streak-grid></div>
  </div>
</section>"#,flame_svg("is-base is-idle"),flame_svg("is-fill"),format_clock(GOAL),flame_svg(""),chevron("M15 5l-7 7 7 7"),chevron("M9 5l7 7-7 7"))
}
fn grid_markup(cells:&[Option<Cell7>],month:f64)->String{
 let month_name=MONTHS.get(month as usize).copied().filter(|_|month>=0.0&&month.fract()==0.0).unwrap_or("undefined");
 let mut out=String::new();
 for row in cells.chunks(7){
  out.push_str("<div role=\"row\">");
  for index in 0..7{
   match row.get(index).and_then(|cell|cell.as_ref()){
    None=>out.push_str("<span role=\"gridcell\" class=\"streak-day is-empty\"></span>"),
    Some(cell)=>{
     let mut classes=String::from("streak-day");
     if cell.done{classes.push_str(" is-done");}
     if cell.today{classes.push_str(" is-today");}
     if cell.future{classes.push_str(" is-future");}
     if cell.join_prev&&index>0{classes.push_str(" join-prev");}
     if cell.join_next&&index<6{classes.push_str(" join-next");}
     let day=ntext(cell.day);
     out.push_str(&format!("<span role=\"gridcell\" class=\"{classes}\" aria-label=\"{day} de {month_name}{}{}\"><span>{day}</span></span>",
      if cell.done{", leído"}else{""},if cell.today{", hoy"}else{""}));
    }
   }
  }
  out.push_str("</div>");
 }
 out
}
fn celebration_markup(info:&Info,week:&[WeekDay],before:f64,title:&str,text:&str)->String{
 let burst:String=(0..12).map(|index|format!("<i style=\"--a:{}deg;--d:{}px;--s:{}px\"></i>",index*30+if index%2==1{12}else{0},index%3*14+70,if index%2==1{7}else{10})).collect();
 let days:String=week.iter().enumerate().map(|(index,day)|format!(
  "<div role=\"listitem\" class=\"streak-week-day{}{}{}\" aria-label=\"{}{}{}\"><span class=\"streak-week-name\">{}</span><span class=\"streak-week-dot\">{CHECK}</span></div>",
  if day.done&&!day.today{" is-done"}else{""},if day.today{" is-today"}else{""},if day.future{" is-future"}else{""},
  WEEKDAYS[index],if day.done{", leído"}else{""},if day.today{", hoy"}else{""},WEEKDAYS[index])).collect();
 let current=ntext(info.current);let word=day_word(info.current);
 format!(r#"<div class="streak-celebration-body">
  <div class="streak-burst" aria-hidden="true">
    <span class="streak-glow"></span>
    {burst}
    <div class="streak-celebration-flame">{}{}</div>
  </div>
  <div class="streak-roll" aria-hidden="true"><span class="streak-roll-old">{}</span><span class="streak-roll-new">{current}</span></div>
  <p class="streak-roll-unit">{word} de racha</p>
  <h2 id="streak-celebration-title" class="visually-hidden">{title} {current} {word} de racha</h2>
  <div class="streak-week" role="list" aria-label="Esta semana">{days}</div>
  <p class="streak-celebration-title" aria-hidden="true">{title}</p>
  <p id="streak-celebration-text" class="streak-celebration-text">{text}</p>
</div>
<div class="streak-celebration-actions">
  <button type="button" class="streak-continue" data-streak-continue>Continuar</button>
  <button type="button" class="streak-link" data-streak-calendar>Ver calendario</button>
</div>"#,flame_svg("is-idle"),flame_svg("is-lit"),ntext(before))
}

// ---------------------------------------------------------------- the widget's book (streak-widget-book.js)
// The last book on the home-screen widget: the minutes left and a PNG thumbnail of its cover (the stored
// one, or one drawn with the title). The canvas is the browser's; the recipe is this one.
const WORDS_PER_MINUTE:f64=230.0;
// Up to 52×78 dp on the widget: 3× so it stays sharp on dense screens.
const COVER_WIDTH:f64=156.0;
const COVER_HEIGHT:f64=234.0;

/// `Number(value)`, throwing like the engine for a Symbol.
fn to_number(value:&JsValue)->R<f64>{
 if let Some(number)=value.as_f64(){return Ok(number);}
 Ok(num(&call(&get(&global(),"Number"),"Number",&[value])?))
}
/// `record?.[key]`.
fn optional_field(record:&JsValue,key:&str)->R<JsValue>{if absent(record){Ok(undef())}else{read(record,key)}}

/// Reading minutes left, or -1 when the book's length is unknown.
fn minutes_left(record:&JsValue)->R<f64>{
 let words=to_number(&optional_field(record,"wordCount")?)?;
 if !(words>0.0){return Ok(-1.0);}
 let fraction=to_number(&read(record,"progressFraction")?)?;
 let fraction=jmin(1.0,jmax(0.0,or0(fraction)));
 Ok(jround(words*(1.0-fraction)/WORDS_PER_MINUTE))
}
/// Rounded so the widget is not rewritten every page: by 5 min, by 10 above an hour.
fn rounded_minutes(minutes:f64)->f64{
 if minutes<0.0{return -1.0;}
 if minutes<60.0{return (minutes/5.0).ceil()*5.0;}
 jround(minutes/10.0)*10.0
}
#[wasm_bindgen]
pub fn streak_minutes_left(record:JsValue)->R<f64>{minutes_left(&record)}
#[wasm_bindgen]
pub fn streak_rounded_minutes(minutes:f64)->f64{rounded_minutes(minutes)}

/// The UTF-16 code units of `String(value)`.
fn units(value:&JsValue)->Vec<u16>{let text:js_sys::JsString=string_value(value).unchecked_into();text.iter().collect()}
fn from_units(units:&[u16])->JsValue{js_sys::JsString::from_char_code(units).into()}
/// The hue of a title: a 31-hash over its code points (lone surrogates count as themselves).
fn hue(units:&[u16])->f64{
 let mut hash:i32=0;
 let mut index=0;
 while index<units.len(){
  let unit=units[index];
  let mut point=u32::from(unit);
  if (0xD800..0xDC00).contains(&unit)&&index+1<units.len()&&(0xDC00..0xE000).contains(&units[index+1]){
   point=0x10000+((point-0xD800)<<10)+(u32::from(units[index+1])-0xDC00);index+=1;
  }
  hash=hash.wrapping_mul(31).wrapping_add(point as i32);
  index+=1;
 }
 (i64::from(hash).abs()%360) as f64
}
/// `\s` of a JavaScript regular expression.
fn js_space(unit:u16)->bool{
 matches!(unit,0x09..=0x0D|0x20|0xA0|0x1680|0x2000..=0x200A|0x2028|0x2029|0x202F|0x205F|0x3000|0xFEFF)
}
/// `text.split(/\s+/)`.
fn split_words(units:&[u16])->Vec<Vec<u16>>{
 let mut words=vec![Vec::new()];
 let mut index=0;
 while index<units.len(){
  if js_space(units[index]){
   while index<units.len()&&js_space(units[index]){index+=1;}
   words.push(Vec::new());
  }else{words.last_mut().unwrap().push(units[index]);index+=1;}
 }
 words
}
fn rounded_rect(context:&JsValue,x:f64,y:f64,width:f64,height:f64,radius:f64)->R{
 method(context,"beginPath",&[])?;
 method(context,"moveTo",&[&f(x+radius),&f(y)])?;
 method(context,"arcTo",&[&f(x+width),&f(y),&f(x+width),&f(y+height),&f(radius)])?;
 method(context,"arcTo",&[&f(x+width),&f(y+height),&f(x),&f(y+height),&f(radius)])?;
 method(context,"arcTo",&[&f(x),&f(y+height),&f(x),&f(y),&f(radius)])?;
 method(context,"arcTo",&[&f(x),&f(y),&f(x+width),&f(y),&f(radius)])?;
 method(context,"closePath",&[])?;
 Ok(())
}
fn draw_title_cover(context:&JsValue,title:&JsValue)->R{
 let text=units(title);
 let base=ntext(hue(&text));
 let gradient=method(context,"createLinearGradient",&[&f(0.0),&f(0.0),&f(0.0),&f(COVER_HEIGHT)])?;
 method(&gradient,"addColorStop",&[&f(0.0),&s(&format!("hsl({base} 42% 42%)"))])?;
 method(&gradient,"addColorStop",&[&f(1.0),&s(&format!("hsl({base} 46% 30%)"))])?;
 js_sys::Reflect::set(context,&s("fillStyle"),&gradient)?;
 method(context,"fillRect",&[&f(0.0),&f(0.0),&f(COVER_WIDTH),&f(COVER_HEIGHT)])?;
 js_sys::Reflect::set(context,&s("fillStyle"),&s("rgba(255,255,255,.18)"))?;
 method(context,"fillRect",&[&f(12.0),&f(0.0),&f(4.0),&f(COVER_HEIGHT)])?;
 js_sys::Reflect::set(context,&s("fillStyle"),&s("#fff"))?;
 js_sys::Reflect::set(context,&s("textAlign"),&s("center"))?;
 js_sys::Reflect::set(context,&s("font"),&s("600 22px Georgia, serif"))?;
 let mut lines:Vec<Vec<u16>>=Vec::new();
 let mut line:Vec<u16>=Vec::new();
 for word in split_words(&text){
  let next=if line.is_empty(){word.clone()}else{let mut joined=line.clone();joined.push(0x20);joined.extend_from_slice(&word);joined};
  let width=num(&read(&method(context,"measureText",&[&from_units(&next)])?,"width")?);
  if width>COVER_WIDTH-32.0&&!line.is_empty(){lines.push(std::mem::replace(&mut line,word));}else{line=next;}
  if lines.len()==4{break;}
 }
 if !line.is_empty()&&lines.len()<4{lines.push(line);}
 let top=COVER_HEIGHT/2.0-(lines.len() as f64-1.0)*13.0;
 for (index,text) in lines.iter().enumerate(){
  method(context,"fillText",&[&from_units(text),&f(COVER_WIDTH/2.0+4.0),&f(top+index as f64*26.0),&f(COVER_WIDTH-28.0)])?;
 }
 Ok(())
}
/// Draws the stored cover filling the thumbnail (cropped like a printed cover). Any failure leaves it undrawn.
async fn draw_stored_cover(context:&JsValue,record:&JsValue)->R<bool>{
 let cover=optional_field(record,"cover")?;
 // `cover instanceof Blob`, throwing like the engine when Blob is not a constructor.
 let blob=get(&global(),"Blob");
 let blob=blob.dyn_ref::<js_sys::Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("Right-hand side of 'instanceof' is not callable")))?;
 let is_blob=cover.is_object()&&{
  let prototype=read(blob,"prototype")?;
  prototype.dyn_ref::<Object>().ok_or_else(||JsValue::from(js_sys::TypeError::new("Function has non-object prototype in instanceof check")))?.is_prototype_of(&cover)
 };
 if !is_blob||!get(&global(),"createImageBitmap").is_function(){return Ok(false);}
 let attempt=async{
  let pending=call(&get(&global(),"createImageBitmap"),"createImageBitmap",&[&read(record,"cover")?])?;
  let image=settle(pending).await?;
  let scale=jmax(COVER_WIDTH/num(&read(&image,"width")?),COVER_HEIGHT/num(&read(&image,"height")?));
  let width=num(&read(&image,"width")?)*scale;
  let height=num(&read(&image,"height")?)*scale;
  method(context,"drawImage",&[&image,&f((COVER_WIDTH-width)/2.0),&f((COVER_HEIGHT-height)/2.0),&f(width),&f(height)])?;
  method_opt(&image,"close",&[])?;
  Ok::<bool,JsValue>(true)
 };
 Ok(attempt.await.unwrap_or(false))
}
async fn cover_png(record:JsValue,title:JsValue)->R<JsValue>{
 let canvas=method(&read(&global(),"document")?,"createElement",&[&s("canvas")])?;
 js_sys::Reflect::set(&canvas,&s("width"),&f(COVER_WIDTH))?;
 js_sys::Reflect::set(&canvas,&s("height"),&f(COVER_HEIGHT))?;
 let context=method(&canvas,"getContext",&[&s("2d")])?;
 rounded_rect(&context,0.0,0.0,COVER_WIDTH,COVER_HEIGHT,12.0)?;
 method(&context,"clip",&[])?;
 if !draw_stored_cover(&context,&record).await?{draw_title_cover(&context,&title)?;}
 js_sys::Reflect::set(&context,&s("strokeStyle"),&s("rgba(0,0,0,.14)"))?;
 js_sys::Reflect::set(&context,&s("lineWidth"),&f(3.0))?;
 rounded_rect(&context,1.0,1.0,COVER_WIDTH-2.0,COVER_HEIGHT-2.0,11.0)?;
 method(&context,"stroke",&[])?;
 let url=method(&canvas,"toDataURL",&[&s("image/png")])?;
 let data=js_sys::Reflect::get(&method(&url,"split",&[&s(",")])?,&f(1.0))?;
 Ok(if truthy(&data){data}else{s("")})
}
/// PNG in base64 (without the data-URL prefix) of the cover with rounded corners.
#[wasm_bindgen]
pub fn streak_cover_png(record:JsValue,title:JsValue)->js_sys::Promise{run(cover_png(record,title)).unchecked_into()}

// ---------------------------------------------------------------- sound and vibration
// Sounds synthesised on the spot (no recordings): a rising breath as the flame lights, a bright chord,
// little taps while counting and a "pop". Web Audio and the vibration motor are the browser's.
const SOUNDS_KEY:&str="inhouse-read-shelf-sounds";
struct Tone{at:f64,freq:f64,to:f64,kind:&'static str,dur:f64,gain:f64}
impl Tone{fn new(freq:f64)->Tone{Tone{at:0.0,freq,to:freq,kind:"sine",dur:0.2,gain:0.2}}}
const ATTACK:f64=0.006;

struct FeedbackCore{
 storage:JsValue,context:RefCell<JsValue>,wanted:RefCell<Option<Box<dyn Fn()->bool>>>,rest:RefCell<JsValue>,unlock:RefCell<JsValue>,rest_fn:RefCell<JsValue>,
}
type Feedback=Rc<FeedbackCore>;
fn noop()->JsValue{js_sys::Function::new_no_args("").into()}
fn listener_options(capture:bool,passive:Option<bool>)->JsValue{
 let object=Object::new();
 let _=js_sys::Reflect::set(&object,&s("capture"),&b(capture));
 if let Some(passive)=passive{let _=js_sys::Reflect::set(&object,&s("passive"),&b(passive));}
 object.into()
}
impl FeedbackCore{
 fn enabled(&self)->bool{
  match method(&self.storage,"getItem",&[&s(SOUNDS_KEY)]){Ok(value)=>value.as_string().as_deref()!=Some("off"),Err(_)=>true}
 }
 /// The audio context, made (and woken) when sounds are on; nothing when the browser has none.
 fn audio(&self)->R<JsValue>{
  if !self.enabled(){return Ok(JsValue::NULL);}
  let constructor=util::or(get(&global(),"AudioContext"),get(&global(),"webkitAudioContext"));
  if !truthy(&constructor){return Ok(JsValue::NULL);}
  if !truthy(&self.context.borrow()){
   let made=constructor.dyn_ref::<js_sys::Function>().ok_or_else(||JsValue::from(js_sys::TypeError::new("Context is not a constructor")))
    .and_then(|constructor|js_sys::Reflect::construct(constructor,&Array::new()));
   match made{Ok(context)=>*self.context.borrow_mut()=context,Err(_)=>return Ok(JsValue::NULL)}
  }
  let context=self.context.borrow().clone();
  if read(&context,"state")?.as_string().as_deref()==Some("suspended"){
   method(&method(&context,"resume",&[])?,"catch",&[&noop()])?;
  }
  Ok(context)
 }
 fn state_is(&self,state:&str)->bool{
  let context=self.context.borrow().clone();
  !absent(&context)&&get(&context,"state").as_string().as_deref()==Some(state)
 }
 fn sleep_soon(&self)->R{
  call(&get(&global(),"clearTimeout"),"clearTimeout",&[&self.rest.borrow()])?;
  let rest=call(&get(&global(),"setTimeout"),"setTimeout",&[&self.rest_fn.borrow(),&f(3000.0)])?;
  *self.rest.borrow_mut()=rest;
  Ok(())
 }
 fn vibrate(pattern:&[f64]){
  let navigator=get(&global(),"navigator");
  if absent(&navigator){return;}
  let value=if pattern.len()==1{f(pattern[0])}else{let list=Array::new();for item in pattern{list.push(&f(*item));}list.into()};
  let _=method_opt(&navigator,"vibrate",&[&value]);
 }
}
fn tone(ctx:&JsValue,tone:&Tone)->R{
 let start=num(&read(ctx,"currentTime")?)+tone.at;
 let osc=method(ctx,"createOscillator",&[])?;let amp=method(ctx,"createGain",&[])?;
 js_sys::Reflect::set(&osc,&s("type"),&s(tone.kind))?;
 method(&read(&osc,"frequency")?,"setValueAtTime",&[&f(tone.freq),&f(start)])?;
 if tone.to!=tone.freq{method(&read(&osc,"frequency")?,"exponentialRampToValueAtTime",&[&f(tone.to),&f(start+tone.dur*0.8)])?;}
 method(&read(&amp,"gain")?,"setValueAtTime",&[&f(0.0),&f(start)])?;
 method(&read(&amp,"gain")?,"linearRampToValueAtTime",&[&f(tone.gain),&f(start+ATTACK)])?;
 method(&read(&amp,"gain")?,"exponentialRampToValueAtTime",&[&f(0.0001),&f(start+tone.dur)])?;
 method(&method(&osc,"connect",&[&amp])?,"connect",&[&read(ctx,"destination")?])?;
 method(&osc,"start",&[&f(start)])?;method(&osc,"stop",&[&f(start+tone.dur+0.02)])?;
 Ok(())
}
fn whoosh(ctx:&JsValue,at:f64,dur:f64)->R{
 let start=num(&read(ctx,"currentTime")?)+at;
 let length=(num(&read(ctx,"sampleRate")?)*dur).ceil();
 let buffer=method(ctx,"createBuffer",&[&f(1.0),&f(length),&read(ctx,"sampleRate")?])?;
 let data:js_sys::Float32Array=method(&buffer,"getChannelData",&[&f(0.0)])?.unchecked_into();
 // One draw per sample asked for, as the original loop; the buffer keeps what it has room for.
 let count=data.length() as usize;
 let draws=if length>0.0{length as usize}else{0};
 let mut noise=Vec::with_capacity(draws.min(count));
 for index in 0..draws{let value=(js_sys::Math::random()*2.0-1.0) as f32;if index<count{noise.push(value);}}
 data.subarray(0,noise.len() as u32).copy_from(&noise);
 let source=method(ctx,"createBufferSource",&[])?;let filter=method(ctx,"createBiquadFilter",&[])?;let amp=method(ctx,"createGain",&[])?;
 js_sys::Reflect::set(&source,&s("buffer"),&buffer)?;
 js_sys::Reflect::set(&filter,&s("type"),&s("bandpass"))?;
 js_sys::Reflect::set(&read(&filter,"Q")?,&s("value"),&f(1.4))?;
 method(&read(&filter,"frequency")?,"setValueAtTime",&[&f(380.0),&f(start)])?;
 method(&read(&filter,"frequency")?,"exponentialRampToValueAtTime",&[&f(3200.0),&f(start+dur)])?;
 method(&read(&amp,"gain")?,"setValueAtTime",&[&f(0.0),&f(start)])?;
 method(&read(&amp,"gain")?,"linearRampToValueAtTime",&[&f(0.16),&f(start+dur*0.7)])?;
 method(&read(&amp,"gain")?,"exponentialRampToValueAtTime",&[&f(0.0001),&f(start+dur)])?;
 method(&method(&method(&source,"connect",&[&filter])?,"connect",&[&amp])?,"connect",&[&read(ctx,"destination")?])?;
 method(&source,"start",&[&f(start)])?;method(&source,"stop",&[&f(start+dur+0.02)])?;
 Ok(())
}
fn new_feedback(storage:&JsValue)->R<Feedback>{
 let me=Rc::new(FeedbackCore{storage:storage.clone(),context:RefCell::new(JsValue::NULL),wanted:RefCell::new(None),rest:RefCell::new(f(0.0)),unlock:RefCell::new(undef()),rest_fn:RefCell::new(undef())});
 // Three seconds after the celebration the context sleeps until the next sound.
 let owner=Rc::downgrade(&me);
 let rest=Closure::wrap(Box::new(move||{
  let Some(me)=owner.upgrade() else{return};
  if me.state_is("running"){
   let context=me.context.borrow().clone();
   if let Err(error)=method(&context,"suspend",&[]).and_then(|pending|method(&pending,"catch",&[&noop()])){wasm_bindgen::throw_val(error)}
  }
 })as Box<dyn Fn()>).into_js_value();
 *me.rest_fn.borrow_mut()=rest;
 // Android and Chrome only let audio start inside a touch: when the goal is near, the context is made on
 // the next touch, so it is ready when the celebration sounds without anyone touching anything.
 let owner=Rc::downgrade(&me);
 let unlock=Closure::wrap(Box::new(move|_:JsValue|{
  let Some(me)=owner.upgrade() else{return};
  let wanted=||me.wanted.borrow().as_ref().is_some_and(|test|test());
  if me.state_is("suspended")||(!truthy(&me.context.borrow())&&wanted()){if let Err(error)=me.audio(){wasm_bindgen::throw_val(error)}}
 })as Box<dyn Fn(JsValue)>).into_js_value();
 method(&global(),"addEventListener",&[&s("pointerdown"),&unlock,&listener_options(true,Some(true))])?;
 *me.unlock.borrow_mut()=unlock;
 Ok(me)
}
fn feedback_run(me:&Feedback,name:&str)->R{
 match name{
  "ignite"=>{
   FeedbackCore::vibrate(&[28.0,50.0,18.0,40.0,70.0]);
   let ctx=me.audio()?;if !truthy(&ctx){return Ok(());}
   whoosh(&ctx,0.0,0.34)?;
   // A quick major arpeggio with an octave sparkle.
   for (index,(freq,at)) in [(659.3,0.26),(830.6,0.32),(987.8,0.38),(1318.5,0.46)].into_iter().enumerate(){
    tone(&ctx,&Tone{at,kind:"triangle",dur:0.55+index as f64*0.08,gain:0.13,..Tone::new(freq)})?;
    tone(&ctx,&Tone{at:at+0.004,kind:"sine",dur:0.3,gain:0.035,..Tone::new(freq*2.0)})?;
   }
  }
  "tick"=>{
   FeedbackCore::vibrate(&[9.0]);
   let ctx=me.audio()?;if truthy(&ctx){tone(&ctx,&Tone{to:1240.0,dur:0.07,gain:0.07,..Tone::new(1480.0)})?;}
  }
  "pop"=>{
   FeedbackCore::vibrate(&[16.0,30.0,10.0]);
   let ctx=me.audio()?;if !truthy(&ctx){return Ok(());}
   tone(&ctx,&Tone{to:520.0,dur:0.12,gain:0.16,..Tone::new(880.0)})?;
   tone(&ctx,&Tone{at:0.05,kind:"triangle",dur:0.18,gain:0.05,..Tone::new(1760.0)})?;
  }
  "tap"=>FeedbackCore::vibrate(&[10.0]),
  "rest"=>me.sleep_soon()?,
  "destroy"=>{
   call(&get(&global(),"clearTimeout"),"clearTimeout",&[&me.rest.borrow()])?;
   method(&global(),"removeEventListener",&[&s("pointerdown"),&me.unlock.borrow(),&listener_options(true,None)])?;
   let context=me.context.borrow().clone();
   if let Some(pending)=method_opt(&context,"close",&[])?{method_opt(&pending,"catch",&[&noop()])?;}
  }
  _=>{}
 }
 Ok(())
}


// ---------------------------------------------------------------- the controller
/// A function value for the host, collected with whatever holds it (as the original's arrow functions were).
/// Handlers are `Fn`: an event they dispatch may re-enter them, as in the browser.
fn function(body:impl Fn(JsValue)->R+'static)->JsValue{
 Closure::wrap(Box::new(move|event:JsValue|{if let Err(error)=body(event){wasm_bindgen::throw_val(error)}})as Box<dyn Fn(JsValue)>).into_js_value()
}
fn options(entries:&[(&str,bool)])->JsValue{let object=Object::new();for (key,value) in entries{let _=js_sys::Reflect::set(&object,&s(key),&b(*value));}object.into()}
const ACTIVITY:[&str;4]=["pointerdown","keydown","wheel","touchstart"];
struct Celebration{timers:Vec<Timer>}

struct Core{
 document:JsValue,body:JsValue,storage:JsValue,
 on_change:JsValue,now:JsValue,latest_book:JsValue,book_title:JsValue,feedback:Feedback,
 state:RefCell<Streak>,today:RefCell<String>,
 dirty:Cell<bool>,last_save:Cell<f64>,last_tick:Cell<f64>,last_activity:Cell<f64>,
 timer:RefCell<JsValue>,clock_timer:RefCell<Option<Timer>>,book_start:RefCell<Option<Timer>>,reading_session:Cell<bool>,
 celebrating:RefCell<Option<Celebration>>,panel:RefCell<JsValue>,destroyed:Cell<bool>,info_cache:Cell<Option<Info>>,widget_revision:Cell<f64>,
 last_prune_day:RefCell<String>,widget_sent_day:RefCell<String>,widget_sent_minute:Cell<f64>,widget_sent_revision:Cell<f64>,widget_sent:RefCell<String>,
 book_sent:RefCell<JsValue>,cover_sent:RefCell<JsValue>,book_task:RefCell<JsValue>,
 chips:RefCell<Vec<JsValue>>,reader_screen:RefCell<JsValue>,
 shown_month:Cell<(f64,f64)>,panel_return:RefCell<JsValue>,widget_offer:Cell<bool>,
 tick_fn:RefCell<JsValue>,activity_fn:RefCell<JsValue>,visibility_fn:RefCell<JsValue>,
 page_observer:RefCell<JsValue>,screen_observer:RefCell<JsValue>,
}
type Me=Rc<Core>;

impl Core{
 fn read(&self,key:&str)->JsValue{method(&self.storage,"getItem",&[&s(key)]).unwrap_or(JsValue::NULL)}
 fn write(&self,key:&str,value:&str)->bool{method(&self.storage,"setItem",&[&s(key),&s(value)]).is_ok()}
 fn now(&self)->R<f64>{Ok(num(&call(&self.now,"now",&[])?))}
 fn today(&self)->String{self.today.borrow().clone()}
 fn fb(&self,name:&str)->R{feedback_run(&self.feedback,name)}
 fn current_info(&self)->Info{
  let mut info=match self.info_cache.get(){Some(info)=>info,None=>{let fresh=info(&self.state.borrow(),&self.today());self.info_cache.set(Some(fresh));fresh}};
  let seconds=jmin(or0(self.state.borrow().get(&self.today())),GOAL);
  info.seconds=seconds;info.done_today=seconds>=GOAL;info.remaining=GOAL-seconds;info.at_risk=!info.done_today&&info.current>0.0;
  self.info_cache.set(Some(info));
  info
 }
 fn persist(&self,force:bool)->R{
  if !self.dirty.get()&&!force{return Ok(());}
  let today=self.today();
  if *self.last_prune_day.borrow()!=today{
   let pruned=prune(&self.state.borrow(),&today);
   *self.state.borrow_mut()=pruned;*self.last_prune_day.borrow_mut()=today;self.info_cache.set(None);
  }
  let text=self.state.borrow().json();
  self.write(LOCAL_KEY,&text);
  self.publish()?;
  self.dirty.set(false);self.last_save.set(self.now()?);
  Ok(())
 }
 /// The synced setting only changes when a day is completed or celebrated.
 fn publish(&self)->R{
  let text=synced_json(&self.state.borrow());
  if self.read(STREAK_KEY).as_string().as_deref()!=Some(text.as_str()){self.write(STREAK_KEY,&text);call(&self.on_change,"onChange",&[&s(STREAK_KEY)])?;}
  Ok(())
 }
 fn reading(&self)->bool{
  let screen=self.reader_screen.borrow().clone();
  cls_has(&self.body,"is-reading")&&!truthy(&get(&screen,"hidden"))&&get(&self.document,"visibilityState").as_string().as_deref()==Some("visible")
 }
 fn audio_playing(&self)->bool{!absent(&qs(&self.document,".reading-mini-player [data-mini-play][aria-label=\"Pausar lectura\"]"))}
 fn bridge(&self)->JsValue{let bridge=get(&global(),"InhouseStreak");if truthy(&bridge){bridge}else{JsValue::NULL}}
 /// `widgetBridge()?.[name]?.() ?? fallback`, with a failing bridge answering `fallback`.
 fn widget_call(&self,name:&str,fallback:JsValue)->JsValue{
  match method_opt(&self.bridge(),name,&[]){Ok(Some(value)) if !absent(&value)=>value,_=>fallback}
 }
 fn book_enabled(&self)->bool{self.read(BOOK_KEY).as_string().as_deref()!=Some("off")}
}

fn render_chips(me:&Me)->R{
 let info=me.current_info();
 // The accessible text changes by minutes, not every second: every attribute change is an
 // accessibility event Android has to process.
 let minutes=(info.remaining/60.0).ceil();
 let left=format!("{} {}",ntext(minutes),if minutes==1.0{"minuto"}else{"minutos"});
 let current=ntext(info.current);
 let label=if info.done_today{format!("Racha de {current} {}. Hoy ya has leído.",day_word(info.current))}
  else{format!("Racha de {current} {}. Te {} {left} de lectura hoy.",day_word(info.current),if minutes==1.0{"falta"}else{"faltan"})};
 let look=if info.done_today{"lit"}else{"idle"};
 let chips=me.chips.borrow().clone();
 for chip in &chips{
  let progress=ntext((info.seconds/GOAL*100.0).floor()/100.0);
  if style_get(chip,"--streak-progress")!=progress{style_set(chip,"--streak-progress",&progress);}
  let data=dataset(chip);
  if get(&data,"state").as_string().as_deref()!=Some(look){put(&data,"state",&s(look));}
  let count=method(chip,"querySelector",&[&s(".streak-chip-count")])?;
  if read(&count,"textContent")?.as_string().as_deref()!=Some(current.as_str()){put(&count,"textContent",&s(&current));}
  if get_attr(chip,"aria-label").as_deref()!=Some(label.as_str()){
   set_attr(chip,"aria-label",&label);
   put(chip,"title",&s(&if info.done_today{"Racha de lectura".to_string()}else{format!("Lee {left} más hoy")}));
  }
 }
 let panel=me.panel.borrow().clone();
 if truthy(&panel)&&!truthy(&get(&panel,"hidden")){render_panel(me)?;}
 sync_widget(me);
 Ok(())
}

/// Home-screen widget (Android 1.1.21+, `window.InhouseStreak`): the complete days and today's progress by
/// minutes; the widget computes the streak with the phone's date, so it goes out at midnight.
fn sync_widget(me:&Me){
 let bridge=me.bridge();
 if !get(&bridge,"update").is_function(){return;}
 let today=me.today();
 let (payload,minute)={
  let state=me.state.borrow();
  let seconds=jmin(GOAL,(or0(state.get(&today))/60.0).floor()*60.0);
  let minute=(seconds/60.0).floor();
  if *me.widget_sent_day.borrow()==today&&me.widget_sent_minute.get()==minute&&me.widget_sent_revision.get()==me.widget_revision.get(){return;}
  let keys=complete_keys(&state);
  let keys=&keys[keys.len().saturating_sub(120)..];
  let mut payload=String::from("{\"days\":[");
  for (index,key) in keys.iter().enumerate(){if index>0{payload.push(',');}json_str(&mut payload,key);}
  payload.push_str("],\"day\":");json_str(&mut payload,&today);payload.push_str(",\"seconds\":");json_num(&mut payload,seconds);payload.push('}');
  (payload,minute)
 };
 *me.widget_sent_day.borrow_mut()=today;me.widget_sent_minute.set(minute);me.widget_sent_revision.set(me.widget_revision.get());
 if *me.widget_sent.borrow()==payload{return;}
 *me.widget_sent.borrow_mut()=payload.clone();
 let _=method(&bridge,"update",&[&s(&payload)]);
}

/// The last book on the widget (setting «Libro en el widget»).
fn sync_widget_book(me:&Me)->R{
 let bridge=me.bridge();
 if !get(&bridge,"updateBook").is_function(){return Ok(());}
 let task=me.book_task.borrow().clone();
 let owner=me.clone();
 let job=Closure::once_into_js(move|_:JsValue|->JsValue{run(widget_book_job(owner,bridge))});
 let next=method(&task,"then",&[&job])?;
 let next=method(&next,"catch",&[&js_sys::Function::new_no_args("")])?;
 *me.book_task.borrow_mut()=next;
 Ok(())
}
async fn widget_book_job(me:Me,bridge:JsValue)->R<JsValue>{
 let record=if me.book_enabled(){
  let pending=call(&me.latest_book,"latestBook",&[])?;
  let recovered=method(&pending,"catch",&[&js_sys::Function::new_no_args("return null")])?;
  settle(recovered).await?
 }else{JsValue::NULL};
 if !truthy(&record){
  if me.book_sent.borrow().as_string().as_deref()!=Some("none"){
   *me.book_sent.borrow_mut()=s("none");*me.cover_sent.borrow_mut()=s("");
   let _=method(&bridge,"updateBook",&[&s("")]);
  }
  return Ok(undef());
 }
 let named=call(&me.book_title,"bookTitle",&[&record])?;
 let named=if truthy(&named){named}else{let title=read(&record,"title")?;if truthy(&title){title}else{s("")}};
 let title=method(&string_value(&named),"trim",&[])?;
 let title=if truthy(&title){title}else{s("Libro")};
 let minutes=f(rounded_minutes(minutes_left(&record)?));
 let id=read(&record,"id")?;
 let key=join_strings(&[string_value(&id),s("|"),title.clone(),s("|"),string_value(&minutes)]);
 let size=get(&get(&record,"cover"),"size");
 let cover=join_strings(&[string_value(&id),s("|"),string_value(&if truthy(&size){size}else{f(0.0)})]);
 if key==*me.book_sent.borrow()&&cover==*me.cover_sent.borrow(){return Ok(undef());}
 let payload=obj(&[("title",&title),("minutes",&minutes)]);
 if cover!=*me.cover_sent.borrow(){
  let png=settle(streak_cover_png(record.clone(),title.clone()).into()).await?;
  put(&payload,"cover",&png);
 }else{put(&payload,"keepCover",&JsValue::TRUE);}
 *me.book_sent.borrow_mut()=key;*me.cover_sent.borrow_mut()=cover;
 let text=method(&get(&global(),"JSON"),"stringify",&[&payload])?;
 let _=method(&bridge,"updateBook",&[&text]);
 Ok(undef())
}

fn start_reading_timer(me:&Me)->R{
 if !truthy(&me.timer.borrow())&&me.reading(){
  me.last_tick.set(me.now()?);
  let id=call(&get(&global(),"setInterval"),"setInterval",&[&me.tick_fn.borrow(),&f(1000.0)])?;
  *me.timer.borrow_mut()=id;
 }
 Ok(())
}
fn activity(me:&Me)->R{me.last_activity.set(me.now()?);start_reading_timer(me)}
fn stop_interval(me:&Me)->R{
 let id=me.timer.borrow().clone();
 call(&get(&global(),"clearInterval"),"clearInterval",&[&id])?;
 Ok(())
}
fn set_today(me:&Me,key:String)->R{
 if key!=me.today(){*me.today.borrow_mut()=key;me.info_cache.set(None);render_chips(me)?;}
 Ok(())
}
fn tick(me:&Me)->R{
 let at=me.now()?;
 let last=me.last_tick.get();
 let elapsed=if last!=0.0&&!last.is_nan(){jmin(at-last,2000.0)}else{0.0};
 me.last_tick.set(at);
 set_today(me,day_at(at)?)?;
 if me.celebrating.borrow().is_some()||!me.reading(){return Ok(());}
 if at-me.last_activity.get()>IDLE_MS&&!me.audio_playing(){
  stop_interval(me)?;*me.timer.borrow_mut()=f(0.0);me.last_tick.set(0.0);
  return Ok(());
 }
 if elapsed<=0.0||elapsed.is_nan(){return Ok(());}
 let today=me.today();
 let (next,reached)=add_reading(&me.state.borrow(),elapsed/1000.0,&today);
 *me.state.borrow_mut()=next;me.dirty.set(true);
 if reached{
  me.info_cache.set(None);me.widget_revision.set(me.widget_revision.get()+1.0);
  me.persist(true)?;
  render_chips(me)?;
  if me.state.borrow().celebrated!=today{celebrate(me)?;}
  return Ok(());
 }
 if at-me.last_save.get()>=SAVE_EVERY_MS{me.persist(false)?;}
 render_chips(me)
}
/// The interval exists only while a book is open.
fn sync_timer(me:&Me)->R{
 let active=me.reading();
 if active&&!me.reading_session.get(){
  me.reading_session.set(true);let now=me.now()?;me.last_tick.set(now);me.last_activity.set(now);
  let id=call(&get(&global(),"setInterval"),"setInterval",&[&me.tick_fn.borrow(),&f(1000.0)])?;
  *me.timer.borrow_mut()=id;
 }else if !active&&me.reading_session.get(){
  if truthy(&me.timer.borrow()){tick(me)?;}
  stop_interval(me)?;*me.timer.borrow_mut()=f(0.0);me.last_tick.set(0.0);me.reading_session.set(false);me.persist(false)?;sync_widget_book(me)?;
 }
 Ok(())
}
/// Changing day with the app open turns the counter grey when it should.
fn refresh_day(me:&Me)->R{let now=me.now()?;set_today(me,day_at(now)?)}
/// The date changes once per day; visibilitychange performs the same check after a suspended app.
fn schedule_day_refresh(me:&Me)->R{
 if let Some(timer)=me.clock_timer.borrow_mut().take(){cancel(&timer);}
 if me.destroyed.get(){return Ok(());}
 let current=crate::host::construct("Date",&[&f(me.now()?)])?;
 let next=crate::host::construct("Date",&[&current])?;
 method(&next,"setHours",&[&f(24.0),&f(0.0),&f(0.0),&f(0.0)])?;
 let delay=jmax(1000.0,num(&method(&next,"getTime",&[])?)-num(&method(&current,"getTime",&[])?));
 let owner=me.clone();
 let timer=after(delay,move||{owner.clock_timer.borrow_mut().take();refresh_day(&owner)?;schedule_day_refresh(&owner)});
 *me.clock_timer.borrow_mut()=Some(timer);
 Ok(())
}

// ---- the calendar panel
fn ensure_panel(me:&Me)->R<JsValue>{
 let existing=me.panel.borrow().clone();
 if truthy(&existing){return Ok(existing);}
 let panel=create("div")?;
 put(&panel,"className",&s("streak-panel-layer"));
 put(&panel,"hidden",&JsValue::TRUE);
 put(&panel,"innerHTML",&s(&panel_markup()));
 *me.panel.borrow_mut()=panel.clone();
 append(&me.body,&panel);
 let owner=me.clone();
 method(&panel,"addEventListener",&[&s("click"),&function(move|event|{
  let target=get(&event,"target");
  if truthy(&method(&target,"closest",&[&s("[data-streak-close]")])?){close_panel(&owner)?;}
  if truthy(&method(&target,"closest",&[&s("[data-streak-widget]")])?){
   owner.fb("tap")?;
   owner.widget_call("requestPin",undef());
   let panel=owner.panel.borrow().clone();
   put(&method(&panel,"querySelector",&[&s("[data-streak-widget-title]")])?,"textContent",&s("Confírmalo en el aviso de Android"));
   put(&method(&panel,"querySelector",&[&s("[data-streak-widget-text]")])?,"textContent",&s("También puedes añadirlo desde los widgets del lanzador."));
  }
  let nav=method(&target,"closest",&[&s("[data-streak-month]")])?;
  if truthy(&nav)&&!truthy(&get(&nav,"disabled")){
   let step=num(&get(&dataset(&nav),"streakMonth"));
   let (year,month)=owner.shown_month.get();
   owner.shown_month.set(month_after(year,month+step)?);
   owner.fb("tap")?;render_panel(&owner)?;
  }
  Ok(())
 })])?;
 let owner=me.clone();
 method(&panel,"addEventListener",&[&s("keydown"),&function(move|event|{
  let key=get(&event,"key").as_string().unwrap_or_default();
  if key=="Escape"{prevent_default(&event);close_panel(&owner)?;}
  if key=="Tab"{let panel=owner.panel.borrow().clone();trap_focus(&owner,&event,&method(&panel,"querySelector",&[&s(".streak-panel")])?)?;}
  Ok(())
 })])?;
 Ok(panel)
}
fn render_panel(me:&Me)->R{
 let info=me.current_info();
 let panel=me.panel.borrow().clone();
 let q=|selector:&str|method(&panel,"querySelector",&[&s(selector)]);
 let sheet=q(".streak-panel")?;
 put(&dataset(&sheet),"state",&s(if info.done_today{"lit"}else{"idle"}));
 method(&read(&q(".streak-panel")?,"style")?,"setProperty",&[&s("--streak-progress"),&s(&ntext((info.seconds/GOAL*100.0).floor()/100.0))])?;
 put(&q("[data-streak-count]")?,"textContent",&s(&ntext(info.current)));
 put(&q("[data-streak-unit]")?,"textContent",&s(day_word(info.current)));
 let status=if info.done_today{"Hoy ya has leído. Vuelve mañana para mantenerla.".to_string()}
  else if info.at_risk{format!("Lee {} más hoy para no perderla.",format_clock(info.remaining))}
  else{format!("Lee {} minutos para empezar tu racha.",ntext(GOAL/60.0))};
 put(&q("[data-streak-status]")?,"textContent",&s(&status));
 put(&dataset(&q("[data-streak-today]")?),"done",&s(if info.done_today{"true"}else{"false"}));
 put(&read(&q(".streak-today-bar span")?,"style")?,"transform",&s(&format!("scaleX({})",ntext(info.seconds/GOAL))));
 put(&q("[data-streak-clock]")?,"textContent",&s(&format_clock(info.seconds)));
 put(&q("[data-streak-best]")?,"textContent",&s(&ntext(info.best)));
 put(&q("[data-streak-total]")?,"textContent",&s(&ntext(info.total)));
 put(&q("[data-streak-widget]")?,"hidden",&b(!me.widget_offer.get()));
 let (year,month)=me.shown_month.get();
 let month_name=if month>=0.0&&month<12.0&&month.fract()==0.0{MONTHS[month as usize]}else{"undefined"};
 put(&q("[data-streak-month-label]")?,"textContent",&s(&format!("{month_name} {}",ntext(year))));
 let today=me.today();
 let (current_year,current_month)=noon_month(&today)?;
 put(&q("[data-streak-month=\"1\"]")?,"disabled",&b(year>current_year||(year==current_year&&month>=current_month)));
 let cells=month_grid(&me.state.borrow(),year,month,&today)?;
 put(&q("[data-streak-grid]")?,"innerHTML",&s(&grid_markup(&cells,month)));
 Ok(())
}
fn open_panel(me:&Me,from:&JsValue)->R{
 let panel=ensure_panel(me)?;
 *me.panel_return.borrow_mut()=if truthy(from){from.clone()}else{get(&me.document,"activeElement")};
 let (year,month)=noon_month(&me.today())?;
 me.shown_month.set(month_after(year,month)?);
 // Asked once on opening (they are synchronous calls to the system).
 me.widget_offer.set(me.widget_call("canPin",JsValue::FALSE)==JsValue::TRUE&&me.widget_call("isPlaced",JsValue::FALSE)==JsValue::FALSE);
 put(&method(&panel,"querySelector",&[&s("[data-streak-widget-title]")])?,"textContent",&s("Añade la racha a tu pantalla de inicio"));
 put(&method(&panel,"querySelector",&[&s("[data-streak-widget-text]")])?,"textContent",&s("Un widget con tu llama y los días de esta semana."));
 render_panel(me)?;
 put(&panel,"hidden",&JsValue::FALSE);
 let shown=panel.clone();
 frame(move||{cls_add(&shown,&["is-open"]);Ok(())});
 method(&method(&panel,"querySelector",&[&s(".streak-panel-close")])?,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;
 Ok(())
}
fn close_panel(me:&Me)->R{
 let panel=me.panel.borrow().clone();
 if !truthy(&panel)||truthy(&get(&panel,"hidden")){return Ok(());}
 cls_remove(&panel,&["is-open"]);
 let owner=me.clone();
 let done=move||->R{let panel=owner.panel.borrow().clone();put(&panel,"hidden",&JsValue::TRUE);focus(&owner.panel_return.borrow().clone());Ok(())};
 if reduced_motion()?{done()?;}else{after(200.0,done);}
 Ok(())
}
fn reduced_motion()->R<bool>{Ok(truthy(&get(&call(&get(&global(),"matchMedia"),"matchMedia",&[&s("(prefers-reduced-motion: reduce)")])?,"matches")))}
fn trap_focus(me:&Me,event:&JsValue,root:&JsValue)->R{
 let found=method(root,"querySelectorAll",&[&s("button:not([disabled])")])?;
 let items:Vec<JsValue>=Array::from(&found).iter().filter(|item|!get(item,"offsetParent").is_null()).collect();
 let (Some(first),Some(last))=(items.first(),items.last())else{return Ok(())};
 let active=get(&me.document,"activeElement");
 let shift=truthy(&get(event,"shiftKey"));
 if shift&&active==*first{prevent_default(event);focus_plain(last);}
 else if !shift&&active==*last{prevent_default(event);focus_plain(first);}
 Ok(())
}

// ---- the celebration
fn celebrate(me:&Me)->R{
 if me.celebrating.borrow().is_some(){return Ok(());}
 let today=me.today();
 me.state.borrow_mut().celebrated=today.clone();me.dirty.set(true);me.persist(true)?;
 let (info,week)={let state=me.state.borrow();(info(&state,&today),week_days(&state,&today))};
 let before=jmax(0.0,info.current-1.0);
 let reduced=reduced_motion()?;
 let milestone=match info.current as i64{_ if info.current.fract()!=0.0=>None,7=>Some("¡Una semana entera leyendo!"),30=>Some("¡Un mes sin fallar ni un día!"),100=>Some("¡Cien días de lectura!"),365=>Some("¡Un año entero leyendo cada día!"),_=>None};
 let title=if info.current==1.0{"¡Tu racha empieza hoy!"}else{milestone.unwrap_or("¡Racha ampliada!")};
 let text=if info.current==1.0{"Has leído 5 minutos. Vuelve mañana para que siga creciendo.".to_string()}
  else{format!("Has leído 5 minutos hoy. Mañana llegarás a {} días.",ntext(info.current+1.0))};
 let layer=method(&me.document,"createElement",&[&s("div")])?;
 put(&layer,"className",&s("streak-celebration"));
 set_attr(&layer,"role","dialog");set_attr(&layer,"aria-modal","true");
 set_attr(&layer,"aria-labelledby","streak-celebration-title");set_attr(&layer,"aria-describedby","streak-celebration-text");
 put(&layer,"innerHTML",&s(&celebration_markup(&info,&week,before,title,&text)));
 append(&me.body,&layer);
 let previous=get(&me.document,"activeElement");
 *me.celebrating.borrow_mut()=Some(Celebration{timers:Vec::new()});
 let finish={let (owner,layer,previous)=(me.clone(),layer.clone(),previous.clone());Rc::new(move|open:bool|->R{finish_celebration(&owner,&layer,&previous,reduced,open)})};
 let continue_button=method(&layer,"querySelector",&[&s("[data-streak-continue]")])?;
 {let (owner,finish)=(me.clone(),finish.clone());method(&continue_button,"addEventListener",&[&s("click"),&function(move|_|{owner.fb("tap")?;finish(false)})])?;}
 {let (owner,finish)=(me.clone(),finish.clone());method(&method(&layer,"querySelector",&[&s("[data-streak-calendar]")])?,"addEventListener",&[&s("click"),&function(move|_|{owner.fb("tap")?;finish(true)})])?;}
 {let (owner,finish,root)=(me.clone(),finish.clone(),layer.clone());method(&layer,"addEventListener",&[&s("keydown"),&function(move|event|{
  let key=get(&event,"key").as_string().unwrap_or_default();
  if key=="Escape"{prevent_default(&event);finish(false)?;}
  if key=="Tab"{trap_focus(&owner,&event,&root)?;}
  Ok(())
 })])?;}
 {let shown=layer.clone();frame(move||{cls_add(&shown,&["is-in"]);Ok(())});}
 let later=|ms:f64,step:Box<dyn FnOnce()->R>|{
  let timer=after(if reduced{0.0}else{ms},step);
  if let Some(celebration)=me.celebrating.borrow_mut().as_mut(){celebration.timers.push(timer);}
 };
 {let (owner,layer)=(me.clone(),layer.clone());later(300.0,Box::new(move||{cls_add(&layer,&["is-lit"]);owner.fb("ignite")}));}
 {let (owner,layer)=(me.clone(),layer.clone());later(680.0,Box::new(move||{cls_add(&layer,&["is-counted"]);owner.fb("tick")}));}
 {let (owner,layer)=(me.clone(),layer.clone());later(1080.0,Box::new(move||{cls_add(&layer,&["is-week"]);owner.fb("pop")}));}
 {let (owner,layer)=(me.clone(),layer.clone());later(1450.0,Box::new(move||{
  cls_add(&layer,&["is-ready"]);owner.fb("rest")?;
  method(&method(&layer,"querySelector",&[&s("[data-streak-continue]")])?,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;Ok(())
 }));}
 if reduced{method(&continue_button,"focus",&[&obj(&[("preventScroll",&JsValue::TRUE)])])?;}
 Ok(())
}
fn finish_celebration(me:&Me,layer:&JsValue,previous:&JsValue,reduced:bool,open_calendar:bool)->R{
 let Some(celebration)=me.celebrating.borrow_mut().take()else{return Ok(())};
 for timer in &celebration.timers{cancel(timer);}
 me.last_tick.set(me.now()?);activity(me)?;
 cls_add(layer,&["is-leaving"]);
 {let layer=layer.clone();after(if reduced{0.0}else{260.0},move||{remove(&layer);Ok(())});}
 let chips=me.chips.borrow().clone();
 if open_calendar{
  let visible=chips.iter().find(|chip|truthy(&get(chip,"offsetParent"))).cloned();
  open_panel(me,&visible.unwrap_or_else(||previous.clone()))?;
 }else{focus(previous);}
 // The header counter gives a little jump when it lights up.
 for chip in &chips{
  cls_remove(chip,&["is-bumped"]);let _=get(chip,"offsetWidth");cls_add(chip,&["is-bumped"]);
  let bumped=chip.clone();
  method(chip,"addEventListener",&[&s("animationend"),&function(move|_|{cls_remove(&bumped,&["is-bumped"]);Ok(())}),&options(&[("once",true)])])?;
 }
 Ok(())
}

/// The reading streak of one document: header counters, reading timer, calendar panel, celebration and
/// widget. `host` carries the app's callbacks.
#[wasm_bindgen]
pub struct ReadingStreak{core:Me}

#[wasm_bindgen]
impl ReadingStreak{
 #[wasm_bindgen(constructor)]
 pub fn new(document:JsValue,storage:JsValue,host:JsValue)->R<ReadingStreak>{
  let body=read(&document,"body")?;
  let feedback=new_feedback(&storage)?;
  let pick=|name:&str|get(&host,name);
  let core=Rc::new(Core{
   document:document.clone(),body,storage,
   on_change:pick("onChange"),now:pick("now"),latest_book:pick("latestBook"),book_title:pick("bookTitle"),feedback,
   state:RefCell::new(Streak::default()),today:RefCell::new(String::new()),
   dirty:Cell::new(false),last_save:Cell::new(0.0),last_tick:Cell::new(0.0),last_activity:Cell::new(0.0),
   timer:RefCell::new(f(0.0)),clock_timer:RefCell::new(None),book_start:RefCell::new(None),reading_session:Cell::new(false),
   celebrating:RefCell::new(None),panel:RefCell::new(JsValue::NULL),destroyed:Cell::new(false),info_cache:Cell::new(None),widget_revision:Cell::new(0.0),
   last_prune_day:RefCell::new(String::new()),widget_sent_day:RefCell::new(String::new()),widget_sent_minute:Cell::new(-1.0),widget_sent_revision:Cell::new(-1.0),widget_sent:RefCell::new(String::new()),
   book_sent:RefCell::new(s("")),cover_sent:RefCell::new(s("")),book_task:RefCell::new(js_sys::Promise::resolve(&undef()).into()),
   chips:RefCell::new(Vec::new()),reader_screen:RefCell::new(JsValue::NULL),
   shown_month:Cell::new((f64::NAN,f64::NAN)),panel_return:RefCell::new(JsValue::NULL),widget_offer:Cell::new(false),
   tick_fn:RefCell::new(undef()),activity_fn:RefCell::new(undef()),visibility_fn:RefCell::new(undef()),
   page_observer:RefCell::new(undef()),screen_observer:RefCell::new(undef()),
  });
  let me=&core;
  // The state combines the synced copy and this device's own.
  let synced=parse_text(&me.read(STREAK_KEY));let local=parse_text(&me.read(LOCAL_KEY));
  *me.state.borrow_mut()=merge(&[synced,local]);
  *me.today.borrow_mut()=day_at(me.now()?)?;
  me.last_save.set(me.now()?);
  {let owner=Rc::downgrade(me);*me.feedback.wanted.borrow_mut()=Some(Box::new(move||->bool{
   let Some(owner)=owner.upgrade() else{return false};
   owner.reading()&&{let info=info(&owner.state.borrow(),&owner.today());!info.done_today&&info.remaining<=120.0}
  }));}

  // ---- header counters
  *me.chips.borrow_mut()=qsa(&document,"[data-streak-chip]");
  // ---- last book on the widget
  let toggle=method(&document,"getElementById",&[&s("widget-book-toggle")])?;
  let row=if absent(&toggle){JsValue::UNDEFINED}else{closest(&toggle,"[data-widget-book-setting]")};
  if truthy(&toggle)&&get(&me.bridge(),"updateBook").is_function(){
   if truthy(&row){put(&row,"hidden",&JsValue::FALSE);}
   put(&toggle,"checked",&b(me.book_enabled()));
   let (owner,target)=(me.clone(),toggle.clone());
   method(&toggle,"addEventListener",&[&s("change"),&function(move|_|{
    owner.write(BOOK_KEY,if truthy(&get(&target,"checked")){"on"}else{"off"});
    sync_widget_book(&owner)
   })])?;
  }
  for chip in me.chips.borrow().iter(){
   put(chip,"innerHTML",&s(&format!("<span class=\"streak-chip-icon\">{}{}</span><span class=\"streak-chip-count\">0</span>",flame_svg("is-base is-idle"),flame_svg("is-fill"))));
   let (owner,from)=(me.clone(),chip.clone());
   method(chip,"addEventListener",&[&s("click"),&function(move|_|{owner.fb("tap")?;open_panel(&owner,&from)})])?;
  }

  // ---- reading timer
  *me.reader_screen.borrow_mut()=method(&document,"getElementById",&[&s("reader-screen")])?;
  {let owner=me.clone();*me.tick_fn.borrow_mut()=function(move|_|tick(&owner));}
  {let owner=me.clone();*me.activity_fn.borrow_mut()=function(move|_|activity(&owner));}
  let activity_fn=me.activity_fn.borrow().clone();
  for kind in ACTIVITY{method(&global(),"addEventListener",&[&s(kind),&activity_fn,&options(&[("capture",true),("passive",true)])])?;}
  // Turning a page inside the book (iframes included) changes the progress bar.
  let page_observer=crate::host::construct("MutationObserver",&[&activity_fn])?;
  let watched=[method(&document,"getElementById",&[&s("reader-progress-fill")])?,method(&document,"querySelector",&[&s(".reader-location-label")])?];
  for node in watched.iter(){
   if truthy(node){method(&page_observer,"observe",&[node,&options(&[("attributes",true),("childList",true),("characterData",true),("subtree",true)])])?;}
  }
  *me.page_observer.borrow_mut()=page_observer;
  let screen_observer={let owner=me.clone();crate::host::construct("MutationObserver",&[&function(move|_|sync_timer(&owner))])?};
  let filter=|name:&str|{let config=options(&[("attributes",true)]);put(&config,"attributeFilter",&Array::of1(&s(name)).into());config};
  method(&screen_observer,"observe",&[&me.body,&filter("class")])?;
  let screen=me.reader_screen.borrow().clone();
  if truthy(&screen){method(&screen_observer,"observe",&[&screen,&filter("hidden")])?;}
  *me.screen_observer.borrow_mut()=screen_observer;
  {let owner=me.clone();*me.visibility_fn.borrow_mut()=function(move|_|{
   sync_timer(&owner)?;
   if get(&owner.document,"visibilityState").as_string().as_deref()==Some("hidden"){owner.persist(false)?;sync_widget_book(&owner)?;}
   else{refresh_day(&owner)?;schedule_day_refresh(&owner)?;}
   Ok(())
  });}
  method(&document,"addEventListener",&[&s("visibilitychange"),&me.visibility_fn.borrow()])?;
  {let owner=me.clone();method(&global(),"addEventListener",&[&s("pagehide"),&function(move|_|owner.persist(false))])?;}
  schedule_day_refresh(me)?;

  render_chips(me)?;
  sync_timer(me)?;
  {let owner=me.clone();*me.book_start.borrow_mut()=Some(after(4000.0,move||{owner.book_start.borrow_mut().take();sync_widget_book(&owner)}));}
  Ok(ReadingStreak{core})
 }
 /// Another device uploaded its streak: merge it with this one.
 pub fn reconcile(&self)->R{
  let me=&self.core;
  let synced=parse_text(&me.read(STREAK_KEY));let local=parse_text(&me.read(LOCAL_KEY));
  let current=me.state.borrow().clone();
  let merged=merge(&[current.clone(),synced,local]);
  let changed=merged.json()!=current.json();
  *me.state.borrow_mut()=merged;
  if changed{me.info_cache.set(None);me.widget_revision.set(me.widget_revision.get()+1.0);}
  let text=me.state.borrow().json();
  me.write(LOCAL_KEY,&text);
  me.publish()?;
  if changed{render_chips(me)?;}
  Ok(())
 }
 pub fn info(&self)->JsValue{info_object(&info(&self.core.state.borrow(),&self.core.today()))}
 pub fn celebrate(&self)->R{celebrate(&self.core)}
 #[wasm_bindgen(js_name=openPanel)]
 pub fn open_panel(&self,from:JsValue)->R{open_panel(&self.core,&from)}
 pub fn destroy(&self)->R{
  let me=&self.core;
  if me.destroyed.get(){return Ok(());}
  me.destroyed.set(true);
  me.persist(false)?;
  stop_interval(me)?;
  if let Some(timer)=me.clock_timer.borrow_mut().take(){cancel(&timer);}
  if let Some(timer)=me.book_start.borrow_mut().take(){cancel(&timer);}
  method(&me.page_observer.borrow(),"disconnect",&[])?;method(&me.screen_observer.borrow(),"disconnect",&[])?;
  method(&me.document,"removeEventListener",&[&s("visibilitychange"),&me.visibility_fn.borrow()])?;
  let activity_fn=me.activity_fn.borrow().clone();
  for kind in ACTIVITY{method(&global(),"removeEventListener",&[&s(kind),&activity_fn,&options(&[("capture",true)])])?;}
  me.fb("destroy")
 }
}

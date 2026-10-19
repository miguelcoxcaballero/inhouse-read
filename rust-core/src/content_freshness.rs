//! Reload eligibility and concurrency for the already-loaded app shell.
//! Network, URL resolution, storage and reload remain browser operations.
pub struct Freshness{started:Vec<u16>,checking:bool}
pub struct Launch{touched:bool,reloading:bool}
#[no_mangle]
pub unsafe extern "C" fn freshness_new(text:*const u16,len:usize)->*mut Freshness{
 if len>16_000_000||(len>0&&text.is_null()){return std::ptr::null_mut();}
 let started=if len==0{Vec::new()}else{std::slice::from_raw_parts(text,len).to_vec()};
 Box::into_raw(Box::new(Freshness{started,checking:false}))
}
#[no_mangle]
pub unsafe extern "C" fn freshness_free(handle:*mut Freshness){if !handle.is_null(){drop(Box::from_raw(handle));}}
#[no_mangle]
pub unsafe extern "C" fn freshness_begin(handle:*mut Freshness)->u32{
 let Some(state)=handle.as_mut()else{return 0;};if state.checking{return 0;}state.checking=true;1
}
#[no_mangle]
pub unsafe extern "C" fn freshness_finish(handle:*mut Freshness){if let Some(state)=handle.as_mut(){state.checking=false;}}
#[no_mangle]
pub unsafe extern "C" fn freshness_newer(handle:*const Freshness,text:*const u16,len:usize)->u32{
 let Some(state)=handle.as_ref()else{return 0;};if state.started.is_empty()||len==0||len>16_000_000||text.is_null(){return 0;}
 (state.started.as_slice()!=std::slice::from_raw_parts(text,len))as u32
}
#[no_mangle]
pub extern "C" fn freshness_retry(same:u32,now:f64,last:f64)->u32{(!(same!=0&&now-last<120_000.0))as u32}
#[no_mangle]
pub extern "C" fn freshness_interval()->u32{600_000}
#[no_mangle]
pub extern "C" fn freshness_safe(reader_exists:u32,hidden_is_false:u32)->u32{(reader_exists==0||hidden_is_false==0)as u32}
#[no_mangle]
pub extern "C" fn freshness_launch_new()->*mut Launch{Box::into_raw(Box::new(Launch{touched:false,reloading:false}))}
#[no_mangle]
pub unsafe extern "C" fn freshness_launch_touch(handle:*mut Launch){if let Some(state)=handle.as_mut(){state.touched=true;}}
#[no_mangle]
pub unsafe extern "C" fn freshness_launch_untouched(handle:*const Launch)->u32{handle.as_ref().is_some_and(|state|!state.touched)as u32}
#[no_mangle]
pub unsafe extern "C" fn freshness_launch_reload(handle:*mut Launch,started:u32)->u32{
 let Some(state)=handle.as_mut()else{return 0;};state.reloading|=started!=0;state.reloading as u32
}
#[no_mangle]
pub unsafe extern "C" fn freshness_launch_free(handle:*mut Launch){if !handle.is_null(){drop(Box::from_raw(handle));}}

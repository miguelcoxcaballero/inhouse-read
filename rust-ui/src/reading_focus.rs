//! «Sin avisos al leer» (solo en la app Android): con un libro abierto, un modo No molestar de la app
//! oculta las notificaciones emergentes. Android pide una vez el permiso de «No molestar»; la app lo
//! enciende y apaga sola con el lector. This is the settings switch of src/js/reading-focus.js: it reads
//! the bridge's state, asks for the permission once the switch is turned on without it, explains where
//! to grant it, and reads the state again when the page comes back from Android's settings.
//!
//! The listeners are plain functions owned by the page, as the original's arrow functions were: the
//! returned function removes them, and dropping it (app.js keeps no reference) leaves them in place.
use std::{cell::Cell,rc::Rc};
use wasm_bindgen::prelude::*;
use crate::host::{absent,get,global,method,read,set,truthy};
type R<T=()>=Result<T,JsValue>;

/// `view?.InhouseReadingFocus` when it has a `state()` method.
fn bridge_of(view:&JsValue)->R<Option<JsValue>>{
 let bridge=if absent(view){JsValue::UNDEFINED}else{read(view,"InhouseReadingFocus")?};
 Ok(if truthy(&bridge)&&read(&bridge,"state")?.is_function(){Some(bridge)}else{None})
}

/// `JSON.parse(bridge.state()) || {}`, an empty state when either throws.
fn read_state(bridge:&JsValue)->JsValue{
 let parsed=method(bridge,"state",&[]).and_then(|text|method(&get(&global(),"JSON"),"parse",&[&text]));
 match parsed{Ok(state) if truthy(&state)=>state,_=>js_sys::Object::new().into()}
}

struct Switch{bridge:JsValue,toggle:JsValue,hint:JsValue,asked:Cell<bool>}
impl Switch{
 fn render(&self)->R{
  let state=read_state(&self.bridge);
  let (enabled,access)=(truthy(&get(&state,"enabled")),truthy(&get(&state,"access")));
  set(&self.toggle,"checked",&JsValue::from_bool(enabled&&access))?;
  if truthy(&self.hint){set(&self.hint,"hidden",&JsValue::from_bool(!(self.asked.get()&&enabled&&!access)))?;}
  Ok(())
 }
 fn change(&self)->R{
  let _=read(&self.toggle,"checked").and_then(|checked|method(&self.bridge,"setEnabled",&[&checked]));
  let state=read_state(&self.bridge);
  // Solo tras pedirlo aquí: si falta el permiso, se explica dónde darlo.
  if truthy(&read(&self.toggle,"checked")?)&&!truthy(&get(&state,"access")){
   self.asked.set(true);
   set(&self.toggle,"checked",&JsValue::FALSE)?;
   let _=method(&self.bridge,"openAccess",&[]);
  }
  self.render()
 }
}

fn handler(body:impl Fn()->R+'static)->JsValue{
 Closure::<dyn Fn(JsValue)>::new(move|_:JsValue|{if let Err(error)=body(){wasm_bindgen::throw_val(error)}}).into_js_value()
}

/// Binds the settings switch; answers the function that unbinds it.
#[wasm_bindgen]
pub fn reading_focus_bind(document:JsValue,view:JsValue)->R<JsValue>{
 let bridge=bridge_of(&view)?;
 let toggle=method(&document,"getElementById",&[&"reading-focus-toggle".into()])?;
 let row=if absent(&toggle){JsValue::UNDEFINED}else{method(&toggle,"closest",&[&"[data-reading-focus-setting]".into()])?};
 let hint=method(&document,"getElementById",&[&"reading-focus-hint".into()])?;
 let Some(bridge)=bridge.filter(|bridge|truthy(&toggle)&&truthy(&row)&&truthy(&get(&read_state(bridge),"supported")))
 else{return Ok(Closure::<dyn Fn()>::new(||{}).into_js_value())};
 set(&row,"hidden",&JsValue::FALSE)?;
 let switch=Rc::new(Switch{bridge,toggle:toggle.clone(),hint,asked:Cell::new(false)});
 let change=handler({let switch=switch.clone();move||switch.change()});
 // Al volver del ajuste de Android el permiso puede haber cambiado.
 let visible=handler({let switch=switch.clone();let document=document.clone();move||{
  if read(&document,"visibilityState")?=="visible"{switch.render()?;}Ok(())
 }});
 method(&toggle,"addEventListener",&[&"change".into(),&change])?;
 method(&document,"addEventListener",&[&"visibilitychange".into(),&visible])?;
 method(&view,"addEventListener",&[&"focus".into(),&visible])?;
 switch.render()?;
 Ok(Closure::<dyn Fn()->R>::new(move||{
  method(&toggle,"removeEventListener",&[&"change".into(),&change])?;
  method(&document,"removeEventListener",&[&"visibilitychange".into(),&visible])?;
  method(&view,"removeEventListener",&[&"focus".into(),&visible])?;
  Ok(())
 }).into_js_value())
}

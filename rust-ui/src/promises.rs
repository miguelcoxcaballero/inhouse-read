//! Promise reactions that own what they need: a callback that runs when a promise settles,
//! either way, and then lets go of itself.
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::prelude::*;
use crate::host::method;

type Reaction = Closure<dyn FnMut(JsValue)>;

/// `promise.then(done, done)` for a callback that runs once, whatever the outcome. The two
/// reactions are released as soon as one of them has run; the derived promise is dropped.
pub fn after(promise: &JsValue, done: impl FnOnce() + 'static) -> Result<(), JsValue> {
    let pair: Rc<RefCell<Option<(Reaction, Reaction)>>> = Rc::new(RefCell::new(None));
    let action: Rc<RefCell<Option<Box<dyn FnOnce()>>>> = Rc::new(RefCell::new(Some(Box::new(done))));
    let reaction = || {
        let (pair, action) = (pair.clone(), action.clone());
        Closure::wrap(Box::new(move |_: JsValue| {
            let work = action.borrow_mut().take();
            if let Some(work) = work { work(); }
            pair.borrow_mut().take();
        }) as Box<dyn FnMut(JsValue)>)
    };
    let (fulfilled, rejected) = (reaction(), reaction());
    method(promise, "then", &[fulfilled.as_ref(), rejected.as_ref()])?;
    *pair.borrow_mut() = Some((fulfilled, rejected));
    Ok(())
}

//! An `async function` as the page knows it: the body runs at once, up to its first
//! wait, and goes on in the very microtask in which the promise it waits for settles.
//! `future_to_promise` starts a body on the next microtask and resumes it one task after
//! its wait is over, which moves every effect (a canvas created, a navigation begun, a
//! frame requested) behind the caller's own next statement and behind other microtasks
//! the page orders by exact counts.
use std::{cell::{Cell, RefCell}, future::Future, pin::Pin, rc::Rc, sync::Arc, task::{Context, Wake, Waker}};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use js_sys::{Function, Promise};

type Body = Pin<Box<dyn Future<Output = ()>>>;

struct Task { body: RefCell<Option<Body>>, polling: Cell<bool>, again: Cell<bool> }
// The page is single threaded; the task never leaves it.
unsafe impl Send for Task {}
unsafe impl Sync for Task {}

struct Wakeup(Rc<Task>);
unsafe impl Send for Wakeup {}
unsafe impl Sync for Wakeup {}
impl Wake for Wakeup {
    // Called from the reaction job of the promise being awaited: continue right there.
    fn wake(self: Arc<Self>) { poll(&self.0); }
}

fn poll(task: &Rc<Task>) {
    // A wake-up while the body itself is running (it settled something it awaits) is
    // picked up by the loop below instead of re-entering the body.
    if task.polling.replace(true) { task.again.set(true); return; }
    loop {
        task.again.set(false);
        let Some(mut body) = task.body.borrow_mut().take() else { break };
        let waker = Waker::from(Arc::new(Wakeup(task.clone())));
        let pending = body.as_mut().poll(&mut Context::from_waker(&waker)).is_pending();
        if pending { *task.body.borrow_mut() = Some(body); }
        if !pending || !task.again.get() { break; }
    }
    task.polling.set(false);
}

/// Run `body` like an `async function` and return its promise.
pub fn eager<F>(body: F) -> Promise where F: Future<Output = Result<JsValue, JsValue>> + 'static {
    let mut settle: Option<(Function, Function)> = None;
    let promise = Promise::new(&mut |resolve, reject| settle = Some((resolve, reject)));
    let (resolve, reject) = settle.expect("The promise executor runs at once");
    let task = Rc::new(Task { polling: Cell::new(false), again: Cell::new(false), body: RefCell::new(Some(Box::pin(async move {
        let _ = match body.await {
            Ok(value) => resolve.call1(&JsValue::UNDEFINED, &value),
            Err(error) => reject.call1(&JsValue::UNDEFINED, &error),
        };
    }))) });
    poll(&task);
    promise
}

/// `await value`: any value, a promise or a thenable.
pub async fn settled(value: JsValue) -> Result<JsValue, JsValue> { JsFuture::from(Promise::resolve(&value)).await }

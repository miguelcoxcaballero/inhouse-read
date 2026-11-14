//! `await value` for code that waits many times a second (the synthesis worker waits a dozen times per fragment).
//! `JsFuture` makes two Rust closures for every wait, and each one is registered with, and later removed from, the
//! finalization registry of the generated bindings: a few microseconds per wait. Here the two callbacks exist once per
//! realm; a wait hands the promise `callback.bind(null, slot)`, a function the engine makes itself, and finds its answer
//! in a table. The continuation runs in the very reaction job of the promise, exactly as with `JsFuture`
//! (`Promise.resolve(value).then(...)`): the microtask of every step is the one an `async function` would use.
use std::{cell::RefCell, future::Future, pin::Pin, task::{Context, Poll, Waker}};
use js_sys::{Function, Promise};
use wasm_bindgen::prelude::*;

type Answer = Result<JsValue, JsValue>;
enum Slot { Free(usize), Waiting(Option<Waker>), Done(Answer), Abandoned }
struct Table { slots: Vec<Slot>, free: usize }
const NONE: usize = usize::MAX;

thread_local! {
    static TABLE: RefCell<Table> = const { RefCell::new(Table { slots: Vec::new(), free: NONE }) };
    static SETTLE: (Function, Function) = (
        Closure::<dyn FnMut(f64, JsValue)>::new(|slot: f64, value: JsValue| settle(slot as usize, Ok(value))).into_js_value().unchecked_into(),
        Closure::<dyn FnMut(f64, JsValue)>::new(|slot: f64, error: JsValue| settle(slot as usize, Err(error))).into_js_value().unchecked_into(),
    );
}
#[wasm_bindgen]
extern "C" {
    type Callback;
    /// `callback.bind(null, slot)`.
    #[wasm_bindgen(method, js_name = bind)]
    fn bound(this: &Callback, receiver: &JsValue, slot: f64) -> JsValue;
    type Thenable;
    #[wasm_bindgen(method, js_name = then)]
    fn then_both(this: &Thenable, fulfilled: &JsValue, rejected: &JsValue) -> JsValue;
}

fn release(table: &mut Table, slot: usize) { table.slots[slot] = Slot::Free(table.free); table.free = slot; }
fn settle(slot: usize, answer: Answer) {
    let waker = TABLE.with(|table| {
        let mut table = table.borrow_mut();
        match std::mem::replace(&mut table.slots[slot], Slot::Abandoned) {
            Slot::Waiting(waker) => { table.slots[slot] = Slot::Done(answer); waker }
            _ => { release(&mut table, slot); None } // nobody waits any more
        }
    });
    // Outside the table's borrow: the continuation may start further waits at once.
    if let Some(waker) = waker { waker.wake(); }
}

/// The wait for one promise; dropping it forgets the answer.
pub struct Wait { slot: usize, over: bool }
impl Future for Wait {
    type Output = Answer;
    fn poll(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Answer> {
        let slot = self.slot;
        let answer = TABLE.with(|table| {
            let mut table = table.borrow_mut();
            match std::mem::replace(&mut table.slots[slot], Slot::Abandoned) {
                Slot::Done(answer) => { release(&mut table, slot); Some(answer) }
                _ => { table.slots[slot] = Slot::Waiting(Some(context.waker().clone())); None }
            }
        });
        match answer { Some(answer) => { self.over = true; Poll::Ready(answer) } None => Poll::Pending }
    }
}
impl Drop for Wait {
    fn drop(&mut self) {
        if self.over { return; }
        let slot = self.slot;
        TABLE.with(|table| {
            let mut table = table.borrow_mut();
            if matches!(table.slots[slot], Slot::Done(_)) { release(&mut table, slot); } else { table.slots[slot] = Slot::Abandoned; }
        });
    }
}

/// `await value`: any value, a promise or a thenable.
pub fn wait(value: &JsValue) -> Wait {
    let slot = TABLE.with(|table| {
        let mut table = table.borrow_mut();
        match table.free {
            NONE => { table.slots.push(Slot::Waiting(None)); table.slots.len() - 1 }
            slot => { if let Slot::Free(next) = table.slots[slot] { table.free = next; } table.slots[slot] = Slot::Waiting(None); slot }
        }
    });
    SETTLE.with(|(fulfilled, rejected)| {
        let (fulfilled, rejected): (&Callback, &Callback) = (fulfilled.unchecked_ref(), rejected.unchecked_ref());
        Promise::resolve(value).unchecked_ref::<Thenable>().then_both(&fulfilled.bound(&JsValue::NULL, slot as f64), &rejected.bound(&JsValue::NULL, slot as f64));
    });
    Wait { slot, over: false }
}

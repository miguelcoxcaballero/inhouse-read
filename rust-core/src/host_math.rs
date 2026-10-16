//! Requests for the few functions whose last bit belongs to the browser: `Math.sin`, `Math.cos`,
//! `Math.pow` (`**`) and `Math.hypot` differ between engines (V8 ships a fdlibm port in one
//! build and glibc's in another, and its `hypot` has its own summation), so a kernel never
//! computes them itself. It writes what it needs as (operation, a, b) triples in a request
//! block; the host fills a result block with one number per request from its own `Math`
//! (see host-math.js) and calls the next stage. The numbers are the ones the JavaScript
//! this replaces computed, in the engine that runs the page. Everything else is IEEE
//! arithmetic the core reproduces exactly.
pub const SIN: f64 = 0.0;
pub const COS: f64 = 1.0;
pub const POW: f64 = 2.0;
pub const HYPOT: f64 = 3.0;
/// A request the plan does not need for this input: the host skips it.
pub const NONE: f64 = 4.0;

/// Request `slot` of the block.
pub fn put(requests: &mut [f64], slot: usize, operation: f64, a: f64, b: f64) {
    requests[slot * 3] = operation;
    requests[slot * 3 + 1] = a;
    requests[slot * 3 + 2] = b;
}
pub fn skip(requests: &mut [f64], slot: usize) { put(requests, slot, NONE, 0.0, 0.0) }

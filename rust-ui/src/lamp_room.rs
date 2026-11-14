//! One frame of every lamp light of a room in a fixed number of calls.
//!
//! `shelf-lamp-lighting.js` used to cross into the module once for the room's transform, once for the plan and once per
//! lit light, copying its arrays in and out each time. A `LampRoomFrame` keeps what those calls kept apart (the pool's
//! quotas and key ranks, every slot's change stamps) and one arena the host writes a frame's numbers into and reads the
//! answers from: `plan` (the room's transform, which lamp each light takes), then `sample` (every point and cone light).
//! The arithmetic and the stamps are the ones of `lamp_light.rs`, called with the same numbers in the same order.
//!
//! The arena, in f64 from `reserve`'s pointer, for `lamps` candidates and `lights` slots:
//! `[room 16][slots 3 x lights][light in 37 x lights][light out 21 x lights][candidates 7 x lamps][plan 2 + 2 x lamps + 3 x lights]`.
//! A light's input is its model's world matrix (16) and inputs 82..103 of `lamp_light::light`; its output is the flags of
//! `LampLightState::light` and that function's outputs 0..20.
//!
//! Lifetime: the host's manager holds the handle and frees it when it is disposed.
use crate::lamp_light::{self, LampLightState, LampPoolState, CANDIDATE, LIGHT_IN, LIGHT_OUT, SLOT};
use wasm_bindgen::prelude::*;

const ROOM: usize = 16;
const LAMP_IN: usize = 37;
const LAMP_OUT: usize = 21;

struct Light { state: LampLightState, kind: f64, shadow: bool }

#[wasm_bindgen]
pub struct LampRoomFrame {
    pool: LampPoolState, lights: Vec<Light>, arena: Vec<f64>, lamp_room: usize, light_room: usize,
    count: usize, follow: bool, inverse: [f64; 16],
}

#[wasm_bindgen]
impl LampRoomFrame {
    #[wasm_bindgen(constructor)]
    pub fn new() -> LampRoomFrame {
        LampRoomFrame { pool:LampPoolState::new(), lights:Vec::new(), arena:Vec::new(), lamp_room:0, light_room:0, count:0, follow:false, inverse:[0.0; 16] }
    }
    pub fn memory(&self) -> JsValue { wasm_bindgen::memory() }
    /// Room for `lamps` candidates and `lights` slots; the arena's address. It only moves when a size changes.
    pub fn reserve(&mut self, lamps: usize, lights: usize) -> usize {
        if lamps != self.lamp_room || lights != self.light_room || self.arena.is_empty() {
            self.lamp_room = lamps; self.light_room = lights;
            self.arena = vec![0.0; ROOM + (SLOT + LAMP_IN + LAMP_OUT) * lights + CANDIDATE * lamps + 2 + 2 * lamps + 3 * lights];
        }
        self.arena.as_ptr() as usize
    }
    /// A light was made for a fixture kind (cone 0, point 1, N filaments N + 1), after the ones there are.
    pub fn slot_added(&mut self, kind: f64, shadow: bool) {
        let strips = if kind > 1.0 { kind as usize - 1 } else { 0 };
        self.lights.push(Light { state:LampLightState::new(strips), kind, shadow });
    }
    pub fn slot_removed(&mut self, index: usize) { if index < self.lights.len() { self.lights.remove(index); } }
    /// The pool the library's lamps ask for (see `LampPoolState::reconcile`), against the lights there are.
    pub fn reconcile(&mut self, entries: &[f64], limit: f64) -> Result<Vec<f64>, JsValue> {
        let slots: Vec<f64> = self.lights.iter().map(|light| light.kind).collect();
        self.pool.reconcile(entries, &slots, limit)
    }
    /// The room's transform (when there is one) and which lamp each light takes: the plan of `lamp_light::plan` is left in
    /// the arena, and every light given to another lamp forgets what it remembered. `false` when the sizes are not the
    /// arena's.
    pub fn plan(&mut self, count: usize, total: usize, transform: bool, middle: f64, rank_keys: &js_sys::Function) -> Result<bool, JsValue> {
        if count > self.lamp_room || total > self.light_room || total != self.lights.len() || self.arena.is_empty() { return Ok(false); }
        self.follow = false;
        if transform {
            let mut out = [0.0; 17];
            if !lamp_light::root(&self.arena[..ROOM], &mut out) { return Ok(false); }
            self.follow = out[0] != 0.0;
            self.inverse.copy_from_slice(&out[1..17]);
        }
        self.count = count;
        let lamps_at = ROOM + (SLOT + LAMP_IN + LAMP_OUT) * self.light_room;
        let plan_at = lamps_at + CANDIDATE * self.lamp_room;
        let (front, out) = self.arena.split_at_mut(plan_at);
        if !self.pool.plan(&front[lamps_at..lamps_at + CANDIDATE * count], &front[ROOM..ROOM + SLOT * total], middle, out, rank_keys)? { return Ok(false); }
        let events = out[1] as usize;
        for event in 0..events {
            if let Some(light) = self.lights.get_mut(out[2 + 2 * event] as usize) { light.state.assign(); }
        }
        Ok(true)
    }
    /// Every point and cone light the plan gave a lamp, from the inputs the host wrote after `plan`.
    pub fn sample(&mut self, shadow_dirty: bool) {
        let total = self.lights.len();
        let in_at = ROOM + SLOT * self.light_room;
        let out_at = in_at + LAMP_IN * self.light_room;
        let plan_at = out_at + LAMP_OUT * self.light_room + CANDIDATE * self.lamp_room + 2 + 2 * self.count;
        if self.arena.len() < plan_at + 3 * total || total > self.light_room { return; }
        let mut input = [0.0; LIGHT_IN + 1];
        let mut out = [0.0; LIGHT_OUT];
        if self.follow {
            input[16] = 1.0;
            input[17..33].copy_from_slice(&self.inverse);
            input[33..49].copy_from_slice(&self.arena[..ROOM]);
        }
        for (index, light) in self.lights.iter_mut().enumerate() {
            let found = self.arena[plan_at + 3 * index];
            if found < 0.0 || light.kind > 1.0 { continue; }
            let (lit, was_lit) = (self.arena[plan_at + 3 * index + 1] != 0.0, self.arena[ROOM + SLOT * index + 2] != 0.0);
            let at = in_at + LAMP_IN * index;
            input[..16].copy_from_slice(&self.arena[at..at + 16]);
            input[82..103].copy_from_slice(&self.arena[at + 16..at + LAMP_IN]);
            let flags = light.state.light(light.kind == 0.0, light.shadow, lit, was_lit, shadow_dirty, &input, &mut out);
            let to = out_at + LAMP_OUT * index;
            self.arena[to] = flags as f64;
            self.arena[to + 1..to + LAMP_OUT].copy_from_slice(&out[..LAMP_OUT - 1]);
        }
    }
    /// The strips of a filament fixture's light (see `LampLightState::filaments`).
    pub fn filaments(&mut self, index: usize, lit: bool, was_lit: bool, input: &[f64], out: &mut [f64]) -> u32 {
        match self.lights.get_mut(index) { Some(light) => light.state.filaments(lit, was_lit, input, out), None => 0 }
    }
}

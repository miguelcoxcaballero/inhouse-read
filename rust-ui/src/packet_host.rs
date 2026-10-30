//! Reading the shelf module's own packets inside the module.
//!
//! A packet (see `geo_packet`) is `[u32 header length][JSON header][padding][typed data]`. The host used to copy
//! it out of the module, parse the header and copy each array out of it (`openPacket` in geo-packet.js); for a
//! plant's bake that reading happens here, and every array the host receives is a fresh typed array with its own
//! buffer, exactly as the host's `copy` made it. The three.js objects are still made by the host.
use js_sys::{Array, Function, Reflect, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::num;

pub type R<T> = Result<T, JsValue>;

fn element_size(kind: &str) -> R<usize> {
    Ok(match kind {
        "u8" => 1,
        "i16" | "u16" => 2,
        "f32" | "u32" => 4,
        "f64" => 8,
        _ => return Err(js_sys::TypeError::new(&format!("unknown packet array type {kind}")).into()),
    })
}

fn typed_class(kind: &str) -> &'static str {
    match kind {
        "f32" => "Float32Array",
        "i16" => "Int16Array",
        "u8" => "Uint8Array",
        "u16" => "Uint16Array",
        "u32" => "Uint32Array",
        _ => "Float64Array",
    }
}

/// An opened packet: its parsed header and the typed data after it.
pub struct Packet {
    pub header: JsValue,
    bytes: Vec<u8>,
    base: usize,
}

impl Packet {
    pub fn open(bytes: Vec<u8>) -> R<Packet> {
        if bytes.len() < 4 {
            return Err(js_sys::RangeError::new("packet too short").into());
        }
        let length = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let text = std::str::from_utf8(bytes.get(4..4 + length).ok_or_else(|| JsValue::from(js_sys::RangeError::new("packet header out of range")))?)
            .map_err(|_| JsValue::from(js_sys::TypeError::new("packet header is not UTF-8")))?;
        let header = js_sys::JSON::parse(text)?;
        let base = (4 + length).div_ceil(4) * 4;
        Ok(Packet { header, bytes, base })
    }

    fn range(&self, kind: &str, at: f64, length: f64) -> R<&[u8]> {
        let start = self.base + at as usize;
        let end = start + length as usize * element_size(kind)?;
        self.bytes.get(start..end).ok_or_else(|| js_sys::RangeError::new("packet array out of range").into())
    }

    /// A typed array of `kind` copied out of the packet, over a buffer of its own (the host's `copy`).
    pub fn copy(&self, kind: &str, at: f64, length: f64) -> R<JsValue> {
        let bytes = Uint8Array::from(self.range(kind, at, length)?);
        let class: Function = Reflect::get(&js_sys::global(), &JsValue::from_str(typed_class(kind)))?.unchecked_into();
        Reflect::construct(&class, &Array::of1(&bytes.buffer()))
    }

    /// `copy` of a `[type, byteOffset, length]` triple.
    pub fn copy_triple(&self, triple: &JsValue) -> R<JsValue> {
        let triple: &Array = triple.unchecked_ref();
        let kind = triple.get(0).as_string().unwrap_or_default();
        self.copy(&kind, num(&triple.get(1)), num(&triple.get(2)))
    }
}

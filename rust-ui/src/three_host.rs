//! Building three.js objects from the shelf module's own packets, inside the module.
//!
//! A packet (see `geo_packet`) is `[u32 header length][JSON header][padding][typed data]`. The host used to copy
//! it out of the module, parse the header and walk it to make three's objects (`geo-packet.js`); the walk now
//! happens here. The objects themselves are still three's: every class comes from the `three` namespace the
//! host passes in, so nothing of three is re-implemented, and every array three receives is a fresh copy with
//! its own buffer, exactly as the host's `copy` made it. These are cold paths (one model is built once), so
//! property reads and writes cross the boundary freely.
use js_sys::{Array, Function, Object, Reflect, Uint8Array};
use wasm_bindgen::{prelude::*, JsCast};

use crate::host::{num, read, set, truthy};

pub type R<T> = Result<T, JsValue>;

/// The `three` module namespace handed over by the host.
pub struct Three<'a>(pub &'a JsValue);

impl<'a> Three<'a> {
    /// `THREE[name]`, which must exist.
    pub fn class(&self, name: &str) -> R<Function> {
        let value = Reflect::get(self.0, &JsValue::from_str(name))?;
        value.dyn_into::<Function>().map_err(|_| js_sys::TypeError::new(&format!("THREE.{name} is not a constructor")).into())
    }
    /// `new THREE[name](...args)`.
    pub fn new(&self, name: &str, args: &[&JsValue]) -> R<JsValue> {
        let list = Array::new();
        for argument in args {
            list.push(argument);
        }
        Reflect::construct(&self.class(name)?, &list)
    }
    /// A constant of the namespace (`THREE.RepeatWrapping`, `THREE.SRGBColorSpace`, ...).
    pub fn constant(&self, name: &str) -> R<JsValue> { Reflect::get(self.0, &JsValue::from_str(name)) }
}

/// `target.name(...args)`.
pub fn call(target: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> { crate::host::method(target, name, args) }

/// `target[a][b] = value`.
pub fn set_in(target: &JsValue, a: &str, b: &str, value: &JsValue) -> R<()> { set(&read(target, a)?, b, value) }

/// `target.userData`.
pub fn user_data(target: &JsValue) -> R<JsValue> { read(target, "userData") }

/// `value` as a JS number.
pub fn number(value: f64) -> JsValue { JsValue::from_f64(value) }

/// `[a, b, c]` as a JS array.
pub fn array(values: &[&JsValue]) -> Array {
    let list = Array::new();
    for value in values {
        list.push(value);
    }
    list
}

/// Visits `node` and then its descendants in order, as `Object3D#traverse` does.
pub fn traverse(node: &JsValue, visit: &mut dyn FnMut(&JsValue) -> R<()>) -> R<()> {
    visit(node)?;
    let children: Array = read(node, "children")?.unchecked_into();
    for index in 0..children.length() {
        traverse(&children.get(index), visit)?;
    }
    Ok(())
}

/// A `DataTexture` of RGBA bytes, `width` x `height`, with its own copy of the texels.
pub fn data_texture(three: &Three, texels: &[u8], width: f64, height: f64) -> R<JsValue> {
    let data: JsValue = Uint8Array::from(texels).into();
    three.new("DataTexture", &[&data, &number(width), &number(height), &three.constant("RGBAFormat")?])
}

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
    bytes: std::rc::Rc<Vec<u8>>,
    base: usize,
}

impl Packet {
    pub fn open(bytes: Vec<u8>) -> R<Packet> { Packet::open_shared(std::rc::Rc::new(bytes)) }

    /// A packet kept by the module (a cached template), opened without copying its bytes.
    pub fn open_shared(bytes: std::rc::Rc<Vec<u8>>) -> R<Packet> {
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
        Reflect::construct(&class, &array(&[&bytes.buffer()]))
    }

    /// `copy` of a `[type, byteOffset, length]` triple.
    pub fn copy_triple(&self, triple: &JsValue) -> R<JsValue> {
        let triple: &Array = triple.unchecked_ref();
        let kind = triple.get(0).as_string().unwrap_or_default();
        self.copy(&kind, num(&triple.get(1)), num(&triple.get(2)))
    }

    /// The exact f64 values of a `[type, byteOffset, length]` triple of type `f64`.
    pub fn f64s(&self, triple: &JsValue) -> R<Vec<f64>> {
        let triple: &Array = triple.unchecked_ref();
        let bytes = self.range("f64", num(&triple.get(1)), num(&triple.get(2)))?;
        Ok(bytes.chunks_exact(8).map(|word| f64::from_le_bytes(word.try_into().unwrap())).collect())
    }
}

/// A BufferGeometry as three builds one (the host's `geometryOf`): Float32 attributes in the packet's order (a
/// generator's own attribute class, or the plain attribute `mergeGeometries` makes when the record's `type` is
/// "BufferGeometry"), the index as `setIndex(array)` makes it (16 or 32 bit), an absent index left absent. The
/// geometry takes the record's `type`.
pub fn geometry_of(three: &Three, packet: &Packet, record: &JsValue) -> R<JsValue> {
    let geometry = three.new("BufferGeometry", &[])?;
    let kind = read(record, "type")?;
    let merged = !truthy(&kind) || kind.as_string().is_some_and(|text| text == "BufferGeometry");
    if truthy(&kind) {
        set(&geometry, "type", &kind)?;
    }
    let attributes: Array = read(record, "attributes")?.unchecked_into();
    for entry in attributes.iter() {
        let entry: Array = entry.unchecked_into();
        let (at, length) = (num(&entry.get(3)), num(&entry.get(4)));
        let values = packet.copy("f32", at, length)?;
        let attribute = three.new(if merged { "BufferAttribute" } else { "Float32BufferAttribute" }, &[&values, &entry.get(1)])?;
        call(&geometry, "setAttribute", &[&entry.get(0), &attribute])?;
    }
    let index = read(record, "index")?;
    if truthy(&index) {
        let triple: &Array = index.unchecked_ref();
        let wide = triple.get(0).as_string().is_some_and(|text| text == "u32");
        let values = packet.copy_triple(&index)?;
        let attribute = three.new(if wide { "Uint32BufferAttribute" } else { "Uint16BufferAttribute" }, &[&values, &number(1.0)])?;
        call(&geometry, "setIndex", &[&attribute])?;
    }
    let groups = read(record, "groups")?;
    if !groups.is_undefined() {
        for group in Array::from(&groups).iter() {
            let group: Array = group.unchecked_into();
            call(&geometry, "addGroup", &[&group.get(0), &group.get(1), &group.get(2)])?;
        }
    }
    Ok(geometry)
}

/// The materials of a Rust material table (`[{ role, class, options, name? }]`), in table order, as an object by
/// role: an option whose value is a key of `values` (a texture placeholder such as "peel") takes that value, in
/// its own place.
pub fn make_materials(three: &Three, table: &JsValue, values: &JsValue, into: &Object) -> R<()> {
    for row in Array::from(table).iter() {
        let options = read(&row, "options")?;
        for key in Object::keys(options.unchecked_ref::<Object>()).iter() {
            let value = Reflect::get(&options, &key)?;
            if value.is_string() && values.is_object() && Object::has_own(values.unchecked_ref(), &value) {
                Reflect::set(&options, &key, &Reflect::get(values, &value)?)?;
            }
        }
        let class = read(&row, "class")?.as_string().unwrap_or_default();
        let material = three.new(&class, &[&options])?;
        Reflect::set(into, &read(&row, "role")?, &material)?;
        let name = read(&row, "name")?;
        if !name.is_undefined() {
            set(&material, "name", &name)?;
        }
    }
    Ok(())
}

/// The scene graph of a prop packet (`shelf_models`): a Mesh per node with geometry (its material is
/// `materials[role]`), a Group per node without, each added to its parent (or `root`) in packet order with its
/// position and, where the packet has them, its rotation and scale. Returns the objects in packet order.
pub fn build_nodes(three: &Three, packet: &Packet, materials: &JsValue, root: &JsValue) -> R<Vec<JsValue>> {
    let transforms = packet.f64s(&read(&packet.header, "transforms")?)?;
    let nodes: Array = read(&packet.header, "nodes")?.unchecked_into();
    let mut objects: Vec<JsValue> = Vec::with_capacity(nodes.length() as usize);
    for (index, node) in nodes.iter().enumerate() {
        let object = if truthy(&read(&node, "attributes")?) {
            let geometry = geometry_of(three, packet, &node)?;
            three.new("Mesh", &[&geometry, &Reflect::get(materials, &read(&node, "material")?)?])?
        } else {
            three.new("Group", &[])?
        };
        let at = index * 9;
        let t = |k: usize| number(transforms.get(at + k).copied().unwrap_or(f64::NAN));
        set(&object, "name", &read(&node, "name")?)?;
        call(&read(&object, "position")?, "set", &[&t(0), &t(1), &t(2)])?;
        let rotation = read(&node, "rotation")?;
        if truthy(&rotation) {
            call(&read(&object, "rotation")?, "set", &[&t(3), &t(4), &t(5), &rotation])?;
        }
        if truthy(&read(&node, "scaled")?) {
            call(&read(&object, "scale")?, "set", &[&t(6), &t(7), &t(8)])?;
        }
        let parent = num(&read(&node, "parent")?);
        let owner = if parent < 0.0 { root.clone() } else { objects[parent as usize].clone() };
        call(&owner, "add", &[&object])?;
        objects.push(object);
    }
    Ok(objects)
}

/// `Number(value)` in a JS value, coercing like a wasm-bindgen `f64` argument.
pub fn coerced(value: &JsValue) -> f64 { num(value) }

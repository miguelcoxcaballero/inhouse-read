//! The catalogue's three studios (plant, cabinet, lamp): one stationary 3D preview each, drawn only on demand.
//! Every decision of their render loop lives here: when a frame is requested or cancelled (inactive panel,
//! hidden document, disposal), when a tapped selection is built (in a task after the frame that painted the
//! tap, never while hidden), when a built model is shown (after its programs are linked in parallel, the
//! previous picture staying meanwhile), when a recolouring needs no rebuild, the lamp's colour-temperature
//! easing, the studio's lights and the lamp's stand. The state is a plain JS object owned by the preview;
//! its callbacks are this module's exports bound to it, so nothing here holds a closure or a cycle. The host
//! adapter (`state.host`) only makes and draws three.js objects.
use wasm_bindgen::prelude::*;
use js_sys::{Array, Object, JSON};
use crate::host::{absent, cancel_frame, clear_timeout, clock, get, global, method, read, request_frame, set, set_timeout, text_value, truthy};

type R<T> = Result<T, JsValue>;

const PLANT: f64 = 0.0;
const SHELF: f64 = 1.0;
const LAMP: f64 = 2.0;

fn kind(state: &JsValue) -> f64 { get(state, "kind").as_f64().unwrap_or(-1.0) }
fn flag(state: &JsValue, key: &str) -> bool { crate::host::flag(state, key) }
fn put(state: &JsValue, key: &str, value: impl Into<JsValue>) -> R<()> { set(state, key, &value.into()) }
fn host(state: &JsValue) -> JsValue { get(state, "host") }
fn hidden() -> bool { get(&get(&global(), "document"), "visibilityState") == JsValue::from_str("hidden") }
fn bound(function: &JsValue, state: &JsValue) -> R<JsValue> { method(function, "bind", &[&JsValue::UNDEFINED, state]) }
fn dataset(state: &JsValue) -> JsValue { get(&get(state, "element"), "dataset") }
/// `value?.()`: nothing for an absent value, a TypeError for anything else that is not a function.
fn call_optional(value: &JsValue) -> R<()> { if !absent(value) { crate::host::call(value, "cancelLink", &[])?; } Ok(()) }

/// The state of one studio: `kind` 0 plant, 1 cabinet, 2 lamp; `host` the three.js adapter (`make(selection,
/// stage, previous model, invalidate)`, `link(model, done)`, `draw(model)`, `unframe()`, `finish(model)`, and for
/// the lamp `retint(now)`/`tintSet(kelvin, now, animate)`, for the plant `swap(previous, next, selection)`);
/// `element` the preview's node; `drawable` whether its renderer exists; `exports` this module's callbacks to bind.
#[wasm_bindgen]
pub fn studio_open(kind: f64, host: JsValue, element: JsValue, drawable: bool, exports: JsValue) -> R<JsValue> {
    let state: JsValue = Object::new().into();
    for (key, value) in [("kind", JsValue::from_f64(kind)), ("host", host), ("element", element), ("drawable", drawable.into()),
        ("frame", 0.0.into()), ("building", 0.0.into()), ("disposed", false.into()), ("active", true.into()), ("dirty", true.into()),
        ("pending", JsValue::NULL), ("shown", false.into()), ("incoming", JsValue::NULL), ("linking", JsValue::NULL),
        ("model", JsValue::NULL), ("cancelLink", JsValue::NULL), ("selected", JsValue::UNDEFINED),
        ("selectionKey", JsValue::UNDEFINED), ("shapeKey", JsValue::UNDEFINED)] { set(&state, key, &value)?; }
    for name in ["render", "build", "visibility", "invalidate", "reveal", "swap"] {
        let function = read(&exports, name)?;
        set(&state, name, &bound(&function, &state)?)?;
    }
    method(&get(&global(), "document"), "addEventListener", &[&"visibilitychange".into(), &get(&state, "visibility")])?;
    Ok(state)
}

/// A frame is asked for only while the studio can draw: not disposed, its panel active, the page visible.
#[wasm_bindgen]
pub fn studio_request(state: &JsValue) -> R<()> {
    if !flag(state, "disposed") && flag(state, "active") && !flag(state, "frame") && !hidden() {
        put(state, "frame", request_frame(&get(state, "render"))?)?;
    }
    Ok(())
}

#[wasm_bindgen]
pub fn studio_invalidate(state: &JsValue) -> R<()> { put(state, "dirty", true)?; studio_request(state) }

/// One frame: schedule a pending build (a task after this frame, so the pressed choice paints first), ease the
/// lamp's colour temperature, and draw only what changed.
#[wasm_bindgen]
pub fn studio_render(state: &JsValue) -> R<()> {
    put(state, "frame", 0.0)?;
    if flag(state, "disposed") || !flag(state, "active") || !flag(state, "drawable") || hidden() { return Ok(()); }
    let plant = kind(state) == PLANT;
    if flag(state, "pending") && !flag(state, "building") && !(plant && flag(state, "incoming")) {
        put(state, "building", set_timeout(&get(state, "build"), 0.0)?)?;
    }
    let showing = flag(state, "model") && (plant || flag(state, "shown"));
    let mut tinting = false;
    if kind(state) == LAMP && showing {
        // 1: the transition is still easing; 2: the shown tint changed and was applied.
        // The lamp studio's own transition says whether it has anything to do (rust-ui/src/catalog_lamp.rs);
        // another host is asked.
        let slot = crate::host::number(state, "tinting");
        let code = if slot.is_nan() { method(&host(state), "retint", &[&clock()?.into()])?.as_f64().unwrap_or(0.0) as u32 }
            else if slot > 0.0 { crate::catalog_lamp::retint(state, slot as usize - 1, clock()?)? } else { 0 };
        tinting = code & 1 != 0;
        if code & 2 != 0 { put(state, "dirty", true)?; }
    }
    if !showing || !flag(state, "dirty") { return Ok(()); }
    put(state, "dirty", false)?;
    method(&host(state), "draw", &[&get(state, "model")])?;
    if tinting { studio_request(state)?; }
    Ok(())
}

/// Build the pending selection (`prepare`: the plant studio links its first plant while the page is closed).
#[wasm_bindgen]
pub fn studio_build(state: &JsValue, prepare: JsValue) -> R<()> {
    put(state, "building", 0.0)?;
    let plant = kind(state) == PLANT;
    let prepare = plant && prepare.as_bool() == Some(true);
    if flag(state, "disposed") || hidden() || (!flag(state, "active") && !prepare) || !flag(state, "pending")
        || (plant && (flag(state, "incoming") || !flag(state, "drawable"))) { return Ok(()); }
    let selection = get(state, "pending");
    put(state, "pending", JsValue::NULL)?;
    if plant {
        // The new plant waits, hidden, for its programs; the shown one stays until then.
        // The plant studio hands over its builder and the plant is made here (`plant` is its record).
        let own = get(state, "plant");
        let next = if absent(&own) { method(&host(state), "make", &[&selection, &JsValue::UNDEFINED, &JsValue::NULL, &get(state, "invalidate")])? }
            else { plant_make(&own, &selection, &get(state, "invalidate"))? };
        put(state, "incoming", next.clone())?;
        put(state, "linking", selection)?;
        put(state, "cancelLink", method(&host(state), "link", &[&next, &get(state, "swap")])?)?;
        return Ok(());
    }
    call_optional(&get(state, "cancelLink"))?;
    put(state, "cancelLink", JsValue::NULL)?;
    put(state, "shown", false)?;
    let stage = if kind(state) == SHELF { cabinet_stage(&selection)? } else { JsValue::UNDEFINED };
    // The cabinet's studio hands over what its model is made of (`rig`) and the model is made here.
    let lamp = if kind(state) == LAMP { get(state, "lamp") } else { JsValue::UNDEFINED };
    let model = if kind(state) == SHELF && !absent(&get(&host(state), "rig")) {
        shelf_make(&host(state), &get(state, "element"), &selection, &stage, &get(state, "model"), &get(state, "invalidate"))?
    } else if !absent(&lamp) {
        crate::catalog_lamp::build(state, &lamp, &selection, &get(state, "model"), &get(state, "invalidate"))?
    } else {
        method(&host(state), "make", &[&selection, &stage, &get(state, "model"), &get(state, "invalidate")])?
    };
    put(state, "model", model.clone())?;
    put(state, "cancelLink", method(&host(state), "link", &[&model, &get(state, "reveal")])?)?;
    Ok(())
}

/// A cabinet or lamp whose programs are linked is shown.
#[wasm_bindgen]
pub fn studio_shown(state: &JsValue) -> R<()> {
    put(state, "cancelLink", JsValue::NULL)?; put(state, "shown", true)?; studio_invalidate(state)
}

/// A linked plant replaces the shown one.
#[wasm_bindgen]
pub fn studio_swap(state: &JsValue) -> R<()> {
    put(state, "cancelLink", JsValue::NULL)?;
    let next = get(state, "incoming");
    put(state, "incoming", JsValue::NULL)?;
    let own = get(state, "plant");
    if absent(&own) { method(&host(state), "swap", &[&get(state, "model"), &next, &get(state, "linking")])?; }
    else { plant_swap(&own, &get(state, "model"), &next, &get(state, "linking"))?; }
    put(state, "model", next)?;
    studio_invalidate(state)
}

/// Hidden: no frame and no build may wait for the page. Shown again: redraw the same model.
#[wasm_bindgen]
pub fn studio_visibility(state: &JsValue) -> R<()> {
    if hidden() {
        let frame = get(state, "frame");
        if truthy(&frame) { cancel_frame(&frame)?; }
        put(state, "frame", 0.0)?;
        let building = get(state, "building");
        if truthy(&building) { clear_timeout(&building)?; }
        put(state, "building", 0.0)?;
    } else if flag(state, "active") { studio_invalidate(state)?; }
    Ok(())
}

/// The catalogue page holding the studio opens or closes; reopening redraws at the current size.
#[wasm_bindgen]
pub fn studio_set_active(state: &JsValue, value: &JsValue) -> R<()> {
    if flag(state, "disposed") { return Ok(()); }
    let next = truthy(value);
    set(&dataset(state), "previewActive", &JsValue::from_str(if next { "true" } else { "false" }))?;
    if flag(state, "active") == next { return Ok(()); }
    put(state, "active", next)?;
    if !next {
        let frame = get(state, "frame");
        if truthy(&frame) { cancel_frame(&frame)?; }
        put(state, "frame", 0.0)?;
    } else { studio_invalidate(state)?; }
    Ok(())
}

/// A new plant selection: recolouring the shown plant needs no rebuild; anything else is built anew.
#[wasm_bindgen]
pub fn studio_update_plant(state: &JsValue, selection: &JsValue) -> R<()> {
    let key = JSON::stringify(selection)?;
    let data = dataset(state);
    for name in ["catalogId", "potId", "potColorId"] { set(&data, name, &read(selection, name)?)?; }
    if !flag(state, "drawable") || flag(state, "disposed") || JsValue::from(key.clone()) == get(state, "selectionKey") { return Ok(()); }
    let kept = Array::new();
    for entry in Object::entries(&Object::from(selection.clone())).iter() {
        if Array::from(&entry).get(0) != JsValue::from_str("potColorId") { kept.push(&entry); }
    }
    let shape = JSON::stringify(&Object::from_entries(&kept)?.into())?;
    if flag(state, "model") && !flag(state, "pending") && !flag(state, "incoming") && JsValue::from(shape.clone()) == get(state, "shapeKey") {
        let user = read(&get(state, "model"), "userData")?;
        let recolour = read(&user, "updatePotColor")?;
        let done = if absent(&recolour) { false } else {
            let recolour = recolour.dyn_into::<js_sys::Function>().map_err(|_| JsValue::from(js_sys::TypeError::new("updatePotColor is not a function")))?;
            truthy(&recolour.call1(&user, &read(selection, "potColorId")?)?)
        };
        if done { put(state, "selectionKey", key)?; return studio_invalidate(state); }
    }
    put(state, "selectionKey", key)?;
    put(state, "shapeKey", shape)?;
    put(state, "pending", selection.clone())?;
    studio_request(state)
}

/// A new cabinet type (already normalised).
#[wasm_bindgen]
pub fn studio_update_shelf(state: &JsValue, kind: &JsValue) -> R<()> {
    let data = dataset(state);
    set(&data, "shelfType", kind)?;
    if flag(state, "disposed") || !flag(state, "drawable") || get(state, "selected") == *kind { return Ok(()); }
    put(state, "selected", kind.clone())?;
    put(state, "pending", kind.clone())?;
    set(&data, "material", &JsValue::from_str(if *kind == JsValue::from_str("baggebo") { "white-powder-coated-steel" } else { "walnut" }))?;
    studio_request(state)
}

/// A new lamp or colour temperature: the temperature eases in about 300 ms (only colours change); a new
/// lamp is built anew. `lamp` is the catalogue entry, already found.
#[wasm_bindgen]
pub fn studio_update_lamp(state: &JsValue, lamp: &JsValue, kelvin: &JsValue) -> R<()> {
    let data = dataset(state);
    let id = read(lamp, "id")?;
    set(&data, "lampId", &id)?;
    set(&data, "mount", &read(lamp, "mount")?)?;
    set(&data, "warmKelvin", &text_value(kelvin))?;
    if !flag(state, "disposed") {
        let now = clock()?;
        let animate = flag(state, "shown") && !reduced_motion()?;
        let tinting = crate::host::number(state, "tinting");
        let changed = if tinting.is_nan() { truthy(&method(&host(state), "tintSet", &[kelvin, &now.into(), &animate.into()])?) }
            else { crate::catalog_lamp::tint_set(state, tinting, kelvin, now, animate)? };
        if changed { put(state, "dirty", true)?; studio_request(state)?; }
    }
    let material = if id == JsValue::from_str("tarnaby") { "glass-brass-black-steel" } else if id == JsValue::from_str("tripod") { "linen-oak" } else { "aluminium-opal" };
    set(&data, "material", &JsValue::from_str(material))?;
    if flag(state, "disposed") || !flag(state, "drawable") || get(state, "selected") == id { return Ok(()); }
    put(state, "selected", id)?;
    put(state, "pending", lamp.clone())?;
    studio_request(state)
}

fn reduced_motion() -> R<bool> {
    let query = get(&global(), "matchMedia");
    if !query.is_function() { return Ok(false); }
    Ok(truthy(&get(&method(&global(), "matchMedia", &[&"(prefers-reduced-motion: reduce)".into()])?, "matches")))
}

/// The plant studio links its queued plant now, even while hidden.
#[wasm_bindgen]
pub fn studio_prepare(state: &JsValue) -> R<()> {
    let building = get(state, "building");
    if truthy(&building) { clear_timeout(&building)?; }
    studio_build(state, JsValue::TRUE)
}

/// Stop listening, cancel any frame, build or link, and release the studio's GPU resources once.
#[wasm_bindgen]
pub fn studio_dispose(state: &JsValue) -> R<()> {
    method(&get(&global(), "document"), "removeEventListener", &[&"visibilitychange".into(), &get(state, "visibility")])?;
    if flag(state, "disposed") { return Ok(()); }
    put(state, "disposed", true)?;
    method(&host(state), "unframe", &[])?;
    let frame = get(state, "frame");
    if truthy(&frame) { cancel_frame(&frame)?; }
    let building = get(state, "building");
    if truthy(&building) { clear_timeout(&building)?; }
    call_optional(&get(state, "cancelLink"))?;
    let incoming = get(state, "incoming");
    if !absent(&incoming) { method(&get(&incoming, "userData"), "dispose", &[])?; }
    method(&host(state), "finish", &[&get(state, "model")])?;
    Ok(())
}

/// The cabinet studio's lighting for a type: white paint needs a gentler key and less ambient fill so the folded
/// lips and expanded-metal facets remain visible against the page. `[hemisphere, key, fill, environment, key
/// casts shadows]`.
fn cabinet_stage(kind: &JsValue) -> R<JsValue> {
    let white = *kind == JsValue::from_str("baggebo");
    let values: [f64; 5] = if white { [0.36, 1.2, 0.22, 0.38, 1.0] } else { [0.8, 2.4, 0.6, 0.55, 0.0] };
    Ok(numbers(&values))
}

fn field_object(fields: &[(&str, JsValue)]) -> R<JsValue> {
    let object: JsValue = Object::new().into();
    for (key, value) in fields { set(&object, key, value)?; }
    Ok(object)
}
fn numbers(values: &[f64]) -> JsValue { values.iter().map(|value| JsValue::from_f64(*value)).collect::<Array>().into() }
fn light(color: &str, intensity: f64, position: &[f64]) -> R<JsValue> {
    field_object(&[("color", color.into()), ("intensity", intensity.into()), ("position", numbers(position))])
}

/// Each studio's renderer, environment, camera and lights. `camera`: the orthographic frustum `[left, right,
/// top, bottom, near, far]`, then where it stands (it looks at the origin; the lamp's camera is placed per
/// mount). `cards`: dark panels beside the room's softboxes that only the reflected environment contains, so
/// clear glass photographs with an edge. `shadow`: the key light's map, frustum, biases and whether its
/// projection is updated at once.
#[wasm_bindgen]
pub fn studio_plan(kind: f64) -> R<JsValue> {
    let (exposure, shadows, sigma, environment) = if kind == PLANT { (1.15, false, 0.04, 0.65) } else if kind == SHELF { (0.95, true, 0.04, 0.55) } else { (1.05, true, 0.035, 0.55) };
    let camera = if kind == PLANT { numbers(&[-80.0, 80.0, 90.0, -90.0, 1.0, 1000.0, 0.0, 0.0, 400.0]) }
        else if kind == SHELF { numbers(&[-400.0, 400.0, 640.0, -640.0, 1.0, 5000.0, 0.0, 0.0, 2500.0]) }
        else { numbers(&[-160.0, 160.0, 180.0, -180.0, 1.0, 5000.0]) };
    let cards: JsValue = if kind == LAMP {
        [[-5.0, 2.0, 3.0, 1.8, 8.0], [5.0, 2.5, -2.0, 2.1, 9.0], [0.0, 2.0, -7.0, 3.0, 8.0]].iter().map(|card| numbers(card)).collect::<Array>().into()
    } else { Array::new().into() };
    let (hemisphere, key, fill) = if kind == PLANT {
        (1.8, light("#fff4e3", 3.0, &[-90.0, 140.0, 180.0])?, light("#e7efff", 1.2, &[100.0, 40.0, 140.0])?)
    } else if kind == SHELF {
        (0.8, light("#fffaf4", 2.4, &[-750.0, 1200.0, 1000.0])?, light("#e7efff", 0.6, &[700.0, 200.0, 800.0])?)
    } else {
        (0.72, light("#fff7ee", 1.65, &[-350.0, 600.0, 550.0])?, light("#e4ecff", 0.5, &[350.0, 180.0, 400.0])?)
    };
    let (sky, ground) = if kind == PLANT { ("#fff8ee", "#817c70") } else if kind == SHELF { ("#fffaf3", "#7b8190") } else { ("#fffaf4", "#767988") };
    let shadow = if kind == SHELF {
        field_object(&[("cast", false.into()), ("mapSize", 1024.0.into()), ("camera", numbers(&[-800.0, 800.0, 850.0, -850.0, 50.0, 4000.0])),
            ("project", true.into()), ("bias", (-0.00012).into()), ("normalBias", 0.35.into())])?
    } else if kind == LAMP {
        field_object(&[("cast", true.into()), ("mapSize", 1024.0.into()), ("camera", numbers(&[-500.0, 500.0, 500.0, -500.0, 1.0, 1700.0])),
            ("project", false.into()), ("bias", (-0.0003).into()), ("normalBias", 0.3.into())])?
    } else { JsValue::NULL };
    field_object(&[("exposure", exposure.into()), ("shadows", shadows.into()), ("sigma", sigma.into()), ("environment", environment.into()),
        ("cards", cards), ("camera", camera), ("sky", sky.into()), ("ground", ground.into()), ("hemisphere", hemisphere.into()),
        ("key", key), ("fill", fill), ("shadow", shadow)])
}

/// The lamp studio's stand: a short ceiling section and the floor of its downward warm pool for an under-shelf
/// fixture (the mounting stays legible; the fixture geometry itself is the bookshelf's), a round base for a
/// standing one, and where the camera stands; also how the fixture's own light is scaled to the studio's
/// exposure (the filament lamp's area strips, a cone, a bulb), the same as the former bulb light.
#[wasm_bindgen]
pub fn studio_lamp_stage(undershelf: bool, width: f64) -> R<JsValue> {
    let stage = lamp_stage(undershelf, width);
    let surfaces = stage.surfaces.iter().map(|surface| field_object(&[("kind", (if surface.round { "circle" } else { "box" }).into()),
        ("size", numbers(if surface.round { &surface.size[..2] } else { &surface.size[..] })), ("color", surface.color.into()), ("y", surface.y.into()),
        ("cast", surface.cast.into())])).collect::<R<Vec<JsValue>>>()?;
    field_object(&[("surfaces", surfaces.into_iter().collect::<Array>().into()), ("camera", numbers(&stage.camera)),
        ("filament", stage.filament.into()), ("cone", stage.cone.into()), ("bulb", stage.bulb.into())])
}
/// One surface of the lamp's stand: a disc (`size`: radius, segments) or a box (width, height, depth).
pub(crate) struct StandSurface { pub round: bool, pub size: [f64; 3], pub color: &'static str, pub y: f64, pub cast: bool }
pub(crate) struct LampStage { pub surfaces: Vec<StandSurface>, pub camera: [f64; 3], pub filament: f64, pub cone: f64, pub bulb: f64 }
/// The stage as numbers, for the set-up that builds it (catalog_lamp.rs).
pub(crate) fn lamp_stage(undershelf: bool, width: f64) -> LampStage {
    let (surfaces, camera) = if undershelf {
        (vec![StandSurface { round: false, size: [width * 2.1, 4.0, width * 1.65], color: "#dbd1bc", y: 2.0, cast: true },
              StandSurface { round: true, size: [width * 0.85, 64.0, 0.0], color: "#e6dfd0", y: -width * 1.35, cast: false }],
         [0.0, -230.0, 650.0])
    } else {
        (vec![StandSurface { round: true, size: [width * 0.82, 64.0, 0.0], color: "#e6dfd3", y: -0.2, cast: false }], [0.0, 75.0, 850.0])
    };
    LampStage { surfaces, camera, filament: 0.4, cone: 0.55, bulb: 0.4 }
}

// ---- The three.js side of one studio (formerly src/js/catalog-studio.js's openStudio) ----
// Every object is made, configured and added in the original's order, so three numbers them the same and
// the pictures are identical. The studio's link/draw/unframe/finish and its context-loss listener are this
// module's exports bound to one plain record (`{host, adapter, hooks, parts, scene, camera, renderer,
// state}`), so nothing here holds a Rust closure.

/// `new constructor(...args)`.
fn construct_with(constructor: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> {
    let constructor: js_sys::Function = constructor.clone().dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{name} is not a constructor"))))?;
    let list = Array::new();
    for argument in args { list.push(argument); }
    js_sys::Reflect::construct(&constructor, &list)
}
/// `new THREE[name](...args)`.
fn three_new(three: &JsValue, name: &str, args: &[&JsValue]) -> R<JsValue> { construct_with(&read(three, name)?, name, args) }
/// `target[name](...list)`: a spread call over an array of arguments.
fn spread(target: &JsValue, name: &str, list: &JsValue) -> R<JsValue> {
    let function: js_sys::Function = read(target, name)?.dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new(&format!("{name} is not a function"))))?;
    function.apply(target, &Array::from(list))
}
/// `target?.name()`: nothing for an absent target, a TypeError for a missing method.
fn present_call(target: &JsValue, name: &str) -> R<()> { if !absent(target) { method(target, name, &[])?; } Ok(()) }
fn at(list: &JsValue, index: u32) -> JsValue { crate::host::get_at(list, index) }
fn bind_export(exports: &JsValue, name: &str, record: &JsValue) -> R<JsValue> {
    method(&read(exports, name)?, "bind", &[&JsValue::UNDEFINED, record])
}

/// The preview's node says the 3D view cannot be shown.
fn unavailable(host: &JsValue) -> R<()> {
    set(&read(host, "dataset")?, "renderer", &"unavailable".into())?;
    set(host, "textContent", &"Vista 3D no disponible".into())
}

/// The renderer, its studio environment and its lights, in the original's order. Any failure is answered
/// by the caller, which releases what was made.
fn studio_build_renderer(three: &JsValue, room_environment: &JsValue, hooks: &JsValue, exports: &JsValue, plan: &JsValue,
    parts: &JsValue, scene: &JsValue, host: &JsValue, record: &JsValue) -> R<()> {
    if get(&global(), "WebGLRenderingContext").is_undefined() { return Err(js_sys::Error::new("WebGL unavailable").into()); }
    let renderer = three_new(three, "WebGLRenderer", &[&field_object(&[("antialias", true.into()), ("alpha", true.into())])?])?;
    set(parts, "renderer", &renderer)?;
    method(hooks, "configureShaderDiagnostics", &[&renderer])?;
    let ratio = get(&global(), "devicePixelRatio");
    let ratio = if truthy(&ratio) { crate::host::num(&ratio) } else { 1.0 };
    method(&renderer, "setPixelRatio", &[&js_sys::Math::min(ratio, 2.0).into()])?;
    set(&renderer, "toneMapping", &read(three, "ACESFilmicToneMapping")?)?;
    set(&renderer, "toneMappingExposure", &read(plan, "exposure")?)?;
    if truthy(&read(plan, "shadows")?) {
        set(&read(&renderer, "shadowMap")?, "enabled", &true.into())?;
        set(&read(&renderer, "shadowMap")?, "type", &read(three, "PCFSoftShadowMap")?)?;
        // Main-camera resize and reopening do not move these stationary casters.
        set(&read(&renderer, "shadowMap")?, "autoUpdate", &false.into())?;
    }
    method(&read(&renderer, "domElement")?, "setAttribute", &[&"aria-hidden".into(), &"true".into()])?;
    let lost = bind_export(exports, "studio_three_lost", record)?;
    method(&read(&renderer, "domElement")?, "addEventListener", &[&"webglcontextlost".into(), &lost])?;
    let pmrem = three_new(three, "PMREMGenerator", &[&renderer])?;
    let room = construct_with(room_environment, "RoomEnvironment", &[])?;
    let cards = read(plan, "cards")?;
    if truthy(&read(&cards, "length")?) {
        let material = three_new(three, "MeshBasicMaterial", &[&field_object(&[("color", "#252a30".into()), ("side", read(three, "DoubleSide")?)])?])?;
        for card in Array::from(&cards).iter() {
            let geometry = three_new(three, "PlaneGeometry", &[&at(&card, 3), &at(&card, 4)])?;
            let mesh = three_new(three, "Mesh", &[&geometry, &material])?;
            method(&read(&mesh, "position")?, "set", &[&at(&card, 0), &at(&card, 1), &at(&card, 2)])?;
            method(&mesh, "lookAt", &[&0.0.into(), &at(&card, 1), &0.0.into()])?;
            method(&room, "add", &[&mesh])?;
        }
    }
    set(parts, "environment", &method(&pmrem, "fromScene", &[&room, &read(plan, "sigma")?])?)?;
    method(&room, "dispose", &[])?;
    method(&pmrem, "dispose", &[])?;
    set(scene, "environment", &read(&read(parts, "environment")?, "texture")?)?;
    set(scene, "environmentIntensity", &read(plan, "environment")?)?;
    let hemisphere = three_new(three, "HemisphereLight", &[&read(plan, "sky")?, &read(plan, "ground")?, &read(plan, "hemisphere")?])?;
    set(&read(parts, "lights")?, "hemisphere", &hemisphere)?;
    method(scene, "add", &[&hemisphere])?;
    let key = three_new(three, "DirectionalLight", &[&read(&read(plan, "key")?, "color")?, &read(&read(plan, "key")?, "intensity")?])?;
    set(&read(parts, "lights")?, "key", &key)?;
    spread(&read(&key, "position")?, "set", &read(&read(plan, "key")?, "position")?)?;
    if truthy(&read(plan, "shadow")?) {
        let frustum = read(&read(plan, "shadow")?, "camera")?;
        let bounds: Vec<JsValue> = (0..6).map(|index| at(&frustum, index)).collect();
        if truthy(&read(&read(plan, "shadow")?, "cast")?) { set(&key, "castShadow", &true.into())?; }
        let size = read(&read(plan, "shadow")?, "mapSize")?;
        method(&read(&read(&key, "shadow")?, "mapSize")?, "set", &[&size, &size])?;
        let shadow_camera = read(&read(&key, "shadow")?, "camera")?;
        for (name, value) in ["left", "right", "top", "bottom", "near", "far"].iter().zip(bounds.iter()) { set(&shadow_camera, name, value)?; }
        if truthy(&read(&read(plan, "shadow")?, "project")?) { method(&read(&read(&key, "shadow")?, "camera")?, "updateProjectionMatrix", &[])?; }
        set(&read(&key, "shadow")?, "bias", &read(&read(plan, "shadow")?, "bias")?)?;
        set(&read(&key, "shadow")?, "normalBias", &read(&read(plan, "shadow")?, "normalBias")?)?;
    }
    method(scene, "add", &[&key])?;
    let fill = three_new(three, "DirectionalLight", &[&read(&read(plan, "fill")?, "color")?, &read(&read(plan, "fill")?, "intensity")?])?;
    set(&read(parts, "lights")?, "fill", &fill)?;
    spread(&read(&fill, "position")?, "set", &read(&read(plan, "fill")?, "position")?)?;
    method(scene, "add", &[&fill])?;
    method(host, "replaceChildren", &[&read(&renderer, "domElement")?])?;
    set(&read(host, "dataset")?, "renderer", &"three-mesh".into())
}

/// Open one catalogue studio: the scene and its orthographic camera from `studio_plan`, the renderer with its
/// studio environment and lights when the page has WebGL (otherwise, or when any of it fails, the node says
/// the view is unavailable), the native loop (`studio_open`) and, with a renderer, the resize observer.
/// `adapter` adds the studio's own `make`, `swap`, `retint`, `tintSet` and `release` (and optionally
/// `prepareScene`, `linkRoot`, `beforeDraw`), `size(model)` and `padding`; `hooks` holds the other modules'
/// functions (`createCatalogPreviewFrame`, `whenProgramsReady`, `retainPrograms`, `configureShaderDiagnostics`);
/// `exports` is this module, whose callbacks are bound. Answers `{state, parts, shelf:exports}`.
#[wasm_bindgen]
pub fn studio_open_three(kind: f64, host: JsValue, adapter: JsValue, three: JsValue, room_environment: JsValue, hooks: JsValue,
    exports: JsValue) -> R<JsValue> {
    let plan = studio_plan(kind)?;
    let scene = three_new(&three, "Scene", &[])?;
    let frustum = read(&plan, "camera")?;
    let bounds: Vec<JsValue> = (0..6).map(|index| at(&frustum, index)).collect();
    let camera = three_new(&three, "OrthographicCamera", &bounds.iter().collect::<Vec<_>>())?;
    let stand = method(&frustum, "slice", &[&6.0.into()])?;
    if truthy(&read(&stand, "length")?) {
        spread(&read(&camera, "position")?, "set", &stand)?;
        method(&camera, "lookAt", &[&0.0.into(), &0.0.into(), &0.0.into()])?;
    }
    let framing = method(&hooks, "createCatalogPreviewFrame", &[])?;
    let parts = field_object(&[("scene", scene.clone()), ("camera", camera.clone()), ("renderer", JsValue::NULL), ("environment", JsValue::NULL),
        ("lights", Object::new().into()), ("framing", framing), ("observer", JsValue::NULL)])?;
    // The lamp studio hands over what its model is made with (`lamp`) and is set up here.
    let lamp = read(&adapter, "lamp")?;
    if absent(&lamp) { crate::host::method_opt(&adapter, "prepareScene", &[&parts])?; } else { crate::catalog_lamp::scene(&lamp, &three, &scene)?; }
    let record = field_object(&[("host", host.clone()), ("adapter", adapter.clone()), ("hooks", hooks.clone()), ("parts", parts.clone()),
        ("scene", scene.clone()), ("camera", camera), ("renderer", JsValue::NULL), ("state", JsValue::UNDEFINED), ("three", three.clone())])?;
    if studio_build_renderer(&three, &room_environment, &hooks, &exports, &plan, &parts, &scene, &host, &record).is_err() {
        present_call(&read(&parts, "renderer")?, "dispose")?;
        set(&parts, "renderer", &JsValue::NULL)?;
        present_call(&read(&parts, "environment")?, "dispose")?;
        set(&parts, "environment", &JsValue::NULL)?;
        unavailable(&host)?;
    }
    let renderer = read(&parts, "renderer")?;
    set(&record, "renderer", &renderer)?;
    let studio: JsValue = Object::new().into();
    for name in ["make", "swap", "retint", "tintSet"] { set(&studio, name, &read(&adapter, name)?)?; }
    let rig = read(&adapter, "rig")?;
    if !absent(&rig) { set(&studio, "rig", &rig)?; set(&studio, "parts", &parts)?; set(&record, "rig", &rig)?; }
    // A studio that hands over what its model is made with has no functions of its own to ask: the lamp's
    // record (1), the plant's builder (2), the cabinet's rig (3).
    let plant = read(&adapter, "createShelfPlant")?;
    let own = if !absent(&lamp) { 1.0 } else if !absent(&plant) { 2.0 } else if !absent(&rig) { 3.0 } else { 0.0 };
    for (name, export) in [("link", "studio_three_link"), ("draw", "studio_three_draw"), ("unframe", "studio_three_unframe"), ("finish", "studio_three_finish")] {
        let bound = if name == "draw" { method(&read(&exports, export)?, "bind", &[&JsValue::UNDEFINED, &record, &own.into()])? }
            else { bind_export(&exports, export, &record)? };
        set(&studio, name, &bound)?;
    }
    let callbacks = field_object(&[("render", read(&exports, "studio_render")?), ("build", read(&exports, "studio_build")?),
        ("visibility", read(&exports, "studio_visibility")?), ("invalidate", read(&exports, "studio_invalidate")?),
        ("reveal", read(&exports, "studio_shown")?), ("swap", read(&exports, "studio_swap")?)])?;
    let state = studio_open(kind, studio, host.clone(), truthy(&renderer), callbacks)?;
    set(&record, "state", &state)?;
    if !absent(&lamp) { set(&record, "lamp", &lamp)?; crate::catalog_lamp::opened(&record, &lamp, &state)?; }
    if own == 2.0 { set(&record, "plant", &plant)?; set(&state, "plant", &record)?; }
    if truthy(&renderer) {
        set(&parts, "observer", &crate::host::construct("ResizeObserver", &[&read(&state, "invalidate")?])?)?;
        method(&read(&parts, "observer")?, "observe", &[&host])?;
    }
    field_object(&[("state", state), ("parts", parts), ("shelf", exports)])
}

/// The renderer's context was lost: a studio still open says its view is unavailable.
#[wasm_bindgen]
pub fn studio_three_lost(record: &JsValue, event: &JsValue) -> R<()> {
    method(event, "preventDefault", &[])?;
    if !truthy(&read(&get(record, "state"), "disposed")?) { unavailable(&get(record, "host"))?; }
    Ok(())
}

/// Link a model's programs (the adapter may name the root to link) and call `done` once they are ready;
/// answers the cancellation.
#[wasm_bindgen]
pub fn studio_three_link(record: &JsValue, model: JsValue, done: JsValue) -> R<JsValue> {
    let lamp = get(record, "lamp");
    let root = if absent(&lamp) { crate::host::method_opt(&get(record, "adapter"), "linkRoot", &[&model])? } else { Some(get(&lamp, "display")) }
        .filter(|root| !absent(root)).unwrap_or_else(|| model.clone());
    method(&get(record, "hooks"), "whenProgramsReady", &[&get(record, "renderer"), &get(record, "scene"), &get(record, "camera"), &root, &done])
}

/// Draw a model at the preview's layout size (the page may be scaled mid-flight, its drawing buffer not),
/// keep its linked programs for a return to an earlier selection, and count the frame on the node.
#[wasm_bindgen]
pub fn studio_three_draw(record: &JsValue, own: u32, model: JsValue) -> R<()> {
    let (host, adapter, renderer, camera) = (get(record, "host"), get(record, "adapter"), get(record, "renderer"), get(record, "camera"));
    let rect = if truthy(&read(&host, "clientWidth")?) {
        field_object(&[("width", read(&host, "clientWidth")?), ("height", read(&host, "clientHeight")?)])?
    } else { method(&host, "getBoundingClientRect", &[])? };
    let framing = read(&get(record, "parts"), "framing")?;
    let apply: js_sys::Function = read(&framing, "apply")?.dyn_into()
        .map_err(|_| JsValue::from(js_sys::TypeError::new("apply is not a function")))?;
    // The lamp studio's record holds its measure and its filament lights (null without them); a plant or a
    // cabinet is measured once, when it is first drawn (texture completion changes the surface, never this
    // stationary geometry).
    let size = match own {
        0 => method(&adapter, "size", &[&model])?,
        1 => get(record, "size"),
        _ => {
            let keeper = if own == 2 { record.clone() } else { get(record, "rig") };
            let known = get(&keeper, "size");
            if truthy(&known) { known } else {
                let three = get(record, "three");
                let bounds = method(&three_new(&three, "Box3", &[])?, "setFromObject", &[&model])?;
                let size = method(&bounds, "getSize", &[&three_new(&three, "Vector3", &[])?])?;
                set(&keeper, "size", &size)?;
                size
            }
        }
    };
    let padding = read(&adapter, "padding")?;
    apply.apply(&framing, &[camera.clone(), renderer.clone(), rect, size, padding].into_iter().collect::<Array>())?;
    if own == 1 { crate::catalog_lamp::light_filaments(&get(record, "lighting"), record)?; }
    else if own == 0 { crate::host::method_opt(&adapter, "beforeDraw", &[&model])?; }
    method(&renderer, "render", &[&get(record, "scene"), &camera])?;
    // Going back to an earlier selection reuses its linked shaders.
    if truthy(&read(&renderer, "info")?) { method(&get(record, "hooks"), "retainPrograms", &[&renderer])?; }
    let dataset = read(&host, "dataset")?;
    let count = read(&dataset, "renderCount")?;
    let count = if truthy(&count) { crate::host::num(&count) } else { 0.0 };
    set(&dataset, "renderCount", &crate::host::number_string(count + 1.0).into())
}

/// The preview's framing is released.
#[wasm_bindgen]
pub fn studio_three_unframe(record: &JsValue) -> R<JsValue> { method(&read(&get(record, "parts"), "framing")?, "dispose", &[]) }

/// Stop observing, let the adapter release its model, then the environment, the renderer and its context,
/// and empty the node.
#[wasm_bindgen]
pub fn studio_three_finish(record: &JsValue, model: JsValue) -> R<()> {
    let parts = get(record, "parts");
    present_call(&read(&parts, "observer")?, "disconnect")?;
    let rig = read(&get(record, "adapter"), "rig")?;
    if !absent(&rig) { shelf_release(&rig, &parts, &model)?; }
    else if !absent(&get(record, "lamp")) { crate::catalog_lamp::release(record, &model)?; }
    else if !absent(&get(record, "plant")) { if !absent(&model) { method(&read(&model, "userData")?, "dispose", &[])?; } }
    else { method(&get(record, "adapter"), "release", &[&model, &parts])?; }
    present_call(&read(&parts, "environment")?, "dispose")?;
    let renderer = get(record, "renderer");
    if !absent(&renderer) { method(&renderer, "dispose", &[])?; }
    if !absent(&renderer) { method(&renderer, "forceContextLoss", &[])?; }
    method(&get(record, "host"), "replaceChildren", &[])?;
    Ok(())
}

// ---- The plant studio's model (formerly `make`, `swap`, `size` and `release` of src/js/plant-catalog-preview.js).
// `record` is the studio's own; its `plant` is the builder (`createShelfPlant`), which stays JavaScript.

/// The chosen plant, hidden in the scene until its programs are linked.
fn plant_make(record: &JsValue, selection: &JsValue, invalidate: &JsValue) -> R<JsValue> {
    use wasm_bindgen::JsCast;
    let options: JsValue = Object::assign(&Object::new(), selection.unchecked_ref()).into();
    set(&options, "seed", &format!("catalog:{}", crate::host::text_of(&read(selection, "catalogId")?)).into())?;
    let next = crate::host::function_of(record, "plant", &[&options])?;
    set(&read(&next, "userData")?, "invalidate", invalidate)?;
    set(&next, "visible", &JsValue::FALSE)?;
    method(&get(record, "scene"), "add", &[&next])?;
    Ok(next)
}

/// The linked plant takes the place of the one shown, which goes; it is measured when it is first drawn.
fn plant_swap(record: &JsValue, previous: &JsValue, next: &JsValue, selection: &JsValue) -> R<()> {
    if truthy(previous) {
        method(&get(record, "scene"), "remove", &[previous])?;
        method(&read(previous, "userData")?, "dispose", &[])?;
    }
    set(next, "visible", &JsValue::TRUE)?;
    set(record, "size", &JsValue::NULL)?;
    set(&read(&get(record, "host"), "dataset")?, "modelCatalogId", &read(selection, "catalogId")?)
}

// ---- The cabinet studio's model (formerly `make`, `walnutMaterials`, `removeModel` and `release` of
// src/js/shelf-catalog-preview.js). `rig` is the preview's own record: `three`, the two walnut pictures
// (`maps`), the wooden cabinet's measures (`spec`), the two builders (`createBaggebo`, `createShelfFurniture`),
// the measured `size` of the model shown (the preview measures it when it is first asked) and what the walnut
// is made of once it has been needed (`walnut`, `textures`, `materials`). Every three.js object is made in the
// original's order, so three numbers them the same.
//
// The straight runs of this set-up are written as data, one host access a step, over numbered places: a
// cold path costs a few bytes a step this way, where a line of code costs about a hundred with its error
// path. Places: 0 three, 1 the rig, 2 the renderer, 3 invalidate, 4 the scene, 5 the lights, 6 the stage,
// 7-15 the walnut's work (9 colour, 10 surface, 12-14 the materials, 15 the three of them), 16 the studio's
// parts and then the wooden cabinet's measures, 17 a builder's options, 18 a hand, 19 the model, 20 the
// preview's node.
#[derive(Clone, Copy)]
enum Step {
    /// `a = b[name]`
    Get(u8, u8, &'static str),
    /// `a[name] = b`
    Put(u8, &'static str, u8),
    /// `a[name] = NUMBERS[n]`, a text, true or null
    Num(u8, &'static str, u8),
    Text(u8, &'static str, &'static str),
    Yes(u8, &'static str),
    Null(u8, &'static str),
    /// `a = NUMBERS[n]`
    Const(u8, u8),
    /// `a = b[index]`
    At(u8, u8, u8),
    /// `a = b.name(...places)`
    Call(u8, u8, &'static str, &'static [u8]),
    /// `a = b(...places)`, a plain call of the function in `b` (named for its error)
    Run(u8, u8, &'static str, &'static [u8]),
    /// `a = new b.name(...places)`, `b` being three
    New(u8, u8, &'static str, &'static [u8]),
    /// `a = {}`
    Fresh(u8),
    /// `a = Math.min(8, a)`
    Min8(u8),
    /// `a = a === 1`
    One(u8),
    /// `for (const item of a) item.name()`
    Each(u8, &'static str),
}
use Step::*;
const PLACES: usize = 21;
const THREE: u8 = 0;
const NUMBERS: [f64; 15] = [0.55, 0.9, 0.32, 0.36, 0.4, 1.0, 0.7, 0.5, 0.95, 0.26, 0.4, 0.075, -0.28, 0.0, 600.0];
type Places = [JsValue; PLACES];

#[inline(never)]
fn run(places: &mut Places, steps: &[Step]) -> R<()> {
    for step in steps {
        let (to, made): (u8, JsValue) = match *step {
            Get(a, b, name) => (a, read(&places[b as usize], name)?),
            Put(a, name, b) => { set(&places[a as usize], name, &places[b as usize])?; continue; }
            Num(a, name, n) => { set(&places[a as usize], name, &NUMBERS[n as usize].into())?; continue; }
            Text(a, name, text) => { set(&places[a as usize], name, &text.into())?; continue; }
            Yes(a, name) => { set(&places[a as usize], name, &JsValue::TRUE)?; continue; }
            Null(a, name) => { set(&places[a as usize], name, &JsValue::NULL)?; continue; }
            Const(a, n) => (a, NUMBERS[n as usize].into()),
            At(a, b, index) => (a, at(&places[b as usize], u32::from(index))),
            Call(a, b, name, list) | Run(a, b, name, list) | New(a, b, name, list) => {
                // Up to three arguments, by place.
                let hold: [&JsValue; 3] = std::array::from_fn(|index| &places[list.get(index).map_or(0, |place| *place as usize)]);
                let (target, args) = (&places[b as usize], &hold[..list.len()]);
                (a, match *step { Call(..) => method(target, name, args)?, Run(..) => crate::host::call(target, name, args)?, _ => three_new(target, name, args)? })
            }
            Fresh(a) => (a, Object::new().into()),
            Min8(a) => (a, crate::host::jmin(8.0, crate::host::num(&places[a as usize])).into()),
            One(a) => (a, (places[a as usize] == JsValue::from_f64(1.0)).into()),
            Each(a, name) => {
                let mut index = 0;
                while f64::from(index) < crate::host::num(&read(&places[a as usize], "length")?) { method(&at(&places[a as usize], index), name, &[])?; index += 1; }
                continue;
            }
        };
        places[to as usize] = made;
    }
    Ok(())
}

/// The studio's parts, then its lights for the cabinet's type (the stage: hemisphere, key, fill, environment,
/// key casts shadows).
const OPEN: [Step; 3] = [Get(4, 16, "scene"), Get(2, 16, "renderer"), Get(5, 16, "lights")];
const LIGHTS: [Step; 18] = [
    Get(18, 5, "hemisphere"), At(7, 6, 0), Put(18, "intensity", 7), Get(18, 5, "key"), At(7, 6, 1), Put(18, "intensity", 7),
    Get(18, 5, "fill"), At(7, 6, 2), Put(18, "intensity", 7), At(7, 6, 3), Put(4, "environmentIntensity", 7),
    Get(18, 5, "key"), At(7, 6, 4), One(7), Put(18, "castShadow", 7), Get(18, 2, "shadowMap"), Yes(18, "needsUpdate"),
    Get(THREE, 1, "three"),
];
/// The white steel cabinet.
const BAGGEBO: [Step; 4] = [Fresh(17), Num(17, "width", 14), Get(18, 1, "createBaggebo"), Run(19, 18, "createBaggebo", &[17])];
/// The wooden cabinet's measures; its rows follow, then the walnut.
const MEASURES: [Step; 9] = [
    Get(16, 1, "spec"), Fresh(17), Get(18, 16, "width"), Put(17, "width", 18), Get(18, 16, "height"), Put(17, "height", 18),
    Get(18, 16, "depth"), Put(17, "depth", 18), Num(17, "scale", 5),
];
/// The walnut's three materials over its two pictures, made the first time a wooden cabinet is shown: the
/// pictures repeat and take the renderer's anisotropy (8 at most), the colour one is sRGB. The last eight steps
/// hand the three to the cabinet's options and build it.
const WALNUT: [Step; 72] = [
    Get(6, 1, "maps"), New(7, THREE, "TextureLoader", &[]),
    At(8, 6, 0), Call(9, 7, "load", &[8, 3]), At(8, 6, 1), Call(10, 7, "load", &[8, 3]),
    Get(8, THREE, "SRGBColorSpace"), Put(9, "colorSpace", 8), Get(11, 1, "textures"),
    Get(8, THREE, "RepeatWrapping"), Put(9, "wrapT", 8), Put(9, "wrapS", 8),
    Get(8, 2, "capabilities"), Call(8, 8, "getMaxAnisotropy", &[]), Min8(8), Put(9, "anisotropy", 8), Call(8, 11, "push", &[9]),
    Get(8, THREE, "RepeatWrapping"), Put(10, "wrapT", 8), Put(10, "wrapS", 8),
    Get(8, 2, "capabilities"), Call(8, 8, "getMaxAnisotropy", &[]), Min8(8), Put(10, "anisotropy", 8), Call(8, 11, "push", &[10]),
    Fresh(8), Put(8, "map", 9), Put(8, "bumpMap", 10), Num(8, "bumpScale", 0), Put(8, "roughnessMap", 10), Yes(8, "vertexColors"),
    Text(8, "color", "#ffffff"), Num(8, "roughness", 1), Num(8, "clearcoat", 2), Num(8, "clearcoatRoughness", 3), New(12, THREE, "MeshPhysicalMaterial", &[8]),
    Fresh(8), Put(8, "map", 9), Put(8, "bumpMap", 10), Num(8, "bumpScale", 4), Put(8, "roughnessMap", 10), Yes(8, "vertexColors"),
    Text(8, "color", "#e6dccf"), Num(8, "roughness", 5), Num(8, "envMapIntensity", 6), New(13, THREE, "MeshStandardMaterial", &[8]),
    Fresh(8), Put(8, "map", 9), Put(8, "bumpMap", 10), Num(8, "bumpScale", 7), Put(8, "roughnessMap", 10), Yes(8, "vertexColors"),
    Text(8, "color", "#f2e6d6"), Num(8, "roughness", 8), Num(8, "clearcoat", 9), Num(8, "clearcoatRoughness", 10), New(14, THREE, "MeshPhysicalMaterial", &[8]),
    Get(8, 1, "materials"), Call(8, 8, "push", &[12, 13, 14]),
    Fresh(15), Put(15, "wood", 12), Put(15, "backWood", 13), Put(15, "darkWood", 14), Put(1, "walnut", 15),
    Get(18, 15, "wood"), Put(17, "wood", 18), Get(18, 15, "backWood"), Put(17, "backWood", 18), Get(18, 15, "darkWood"), Put(17, "darkWood", 18),
    Get(18, 1, "createShelfFurniture"), Run(19, 18, "createShelfFurniture", &[17]),
];
/// A near-front angle reveals the shallow depth and perforations while retaining an easy comparison of the two
/// furniture silhouettes; the model is centred, shown, and its measures (mm) written on the preview's node.
const PLACE: [Step; 16] = [
    Get(18, 19, "rotation"), Const(6, 11), Const(7, 12), Const(8, 13), Call(18, 18, "set", &[6, 7, 8]),
    New(6, THREE, "Box3", &[]), Call(6, 6, "setFromObject", &[19]), Get(8, 19, "position"), New(7, THREE, "Vector3", &[]), Call(7, 6, "getCenter", &[7]),
    Call(8, 8, "sub", &[7]), Call(8, 4, "add", &[19]),
    Get(18, 20, "dataset"), Text(18, "modelWidth", "600"), Text(18, "modelDepth", "250"), Text(18, "modelHeight", "1160"),
];

/// Takes the cabinet in place 19 out of the scene and disposes of it.
fn shelf_remove(places: &mut Places) -> R<()> {
    if !truthy(&places[19]) { return Ok(()); }
    run(places, &[Call(18, 4, "remove", &[19]), Get(18, 19, "userData"), Get(7, 18, "dispose")])?;
    if places[7].is_function() { run(places, &[Call(7, 18, "dispose", &[])])?; } else { crate::host::method_opt(&places[18], "disposeGeometry", &[])?; }
    run(places, &[Null(1, "size")])
}

/// Builds the chosen cabinet in place of `previous` under the studio's lights for its type, and returns it.
fn shelf_make(studio: &JsValue, element: &JsValue, kind: &JsValue, stage: &JsValue, previous: &JsValue, invalidate: &JsValue) -> R<JsValue> {
    let mut places: Places = std::array::from_fn(|_| JsValue::UNDEFINED);
    for (place, value) in [(1, get(studio, "rig")), (16, get(studio, "parts")), (3, invalidate.clone()), (6, stage.clone()), (19, previous.clone()), (20, element.clone())] { places[place] = value; }
    run(&mut places, &OPEN)?;
    shelf_remove(&mut places)?;
    run(&mut places, &LIGHTS)?;
    if *kind == JsValue::from_str("baggebo") { run(&mut places, &BAGGEBO)?; } else {
        run(&mut places, &MEASURES)?;
        let (bottoms, rows) = (read(&places[16], "shelfBottoms")?, Array::new());
        for index in 0..crate::host::num(&read(&bottoms, "length")?) as u32 { rows.push(&field_object(&[("bottom", at(&bottoms, index))])?); }
        set(&places[17], "rows", &rows)?;
        places[15] = read(&places[1], "walnut")?;
        // Made already: only the last eight steps.
        let steps: &[Step] = if truthy(&places[15]) { &WALNUT[WALNUT.len() - 8..] } else { &WALNUT };
        run(&mut places, steps)?;
    }
    run(&mut places, &PLACE)?;
    Ok(places[19].clone())
}

/// The studio is closed: the cabinet goes, then the walnut's materials and pictures and the key light's shadow.
fn shelf_release(rig: &JsValue, parts: &JsValue, model: &JsValue) -> R<()> {
    let mut places: Places = std::array::from_fn(|_| JsValue::UNDEFINED);
    for (place, value) in [(1, rig), (16, parts), (19, model)] { places[place] = value.clone(); }
    run(&mut places, &OPEN)?;
    shelf_remove(&mut places)?;
    run(&mut places, &[Get(8, 1, "materials"), Each(8, "dispose"), Get(8, 1, "textures"), Each(8, "dispose"), Get(18, 5, "key")])?;
    if !absent(&places[18]) { run(&mut places, &[Get(18, 18, "shadow"), Call(18, 18, "dispose", &[])])?; }
    Ok(())
}

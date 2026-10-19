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
fn flag(state: &JsValue, key: &str) -> bool { truthy(&get(state, key)) }
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
        let code = method(&host(state), "retint", &[&clock()?.into()])?.as_f64().unwrap_or(0.0) as u32;
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
        let next = method(&host(state), "make", &[&selection, &JsValue::UNDEFINED, &JsValue::NULL, &get(state, "invalidate")])?;
        put(state, "incoming", next.clone())?;
        put(state, "linking", selection)?;
        put(state, "cancelLink", method(&host(state), "link", &[&next, &get(state, "swap")])?)?;
        return Ok(());
    }
    call_optional(&get(state, "cancelLink"))?;
    put(state, "cancelLink", JsValue::NULL)?;
    put(state, "shown", false)?;
    let stage = if kind(state) == SHELF { cabinet_stage(&selection)? } else { JsValue::UNDEFINED };
    let model = method(&host(state), "make", &[&selection, &stage, &get(state, "model"), &get(state, "invalidate")])?;
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
    method(&host(state), "swap", &[&get(state, "model"), &next, &get(state, "linking")])?;
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
        if truthy(&method(&host(state), "tintSet", &[kelvin, &now.into(), &animate.into()])?) { put(state, "dirty", true)?; studio_request(state)?; }
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
    let surface = |kind: &str, size: &[f64], color: &str, y: f64, cast: bool| field_object(&[("kind", kind.into()), ("size", numbers(size)),
        ("color", color.into()), ("y", y.into()), ("cast", cast.into())]);
    let (surfaces, camera) = if undershelf {
        (vec![surface("box", &[width * 2.1, 4.0, width * 1.65], "#dbd1bc", 2.0, true)?, surface("circle", &[width * 0.85, 64.0], "#e6dfd0", -width * 1.35, false)?],
         [0.0, -230.0, 650.0])
    } else {
        (vec![surface("circle", &[width * 0.82, 64.0], "#e6dfd3", -0.2, false)?], [0.0, 75.0, 850.0])
    };
    field_object(&[("surfaces", surfaces.into_iter().collect::<Array>().into()), ("camera", numbers(&camera)),
        ("filament", 0.4.into()), ("cone", 0.55.into()), ("bulb", 0.4.into())])
}

//! One shelf plant's recipe in two calls (formerly about fourteen from `createShelfPlant` in
//! src/js/shelf-plants.js): what it looks like, its lifecycle record, the three shared surfaces (pot, leaf,
//! soil, requested in that order: the paint queue's order shows while the textures fill in), the options of the
//! three materials that carry them, and its bake, remembered or freshly drawn. The host still makes three's
//! materials and objects, in its own order.
//!
//! Properties are read and written through declared accessors: each is one direct call with no key string to
//! build, which is what made the separate calls slow (a plant is made per plant at start-up).
use wasm_bindgen::{intern, prelude::*, JsCast};
use js_sys::{Array, Float64Array, Object, Set};
use crate::host::{absent, num, truthy};
use crate::plant_surface_policy::{appearance, finish_plan, leaf_look, leaf_plan, pot_key_text, pot_plan, soil_plan, Surface};
use crate::plant_surface_queue::{plant_bake_get, plant_bake_remember, surface_maps};

type R<T> = Result<T, JsValue>;

#[wasm_bindgen]
extern "C" {
    /// Any object a plant is described with or made of: an entry, the geometry spec, a surface, a texture, a
    /// vector, the paint host, a record made here.
    pub type Thing;
    #[wasm_bindgen(method, getter = catalogPlant, catch)] pub fn catalog_plant(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = potId, catch)] pub fn pot_id(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = potModelId, catch)] pub fn pot_model_id(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn real(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn unit(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn height(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn variant(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn seed(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn key(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn node(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn dataset(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = objectId, catch)] pub fn object_id(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = inspectionResolution, catch)] pub fn inspection_resolution(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn canopy(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = potDiameter, catch)] pub fn pot_diameter(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = potHeight, catch)] pub fn pot_height(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = foliageHeight, catch)] pub fn foliage_height(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = referenceHeight, catch)] pub fn reference_height(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn hex(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn surfaces(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn queue(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn waiting(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn clones(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn map(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn data(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn source(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn version(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn pigment(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn repeat(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn offset(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn role(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn bake(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn objects(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = potColor, catch)] pub fn pot_color(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn materials(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn baked(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = bakeKey, catch)] pub fn bake_key(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = clayColor, catch)] pub fn clay_color(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter = soilKind, catch)] pub fn soil_kind(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, getter, catch)] pub fn detailed(this: &Thing) -> R<JsValue>;

    #[wasm_bindgen(method, setter = version, catch)] pub fn set_version(this: &Thing, value: &JsValue) -> R<()>;
    #[wasm_bindgen(method, setter = x, catch)] pub fn set_x(this: &Thing, value: f64) -> R<()>;
    #[wasm_bindgen(method, setter = surfaces, catch)] pub fn set_surfaces(this: &Thing, value: &JsValue) -> R<()>;

    // The paint host's own functions (shelf-plants.js) and what is called on three's objects.
    #[wasm_bindgen(method, catch, js_name = savedSurface)] pub fn saved_surface(this: &Thing, key: &JsValue, width: f64, height: f64) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] pub fn lattice(this: &Thing, spec: &JsValue, width: f64, height: f64, repeat: bool, pigment: &JsValue, data: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] pub fn texture(this: &Thing, bytes: &JsValue, width: f64, height: f64, color: bool, repeat: bool) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] pub fn schedule(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = watchDispose)] pub fn watch_dispose(this: &Thing, base: &JsValue, texture: &JsValue) -> R<JsValue>;
    #[wasm_bindgen(method, catch, js_name = clone)] pub fn clone_object(this: &Thing) -> R<JsValue>;
    #[wasm_bindgen(method, catch)] pub fn dispose(this: &Thing) -> R<JsValue>;

    /// A record made here, filled in a fixed order: plain data properties on a fresh object.
    pub type Fresh;
    #[wasm_bindgen(method, setter)] pub fn set_family(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] pub fn set_kind(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] pub fn set_config(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_base(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_key(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_width(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] pub fn set_height(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] pub fn set_row(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] pub fn set_spec(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_pigment(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_data(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_map(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_clones(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] pub fn set_waiting(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_disposed(this: &Fresh, value: bool);
    #[wasm_bindgen(method, setter = pendingQuality)] fn set_pending_quality(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter = potColor)] fn set_pot_color(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_textures(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_materials(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_geometries(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter = roughnessMap)] fn set_roughness_map(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter = bumpMap)] fn set_bump_map(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter = bumpScale)] fn set_bump_scale(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter = vertexColors)] fn set_vertex_colors(this: &Fresh, value: bool);
    #[wasm_bindgen(method, setter)] fn set_roughness(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_metalness(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_clearcoat(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter = clearcoatRoughness)] fn set_clearcoat_roughness(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_color(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_sheen(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter = sheenColor)] fn set_sheen_color(this: &Fresh, value: &str);
    #[wasm_bindgen(method, setter = sheenRoughness)] fn set_sheen_roughness(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter = alphaTest)] fn set_alpha_test(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter = alphaToCoverage)] fn set_alpha_to_coverage(this: &Fresh, value: bool);
    #[wasm_bindgen(method, setter = specularIntensity)] fn set_specular_intensity(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_side(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_lifecycle(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_variant(this: &Fresh, value: &str);
    #[wasm_bindgen(method, setter)] fn set_seed(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_quality(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_detailed(this: &Fresh, value: bool);
    #[wasm_bindgen(method, setter = clayColor)] fn set_clay_color(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter = soilKind)] fn set_soil_kind(this: &Fresh, value: &str);
    #[wasm_bindgen(method, setter = bakeKey)] fn set_bake_key(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_baked(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_extra(this: &Fresh, value: f64);
    #[wasm_bindgen(method, setter)] fn set_clay(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_leaf(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_soil(this: &Fresh, value: &JsValue);
    #[wasm_bindgen(method, setter)] fn set_bake(this: &Fresh, value: &JsValue);
}

/// `value.name` as `host::get` reads it: undefined for null/undefined and for a getter that throws.
pub fn g(value: &JsValue, read: impl Fn(&Thing) -> R<JsValue>) -> JsValue {
    if absent(value) { JsValue::UNDEFINED } else { read(value.unchecked_ref()).unwrap_or(JsValue::UNDEFINED) }
}
/// `value.name` as `host::read` reads it: throwing like the engine for null/undefined or a failing getter.
pub fn r(value: &JsValue, name: &str, read: impl Fn(&Thing) -> R<JsValue>) -> R<JsValue> {
    if absent(value) {
        return Err(js_sys::TypeError::new(&format!("Cannot read properties of {} (reading '{name}')", if value.is_null() { "null" } else { "undefined" })).into());
    }
    read(value.unchecked_ref())
}
pub fn thing(value: &JsValue) -> &Thing { value.unchecked_ref() }
pub fn fresh() -> Fresh { JsValue::from(Object::new()).unchecked_into() }

/// The `spec` of a surface: `{ family, kind[, config] }`.
pub fn surface_spec(plan: &Surface) -> JsValue {
    let spec = fresh();
    spec.set_family(plan.family);
    spec.set_kind(plan.kind);
    if let Some(config) = &plan.config { spec.set_config(&Float64Array::from(config.as_slice()).into()); }
    spec.into()
}

/// `own(plannedSurface(plan, refresh))`: the surface's two textures, kept in the plant's set (map, then data).
fn owned(state: &JsValue, host: &JsValue, plan: &Surface, refresh: &JsValue, textures: &Set) -> R<(JsValue, JsValue)> {
    let key = JsValue::from_str(&plan.key);
    let (map, data) = surface_maps(state, host, &key, plan.width as u32, plan.height as u32, plan.repeat, &|| surface_spec(plan), refresh)?;
    textures.add(&map);
    textures.add(&data);
    Ok((map, data))
}

fn string_or_empty(value: &JsValue) -> String { if absent(value) { String::new() } else { value.as_string().unwrap_or_default() } }

/// Everything `createShelfPlant` needs before it makes three's objects. `refresh` is the plant's redraw
/// request; it is only kept here (a surface still being painted calls it when done), never called.
#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn plant_recipe(state: &JsValue, host: &JsValue, entry: &JsValue, geometry: &JsValue, pot_color: &JsValue, persist: bool, soil_fraction: f64,
                    textures: &JsValue, materials: &JsValue, geometries: &JsValue, refresh: &JsValue) -> R<JsValue> {
    let look = appearance(entry, geometry, pot_color, persist)?;
    let lifecycle = fresh();
    lifecycle.set_disposed(false);
    lifecycle.set_pending_quality(&JsValue::NULL);
    lifecycle.set_pot_color(pot_color);
    lifecycle.set_textures(textures);
    lifecycle.set_materials(materials);
    lifecycle.set_geometries(geometries);
    let owned_textures: &Set = textures.unchecked_ref();
    let pot_id = g(geometry, Thing::pot_id);
    let model = string_or_empty(&g(geometry, Thing::pot_model_id));
    let finish = finish_plan(&model);
    let color = string_or_empty(&r(pot_color, "hex", Thing::hex)?);

    let (pot_map, pot_data) = owned(state, host, &pot_plan(&pot_id, &model, &color, &look.clay, look.quality), refresh, owned_textures)?;
    // Texels stay roughly square on the outer wall, whatever the pot proportions.
    let (map_repeat, data_repeat) = (r(&pot_map, "repeat", Thing::repeat)?, r(&pot_data, "repeat", Thing::repeat)?);
    thing(&data_repeat).set_x(look.repeat)?;
    thing(&map_repeat).set_x(look.repeat)?;
    let (map_offset, data_offset) = (r(&pot_map, "offset", Thing::offset)?, r(&pot_data, "offset", Thing::offset)?);
    thing(&data_offset).set_x(look.offset)?;
    thing(&map_offset).set_x(look.offset)?;
    let clay = fresh();
    clay.set_map(&pot_map);
    clay.set_roughness_map(&pot_data);
    clay.set_bump_map(&pot_data);
    clay.set_bump_scale(finish.bump_scale);
    clay.set_vertex_colors(true);
    clay.set_roughness(1.0);
    clay.set_metalness(finish.metalness.unwrap_or(0.0));
    clay.set_clearcoat(finish.clearcoat.unwrap_or(0.0));
    clay.set_clearcoat_roughness(finish.clearcoat_roughness.unwrap_or(0.3));

    // A shelf plant made earlier (this session or the last) is rebuilt from its bake: its meshes depend on
    // none of the colours or surface levels.
    let baked = if truthy(&look.bake_key) { plant_bake_get(state, host, &look.bake_key)? } else { JsValue::NULL };

    let leaf_maps = if look.detailed { Some(owned(state, host, &leaf_plan(&look.variant, look.quality), refresh, owned_textures)?) } else { None };
    let (leaf_map, leaf_data) = leaf_maps.unwrap_or((JsValue::NULL, JsValue::NULL));
    let shine = leaf_look(&look.variant, look.width);
    let leaf = fresh();
    leaf.set_map(&leaf_map);
    leaf.set_bump_map(&leaf_data);
    leaf.set_roughness_map(&leaf_data);
    leaf.set_color(16777215.0);
    leaf.set_vertex_colors(true);
    leaf.set_bump_scale(shine.bump_scale);
    leaf.set_sheen(shine.sheen);
    leaf.set_sheen_color(intern("#acc394"));
    leaf.set_sheen_roughness(0.85);
    leaf.set_alpha_test(0.0);
    leaf.set_alpha_to_coverage(false);
    leaf.set_specular_intensity(shine.specular);
    leaf.set_roughness(shine.roughness);
    leaf.set_metalness(0.0);
    leaf.set_clearcoat(shine.clearcoat);
    leaf.set_clearcoat_roughness(shine.clearcoat_roughness);
    // THREE.DoubleSide.
    leaf.set_side(2.0);

    let extra = extra_materials(&baked, &look.variant);

    let (soil_map, soil_data) = owned(state, host, &soil_plan(look.soil, look.quality), refresh, owned_textures)?;
    let soil = fresh();
    soil.set_map(&soil_map);
    soil.set_roughness_map(&soil_data);
    soil.set_bump_map(&soil_data);
    soil.set_bump_scale(if look.soil == "grit" { 1.4 } else { 1.1 });
    soil.set_roughness(1.0);
    soil.set_vertex_colors(true);

    let bake = if truthy(&baked) { r(&baked, "bake", Thing::bake)? } else {
        let real = g(geometry, Thing::real);
        let unit = g(geometry, Thing::unit);
        let foliage = num(&r(&real, "foliageHeight", Thing::foliage_height)?) * num(&unit);
        let reference = num(&r(&real, "referenceHeight", Thing::reference_height)?) * num(&unit);
        let dims = [look.width, look.radius, look.pot_height, soil_fraction, foliage, reference, num(&g(geometry, Thing::height))];
        crate::plant_build::bake_build(&look.units, look.skip, &look.variant, &string_or_empty(&pot_id), &model, truthy(&g(geometry, Thing::catalog_plant)), look.detailed, &dims)?
    };

    let recipe = fresh();
    recipe.set_lifecycle(lifecycle.as_ref());
    recipe.set_variant(intern(&look.variant));
    recipe.set_seed(&look.seed);
    recipe.set_quality(look.quality);
    recipe.set_detailed(look.detailed);
    recipe.set_clay_color(&look.clay_value);
    recipe.set_soil_kind(intern(look.soil));
    recipe.set_bake_key(&look.bake_key);
    recipe.set_baked(&baked);
    recipe.set_extra(extra as f64);
    recipe.set_clay(clay.as_ref());
    recipe.set_leaf(leaf.as_ref());
    recipe.set_soil(soil.as_ref());
    recipe.set_bake(&bake);
    Ok(recipe.into())
}

/// Which optional materials a plant needs: bit 0 the cactus body, bit 1 its needles. A remembered bake says so
/// by its objects' roles; a fresh cactus needs both.
pub fn extra_materials(baked: &JsValue, variant: &str) -> u32 {
    if !truthy(baked) { return if variant == "cactus" { 3 } else { 0 }; }
    let mut bits = 0;
    for object in Array::from(&g(&g(baked, Thing::bake), Thing::objects)).iter() {
        match g(&object, Thing::role).as_string().as_deref() { Some("green") => bits |= 1, Some("needles") => bits |= 2, _ => {} }
    }
    bits
}

/// After the host made the plant's objects: each shelf plant keeps its bake and its level-1 surfaces for the
/// next launch, and the materials no object uses are released. Returns the shelf's entry for the plant (null
/// for a plant that is not kept).
#[wasm_bindgen]
pub fn plant_recipe_keep(state: &JsValue, host: &JsValue, lifecycle: &JsValue, recipe: &JsValue, geometry: &JsValue, unused: &Array) -> R<JsValue> {
    let key = r(recipe, "bakeKey", Thing::bake_key)?;
    let mut entry = r(recipe, "baked", Thing::baked)?;
    if truthy(&key) && !truthy(&entry) {
        let made = fresh();
        made.set_bake(&r(recipe, "bake", Thing::bake)?);
        thing(made.as_ref()).set_surfaces(&JsValue::NULL)?;
        entry = made.into();
    }
    if truthy(&entry) {
        let color = string_or_empty(&r(&r(lifecycle, "potColor", Thing::pot_color)?, "hex", Thing::hex)?);
        let clay = string_or_empty(&r(recipe, "clayColor", Thing::clay_color)?);
        let pot = pot_key_text(&g(geometry, Thing::pot_id), &color, &clay, 1.0);
        let variant = string_or_empty(&r(recipe, "variant", Thing::variant)?);
        let soil = string_or_empty(&r(recipe, "soilKind", Thing::soil_kind)?);
        let keys = crate::plant_surface_policy::plant_surface_keys(&pot, truthy(&r(recipe, "detailed", Thing::detailed)?), &variant, &soil);
        thing(&entry).set_surfaces(keys.as_ref())?;
        plant_bake_remember(state, host, &key, &entry)?;
    }
    let used: Set = r(lifecycle, "materials", Thing::materials)?.unchecked_into();
    for material in unused.iter() {
        if !used.has(&material) { thing(&material).dispose()?; }
    }
    Ok(entry)
}

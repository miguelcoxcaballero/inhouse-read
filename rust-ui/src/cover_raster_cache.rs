//! Decoded cover ownership, exact budget accounting and LRU eviction. Texture
//! handles remain browser objects; no decoded pixels cross the WASM boundary.
use wasm_bindgen::prelude::*;
use std::cell::RefCell;
use js_sys::Object;
use crate::host::{call, method, read, set, truthy};

const MAX_PIXELS: f64 = 2.0 * 1024.0 * 1024.0;
struct Raster {
    owner: JsValue,
    key: JsValue,
    map: JsValue,
    bounds: JsValue,
    pixels: f64,
}
#[wasm_bindgen]
pub struct RustCoverRasterCache { state: RefCell<CacheState> }
struct CacheState { rasters: Vec<Raster>, pixels: f64 }

impl RustCoverRasterCache {
    fn remove(&self, index: usize) -> Result<(), JsValue> {
        let raster = {
            let mut state = self.state.borrow_mut();
            let raster = state.rasters.remove(index); state.pixels -= raster.pixels; raster
        };
        method(&raster.map, "dispose", &[])?;
        Ok(())
    }
}
#[wasm_bindgen]
impl RustCoverRasterCache {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self { state: RefCell::new(CacheState { rasters: Vec::new(), pixels: 0.0 }) } }

    pub fn release(&self, owner: &JsValue) -> Result<(), JsValue> {
        let index = self.state.borrow().rasters.iter().position(|raster| &raster.owner == owner);
        if let Some(index) = index { self.remove(index)?; }
        Ok(())
    }

    pub fn reuse(&self, owner: JsValue, key: JsValue, build: &JsValue) -> Result<JsValue, JsValue> {
        if !truthy(&owner) { return call(build, "build", &[]); }
        let existing = self.state.borrow().rasters.iter().position(|raster| raster.owner == owner && raster.key == key);
        if let Some(index) = existing {
            // Recency changes even when pixels and appearance are unchanged.
            let mut state = self.state.borrow_mut();
            let cached = state.rasters.remove(index); state.rasters.push(cached);
        } else {
            // Construct before removing a valid previous image: a decoding or
            // Canvas failure must leave it reusable at the original key.
            let result = call(build, "build", &[])?;
            let map = read(&result, "map")?; let image = read(&map, "image")?;
            let width = read(&image, "width")?.as_f64().unwrap_or(f64::NAN);
            let height = read(&image, "height")?.as_f64().unwrap_or(f64::NAN);
            let pixels = width * height;
            if !width.is_finite() || !height.is_finite() || width.fract() != 0.0 || height.fract() != 0.0
                || width <= 0.0 || height <= 0.0 || pixels > MAX_PIXELS {
                self.release(&owner)?; return Ok(result);
            }
            self.release(&owner)?;
            while self.state.borrow().pixels + pixels > MAX_PIXELS { self.remove(0)?; }
            let bounds = read(&result, "bounds")?;
            let mut state = self.state.borrow_mut();
            state.pixels += pixels;
            state.rasters.push(Raster { owner, key, map, bounds, pixels });
        }
        let (cached_map, cached_bounds) = {
            let state = self.state.borrow(); let cached = state.rasters.last().unwrap();
            (cached.map.clone(), cached.bounds.clone())
        };
        let source = read(&cached_map, "source")?;
        let version = read(&source, "version")?;
        let map = method(&cached_map, "clone", &[])?;
        // Texture.copy dirties the shared Source. Its exact original upload is
        // still valid; each displayed clone keeps its independent lifecycle.
        set(&read(&map, "source")?, "version", &version)?;
        let result: JsValue = Object::new().into();
        set(&result, "map", &map)?; set(&result, "bounds", &cached_bounds)?;
        Ok(result)
    }
}

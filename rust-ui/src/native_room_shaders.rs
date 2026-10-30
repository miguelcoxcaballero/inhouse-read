//! The raw replay program of the native room cache (native-room-cache.js): the vertex and fragment
//! sources of the full-screen copy that composes up to `layers` retained framebuffer textures. The
//! textures, uniforms and the draw stay with Three.js in JavaScript; the text is built here, byte for
//! byte as the template it replaces (three.js keys its program cache on the source).
use wasm_bindgen::prelude::*;

const VERTEX:&str="precision highp float;
      attribute vec3 position;
      uniform vec2 outputSize;
      varying vec2 point;
      void main() {
        point = (position.xy * vec2(.5,-.5) + .5) * outputSize;
        gl_Position = vec4(position.xy,0.,1.);
      }";

/// `[vertexShader, fragmentShader]` for `layers` layers.
fn sources(layers:u32)->[String;2]{
 let uniforms=(0..layers).map(|i|format!("uniform sampler2D layer{i}; uniform vec4 rect{i}; uniform vec4 clip{i}; uniform float enabled{i};")).collect::<Vec<_>>().join("\n");
 let blend=(0..layers).map(|i|format!("vec4 foreground{i} = sampleLayer(layer{i},rect{i},clip{i},enabled{i},p); color = foreground{i} + color * (1. - foreground{i}.a);")).collect::<Vec<_>>().join("\n");
 let fragment=format!("precision highp float;
      uniform vec2 outputOrigin;
      {uniforms}
      varying vec2 point;
      vec4 sampleLayer(sampler2D image, vec4 rect, vec4 clip, float enabled, vec2 p) {{
        if (enabled < .5 || p.x < clip.x || p.y < clip.y || p.x >= clip.z || p.y >= clip.w) return vec4(0.);
        vec2 uv = (p - rect.xy) / rect.zw;
        if (uv.x < 0. || uv.y < 0. || uv.x >= 1. || uv.y >= 1.) return vec4(0.);
        // Framebuffer textures keep GL's bottom-left origin. The geometry and
        // clipping above use the same top-left logical axes as the CSS cache.
        return texture2D(image,vec2(uv.x,1.-uv.y));
      }}
      void main() {{
        vec2 p = point + outputOrigin;
        vec4 color = vec4(0.);
        {blend}
        // Every input is already premultiplied and encoded. A single raw
        // output avoids shader color-space conversion or a second GL blend.
        gl_FragColor = color;
      }}");
 [VERTEX.to_owned(),fragment]
}

/// The two shader sources of the room replay material, as a `[vertex, fragment]` array.
#[wasm_bindgen]
pub fn native_room_shaders(layers:u32)->js_sys::Array{sources(layers).iter().map(|text|JsValue::from_str(text)).collect()}

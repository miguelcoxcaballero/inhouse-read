// Frozen from src/js/native-room-cache.js (1.7.325): the shader sources of the room replay material.
export const referenceRoomShaders = MAX_LAYERS => ({
    vertexShader:`precision highp float;
      attribute vec3 position;
      uniform vec2 outputSize;
      varying vec2 point;
      void main() {
        point = (position.xy * vec2(.5,-.5) + .5) * outputSize;
        gl_Position = vec4(position.xy,0.,1.);
      }`,
    fragmentShader:`precision highp float;
      uniform vec2 outputOrigin;
      ${Array.from({length:MAX_LAYERS},(_,i)=>`uniform sampler2D layer${i}; uniform vec4 rect${i}; uniform vec4 clip${i}; uniform float enabled${i};`).join('\n')}
      varying vec2 point;
      vec4 sampleLayer(sampler2D image, vec4 rect, vec4 clip, float enabled, vec2 p) {
        if (enabled < .5 || p.x < clip.x || p.y < clip.y || p.x >= clip.z || p.y >= clip.w) return vec4(0.);
        vec2 uv = (p - rect.xy) / rect.zw;
        if (uv.x < 0. || uv.y < 0. || uv.x >= 1. || uv.y >= 1.) return vec4(0.);
        // Framebuffer textures keep GL's bottom-left origin. The geometry and
        // clipping above use the same top-left logical axes as the CSS cache.
        return texture2D(image,vec2(uv.x,1.-uv.y));
      }
      void main() {
        vec2 p = point + outputOrigin;
        vec4 color = vec4(0.);
        ${Array.from({length:MAX_LAYERS},(_,i)=>`vec4 foreground${i} = sampleLayer(layer${i},rect${i},clip${i},enabled${i},p); color = foreground${i} + color * (1. - foreground${i}.a);`).join('\n')}
        // Every input is already premultiplied and encoded. A single raw
        // output avoids shader color-space conversion or a second GL blend.
        gl_FragColor = color;
      }`
})

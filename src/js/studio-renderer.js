import * as THREE from 'three';
import { cachedStudioEnvironment, prepareStudioEnvironmentCache } from './studio-environment-cache.js';
import { configureShaderDiagnostics } from './shader-diagnostics.js';
import { keepProgramsAlive } from './gpu-programs.js';

// Immutable room generation lives independently of book appearance and motion.
// Its build revision includes this module, its dependencies and the Three engine.
const rendererEnvironments = new WeakMap();
export function createStudioRenderer(preserveDrawingBuffer = false) {
  let renderer, studioEnvironment;
  if (!globalThis.WebGLRenderingContext && !globalThis.WebGL2RenderingContext) return null;
  try {
    // Snapshot consumers copy immediately after rendering. The presentation
    // canvas preserves its last displayed frame for a later snapshot request.
    // Every consumer (bookView, the shelf and its insertion overlay) sets its
    // own pixel ratio and size before drawing, so no oversized buffer is allocated up front.
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer });
    configureShaderDiagnostics(renderer);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Preserve print colours and gently compress real specular highlights.
    // Unmapped studio radiance used to clip RGB channels on bright jackets.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1;
    // Its toe pulls the weakest channel of every dark tone to zero, which
    // turns walnut and deep bookcloth orange and crushes navy. A smoothstep
    // toe keeps the black point, the join at 0.08 and the highlight curve.
    // Patched once before any program compiles; a later three skips it.
    const toe = 'float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;';
    const tonemap = THREE.ShaderChunk.tonemapping_pars_fragment;
    if (tonemap?.includes(toe)) THREE.ShaderChunk.tonemapping_pars_fragment = tonemap.replace(toe,
      'float toe = min( x / 0.08, 1.0 ); float offset = 0.04 * toe * toe * ( 3.0 - 2.0 * toe );');
    renderer.shadowMap.enabled = true;
    // Variance shadows: one 1024 map with a wide, smooth interior penumbra.
    // Its blur runs only when the scene requests a shadow refresh.
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // A quiet reading room instead of a grey photo studio: plaster walls, a
    // walnut floor, a tall window high on the left (the key's direction) and a
    // warm lamp on the right. Satin wood and laminates reflect real shapes.
    studioEnvironment = cachedStudioEnvironment();
    if (!studioEnvironment) {
      const room = new THREE.Scene(), shell = new THREE.SphereGeometry(10, 48, 24), tint = [];
      // Near-neutral surfaces: the warmth belongs to the key and the lamp, so
      // shadows stay natural instead of turning every material orange.
      const floor = new THREE.Color(.068, .05, .037), wall = new THREE.Color(.34, .315, .288), ceiling = new THREE.Color(.5, .485, .46);
      for (let i = 0, p = shell.attributes.position, c = new THREE.Color(); i < p.count; i++) {
        const y = p.getY(i) / 10;
        c.copy(floor).lerp(wall, THREE.MathUtils.smoothstep(y, -.32, -.02)).lerp(ceiling, THREE.MathUtils.smoothstep(y, .3, .85));
        tint.push(c.r, c.g, c.b);
      }
      shell.setAttribute('color', new THREE.Float32BufferAttribute(tint, 3));
      room.add(new THREE.Mesh(shell, new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.BackSide })));
      const glow = (geometry, rgb, strength, position) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color:new THREE.Color(...rgb).multiplyScalar(strength), side:THREE.DoubleSide }));
        mesh.position.set(...position); mesh.lookAt(0, 0, 0); room.add(mesh); return mesh;
      };
      const pane = glow(new THREE.PlaneGeometry(4.6, 5.8), [1, .98, .95], 6.5, [-3.6, 3.9, 7.8]);
      // Mullions break the reflection into panes, as a real window would.
      for (const [w, h, x, y] of [[.16, 5.8, 0, 0], [4.6, .14, 0, .5]]) {
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color:0x2a2119, side:THREE.DoubleSide }));
        bar.position.set(x, y, .02); pane.add(bar);
      }
      glow(new THREE.SphereGeometry(.55, 16, 8), [1, .7, .4], 16, [7.4, 1.2, 3.6]);
      // Shelf covers face the room's rear-right side after the isometric turn.
      // Give their laminate a broad secondary window to reflect; the existing
      // front-left key still lights the print. This is baked into the shared
      // environment once per context, adding no live reflection render pass.
      glow(new THREE.PlaneGeometry(4, 6), [1, .98, .95], 2.2, [7, -1, -6.4]);
      glow(new THREE.PlaneGeometry(7, 2.2), [1, .96, .92], .9, [0, 9.4, -1]);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const studioTarget = pmrem.fromScene(room, .035);
      studioEnvironment = studioTarget.texture;
      prepareStudioEnvironmentCache(renderer,studioTarget);
      room.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
      pmrem.dispose();
    }
    keepProgramsAlive(renderer);
  } catch { renderer?.dispose?.(); return null; }
  rendererEnvironments.set(renderer, studioEnvironment);
  return { renderer, environment:studioEnvironment };
}


export const studioEnvironmentFor = renderer => rendererEnvironments.get(renderer);

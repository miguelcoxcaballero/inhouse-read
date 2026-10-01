import * as THREE from 'three';

const SHADOW_SIZE = 1024;
// Soft edge of every shelf shadow, in shelf pixels, whatever window it covers.
const PENUMBRA = 9;
// The fitted window reaches this share of a screen beyond each edge, so a
// scroll of that much reuses the map instead of redrawing and blurring it.
const SLACK = .25;
// Nearly square texels keep the blur round on tall, narrow phone screens.
const MAX_ASPECT = 1.5;
const compactScreen = () => Math.min(globalThis.innerWidth || 1024, globalThis.innerHeight || 1024) < 600;
// three's variance shadows keep a 0.3 light-bleed floor. Books standing a
// finger's width from the back panel, under a shelf far above them, need a
// firmer one or a lit halo opens between the two shadows. Patched once,
// before any shelf program is compiled; a later three simply skips it.
const BLEED = '( softness_probability - 0.3 ) / ( 0.95 - 0.3 )';
function firmVarianceShadows() {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (chunk?.includes(BLEED)) THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(BLEED,
    '( softness_probability - 0.62 ) / ( 0.97 - 0.62 )');
}

// The back panel stands a whole shelf depth behind every board, where a
// window's shadow arrives with a wide penumbra: it averages the (already
// blurred) map over a Vogel disk this many blur radii across.
const PANEL_REACH = 3.6;
const PANEL_SHADOW = `
#ifdef USE_SHADOWMAP
float getPanelShadow( sampler2D map, vec2 size, float intensity, float bias, float radius, vec4 coord ) {
  // Taps slide along the panel itself (screen derivatives of the shadow
  // coordinate), so a wide disk never compares against the panel's own slope.
  float reach = radius * ${PANEL_REACH.toFixed(2)} / size.x;
  vec3 du = dFdx( coord.xyz ), dv = dFdy( coord.xyz );
  du *= reach / max( length( du.xy ), 1e-7 ); dv *= reach / max( length( dv.xy ), 1e-7 );
  float sum = 0.0;
  for ( int k = 0; k < PANEL_TAPS; k ++ ) {
    float r = sqrt( ( float( k ) + .5 ) / float( PANEL_TAPS ) ), a = float( k ) * 2.39996 + .4;
    sum += getShadow( map, size, intensity, bias, radius, coord + vec4( r * ( cos( a ) * du + sin( a ) * dv ), 0.0 ) );
  }
  return sum / float( PANEL_TAPS );
}
#endif`;

/** Soft, wide shelf shadows and dimmer room bounce for the cabinet's back
 * panel only, so each shelf's shadow fades out instead of ending in a hard
 * band; boards, books and plants keep their tighter contact shadows. Guarded
 * string patches: a later three without these lines compiles stock shaders. */
export function widePenumbra(material) {
  // Phones shade many more device pixels: fewer taps, fixed for the session.
  material.defines = { ...material.defines, PANEL_TAPS:compactScreen() ? 9 : 12 };
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${PANEL_SHADOW}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
        .replace('getShadow( directionalShadowMap[ i ]', 'getPanelShadow( directionalShadowMap[ i ]'))
      // Deep inside the carcass, sides and shelves hide much of the room:
      // its bounce and reflections reach the panel dimmed.
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= .8; reflectedLight.indirectSpecular *= .72;`);
  };
  material.customProgramCacheKey = () => 'walnut-panel-penumbra';
  return material;
}

/** A single soft key shadow, fitted in light space to the part of the cabinet
 * around the camera window rather than to its whole scroll height. The
 * variance map is only redrawn (and blurred) when something changed or the
 * view scrolled beyond the fitted window's slack. */
export function createShelfLighting(scene, renderer) {
  const key = scene.userData.readerLight;
  if (!key) return { update:() => false, settling:false, dispose() {} };
  firmVarianceShadows();
  // The rig's own direction; the light is only moved along it.
  const toLight = key.position.clone().sub(key.target.position).normalize();
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
  // Variance maps need only a small constant bias; a modest normal offset
  // keeps grazing boards free of acne without detaching books (peter-panning).
  key.shadow.bias = -.0004;
  key.shadow.normalBias = .45;
  // A window is an area light: wide, even penumbrae under every shelf. The
  // radius (in texels) follows the fit; fewer taps suffice on phone screens.
  // While anything moves the map is redrawn (and blurred) every frame: half
  // the taps then, and one full-quality redraw once the scene settles. Each
  // count compiles its two small blur programs once; three caches both.
  const restSamples = compactScreen() ? 8 : 12, movingSamples = restSamples / 2;
  let coarse = false;
  key.shadow.radius = 9;
  key.shadow.blurSamples = restSamples;
  // Room bounce never lets a shelf shadow go fully black.
  key.shadow.intensity = .84;
  key.shadow.autoUpdate = false;
  scene.add(key.target);
  const want = new THREE.Box3(), fitted = new THREE.Box3(), view = new THREE.Matrix4();
  const point = new THREE.Vector3(), centre = new THREE.Vector3();
  const previousTransform = new THREE.Matrix4(), inverseTransform = new THREE.Matrix4(), delta = new THREE.Matrix4();
  const previousBounds = new THREE.Box3(), transportedBounds = new THREE.Box3();
  let hasTransform = false;
  let frame = '';
  // The camera window (plus some slack), clipped to the cabinet's world bounds.
  const windowBox = (box, { width, viewportHeight, scroll, depth, bounds }, slack) => {
    box.min.set(0, -scroll - viewportHeight - slack, -depth - 24);
    box.max.set(width, -scroll + slack, 24);
    if (bounds && !bounds.isEmpty()) {
      box.min.set(Math.max(box.min.x, bounds.min.x), Math.max(box.min.y, bounds.min.y), bounds.min.z);
      box.max.set(Math.min(box.max.x, bounds.max.x), Math.min(box.max.y, bounds.max.y), bounds.max.z);
      if (box.isEmpty()) box.min.copy(box.max);
    }
    return box;
  };
  const fit = box => {
    // A new fit uses the original screen-space contact offset. During a
    // cached finger zoom it scales with the map, then returns to this value
    // when the visible window is rendered once at its settled resolution.
    key.shadow.normalBias = .45;
    box.getCenter(centre);
    const reach = box.getSize(point).length() / 2 + 400;
    key.target.position.copy(centre);
    key.position.copy(centre).addScaledVector(toLight, reach);
    key.updateMatrixWorld(); key.target.updateMatrixWorld();
    // Fit the frustum around the box's eight corners, seen from the light.
    // Anything between the light and the box (a shelf above the viewport)
    // still falls inside, because the near plane sits at the light itself.
    view.lookAt(key.position, centre, THREE.Object3D.DEFAULT_UP).setPosition(key.position).invert();
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, far = 0;
    for (let corner = 0; corner < 8; corner++) {
      point.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y, corner & 4 ? box.max.z : box.min.z)
        .applyMatrix4(view);
      left = Math.min(left, point.x); right = Math.max(right, point.x);
      bottom = Math.min(bottom, point.y); top = Math.max(top, point.y); far = Math.max(far, -point.z);
    }
    // Widen the narrow side, then leave room at every edge for the blur and
    // the back panel's wider disk, whose outer taps must stay in the map.
    const margin = PENUMBRA * (PANEL_REACH + 1) + 8;
    const width = right - left, height = top - bottom, span = Math.max(width, height) / MAX_ASPECT;
    const padX = Math.max(0, span - width) / 2 + margin, padY = Math.max(0, span - height) / 2 + margin;
    const camera = key.shadow.camera;
    Object.assign(camera, { left:left - padX, right:right + padX, top:top + padY, bottom:bottom - padY,
      near:1, far:far + 60 });
    camera.updateProjectionMatrix();
    // The blur is measured in texels: keep its width constant on the shelf.
    const texel = Math.max(camera.right - camera.left, camera.top - camera.bottom) / SHADOW_SIZE;
    key.shadow.radius = THREE.MathUtils.clamp(PENUMBRA / texel, 2, 16);
  };
  const update = options => {
    const { width, viewportHeight, depth, bounds = null, moving = false, transform = null, forceRefit = false } = options;
    let { dirty = true } = options;
    windowBox(want, options, 0);
    // Anything but a scroll (resize, depth, a turning or rebuilt cabinet)
    // refits at once; a scroll only once the view leaves the fitted slack.
    const layout = [width, viewportHeight, depth, ...(bounds ? [...bounds.min.toArray(), ...bounds.max.toArray()] : [])]
      .map(value => value.toFixed(2)).join(':');
    const transformChanged = transform && hasTransform && transform.elements.some((value, index) =>
      Math.abs(value - previousTransform.elements[index]) > 1e-7);
    let transported = false;
    if (transform && hasTransform && !dirty && !forceRefit && bounds && !previousBounds.isEmpty()) {
      delta.multiplyMatrices(transform, inverseTransform.copy(previousTransform).invert());
      const e = delta.elements, scale = e[0], tolerance = Math.max(1, Math.abs(scale)) * 1e-7;
      // A finger zoom/pan changes every caster, receiver and fixture together.
      // Moving the existing light camera by that same similarity leaves every
      // texel and its stored depth identical. A cabinet turn relative to the
      // daylight does change its shadows, and deliberately takes the fit path.
      const translationAndScale = Number.isFinite(scale) && scale > 0 &&
        [e[5] - scale, e[10] - scale, e[1], e[2], e[3], e[4], e[6], e[7], e[8], e[9], e[11], e[15] - 1]
          .every(value => Math.abs(value) <= tolerance);
      transportedBounds.copy(previousBounds).applyMatrix4(delta);
      const unchangedBounds = transportedBounds.min.distanceTo(bounds.min) < 1e-4 &&
        transportedBounds.max.distanceTo(bounds.max) < 1e-4;
      const dimensions = [width, viewportHeight, depth].map(value => value.toFixed(2)).join(':');
      if (translationAndScale && unchangedBounds && frame.startsWith(`${dimensions}:`)) {
        key.position.applyMatrix4(delta); key.target.position.applyMatrix4(delta);
        const camera = key.shadow.camera;
        for (const axis of ['left', 'right', 'top', 'bottom', 'near', 'far']) camera[axis] *= scale;
        camera.updateProjectionMatrix();
        key.shadow.normalBias *= scale;
        fitted.applyMatrix4(delta);
        key.updateMatrixWorld(); key.target.updateMatrixWorld();
        // three normally updates this while rendering the map. With a cached
        // map the new lookup matrix is sufficient; no depth or blur pass runs.
        key.shadow.updateMatrices(key);
        transported = true;
      }
    }
    // Transported boundaries accumulate harmless floating-point roundoff.
    // Treat a fraction of a physical millimetre as the same fitted edge.
    const covers = !fitted.isEmpty() && fitted.min.x <= want.min.x + 1e-4 && fitted.max.x >= want.max.x - 1e-4 &&
      fitted.min.y <= want.min.y + 1e-4 && fitted.max.y >= want.max.y - 1e-4 &&
      fitted.min.z <= want.min.z + 1e-4 && fitted.max.z >= want.max.z - 1e-4;
    if (forceRefit || (!transported && (layout !== frame || transformChanged)) || !covers) {
      fit(windowBox(fitted, options, viewportHeight * SLACK));
      dirty = true;
    }
    frame = layout;
    if (transform) {
      previousTransform.copy(transform); hasTransform = true;
      if (bounds) previousBounds.copy(bounds); else previousBounds.makeEmpty();
    } else hasTransform = false;
    if (coarse && !moving) dirty = true;
    if (dirty) {
      coarse = Boolean(moving) && !forceRefit; key.shadow.blurSamples = coarse ? movingSamples : restSamples;
      key.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true;
    }
    return dirty;
  };
  return { update,
    /** A map drawn in motion still awaits its full-quality redraw. */
    get settling() { return coarse; },
    dispose() { key.shadow.map?.dispose(); key.shadow.mapPass?.dispose(); } };
}

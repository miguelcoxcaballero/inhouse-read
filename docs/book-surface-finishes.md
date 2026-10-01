# Book surface finishes

Shelf, enlarged shelf and lifted book models share the same physical finish
profiles. Matte stock has a rough base without clearcoat; satin laminate has a
broader partial coat; glossy laminate has a full smooth coat with a 0.065
roughness floor. The floor keeps local point-light highlights large enough to
survive the shelf's pixel footprint instead of becoming isolated subpixel
flashes. Diffuse print colours are not tinted or baked with highlights. A
moderate rear-right window in the shared room environment provides a visible
reflection at the isometric cover angle; it is baked once into the PMREM,
without a live scene light or additional reflection passes. Local lamps still
produce their own warm highlights and respond to their switches.

Printed covers retain full dielectric specular response. On detailed or zoomed
copies, laminate reduces the existing paper/cloth normal strength while reusing
its texture source. Packed spine roughness remains encoded in the texture's
green channel with material roughness 1, so the finish is not multiplied twice.
Spine caps follow the selected surface finish; foil keeps its metal response.
Paper edges remain more fibrous and less coated than a jacket.

The shelf's material cache includes `spineSurfaceFinish`. Changing this setting
updates the existing binding immediately, including when it is the only changed
field. The same book model, cover artwork and shared grain textures remain
alive. No additional lights, meshes, shadow passes or animation loops are
introduced for a finish. The scene's `data-scene-draw-calls` records the completed
GPU render count for browser performance comparisons.

The browser regression compares pixels belonging to one book under the same
TÄRNABY fixture across all three finishes and measures the real lamp-on/off
highlight response. It also checks saved settings and a resting renderer.

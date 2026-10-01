# Shelf lamps

The three models follow the photos supplied for this feature: a round spotlight
under a shelf, a black vintage lantern with a glass chimney and amber LED candle,
and a light wood tripod with a cylindrical linen shade.

The circular spotlight is inspired by the IKEA MITTLED family. The lantern
follows the TÄRNABY form, including the stepped black metal base, brass dimmer,
open glass rim and four visible LED filaments. The tripod follows the supplied
photo and the wood/textile material language of IKEA LAUTERS; its compact
180 × 280 mm size is chosen for the bookshelf. It is not labelled LAUTERS in the
catalogue because the photo is not sufficient to identify an exact IKEA article.
The IKEA search links in `lamp-catalog-data.js` identify the reference families;
older direct article URLs now redirect to the general product catalogue.

## Coordinates and placement

Catalogue dimensions are millimetres, with centred x and z axes. A standing
lamp has its support plane at y=0 and extends upward. The spotlight's mounting
face is y=0 and the housing extends downward. It belongs at the underside of
the shelf above the selected row, not among objects standing on its lower shelf.
On the wooden cabinet it mounts just behind the front edge so its underside
diffuser is visible and touchable beneath the opaque board from the isometric
camera. The open BAGGEBO keeps its central mounting position.

`createShelfLamp({lampId, width, height, quality, isOn=true})` uniformly fits the requested
width and an optional maximum height. Geometry is scaled into root-local units,
so the returned group's scale stays 1 and `lightEmitter.position` can be passed
to `localToWorld` directly. The emitter carries colour, inverse-square decay,
range, intensity and optional spotlight direction/angle/penumbra. The model has
no actual Three.js light: the scene owns its bounded lighting budget.

## Switching and filament emission

Each placed lamp stores `isOn`; older records default to on. A tap or native
keyboard activation toggles that one fixture, while a hold, drag, cancelled
touch or pinch keeps its power unchanged. The projected lamp body is also a
native hit surface, with raycasting to reject empty or occluded pixels.

`userData.setPower(value)` scales the original emissive intensities and the
emitter's `power` together, without rebuilding any GPU resource. The scene
eases between 0 and 1 over 220 ms, or changes immediately with reduced motion.
The four retro LED strands use a narrow bright warm core and amber round edge
inside their existing material shader; zero power leaves non-emitting phosphor
and real glass. No bloom or additional material batch is introduced.

The lighting manager multiplies nominal irradiance by `power`, removes sources
at zero, and excludes them from its light budget. Colour and power changes
reuse existing caster depth maps; actual geometry and cone projection changes
still refresh them. Ambient compensation follows the selected sources' maximum
power continuously. Rendering stops after the transition settles.

## Materials and resources

The lantern uses physical transmission and refraction for the clear chimney.
The thin amber bulb coating is composited transparently afterward, keeping its
colour and the four visible filaments: Three.js samples only opaque objects in
its transmission buffer, so a second refractive volume would erase that coating.
Neither glass surface casts an opaque shadow over the LED filaments. The
wood and linen have deterministic pigment, relief and roughness textures,
512-pixel linen and 1024-pixel vertical wood detail, mipmaps and anisotropic
filtering. Warm emissive surfaces are restrained to the bulb, diffuser and lit
cloth. Surrounding books and plants receive light from scene-owned fixtures.

The high quality geometry uses respectively 3, 8 and 6 draws, and fewer than
12,500 triangles per fixture. There is no animation timer or asynchronous GPU
work. `.dispose()` and `userData.dispose()` are the same idempotent function;
every fixture releases its own geometries, materials and textures exactly once.
Only immutable CPU texture bytes remain cached between identical fixtures.

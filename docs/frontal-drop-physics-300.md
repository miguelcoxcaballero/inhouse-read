# Front-view drop stability — 1.7.300

Picking up, moving or releasing an object used to wake every rigid body on its shelf. This also invalidated the saved resting poses of disconnected books. A real contact with a restored book could repeat the same broad wake-up.

The Rust solver now wakes the affected objects and their touching supports. Before removing, lifting or replacing a support, it finds contacts against the actual collider shapes, including restored scenes whose contact cache is still cold. Real collision impulses continue propagating through supported stacks; distant objects keep their position, orientation and sleeping state. Cabinet geometry changes still invalidate the affected boards.

A second regression reproduces a frontal drop onto a flat book. Sleeping only the lower book can briefly lose its warm contacts and make the upper book settle again, repeatedly waking both. The solver now lets a quiet flat book and its already quiet contact stack sleep together. Held objects, active release torques, movement and unsettled supports block that operation. The existing 0.25 mm / 0.11 degree quiet limits and model/render quality remain unchanged.

Validation:

- Regression for disconnected objects on the same board during pickup/release.
- Restored-room regression: removing a support releases its books while an unrelated book on the same board stays exact.
- Captured synthetic front-view drag/drop replay checks that the book stack settles and remains asleep.
- Existing physical pushes, domino chains, thin-book cabinet bounds, plant/lamp contacts, sounds and portable room checkpoints.
- Browser gestures on walnut and BAGGEBO, touch lamp placement, desktop drag/open and input recovery in a synced room.

No APK or updater channel publication is included.

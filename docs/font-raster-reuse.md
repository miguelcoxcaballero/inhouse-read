# Reuse of title-font raster surfaces

Each title-font family search now owns one private CPU-backed canvas instead of
allocating a new canvas for every size/alignment/uppercase plan. Every draw
clears its pixels and reapplies font, alignment, baseline and fill style. Resize
still resets the context when needed. Masks are copied before the generator
yields; its finalizer releases the scratch bitmap on completion or cancellation.
Different jobs/families never share a mutable surface.

Vite production compilation and 47 cover/font-score unit tests pass. Tests keep
the search order, native scores, worker fallback and CPU-backed reads while
bounding raster contexts to six family surfaces plus the cover sample.

The Chromium real-font parity test also passes. Both Oswald's “A Visual Match”
and Playfair Display's “The Quiet Garden” produce the exact same saved appearance
as the frozen analyzer. Each current analysis allocates eight canvases, versus
146 for the reference. This measures allocation count and final-style equality;
it does not establish a whole-app load-time or device battery improvement.

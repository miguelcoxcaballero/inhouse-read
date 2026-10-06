# Reducción del framebuffer nativo —1.7.90 en comprobación

El diagnóstico real de1.7.89 conserva un cierre fallido8018,7ms. Su reset
intermedio a altura0 durante la reducción final consume1105,4ms en esa
tanda. El candidato conserva los dos resets normales de Three al reducir
ambos ejes; omite sólo el tercer reset intermedio0, que no evita crecimiento
porque el tamaño intermedio ya cabe en la asignación previa. Crecimiento y
cambios cruzados mantienen el staging existente; no cambia DPR, píxeles,
shader, tamaño final, viewport, reloj ni plazos. No afirma FPS móvil ni
una mejora causal de velocidad con una sola medición.

Seis casos nuevos y53 relacionados PASS. Evidencia de diagnóstico original:
.animation.local/performance-1789/return-frame-observer-attempt1/.
Batería final, comparación RGBA, recorridos y publicación pendientes.

Batería final:3468 unitarias/279 archivos, build y75 Python PASS.
Censo524 sólo listado, cero E2E ejecutadas en ese censo; la CI completa
se realiza por separado. Fuente659 estable. Dieciocho comparaciones con
la implementación anterior conservan todos los bytes RGBA en WebGL2,
acabados mate/oro/plata, seis poses y framebuffer final589×1174.

Siete recorridos gráficos originales PASS, primer intento,0 retries:
continuidad/cancelación/editor/fallback/ambos nativos/gesto isométrico.
Cierres4848,4/4845,4ms; plazos30/8s intactos. No son una comparación causal
ni FPS en un teléfono. La publicación y las comprobaciones adicionales
de software, catálogo, luz, web pública y APK siguen pendientes.
Evidencia: .animation.local/performance-1790/full-local-resource2-attempt1/,
shrink-pixels-attempt1/ ylocal-browser-attempt1/.

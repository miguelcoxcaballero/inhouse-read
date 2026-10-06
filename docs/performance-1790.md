# Reducción del framebuffer nativo —1.7.90 publicada

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

## Publicación real y límites

Fuente ef2f37fa4941144932d810cca363e6c15d462d96, deploy37439363384 PASS;
gh-pages f5fc91b128f464d95213a28cec07d0481db195d7. Descarga real32 assets y96
recursos offline PASS; main-BNSAZNVx.js593807 bytes SHA256
 ead17ab7affdb81c857731c2587d335daaf5db9dc98f3499facafef538c2bab3.
APK público1.1.4/code17 descargado de nuevo,78515243 bytes y SHA256
feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191;
loader2089 bytes exacto, sin app antigua empaquetada. No cambio nativo.

Once recorridos locales originales PASS: siete generales, dos software
explícito y dos regreso/luces. Cero retries y plazos originales. Catálogo
y luz pública5/5 PASS. Web pública original: principales2/3 yPDF15/18
PASS; cuatro auditorías conservan cuerpos de textura observados como0,
sin requestfailed registrado. Los cuerpos funcionales pasan, pero eso no
convierte las auditorías fallidas en aprobadas. Total22/26 estrictos.

Una observación aparte de seis arranques recibe y decodifica ambas texturas
con bytes/SHA exactos, sin reproducir cuerpos observados como0. Devuelve
los mismos promises originales y no sustituye respuestas. No prueba la
causa de los cuatro fallos anteriores ni los reemplaza.

PDF físico y snapshot estabilizado en cinco temas, y portada offline,
PASS con worker/SW reales. La app importa y conserva3143 bytes exactos,
las imágenes RGB originales y locator textOffset115 al cerrar, recargar
y reabrir offline; driveFileId null. Sin sustituir motores/respuestas.

CI37439363327 todavía en marcha: snapshot-001 conserva182 casos de siete
artefactos y el shardUI3 FAILED. Dos nativos superan30s mientras el cuerpo
continúa is-closing-reader y la espera original8s sigue pendiente, también
en retries. Cuatro intentos fallidos, conservados. Las tandas Piper reales
completadas pasan; Supertonic y varios shards siguen pendientes. No se da
por resuelta la lentitud ni por completada la verificación global.
Evidencia: swiftshader-original-attempt1/,return-regressions-attempt1/,
public-ef2f37f-attempt1/,veneer-body-observation-attempt1/ y
ci-original-37439363327-attempt1/snapshot-001/. El catálogo es una tanda
pública, no se cuenta como cinco ejecuciones locales adicionales.

## CI original completa

37439363327 termina FAILED. Snapshot-002 conserva11 ZIP y12 trabajos:
524 casos unicos/527 intentos,3 retries y5 intentos fallidos, UI3 yUI6.
Dos cierres nativos superan30s tambien al repetirlos. El caso isometrico
recibe0 lomos en vez de6 al arrancar8s, luego pasa el retry; se conserva
como flaky rechazado. Cuatro tandas de voces reales y las otras cuatro
UI PASS. No se considera resuelto el rendimiento global.

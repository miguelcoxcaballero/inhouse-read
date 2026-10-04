# Rendimiento de web 1.7.48

## Cambios

La preparación de la página guardada deja de esperar a la regeneración de la
portada PDF en alta resolución. La actualización de la portada conserva su
resolución y se inicia después de terminar la apertura del lector. Los guards
de sesión siguen impidiendo guardar el resultado de otro libro o lector.

En la estantería de respaldo, un refresco pendiente conserva el botón pulsado
hasta que el navegador entrega el click de ratón. La cancelación sigue aplicando
los cambios inmediatamente. Esto evita perder una selección al sustituir el
nodo durante `pointerup`.

Se mantienen las mejoras de 1.7.47: reutilización del modelo al guardar una
edición, agrupación de avisos de biblioteca, poda de texturas sin consumidores
y entrega directa del framebuffer entre libro y estantería. Se conservan
geometría, materiales, iluminación, resolución y relojes de animación.

## Regresiones y controles

La propuesta aislada de la portada pasa 20 casos de CPU. El caso existente del
control de sesión conserva sus assertions y plazo; su preparación se mueve al
nuevo momento de inicio de la tarea de fondo. Al eliminar deliberadamente el
guard de epoch en el control aislado, falla la assertion original de solicitud
de portada. El primer control ineficaz permanece preservado por separado.

Los dos casos nuevos de click ejecutan la misma prueba en el candidato y la
fuente 1.7.47. El candidato pasa ambos; la fuente original falla cuando el
refresco desconecta el botón antes de entregar el click. La cancelación pasa
en ambas fuentes. Son controles de CPU, sin una medición de FPS.

## Verificación de la fuente final

La primera batería local completa pasa 2.802/2.802 unitarias en 202 archivos,
sin fallos, pendientes ni todo, build y las 51 + 24 verificaciones Python
originales. El censo enumera 524 casos E2E únicos, sin omisiones; `--list` no
ejecuta esos casos. Los 478 archivos de runtime, pruebas y configuración
conservan sus hashes antes y después; la documentación se excluye del guard.

El build local produce `main-Cvva8aqt.js`, 1.444.445 bytes, SHA-256
`ac225f9cfacc30e559c967a4d5edb07860e0741bf125155d3dad34320dfd58a8`.
El resumen original está en
`.animation.local/performance-1748/full-local-attempt1/summary.json`.

## CI original y publicación

Fuente `1f8f00e635cff22e721182e3f53adaf126e9f2a2`, Pages
`5e96fa325d91d84cb002630479b6b0fad322bdfb`. La
[CI original 37221277939](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37221277939)
conserva **FAILED**: pasan 2.802 unitarias en 202 archivos. Sus diez manifiestos
E2E subidos contienen 524 casos únicos: 522 expected y dos unexpected, sin
flaky ni omitidos. Se conservan 526 intentos, cuatro fallidos y dos reintentos.
Los dos contratos nativos de devolución fallan el plazo original de ocho
segundos en ambos intentos; la apertura sin WebGL pasa al primer intento.
El instante exacto de fin del cierre no se conserva, porque la assertion
fallida impide ejecutar la lectura posterior del observer. No se reinterpreta
el fallo a partir de las capturas posteriores. Los otros nueve grupos E2E
pasan sus guards estrictos.

Se guardan los doce logs y once ZIP originales autenticados, con tamaño,
SHA-256, CRC, miembros y censos contrastados. El resumen está en
`.animation.local/performance-1748/ci-1f8f00e-failed-original-collector-attempt2/snapshot-001/final-summary.json`;
certificado `e44ae9e5c6fa608a6ad2d2566b9d66fe9dcd0d2f14a433a8bbac4aa65d2b0a46`.
El watcher fallido y la recogida temprana de UI3 permanecen intactos.

La web pública pasa **21 casos sin reintentos**: los 18 PDF originales y tres
de edición/devolución nativa. Sus cuerpos HTTP corresponden al artefacto Pages
fijado, sin sustituir respuestas de la aplicación. Pasan también el grafo HTTP,
el inventario público, la descarga exacta de la APK firmada 1.1.4 y la igualdad
de su loader con los bytes Git. Esto no ejecuta ni acredita un teléfono físico.
Los certificados están en
`.animation.local/performance-1748/public-1f8f00e-attempt2/`: `browser-attempt1/certification.json`,
`performance-browser-attempt1/performance-qualification.json`,
`http-attempt1/artifact-1748-1f8f00e-provenance.json`, `apk-attempt1/public-apk.json`
y `apk-attempt1/apk-loader.json`. El primer pin que recibió el CDN anterior
permanece preservado por separado.

No se ha medido fluidez, temperatura ni batería en un teléfono físico.

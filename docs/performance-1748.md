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

El navegador, la CI original y los archivos públicos de esta fuente se
incorporarán después de ejecutarse. Ningún resultado previo se considera
prueba de 1.7.48. La APK 1.1.4 carga la web con su loader; la descarga y el
inventario del APK se comprobarán de nuevo.

No se ha medido fluidez, temperatura ni batería en un teléfono físico.

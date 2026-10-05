# Rendimiento de Inhouse Read 1.7.58

## Cambios

La estantería pausa los repintados mientras el libro seleccionado la tapa,
después de completar realmente la pintura de su hueco vacío. Conserva los
registros y cambios pendientes. Al cancelar, volver o preparar la devolución,
reanuda la escena antes de mover el libro. Los movimientos visibles, cambios
de cámara, dimensiones, luces y sombras pendientes mantienen sus pinturas.

Los textos de canvas sólo esperan otra pintura por fuentes cuando, después
de dibujarlos, todavía están cargándose. Se conserva la actualización cuando
el primer dibujo inicia una descarga de fuentes.

La pulsación conserva su objetivo hasta la activación. Si la biblioteca ha
cambiado, la apertura usa el registro, contenido y pose actuales. Se mantienen
los gestos de desplazamiento, pulsación larga, cancelación y reorganización.

No cambia la calidad de los modelos, texturas, iluminación, sombras, densidad
ni los plazos originales de las pruebas. No hay medición de FPS ni temperatura
en un teléfono.

## Verificación

CPU combinado final PASS: 246 casos (191 originales y 55 nuevos), sin
errores uncaught, pending, skipped ni todo. El control Git57 conserva los
191 originales PASS, 17 nuevos PASS y 32 nuevos FAIL; sus 49 identidades
de integración son las mismas. Los seis tests del nuevo helper sólo se
ejecutan en el candidato.

Fuente final PASS al primer intento: 3.059 unitarias en 230 archivos, build,
75 comprobaciones Python y 509 hechos de fuente estables. Se conservan
las 524 identidades E2E originales en el censo; el listado no ejecuta
navegadores. Los siete recorridos locales originales pasan al primer
intento, sin retries, flaky ni omisiones. Cierres alineado y legado:
5.371,7 y 5.917,5 ms, con ocho segundos y global de treinta intactos.
Veinte composiciones isométricas no generan renders nuevos de sala;
dos escrituras de buffer y seis lomos de 1.024 px. Publicación y CI
completa todavía pendientes.

El primer CPU combinado conserva FAILED: los 191 casos originales pasan;
53 de 55 nuevos pasan. Los dos fallos pertenecen a la expectativa nueva de
que el botón antiguo siga conectado después de una pulsación táctil, aunque
la apertura síncrona ya ha actualizado la biblioteca. Su reparación comprueba
ese reemplazo y mantiene las comprobaciones del registro y progreso actuales.
El control conserva sus 32 fallos nuevos y los 191 originales PASS; ambos
terminan sin errores uncaught. No se relabelan ni sobrescriben esos resultados.

## Evidencia

- Primer CPU combinado: `combined-cpu-method-attempt1/cpu-attempt1/summary.json`,
  SHA256 `df0e4ba0dd96a26c517386cd26e91ccb9d901307bd03e1688aa39469e5683be6`.
- CPU combinado final: `combined-cpu-method-attempt2/cpu-attempt1/summary.json`,
  SHA256 `fc7a42b873028fdec6649c4acd669b96c22e47b801bdaefd41a96ad145c5fc96`.
- Fuente final: `full-local-attempt1/summary.json`.
- Navegador local: `local-browser-attempt1/summary.json`.
- La comparación aislada selecciona 55 casos nuevos en el candidato y 49
  en el control Git57. Los seis casos del nuevo helper de fuentes sólo existen
  en el candidato; no se presentan como ejecutados en el control.
- Antecedente publicado: [Rendimiento de 1.7.57](performance-1757.md).

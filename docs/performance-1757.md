# Rendimiento de Inhouse Read 1.7.57

## Cambio

Las confirmaciones de progreso, historial, marcadores y citas actualizan los
registros existentes sin reconstruir la estantería cuando todos los datos
visibles siguen idénticos. Los Blob reconstruidos por IndexedDB requieren una
revisión de contenido o fecha de portada ya confirmada; su tamaño no basta.

Se conservan los nodos, modelos, materiales y texturas. Los eventos reciben los
registros actuales y el componente mantiene su propia copia de la lista. Las
selecciones, movimientos, devoluciones, cambios visibles, nuevas dimensiones
y campos desconocidos conservan su actualización original.

## Comprobaciones locales

- CPU aislada: 75 casos PASS, incluidos 60 originales y 15 nuevos. El control
  Git56 pasa los 60 originales y conserva cuatro fallos de los casos nuevos.
- Gráficos: 32 pares PNG nativos y 100 pares RGBA/exportPNG exactos, cero
  componentes distintos; 64 invariancias de exportación. Cuatro perfiles:
  390/393 px, DPR 2/1,5, rutas nativa y legada decididas por producción.
- En las cuatro colas reales, sala/base/snapshot pasan de 1/1/1 a 0/0/0;
  referencias, modelos, mapas y foco siguen vigentes.
- Fuente final: 3.004 unitarias en 223 archivos, build, 75 comprobaciones
  Python, 501 hechos de fuente y 524 identidades E2E originales. El listado
  no es una ejecución de navegador.
- Siete recorridos locales originales PASS al primer intento, sin retries,
  flaky ni omisiones. Cierres alineado y legado: 7.034,4 y 6.140,6 ms,
  dentro de sus ocho segundos originales y global de treinta segundos.
- Gesto isométrico: veinte composiciones, cero nuevos renders de sala,
  dos escrituras de buffer y seis lomos de 1.024 px.

La publicación, la comprobación HTTP/APK y los recorridos públicos de esta
versión están pendientes. También está pendiente su CI original completa;
los pases anteriores no sustituyen las 524 ejecuciones originales.

## Fallos conservados y alcance

El primer método CPU aislado falló por un mock incompleto. Los métodos
gráficos 3, 4 y 5 conservaron sus primeros fallos de preparación/observación;
el método final usa el renderer real de la presentación y espera su relieve
real antes de comparar. Los cuatro perfiles finales pasan sin reintentos.

El primer full root se detuvo antes de ejecutar comandos por una comilla
ausente en los JSON de versión que generó el auxiliar de adopción. Se
conserva íntegro; la reparación sólo restaura esa comilla desde los backups.
La batería completa posterior corresponde a `full-local-attempt2`.

No se acredita corregir el timeout de apertura ni el clic perdido de CI56.
Los contadores y píxeles exactos no miden FPS ni temperatura de un teléfono.
Los modelos, iluminación, sombras, texturas, densidad y plazos no se reducen.

## Evidencia

- Propuesta: `.animation.local/performance-1757/metadata-reference-proposal-attempt4/`.
- Gráficos finales: `metadata-reference-quality-attempt6-final/summary.json`,
  SHA256 `db89ff05b0f81d62b1b5415a7a20f32fe724174ccc7a193e6ea2f34773b1bd45`.
- Fuente final: `full-local-attempt2/summary.json`.
- Navegador local: `local-browser-attempt1/summary.json`.
- Fallos originales previos: [Rendimiento 1.7.56](performance-1756.md).

# Rendimiento de Inhouse Read 1.7.59

## Cambio

Al cambiar el tamaño del canvas del libro, Three asignaba sus dos dimensiones
aunque sólo cambiase una. Cada asignación reinicia el framebuffer nativo.
La presentación del libro evita la segunda asignación cuando esa dimensión
ya coincide y la otra realmente ha cambiado. Three conserva la actualización
original del tamaño lógico, densidad y viewport.

El camino optimizado sólo se aplica al canvas HTML nativo del renderer conocido,
con limpieza automática completa, scissor desactivado, destino principal y XR
inactivo. Los demás casos mantienen la operación original. Los descriptores
temporales se retiran también si la operación falla. No se cambian modelos,
texturas, materiales, antialiasing, densidad ni relojes de animación.

## Verificación local

- Comparación CPU final: 82 PASS, incluidos los 59 originales y 23 nuevos,
  sin fallos ni omisiones.
- Batería completa: 3.082 unitarias en 231 archivos, compilación y 75
  comprobaciones Python PASS. Conserva 511 hechos de fuente estables.
- El censo conserva las 524 identidades E2E originales; ese listado no cuenta
  como ejecución.
- Los siete recorridos originales de navegador pasan al primer intento,
  sin retries, flaky ni omisiones. Los cierres alineado y legado tardan
  5.176,8 y 5.639,3 ms, manteniendo sus plazos originales de ocho y treinta
  segundos.
- Veinte composiciones de cámara no repintan la sala; la restauración conserva
  dos escrituras de buffer y seis lomos de 1.024 px.

La primera comparación CPU aislada conserva su resultado FAILED: los 59
originales pasan y falla una expectativa nueva que pedía cambiar las dos
dimensiones cuando el redondeo dejaba una idéntica. Se corrigieron los datos
de ese caso nuevo; no se modificó la implementación para satisfacerlo.

La comparación gráfica nativa pasa al primer intento: 64 pares exactos de
RGBA y PNG nativo/exportado, con 128 capturas. En 32 cambios de una sola
dimensión, las dos asignaciones originales pasan a una. Cubre DPR2, anchos
390/393 y 16 poses de dos portadas; utiliza una página pintada controlada,
no acredita por sí sola todos los temas del lector. Conserva contexto real,
antialiasing y dimensiones; el navegador y servidor terminan cerrados.
Certificado `report.json`, SHA256
`a0a06577bc1e320b7c2841a644043e79a0f0eb79280cb4809b1f8d680d399df9`.

Publicación desde `ebffb33`, Pages `68f8edf`: HTTP comprueba los 23 módulos
y 44 archivos offline reales. Los 21 recorridos públicos originales pasan
al primer intento: tres de editor/regreso y 18 de PDF, sin retries, flaky
ni omisiones. La APK recién descargada coincide con la firmada 1.1.4/code17;
su loader de 2.089 bytes coincide con la fuente y no contiene una web antigua.
El primer pin HTTP conserva FAILED porque la CDN todavía servía 1.7.58;
la comprobación posterior tiene sus propios cuerpos y certificado.

Su CI original `37249480029` termina FAILED. Los doce trabajos terminaron;
UI3 conserva dos casos de apertura fallidos, con sus reintentos. La colección
completa de logs y ZIPs tiene un recibo independiente todavía pendiente.
Los pases locales y públicos no sustituyen ese resultado. No hay medición
de FPS ni temperatura de un teléfono físico.

## Diagnóstico anterior

El perfil de la fuente 1.7.58 conserva sus relojes originales. Sus dos
recorridos instrumentados pasan, pero la instrumentación no sustituye a la
QA original ni demuestra la causa de sus timeouts de CI. Durante la apertura
se registran siete cambios de tamaño por recorrido, seis de una sola
dimensión. La optimización de esta versión elimina la asignación redundante;
no se presenta ese dato como una mejora medida de FPS.

La CI original de 1.7.58 permanece FAILED: dos casos de apertura PDF en UI3,
incluidos sus reintentos, esperan ocho segundos antes de pulsar Back. Sus
522 pases y archivos originales completos se conservan. Véase
[Rendimiento de 1.7.58](performance-1758.md).

## Evidencia

En `.animation.local/performance-1759/`:

- `native-axis-proposal-attempt4/cpu-attempt1/`: CPU final de 82 casos.
- `native-axis-proposal-attempt2/cpu-attempt1/`: primer fallo conservado.
- `full-local-attempt1/summary.json`: batería completa de la fuente final.
- `local-browser-attempt1/summary.json`: siete recorridos originales.
- `opening-profile-attempt2/`: diagnóstico aislado de la fuente 1.7.58.
- `native-axis-quality-attempt1/`: comparación gráfica independiente.
- `public-ebffb33-attempt1/`: primer pin HTTP antiguo conservado.
- `public-ebffb33-attempt2/`: HTTP, APK, loader y 21 recorridos públicos.

Los recibos y resultados anteriores no se sobrescriben ni se cuentan como
ejecuciones de esta versión.

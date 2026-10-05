# Rendimiento de Inhouse Read 1.7.60

## Cambio

Cada entrada ordinaria del editor aplicaba la portada y el canto por separado,
presentando el mismo modelo dos veces seguidas. Ahora se aplican ambos cambios
al registro completo y se presenta una vez. Las terminaciones posteriores de
carga y relieve conservan su callback y siguen actualizando la imagen.

Se conserva el camino anterior para vistas sin la operación agrupada. No se
cambian geometrías, materiales, mapas, densidad, antialiasing ni los plazos de
90, 180 y 220 ms del editor. Los cambios exclusivos de relieve conservan su
operación original.

## Comprobaciones

La comparación CPU final pasa 194 casos: 176 originales y 18 nuevos, sin
errores no capturados ni omisiones. El primer intento conserva tres fallos
de datos de fixtures nuevos: el ayudante esperaba un material único donde
el bloque de páginas usa un array. Los 176 originales pasaban también allí;
la corrección sólo lee el material real en los tres fixtures nuevos.

La comparación gráfica pasa al primer intento: 64 pares y 128 capturas
con RGBA completo y PNG nativo/exportado exactamente iguales. En las
64 operaciones, las presentaciones síncronas reales pasan de dos a una.
Cubre cuatro combinaciones de acabados, cuatro poses, dos portadas y
anchos 390/393 con DPR2. Conserva contexto WebGL2 real, antialiasing,
modelo, página, marcapáginas y dimensiones. Navegador y servidor cerrados.
Utiliza una página pintada controlada; no acredita todos los temas del
lector ni FPS de un teléfono físico.

CPU: `feca480e69b6d8fc4c109d42aaa594dfc0cabb249c267d8b16b898629b3a24a9`.
GPU: `84d0593cc3a619866d1ca138149fa23c33959f09f8c30a85b6bc2e7dd8c5caac`.

La batería completa pasa 3.100 unitarias en 233 archivos, compilación y 75
comprobaciones Python. Conserva 513 hechos de fuente estables. El censo de
524 identidades E2E sigue intacto; un listado no cuenta como ejecución.
Los recorridos originales y la publicación tienen sus propios recibos;
los resultados CPU y gráficos anteriores no los sustituyen.

Los siete recorridos locales originales terminan con cinco pases y dos fallos,
al primer intento, sin retries, flaky ni omisiones. Ambos casos nativos llegaron
al lector y pulsaron Back. Permanecía `is-closing-reader` al agotar la espera
original de ocho segundos o el límite global de treinta. Sus trazas y errores
se conservan; no se acredita que el cierre ya sea rápido. El análisis posterior
es de sólo lectura y no sustituye esa ejecución fallida.

## Evidencia

En `.animation.local/performance-1760/`:

- `editor-material-batch-proposal-attempt4/`: fuente final y conservación de originales.
- `editor-material-batch-cpu-method-attempt1/`: primer fallo conservado.
- `editor-material-batch-cpu-method-attempt2/cpu-attempt1/`: CPU final.
- `editor-material-quality-attempt1/`: primer método preparado, sin ejecutar.
- `editor-material-quality-attempt2/gpu-attempt1/`: comparación gráfica real.
- `adoption.json`: adopción después de revisar fuentes y resultados reales.
- `full-local-attempt1/summary.json`: batería completa de la fuente final.
- `local-browser-attempt1/`: siete recorridos originales, incluidos los dos fallos.
- `local-failures-analysis-attempt1.json`: análisis de las trazas originales.
- `local-seven-preparation1-failure.json`: conflicto de preparación conservado;
  ningún test se ejecutó allí. Los métodos finales son idénticos a los anteriores
  salvo versión, namespace y conteos comprobados.

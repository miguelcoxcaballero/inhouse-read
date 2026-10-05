# Rendimiento de Inhouse Read 1.7.61

## Cambio

Cuando termina el análisis de la portada de un libro seleccionado, la vista
reutiliza su modelo ya cargado en vez de construir otro completo. Conserva
la página, el marcapáginas, geometrías, materiales y mapas. Los casos de
carga pendiente o fallida mantienen la sustitución original. Se utiliza
la operación existente del editor; sólo cambia una llamada de la estantería.
No cambian resolución, iluminación, relieve, antialiasing ni las animaciones.

## Comprobaciones

CPU aislada: candidato 20 PASS, incluidos 11 casos originales y 9 nuevos.
El control conserva sus 11 originales y los 6 casos nuevos de paridad;
fallan únicamente las dos expectativas nuevas del opt-in que no incorpora.
Su informe bruto conserva exit 1. El primer ensayo fallido de los fixtures
nuevos queda separado: un contexto de canvas simulado no tenía el valor
inicial de font del navegador; sólo se añadió ese dato a los fixtures.

La GPU real pasa al primer intento en DPR2 y DPR1,5: 48 pares, 96 capturas,
RGBA completo y PNG nativo/exportado exactamente iguales. Son portadas
reales decodificadas y generadas, cambios de color, fuente y proporción,
en cuatro poses. En las 48 operaciones se observa una sustitución del
modelo en el control y ninguna en el candidato. Se conservan pose, página,
marcapáginas, contexto WebGL2, materiales y recursos. Las cargas y los
relieves reales se esperan en ambos caminos antes de capturar. No es una
medición de FPS ni de temperatura de un teléfono físico.

CPU: `760ee6b0c1a16c5062e928bf3aa4a721ba498474bf2be3eff82cdb5e66397e4d`.
GPU2: `921f5fcdfee12c896148209f301e3ab950f67b61df694d22ff765e1d066601d8`.
GPU1,5: `a1a44d981d1a16fe68f1e4a6f2ae3cd3015ef08f4f93d6ef79bf4c613402dab0`.

La fuente final pasa 3.109 unitarias en 235 archivos, compilación y 75
comprobaciones Python. Sus 515 hechos de fuente permanecen estables. El censo
conserva las 524 identidades E2E; no es una ejecución. Los siete recorridos
originales locales pasan al primer intento, cero retries, flaky y omisiones.
Los cierres alineado y legado tardan 5.058,1 y 6.003,5 ms con los plazos
originales. Veinte composiciones de cámara conservan la sala sin repintarla
y mantienen seis lomos de 1.024 px. La publicación sigue pendiente. Los resultados aislados anteriores
no sustituyen esos recorridos ni corrigen el resultado fallido de 1.7.60.

## Evidencia

En `.animation.local/performance-1761/`:

- `appearance-reuse-proposal-attempt1/` y `appearance-reuse-proposal-attempt2/`.
- `appearance-reuse-cpu-method-attempt1/`: preparación fallida por EOL.
- `appearance-reuse-cpu-method-attempt2/`: ejecución fallida de fixtures conservada.
- `appearance-reuse-cpu-method-attempt3/`: control y candidato finales completos.
- `appearance-reuse-quality-attempt1/`: fuentes y métodos sellados, build,
  DPR2 y DPR1,5 con sus informes originales y procesos cerrados.
- `adoption.json`: adopción después de comprobar CPU y GPU reales.

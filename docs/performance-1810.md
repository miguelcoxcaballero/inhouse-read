# Web 1.7.110: preparación del modelo ampliado

## Cambio

Después de presentar la estantería y preparar sus materiales, se prepara
también un modelo temporal con los materiales reales del libro ampliado:
normales de papel y tela, sombreado del lomo y hojas ya leídas. Se compila
en el renderer persistente de selección, sin dibujarlo ni subir sus texturas.
Sólo hay una preparación por contexto. La selección o destrucción de su
propietario cancela el trabajo entre los tramos de reposo.

Al terminar, cancelar o fallar el driver se liberan geometrías, materiales
y rasters temporales. Los programas usan el límite de retención existente.
No cambian geometrías mostradas, iluminación, DPR, duración de animaciones,
almacenamiento, Drive ni catálogo de voces.

## Comparaciones conservadas

- Comparación con los dos recorridos nativos originales, SwiftShader y
  trace:on, sin retries ni cambios de sus límites: control 109
  27.478/25.703 ms; candidato 24.072/25.774 ms. Ambos pasan. Una muestra
  mejora y la otra es similar; no se demuestra una mejora sostenida.
- Instrumentación separada: después de completar la preparación en reposo,
  la selección enlaza un programa frente a cinco del control. La marca se
  toma del pointerdown real, después de la captura previa. El tramo hasta
  estar listo dura 2.724,8/2.928,2 ms; no es una medición de FPS del móvil.
- El primer probe conservaba una marca anterior a la captura y contabilizaba
  compilaciones durante esa espera. Sus resultados quedan separados; no se
  usan para contar los enlaces posteriores al toque.
- Las capturas de sala no son idénticas. Se observan 5.181 píxeles distintos
  dentro de `[56,388,76,656]`, en el área del texto del lomo, sobre una imagen
  de 1.081×2.153 px. No se atribuye su causa ni se certifican píxeles iguales.

## Pruebas

Se añaden nueve regresiones sobre variantes ampliadas, liberación de
recursos, cancelación, error del driver y orden de preparación. Los prefijos
de ambas pruebas unitarias originales permanecen idénticos. El primer
harness nuevo espiaba varias veces los materiales compartidos y registraba
dos fallos; se conserva. Sólo ese harness se corrigió para espiar cada
material una vez, manteniendo la comprobación de liberación exacta.

La primera batería pasa: 3.629 unitarias en 293 archivos, build y 105 Python.
Se conserva y se repite tras restaurar los finales de línea originales en
las partes no modificadas de dos archivos. Sus contenidos normalizados son
idénticos; no se debilitan los controles de bytes de las pruebas posteriores.
La batería definitiva también pasa: 3.629/293, build y 105 Python. Los
siete recorridos originales locales pasan sin retries, incluidos ambos
regresos nativos con sus plazos originales. El censo enumera 533 casos
de interfaz; enumerarlos no equivale a ejecutarlos. Publicación, web real
y CI de 110 están pendientes al preparar este documento.

La 109 sigue publicada hasta completar esa comprobación. Conserva sus dos
timeouts nativos de CI y los dos fallos de captura de texturas públicas.
No se considera todo el rendimiento resuelto ni se añaden voces nuevas.

Evidencia: `.animation.local/performance-1811/`, incluidos los originales
fallidos, ambas comparaciones, los dos probes y la restauración de finales
de línea. El experimento distinto de uniforms previo al primer dibujo,
descartado por empeorar tiempos, permanece en `performance-1810/`.

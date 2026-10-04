# Rendimiento de 1.7.56

## Cambio

La devolución del libro sobre la estantería legada conserva su capa gráfica
para volver a componerla. Evita la segunda copia del framebuffer completo
en cada fotograma compatible. La estantería nativa alineada conserva su
captura original: su fondo puede cambiar cuando otro renderer dibuja.

Se comprueban propietario, contexto, generación, revisión del fotograma,
dimensiones físicas, posición y descriptor exacto. La exportación sigue
siendo sólo del libro y restaura la presentación visible. Cancelación,
dimensiones incompatibles y pérdida de contexto mantienen sus rutas.
No cambian geometrías, materiales, mapas, sombras, antialiasing, resolución,
densidad ni duración de las animaciones.

## Comparación aislada

Fuente de control `636aecb85d215b0164c955e053a62725df250b17` (1.7.55).
Pasan 59 casos en el candidato: 50 originales y nueve nuevos. El control
pasa los 50 originales y cuatro de los nuevos; falla los otros cinco.
Cuatro fallos demuestran la reducción de copias. El quinto comprueba una
llamada evitada al cache durante pérdida de contexto; el cache original ya
rechazaba esa llamada antes de trabajar en GPU. No se cuenta como otra
reducción de trabajo gráfico.

El wrapper de esa primera ejecución conserva FAILED por `KeyError` después
de guardar ambos informes y receipts. La observación posterior es sólo de
archivos, sin repetir tests ni reemplazar el fallo. SHA de la observación:
`6037f3c5a84c63decfb27dd99d92dd9670ee4cda0f7f3565abf5075b81a19720`.

La comparación gráfica de método 2 pasa sus 26 pares en DPR 2 y 2,75:
253.328.880 componentes RGBA sin diferencias, 26 PNG nativos y 26 exports
exactos, 104 invariantes. Las primeras seis poses de cada densidad pasan de
doce copias a seis. También se comprueban exportación, cambio de propietario,
fondos y dimensiones incompatibles, cancelación y pérdida y restauración
reales del contexto. Los 1.014 hechos de fuente/método permanecen iguales;
los navegadores y servidores de prueba están cerrados.

Certificado `legacy-insertion-quality-attempt2-final/summary.json`, SHA
`f960b69dd13a94bf494eeb4d00f8b0f7d106968979625f08f723829ac35bfdfa`.
El primer método gráfico conserva FAILED: completó doce pares exactos y
se bloqueó al solicitar restauración de contexto antes de terminar su evento
de pérdida. El método 2 espera un RAF nativo y limita la espera diagnóstica
de los eventos; no modifica el reloj de las animaciones ni las assertions.

Estas comparaciones acreditan igualdad visual y menos copias. No miden FPS,
temperatura o batería en un teléfono, ni explican los fallos de apertura de
la CI de 1.7.55. Los resultados de cada ámbito conservan su estado.

## Incorporación y verificación final

Se incorpora únicamente `bookshelf-scene.js`, el archivo con nueve casos
unitarios nuevos y la metadata de versión. La batería final pasa las 2.989
unitarias de 220 archivos, build y 75 comprobaciones Python originales.
Se mantienen 497 hechos de fuente y las 524 identidades del censo E2E
original; el listado no se cuenta como ejecución de navegador.
Evidencia `full-local-attempt1/summary.json`.

Los siete recorridos locales originales pasan al primer intento, con cero
retries, flaky u omisiones. Los cierres alineado y legacy registran 4.286,3
y 6.134,5 ms con los plazos originales de ocho segundos y treinta segundos
globales intactos. El gesto conserva veinte composiciones sin nuevos renders
de escena, dos escrituras de buffer, 74 geometrías, 52 texturas, 34 programas
y seis lomos de 1.024 px. Fuente, build y métodos permanecen estables.
Son medidas del navegador de escritorio, no del teléfono físico.
Evidencia `local-browser-attempt1/summary.json`.

La verificación del artefacto publicado y la CI completa siguen pendientes.

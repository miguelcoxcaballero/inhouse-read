# Rendimiento de Inhouse Read 1.7.65

## Cambios incluidos

La transferencia de modelos de voz a Android conserva los mismos bloques de
128 KiB, bytes, orden y protocolo. Cuando quedan datos, devuelve el control
al comprobar el presupuesto entre bloques, tras cuatro bloques o al alcanzar
cuatro milisegundos, mediante una confirmación del
executor nativo existente. El cierre cancela el trabajo pendiente y evita
finalizar una carga antigua. No cambia los pesos, el audio ni los plazos.

La captura física PDF sigue esperando al render actual de PDF.js y a los
dos frames originales, pero no espera fuentes globales ajenas a la página
ya rasterizada. Las capturas de texto PDF y EPUB conservan esa espera.
Los cambios de modo, render o documento se comprueban de nuevo antes de
copiar. No cambian dimensiones, resolución, fotos ni temas.

El analizador de portadas vuelve a poder importarse directamente desde una
URL `data:`. Conserva el scorer numérico original y carga el cliente Worker
al comenzar el análisis. Si ese enlace no está disponible, usa el cálculo
original por bloques. La carga real del cliente, Worker y archivos offline
se comprueba en el replay de navegador descrito abajo.

## Controles CPU aislados

La referencia es Git64 `72a785c2db0c4d65792c9008299f1445ab022d04`.
Las pruebas y los plazos originales permanecen intactos.

| Cambio | Candidato ejecutado | Control ejecutado | Alcance original |
| --- | --- | --- | --- |
| Transferencia nativa | 62/62 PASS | 50 PASS y 12 FAIL causales | 49 originales PASS en ambos |
| Captura física PDF | 150/150 PASS | 145 PASS; cinco nuevos no seleccionados | 142 originales PASS en ambos |
| Portada autocontenida | 48/48 PASS | 44 PASS; cuatro nuevos no seleccionados | 41 originales PASS en ambos |

Los casos nuevos no seleccionados del control son exclusiones planificadas;
no se presentan como pases ni fallos. Los procesos no registran errores no
capturados y conservan las identidades originales y las entradas verificadas.

El primer resumen nativo permanece FAILED: el clasificador no reconoció una
aserción `rejects` de Vitest cuyo mensaje comienza con `Error`. Una auditoría
posterior de los mismos JSON, sin ejecutar más pruebas, verifica únicamente
esa aserción concreta y los otros once fallos causales. El candidato queda
cualificado por ese certificado separado; el control y el primer resumen
siguen FAILED. Certificado SHA-256:
`9c10cc540233676f65e3a0681dc087ae5d40275dc548e4dc9575ffbbd53d9a91`.

## Integración local

La adopción conjunta aplica once archivos y conserva los bytes fuera de los
bloques cualificados, incluidos los saltos de línea existentes. El recibo
de adopción tiene SHA-256
`265cf7ea5e8baafa9035ade52c332547b66334b5c1a4ef38d9684ce67c3003c7`.

La batería completa final termina el 5 de octubre de 2026 a las 03:32:53 UTC:
3.175 unitarias PASS en 246 archivos, build PASS y 75 comprobaciones Python
PASS (51 de aplicación y 24 de segundo plano). Los cinco comandos terminan
con exit0, sin incidencias; los 530 hechos de fuente permanecen estables.
El listado contiene 524 identidades E2E únicas, cero omisiones y cero
intentos ejecutados. Es un censo, no una ejecución de esos 524 casos.
Resumen SHA-256:
`88975cedafc4e955f9c27ef7bc41c3f2df9d6b943f775c1901d444cae3821802`.

Los siete recorridos locales originales pasan al primer intento, con siete
intentos y cero retries, flaky u omisiones. Fuente y build permanecen
estables. Los cierres alineado y legado miden 5.357,7 y 6.299,9 ms con los
ocho segundos originales. Son observaciones de este entorno de renderizado
por software, sin comparación de velocidad ni acreditación de fluidez de
un teléfono. Resumen SHA-256:
`c2e0233a0e48a494646e9334b16bb0ac80e91f019e42ee7f58461090a6203dc4`.

El caso RAW de portada original pasa una vez, sin retries, flaky u omisiones,
con fuente y build estables. Usa la prueba y los plazos originales, sin
atribuir actividad Worker a esa carga `data:`. Resumen SHA-256:
`7e570ba6ee146e9a70dd5aae29e27ad0660f6a6644c0c89c74b41482d0405fef`.

El replay real del Worker pasa las cuatro comparaciones de dos portadas,
online y offline: 432 puntuaciones exactas y los mismos bytes de muestras,
máscaras y apariencias. El cliente dinámico y el Worker construido llegan
200 con cuerpos exactos; offline ambos proceden del Service Worker. La
navegación offline también llega 200 desde caché con el HTML exacto. El
fallo de red esperado de ese único probe de raíz permanece registrado;
no hay fallos de red inesperados, pageErrors ni consoleErrors. Entradas
estables y navegador/preview cerrados. Informe SHA-256:
`c946b0d6fcb492f38134c63dfc0cf093e44debfa3cb76412c32f28e758ed1280`.

La publicación HTTP, APK y loader se comprobaron contra sus bytes reales.
Los 18 recorridos PDF publicados y el caso RAW original pasan al primer
intento. El editor público también pasa, pero los dos recorridos nativos
de devolución fallan por el plazo global de 30 segundos. Las trazas
truncadas no acreditan un cierre completo superior a ocho segundos.
La CI65 completa termina con dos recorridos de apertura fallidos; detalle
más abajo. El APK publicado supera ambos recorridos de audio bloqueado
con Lessac y Cori, incluido el modelo mayor. No se declara
solucionada la fluidez de un teléfono por estos resultados.

## Publicación y diagnóstico posterior

Fuente `accce9b0a39380ef100a7f54a239f382575cc6a4`, Pages
`ba66ce6b6c3d7905fd1d28406bbb89a5611447e0`. Los 25 módulos y los
46 recursos del shell offline publicados coinciden con Pages. El primer
intento HTTP encontró todavía la versión64 del CDN y permanece FAILED;
el segundo obtuvo65 con sus bytes exactos.

La APK pública sigue siendo1.1.4, versionCode17, 78.515.243 bytes, SHA256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Su loader tiene2.089 bytes y sólo redirige a producción; no incorpora una
copia antigua de la app. No se hizo un build nativo nuevo para estos cambios
web. La inspección de esta descarga no se presenta como una nueva
comprobación criptográfica de la firma.

El diagnóstico pasivo posterior conserva las pruebas originales y sus
plazos, pero añade observadores, por lo que no sustituye la cualificación.
El editor y el recorrido legado pasan; el alineado termina por global30.
En el legado, ocho llamadas del mismo fallback de estantería copian el
framebuffer589×1174 al canvas590×1175: seis antes del lector (cuatro iniciales y dos de selección) suman9.723,7ms,
y las dos restantes miden934,8ms y913,7ms. La mayor llamada inicial tarda
4.199,2ms. Estos tiempos incluyen trabajo del navegador/driver por
software; no son tiempos GPU aislados ni mediciones de un teléfono.
El remuestreo de esa ruta debe conservarse al optimizarla.
Observaciones SHA256:
`160d7e241e38cfe2373ef072482dc5299ed1bc81ece5726a4ae44acddf909a51`.

La primera cualificación nativa remota, run37260698693, permanece FAILED
en ambos escenarios. La APK llegó a la estantería, pero el verificador
reubicado no encontró `register_book_imports`; no comenzó la prueba de
audio. La nueva rama QA corrige únicamente las rutas de ejecución y sus
comprobaciones, conservando los verificadores, los plazos, la APK y la
publicación65. Run37261578368 está en curso. No se acredita todavía la
transferencia real de Cori ni el audio con la pantalla apagada.

La CI original de65, run37260216704, termina FAILED: 3.175 unitarias en246
archivos pasan; de524 identidades E2E,522 pasan y dos son unexpected.
Hay526 intentos, dos retries y cuatro intentos timedOut. No hay omisiones,
flaky ni errores globales. Los cuatro fallos de los recorridos nativos
ocurren antes de pulsar Volver, esperando que el canvas PDF sea visible;
no prueban un cierre superior a ocho segundos. Los otros shards y todos
los grupos de voces reales pasan. Certificado SHA256:
`9850fb224644993717488839a94a67ee125c5dc46e5bf73118f7929319155b22`.

Evidencia adicional bajo `performance-1765/`:

- `public-accce9b-attempt2/http-attempt1/artifact-1765-accce9b.json`.
- `public-accce9b-attempt2/{performance-browser-attempt1,browser-attempt1,raw-cover-browser-attempt1}`.
- `passive-public-profile-method-attempt1/prepared-attempt1/results.json`.
- `passive-profile-analysis-attempt1/observations-attempt1.json`.
- `remote-native-37260698693-{original,largest}-attempt1/`.
- `qa-git-commit-method-attempt3/commit-attempt1/receipt.json`.

La preparación del helper RAW local método2 queda rechazada sin ejecución:
recodificó el título UTF-8 y su afirmación de cambio exclusivo de salida era
incorrecta. El método3 conserva los bytes originales y modifica únicamente
la salida de artefactos; su ejecución original pasa una vez. Se conservan también
los errores de preparación anteriores y el primer resumen nativo FAILED.

## Límites y evidencia

Estos resultados CPU comprueban contratos y ciclos de vida; no miden FPS,
memoria ni fluidez de un teléfono. La transferencia mantiene sus bytes,
pero añade confirmaciones cuyo coste en el modelo mayor debe medirse con
la APK publicada. El recorrido original en emulador con el APK publicado
supera inicialización, 368.424 ms bloqueado, continuidad de capítulos,
pause/resume/stop y cierre pausado. Cori supera 368.100 ms bloqueado,
367,029 s de PCM y capítulos 0–21. Ambos recorridos conservan PDF oculto,
progreso, controles y fuente/Pages/APK/loader exactos antes y después.
Resumen `3d0bfc48…`, run `37261578368`; todos los procesos cerrados.
No se acredita igualdad
PCM observada ni tiempo de confirmación nativa. Los fallos originales de
versiones anteriores permanecen conservados.

Rutas bajo `.animation.local/`:

- `performance-1765/native-model-upload-cpu-method-attempt1/cpu-attempt1/execution/summary.json`:
  primer resumen FAILED, candidato62/control50+12.
- `performance-1765/native-upload-cpu-posthoc-assertion-audit-attempt1/audit-attempt1/certificate.json`:
  auditoría separada, sin nuevas ejecuciones.
- `performance-1767/pdf-physical-font-wait-cpu-method-attempt1/cpu-attempt1/execution/summary.json`:
  candidato150/control145 y cinco exclusiones planificadas.
- `performance-1766/cover-self-contained-worker-compat-cpu-method-attempt2/cpu-attempt1/execution/summary.json`:
  candidato48/control44 y cuatro exclusiones planificadas.
- `performance-1765/combined-three-fixes-adoption-method-attempt3/plan-attempt1/adoption.json`:
  adopción conjunta y preservación de pruebas originales.
- `performance-1765/full-local-attempt1/summary.json`: batería completa PASS y
  censo E2E sin ejecución.
- `performance-1765/local-browser-attempt1/summary.json`: siete originales
  locales PASS al primer intento, con los mismos plazos.
- `performance-1765/raw-cover-local-attempt1/summary.json`: caso RAW original
  PASS al primer intento, separado del replay Worker.
- `performance-1765/cover-font-worker65-replay-preparation-attempt1/browser-attempt1/report.json`:
  cuatro comparaciones reales online/offline PASS y procesos cerrados.
- `performance-1765/raw-cover-local-method3-preparation.json`: método2
  rechazado sin ejecución y reversión exacta del método3 antes de su pase.

# Natural voice startup — 1.7.5

The user's Android recording shows automatic Pim in Dutch at 1.1× falling back before its first fragment. The failure reproduced with the actual `nl_NL-pim-medium` ONNX model on main: `synth-failed` after ~2.1 seconds, no audio. The published dictionary bytes matched the repository.

The shipped 2.23 MB phonemizer pack already contains `nl_dict` and other dictionaries, while the wrapper tried to create them again. Emscripten throws EEXIST, reported as `[object Object]` by the worker. The wrapper now checks the module's real filesystem and reuses an existing dictionary. The exported lookup is part of the generator too. Revisioned URLs keep the glue/file table and data pack together across cached Android sessions.

The real-engine Dutch regression now passes: actual model download, audible finite PCM, both sentences completed, cold worker after reload at 1.1×, and dictionary URLs blocked during that second reading. No replacement of the engine with a fake. The failing test's outdated data-pack assertion now checks the embedded byte count and the current pack budget. Worker errors are preserved in failures for diagnosis.

This is a web correction loaded by the existing Android 1.1.2 shell. Native version, signing and APK are unchanged. Additional loading-race corrections and the remaining WIP are separate follow-up changes.

Production verification (2026-10-02): the actual published app downloaded Pim from Hugging Face, selected Dutch automatically and produced finite audible Web Audio at 1.1× without system speech. A second reading after reload reused the installed model and started again with the dictionary URL blocked. Both completed starts passed in a clean mobile-size browser context (40.6 seconds total). Evidence is in `.animation.local/pim-live-evidence/`; the system API is observed through a controlled implementation, while Piper, its weights, WebAssembly and Web Audio are real. This is not a physical Android-device test.

Published main asset: `/inhouse-read/assets/main-Cyyuwg_s.js`, SHA-256 `decf0daedc1ecfe16c912888b88fbb104fcc3778b678a7ef041b8e905c5b0dda`. The live phonemizer exports the filesystem lookup and serves the complete 2,232,748-byte pack with `?v=20261002-dictionaries`.

## Production verification — 1.7.8

On 3 October 2026 (Europe/Madrid), the same live test passed again on the deployment of commit `e310cb75fe2b7cd8e295c1049cf5fba085f96268`: **1/1, 33.57 seconds, no retries, skips or page errors**. It used the actual production app and its default Hugging Face download URLs. Dutch automatic selection chose `piper:nl_NL-pim-medium` at **1.25×** for both starts. The second start followed reloads in the same browser context, reused installed weights from Cache Storage and had no Download button. The separate `nl_dict` URL was blocked; neither start requested it, since Dutch is embedded in the phonemizer pack.

Web Audio produced finite PCM at 22,050 Hz with a 0.9 peak and RMS values of 0.154, 0.143 and 0.124. Every captured chunk used a running audio context. The observed system-speech implementation recorded zero calls, so the test did not pass through a system fallback. The engine request to first scheduled audio took approximately 3387 ms after installation and 2917 ms after reload. These are measured starts on this browser and machine, not a universal startup-time promise or a test of an entire book.

The system API remains a controlled observer; the production picker, Piper model, phonemizer, ONNX Runtime worker and Web Audio are real. The test does not establish physical Android playback or offline app bootstrap. The unchanged Android 1.1.2 / code 15 APK has a 2089-byte loader that redirects to the published app; it contains neither app bundles nor neural model assets.

Published asset: `/inhouse-read/assets/main-3lf-QqBP.js`, 1,365,072 bytes, SHA-256 `c8575e57797742ea855c847e08900df116deb9a9036756b38289df2037506bd6`, matching the deployed `gh-pages` bytes. Evidence: `.animation.local/final-live-evidence/artifact.json`, `.animation.local/final-live-evidence/pim-178/{results,numbers}.json`, `pim-live-0.png`, `pim-live-1.png` and `.animation.local/final-live-pim-178.log`.

The three neural jobs of Production checks **37073632148** also passed with **56/56** executed cases: engine 9, reading 10 and languages 37 (all 36 catalogue options plus the dictionary-pack check), with zero skips or retries. This confirms the voice jobs only; the complete CI and bookshelf/reader checks are tracked separately in [remaining-wip-verification.md](remaining-wip-verification.md).

## Corrección publicada 1.7.9: Daniela y sólo voces naturales

Daniela high superó RTF 1,6 durante varios segmentos. El motor anterior
convertía esa lentitud en error `too-slow`; el lector guardaba un veto global
durante catorce días y pasaba al dispositivo. El nuevo motor espera fragmentos
completos cuando la generación va más lenta que el audio. Conserva la voz y la
cola; los errores reales se muestran para reintentar la misma natural. Se
eliminan el veto y los transportes de sistema del lector y sus menús.

La regresión con pesos reales de Argentina pasó a 1× y 1,25×, con worker frío
y tres inicios audibles por velocidad. RTF 1,802 y 1,821 activaron el buffer
completo y la lectura continuó; el primer inicio tardó 3285 y 3269 ms. Ambas
API de voces del dispositivo permanecieron sin llamadas. Evidencia local:
`.animation.local/argentina-real-179/`.

La comprobación publicada también pasó: Daniela a 1× y 1,25×, worker frío,
tres fragmentos por velocidad, pesos descargados desde Hugging Face y cero
llamadas a ambas API de voces del dispositivo. RTF 1,806 y 1,831 activaron el
buffer sin cancelar la voz; primer audio en 3343 y 3181 ms en esta máquina.
Pim automático neerlandés a 1,25× pasó después de la descarga y de recargar con
Hugging Face bloqueado, reutilizando los recursos instalados. Los dos casos
pasaron sin omisiones, reintentos ni errores en `main-Ds1rBulm.js`.
Evidencia: `.animation.local/final-live-evidence/voices179/`.

## Publicación 1.7.11: Argentina y neerlandés

Los dos casos dirigidos pasaron de nuevo sobre la web real, con manifiesto
`chromium` / shard `1/1`, guard válido, cero omisiones y cero reintentos. La entrada
fue `assets/main-CYpsBWpi.js`, SHA-256
`171442b72fde552c33dedb9a6d61432d7f85eeda664f4c28656553aead08e473`.
La publicación de los cambios exclusivos en pruebas hasta `a89d67b` conservó
esos mismos bytes del runtime, fonemizador, diccionarios y manifiesto Android.
Las verificaciones de 1.7.12, cuyo runtime cambia por la corrección de caché y CSS,
se registran por separado.

Daniela inició tres fragmentos por velocidad, a 1× y 1,25×, con worker frío y pesos
reales descargados desde Hugging Face. Del toque al evento de inicio audible fueron
3468 y 3130 ms; RTF 1,835 y 1,805. Se observaron dos underruns por caso antes de
activar el buffer completo: la lentitud quedó como diagnóstico, la voz y la cola
se conservaron y hubo cero llamadas a las dos API de voz del dispositivo. Estas
muestras no prometen continuidad perfecta ni una latencia universal.

Pim se eligió automáticamente para neerlandés a 1,25×. El primer inicio siguió a
la instalación; el segundo reutilizó Cache Storage tras recargar con Hugging Face
bloqueado. No se pidió `nl_dict`, que ya está en el paquete. Los chunks observados
fueron finitos, audibles, de 22.050 Hz, con peak 0,9 y contexto de audio activo.
No se llamó a una voz del dispositivo.

Evidencia: `.animation.local/final-live-evidence/voices1711/`, incluidos
`manifest.json`, `results.json`, `guard.log`, `numbers-argentina.json`,
`numbers-pim.json`, capturas y trazas. Los modelos, Piper, fonemizador, ONNX y
Web Audio son reales; las API del dispositivo son observadores controlados.
Esto comprueba la publicación en un navegador, sin acreditar audio en un
teléfono Android físico ni el arranque completo de la APK sin conexión.

La batería integrada de voces de esa tanda, [Production checks 37090203031](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37090203031),
pasó **58/58** casos del commit `a89d67b38388820f8e7435dc3717e05be4c9f5b1`:
engine 9, reading 12 y languages 37. Los manifiestos y los resultados coinciden
con el censo independiente, sin identidades omitidas o duplicadas, skips,
resultados flaky, retries ni errores globales. Esto acredita los tres grupos
de voces; la conclusión de la batería completa se registra en
[remaining-wip-verification.md](remaining-wip-verification.md).

La prueba de cancelación termina con Davefx seleccionado. La de inactividad
elige Claude por sí misma antes de comprobar su worker. La
secuencia dirigida switching → idle pasó también 2/2, comprobando cancelación,
cierre real del worker, recursos liberados y un worker nuevo desde caché con las
peticiones de modelos bloqueadas. Evidencia:
`.animation.local/natural-switch-idle-1711/` y
`.animation.local/ci-37090203031/neural-{engine,reading,languages}/`.

En el harness de idiomas del run 37090203031, el primer audio varió entre 2,331 y 9,153 s:
Daniela 9,153 s (RTF 1,97), Pim 3,146 s y hebreo 2,331 s. Los 36 casos
produjeron PCM finito, audible y sin clipping. La latencia depende de modelo,
texto y máquina; estas medidas no establecen un tiempo universal de arranque.

En el lector integrado, Daniela inició tres fragmentos a cada velocidad. Del
toque al evento de inicio fueron 3910 ms a 1× y 3764 ms a 1,25×, con RTF 2,403 y
2,413. Cada caso registró dos underruns y activó el buffer completo. La señal
`tooSlow` permaneció como diagnóstico; se conservaron la voz natural y la cola,
sin llamadas a las voces del dispositivo. El caso del motor completó seis
fragmentos y 36,55 s de audio con cero underruns y cero huecos mayores de 150 ms.
Estos resultados se conservan por separado de los dos casos de la web real.

En el caso de estantería junto a la síntesis de ese mismo run, los cinco segundos
tras volver de un EPUB a la biblioteca tuvieron 249 frames, p50/p95/máximo de
16,7/16,7/900 ms y una tarea larga de 897 ms.
Durante los 14 s de generación hubo 842 frames, 16,7/16,7/16,8 ms y
cero tareas largas. El observador registra duraciones y no identifica la causa
de las pausas iniciales. La prueba compara la degradación añadida durante la
síntesis; no exige 60 fps absolutos ni que el regreso a la estantería sea fluido.
Son mediciones de ese runner, sin acreditar rendimiento en un teléfono físico.
La comprobación de inactividad observó el cierre del
worker, los mapas de llamadas/trabajos/preparaciones vacíos y su sustitución desde
caché. El descenso de RSS agregado de 397,41 MiB es diagnóstico del conjunto de
procesos; el cierre y la limpieza son sus criterios de aprobación. Los datos
están en los artefactos originales de idiomas y en
`neural-reading/test-results/neural-reading/numbers.json` dentro de esa tanda.

## Publicación 1.7.12: comprobación nueva sobre el runtime publicado

Las dos regresiones reales de Argentina y neerlandés pasaron otra vez, sin
omisiones ni reintentos, en `assets/main-B_kpIj72.js` del commit
`67dd9bf269b81839f17f6a09beba11ce8c5cabea`. La entrada tiene 1.371.955 bytes y
SHA-256 `585138de511b90bb0817514542493080126220a37917d176c7524dc4f7227a79`,
coincidente con `gh-pages` y los 20 recursos publicados comprobados.

Daniela inició tres fragmentos a 1× y otros tres a 1,25× con worker frío. Del
toque al evento de inicio fueron 3522 y 3292 ms, con RTF 1,809 y 1,877. Cada
velocidad registró dos underruns antes de activar el buffer completo; la voz y
la cola se conservaron, y las dos API del dispositivo registraron cero llamadas.
Son eventos observados en Web Audio, sin medición de un altavoz físico ni
promesa de latencia o continuidad universales.

Pim volvió a iniciar automáticamente a 1,25× después de instalarse y tras
recargar con Hugging Face bloqueado, utilizando los recursos guardados.
Ambos casos conservaron las aserciones originales de PCM finito y audible.
Manifiesto, resultados, trazas, medidas, pin de publicación y guard normal
`chromium` / `1/1`: `.animation.local/final-live-evidence/live1712/voices/`.
La certificación nueva se guarda en `live1712/certification.json`; los
resultados anteriores de 1.7.11 permanecen separados.

La batería integrada de voces del mismo commit,
[Production checks 37092411622](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37092411622),
pasó **58/58** identidades exactas (9 engine, 12 reading y 37 languages), sin
skips, reintentos, resultados flaky ni errores globales. Los 36 casos de voz
produjeron PCM finito y audible con los 33 modelos del catálogo. El primer audio
del harness de idiomas varió de 3,119 a 11,543 s; en esa tanda Daniela tardó
11,543 s, Pim 3,999 s y hebreo 3,119 s.

En el lector integrado, Daniela inició tres fragmentos por velocidad: 4061 ms
a 1× y 4039 ms a 1,25×, con RTF 2,223 y 2,245 y dos underruns diagnósticos por
caso. Conservó voz y cola, sin llamadas al dispositivo. El caso del motor
completó seis fragmentos y 37,04 s de audio con cero underruns o huecos mayores
de 150 ms. Son mediciones de ese runner, separadas de la comprobación LIVE.

El caso de inactividad acreditó worker cerrado, referencia nula y mapas vacíos,
seguido de un worker nuevo desde caché sin peticiones de modelos. La caída de
RSS agregado de 294,72 MiB es sólo diagnóstica. Durante 14 s de síntesis se
registraron 841 frames con p50/p95/máximo 16,7/16,7/16,8 ms y cero tareas largas;
los cinco segundos de referencia tras volver a la biblioteca tuvieron 144 frames,
16,7/16,8/2249,8 ms y tres tareas largas. El observador no atribuye causas y la
prueba exige degradación relativa, sin prometer 60 fps absolutos o rendimiento
en un teléfono. Originales, integridad ZIP/JSON y medidas:
`.animation.local/ci-37092411622/neural-{engine,reading,languages}/` y
`neural-metrics.json`. La conclusión de toda la batería se registra en
[remaining-wip-verification.md](remaining-wip-verification.md).

## Confirmación web 1.7.14

La batería del commit 506f7ef08c3e7dddaddc4e5ce6a63313756710e5 pasó las 59 pruebas de motores reales, además de las 1873 unitarias en 109 archivos y las 246 E2E completas. En la publicación 1.7.14 se repitieron Argentina a 1×/1,25× y neerlandés tras instalar y recargar desde caché con Hugging Face bloqueado, conservando voz, cola y PCM audible sin llamadas a voces del dispositivo. El resto de las 24 regresiones publicadas también pasó sin omisiones ni reintentos.

Las mediciones anteriores de 1.7.12 se conservan con su fecha y fuente. La evidencia nueva pertenece a 37100354260 y a .animation.local/final-live-evidence/live1714/voices/; no acredita audio ni rendimiento en un teléfono físico.

Los casos publicados se ejecutaron sobre b48a9928b9f2520e3ff3a3b299010b9bc7c0fd2f. El commit 506f7ef08c3e7dddaddc4e5ce6a63313756710e5 modifica únicamente las observaciones en tres archivos E2E: los bytes publicados siguen siendo idénticos, acreditados por runtime-equivalence-1714-506f7ef.json. Su certificado original conserva las fechas y la fuente del ensayo.

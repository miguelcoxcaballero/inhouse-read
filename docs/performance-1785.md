# PreparaciÃ³n de programas de inserciÃ³n â€” 1.7.85 en comprobaciÃ³n

El perfil anterior localizÃ³ reflexiÃ³n de uniforms durante paintInsertionOverlay.
Los programas de profundidad y del indicador ya se enlazaban despuÃ©s del
primer frame de la estanterÃ­a. Ahora tambiÃ©n preparan los mismos uniforms,
uno por intervalo libre, usando el helper existente. La destrucciÃ³n del
propietario cancela el trabajo pendiente y los errores conservan el dibujo
normal. No se dibuja una vista previa ni se cambian materiales, resoluciÃ³n,
variantes o relojes de animaciÃ³n.

Seis pruebas nuevas y 30 enfocadas PASS: espera por idle, deduplicaciÃ³n,
conservaciÃ³n de geometrÃ­a/material, cancelaciÃ³n antes del enlace y antes de
la reflexiÃ³n, propagaciÃ³n del error y contrato para renderers de prueba.
Evidencia: `.animation.local/insertion-warmup-focused-attempt1.json`.
La baterÃ­a completa y los grÃ¡ficos todavÃ­a estÃ¡n pendientes; no publicada.

BaterÃ­a completa local PASS: 3.436 unitarias/274 archivos, build y
75 Python. Fuente653 y mÃ©todos exactos. El censo524 es sÃ³lo listado,
no ejecuciÃ³n E2E. Evidencia: `.animation.local/performance-1785/full-local-resource2-attempt1/`.

Catorce recorridos originales locales PASS, cero retries: siete de
apertura/cierre/editor/gestos, cinco de catÃ¡logo/plantas/luces y dos de
reutilizaciÃ³n y cambios de luces. MÃ©todos y fuente653 exactos; relojes
originales. Los cierres nativos medidos son 5.226,2 y 4.894,2 ms en estos
recorridos. No es una mejora causal porcentual ni un benchmark de telÃ©fono.
Evidencia: `.animation.local/performance-1785/`.

Los dos casos originales adicionales de SwiftShader PASS en su primer
intento: 26,9 y 25,7 s completos, con lÃ­mites originales de 30/8 s.
Sus FAIL de 1.7.84 permanecen registrados y no se sustituyen. Esta aprobaciÃ³n
es local Windows y no acredita rendimiento en un telÃ©fono ni causa porcentual.
Evidencia: `swiftshader-original-attempt1/` de performance-1785.

PublicaciÃ³n fuente `aa571cd05797f1fb9a2624e7c104193e60e13e1d`; deploy
[37418686475](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37418686475)
PASS. Pages `2c8ff7fca271014fef678d5d7735fc0cb2e68cc9`; main real
`assets/main-B-JyNEzn.js`, 592.699 bytes, SHA256
`fb9dc1ef3655cea45b16072d0419a0a0d9ebe561748b74be384c19449c3ad4ff`.
HTTP32/offline96 y nueva descarga APK1.1.4/code17 con loader exacto2089 PASS.
Los tres recorridos pÃºblicos y su auditorÃ­a PASS. PDF18 y auditorÃ­a PASS,
cero retries y mÃ©todos originales conservados. CatÃ¡logo y offline pendientes.
CI85 completa524 ejecutÃ¡ndose, todavÃ­a sin aprobaciÃ³n global.
Evidencia: `.animation.local/performance-1785/public-aa571cd-attempt1/`.

El diagnÃ³stico adicional con profiler tambiÃ©n pasa su cuerpo original,
fuente653 y mÃ©todos exactos. Fue preparado antes del commit; la etiqueta
uncommitted de su metadata describe esa preparaciÃ³n y sus bytes guardados
coinciden con el cÃ³digo publicado. No se reescribe la captura. El muestreo
sigue mostrando reflexiÃ³n de uniforms durante la inserciÃ³n (~477 y88 ms),
asÃ­ como resizing (~786 y447 ms); no se afirma haber eliminado toda la
reflexiÃ³n ni que el cambio explique causalmente la diferencia entre runs.
Una muestra de preparaciÃ³n en idle aparece antes de abrir (~30 ms).
Perfil SHA256 `8b590a1c598ea372b95de7a77f6ab72c91af7bd50b6777bb8b5a27e8f2e43a16`.
Evidencia: `swiftshader-startup-profile-attempt1/` de performance-1785.

CatÃ¡logo pÃºblico5 PASS: en conjunto26/26 recorridos y auditorÃ­as PASS, sin
retries. Papel offline v4 y v5 PASS en cinco temas; ambos caminos conservan
los mismos pÃ­xeles. Portada offline PASS JPEG800x1600/150.310 bytes, worker
real, cero fallback. CachÃ© real:
`inhouse-read-shell-v1-a67481ebb18d7117b8ddad42ba848000cca4881d16e44e58e648f9361e0f73c9`.
La CI85 sigue en marcha con UI3 y UI4 fallidas: todavÃ­a no se da por terminado.

La CI85 ha terminado FAILED en UI3, UI4 y UI6; unitarias y las cuatro
 tandas de voces reales PASS. La recogida completa de originales está pendiente.
 En snapshot001, UI3 falla al seleccionar/abrir antes del cierre; UI4 falla al
 cerrar antes de los pasos de planta vecina. No se interpreta como un fallo
 demostrado de hit testing de plantas ni se sustituyen sus originales.

Recogida completa CI85: 11 ZIP y12 logs originales,524 identidades,
528 intentos,4 retries y7 intentos fallidos; sin omisiones ni errores de
recogida. Fuenteaa571cd, unitarias3436/274 y cuatro tandas de voces PASS.
UI3: dos casos fallan antes/durante la apertura. UI4: regreso del libro
antes de los pasos de planta vecina falla a8s. UI6: recarga del nogal con
3luces falla su primera observación a8s, pasa el retry y queda flaky;
el gate original rechaza ese retry. No se sustituye por el resultado aprobado.
Evidencia: `ci-original-37418686532-attempt1/snapshot-002/` de performance-1785.

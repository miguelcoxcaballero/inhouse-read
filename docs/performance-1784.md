# Consultas de diagnóstico de shaders — 1.7.84

## Cambio en comprobación

Los cuatro constructores de renderer configuran los diagnósticos de Three
antes de generar iluminación o dibujar. Producción evita obtener los logs
sincrónicos de los shaders; desarrollo conserva su comprobación original.
Un manejador de errores personalizado conserva también los diagnósticos.
Se usan los mismos programas, uniformes, iluminación, materiales, DPR,
resolución, sombras y relojes. No se amplía ningún plazo de prueba.

El código instalado de Three llama a getProgramInfoLog y getShaderInfoLog en
su primer uso cuando debug.checkShaderErrors está activo. El perfil local de
luces conservado en performance-1783/lamp-first-frame-profile-attempt2
atribuye unos 846 ms a getProgramInfoLog en el contexto final. El perfil
recoge la navegación final; no identifica por sí solo la causa del frame
fallido de un run diferente ni mide rapidez en un teléfono.

## Comprobaciones

Seis pruebas nuevas conservan producción, desarrollo, callbacks, ajustes
existentes y renderers sin interfaz debug; 30 pruebas enfocadas PASS.

Dos contextos WebGL2 nuevos ejecutan el mismo modelo con las configuraciones
de desarrollo y producción explícitas. Tres acabados y seis poses: 18 pares
con los mismos SHA256 de todos los bytes RGBA, dimensiones, DPR y contenido
no vacío. La configuración de producción realiza cero consultas de logs;
la de desarrollo realiza 10 getProgramInfoLog y 20 getShaderInfoLog, con unos
297 ms de espera medida en este ensayo instrumentado. Es una comprobación
del mecanismo; no acredita una mejora porcentual de velocidad/FPS o consumo
ni la apertura/cierre completos. Fuente650 y métodos permanecen exactos.
Después se cambió sólo la versión, sin alterar el dibujo.

Evidencia: `.animation.local/performance-1784/shader-diagnostics-pixels-attempt1/`.
Batería completa local y gráficos pendientes; todavía no publicada.


## Integración revisada

La primera batería completa conserva 3.426 PASS/4 FAIL, build y 75 Python PASS.
Los cuatro fallos proceden del mock original del enlazador en el catálogo
(botánica): su interfaz no tiene el nuevo export y el constructor abandona
la preparación. No se alteró el mock ni ninguna aserción original. La
configuración se trasladó a shader-diagnostics.js, independiente del enlazador,
conservando el contrato anterior y el mismo cuerpo de función. Código e informes
anteriores quedan en `.animation.local/performance-1784/`.

Revisión: 34 pruebas enfocadas PASS, incluidas las cuatro originales. Nueva
comparación WebGL2: 18 pares exactos, 10+20 consultas en desarrollo y cero
en producción, fuente651 intacta. Los ~273 ms medidos de consultas corresponden
a ese ensayo instrumentado, no a un benchmark del lector. Evidencia revisada:
`.animation.local/performance-1784-diagnostics/shader-diagnostics-pixels-attempt1/`.
Batería completa revisada PASS: 3.430 unitarias/273 archivos, build y
75 Python. Las 651 entradas de runtime/tests/config quedan intactas.
El listado524 es censo, no ejecución E2E. Gráficos pendientes; no publicada.

## Recorridos locales de la revisión final

Catorce casos originales PASS, cero retries: siete de apertura/cierre/editor,
cinco de catálogo/plantas/luces y dos de conservación del modelo al devolverlo.
El cierre nativo medido fue 4.929,7 ms alineado y 5.112,5 ms fraccionario;
son medidas de estos recorridos, sin acreditar velocidad en un teléfono ni
una mejora causal porcentual. Métodos y fuente651 exactos; plazos originales.
Evidencia: `.animation.local/performance-1784-diagnostics/`.

La comprobación adicional de SwiftShader conserva dos FAIL: ambos mantienen
is-closing-reader al límite original de 8 s. No se repite ni se amplía ese
límite. Las 14 pruebas normales aprobadas y la eliminación de consultas
no sustituyen esos fallos ni acreditan que toda la lentitud esté corregida.
Evidencia: `swiftshader-original-attempt1/` de la revisión final.

## Publicación 1.7.84 y comprobación del artefacto

Fuente `0bd01b6e759052ba1804c36800830e3de4408ecc`; deploy
[37414985336](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37414985336)
PASS. Pages `07deb1a943f85c81480e37cf6e9211650bf7e376`; main real
`assets/main-BWhhgVNb.js`, 592.260 bytes, SHA256
`a62077ef01904cbd098d13f7430a05d53a6453fa78ef0702005bd6c4e0ccf47a`.
Los dos primeros pins conservaron el HTML anterior de CDN y se rechazaron;
el tercero coincidió exactamente. HTTP32/offline96 PASS.

Nueva descarga real de APK 1.1.4/code17: 78.515.243 bytes, SHA256
`feafaaa762b35344ac8b19418f9f6eb6cb1f725fba22b1ef3d3f273bd32a6191`.
Loader exacto de 2.089 bytes, tres archivos public, sin app antigua empaquetada.
No se cambió código nativo ni se ejecutó de nuevo el APK en un teléfono.

Resultado estricto público: recorridos3 2 PASS/1 FAIL; PDF18 17 PASS/1 FAIL;
catálogo5 PASS. Los dos fallos proceden de la auditoría HTTP que observó un
cuerpo vacío del walnut-pbr.webp (209.252 bytes esperados), después de las
aserciones funcionales originales. Se conserva el FAIL; la descarga HTTP
independiente correcta no lo convierte en PASS ni determina su causa.
En conjunto son 24/26 casos estrictos aprobados, cero retries.

La colección completa de CI83 conservó 11 ZIP/12 logs, 524 casos únicos y
526 intentos: dos retries, cuatro intentos fallidos de aperturas nativas en
UI3. Unitarias y las cuatro tandas de voces reales PASS. Colección final:
`.animation.local/performance-1783-compact/ci-original-37412046498-attempt1/snapshot-002/`.
La CI84 de 524 casos está ejecutándose; todavía no hay aprobación completa.

Evidencia pública: `.animation.local/performance-1784-diagnostics/public-0bd01b6-attempt3/`.

Papel offline v4 PASS en cinco temas; v5 PASS con los mismos píxeles en
captura normal y reutilización de layout. Portada offline PASS: JPEG
800x1600, 150.310 bytes, worker real, cero fallback. Caché SW real:
`inhouse-read-shell-v1-6c100a652f1e029314f7c731c68b43bc8f46220cbaae4a7574f5de4b1561f0e1`.
Son comprobaciones de esta publicación; no una medición en un teléfono.

## Diagnóstico adicional del cierre en software

Un recorrido original fraccionario con profiler CDP conserva un FAIL,
fuente651 y métodos exactos. No se usa como aprobación. El muestreo atribuye
aproximadamente 1.445 ms exclusivos durante el cierre a los setters del
canvas dentro de setDrawingBufferSize, y 379 ms a reflexión de uniforms.
Son muestras de un ensayo instrumentado; no permiten atribuir todo su
retraso a esas funciones ni comparar causalmente velocidades con otro run.
El programa original mantiene sus plazos de 30/8 s. Próximo trabajo:
comprobar los cambios reales de framebuffer y la preparación de uniforms,
conservar DPR, geometría y salida visual, antes de cambiar el cierre.

Evidencia: `swiftshader-startup-profile-attempt1/` de la revisión final;
perfil SHA256 `407525b8daf9f55b5cfb5f5838ac4e08a089eea0d7c5e1e391020cef219deed1`.

CI84 snapshot002: 7 ZIP disponibles/11, 182 casos únicos y 184 intentos,
dos retries y cuatro intentos fallidos de UI3. Ambos recorridos nativos
llegaron al cierre y agotaron el límite global30 mientras is-closing-reader
seguía activo, también en retry. Es distinto de las aperturas fallidas en
CI83, sin demostrar por sí solo una mejora causal. Unitarias y las tres
tandas Piper PASS; Supertonic y otras tandas siguen ejecutándose. Todavía
no es el censo completo524. Métodos originales guardados, issues vacío.

La cadena de la muestra de reflexión señala paintInsertionOverlay:
la cámara de inserción prepara primero la profundidad de los vecinos y luego
el libro. Los depthWriters ya se preenlazan en un idle después del primer
frame, pero no precargan sus uniforms. Se ha identificado para la siguiente
propuesta: preparar esos uniforms en idle usando el helper existente, con
cancelación por dispose y sin dibujar ni cambiar variantes. Todavía no se
ha cambiado ese código ni se ha comprobado causalidad por programa concreto.
Cadena original: `uniform-reflection-chain-readonly.json`.

El helper real descargado de producción confirma su default true y la
configuración de checkShaderErrors en false, con callback personalizado
conservado; `production-helper-readonly.json`. Es inspección del bundle
publicado, independiente de la prueba de píxeles y sin medir rapidez.

## CI84 completa

[37414985340](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37414985340)
terminó FAILED. Colección autenticada: 11 ZIP/12 logs, 524 casos únicos,
527 intentos, tres retries y seis intentos fallidos. UI3 conserva los dos
cierres nativos agotando el plazo global30, también en retry. UI6 conserva
la recarga del nogal con tres luces: falta data-active-lamps=3 al límite8,
también en retry. No se ajusta ese límite ni se cuenta el retry como aprobación.
Las 3.430 unitarias/273 archivos, las otras cuatro tandas generales y las
cuatro tandas reales de voces PASS. Método intacto, issues vacío.
Evidencia: `ci-original-37414985340-attempt1/snapshot-003/` de la revisión final.

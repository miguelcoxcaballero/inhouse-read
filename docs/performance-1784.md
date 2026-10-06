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

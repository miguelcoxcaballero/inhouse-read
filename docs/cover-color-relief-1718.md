# Relieve por colores de portada — Inhouse Read 1.7.18

Publicado en [Inhouse Read](https://miguelcoxcaballero.github.io/inhouse-read/). La implementación pertenece a `7be235b78ac769426b44c03abe65dbcf119ad6ca`; la verificación integrada final pertenece a `8936abedd970ac50b65925c2d51e699aabcb80a4`, que sólo añade cinco líneas de espera a un observador E2E.

## Qué cambia

- El editor escanea la portada y propone hasta **tres colores distintos presentes en la imagen**. Cada opción muestra su color y la proporción aproximada de portada que ocupa.
- Elegir una opción aplica relieve y barniz a las zonas de ese color. El libro se balancea para mostrar el reflejo. La intensidad se guarda junto al color y puede elegirse **Sin relieve**.
- El color elegido se conserva al reabrir y sincronizar el libro. La selección identifica el color y su tolerancia; el orden de las propuestas puede cambiar sin sustituirla.
- Una portada con sólo uno o dos colores suficientemente distintos ofrece esas opciones. El análisis tiene un soporte mínimo del 0,25 % para evitar que un píxel aislado se convierta en propuesta.
- Las selecciones antiguas se conservan; el editor indica que se elija un color para actualizar el relieve.

## Cómo se obtiene el efecto

El análisis usa una imagen de hasta 288 píxeles en su lado mayor, un histograma RGB y distancia perceptual OKLab. El representante de cada zona es un color observado en los píxeles originales. La densidad de su vecindad se calcula agrupando colores próximos, conservando el color más frecuente de la zona. Así los bordes suavizados de las letras no desplazan el centro hacia un color aislado.

Los centros están separados al menos 12 unidades OKLab × 100. Las tolerancias automáticas se limitan a seis unidades y al 45 % de la separación más próxima. Las máscaras quedan separadas. El perfil guardado contiene `{ id, color, tolerance, strength }`.

Los mapas se preparan sobre el mismo encuadre y UV que la tinta visible de la portada. La cobertura del barniz sigue el color; la altura usa un bisel independiente para conservar los reflejos de letras finas. Los mapas de normales y acabado son texturas de datos, con normal plana exacta fuera de la zona. La tinta mantiene sus colores y el acabado general de la portada se conserva fuera de la selección.

El relieve se representa mediante un mapa de altura convertido en normales y barniz dieléctrico del material 3D. La imagen permite elegir zonas por color; no determina el acabado físico del ejemplar impreso. La preparación es local, se divide en tareas cancelables y se almacena en caché por imagen, color y tolerancia. Cambiar la intensidad reutiliza los mapas preparados. La comprobación de cinco poses conserva mallas, llamadas de dibujo, texturas y programas durante la selección.

## Comprobaciones

- **2.191/2.191 unitarias en 128 archivos y 335/335 E2E aprobados** (206 de interfaz y 129 de motores de voz reales) en [Production checks 37118962162](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/37118962162). Los 12 jobs y 11 ZIP originales se contrastaron con el censo de esa fuente: 21 informes JSON y 89 PNG de interfaz, incluidos los 12 de controles. No hubo omisiones, reintentos, flaky ni errores.
- La revisión semántica nueva de voces verifica cuatro ZIP, 193 miembros y 106 WAV. La actualización de portada conserva los motores existentes.
- **18 casos locales**: 14 del editor y cuatro del material 3D. Incluyen 18 portadas, una fotografía CC0 con procedencia documentada, colores monocromos y bicolores, JPEG, bordes suavizados y letras finas.
- Las máscaras de color se contrastan con un cálculo independiente. En las poses medidas, las muestras exteriores comparadas conservan los mismos píxeles; el relieve y el reflejo responden dentro de la selección. El observador usa el mismo raster de entrada que el generador de máscaras y sus propios cálculos de color y geometría.
- **20 casos sobre la web publicada**: los 14 del editor y los seis de proporciones del lector, incluyendo la cita larga real, AMOLED, PDF y EPUB. Cada traza conserva un cuerpo completo de la entrada JavaScript autenticado por tamaño y SHA-256. Las respuestas sin cuerpo registrado se identifican aparte.
- Se revisaron las capturas claras, oscuras, de 320 px y horizontales. Las ejecuciones usan Chromium y WebGL por software; no acreditan FPS, batería ni temperatura de un teléfono físico.

La tanda local de unitarias corresponde al árbol congelado antes de crear el commit de implementación. Su observación posterior conserva `sourceCommit: null`, fuente base `c64fc8750f4d4ac2de83915f069d5b4c1df34d25` y 379 archivos normalizados idénticos a `7be235b`. El informe local y el de CI mantienen sus fechas, rutas y SHA distintos. CI ejecuta directamente la fuente de verificación final.

## Fallo de observación conservado

El run `37118028975` se rechazó por un resultado flaky de la prueba de PDF compacto. La traza muestra que `setInputFiles` forzaba el segundo archivo 60,576 ms después de pulsar volver, cuando `body` aún estaba en `is-closing-reader`. Esa fase desactiva las acciones visibles del usuario. La importación se cruzaba con el cierre del documento anterior y la consulta de texto no encontró la página durante sus ocho segundos.

El observador ahora espera el fin de la devolución, la desaparición del vuelo y la biblioteca visible antes de importar. Conserva los ocho segundos para el texto completo, el límite total de 90 segundos, el documento, la selección de cita y todas las aserciones de proporciones. Los seis casos completos pasaron sobre la publicación original en 54,819 s. La ejecución general anterior y sus intentos se conservan separados de la nueva batería. Al subir la corrección, la concurrencia del workflow canceló los dos shards todavía activos, UI1 y UI6. Se conservaron sus 11 ZIP disponibles, incluidos los informes incompletos de la cancelación; esa tanda no se presenta como batería aprobada.

Durante el desarrollo también se conservaron las pruebas fallidas que detectaron colores de borde poco representativos y barniz insuficiente sobre letras finas. Se corrigieron los representantes y la cobertura independiente del barniz. Los primeros observadores de imagen y certificación se conservaron al corregir la decodificación del raster y la identificación de JavaScript; sus reparaciones no cambian resultados ni artefactos de la app.

## Artefactos y evidencia

Publicación observada originalmente: Pages `cccc7045d1016de98796a8e8e53ce674b7d20a62`, entrada `assets/main-Bttpz-IX.js`, **1.382.199 bytes**, SHA-256 `1b2b76380aa6aa76821283015198d6b012c0852627930c753606eeb6cb051095`. Los 20 módulos y estilos y los 40 archivos del shell offline coinciden por HTTP con Pages. La publicación posterior de `8936abedd970ac50b65925c2d51e699aabcb80a4`, Pages `d85b2321d18408dc887abdda08a6be8baf5e314f`, conserva los 85 archivos de Pages idénticos por ruta, modo y objeto Git, y las tablas HTTP completas de módulos y shell. Certificado: `.animation.local/ci-37118962162/public-equivalence-7be-8936.json`, SHA-256 `157a012bbcd5bb3d8d86750d81d73c959a5f3b85e2cf6b8ae61ab839f30db97c`. Los casos públicos mantienen su fuente y fechas originales; esta equivalencia no los renombra como ejecución posterior.

| Evidencia original local | SHA-256 |
| --- | --- |
| `.animation.local/cover-color-1718/unit-final2-results.json` — unitarias locales | `b3161748c3e0f67efff45d5a01e7f6794831887cc7a556df4fa6f0f74be69151` |
| `.animation.local/ci-37118962162/downloaded/unit-results/results.json` — unitarias de CI | `b522ab94c24fc942de8dcd042c377f8bef0333e87c3f14730580b9efbe616212` |
| `.animation.local/colour-relief-material-gloss/certification.json` — cuatro casos 3D | `9db08dc0c3e0baf4fd97e58692ec030f4632232fdf925a12cc2f994569504d96` |
| `.animation.local/cover-color-1718/editor/certification.json` — editor local | `a09f119a6770b4397927e0ea711739b22af38c2a7a6631470c1df04ce49d9c58` |
| `.animation.local/final-live-evidence/cover1718/certification.json` — editor publicado | `dd199912974fdd6e4b3db71fd2a4f802da88c11e28b00b864d1ba369d7b21843` |
| `.animation.local/final-live-evidence/reader-layout1718/certification.json` — lector publicado, observador antes de commit | `4b4b30526e1e98faf33554e7371767fad0307a81d74bb2834e287c16c977f9c2` |
| `.animation.local/final-live-evidence/artifact-1718-7be235b.json` — HTTP original | `a71b74e36db2b72ef1dce84f9d95c7d46427c123612581ed44886c1b884074a1` |
| `.animation.local/ci-37118962162/aggregate.json` — batería final | `f58abd154ad0c094837d821b8bd6e137d998eba28d77b5750896828a47f4790a` |
| `.animation.local/ci-37118962162/neural-semantic-review.json` — voces finales | `5e4b4d70a1384a8c5d704870f73a2cd9973b3f7b5d5550ca2ab0307d19f5a954` |

La APK pública mantiene **1.1.3, versionCode 16**, 3.174.689 bytes, SHA-256 `67a52bdebff36c889c81061c488d002f4ac881404e9d1a5f6ad49e909ce267f7`. La descarga nueva conserva la firma V2 y el loader de **2.089 bytes**, sin una copia empaquetada de la app. El wrapper abre esta web actualizada. No se generó otra APK ni se realizó otra prueba de un teléfono físico para este cambio de portada.

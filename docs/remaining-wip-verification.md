# WIP restante — puntos 3, 4 y 5

Estado: 3 de octubre de 2026. Los puntos 4 y 5 están publicados en la web 1.7.7. La primera ejecución completa de Production checks detectó regresiones de EPUB, interacciones de estantería y pruebas con contratos anteriores; se corrigen en 1.7.8. El check completo sigue pendiente de repetirse sobre esa versión.

## Punto 3 — Verificación general y CI

Implementado:

- El helper de `android-refresh-rate.test.js` normaliza CRLF antes de comprobar ambas plantillas Android y la versión nativa.
- `pretest:e2e` ejecuta `npm run build`, incluida la restauración del chunk PDF compatible que también usa la publicación.
- Playwright usa un servidor nuevo en el puerto 4283, configurable con `PLAYWRIGHT_PORT`, y no reutiliza previews anteriores. La ejecución local por defecto conserva todos los specs.
- Production checks separa unitarias, seis shards de interfaz con un worker por runner y tres jobs de motores reales: `engine`, `reading` y `languages`. Los artefactos se guardan incluso si falla una tanda; el check final exige el éxito de todos los jobs.
- `scripts/prepare-neural-fixtures.mjs` prepara por defecto los 33 modelos del catálogo y el auxiliar hebreo. También admite `--voices` y `--output`. Verifica los ficheros y usa revisiones fijadas para las fuentes de prueba; el job de idiomas falla si faltan sus pesos requeridos. El job de lectura activa también la prueba de liberación por inactividad.
- `scripts/check-neural-results.mjs` comprueba el reporte JSON después de cada job real, incluso si el runner falla. Exige cero pruebas omitidas, cero resultados inesperados y al menos 9 casos correctos en `engine`, 10 en `reading` y una prueba por opción del catálogo más la comprobación de diccionarios en `languages` (37 ahora). También rechaza un reporte ausente, vacío o inválido y escribe los contadores en JSON.

Evidencia confirmada:

| Tanda | Resultado | Alcance |
| --- | --- | --- |
| Comprobaciones de refresco Android tras normalizar CRLF | 9/9 | Unitarias, Windows |
| Tanda unitaria de Production checks 37069236676 | 1618/1618 | Código publicado 1.7.7; 95 archivos |
| Tanda unitaria final local de 1.7.8 | 1630/1630 | 97 archivos; dos workers, 176,77 s |
| Guard de resultados neuronales | 19/19 | Reportes correctos y rechazo de ausencia, vacío, omisiones, fallos y tandas cortas |
| Importación Android y continuidad de animaciones | 8/8, 3,5 min | Cuatro casos de importación y cuatro de continuidad; build `main-DsZr-Lsq.js`, preview exclusivo 4193 |
| Los mismos casos con SwiftShader explícito | 8/8, 4,2 min | Renderizado por software, trazas completas, cero omisiones y cero reintentos |
| Preparación de fixtures | 33 modelos y Nakdimon verificados | Descarga e integridad de ficheros; no acredita por sí sola la síntesis de cada voz |
| Motores reales en Production checks 37069236676 | 9/9 engine, 37/37 languages | Cero omisiones, fallos o reintentos |
| Lectura real en el mismo CI | 10 casos ejecutados, uno necesitó reintento | El criterio antiguo de RSS global se sustituye por cierre real del worker, liberación de sus recursos y creación de otro desde caché |
| Regresión local de inactividad corregida y controles | 5/5 | Audio real, worker cerrado, recursos liberados y nueva lectura sin descargar modelo/configuración; tres diseños del lector |

Las pruebas Android comprueban el puente con un doble de navegador, los bytes guardados y la apertura del PDF; no son una prueba en un teléfono físico. En SwiftShader, el retorno del primer libro importado tardó 15,3 s frente a un plazo de 20 s. No se reprodujo un fallo funcional y no se cambiaron estas pruebas ni el código de importación/animación.

Evidencia local: `.animation.local/android-continuity-before.log`, `.animation.local/android-continuity-before.json`, `.animation.local/android-continuity-swiftshader.log` y `.animation.local/android-continuity-swiftshader-results/*/trace.zip`. Los runs 37063937083 y 37065656932 se cancelaron antes de guardar el reporte final; no prueban que la batería completa haya terminado.

Pendiente: terminar la batería integrada sobre los últimos cambios de diccionarios y voces, incluidas las nuevas unitarias del guard, y confirmar todos los jobs de Production checks. El guard evita que una tanda real vacía, incompleta o con omisiones deje el job aprobado.

La verificación anterior del cambio natural/sistema está en [voice-switch-verification.md](voice-switch-verification.md). La corrección del arranque neerlandés y la comprobación publicada se documentan en [natural-voice-startup-fix.md](natural-voice-startup-fix.md).

## Punto 4 — Cinco velocidades accesibles

Implementados los pasos 0,75×, 1×, 1,25×, 1,5× y 2× mediante radios nativos. La selección conserva navegación por flechas y Tab, foco visible y persistencia. Se corrigen los desbordamientos del temporizador y del transporte de audio a 320 px.

Evidencia confirmada: 48 unitarias de `reader-experience`; una tanda de interfaz terminó con 34/35 y detectó el desbordamiento móvil. Después de corregirlo, el caso dirigido «velocidad: cinco pasos accesibles por teclado, caben en móvil y conservan la elección» pasó 1/1 en 14,8 s, incluido foco, teclado, ancho de 320 px y recarga. No se ha repetido todavía la tanda completa de 35 casos sobre esas últimas correcciones.

Pendiente: confirmar la tanda integrada completa y la lectura con el motor real después de los últimos cambios.

## Punto 5 — Idiomas y voces faltantes

El catálogo contiene **36 opciones de voz, 33 modelos y 27 idiomas base**. Sharvard comparte un modelo entre dos hablantes y Ukrainian TTS entre tres. Se incorporan portugués de Portugal, búlgaro, serbio, hindi y hebreo; turco utiliza el modelo existente `tr_TR-dfki-medium`.

Marko usa el modelo serbio del autor con revisión fijada; el modelo de nombre parecido del catálogo general es sorabo. Saspeech requiere el auxiliar Nakdimon para restituir niqqud y convertir el texto hebreo en los fonemas que espera Piper. El auxiliar se descarga junto a la voz y se verifica por tamaño y SHA-256.

Hay 19 copias de diccionarios en `phon/dict/`. El fonemizador reutiliza los que ya están en el paquete; los necesarios fuera del paquete se descargan y verifican al instalar la voz, y se conservan en Cache Storage para un worker nuevo y lectura sin conexión. La implementación y procedencia están en [el README del fonemizador](../public/neural-voice/phon/README.md).

El harness de idiomas tiene 36 casos de voces que cubren todos los modelos y hablantes del catálogo, más una comprobación de diccionarios: 37 pruebas en total. Los 37 pasan con audio real tanto en Windows como en el CI Linux de la versión 1.7.7. Búlgaro y hebreo comprueban además una recarga fría antes de sintetizar, con la descarga de modelos y diccionarios bloqueada. Esto acredita la caché de voz, no el arranque completo de una APK sin conexión.

La web publicada también pasó una lectura automática en neerlandés con Pim y una segunda lectura desde caché tras recargar, con descargas bloqueadas. La comprobación del archivo APK real mantiene el loader de 2089 bytes, idéntico al del repositorio, y versión Android 1.1.2. Las correcciones web llegan a esa APK sin incorporar pesos de voz al instalador.

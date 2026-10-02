# WIP restante — puntos 3, 4 y 5

Estado: 3 de octubre de 2026. Los puntos 4 y 5 están publicados desde la web 1.7.7. Las correcciones de EPUB, preparación de páginas y portadas se publicaron en 1.7.8. La comprobación integrada de esa versión confirmó las 56 pruebas de voces y detectó plazos insuficientes para las poses intermedias del renderizado por software. La candidata 1.7.9 corrige además una compilación real durante el primer arrastre, conserva sólo voces naturales, espera audio completo en dispositivos lentos y sincroniza los cortes de página. Añade la política de pantalla con APK 1.1.3; su check integrado completo y la verificación del nuevo APK siguen pendientes.

## Punto 3 — Verificación general y CI

Implementado:

- El helper de `android-refresh-rate.test.js` normaliza CRLF antes de comprobar ambas plantillas Android y la versión nativa.
- `pretest:e2e` ejecuta `npm run build`, incluida la restauración del chunk PDF compatible que también usa la publicación.
- Playwright usa un servidor nuevo en el puerto 4283, configurable con `PLAYWRIGHT_PORT`, y no reutiliza previews anteriores. La ejecución local por defecto conserva todos los specs.
- Production checks separa unitarias, seis shards de interfaz con un worker por runner y tres jobs de motores reales: `engine`, `reading` y `languages`. Los artefactos se guardan incluso si falla una tanda; el check final exige el éxito de todos los jobs.
- `scripts/prepare-neural-fixtures.mjs` prepara por defecto los 33 modelos del catálogo y el auxiliar hebreo. También admite `--voices` y `--output`. Verifica los ficheros y usa revisiones fijadas para las fuentes de prueba; el job de idiomas falla si faltan sus pesos requeridos. El job de lectura activa también la prueba de liberación por inactividad.
- `scripts/check-neural-results.mjs` comprueba el reporte JSON después de cada job real, incluso si el runner falla. Exige cero pruebas omitidas, cero resultados inesperados y al menos 9 casos correctos en `engine`, 12 en `reading` y una prueba por opción del catálogo más la comprobación de diccionarios en `languages` (37 ahora). También rechaza un reporte ausente, vacío o inválido y escribe los contadores en JSON.
- Cada shard de interfaz y cada tanda real de voces guarda además el manifiesto `--list` del mismo código. `scripts/check-ui-results.mjs` exige que todos esos casos aparezcan y pasen sin omisiones, duplicados, retries, resultados flaky ni anotaciones de fotogramas no observados. El censo de la candidata es de 187 casos de interfaz y 58 de voces reales.

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
| Catálogo y retirada estricta de 1.7.9 | 9/9, 4,0 min | Ocho casos del catálogo y primer arrastre/retirada con cero enlaces nuevos; sin reintentos ni omisiones, bytes del preview iguales a dist |
| Biblioteca de cuatro muebles y reapertura | 2/2 dirigidas | 21 libros, dos retiradas y recarga; reapertura completa con sus límites locales intactos |
| Voces reales de Production checks 37073632148 | **56/56: engine 9/9, reading 10/10, languages 37/37** | Commit `e310cb75fe2b7cd8e295c1049cf5fba085f96268`, web 1.7.8; cero omisiones, fallos y reintentos en los tres jobs |
| Pim en la web publicada 1.7.8 | 1/1, dos arranques reales, 33,57 s | Selección automática neerlandesa a 1,25×; descarga real y recarga desde Cache Storage; cero recurso a voz del sistema |

Las pruebas Android comprueban el puente con un doble de navegador, los bytes guardados y la apertura del PDF; no son una prueba en un teléfono físico. En SwiftShader, el retorno del primer libro importado tardó 15,3 s frente a un plazo de 20 s. No se reprodujo un fallo funcional y no se cambiaron estas pruebas ni el código de importación/animación.

Evidencia local: `.animation.local/android-continuity-before.log`, `.animation.local/android-continuity-before.json`, `.animation.local/android-continuity-swiftshader.log` y `.animation.local/android-continuity-swiftshader-results/*/trace.zip`. Los runs 37063937083 y 37065656932 se cancelaron antes de guardar el reporte final; no prueban que la batería completa haya terminado.

Pendiente: terminar la batería integrada sobre los últimos cambios de diccionarios y voces, incluidas las nuevas unitarias del guard, y confirmar todos los jobs de Production checks. El guard evita que una tanda real vacía, incompleta o con omisiones deje el job aprobado.

La verificación histórica del cambio natural/sistema está en [voice-switch-verification.md](voice-switch-verification.md). Desde la candidata 1.7.9 sólo se ofrecen y reproducen voces naturales; las pruebas anteriores de cambio de transporte se conservan como cambios entre dos naturales y cancelación de los eventos de la anterior. La corrección del arranque neerlandés y la comprobación publicada se documentan en [natural-voice-startup-fix.md](natural-voice-startup-fix.md).

## Punto 4 — Cinco velocidades accesibles

Implementados los pasos 0,75×, 1×, 1,25×, 1,5× y 2× mediante radios nativos. La selección conserva navegación por flechas y Tab, foco visible y persistencia. Se corrigen los desbordamientos del temporizador y del transporte de audio a 320 px.

Evidencia confirmada: 48 unitarias de `reader-experience`; una tanda de interfaz terminó con 34/35 y detectó el desbordamiento móvil. Después de corregirlo, el caso dirigido «velocidad: cinco pasos accesibles por teclado, caben en móvil y conservan la elección» pasó 1/1 en 14,8 s, incluido foco, teclado, ancho de 320 px y recarga. No se ha repetido todavía la tanda completa de 35 casos sobre esas últimas correcciones.

La lectura con el motor real está confirmada en los diez casos de Production checks 37073632148. Pendiente: confirmar la tanda integrada completa de interfaz sobre la última candidata.

## Punto 5 — Idiomas y voces faltantes

El catálogo contiene **36 opciones de voz, 33 modelos y 27 idiomas base**. Sharvard comparte un modelo entre dos hablantes y Ukrainian TTS entre tres. Se incorporan portugués de Portugal, búlgaro, serbio, hindi y hebreo; turco utiliza el modelo existente `tr_TR-dfki-medium`.

Marko usa el modelo serbio del autor con revisión fijada; el modelo de nombre parecido del catálogo general es sorabo. Saspeech requiere el auxiliar Nakdimon para restituir niqqud y convertir el texto hebreo en los fonemas que espera Piper. El auxiliar se descarga junto a la voz y se verifica por tamaño y SHA-256.

Hay 19 copias de diccionarios en `phon/dict/`. El fonemizador reutiliza los que ya están en el paquete; los necesarios fuera del paquete se descargan y verifican al instalar la voz, y se conservan en Cache Storage para la síntesis de un worker nuevo sin volver a pedirlos a la red. La implementación y procedencia están en [el README del fonemizador](../public/neural-voice/phon/README.md).

El harness de idiomas tiene 36 casos de voces que cubren todos los modelos y hablantes del catálogo, más una comprobación de diccionarios: 37 pruebas en total. Los 37 pasan con audio real tanto en Windows como en el CI Linux de la versión 1.7.7. Búlgaro y hebreo comprueban además una recarga fría antes de sintetizar, con la descarga de modelos y diccionarios bloqueada. Esto acredita la caché de voz, no el arranque completo de una APK sin conexión.

La web publicada **1.7.8** también pasó una lectura automática en neerlandés con Pim a 1,25× y un segundo arranque desde Cache Storage tras recargar. La prueba bloquea el diccionario neerlandés separado, que no se pide porque está en el paquete; no bloquea todo el runtime de la aplicación. La comprobación del archivo APK real mantiene el loader de 2089 bytes, idéntico al del repositorio, y versión Android 1.1.2, código 15. Las correcciones web llegan a esa APK sin incorporar pesos de voz al instalador.

### Medidas finales de voces en 1.7.8

Los artefactos de los tres jobs de voces del run **37073632148** se descargaron y sus JSON se validaron de nuevo con `scripts/check-neural-results.mjs`. Las 36 opciones del catálogo produjeron PCM finito y audible (RMS mínimo 0,101); la prueba adicional verifica el paquete de diccionarios. Búlgaro y hebreo arrancaron con un worker frío tras recargar, bloqueando Hugging Face y los diccionarios separados. La aplicación y sus assets seguían servidos: esta evidencia cubre los recursos de voz instalados y el auxiliar hebreo, no el arranque completo sin conexión ni un teléfono Android físico.

El motor completó seis fragmentos, 36,8 s de audio, con cero underruns y cero huecos superiores a 150 ms. En el lector, la muestra EPUB registró un underrun y una pausa máxima de 831 ms; PDF registró cero underruns y una pausa máxima de 354 ms. Ambas cumplen los límites de sus pruebas. La liberación por inactividad cerró el worker, dejó a cero llamadas, trabajos y preparaciones pendientes, liberó 269 MiB y creó otro worker desde caché sin pedir de nuevo el modelo o su configuración.

La latencia medida varía entre voces y escenarios: Pim inició en 3096 ms y Saspeech en 2303 ms en el harness de CI; Daniela high y Cori high necesitaron 8975 y 8475 ms y tuvieron RTF 2,00 y 2,12. En Pim LIVE, del pedido al primer audio programado fueron aproximadamente 3387 ms tras la instalación y 2917 ms tras la recarga. Estas muestras no prometen una latencia universal inferior a cinco segundos ni continuidad perfecta entre páginas.

Evidencia: `.animation.local/ci-37073632148/neural-{engine,reading,languages}/`, con `job.log`, `playwright-report/results.json` y los ficheros de medidas y WAV; `.animation.local/final-live-evidence/pim-178/`, con `results.json`, `numbers.json` y dos capturas, y `.animation.local/final-live-pim-178.log`. Los tres jobs neuronales están confirmados; los jobs de interfaz y papelera y la conclusión completa del punto 3 siguen pendientes.

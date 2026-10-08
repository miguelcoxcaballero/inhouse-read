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
  dentro de `[56,388,76,656]`, en el área del lomo, sobre una imagen
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
de interfaz; enumerarlos no equivale a ejecutarlos. La ejecución completa
de CI110 se recoge y audita por separado a continuación.

No se considera todo el rendimiento resuelto ni se añaden voces nuevas.

Evidencia: `.animation.local/performance-1811/`, incluidos los originales
fallidos, ambas comparaciones, los dos probes y la restauración de finales
de línea. El experimento distinto de uniforms previo al primer dibujo,
descartado por empeorar tiempos, permanece en `performance-1810/`.

## Publicación y comprobación real

Web **1.7.110 publicada**, fuente
`c349ed715258032739dc4cf68c65decb2eedf61c`, Pages
`d2d7d61ed854ab0f71b8ac8bef53c551ec60f684`.
`main-CqXhaZGa.js`: 613.860 bytes, SHA-256
`9ffb2568ff4fd7aefb2fdc14e1cb30148efff401cfcdcb5a48f78524c11ff06b`.
Los 32 recursos del grafo, 96 entradas offline y ocho chunks PDF antiguos
coinciden por HTTP con los blobs de Pages. El primer intento conserva un
503 de Montserrat Cyrillic-ext. Una comprobación posterior obtiene 200 y
el hash exacto; la segunda cualificación completa pasa, sin borrar el 503.

Web real: **31/32 comprobaciones estrictas PASS**. El regreso de 390px
conserva FAIL en su auditoría de transporte: `response.body()` y la traza
guardan 16.375 de los 151.604 bytes de walnut-surface. Son el prefijo exacto
del archivo completo. La cabecera anuncia 151.604 bytes y la traza registra
transferencia completa; no acredita qué recibió el consumidor en ese caso.
Sus aserciones funcionales llegaron hasta el final y el attachment registra
4.713 ms de cierre, pero la prueba completa permanece FAIL.
Un diagnóstico nuevo con tres contextos recibe los Blobs reales completos
con hashes correctos. Instrumenta el consumidor y añade el tiempo de hash;
no reproduce, explica ni reemplaza el fallo original.

Los demás casos públicos pasan: 18 PDF, cinco catálogo, cuatro puente Android
y cuatro recorridos offline. Estos últimos comprueban bytes/progreso local,
fotografías RGB en los temas probados, portada JPEG y cierre inmediato.

CI110: **531/533 casos PASS**, 3.629 unitarias/293 archivos PASS.
Los dos regresos nativos agotan el presupuesto global de 30 s tanto en el
primer intento como en el retry: 535 intentos y cuatro timeouts conservados.
Las trazas llegan a Back entre los segundos 25,18 y 27,73; el tiempo ya se
acumuló en arranque, selección y apertura. No prueban por sí solas un cierre
de más de ocho segundos, pues el plazo global interrumpe antes su observación.
Los once ZIP originales coinciden con los digests autenticados de GitHub;
el censo completo contiene 533 identidades únicas. Las cuatro familias de
voces con pesos reales pasan. El catálogo sigue con 39 Piper y diez personas
Supertonic en 22 idiomas: 220 perfiles, no 220 personas distintas.

APK público **1.1.8/code21**: descarga, SHA, firma, manifest y loader de
2.107 bytes PASS. La versión nativa no cambia por esta mejora web. El ensayo
nuevo 37847023591 usa ese APK público y pasa los cinco estados nativos:
estantería, lector, segundo plano, regreso al lector y estantería. Los dumps,
XML y PNG originales quedan recogidos con digest verificado; un análisis
independiente vuelve a comprobar flags, foco, barra e insets. Google muestra
su formulario sin error de solicitud; no acredita una cuenta humana conectada.
No se midieron FPS, calor, batería ni audio prolongado en un teléfono físico.

Evidencia adicional: `public-c349ed7-attempt1/`, `ci-original-attempt1/`,
`native-public-attempt1/`, `ci-native-timelines.json` y
`texture-blob-diagnostic-attempt1/`, dentro de `performance-1811/`.
APK: `performance-1796/apk-1.1.8-web17110-attempt1/`.

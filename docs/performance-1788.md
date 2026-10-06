# Guardado de progreso — 1.7.88 publicada

La cola anterior añadía una escritura de IndexedDB por cada aviso de posición.
Ahora sólo reemplaza la última posición pendiente de cada libro. La escritura
que ya empezó termina, los ajustes y el historial son barreras de orden, y los
consumidores de cierre/apertura esperan la última posición comprometida. No
hay un timer ni espera añadida; arranca en el microtask del aviso. Los errores
se comunican y la siguiente posición sigue intentándose. Drive sólo se programa
tras el commit local, como antes. Durante el cierre la posición final se toma
de la instantánea y no se encolan avisos intermedios del lector.

Siete nuevas y43 relacionadas PASS. Una escritura para100 posiciones del
mismo task, dos para una activa y100 pendientes. El store real de pruebas
conserva bytes, portada, progreso, textoOffset, ajustes e historial. No se
presupone que IndexedDB copiara todos los bytes del Blob en cada escritura:
la mejora demostrada es la reducción de commits pendientes, no una medición
de FPS, GPU, batería o teléfono. Batería completa y publicación pendientes.
Evidencia: `.animation.local/performance-1788/`.

Batería final3455 unitarias/277 archivos, build y75 Python PASS. Fuente657
sin cambios;524 sólo listados, ninguna E2E ejecutada en ese censo. Los
recorridos gráficos y la comprobación en IndexedDB real todavía pendientes.
Evidencia: full-local-resource2-attempt1/.

IndexedDB nativo de Chromium PASS en dos archivos reales1/16MB: dos commits
para una escritura activa y1000 avisos pendientes; bytes y portada coinciden
por SHA256, ajustes/historial y locator final conservados. Sin mocks de IDB.
Los14 recorridos normales locales PASS, cero retries, fuente657 estable.
Dos casos originales adicionales de SwiftShader PASS28576/27210ms totales,
con30/8s intactos; la reanudación EPUB original también PASS en su primera
ejecución. No son comparaciones causales ni acreditación de FPS en móvil.
Evidencia: progress-native-idb-attempt1/, local-browser-attempt1/,
catalog-browser-attempt1/, return-regressions-attempt1/,
swiftshader-original-attempt1/ y progress-follow-attempt1/.
Publicación, comprobación pública y nueva CI completa todavía pendientes.

Publicación fuente1630f0d4e5974a8bd66ab403e70e69b881767d76; deploy37429678043
PASS. Pagesae1d7af7535f2c4e0112673f00ccf226f4910345. Main real
assets/main-rj4UD3U8.js,593683bytes,SHA256
28657a459253aea4efd7cfbac56d08b0f1ba5fd347b581e59b486ed576d8e05f.
Pin en primer intento, HTTP32/offline96 y descarga nuevaAPK78.515.243bytes
PASS. Loader2089bytes exactos a fuente, sólo tres archivos enassets/public.
Certificado HTTPa2220f25256f0b0aeadb4880d740a2320eea2f66ef2c313bca304d06a834ce49.
Recorridos públicos, offline práctico y CI37429678089 todavía en marcha.
Evidencia: public-1630f0d-attempt1/.

Resultado público original: principales2/3 yPDF17/18 pasan la auditoría;
los cuerpos funcionales de los21 casos pasan. Dos finales de fixture
rechazan una textura209252bytes observada como0 y otra151604bytes en el
mismo caso nativo; la descarga HTTP independiente coincide. No hay errores
de request registrados en esas observaciones, así que no se atribuye a abort
ni se modifica la clasificación del fallo. Catálogo5 PASS:24/26 originales
públicos aprobados,2 fallidos conservados,0 retries. Papel normal/settled en
cinco temas y portadaJPEG800x1600/150310bytes offline PASS,0 fallback.
PDF real26432bytes desde SW, SHA256
37b338052f54316017b5ba9b960330ffbd2f88e8a08644507126b118816e4dd1.
No se declara toda la lentitud resuelta. CI completa sigue en marcha.

La app pública también pasa el recorrido offline completo: importar el PDF
con la red desconectada, usar la vista adaptable, avanzar a textOffset115,
cerrar, recargar y reabrir. El locator exacto y los3143bytes originales se
conservan por SHA256; dos imágenes mantienen RGBA230/35/50/255. Sin cuenta
ni subida forzada a Drive. Es un diagnóstico adicional de UI, no otra
identidad de la batería524 ni una medición de FPS o del teléfono.
Evidencia: public-1630f0d-attempt1/app-offline-progress-attempt1/.
Verificación adicional del APK real en emulador: run37432501323 en marcha,
APK1.1.4 y fixture autenticado del build37167745832. No acredita un login
con sesión de Google ni un móvil físico.

CI37429678089 completa FAILED:11 ZIP y12 logs autenticados;524 identidades
únicas,527 intentos,3 retries y6 intentos fallidos. UI3 falla los dos
recorridos nativos en ambos intentos al consumir el total30s durante cierre;
UI6 falla la iluminación cálida de walnut/BAGGEBO en ambos intentos. Cuatro
tandas de voces reales y las otras cuatro UI PASS. Issues del recolector[];
los fallos originales no se reemplazan por los ensayos locales.
Evidencia: ci-original-37429678089-attempt1/snapshot-003/.
Verificación APK37432501323 completada PASS; todavía se deben recoger y
comprobar los bytes de sus artefactos originales antes de acreditar estados.

Los originales autenticados del run Android37432501323 pasan cinco estados:
estantería, lector, segundo plano, regreso al lector y cierre. KEEP_SCREEN_ON
y barra oculta activos sólo al leer; se liberan al salir o perder foco y se
reaplican al volver. APK78515243bytes/hashfeafaaa… coincide con el artefacto
local publicado. Inspeccionada PNG del PDF real sin hora ni iconos; Google
muestra la página de acceso sin redirect_uri_mismatch. No se acredita una
sesión autenticada, FPS de teléfono ni URL exacta del bundle en emulador.
La descarga del log inicialmente fue rechazada por escapes ANSI del CLI; se
conserva el error y se obtiene el mismo log sin repetir el ensayo.
Evidencia: android-public-37432501323-attempt1/summary.json.

# Guardado de progreso — 1.7.88 en preparación

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
Dos casos originales adicionales de SwiftShader PASS28560/27150ms totales,
con30/8s intactos; la reanudación EPUB original también PASS en su primera
ejecución. No son comparaciones causales ni acreditación de FPS en móvil.
Evidencia: progress-native-idb-attempt1/, local-browser-attempt1/,
catalog-browser-attempt1/, return-regressions-attempt1/,
swiftshader-original-attempt1/ y progress-follow-attempt1/.
Publicación, comprobación pública y nueva CI completa todavía pendientes.

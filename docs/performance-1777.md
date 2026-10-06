# Catálogo oculto sin trabajo GPU — 1.7.77

La estantería prepara la descarga del catálogo en su turno idle, pero ya no
construye su estudio 3D oculto. Crear ese estudio producía otro contexto,
su entorno PMREM y shaders aunque el usuario no hubiera abierto el catálogo.
Ese trabajo podía coincidir con un resize o con el primer dibujo de luces.

El primer estudio se crea al abrir el catálogo, después del vuelo de cámara
que ya existe. Las visitas siguientes reutilizan el estudio. No se cambian
modelos, resolución, iluminación, acabados ni relojes de las animaciones.

Las dos regresiones nuevas fallan con el código anterior: tanto al entrar
directamente en isométrica como al cambiar desde lomos se invoca la
preparación del estudio oculto. Con el cambio pasan; el botón sigue abriendo
el catálogo. Pasan 47 pruebas enfocadas en cinco archivos, incluidas las
originales de previews, catálogo y persistencia de plantas.

Pasan 3.384 unitarias en 265 archivos, build y 75 comprobaciones Python.
El censo contiene 524 casos E2E, todavía sin ejecución en esa tanda CPU.
Pasan los siete recorridos gráficos de continuidad/editor/retorno y cinco
originales de catálogo/plantas/luces, todos al primer intento sin retries.
Los cierres nativos locales tardan 4.986,3 y 4.926,7 ms; son observaciones de
esta ejecución, no un benchmark de teléfono. Monstera conserva cero enlaces
nuevos de shaders tras resize en nogal y BAGGEBO (20/19 programas, un draw).
La apertura a 320 px, persistencia de acabados y luces originales pasan.
Publicación y CI global pendientes. Esto no
acredita por sí solo la resolución de todos los fallos intermitentes de CI.
Evidencia: `.animation.local/performance-1777/`.

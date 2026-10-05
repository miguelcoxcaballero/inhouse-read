# Rendimiento de Inhouse Read 1.7.66

## Cambios

- Un toque breve conserva el estado táctil del libro, pero evita iniciar el
  pequeño levantamiento que obligaba a repintar toda la estantería antes de
  extraerlo. Mantener pulsado conserva la elevación 3D y el arrastre a los
  440 ms originales. Se limpian ambos estados al cancelar, soltar o iniciar
  otro gesto.
- El HTML empieza a cargar las dos texturas de madera existentes antes de
  descargar y analizar el código principal. Las solicitudes conservan el
  mismo modo CORS que Three.js y reutilizan los mismos archivos del build.

Los modelos, luces, materiales, resolución, DPR, duraciones de animación y
pruebas originales permanecen sin cambios. Estos cambios no eliminan todas
las copias entre WebGL y Canvas2D en dispositivos con dimensiones fraccionarias.

## Comprobación

El control con runtime 1.7.65 conserva 103 pruebas originales aprobadas;
los 16 casos nuevos tienen diez aprobados y seis fallos causales. Con el
runtime candidato, las 119 assertions pasan. Su primer comando conserva
un fallo de colección en la nueva prueba de precarga: una URL del entorno
jsdom no era una URL de archivo. Este intento no se cuenta como PASS.

La primera batería completa queda FAILED: 3.190 de 3.191 casos pasan,
el caso original `neural-cached-order` agota sus 5 s y el nuevo archivo de
precarga falla al coleccionar. Build y 75 Python pasan. Se conserva ese
resultado; sólo se corrige la lectura de archivos del nuevo test y se
inicia una batería nueva con las mismas pruebas y plazos originales.
El segundo intento conserva 3.191 aprobados y dos timeouts de 5 s:
`neural-cached-order` y el caso BAGGEBO de `lamp-scene`. La prueba de
precarga ya pasa. Build y 75 Python pasan otra vez.

El diagnóstico separado ejecuta ambos archivos originales: 30/30 PASS.
El matcher de audio compara 640.000 bytes y cuesta 4.837 ms; el caso vecino
envía las mismas dos PCM sin ese matcher y cuesta unos 90 ms. La lectura de
Vitest confirma que su comparación crea 1,28 millones de pares con
`Object.entries`. Se prepara una batería con menor concurrencia conservando
todos los casos, assertions y plazos; los dos intentos fallidos permanecen.
Las comprobaciones de los artefactos publicados están pendientes.
El perfil anterior de software muestra copias de la sala
costosas; no mide los FPS ni la temperatura de un teléfono físico.

Evidencia local: `.animation.local/performance-1766/`.

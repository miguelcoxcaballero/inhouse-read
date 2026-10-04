# Fluidez en 1.7.44

La apertura prepara sus poses y espera la portada sin pintar un canvas que aún
no está conectado. El primer dibujo ocurre en el escenario final, antes de
ocultar el libro de la estantería. La preparación diferida conserva ese
contrato también cuando terminan las actualizaciones de apariencia.

Las letras, portada y marcapáginas del libro oculto se actualizan sin repintar
la habitación vacía. La restauración pinta los materiales actuales. Los
cambios de geometría, posición, reemplazos pendientes, inserción y papelera
conservan sus invalidaciones. No cambian modelos, texturas, DPR ni iluminación.

Las pruebas de relieves observan ambos contextos GPU y leen las métricas del
que realmente dibuja el libro. Conservan cada aserción y presupuesto original;
siguen ejercitando la presentación directa del libro activo. Los dos fallos
originales de CI 37201382206 y sus reintentos se conservan como fallos.

## Medición aislada

En la escena original de seis libros, una planta y una lámpara, Chromium
390 × 844, DPR 2, SwiftShader, el candidato congelado elimina la copia de
1.264,5 ms de la habitación al preparar el cierre. Su cierre completo registra
10.109,8 ms, frente a 12.334,5 ms de la fuente anterior a estas optimizaciones
y 10.691,5 ms de la publicación 1.7.43.

**El candidato continúa por encima del presupuesto original de ocho segundos.**
No se cambia ese reloj ni se atribuyen estas mediciones a un teléfono físico.
El candidato, la fuente publicada y su verificación final tienen resultados
independientes. Los resultados anteriores y sus perfiles permanecen guardados.

La versión conserva además las optimizaciones de [1.7.43](performance-1743.md):
presentación GPU directa, preparación de PDF en lotes, reutilización de sombras
y eliminación de recorridos y repintados redundantes. La presentación directa
mantiene un único contexto adicional para toda la app; su memoria no es neutra.

La batería completa y los artefactos públicos se comprueban antes del informe
final. La APK continúa en 1.1.4, código 17: su loader carga la web publicada.

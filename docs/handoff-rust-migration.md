# Traspaso: migración a Rust de Inhouse Read

Escrito el 16-oct-2026 por la sesión que llevaba la migración, para quien la continúe. Todo lo que sigue
sale de lo comprobado en esa sesión; lo que no se pudo comprobar está dicho.

## Orden vigente de la persona propietaria

- Pasar a Rust todo el JavaScript propio de la aplicación, con EXACTAMENTE la misma interfaz, comportamiento,
  formatos de datos y píxeles asentados. «No pares hasta tenerlo prácticamente todo en Rust.»
- Publicar en `main` cada bloque verificado y decir el porcentaje de Rust cada vez.
- Habla español y es muy exigente: informar con honestidad (qué se comprobó, qué no, qué falla ya en `main`).
- Las librerías de terceros (three.js, pdf.js, foliate-js, onnxruntime) y el pegamento fino con el navegador
  (DOM, WebGL, IndexedDB, `fetch`, workers, temporizadores) se quedan en JS.
- No tocar `android/`, `.github/workflows`, `public/android-update.json`, `updates/`, `vendor/`,
  `inhouse-updater.lock.json`, `UPDATER.md` ni `AGENTS.md` (política del actualizador compartido: léela en `AGENTS.md`).

## Estado

- `main` está en **1.7.254**: **59,52 %** de Rust (31305 líneas de Rust, 21292 de JS).
  Se mide con `git add -A -n . && node scripts/rust-migration-status.mjs`; es un recuento de líneas de
  `rust-core/src`, `rust-ui/src` y `src/js`, no mide funciones terminadas.
- Evolución: 16,38 % (1.7.234) → 39,73 % (1.7.245) → 42,35 % (1.7.246 portadas) → 45,38 % (1.7.247 armario y
  BAGGEBO) → 46,93 % (1.7.248 modelo del libro) → 49,82 % (1.7.249 plantas, lámparas y su luz) → 50,96 % (1.7.250 cámara y posiciones de escena) → 57,95 % (1.7.251 controles de la pantalla de estantería) → 58,68 % (1.7.252 render/refresco/preferencias).
- Lo que corre en Rust ya publicado, por áreas: lectores PDF y EPUB (decisiones, texto, instantáneas,
  controlador), voces y audio, biblioteca y nube (Drive, copia, importación), estantería (disposición, luz,
  oclusión, papelera, zoom, gestos, retorno), armario y BAGGEBO, plantas y lámparas (geometría, texturas, luz),
  libros 3D (cinta, páginas, encuadernación, vista, pose, pintura de bordes y tapa), portadas y relieve.
- Sigue en JS lo grande: `src/js/bookshelf.js` (698 líneas), `bookshelf-scene.js` (3035), `book-model.js`
  (~2000, pegamento de three.js), `app.js` (1411), `shelf-plants.js` (475, ensamblado con objetos three.js),
  y una cola larga: `cover-appearance.js` (577), `library-store.js`, `native-room-cache.js`, los previsualizadores
  de catálogo, `book-length.js`, `content-freshness.js`, `gpu-programs.js`, `shelf-trash.js`,
  `shelf-light-occlusion.js`, `shelf-lighting.js`, `shelf-bake-cache.js`, `readers/neural-voice/*`, etc.
  Hay una lista por tamaño con `git ls-files 'src/js/*.js' | xargs wc -l | sort -rn`.

## Ramas y trabajo pendiente

| Rama | Contenido | Estado |
|---|---|---|
| `origin/wip/scene` (41f8083) | `bookshelf-scene.js`: vista/cámara/impactos y cinemática de las entradas a Rust, con arnés diferencial de escena entera | Integrado y corregido en 1.7.250; queda pegamento Three.js/DOM |
| `origin/wip/shelf-ui` (9e6d785) | Libro extraído, editor, retorno, portadas, objetos, arrastre y papelera | Integrado en 1.7.251; corregidas identidades UTF-16 y ampliada la prueba de memoria |
| `origin/wip/shelf-screen` (4996bc3) | Render, planificación, medidas, refresco, metadatos, preparación de portadas, preferencias y argumentos | Integrado en 1.7.252 tras verificar |
| `gpt/rust-shelf-controls` (local, árbol `/workspace/inhouse-read-shelf-controls`) | Builders de libros/plantas/lámparas y sus entradas, propiedad y limpieza de listeners por nodo | Integrado en 1.7.253: 678 específicas y 35 E2E pasan; detalles y fallo de tiempo reproducido en la base en remaining-wip-verification.md |
| (sin rama) `tail` | cola larga de ficheros pequeños | No llegó a empezar |
| `origin/wip/mittled`, `wip/catalog`, `wip/transition-open`, `wip/transition-close` | Peticiones anteriores de la persona (hitbox de la lámpara MITTLED, animación del catálogo y balance de blancos, transición de apertura/cierre del libro) | La persona las continúa en local con `TESTS-LOCAL.md`; no las toques sin que lo pida |

Las ramas `ready/book-model` y `ready/geometry-3d` y las `wip/*` antiguas ya están publicadas (con correcciones);
`ready/*` no se borra.

## Cómo se verifica y se publica un bloque (lo que se hizo con cada entrega)

1. `git fetch origin`; ramas de trabajo en `origin/wip/<clave>` y entregas en `origin/ready/<clave>`. Los agentes
   NO pueden empujar a `main` (el clasificador lo deniega): publica tú tras verificar.
2. Mezcla `origin/main` en la rama (merge, no rebase). Sube la versión de parche en `package.json` y en los
   DOS campos de versión de `package-lock.json` (`"version"` de la raíz y de `packages[""]`).
   Añade la entrada arriba del todo de `docs/remaining-wip-verification.md` y el primer párrafo de
   `docs/rust-migration.md` (inventario, qué se comprobó, qué no).
3. `npm run build:rust` y `npm run build` (en este equipo Rust 1.99.0; wasm-bindgen 0.2.105).
4. Tests unitarios en 4 bloques: `npx vitest run --shard=N/4 --testTimeout=90000` (N = 1..4). El bloque 2 suele
   registrar «Timeout calling "onTaskUpdate"» del worker bajo carga sin ningún test fallido.
5. E2E de los ficheros tocados, con la configuración local (copia en `tools/visual-harness/playwright.local.config.example.mjs`: cópiala a la raíz como `playwright.local.config.mjs`;
   está en `.git/info/exclude`; usa Chromium de `/opt/pw-browsers` con SwiftShader):
   `flock /tmp/claude-0/visual.lock nice -n -15 npx playwright test -c playwright.local.config.mjs <specs> --workers=2 --reporter=line`.
   Si algo falla con la caja cargada, repítelo a solas (`--workers=1 -g "<título>"`) antes de concluir nada.
6. Comparación visual contra un build de `main` (`tools/visual-harness`, ver `USAGE.txt`): construye `dist` de
   `main` y de la rama (`npm run build:rust && npm run build`, copia `dist` fuera), captura ambos con
   `node visual.mjs capture <dist> <salida> <puerto> --workers 2`, compara con `node visual.mjs compare A B --allow-missing`.
   Incluye una captura de `main` contra sí mismo para medir el ruido. Aviso: 8 de los 34 estados (los de transición)
   expiran por tiempo en este equipo en las dos versiones; repite los que difieran 2 veces por build antes de
   declarar un cambio real (la escena 05 salió distinta una vez por una captura bajo carga).
7. Revisión independiente de solo lectura antes de publicar (tres revisores con lentes distintas: equivalencia
   numérica, orden y resultado, ciclo de vida y cobertura) con una ejecución de `Workflow`; ambas revisiones de
   1.7.247–1.7.249 encontraron fallos reales o huecos de cobertura que se corrigieron.
8. `git push origin HEAD:main`; después copia el mismo estado a la rama de respaldo
   `ccr-8d2fa5b2-728p5v` (en un `git worktree` aparte para no tocar el árbol en uso).
   Ese respaldo tiene dos documentos propios (`HANDOFF-PENDING-WORK.md` y `PROMPT-CHATGPT.md`): se mezcló main
   conservándolos; no hay que forzar su historial para dejarlo idéntico a main.

## Incidencias históricas del traspaso anterior

Estos apuntes proceden del traspaso de 1.7.249. No describen la batería final de esta entrega: las 6374 pruebas
unitarias de 1.7.252 pasan. Los resultados actuales del navegador se documentan en remaining-wip-verification.md.

- Cierre del lector a la estantería con GL por software: `animateMotion` limita el paso a 100 ms por fotograma,
  así que cada fase se alarga 3 a 9 veces; fallan por tiempo los contratos de retorno de la estantería, `smoke`
  «el libro abierto reaparece…», cover-editor «escritorio» (claro y oscuro) y «salir coloca el marcapáginas» (a veces).
- Las pruebas `rust-plant-*` y `rust-book-surfaces` contaban como fuga el arenero fijo de 128 B de
  `decor-catalogue.js`; están ajustadas, pero el resto de `rust-*` con contadores de memoria absolutos pueden ver 128.
- `rust-startup` (4 de 5) y `neural-voice-reading` (2) fallan igual en `main`.
- Sin GPU real no se puede medir velocidad: el arranque depende de la GPU y estos cambios no lo han acelerado.
  No hay prueba en móvil físico de nada de esto.

## Otros

- En esta nube: Chromium está en `/usr/bin/chromium`, las dependencias en `/workspace/inhouse-read/node_modules`
  y Rust en `/home/agent/.cargo/bin`. `NODE_USE_ENV_PROXY=1` permite las descargas de Node tras el proxy.
- No recompilar ni reemplazar bindings/wasm durante Vitest: una ejecución mezclada usa un código de
  funciones/callbacks incompatible y sus resultados no valen. Tampoco compilar ni lanzar la batería unitaria
  mientras corre un trabajo gráfico. Una sola ejecución Chromium/SwiftShader cada vez.

- Android: 1.1.8 (código 21) publicado; la persona debe probar en el móvil que el salto de la barra de estado
  ya no aparece.
- Los agentes de `Workflow` mueren al llegar al límite de uso de sesión (esta sesión vio reposiciones, entre otras,
  a las 00:00 y las 16:10 UTC). `tools/rust-wave/rust-wave5.js` es el guion de la ola 5 (prompts completos de las tres unidades
  `scene`, `shelf-ui` y `tail`); sus rutas del arnés visual apuntan a un directorio temporal que ya no existe:
  cámbialas por `tools/visual-harness`. Relánzalo con `resumeFromRunId` si el entorno aún conserva la carrera.
- Concurrencia útil en este equipo (4 núcleos, ~14 GB libres): dos agentes con construcciones de Rust a la vez;
  más y los E2E se vuelven inservibles (carga 14+).
- Limpieza: `git worktree list` suele traer cinco o más árboles de agentes; bórralos cuando acaben
  (`git worktree remove --force`), y borra los `rust-*/target` que no uses.

## Prioridades actuales de la persona

Corrección rápida del audiolibro: omitir marcas decorativas como § sin cambiar el texto visible ni sus offsets.
Después optimizar el zoom isométrico y el repintado conservando la calidad, publicar en main y seguir la migración.
WIP local sin validar: /workspace/inhouse-read-shelf-lifecycle (inicialización y destrucción; revisar destroy repetido),
/workspace/inhouse-read-book-length (recuento), /workspace/inhouse-read-zoom-render (zoom prioritario).
La entrega 1.7.253 tiene 6378/6379 pruebas completas pasando; el caso restante excede 5 s también en main 1.7.252.

Corrección urgente de símbolos del audiolibro publicada en 1.7.254; se continúa ahora con zoom/repintado.

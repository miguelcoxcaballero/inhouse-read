# Relevo de Inhouse Read — 13 de octubre de 2026

El usuario pidió detener este trabajo y entregarlo a otro agente. No continuar
escribiendo desde la tarea antigua. No se publicaron cambios incompletos de 235.

## Relevo remoto solicitado después

El usuario indicó que el siguiente agente no tiene acceso a este ordenador.
El código pendiente y esta documentación se conservan en la rama
`handoff/rust-1.7.235-20261013`, destinada al relevo, sin desplegar 235 en Pages.
El estado «sin commit ni push» descrito debajo corresponde al momento del
relevo inicial, antes de esta publicación de fuentes.

Descargar esa rama y leer también [el paquete del banco de trabajo](handoff/2026-10-13/README.md).
Su ZIP incluye fuentes de los prototipos, scripts de comprobación y logs
originales de pruebas pendientes/fallidas. Es una copia para trabajar desde
otro equipo: las rutas absolutas de los scripts deben adaptarse y los archivos
generados deben reconstruirse. No ejecutar ni integrar todos los prototipos
por el hecho de estar incluidos. Los descartes y los resultados siguen siendo
los indicados en este informe.

## Estado exacto

- Repositorio: `C:/Users/migue/Documents/InhouseRead-New`.
- Remoto: `miguelcoxcaballero/inhouse-read`, main
  `9c6e4325d1073357bc215ae29d69809836c40b91`, versión **1.7.234** publicada.
- Publicado: **16.38 % Rust**, 7478 líneas Rust / 38189 JS. Inventario de
  fuentes propias, incluye comentarios/fallback; no es porcentaje funcional.
- Local pendiente: **1.7.235**, **16.41 % Rust**, 7497 / 38198, sin commit ni push.
  Hay cambios de código en staging y documentación sin staging. Preservar ambos.
- 235 añade `rust-core/src/cover_seed.rs`, su módulo en `lib.rs`, integración
  opcional de semilla en `relief-palette-wasm.js` y `cover-relief.js`, y pruebas
  `cover-seed-wasm.test.js` / `rust-relief-editor.spec.mjs`. Package/lock ya 235.
- La semilla FNV usa el buffer RGBA existente de la paleta. No añade copia ni
  arena. La opción es solo para el raster privado inmutable; API genérica y
  fallback conservan el cálculo anterior. No cambia colores, propuesta o diseño.
- Build 235, 50 focalizadas y 2 E2E de editor aprobados. Unitarias completas
  **interrumpidas para el relevo**, no aprobadas: log archivado aparte. Faltan
  batería completa, regresiones y toda comprobación de publicación de 235.

## Entrega 234 comprobada

6537 unitarias y tanda de 72 E2E locales sin retries. Cobertura de máscaras
calculada con su clasificación Rust: CPU×4, 10 colores 50.70→40.40 ms,
solo ese trabajo sintético, sin afirmación de velocidad global o teléfono.
Deploy `38427723866` y Pages `38427883697` aprobados; Pages
`322feebc5affc8104115567bb48932d1b38120c5` atribuido al commit de main.
109 recursos reales HTTP/tamaño/SHA, 2 perfiles y memoria de UI, 30 PCM,
2 PDF, 18 escena/editor y 3 perfil públicos aprobados.
APK real descargado/verificado: paquete `com.inhousesoftware.read`, 1.1.15/28,
firma SHA256 `15a1f89c7a6fe7476bee6eaf48cc78239b5a5cb05f98daa4d3c02a6bc73284bd`.
Loader 2107 bytes/3 assets, sin app antigua empaquetada. Android mostró
1.7.234/PID3829, importación content URI y Lessac2× 11.944 s acumulados,
8 done/9 start, sin FATAL ni cambio de proceso. No sustituye un móvil físico.

**CI 234/38427723850 terminó fallida**: UI2/115401419824, ambos cierres
nativos de 8 s fallan original y retry; además captura desktop paper del lector
flaky, foliate-view no aparece en 8 s inicialmente y pasa al retry. Los demás
cinco UI, unitarias y cuatro tandas de pesos reales pasaron; el agregador
115418486958 rechaza correctamente la revisión. Conservar los originales y
no cambiar plazos/retries/aserciones para presentarla como aprobada.
Tres cierres terminaron alrededor de 9.96–9.99 s; otro aún no acababa.
El mismo problema estaba en CI233; local/public pasan pero no prueba universal.

## Evidencia y siguientes pasos

Leer `AGENTS.md`, `UPDATER.md`, `docs/remaining-wip-verification.md` y
`docs/rust-migration.md` antes de actuar; inspeccionar status/fetch sin perder WIP.
Evidencia 234: `D:/CodexEvidence/InhouseRead-20261013/rust-mask-coverage`;
artefacto real `D:/CodexEvidence/InhouseRead-20261013/published-1791907805581`.
CI original completa, captures y traces en `ci234-ui2-original-artifact`;
`ci234-close-facts.json`, logs de job/agregador, `ci234-final.json` y publication.json.
Evidencia 235: `D:/CodexEvidence/InhouseRead-20261013/rust-cover-seed-prototype`.

Recompilar con los scripts normales: los targets Cargo compartidos se han
usado para prototipos; nunca copiar sus bindings a producción. Los archivos
generados root fueron construidos con el ABI correcto pero siempre reconstruir.
Variables Windows de esta máquina:

```powershell
$env:RUSTUP_HOME='D:/InhouseRead-Rust/rustup'
$env:CARGO_HOME='D:/InhouseRead-Rust/cargo'
$env:CARGO='D:/InhouseRead-Rust/cargo/bin/cargo.exe'
$env:CARGO_TARGET_DIR='D:/InhouseRead-Rust/target'
$env:CARGO_UI_TARGET_DIR='D:/InhouseRead-Rust/ui-target'
$env:WASM_BINDGEN='D:/InhouseRead-Rust/wasm-bindgen-0.2.105/wasm-bindgen-0.2.105-x86_64-pc-windows-msvc/wasm-bindgen.exe'
$env:TEMP='D:/CodexEvidence/InhouseRead-20261011/night-review/tmp'
$env:TMP=$env:TEMP
```

Build, unitarias completas (6548 previstas/439 archivos), benchmark del
artefacto final y E2E se ejecutan **separados**, sin compiladores/benchmark/browser
concurrentes. `run-regressions.ps1` preparado en evidencia235 espera unitarias
completas y ejecuta 72 regresiones; no es toda la matriz CI. La CI ejecuta todos
los shards y voces reales. Registrar resultados exactos antes de publicar.
`prepare-final.py` prepara `verify-public-235.mjs` y `native-ui235.py`.
Verificar fuente/Pages/109 archivos/APK reales, PDF, escena/editor y perfil.
Scripts de navegador, vida UI, PCM y APK loader reutilizables en evidencia12.
Android SDK `D:/AndroidSdk`, dispositivo `emulator-5562`; conservar instalación
y voces. Python `C:/Users/migue/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`.

Updater canónico fijado y remoto `6621ca1dbb519d171d723f118052e42ef5d5c001`.
No editar copias compartidas. Publicar novedades solo en A; B requiere petición
explícita. APK 1.1.15/28 es inmutable, firma/paquete fijos; no sustituirla ni
crear catálogo sin APK real verificado. Estos bloques web no cambian código
nativo: el loader recibe la web nueva. No afirmar que se publicó una APK nueva.

## Prototipos que deben seguir fuera de producción

Cola completa de longitud en Rust: versiones host/IO/task en evidencia13.
La host pasa35 pruebas y 1000 completos+1000 cancelados con GC/counters0,
pero no acelera: 100 trabajos de I/O simulado ~22→45 ms CPU×4. IO real de
IndexedDB y contador Intl, sin extracción PDF/EPUB, 3×4000 palabras
22.10→25.10 ms; 3×20000,73.20→79.40 ms. Las variantes IO/task tampoco
arreglan el coste. No contarlas ni integrarlas automáticamente.
La variante reference-types con metadata conservada no acelera y **pierde
una referencia tras error de constructor**; `lifetime-control-original.log`
conserva la prueba. Mantener ABI `-reference-types,-multivalue`, bindgen0.2.105
y stackUI262144. No borrar evidencias ni enmascarar contadores con reset.

Objetivo restante autorizado: continuar la migración a Rust con la misma UI,
funciones y datos, mejorar móvil, reparar el cierre pendiente y publicar cada
bloque verificado a main. No prometer porcentaje funcional a partir de líneas.
No pedir aclaraciones innecesarias. No hay subagentes activos de esta tarea.

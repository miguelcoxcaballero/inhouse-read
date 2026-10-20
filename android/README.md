# Android

Mismo patrón que **inhouse notes**: la app Android es un **WebView-shell** (Capacitor `BridgeActivity`) que redirige de inmediato a la versión en vivo de GitHub Pages (`.github/android/app-loader.html`). Un único sitio publicado sirve tanto al navegador como a la app instalada.

## Pipeline de build y firma (ya automatizado)

- `.github/workflows/build-android.yml` — se dispara manualmente (`workflow_dispatch`, pestaña Actions → "Build and publish signed Android APK" → Run workflow). Compila, firma con el keystore de release guardado en los secrets del repo, y publica el APK como GitHub Release con tag `android-vX.Y.Z` (sube `ANDROID_VERSION_NAME`/`ANDROID_VERSION_CODE` en `.github/scripts/build_android_apk.py` en cada cambio nativo real — el workflow no se dispara solo con cada push, así que un cambio en `android/html_to_apk_builder.py` no llega al APK hasta que se vuelve a ejecutar a mano).
- `.github/scripts/build_android_apk.py` — orquesta el build en modo headless (sin abrir ninguna ventana), copiado y adaptado de `build_android_apk.py` de inhouse notes.
- `android/html_to_apk_builder.py` — el builder (Capacitor + manifest/gradle/iconos), con autorización nativa de Drive por Google Play Services y el instalador de auto-actualización.
- El keystore de firma (`inhouse-read-release.jks`, válido hasta 2054) se generó una vez con `keytool` y vive únicamente como secrets del repo (`INHOUSE_READ_ANDROID_KEYSTORE_BASE64`, `_PASSWORD`, `_KEY_ALIAS`) y en una copia local fuera de este repositorio — nunca en el código ni en este README.

## Actualizaciones dentro de la app

Read usa el [Inhouse services updater común](https://github.com/miguelcoxcaballero/inhouse-services-updater), sincronizado desde su repositorio canónico. El aviso es opcional, B es el canal predeterminado y A requiere aceptar su advertencia de desarrollo. «Later» aplaza el aviso 14 días y la comprobación manual sigue disponible en ajustes. El código compartido no se modifica en este repositorio.

Android 1.1.19 (versionCode 32) sincroniza el actualizador común en acd1c37: `.update-provider` se registra con la clase propia `UpdateFileProvider` en lugar de `androidx.core.content.FileProvider`, que Capacitor ya usa para `.fileprovider`. Con la clase compartida, Android servía las dos autoridades desde una sola instancia que rechazaba los URI de actualización.

Android 1.1.18 (versionCode 31) cambia la pantalla de arranque (`.github/android/app-loader.html`) al icono nuevo de Inhouse Read.

Android 1.1.17 (versionCode 30) sincroniza el actualizador común en d313e8a: la APK verificada se entrega al instalador de Android con `ACTION_VIEW` y el `FileProvider` propio, se pide antes el permiso de instalar apps y solo la versión instalada confirma el éxito. Se publica en A con `build-android.yml`; B sigue en 1.1.15. Las instalaciones con 1.1.16 o anterior deben actualizar a mano una vez con «Download APK». La prueba del instalador en el emulador sigue ejercitando `InstallActivity` y ahora incluye su `InstallReceiver`.

Android 1.1.16 (versionCode 29) cambia el icono del lanzador por el nuevo marcapáginas de Inhouse (`android/inhouse-read-logo.png`). Está [publicada en A](https://github.com/miguelcoxcaballero/inhouse-read/releases/tag/android-v1.1.16): el [build](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/39348902958) firmó con la clave permanente, comprobó la continuidad frente a 1.1.13, pasó las pruebas de Android 15 y verificó que la APK pública coincide con la compilada antes de actualizar el catálogo A. B sigue en 1.1.15.

Android 1.1.15 (versionCode 28) está [publicada en A y B](https://github.com/miguelcoxcaballero/inhouse-read/releases/tag/android-v1.1.15), promovida a B por petición expresa del usuario con la misma APK y metadatos. Junto con la web 1.7.140, distingue el resultado de instalación: abrir el instalador no acredita que la actualización haya terminado. Las APK antiguas ofrecen un enlace a la página de esa versión en GitHub para descargar la APK desde allí y abrirla desde Descargas cuando su instalador no responde. La recuperación web llega al recargar, sin depender de instalar primero la nueva APK. No se ha probado esta versión en un teléfono físico.

La [verificación de Android 15](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/38180160799) completó cancelación, reintento y actualización de una aplicación de prueba con las mismas clases nativas del instalador; tras el reemplazo y reapertura conservó el intento y confirmó la versión instalada. También pasaron las pruebas existentes de importación y audio de Read. La APK pública coincide con los bytes del build, conserva el certificado de 1.1.14 y sus metadatos corresponden al código 28. La prueba no cubre instaladores de terceros ni el teléfono del usuario.

El workflow verifica el paquete `com.inhousesoftware.read`, la versión y la continuidad de firma frente a Android 1.1.13 antes de publicar. Conserva las pruebas del loader, importación de libros y audio en segundo plano en Android 15. Tras publicar vuelve a descargar la APK, compara sus bytes y verifica su identidad y firma antes de generar los metadatos reales de `public/android-update.json` y el catálogo A. B no cambia. Nunca se editan tamaño o SHA-256 a mano ni se anuncia una APK antes de su publicación y verificación.

## Google Drive en Android

Desde v1.0.13 el APK usa el mismo flujo de Inhouse Notes: Custom Tab, código de autorización con PKCE, callback `com.inhousesoftware.read:/oauth2redirect` y renovación de sesión.

### Configuración real corregida el 2026-09-28

El cliente Android **sí estaba registrado**. El error `400: invalid_request` se debía a que **Enable custom URI scheme estaba desactivado** en Google Auth Platform → Clients → Inhouse Read Android → Advanced settings. Se ha activado y guardado en el proyecto `inhouse-notes`.

- Cliente Android: `435784295430-tjdos7pgbpr07q9gjpshc6gqd2cvcg43.apps.googleusercontent.com`.
- Paquete: `com.inhousesoftware.read`.
- SHA-1 de release: `C8:3A:3B:38:B7:9E:0E:4A:44:A0:69:22:2A:85:24:E6:01:15:CE:76`.
- Cliente web compartido con Notes: `435784295430-cmug30o42f1vu4ijgor9sjb0ro4oo37o.apps.googleusercontent.com`.

Comprobación real: la petición Android con ese cliente, redirect y desafío PKCE abre ahora el selector de cuenta de Google. Tras elegir la cuenta, Google muestra el aviso de proyecto no verificado. El proyecto compartido se presenta como «Inhouse Notes» en Google. Esta comprobación no equivale a completar el consentimiento y el retorno en un teléfono físico.

En v1.0.14 el callback nativo espera a que la página de producción esté lista. La transacción PKCE persistida permite terminar el acceso incluso si Android recrea la WebView. El estado aleatorio, la caducidad de la transacción, el límite de 20 segundos para intercambio/renovación y el control de cierre de sesión evitan aceptar respuestas ajenas o guardar una sesión después de desconectar. La UI permite cancelar y reintentar.

No sustituir el cliente Android por el de Notes: cada paquete tiene su propio cliente y certificado, dentro del mismo proyecto/API. No se necesita una API key ni un client secret en el frontend.

### Comprobación del APK publicado 1.0.14

Se descargó el APK de Releases y se comprobó `versionCode=12`, paquete, certificado SHA-1 y cargador de producción de 2089 bytes. Su SHA-256 coincide con el manifiesto publicado: `171940d751ac566e4438da6e1f9c2df69b66e0618bb52c01bae745512912878f`.

En Android 15 el APK descargado carga la estantería y, al pulsar Iniciar sesión, abre una Custom Tab en `accounts.google.com` con el formulario real de Google «to continue to Inhouse Notes». La captura y el árbol de interfaz del [run de verificación](https://github.com/miguelcoxcaballero/inhouse-read/actions/runs/36487575225) demuestran ambas pantallas. Ese run quedó rojo por un falso negativo del comprobador: Chrome omitió el label del correo en el árbol accesible. La detección se corrigió y se validó directamente contra ese XML. El emulador no tiene una cuenta de Google y no se completó el consentimiento con credenciales reales; el intercambio, la renovación y la recuperación del callback están cubiertos por pruebas automatizadas con respuestas simuladas.

## Cómo instalar

**Vía APK firmado**: https://miguelcoxcaballero.github.io/inhouse-read/download-android.html — página real del sitio (no un link suelto a un asset) que consulta en vivo cuál es el último release publicado, así que nunca queda desactualizada. Android pedirá permitir "orígenes desconocidos" la primera vez, es normal para un APK fuera de Play Store.

**Vía PWA (sin instalar nada, recomendado si no necesitas la app nativa)**: abre la URL de GitHub Pages en Chrome/Edge en Android y usa "Añadir a pantalla de inicio" / "Instalar app".

## Cómo volver a compilar tú mismo (manual, sin CI)

```bash
npm install -D @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Inhouse Read" com.inhousesoftware.read --web-dir android/www
mkdir -p android/www && cp .github/android/app-loader.html android/www/index.html
npx cap add android
npx cap sync android
npx cap open android   # Android Studio; Build > Generate Signed Bundle/APK
```

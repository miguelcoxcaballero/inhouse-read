package __PACKAGE__;

import android.app.Activity;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * «Compartir»: la estantería entrega el archivo del libro (EPUB o PDF) en trozos base64 y Android
 * abre su hoja de compartir (WhatsApp, correo, Drive…) con ese archivo, servido desde cache/shared/
 * por el FileProvider ".fileprovider" de la app. Inhouse Read no se ofrece a sí misma como destino.
 *
 * window.InhouseBookShare: begin(name, type, title) returns a session id ("" when it fails);
 * append(id, base64) and finish(id) act only on that session, so a share started later can never
 * mix its pieces with an earlier one.
 */
public final class BookShare {
    private static final long MAX_BYTES = 512L * 1024 * 1024;
    /** Android file systems allow 255 bytes per name; keep a margin. */
    private static final int NAME_BYTES = 200;

    private BookShare() { }

    private static int utf8Length(String text) {
        return text.getBytes(StandardCharsets.UTF_8).length;
    }

    /**
     * A name every app and file system accepts: no path separators, control or reserved
     * characters, at most 200 UTF-8 bytes, the extension kept.
     */
    static String safeName(String name) {
        StringBuilder safe = new StringBuilder();
        String source = name == null ? "" : name;
        for (int i = 0; i < source.length(); i++) {
            char c = source.charAt(i);
            safe.append(c < 32 || "/\\:*?\"<>|".indexOf(c) >= 0 ? '_' : c);
        }
        String result = safe.toString().trim();
        while (result.startsWith(".")) result = result.substring(1);
        int dot = result.lastIndexOf('.');
        String extension = dot > 0 && result.length() - dot <= 8 ? result.substring(dot) : "";
        String stem = extension.isEmpty() ? result : result.substring(0, dot);
        while (!stem.isEmpty() && utf8Length(stem) + utf8Length(extension) > NAME_BYTES) {
            stem = stem.substring(0, stem.offsetByCodePoints(stem.length(), -1));
        }
        stem = stem.trim();
        return (stem.isEmpty() ? "libro" : stem) + extension;
    }

    public static final class Bridge {
        private final Activity activity;
        private final WebView webView;
        private final Object lock = new Object();
        private File file;
        private FileOutputStream output;
        private long written;
        private long session;
        private String type = "application/octet-stream";
        private String title = "";

        public Bridge(Activity activity, WebView webView) {
            this.activity = activity;
            this.webView = webView;
        }

        /** Starts a new file in cache/shared/, removing the one shared before; returns its session id. */
        @JavascriptInterface
        public String begin(String name, String mimeType, String bookTitle) {
            if (!trustedPage()) return "";
            synchronized (lock) {
                discard();
                session++;
                try {
                    File folder = new File(activity.getCacheDir(), "shared");
                    File[] previous = folder.listFiles();
                    if (previous != null) for (File entry : previous) entry.delete();
                    if (!folder.isDirectory() && !folder.mkdirs()) return "";
                    file = new File(folder, safeName(name));
                    output = new FileOutputStream(file);
                    written = 0;
                    type = mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType;
                    title = bookTitle == null ? "" : bookTitle;
                    return Long.toString(session);
                } catch (IOException | RuntimeException error) {
                    discard();
                    return "";
                }
            }
        }

        private boolean current(String id) {
            return output != null && Long.toString(session).equals(id);
        }

        /** One piece of the file of session `id`, in standard base64. */
        @JavascriptInterface
        public boolean append(String id, String base64) {
            synchronized (lock) {
                if (!current(id)) return false;
                try {
                    byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                    written += bytes.length;
                    if (written > MAX_BYTES) throw new IOException("Book too large to share");
                    output.write(bytes);
                    return true;
                } catch (IOException | RuntimeException error) {
                    discard();
                    return false;
                }
            }
        }

        /** Closes the file of session `id` and opens Android's share sheet with it. */
        @JavascriptInterface
        public boolean finish(String id) {
            final File shared;
            final String sharedType;
            final String sharedTitle;
            synchronized (lock) {
                if (!current(id) || file == null) return false;
                try {
                    output.close();
                } catch (IOException error) {
                    discard();
                    return false;
                }
                output = null;
                shared = file;
                sharedType = type;
                sharedTitle = title;
            }
            if (!trustedPage()) {
                shared.delete();
                return false;
            }
            activity.runOnUiThread(() -> {
                try {
                    Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", shared);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(sharedType);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    if (!sharedTitle.isEmpty()) {
                        send.putExtra(Intent.EXTRA_SUBJECT, sharedTitle);
                        send.putExtra(Intent.EXTRA_TITLE, sharedTitle);
                    }
                    send.setClipData(ClipData.newRawUri(shared.getName(), uri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    Intent chooser = Intent.createChooser(send, "Compartir libro");
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                        chooser.putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, new ComponentName[] { activity.getComponentName() });
                    }
                    activity.startActivity(chooser);
                } catch (RuntimeException error) {
                    error.printStackTrace();
                }
            });
            return true;
        }

        private void discard() {
            if (output != null) {
                try {
                    output.close();
                } catch (IOException ignored) { }
            }
            output = null;
            if (file != null) file.delete();
            file = null;
        }

        private boolean trustedPage() {
            try {
                java.util.concurrent.FutureTask<String> url = new java.util.concurrent.FutureTask<>(webView::getUrl);
                activity.runOnUiThread(url);
                Uri page = Uri.parse(String.valueOf(url.get(2, java.util.concurrent.TimeUnit.SECONDS)));
                return "https".equals(page.getScheme())
                    && "miguelcoxcaballero.github.io".equals(page.getHost())
                    && String.valueOf(page.getPath()).startsWith("/inhouse-read/");
            } catch (Exception ignored) {
                return false;
            }
        }
    }
}

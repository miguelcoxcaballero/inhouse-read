package __PACKAGE__;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Copies temporary URI grants immediately, then transfers bytes in bounded chunks. */
public final class BookImportBridge {
    private final Activity activity;
    private final WebView webView;
    private final SharedPreferences preferences;
    private final File directory;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    public BookImportBridge(Activity activity, WebView webView) {
        this.activity = activity;
        this.webView = webView;
        preferences = activity.getSharedPreferences("book-imports", 0);
        directory = new File(activity.getCacheDir(), "book-imports");
        directory.mkdirs();
    }

    public void close() { worker.shutdown(); }

    public void handleIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_VIEW.equals(action) && intent.getData() != null) uris.add(intent.getData());
        else if (Intent.ACTION_SEND.equals(action)) {
            Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri != null) uris.add(uri);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> streams = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (streams != null) uris.addAll(streams);
        } else return;
        if (uris.isEmpty() && intent.getClipData() != null) {
            for (int i = 0; i < intent.getClipData().getItemCount(); i++) {
                Uri uri = intent.getClipData().getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        }
        String mime = intent.getType();
        for (Uri uri : uris) {
            if (!"content".equals(uri.getScheme()) && !"file".equals(uri.getScheme())) continue;
            worker.execute(() -> copy(uri, mime));
        }
        // Prevent activity recreation from importing the same launch intent again.
        if (!uris.isEmpty() && !"__PACKAGE__".equals(intent.getScheme())) {
            intent.setAction(Intent.ACTION_MAIN);
            intent.setData(null);
            intent.removeExtra(Intent.EXTRA_STREAM);
            intent.setClipData(null);
        }
    }

    private void copy(Uri uri, String fallbackMime) {
        String id = UUID.randomUUID().toString();
        File destination = new File(directory, id);
        JSONObject entry = new JSONObject();
        try {
            String name = uri.getLastPathSegment();
            try (Cursor cursor = activity.getContentResolver().query(uri,
                    new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            } catch (Exception ignored) { }
            String mime = activity.getContentResolver().getType(uri);
            if (mime == null) mime = fallbackMime;
            if (name == null || name.isEmpty()) name = "Libro";
            name = name.replaceAll(".*[/\\\\]", "");
            if (!name.matches("(?i).+\\.(pdf|epub|mobi|azw|azw3|kf8|fb2|cbz)$")) {
                String extension = extensionForMime(mime);
                if (extension == null) throw new Exception("Formato no compatible. Usa PDF, EPUB, MOBI, AZW, AZW3, KF8, FB2 o CBZ.");
                name += "." + extension;
            }
            try (InputStream input = activity.getContentResolver().openInputStream(uri);
                    FileOutputStream output = new FileOutputStream(destination)) {
                if (input == null) throw new Exception("No se pudo leer el archivo.");
                byte[] buffer = new byte[65536];
                int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            }
            if (destination.length() == 0) throw new Exception("El archivo está vacío.");
            entry.put("name", name).put("mimeType", mime == null ? "application/octet-stream" : mime)
                .put("size", destination.length());
        } catch (Exception error) {
            destination.delete();
            try { entry.put("error", error.getMessage() == null ? "No se pudo leer el archivo compartido." : error.getMessage()); }
            catch (Exception ignored) { }
        }
        try { entry.put("id", id); } catch (Exception ignored) { }
        synchronized (BookImportBridge.class) {
            JSONArray queue = queue();
            queue.put(entry);
            preferences.edit().putString("pending", queue.toString()).commit();
        }
    }

    private static String extensionForMime(String mime) {
        if (mime == null) return null;
        switch (mime.toLowerCase(java.util.Locale.ROOT)) {
            case "application/pdf": case "application/x-pdf": return "pdf";
            case "application/epub+zip": return "epub";
            case "application/x-mobipocket-ebook": return "mobi";
            case "application/vnd.amazon.ebook": case "application/x-azw": return "azw";
            case "application/x-azw3": case "application/x-kf8": return "azw3";
            case "application/x-fictionbook+xml": case "application/fb2": return "fb2";
            case "application/vnd.comicbook+zip": case "application/x-cbz": return "cbz";
            default: return null;
        }
    }

    private JSONArray queue() {
        try { return new JSONArray(preferences.getString("pending", "[]")); }
        catch (Exception error) { return new JSONArray(); }
    }

    private boolean trustedPage() {
        // getUrl belongs to the UI thread; JavascriptInterface runs on a worker.
        try {
            java.util.concurrent.FutureTask<Boolean> check = new java.util.concurrent.FutureTask<>(() -> {
                Uri page = Uri.parse(webView.getUrl() == null ? "" : webView.getUrl());
                return "https".equals(page.getScheme()) && "miguelcoxcaballero.github.io".equals(page.getHost())
                    && page.getPath() != null && page.getPath().startsWith("/inhouse-read/");
            });
            activity.runOnUiThread(check);
            return check.get(3, java.util.concurrent.TimeUnit.SECONDS);
        } catch (Exception error) { return false; }
    }

    @JavascriptInterface public String pending() {
        if (!trustedPage()) return "[]";
        synchronized (BookImportBridge.class) { return queue().toString(); }
    }

    @JavascriptInterface public String readChunk(String id, long offset) {
        if (!trustedPage() || !id.matches("[a-f0-9-]{36}") || offset < 0) return "";
        synchronized (BookImportBridge.class) {
            boolean known = false;
            JSONArray queue = queue();
            for (int i = 0; i < queue.length(); i++) if (id.equals(queue.optJSONObject(i).optString("id"))) known = true;
            if (!known) return "";
        }
        try (RandomAccessFile input = new RandomAccessFile(new File(directory, id), "r")) {
            input.seek(offset);
            byte[] buffer = new byte[196608];
            int count = input.read(buffer);
            return count <= 0 ? "" : Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP);
        } catch (Exception error) { return ""; }
    }

    @JavascriptInterface public void acknowledge(String id) {
        if (!trustedPage() || !id.matches("[a-f0-9-]{36}")) return;
        synchronized (BookImportBridge.class) {
            JSONArray remaining = new JSONArray();
            JSONArray queue = queue();
            for (int i = 0; i < queue.length(); i++) {
                JSONObject entry = queue.optJSONObject(i);
                if (!id.equals(entry.optString("id"))) remaining.put(entry);
            }
            preferences.edit().putString("pending", remaining.toString()).commit();
            new File(directory, id).delete();
        }
    }
}

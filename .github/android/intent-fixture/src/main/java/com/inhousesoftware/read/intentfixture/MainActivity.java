package com.inhousesoftware.read.intentfixture;
import android.app.Activity;
import android.os.Bundle;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.InputStream;
import java.io.FileOutputStream;

/** Separate test APK: supplies a real private content URI with a temporary grant. */
public class MainActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            String mode = getIntent().getStringExtra("mode");
            String name = "Intent_" + mode + ".pdf";
            File file = new File(getFilesDir(), name);
            try (InputStream input = getAssets().open("tiny.pdf"); FileOutputStream output = new FileOutputStream(file)) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer,0,count);
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
            Intent open = new Intent("share".equals(mode) ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
            open.setType("application/pdf");
            if (Intent.ACTION_SEND.equals(open.getAction())) open.putExtra(Intent.EXTRA_STREAM, uri);
            else open.setDataAndType(uri, "application/pdf");
            open.setClipData(ClipData.newRawUri(name, uri));
            open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if ("chooser".equals(mode)) startActivity(Intent.createChooser(open, "Open ebook"));
            else { open.setPackage("com.inhousesoftware.read"); startActivity(open); }
            finish();
        } catch (Exception error) { throw new RuntimeException(error); }
    }
}

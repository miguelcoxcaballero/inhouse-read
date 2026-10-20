#!/usr/bin/env python3
"""Exercise the shared updater's Android installer handoff in a disposable,
self-updating Android app.

The locked PhotosUpdateInstaller hands the verified APK to Android's package
installer with ACTION_VIEW and a FileProvider URI. The fixture performs exactly
that handoff and the check drives the real installer: cancel, retry, update.
The debug fixture uses its own package/key; production Read APKs are untouched.
Run --build after build_android_apk.py, then --verify on the CI emulator.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "com.inhouse.services.updater.smoke"
APK = ROOT / "updater-install-fixture-debug.apk"
REPORT = ROOT / "android-updater-install-results.json"


def run(*args, check=True, timeout=60, cwd=None):
    result = subprocess.run(args, check=False, capture_output=True, text=True,
                            timeout=timeout, cwd=cwd)
    if check and result.returncode:
        print(result.stdout, flush=True)
        print(result.stderr, flush=True)
        result.check_returncode()
    return result


def build():
    project = Path(os.environ["RUNNER_TEMP"]) / "inhouseread-android-build/android"
    fixture = project / "updater-install-fixture"
    if fixture.exists():
        shutil.rmtree(fixture)
    main = fixture / "src/main"
    # Fail if the locked installer stops using the handoff this fixture repeats.
    installer = (ROOT / "vendor/inhouse-services-updater/android/PhotosUpdateInstaller.kt").read_text()
    for marker in ("Intent(Intent.ACTION_VIEW)", "setDataAndType(apkUri, APK_MIME_TYPE)",
                   "Intent.FLAG_GRANT_READ_URI_PERMISSION", ".update-provider"):
        if marker not in installer:
            raise SystemExit(f"Locked installer no longer contains {marker!r}; update this fixture")
    (fixture / "build.gradle").write_text("""apply plugin: 'com.android.application'
android {
    namespace 'com.inhouse.services.updater.smoke'
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId 'com.inhouse.services.updater.smoke'
        minSdkVersion 23
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode providers.gradleProperty('installerFixtureVersion').get().toInteger()
        versionName providers.gradleProperty('installerFixtureVersion').get()
    }
    compileOptions { sourceCompatibility JavaVersion.VERSION_1_8; targetCompatibility JavaVersion.VERSION_1_8 }
}
dependencies { implementation 'androidx.core:core:1.15.0' }
""")
    (main / "AndroidManifest.xml").write_text('''<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
  <application android:label="Updater install test" android:theme="@android:style/Theme.Material.Light.NoActionBar" android:allowBackup="false">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter>
    </activity>
    <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.update-provider" android:exported="false" android:grantUriPermissions="true">
      <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/update_paths"/>
    </provider>
  </application>
</manifest>''')
    xml = main / "res/xml"
    xml.mkdir(parents=True)
    (xml / "update_paths.xml").write_text('<paths><cache-path name="updates" path="updates/"/></paths>')
    launcher = main / "java/com/inhouse/services/updater/smoke"
    launcher.mkdir(parents=True)
    (launcher / "MainActivity.java").write_text('''package com.inhouse.services.updater.smoke;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.core.content.FileProvider;
import java.io.*;
public final class MainActivity extends Activity {
    private TextView state;
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL); body.setPadding(32, 96, 32, 32);
        state = new TextView(this); body.addView(state);
        Button install = new Button(this); install.setText("Install test update");
        install.setOnClickListener(view -> launchUpdate()); body.addView(install);
        setContentView(body);
    }
    @Override public void onResume() {
        super.onResume();
        long version = 0;
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode(); }
        catch (Exception ignored) {}
        String result = "fixtureVersion=" + version
            + "; installPermission=" + getPackageManager().canRequestPackageInstalls();
        android.util.Log.i("UpdaterInstallFixture", "MainActivity resumed: " + result);
        if (state != null) state.setText(result);
    }
    private void launchUpdate() {
        try {
            File folder = new File(getCacheDir(), "updates"); folder.mkdirs();
            File file = new File(folder, "next.apk");
            try (InputStream input = getAssets().open("next.apk"); FileOutputStream output = new FileOutputStream(file)) {
                byte[] buffer = new byte[32768]; int count;
                while ((count = input.read(buffer)) >= 0) output.write(buffer, 0, count);
                output.getFD().sync();
            }
            // Same handoff as the locked PhotosUpdateInstaller after verification.
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".update-provider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Test update", uri));
            startActivity(intent);
        } catch (Exception error) { state.setText("FIXTURE ERROR: " + error); }
    }
}''')
    settings = project / "settings.gradle"
    with settings.open("a") as target:
        target.write("\ninclude ':updater-install-fixture'\n")
    gradle = str(project / "gradlew")
    output = fixture / "build/outputs/apk/debug/updater-install-fixture-debug.apk"
    # Build the replacement before embedding it in the initial APK.
    for version in (2, 1):
        print(f"Building installer fixture version {version}", flush=True)
        result = run(gradle, ":updater-install-fixture:assembleDebug",
                     f"-PinstallerFixtureVersion={version}", "--console=plain", "--warning-mode=none",
                     cwd=project, timeout=300)
        print(result.stdout, flush=True)
        if version == 2:
            assets = main / "assets"
            assets.mkdir()
            shutil.copy2(output, assets / "next.apk")
        else:
            shutil.copy2(output, APK)


def dump_ui():
    run("adb", "shell", "rm", "-f", "/sdcard/updater-install-ui.xml")
    run("adb", "shell", "uiautomator", "dump", "--compressed", "/sdcard/updater-install-ui.xml", timeout=20)
    result = run("adb", "shell", "cat", "/sdcard/updater-install-ui.xml")
    (ROOT / "android-updater-ui.xml").write_text(result.stdout)
    return ET.fromstring(result.stdout)


def tap(labels, package=None, timeout=30, click=True):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            for node in dump_ui().iter("node"):
                if package and node.get("package") != package:
                    continue
                if node.get("text", "").strip().casefold() not in labels or node.get("enabled") != "true":
                    continue
                bounds = list(map(int, re.findall(r"\d+", node.get("bounds", ""))))
                if len(bounds) == 4:
                    if click:
                        run("adb", "shell", "input", "tap", str((bounds[0] + bounds[2]) // 2), str((bounds[1] + bounds[3]) // 2))
                    return
        except (subprocess.SubprocessError, ET.ParseError):
            pass
        time.sleep(.5)
    raise AssertionError(f"Could not find Android button: {labels}")


def wait_for(predicate, description, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(.4)
    raise AssertionError(description)


def allow_test_source():
    # A shell appops write can be superseded by Android's source-install
    # policy. Exercise the user-visible grant and verify the app's own API.
    run("adb", "shell", "am", "start", "-a", "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
        "-d", "package:" + PACKAGE)
    def source_settings():
        try:
            tree = dump_ui()
            return [tree] if any(node.get("text", "").strip().casefold() == "allow from this source"
                                 for node in tree.iter("node")) else None
        except (subprocess.SubprocessError, ET.ParseError):
            return None

    current = wait_for(source_settings, "Android source-permission settings did not open")[0]
    if not any(node.get("checkable") == "true" and node.get("checked") == "true"
               for node in current.iter("node")):
        tap({"allow from this source"})
    run("adb", "shell", "input", "keyevent", "KEYCODE_BACK")
    run("adb", "shell", "am", "start", "-n", PACKAGE + "/.MainActivity")

    def granted():
        try:
            return any(node.get("package") == PACKAGE and "installPermission=true" in node.get("text", "")
                       for node in dump_ui().iter("node"))
        except (subprocess.SubprocessError, ET.ParseError):
            return False

    wait_for(granted, "Android did not grant installation permission to the fixture")


def reopen_installed_app(report, timeout=45):
    # PackageManager exposes the new version before PackageInstaller finishes
    # closing the old task. That cleanup can swallow a single immediate start.
    # Require a real version-2 onResume/UI.
    run("adb", "shell", "am", "force-stop", PACKAGE)
    attempts = report["reopenAttempts"] = []
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        attempt = {}
        attempts.append(attempt)
        try:
            result = run("adb", "shell", "am", "start", "-W", "-f", "0x10008000",
                         "-n", PACKAGE + "/.MainActivity", check=False, timeout=12)
            attempt["launch"] = result.stdout + result.stderr
            nodes = list(dump_ui().iter("node"))
            attempt["visiblePackages"] = sorted({node.get("package", "") for node in nodes})
            for node in nodes:
                text = node.get("text", "")
                if node.get("package") == PACKAGE and text.startswith("fixtureVersion=2;"):
                    report["reopenedUi"] = text
                    return
        except (subprocess.SubprocessError, ET.ParseError) as error:
            attempt["error"] = str(error)
        time.sleep(.5)
    raise AssertionError("Updated fixture MainActivity did not become visible after package replacement")


def fixture_version():
    match = re.search(r"versionCode=(\d+)", run("adb", "shell", "dumpsys", "package", PACKAGE).stdout)
    return int(match.group(1)) if match else 0


def verify():
    report = {"package": PACKAGE, "cancelled": False, "installed": False}
    try:
        assert APK.is_file(), "Build the updater debug fixture first"
        run("adb", "logcat", "-c")
        run("adb", "uninstall", PACKAGE, check=False)
        run("adb", "install", str(APK))
        report["phase"] = "allow-source"
        allow_test_source()
        report["installPermission"] = True
        report["phase"] = "cancel-installation"
        tap({"install test update"}, PACKAGE)
        # Cancellation must occur on the actual installation confirmation,
        # not an unknown-source permission warning that also has Cancel.
        tap({"update", "install"}, click=False)
        tap({"cancel"})
        # Android returns to the app without installing; the retry must work.
        tap({"install test update"}, PACKAGE, click=False)
        assert fixture_version() == 1, "Cancelling must keep version 1"
        report["cancelled"] = True
        report["phase"] = "retry-installation"
        tap({"install test update"}, PACKAGE)
        tap({"update", "install"})
        report["phase"] = "wait-for-replacement"
        wait_for(lambda: fixture_version() == 2, "Android did not replace the fixture with version 2", timeout=45)
        # The replacement terminates the caller; reopening must show version 2.
        report["phase"] = "reopen-installed-app"
        reopen_installed_app(report)
        report["installed"] = True
        report["phase"] = "passed"
        dump_ui()
        print("Real Android installer cancellation, retry and self-update passed.", flush=True)
    finally:
        report["finalVersion"] = fixture_version()
        try:
            dump_ui()
        except (subprocess.SubprocessError, ET.ParseError) as error:
            report["finalUiError"] = str(error)
        REPORT.write_text(json.dumps(report, indent=2) + "\n")
        logs = run("adb", "logcat", "-d", check=False)
        (ROOT / "android-updater-logcat.txt").write_text(logs.stdout)
        if not report["installed"]:
            run("adb", "shell", "screencap", "-p", "/sdcard/updater-install.png", check=False)
            run("adb", "pull", "/sdcard/updater-install.png", str(ROOT / "android-updater-failure.png"), check=False)
        run("adb", "uninstall", PACKAGE, check=False)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--build", action="store_true")
    mode.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    build() if args.build else verify()

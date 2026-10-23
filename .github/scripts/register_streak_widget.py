"""Register the reading-streak home-screen widget and its WebView bridge."""
import shutil
from pathlib import Path
from xml.etree import ElementTree as ET

WIDGET_DIR = Path("android/streak-widget")
JAVA_FILES = ("StreakWidgetProvider.java", "StreakWidgetBridge.java")
BRIDGE_JAVA = 'webView.addJavascriptInterface(bookImports, "InhouseBookImports");'
BRIDGE_KOTLIN = 'webView.addJavascriptInterface(bookImports!!, "InhouseBookImports")'


def register_streak_widget(project_dir: Path, package_id: str, repo_root: Path):
    source = repo_root / WIDGET_DIR
    root = project_dir / "android/app/src/main"
    java_dir = root / "java" / Path(*package_id.split("."))
    java_dir.mkdir(parents=True, exist_ok=True)
    for name in JAVA_FILES:
        (java_dir / name).write_text(
            (source / name).read_text(encoding="utf-8").replace("__PACKAGE__", package_id), encoding="utf-8")
    for resource in (source / "res").rglob("*.xml"):
        target = root / "res" / resource.relative_to(source / "res")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise RuntimeError(f"Streak widget resource would overwrite {target}")
        shutil.copy2(resource, target)

    manifest = root / "AndroidManifest.xml"
    ns = "{http://schemas.android.com/apk/res/android}"
    ET.register_namespace("android", ns[1:-1])
    tree = ET.parse(manifest)
    application = tree.getroot().find("application")
    receiver = ET.SubElement(application, "receiver", {
        ns + "name": ".StreakWidgetProvider",
        ns + "exported": "false",
        ns + "label": "@string/streak_widget_label",
    })
    intents = ET.SubElement(receiver, "intent-filter")
    for action in ("android.appwidget.action.APPWIDGET_UPDATE", "android.intent.action.TIME_SET",
                   "android.intent.action.TIMEZONE_CHANGED"):
        ET.SubElement(intents, "action", {ns + "name": action})
    ET.SubElement(receiver, "meta-data", {
        ns + "name": "android.appwidget.provider",
        ns + "resource": "@xml/streak_widget_info",
    })
    tree.write(manifest, encoding="utf-8", xml_declaration=True)

    java_file = java_dir / "MainActivity.java"
    kotlin_file = root / "kotlin" / Path(*package_id.split(".")) / "MainActivity.kt"
    if java_file.exists():
        text = java_file.read_text(encoding="utf-8")
        if BRIDGE_JAVA not in text:
            raise RuntimeError("MainActivity has no book-import bridge to follow")
        text = text.replace(BRIDGE_JAVA, BRIDGE_JAVA +
            '\n        webView.addJavascriptInterface(new StreakWidgetBridge(this, webView), "InhouseStreak");', 1)
        java_file.write_text(text, encoding="utf-8")
    elif kotlin_file.exists():
        text = kotlin_file.read_text(encoding="utf-8")
        if BRIDGE_KOTLIN not in text:
            raise RuntimeError("MainActivity has no book-import bridge to follow")
        text = text.replace(BRIDGE_KOTLIN, BRIDGE_KOTLIN +
            '\n        webView.addJavascriptInterface(StreakWidgetBridge(this, webView), "InhouseStreak")', 1)
        kotlin_file.write_text(text, encoding="utf-8")
    else:
        raise RuntimeError("Generated MainActivity is missing")

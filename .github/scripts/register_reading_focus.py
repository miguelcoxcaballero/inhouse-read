"""Register «Sin avisos al leer»: the reader's own Do Not Disturb rule and its WebView bridge."""
from pathlib import Path
from xml.etree import ElementTree as ET

SOURCE = Path("android/reading-focus/ReadingFocus.java")
PERMISSION = "android.permission.ACCESS_NOTIFICATION_POLICY"
# The reader display switches with the book and the app's lifecycle; the rule follows it.
DISPLAY_JAVA = "boolean active = isReadingDisplayActive();"
BRIDGE_JAVA = 'webView.addJavascriptInterface(new StreakWidgetBridge(this, webView), "InhouseStreak");'


def register_reading_focus(project_dir: Path, package_id: str, repo_root: Path):
    root = project_dir / "android/app/src/main"
    java_dir = root / "java" / Path(*package_id.split("."))
    (java_dir / "ReadingFocus.java").write_text(
        (repo_root / SOURCE).read_text(encoding="utf-8").replace("__PACKAGE__", package_id), encoding="utf-8")

    manifest = root / "AndroidManifest.xml"
    ns = "{http://schemas.android.com/apk/res/android}"
    ET.register_namespace("android", ns[1:-1])
    tree = ET.parse(manifest)
    existing = {node.attrib.get(ns + "name") for node in tree.getroot().findall("uses-permission")}
    if PERMISSION not in existing:
        node = ET.Element("uses-permission", {ns + "name": PERMISSION})
        tree.getroot().insert(0, node)
    tree.write(manifest, encoding="utf-8", xml_declaration=True)

    activity = java_dir / "MainActivity.java"
    if not activity.exists():
        raise RuntimeError("Generated MainActivity.java is missing")
    text = activity.read_text(encoding="utf-8")
    for anchor in (DISPLAY_JAVA, BRIDGE_JAVA):
        if text.count(anchor) != 1:
            raise RuntimeError(f"MainActivity anchor not found exactly once: {anchor}")
    text = text.replace(DISPLAY_JAVA, DISPLAY_JAVA + "\n        ReadingFocus.apply(this, active);", 1)
    text = text.replace(BRIDGE_JAVA, BRIDGE_JAVA +
        '\n        webView.addJavascriptInterface(new ReadingFocus.Bridge(this, webView), "InhouseReadingFocus");', 1)
    activity.write_text(text, encoding="utf-8")

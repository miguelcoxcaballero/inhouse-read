"""Register ebook intents and the chunked native inbox in the generated shell."""
from pathlib import Path
from xml.etree import ElementTree as ET

MIME_TYPES = (
    "application/pdf", "application/x-pdf", "application/epub+zip",
    "application/x-mobipocket-ebook", "application/vnd.amazon.ebook",
    "application/x-azw", "application/x-azw3", "application/x-kf8",
    "application/x-fictionbook+xml", "application/fb2",
    "application/vnd.comicbook+zip", "application/x-cbz",
    # Several Android document providers report all ebook files as binary/ZIP/XML.
    # The native inbox validates the DISPLAY_NAME extension before accepting them.
    "application/octet-stream", "application/zip", "application/x-zip-compressed",
    "application/xml", "text/xml",
)
EXTENSIONS = ("pdf", "epub", "mobi", "azw", "azw3", "kf8", "fb2", "cbz")


def register_book_imports(project_dir: Path, package_id: str, repo_root: Path):
    root = project_dir / "android/app/src/main"
    manifest = root / "AndroidManifest.xml"
    ns = "{http://schemas.android.com/apk/res/android}"
    ET.register_namespace("android", ns[1:-1])
    tree = ET.parse(manifest)
    activity = next(node for node in tree.getroot().find("application").findall("activity")
                    if node.get(ns + "name", "").endswith("MainActivity"))
    activity.set(ns + "launchMode", "singleTask")
    for action in ("VIEW", "SEND", "SEND_MULTIPLE"):
        intent = ET.SubElement(activity, "intent-filter", {ns + "label": "Inhouse Read"})
        ET.SubElement(intent, "action", {ns + "name": "android.intent.action." + action})
        ET.SubElement(intent, "category", {ns + "name": "android.intent.category.DEFAULT"})
        for mime in MIME_TYPES:
            ET.SubElement(intent, "data", {ns + "mimeType": mime})
    # Providers sometimes omit a MIME type altogether. Keep these filters separate
    # from MIME filters, because Android matches both sets with different rules.
    for scheme in ("content", "file"):
        for extension in EXTENSIONS:
            intent = ET.SubElement(activity, "intent-filter", {ns + "label": "Inhouse Read"})
            ET.SubElement(intent, "action", {ns + "name": "android.intent.action.VIEW"})
            ET.SubElement(intent, "category", {ns + "name": "android.intent.category.DEFAULT"})
            for suffix in (extension, extension.upper()):
                ET.SubElement(intent, "data", {ns + "scheme": scheme, ns + "host": "*",
                    ns + "pathPattern": ".*\\." + suffix})
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    java_dir = root / "java" / Path(*package_id.split("."))
    java_dir.mkdir(parents=True, exist_ok=True)
    (java_dir / "BookImportBridge.java").write_text(
        (repo_root / "android/BookImportBridge.java").read_text(encoding="utf-8")
        .replace("__PACKAGE__", package_id), encoding="utf-8")
    java_file = java_dir / "MainActivity.java"
    kotlin_file = root / "kotlin" / Path(*package_id.split(".")) / "MainActivity.kt"
    if java_file.exists():
        source = java_file.read_text(encoding="utf-8")
        source = source.replace("private ReadAloudBridge speechBridge;", "private ReadAloudBridge speechBridge;\n    private BookImportBridge bookImports;")
        source = source.replace("if (speechBridge != null) speechBridge.close();", "if (speechBridge != null) speechBridge.close();\n        if (bookImports != null) bookImports.close();")
        source = source.replace("handleAppCallback(intent);", "handleAppCallback(intent);\n        if (bookImports != null) bookImports.handleIntent(intent);")
        source = source.replace("handleAppCallback(getIntent());", 'bookImports = new BookImportBridge(this, webView);\n        webView.addJavascriptInterface(bookImports, "InhouseBookImports");\n        handleAppCallback(getIntent());\n        bookImports.handleIntent(getIntent());')
        java_file.write_text(source, encoding="utf-8")
    elif kotlin_file.exists():
        source = kotlin_file.read_text(encoding="utf-8")
        source = source.replace("private var speechBridge: ReadAloudBridge? = null", "private var speechBridge: ReadAloudBridge? = null\n    private var bookImports: BookImportBridge? = null")
        source = source.replace("speechBridge?.close()", "speechBridge?.close()\n        bookImports?.close()")
        source = source.replace("setIntent(intent)\n        handleAppCallback(intent)", "setIntent(intent)\n        handleAppCallback(intent)\n        bookImports?.handleIntent(intent)")
        source = source.replace('webView.addJavascriptInterface(InhouseNativeBridge(), "InhouseNative")', 'webView.addJavascriptInterface(InhouseNativeBridge(), "InhouseNative")\n        bookImports = BookImportBridge(this, webView)\n        webView.addJavascriptInterface(bookImports!!, "InhouseBookImports")')
        source = source.replace("handleAppCallback(intent)\n    }\n\n    inner class", "handleAppCallback(intent)\n        bookImports?.handleIntent(intent)\n    }\n\n    inner class")
        kotlin_file.write_text(source, encoding="utf-8")
    else:
        raise RuntimeError("Generated MainActivity is missing")

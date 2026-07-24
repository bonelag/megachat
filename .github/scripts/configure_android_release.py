#!/usr/bin/env python3
"""Configure a generated Capacitor Android project for a signed release build."""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from pathlib import Path


ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)


def android_attr(name: str) -> str:
    return f"{{{ANDROID_NS}}}{name}"


def patch_gradle(path: Path, version_name: str, version_code: int) -> None:
    text = path.read_text()

    text, code_changes = re.subn(
        r"(?m)^(\s*)versionCode\s+\d+\s*$",
        rf"\g<1>versionCode {version_code}",
        text,
        count=1,
    )
    text, name_changes = re.subn(
        r'(?m)^(\s*)versionName\s+"[^"]*"\s*$',
        rf'\g<1>versionName "{version_name}"',
        text,
        count=1,
    )
    if code_changes != 1 or name_changes != 1:
        raise RuntimeError("Could not locate versionCode/versionName in app/build.gradle")

    if "signingConfigs {" not in text:
        signing_config = """    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
"""
        marker = "    buildTypes {"
        if marker not in text:
            raise RuntimeError("Could not locate buildTypes in app/build.gradle")
        text = text.replace(marker, signing_config + marker, 1)

    text, minify_changes = re.subn(
        r"(?m)^(\s*)minifyEnabled\s+false\s*$",
        r"\g<1>minifyEnabled true\n\g<1>shrinkResources true\n\g<1>signingConfig signingConfigs.release",
        text,
        count=1,
    )
    if minify_changes != 1 and "signingConfig signingConfigs.release" not in text:
        raise RuntimeError("Could not configure release build type")

    path.write_text(text)


def patch_styles(path: Path) -> None:
    tree = ET.parse(path)
    root = tree.getroot()
    launch_style = next(
        (style for style in root.findall("style") if style.get("name") == "AppTheme.NoActionBarLaunch"),
        None,
    )
    if launch_style is None:
        raise RuntimeError("Could not locate AppTheme.NoActionBarLaunch in styles.xml")

    item_name = "android:windowOptOutEdgeToEdgeEnforcement"
    if not any(item.get("name") == item_name for item in launch_style.findall("item")):
        item = ET.SubElement(launch_style, "item", {"name": item_name})
        item.text = "true"

    ET.indent(tree, space="    ")
    tree.write(path, encoding="utf-8", xml_declaration=True)


def ensure_permission(root: ET.Element, permission: str) -> None:
    if any(
        element.get(android_attr("name")) == permission
        for element in root.findall("uses-permission")
    ):
        return
    root.insert(0, ET.Element("uses-permission", {android_attr("name"): permission}))


def patch_manifest(path: Path) -> None:
    tree = ET.parse(path)
    root = tree.getroot()

    for permission in (
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
    ):
        ensure_permission(root, permission)

    application = root.find("application")
    if application is None:
        raise RuntimeError("Could not locate application in AndroidManifest.xml")
    application.set(android_attr("usesCleartextTraffic"), "true")

    activity = next(
        (
            candidate
            for candidate in application.findall("activity")
            if candidate.get(android_attr("name"), "").endswith("MainActivity")
        ),
        None,
    )
    if activity is None:
        raise RuntimeError("Could not locate MainActivity in AndroidManifest.xml")

    has_chatbox_deep_link = any(
        data.get(android_attr("scheme")) == "chatbox"
        for intent_filter in activity.findall("intent-filter")
        for data in intent_filter.findall("data")
    )
    if not has_chatbox_deep_link:
        intent_filter = ET.SubElement(activity, "intent-filter", {android_attr("autoVerify"): "true"})
        ET.SubElement(intent_filter, "action", {android_attr("name"): "android.intent.action.VIEW"})
        ET.SubElement(intent_filter, "category", {android_attr("name"): "android.intent.category.DEFAULT"})
        ET.SubElement(intent_filter, "category", {android_attr("name"): "android.intent.category.BROWSABLE"})
        ET.SubElement(intent_filter, "data", {android_attr("scheme"): "chatbox"})

    ET.indent(tree, space="    ")
    tree.write(path, encoding="utf-8", xml_declaration=True)


def patch_proguard(path: Path) -> None:
    text = path.read_text()
    rules = (
        "-dontwarn com.google.errorprone.annotations.**",
        "-dontwarn javax.annotation.**",
    )
    missing = [rule for rule in rules if rule not in text]
    if missing:
        text = text.rstrip() + "\n\n# Compile-time annotations omitted from Android runtime\n"
        text += "\n".join(missing) + "\n"
        path.write_text(text)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--android-dir", type=Path, required=True)
    parser.add_argument("--version-name", required=True)
    parser.add_argument("--version-code", type=int, required=True)
    args = parser.parse_args()

    if args.version_code < 1:
        parser.error("--version-code must be a positive integer")

    app_dir = args.android_dir / "app"
    patch_gradle(app_dir / "build.gradle", args.version_name, args.version_code)
    patch_styles(app_dir / "src/main/res/values/styles.xml")
    patch_manifest(app_dir / "src/main/AndroidManifest.xml")
    patch_proguard(app_dir / "proguard-rules.pro")


if __name__ == "__main__":
    main()

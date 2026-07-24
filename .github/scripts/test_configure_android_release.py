import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("configure_android_release.py")


class ConfigureAndroidReleaseTest(unittest.TestCase):
    def test_configures_generated_capacitor_project_like_official_release(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            android_dir = Path(temp_dir) / "android"
            app_dir = android_dir / "app"
            values_dir = app_dir / "src/main/res/values"
            values_dir.mkdir(parents=True)

            (app_dir / "build.gradle").write_text(
                """plugins {
    id 'com.android.application'
}

android {
    namespace "xyz.chatboxapp.chatbox"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "xyz.chatboxapp.chatbox"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
"""
            )
            (values_dir / "styles.xml").write_text(
                """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
    </style>
</resources>
"""
            )
            (app_dir / "src/main/AndroidManifest.xml").write_text(
                """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:theme="@style/AppTheme" android:label="@string/app_name">
        <activity android:name=".MainActivity" android:theme="@style/AppTheme.NoActionBarLaunch" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""
            )
            (app_dir / "proguard-rules.pro").write_text("# Project rules\n")

            subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--android-dir",
                    str(android_dir),
                    "--version-name",
                    "1.21.1",
                    "--version-code",
                    "436",
                ],
                check=True,
            )

            gradle = (app_dir / "build.gradle").read_text()
            self.assertIn("versionCode 436", gradle)
            self.assertIn('versionName "1.21.1"', gradle)
            self.assertIn("signingConfigs {", gradle)
            self.assertIn("signingConfig signingConfigs.release", gradle)
            self.assertIn("minifyEnabled true", gradle)
            self.assertIn("shrinkResources true", gradle)

            styles = (values_dir / "styles.xml").read_text()
            self.assertIn("android:windowOptOutEdgeToEdgeEnforcement", styles)

            manifest = (app_dir / "src/main/AndroidManifest.xml").read_text()
            self.assertIn('android:usesCleartextTraffic="true"', manifest)
            self.assertIn("android.permission.READ_MEDIA_IMAGES", manifest)
            self.assertIn('android:scheme="chatbox"', manifest)

            proguard = (app_dir / "proguard-rules.pro").read_text()
            self.assertIn("-dontwarn com.google.errorprone.annotations.**", proguard)
            self.assertIn("-dontwarn javax.annotation.**", proguard)


if __name__ == "__main__":
    unittest.main()

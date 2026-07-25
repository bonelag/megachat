@echo off
setlocal

REM ============================================================
REM Build signed release APK - full pipeline
REM Repo root: F:\Code\megachat  (this file lives in android\)
REM Steps: renderer build -> cap sync -> fix local.properties
REM        -> patch release config -> gradle assembleRelease
REM ============================================================

set "REPO=F:\Code\megachat"
set "ANDROID_SDK=D:\Code\REMOTE_DESKTOP\android"
set "JAVA_HOME=%ANDROID_SDK%\jdk17"

set "ANDROID_KEYSTORE_PATH=%ANDROID_SDK%\chatbox-release.p12"
set "ANDROID_KEYSTORE_PASSWORD=khongnho"
set "ANDROID_KEY_ALIAS=khongnho"
set "ANDROID_KEY_PASSWORD=khongnho"

set "PATH=%JAVA_HOME%\bin;%PATH%"

cd /d "%REPO%" || exit /b 1

echo [1/5] Building mobile renderer...
call pnpm exec cross-env CHATBOX_BUILD_TARGET=mobile_app CHATBOX_BUILD_PLATFORM=android electron-vite build || exit /b 1
for /r "%REPO%\release\app\dist" %%f in (*.map) do del "%%f" 2>nul

echo [2/5] Capacitor sync android...
if not exist "%REPO%\capacitor.config.json" (
    echo capacitor.config.json missing! Restore it first.
    exit /b 1
)
if not exist "%REPO%\android\gradlew" call pnpm exec cap add android || exit /b 1
call pnpm exec cap sync android || exit /b 1
call pnpm exec capacitor-assets generate --android || exit /b 1

echo [3/5] Fixing local.properties (cap sync overwrites it)...
REM Java Properties: backslash must be doubled
> "%REPO%\android\local.properties" echo sdk.dir=D:\\Code\\REMOTE_DESKTOP\\android

echo [4/5] Patching release config...
for /f %%v in ('node -p "require('./release/app/package.json').version"') do set "VERSION_NAME=%%v"
python "%REPO%\.github\scripts\configure_android_release.py" --android-dir "%REPO%\android" --version-name "%VERSION_NAME%" --version-code 436 || exit /b 1

echo [5/5] Gradle assembleRelease...
cd /d "%REPO%\android" || exit /b 1
call "%REPO%\android\gradlew.bat" --no-daemon assembleRelease || exit /b 1

echo.
echo ============================================================
echo DONE: %REPO%\android\app\build\outputs\apk\release\app-release.apk
echo ============================================================
endlocal

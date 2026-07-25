@echo off
setlocal

REM ============================================================
REM Build signed release APK - full pipeline
REM Repo root: F:\Code\megachat  (this file lives in android\)
REM Steps: mobile:sync:android -> fix local.properties
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

if not exist "%REPO%\capacitor.config.json" (
    echo capacitor.config.json missing! Restore it first.
    exit /b 1
)
if not exist "%REPO%\android\gradlew" (
    echo [0/4] Android platform missing, running cap add android...
    call pnpm exec cap add android || exit /b 1
)

echo [1/4] pnpm run mobile:sync:android (build renderer + cap sync)...
call pnpm run mobile:sync:android || exit /b 1
call pnpm exec capacitor-assets generate --android || exit /b 1

echo [2/4] Fixing local.properties (cap sync overwrites it)...
REM Java Properties: backslash must be doubled
> "%REPO%\android\local.properties" echo sdk.dir=D:\\Code\\REMOTE_DESKTOP\\android

echo [3/4] Patching release config...
for /f %%v in ('node -p "require('./release/app/package.json').version"') do set "VERSION_NAME=%%v"
python "%REPO%\.github\scripts\configure_android_release.py" --android-dir "%REPO%\android" --version-name "%VERSION_NAME%" --version-code 436 || exit /b 1

echo [4/4] Gradle assembleRelease...
cd /d "%REPO%\android" || exit /b 1
call "%REPO%\android\gradlew.bat" --no-daemon assembleRelease || exit /b 1

echo.
echo ============================================================
echo DONE: %REPO%\android\app\build\outputs\apk\release\app-release.apk
echo ============================================================
endlocal

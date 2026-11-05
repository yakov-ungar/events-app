#!/usr/bin/env bash
# Creates the Android project and applies this app's icons, splash screen and signing key. Used by GitHub Actions; safe to run locally.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d android ] || npx cap add android
cp -r resources/res/. android/app/src/main/res/
# NetFree / HTTPS filtering: trust user-installed certificates (android/ is generated, so the manifest is patched here)
MANIFEST=android/app/src/main/AndroidManifest.xml
grep -q networkSecurityConfig "$MANIFEST" || sed -i 's|<application|<application android:networkSecurityConfig="@xml/network_security_config"|' "$MANIFEST"
grep -q "events-app signing" android/app/build.gradle || cat scripts/signing.gradle >> android/app/build.gradle
sed -i "s/versionCode [0-9]*/versionCode ${VERSION_CODE:-1}/; s/versionName \"[^\"]*\"/versionName \"1.${VERSION_CODE:-0}\"/" android/app/build.gradle
npx cap sync android
chmod +x android/gradlew

#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if [[ "${1:-}" == --help ]]; then
  cat <<'HELP'
Usage: ./build-apk.sh [--debug]

Build a standalone, locally signed release APK on NixOS. No Expo account needed.
Output: dist/reducto.apk
Use --debug for a Fast Refresh build requiring Metro: dist/reducto-debug.apk.

First run downloads the Nix Android toolchain, JS dependencies and Gradle/Maven
dependencies. Android SDK licenses are accepted by android-build.nix.
Requires Nix with <nixpkgs> configured and Linux user namespaces (for the FHS shell).

Optional environment variables:
  APK_ARCHITECTURES  Comma-separated ABIs (default: arm64-v8a,armeabi-v7a)
  APK_BUILD_JOBS     Gradle worker count (default: 2)
  APK_BUILD_VERBOSE  Set to 1 for detailed Gradle download/build logs
HELP
  exit 0
fi
variant=release
gradle_task=assembleRelease
output_name=reducto
if [[ $# -eq 1 && "$1" == --debug ]]; then
  variant=debug
  gradle_task=assembleDebug
  output_name=reducto-debug
elif [[ $# -ne 0 ]]; then
  printf 'Unknown argument: %s (see --help)\n' "$1" >&2
  exit 2
fi

if [[ "${REDUCTO_ANDROID_BUILD_ENV:-}" != 1 ]]; then
  command -v nix-build >/dev/null || { echo 'Install Nix and configure <nixpkgs> first.' >&2; exit 1; }
  echo 'Preparing the NixOS Android build environment…'
  build_env="$(nix-build "$project_dir/android-build.nix" --no-out-link)"
  exec "$build_env/bin/reducto-android-build" "$project_dir/build-apk.sh" "$@"
fi

if [[ "$variant" == debug ]]; then
  export NODE_ENV=development
else
  export NODE_ENV=production
fi
# Keep build caches in the project; no system SDK or global Gradle is needed.
export GRADLE_USER_HOME="$project_dir/.gradle-apk"
pnpm install --frozen-lockfile --prod=false
# Expo prebuild rewrites the Android/iOS development scripts. Restore our package
# file afterward so an APK build does not change the Expo Go commands.
package_backup="$(mktemp)"
cp package.json "$package_backup"
restore_package() { cp "$package_backup" package.json; rm -f "$package_backup"; }
trap restore_package EXIT
pnpm exec expo prebuild --platform android --no-install --no-clean
restore_package
trap - EXIT

# Expo's generated release variant uses its local debug signing key. This is a
# sideload build, not a Play Store upload. Keep the key stable across prebuilds.
mkdir -p .apk-signing dist
chmod 700 .apk-signing
if [[ ! -f .apk-signing/local.keystore ]]; then
  keytool -genkeypair -noprompt -keystore .apk-signing/local.keystore \
    -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Reducto Local Build'
fi
cp .apk-signing/local.keystore android/app/debug.keystore

gradle_options=()
if [[ "${APK_BUILD_VERBOSE:-0}" == 1 ]]; then
  gradle_options+=(--info)
fi
(
  cd android
  ./gradlew ":app:$gradle_task" --no-daemon --console=plain \
    --max-workers="${APK_BUILD_JOBS:-2}" \
    -PreactNativeArchitectures="${APK_ARCHITECTURES:-arm64-v8a,armeabi-v7a}" \
    -Pandroid.cmakeVersion=3.22.1 "${gradle_options[@]}"
) | tee "$GRADLE_USER_HOME/build.log"
apk="android/app/build/outputs/apk/$variant/app-$variant.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "$apk"
cp "$apk" "dist/$output_name.apk"
sha256sum "dist/$output_name.apk" > "dist/$output_name.apk.sha256"
printf '\nAPK built: %s/dist/%s.apk\n' "$project_dir" "$output_name"

{
  pkgs ? import <nixpkgs> {
    config = {
      allowUnfree = true;
      android_sdk.accept_license = true;
    };
  },
}:
let
  android = pkgs.androidenv.composeAndroidPackages {
    toolsVersion = null;
    platformVersions = [ "36" ];
    # Some transitive native modules retain AGP's Build Tools 35 default.
    buildToolsVersions = [
      "35.0.0"
      "36.0.0"
    ];
    includeNDK = true;
    ndkVersions = [ "27.1.12297006" ];
    includeCmake = true;
    cmakeVersions = [ "3.22.1" ];
    includeEmulator = false;
  };
  sdk = "${android.androidsdk}/libexec/android-sdk";
in
pkgs.buildFHSEnv {
  name = "reducto-android-build";
  targetPkgs = p: [
    p.bash
    p.coreutils
    p.findutils
    p.gnugrep
    p.gnused
    p.git
    p.nodejs_22
    p.pnpm_9
    p.jdk21
    p.curl
    p.unzip
    p.zip
    p.glibc
    p.zlib
    p.stdenv.cc.cc.lib
    android.androidsdk
  ];
  profile = ''
    export JAVA_HOME=${pkgs.jdk21.home}
    export ANDROID_HOME=${sdk}
    export ANDROID_SDK_ROOT=${sdk}
    export REDUCTO_ANDROID_BUILD_ENV=1
    export GRADLE_OPTS="-Dorg.gradle.project.android.aapt2FromMavenOverride=${sdk}/build-tools/36.0.0/aapt2 ''${GRADLE_OPTS:-}"
  '';
  runScript = "bash";
}

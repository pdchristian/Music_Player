#!/usr/bin/env bash
# BeatClip – iOS-Build auf dem Mac (unter Windows nicht moeglich).
#
# Voraussetzungen (einmalig):
#   • macOS mit Xcode (App Store) + `xcode-select --install`
#   • Node 18+  (https://nodejs.org)
#   • CocoaPods:  sudo gem install cocoapods   (oder: brew install cocoapods)
#   • Apple-ID in Xcode -> Einstellungen -> Accounts (fuer Signing)
#
# Aufruf:
#   ./tools/build_ios.sh              Debug-Build, direkt aufs iPhone (xcodebuild + devicectl)
#   ./tools/build_ios.sh clean        Nur Xcode-Caches zuruecksetzen (IDE-Fehler
#                                     "Unable to resolve module dependency: 'Capacitor'")
#   CLEAN=1 ./tools/build_ios.sh ...  Caches vor dem Build zuruecksetzen
#   ./tools/ios_fix.sh                Caches + Pods erneuern und App.xcworkspace oeffnen
#   ./tools/build_ios.sh ipa          Ad-hoc-.ipa fuer dist/ios (Signing-Nachweise noetig, s.u.)
#   ./tools/build_ios.sh sim          Build+Start im iOS-Simulator
#   ./tools/build_ios.sh testflight   Release-Archiv fuer TestFlight (liegt im Xcode-Organizer)
#   ./tools/build_ios.sh testflight-upload   Archiv + Direkt-Upload zu App Store Connect
#       dafuer Umgebungsvariablen setzen (App Store Connect -> Benutzer und Zugriffe
#       -> Integrationen -> "App Store Connect API", Rolle Entwickler oder Admin):
#         ASC_KEY_PATH=/pfad/AuthKey_XXXXXXXX.p8  ASC_KEY_ID=XXXXXXXX  ASC_ISSUER_ID=xxxxxxxx-xxxx-...
#
# TestFlight-Vorbereitung (einmalig):
#   • Bezahltes Apple-Developer-Konto, App mit Bundle-ID com.beatclip-music.app in
#     App Store Connect anlegen. Version/Build stehen im Xcode-Projekt
#     (ios/App/App.xcodeproj -> MARKETING_VERSION / CURRENT_PROJECT_VERSION).
#   • Apple-Distribution-Zertifikat legt Xcode beim ersten Upload automatisch an.
#
# Ad-hoc-Signing vorbereiten (einmal pro Geraet):
#   1. Geraet per USB an den Mac, in Xcode -> Fenster -> Geraete und Simulator
#      -> Geraet registrieren.
#   2. Xcode -> Einstellungen -> Accounts -> Team hinzufuegen (persoenliche
#      Apple-ID reicht fuer 7-Tage-Sideload).
#   3. In ios/App das Target App -> Signing & Capabilities -> Team waehlen,
#      "Bundle Identifier" com.beatclip-music.app lassen. Speichern (pbxproj bleibt
#      sonst ohne Team). Alternativ TEAM_ID unten setzen.
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-device}"
TEAM_ID="${TEAM_ID:-}"          # z.B. ABCDEFG123; leer = Xcode-Automatik
BUILDDIR="build_ios"

# Nur-Caches-Modus: kein npm/pod/xcodebuild, nur Xcode-Caches weg.
if [ "$MODE" = "clean" ]; then
  ./tools/ios_clean.sh
  exit 0
fi

echo "==> npm ci"
npm ci

echo "==> iOS-Assets erzeugen"
node tools/make_ios_assets.js

echo "==> cap sync ios"
npx cap sync ios

echo "==> pod install"
(cd ios/App && pod install)

# Ziel-Abhaengigkeit App -> Pods-App auffrischen (damit auch App.xcodeproj allein baut).
node tools/ios_pods_dependency.js

# CLEAN=1: veraltete Xcode-Caches (Modul-Cache, Index) vor dem Build entsorgen, damit auch der
# IDE-Index danach wieder Capacitor/BeatclipMedia findet.
if [ -n "${CLEAN:-}" ]; then ./tools/ios_clean.sh; fi

mkdir -p "$BUILDDIR" dist/ios

# Persoenliches Entwicklungsprofil: xcodebuild kann mit -allowProvisioningUpdates
# automatisch Profile erzeugen/aktualisieren (dafuer Apple-ID im Token-Stored).
XC_BASE=(-workspace ios/App/App.xcworkspace -scheme App
         -allowProvisioningUpdates -allowProvisioningDeviceRegistration)
XC_ARGS=("${XC_BASE[@]}" -configuration Debug)
XC_ARGS_TF=("${XC_BASE[@]}" -configuration Release)   # TestFlight/Archive
if [ -n "$TEAM_ID" ]; then
  XC_ARGS+=(DEVELOPMENT_TEAM="$TEAM_ID"); XC_ARGS_TF+=(DEVELOPMENT_TEAM="$TEAM_ID")
fi

case "$MODE" in
  sim)
    # Simulator waehlen: SIM="iPhone 17 Pro" oder SIM=<UDID>; leer/fehlend -> erstes freie iPhone.
    SIM="${SIM:-iPhone 15}"
    UDID="$(xcrun simctl list devices available | sed -n "s/^ *${SIM} (\([0-9A-Fa-f-]\{36\}\)).*/\1/p" | head -1 || true)"
    if [ -z "$UDID" ]; then
      UDID="$(xcrun simctl list devices available | grep -E '^ *(iPhone|iPad) ' \
              | sed -n 's/.*(\([0-9A-Fa-f-]\{36\}\)) *(Shutdown).*/\1/p' | head -1 || true)"
      echo "   Simulator '$SIM' nicht vorhanden -> nutze $UDID"
    fi
    [ -n "$UDID" ] || { echo "Kein Simulator gefunden (xcrun simctl list devices)." >&2; exit 1; }
    xcrun simctl boot "$UDID" 2>/dev/null || true
    xcrun simctl bootstatus "$UDID" -b
    xcodebuild "${XC_ARGS[@]}" -destination 'generic/platform=iOS Simulator' \
      -sdk iphonesimulator -derivedDataPath "$BUILDDIR/DerivedData" build
    APP="$BUILDDIR/DerivedData/Build/Products/Debug-iphonesimulator/App.app"
    xcrun simctl install "$UDID" "$APP"
    xcrun simctl launch "$UDID" com.beatclip-music.app
    echo "==> BeatClip laeuft im Simulator $UDID"
    ;;
  device)
    xcodebuild "${XC_ARGS[@]}" -destination 'generic/platform=iOS' \
      -derivedDataPath "$BUILDDIR/DerivedData" -allowProvisioningUpdates build
    APP="$BUILDDIR/DerivedData/Build/Products/Debug-iphoneos/App.app"
    echo "==> App gebaut: $APP"
    echo "   Installiere sie mit:  xcrun devicectl device install app --device <UDID> \"$APP\""
    echo "   Gerate-UDID anzeigen: xcrun devicectl list devices"
    ;;
  ipa)
    # Ad-hoc-Archiv -> exportOptions fuer Geraete-Sideload ohne App Store.
    xcodebuild "${XC_ARGS[@]}" -destination 'generic/platform=iOS' \
      -archivePath "$BUILDDIR/App.xcarchive" archive
    cat > "$BUILDDIR/export_adhoc.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>ad-hoc</string>
  <key>destination</key><string>export</string>
  <key>signingStyle</key><string>automatic</string>
  <key>compileBitcode</key><false/>
</dict>
</plist>
PLIST
    xcodebuild -exportArchive -archivePath "$BUILDDIR/App.xcarchive" \
      -exportOptionsPlist "$BUILDDIR/export_adhoc.plist" -exportPath dist/ios \
      -allowProvisioningUpdates
    echo "==> dist/ios/App.ipa gebaut (Ad-hoc). Installation z.B. mit Apple Configurator, dem"
    echo "   Apple Development-Tool 'xcrun devicectl device install app', oder 'cfgutil'."
    ;;
  testflight)
    # Release-Archiv im Ordner, den Xcode im Organizer (Fenster -> Organizer) anzeigt.
    ARC="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/App-$(date +%H.%M.%S).xcarchive"
    mkdir -p "$(dirname "$ARC")"
    xcodebuild "${XC_ARGS_TF[@]}" -destination 'generic/platform=iOS' \
      -archivePath "$ARC" archive
    INFO="$ARC/Products/Applications/App.app/Info.plist"
    echo "==> Archiv: $ARC"
    echo "    Version: $(plutil -extract CFBundleShortVersionString raw "$INFO")" \
         "(Build $(plutil -extract CFBundleVersion raw "$INFO"))"
    echo "    Jetzt in Xcode: Fenster -> Organizer -> dieses Archiv -> Distribute App"
    echo "    -> App Store Connect -> Upload (TestFlight-Internes Testprogramm waelhen)."
    ;;
  testflight-upload)
    # Archiv bauen und direkt zu App Store Connect hochladen (TestFlight).
    : "${ASC_KEY_PATH:?ASC_KEY_PATH=/pfad/zu/AuthKey_XXXXXXXX.p8 noetig}"
    : "${ASC_KEY_ID:?ASC_KEY_ID (Schluessel-ID aus App Store Connect) noetig}"
    : "${ASC_ISSUER_ID:?ASC_ISSUER_ID (Issuer-ID aus App Store Connect) noetig}"
    ARC="$HOME/Library/Developer/Xcode/Archives/$(date +%Y-%m-%d)/App-$(date +%H.%M.%S).xcarchive"
    mkdir -p "$(dirname "$ARC")"
    xcodebuild "${XC_ARGS_TF[@]}" -destination 'generic/platform=iOS' \
      -archivePath "$ARC" archive
    xcodebuild -exportArchive -archivePath "$ARC" \
      -exportOptionsPlist tools/export_testflight.plist \
      -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" \
      -authenticationKeyIssuerID "$ASC_ISSUER_ID" -allowProvisioningUpdates
    echo "==> Build hochgeladen. App Store Connect -> Testen -> Build frueheren Testern zuweisen."
    ;;
  *)
    echo "Unbekannter Modus: $MODE (erlaubt: device | sim | ipa | testflight | testflight-upload | clean)" >&2
    exit 1 ;;
esac

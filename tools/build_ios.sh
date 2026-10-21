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
#   ./tools/build_ios.sh ipa          Ad-hoc-.ipa fuer dist/ios (Signing-Nachweise noetig, s.u.)
#   ./tools/build_ios.sh sim          Build+Start im iOS-Simulator
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

echo "==> npm ci"
npm ci

echo "==> iOS-Assets erzeugen"
node tools/make_ios_assets.js

echo "==> cap sync ios"
npx cap sync ios

echo "==> pod install"
(cd ios/App && pod install)

mkdir -p "$BUILDDIR" dist/ios

# Persoenliches Entwicklungsprofil: xcodebuild kann mit -allowProvisioningUpdates
# automatisch Profile erzeugen/aktualisieren (dafuer Apple-ID im Token-Stored).
XC_ARGS=(-workspace ios/App/App.xcworkspace -scheme App -configuration Debug
         -allowProvisioningUpdates -allowProvisioningDeviceRegistration)
if [ -n "$TEAM_ID" ]; then XC_ARGS+=(DEVELOPMENT_TEAM="$TEAM_ID"); fi

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
  *)
    echo "Unbekannter Modus: $MODE (erlaubt: device | ipa | sim)" >&2; exit 1 ;;
esac

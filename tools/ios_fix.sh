#!/usr/bin/env bash
# BeatClip – iOS-IDE reparieren: Caches loeschen, Pods einspielen, Workspace oeffnen.
#
# Hilft bei Fehlern wie
#   AppDelegate -> Unable to resolve module dependency: 'Capacitor'
#   AppDelegate -> Unable to resolve module dependency: 'BeatclipMedia'
#
# Wichtig: BeatClip-Quellen in Xcode immer ueber ios/App/App.xcworkspace oeffnen, NIE ueber
# App.xcodeproj. Die Pods (Capacitor, BeatclipMedia) haengen nur als Projekt an dem Workspace; eine
# einzeln geoeffnete .xcodeproj kann sie nicht finden; Xcode versucht stattdessen eine automatische
# "module dependency"-Aufloesung (Swift Package Manager) -> rote Fehler, obwohl der Build per
# xcodebuild laeuft.
#
# Aufruf:  ./tools/ios_fix.sh              DEEP=1 ./tools/ios_fix.sh  (zusatzlich globale Modul-Caches)
set -euo pipefail
cd "$(dirname "$0")/.."

./tools/ios_clean.sh

# Xcode-Fensterzustand zuruecksetzen, falls das System ihn noch speichert.
SAVED="$HOME/Library/Saved Application State/com.apple.dt.Xcode.savedState"
if [ -d "$SAVED" ]; then
  echo "==> Entferne Xcode-Fensterzustand"
  rm -rf "$SAVED"
fi

echo "==> iOS-Assets erzeugen"
node tools/make_ios_assets.js

echo "==> cap sync ios"
npx cap sync ios

echo "==> pod install"
(cd ios/App && pod install)

# Dafuer sorgen, dass App.xcodeproj die Pods-Targets selbst mitbaut (unabhaengig vom Workspace).
node tools/ios_pods_dependency.js

# Benutzerzustand des iOS-Projekts wegnehmen (alte Fenster-/Schemazustande), damit nichts
# Ueberkommenes zurueckkehrt; geteiltes Schema liegt unter xcshareddata/xcschemes.
find ios/App -type d -name xcuserdata -prune -exec rm -rf {} + 2>/dev/null || true

# Vorab in die Standard-DerivedData von Xcode bauen, damit der Editor die Module sofort findet
# (Workspace UND App.xcodeproj – beides soll ohne rote Fehler oeffnet werden koennen).
warm() {   # $1 = -workspace|-project, $2 = Pfad; baut in die Standard-DerivedData von Xcode
  local log="build_ios/ide_warm.log"
  echo "==> Vorab-Build fuer den Editor: $2"
  if xcodebuild "$1" "$2" -scheme App -configuration Debug \
       -destination 'generic/platform=iOS Simulator' -quiet build > "$log" 2>&1; then
    echo "    ok"
  else
    echo "    fehlgeschlagen – Details in $log"
    return 1
  fi
}
if [ -z "${NOWARM:-}" ]; then
  mkdir -p build_ios
  warm -workspace ios/App/App.xcworkspace || echo "   (bitte ./tools/build_ios.sh sim|device nutzen)"
  warm -project ios/App/App.xcodeproj || echo "   (bitte ./tools/build_ios.sh sim|device nutzen)"
fi

echo "==> Oeffne ios/App/App.xcworkspace (Workspace, nicht App.xcodeproj)"
open "ios/App/App.xcworkspace"

# macOS/Xcode oeffnet beim Start gern das zuletzt benutzte Dokument erneut – das war bisher fast
# immer App.xcodeproj, also genau das Fenster mit den Modulfehlern. Solche Fenster schliessen.
for _ in $(seq 1 30); do pgrep -x Xcode >/dev/null && break; sleep 1; done
sleep 3
osascript <<'OSA' 2>/dev/null || echo "   (Automation nicht erlaubt – bitte das App.xcodeproj-Fenster selbst schliessen)"
tell application "System Events"
  tell process "Xcode"
    repeat 5 times
      set winList to (every window whose name contains "App.xcodeproj")
      if (count of winList) is 0 then exit repeat
      perform action "AXRaise" of (item 1 of winList)
      delay 0.5
      keystroke "w" using command down
      delay 0.8
    end repeat
  end tell
end tell
OSA

echo "==> Fertig. Falls die Fehler weiterhin erscheinen: Xcode -> Product -> Clean Build Folder."

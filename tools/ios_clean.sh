#!/usr/bin/env bash
# BeatClip – Xcode-Caches für das iOS-Projekt zurücksetzen.
#
# Löst das immer wiederkehrende Problem
#     AppDelegate → "Unable to resolve module dependency: 'Capacitor'" / "'BeatclipMedia'"
# Es werden ausschliesslich regenerierbare Cache-Ordner gelöscht, kein Quellcode.
#
# Ursachen, die hier dauerhaft beseitigt werden:
#   1. Build-Artefakte (build_ios/DerivedData, Modul-Header-Caches, Index) waren frueher im Git
#      und wandern zwischen Windows- und Mac-Arbeitsplatz mit -> Xcode index mit Fremd-Caches.
#   2. ios/App/Pods liegt nicht im Git. Wird der Workspace vor `pod install` geoeffnet, zeigt er
#      auf ein fehlendes Pods-Projekt -> alle Pod-Module gelten als "dependency" (SPM-Fehler).
#   3. Veraltete Paket-/Framework-Metadaten (~/Library/Caches/BundleMetadata) halten den Zustand.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

DEEP="${DEEP:-}"                 # DEEP=1 zusaetzlich globalen Modul-Cache + BundleMetadata

quit_xcode() {
  local pids
  pids="$(pgrep -x Xcode || true)"
  [ -n "$pids" ] || return 0
  echo "==> Xcode beenden (sonst schreibt es die Caches sofort zurueck)"
  osascript -e 'tell application "Xcode" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    pgrep -x Xcode >/dev/null || return 0
    sleep 1
  done
  for p in $pids; do kill "$p" 2>/dev/null || true; done
  sleep 2
}

# 1. Altlasten im Repo (Build-Artefakte, die nie ins Git gehoeren)
for d in build_ios/DerivedData build_ios/ModuleCache.noindex; do
  if [ -d "$d" ]; then echo "==> Entferne $d"; rm -rf "$d"; fi
done
find ios/App -name "Package.resolved" -delete 2>/dev/null || true

# 2. DerivedData von Xcode – nur Ordner, die zu DIESEM Projekt gehoeren (info.plist pruefen)
DERI="$HOME/Library/Developer/Xcode/DerivedData"
if [ -d "$DERI" ]; then
  for d in "$DERI"/*; do
    [ -f "$d/info.plist" ] || continue
    wp="$(plutil -extract WorkspacePath raw "$d/info.plist" 2>/dev/null || true)"
    case "$wp" in
      "$ROOT/ios/App/App.xcodeproj"|"$ROOT/ios/App/App.xcworkspace")
        echo "==> Entferne ${d#"$HOME"/}"
        rm -rf "$d" ;;
    esac
  done
fi

# 3. Globaler Modul-Cache / Framework-Metadaten (nur bei DEEP=1, naechster Build wird langsamer)
if [ -n "$DEEP" ]; then
  if [ -d "$DERI/ModuleCache.noindex" ]; then
    echo "==> Entferne ModuleCache.noindex"; rm -rf "$DERI/ModuleCache.noindex"
  fi
  if [ -d "$HOME/Library/Caches/BundleMetadata" ]; then
    echo "==> Entferne BundleMetadata-Cache"; rm -rf "$HOME/Library/Caches/BundleMetadata"
  fi
fi

echo "==> Caches sauber."

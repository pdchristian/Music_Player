# BeatClip – native iOS-App

BeatClip gibt es jetzt auch als **echte iOS-App** (iPhone/iPad): eine Capacitor-Hülle mit
eigener Swift-Schicht für Hintergrundwiedergabe, „Now Playing“ (Sperrbildschirm,
Kontrollzentrum, Lockscreen) und Bluetooth-/Headset-Tasten. Die Oberfläche ist dieselbe
BeatClip-Web-UI aus [`app/`](app/) – Android- und iOS-Version teilen sich den Code,
die Brücke `BeatClipMedia` hat auf beiden Seiten dieselbe API.

Package-Name: `com.beatclip.app` · Deployment-Ziel iOS 13+ · iPad-Unterstützung an

> **Wichtig:** iOS-Pakete können **nur auf einem Mac mit Xcode** gebaut werden.
> Dieser Arbeitsordner (Windows) enthält das komplette iOS-Projekt inklusive
> Native-Schicht; der Build läuft über [`tools/build_ios.sh`](tools/build_ios.sh) auf dem Mac.
> Ein fertiges `.ipa` liegt deshalb (noch) nicht in [`dist/ios/`](dist/ios/).

---

## 1. Installation aufs iPhone

### Variante A: direkt aus Xcode (einfachster Weg)
1. Projektordner auf den Mac kopieren (z. B. per Git/USB – `node_modules` nicht nötig).
2. `npm install && npm run ios:open` → Xcode öffnet das Projekt, Gerät per USB anschließen.
3. Target **App → Signing & Capabilities**: Team wählen (persönliche Apple-ID genügt).
4. ▶-Knopf drücken – BeatClip läuft direkt auf dem Gerät (Profile/Signatur erledigt Xcode).

### Variante B: Skript-Build + Installation
```bash
./tools/build_ios.sh device   # baut Debug-App und nennt den Installationsbefehl
xcrun devicectl list devices
xcrun devicectl device install app --device <UDID> build_ios/DerivedData/Build/Products/Debug-iphoneos/App.app
```

### Variante C: fertige .ipa (Ad-hoc)
```bash
./tools/build_ios.sh ipa      # -> dist/ios/App.ipa
```
Installation z. B. mit Apple Configurator, `xcrun devicectl device install app` oder
jedem anderen IPA-Installer. **Gültigkeit:** mit einer persönlichen Apple-ID signiert
läuft die App **7 Tage** (danach neu bauen/signieren); einem bezahlten
Apple-Developer-Konto (99 $/Jahr) gehören 1-Jahr-Ad-hoc-Signaturen und **TestFlight**
(Verteilung an bis zu 10.000 Tester, ohne USB).

### Update einer vorhandenen Installation
Solange mit demselben Team signiert wird, bleibt beim Drüberinstallieren alles erhalten
(Bibliotheken, Schnitte – sie liegen im App-Sandbox-Speicher).

---

## 2. Bauen / neu bauen (auf dem Mac)

Voraussetzungen, einmalig:
- macOS mit **Xcode** (App Store) + `xcode-select --install`
- **Node 18+**, **CocoaPods** (`sudo gem install cocoapods` oder `brew install cocoapods`)
- Apple-ID in Xcode → Einstellungen → Accounts

```bash
npm install
npm run assets:ios   # AppIcon + Splash neu erzeugen (reines Node-Skript)
npm run sync:ios     # app/ -> ios/App/App/public, Plugin-Pods, packageClassList
./tools/build_ios.sh sim | device | ipa
```

Unter Windows/macOS gleich: Alles, was **keinen** iOS-Toolchain braucht (Web-UI,
Assets, Podfile-Einträge, Plugin-Registrierung), passiert bereits per `npm run sync:ios`
– auf dem Mac läuft dann nur noch `pod install` + `xcodebuild`.

---

## 3. Was die native Schicht tut

| Datei | Zweck |
|---|---|
| `plugins/beatclip-media/ios/Sources/BeatClipMediaPlugin.swift` | Die ganze Swift-Brücke (lokales Capacitor-Plugin): AVAudioSession (`.playback`) für Hintergrundton, Now-Playing-Info (Titel/Interpret/Cover/Fortschritt), `MPRemoteCommandCenter` für Tasten (Play/Pause/Weiter/Zurück/Seek → Ereignis `mediaAction` an JS), Abbruch-Behandlung bei Anrufen (Pause, bei Rückkehr Weiter), Posteingang `Documents/shared` mit `getSharedFiles/readSharedFile/…` – exakt dieselbe JS-API wie `BeatClipMediaPlugin.java` auf Android |
| `ios/App/App/AppDelegate.swift` | „Öffnen in → BeatClip“: Audiodateien (≤ 64 MB) werden sicher in den Posteingang kopiert |
| `ios/App/App/Info.plist` | `UIBackgroundModes: audio` (Hintergrundton erlaubt), `CFBundleDocumentTypes` (BeatClip erscheint unter „Öffnen in“ für MP3/M4A/WAV/AIFF/FLAC/MP4) |
| `plugins/beatclip-media/BeatclipMedia.podspec` | Bindet die Swift-Quellen als CocoaPods-Pod `BeatclipMedia` ein (Name muss zum Capacitor-Paketnamen passen) |
| `app/app.js` (Abschnitt „Native Brücke“) | Dasselbe JS wie auf Android: spiegelt die Wiedergabe in Now Playing (Cover inklusive), reagiert auf Tasten (bleibt innerhalb des Schnitts), holt den Posteingang beim Kalt- **und** Warmstart (Sichtbarkeitswechsel), deaktiviert Service Worker; die private Safari-API `setActiveMediaElement` wird in der nativen App nicht mehr angerufen |
| `ios/App/App/Assets.xcassets` | AppIcon (1024 px, Xcode erzeugt alle Größen) und Splash (dunkler Grund) – erzeugt von `tools/make_ios_assets.js` |

### Hintergrund / Bluetooth
- Dank `UIBackgroundModes: audio` + `AVAudioSession (.playback)` spielt die App weiter,
  wenn das Display sperrt oder die App in den Hintergrund geht.
- „Now Playing“ erscheint im **Kontrollzentrum, auf dem Sperrbildschirm und beim
 Verbinden von Bluetooth-Kopfhörern** mit Titel, Interpret und Cover.
- **Knöpfe an Headset/Lautsprecher-Fernbedienung** (Play/Pause, Weiter, Zurück, Seek aus
  dem Slider) wirken direkt auf BeatClip – der Seek bleibt dabei wie auf Android innerhalb
  des Schnitts (S→E).
- Bei einem **Anruf** pausiert die Wiedergabe automatisch; nach dem Gesprächsende spielt
  sie weiter, wenn iOS das Signal `shouldResume` liefert.
- **Bluetooth-Lautsprecher (A2DP):** in den iOS-Einstellungen verbinden; AirPlay-Ziele
  sind im Kontrollzentrum wählbar.

### Audiodateien in die App bekommen
1. **„Öffnen in → BeatClip“** – Dateien-App (oder Downloads): Audio-Datei antippen →
   Teilen-Symbol → *Öffnen in* → **BeatClip**. Der Titel erscheint beim nächsten
   App-Fokus automatisch in der Bibliothek.
2. **Import in der App** – Bibliothek → *Importieren* (iOS-Dateiauswahl, mehrere Dateien).
3. Drag & Drop gibt es in der nativen iOS-App nicht (nur im Browser/PWA-Modus).

Alle Dateien liegen lokal im App-Sandbox (IndexedDB); keine Uploads, kein Konto.

### Aufnehmen und Kanäle exportieren
- Bibliothek → **Aufnahme** startet die Mikrofonaufnahme; **Aufnahme beenden** speichert sie automatisch in der lokalen Bibliothek. iOS fragt nach Mikrofonzugriff.
- Im Menü eines Titels **Stereo-Kanäle extrahieren** wählen und bei der gewünschten Mono-WAV-Datei auf **Speichern** tippen, um den iOS-Dateiexport mit Speicherortauswahl zu öffnen. Bei Mehrkanal-Audio wird jeder Kanal exportiert; Mono-Dateien sind nicht teilbar.

### Schnitt (Start/Ende) unverändert
Wie gehabt: Playlist → Titel → *Schnitt* → Griffe **S**/**E** auf der Waveform.
Auch Now-Playing-Seeking und die Headset-Tasten stoppen bzw. springen innerhalb des Schnitts.

---

## 4. Bekannte Grenzen / Hinweise
- **Build nur auf dem Mac** (Xcode + CocoaPods). Dieser Windows-Ordner liefert alles
  außer Compilieren; `npx cap sync ios` läuft aber auch hier (Podfile, Registrierung).
- iOS zeigt nur **ein** Bedienfeld: Die Web-Media-Session ist in der nativen App deaktiviert,
  alles kommt von `MPNowPlayingInfoCenter`/`MPRemoteCommandCenter`.
- Persönliche Apple-ID: Signatur **7 Tage** gültig, Ad-hoc auf 3 eigene Geräte beschränkt;
  für bequeme Verteilung TestFlight (Developer-Konto) nutzen.
- FLAC/OGG: WKWebView decodiert MP3, AAC/M4A, WAV, AIFF und FLAC (iOS 11+); OGG/Opus
  nicht – diese Titel wie bisher in der PWA- oder Android-Version nutzen.
- Nach einem iOS-Update ggf. einmal `pod install` + neu bauen, wenn Apple die
  Capacitor-Pods neu compiliert haben will.
- Push-Benachrichtigungen braucht BeatClip nicht; die Medienleiste ist davon unabhängig.

---

## 5. Projektstruktur (iOS-bezogen)
```
ios/                       Capacitor-iOS-Projekt (App.xcworkspace, Podfile, Info.plist, AppDelegate)
plugins/beatclip-media/    lokales Capacitor-Plugin: Swift-Bruecke + BeatclipMedia.podspec
tools/make_ios_assets.js   AppIcon + Splash fuer ios/App/App/Assets.xcassets
tools/build_ios.sh         Build-Anleitung/Ablauf auf dem Mac (sim | device | ipa)
dist/ios/                  Ziel fuer gebaute .ipa (hier nicht gebaut)
```
Der Rest (Web-UI, Android-Projekt, Signing) steht in [README-ANDROID.md](README-ANDROID.md).

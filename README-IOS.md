# BeatClip – native iOS-App

BeatClip gibt es jetzt auch als **echte iOS-App** (iPhone/iPad): eine Capacitor-Hülle mit
eigener Swift-Schicht für Hintergrundwiedergabe, „Now Playing“ (Sperrbildschirm,
Kontrollzentrum, Lockscreen) und Bluetooth-/Headset-Tasten. Die Oberfläche ist dieselbe
BeatClip-Web-UI aus [`app/`](app/) – Android- und iOS-Version teilen sich den Code,
die Brücke `BeatClipMedia` hat auf beiden Seiten dieselbe API.

Package-Name iOS: `com.beatclip-music.app` (Android bleibt `com.beatclip.app`) · Deployment-Ziel iOS 15+ (Xcode 26/27 baut keine Ziele unter 15.0) · iPad-Unterstützung an · App-Store-Name: „BeatClip Player“ („BeatClip“ war in App Store Connect bereits vergeben)

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

### Variante D: TestFlight (verteilt über App Store Connect, ohne USB)
```bash
npm run ios:testflight      # = ./tools/build_ios.sh testflight
```
Das Skript baut das **Release-Archiv** und legt es im Organizer-Ordner von Xcode ab
(`~/Library/Developer/Xcode/Archives/<Datum>/App-<Zeit>.xcarchive`). Danach in Xcode:

1. **Fenster → Organizer** → oberstes Eintrag → **Distribute App…**
2. **App Store Connect** → **Upload**, Signing *Automatically managed* – Xcode erzeugt das
   Apple-Distribution-Zertifikat und das App-Store-Profil beim ersten Mal automatisch.
3. App Store Connect → *Builds* → Build für das **interne Testtesting** auswählen → Tester
   per E-Mail (bis zu 100 interne) oder per Link (bis zu 10.000 externe, mit Review).

**Ohne Xcode-GUI** (Archiv + Export + Upload in einem Schritt) – dafür ein Team-Key unter
*App Store Connect → Benutzer und Zugriffe → Integrationen → App Store Connect API*
(Rolle *Entwickler* genügt), `.p8` einmalig heruntergeladen:

```bash
ASC_KEY_PATH=~/AuthKey_ABCDEF1234.p8 \
ASC_KEY_ID=ABCDEF1234 \
ASC_ISSUER_ID=0f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8 \
  npm run ios:testflight:upload
```

Export-Einstellungen stehen in [`tools/export_testflight.plist`](tools/export_testflight.plist)
(`method: app-store-connect`, `destination: upload`, `teamID: CH9M2M9R7N`). Das Skript legt
das Archiv wie oben ab und lädt den Build danach direkt hoch. Ein bereits fertig
signiertes .ipa (App-Store-Profil) liegt in [`dist/ios/`](dist/ios/) – alternativ damit die
Mac-App **Transporter** zum Hochladen verwenden.

**Version/Build** kommen aus `ios/App/App.xcodeproj` (`MARKETING_VERSION`,
`CURRENT_PROJECT_VERSION`) und halten zu `app/app.js` (`APP_VER`/`APP_BUILD`) und
`android/app/build.gradle` (aktuell **1.3.1**, Build **11**). App Store Connect weist einen
Upload ab, wenn die Build-Nummer innerhalb derselben Version schon vergeben ist – dann
`CURRENT_PROJECT_VERSION` erhöhen und neu archivieren. Beim ersten Upload fragt
App Store Connect nach der **Export Compliance**; die App nutzt nur Standard-TLS, die
Antwort lautet „nein“ (dauerhaft abkürzbar mit `ITSAppUsesNonExemptEncryption = false`
in `ios/App/App/Info.plist`).

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
./tools/build_ios.sh sim | device | ipa | testflight
CLEAN=1 ./tools/build_ios.sh device   # vorher alle Xcode-Caches zurücksetzen
```

Wenn Xcode rote Fehler anzeigt, der Build aber durchläuft → `npm run ios:fix`
(Caches löschen, Assets/`cap sync`/`pod install` erneuern, **`App.xcworkspace`** öffnen).

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
- Im Menü eines Titels **Stereo-Kanäle extrahieren** wählen, dort das Format (Chips **WAV / MP3 / M4A**) auswählen und bei der gewünschten Mono-Datei auf **Speichern** tippen, um den iOS-Dateiexport mit Speicherortauswahl zu öffnen; M4A wird dort nativ (AVAudioFile/AAC) kodiert. Das Sheet zeigt währenddessen Fortschritt (Spinner, Phasentext, Balken) – **Sheet schließen bricht ab** und löscht die temporären Dateien. Bei Mehrkanal-Audio wird jeder Kanal exportiert; Mono-Dateien sind nicht teilbar.

### Schnitt (Start/Ende) unverändert
Wie gehabt: Playlist → Titel → *Schnitt* → Griffe **S**/**E** auf der Waveform.
Auch Now-Playing-Seeking und die Headset-Tasten stoppen bzw. springen innerhalb des Schnitts.

### Lautstärke und Blendzeit („Ausblenden an Schnittkante“)
- **iOS ignoriert `audio.volume`** – Apple: „The volume property is not settable in
  JavaScript. Reading the volume property always returns 1.“ Deshalb wirkten auf iOS
  weder der Lautstärke-Regler noch die Blendung (Android hält sich daran, dort funktionierte
  alles).
- Deshalb hängt [`app/app.js`](app/app.js) (Abschnitt **„Gain-Pfad“**) das `audio`-Element
  auf iOS **einmal pro App-Lauf** über `createMediaElementSource` an einen **GainNode**
  (Web Audio) und legt dort Grundlautstärke *und* Blendung an. Auf Android und in der PWA
  bleibt es beim bisherigen `audio.volume`.
- Der AudioContext braucht eine erste Berührung: beim App-Start genügt das Antippen von
  *Abspielen*; zusätzlich fängt `armWaGesture()` jede Berührung ab und holt einen von iOS
  abgewählten Kontext zurück (`resumeWa()` aus `loop()`/`timeupdate`).
- Die Rampe wird gleichzeitig von Intervall, `requestAnimationFrame` **und** dem
  `timeupdate`-Ereignis getaktet – im Hintergrund drosselt iOS Intervalle auf ~1 s und rAF
  ruht ganz, `timeupdate` läuft aber weiter. Das verbessert auch die Blendung auf Android.
- **Blendzeit maximal 10 s** (Vorher: 4 s). Wie bisher gilt zusätzlich die halbe
  Schnittlänge als Obergrenze, damit sich Fade-In und Fade-Out nie überlappen; in 0,5-s-
  Schritten bis 4 s, darüber in ganzen Sekunden.
- Abschaltbar in den **Einstellungen → „Lautstärke über Web Audio (iOS)“** (Standard: Ein).
  Wegschalten wirkt erst nach einem **Neustart** der App, weil sich die Anbindung des
  Media-Elements an Web Audio nicht rückgängig machen lässt.

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

### Fehlerbehebung
- **Lautstärke-Regler ohne Effekt / Blendung („Ausblenden an Schnittkante“) bleibt hart**:
  iOS ignoriert `audio.volume`, geholfen wird über den Web-Audio-Gain-Pfad
  (Abschnitt *Lautstärke und Blendzeit* oben). Prüfen: Einstellungen → „Lautstärke über
  Web Audio (iOS)“ steht auf **Ein**, und die App wurde nach dem Umschalten **neu
  gestartet**. Spielt die App bei gesperrtem Bildschirm gar nicht oder bricht sie dort hart
  ab (iOS hat das Web-Audio-Rendering abgewählt), den Schalter auf **Aus** stellen und die
  App neu starten – dann läuft wieder der reine `audio`-Pfad (ohne Blendung).
- **„Unable to resolve module dependency: 'Capacitor' / 'BeatclipMedia'“** in
  `AppDelegate.swift` (Build schlägt fehl, `xcodebuild` läuft aber durch): das Projekt hatte
  keine Ziel-Abhängigkeit auf `Pods-App`, deshalb wurden die Pods nur über das Workspace gebaut.
  Diese Abhängigkeit ist jetzt in `ios/App/App.xcodeproj` eingetragen – **beide** Einstiegspunkte
  (`App.xcworkspace` *und* `App.xcodeproj`) bauen und archivieren damit. `node tools/ios_pods_dependency.js`
  erneuert die darin hinterlegte Ziel-ID nach jedem `pod install` (macht `build_ios.sh`/`ios_fix.sh` automatisch).
  Empfehlungsweise bleibt trotzdem, das Workspace zu öffnen: `npm run ios:open`
  (oder `open ios/App/App.xcworkspace`).
- Derselbe Fehler nach `npm ci`/`git clean`: Pods fehlen → `npx cap sync ios`, dann
  `pod install` in `ios/App/` (macht beides automatisch `tools/build_ios.sh`).
- Derselbe Fehler, obwohl `./tools/build_ios.sh` erfolgreich baut (**BUILD SUCCEEDED**): das ist
  nur der **IDE-Index** in Xcode. Ursache sind veraltete Caches – früher lagen
  `build_ios/DerivedData/` (Modul-Cache, Header-Maps, Index) im Git und wanderten zwischen
  Windows- und Mac-Arbeitsplatz mit; Xcode indexet dann Fremd-Caches. Diese Artefakte sind jetzt
  ignoriert. Einmalig bereinigen: `npm run ios:fix` (oder nur Caches: `npm run ios:clean`,
  alternativ `DEEP=1 npm run ios:clean` für den globalen Modul-Cache).
- `npm run ios:fix` löscht die Caches, erneuert Assets/`cap sync`/`pod install`, **baut einmal
  vorbeugend** (Workspace und `App.xcodeproj`, Simulator-Konfiguration) und öffnet dann das
  Workspace – dabei geschlossene bzw. wiederhergestellte `App.xcodeproj`-Fenster werden
  automatisch geschlossen. Ohne Vorab-Build: `NOWARM=1 npm run ios:fix`.
- Der Ordner `ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` enthält ein geteiltes
  „App“-Schema, damit `xcodebuild -scheme App` auch auf einem frischen Mac-Klon funktioniert.
- Warnung `Run script build phase '[CP] Embed Pods Frameworks' will be run during every build
  because it does not specify any outputs`: bewusst erzeugt durch `install! 'cocoapods',
  :disable_input_output_paths => true` im Podfile (Capacitor-Vorgabe, verhindert falsch
  eingebettete Plugin-Frameworks nach einem Update) – kann ignoriert werden.

---

## 5. Projektstruktur (iOS-bezogen)
```
ios/                       Capacitor-iOS-Projekt (App.xcworkspace, Podfile, Info.plist, AppDelegate)
plugins/beatclip-media/    lokales Capacitor-Plugin: Swift-Bruecke + BeatclipMedia.podspec
tools/make_ios_assets.js   AppIcon + Splash fuer ios/App/App/Assets.xcassets
tools/build_ios.sh         Build-Anleitung/Ablauf auf dem Mac (sim | device | ipa | testflight | clean)
tools/ios_clean.sh         Xcode-Caches dieses Projekts löschen (IDE-„module dependency“-Fehler)
tools/ios_fix.sh           ios_clean.sh + Assets/sync/pod install, oeffnet App.xcworkspace
tools/ios_pods_dependency.js  haelt die Ziel-Abhaengigkeit App -> Pods-App im .xcodeproj aktuell
dist/ios/                  Ziel fuer gebaute .ipa (hier nicht gebaut)
```
Der Rest (Web-UI, Android-Projekt, Signing) steht in [README-ANDROID.md](README-ANDROID.md).

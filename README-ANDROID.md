# BeatClip – native Android-App

BeatClip ist eine **echte Android-App** (APK), keine Web-Page: eine Capacitor-Hülle
mit eigener Android-Schicht für Hintergrundwiedergabe, Medienleiste und
Bluetooth-Steuerung. Die Oberfläche ist die bekannte BeatClip-Web-UI aus [`app/`](app/).

Fertige Pakete liegen in [`dist/android/`](dist/android/):

| Datei | Größe | Verwendung |
|---|---|---|
| `BeatClip-release.apk` | ~2,8 MB | Signiert, für die tägliche Nutzung (empfohlen) |
| `BeatClip-debug.apk` | ~3,6 MB | Debugbar (Chrome-Inspect, Logcats) |

Package-Name: `com.beatclip.app` · minSdk 22 (Android 5.1+) · targetSdk 34 (Android 14)

---

## 1. Installation auf dem Handy

### Variante A: APK direkt aufs Handy (sideload)
1. `BeatClip-release.apk` aufs Handy kopieren (USB, Cloud, E-Mail …).
2. Auf dem Handy öffnen → „Installation aus unbekannten Quellen“ einmalig erlauben.
3. BeatClip starten, beim ersten Start **Benachrichtigungen erlauben** (sonst ist die
   Medienleiste auf dem Sperrbildschirm evtl. unsichtbar – Abspielen funktioniert trotzdem).

### Variante B: per ADB (Handy per USB, USB-Debugging an)
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" install -r "C:\Python\Music_Player\dist\android\BeatClip-release.apk"
```

### Update einer vorhandenen Installation
`BeatClip-release.apk` ist mit dem lokalen Schlüssel aus [`keystore/`](keystore/) signiert.
Solange du denselben Schlüssel verwendest, ist ein Update ohne Datenverlust möglich
(`install -r`). Für Google Play musst du einen **eigenen** Release-Schlüssel erzeugen –
dann vorher die lokale APK deinstallieren.

---

## 2. Bauen / neu bauen

Voraussetzungen (sind hier installiert):
- JDK 17 → `C:\Users\cp\AppData\Local\Programs\jdk-17.0.14`
- Android SDK → `%LOCALAPPDATA%\Android\Sdk` (build-tools 34, platform android-34)
- Gradle: der Wrapper in [`android/gradle/wrapper/gradle-wrapper.properties`](android/gradle/wrapper/gradle-wrapper.properties)
  ist auf **8.9** festgelegt – das Android Gradle Plugin 8.2.1 läuft nicht mit Gradle 9
  (`NoClassDefFoundError: org/gradle/api/artifacts/SelfResolvingDependency`).

```powershell
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\jdk-17.0.14"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"

npm install                # einmalig (Capacitor 6.2.2)
npm run sync               # app/ -> android/app/src/main/assets/public
npm run apk:debug          # -> dist/android/BeatClip-debug.apk
npm run apk:release        # -> dist/android/BeatClip-release.apk
```

Nur die Icons/Splashscreens neu erzeugen (keine Bildbibliothek nötig):
```powershell
npm run assets:android     # tools/make_android_assets.js + tools/make_icons.js
```

### Release-Signing
`android/keystore.properties` zeigt auf [`keystore/beatclip-release.keystore`](keystore/beatclip-release.keystore)
(Alias `beatclip`, Passwort `beatclip123`, gültig bis ca. 2053). Fehlt die Datei, baut Gradle
automatisch wieder ein **unsigniertes** Release. Für Google Play: eigenen Schlüssel anlegen und
geheim halten – ein verlorener Play-Schlüssel kann nicht ersetzt werden.

---

## 3. Was die native Schicht tut

| Datei | Zweck |
|---|---|
| `MainActivity.java` | Plugin registriert, Autoplay ohne Geste, Berechtigung „Benachrichtigungen“ (Android 13+), Hardware-Zurück Taste bedient erst Sheets/Navigation, Share-Intents entgegengenommen |
| `AudioHoldService.java` | Vordergrund-Dienst (`mediaPlayback`): Audio bleibt bei ausgeschaltetem Display bzw. im Hintergrund hörbar (Partial-Wakelock); MediaSession mit Titel, Fortschritt und Zurück/Play-Pause/Weiter. Der Dienst fordert **bewusst keinen eigenen Audio-Fokus** an – das WebView hält den Fokus für sein `<audio>`-Element, ein zweiter Fokus-Client im selben Prozess würde die Wiedergabe stummschalten |
| `BeatClipMediaPlugin.java` | JS↔Android-Brücke: `startSession/updateSession/stopSession`, `notificationPermission`, `getSharedFiles/readSharedFile/deleteSharedFile/clearSharedFiles`, `getStatus`; sendet Ereignisse `mediaAction` an JS |
| `ShareInbox.java` |Audiodateien aus anderen Apps („Teilen → BeatClip“ / „Öffnen mit“) nach `files/shared`, dann automatisch in die Bibliothek übernommen |
| `app/app.js` (Abschnitt „Native Android-Brücke“) | Spiegelt Media Session in die Android-Leiste (inkl. Cover als `largeIcon`/Album-Art), reagiert auf Tasten (Play/Pause/Weiter/Zurück/Seek, auf den Schnitt begrenzt), importiert geteilte Dateien, deaktiviert Service Worker + „Installieren“-UI nativ. In der nativen App wird die Web-Media-Session **nicht** gestartet, damit es kein zweites Bedienfeld gibt. |

### Hintergrund / Bluetooth
- Der Dienst läuft als *Foreground Service* (Kanal „Wiedergabe“), deshalb bleibt die Audio-
  wiedergabe erhalten, wenn die App im Hintergrund ist oder das Display ausgeschaltet wird.
- Die Benachrichtigung (ID 4211) zeigt Titel, Interpret und die drei Tasten; über die
  MediaSession erscheinen sie zusätzlich auf dem Sperrbildschirm.
- **Bluetooth-Lautsprecher:** normal in den Android-Einstellungen verbinden – BeatClip folgt
  der Systemausgabe (A2DP). Medientasten am Kopfhörer (Play/Pause/Weiter/Zurück sowie „Seek“
  aus der Leiste) wirken direkt auf die Wiedergabe und bleiben dabei innerhalb des Schnitts.

### Audiodateien in die App bekommen
1. **Teilen / Öffnen mit** – Dateien-App, Download-Ordner, WhatsApp etc.: Audiodatei →
   *Teilen* → **BeatClip** (oder *Öffnen mit* → BeatClip). Der Titel erscheint in der Bibliothek.
2. **Import in der App** – Bibliothek → *Importieren* (Systemspeicher-Dialog, mehrere Dateien).
3. **Drag & Drop** nur im Browser (PWA-Modus), nativ nicht verfügbar.

Alle Dateien liegen lokal in IndexedDB; es werden keine Uploads gemacht. Der verbrauchte
Platz steht unter Einstellungen → „Speicher“.

### Aufnehmen und Kanäle exportieren
- Bibliothek → **Aufnahme** startet die Mikrofonaufnahme; **Aufnahme beenden** speichert sie automatisch in der lokalen Bibliothek. Android fragt nach Mikrofonzugriff.
- Im Menü eines Titels **Stereo-Kanäle extrahieren** wählen und bei der gewünschten Mono-WAV-Datei auf **Speichern** tippen. Android öffnet den Systemdialog zur Speicherortauswahl (standardmäßig Downloads). Bei Mehrkanal-Audio wird jeder Kanal exportiert; Mono-Dateien sind nicht teilbar.

### Schnitt (Start/Ende) unverändert
Wie im Prototyp: Playlist → Titel → *Schnitt* → Griffe **S**/**E** auf der Waveform,
bzw. Zeitwerte von Hand. Der Schnitt gilt pro Playlist-Eintrag, die Wiedergabe stoppt
beim Schnitt-Ende (bzw. springt bei „Wiederholen“ zurück zum Schnitt-Anfang) –
auch über die Bluetooth-/Leisten-Tasten.

---

## 4. Bekannte Grenzen / Hinweise
- Es gibt auch eine **native iOS-App** (Capacitor + Swift-Brücke, gleiche API) – siehe
  [README-IOS.md](README-IOS.md). Der Build benötigt macOS + Xcode und ist hier (Windows)
  noch nicht durchgeführt; als PWA (Safari → „Zum Startbildschirm hinzufügen“) läuft iOS
  weiterhin unverändert.
- Android zeigt nur **ein** Bedienfeld: In der nativen App wird die Web-Media-Session nicht
  aktiviert, Sperrbildschirm und Benachrichtigung kommen ausschließlich von der
  Android-MediaSession (inkl. Cover-Bild).
- Ohne Benachrichtigungs-Berechtigung (Android 13+) kann die Medienleiste fehlen; unter
  *Einstellungen → Apps → BeatClip → Benachrichtigungen* nachholen.
- OEM-Rom’s (Xiaomi, Huawei, Samsung …) können den Dienst trotz Vordergrund-Status nach
  einigen Minuten beenden → BeatClip als „nicht optimiert“ bei der Akku-Optimierung markieren.
  Der Dienst hält deshalb zusätzlich einen Partial-Wakelock, solange Wiedergabe läuft.
- **Kein eigener Audio-Fokus in Java:** der Ton kommt aus dem WebView, und Chromium hält für
  sein `<audio>`-Element bereits den Android-Audio-Fokus. Fordert der native Dienst zusätzlich
  `AUDIOFOCUS_GAIN` an, löst Chromium den eigenen Fokus ab und schaltet die Wiedergabe stumm
  bzw. pausiert sie – auf MIUI (Xiaomi) war der Ton dadurch nach wenigen Sekunden weg.
  Anruf/Navigation ducken und pausieren weiterhin, weil das WebView der Fokus-Inhaber bleibt.
- Bleibt die Wiedergabe stehen (ohne Ton), zeigt die App nach ~4 s „⚠️ Der Ton steht still“;
  Medienspezifische Fehler (Dekodierung/Format) erscheinen als „Audio-Fehler: …“.
- `chrome://inspect` funktioniert nur mit `BeatClip-debug.apk` (WebView-Debugging an).

---

## 5. Projektstruktur
```
app/                    Web-UI (wird in APK und iOS-App gepackt)
android/                Capacitor-Android-Projekt (inkl. eigener Java-Schicht)
ios/                    Capacitor-iOS-Projekt (Swift-Schicht im lokalen Plugin)
plugins/beatclip-media/ gemeinsames lokales Capacitor-Plugin (iOS-Teil: Swift + Podspec)
tools/                  Generator-/Build-Skripte (Icons, Splash, Test-WAVs, build_ios.sh)
keystore/               lokales Release-Signing
dist/android/           fertige APKs
dist/ios/               Ziel für die .ipa (nur auf dem Mac gebaut)
design_prototype/       HTML-Prototyp (Designvorlage)
test_audio/             Test-WAVs für Browser-Tests
```
Details zur iOS-Variante: [README-IOS.md](README-IOS.md)

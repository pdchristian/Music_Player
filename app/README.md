# BeatClip – Offline-Musik-Player (PWA für Android & iOS)

HTML-App (Progressive Web App), die **lokal gespeicherte Audiodateien** abspielt.
Kernfunktion: Jeder Titel in einer Playlist hat eigene **Start-/Endmarken (Schnitt)** –
abgespielt wird nur der Abschnitt dazwischen. Die Musik kann per **Bluetooth-Lautsprecher**
(Android A2DP / iOS AirPlay & Bluetooth) ausgegeben werden.

Entstanden aus dem UI-Prototypen im Ordner [`../design_prototype`](../design_prototype)
(gleiche Farb-/Formsprache wie WOL `Android_50.html` und Copilot Chat `Mobile_Chat_51.html`).

> **Native Android-App?** Diese Ordner [`app/`](./) sind auch der Inhalt des Android-Pakets.
> Bau, Installation (APK), Hintergrundwiedergabe, Medienleiste und „Teilen nach BeatClip“
> stehen in [`../README-ANDROID.md`](../README-ANDROID.md). Fertige APKs: [`../dist/android/`](../dist/android/).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Gerüst (Screens, Mini-Player, Bottom-Nav, `<audio>`) |
| `app.js` | Logik: IndexedDB-Speicher, Import, Wiedergabe, Schnitte, Waveform, Media Session, native Android-Brücke |
| `style.css` | Design (Dark/Light, Farbtokens wie die Prototypen) |
| `manifest.webmanifest` | PWA-Manifest (Icons, Installation, `file_handlers` für Audio-Dateien) |
| `sw.js` | Service Worker – App-Shell offline (im nativen Android-Paket deaktiviert) |
| `icons/` | App-Icons (192/512/maskable) |
| `../tools/make_icons.js` | erzeugt die Web-Icons (`node tools/make_icons.js`) |
| `../tools/make_android_assets.js` | erzeugt Launcher-Icons/Splash für das Android-Paket |
| `../tools/make_test_wavs.js` | erzeugt Test-WAVs (`node tools/make_test_wavs.js`) |

## Starten

PWA braucht einen HTTP(S)-Server (nicht `file://`):

```powershell
# Variante 1
python -m http.server 8017 --directory C:\Python\Music_Player\app
# Variante 2
npx serve C:\Python\Music_Player\app
```

Dann `http://localhost:8017` öffnen.

## Auf dem Handy nutzen

**Android (Chrome):** Seite öffnen → Menu ⋮ → **App installieren**.
Danach randlos wie eine native App; Audiodateien über „⬇ Import“ oder
Dateien-App → Teilen → „In BeatClip öffnen“ (dank `file_handlers`).

**iPhone / iPad (Safari):** Teilen → **Zum Startbildschirm hinzufügen**.
Wiedergabe läuft auch bei gesperrtem Bildschirm; Lautsprecher über
Kontrollzentrum → AirPlay wählbar.

## Bluetooth-Lautsprecher

Die App benutzt ein einziges `<audio>`-Element → die Wiedergabe folgt der
**System-Audioausgabe**:

- **Android:** BT-Lautsprecher koppeln, ggf. Schnelleinstellungen → *Media-Ausgabe* wählen.
  Die App routet automatisch dorthin.
- **iOS/iPadOS:** Kontrollzentrum → AirPlay/Audiogerät wählen.
- **Media Session API**: Titel, Interpret und Cover erscheinen auf Sperrbildschirm /
  Control Center; **Bluetooth-Fernbedienungen** (Play/Pause, Weiter, Zurück, Seek)
  steuern die App – inklusive korrekt begrenztem Seek nur innerhalb des Schnitts.

## Schnittfunktion

- Playlist-Titel antippen → spielt **nur den Schnittbereich** (Start/Ende).
- In der Playlist-Ansicht „Reihenfolge“ Titel am Ziehgriff per Maus oder Touch verschieben; die neue Reihenfolge wird lokal gespeichert.
- ✂ (FAB oder Zeile) öffnet den Editor: Waveform **aus echten Audiodaten**,
  Griffe S/E ziehen, Feinjustage ±1/±5 s, Vorschau, Reset, Speichern.
- Ende erreicht → Auto-Transition zum nächsten Titel (oder Repeat/Sleep wie eingestellt).
- Schnitte werden je Playlist-Eintrag in IndexedDB gespeichert (Gerät bleibt Datenhalter).
- **Aufnahme:** Bibliothek → „Aufnahme“ startet eine Mikrofonaufnahme. Beim Beenden wird sie automatisch als Audiodatei in der lokalen Bibliothek gespeichert.
- **Kanäle exportieren:** Im Menü eines Titels „Kanäle extrahieren / exportieren“ wählen. Bei Stereo werden links und rechts als separate Mono-Dateien angeboten; auf Geräten mit mehr Kanälen wird jeder Kanal einzeln exportiert. Mono-Quellen lassen sich nicht aufteilen – sie werden als ein Track („Titel_Mono“) in WAV, MP3 oder M4A ausgegeben. Über die Chips **WAV / MP3 / M4A** unter dem Titel wird das Zielformat gewählt (MP3 mit 192 kbps, im Browser mit lamejs kodiert). „Speichern“ öffnet den Speicher-/Download-Dialog des Geräts. **M4A (AAC)** ist nur in der nativen BeatClip-App verfügbar – dort wandelt das Betriebssystem das Material im Native-Layer um. Während des Erzeugens zeigt das Sheet Spinner, Phasentext und Fortschrittsbalken (MP3 in Prozent, M4A mit „Rohdaten uebergeben…“ / „M4A wird kodiert…“); Speichern, Teilen und die Formatchips sind solange gesperrt. Sheet schließen bricht den Lauf ab und räumt die temporären Dateien der App auf.

## Playlist-Import / -Export

Im ⋯-Menü einer Playlist (in der Playlist-Übersicht oder in der Playlist-Ansicht): **Export** und **Import**.

- **Nur Referenzen** (Standard): eine kleine JSON-Datei mit Titelreihenfolge, Schnitten,
  Playlist-Name und Cover-Emoji. Sie setzt voraus, dass die Audiodateien auf dem Zielgerät
  bereits importiert sind.
- **Vollständig**: eine ZIP-Datei mit `playlist.json` und den Audiodateien unter `audio/`.
  Das Sheet zeigt vorab die geschätzte Größe; Titel ohne Audiodatei im Speicher werden
  übersprungen und gemeldet.
- Der Import erkennt das Format automatisch (ZIP oder JSON) und legt **immer eine neue
  Playlist** an (bei Namensdopplung „… (2)“). Titel werden über Dateiname, Dateigröße und
  Spieldauer wiedergefunden; aus einem Voll-Export fehlen sie nie. Es wird nichts gelöscht
  oder überschrieben – nur die neue Playlist kommt hinzu.
- Schnittmarken werden beim Import auf die lokale Spieldauer begrenzt (Spannen unter 0,5 s
  gelten als „kein Schnitt“).

## Formate

MP3, M4A/AAC, OGG/Opus, WAV überall; FLAC je nach Browser/Gerät.
Ohne echte Dateien: Button **Demo-Titel erzeugen** synthetisiert WAVs zum Ausprobieren.

## Hinweise / Grenzen

- iOS Private Tab: Speicher (IndexedDB) ist dort blockiert – normaler Modus nötig.
- `navigator.storage.persist()` in Einstellungen anfragen, damit das OS den
  Speicher nicht aufräumt.
- Die App sendet keine Daten irgendwohin; alles bleibt im Browser-Speicher.

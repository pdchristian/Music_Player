import Foundation
import UIKit
import Capacitor
import AVFoundation
import MediaPlayer

/*
 BeatClip – native iOS-Bruecke. Dieselbe JS-API wie die Android-Schicht
 (plugins/beatclip-media wird von Capacitor automatisch registriert):

  • Now Playing: Sperrbildschirm, Kontrollzentrum, Tasten an Kophoerer/
    Bluetooth-Fernbedienung (Play/Pause/Weiter/Zurueck/Seek, auf den
    Schnitt begrenzt ueber die Web-Seite)
  • Hintergrund-Wiedergabe: AVAudioSession (.playback) zusammen mit
    UIBackgroundModes: audio in der Info.plist
  • Posteingang: Audiodateien, die ueber die Dateien-App mit BeatClip
    geoeffnet wurden ("Teilen / Oeffnen in") – wie "Teilen → BeatClip" auf Android
 */
@objc(BeatClipMediaPlugin)
public class BeatClipMediaPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "BeatClipMediaPlugin"
    public let jsName = "BeatClipMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notificationPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSharedFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSharedFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteSharedFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSharedFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAudioExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeAudioExportChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveAudioExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAudioExport", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginAudioEncode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeAudioEncodeChunk", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "finishAudioEncode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelAudioEncode", returnType: CAPPluginReturnPromise),
    ]

    private static let chunk = 768 * 1024          // Base64 in handlichen Stuecken

    private var sessionOn = false
    private var playing = false
    private var commandsRegistered = false
    private var exportFiles: [String: URL] = [:]
    private var encodeWavFiles: [String: URL] = [:]
    private var pendingExportCalls: [String: CAPPluginCall] = [:]
    private var pendingExportIds: [ObjectIdentifier: String] = [:]

    /// Ablage fuer mit BeatClip geoeffnete Dateien (vom AppDelegate befuellt).
    public static func inboxDir() -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("shared", isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: – Wiedergabe-Sitzung (Now Playing)

    @objc func startSession(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "BeatClip"
        let artist = call.getString("artist") ?? ""
        let durationMs = call.getInt("durationMs") ?? 0
        playing = call.getBool("playing") ?? true

        enableAudioSession()
        registerRemoteCommands()

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist.isEmpty ? "BeatClip" : artist,
            MPMediaItemPropertyAlbumTitle: "BeatClip (offline)",
            MPMediaItemPropertyPlaybackDuration: Double(durationMs) / 1000.0,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0.0,
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0,
        ]
        if let art = call.getString("art"), let image = imageFromDataURL(art) {
            info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        sessionOn = true
        call.resolve()
    }

    @objc func updateSession(_ call: CAPPluginCall) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = call.getString("title") ?? "BeatClip"
        let artist = call.getString("artist") ?? ""
        info[MPMediaItemPropertyArtist] = artist.isEmpty ? "BeatClip" : artist
        playing = call.getBool("playing") ?? playing
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        if let pos = call.getInt("positionMs") {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(pos) / 1000.0
        }
        if let dur = call.getInt("durationMs") {
            info[MPMediaItemPropertyPlaybackDuration] = Double(dur) / 1000.0
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        call.resolve()
    }

    @objc func stopSession(_ call: CAPPluginCall) {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        playing = false
        sessionOn = false
        call.resolve()
    }

    @objc func notificationPermission(_ call: CAPPluginCall) {
        // iOS braucht fuer die Medienbedienung keine Berechtigung.
        call.resolve(["granted": true, "rationale": false, "permanentlyDenied": false])
    }

    // MARK: – Tasten (Kophoerer, Bluetooth, Kontrollzentrum, Lockscreen)

    private func registerRemoteCommands() {
        guard !commandsRegistered else { return }
        commandsRegistered = true
        let cc = MPRemoteCommandCenter.shared()
        cc.playCommand.addTarget { [weak self] _ in self?.emit("play", 0); return .success }
        cc.pauseCommand.addTarget { [weak self] _ in self?.emit("pause", 0); return .success }
        cc.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.emit(self?.playing == true ? "pause" : "play", 0)
            return .success
        }
        cc.nextTrackCommand.addTarget { [weak self] _ in self?.emit("next", 0); return .success }
        cc.previousTrackCommand.addTarget { [weak self] _ in self?.emit("prev", 0); return .success }
        cc.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let e = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.emit("seek", Int((e.positionTime * 1000).rounded()))
            return .success
        }
    }

    private func emit(_ action: String, _ positionMs: Int) {
        notifyListeners("mediaAction", data: ["action": action, "positionMs": positionMs])
    }

    // MARK: – Audio-Sitzung & Unterbrechungen (Anruf, AirPlay-Wechsel …)

    override public func load() {
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    private func enableAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard
            let info = note.userInfo,
            let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        switch type {
        case .began:
            emit("pause", 0)
        case .ended:
            let opts = (info[AVAudioSessionInterruptionOptionKey] as? UInt)
                .map { AVAudioSession.InterruptionOptions(rawValue: $0) }
            if opts?.contains(.shouldResume) == true { emit("play", 0) }
        @unknown default:
            break
        }
    }

    // MARK: – Posteingang ("Oeffnen in BeatClip")

    @objc func getSharedFiles(_ call: CAPPluginCall) {
        var arr: [[String: Any]] = []
        for f in inboxFiles() {
            arr.append(["name": (f as NSString).lastPathComponent, "size": fileSize(f)])
        }
        call.resolve(["files": arr])
    }

    /// Liest eine Datei in Stuecken (base64), damit grosse Titel nicht den Speicher sprengen.
    @objc func readSharedFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else { call.reject("name fehlt"); return }
        guard let path = safeFile(named: name) else { call.reject("Datei nicht gefunden"); return }
        let offset = UInt64(max(0, call.getInt("offset") ?? 0))
        let size = UInt64(fileSize(path))
        let at = min(offset, size)

        guard let handle = try? FileHandle(forReadingFrom: URL(fileURLWithPath: path)) else {
            call.reject("Lesen fehlgeschlagen"); return
        }
        defer { try? handle.close() }
        handle.seek(toFileOffset: at)
        let want = Int(min(UInt64(Self.chunk), size - at))
        let data = handle.readData(ofLength: want)
        call.resolve([
            "data": data.base64EncodedString(),
            "offset": Int(at),
            "size": Int(size),
            "eof": at + UInt64(data.count) >= size,
        ])
    }

    @objc func deleteSharedFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else { call.reject("name fehlt"); return }
        if let path = safeFile(named: name) { try? FileManager.default.removeItem(atPath: path) }
        call.resolve()
    }

    @objc func clearSharedFiles(_ call: CAPPluginCall) {
        for path in inboxFiles() { try? FileManager.default.removeItem(atPath: path) }
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve([
            "serviceRunning": sessionOn,
            "shared": inboxFiles().map { ($0 as NSString).lastPathComponent },
        ])
    }

    // MARK: – Exportierter Audiokanal

    @objc func beginAudioExport(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty,
              !name.contains("/"), !name.contains("\\") else {
            call.reject("Ungueltiger Dateiname")
            return
        }
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        let url = directory.appendingPathComponent(name)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            call.reject("Exportordner konnte nicht angelegt werden: \(error.localizedDescription)")
            return
        }
        guard FileManager.default.createFile(atPath: url.path, contents: Data()) else {
            try? FileManager.default.removeItem(at: directory)
            call.reject("Exportdatei konnte nicht angelegt werden")
            return
        }
        exportFiles[id] = url
        call.resolve(["id": id])
    }

    @objc func writeAudioExportChunk(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = exportFiles[id],
              let encoded = call.getString("data"), let offset = call.getInt("offset"),
              offset >= 0, let data = Data(base64Encoded: encoded) else {
            call.reject("Ungueltiger Exportblock")
            return
        }
        do {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: UInt64(offset))
            try handle.write(contentsOf: data)
            call.resolve()
        } catch {
            call.reject("Exportblock konnte nicht geschrieben werden: \(error.localizedDescription)")
        }
    }

    @objc func saveAudioExport(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = exportFiles[id],
              let name = call.getString("name"), fileSize(url.path) > 0 else {
            call.reject("Exportdatei fehlt oder ist leer")
            return
        }
        presentExport(call, id: id, url: url, name: name)
    }

    /// Oeffnet den iOS-Dateiexport fuer eine fertige Datei (WAV oder M4A).
    private func presentExport(_ call: CAPPluginCall, id: String, url: URL, name: String) {
        let picker = UIDocumentPickerViewController(url: url, in: .exportToService)
        picker.delegate = self
        picker.shouldShowFileExtensions = true
        picker.title = name
        pendingExportCalls[id] = call
        pendingExportIds[ObjectIdentifier(picker)] = id
        DispatchQueue.main.async { [weak self] in
            guard let self, let viewController = self.bridge?.viewController else {
                self?.finishAudioExport(picker, error: NSError(
                    domain: "BeatClipAudioExport", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Speicherdialog konnte nicht geöffnet werden"]))
                return
            }
            viewController.present(picker, animated: true)
        }
    }

    // MARK: – M4A-Encoding (PCM/WAV -> AAC in MP4-Container)

    @objc func beginAudioEncode(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.isEmpty,
              !name.contains("/"), !name.contains("\\") else {
            call.reject("Ungueltiger Dateiname")
            return
        }
        let id = UUID().uuidString
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(id, isDirectory: true)
        // Zwischendatei enthaelt WAV – bewusst mit .wav-Endung, egal wie die
        // spaetere M4A-Ausgabe heissen soll.
        let url = directory.appendingPathComponent("source.wav")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            call.reject("Encodeordner konnte nicht angelegt werden: \(error.localizedDescription)")
            return
        }
        guard FileManager.default.createFile(atPath: url.path, contents: Data()) else {
            try? FileManager.default.removeItem(at: directory)
            call.reject("Encodedatei konnte nicht angelegt werden")
            return
        }
        encodeWavFiles[id] = url
        call.resolve(["id": id])
    }

    @objc func writeAudioEncodeChunk(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let url = encodeWavFiles[id],
              let encoded = call.getString("data"), let offset = call.getInt("offset"),
              offset >= 0, let data = Data(base64Encoded: encoded) else {
            call.reject("Ungueltiger Encodeblock")
            return
        }
        do {
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seek(toOffset: UInt64(offset))
            try handle.write(contentsOf: data)
            call.resolve()
        } catch {
            call.reject("Encodeblock konnte nicht geschrieben werden: \(error.localizedDescription)")
        }
    }

    @objc func cancelAudioEncode(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Encodekennung fehlt")
            return
        }
        if let url = encodeWavFiles.removeValue(forKey: id) {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        call.resolve()
    }

    @objc func finishAudioEncode(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let wavUrl = encodeWavFiles.removeValue(forKey: id),
              let name = call.getString("name"), fileSize(wavUrl.path) > 44 else {
            call.reject("Encodedatei fehlt oder ist zu kurz")
            return
        }
        let directory = wavUrl.deletingLastPathComponent()
        let base = ((name as NSString).deletingPathExtension)
        let safeBase = (base.isEmpty ? "BeatClip" : base)
        let m4aUrl = directory.appendingPathComponent(safeBase + ".m4a")
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            Self.encodeWav(wavUrl, to: m4aUrl) { error in
                try? FileManager.default.removeItem(at: wavUrl)
                if let error {
                    try? FileManager.default.removeItem(at: directory)
                    call.reject("M4A-Encoding fehlgeschlagen: \(error.localizedDescription)")
                    return
                }
                guard self.fileSize(m4aUrl.path) > 0 else {
                    try? FileManager.default.removeItem(at: directory)
                    call.reject("M4A-Encoding fehlgeschlagen: keine Ausgabedatei")
                    return
                }
                let newId = UUID().uuidString
                self.exportFiles[newId] = m4aUrl
                self.presentExport(call, id: newId, url: m4aUrl, name: m4aUrl.lastPathComponent)
            }
        }
    }

    /// Wandelt eine (unkomprimierte) WAV-Datei per AVAudioFile in AAC/M4A um.
    private static func encodeWav(_ wavUrl: URL, to m4aUrl: URL, completion: @escaping (Error?) -> Void) {
        do {
            let reader = try AVAudioFile(forReading: wavUrl, commonFormat: .pcmFormatFloat32, interleaved: false)
            let format = reader.processingFormat
            let channels = Int(format.channelCount)
            let sampleRate = format.sampleRate
            guard channels > 0, sampleRate > 0, reader.length > 0 else {
                completion(NSError(domain: "BeatClipM4aEncode", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Ungueltiges WAV-Format"]))
                return
            }
            let bitRate = max(96_000, min(320_000, Int(Double(channels) * sampleRate * 16 * 0.4)))
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channels,
                AVEncoderBitRateKey: bitRate,
            ]
            var writer: AVAudioFile? = try AVAudioFile(forWriting: m4aUrl, settings: settings,
                                                      commonFormat: .pcmFormatFloat32,
                                                      interleaved: false)
            guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096) else {
                writer = nil
                completion(NSError(domain: "BeatClipM4aEncode", code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "Audio-Puffer nicht verfuegbar"]))
                return
            }
            while reader.framePosition < reader.length {
                buffer.frameLength = 0
                try reader.read(into: buffer)
                if buffer.frameLength == 0 { break }
                try writer?.write(from: buffer)
            }
            writer = nil   // schliesst die Datei und schreibt den moov-Block
            completion(nil)
        } catch {
            completion(error)
        }
    }

    @objc func cancelAudioExport(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Exportkennung fehlt")
            return
        }
        if let url = exportFiles.removeValue(forKey: id) {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        pendingExportCalls.removeValue(forKey: id)
        call.resolve()
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        finishAudioExport(controller, error: nil)
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishAudioExport(controller, error: NSError(
            domain: "BeatClipAudioExport", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Speichern abgebrochen"]))
    }

    private func finishAudioExport(_ controller: UIDocumentPickerViewController, error: Error?) {
        guard let id = pendingExportIds.removeValue(forKey: ObjectIdentifier(controller)),
              let call = pendingExportCalls.removeValue(forKey: id) else { return }
        if let error {
            call.reject(error.localizedDescription, "USER_CANCELLED", error, nil)
        } else {
            call.resolve()
        }
        if let url = exportFiles.removeValue(forKey: id) {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
    }

    // MARK: – Helfer

    /// Nur der nackte Dateiname wird akzeptiert – kein Pfad-Traversal.
    private func safeFile(named name: String) -> String? {
        let clean = (name as NSString).lastPathComponent
        let path = Self.inboxDir().appendingPathComponent(clean).path
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        return path
    }

    /// Alle Dateien im Posteingang, aelteste zuerst (wie Android).
    private func inboxFiles() -> [String] {
        let dir = Self.inboxDir().path
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
        let files = names
            .map { (dir as NSString).appendingPathComponent($0) }
            .filter { path in
                var isDir: ObjCBool = false
                return FileManager.default.fileExists(atPath: path, isDirectory: &isDir) && !isDir.boolValue
            }
        return files.sorted { a, b in
            (attrs(a)[.modificationDate] as? Date ?? .distantPast) < (attrs(b)[.modificationDate] as? Date ?? .distantPast)
        }
    }

    private func attrs(_ path: String) -> [FileAttributeKey: Any] {
        (try? FileManager.default.attributesOfItem(atPath: path)) ?? [:]
    }

    private func fileSize(_ path: String) -> Int {
        (attrs(path)[.size] as? Int) ?? 0
    }

    /// data-URL (PNG) als Bild, fuer das Cover in der Now-Leiste.
    private func imageFromDataURL(_ dataUrl: String) -> UIImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let b64 = String(dataUrl[dataUrl.index(after: comma)...])
        guard b64.count > 40, let data = Data(base64Encoded: b64), let image = UIImage(data: data) else { return nil }
        return image
    }
}

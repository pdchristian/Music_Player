import UIKit
import Capacitor
import BeatclipMedia

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Formate, die als Audiodatei nach BeatClip geoeffnet werden koennen.
    private static let audioExtensions: Set<String> = [
        "mp3", "m4a", "aac", "m4b", "wav", "wave", "aiff", "aif", "flac", "mp4",
    ]

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Audiodateien aus der Dateien-App ("Oeffnen in BeatClip") uebernehmen;
        // alles andere an Capacitor durchreichen.
        if ingest(url) { return true }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // MARK: – Posteingang fuer geteilte Audiodateien (entspricht ShareInbox auf Android)

    /// Gemeinsamer Einstieg fuer Geoeffnete URLs (AppDelegate alt / SceneDelegate neu):
    /// erst Posteingang pruefen, sonst an Capacitor durchreichen.
    func handleIncoming(url: URL) {
        if ingest(url) { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    /// Kopiert eine mit BeatClip geoeffnete Audiodatei in den Posteingang;
    /// die Web-UI holt sie sich beim naechsten Sichtbarwerden (importSharedFiles).
    func ingest(_ url: URL) -> Bool {
        guard AppDelegate.audioExtensions.contains(url.pathExtension.lowercased()) else { return false }

        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        if let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
           let size = values.fileSize, size > 64 * 1024 * 1024 {
            CAPLog.print("BeatClip: „\(url.lastPathComponent)“ ist zu gross (max. 64 MB) – in der App importieren")
            return false
        }

        let dir = BeatClipMediaPlugin.inboxDir()
        let target = dir.appendingPathComponent(sanitize(url.lastPathComponent))
        do {
            if FileManager.default.fileExists(atPath: target.path) {
                try FileManager.default.removeItem(at: target)
            }
            try FileManager.default.copyItem(at: url, to: target)
        } catch {
            CAPLog.print("BeatClip: Uebernahme fehlgeschlagen:", error.localizedDescription)
            return false
        }
        return true
    }

    /// Keine Pfad- oder Sonderzeichen, hoechstens 120 Zeichen (wie Android).
    private func sanitize(_ raw: String) -> String {
        var name = (raw as NSString).lastPathComponent
        name = name.replacingOccurrences(of: "[^A-Za-z0-9._ -]", with: "_", options: .regularExpression)
        if name.count > 120 { name = String(name.suffix(120)) }
        return name.isEmpty ? "geteilter-titel" : name
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

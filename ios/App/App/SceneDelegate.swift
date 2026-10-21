import UIKit
import Capacitor

/// UIScene-Lifecycle, den iOS 26+/27 von Apps mit aktuellem SDK verlangt
/// (sonst SIGTRAP "NoSceneLifecycleAdoption" beim Start auf dem Geraet).
/// Das Fenster wird aus dem bestehenden Main-Storyboard erzeugt – dessen
/// Initial-ViewController ist wie bisher Capacitors BridgeViewController.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = UIStoryboard(name: "Main", bundle: nil)
            .instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        // Kaltstart durch "Oeffnen in BeatClip" / URL-Aufruf:
        for context in connectionOptions.urlContexts {
            handle(url: context.url)
        }
    }

    /// Warmstart durch "Oeffnen in BeatClip" / URL-Aufruf.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            handle(url: context.url)
        }
    }

    private func handle(url: URL) {
        guard let app = UIApplication.shared.delegate as? AppDelegate else { return }
        app.handleIncoming(url: url)
    }
}

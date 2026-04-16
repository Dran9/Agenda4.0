import UIKit
import Capacitor
import LocalAuthentication

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var lockView: UIView?
    private var privacyView: UIView?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        DispatchQueue.main.async { [weak self] in
            self?.presentLockOverlay()
            self?.authenticateWithBiometrics()
        }
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        guard lockView == nil else { return }
        showPrivacyOverlay()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        hidePrivacyOverlay()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - FaceID gate (cold launch only)

    private func presentLockOverlay() {
        guard let window = window, lockView == nil else { return }
        let overlay = buildLockView(frame: window.bounds)
        window.addSubview(overlay)
        window.bringSubviewToFront(overlay)
        lockView = overlay
    }

    @objc private func lockTapped() {
        authenticateWithBiometrics()
    }

    private func authenticateWithBiometrics() {
        let context = LAContext()
        context.localizedFallbackTitle = "Usar código"
        var authError: NSError?
        if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) {
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Desbloqueá Agenda") { success, _ in
                DispatchQueue.main.async { [weak self] in
                    if success { self?.removeLockOverlay() }
                }
            }
        } else {
            removeLockOverlay()
        }
    }

    private func removeLockOverlay() {
        UIView.animate(withDuration: 0.2, animations: {
            self.lockView?.alpha = 0
        }, completion: { _ in
            self.lockView?.removeFromSuperview()
            self.lockView = nil
        })
    }

    private func buildLockView(frame: CGRect) -> UIView {
        let v = UIView(frame: frame)
        v.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.08, alpha: 1.0)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let icon = UIImageView(image: UIImage(systemName: "faceid"))
        icon.tintColor = .white
        icon.alpha = 0.85
        icon.contentMode = .scaleAspectFit
        icon.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(icon)

        let label = UILabel()
        label.text = "Tocá para desbloquear"
        label.textColor = UIColor.white.withAlphaComponent(0.55)
        label.font = .systemFont(ofSize: 15, weight: .medium)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        v.addSubview(label)

        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: v.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: v.centerYAnchor, constant: -20),
            icon.widthAnchor.constraint(equalToConstant: 72),
            icon.heightAnchor.constraint(equalToConstant: 72),
            label.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 20),
            label.centerXAnchor.constraint(equalTo: v.centerXAnchor),
        ])

        let tap = UITapGestureRecognizer(target: self, action: #selector(lockTapped))
        v.addGestureRecognizer(tap)
        v.isUserInteractionEnabled = true
        return v
    }

    // MARK: - Privacy overlay (app switcher)

    private func showPrivacyOverlay() {
        guard let window = window, privacyView == nil else { return }
        let v = UIView(frame: window.bounds)
        v.backgroundColor = UIColor(red: 0.05, green: 0.05, blue: 0.08, alpha: 1.0)
        v.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(v)
        window.bringSubviewToFront(v)
        privacyView = v
    }

    private func hidePrivacyOverlay() {
        privacyView?.removeFromSuperview()
        privacyView = nil
    }
}

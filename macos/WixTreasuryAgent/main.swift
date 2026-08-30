import AppKit
import ApplicationServices

private let wixTransfersURL = URL(string: "https://manage.wix.com/wix-payments/br/dashboard/1e7a5d33-26d6-4f39-8f4c-be9452b1eb10/002/transfer-history")!
private let wixTransfersPath = "/wix-payments/br/dashboard/1e7a5d33-26d6-4f39-8f4c-be9452b1eb10/002/transfer-history"
private let safeTransferButtonTitle = "Transferir"
private let maximumAttempts = 60

private func normalized(_ value: String) -> String {
    value.trimmingCharacters(in: .whitespacesAndNewlines)
        .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pt_BR"))
        .lowercased()
}

private func isSafeTransferButtonTitle(_ title: String) -> Bool {
    normalized(title) == normalized(safeTransferButtonTitle)
}

private func attributeValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String? {
    guard let value = attributeValue(element, attribute) else { return nil }
    if let string = value as? String { return string }
    if let url = value as? URL { return url.absoluteString }
    return nil
}

private func children(of element: AXUIElement) -> [AXUIElement] {
    attributeValue(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
}

private func treeContainsWixTransfersURL(_ element: AXUIElement, depth: Int = 0) -> Bool {
    guard depth < 70 else { return false }

    if let url = stringAttribute(element, kAXURLAttribute), url.contains(wixTransfersPath) {
        return true
    }

    return children(of: element).contains { treeContainsWixTransfersURL($0, depth: depth + 1) }
}

private func findSafeTransferButton(_ element: AXUIElement, depth: Int = 0) -> AXUIElement? {
    guard depth < 70 else { return nil }

    let role = stringAttribute(element, kAXRoleAttribute)
    let title = stringAttribute(element, kAXTitleAttribute)
        ?? stringAttribute(element, kAXDescriptionAttribute)
        ?? ""

    if role == kAXButtonRole, isSafeTransferButtonTitle(title) {
        return element
    }

    for child in children(of: element) {
        if let button = findSafeTransferButton(child, depth: depth + 1) {
            return button
        }
    }

    return nil
}

private func safariWindows() -> [AXUIElement] {
    guard let safari = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.Safari").first else {
        return []
    }

    let application = AXUIElementCreateApplication(safari.processIdentifier)
    return attributeValue(application, kAXWindowsAttribute) as? [AXUIElement] ?? []
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    private var automationInProgress = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.setActivationPolicy(.accessory)
        if CommandLine.arguments.contains("--prepare-transfer") {
            prepareTransfer()
        }
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        guard urls.contains(where: { $0.scheme == "spwix" && $0.host == "prepare-transfer" }) else {
            return
        }
        prepareTransfer()
    }

    private func prepareTransfer() {
        guard !automationInProgress else { return }
        automationInProgress = true

        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        let options = [promptKey: true] as CFDictionary
        guard AXIsProcessTrustedWithOptions(options) else {
            showError(
                title: "Permissão necessária",
                message: "Autorize o app SP Wix Automação em Ajustes do Sistema > Privacidade e Segurança > Acessibilidade. Depois, clique novamente no botão do SP Dashboard."
            )
            return
        }

        NSWorkspace.shared.open(wixTransfersURL)
        findAndOpenReview(attempt: 0)
    }

    private func findAndOpenReview(attempt: Int) {
        if let window = safariWindows().first(where: { treeContainsWixTransfersURL($0) }),
           let button = findSafeTransferButton(window) {
            let result = AXUIElementPerformAction(button, kAXPressAction as CFString)
            if result == .success {
                NSApplication.shared.terminate(nil)
                return
            }
        }

        guard attempt < maximumAttempts else {
            showError(
                title: "Não foi possível preparar o resgate",
                message: "A conta Wix foi aberta, mas o botão Transferir não ficou disponível. Confirme o login e tente novamente."
            )
            return
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.findAndOpenReview(attempt: attempt + 1)
        }
    }

    private func showError(title: String, message: String) {
        NSApplication.shared.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        NSApplication.shared.terminate(nil)
    }
}

if CommandLine.arguments.contains("--self-test") {
    precondition(isSafeTransferButtonTitle("Transferir"))
    precondition(isSafeTransferButtonTitle(" transferir "))
    precondition(!isSafeTransferButtonTitle("Transferir fundos"))
    precondition(!isSafeTransferButtonTitle("Confirmar transferência"))
    print("WixTreasuryAgent self-test: OK")
    exit(EXIT_SUCCESS)
}

private let application = NSApplication.shared
private let delegate = AppDelegate()
application.delegate = delegate
application.run()

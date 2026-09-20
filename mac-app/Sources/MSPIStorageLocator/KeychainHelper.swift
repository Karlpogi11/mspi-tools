import Foundation
import Security

class KeychainHelper {
    static let shared = KeychainHelper()

    private let service = "com.mspi.storage-locator"

    #if DEBUG
    // Xcode's unsigned debug executable can trigger a Keychain access prompt on every rebuild.
    // Keep debug session data in the app's local preferences; release builds use Keychain.
    private func debugKey(_ key: String) -> String { "mspi.debug.\(key)" }
    #endif

    func set(_ value: String, forKey key: String) throws {
        #if DEBUG
        UserDefaults.standard.set(value, forKey: debugKey(key))
        return
        #else
        let data = value.data(using: .utf8)!
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: "Keychain", code: Int(status), userInfo: nil) }
        #endif
    }

    func string(forKey key: String) -> String? {
        #if DEBUG
        return UserDefaults.standard.string(forKey: debugKey(key))
        #else
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
        #endif
    }

    func delete(forKey key: String) {
        #if DEBUG
        UserDefaults.standard.removeObject(forKey: debugKey(key))
        return
        #else
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(query as CFDictionary)
        #endif
    }
}

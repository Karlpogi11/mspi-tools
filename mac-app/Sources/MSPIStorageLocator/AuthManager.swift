import Foundation
import Combine

@MainActor
final class AuthManager: ObservableObject {
    @Published var employeeNumber: String = ""
    @Published var fullName: String = ""
    @Published var isLoading: Bool = false
    @Published private(set) var isOffline = false

    private let api = StorageAPI()

    private let sessionKey = "mspi_employee_session"

    init() {
        restoreSession()
    }

    var isAuthenticated: Bool {
        !employeeNumber.isEmpty && (KeychainHelper.shared.string(forKey: "mspi_token") != nil || isOffline)
    }

    func login(employeeNumber: String) async throws {
        isLoading = true
        defer { isLoading = false }

        let result = try await api.authenticate(employeeNumber: employeeNumber)
        try KeychainHelper.shared.set(result.token, forKey: "mspi_token")
        try KeychainHelper.shared.set(
            String(data: try JSONEncoder().encode(CachedEmployeeSession(employeeNumber: result.employeeNumber, fullName: result.fullName)), encoding: .utf8)!,
            forKey: sessionKey
        )
        self.employeeNumber = result.employeeNumber
        self.fullName = result.fullName
        isOffline = false
        objectWillChange.send()
    }

    func logout() {
        KeychainHelper.shared.delete(forKey: "mspi_token")
        KeychainHelper.shared.delete(forKey: sessionKey)
        employeeNumber = ""
        fullName = ""
        isOffline = false
        objectWillChange.send()
    }

    func restoreSession() {
        guard let rawSession = KeychainHelper.shared.string(forKey: sessionKey),
              let data = rawSession.data(using: .utf8),
              let session = try? JSONDecoder().decode(CachedEmployeeSession.self, from: data) else {
            return
        }

        employeeNumber = session.employeeNumber
        fullName = session.fullName
        isOffline = KeychainHelper.shared.string(forKey: "mspi_token") == nil
        objectWillChange.send()
    }
}

private struct CachedEmployeeSession: Codable {
    let employeeNumber: String
    let fullName: String
}

struct AuthResult: Codable {
    let token: String
    let employeeNumber: String
    let fullName: String
}

extension StorageAPI {
    func authenticate(employeeNumber: String) async throws -> AuthResult {
        struct AuthPayload: Codable { let employeeNumber: String }
        let response: AuthResult = try await request(path: "/auth/employee-login", method: "POST", body: try JSONEncoder().encode(AuthPayload(employeeNumber: employeeNumber.trimmed)))
        return response
    }
}

extension String {
    var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) }
}

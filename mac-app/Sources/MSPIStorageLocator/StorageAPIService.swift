import Foundation
import OSLog

struct StorageAPI {
    private static let logger = Logger(subsystem: "com.mspi.storage-locator", category: "API")

    static let baseURL: URL = {
        if let configuredURL = ProcessInfo.processInfo.environment["MSPI_API_URL"],
           let url = URL(string: configuredURL) {
            return url
        }

        #if DEBUG
        return URL(string: "http://127.0.0.1:3001/api")!
        #else
        return URL(string: "https://tools.mspi.io/api")!
        #endif
    }()

    func request<T: Decodable>(path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var urlRequest = URLRequest(url: StorageAPI.baseURL.appendingPathComponent(path))
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = KeychainHelper.shared.string(forKey: "mspi_token") {
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            urlRequest.httpBody = body
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: urlRequest)
        } catch {
            Self.logger.error("Network request failed path=\(path, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            throw error
        }
        let httpResponse = response as! HTTPURLResponse
        Self.logger.debug("API response path=\(path, privacy: .public) status=\(httpResponse.statusCode, privacy: .public)")
        if httpResponse.statusCode == 401 {
            throw NSError(domain: "StorageAPI", code: 401, userInfo: [NSLocalizedDescriptionKey: "Session expired"])
        }
        guard httpResponse.statusCode >= 200 && httpResponse.statusCode < 300 else {
            let serverMessage = (try? JSONDecoder().decode(APIErrorResponse.self, from: data))?.resolvedMessage
            let message = serverMessage ?? "Request failed (HTTP \(httpResponse.statusCode))"
            Self.logger.error("API request rejected path=\(path, privacy: .public) status=\(httpResponse.statusCode, privacy: .public)")
            throw NSError(domain: "StorageAPI", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: message])
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let value = try decoder.singleValueContainer()
            if let string = try? value.decode(String.self) {
                let isoFormatter = ISO8601DateFormatter()
                if let date = isoFormatter.date(from: string) { return date }
                let fractionalISOFormatter = ISO8601DateFormatter()
                fractionalISOFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                if let date = fractionalISOFormatter.date(from: string) { return date }

                let mysqlFormatter = DateFormatter()
                mysqlFormatter.locale = Locale(identifier: "en_US_POSIX")
                mysqlFormatter.timeZone = TimeZone(secondsFromGMT: 0)
                mysqlFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
                if let date = mysqlFormatter.date(from: string) { return date }
                mysqlFormatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
                if let date = mysqlFormatter.date(from: string) { return date }
            }
            if let timestamp = try? value.decode(Double.self) {
                return Date(timeIntervalSince1970: timestamp)
            }
            throw DecodingError.dataCorruptedError(in: value, debugDescription: "Unsupported date format")
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            Self.logger.error("Response decoding failed path=\(path, privacy: .public) error=\(error.localizedDescription, privacy: .public)")
            throw NSError(domain: "StorageAPI", code: -2, userInfo: [NSLocalizedDescriptionKey: "Data could not be read: \(error.localizedDescription)"])
        }
    }

    func rules() async throws -> [StorageRule] {
        let response: StorageRulesResponse = try await request(path: "/storage-locator/rules")
        return response.rules
    }

    func overview() async throws -> (occupied: [StorageUnit], rules: [StorageRule]) {
        let response: StorageOverviewResponse = try await request(path: "/storage-locator/overview")
        return (response.occupied, response.rules)
    }

    func recentHistory() async throws -> [StorageMovement] {
        let response: StorageRecentHistoryResponse = try await request(path: "/storage-locator/recent-history")
        return response.history
    }

    func verifyEmployee(number: String) async throws -> StorageEmployee {
        let response: VerifyEmployeeResponse = try await request(path: "/storage-locator/employees/verify?employeeNumber=\(number.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? number)")
        return response.employee
    }

    func lookup(arNumber: String) async throws -> (unit: StorageUnit?, history: [StorageMovement]) {
        let response: LookupResponse = try await request(path: "/storage-locator/units/\(arNumber.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? arNumber)")
        return (response.unit, response.history)
    }

    func checkIn(payload: CheckInPayload) async throws -> String {
        let response: MessageResponse = try await request(path: "/storage-locator/units/in", method: "POST", body: try JSONEncoder().encode(payload))
        return response.message
    }

    func checkOut(payload: CheckOutPayload) async throws -> String {
        let response: MessageResponse = try await request(path: "/storage-locator/units/out", method: "POST", body: try JSONEncoder().encode(payload))
        return response.message
    }
}

private struct APIErrorResponse: Decodable {
    let error: String?
    let detail: String?

    var resolvedMessage: String? { error ?? detail }
}

struct StorageRule: Identifiable, Codable {
    let family: String
    let status: String
    let numbers: [Int]
    let id = UUID()
    enum CodingKeys: String, CodingKey { case family, status, numbers }
}

struct StorageUnit: Identifiable, Codable {
    let arNumber: String
    let family: String
    let status: String
    let cabinetNumber: Int?
    let state: String
    let id: Int

    enum CodingKeys: String, CodingKey {
        case arNumber = "ar_number"
        case family, status
        case cabinetNumber = "cabinet_number"
        case state
        case id
    }
}

struct StorageEmployee: Identifiable, Codable {
    let employeeNumber: String
    let fullName: String
    let id: Int

    enum CodingKeys: String, CodingKey {
        case employeeNumber = "employee_number"
        case fullName = "fullName"
        case id
    }
}

struct StorageMovement: Identifiable, Codable {
    let id: Int
    let action: String
    let family: String
    let cabinetNumber: Int?
    let status: String
    let fullName: String
    let employeeNumber: String
    let occurredAt: Date
    let arNumber: String

    enum CodingKeys: String, CodingKey {
        case id, action, family
        case cabinetNumber = "cabinet_number"
        case status
        case fullName = "full_name"
        case employeeNumber = "employee_number"
        case occurredAt = "occurred_at"
        case arNumber = "ar_number"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(Int.self, forKey: .id)
        action = try container.decode(String.self, forKey: .action)
        family = try container.decode(String.self, forKey: .family)
        cabinetNumber = try container.decodeIfPresent(Int.self, forKey: .cabinetNumber)
        status = try container.decode(String.self, forKey: .status)
        fullName = try container.decodeIfPresent(String.self, forKey: .fullName) ?? ""
        employeeNumber = try container.decodeIfPresent(String.self, forKey: .employeeNumber) ?? ""
        occurredAt = try container.decode(Date.self, forKey: .occurredAt)
        arNumber = try container.decodeIfPresent(String.self, forKey: .arNumber) ?? ""
    }
}

struct StorageRulesResponse: Codable { let rules: [StorageRule] }
struct StorageOverviewResponse: Codable { let occupied: [StorageUnit]; let rules: [StorageRule] }
struct StorageRecentHistoryResponse: Codable { let history: [StorageMovement] }
struct VerifyEmployeeResponse: Codable { let employee: StorageEmployee }
struct LookupResponse: Codable { let unit: StorageUnit?; let history: [StorageMovement] }
struct MessageResponse: Codable { let message: String }

struct CheckInPayload: Codable {
    let employeeNumber: String
    let arNumber: String
    let family: String
    let status: String
    let cabinetNumber: Int

    enum CodingKeys: String, CodingKey {
        case employeeNumber = "employeeNumber"
        case arNumber
        case family, status
        case cabinetNumber = "cabinetNumber"
    }
}

struct CheckOutPayload: Codable {
    let employeeNumber: String
    let arNumber: String

    enum CodingKeys: String, CodingKey {
        case employeeNumber = "employeeNumber"
        case arNumber
    }
}

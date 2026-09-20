import SwiftUI
import Combine
import AppKit

struct ContentView: View {
    @EnvironmentObject var authManager: AuthManager
    @StateObject private var viewModel = StorageViewModel()

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                MainView(viewModel: viewModel)
            } else {
                LoginView()
            }
        }
        .frame(minWidth: 400, minHeight: 400)
    }
}

struct LoginView: View {
    @EnvironmentObject var authManager: AuthManager
    @State private var employeeNumber = ""
    @State private var errorMessage: String?
    @State private var isLoading = false
    @FocusState private var employeeNumberFocused: Bool

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 48))
                .foregroundColor(.primary)
            Text("Storage Locator")
                .font(.title2).bold()
            Text("Sign in to continue")
                .font(.subheadline).foregroundColor(.secondary)

            TextField("Employee number", text: $employeeNumber)
                .textFieldStyle(.roundedBorder)
                .focused($employeeNumberFocused)
                .onSubmit(handleLogin)
                .accessibilityLabel("Employee number")

            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundColor(.red)
            }

            Button(action: handleLogin) {
                Text(isLoading ? "Signing in..." : "Continue")
            }
            .buttonStyle(.borderedProminent)
            .disabled(isLoading || employeeNumber.isEmpty)
            .frame(maxWidth: .infinity)
        }
        .padding(40)
        .frame(width: 360)
        .onAppear {
            employeeNumberFocused = true
        }
    }

    func handleLogin() {
        let normalizedEmployeeNumber = employeeNumber.trimmed
        guard !normalizedEmployeeNumber.isEmpty, !isLoading else { return }

        employeeNumber = normalizedEmployeeNumber
        isLoading = true
        errorMessage = nil
        Task {
            do {
                try await authManager.login(employeeNumber: normalizedEmployeeNumber)
            } catch {
                errorMessage = error.localizedDescription
                isLoading = false
            }
        }
    }
}

struct MainView: View {
    @ObservedObject var viewModel: StorageViewModel
    @EnvironmentObject var authManager: AuthManager

    private let titleBarInset: CGFloat = 20
    private let scrollContentBottomInset: CGFloat = 20

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Keep the first row below the native macOS title-bar region.
                Color.clear
                    .frame(height: titleBarInset)

                header

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 16) {
                        workspace
                            .frame(minWidth: 500, maxWidth: .infinity, alignment: .topLeading)
                        historyPanel
                            .frame(width: 300, alignment: .topLeading)
                    }

                    VStack(alignment: .leading, spacing: 16) {
                        workspace
                        historyPanel
                    }
                }
            }
            .frame(maxWidth: 1040, alignment: .topLeading)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
            .padding(.bottom, scrollContentBottomInset)
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .frame(minWidth: 680, idealWidth: 980, minHeight: 520, idealHeight: 650)
        .task { await viewModel.loadOverview() }
    }

    private var header: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 20) {
                titleBlock
                Spacer()
                accountActions
            }

            VStack(alignment: .leading, spacing: 12) {
                titleBlock
                HStack {
                    accountActions
                    Spacer()
                }
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("STORAGE LOCATOR")
                .font(.caption.weight(.semibold))
                .tracking(1.4)
                .foregroundColor(.secondary)
            Text("Storage Locator")
                .font(.system(size: 28, weight: .semibold))
                .tracking(-0.4)
            Text("Find a unit, view its history, and update its storage location.")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var accountActions: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Button("Sign Out") {
                authManager.logout()
                viewModel.signOut()
            }
            .buttonStyle(.bordered)
            Text(authManager.isOffline ? "Offline profile" : "Connected")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private var workspace: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Image(systemName: authManager.isOffline ? "wifi.slash" : "person.crop.circle")
                    .foregroundColor(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(authManager.fullName.isEmpty ? "Employee" : authManager.fullName)
                        .font(.body.weight(.medium))
                    Text("Employee \(authManager.employeeNumber)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                Spacer()
            }
            .padding(12)
            .background(Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 10))

            if authManager.isOffline {
                Text("Reconnect to search or update storage. Your verified employee profile is available offline.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            CardView(title: "Find a unit") {
                TextField("AR number", text: $viewModel.arNumber)
                    .textFieldStyle(.roundedBorder)
                    .controlSize(.large)
                    .disabled(authManager.isOffline)
                    .onSubmit { Task { await viewModel.lookup() } }

                Button(viewModel.isLoading ? "Loading…" : "View unit history") {
                    Task { await viewModel.lookup() }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(authManager.isOffline || viewModel.arNumber.trimmed.isEmpty || viewModel.isLoading)

                if viewModel.isLoading { ProgressView("Loading…").controlSize(.small) }
                if let errorMessage = viewModel.errorMessage { Text(errorMessage).font(.caption).foregroundColor(.red) }
                if let message = viewModel.message { Text(message).font(.caption).foregroundColor(.secondary) }
            }

            if let unit = viewModel.unit {
                CardView(title: "Current location") {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(unit.state == "in" ? "\(unit.family) \(unit.cabinetNumber.map { String(format: "%02d", $0) } ?? "—")" : "Outside storage")
                                .font(.system(size: 22, weight: .semibold))
                            Text(unit.status).font(.caption).foregroundColor(.secondary)
                        }
                        Spacer()
                        Text(unit.state == "in" ? "IN STORAGE" : "OUT")
                            .font(.caption.weight(.medium))
                            .foregroundColor(.secondary)
                    }
                }
            }

            if viewModel.didLookup, viewModel.action == .checkIn { checkInPanel }
            if viewModel.didLookup, viewModel.action == .checkOut { checkOutPanel }
        }
    }

    private var checkInPanel: some View {
        CardView(title: "Check in to storage") {
            Text("Choose the destination cabinet for this unit.")
                .font(.caption)
                .foregroundColor(.secondary)
            Picker("Family", selection: $viewModel.family) {
                Text("iOS").tag("IOS")
                Text("Mac").tag("Mac")
            }
            .pickerStyle(.segmented)
            Picker("Status", selection: $viewModel.status) {
                Text("Select status").tag("")
                ForEach(viewModel.statuses(for: viewModel.family), id: \.self) { Text($0).tag($0) }
            }
            .labelsHidden()
            if let rule = viewModel.selectedRule {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 94, maximum: 94), spacing: 8)], spacing: 8) {
                    ForEach(rule.numbers, id: \.self) { number in
                        let storedCount = viewModel.storedCount(family: viewModel.family, cabinet: number)
                        Button {
                            viewModel.cabinet = number
                        } label: {
                            VStack(spacing: 2) {
                                Text("\(viewModel.family) \(String(format: "%02d", number))")
                                Text(storedCount == 0 ? "Empty" : "\(storedCount) stored")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            .frame(width: 94, height: 40)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(viewModel.cabinet == number ? .primary : .secondary)
                        .help(storedCount > 0 ? "\(storedCount) unit(s) stored; more units can be added" : "Empty cabinet")
                    }
                }
            }
            Button("Check in unit") { Task { await viewModel.checkIn(employeeNumber: authManager.employeeNumber) } }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(viewModel.status.isEmpty || viewModel.cabinet == nil || viewModel.isLoading)
        }
    }

    private var checkOutPanel: some View {
        CardView(title: "Check out of storage") {
            Text("This will mark the unit as outside storage.")
                .font(.caption)
                .foregroundColor(.secondary)
            Button("Check out unit") { Task { await viewModel.checkOut(employeeNumber: authManager.employeeNumber) } }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(maxWidth: .infinity)
                .disabled(viewModel.isLoading)
        }
    }

    private var historyPanel: some View {
        CardView(title: viewModel.arNumber.trimmed.isEmpty ? "Recent history" : "Unit history") {
            let entries = viewModel.arNumber.trimmed.isEmpty ? viewModel.recentHistory : viewModel.history
            if entries.isEmpty {
                Text("No storage activity to show yet.")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(entries.prefix(12))) { entry in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(entry.action).font(.caption.weight(.semibold))
                                Spacer()
                                Text(entry.occurredAt.formatted(date: .abbreviated, time: .shortened))
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                            Text("\(entry.family) \(entry.cabinetNumber.map { String(format: "%02d", $0) } ?? "—") · AR \(entry.arNumber)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            if !entry.fullName.isEmpty {
                                Text(entry.fullName)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                        .padding(.vertical, 8)
                        if entry.id != entries.prefix(12).last?.id { Divider() }
                    }
                }
            }
        }
    }
}

struct CardView<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .padding(.top, 2)
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

@MainActor
final class StorageViewModel: ObservableObject {
    @Published var employee: StorageEmployee?
    @Published var arNumber = ""
    @Published var unit: StorageUnit?
    @Published var history: [StorageMovement] = []
    @Published var rules: [StorageRule] = []
    @Published var occupied: [StorageUnit] = []
    @Published var recentHistory: [StorageMovement] = []
    @Published var didLookup = false
    @Published var action: StorageAction?
    @Published var family = "IOS"
    @Published var status = ""
    @Published var cabinet: Int?
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var message: String?

    private let api = StorageAPI()

    enum StorageAction: Equatable { case checkIn, checkOut }

    var selectedRule: StorageRule? {
        rules.first { $0.family == family && $0.status == status }
    }

    func statuses(for family: String) -> [String] {
        rules.filter { $0.family == family }.map(\.status)
    }

    func storedCount(family: String, cabinet: Int) -> Int {
        occupied.filter { $0.state == "in" && $0.family == family && $0.cabinetNumber == cabinet }.count
    }

    func loadOverview() async {
        do {
            async let overview = api.overview()
            async let recentHistory = api.recentHistory()
            let (overviewResult, recentHistoryResult) = try await (overview, recentHistory)
            occupied = overviewResult.occupied
            rules = overviewResult.rules
            self.recentHistory = recentHistoryResult
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func lookup() async {
        isLoading = true
        errorMessage = nil
        message = nil
        do {
            let result = try await api.lookup(arNumber: arNumber.trimmed)
            unit = result.unit
            history = result.history
            didLookup = true
            action = result.unit?.state == "in" ? .checkOut : .checkIn
            cabinet = nil
            status = ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func checkIn(employeeNumber: String) async {
        guard let cabinet, !status.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        message = nil
        do {
            let successMessage = try await api.checkIn(payload: CheckInPayload(employeeNumber: employeeNumber, arNumber: arNumber.trimmed, family: family, status: status, cabinetNumber: cabinet))
            await loadOverview()
            await lookup()
            message = successMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func checkOut(employeeNumber: String) async {
        isLoading = true
        errorMessage = nil
        message = nil
        do {
            let successMessage = try await api.checkOut(payload: CheckOutPayload(employeeNumber: employeeNumber, arNumber: arNumber.trimmed))
            await loadOverview()
            await lookup()
            message = successMessage
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    func openDownload() {
        NSWorkspace.shared.open(URL(string: "https://tools.mspi.io/mac-app/download")!)
    }

    func signOut() {
        employee = nil
        unit = nil
        history = []
        rules = []
        occupied = []
        recentHistory = []
        didLookup = false
        action = nil
        arNumber = ""
    }
}

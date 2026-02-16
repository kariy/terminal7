import Foundation
import Observation
import UIKit

struct ClaudeSessionSummary: Identifiable, Equatable {
    let sessionId: String
    let encodedCwd: String
    let cwd: String
    let title: String
    let lastActivityAt: Int
    let messageCount: Int

    var id: String {
        "\(sessionId)|\(encodedCwd)"
    }
}

@Observable
final class ChatViewModel {
    var messages: [Message] = []
    var currentInput: String = ""
    var isStreaming: Bool { !activeRequestIds.isEmpty }
    private var activeRequestIds: Set<String> = []
    var isConnected: Bool = false
    var isConnecting: Bool = false
    var connectionStatus: String = "Disconnected"
    var isSessionViewActive: Bool = false
    var sessions: [ClaudeSessionSummary] = []
    var isLoadingSessions: Bool = false

    var serverHost: String = ""
    private let managerPort: Int = 8787

    private var webSocketSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?
    private var refreshTimer: Timer?
    private var historyLoadTask: Task<Void, Never>?

    private var accessToken: String?
    private var deviceId: String?
    private var activeSessionId: String?
    private var activeEncodedCwd: String?

    private let defaults = UserDefaults.standard

    private enum DefaultsKey {
        static let host = "manager.host"
        static let deviceId = "manager.deviceId"
    }

    init() {
        loadPersistedConfig()
    }

    func autoConnectIfPossible() {
        if isConnected || isConnecting { return }
        guard !serverHost.isEmpty else { return }
        connect()
    }

    func connect() {
        guard !isConnecting else { return }
        guard !serverHost.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            connectionStatus = "Missing host"
            return
        }

        isSessionViewActive = false
        activeSessionId = nil
        activeEncodedCwd = nil
        sessions.removeAll()
        isLoadingSessions = false
        messages.removeAll()
        currentInput = ""

        persistConfig()
        isConnecting = true
        connectionStatus = "Bootstrapping..."

        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.ensureAccessToken()
                await MainActor.run {
                    self.openWebSocket()
                    self.isConnecting = false
                }
            } catch {
                await MainActor.run {
                    self.isConnecting = false
                    self.isConnected = false
                    self.connectionStatus = "Connect failed"
                    self.messages.append(
                        Message(role: "assistant", text: "Connection error: \(error.localizedDescription)")
                    )
                }
            }
        }
    }

    func disconnect() {
        historyLoadTask?.cancel()
        historyLoadTask = nil
        isConnected = false
        isConnecting = false
        activeRequestIds.removeAll()
        isSessionViewActive = false
        sessions.removeAll()
        isLoadingSessions = false
        connectionStatus = "Disconnected"
        refreshTimer?.invalidate()
        refreshTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil
    }

    func startNewClaudeCodeSession() {
        guard isConnected else { return }
        historyLoadTask?.cancel()
        historyLoadTask = nil
        activeSessionId = nil
        activeEncodedCwd = nil
        messages.removeAll()
        currentInput = ""
        activeRequestIds.removeAll()
        isSessionViewActive = true
    }

    func openExistingSession(_ session: ClaudeSessionSummary) {
        guard isConnected else { return }
        historyLoadTask?.cancel()
        historyLoadTask = nil
        activeSessionId = session.sessionId
        activeEncodedCwd = session.encodedCwd
        messages.removeAll()
        currentInput = ""
        activeRequestIds.removeAll()
        isSessionViewActive = true

        historyLoadTask = Task { [weak self] in
            guard let self else { return }
            do {
                let history = try await self.fetchSessionHistory(
                    sessionId: session.sessionId,
                    encodedCwd: session.encodedCwd
                )
                await MainActor.run {
                    guard
                        self.activeSessionId == session.sessionId,
                        self.activeEncodedCwd == session.encodedCwd,
                        !self.isStreaming,
                        self.messages.isEmpty
                    else {
                        return
                    }
                    self.messages = history
                }
            } catch {
                await MainActor.run {
                    guard
                        self.activeSessionId == session.sessionId,
                        self.activeEncodedCwd == session.encodedCwd,
                        self.messages.isEmpty
                    else {
                        return
                    }
                    self.messages = [
                        Message(
                            role: "assistant",
                            text: "Failed to load history: \(error.localizedDescription)"
                        ),
                    ]
                }
            }
        }
    }

    func returnToSessionHome() {
        guard isConnected else { return }
        historyLoadTask?.cancel()
        historyLoadTask = nil
        isSessionViewActive = false
        currentInput = ""
        activeRequestIds.removeAll()
        refreshSessions(forceRefresh: false)
    }

    func refreshSessions(forceRefresh: Bool = true) {
        guard isConnected else { return }
        Task { [weak self] in
            guard let self else { return }
            await MainActor.run {
                self.isLoadingSessions = true
            }

            do {
                let fetched = try await self.fetchSessions(forceRefresh: forceRefresh)
                await MainActor.run {
                    self.sessions = fetched
                    self.isLoadingSessions = false
                }
            } catch {
                await MainActor.run {
                    self.isLoadingSessions = false
                }
            }
        }
    }

    func send() {
        let text = currentInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard isSessionViewActive else { return }
        guard webSocketTask != nil, isConnected else {
            messages.append(Message(role: "assistant", text: "Not connected to manager."))
            return
        }
        historyLoadTask?.cancel()
        historyLoadTask = nil

        let requestId = UUID().uuidString
        var payload: [String: String] = [
            "request_id": requestId,
            "prompt": text,
        ]

        if let sessionId = activeSessionId, let encodedCwd = activeEncodedCwd {
            payload["type"] = "session.send"
            payload["session_id"] = sessionId
            payload["encoded_cwd"] = encodedCwd
        } else {
            payload["type"] = "session.create"
        }

        messages.append(Message(role: "user", text: text))
        messages.append(Message(role: "assistant", text: "", requestId: requestId))
        currentInput = ""
        activeRequestIds.insert(requestId)

        sendWebSocket(payload)
    }

    func clearSavedCredentials() {
        let account = accountKey()
        KeychainHelper.delete(account: "cc-manager-token:\(account)")
        accessToken = nil
        messages.append(Message(role: "assistant", text: "Saved credentials cleared."))
    }

    private func ensureAccessToken() async throws {
        if accessToken == nil {
            accessToken = try KeychainHelper.readString(account: "cc-manager-token:\(accountKey())")
        }

        if accessToken != nil {
            return
        }

        var request = URLRequest(url: try managerHTTPURL(path: "/v1/bootstrap/register-device"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        let deviceName = await MainActor.run { UIDevice.current.name }
        let body: [String: String] = [
            "device_name": deviceName,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(domain: "manager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
        }

        guard (200...299).contains(http.statusCode) else {
            let serverError = String(data: data, encoding: .utf8) ?? "Unknown bootstrap error"
            throw NSError(domain: "manager", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: serverError])
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let newDeviceId = json["device_id"] as? String,
            let token = json["access_token"] as? String
        else {
            throw NSError(domain: "manager", code: -2, userInfo: [NSLocalizedDescriptionKey: "Invalid bootstrap payload"])
        }

        deviceId = newDeviceId
        accessToken = token
        defaults.set(newDeviceId, forKey: DefaultsKey.deviceId)
        try KeychainHelper.saveString(token, account: "cc-manager-token:\(accountKey())")
    }

    private func fetchSessions(forceRefresh: Bool) async throws -> [ClaudeSessionSummary] {
        guard let accessToken else {
            throw NSError(
                domain: "manager",
                code: -10,
                userInfo: [NSLocalizedDescriptionKey: "Missing access token"]
            )
        }

        var queryItems: [URLQueryItem] = []
        if forceRefresh {
            queryItems.append(URLQueryItem(name: "refresh", value: "1"))
        }

        var request = URLRequest(url: try managerHTTPURL(path: "/v1/sessions", queryItems: queryItems))
        request.httpMethod = "GET"
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(
                domain: "manager",
                code: -11,
                userInfo: [NSLocalizedDescriptionKey: "Invalid session list response"]
            )
        }

        guard (200...299).contains(http.statusCode) else {
            let serverError = String(data: data, encoding: .utf8) ?? "Unknown sessions error"
            throw NSError(
                domain: "manager",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: serverError]
            )
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawSessions = json["sessions"] as? [[String: Any]]
        else {
            throw NSError(
                domain: "manager",
                code: -12,
                userInfo: [NSLocalizedDescriptionKey: "Invalid sessions payload"]
            )
        }

        return rawSessions.compactMap { item in
            guard
                let sessionId = item["session_id"] as? String,
                let encodedCwd = item["encoded_cwd"] as? String
            else {
                return nil
            }

            return ClaudeSessionSummary(
                sessionId: sessionId,
                encodedCwd: encodedCwd,
                cwd: item["cwd"] as? String ?? "",
                title: item["title"] as? String ?? "Untitled session",
                lastActivityAt: item["last_activity_at"] as? Int ?? item["updated_at"] as? Int ?? 0,
                messageCount: item["message_count"] as? Int ?? 0
            )
        }
    }

    private func fetchSessionHistory(sessionId: String, encodedCwd: String) async throws -> [Message] {
        guard let accessToken else {
            throw NSError(
                domain: "manager",
                code: -13,
                userInfo: [NSLocalizedDescriptionKey: "Missing access token"]
            )
        }

        let escapedSessionId = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        let queryItems = [URLQueryItem(name: "encoded_cwd", value: encodedCwd)]
        var request = URLRequest(
            url: try managerHTTPURL(
                path: "/v1/sessions/\(escapedSessionId)/history",
                queryItems: queryItems
            )
        )
        request.httpMethod = "GET"
        request.addValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw NSError(
                domain: "manager",
                code: -14,
                userInfo: [NSLocalizedDescriptionKey: "Invalid history response"]
            )
        }

        guard (200...299).contains(http.statusCode) else {
            let serverError = String(data: data, encoding: .utf8) ?? "Unknown history error"
            throw NSError(
                domain: "manager",
                code: http.statusCode,
                userInfo: [NSLocalizedDescriptionKey: serverError]
            )
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawMessages = json["messages"] as? [[String: Any]]
        else {
            throw NSError(
                domain: "manager",
                code: -15,
                userInfo: [NSLocalizedDescriptionKey: "Invalid history payload"]
            )
        }

        return rawMessages.compactMap { item in
            guard
                let role = item["role"] as? String,
                let text = item["text"] as? String
            else {
                return nil
            }
            return Message(role: role, text: text)
        }
    }

    private func openWebSocket() {
        disconnect()

        guard let wsURL = try? managerWebSocketURL(path: "/v1/ws") else {
            connectionStatus = "Invalid WebSocket URL"
            return
        }

        webSocketSession?.invalidateAndCancel()
        let session = URLSession(configuration: .default)
        webSocketSession = session
        webSocketTask = session.webSocketTask(with: wsURL)
        webSocketTask?.resume()

        isConnected = true
        connectionStatus = "Authenticating..."

        receiveMessage()
        startRefreshTimer()

        if let accessToken {
            sendWebSocket([
                "type": "auth.init",
                "token": accessToken,
            ])
        }
    }

    private func sendWebSocket(_ payload: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        webSocketTask?.send(.string(json)) { [weak self] error in
            guard let self else { return }
            if let error {
                DispatchQueue.main.async {
                    self.messages.append(Message(role: "assistant", text: "Send error: \(error.localizedDescription)"))
                    self.activeRequestIds.removeAll()
                }
            }
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    DispatchQueue.main.async {
                        self.handleServerMessage(text)
                    }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async {
                            self.handleServerMessage(text)
                        }
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure(let error):
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.activeRequestIds.removeAll()
                    self.connectionStatus = "Disconnected"
                    self.messages.append(Message(role: "assistant", text: "Socket error: \(error.localizedDescription)"))
                }

                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                    self.connect()
                }
            }
        }
    }

    private func startRefreshTimer() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            guard let self else { return }
            guard self.isConnected, !self.isStreaming else { return }
            self.sendWebSocket(["type": "session.refresh_index"])
        }
    }

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "hello":
            break

        case "auth.ok":
            isConnected = true
            connectionStatus = "Connected"
            isSessionViewActive = false
            activeSessionId = nil
            activeEncodedCwd = nil
            messages.removeAll()
            refreshSessions(forceRefresh: true)

        case "session.created":
            historyLoadTask?.cancel()
            historyLoadTask = nil
            activeSessionId = json["session_id"] as? String
            activeEncodedCwd = json["encoded_cwd"] as? String

        case "session.state":
            if let sessionId = json["session_id"] as? String {
                activeSessionId = sessionId
            }
            if let encodedCwd = json["encoded_cwd"] as? String {
                activeEncodedCwd = encodedCwd
            }
            if
                let status = json["status"] as? String,
                status == "index_refreshed",
                !isSessionViewActive
            {
                refreshSessions(forceRefresh: false)
            }

        case "stream.delta":
            if let deltaText = json["text"] as? String {
                let reqId = json["request_id"] as? String
                if let reqId,
                   let idx = messages.lastIndex(where: { $0.requestId == reqId }) {
                    messages[idx].text += deltaText
                } else if let last = messages.last, last.role == "assistant", isStreaming {
                    messages[messages.count - 1].text += deltaText
                } else {
                    messages.append(Message(role: "assistant", text: deltaText, requestId: reqId))
                }
            }

        case "stream.done":
            if let reqId = json["request_id"] as? String {
                activeRequestIds.remove(reqId)
            } else {
                activeRequestIds.removeAll()
            }

        case "error":
            let message = json["message"] as? String ?? "Unknown server error"
            messages.append(Message(role: "assistant", text: "Error: \(message)"))
            if let code = json["code"] as? String, code == "unauthorized" {
                accessToken = nil
                KeychainHelper.delete(account: "cc-manager-token:\(accountKey())")
            }
            if let reqId = json["request_id"] as? String {
                activeRequestIds.remove(reqId)
            } else {
                activeRequestIds.removeAll()
            }

        default:
            break
        }
    }

    private func loadPersistedConfig() {
        serverHost = defaults.string(forKey: DefaultsKey.host) ?? serverHost
        deviceId = defaults.string(forKey: DefaultsKey.deviceId)

        if !serverHost.isEmpty {
            accessToken = try? KeychainHelper.readString(account: "cc-manager-token:\(accountKey())")
        }
    }

    private func persistConfig() {
        defaults.set(serverHost, forKey: DefaultsKey.host)
    }

    private func accountKey() -> String {
        "\(serverHost):\(managerPort)"
    }

    private func managerHTTPURL(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        var components = URLComponents()

        components.scheme = "http"
        components.host = serverHost
        components.port = managerPort

        if path.hasPrefix("/") {
            components.path = path
        } else {
            components.path = "/\(path)"
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }

        guard let url = components.url else {
            throw NSError(domain: "manager", code: -5, userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP URL"])
        }
        return url
    }

    private func managerWebSocketURL(path: String) throws -> URL {
        var components = URLComponents()

        components.scheme = "ws"
        components.host = serverHost
        components.port = managerPort

        if path.hasPrefix("/") {
            components.path = path
        } else {
            components.path = "/\(path)"
        }

        guard let url = components.url else {
            throw NSError(domain: "manager", code: -7, userInfo: [NSLocalizedDescriptionKey: "Invalid WebSocket URL"])
        }
        return url
    }
}

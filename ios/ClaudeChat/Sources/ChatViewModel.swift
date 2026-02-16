import Foundation
import Observation
import UIKit

@Observable
final class ChatViewModel {
    var messages: [Message] = []
    var currentInput: String = ""
    var isStreaming: Bool = false
    var isConnected: Bool = false
    var isConnecting: Bool = false
    var connectionStatus: String = "Disconnected"
    var isSessionViewActive: Bool = false

    var serverHost: String = ""
    private let managerPort: Int = 8787

    private var webSocketSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?
    private var refreshTimer: Timer?

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
        isConnected = false
        isConnecting = false
        isStreaming = false
        isSessionViewActive = false
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
        activeSessionId = nil
        activeEncodedCwd = nil
        messages.removeAll()
        currentInput = ""
        isStreaming = false
        isSessionViewActive = true
    }

    func send() {
        let text = currentInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }
        guard isSessionViewActive else { return }
        guard webSocketTask != nil, isConnected else {
            messages.append(Message(role: "assistant", text: "Not connected to manager."))
            return
        }

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
        currentInput = ""
        isStreaming = true

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
                    self.isStreaming = false
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
                    self.isStreaming = false
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

        case "session.created":
            activeSessionId = json["session_id"] as? String
            activeEncodedCwd = json["encoded_cwd"] as? String

        case "session.state":
            if let sessionId = json["session_id"] as? String {
                activeSessionId = sessionId
            }
            if let encodedCwd = json["encoded_cwd"] as? String {
                activeEncodedCwd = encodedCwd
            }

        case "stream.delta":
            if let deltaText = json["text"] as? String {
                if let last = messages.last, last.role == "assistant", isStreaming {
                    messages[messages.count - 1].text += deltaText
                } else {
                    messages.append(Message(role: "assistant", text: deltaText))
                }
            }

        case "stream.done":
            isStreaming = false

        case "error":
            let message = json["message"] as? String ?? "Unknown server error"
            messages.append(Message(role: "assistant", text: "Error: \(message)"))
            if let code = json["code"] as? String, code == "unauthorized" {
                accessToken = nil
                KeychainHelper.delete(account: "cc-manager-token:\(accountKey())")
            }
            isStreaming = false

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

    private func managerHTTPURL(path: String) throws -> URL {
        var components = URLComponents()

        components.scheme = "http"
        components.host = serverHost
        components.port = managerPort

        if path.hasPrefix("/") {
            components.path = path
        } else {
            components.path = "/\(path)"
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

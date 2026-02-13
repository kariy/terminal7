import Foundation
import Observation

// Change this to your Mac's local network IP (find it via: ipconfig getifaddr en0)
private let serverURL = URL(string: "ws://100.110.9.55:3000/ws")!

@Observable
final class ChatViewModel {
    var messages: [Message] = []
    var currentInput: String = ""
    var isStreaming: Bool = false

    private var webSocketTask: URLSessionWebSocketTask?
    private var isConnected = false
    private var refreshTimer: Timer?

    func connect() {
        guard !isConnected else { return }
        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: serverURL)
        webSocketTask?.resume()
        isConnected = true
        receiveMessage()
        startRefreshTimer()
    }

    func disconnect() {
        isConnected = false
        refreshTimer?.invalidate()
        refreshTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
    }

    private func startRefreshTimer() {
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.requestRefresh()
        }
    }

    private func requestRefresh() {
        guard isConnected, !isStreaming else { return }
        let message = #"{"type":"refresh"}"#
        webSocketTask?.send(.string(message)) { _ in }
    }

    func send() {
        let text = currentInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }

        let payload: [String: String] = ["prompt": text]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let jsonString = String(data: data, encoding: .utf8) else { return }

        messages.append(Message(role: "user", text: text))
        currentInput = ""
        isStreaming = true

        webSocketTask?.send(.string(jsonString)) { [weak self] error in
            if let error {
                DispatchQueue.main.async {
                    self?.messages.append(Message(role: "assistant", text: "Send error: \(error.localizedDescription)"))
                    self?.isStreaming = false
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
                default:
                    break
                }
                self.receiveMessage()

            case .failure:
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.isStreaming = false
                }
                // Auto-reconnect after 1 second
                DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                    self.connect()
                }
            }
        }
    }

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else { return }

        switch type {
        case "history":
            if let rawMessages = json["messages"] as? [[String: String]] {
                messages = rawMessages.compactMap { dict in
                    guard let role = dict["role"], let text = dict["text"] else { return nil }
                    return Message(role: role, text: text)
                }
            }

        case "delta":
            if let deltaText = json["text"] as? String {
                if let last = messages.last, last.role == "assistant", isStreaming {
                    messages[messages.count - 1].text += deltaText
                } else {
                    messages.append(Message(role: "assistant", text: deltaText))
                }
            }

        case "done":
            isStreaming = false

        case "error":
            let errorText = json["text"] as? String ?? "Unknown error"
            messages.append(Message(role: "assistant", text: "Error: \(errorText)"))
            isStreaming = false

        default:
            break
        }
    }
}

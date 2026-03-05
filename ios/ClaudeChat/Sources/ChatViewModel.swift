import Foundation
import Observation

@Observable
final class ChatViewModel {
    var messages: [ChatMessage] = []
    var currentInput: String = ""
    var isStreaming: Bool { !activeRequestIds.isEmpty }
    private var activeRequestIds: Set<String> = []
    var isConnected: Bool = false
    var isConnecting: Bool = false
    var connectionStatus: String = "Disconnected"
    var isSessionViewActive: Bool = false
    var sessions: [ClaudeSessionSummary] = []
    var isLoadingSessions: Bool = false
    var permissionRequests: [ToolPermissionRequestState] = []
    var sessionPermissionModes: [String: SessionPermissionMode] = [:]
    var draftPermissionMode: SessionPermissionMode = .default
    var activeSessionMeta: SessionMeta?
    var sessionsNextCursor: String?

    var toastMessage: String?
    var toastIsError: Bool = true

    var serverEndpoint: String = ""
    var authToken: String = ""

    private var webSocketSession: URLSession?
    private var webSocketTask: URLSessionWebSocketTask?
    private var refreshTimer: Timer?
    private var historyLoadTask: Task<Void, Never>?

    private var activeSessionId: String?
    private var activeEncodedCwd: String?

    // Maps requestId -> base block index for stream block positioning
    private var streamMessageBaseByRequestId: [String: Int] = [:]

    private let defaults = UserDefaults.standard

    private enum DefaultsKey {
        static let endpoint = "manager.endpoint"
        static let authToken = "manager.authToken"
    }

    /// Parses serverEndpoint into (host, port). Accepts formats:
    /// - "host" (defaults to port 8787)
    /// - "host:port"
    /// - "http://host:port"
    /// - "http://host:port/path" (path ignored)
    private var parsedEndpoint: (host: String, port: Int)? {
        let trimmed = serverEndpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        // If it looks like a URL, parse it
        if trimmed.contains("://") {
            if let url = URL(string: trimmed), let host = url.host, !host.isEmpty {
                return (host, url.port ?? 8787)
            }
            return nil
        }

        // host:port or just host
        let parts = trimmed.split(separator: ":", maxSplits: 1)
        let host = String(parts[0])
        guard !host.isEmpty else { return nil }
        if parts.count == 2, let port = Int(parts[1]) {
            return (host, port)
        }
        return (host, 8787)
    }

    init() {
        loadPersistedConfig()
    }

    // MARK: - Stream Block Index Helpers

    private func isSdkStreamContentBlock(_ block: ContentBlockState) -> Bool {
        block.type == .text || block.type == .toolUse || block.type == .thinking
    }

    private func findStreamBlockInsertIndex(_ blocks: [ContentBlockState], streamIndex: Int) -> Int {
        var seenStreamBlocks = 0
        for i in 0..<blocks.count {
            if !isSdkStreamContentBlock(blocks[i]) { continue }
            if seenStreamBlocks == streamIndex { return i }
            seenStreamBlocks += 1
        }
        return blocks.count
    }

    private func findStreamBlockArrayIndex(_ blocks: [ContentBlockState], streamIndex: Int) -> Int {
        var seenStreamBlocks = 0
        for i in 0..<blocks.count {
            if !isSdkStreamContentBlock(blocks[i]) { continue }
            if seenStreamBlocks == streamIndex { return i }
            seenStreamBlocks += 1
        }
        return -1
    }

    private func countStreamBlocks(_ blocks: [ContentBlockState]) -> Int {
        blocks.filter { isSdkStreamContentBlock($0) }.count
    }

    // MARK: - Connection

    func autoConnectIfPossible() {
        if isConnected || isConnecting { return }
        guard parsedEndpoint != nil else { return }
        connect()
    }

    func connect() {
        guard !isConnecting else { return }
        guard parsedEndpoint != nil else {
            connectionStatus = "Invalid endpoint"
            return
        }

        isSessionViewActive = false
        activeSessionId = nil
        activeEncodedCwd = nil
        sessions.removeAll()
        isLoadingSessions = false
        messages.removeAll()
        currentInput = ""
        permissionRequests.removeAll()
        streamMessageBaseByRequestId.removeAll()
        activeSessionMeta = nil
        sessionsNextCursor = nil

        persistConfig()
        isConnecting = true
        connectionStatus = "Connecting..."

        openWebSocket()
        isConnecting = false
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
        permissionRequests.removeAll()
        streamMessageBaseByRequestId.removeAll()
        activeSessionMeta = nil
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
        permissionRequests.removeAll()
        streamMessageBaseByRequestId.removeAll()
        activeSessionMeta = nil
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
        permissionRequests.removeAll()
        streamMessageBaseByRequestId.removeAll()
        activeSessionMeta = nil
        isSessionViewActive = true

        // Restore permission mode if we have one
        if let mode = sessionPermissionModes[session.sessionId] {
            draftPermissionMode = mode
        } else {
            draftPermissionMode = .default
        }

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
                    else { return }
                    self.messages = history
                }
            } catch {
                await MainActor.run {
                    guard
                        self.activeSessionId == session.sessionId,
                        self.activeEncodedCwd == session.encodedCwd,
                        self.messages.isEmpty
                    else { return }
                    self.messages = [
                        ChatMessage(
                            role: "assistant",
                            contentBlocks: [ContentBlockState(type: .text, text: "Failed to load history: \(error.localizedDescription)")]
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
        permissionRequests.removeAll()
        streamMessageBaseByRequestId.removeAll()
        refreshSessions(forceRefresh: false)
    }

    func refreshSessions(forceRefresh: Bool = true) {
        guard isConnected else { return }
        Task { [weak self] in
            guard let self else { return }
            await MainActor.run { self.isLoadingSessions = true }

            do {
                let (fetched, cursor) = try await self.fetchSessions(forceRefresh: forceRefresh)
                await MainActor.run {
                    self.sessions = fetched
                    self.sessionsNextCursor = cursor
                    self.isLoadingSessions = false
                }
            } catch {
                await MainActor.run { self.isLoadingSessions = false }
            }
        }
    }

    func loadMoreSessions() {
        guard isConnected, let cursor = sessionsNextCursor else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                let (fetched, nextCursor) = try await self.fetchSessions(forceRefresh: false, cursor: cursor)
                await MainActor.run {
                    self.sessions.append(contentsOf: fetched)
                    self.sessionsNextCursor = nextCursor
                }
            } catch {}
        }
    }

    // MARK: - Send Message

    func send() {
        let text = currentInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard isSessionViewActive else { return }
        guard webSocketTask != nil, isConnected else {
            messages.append(ChatMessage(
                role: "assistant",
                contentBlocks: [ContentBlockState(type: .text, text: "Not connected to manager.")]
            ))
            return
        }
        historyLoadTask?.cancel()
        historyLoadTask = nil

        let requestId = UUID().uuidString
        var payload: [String: Any] = [
            "request_id": requestId,
            "prompt": text,
            "permission_mode": currentPermissionMode.rawValue,
        ]

        if let sessionId = activeSessionId, let encodedCwd = activeEncodedCwd {
            payload["type"] = "session.send"
            payload["session_id"] = sessionId
            payload["encoded_cwd"] = encodedCwd
        } else {
            payload["type"] = "session.create"
        }

        messages.append(ChatMessage(
            role: "user",
            contentBlocks: [ContentBlockState(type: .text, text: text)]
        ))
        messages.append(ChatMessage(
            role: "assistant",
            requestId: requestId,
            contentBlocks: [],
            streamStartTime: Date()
        ))
        currentInput = ""
        activeRequestIds.insert(requestId)

        sendWebSocket(payload)
    }

    func stopStreaming() {
        guard let sessionId = activeSessionId, let encodedCwd = activeEncodedCwd else { return }
        sendWebSocket([
            "type": "session.stop",
            "session_id": sessionId,
            "encoded_cwd": encodedCwd,
        ])
    }

    // MARK: - Permissions

    func respondToPermission(
        permissionRequestId: String,
        decision: String,
        message: String? = nil,
        mode: PermissionMode? = nil,
        updatedInput: [String: Any]? = nil
    ) {
        // Update local state
        if let idx = permissionRequests.firstIndex(where: { $0.permissionRequestId == permissionRequestId }) {
            permissionRequests[idx].status = decision == "allow" ? .approved : .rejected
            permissionRequests[idx].message = message
            permissionRequests[idx].mode = mode
        }

        // Send WS message
        var payload: [String: Any] = [
            "type": "permission.respond",
            "request_id": permissionRequestId,
            "decision": decision,
        ]
        if let message { payload["message"] = message }
        if let mode { payload["mode"] = mode.rawValue }
        if let updatedInput { payload["updated_input"] = updatedInput }

        sendWebSocket(payload)
    }

    var currentPermissionMode: SessionPermissionMode {
        if let sessionId = activeSessionId, let mode = sessionPermissionModes[sessionId] {
            return mode
        }
        return draftPermissionMode
    }

    // MARK: - Fetch Sessions

    private func fetchSessions(forceRefresh: Bool, cursor: String? = nil) async throws -> ([ClaudeSessionSummary], String?) {
        var queryItems: [URLQueryItem] = []
        if forceRefresh { queryItems.append(URLQueryItem(name: "refresh", value: "1")) }
        if let cursor { queryItems.append(URLQueryItem(name: "cursor", value: cursor)) }

        var request = URLRequest(url: try managerHTTPURL(path: "/v1/sessions", queryItems: queryItems))
        request.httpMethod = "GET"
        applyAuth(to: &request)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let serverError = String(data: data, encoding: .utf8) ?? "Unknown sessions error"
            throw NSError(domain: "manager", code: -11, userInfo: [NSLocalizedDescriptionKey: serverError])
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawSessions = json["sessions"] as? [[String: Any]]
        else {
            throw NSError(domain: "manager", code: -12, userInfo: [NSLocalizedDescriptionKey: "Invalid sessions payload"])
        }

        let nextCursor = json["next_cursor"] as? String

        let sessions = rawSessions.compactMap { item -> ClaudeSessionSummary? in
            guard
                let sessionId = item["session_id"] as? String,
                let encodedCwd = item["encoded_cwd"] as? String
            else { return nil }

            return ClaudeSessionSummary(
                sessionId: sessionId,
                encodedCwd: encodedCwd,
                cwd: item["cwd"] as? String ?? "",
                title: item["title"] as? String ?? "Untitled session",
                lastActivityAt: item["last_activity_at"] as? Int ?? item["updated_at"] as? Int ?? 0,
                messageCount: item["message_count"] as? Int ?? 0,
                totalCostUsd: item["total_cost_usd"] as? Double
            )
        }

        return (sessions, nextCursor)
    }

    // MARK: - Fetch History

    private func fetchSessionHistory(sessionId: String, encodedCwd: String) async throws -> [ChatMessage] {
        let escapedSessionId = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        let queryItems = [URLQueryItem(name: "encoded_cwd", value: encodedCwd)]
        var request = URLRequest(
            url: try managerHTTPURL(path: "/v1/sessions/\(escapedSessionId)/history", queryItems: queryItems)
        )
        request.httpMethod = "GET"
        applyAuth(to: &request)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            let serverError = String(data: data, encoding: .utf8) ?? "Unknown history error"
            throw NSError(domain: "manager", code: -14, userInfo: [NSLocalizedDescriptionKey: serverError])
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let rawMessages = json["messages"] as? [[String: Any]]
        else {
            throw NSError(domain: "manager", code: -15, userInfo: [NSLocalizedDescriptionKey: "Invalid history payload"])
        }

        return mapHistoryToChat(rawMessages)
    }

    // MARK: - History Mapping

    private func mapHistoryToChat(_ rawMessages: [[String: Any]]) -> [ChatMessage] {
        var result: [ChatMessage] = []

        for item in rawMessages {
            guard let role = item["role"] as? String else { continue }

            var blocks: [ContentBlockState] = []

            if let rawBlocks = item["content_blocks"] as? [[String: Any]] {
                blocks = rawBlocks.compactMap { mapContentBlock($0) }
            }

            // Fallback to plain text
            if blocks.isEmpty, let text = item["text"] as? String, !text.isEmpty {
                blocks = [ContentBlockState(type: .text, text: text)]
            }

            guard !blocks.isEmpty else { continue }

            // Merge user messages that only have tool_result blocks into the preceding assistant
            if role == "user" {
                let hasOnlyToolResults = blocks.allSatisfy { $0.type == .toolResult }
                if hasOnlyToolResults, let lastIdx = result.indices.last, result[lastIdx].role == "assistant" {
                    result[lastIdx].contentBlocks.append(contentsOf: blocks)
                    continue
                }
                // Skip user messages with no displayable content
                let hasDisplayable = blocks.contains { $0.type == .text && !$0.text.isEmpty }
                if !hasDisplayable {
                    // Still merge tool_results into preceding assistant
                    let toolResults = blocks.filter { $0.type == .toolResult }
                    if !toolResults.isEmpty, let lastIdx = result.indices.last, result[lastIdx].role == "assistant" {
                        result[lastIdx].contentBlocks.append(contentsOf: toolResults)
                    }
                    continue
                }
            }

            result.append(ChatMessage(role: role, contentBlocks: blocks))
        }

        return result
    }

    private func mapContentBlock(_ raw: [String: Any]) -> ContentBlockState? {
        guard let typeStr = raw["type"] as? String else { return nil }

        switch typeStr {
        case "text":
            let text = raw["text"] as? String ?? ""
            return ContentBlockState(type: .text, text: text)

        case "tool_use":
            let name = raw["name"] as? String ?? ""
            let toolId = raw["id"] as? String ?? ""
            var inputStr = ""
            if let input = raw["input"] {
                if let data = try? JSONSerialization.data(withJSONObject: input),
                   let str = String(data: data, encoding: .utf8) {
                    inputStr = str
                }
            }
            return ContentBlockState(
                type: .toolUse,
                toolName: name,
                toolId: toolId,
                toolInput: inputStr,
                isComplete: true
            )

        case "thinking":
            let text = raw["thinking"] as? String ?? ""
            return ContentBlockState(type: .thinking, text: text, isComplete: true)

        case "tool_result":
            let toolUseId = raw["tool_use_id"] as? String ?? ""
            let text = extractToolResultText(raw)
            let isError = raw["is_error"] as? Bool ?? false
            return ContentBlockState(
                type: .toolResult,
                text: text,
                toolResultForId: toolUseId,
                isError: isError
            )

        default:
            return nil
        }
    }

    private func extractToolResultText(_ raw: [String: Any]) -> String {
        if let content = raw["content"] as? String {
            return content
        }
        if let content = raw["content"] as? [[String: Any]] {
            return content.compactMap { item -> String? in
                if item["type"] as? String == "text" {
                    return item["text"] as? String
                }
                return nil
            }.joined(separator: "\n")
        }
        return ""
    }

    // MARK: - WebSocket

    private func openWebSocket() {
        // Clean up existing connection without full disconnect
        refreshTimer?.invalidate()
        refreshTimer = nil
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        webSocketSession?.invalidateAndCancel()
        webSocketSession = nil

        guard let wsURL = try? managerWebSocketURL(path: "/v1/ws") else {
            connectionStatus = "Invalid WebSocket URL"
            return
        }

        let session = URLSession(configuration: .default)
        webSocketSession = session
        var wsRequest = URLRequest(url: wsURL)
        applyAuth(to: &wsRequest)
        webSocketTask = session.webSocketTask(with: wsRequest)
        webSocketTask?.resume()

        // Don't set isConnected until we receive the "hello" message
        connectionStatus = "Connecting..."

        receiveMessage()
    }

    private func sendWebSocket(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        webSocketTask?.send(.string(json)) { [weak self] error in
            guard let self else { return }
            if let error {
                DispatchQueue.main.async {
                    self.showToast("Send error: \(error.localizedDescription)")
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
                    DispatchQueue.main.async { self.handleServerMessage(text) }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        DispatchQueue.main.async { self.handleServerMessage(text) }
                    }
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure(let error):
                DispatchQueue.main.async {
                    let wasConnected = self.isConnected
                    self.isConnected = false
                    self.activeRequestIds.removeAll()
                    self.connectionStatus = "Disconnected"
                    self.refreshTimer?.invalidate()
                    self.refreshTimer = nil

                    if wasConnected {
                        self.showToast("Connection lost. Reconnecting...")
                        self.connectionStatus = "Reconnecting..."
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                            guard !self.isConnected, !self.isConnecting else { return }
                            self.openWebSocket()
                        }
                    } else {
                        self.showToast("Connection failed: \(error.localizedDescription)")
                        self.connectionStatus = "Connection failed"
                    }
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

    // MARK: - Message Handling

    private func handleServerMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "hello":
            isConnected = true
            connectionStatus = "Connected"
            startRefreshTimer()
            refreshSessions(forceRefresh: true)

        case "session.created":
            historyLoadTask?.cancel()
            historyLoadTask = nil
            activeSessionId = json["session_id"] as? String
            activeEncodedCwd = json["encoded_cwd"] as? String
            if let sessionId = activeSessionId {
                sessionPermissionModes[sessionId] = draftPermissionMode
            }
            if let meta = json["meta"] as? [String: Any] {
                updateSessionMeta(meta)
            }

        case "session.state":
            if let sessionId = json["session_id"] as? String {
                activeSessionId = sessionId
            }
            if let encodedCwd = json["encoded_cwd"] as? String {
                activeEncodedCwd = encodedCwd
            }
            if let meta = json["meta"] as? [String: Any] {
                updateSessionMeta(meta)
            }
            if let status = json["status"] as? String, status == "index_refreshed", !isSessionViewActive {
                refreshSessions(forceRefresh: false)
            }

        case "stream.message":
            handleStreamMessage(json)

        case "stream.done":
            handleStreamDone(json)

        case "permission.request":
            handlePermissionRequest(json)

        case "error":
            handleError(json)

        default:
            break
        }
    }

    // MARK: - stream.message Handling

    private func handleStreamMessage(_ json: [String: Any]) {
        guard let requestId = json["request_id"] as? String,
              let sdkMessage = json["sdk_message"] as? [String: Any],
              let sdkType = sdkMessage["type"] as? String else {
            return
        }

        guard let msgIdx = messages.lastIndex(where: { $0.requestId == requestId }) else {
            return
        }

        switch sdkType {
        case "stream_event":
            handleStreamEvent(sdkMessage, messageIndex: msgIdx, requestId: requestId)

        case "tool_progress":
            handleToolProgress(sdkMessage, messageIndex: msgIdx)

        case "tool_use_summary":
            handleToolUseSummary(sdkMessage, messageIndex: msgIdx)

        case "result":
            handleResult(sdkMessage, messageIndex: msgIdx, json: json)

        case "system":
            if let model = (sdkMessage["model_info"] as? [String: Any])?["model"] as? String {
                if activeSessionMeta == nil { activeSessionMeta = SessionMeta() }
                activeSessionMeta?.model = model
            }

        default:
            break
        }
    }

    private func handleStreamEvent(_ sdkMessage: [String: Any], messageIndex: Int, requestId: String) {
        guard let event = sdkMessage["event"] as? [String: Any],
              let eventTypeStr = event["type"] as? String else {
            return
        }

        switch eventTypeStr {
        case "message_start":
            let base = countStreamBlocks(messages[messageIndex].contentBlocks)
            streamMessageBaseByRequestId[requestId] = base

        case "message_stop":
            streamMessageBaseByRequestId.removeValue(forKey: requestId)

        case "content_block_start":
            guard let eventIndex = event["index"] as? Int,
                  let contentBlock = event["content_block"] as? [String: Any],
                  let blockType = contentBlock["type"] as? String else {
                return
            }

            let streamIndex = (streamMessageBaseByRequestId[requestId] ?? 0) + eventIndex

            switch blockType {
            case "text":
                let text = contentBlock["text"] as? String ?? ""
                let block = ContentBlockState(type: .text, text: text)
                let insertAt = findStreamBlockInsertIndex(messages[messageIndex].contentBlocks, streamIndex: streamIndex)
                messages[messageIndex].contentBlocks.insert(block, at: insertAt)

            case "tool_use":
                let name = contentBlock["name"] as? String ?? ""
                let toolId = contentBlock["id"] as? String ?? ""
                // Deduplicate by toolId
                if messages[messageIndex].contentBlocks.contains(where: { $0.toolId == toolId }) {
                    return
                }
                var inputStr = ""
                if let input = contentBlock["input"] {
                    if let data = try? JSONSerialization.data(withJSONObject: input),
                       let str = String(data: data, encoding: .utf8) {
                        inputStr = str
                    }
                }
                let block = ContentBlockState(type: .toolUse, toolName: name, toolId: toolId, toolInput: inputStr)
                let insertAt = findStreamBlockInsertIndex(messages[messageIndex].contentBlocks, streamIndex: streamIndex)
                messages[messageIndex].contentBlocks.insert(block, at: insertAt)

            case "thinking":
                let text = contentBlock["thinking"] as? String ?? ""
                let block = ContentBlockState(type: .thinking, text: text)
                let insertAt = findStreamBlockInsertIndex(messages[messageIndex].contentBlocks, streamIndex: streamIndex)
                messages[messageIndex].contentBlocks.insert(block, at: insertAt)

            default:
                break
            }

        case "content_block_delta":
            guard let eventIndex = event["index"] as? Int,
                  let delta = event["delta"] as? [String: Any],
                  let deltaType = delta["type"] as? String else {
                return
            }

            let streamIndex = (streamMessageBaseByRequestId[requestId] ?? 0) + eventIndex
            let arrayIndex = findStreamBlockArrayIndex(messages[messageIndex].contentBlocks, streamIndex: streamIndex)
            guard arrayIndex >= 0 else { return }

            switch deltaType {
            case "text_delta":
                if let text = delta["text"] as? String {
                    messages[messageIndex].contentBlocks[arrayIndex].text += text
                }

            case "input_json_delta":
                if let json = delta["partial_json"] as? String {
                    messages[messageIndex].contentBlocks[arrayIndex].toolInput =
                        (messages[messageIndex].contentBlocks[arrayIndex].toolInput ?? "") + json
                }

            case "thinking_delta":
                if let text = delta["thinking"] as? String {
                    messages[messageIndex].contentBlocks[arrayIndex].text += text
                }

            default:
                break
            }

        case "content_block_stop":
            guard let eventIndex = event["index"] as? Int else { return }

            let streamIndex = (streamMessageBaseByRequestId[requestId] ?? 0) + eventIndex
            let arrayIndex = findStreamBlockArrayIndex(messages[messageIndex].contentBlocks, streamIndex: streamIndex)
            guard arrayIndex >= 0 else { return }

            messages[messageIndex].contentBlocks[arrayIndex].isComplete = true

        default:
            break
        }
    }

    private func handleToolProgress(_ sdkMessage: [String: Any], messageIndex: Int) {
        guard let toolName = sdkMessage["tool_name"] as? String,
              let elapsed = sdkMessage["elapsed_time_seconds"] as? Double else {
            return
        }

        // Find the last tool_use block matching this tool name
        for i in stride(from: messages[messageIndex].contentBlocks.count - 1, through: 0, by: -1) {
            if messages[messageIndex].contentBlocks[i].type == .toolUse,
               messages[messageIndex].contentBlocks[i].toolName == toolName {
                messages[messageIndex].contentBlocks[i].elapsedSeconds = elapsed
                break
            }
        }
    }

    private func handleToolUseSummary(_ sdkMessage: [String: Any], messageIndex: Int) {
        let summary = sdkMessage["summary"] as? String ?? ""

        // Find the last tool_use block
        var lastToolId: String?
        for i in stride(from: messages[messageIndex].contentBlocks.count - 1, through: 0, by: -1) {
            if messages[messageIndex].contentBlocks[i].type == .toolUse {
                lastToolId = messages[messageIndex].contentBlocks[i].toolId
                break
            }
        }

        let resultBlock = ContentBlockState(
            type: .toolResult,
            text: summary,
            toolResultForId: lastToolId
        )
        messages[messageIndex].contentBlocks.append(resultBlock)
    }

    private func handleResult(_ sdkMessage: [String: Any], messageIndex: Int, json: [String: Any]) {
        let cost = sdkMessage["total_cost_usd"] as? Double
        let duration = sdkMessage["duration_seconds"] as? Double
            ?? sdkMessage["duration_ms"].flatMap { ($0 as? Double).map { $0 / 1000.0 } }

        if cost != nil || duration != nil {
            let resultBlock = ContentBlockState(
                type: .result,
                totalCostUsd: cost,
                durationSeconds: duration
            )
            messages[messageIndex].contentBlocks.append(resultBlock)

            if let cost {
                if activeSessionMeta == nil { activeSessionMeta = SessionMeta() }
                activeSessionMeta?.totalCostUsd = cost
            }
        }
    }

    // MARK: - stream.done

    private func handleStreamDone(_ json: [String: Any]) {
        if let reqId = json["request_id"] as? String {
            activeRequestIds.remove(reqId)
            streamMessageBaseByRequestId.removeValue(forKey: reqId)
            if let idx = messages.lastIndex(where: { $0.requestId == reqId }) {
                messages[idx].requestId = nil
            }
        } else {
            activeRequestIds.removeAll()
            streamMessageBaseByRequestId.removeAll()
        }

        // Update cost from done message
        if let meta = json["meta"] as? [String: Any] {
            updateSessionMeta(meta)
        }

        // Refresh sessions list to update costs
        if !isSessionViewActive {
            refreshSessions(forceRefresh: false)
        }
    }

    // MARK: - permission.request

    private func handlePermissionRequest(_ json: [String: Any]) {
        guard let permReqId = json["request_id"] as? String,
              let promptReqId = json["prompt_request_id"] as? String,
              let toolName = json["tool_name"] as? String,
              let toolUseId = json["tool_use_id"] as? String else {
            return
        }

        let toolInput = json["tool_input"] as? [String: Any] ?? [:]

        // Upsert into permission requests
        if let idx = permissionRequests.firstIndex(where: { $0.permissionRequestId == permReqId }) {
            permissionRequests[idx] = ToolPermissionRequestState(
                permissionRequestId: permReqId,
                promptRequestId: promptReqId,
                toolName: toolName,
                toolUseId: toolUseId,
                toolInput: toolInput
            )
        } else {
            permissionRequests.append(ToolPermissionRequestState(
                permissionRequestId: permReqId,
                promptRequestId: promptReqId,
                toolName: toolName,
                toolUseId: toolUseId,
                toolInput: toolInput
            ))
        }

        // Inject tool_use block if not already present
        var inputStr = ""
        if let data = try? JSONSerialization.data(withJSONObject: toolInput),
           let str = String(data: data, encoding: .utf8) {
            inputStr = str
        }

        let toolBlock = ContentBlockState(
            type: .toolUse,
            toolName: toolName,
            toolId: toolUseId,
            toolInput: inputStr,
            isComplete: true
        )

        // Find message matching the promptRequestId
        if let msgIdx = messages.lastIndex(where: { $0.requestId == promptReqId }) {
            // Check if tool_use block already exists
            if !messages[msgIdx].contentBlocks.contains(where: { $0.toolId == toolUseId }) {
                messages[msgIdx].contentBlocks.append(toolBlock)
            }
        } else {
            // Create a new assistant message for the permission
            messages.append(ChatMessage(
                role: "assistant",
                requestId: promptReqId,
                contentBlocks: [toolBlock]
            ))
            if !activeRequestIds.contains(promptReqId) {
                activeRequestIds.insert(promptReqId)
            }
        }
    }

    // MARK: - error

    private func handleError(_ json: [String: Any]) {
        let message = json["message"] as? String ?? "Unknown server error"
        let reqId = json["request_id"] as? String

        if let reqId {
            activeRequestIds.remove(reqId)
            streamMessageBaseByRequestId.removeValue(forKey: reqId)
            if let idx = messages.lastIndex(where: { $0.requestId == reqId }) {
                messages[idx].contentBlocks.append(ContentBlockState(type: .text, text: "Error: \(message)"))
                messages[idx].requestId = nil
            } else {
                showToast(message)
            }
        } else {
            activeRequestIds.removeAll()
            showToast(message)
        }
    }

    // MARK: - Toast

    func showToast(_ message: String, isError: Bool = true) {
        toastMessage = message
        toastIsError = isError
    }

    func dismissToast() {
        toastMessage = nil
    }

    // MARK: - Helpers

    private func updateSessionMeta(_ meta: [String: Any]) {
        if activeSessionMeta == nil { activeSessionMeta = SessionMeta() }
        if let cost = meta["total_cost_usd"] as? Double {
            activeSessionMeta?.totalCostUsd = cost
        }
        if let model = meta["model"] as? String {
            activeSessionMeta?.model = model
        }
    }

    private func applyAuth(to request: inout URLRequest) {
        let token = authToken.trimmingCharacters(in: .whitespacesAndNewlines)
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
    }

    private func loadPersistedConfig() {
        serverEndpoint = defaults.string(forKey: DefaultsKey.endpoint) ?? serverEndpoint
        authToken = defaults.string(forKey: DefaultsKey.authToken) ?? authToken
    }

    private func persistConfig() {
        defaults.set(serverEndpoint, forKey: DefaultsKey.endpoint)
        defaults.set(authToken, forKey: DefaultsKey.authToken)
    }

    private func managerHTTPURL(path: String, queryItems: [URLQueryItem] = []) throws -> URL {
        guard let ep = parsedEndpoint else {
            throw NSError(domain: "manager", code: -5, userInfo: [NSLocalizedDescriptionKey: "Invalid endpoint"])
        }
        var components = URLComponents()
        components.scheme = "http"
        components.host = ep.host
        components.port = ep.port
        components.path = path.hasPrefix("/") ? path : "/\(path)"
        if !queryItems.isEmpty { components.queryItems = queryItems }

        guard let url = components.url else {
            throw NSError(domain: "manager", code: -5, userInfo: [NSLocalizedDescriptionKey: "Invalid HTTP URL"])
        }
        return url
    }

    private func managerWebSocketURL(path: String) throws -> URL {
        guard let ep = parsedEndpoint else {
            throw NSError(domain: "manager", code: -7, userInfo: [NSLocalizedDescriptionKey: "Invalid endpoint"])
        }
        var components = URLComponents()
        components.scheme = "ws"
        components.host = ep.host
        components.port = ep.port
        components.path = path.hasPrefix("/") ? path : "/\(path)"

        guard let url = components.url else {
            throw NSError(domain: "manager", code: -7, userInfo: [NSLocalizedDescriptionKey: "Invalid WebSocket URL"])
        }
        return url
    }
}

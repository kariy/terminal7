import Foundation

struct ClaudeSessionSummary: Identifiable, Equatable {
    let sessionId: String
    let encodedCwd: String
    let cwd: String
    let title: String
    let lastActivityAt: Int
    let messageCount: Int
    var totalCostUsd: Double?

    var id: String {
        "\(sessionId)|\(encodedCwd)"
    }
}

struct SessionMeta: Equatable {
    var model: String?
    var totalCostUsd: Double?
    var durationMs: Double?
    var permissionMode: SessionPermissionMode?
}

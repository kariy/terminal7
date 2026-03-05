import Foundation

enum ContentBlockType: String {
    case text
    case toolUse = "tool_use"
    case thinking
    case toolResult = "tool_result"
    case result
}

struct ContentBlockState: Identifiable {
    let id = UUID()
    var type: ContentBlockType
    var text: String = ""
    // tool_use
    var toolName: String?
    var toolId: String?
    var toolInput: String?
    var isComplete: Bool?
    var elapsedSeconds: Double?
    // tool_result (linked to a tool_use block)
    var toolResultForId: String?
    var isError: Bool?
    // result (SDK result message)
    var totalCostUsd: Double?
    var durationSeconds: Double?
}

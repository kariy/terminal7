import Foundation

struct ChatMessage: Identifiable {
    let id = UUID()
    var role: String // "user" or "assistant"
    var requestId: String?
    var contentBlocks: [ContentBlockState] = []
    var streamStartTime: Date?
}

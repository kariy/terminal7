import Foundation

struct Message: Identifiable {
    let id = UUID()
    let role: String // "user" or "assistant"
    var text: String
    var requestId: String?
}

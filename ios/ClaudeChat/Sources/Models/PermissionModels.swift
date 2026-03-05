import Foundation

enum SessionPermissionMode: String, CaseIterable {
    case `default` = "default"
    case plan = "plan"
    case bypassPermissions = "bypassPermissions"

    var label: String {
        switch self {
        case .default: return "Default"
        case .plan: return "Plan"
        case .bypassPermissions: return "Bypass"
        }
    }

    func next() -> SessionPermissionMode {
        switch self {
        case .default: return .plan
        case .plan: return .bypassPermissions
        case .bypassPermissions: return .default
        }
    }
}

enum PermissionMode: String {
    case `default` = "default"
    case acceptEdits = "acceptEdits"
    case bypassPermissions = "bypassPermissions"
}

enum PermissionStatus: String {
    case pending
    case approved
    case rejected
}

struct ToolPermissionRequestState: Identifiable {
    var id: String { permissionRequestId }
    let permissionRequestId: String
    let promptRequestId: String
    let toolName: String
    let toolUseId: String
    let toolInput: [String: Any]
    var status: PermissionStatus = .pending
    var message: String?
    var mode: PermissionMode?
}

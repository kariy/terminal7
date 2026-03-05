import SwiftUI

struct ToolCallBlockView: View {
    let block: ContentBlockState
    let toolResult: ContentBlockState?
    let permissionRequest: ToolPermissionRequestState?
    let isStreaming: Bool
    var onRespondPermission: ((String, String, String?, PermissionMode?, [String: Any]?) -> Void)?

    @State private var isExpanded: Bool = true
    @State private var userToggledExpand = false

    private var isRunning: Bool {
        if permissionRequest?.status == .pending { return true }
        return isStreaming && block.isComplete != true
    }

    private var isExitPlanMode: Bool {
        let name = (block.toolName ?? "").lowercased()
        return name.hasSuffix("exitplanmode")
    }

    private var isAskUserQuestion: Bool {
        let name = (block.toolName ?? "").lowercased()
        if name.contains("askuserquestion") { return true }
        // Also check toolInput for questions array
        if let input = block.toolInput,
           let data = input.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           obj["questions"] is [[String: Any]] {
            return true
        }
        return false
    }

    var body: some View {
        if isExitPlanMode {
            ExitPlanModeView(
                block: block,
                permissionRequest: permissionRequest,
                onRespond: onRespondPermission
            )
        } else {
            standardToolCallView
        }
    }

    private var standardToolCallView: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                userToggledExpand = true
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color(white: 0.4))
                        .frame(width: 12)

                    Image(systemName: toolIcon(block.toolName ?? ""))
                        .font(.system(size: 13))
                        .foregroundStyle(Color(white: 0.6))

                    Text(block.toolName ?? "Tool")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color(white: 0.85))

                    Spacer()

                    if let elapsed = block.elapsedSeconds, isRunning {
                        Text(formatElapsed(elapsed))
                            .font(.caption2)
                            .foregroundStyle(Color(white: 0.4))
                    }

                    statusIndicator
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            // Expanded content
            if computedExpanded {
                Divider()
                    .background(Color(white: 0.2))

                VStack(alignment: .leading, spacing: 8) {
                    if let input = block.toolInput, !input.isEmpty {
                        ToolInputView(toolName: block.toolName ?? "", toolInput: input)
                    }

                    if isAskUserQuestion, let pr = permissionRequest {
                        AskUserQuestionView(
                            block: block,
                            permissionRequest: pr,
                            onRespond: onRespondPermission
                        )
                    }

                    if let result = toolResult {
                        toolResultView(result)
                    }
                }
                .padding(12)
            }
        }
        .background(Color(white: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(
                    permissionRequest?.status == .pending ? Color.orange.opacity(0.4) : Color(white: 0.18),
                    lineWidth: 1
                )
        )
    }

    private var computedExpanded: Bool {
        if userToggledExpand { return isExpanded }
        return isRunning || permissionRequest?.status == .pending
    }

    @ViewBuilder
    private var statusIndicator: some View {
        if isRunning {
            ProgressView()
                .scaleEffect(0.6)
                .tint(Color(white: 0.5))
        } else if block.isComplete == true {
            if toolResult?.isError == true {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.red)
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.green)
            }
        }
    }

    @ViewBuilder
    private func toolResultView(_ result: ContentBlockState) -> some View {
        if !result.text.isEmpty {
            let truncated = result.text.count > 2000
                ? String(result.text.prefix(2000)) + "\n... (truncated)"
                : result.text
            Text(truncated)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(result.isError == true ? Color.red.opacity(0.8) : Color(white: 0.6))
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(white: 0.06))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func formatElapsed(_ seconds: Double) -> String {
        if seconds < 1 { return "<1s" }
        return "\(Int(seconds))s"
    }

    func toolIcon(_ name: String) -> String {
        switch name.lowercased() {
        case "bash": return "terminal"
        case "read": return "doc.text"
        case "edit": return "pencil.line"
        case "write", "notebookedit": return "doc.text"
        case "glob": return "magnifyingglass"
        case "grep": return "text.magnifyingglass"
        case "webfetch": return "globe"
        case "websearch": return "magnifyingglass"
        case "agent": return "person.2"
        case "taskcreate", "taskupdate", "taskget", "taskoutput": return "checklist"
        case "taskstop": return "stop.circle"
        case "skill": return "bolt"
        case "enterworktree": return "arrow.triangle.branch"
        case let n where n.contains("askuserquestion"): return "questionmark.circle"
        case let n where n.hasSuffix("exitplanmode"): return "list.clipboard"
        case let n where n.hasSuffix("enterplanmode"): return "list.clipboard"
        default: return "wrench"
        }
    }
}

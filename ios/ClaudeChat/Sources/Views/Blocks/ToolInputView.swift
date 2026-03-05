import SwiftUI

struct ToolInputView: View {
    let toolName: String
    let toolInput: String

    var body: some View {
        let normalized = toolName.lowercased()
        let data = parseJSON(toolInput)

        Group {
            switch normalized {
            case "bash":
                bashInput(data)
            case "read":
                readInput(data)
            case "edit":
                editInput(data)
            case "write", "notebookedit":
                writeInput(data)
            case "glob":
                globInput(data)
            case "grep":
                grepInput(data)
            case "webfetch":
                webFetchInput(data)
            case "websearch":
                webSearchInput(data)
            case "agent":
                agentInput(data)
            case "taskcreate":
                taskCreateInput(data)
            case "taskupdate":
                taskUpdateInput(data)
            case "taskget", "taskoutput":
                taskIdInput(data)
            case "taskstop":
                taskStopInput(data)
            case "skill":
                skillInput(data)
            case "enterworktree":
                enterWorktreeInput(data)
            default:
                defaultInput()
            }
        }
    }

    // MARK: - Tool-specific views

    @ViewBuilder
    private func bashInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let desc = data["description"] as? String, !desc.isEmpty {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.5))
            }
            if let command = data["command"] as? String {
                HStack(alignment: .top, spacing: 4) {
                    Text("$")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.5))
                    Text(command)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.85))
                        .textSelection(.enabled)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    @ViewBuilder
    private func readInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let path = data["file_path"] as? String {
                filePathLabel(path)
            }
            HStack(spacing: 12) {
                if let offset = data["offset"] as? Int {
                    Text("offset: \(offset)")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.5))
                }
                if let limit = data["limit"] as? Int {
                    Text("limit: \(limit)")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.5))
                }
            }
        }
    }

    @ViewBuilder
    private func editInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if let path = data["file_path"] as? String {
                filePathLabel(path)
            }
            if let oldStr = data["old_string"] as? String, !oldStr.isEmpty {
                diffBlock(text: oldStr, color: Color(red: 0.8, green: 0.3, blue: 0.3), prefix: "-")
            }
            if let newStr = data["new_string"] as? String, !newStr.isEmpty {
                diffBlock(text: newStr, color: Color(red: 0.3, green: 0.7, blue: 0.3), prefix: "+")
            }
        }
    }

    @ViewBuilder
    private func writeInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let path = data["file_path"] as? String {
                filePathLabel(path)
            }
            if let content = data["content"] as? String {
                let truncated = content.count > 500 ? String(content.prefix(500)) + "..." : content
                Text(truncated)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(Color(white: 0.7))
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(white: 0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    @ViewBuilder
    private func globInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let pattern = data["pattern"] as? String {
                HStack(spacing: 4) {
                    Text("pattern:")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.5))
                    Text(pattern)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.85))
                }
            }
            if let path = data["path"] as? String {
                filePathLabel(path)
            }
        }
    }

    @ViewBuilder
    private func grepInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let pattern = data["pattern"] as? String {
                HStack(spacing: 4) {
                    Text("/")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.5))
                    Text(pattern)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.85))
                    Text("/")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color(white: 0.5))
                }
            }
            if let path = data["path"] as? String {
                filePathLabel(path)
            }
        }
    }

    @ViewBuilder
    private func webFetchInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let url = data["url"] as? String {
                Text(url)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.blue)
                    .lineLimit(2)
            }
            if let prompt = data["prompt"] as? String {
                Text(prompt)
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.6))
                    .lineLimit(2)
            }
        }
    }

    @ViewBuilder
    private func webSearchInput(_ data: [String: Any]) -> some View {
        if let query = data["query"] as? String {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.5))
                Text(query)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(white: 0.85))
            }
        }
    }

    @ViewBuilder
    private func agentInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let desc = data["description"] as? String {
                Text(desc)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color(white: 0.85))
            }
            if let prompt = data["prompt"] as? String {
                let truncated = prompt.count > 300 ? String(prompt.prefix(300)) + "..." : prompt
                Text(truncated)
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.5))
            }
        }
    }

    @ViewBuilder
    private func taskCreateInput(_ data: [String: Any]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let subject = data["subject"] as? String {
                Text(subject)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color(white: 0.85))
            }
            if let desc = data["description"] as? String {
                let truncated = desc.count > 200 ? String(desc.prefix(200)) + "..." : desc
                Text(truncated)
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.5))
            }
        }
    }

    @ViewBuilder
    private func taskUpdateInput(_ data: [String: Any]) -> some View {
        HStack(spacing: 8) {
            if let taskId = data["taskId"] as? String {
                Text("#\(taskId)")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.blue)
            }
            if let status = data["status"] as? String {
                Text(status)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(statusColor(status))
            }
            if let subject = data["subject"] as? String {
                Text(subject)
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.6))
                    .lineLimit(1)
            }
        }
    }

    @ViewBuilder
    private func taskIdInput(_ data: [String: Any]) -> some View {
        if let taskId = data["taskId"] as? String {
            Text("#\(taskId)")
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(.blue)
        }
    }

    @ViewBuilder
    private func taskStopInput(_ data: [String: Any]) -> some View {
        HStack(spacing: 8) {
            if let taskId = data["task_id"] as? String {
                Text("#\(taskId)")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.blue)
            }
        }
    }

    @ViewBuilder
    private func skillInput(_ data: [String: Any]) -> some View {
        HStack(spacing: 4) {
            if let skill = data["skill"] as? String {
                Text("/\(skill)")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Color(white: 0.85))
            }
            if let args = data["args"] as? String {
                Text(args)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(Color(white: 0.6))
            }
        }
    }

    @ViewBuilder
    private func enterWorktreeInput(_ data: [String: Any]) -> some View {
        if let name = data["name"] as? String {
            Text(name)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color(white: 0.85))
        }
    }

    @ViewBuilder
    private func defaultInput() -> some View {
        if let data = toolInput.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: data),
           let pretty = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
           let str = String(data: pretty, encoding: .utf8) {
            Text(str)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color(white: 0.7))
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    // MARK: - Helpers

    private func parseJSON(_ input: String) -> [String: Any] {
        guard let data = input.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return obj
    }

    @ViewBuilder
    private func filePathLabel(_ path: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "doc.text")
                .font(.caption2)
                .foregroundStyle(Color(white: 0.5))
            Text(path)
                .font(.system(size: 13, design: .monospaced))
                .foregroundStyle(Color(white: 0.85))
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func diffBlock(text: String, color: Color, prefix: String) -> some View {
        let lines = text.components(separatedBy: "\n")
        let display = lines.prefix(20).map { "\(prefix) \($0)" }.joined(separator: "\n")
            + (lines.count > 20 ? "\n... (\(lines.count - 20) more lines)" : "")

        Text(display)
            .font(.system(size: 12, design: .monospaced))
            .foregroundStyle(color)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(color.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "completed": return .green
        case "in_progress": return .blue
        case "deleted": return .red
        default: return Color(white: 0.6)
        }
    }
}

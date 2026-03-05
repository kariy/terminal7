import SwiftUI
import MarkdownUI

struct ExitPlanModeView: View {
    let block: ContentBlockState
    let permissionRequest: ToolPermissionRequestState?
    var onRespond: ((String, String, String?, PermissionMode?, [String: Any]?) -> Void)?

    @State private var feedback: String = ""
    @State private var showFeedback = false

    private var planText: String {
        guard let input = block.toolInput,
              let data = input.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return "" }

        // Try reading from plan file path or direct text
        if let plan = obj["plan"] as? String { return plan }
        return ""
    }

    private var allowedPrompts: [[String: String]] {
        guard let input = block.toolInput,
              let data = input.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let prompts = obj["allowedPrompts"] as? [[String: String]]
        else { return [] }
        return prompts
    }

    private var toolInputDict: [String: Any] {
        guard let input = block.toolInput,
              let data = input.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return obj
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Plan header
            HStack(spacing: 8) {
                Image(systemName: "list.clipboard")
                    .font(.system(size: 16))
                    .foregroundStyle(Color(white: 0.6))
                Text("Plan")
                    .font(.headline)
                    .foregroundStyle(.white)
            }

            // Plan content
            if !planText.isEmpty {
                TextBlockView(text: planText)
            }

            // Allowed prompts
            if !allowedPrompts.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Requested permissions:")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color(white: 0.5))

                    ForEach(Array(allowedPrompts.enumerated()), id: \.offset) { _, prompt in
                        HStack(spacing: 6) {
                            Image(systemName: "lock.open")
                                .font(.caption2)
                                .foregroundStyle(Color(white: 0.4))
                            Text("\(prompt["tool"] ?? ""):")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Color(white: 0.6))
                            Text(prompt["prompt"] ?? "")
                                .font(.caption)
                                .foregroundStyle(Color(white: 0.5))
                        }
                    }
                }
                .padding(8)
                .background(Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            // Approval UI
            if let pr = permissionRequest {
                if pr.status == .pending {
                    pendingApprovalView(pr)
                } else {
                    resolvedView(pr)
                }
            }
        }
        .padding(14)
        .background(Color(white: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(
                    permissionRequest?.status == .pending ? Color.orange.opacity(0.4) : Color(white: 0.18),
                    lineWidth: 1
                )
        )
    }

    @ViewBuilder
    private func pendingApprovalView(_ pr: ToolPermissionRequestState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ready to code?")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)

            if showFeedback {
                TextField("Feedback (optional)...", text: $feedback, axis: .vertical)
                    .lineLimit(2...5)
                    .textFieldStyle(.plain)
                    .padding(10)
                    .background(Color(white: 0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .foregroundStyle(.white)
            }

            HStack(spacing: 10) {
                Button {
                    onRespond?(pr.permissionRequestId, "allow", nil, nil, toolInputDict)
                } label: {
                    Text("Approve")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 8)
                        .background(Color.green.opacity(0.7))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Button {
                    if showFeedback {
                        let msg = feedback.isEmpty
                            ? "Exit plan mode was rejected by the user."
                            : feedback
                        onRespond?(pr.permissionRequestId, "deny", msg, nil, nil)
                    } else {
                        showFeedback = true
                    }
                } label: {
                    Text(showFeedback ? "Reject" : "Give Feedback")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.red.opacity(showFeedback ? 0.7 : 0.3))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }

    @ViewBuilder
    private func resolvedView(_ pr: ToolPermissionRequestState) -> some View {
        HStack(spacing: 6) {
            Image(systemName: pr.status == .approved ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(pr.status == .approved ? .green : .red)
            Text(pr.status == .approved ? "Plan approved" : "Plan rejected")
                .font(.caption.weight(.medium))
                .foregroundStyle(pr.status == .approved ? .green : .red)
        }
    }
}

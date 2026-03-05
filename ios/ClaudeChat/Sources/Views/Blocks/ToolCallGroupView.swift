import SwiftUI

struct ToolCallGroupView: View {
    let blocks: [ContentBlockState]
    let toolResults: [String: ContentBlockState]
    let permissionRequests: [ToolPermissionRequestState]
    let isStreaming: Bool
    var onRespondPermission: ((String, String, String?, PermissionMode?, [String: Any]?) -> Void)?

    @State private var isExpanded = false

    private var allComplete: Bool {
        blocks.allSatisfy { $0.isComplete == true }
    }

    private var toolNamesSummary: String {
        let names = blocks.compactMap { $0.toolName }
        let unique = Array(dict: names.reduce(into: [:]) { d, n in d[n, default: 0] += 1 })
        return unique.map { $0.count > 1 ? "\($0.name) x\($0.count)" : $0.name }.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(Color(white: 0.4))
                        .frame(width: 12)

                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(white: 0.5))

                    Text("\(blocks.count) tool calls")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color(white: 0.7))

                    Text("— \(toolNamesSummary)")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.4))
                        .lineLimit(1)

                    Spacer()

                    if allComplete {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.green)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                    .background(Color(white: 0.2))

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(blocks) { block in
                        ToolCallBlockView(
                            block: block,
                            toolResult: block.toolId.flatMap { toolResults[$0] },
                            permissionRequest: findPermission(for: block),
                            isStreaming: isStreaming,
                            onRespondPermission: onRespondPermission
                        )
                    }
                }
                .padding(8)
            }
        }
        .background(Color(white: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(white: 0.18), lineWidth: 1)
        )
    }

    private func findPermission(for block: ContentBlockState) -> ToolPermissionRequestState? {
        guard let toolId = block.toolId else { return nil }
        let matching = permissionRequests.filter { $0.toolUseId == toolId }
        return matching.first { $0.status == .pending } ?? matching.last
    }
}

// Helper for tool name counting
private extension Array where Element == (name: String, count: Int) {
    init(dict: [String: Int]) {
        self = dict.map { (name: $0.key, count: $0.value) }.sorted { $0.name < $1.name }
    }
}

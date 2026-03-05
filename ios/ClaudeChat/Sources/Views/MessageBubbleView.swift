import SwiftUI

// A segment is either a single block or a group of consecutive tool calls
enum BlockSegment: Identifiable {
    case single(ContentBlockState, Int)
    case toolGroup([ContentBlockState], Int)

    var id: String {
        switch self {
        case .single(let block, let idx): return "s-\(block.id)-\(idx)"
        case .toolGroup(let blocks, let idx): return "g-\(blocks.first?.id.uuidString ?? "")-\(idx)"
        }
    }
}

struct MessageBubbleView: View {
    let message: ChatMessage
    let permissionRequests: [ToolPermissionRequestState]
    let isStreaming: Bool
    var onRespondPermission: ((String, String, String?, PermissionMode?, [String: Any]?) -> Void)?

    var body: some View {
        if message.role == "user" {
            userBubble
        } else {
            assistantBubble
        }
    }

    // MARK: - User Bubble

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 60)

            let textContent = message.contentBlocks
                .filter { $0.type == .text }
                .map(\.text)
                .joined()

            if textContent.isEmpty && isStreaming {
                TypingIndicator()
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            } else {
                TextBlockView(text: textContent)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    // MARK: - Assistant Bubble

    private var assistantBubble: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                let toolResults = buildToolResultsMap()
                let visibleBlocks = message.contentBlocks.filter { $0.type != .toolResult }
                let segments = segmentBlocks(visibleBlocks)

                if segments.isEmpty && isStreaming {
                    TypingIndicator()
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color(white: 0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                } else {
                    ForEach(segments) { segment in
                        switch segment {
                        case .single(let block, _):
                            singleBlockView(block, toolResults: toolResults)
                        case .toolGroup(let blocks, _):
                            ToolCallGroupView(
                                blocks: blocks,
                                toolResults: toolResults,
                                permissionRequests: permissionRequests,
                                isStreaming: isStreaming,
                                onRespondPermission: onRespondPermission
                            )
                        }
                    }

                    if isStreaming {
                        TypingBarsLoader()
                    }
                }
            }

            Spacer(minLength: 24)
        }
    }

    // MARK: - Single Block Rendering

    @ViewBuilder
    private func singleBlockView(_ block: ContentBlockState, toolResults: [String: ContentBlockState]) -> some View {
        switch block.type {
        case .text:
            if !block.text.isEmpty {
                TextBlockView(text: block.text)
            }

        case .toolUse:
            ToolCallBlockView(
                block: block,
                toolResult: block.toolId.flatMap { toolResults[$0] },
                permissionRequest: findPermission(for: block),
                isStreaming: isStreaming,
                onRespondPermission: onRespondPermission
            )

        case .thinking:
            ThinkingBlockView(
                text: block.text,
                isComplete: block.isComplete ?? false
            )

        case .result:
            if let cost = block.totalCostUsd {
                ResultBarView(totalCostUsd: cost, durationSeconds: block.durationSeconds)
            }

        case .toolResult:
            EmptyView()
        }
    }

    // MARK: - Segmentation

    private func segmentBlocks(_ blocks: [ContentBlockState]) -> [BlockSegment] {
        var segments: [BlockSegment] = []
        var toolGroup: [ContentBlockState] = []
        var groupStart = 0

        func flushToolGroup() {
            if !toolGroup.isEmpty {
                if toolGroup.count == 1 {
                    segments.append(.single(toolGroup[0], groupStart))
                } else {
                    segments.append(.toolGroup(toolGroup, groupStart))
                }
                toolGroup = []
            }
        }

        for (i, block) in blocks.enumerated() {
            if block.type == .toolUse {
                let hasPendingPermission = findPermission(for: block)?.status == .pending
                if hasPendingPermission || isInteractiveTool(block) {
                    flushToolGroup()
                    segments.append(.single(block, i))
                } else {
                    if toolGroup.isEmpty { groupStart = i }
                    toolGroup.append(block)
                }
            } else {
                flushToolGroup()
                segments.append(.single(block, i))
            }
        }
        flushToolGroup()

        return segments
    }

    private func isInteractiveTool(_ block: ContentBlockState) -> Bool {
        let name = (block.toolName ?? "").lowercased()
        return name.hasSuffix("exitplanmode") || name.contains("askuserquestion")
    }

    // MARK: - Helpers

    private func buildToolResultsMap() -> [String: ContentBlockState] {
        var map: [String: ContentBlockState] = [:]
        for block in message.contentBlocks where block.type == .toolResult {
            if let forId = block.toolResultForId {
                map[forId] = block
            }
        }
        return map
    }

    private func findPermission(for block: ContentBlockState) -> ToolPermissionRequestState? {
        guard let toolId = block.toolId else { return nil }
        let matching = permissionRequests.filter { $0.toolUseId == toolId }
        return matching.first { $0.status == .pending } ?? matching.last
    }
}

// MARK: - Result Bar

struct ResultBarView: View {
    let totalCostUsd: Double
    let durationSeconds: Double?

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(.green)
            Text("Done")
                .font(.caption.weight(.medium))
                .foregroundStyle(.green)

            Spacer()

            Text(String(format: "$%.4f", totalCostUsd))
                .font(.caption)
                .foregroundStyle(Color(white: 0.5))

            if let dur = durationSeconds {
                Text(formatDuration(dur))
                    .font(.caption)
                    .foregroundStyle(Color(white: 0.5))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.green.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func formatDuration(_ seconds: Double) -> String {
        let mins = Int(seconds) / 60
        let secs = Int(seconds) % 60
        if mins > 0 { return "\(mins)m \(secs)s" }
        return "\(secs)s"
    }
}

// MARK: - Typing Indicators

struct TypingIndicator: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .frame(width: 8, height: 8)
                    .foregroundStyle(.white.opacity(0.7))
                    .offset(y: animating ? -4 : 4)
                    .animation(
                        .easeInOut(duration: 0.5)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.15),
                        value: animating
                    )
            }
        }
        .onAppear { animating = true }
    }
}

struct TypingBarsLoader: View {
    @State private var animating = false

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<3, id: \.self) { index in
                RoundedRectangle(cornerRadius: 1.5)
                    .frame(width: 3, height: animating ? 16 : 8)
                    .foregroundStyle(Color(white: 0.4))
                    .animation(
                        .easeInOut(duration: 0.4)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.12),
                        value: animating
                    )
            }
        }
        .frame(height: 16)
        .onAppear { animating = true }
    }
}

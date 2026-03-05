import SwiftUI

struct Turn: Identifiable {
    let id = UUID()
    var userMessage: ChatMessage?
    var assistantBlocks: [ContentBlockState]
    var assistantRequestId: String?
    var isStreaming: Bool
}

struct ChatView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Session cost display
            if let meta = viewModel.activeSessionMeta, let cost = meta.totalCostUsd, cost > 0 {
                HStack {
                    Spacer()
                    Text(String(format: "Session cost: $%.4f", cost))
                        .font(.caption2)
                        .foregroundStyle(Color(white: 0.4))
                    Spacer()
                }
                .padding(.vertical, 4)
                .background(Color(white: 0.1))
            }

            // Messages list
            messagesList

            // Permission mode + input bar
            VStack(spacing: 0) {
                PermissionModeSelectorView(mode: $viewModel.draftPermissionMode)
                    .padding(.horizontal, 12)
                    .padding(.top, 6)

                inputBar
            }
            .background(Color(white: 0.12))
        }
    }

    // MARK: - Messages List

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    let turns = groupIntoTurns(viewModel.messages)
                    ForEach(turns) { turn in
                        if let userMsg = turn.userMessage {
                            MessageBubbleView(
                                message: userMsg,
                                permissionRequests: [],
                                isStreaming: false
                            )
                            .id("user-\(userMsg.id)")
                        }

                        if !turn.assistantBlocks.isEmpty || turn.isStreaming {
                            let assistantMsg = ChatMessage(
                                role: "assistant",
                                requestId: turn.assistantRequestId,
                                contentBlocks: turn.assistantBlocks
                            )
                            MessageBubbleView(
                                message: assistantMsg,
                                permissionRequests: viewModel.permissionRequests,
                                isStreaming: turn.isStreaming,
                                onRespondPermission: { id, decision, message, mode, updatedInput in
                                    viewModel.respondToPermission(
                                        permissionRequestId: id,
                                        decision: decision,
                                        message: message,
                                        mode: mode,
                                        updatedInput: updatedInput
                                    )
                                }
                            )
                            .id("assistant-\(turn.id)")
                        }
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: viewModel.messages.last?.contentBlocks.count) {
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let turns = groupIntoTurns(viewModel.messages)
        if let last = turns.last {
            withAnimation(.easeOut(duration: 0.15)) {
                proxy.scrollTo("assistant-\(last.id)", anchor: .bottom)
            }
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            TextField("Message...", text: $viewModel.currentInput, axis: .vertical)
                .lineLimit(1...5)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color(white: 0.18))
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .foregroundStyle(.white)
                .onSubmit {
                    viewModel.send()
                }
                .disabled(!viewModel.isConnected || !viewModel.isSessionViewActive)

            if viewModel.isStreaming {
                Button {
                    viewModel.stopStreaming()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(.red)
                }
            } else {
                Button {
                    viewModel.send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(canSend ? .blue : .gray)
                }
                .disabled(!canSend)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var canSend: Bool {
        viewModel.isConnected &&
            viewModel.isSessionViewActive &&
            !viewModel.currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Turn Grouping

    private func groupIntoTurns(_ messages: [ChatMessage]) -> [Turn] {
        var turns: [Turn] = []
        var currentTurn: Turn?

        for msg in messages {
            if msg.role == "user" {
                if let turn = currentTurn {
                    turns.append(turn)
                }
                currentTurn = Turn(
                    userMessage: msg,
                    assistantBlocks: [],
                    assistantRequestId: nil,
                    isStreaming: false
                )
            } else {
                if currentTurn == nil {
                    currentTurn = Turn(
                        userMessage: nil,
                        assistantBlocks: [],
                        assistantRequestId: nil,
                        isStreaming: false
                    )
                }
                currentTurn?.assistantBlocks.append(contentsOf: msg.contentBlocks)
                if msg.requestId != nil {
                    currentTurn?.assistantRequestId = msg.requestId
                    currentTurn?.isStreaming = true
                }
            }
        }

        if let turn = currentTurn {
            turns.append(turn)
        }

        return turns
    }
}

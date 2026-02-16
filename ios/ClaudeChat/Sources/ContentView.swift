import SwiftUI

struct ContentView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
        VStack(spacing: 0) {
            header
            if !viewModel.isConnected {
                connectionForm
                Spacer()
            } else if !viewModel.isSessionViewActive {
                sessionHome
            } else {
                messagesList
                inputBar
            }
        }
        .background(Color(white: 0.08))
    }

    private var header: some View {
        HStack {
            if viewModel.isConnected && viewModel.isSessionViewActive {
                Button {
                    viewModel.returnToSessionHome()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(8)
                        .background(Color(white: 0.2))
                        .clipShape(Circle())
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Claude Manager")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(viewModel.connectionStatus)
                    .font(.caption)
                    .foregroundStyle(viewModel.isConnected ? .green : .gray)
            }

            Spacer()

            if viewModel.isConnecting {
                ProgressView()
                    .tint(.white)
                    .scaleEffect(0.85)
            }

            Button(viewModel.isConnected ? "Disconnect" : "Connect") {
                if viewModel.isConnected {
                    viewModel.disconnect()
                } else {
                    viewModel.connect()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isConnecting)
        }
        .padding(.horizontal)
        .padding(.vertical, 12)
        .background(Color(white: 0.12))
    }

    private var connectionForm: some View {
        VStack(spacing: 10) {
            TextField("Server host", text: $viewModel.serverHost)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Color(white: 0.16))
                .clipShape(RoundedRectangle(cornerRadius: 10))

            Text("Port 8787 (fixed)")
                .font(.caption)
                .foregroundStyle(.gray)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .foregroundStyle(.white)
        .background(Color(white: 0.10))
    }

    private var sessionHome: some View {
        ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Sessions")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.white)

                    Spacer()

                    Button {
                        viewModel.refreshSessions(forceRefresh: true)
                    } label: {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(10)
                            .background(Color(white: 0.2))
                            .clipShape(Circle())
                    }
                }

                Text("Connected to \(viewModel.serverHost)")
                    .font(.caption)
                    .foregroundStyle(.gray)

                if viewModel.isLoadingSessions {
                    VStack {
                        Spacer()
                        ProgressView()
                            .tint(.white)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.sessions.isEmpty {
                    VStack(spacing: 8) {
                        Spacer()
                        Text("No sessions yet")
                            .font(.headline)
                            .foregroundStyle(.white)
                        Text("Tap + to create a new Claude Code session.")
                            .font(.caption)
                            .foregroundStyle(.gray)
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(viewModel.sessions) { session in
                                Button {
                                    viewModel.openExistingSession(session)
                                } label: {
                                    SessionRow(session: session)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.bottom, 90)
                    }
                }
            }
            .padding()

            Button {
                viewModel.startNewClaudeCodeSession()
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 60, height: 60)
                    .background(Color.blue)
                    .clipShape(Circle())
                    .shadow(color: .black.opacity(0.35), radius: 8, x: 0, y: 4)
            }
            .padding(.trailing, 20)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            viewModel.refreshSessions(forceRefresh: false)
        }
    }

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding()
            }
            .onChange(of: viewModel.messages.count) {
                if let last = viewModel.messages.last {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
            .onChange(of: viewModel.messages.last?.text) {
                if let last = viewModel.messages.last {
                    withAnimation(.easeOut(duration: 0.1)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

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

            Button {
                viewModel.send()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(canSend ? .blue : .gray)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(white: 0.12))
    }

    private var canSend: Bool {
        viewModel.isConnected &&
            viewModel.isSessionViewActive &&
            !viewModel.isStreaming &&
            !viewModel.currentInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

private struct MessageBubble: View {
    let message: Message

    var body: some View {
        HStack {
            if message.role == "user" { Spacer(minLength: 60) }

            Text(message.text)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(message.role == "user" ? Color.blue : Color(white: 0.2))
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            if message.role == "assistant" { Spacer(minLength: 60) }
        }
    }
}

private struct SessionRow: View {
    let session: ClaudeSessionSummary

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(session.title)
                    .font(.headline)
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(session.cwd)
                    .font(.caption)
                    .foregroundStyle(.gray)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Text(activityLabel)
                    Text("•")
                    Text("\(session.messageCount) messages")
                }
                .font(.caption2)
                .foregroundStyle(.gray)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.gray)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color(white: 0.16))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var activityLabel: String {
        guard session.lastActivityAt > 0 else { return "No activity" }
        let date = Date(timeIntervalSince1970: TimeInterval(session.lastActivityAt) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

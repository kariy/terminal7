import SwiftUI

struct SessionsListView: View {
    @Bindable var viewModel: ChatViewModel

    var body: some View {
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

                            // Infinite scroll trigger
                            if viewModel.sessionsNextCursor != nil {
                                ProgressView()
                                    .tint(.white)
                                    .padding()
                                    .onAppear {
                                        viewModel.loadMoreSessions()
                                    }
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
                    Text("\u{2022}")
                    Text("\(session.messageCount) messages")
                    if let cost = session.totalCostUsd, cost > 0 {
                        Text("\u{2022}")
                        Text(String(format: "$%.2f", cost))
                    }
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

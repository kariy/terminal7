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
                SessionsListView(viewModel: viewModel)
            } else {
                ChatView(viewModel: viewModel)
            }
        }
        .background(Color(white: 0.08))
        .overlay(alignment: .top) {
            if let toast = viewModel.toastMessage {
                ToastView(
                    message: toast,
                    isError: viewModel.toastIsError,
                    onDismiss: { viewModel.dismissToast() }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
                .padding(.top, 8)
                .zIndex(100)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.toastMessage)
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
            TextField("Server endpoint (host or host:port)", text: $viewModel.serverEndpoint)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .padding(10)
                .background(Color(white: 0.16))
                .clipShape(RoundedRectangle(cornerRadius: 10))

            Text("e.g. 192.168.1.10:8787 or myserver.local")
                .font(.caption)
                .foregroundStyle(.gray)
                .frame(maxWidth: .infinity, alignment: .leading)

            SecureField("Auth token (optional)", text: $viewModel.authToken)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Color(white: 0.16))
                .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .padding()
        .foregroundStyle(.white)
        .background(Color(white: 0.10))
    }
}

private struct ToastView: View {
    let message: String
    var isError: Bool = true
    var onDismiss: () -> Void

    @State private var autoDismissTask: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "info.circle.fill")
                .font(.system(size: 16))
                .foregroundStyle(isError ? .yellow : .blue)

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.white)
                .lineLimit(3)

            Spacer(minLength: 4)

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(Color(white: 0.5))
                    .padding(4)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color(white: 0.18))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
        .padding(.horizontal, 16)
        .onAppear {
            autoDismissTask?.cancel()
            autoDismissTask = Task {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                await MainActor.run { onDismiss() }
            }
        }
        .onDisappear {
            autoDismissTask?.cancel()
        }
    }
}

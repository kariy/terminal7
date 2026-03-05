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
}

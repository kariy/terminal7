import SwiftUI

@main
struct ClaudeChatApp: App {
    @State private var viewModel = ChatViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(viewModel: viewModel)
                .preferredColorScheme(.dark)
                .onAppear {
                    viewModel.autoConnectIfPossible()
                }
        }
    }
}

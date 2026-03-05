import SwiftUI

struct PermissionModeSelectorView: View {
    @Binding var mode: SessionPermissionMode
    var onCycle: (() -> Void)?

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SessionPermissionMode.allCases, id: \.rawValue) { option in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        mode = option
                    }
                } label: {
                    Text(option.label)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(mode == option ? foregroundColor(option) : Color(white: 0.5))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                        .background(mode == option ? backgroundColor(option) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Color(white: 0.12))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func foregroundColor(_ option: SessionPermissionMode) -> Color {
        switch option {
        case .default: return .white
        case .plan: return .green
        case .bypassPermissions: return .red
        }
    }

    private func backgroundColor(_ option: SessionPermissionMode) -> Color {
        switch option {
        case .default: return Color(white: 0.22)
        case .plan: return Color.green.opacity(0.2)
        case .bypassPermissions: return Color.red.opacity(0.2)
        }
    }
}

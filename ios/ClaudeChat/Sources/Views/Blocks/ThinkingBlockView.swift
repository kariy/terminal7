import SwiftUI
import MarkdownUI

struct ThinkingBlockView: View {
    let text: String
    let isComplete: Bool
    @State private var isExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "brain")
                        .font(.system(size: 14))
                        .foregroundStyle(Color(white: 0.6))

                    Text(isComplete ? "Thinking" : "Thinking...")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color(white: 0.6))

                    if !isComplete {
                        ProgressView()
                            .scaleEffect(0.6)
                            .tint(Color(white: 0.5))
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(Color(white: 0.4))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider()
                    .background(Color(white: 0.2))

                Markdown(text)
                    .markdownTheme(.claudeDark)
                    .markdownTextStyle {
                        ForegroundColor(Color(white: 0.6))
                        FontSize(13)
                        FontStyle(.italic)
                    }
                    .padding(12)
            }
        }
        .background(Color(white: 0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color(white: 0.18), lineWidth: 1)
        )
    }
}

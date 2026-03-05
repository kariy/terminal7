import SwiftUI
import MarkdownUI

struct TextBlockView: View {
    let text: String

    var body: some View {
        Markdown(text)
            .markdownTheme(.claudeDark)
            .textSelection(.enabled)
    }
}

extension MarkdownUI.Theme {
    static let claudeDark = Theme()
        .text {
            ForegroundColor(.white)
            FontSize(15)
        }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(13)
            ForegroundColor(Color(red: 0.9, green: 0.8, blue: 0.5))
            BackgroundColor(Color(white: 0.15))
        }
        .codeBlock { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(13)
                        ForegroundColor(Color(white: 0.9))
                    }
                    .padding(12)
            }
            .background(Color(white: 0.12))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(22)
                    ForegroundColor(.white)
                }
                .markdownMargin(top: 16, bottom: 8)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.bold)
                    FontSize(18)
                    ForegroundColor(.white)
                }
                .markdownMargin(top: 12, bottom: 6)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontWeight(.semibold)
                    FontSize(16)
                    ForegroundColor(.white)
                }
                .markdownMargin(top: 10, bottom: 4)
        }
        .paragraph { configuration in
            configuration.label
                .markdownMargin(top: 0, bottom: 8)
        }
        .link {
            ForegroundColor(.blue)
        }
        .strong {
            FontWeight(.bold)
        }
        .emphasis {
            FontStyle(.italic)
        }
        .listItem { configuration in
            configuration.label
                .markdownMargin(top: 2, bottom: 2)
        }
        .blockquote { configuration in
            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color(white: 0.4))
                    .frame(width: 3)
                configuration.label
                    .markdownTextStyle {
                        ForegroundColor(Color(white: 0.7))
                        FontStyle(.italic)
                    }
                    .padding(.leading, 12)
            }
            .markdownMargin(top: 4, bottom: 4)
        }
        .table { configuration in
            configuration.label
                .markdownTableBorderStyle(.init(color: Color(white: 0.3)))
                .markdownMargin(top: 4, bottom: 4)
        }
        .tableCell { configuration in
            configuration.label
                .markdownTextStyle {
                    ForegroundColor(.white)
                    FontSize(14)
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 8)
        }
}

import SwiftUI

struct AskUserQuestionView: View {
    let block: ContentBlockState
    let permissionRequest: ToolPermissionRequestState
    var onRespond: ((String, String, String?, PermissionMode?, [String: Any]?) -> Void)?

    @State private var currentQuestionIndex = 0
    @State private var answers: [String: String] = [:]
    @State private var otherTexts: [String: String] = [:]

    private var questions: [[String: Any]] {
        guard let qs = permissionRequest.toolInput["questions"] as? [[String: Any]] else { return [] }
        return qs
    }

    private var isSubmitted: Bool {
        permissionRequest.status != .pending
    }

    var body: some View {
        if questions.isEmpty {
            invalidPayloadView
        } else if isSubmitted {
            submittedView
        } else {
            questionCarousel
        }
    }

    // MARK: - Question Carousel

    @ViewBuilder
    private var questionCarousel: some View {
        let q = questions[currentQuestionIndex]
        let questionText = q["question"] as? String ?? ""
        let header = q["header"] as? String ?? ""
        let options = q["options"] as? [[String: Any]] ?? []
        let multiSelect = q["multiSelect"] as? Bool ?? false

        VStack(alignment: .leading, spacing: 10) {
            // Navigation
            if questions.count > 1 {
                HStack {
                    Button {
                        withAnimation { currentQuestionIndex = max(0, currentQuestionIndex - 1) }
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(currentQuestionIndex > 0 ? .white : Color(white: 0.3))
                    }
                    .disabled(currentQuestionIndex == 0)

                    Spacer()

                    if !header.isEmpty {
                        Text(header)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color(white: 0.5))
                    }

                    Text("\(currentQuestionIndex + 1)/\(questions.count)")
                        .font(.caption)
                        .foregroundStyle(Color(white: 0.4))

                    Spacer()

                    Button {
                        withAnimation { currentQuestionIndex = min(questions.count - 1, currentQuestionIndex + 1) }
                    } label: {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(currentQuestionIndex < questions.count - 1 ? .white : Color(white: 0.3))
                    }
                    .disabled(currentQuestionIndex >= questions.count - 1)
                }
            }

            // Question text
            Text(questionText)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)

            // Options
            let selectedForQ = answers[questionText] ?? ""
            let selectedLabels = multiSelect ? Set(selectedForQ.split(separator: "\n").map(String.init)) : []

            ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                let label = option["label"] as? String ?? ""
                let desc = option["description"] as? String ?? ""
                let isSelected = multiSelect ? selectedLabels.contains(label) : selectedForQ == label

                Button {
                    selectOption(questionText: questionText, label: label, multiSelect: multiSelect)
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: isSelected
                              ? (multiSelect ? "checkmark.square.fill" : "circle.inset.filled")
                              : (multiSelect ? "square" : "circle"))
                            .font(.system(size: 16))
                            .foregroundStyle(isSelected ? .blue : Color(white: 0.4))

                        VStack(alignment: .leading, spacing: 2) {
                            Text(label)
                                .font(.subheadline)
                                .foregroundStyle(.white)
                            if !desc.isEmpty {
                                Text(desc)
                                    .font(.caption)
                                    .foregroundStyle(Color(white: 0.5))
                            }
                        }

                        Spacer()
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(isSelected ? Color.blue.opacity(0.15) : Color(white: 0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }

            // "Other" option
            let otherSelected = multiSelect ? selectedLabels.contains("Other") : selectedForQ == "Other"

            Button {
                selectOption(questionText: questionText, label: "Other", multiSelect: multiSelect)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: otherSelected
                          ? (multiSelect ? "checkmark.square.fill" : "circle.inset.filled")
                          : (multiSelect ? "square" : "circle"))
                        .font(.system(size: 16))
                        .foregroundStyle(otherSelected ? .blue : Color(white: 0.4))

                    Text("Other")
                        .font(.subheadline)
                        .foregroundStyle(.white)

                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(otherSelected ? Color.blue.opacity(0.15) : Color(white: 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)

            if otherSelected {
                TextField("Enter your answer...", text: Binding(
                    get: { otherTexts[questionText] ?? "" },
                    set: { otherTexts[questionText] = $0 }
                ))
                .textFieldStyle(.plain)
                .padding(10)
                .background(Color(white: 0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .foregroundStyle(.white)
            }

            // Submit button
            if allAnswered {
                Button {
                    submitAnswers()
                } label: {
                    Text("Submit")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(canSubmit ? Color.blue : Color(white: 0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(!canSubmit)
            }
        }
        .padding(12)
        .background(Color(white: 0.08))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    // MARK: - Submitted / Invalid

    @ViewBuilder
    private var submittedView: some View {
        HStack(spacing: 6) {
            Image(systemName: permissionRequest.status == .approved
                  ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(permissionRequest.status == .approved ? .green : .red)
            Text(permissionRequest.status == .approved ? "Answers submitted" : "Rejected")
                .font(.caption.weight(.medium))
                .foregroundStyle(permissionRequest.status == .approved ? .green : .red)
        }
        .padding(8)
    }

    @ViewBuilder
    private var invalidPayloadView: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Invalid question payload")
                .font(.caption)
                .foregroundStyle(.orange)

            if permissionRequest.status == .pending {
                Button {
                    onRespond?(permissionRequest.permissionRequestId, "deny", "Invalid question payload", nil, nil)
                } label: {
                    Text("Reject")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color.red.opacity(0.6))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
    }

    // MARK: - Logic

    private func selectOption(questionText: String, label: String, multiSelect: Bool) {
        if multiSelect {
            var current = Set((answers[questionText] ?? "").split(separator: "\n").map(String.init))
            if current.contains(label) {
                current.remove(label)
            } else {
                current.insert(label)
            }
            answers[questionText] = current.sorted().joined(separator: "\n")
        } else {
            answers[questionText] = label
            // Auto-advance for single-select
            if label != "Other" && currentQuestionIndex < questions.count - 1 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    withAnimation {
                        // Find next unanswered question
                        for i in (currentQuestionIndex + 1)..<questions.count {
                            let qt = questions[i]["question"] as? String ?? ""
                            if answers[qt] == nil || answers[qt]?.isEmpty == true {
                                currentQuestionIndex = i
                                return
                            }
                        }
                        currentQuestionIndex = min(questions.count - 1, currentQuestionIndex + 1)
                    }
                }
            }
        }
    }

    private var allAnswered: Bool {
        questions.allSatisfy { q in
            let qt = q["question"] as? String ?? ""
            let answer = answers[qt] ?? ""
            return !answer.isEmpty
        }
    }

    private var canSubmit: Bool {
        guard allAnswered else { return false }
        // Check all "Other" selections have text
        for q in questions {
            let qt = q["question"] as? String ?? ""
            let answer = answers[qt] ?? ""
            let multiSelect = q["multiSelect"] as? Bool ?? false
            if multiSelect {
                let labels = Set(answer.split(separator: "\n").map(String.init))
                if labels.contains("Other") && (otherTexts[qt] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                    return false
                }
            } else if answer == "Other" {
                if (otherTexts[qt] ?? "").trimmingCharacters(in: .whitespaces).isEmpty {
                    return false
                }
            }
        }
        return true
    }

    private func submitAnswers() {
        // Build answers dict: question text -> selected label(s)
        var answersDict: [String: String] = [:]
        for q in questions {
            let qt = q["question"] as? String ?? ""
            var answer = answers[qt] ?? ""
            let multiSelect = q["multiSelect"] as? Bool ?? false

            if multiSelect {
                let labels = answer.split(separator: "\n").map(String.init)
                let resolved = labels.map { $0 == "Other" ? (otherTexts[qt] ?? "") : $0 }
                answer = resolved.joined(separator: "\n")
            } else if answer == "Other" {
                answer = otherTexts[qt] ?? ""
            }
            answersDict[qt] = answer
        }

        var updatedInput = permissionRequest.toolInput
        updatedInput["answers"] = answersDict

        onRespond?(permissionRequest.permissionRequestId, "allow", nil, nil, updatedInput)
    }
}

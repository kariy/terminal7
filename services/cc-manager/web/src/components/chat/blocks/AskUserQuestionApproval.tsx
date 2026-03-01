import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  RespondPermissionHandler,
  ToolPermissionRequestState,
} from "@/types/chat";

interface AskUserQuestionApprovalProps {
  request: ToolPermissionRequestState;
  onRespond: RespondPermissionHandler;
}

interface AskUserQuestionOption {
  label: string;
  description: string;
}

interface AskUserQuestion {
  header: string;
  question: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export function AskUserQuestionApproval({
  request,
  onRespond,
}: AskUserQuestionApprovalProps) {
  const questions = useMemo(
    () => parseAskUserQuestions(request.toolInput),
    [request.toolInput],
  );
  const [selectedByQuestion, setSelectedByQuestion] = useState<
    Record<number, string[]>
  >({});

  useEffect(() => {
    setSelectedByQuestion({});
  }, [request.permissionRequestId]);

  const validation = useMemo(() => {
    const answers: Record<string, string> = {};
    for (const [index, question] of questions.entries()) {
      const selected = selectedByQuestion[index] ?? [];
      if (question.multiSelect) {
        if (selected.length === 0) {
          return { canSubmit: false, answers: {} as Record<string, string> };
        }
      } else if (selected.length !== 1) {
        return { canSubmit: false, answers: {} as Record<string, string> };
      }

      const validLabels = new Set(question.options.map((option) => option.label));
      if (selected.some((label) => !validLabels.has(label))) {
        return { canSubmit: false, answers: {} as Record<string, string> };
      }

      answers[question.question] = question.multiSelect
        ? selected.join(", ")
        : selected[0]!;
    }

    return {
      canSubmit: questions.length > 0,
      answers,
    };
  }, [questions, selectedByQuestion]);

  const toggleOption = (questionIndex: number, optionLabel: string) => {
    const question = questions[questionIndex];
    if (!question) return;

    setSelectedByQuestion((prev) => {
      const current = prev[questionIndex] ?? [];

      if (question.multiSelect) {
        if (current.includes(optionLabel)) {
          return {
            ...prev,
            [questionIndex]: current.filter((label) => label !== optionLabel),
          };
        }
        return {
          ...prev,
          [questionIndex]: [...current, optionLabel],
        };
      }

      if (current[0] === optionLabel) {
        return {
          ...prev,
          [questionIndex]: [],
        };
      }
      return {
        ...prev,
        [questionIndex]: [optionLabel],
      };
    });
  };

  const submitAnswers = () => {
    if (!validation.canSubmit) return;
    const updatedInput: Record<string, unknown> = {
      ...request.toolInput,
      answers: validation.answers,
    };
    onRespond(
      request.permissionRequestId,
      "allow",
      undefined,
      undefined,
      updatedInput,
    );
  };

  if (request.status === "approved") {
    return (
      <div className="p-3 text-xs flex items-center gap-1.5 text-green-700 bg-green-50/70">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Answers submitted.
      </div>
    );
  }

  if (request.status === "rejected") {
    return (
      <div className="p-3 text-xs flex items-start gap-1.5 text-red-700 bg-red-50/70">
        <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <div>Question request rejected.</div>
          {request.message && (
            <div className="text-red-700/80 mt-1">{request.message}</div>
          )}
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="p-3 space-y-3 bg-secondary/20">
        <div className="text-xs font-medium flex items-center gap-1.5">
          <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
          Invalid AskUserQuestion payload.
        </div>
        <div className="text-xs text-muted-foreground">
          The question list is missing or malformed, so no answer can be submitted.
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onRespond(
                request.permissionRequestId,
                "deny",
                "Invalid AskUserQuestion payload.",
              )
            }
          >
            Reject
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 bg-secondary/20">
      <div className="text-xs font-medium">Please answer before continuing</div>
      <div className="space-y-3">
        {questions.map((question, questionIndex) => {
          const selected = selectedByQuestion[questionIndex] ?? [];
          return (
            <div
              key={`${question.header}-${questionIndex}`}
              className="rounded border border-border bg-card p-2.5 space-y-2"
            >
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground">
                  {question.header}
                </div>
                <div className="text-xs">{question.question}</div>
                <div className="text-[11px] text-muted-foreground">
                  {question.multiSelect ? "Select one or more" : "Select one"}
                </div>
              </div>
              <div className="space-y-1.5">
                {question.options.map((option) => {
                  const isSelected = selected.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      className={[
                        "w-full text-left rounded border px-2 py-1.5 transition-colors",
                        isSelected
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-background hover:bg-secondary/40",
                      ].join(" ")}
                      onClick={() => toggleOption(questionIndex, option.label)}
                    >
                      <div className="text-xs font-medium">{option.label}</div>
                      {option.description ? (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {option.description}
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!validation.canSubmit}
          onClick={submitAnswers}
        >
          Submit answers
        </Button>
      </div>
    </div>
  );
}

function parseAskUserQuestions(toolInput: Record<string, unknown>): AskUserQuestion[] {
  const rawQuestions = toolInput.questions;
  if (!Array.isArray(rawQuestions)) return [];

  const result: AskUserQuestion[] = [];
  for (const rawQuestion of rawQuestions) {
    if (!isRecord(rawQuestion)) continue;

    const questionText = getNonEmptyString(rawQuestion.question);
    if (!questionText) continue;

    const header = getNonEmptyString(rawQuestion.header) ?? questionText;
    const multiSelect = rawQuestion.multiSelect === true;
    const options = parseAskUserQuestionOptions(rawQuestion.options);
    if (options.length === 0) continue;

    result.push({
      header,
      question: questionText,
      options,
      multiSelect,
    });
  }
  return result;
}

function parseAskUserQuestionOptions(value: unknown): AskUserQuestionOption[] {
  if (!Array.isArray(value)) return [];

  const result: AskUserQuestionOption[] = [];
  for (const rawOption of value) {
    if (!isRecord(rawOption)) continue;
    const label = getNonEmptyString(rawOption.label);
    if (!label) continue;
    const description = getNonEmptyString(rawOption.description) ?? "";
    result.push({ label, description });
  }
  return result;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

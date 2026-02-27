import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  PermissionMode,
  ToolPermissionRequestState,
} from "@/types/chat";

interface ExitPlanModeApprovalProps {
  request: ToolPermissionRequestState;
  onRespond: (
    permissionRequestId: string,
    decision: "allow" | "deny",
    message?: string,
    mode?: PermissionMode,
  ) => void;
}

interface AllowedPrompt {
  tool: string;
  prompt: string;
}

export function ExitPlanModeApproval({
  request,
  onRespond,
}: ExitPlanModeApprovalProps) {
  const [feedback, setFeedback] = useState("");

  const plan = useMemo(() => getPlanText(request.toolInput), [request.toolInput]);
  const allowedPrompts = useMemo(
    () => getAllowedPrompts(request.toolInput),
    [request.toolInput],
  );

  if (request.status === "approved") {
    return (
      <div className="p-3 text-xs flex items-center gap-1.5 text-green-700 bg-green-50/70">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Exit plan mode approved.
      </div>
    );
  }

  if (request.status === "rejected") {
    return (
      <div className="p-3 text-xs flex items-start gap-1.5 text-red-700 bg-red-50/70">
        <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <div>
          <div>Exit plan mode rejected.</div>
          {request.message && (
            <div className="text-red-700/80 mt-1">{request.message}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 bg-secondary/20">
      <div className="text-xs font-medium">Ready to code?</div>

      {plan && (
        <div className="rounded border border-border bg-card p-2">
          <div className="text-[11px] text-muted-foreground mb-1">Plan</div>
          <pre className="text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto">
            {plan}
          </pre>
        </div>
      )}

      {allowedPrompts.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">
            Requested permissions
          </div>
          <div className="space-y-1">
            {allowedPrompts.map((entry, index) => (
              <div key={`${entry.tool}-${index}`} className="text-xs">
                <span className="font-medium">{entry.tool}</span>: {entry.prompt}
              </div>
            ))}
          </div>
        </div>
      )}

      <textarea
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="Optional feedback if you reject..."
        className="w-full min-h-[72px] rounded border border-input bg-background px-2 py-1.5 text-xs"
      />

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onRespond(request.permissionRequestId, "allow")}
        >
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onRespond(
              request.permissionRequestId,
              "deny",
              feedback.trim() || undefined,
            )
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function getPlanText(toolInput: Record<string, unknown>): string | null {
  const plan = toolInput.plan;
  if (typeof plan !== "string") return null;
  const trimmed = plan.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getAllowedPrompts(toolInput: Record<string, unknown>): AllowedPrompt[] {
  const raw = toolInput.allowedPrompts;
  if (!Array.isArray(raw)) return [];

  const result: AllowedPrompt[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const tool = record.tool;
    const prompt = record.prompt;
    if (typeof tool !== "string" || typeof prompt !== "string") continue;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) continue;
    result.push({ tool, prompt: trimmedPrompt });
  }
  return result;
}

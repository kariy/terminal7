import { cn } from "@/lib/utils";
import type {
  ContentBlockState,
  RespondPermissionHandler,
  ToolPermissionRequestState,
} from "@/types/chat";
import { TextBlock } from "./TextBlock";
import { ExitPlanModeApproval } from "./ExitPlanModeApproval";

interface ExitPlanModeMessageProps {
  block: ContentBlockState;
  permissionRequest?: ToolPermissionRequestState;
  onRespondPermission?: RespondPermissionHandler;
  extraTopSpace?: boolean;
  extraBottomSpace?: boolean;
}

export function ExitPlanModeMessage({
  block,
  permissionRequest,
  onRespondPermission,
  extraTopSpace,
  extraBottomSpace,
}: ExitPlanModeMessageProps) {
  const plan = getPlanFromToolInput(block.toolInput);

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-secondary/50",
        extraTopSpace ? "mt-3.5" : "mt-2.5",
        extraBottomSpace ? "mb-3.5" : "mb-2.5",
      )}
    >
      <div className="p-3">
        <div className="text-[11px] text-muted-foreground mb-1">Plan</div>
        {plan ? (
          <TextBlock text={plan} />
        ) : (
          <div className="text-xs text-muted-foreground">
            Plan content unavailable.
          </div>
        )}
      </div>

      {permissionRequest && onRespondPermission && (
        <div className="border-t border-border">
          <ExitPlanModeApproval
            request={permissionRequest}
            onRespond={onRespondPermission}
            showPlan={false}
            showRequestedPermissions={false}
          />
        </div>
      )}
    </div>
  );
}

function getPlanFromToolInput(toolInput?: string): string | null {
  if (!toolInput) return null;

  try {
    const parsed = JSON.parse(toolInput) as Record<string, unknown>;
    const plan = parsed.plan;
    if (typeof plan !== "string") return null;
    const trimmed = plan.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

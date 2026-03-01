export type CopyTextFailureReason =
  | "empty"
  | "unsupported"
  | "denied"
  | "unknown";

export type CopyTextResult =
  | { ok: true }
  | { ok: false; reason: CopyTextFailureReason };

export async function copyText(text: string): Promise<CopyTextResult> {
  if (!text) return { ok: false, reason: "empty" };

  let modernClipboardDenied = false;
  let hasModernClipboard = false;

  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    hasModernClipboard = true;
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch (error) {
      modernClipboardDenied = isPermissionDeniedError(error);
    }
  }

  if (fallbackExecCommandCopy(text)) {
    return { ok: true };
  }

  if (modernClipboardDenied) return { ok: false, reason: "denied" };
  if (!hasModernClipboard) return { ok: false, reason: "unsupported" };
  return { ok: false, reason: "unknown" };
}

function fallbackExecCommandCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  if (!document.body) return false;
  if (typeof document.execCommand !== "function") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  const selection = window.getSelection();
  const previousRange =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      if (previousRange) selection.addRange(previousRange);
    }
  }

  return copied;
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return error.name === "NotAllowedError" || error.name === "SecurityError";
}


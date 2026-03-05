import type { SessionListResponse, SessionHistoryResponse, RepositoryListResponse, SshConnectionListResponse, SshConnectionItem } from "@/types/api";
import { authHeaders } from "@/lib/auth";

export async function fetchSessions(
  params?: { refresh?: boolean; limit?: number; cursor?: string | null },
): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params?.refresh) query.set("refresh", "1");
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    query.set("limit", String(Math.trunc(params.limit)));
  }
  if (params?.cursor) query.set("cursor", params.cursor);
  const qs = query.toString() ? `?${query.toString()}` : "";
  const res = await fetch("/v1/sessions" + qs, { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch sessions: " + res.status);
  return res.json();
}

export async function fetchHistory(
  sessionId: string,
  encodedCwd?: string,
): Promise<SessionHistoryResponse> {
  const qs = encodedCwd
    ? "?encoded_cwd=" + encodeURIComponent(encodedCwd)
    : "";
  const res = await fetch(
    "/v1/sessions/" + encodeURIComponent(sessionId) + "/history" + qs,
    { headers: authHeaders() },
  );
  if (!res.ok) throw new Error("Failed to fetch history: " + res.status);
  return res.json();
}

export async function fetchRepositories(): Promise<RepositoryListResponse> {
  const res = await fetch("/v1/repos", { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch repositories: " + res.status);
  return res.json();
}

export async function fetchSshConnections(): Promise<SshConnectionListResponse> {
  const res = await fetch("/v1/ssh/connections", { headers: authHeaders() });
  if (!res.ok) throw new Error("Failed to fetch SSH connections: " + res.status);
  return res.json();
}

export async function createSshConnection(params: {
  ssh_destination: string;
  title?: string;
}): Promise<{ connection: SshConnectionItem }> {
  const res = await fetch("/v1/ssh/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to create SSH connection: " + res.status);
  return res.json();
}

export async function deleteSshConnection(id: string): Promise<void> {
  const res = await fetch("/v1/ssh/connections/" + encodeURIComponent(id), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete SSH connection: " + res.status);
}

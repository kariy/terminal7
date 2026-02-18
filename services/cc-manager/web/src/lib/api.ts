import type { SessionListResponse, SessionHistoryResponse, RepositoryListResponse, SshConnectionListResponse, SshConnectionItem } from "@/types/api";

export async function fetchSessions(
  refresh?: boolean,
): Promise<SessionListResponse> {
  const qs = refresh ? "?refresh=1" : "";
  const res = await fetch("/v1/sessions" + qs);
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
  );
  if (!res.ok) throw new Error("Failed to fetch history: " + res.status);
  return res.json();
}

export async function fetchRepositories(): Promise<RepositoryListResponse> {
  const res = await fetch("/v1/repos");
  if (!res.ok) throw new Error("Failed to fetch repositories: " + res.status);
  return res.json();
}

export async function fetchSshConnections(): Promise<SshConnectionListResponse> {
  const res = await fetch("/v1/ssh/connections");
  if (!res.ok) throw new Error("Failed to fetch SSH connections: " + res.status);
  return res.json();
}

export async function createSshConnection(params: {
  ssh_destination: string;
  title?: string;
}): Promise<{ connection: SshConnectionItem }> {
  const res = await fetch("/v1/ssh/connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error("Failed to create SSH connection: " + res.status);
  return res.json();
}

export async function deleteSshConnection(id: string): Promise<void> {
  const res = await fetch("/v1/ssh/connections/" + encodeURIComponent(id), {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) throw new Error("Failed to delete SSH connection: " + res.status);
}

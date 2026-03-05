const AUTH_TOKEN_KEY = "cc-manager:auth-token";

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

export function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface AuthStatus {
  auth_enabled: boolean;
  needs_setup: boolean;
  google_enabled: boolean;
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/v1/auth/status");
  if (!res.ok) {
    throw new Error("Failed to fetch auth status");
  }
  return res.json();
}

export async function login(
  username: string,
  password: string,
): Promise<{ user: { username: string } }> {
  const res = await fetch("/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: "Login failed" } }));
    throw new Error(body.error?.message ?? "Login failed");
  }
  return res.json();
}

export async function register(
  username: string,
  password: string,
): Promise<{ user: { username: string } }> {
  const res = await fetch("/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: "Registration failed" } }));
    throw new Error(body.error?.message ?? "Registration failed");
  }
  return res.json();
}

export async function googleLogin(
  idToken: string,
): Promise<{ user: { username: string } }> {
  const res = await fetch("/v1/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: "Google login failed" } }));
    throw new Error(body.error?.message ?? "Google login failed");
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/v1/auth/logout", {
    method: "POST",
    headers: authHeaders(),
  });
}

export async function fetchAuthMe(): Promise<{
  user: { username: string };
  auth_method: string;
  discord_links?: Array<{ discord_user_id: string; created_at: number }>;
} | null> {
  const res = await fetch("/v1/auth/me", {
    headers: authHeaders(),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch("/v1/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: { message: "Password change failed" } }));
    throw new Error(body.error?.message ?? "Password change failed");
  }
}

export async function initiateDiscordLink(): Promise<{ oauth_url: string }> {
  const res = await fetch("/v1/auth/discord/link/initiate", {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: { message: "Failed to initiate Discord link" } }));
    throw new Error(body.error?.message ?? "Failed to initiate Discord link");
  }
  return res.json();
}

export async function unlinkDiscord(): Promise<void> {
  const res = await fetch("/v1/auth/discord/link", {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({ error: { message: "Unlink failed" } }));
    throw new Error(body.error?.message ?? "Unlink failed");
  }
}

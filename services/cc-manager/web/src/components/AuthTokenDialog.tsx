import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { login, setAuthToken } from "@/lib/auth";

interface AuthTokenDialogProps {
  onAuthenticated: () => void;
}

export function AuthTokenDialog({ onAuthenticated }: AuthTokenDialogProps) {
  const [mode, setMode] = useState<"login" | "token">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(username.trim(), password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setAuthToken(trimmed);
    onAuthenticated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-sm mx-4">
        {mode === "login" ? (
          <form onSubmit={handleLoginSubmit}>
            <CardHeader>
              <CardTitle>Sign In</CardTitle>
              <p className="text-sm text-muted-foreground">
                This server requires authentication.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  autoFocus
                  autoComplete="username"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button
                type="submit"
                className="w-full"
                disabled={!username.trim() || !password || loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
              <button
                type="button"
                onClick={() => { setMode("token"); setError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Use API token instead
              </button>
            </CardFooter>
          </form>
        ) : (
          <form onSubmit={handleTokenSubmit}>
            <CardHeader>
              <CardTitle>API Token</CardTitle>
              <p className="text-sm text-muted-foreground">
                Enter a Bearer API token to authenticate.
              </p>
            </CardHeader>
            <CardContent>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter auth token"
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button type="submit" className="w-full" disabled={!token.trim()}>
                Connect
              </Button>
              <button
                type="button"
                onClick={() => { setMode("login"); setError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Sign in with username instead
              </button>
            </CardFooter>
          </form>
        )}
      </Card>
    </div>
  );
}

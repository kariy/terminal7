import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  login,
  register,
  googleLogin,
  fetchAuthStatus,
  type AuthStatus,
} from "@/lib/auth";

// Extend window for Google Identity Services
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }): void;
          renderButton(
            element: HTMLElement,
            options: { theme?: string; size?: string; width?: number },
          ): void;
        };
      };
    };
  }
}

interface AuthDialogProps {
  onAuthenticated: () => void;
}

type Mode = "loading" | "login" | "register";

export function AuthDialog({ onAuthenticated }: AuthDialogProps) {
  const [mode, setMode] = useState<Mode>("loading");
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAuthStatus()
      .then((status) => {
        setAuthStatus(status);
        setMode(status.needs_setup ? "register" : "login");
      })
      .catch(() => {
        setMode("login");
      });
  }, []);

  // Load Google Identity Services script when google is enabled
  useEffect(() => {
    if (!authStatus?.google_enabled) return;
    if (document.querySelector('script[src*="accounts.google.com/gsi/client"]')) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    document.head.appendChild(script);
  }, [authStatus?.google_enabled]);

  const handleGoogleCredential = useCallback(
    async (response: { credential: string }) => {
      setLoading(true);
      setError(null);
      try {
        await googleLogin(response.credential);
        onAuthenticated();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google login failed");
      } finally {
        setLoading(false);
      }
    },
    [onAuthenticated],
  );

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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await register(username.trim(), password);
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "loading") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <Card className="w-full max-w-sm mx-4">
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading...
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSetup = authStatus?.needs_setup;
  const googleEnabled = authStatus?.google_enabled;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-sm mx-4">
        {mode === "login" && (
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
              {googleEnabled && (
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              )}
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
                onClick={() => { setMode("register"); setError(null); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Create account
              </button>
            </CardFooter>
          </form>
        )}

        {mode === "register" && (
          <form onSubmit={handleRegisterSubmit}>
            <CardHeader>
              <CardTitle>{isSetup ? "Create your account" : "Create account"}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {isSetup
                  ? "Set up the first account to secure this server."
                  : "Register a new account."}
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
                  placeholder="Password (min 8 characters)"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {googleEnabled && (
                <GoogleSignInButton onCredential={handleGoogleCredential} />
              )}
            </CardContent>
            <CardFooter className="flex-col gap-2">
              <Button
                type="submit"
                className="w-full"
                disabled={!username.trim() || !password || !confirmPassword || loading}
              >
                {loading ? "Creating account..." : "Create account"}
              </Button>
              {!isSetup && (
                <button
                  type="button"
                  onClick={() => { setMode("login"); setError(null); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Sign in instead
                </button>
              )}
            </CardFooter>
          </form>
        )}

      </Card>
    </div>
  );
}

function GoogleSignInButton({
  onCredential,
}: {
  onCredential: (response: { credential: string }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const tryRender = () => {
      if (!window.google || !containerRef.current) return false;

      const clientId = document.querySelector<HTMLMetaElement>(
        'meta[name="google-client-id"]',
      )?.content ?? "";

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: onCredential,
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        theme: "outline",
        size: "large",
        width: 320,
      });
      return true;
    };

    if (!tryRender()) {
      const interval = setInterval(() => {
        if (tryRender()) clearInterval(interval);
      }, 200);
      return () => clearInterval(interval);
    }
  }, [onCredential]);

  return (
    <div className="flex justify-center pt-1">
      <div ref={containerRef} />
    </div>
  );
}

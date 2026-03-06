import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface DiscordLink {
  discord_user_id: string;
  discord_username: string;
  created_at: number;
}

interface UserViewProps {
  username: string;
  authMethod: string;
  discordLinks: DiscordLink[];
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onLinkDiscord: () => Promise<void>;
  onUnlinkDiscord: () => Promise<void>;
  onLogout: () => void;
}

export function UserView({
  username,
  authMethod,
  discordLinks,
  onChangePassword,
  onLinkDiscord,
  onUnlinkDiscord,
  onLogout,
}: UserViewProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [unlinkLoading, setUnlinkLoading] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);

    if (newPassword !== confirmPassword) {
      setPwError("Passwords do not match");
      return;
    }
    if (!newPassword) {
      setPwError("New password is required");
      return;
    }

    setPwLoading(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      setPwSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password");
    } finally {
      setPwLoading(false);
    }
  };

  const handleUnlink = async () => {
    setUnlinkLoading(true);
    try {
      await onUnlinkDiscord();
    } catch {
      // silently handled
    } finally {
      setUnlinkLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Account info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Username</span>
            <span className="font-medium">{username}</span>
          </div>
        </CardContent>
      </Card>

      {/* Change password (session auth only) */}
      {authMethod === "session" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground">Current password</label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">New password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">Confirm new password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                />
              </div>
              {pwError && (
                <p className="text-sm text-destructive">{pwError}</p>
              )}
              {pwSuccess && (
                <p className="text-sm text-green-600">Password changed successfully</p>
              )}
              <Button type="submit" disabled={pwLoading} size="sm">
                {pwLoading ? "Changing..." : "Change Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Integrations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Discord */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
              </svg>
              Discord
            </div>
            {discordLinks.length > 0 ? (
              <div className="space-y-2">
                {discordLinks.map((link) => (
                  <div
                    key={link.discord_user_id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span>
                      Linked: <span className="font-medium">@{link.discord_username || link.discord_user_id}</span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUnlink}
                      disabled={unlinkLoading}
                    >
                      {unlinkLoading ? "Unlinking..." : "Unlink"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  No Discord account linked.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setLinkLoading(true);
                    try {
                      await onLinkDiscord();
                    } catch {
                      // handled by caller
                    } finally {
                      setLinkLoading(false);
                    }
                  }}
                  disabled={linkLoading}
                >
                  {linkLoading ? "Linking..." : "Link Discord Account"}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Logout */}
      <Card>
        <CardContent className="pt-6">
          <Button variant="destructive" onClick={onLogout} className="w-full">
            Logout
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

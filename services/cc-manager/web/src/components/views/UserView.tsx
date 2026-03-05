import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const inputClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

interface DiscordLink {
  discord_user_id: string;
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
  onUnlinkDiscord: () => Promise<void>;
  onLogout: () => void;
}

export function UserView({
  username,
  authMethod,
  discordLinks,
  onChangePassword,
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
          <div className="flex justify-between">
            <span className="text-muted-foreground">Auth method</span>
            <span className="font-medium">{authMethod === "session" ? "Password" : "Bearer token"}</span>
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

      {/* Discord integration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discord</CardTitle>
        </CardHeader>
        <CardContent>
          {discordLinks.length > 0 ? (
            <div className="space-y-2">
              {discordLinks.map((link) => (
                <div
                  key={link.discord_user_id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    Linked: <span className="font-medium">{link.discord_user_id}</span>
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
            <p className="text-sm text-muted-foreground">
              No Discord account linked. Use the Discord bot's link command to connect your account.
            </p>
          )}
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

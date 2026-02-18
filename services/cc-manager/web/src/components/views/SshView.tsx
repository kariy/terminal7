import { useState } from "react";
import { Pencil, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSshDestination, getSshPassword, setSshDestination, setSshPassword } from "@/lib/settings";

interface SshViewProps {
  onConnect: (destination: string, password?: string) => void;
}

export function SshView({ onConnect }: SshViewProps) {
  const savedDest = getSshDestination();
  const [editing, setEditing] = useState(!savedDest);
  const [destination, setDestination] = useState(savedDest ?? "");
  const [password, setPassword] = useState(getSshPassword() ?? "");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = destination.trim();
    if (!trimmed) return;
    setSshDestination(trimmed);
    setSshPassword(password);
    setEditing(false);
  };

  const handleConnect = () => {
    const dest = getSshDestination();
    if (!dest) return;
    onConnect(dest, getSshPassword() ?? undefined);
  };

  if (editing) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <form onSubmit={handleSave} className="w-full max-w-sm space-y-4">
          <h2 className="text-lg font-semibold">SSH Connection</h2>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Destination
            </label>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="user@host"
              autoFocus
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
              placeholder="Leave empty for key-based auth"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-2 justify-end">
            {savedDest && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!destination.trim()}>
              Save
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <span className="text-sm font-mono">{savedDest}</span>
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Edit SSH settings"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <Button onClick={handleConnect} size="lg" className="gap-2">
          <Terminal className="h-4 w-4" />
          Connect
        </Button>
      </div>
    </div>
  );
}

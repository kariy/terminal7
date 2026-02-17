import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { getSshDestination, getSshPassword } from "@/lib/settings";

interface SshDestinationDialogProps {
  onSave: (destination: string, password: string) => void;
  onCancel: () => void;
}

export function SshDestinationDialog({ onSave, onCancel }: SshDestinationDialogProps) {
  const [destination, setDestination] = useState(getSshDestination() ?? "");
  const [password, setPassword] = useState(getSshPassword() ?? "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = destination.trim();
    if (trimmed) {
      onSave(trimmed, password);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-sm mx-4">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <CardTitle>SSH Connection</CardTitle>
            <p className="text-sm text-muted-foreground">
              Enter the SSH destination and password for terminal connections.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!destination.trim()}>
              Save
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

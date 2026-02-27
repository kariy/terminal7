import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchRepositories } from "@/lib/api";
import type { RepositoryListItem } from "@/types/api";

const PRESET_REPOS = [
  { owner: "dojoengine", name: "katana" },
  { owner: "dojoengine", name: "dojo" },
  { owner: "dojoengine", name: "torii" },
  { owner: "cartridge-gg", name: "controller" },
  { owner: "cartridge-gg", name: "controller-rs" },
];

export interface RepoSelection {
  repoUrl?: string;
  repoId?: string;
  branch?: string;
}

interface RepoSelectionDialogProps {
  onSelect: (selection: RepoSelection | null) => void;
  onCancel: () => void;
}

export function RepoSelectionDialog({ onSelect, onCancel }: RepoSelectionDialogProps) {
  const [repos, setRepos] = useState<RepositoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");

  useEffect(() => {
    fetchRepositories()
      .then((data) => setRepos(data.repositories))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = repoUrl.trim();
    if (trimmed) {
      onSelect({
        repoUrl: trimmed,
        branch: branch.trim() || undefined,
      });
    }
  };

  const handleSelectRepo = (repo: RepositoryListItem) => {
    onSelect({
      repoId: repo.id,
      branch: branch.trim() || undefined,
    });
  };

  const handleSelectPreset = (preset: { owner: string; name: string }) => {
    const url = `https://github.com/${preset.owner}/${preset.name}.git`;
    // If this repo was already cloned, use its ID instead
    const existing = repos.find((r) => r.url === url);
    if (existing) {
      onSelect({ repoId: existing.id });
    } else {
      onSelect({ repoUrl: url });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <Card className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
        <CardHeader>
          <CardTitle>Select Repository</CardTitle>
          <p className="text-sm text-muted-foreground">
            Choose a git repository for this session, or start without one.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 overflow-y-auto flex-1">
          {/* Preset repos */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground block">
              Repositories
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_REPOS.map((preset) => (
                <button
                  key={`${preset.owner}/${preset.name}`}
                  type="button"
                  onClick={() => handleSelectPreset(preset)}
                  className="inline-flex cursor-pointer items-center rounded-full border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  {preset.owner}/{preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Previously cloned repos (excluding presets) */}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : repos.filter((r) => !PRESET_REPOS.some((p) => r.url === `https://github.com/${p.owner}/${p.name}.git`)).length > 0 ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground block">
                Previously cloned
              </label>
              {repos
                .filter((r) => !PRESET_REPOS.some((p) => r.url === `https://github.com/${p.owner}/${p.name}.git`))
                .map((repo) => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleSelectRepo(repo)}
                  className="w-full text-left rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  <div className="font-medium truncate">{repo.url}</div>
                  <div className="text-xs text-muted-foreground">
                    {repo.slug} &middot; {repo.default_branch}
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {/* New repo URL */}
          <form onSubmit={handleSubmitUrl} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Clone a new repository
              </label>
              <input
                type="text"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                Branch (optional)
              </label>
              <input
                type="text"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="defaults to repository default branch"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {repoUrl.trim() && (
              <Button type="submit" className="w-full">
                Clone & Start
              </Button>
            )}
          </form>
        </CardContent>
        <CardFooter className="justify-between">
          <Button
            type="button"
            variant="link"
            className="text-muted-foreground px-0"
            onClick={() => onSelect(null)}
          >
            Start without repo
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

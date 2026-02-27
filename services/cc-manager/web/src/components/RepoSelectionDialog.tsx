import { useCallback, useEffect, useRef, useState } from "react";
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

interface SelectedRepoOption {
  key: string;
  selection: RepoSelection;
}

export function RepoSelectionDialog({ onSelect, onCancel }: RepoSelectionDialogProps) {
  const [repos, setRepos] = useState<RepositoryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState("");
  const [showCloneInput, setShowCloneInput] = useState(false);
  const [branch, setBranch] = useState("");
  const [selectedRepoOption, setSelectedRepoOption] = useState<SelectedRepoOption | null>(
    null,
  );
  const presetPillsContainerRef = useRef<HTMLDivElement | null>(null);
  const [showPresetLeftShadow, setShowPresetLeftShadow] = useState(false);
  const [showPresetRightShadow, setShowPresetRightShadow] = useState(false);
  const selectedBranch = branch.trim() || undefined;
  const trimmedRepoUrl = repoUrl.trim();

  const updatePresetShadows = useCallback(() => {
    const container = presetPillsContainerRef.current;
    if (!container) return;

    const maxScrollLeft = container.scrollWidth - container.clientWidth;
    if (maxScrollLeft <= 1) {
      setShowPresetLeftShadow(false);
      setShowPresetRightShadow(false);
      return;
    }

    const scrollLeft = container.scrollLeft;
    setShowPresetLeftShadow(scrollLeft > 1);
    setShowPresetRightShadow(scrollLeft < maxScrollLeft - 1);
  }, []);

  useEffect(() => {
    fetchRepositories()
      .then((data) => setRepos(data.repositories))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const rafId = window.requestAnimationFrame(updatePresetShadows);

    const handleResize = () => updatePresetShadows();
    window.addEventListener("resize", handleResize);

    const container = presetPillsContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") {
      return () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener("resize", handleResize);
      };
    }

    const observer = new ResizeObserver(() => updatePresetShadows());
    observer.observe(container);

    return () => {
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [updatePresetShadows]);

  const handleSelectRepo = (repo: RepositoryListItem) => {
    setRepoUrl("");
    setShowCloneInput(false);
    setSelectedRepoOption({
      key: `repo:${repo.id}`,
      selection: { repoId: repo.id },
    });
  };

  const handleSelectPreset = (preset: { owner: string; name: string }) => {
    const url = `https://github.com/${preset.owner}/${preset.name}.git`;
    const presetKey = `preset:${preset.owner}/${preset.name}`;
    setRepoUrl("");
    setShowCloneInput(false);
    // If this repo was already cloned, use its ID instead
    const existing = repos.find((r) => r.url === url);
    if (existing) {
      setSelectedRepoOption({
        key: presetKey,
        selection: { repoId: existing.id },
      });
    } else {
      setSelectedRepoOption({
        key: presetKey,
        selection: { repoUrl: url },
      });
    }
  };

  const handleStart = () => {
    if (trimmedRepoUrl) {
      onSelect({
        repoUrl: trimmedRepoUrl,
        branch: selectedBranch,
      });
      return;
    }
    if (selectedRepoOption) {
      onSelect({
        ...selectedRepoOption.selection,
        branch: selectedBranch,
      });
      return;
    }
    onSelect(null);
  };

  const handlePresetPillsWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    if (container.scrollWidth <= container.clientWidth) return;

    const delta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
    if (delta === 0) return;

    container.scrollLeft += delta;
    updatePresetShadows();
    e.preventDefault();
    e.stopPropagation();
  };

  const nonPresetRepos = repos.filter(
    (repo) =>
      !PRESET_REPOS.some(
        (preset) =>
          repo.url === `https://github.com/${preset.owner}/${preset.name}.git`,
      ),
  );

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
          <div className="space-y-4 rounded-lg border border-border/70 bg-secondary/40 p-3">
            <div className="space-y-3">
              <label className="text-xs font-medium text-muted-foreground block">
                Repositories
              </label>
              <div className="relative h-7 w-full overflow-hidden rounded-md [clip-path:inset(0)]">
                <div
                  ref={presetPillsContainerRef}
                  className="flex h-7 w-full items-stretch gap-2 overflow-x-auto overflow-y-hidden"
                  onWheel={handlePresetPillsWheel}
                  onScroll={updatePresetShadows}
                >
                  {PRESET_REPOS.map((preset) => {
                    const presetKey = `preset:${preset.owner}/${preset.name}`;
                    const isSelected = selectedRepoOption?.key === presetKey;
                    return (
                      <button
                        key={`${preset.owner}/${preset.name}`}
                        type="button"
                        onClick={() => handleSelectPreset(preset)}
                        className={`inline-flex h-full shrink-0 cursor-pointer items-center rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none ${
                          isSelected
                            ? "border-primary/40 bg-accent text-accent-foreground"
                            : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        {preset.owner}/{preset.name}
                      </button>
                    );
                  })}
                </div>
                <div
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-0 left-0 w-4 rounded-l-md shadow-[inset_10px_0_10px_-10px_rgba(0,0,0,0.35)] transition-opacity ${
                    showPresetLeftShadow ? "opacity-100" : "opacity-0"
                  }`}
                />
                <div
                  aria-hidden
                  className={`pointer-events-none absolute inset-y-0 right-0 w-4 rounded-r-md shadow-[inset_-10px_0_10px_-10px_rgba(0,0,0,0.35)] transition-opacity ${
                    showPresetRightShadow ? "opacity-100" : "opacity-0"
                  }`}
                />
              </div>

              {loading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : nonPresetRepos.length > 0 ? (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground block">
                    Previously cloned
                  </label>
                  {nonPresetRepos.map((repo) => {
                    const isSelected = selectedRepoOption?.key === `repo:${repo.id}`;
                    return (
                      <button
                        key={repo.id}
                        type="button"
                        onClick={() => handleSelectRepo(repo)}
                        className={`w-full text-left rounded-md border px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? "border-primary/40 bg-accent text-accent-foreground"
                            : "border-input bg-background hover:bg-accent hover:text-accent-foreground"
                        }`}
                      >
                        <div className="font-medium truncate">{repo.url}</div>
                        <div className="text-xs text-muted-foreground">
                          {repo.slug} &middot; {repo.default_branch}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowCloneInput(true)}
                className="w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                Clone a new repository
              </button>
              {showCloneInput && (
                <input
                  type="text"
                  value={repoUrl}
                  onChange={(e) => {
                    const nextUrl = e.target.value;
                    setRepoUrl(nextUrl);
                    if (nextUrl.trim()) {
                      setSelectedRepoOption(null);
                    }
                  }}
                  placeholder="https://github.com/user/repo.git"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              )}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Branch (optional)
            </label>
            <input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="applies to both options; defaults to repository default branch"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleStart}>
            Start Session
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

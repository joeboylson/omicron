import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { deleteProject } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";

/** Can it be deleted yet: its name typed exactly. */
export function nameMatches(typed: string, name: string): boolean {
  return typed === name;
}

/**
 * Deleting a Project, from its row in the Projects table: its name typed
 * first, then Delete.
 */
export function DeleteProject({
  project,
  onOpenChange,
  onDeleted,
}: {
  project: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { db, act } = useApp();
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [project?.id]);
  return (
    <Dialog open={project !== null} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md">
        {project && (
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!nameMatches(typed, project.name)) return;
              if (await act(() => deleteProject(db, project.id))) {
                onOpenChange(false);
                onDeleted();
              }
            }}
          >
            <DialogHeader className="text-left">
              <DialogTitle>Delete {project.name}?</DialogTitle>
              <DialogDescription>It goes for everyone, with all its tasks, sessions and chat. This can't be undone.</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={`Type ${project.name} to delete it`}
              aria-label={`Type ${project.name} to delete it`}
              autoComplete="off"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!nameMatches(typed, project.name)}>
                <Trash2 /> Delete
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

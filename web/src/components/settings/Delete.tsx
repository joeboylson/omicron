import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { deleteProject, type ProjectData } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Group } from "@/components/Grouped";

export function DeleteSection({ project, onDeleted }: { project: ProjectData; onDeleted: () => void }) {
  const { db, act } = useApp();
  // Deleting asks for the Project's name, typed, first.
  const [typedName, setTypedName] = useState("");
  return (
    <Group
      title={<label htmlFor="delete-project">Delete Project</label>}
      note="Deletes it for everyone, with all its tasks and sessions. This can't be undone."
    >
      <form
        className="flex items-center gap-2 py-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (typedName !== project.name) return;
          if (await act(() => deleteProject(db, project.id))) onDeleted();
        }}
      >
        <Input
          id="delete-project"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          placeholder={`Type ${project.name} to delete it`}
          autoComplete="off"
          className="flex-1"
        />
        <Button type="submit" variant="destructive" size="sm" disabled={typedName !== project.name}>
          <Trash2 /> Delete
        </Button>
      </form>
    </Group>
  );
}

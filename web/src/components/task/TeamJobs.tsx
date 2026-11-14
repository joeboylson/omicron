import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { linkJob, listProjectJobs, unlinkJob, type JobLink, type ProjectData, type Task } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/base/select";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";

const JOB_STATE: Record<string, string> = {
  waiting: "waiting",
  working: "working",
  blocked: "blocked",
  done: "done",
  cancelled: "cancelled",
};

/**
 * Team jobs the task is linked to (the session handles the task; the team
 * handles the jobs), with each job's state, live. Shown when the Project
 * has any team jobs.
 */
export function TeamJobs({ project, task, onChanged }: { project: ProjectData; task: Task; onChanged: () => void }) {
  const { db, act } = useApp();
  const [all, setAll] = useState<JobLink[] | null>(null);
  useEffect(() => {
    listProjectJobs(db, project.id).then(setAll, () => setAll([]));
  }, [db, project.id, task.jobs.length]);
  if (all === null || (all.length === 0 && task.jobs.length === 0)) return null;
  const linked = new Set(task.jobs.map((j) => j.id));
  const free = all.filter((j) => !linked.has(j.id) && j.state !== "cancelled");
  const change = (work: () => Promise<unknown>) => act(work).then((ok) => ok && onChanged());
  return (
    <Group title="Team jobs">
      {task.jobs.length > 0 && (
        <ul aria-label="Linked jobs" className="divide-y">
          {task.jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-2 px-4 py-2.5 text-[15px] sm:text-sm">
              <span className="tabular-nums text-xs text-muted-foreground">
                {j.team} #{j.number}
              </span>
              <span className="flex-1 truncate">{j.title}</span>
              <Badge variant={j.state === "done" ? "secondary" : "outline"} className="font-normal">
                {JOB_STATE[j.state] ?? j.state}
                {j.step && j.state === "working" ? ` · ${j.step}` : ""}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 h-8 w-8 text-muted-foreground"
                aria-label={`Unlink ${j.team} job #${j.number}`}
                onClick={() => change(() => unlinkJob(db, task, j.id))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <Row>
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
          <Select value="" onValueChange={(id) => change(() => linkJob(db, task, id))}>
            <SelectTrigger aria-label="Link a team job" className={cn(bare, "px-0 text-muted-foreground")}>
              <SelectValue placeholder="Link a team job…" />
            </SelectTrigger>
            <SelectContent>
              {free.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.team} #{j.number} {j.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )}
    </Group>
  );
}

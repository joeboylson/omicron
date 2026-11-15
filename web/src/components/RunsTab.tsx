// A Project's Runs tab (#251): its run (a session working down a set of
// tasks, one at a time) and its loops (one message typed into a session
// again and again).
import type { Dev } from "@/lib/dev";
import type { ProjectData } from "@/lib/data";
import { RunBar } from "@/components/RunBar";
import { LoopsHere } from "@/components/ComputerPanel";
import { LoopGroup } from "@/components/Sessions";
import { Group, Row } from "@/components/Grouped";

export function RunsTab({ project, dev, onChanged }: { project: ProjectData; dev: Dev | null; onChanged: () => void }) {
  // On this computer: its sessions' loops, with Stop and Start. Elsewhere:
  // every loop in the Project, each with its session.
  const loops = project.loops
    .map((loop) => ({ loop, session: project.sessions.find((s) => s.id === loop.session_id) }))
    .filter((l) => l.session);
  const nothing = project.sessions.length === 0 && project.runs.length === 0 && loops.length === 0;
  return (
    <section aria-label="Runs and loops" className="mx-auto grid w-full max-w-3xl content-start gap-5 pb-4">
      {nothing ? (
        // A tab is never hidden (HIG tab bars #5): an empty one says why.
        <p className="px-[max(1rem,env(safe-area-inset-left))] py-8 text-center text-sm text-muted-foreground">
          No runs or loops. They need a Claude session working in this Project.
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <h3 className="px-[max(2rem,calc(env(safe-area-inset-left)+1rem))] text-xs font-medium uppercase tracking-wide text-muted-foreground">Run</h3>
            <RunBar project={project} onChanged={onChanged} machineId={dev?.machine_id} />
          </div>
          <div className="px-[max(1rem,env(safe-area-inset-left))]">
            {dev ? (
              <LoopsHere project={project} dev={dev} onChanged={onChanged} />
            ) : loops.length === 0 ? (
              <Group title="Loops">
                <Row className="text-sm text-muted-foreground">No loops running.</Row>
              </Group>
            ) : (
              <div className="grid gap-4">
                {loops.map(({ loop, session }) => (
                  <LoopGroup key={loop.session_id} loop={loop} onChanged={onChanged} title={`Loop in ${session!.name}`} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

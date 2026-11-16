import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send, Terminal } from "lucide-react";
import { useApp } from "@/lib/app";
import { useAwakeMachines } from "@/lib/awake";
import { checkNow, giveUpDispatch, requestDispatch, sayEvery, type ProjectData, type Task } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Row } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { ago } from "@/components/task/when";

/**
 * Whether the session has the task, and the Dispatch button: hands it to the
 * session now, on its machine (in its window, or when it's next opened). The
 * outcome of the latest Dispatch shows under it, for everyone, live.
 */
export function DispatchRow({ project, task, onChanged }: { project: ProjectData; task: Task; onChanged: () => void }) {
  const { db, act } = useApp();
  const awake = useAwakeMachines(db);
  const [asking, setAsking] = useState(false);
  const session = project.sessions.find((s) => s.id === task.assignee_session_id);
  // A session with a loop gets its work on its checks: Dispatch becomes Check Now (#278).
  const loop = session ? project.loops.find((l) => l.session_id === session.id && l.state !== "stopped") : undefined;
  const latest = task.dispatches[0];
  // A request nobody took by the time the database allows (claim_by), or
  // one a machine took but never finished: over, whatever its state says;
  // give up on it. Drawn again at claim_by, so this is seen in time.
  const [, redraw] = useState(0);
  useEffect(() => {
    if (latest?.state !== "pending") return;
    const wait = new Date(latest.claim_by).getTime() - Date.now() + 1000;
    if (wait <= 0) return;
    const t = window.setTimeout(() => redraw((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [latest?.id, latest?.state, latest?.claim_by]);
  const stale =
    !!latest &&
    ((latest.state === "pending" && Date.now() > new Date(latest.claim_by).getTime()) ||
      (latest.state === "claimed" && !!latest.claimed_at && Date.now() - new Date(latest.claimed_at).getTime() > 125_000));
  useEffect(() => {
    if (!stale || !latest) return;
    const why =
      latest.state === "pending" ? `${session?.machine ?? "Its machine"} didn't pick it up in time. Is Omicron running on it?` : "Its machine took it but never said how it went.";
    giveUpDispatch(db, latest.id, why).catch(() => {}).finally(onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, latest?.id]);
  const working = asking || (!stale && (latest?.state === "pending" || latest?.state === "claimed"));
  const asleep = !!session && awake !== null && !awake.has(session.machine_id);

  async function dispatch() {
    if (!session) return;
    setAsking(true);
    // If the machine doesn't take it in time, it's given up once its time
    // is past (above), or by the next Dispatch of the task (the database).
    const asked = await act(async () => {
      await requestDispatch(db, task);
      onChanged();
    });
    setAsking(false);
    if (!asked) onChanged();
  }

  // One line: where the task is with its session, and why Dispatch is off.
  const name = session?.name ?? "its session";
  const machine = session?.machine ?? "its computer";
  const failed = !working && !task.picked_up_at && latest?.state === "failed";
  const line = working
    ? latest?.state === "claimed"
      ? `${machine} is handing it to ${name}…`
      : `Sending it to ${name} on ${machine}…`
    : failed
      ? latest!.error ?? "It couldn't be sent."
      : task.picked_up_at
        ? `${name} has it.`
        : latest?.state === "done"
          ? (latest.result ?? `Sent to ${name}.`)
          : `${name} gets it when it next looks for tasks.`;
  // When the last send happened, beside what it said.
  const at = !working && !task.picked_up_at && latest && (latest.state === "done" || failed) ? latest.created_at : null;
  const off = asleep && !working && !task.picked_up_at ? ` ${machine} is off, so it can't be sent now.` : "";
  // When the last send happened, at the end, in words.
  const time = at ? ` (${ago(at)})` : "";

  if (loop && !task.picked_up_at) {
    return (
      <Row className="text-sm">
        <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span role="status" aria-live="polite" data-testid="dispatch" className="flex-1 text-muted-foreground">
          {name} checks its list {loop.asap ? "as soon as it's done" : `every ${sayEvery(loop.every_seconds)}`}.{off}
        </span>
        {!asleep && (
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => act(() => checkNow(db, loop)).then(() => onChanged())} title={`${name} checks its list now`}>
            <Send className="h-4 w-4" aria-hidden />
            Check Now
          </Button>
        )}
      </Row>
    );
  }

  return (
    <Row className="text-sm">
      {failed ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sys-red)]" aria-hidden />
      ) : task.picked_up_at ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--sys-green)]" aria-hidden />
      ) : (
        <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span role="status" aria-live="polite" data-testid="dispatch" className={cn("flex-1", !failed && "text-muted-foreground")}>
        {at ? line.replace(/\.$/, "") : line}
        {at && (
          <time dateTime={at} title={new Date(at).toLocaleString()}>
            {time}
          </time>
        )}
        {at && line.endsWith(".") && "."}
        {off}
      </span>
      {/* Off (its computer asleep, or no session): not shown, the line says why. */}
      {!task.picked_up_at && session && !asleep && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={working}
          onClick={dispatch}
          title={`Hand it to ${name} now, on ${machine}`}
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {working ? "Sending" : latest?.state === "done" || failed ? "Send again" : "Send now"}
        </Button>
      )}
    </Row>
  );
}

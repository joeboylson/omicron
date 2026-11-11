import { useState } from "react";
import { Copy, Terminal } from "lucide-react";
import type { ClaudeSession, HandoffNote } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";

const STATE_TEXT = { open: "open", closed: "closed", gone: "stopped" } as const;
const NOTE_STATE = { waiting: "waiting", picked_up: "picked up", replaced: "replaced", cancelled: "cancelled" } as const;

/** The Project's Claude sessions, open ones first. Tap one for its handoff notes. */
export function Sessions({ project, sessions, handoffs }: { project: string; sessions: ClaudeSession[]; handoffs: HandoffNote[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (sessions.length === 0) return null;
  const order = { open: 0, closed: 1, gone: 2 };
  const sorted = [...sessions].sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const open = sessions.find((s) => s.id === openId) ?? null;
  return (
    <section aria-label="Claude sessions" className="flex items-center gap-2 overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] pb-3 text-sm">
      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <ul className="flex gap-2">
        {sorted.map((s) => (
          <li key={s.id} title={s.folder ? `${s.folder} on ${s.machine}` : s.machine}>
            <button type="button" className="flex min-h-11 items-center sm:min-h-0" onClick={() => setOpenId(s.id)}>
              <Badge
                variant={s.state === "open" ? "secondary" : "outline"}
                className={cn("cursor-pointer gap-1.5 whitespace-nowrap font-normal", s.state !== "open" && "text-muted-foreground")}
              >
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 rounded-full", s.state === "open" ? "bg-foreground" : "border border-muted-foreground")}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">
                  <span className="font-mono text-[11px]">{s.machine}</span> · {STATE_TEXT[s.state]}
                </span>
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && <SessionNotes project={project} session={open} notes={handoffs.filter((h) => h.session_id === open.id)} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SessionNotes({ project, session, notes }: { project: string; session: ClaudeSession; notes: HandoffNote[] }) {
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (n: HandoffNote) => {
    // Pastes into any Claude session to continue from this note.
    await navigator.clipboard?.writeText(`omicron handoff show '${project}' ${n.number} --pickup`).catch(() => {});
    setCopied(n.number);
  };
  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle>{session.name}</DialogTitle>
        <DialogDescription>
          <span className="font-mono">{session.machine}</span>
          {session.folder && (
            <>
              {" · "}
              <span className="font-mono">{session.folder}</span>
            </>
          )}
          {" · "}
          {STATE_TEXT[session.state]}
        </DialogDescription>
      </DialogHeader>
      <Group title="Handoff notes" note="A waiting note goes to the next conversation in the session's window after /clear.">
        {notes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No notes yet. In the session: <span className="font-mono">omicron handoff write</span>
          </p>
        ) : (
          <ul aria-label="Handoff notes" className="divide-y">
            {notes.map((n) => (
              <li key={n.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">#{n.number}</span>
                  <Badge variant={n.state === "waiting" ? "default" : "outline"} className="font-normal">
                    {NOTE_STATE[n.state]}
                  </Badge>
                  <time className="whitespace-nowrap font-mono" dateTime={n.written_at}>
                    {new Date(n.written_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </time>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8 shrink-0 gap-1 px-2 text-xs"
                    aria-label="Copy pickup command"
                    onClick={() => copy(n)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied === n.number ? (
                      "Copied"
                    ) : (
                      <>
                        <span className="sm:hidden">Copy</span>
                        <span className="hidden sm:inline">Copy pickup command</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap break-words text-[15px] sm:text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

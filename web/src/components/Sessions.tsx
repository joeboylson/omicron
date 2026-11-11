import { Terminal } from "lucide-react";
import type { ClaudeSession } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATE_TEXT = { open: "open", closed: "closed", gone: "stopped" } as const;

/** The Project's Claude sessions, open ones first. */
export function Sessions({ sessions }: { sessions: ClaudeSession[] }) {
  if (sessions.length === 0) return null;
  const order = { open: 0, closed: 1, gone: 2 };
  const sorted = [...sessions].sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  return (
    <section aria-label="Claude sessions" className="flex items-center gap-2 overflow-x-auto px-4 pb-3 text-sm">
      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <ul className="flex gap-2">
        {sorted.map((s) => (
          <li key={s.id} title={s.folder ? `${s.folder} on ${s.machine}` : s.machine}>
            <Badge
              variant={s.state === "open" ? "secondary" : "outline"}
              className={cn("gap-1.5 whitespace-nowrap font-normal", s.state !== "open" && "text-muted-foreground")}
            >
              <span
                aria-hidden
                className={cn("h-1.5 w-1.5 rounded-full", s.state === "open" ? "bg-foreground" : "border border-muted-foreground")}
              />
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">
                {s.machine} · {STATE_TEXT[s.state]}
              </span>
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

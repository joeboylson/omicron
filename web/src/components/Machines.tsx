import type { MachineSummary, UsageWindow } from "@/lib/data";
import { Group, Row } from "@/components/Grouped";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

/** Each machine's Claude account in use, and how much of each account's limits is used. */
export function Machines({ machines }: { machines: MachineSummary[] }) {
  if (machines.length === 0) return null;
  return (
    <Group title="Machines" note="Claude accounts each machine has saved (omicron accounts). Updated every 2 minutes.">
      <ul className="divide-y" aria-label="Machines">
        {machines.map((m) => (
          <li key={m.id} className="grid gap-2 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{m.name}</span>
              {m.accounts.in_use ? (
                <Badge variant="secondary" className="font-normal">
                  on {m.accounts.in_use}
                </Badge>
              ) : (
                <Badge variant="outline" className="font-normal text-muted-foreground">
                  on an unsaved account
                </Badge>
              )}
              {m.accounts.auto && (
                <span className="text-xs text-muted-foreground">
                  {m.accounts.auto.held
                    ? `held on ${m.accounts.auto.held}`
                    : `switches ${m.accounts.auto.primary} → ${m.accounts.auto.secondary} at a limit`}
                </span>
              )}
            </div>
            {m.accounts.accounts.map((a) => (
              <Row key={a.name} className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 px-0 sm:grid-cols-[8rem_1fr_1fr]">
                <span className="text-sm">{a.name}</span>
                <Meter label="5-hour" w={a.five_hour} />
                <Meter label="Weekly" w={a.weekly} className="col-start-2 sm:col-start-auto" />
              </Row>
            ))}
          </li>
        ))}
      </ul>
    </Group>
  );
}

/** Green, then orange from 70%, red from 90%: Apple's colors for fine, look, stop. */
function Meter({ label, w, className }: { label: string; w: UsageWindow; className?: string }) {
  const percent = w?.percent ?? null;
  const color = percent === null ? "gray" : percent >= 90 ? "red" : percent >= 70 ? "orange" : "green";
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">
          {percent === null ? "–" : `${percent}%`}
          {w?.resets_at && <span className="ml-1">· {resetsIn(w.resets_at)}</span>}
        </span>
      </div>
      <Progress
        value={percent ?? 0}
        aria-label={`${label} use`}
        className="mt-1 h-1.5"
        indicatorStyle={{ background: `var(--sys-${color})` }}
      />
    </div>
  );
}

function resetsIn(iso: string): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  if (mins >= 1440) return `resets in ${Math.floor(mins / 1440)}d`;
  if (mins >= 60) return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `resets in ${mins}m`;
}
